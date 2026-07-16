"""DataFrame and object → JSON-friendly helpers.

Centralized so route handlers stay thin: one ``frame_to_payload``
call converts a pandas DataFrame to the ``(columns, rows)`` shape
expected by :class:`aggregate_api.models.FrameResponse`.

Numeric/string coercion notes
-----------------------------

* NaN / Inf serialize to None -- strict JSON forbids them and
  ``json.dumps(float("nan"))`` produces non-parseable output that
  some clients reject.
* MultiIndex columns are flattened with ``.`` joins so the wire
  format stays a plain list-of-strings (``"freq.mean"``,
  ``"sev.cv"``). The client can split back on ``.`` if needed.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


def _safe(value: Any) -> Any:
    """Coerce one cell to a JSON-friendly value.

    * Non-finite floats → None (strict JSON).
    * numpy scalars → native Python (avoids ``numpy.int64`` objects
      breaking ``json.dumps``).
    * numpy arrays / list-likes → nested lists (recursive coerce).
    * ``pd.NA`` / ``pd.NaT`` → None.
    * Everything else falls back to ``str()`` so a single weird
      cell can't 500 the whole response.
    """
    if value is None:
        return None
    # pandas NA / NaT sentinels don't compare cleanly via ``is None``.
    if value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (np.integer, np.floating)):
        value = value.item()
    if isinstance(value, float):
        # math.isfinite covers NaN, +Inf, -Inf.
        if not math.isfinite(value):
            return None
    if isinstance(value, np.ndarray):
        # 0-d arrays ``np.array(3.)``: .tolist() returns a scalar
        # (not iterable). Higher-d: returns a (possibly nested) list.
        as_list = value.tolist()
        if isinstance(as_list, list):
            return [_safe(v) for v in as_list]
        return _safe(as_list)
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    # ``str``, ``int``, ``bool``, ``float`` are JSON-native; let
    # anything else through as its str() form so unexpected dtypes
    # don't blow up serialization.
    if isinstance(value, (str, int, bool, float)):
        return value
    return str(value)


def reset_index_safe(df: pd.DataFrame) -> pd.DataFrame:
    """``df.reset_index()`` that tolerates duplicate names.

    ``Aggregate.density_df`` has its index named ``'loss'`` and a
    column named ``'loss'`` -- a plain ``reset_index()`` raises
    ``ValueError: cannot insert loss, already exists``. Detect that
    case and return the frame unchanged (the column already carries
    the index values).

    For a MultiIndex with one or more names colliding with existing
    columns, we let pandas raise -- that case is rare and signals
    a real upstream issue.
    """
    idx = df.index
    if idx.name is None and not isinstance(idx, pd.MultiIndex):
        # Anonymous single-level index -- nothing to surface.
        return df
    if isinstance(idx, pd.MultiIndex):
        return df.reset_index()
    if idx.name in df.columns:
        # Column already carries the index values; reset would
        # collide. Leave the frame as-is.
        return df
    return df.reset_index()


def _flatten_columns(columns: pd.Index) -> list[str]:
    """MultiIndex → list of ``"a.b.c"`` strings; plain Index → list of str."""
    if isinstance(columns, pd.MultiIndex):
        return [".".join(str(p) for p in tup) for tup in columns.values]
    return [str(c) for c in columns]


def frame_to_payload(
    df: pd.DataFrame,
    *,
    cols: list[str] | None = None,
    start: int | None = None,
    stop: int | None = None,
    downsample: int | None = None,
) -> dict:
    """Convert a DataFrame to the ``FrameResponse`` payload.

    Parameters
    ----------
    df : pandas.DataFrame
        Source frame. The index is *not* included in the output
        unless explicitly named -- callers can ``df.reset_index()``
        first if they want it.
    cols : list[str] | None
        Subset of columns to return. Names absent from the frame are
        silently dropped (callers can request a generic set and let
        the api filter).
    start, stop : int | None
        Positional row slice (NOT label slice). ``None`` means
        unbounded on that side.
    downsample : int | None
        If set, return at most this many rows -- evenly spaced
        across whatever slice survived the start/stop. Used by
        the SPA to render a 2**16-row density_df at sensible
        display resolution.
    """
    if cols:
        # Tolerate caller passing column names that aren't on this
        # frame -- the SPA might ask for "exeqa_total" on an
        # Aggregate (no such column) without failing the round-trip.
        existing = [c for c in cols if c in df.columns]
        df = df[existing]

    # Positional slicing first, then downsample. Downsampling
    # *after* slicing means a request like ``start=0, stop=1000,
    # downsample=100`` returns 100 rows from the first 1000, not
    # 100 rows spread across the whole 2**N grid.
    sliced = df.iloc[slice(start, stop)]

    if downsample is not None and len(sliced) > downsample > 0:
        # Even-spaced index sampling. linspace + round + unique
        # avoids duplicate row picks when downsample is close to
        # len(sliced).
        idx = np.unique(
            np.round(np.linspace(0, len(sliced) - 1, downsample)).astype(int)
        )
        sliced = sliced.iloc[idx]

    columns = _flatten_columns(sliced.columns)
    # ``.to_numpy()`` is faster than .values and preserves dtype.
    rows = [
        [_safe(v) for v in row]
        for row in sliced.to_numpy().tolist()
    ]
    return {"columns": columns, "rows": rows}


# Default display resolution for the binned density: 2**11 = 2048 rows. A
# density built at log2 = N is reduced to this many grid-aligned super-buckets,
# i.e. shown as if built at a coarser ``bs`` while the fine build is kept.
DENSITY_DISPLAY_LOG2 = 11


def bin_density(
    df: pd.DataFrame,
    source_log2: int,
    *,
    sum_cols: set[str],
    label_col: str = "loss",
    display_log2: int = DENSITY_DISPLAY_LOG2,
) -> pd.DataFrame:
    """Aggregate a density frame onto a coarser power-of-two display grid.

    The density grid has ``2**source_log2`` rows. We reduce it to exactly
    ``2**display_log2`` rows binned by a factor ``k = 2**j``
    (``j = source_log2 - display_log2``) -- the density "as if built at a
    coarser ``bs' = k * bs``", with no loss of severity detail in the fine
    build. This keeps the power-of-two paradigm.

    Buckets are **centered on the coarse grid nodes** (the "around x_i"
    convention). Node ``i`` sits at ``loss = i * bs'`` (a clean multiple:
    0, bs', 2*bs', …) and owns the fine buckets in the half-open window
    ``(i*bs' - bs'/2, i*bs' + bs'/2]``. So with ``bs' = 320`` the first row is
    labeled ``0`` and covers ``loss <= 160``; the second is labeled ``320`` and
    covers ``160 < loss <= 480``; and so on. The first bucket is a left
    half-window (nothing below 0) and the final node absorbs the short tail, so
    the partition is exact and the row count stays ``2**display_log2``.

    Column reductions:

    * **mass columns** (``sum_cols`` -- ``p_total`` / ``p_sev`` / any ``p_*``)
      are **summed** over the window (probability-conserving);
    * the **label column** (``label_col``, default ``loss``) takes the node
      center ``i * bs'`` -- the clean coarse-grid label;
    * **every other column** (``F`` / ``S`` / the ``ex***`` series) takes the
      window's **right edge** (``last``). For ``F`` / ``S`` that makes the
      surfaced value the running cumulative through the bucket, so
      ``F[i] - F[i-1]`` equals the summed mass ``p_total[i]`` -- the same
      convention a native coarse build uses (``F`` = cumsum of the masses).

    Parameters
    ----------
    df : pandas.DataFrame
        Density frame (already index-reset, ``loss`` a column).
    source_log2 : int
        ``log2`` of the underlying build grid.
    sum_cols : set[str]
        Column names whose values are masses and should be summed.
    label_col : str, default ``"loss"``
        The coarse-grid label column, sampled at each node center. Absent from
        the frame is fine (then no column is treated as the label).
    display_log2 : int, default ``DENSITY_DISPLAY_LOG2``
        Target ``log2`` of the displayed grid. ``source_log2 <= display_log2``
        means no binning (``k == 1``) -- the frame is returned unchanged.

    Returns
    -------
    pandas.DataFrame
        The binned frame, column order preserved, with a fresh 0..2**m index.

    Notes
    -----
    Grouping is positional, not value-based, so it does not depend on the index
    being clean or monotone. ``(arange(n) + k//2 - 1) // k`` (clamped to the last
    node) assigns each fine index to the nearest node under the upper-inclusive
    ``(node - bs'/2, node + bs'/2]`` rule; the node centers themselves are the
    fine rows ``0, k, 2k, …``.
    """
    j = max(0, int(source_log2) - int(display_log2))
    k = 1 << j
    if k == 1:
        return df
    n = len(df)
    half = k // 2
    num_groups = (n - 1) // k + 1
    # Nearest-node assignment under the (node - bs'/2, node + bs'/2] rule, with
    # the short tail folded into the final node so the partition is exact.
    groups = np.minimum((np.arange(n) + half - 1) // k, num_groups - 1)
    # Node centers are the fine rows 0, k, 2k, … (capped at the last row).
    center_idx = np.minimum(np.arange(num_groups) * k, n - 1)

    cols = list(df.columns)
    out: dict[str, np.ndarray] = {}
    for col in cols:
        series = df[col]
        if col in sum_cols:
            out[col] = series.groupby(groups, sort=True).sum().to_numpy()
        elif col == label_col:
            out[col] = series.to_numpy()[center_idx]
        else:
            # Window right edge -> F/S read as the cumulative through the bucket.
            out[col] = series.groupby(groups, sort=True).last().to_numpy()
    return pd.DataFrame(out, columns=cols)


def pnl_density_frame(obj: Any) -> pd.DataFrame:
    """Synthesize a ``loss / p_total / F / S`` density frame from a PnL result.

    A :class:`PnL` object's ``density_df`` is an ``OrderedDict`` of per-leg
    ``GridDistribution``s, not a single DataFrame, so it can't flow through the
    generic density path. Its ``result`` attribute is the grand-result
    ``GridDistribution`` (the consolidated P&L outcome), carrying the outcome
    grid ``x`` and its probability masses ``p``. We surface it in the same
    ``loss / p_total / F / S`` shape the SPA density plot expects for an
    aggregate, so the Overview and Density views render unchanged.

    Parameters
    ----------
    obj : Any
        A built ``PnL`` object exposing ``result.x`` / ``result.p``.

    Returns
    -------
    pandas.DataFrame
        Columns ``loss`` (outcome), ``p_total`` (mass), ``F`` (cdf), ``S``
        (survival), one row per grid node, ascending in ``loss``.

    Notes
    -----
    The P&L outcome axis is *signed* -- losses are negative -- unlike an
    aggregate's non-negative loss grid. The downstream reduction
    (:func:`bin_density`) is positional and samples the real ``loss`` value at
    each node, so it makes no non-negativity assumption and bins the signed grid
    faithfully.
    """
    gd = obj.result
    x = np.asarray(gd.x, dtype=float)
    p = np.asarray(gd.p, dtype=float)
    cdf = np.cumsum(p)
    return pd.DataFrame({"loss": x, "p_total": p, "F": cdf, "S": 1.0 - cdf})


def info_to_payload(obj: Any) -> dict:
    """Return ``{"info": "..."}``.

    :attr:`Aggregate.info` and :attr:`Portfolio.info` are
    multi-line strings (formatted summaries). We expose them
    verbatim; clients display in a monospaced block.

    A ``PnL`` object has no ``info`` string; it carries the equivalent narrative
    on ``construction_explanation``. We fall back to that so the Info tab isn't
    blank for a P&L build. Both accesses are getattr-gated, so an object kind
    with neither simply reports an empty string.
    """
    info = getattr(obj, "info", "") or getattr(obj, "construction_explanation", "")
    if not isinstance(info, str):
        # Fallback for objects that override .info as something
        # else -- str() coerces to a usable rendering.
        info = str(info)
    return {"info": info}
