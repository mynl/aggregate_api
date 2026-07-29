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


# Default display resolution for the binned density: 2**13 = 8192 rows. A
# density built at log2 = N is reduced to this many grid-aligned super-buckets,
# i.e. shown as if built at a coarser ``bs`` while the fine build is kept.
#
# Why 13 and not the 11 this shipped with: a discretized aggregate is routinely
# **atomic**, not merely spiky. A book written over layer limits, or with an
# occurrence cession, puts point masses in the severity and the aggregate
# inherits them at every multiple. Measured on one such program (limits
# ``250 500 1000 2000 xs 0``, ``750 xs 750`` occurrence cession, ``log2=16``,
# ``bs=1``): single buckets at 0 / 250 / 500 / 750 hold 8.6% / 12.9% / 10.0% /
# 5.7% of the mass against a continuum of 0.07% per bucket. Binning 32 fine
# buckets into one (which 2**11 does at ``log2=16``) merged each atom with 31
# neighbours and located it only to within half a super-bucket, so the plot drew
# a triangle 64 loss units wide where the truth is a spine one unit wide.
DENSITY_DISPLAY_LOG2 = 13

# Cell budget for one density payload, roughly 2**16 numbers. The row target
# above is right for the four-column ``loss / p_total / F / S`` case; a
# Portfolio's per-unit frame is 2 * units + 3 columns wide and would ship several
# megabytes of JSON at the same row count. Trading rows for columns keeps the
# payload flat instead of scaling with the unit count.
DENSITY_DISPLAY_CELLS = 1 << 16


def display_log2_for(n_cols: int, cap: int = DENSITY_DISPLAY_LOG2) -> int:
    """Display ``log2`` for a frame ``n_cols`` wide, under the cell budget.

    Parameters
    ----------
    n_cols : int
        Number of columns the payload will carry.
    cap : int, optional
        Upper bound, :data:`DENSITY_DISPLAY_LOG2` by default.

    Returns
    -------
    int
        ``log2`` of the row target: ``cap`` for a narrow frame, reduced by whole
        powers of two until ``rows * n_cols`` fits :data:`DENSITY_DISPLAY_CELLS`.
        Never below 11, which is the resolution this shipped with and the floor
        at which a density is still worth drawing.

    Examples
    --------
    Four columns keep the full grid; an eleven-column portfolio frame steps down
    one notch.

    >>> display_log2_for(4)
    13
    >>> display_log2_for(11)
    12
    """
    rows = DENSITY_DISPLAY_CELLS // max(1, int(n_cols))
    return max(11, min(cap, rows.bit_length() - 1))


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
        means no binning (``k == 1``), the frame is returned unchanged. Callers
        serving a wide frame should pass :func:`display_log2_for` rather than the
        bare default, so the payload stays inside the cell budget.

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


def severity_density_frame(obj: Any, n: int = 512) -> pd.DataFrame:
    """Synthesize a ``loss / pdf / F / S`` curve from a frozen severity.

    A :class:`Severity` is a look-through onto a frozen scipy random variable,
    not a compute result, so it carries no ``density_df``: upstream lists it in
    ``NEAR_FIRST_CLASS`` and exempts it from the DataFrame quartet for exactly
    that reason. The api still needs *something* to draw, so it samples the
    frozen variable here, the same presentation-layer move
    :func:`pnl_density_frame` makes for a ``PnL``.

    Parameters
    ----------
    obj : Any
        A built ``Severity`` exposing the scipy surface (``isf`` / ``pdf`` /
        ``cdf`` / ``sf``).
    n : int, optional
        Number of grid points. 512 is smooth at any plot width and trivial to
        serialize.

    Returns
    -------
    pandas.DataFrame
        Columns ``loss``, ``pdf``, ``F``, ``S``, one row per grid point,
        ascending in ``loss``.

    Notes
    -----
    The column is ``pdf``, **not** ``p_total``, and the distinction is load
    bearing: an aggregate's ``p_total`` is a probability *mass* per bucket that
    sums to one, while this is a density *ordinate* that does not. Reusing the
    aggregate's column name would invite summing a column that has no business
    being summed.

    The grid is built by inverting the survival function over log-spaced
    exceedance probabilities rather than by walking loss linearly. A severity is
    routinely heavy-tailed and its support often unbounded, so a linear grid
    either truncates the tail or wastes nearly every point on it. Quantile
    spacing puts points where the probability is.
    """
    # Log-spaced exceedance probabilities: dense near the median, and still
    # resolving the 1-in-100,000 tail without a huge grid.
    ps = np.concatenate([
        np.logspace(np.log10(1 - 1e-5), np.log10(0.5), n // 2, endpoint=False),
        np.logspace(np.log10(0.5), np.log10(1e-5), n - n // 2),
    ])
    loss = np.asarray(obj.isf(ps), dtype=float)
    # A bounded or discrete severity can repeat or invert; keep it monotone and
    # finite so the client never has to defend against a bad axis.
    ok = np.isfinite(loss)
    loss = np.unique(loss[ok])
    with np.errstate(divide="ignore", invalid="ignore"):
        pdf = np.asarray(obj.pdf(loss), dtype=float)
        cdf = np.asarray(obj.cdf(loss), dtype=float)
        sf = np.asarray(obj.sf(loss), dtype=float)
    return pd.DataFrame({"loss": loss, "pdf": pdf, "F": cdf, "S": sf})


def bivariate_marginal_frame(obj: Any) -> pd.DataFrame:
    """The two component marginals of a bivariate, as one long frame.

    A :class:`BivariateAggregate`'s ``density_df`` is the **joint** matrix: the
    axis-0 grid as the index and the axis-1 grid as the columns, so 2**16 cells
    or more. That is a picture, not a table, and serving it to a grid produces
    something no reader can use and a payload nobody wants. The marginals are
    what a table of a bivariate should say.

    Parameters
    ----------
    obj : Any
        A built ``BivariateAggregate`` exposing ``marginals`` (the exact pass-3
        fold, precomputed), ``axis_xs`` and ``unit_names``.

    Returns
    -------
    pandas.DataFrame
        Columns ``unit``, ``loss``, ``p``, ``F``, ``S``; the two components
        stacked, each ascending in ``loss``.

    Notes
    -----
    Long rather than wide because the two axes have **different grids** (and
    routinely different lengths: 2048 and 512 on one measured build). Aligning
    them side by side would mean padding one with nulls and inviting a reader to
    compare row `i` of one against row `i` of the other, which means nothing.
    ``unit`` is a real column, so the grid's own filter narrows to one component.

    ``marginals`` returns plain arrays that each sum to 1, so ``F`` is their
    cumulative sum and ``S`` its complement, exactly as for an aggregate.
    """
    marginals = obj.marginals
    grids = obj.axis_xs
    names = list(getattr(obj, "unit_names", None) or ["axis 0", "axis 1"])

    parts = []
    for i, (mass, loss) in enumerate(zip(marginals, grids)):
        mass = np.asarray(mass, dtype=float)
        loss = np.asarray(loss, dtype=float)
        cdf = np.cumsum(mass)
        parts.append(pd.DataFrame({
            "unit": names[i] if i < len(names) else f"axis {i}",
            "loss": loss,
            "p": mass,
            "F": cdf,
            # Clamped: accumulating thousands of floats to 1 overshoots by a few
            # parts in 1e15, and a negative survival is not a thing to serve.
            "S": np.maximum(0.0, 1.0 - cdf),
        }))
    return pd.concat(parts, ignore_index=True)


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
