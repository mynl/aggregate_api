"""Object lifecycle routes -- the heart of the api.

Endpoints
---------

The /v1/objects/* family covers everything object-shaped:

* ``POST   /v1/objects``         -- build + cache; returns slim manifest.
* ``GET    /v1/objects``         -- list cache contents.
* ``GET    /v1/objects/{id}``    -- per-object manifest.
* ``DELETE /v1/objects/{id}``    -- evict from cache.
* ``GET    /v1/objects/{id}/info``        -- text summary.
* ``GET    /v1/objects/{id}/meta``        -- note / tags / hints / program / pprogram.
* ``GET    /v1/objects/{id}/summary``     -- summary_df risk view (moments + percentiles).
* ``GET    /v1/objects/{id}/tail_df``     -- return-period / exceedance table.
* ``GET    /v1/objects/{id}/validation_df`` -- moment-vs-estimate QA table.
* ``GET    /v1/objects/{id}/stats_df``    -- stats_df DataFrame.
* ``GET    /v1/objects/{id}/density_df``  -- paginated density frame.
* ``GET    /v1/objects/{id}/kappa``       -- Portfolio exeqa_* slice.
* ``GET    /v1/objects/{id}/reins_description`` -- reinsurance text block.
* ``GET    /v1/objects/{id}/reins_summary_df`` -- per-layer summary frame.
* ``GET    /v1/objects/{id}/reins_stats_df``    -- per-layer stats frame.
* ``GET    /v1/objects/{id}/reins_density_df``  -- density preview frame.
* ``GET    /v1/objects/{id}/frame/{which}.csv`` -- full-frame CSV download.
* ``GET    /v1/objects/{id}/frame/{which}``     -- table document for the
  static view (``?format=ir``), built from the DataFrame rather than the
  flattened wire format.
* ``GET    /v1/objects/{id}/plot``        -- SVG/PNG image (native .plot()).
* ``POST   /v1/objects/{id}/pricing/preview``   -- the pentagon as scalars.
* ``POST   /v1/objects/{id}/pricing/calibrate`` -- the ``pricing.calibrate`` and
  ``pricing.stand_alone`` exhibit envelopes, both perspectives.
* ``POST   /v1/objects/{id}/pricing/allocate``  -- the ``pricing.allocate``
  exhibit envelope, both perspectives.
* ``POST   /v1/objects/{id}/pricing/evaluate``  -- the ``pricing.evaluate``
  envelope, both perspectives.

Build pipeline (POST /v1/objects)
---------------------------------

1. Validate ``log2`` against the cap. Reject early.
2. Compute the content-hash id for the (canonical_decl, log2, bs)
   triple.
3. If cached: bump LRU, audit ``status='ok'``, return slim response.
4. Otherwise: acquire the build semaphore (single concurrent
   build), submit to a thread-pool with a wall-clock timeout, and
   either store the result + audit ``ok`` or audit
   ``parse_error / build_error / timeout``.

Why a thread-pool + future timeout
----------------------------------

``concurrent.futures.ThreadPoolExecutor`` is the simplest way to
get a hard wall-clock cap on a synchronous library call. Python
can't truly cancel a CPU-bound thread, but the api stops waiting
on it and returns 504 so the SPA doesn't hang. The thread keeps
running until ``build()`` returns -- documented caveat in the plan.

Per-button-fetch UX
-------------------

The build response carries only ``id``, ``kind``, ``name``,
``warnings``, ``cached``, ``elapsed_ms``. The SPA shows that
immediately and only fetches info/summary/plot/pricing when the
user clicks the matching button. Second visits hit the cache and
return in milliseconds.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
import warnings
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Literal

import pandas as pd

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from lark.exceptions import UnexpectedInput, VisitError

from aggregate import Distortion, Severity, build as _build_singleton
from aggregate import charts as agg_charts
from aggregate import exhibits as agg_exhibits
from aggregate.constants import FIRST_CLASS_CLASSES, NEAR_FIRST_CLASS
from aggregate.parser_errors import ErrorReport, format_error

from .. import models
from ..audit import AuditLog
from ..cache import CacheEntry, ObjectCache, canonicalize_decl, object_id
from ..bounds import run_allocation, run_envelope, run_pricing_bounds
from ..capability import can_sharpen, capability_for, narrative_for
from ..config import Settings, get_settings
from ..library_notes import from_library
from ..pricing import (
    run_calibration, run_evaluation, run_natural_allocation,
    run_pricing_preview,
)
from ..tables import MAX_ROWS, frame_document
from ..serializers import (
    bin_density,
    bivariate_marginal_frame,
    display_log2_for,
    frame_to_payload,
    info_to_payload,
    pnl_density_frame,
    reset_index_safe,
    severity_density_frame,
)


logger = logging.getLogger(__name__)

router = APIRouter()


# ----------------------------------------------------------------------
# DecL hints{} log2 scan
# ----------------------------------------------------------------------
# The log2 cap (``AGGAPI_LOG2_CAP``) is a DoS guard, but a program can
# dodge a request-level cap by embedding ``hints{ log2=24 }`` in the DecL
# source -- ``build()`` honors that hint, so the effective grid is 2**24
# regardless of the request log2. We extract the log2 out of any
# ``hints{ ... }`` block straight from the source, before building, and
# enforce the cap against the *effective* log2 (request vs hint, whichever
# is larger). ``[^}]*`` keeps the match inside one block so a bs-only
# ``hints{}`` can't false-match; ``findall`` + max handles a multi-line
# ``port`` with several agg lines. This is a guard, not a parser: a
# non-integer log2 expression won't match ``\d+`` and slips through -- not
# a real hint form, so acceptable.
_HINTS_LOG2 = re.compile(r"hints\s*\{[^}]*\blog2\s*=\s*(\d+)", re.IGNORECASE)


# ----------------------------------------------------------------------
# Process-wide singletons
# ----------------------------------------------------------------------
# The cache and audit log are created lazily on first use. They're
# *not* created at import time because tests rely on env-var-driven
# config (audit-db location) being read after monkeypatching.
# ``_get_cache`` / ``_get_audit`` are pulled via Depends so the
# objects stay in module-level state where production code wants
# them, but they're reachable for monkeypatching in tests.
#
# Build-side concurrency: a single semaphore caps in-flight heavy
# builds at 1, regardless of how many requests are queued up. Reads
# (info / summary / plot) don't touch it -- they're O(ms) lookups
# on the already-built object.
_cache_lock = threading.Lock()
_cache_singleton: ObjectCache | None = None
_audit_singleton: AuditLog | None = None

# Single-slot semaphore = only one heavy build runs at a time.
# Heavy builds happen rarely (most requests are cache hits); the
# semaphore prevents an accidental "build a 2**18 portfolio four
# times" pile-up from saturating the box.
_build_semaphore = threading.Semaphore(1)

# A small thread pool, one worker, used solely to enforce build
# timeouts. ``future.result(timeout=T)`` is the cleanest pattern
# for "give up on a synchronous call after N seconds" in Python.
_build_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="agg-build")


def _get_cache(settings: Settings = Depends(get_settings)) -> ObjectCache:
    """Lazy-init the cache singleton with the configured max size."""
    global _cache_singleton
    with _cache_lock:
        if _cache_singleton is None or _cache_singleton._max != settings.cache_max:
            _cache_singleton = ObjectCache(max_entries=settings.cache_max)
    return _cache_singleton


def _get_audit(settings: Settings = Depends(get_settings)) -> AuditLog:
    """Lazy-init the audit-log singleton at the configured DB path."""
    global _audit_singleton
    with _cache_lock:
        if _audit_singleton is None or str(_audit_singleton.db_path) != settings.audit_db:
            _audit_singleton = AuditLog(settings.audit_db)
    return _audit_singleton


def reset_singletons() -> None:
    """Drop the cached cache + audit so the next request re-inits.

    Hook for tests that swap env vars across cases -- the
    ``client`` fixture in ``tests/api/conftest.py`` calls this.
    """
    global _cache_singleton, _audit_singleton
    with _cache_lock:
        _cache_singleton = None
        _audit_singleton = None
    with _chart_cache_lock:
        _chart_cache.clear()


# ----------------------------------------------------------------------
# The chart-document cache
# ----------------------------------------------------------------------
# Keyed on ``(oid, name, window, detail, encoding)``: everything that changes
# the bytes, which is what makes it the same key the ETag answers for. It sits
# *above* the object cache and can never cause a build, so no chart parameter
# is ever a reason to re-run an FFT. An ``oid`` is the content hash of
# ``(decl, log2, bs)``, so an entry cannot go stale under its own key: the only
# way to get different numbers is a different key.
#
# What it buys is the revalidation path. A conditional GET has to know the
# document's hash before it can answer 304, and the hash is only known by
# building the document; without a cache every ``If-None-Match`` would redo the
# window-and-reduce work in order to reply "nothing changed". A joint surface at
# a high ``detail`` is the first chart in this app where that is real work.
#
# Small on purpose, and bounded by entries rather than bytes because the entries
# a reader generates in one sitting are one object's charts at a few settings of
# the knob. A surface at the public ceiling of 256 cells per axis is a few
# hundred kB; at the local default of 1024 it can be a few MB, so eight entries
# is a worst case of a few tens of MB.
_CHART_CACHE_MAX = 8
_chart_cache: OrderedDict[tuple, tuple[str, bytes]] = OrderedDict()
_chart_cache_lock = threading.Lock()


def _chart_cached(key: tuple) -> tuple[str, bytes] | None:
    """Return the cached ``(etag, body)`` for ``key``, or None, marking it used."""
    with _chart_cache_lock:
        hit = _chart_cache.get(key)
        if hit is not None:
            _chart_cache.move_to_end(key)
        return hit


def _chart_store(key: tuple, etag: str, body: bytes) -> None:
    """File ``(etag, body)`` under ``key``, evicting the least recently read."""
    with _chart_cache_lock:
        _chart_cache[key] = (etag, body)
        _chart_cache.move_to_end(key)
        while len(_chart_cache) > _CHART_CACHE_MAX:
            _chart_cache.popitem(last=False)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    """Best-effort client IP. Returns ``"-"`` if FastAPI didn't capture one."""
    if request.client and request.client.host:
        return request.client.host
    return "-"


def _now_iso() -> str:
    """ISO 8601 timestamp with millisecond precision."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class _NoteCollector(logging.Handler):
    """A logging handler that keeps formatted records in a list."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.notes: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        # Never let a bad format string in someone else's log call break a
        # build: the notes are a courtesy, the object is the product.
        try:
            self.notes.append(record.getMessage())
        except Exception:  # noqa: BLE001 -- see above
            pass


@contextmanager
def _collecting_notes():
    """Collect what ``aggregate`` says while a build runs, on both channels.

    Yields a list that fills with the messages the library emitted at WARNING
    and above. Empty is the common case and means the build had nothing to say.

    Notes
    -----
    **Two channels, because the library uses two.** ``logger.warning`` is the
    larger by far (``_aggregate``, ``underwriter`` and ``parser`` alone account
    for most of it) and carries the messages a reader most wants, such as a
    splice whose components do not meet. ``warnings.warn`` carries the rest,
    including the library's own ``IgnoredDecLClauseWarning`` family. Capturing
    only one of them would have looked like it worked, on whichever example was
    tried first.

    **Both mutate process-global state, and this runs on the build worker
    thread.** That is safe here for a structural reason rather than a hopeful
    one: ``_build_semaphore`` admits one build at a time and
    ``_build_executor`` has a single worker, so there is exactly one writer to
    the logger's handler list and to the warnings filters while this is open.
    Entering the context *inside* the worker (rather than around
    ``future.result()`` on the calling thread) is deliberate:
    ``catch_warnings`` swaps module state that a warning raised on another
    thread would not reliably see.

    **Both channels are scoped to the library, and both need scoping.** The
    handler goes on the ``aggregate`` logger rather than the root, so nothing
    this service logs about itself is mistaken for something the model said.
    The warnings half needs the same discipline, and
    :mod:`aggregate_api.library_notes` is where that rule now lives, because
    this was not the only capture site: ``pricing.py`` held two more and kept
    everything they caught, which is how the audit log's own
    ``unclosed database in <sqlite3.Connection ...>`` reached a reader's status
    strip through the Price tab while this route filtered it out correctly.
    Both use :func:`~aggregate_api.library_notes.from_library` now.

    The loop below is spelled out rather than using
    :func:`~aggregate_api.library_notes.library_warnings`, because this one has
    to interleave with the logging collector: the notes from both channels land
    in one list, in the order they were said.
    """
    collector = _NoteCollector()
    lib_logger = logging.getLogger("aggregate")
    lib_logger.addHandler(collector)
    # A library logger with no handler and no propagation would drop records
    # before ours ran; and one whose level is above WARNING would never emit
    # them at all. Force both for the duration and restore after.
    was_level = lib_logger.level
    if was_level > logging.WARNING or was_level == logging.NOTSET:
        lib_logger.setLevel(logging.WARNING)
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            yield collector.notes
            for w in caught:
                if from_library(getattr(w, "filename", "")):
                    collector.notes.append(str(w.message))
    finally:
        lib_logger.removeHandler(collector)
        lib_logger.setLevel(was_level)


def _run_build(decl: str, log2: int, bs: float):
    """Invoke the underlying ``build()``, collecting what it says.

    Pulled into a helper so the thread-pool target is a plain
    function -- closures over ``log2=0`` / ``bs=0`` are the
    library's "let me pick" signal, so we forward the request's
    values verbatim.

    Returns
    -------
    tuple
        ``(obj, notes)``, the built object and the library's WARNING-and-above
        messages. See :func:`_collecting_notes` for why the capture is opened
        here, on the worker, rather than around the future.
    """
    # log2=0 / bs=0 are the underlying ``build()``'s "use defaults"
    # sentinels; pass them through when the request omitted those
    # knobs.
    with _collecting_notes() as notes:
        obj = _build_singleton(decl, log2=log2, bs=bs)
    return obj, notes


def _resolve_object(oid: str, cache: ObjectCache) -> CacheEntry:
    """Fetch an entry or raise 404."""
    entry = cache.get(oid)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"object {oid} not in cache")
    return entry


def _locked_entry(oid: str, cache: ObjectCache = Depends(_get_cache)):
    """Dependency: resolve an object and hold its lock for the whole request.

    Every route that pulls data off a built object depends on this rather than
    calling :func:`_resolve_object` in its body, which makes the guarantee
    structural instead of a habit each new handler has to remember.

    Why a lock at all, for something described as a read: an ``Aggregate`` or
    ``Portfolio`` materializes several frames lazily and caches them on the
    instance, so the first read *is* a write. FastAPI runs these synchronous
    handlers in a thread pool, so two requests for different frames of the same
    object are genuinely two threads racing to build them.

    Measured, not theoretical. Fetching ``unit_density_df`` and ``tail_df``
    together for one Portfolio (exactly what the Overview exhibit does, in a
    single ``Promise.all``) raised ``KeyError: "['F', 'S'] not in index"`` from
    inside ``Portfolio.unit_density_df`` on roughly half of cold-object runs,
    and never once the frames were warm.

    The lock is per entry, so unrelated objects still serve in parallel, and
    contention is confined to the first access of each frame.

    A bare generator, deliberately **not** wrapped in ``@contextmanager``:
    FastAPI drives a yield-dependency as an iterator itself, and the wrapper
    hands it a context-manager object instead, which fails with
    ``'_GeneratorContextManager' object is not an iterator``.

    Yields
    ------
    CacheEntry
    """
    entry = _resolve_object(oid, cache)
    with entry.lock:
        yield entry


def _has_reinsurance(obj: Any) -> bool:
    """Does this object's distribution sit net of a cession?

    Reads the cession specs directly (``occ_reins`` / ``agg_reins``) rather than
    materializing ``reins_summary_df``, because this is called on the build path
    for every object and that frame is not cheap.

    A ``Portfolio`` carries no cession of its own, so it is asked about its
    units. The recursion is gated on the class name rather than on iterability:
    an ``Aggregate`` is iterable too, and walking one here would be a loop with
    no base case.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    if getattr(obj, "occ_reins", None) is not None:
        return True
    if getattr(obj, "agg_reins", None) is not None:
        return True
    if type(obj).__name__ == "Portfolio":
        return any(_has_reinsurance(unit) for unit in obj)
    return False


def _value_type(obj: Any) -> str | None:
    """The sign convention the object is read on: ``'loss'`` or ``'payoff'``.

    Parameters
    ----------
    obj : Any
        Any first-class object.

    Returns
    -------
    str or None
        The convention's label, or ``None`` for a kind that has no orientation
        to report (a ``Distortion``, a ``Severity``).

    Notes
    -----
    **Always reported, including ``'loss'``.** a57 printed it only for
    ``'payoff'``, reasoning that loss is the default and stamping it on every
    build adds noise to a line that has been trimmed twice. The reasoning was
    sound and the outcome was that the field printed for **no object the app can
    build**: ``Aggregate`` and ``Portfolio`` both answer ``'loss'`` and were
    suppressed, and a ``PnL`` has no ``value_type`` at all. The author's ruling,
    2026-08-10, is that the convention is worth a word on every build, which is
    what asking for it in the first place meant.

    **Read off the object, never asserted about it.** a65 carried a special
    case here: a ``PnL`` exposed neither ``value_type`` nor the internal
    ``_is_loss_value``, and it is the one kind whose reading genuinely depends
    on the convention, so the app stated ``payoff`` on the author's ruling
    ("implied by the name, profit positive and loss negative") while knowing
    that was the app holding a fact about a library class from outside it. It
    came out at a68: ``aggregate`` 1.0.0a248 states the convention on the class,
    which is where it belongs, and this is a plain read again.
    """
    declared = getattr(obj, "value_type", None)
    return str(declared) if declared is not None else None


def _summary_fields(obj: Any) -> dict:
    """Headline grid and moments for the build summary: ``bs``, ``log2``,
    ``mean``, ``cv``, ``validation``.

    ``Aggregate`` and ``Portfolio`` carry the analytic moments on ``actual_m`` /
    ``actual_cv`` and the realized (model-output) ones on ``est_m`` / ``est_cv``.
    The summary shows the analytic value, which is what the program asked for,
    and falls back to the estimate: a ``PnL`` has only ``est_*`` (its outcome is
    emergent, so there is no input mean to report).

    **Under reinsurance that order reverses**, and it is not a preference. The
    two attributes then describe two different random variables: ``actual_m`` is
    the analytic mean of the *subject* (gross) book, while the object's density,
    every percentile, ``summary_df`` and the plotted distribution are all
    **net**. On one measured program (limits ``250 500 1000 2000 xs 0`` with a
    ``750 xs 750`` occurrence cession) that is 12,000 against 549.5, so the
    summary bar reported a number twenty-two times the one in the table directly
    beneath it, and the exhibit drew its mean reference line off the end of the
    axis. The library is not wrong here: ``validation_description`` says
    "reinsurance; subject not unreasonable", which is it telling you exactly
    which variable ``actual_m`` belongs to.

    Notes
    -----
    The ``agg_m`` / ``agg_cv`` spellings this used to read were renamed to
    ``actual_*`` at ``aggregate`` 1.0.0a149, and there is no alias. Everything is
    getattr-gated, so an object kind carrying none of them reports ``None``
    rather than raising.
    """
    def _num(*names: str) -> float | None:
        # First present, float-coercible attribute wins; skip missing or
        # non-numeric ones so a PnL's ``est_m`` backs up the ``actual_m`` miss.
        for name in names:
            v = getattr(obj, name, None)
            if v is None:
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    # The terse verdict ("not unreasonable" / "fails sev mean, agg mean") is
    # ``validation_description``. Do NOT read ``validation_explanation``: since
    # aggregate 1.0.0a172 that is the long form it always claimed to be, a whole
    # paragraph naming what was checked, which would swamp the one-line summary.
    # getattr-gated so an object kind without it simply reports ``None``.
    validation: str | None = None
    description = getattr(obj, "validation_description", None)
    if description is not None:
        validation = str(description)

    # Net of a cession, the realized moments are the ones that describe what is
    # on screen; gross, the analytic ones are exact and the estimates carry
    # discretization error. Either way the fallback is the other one.
    reinsured = _has_reinsurance(obj)
    m, cv = ("est_m", "actual_m"), ("est_cv", "actual_cv")
    if not reinsured:
        m, cv = m[::-1], cv[::-1]

    # ``log2`` rides beside ``bs`` because the two are one fact: bs is how fine
    # the grid is and log2 is how far it reaches, and bs * 2**log2 is the window
    # the object was computed on. An int, and int-coerced rather than
    # float-coerced, so the strip prints ``log2 = 16`` and not ``16.0``.
    log2 = getattr(obj, "log2", None)
    try:
        log2 = int(log2) if log2 is not None else None
    except (TypeError, ValueError):
        log2 = None

    value_type = _value_type(obj)

    return {
        "bs": _num("bs"),
        "log2": log2,
        "mean": _num(*m),
        "cv": _num(*cv),
        "validation": validation,
        "has_reins": reinsured,
        "value_type": str(value_type) if value_type is not None else None,
        "components": _component_fields(obj),
    }


def _component_fields(obj: Any) -> list[dict]:
    """Per-component grid and moments, for an object built from a pair.

    Returns
    -------
    list of dict
        ``{"name", "bs", "log2", "mean", "cv"}`` per component, or ``[]`` for
        an object that is not a pair.

    Notes
    -----
    Only a ``BivariateAggregate`` answers this today, and it is the reason the
    block exists: its ``bs`` is a **two element list**, one grid per axis, so
    every scalar field in :func:`_summary_fields` comes back ``None`` for it
    and its status line said nothing but a name and a kind. The pair is the
    honest answer, not a scalar chosen from it.

    Additive, deliberately. Widening ``bs`` / ``log2`` / ``mean`` / ``cv`` to
    "scalar or pair" would change the response type every other kind is read
    with, to describe one kind; a block that is empty everywhere else costs
    those kinds nothing.

    ``log2`` is derived rather than read: a bivariate carries no ``log2``
    attribute, only the per-axis grids, and the axis length is what log2 means
    (the library's own ``bs_description`` computes it the same way).

    **The moments come off ``stats_df``, not off ``units``.** a57 read them from
    ``obj.units``, on the stated belief that it holds a list of ordinary
    ``Aggregate`` objects. It does not: ``units`` is ``None`` on a
    ``BivariateAggregate``, so both moments resolved to ``None`` and the strip
    printed ``mean (?, ?) . CV (?, ?)`` for every pair built since. ``stats_df``
    is the public frame that has them, and its columns are exactly
    ``unit_names``, so the pair lines up by name rather than by position. The
    ``units`` path is kept ahead of it for a kind that does carry components,
    and costs nothing when there are none.

    ``theoretical`` before ``empirical``, matching the scalar path's preference
    for the analytic moment with the realized one as the fallback. On a
    bivariate the two agree to about 1e-11 anyway, so the order is a convention
    rather than a choice with consequences.
    """
    axis_xs = getattr(obj, "axis_xs", None)
    names = getattr(obj, "unit_names", None)
    units = getattr(obj, "units", None)
    bss = getattr(obj, "bs", None)
    if not axis_xs or not names or not isinstance(bss, (list, tuple)):
        return []
    stats = getattr(obj, "stats_df", None)

    def _moment(unit: Any, *candidates: str) -> float | None:
        for name in candidates:
            v = getattr(unit, name, None)
            if v is None:
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    def _from_stats(column: str, stat: str) -> float | None:
        """One statistic for one axis, by name, out of the pair's stats frame."""
        if stats is None or column not in getattr(stats, "columns", ()):
            return None
        for basis in ("theoretical", "empirical"):
            try:
                value = float(stats.loc[(basis, stat), column])
            except (KeyError, IndexError, TypeError, ValueError):
                continue
            if math.isfinite(value):
                return value
        return None

    out: list[dict] = []
    for i, name in enumerate(names):
        try:
            n = len(axis_xs[i])
            bs = float(bss[i])
        except (IndexError, TypeError, ValueError):
            continue
        unit = units[i] if units is not None and i < len(units) else None
        mean = _moment(unit, "actual_m", "est_m") if unit is not None else None
        cv = _moment(unit, "actual_cv", "est_cv") if unit is not None else None
        out.append({
            "name": str(name),
            "bs": bs,
            "log2": int(round(math.log2(n))) if n > 0 else None,
            "mean": mean if mean is not None else _from_stats(str(name), "mean"),
            "cv": cv if cv is not None else _from_stats(str(name), "cv"),
        })
    return out


# Raw-moment statistic labels (E[X], E[X^2], E[X^3]). The displayed stats /
# reins-stats tables drop these rows -- nobody reads E[X^2]; the human-readable
# mean / cv / skew (and the ``meta`` block) carry the story. The full-frame CSV
# download keeps them (the "give me everything" export).
_RAW_MOMENTS = frozenset({"ex1", "ex2", "ex3"})


def _drop_raw_moments(df):
    """Drop the ``ex1`` / ``ex2`` / ``ex3`` rows; keep mean / cv / skew (+ meta).

    Parameters
    ----------
    df : pandas.DataFrame or None
        ``stats_df`` / ``reins_stats_df``, whose rows carry a 2-level
        ``(group, statistic)`` MultiIndex (the ``meta`` group has its own
        labels and no ``ex*``, so it's untouched). None passes through, because
        this composes inside ``_CSV_FRAMES`` resolvers and "the object has no
        such frame" is an ordinary answer there, reported as a 400 further up.

    Returns
    -------
    pandas.DataFrame or None
        The frame with the raw-moment rows removed. Filters on the
        *innermost* index level, so it works for a flat index too.
    """
    if df is None:
        return None
    stat = df.index.get_level_values(-1)
    return df[~stat.isin(_RAW_MOMENTS)]


def _resolve_frame(obj: Any, name: str):
    """Return the named frame, calling it when it is a method.

    The risk frames are properties as of ``aggregate`` 1.0.0a149, which turned
    ``tail_df`` from a method into one. Both shapes are still resolved, so a
    frame that goes back to being callable (or a class that never converted)
    keeps working: a missing or ``None`` attribute yields ``None`` (the route
    answers 400), a callable is invoked with its defaults, anything else is
    returned as-is.

    Parameters
    ----------
    obj : Any
        The built object (Aggregate / Portfolio / BivariateAggregate / ...).
    name : str
        Attribute name to resolve to a DataFrame.

    Returns
    -------
    pandas.DataFrame or None
    """
    attr = getattr(obj, name, None)
    if attr is None:
        return None
    return attr() if callable(attr) else attr


def _bs_window_frame(obj: Any):
    """The grid-sizing frame, as the library publishes it.

    One resolution shared by the JSON route and the CSV download so the two
    cannot answer differently.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    pandas.DataFrame or None

    Notes
    -----
    **The published frame, not the private one.** This read
    ``obj._bs_window_df`` first through a70 and fell back to the public
    attribute, because the private probe frame is two columns wider (``W``, the
    window width, and ``coverage``) and those two are the diagnostic the pane
    exists for. Preferring it meant this service had decided that the library's
    published view of its own grid search was the wrong one, which is not a
    decision it gets to make: the app draws the ``bs_window`` exhibit now, and
    if two columns are missing from it they are missing upstream. Asked for in
    ``aggregate_REFACTOR/dev/note-from-aggregate-api-round-6.md``.
    """
    return _resolve_frame(obj, "bs_window_df")


def _sharpen_score_frame(obj: Any):
    """The sharpen probe's score grid: ``d_bs`` down, ``d_log2`` across.

    The library's own documented picture of the audit
    (``_bucket_window.py:1835``), and the one worth leading with. ``sharpen_df``
    has one row per probed cell and twenty columns; this is the single number
    that decides between them, laid out as the grid the probe actually walked,
    so the shape of the search and where the winner sits are both visible at a
    glance. Lower is better. A ragged walk leaves NaN in the corners it never
    reached, which is information rather than a gap: it says the probe ran out
    of budget in that direction.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    pandas.DataFrame or None
        ``None`` before ``sharpen()`` has run, and on any object whose frame
        does not carry the two index levels (nothing does today, but this route
        must not 500 if that changes).
    """
    df = _resolve_frame(obj, "sharpen_df")
    if df is None or df.empty or "score" not in df.columns:
        return None
    if "d_log2" not in (df.index.names or []):
        return None
    try:
        return df["score"].unstack("d_log2")
    except Exception:  # noqa: BLE001 -- a frame that will not pivot has no grid
        return None


#: The three moments the reins stats tables report, in reading order.
_REINS_MOMENTS = ["mean", "cv", "skew"]

# `_reins_stats_transposed` and `_REINS_COMPONENTS` came out at a71, with the
# `reins_stats_terms` and `reins_stats_moments` routes they fed. They turned
# the library's layering analysis on its side and split it in two, which was
# this service deciding how a table it does not own should be read. The
# library serves that analysis as the `reins` exhibit's first block and the
# app draws what it is given; if the orientation is wrong it is wrong there.


def collapse_program(decl: str) -> str:
    """One line of DecL from however the text arrived.

    Collapse newlines, tabs and ``\\`` line-continuations to single spaces so a
    program formatted across several indented lines builds without the ugly
    continuation character. DecL treats a bare newline as a *program separator*,
    but the same program on one line parses fine. Runs of whitespace are
    replaced rather than deleted so tokens do not merge (``100\\nclaims`` to
    ``100 claims``), and any ``\\`` goes first so existing continuation programs
    fold in too.

    Done up front on the build path so the hints scan, the cache key, the build
    and any parse-error caret all see the same source. This is a single-object
    playground (one program per build), so merging newline-separated programs is
    not a regression, and ``#`` comments are not accepted in the input box, so
    nothing gets swallowed.

    Shared rather than inlined because the derivation routes have to reach the
    **same cache key** an ordinary build of the same text would. The library
    renders derived programs in its multi-line spread layout, so without this
    the id would be computed over different bytes and rebuilding a derived
    program from the editor would miss its own cache slot.

    Parameters
    ----------
    decl : str

    Returns
    -------
    str
    """
    return re.sub(r"\s+", " ", decl.replace("\\", " ")).strip()


# ----------------------------------------------------------------------
# POST /v1/objects
# ----------------------------------------------------------------------

@router.post("/objects", response_model=models.BuildResponse)
def post_object(
    req: models.BuildRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
) -> dict:
    """Build (or retrieve from cache) an aggregate object.

    Returns the slim manifest; the SPA fetches heavier panes on
    demand via the per-button GETs. Same (decl, log2, bs) is
    idempotent -- the second call returns ``cached=True`` with
    the same ``id``.
    """
    # Resolve effective knobs: a missing log2 / bs from the request
    # means "use library defaults" -- which the underlying build()
    # signals via 0. We hash the *requested* values (0 included)
    # so two callers asking for "defaults" share the same cache slot.
    eff_log2 = req.log2 if req.log2 is not None else 0
    eff_bs = req.bs if req.bs is not None else 0.0
    ip = _client_ip(request)
    t0 = time.monotonic()

    req.decl = collapse_program(req.decl)

    # Cap check is cheap; do it before the cache lookup so an
    # over-cap request never reaches the build path. Enforce against the
    # *effective* log2: the larger of the request log2 and any log2 set
    # via a DecL hints{} clause (which build() would otherwise honor,
    # bypassing a request-only cap). Other hints (bs, etc.) pass through
    # untouched -- this guard only vetoes an over-cap log2.
    hint_log2 = max((int(m) for m in _HINTS_LOG2.findall(req.decl)), default=0)
    effective_log2 = max(eff_log2, hint_log2)
    if effective_log2 > settings.log2_cap:
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="limit_exceeded",
            error_msg=f"log2 {effective_log2} exceeds cap {settings.log2_cap}",
            elapsed_ms=elapsed,
        )
        raise HTTPException(
            status_code=422,
            detail=f"log2 {effective_log2} exceeds AGGAPI_LOG2_CAP={settings.log2_cap}",
        )

    canonical = canonicalize_decl(req.decl)
    oid = object_id(canonical, eff_log2, eff_bs)

    # Cache hit -- return slim manifest immediately.
    cached_entry = cache.get(oid)
    if cached_entry is not None:
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="ok", object_id=oid, kind=cached_entry.kind,
            elapsed_ms=elapsed,
        )
        return {
            "id": oid,
            "kind": cached_entry.kind,
            "name": cached_entry.name,
            # The build's warnings, not this request's: they belong to the
            # object and were stored with it, so a hit says what the miss said.
            "warnings": list(cached_entry.notes),
            "cached": True,
            "elapsed_ms": elapsed,
            **_summary_fields(cached_entry.obj),
            # Computed on the hit path too, never cached alongside the entry:
            # ``can_sharpen`` reads the object's own note, which a Sharpen can
            # move under a live id, so a stored copy could go stale.
            "capability": capability_for(cached_entry.obj),
        }

    # Cache miss -- fire the build, gated by the semaphore +
    # wall-clock timeout. Note: the semaphore only serializes the
    # *future submission*, not the wait. With one worker the
    # semaphore is technically redundant (the worker serializes
    # naturally), but it makes intent explicit.
    with _build_semaphore:
        future = _build_executor.submit(_run_build, req.decl, eff_log2, eff_bs)
        try:
            obj, build_notes = future.result(timeout=settings.build_timeout_s)
        except FuturesTimeout:
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="timeout",
                error_msg=f"build exceeded {settings.build_timeout_s}s",
                elapsed_ms=elapsed,
            )
            raise HTTPException(status_code=504, detail="build timeout")
        except ValueError as exc:
            # A DecL parse failure surfaces as a ValueError. Newer
            # ``aggregate`` attaches the structured ErrorReport as
            # ``exc.report`` and raises with ``from None`` (so
            # ``__cause__`` is empty); older builds left the Lark
            # UnexpectedInput on ``__cause__``. Treat either as a parse
            # error and recover the rich report via format_error (which
            # honors both conventions). Anything else is a build-time
            # validation error and we fall through.
            is_parse_error = isinstance(getattr(exc, "report", None), ErrorReport) or \
                isinstance(exc.__cause__, UnexpectedInput)
            if is_parse_error:
                report = format_error(req.decl, exc)
                elapsed = int((time.monotonic() - t0) * 1000)
                audit.record_build(
                    ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                    status="parse_error", error_msg=report.message,
                    elapsed_ms=elapsed,
                )
                raise HTTPException(status_code=422, detail=report.to_dict())
            # Library-side validation error (e.g. invalid spec).
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=str(exc),
                elapsed_ms=elapsed,
            )
            raise HTTPException(status_code=422, detail=str(exc))
        except UnexpectedInput as exc:
            # Defensive: if the parser ever surfaces a raw Lark
            # exception without the ValueError wrap, handle it the
            # same way.
            report = format_error(req.decl, exc)
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="parse_error", error_msg=report.message,
                elapsed_ms=elapsed,
            )
            raise HTTPException(status_code=422, detail=report.to_dict())
        except VisitError as exc:
            # Lark wraps any exception raised *inside* the transformer in a
            # ``VisitError``; the real cause (e.g. a ``ValueError("Unknown
            # distortion kind 'pd'; available: …")`` from an unknown distortion
            # kind) hangs off ``.orig_exc``. These are user-input errors with an
            # informative message, so surface them in the 422 family rather than
            # letting them fall through to the catch-all 500.
            orig = getattr(exc, "orig_exc", None) or exc
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=str(orig),
                elapsed_ms=elapsed,
            )
            raise HTTPException(status_code=422, detail=str(orig))
        except (NotImplementedError, KeyError) as exc:
            # Two more shapes of "your program cannot be built", both of which
            # the library already reports well and neither of which is a server
            # fault, so neither belongs in the 500 family:
            #
            # * ``NotImplementedError`` for an unsupported combination, e.g.
            #   ``xpnl`` over a portfolio ("the portfolio total hides its
            #   units, so there is nothing to explode. Use 'pnl' ...").
            # * ``KeyError`` for a ``sev.X`` / ``agg.X`` / ``port.X`` reference
            #   that resolves to nothing ("no recipe named 'X' of kind 'port'").
            #
            # ``str()`` on a KeyError re-quotes its argument, which would show
            # the user a message wrapped in stray quotes, so read args[0].
            detail = (exc.args[0] if isinstance(exc, KeyError) and exc.args
                      else str(exc))
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=str(detail),
                elapsed_ms=elapsed,
            )
            raise HTTPException(status_code=422, detail=str(detail))
        except Exception as exc:
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=str(exc),
                elapsed_ms=elapsed,
            )
            raise HTTPException(status_code=500, detail=str(exc))

    # Classify the result. The api serves exactly the six DecL-creatable kinds
    # the library declares as first-class (plus near-first-class ``sev``), and
    # nothing else. They do not all carry the same surface: an Aggregate and a
    # Portfolio have the lot, while a Distortion, a BivariateAggregate and a PnL
    # have the reporting frames but no pricing / reinsurance / bs window, and a
    # Severity is a look-through onto a frozen scipy variable with ``info`` and
    # ``plot`` but no frames at all. Every frame route answers a clean 400 for a
    # kind that does not carry it, so the SPA degrades rather than erroring.
    kind = _classify_object(obj)
    if kind not in SUPPORTED_KINDS:
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="build_error",
            error_msg=f"unsupported kind {kind!r}",
            elapsed_ms=elapsed,
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"api supports {', '.join(repr(k) for k in SUPPORTED_KINDS)} "
                f"only; got {kind!r}"
            ),
        )

    entry = CacheEntry(
        obj=obj,
        decl=req.decl,
        log2=eff_log2,
        bs=eff_bs,
        kind=kind,
        name=getattr(obj, "name", "<anonymous>"),
        created_at=datetime.now(timezone.utc),
        notes=build_notes,
    )
    cache.put(oid, entry)
    elapsed = int((time.monotonic() - t0) * 1000)
    audit.record_build(
        ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
        status="ok", object_id=oid, kind=kind, elapsed_ms=elapsed,
    )
    return {
        "id": oid,
        "kind": kind,
        "name": entry.name,
        "warnings": build_notes,
        "cached": False,
        "elapsed_ms": elapsed,
        **_summary_fields(obj),
        "capability": capability_for(obj),
    }


# Class name -> the parser's own kind token. The keys are exactly
# ``aggregate.constants.FIRST_CLASS_CLASSES`` plus ``NEAR_FIRST_CLASS``, and the
# values are the kinds ``Underwriter._factory`` dispatches on, so the api speaks
# the library's vocabulary rather than a parallel one of its own. Note
# ``bvagg``, not ``bivariate``: where the two disagree the library wins.
_KIND_OF_CLASS = {
    "Aggregate": "agg",
    "Portfolio": "port",
    "BivariateAggregate": "bvagg",
    "PnL": "pnl",
    "Distortion": "distortion",
    "Severity": "sev",
}

# The two taxonomies whose subclasses reach the api under the base name.
# ``build('dist X ph .7')`` returns a ``DistortionPH`` and
# ``build('sev X lognorm 50 cv 1.5')`` a ``SeverityScipy``; both flatten to the
# base kind so the endpoints treat every member uniformly. The specific subclass
# still shows up in ``info``.
_KIND_OF_BASE = ((Distortion, "distortion"), (Severity, "sev"))

# What POST /v1/objects will build, in the library's own vocabulary.
SUPPORTED_KINDS = ("agg", "port", "sev", "distortion", "bvagg", "pnl")

# Guard: the contract declares which classes flow through to this service, so a
# class added upstream without a kind here should be noticed, not silently
# lower-cased into a stray kind string.
_UNMAPPED_FCC = tuple(
    name for name in (*FIRST_CLASS_CLASSES, *NEAR_FIRST_CLASS)
    if name not in _KIND_OF_CLASS
)
if _UNMAPPED_FCC:  # pragma: no cover -- fires only on an upstream addition
    logger.warning(
        "first-class classes with no api kind mapping: %s", ", ".join(_UNMAPPED_FCC)
    )


def _classify_object(obj: Any) -> str:
    """Return the parser kind for a built object, or the lower-cased class name.

    Uses class discrimination because a built object carries no ``.kind`` of its
    own: the kind lives on the :class:`Recipe`, and ``build()`` unwraps to the
    object. A ``BivariateAggregate`` (``bivariate`` / ``bv`` / ``clash`` and the
    ``netceded`` / ``grossceded`` / ``grossnet`` view pairs) maps to ``'bvagg'``,
    and a ``PnL`` (built by both ``pnl`` and ``xpnl``) to ``'pnl'``.

    Parameters
    ----------
    obj : Any
        A built object.

    Returns
    -------
    str
        A parser kind token, or the lower-cased class name for anything the
        contract does not cover.
    """
    kind = _KIND_OF_CLASS.get(type(obj).__name__)
    if kind is not None:
        return kind
    for base, base_kind in _KIND_OF_BASE:
        if isinstance(obj, base):
            return base_kind
    return type(obj).__name__.lower()


# ----------------------------------------------------------------------
# GET /v1/objects -- cache listing
# ----------------------------------------------------------------------

@router.get("/objects", response_model=models.ObjectListResponse)
def list_objects(cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Return a snapshot of cache contents, MRU last."""
    # Recover the (id, entry) pairing by scanning the cache.
    # The cache holds the OrderedDict internally; we expose it via
    # .list() but lose the id. Walk the internal dict directly
    # *with* the lock through a small helper.
    items = []
    # Internal access: read the OrderedDict items under lock.
    with cache._lock:  # noqa: SLF001 -- intentional cross-module use
        for oid, entry in cache._store.items():
            items.append({
                "id": oid,
                "kind": entry.kind,
                "name": entry.name,
                "ts": entry.created_at.isoformat(timespec="milliseconds"),
            })
    return {"objects": items}


# ----------------------------------------------------------------------
# GET /v1/session/models.agg -- download the session's built programs
# ----------------------------------------------------------------------

# Dependency order for the canonical ('agg') export, mirroring the library's
# write order: a sev precedes the agg that uses it, an agg precedes the port,
# bvagg and pnl that reference it, so the emitted file re-loads cleanly. A
# distortion depends on nothing and sorts last. An unlisted kind falls to 99.
_KIND_ORDER = {
    "sev": 0, "agg": 1, "port": 2, "bvagg": 3, "pnl": 4, "distortion": 5,
}


@router.get("/session/models.agg")
def get_session_models(
    form: Literal["raw", "agg"] = Query(
        "raw",
        description=(
            "'raw' = programs exactly as submitted, verbatim (from the object "
            "cache; compact syntax like ranges preserved); 'agg' = canonical, "
            "line-wrapped, dependency-ordered DecL from the underwriter's session "
            "knowledge (re-loadable)."
        ),
    ),
    cache: ObjectCache = Depends(_get_cache),
) -> Response:
    """Download every DecL program built this session as one ``.agg`` file.

    Two forms, kept deliberately distinct. ``raw`` walks the api object cache and
    emits each built object's program **verbatim** -- your exact source, compact
    syntax and all (a range ``[10:100:10]`` stays ``[10:100:10]``). ``agg`` reads
    the shared ``build`` underwriter's knowledge base, keeps the entries it
    flagged ``source='session'`` (every in-session ``build(...)``), renders each
    through ``decl_writer.spec_to_decl`` (verbatim fallback) and then
    ``format_program`` for the spread / line-wrapped layout, in dependency order
    -- a **canonical, re-flowed, re-loadable** set (ranges expanded to
    ``[10 20 ... 100]``). Formatting ``raw`` too would collapse it into ``agg``,
    so it is intentionally left un-reflowed.

    Notes
    -----
    Scope is **process-global**: both the object cache and the ``build`` singleton
    are shared across the server process, so on a shared deployment this returns
    every program built since the last restart, not just one browser's. Fine for a
    personal / local instance; per-session scoping is future work.
    """
    programs: list[str] = []
    if form == "raw":
        # Programs exactly as typed -- unique decls in cache (MRU) order. This is
        # deliberately NOT run through ``format_program``: that re-parses and so
        # expands compact syntax (a range ``[10:100:10]`` becomes
        # ``[10 20 ... 100]``). Preserving the user's exact source -- ranges and
        # all -- is the whole point of the ``raw`` form; the ``agg`` form is the
        # canonical, re-flowed one.
        seen: set[str] = set()
        with cache._lock:  # noqa: SLF001 -- intentional cross-module use
            for entry in cache._store.values():
                decl = entry.decl.strip()
                if decl and decl not in seen:
                    seen.add(decl)
                    programs.append(decl)
    else:  # form == "agg"
        from aggregate.decl_writer import format_program, spec_to_decl

        # ``recipes`` replaced ``knowledge`` at aggregate 1.0.0a164: one frame,
        # one class, indexed (kind, name), with ``source`` marking where an
        # entry came from. A program built through this api is a session entry.
        recipes = _build_singleton.recipes
        session = recipes[recipes["source"] == "session"]
        # (kind, name) MultiIndex; order by kind dependency then name.
        rows = sorted(
            session.itertuples(),
            key=lambda r: (_KIND_ORDER.get(r.Index[0], 99), r.Index[1]),
        )
        for r in rows:
            kind, name = r.Index
            # Canonical text from the parsed spec (ranges expanded, deduped) ...
            try:
                text = spec_to_decl(r.spec, kind, name)
            except Exception:  # noqa: BLE001
                # Best-effort: any spec the unparser can't render (minimum /
                # mixture distortions, or a kind it doesn't cover) falls back to
                # the verbatim program. Never 500 over one un-round-trippable entry.
                text = r.program if isinstance(r.program, str) else ""
            if not text.strip():
                continue
            # ... then the spread text layout (line wraps) for readability.
            #
            # `trailer=True`, because `format_program` defaults it to False and
            # would drop the `note{}`, `tags{}` and `hints{}` that `spec_to_decl`
            # emitted ten lines up. This file is the re-loadable export: a
            # program whose `hints{}` was stripped on the way out rebuilds on a
            # different grid from the one it was written for, silently. Fixed at
            # a51; every `.agg` downloaded before that is missing its trailers.
            try:
                text = format_program(text, fmt="text", trailer=True)
            except Exception:  # noqa: BLE001 -- keep the unwrapped canonical text
                pass
            programs.append(text.strip())

    header = f"# aggregate_api session models ({form}), {len(programs)} program(s)"
    body = header + "\n\n" + "\n\n".join(programs) + "\n"
    return Response(
        content=body,
        media_type="text/plain",
        headers={
            "Content-Disposition": 'attachment; filename="session-models.agg"',
        },
    )


# ----------------------------------------------------------------------
# GET /v1/objects/{id} -- manifest
# ----------------------------------------------------------------------

@router.get("/objects/{oid}", response_model=models.ObjectManifest)
def get_manifest(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    entry = _resolve_object(oid, cache)
    return {
        "id": oid,
        "kind": entry.kind,
        "name": entry.name,
        "decl": entry.decl,
        "log2": entry.log2,
        "bs": entry.bs,
        "created_at": entry.created_at.isoformat(timespec="milliseconds"),
    }


# ----------------------------------------------------------------------
# DELETE /v1/objects/{id}
# ----------------------------------------------------------------------

@router.delete("/objects/{oid}", response_model=models.DeleteResponse)
def delete_object(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    if not cache.delete(oid):
        raise HTTPException(status_code=404, detail=f"object {oid} not in cache")
    return {"ok": True}


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/info
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/info", response_model=models.InfoResponse)
def get_info(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    return info_to_payload(entry.obj)


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/meta
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/meta", response_model=models.ObjectMetaResponse)
def get_meta(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """The object's own DecL metadata: trailer clauses plus both programs.

    Every first-class citizen carries ``note`` / ``tags`` / ``hints`` and the
    ``program`` / ``pprogram`` pair, so this is one route for all six kinds.
    ``doc{{{...}}}`` is deliberately never served: it is the cookbook's
    long-form recipe, not playground content.

    Notes
    -----
    Read through ``getattr`` rather than direct attribute access. The library
    declares its own contract holes in
    ``aggregate.constants.FCC_CONTRACT_EXCEPTIONS`` (empty as of 1.0.0a172, but
    the mechanism exists precisely because they recur), and an empty clause
    comes back as ``''``, which serializes as ``null`` here so the SPA can test
    presence without trimming.
    """
    obj = entry.obj

    def text(name: str) -> str | None:
        value = getattr(obj, name, None)
        if value is None:
            return None
        value = str(value).strip()
        return value or None

    tags = getattr(obj, "tags", ()) or ()
    return {
        "kind": entry.kind,
        "name": entry.name,
        "note": text("note"),
        "tags": [str(t) for t in tags],
        "hints": text("hints"),
        "program": text("program"),
        "pprogram": text("pprogram"),
    }


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/summary
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/summary", response_model=models.FrameResponse)
def get_summary(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """At-a-glance risk view -- moments + key percentiles (``summary_df``).

    Since ``aggregate`` 1.0.0a113 ``summary_df`` is the user-facing risk
    frame (Freq / Sev / Agg rows; ``E[X] | SD | CV | Skew | p0.01 | p0.50 |
    p0.99``), not the old moment-validation table -- that moved to
    :func:`get_validation_df` (``validation_df``). ``CV`` and the Freq-row
    percentiles are blank (NaN -> JSON ``null``) by design.
    """
    df = _resolve_frame(entry.obj, "summary_df")
    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"summary not available for {entry.kind!r}",
        )
    # ``summary_df`` is a property returning a DataFrame; we want its
    # named index in the payload too, so promote it to a column when
    # possible (reset_index_safe handles index/column collisions).
    df = reset_index_safe(df)
    return frame_to_payload(df)


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/tail_df
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/tail_df", response_model=models.FrameResponse)
def get_tail_df(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Return-period / exceedance table (``tail_df``).

    The centerpiece risk view: columns ``p | VaR | TVaR | xsVaR | VaR/Mean``,
    indexed by return period ``T`` on an ``Aggregate`` and by ``(unit, T)`` on a
    ``Portfolio``, whose ladder includes the 1-in-200 / 1-in-250 capital
    anchors. ``None`` before a grid exists (no realised density) -> 400.

    Notes
    -----
    A ``BivariateAggregate`` has no ``tail_df`` and answers 400. It once carried
    the name for a different report entirely (where the realized mass sits on
    each axis), which ``aggregate`` 1.0.0a171 renamed ``axis_support_df`` because
    two reports under one name is how a reader gets the wrong one.
    """
    df = _resolve_frame(entry.obj, "tail_df")
    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"tail_df not available for {entry.kind!r}",
        )
    return frame_to_payload(reset_index_safe(df))


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/validation_df
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/validation_df", response_model=models.FrameResponse)
def get_validation_df(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Moment-vs-estimate QA table (``validation_df``).

    The old ``summary_df`` payload, renamed upstream: theoretical vs
    empirical moments with the per-moment error, reading "not unreasonable"
    on a clean build. Demoted under the SPA's **More** menu now that
    ``summary_df`` is the headline risk view.
    """
    df = _resolve_frame(entry.obj, "validation_df")
    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"validation_df not available for {entry.kind!r}",
        )
    return frame_to_payload(reset_index_safe(df))


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/stats_df
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/stats_df", response_model=models.FrameResponse)
def get_stats_df(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    df = getattr(entry.obj, "stats_df", None)
    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"stats_df not available for {entry.kind!r}",
        )
    return frame_to_payload(reset_index_safe(_drop_raw_moments(df)))


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/density_df
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/density_df", response_model=models.FrameResponse)
def get_density_df(
    oid: str,
    cols: str | None = Query(
        None,
        description="Comma-separated subset of column names.",
    ),
    start: int | None = Query(None, ge=0),
    stop: int | None = Query(None, ge=0),
    downsample: int | None = Query(None, ge=1, le=10_000),
    nonzero: bool = Query(
        False,
        description="Drop zero-mass rows (keep only p_total > 0) before slicing.",
    ),
    resolution: Literal["full", "display"] = Query(
        "full",
        description=(
            "'full' = every grid point, unbinned (what a plot wants); "
            "'display' = binned to a power-of-two grid (what a table wants)."
        ),
    ),
    view: Literal["marginal", "joint"] = Query(
        "marginal",
        description=(
            "BivariateAggregate only. 'marginal' = the two component marginals; "
            "'joint' = the full joint-density matrix."
        ),
    ),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """The density frame. Full resolution by default.

    ``resolution='full'`` ships every grid point, which is what a plot wants, and
    is the default. A discretized aggregate is routinely **atomic**: layer limits
    and occurrence cessions put point masses in the severity and the aggregate
    inherits them at every multiple, so single ``bs``-wide buckets carry whole
    percentage points of probability against a continuum three orders of
    magnitude below. *Any* binning merges an atom with its neighbours and turns a
    spine into a triangle, and no threshold avoids it, because from the frame
    alone an atom is not distinguishable from a tall continuum bucket. So the
    honest answer is to ship the grid and let the client draw it.

    ``resolution='display'`` bins to a power-of-two grid (see
    ``display_log2_for``): masses (``p_total`` / ``p_sev`` / ``p_*``) are summed
    and the pointwise columns (``loss`` / ``F`` / ``S`` / ``ex***``) take the
    super-bucket right edge, so ``p_total`` stays faithful (sums to ~1) rather
    than being understated by an even-spaced stride. That is the right shape for
    a **table**, where 2**16 rows is not a reading experience.

    A ``PnL`` has no DataFrame ``density_df`` (it is a dict of per-leg grids);
    its grand-result density is synthesized (:func:`pnl_density_frame`) into the
    same ``loss / p_total / F / S`` shape.

    A ``BivariateAggregate`` answers with its two component **marginals** by
    default (:func:`bivariate_marginal_frame`). Its joint density is a matrix of
    2**16 cells or more, which is a picture rather than a table; ask for it with
    ``view='joint'``, which the Overview heatmap does.

    Objects without a build grid (a distortion's g-curve) honor the legacy
    ``cols`` / ``start`` / ``stop`` / ``downsample`` / ``nonzero`` params.
    """
    col_list = [c.strip() for c in cols.split(",")] if cols else None
    binned = resolution == "display"

    if entry.kind == "bvagg" and view == "marginal":
        df = bivariate_marginal_frame(entry.obj)
        if col_list:
            df = df[[c for c in col_list if c in df.columns]]
        return frame_to_payload(df)

    if entry.kind == "sev":
        # A Severity has no density_df at all; sample the frozen variable onto a
        # quantile-spaced grid. Not binned: the grid is already the display grid
        # and its `pdf` is an ordinate, not a mass, so summing it would be wrong.
        df = severity_density_frame(entry.obj)
        if col_list:
            df = df[[c for c in col_list if c in df.columns]]
        return frame_to_payload(df)

    if entry.kind == "pnl":
        # A PnL's density_df is a dict of per-leg GridDistributions, not a
        # DataFrame. Synthesize the grand-result density in the standard
        # loss / p_total / F / S shape. When binning is asked for, the
        # positional reduction tolerates the signed P&L outcome axis;
        # ``(n - 1).bit_length()`` is ceil(log2(n)), so a grid already at or
        # under the display size skips it.
        df = pnl_density_frame(entry.obj)
        if col_list:
            df = df[[c for c in col_list if c in df.columns]]
        if not binned:
            return frame_to_payload(df)
        sum_cols = {c for c in df.columns if c.startswith("p")}
        display_log2 = display_log2_for(len(df.columns))
        source_log2 = max(display_log2, (len(df) - 1).bit_length())
        return frame_to_payload(
            bin_density(df, source_log2, sum_cols=sum_cols, display_log2=display_log2)
        )

    df = getattr(entry.obj, "density_df", None)
    if df is None:
        raise HTTPException(
            status_code=400,
            detail=f"density_df not available for {entry.kind!r}",
        )
    # density_df is indexed by loss; surface that as a column for
    # the SPA so it can render the x-axis without a separate query.
    # ``loss`` is already a column on the frame so reset_index_safe
    # avoids the collision.
    df = reset_index_safe(df)

    if col_list:
        df = df[[c for c in col_list if c in df.columns]]

    source_log2 = getattr(entry.obj, "log2", None)
    if source_log2 is not None and binned:
        # Bin the full grid down: p_* columns sum, loss/F/S right-edge.
        sum_cols = {c for c in df.columns if c.startswith("p")}
        return frame_to_payload(
            bin_density(
                df, source_log2, sum_cols=sum_cols,
                display_log2=display_log2_for(len(df.columns)),
            )
        )
    if source_log2 is not None:
        return frame_to_payload(df)

    # No build grid: leave the frame as-is and honor the legacy slice params.
    if nonzero and "p_total" in df.columns:
        df = df[df["p_total"] > 0]
    return frame_to_payload(
        df, cols=col_list, start=start, stop=stop, downsample=downsample,
    )


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/unit_density_df  -- Portfolio only
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/unit_density_df", response_model=models.FrameResponse)
def get_unit_density_df(
    oid: str,
    resolution: Literal["full", "display"] = Query(
        "full",
        description="'full' = every grid point; 'display' = binned.",
    ),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Per-unit densities and survivals on the portfolio's common grid.

    Columns ``loss``, then ``p_<unit>`` and ``S_<unit>`` for each unit, plus the
    portfolio's own ``p_total`` and ``S``. This is what the Overview exhibit
    draws for a portfolio: one density series and one exceedance series per
    unit, alongside the total, which is the diversification story.

    Notes
    -----
    A ``Portfolio.density_df`` carries ``p_total`` and the per-unit *allocation*
    columns (``exa_*``, ``lev_*``, ...) but no per-unit densities. Since the
    windowed-grid work those live on ``unit_density_df()``, a long frame indexed
    ``(unit, loss)``, and unstacking it recovers the wide common-index form.
    Verified to align with the portfolio grid even when the units are on wildly
    different scales.

    Two pandas details worth knowing, both load bearing:

    * ``unit_density_df()`` carries ``unit`` as **both** an index level and a
      column, so a bare ``groupby('unit')`` raises ``ValueError: ambiguous``.
      Nothing here groups, but the same trap catches the next reader.
    * Binning treats a ``p``-prefixed column as a mass to **sum** and everything
      else as a pointwise value read at the super-bucket right edge. That is
      exactly right for the ``S_*`` survivals, so both families bin correctly in
      one pass.
    """
    if entry.kind != "port":
        raise HTTPException(
            status_code=400,
            detail=f"unit_density_df is Portfolio-only; got {entry.kind!r}",
        )
    obj = entry.obj
    long = obj.unit_density_df()
    out = {}
    for stat, prefix in (("p", "p_"), ("S", "S_")):
        if stat not in long.columns:
            continue
        wide = long[stat].unstack("unit")
        for unit in wide.columns:
            out[f"{prefix}{unit}"] = wide[unit]

    total = obj.density_df
    df = pd.DataFrame(out)
    df.insert(0, "loss", total["loss"].to_numpy() if "loss" in total else df.index)
    for name in ("p_total", "S"):
        if name in total.columns:
            df[name] = total[name].to_numpy()

    source_log2 = getattr(obj, "log2", None)
    if source_log2 is None or resolution == "full":
        return frame_to_payload(df.reset_index(drop=True))
    # The widest density payload the api serves: 2 * units + 3 columns. The cell
    # budget trades rows for those columns so a 12-unit portfolio ships the same
    # number of JSON numbers as a 2-unit one.
    sum_cols = {c for c in df.columns if c.startswith("p")}
    return frame_to_payload(
        bin_density(
            df, source_log2, sum_cols=sum_cols,
            display_log2=display_log2_for(len(df.columns)),
        )
    )


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/kappa  -- Portfolio only
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/kappa", response_model=models.FrameResponse)
def get_kappa(
    oid: str,
    downsample: int | None = Query(None, ge=1, le=10_000),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Per-unit conditional expected losses (the ``exeqa_*`` slice)."""
    if entry.kind != "port":
        raise HTTPException(status_code=400, detail="kappa is Portfolio-only")
    df = entry.obj.density_df
    # Build the kappa-slice: loss + every exeqa_* column.
    exeqa = [c for c in df.columns if c.startswith("exeqa_")]
    if not exeqa:
        raise HTTPException(status_code=400, detail="no exeqa_* columns on density_df")
    df = reset_index_safe(df)[["loss", *exeqa]]
    # Bin to the power-of-two display grid. ``exeqa_*`` are conditional
    # expectations (pointwise in x), not masses, so every column right-edges
    # (sum_cols empty). The full-frame CSV stays exact.
    source_log2 = getattr(entry.obj, "log2", None)
    if source_log2 is not None:
        df = bin_density(
            df, source_log2, sum_cols=set(),
            display_log2=display_log2_for(len(df.columns)),
        )
    return frame_to_payload(df, downsample=downsample)


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/bs_window_df  -- bucket/window estimator summary
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/bs_window_df", response_model=models.FrameResponse)
def get_bs_window_df(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Bucket/window estimator summary.

    A small per-method frame the library builds while choosing the grid
    (``bs`` / ``log2`` / ``x_min``); the ``selected`` row marks the method
    actually used.

    **The published frame.** Two attributes carry a version of this, and this
    route read the private ``_bs_window_df`` in preference from a45 to a70, on
    the grounds that it is two columns wider (``W``, the window width, and
    ``coverage``). Both readings were wrong. Reading *only* the private one
    404'd on a ``BivariateAggregate``, which carries the public frame alone,
    while the capability list reported the exhibit as available; preferring it
    was this service ruling that the library's published view of its own grid
    search is the wrong one. The app draws the ``bs_window`` exhibit now, the
    two columns are asked for upstream, and this route serves what the library
    publishes. A kind carrying neither (a P&L, a severity, a distortion) gets a
    clean 400.
    """
    df = _bs_window_frame(entry.obj)
    if df is None:
        raise HTTPException(
            status_code=400, detail="bs window summary not available for this object"
        )
    return frame_to_payload(reset_index_safe(df))


# ----------------------------------------------------------------------
# Reinsurance -- text description + per-layer frames
# ----------------------------------------------------------------------
# Fallback row budget for a density preview on an object *without* a build
# grid (no ``log2`` to bin against). Grid-backed objects (agg / port) bin to a
# faithful power-of-two display grid instead, see ``bin_density``. The csv download
# carries the full frame.
DENSITY_PREVIEW_ROWS = 20


def _frame_attr(obj: Any, name: str):
    """Return ``getattr(obj, name)`` as a DataFrame, or ``None``.

    Reinsurance frames are properties that return ``None`` when the
    object carries no reinsurance; we treat a missing attribute the same
    way so the route can answer with a uniform 400.
    """
    df = getattr(obj, name, None)
    if df is None:
        return None
    return df


@router.get(
    "/objects/{oid}/reins_description",
    response_model=models.ReinsDescriptionResponse,
)
def get_reins_description(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Always-visible text block describing the reinsurance program.

    ``Aggregate.reins_description`` is a short string attribute (e.g.
    ``"Ceded to 100% share of 15 xs 5 per occurrence"``), empty when the
    object carries no reinsurance. ``Portfolio`` has no such attribute --
    there we report availability from ``reins_summary_df`` and leave the text
    empty (the Reins table carries the detail).
    """
    obj = entry.obj
    # ``reins_summary_df`` is None exactly when the object has no reinsurance, so
    # it's the canonical availability signal. ``reins_description`` is a plain
    # string property carrying the human-readable blurb (empty otherwise).
    has_reins = _frame_attr(obj, "reins_summary_df") is not None
    text = str(getattr(obj, "reins_description", "") or "").strip() if has_reins else ""
    return {"available": has_reins, "text": text}


@router.get("/objects/{oid}/reins_summary_df", response_model=models.FrameResponse)
def get_reins_summary_df(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Per-layer gross/ceded/net reference-vs-model frame."""
    df = _frame_attr(entry.obj, "reins_summary_df")
    if df is None:
        raise HTTPException(status_code=400, detail="no reinsurance on this object")
    return frame_to_payload(reset_index_safe(df))


@router.get("/objects/{oid}/reins_stats_df", response_model=models.FrameResponse)
def get_reins_stats_df(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Per-layer summary statistics (small frame -> shown in full)."""
    df = _frame_attr(entry.obj, "reins_stats_df")
    if df is None:
        raise HTTPException(status_code=400, detail="no reinsurance on this object")
    return frame_to_payload(reset_index_safe(_drop_raw_moments(df)))


@router.get("/objects/{oid}/reins_density_df", response_model=models.FrameResponse)
def get_reins_density_df(
    oid: str,
    resolution: Literal["full", "display"] = Query(
        "full",
        description="'full' = every grid point; 'display' = binned.",
    ),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Reinsurance densities, full resolution by default.

    Same reasoning as :func:`get_density_df`: the Reins exhibit is a plot, and a
    ceded distribution is more atomic than a gross one, not less (a layer output
    piles every loss above its limit onto one point). ``resolution='display'``
    bins for the table: every ``p_*`` column sums and ``loss`` right-edges, so
    the previewed masses stay faithful.
    """
    df = _frame_attr(entry.obj, "reins_density_df")
    if df is None:
        raise HTTPException(status_code=400, detail="no reinsurance on this object")
    df = reset_index_safe(df)
    source_log2 = getattr(entry.obj, "log2", None)
    if source_log2 is not None and resolution == "display":
        sum_cols = {c for c in df.columns if c.startswith("p")}
        return frame_to_payload(
            bin_density(
                df, source_log2, sum_cols=sum_cols,
                display_log2=display_log2_for(len(df.columns)),
            )
        )
    if source_log2 is not None:
        return frame_to_payload(df)
    # No build grid to reason about: fall back to a small even-spaced preview.
    return frame_to_payload(df, downsample=DENSITY_PREVIEW_ROWS)


# ----------------------------------------------------------------------
# The named frames, and the one place that resolves them
# ----------------------------------------------------------------------
# Maps a frame name to a callable that yields its DataFrame **with the index
# intact**. Every by-name consumer goes through here: the CSV download and the
# table-document route.
#
# Callables rather than attribute names, and that is the point. Some frames are
# not simply an attribute: ``stats_df`` and ``reins_stats_df`` drop their raw
# ``ex1`` / ``ex2`` / ``ex3`` moment rows before anyone sees them, and when that
# step lived only in the JSON route the other two paths quietly disagreed with
# it. A portfolio's More > Stats showed 26 rows statically and 17 interactively,
# from the same button, because two paths resolved "the frame called stats_df"
# independently. One resolver makes that class of drift impossible rather than
# fixing this instance of it.
#
# The JSON routes above still apply their own steps; they are the same steps.
_CSV_FRAMES = {
    "summary": lambda o: _resolve_frame(o, "summary_df"),
    # ``tail_df`` is a method on agg / port; ``_resolve_frame`` calls it.
    "tail_df": lambda o: _resolve_frame(o, "tail_df"),
    "validation_df": lambda o: _resolve_frame(o, "validation_df"),
    "stats_df": lambda o: _drop_raw_moments(_resolve_frame(o, "stats_df")),
    # The P&L accounting family (aggregate 1.0.0a204, [PnL-Economic-Frames]).
    # ``economic_df`` is the ledger sheet that used to answer to ``stats_df``
    # on a PnL; that name now delegates to the wrapped engine's moment store,
    # so without these two entries the ledger would be unreachable until the
    # economics tab lands. No raw-moment drop: neither is a moment store.
    "economic_df": lambda o: _resolve_frame(o, "economic_df"),
    "economic_ratios_df": lambda o: _resolve_frame(o, "economic_ratios_df"),
    "density_df": lambda o: _resolve_frame(o, "density_df"),
    "bs_window_df": lambda o: _bs_window_frame(o),
    # The grid audit, in two views: the score grid the probe walked, and the
    # full per-cell detail behind it. Both are ``None`` until ``sharpen()`` runs,
    # which is what the ``has_sharpen`` capability flag reports, so the leaf that
    # reads them is dark rather than empty before then.
    "sharpen_score": lambda o: _sharpen_score_frame(o),
    "sharpen_df": lambda o: _resolve_frame(o, "sharpen_df"),
    "reins_summary_df": lambda o: _resolve_frame(o, "reins_summary_df"),
    # The layering analysis, transposed so the layers run down the rows, and
    # split into the layer's own terms and what it does to the moments. The
    # untransposed frame stays reachable under its own name for the CSV
    # download, which is the "give me exactly what the library built" export.
    "reins_stats_df": lambda o: _drop_raw_moments(_resolve_frame(o, "reins_stats_df")),
    "reins_density_df": lambda o: _resolve_frame(o, "reins_density_df"),
}


def _named_frame(entry: CacheEntry, which: str):
    """Resolve a frame by name, or raise the right HTTP error.

    Parameters
    ----------
    entry : CacheEntry
        The cached object and its kind.
    which : str
        A key of ``_CSV_FRAMES``.

    Returns
    -------
    pandas.DataFrame
        The frame, index intact. Flattening belongs to the caller, and only on
        the wire formats that need it.
    """
    resolve = _CSV_FRAMES.get(which)
    if resolve is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown frame {which!r}; expected one of {sorted(_CSV_FRAMES)}",
        )
    if entry.kind == "pnl" and which == "density_df":
        # A PnL's density_df is a dict of GridDistributions, not a frame; export
        # the grand-result density instead (the full, unbinned shape the Density
        # tab previews). All the PnL's other frames are real DataFrames and flow
        # through the generic path.
        df = pnl_density_frame(entry.obj)
    else:
        df = resolve(entry.obj)
    if df is None:
        raise HTTPException(
            status_code=400, detail=f"{which} not available for {entry.kind!r}"
        )
    return df


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/frame/{which}.csv  -- full-frame download
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/frame/{which}.csv")
def get_frame_csv(
    oid: str, which: str, entry: CacheEntry = Depends(_locked_entry)
) -> Response:
    """Return the full named frame as a CSV download.

    Notes
    -----
    Exactly what the on-screen table shows, which has not always been true: the
    raw-moment rows were dropped for the screen and exported here. See
    ``_CSV_FRAMES``.
    """
    df = _named_frame(entry, which)
    csv_text = reset_index_safe(df).to_csv(index=False)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{entry.name}-{which}.csv"',
        },
    )


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/plot
# ----------------------------------------------------------------------

# ----------------------------------------------------------------------
# GET /v1/objects/{id}/frame/{which}?format=ir  -- the static-view document
# ----------------------------------------------------------------------
# Declared **after** the `.csv` route above and that ordering is load bearing:
# a path parameter matches a dot, so `{which}` here would happily swallow
# `summary.csv` and answer JSON to a download request. Starlette matches in
# declaration order, so `.csv` wins as long as it stays first. A test pins it.

@router.get("/objects/{oid}/frame/{which}")
def get_frame_document(
    oid: str,
    which: str,
    format: str = Query("ir", description="ir"),
    request: Request = None,
    entry: CacheEntry = Depends(_locked_entry),
) -> Response:
    """Return the named frame as a table document (the IR).

    The presentation counterpart to the ``.csv`` route above, resolving the same
    ``_CSV_FRAMES`` names through the same ``_resolve_frame``. It builds from the
    **DataFrame**, not from the wire format, because the two things worth having
    are exactly the two ``FrameResponse`` discards: a sparsified row index (a
    portfolio's ``tail_df`` otherwise reprints the unit name on all ten of its
    return-period rows) and spanned MultiIndex column headers.

    Notes
    -----
    The body is ``canonical_json`` bytes rather than a Pydantic model, because
    the document's own content hash is the ETag and re-serializing through
    Pydantic would break the byte-for-byte determinism that makes the hash mean
    anything.

    Large frames truncate rather than fail (``tables.MAX_ROWS``), and say so in
    the document's notes. The SPA still sends anything over a few hundred rows to
    the interactive grid, which is the honest instrument for them.

    **``precision`` came out at a68**, and nothing replaced it server side. It
    reprinted the document with the per-column formats dropped, which existed
    because the *exhibit* route served documents that had thrown their numbers
    away and a client had nothing local to reprint. Every served document now
    carries the exact value beside the formatted string, here through
    ``include_raw`` and on the exhibit route through the library's own
    ``INCLUDE_RAW`` (``aggregate`` 1.0.0a246), so full precision is a rendering
    choice the client makes without asking. Two implementations of one idea, one
    of which cost a round trip, is worse than one that costs nothing.
    """
    if format != "ir":
        raise HTTPException(
            status_code=422, detail=f"unknown format {format!r}; expected 'ir'"
        )
    df = _named_frame(entry, which)
    try:
        # `formats=which`, so a frame's own name is its format key. This route
        # passed none at all through a50, which left `summary`, `tail_df`,
        # `stats_df`, `validation_df`, `bs_window_df` and every reins frame to
        # dtype inference alone; that reads a column's magnitude and drops the
        # decimals on anything averaging over 20,000, so a book worth pricing
        # showed its money as whole units. A name with no `tables.FORMATS` entry
        # resolves to nothing and behaves exactly as before.
        body, doc_hash = frame_document(df, which, formats=which)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # The document stamps its own hash; quote it per RFC 7232. Cached objects are
    # immutable and the build is deterministic, so a repeat request on an
    # unchanged object always revalidates rather than re-transferring.
    etag = f'"{doc_hash}"'
    if request is not None and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=body,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/quantiles -- q(p) for the reinsurance quick-edit form
# ----------------------------------------------------------------------

def _snap(value: float, digits: int = 3) -> float:
    """Round to ``digits`` significant figures, for a number a person will type.

    The quick-edit form turns probabilities into a layer, and a layer is
    something an underwriter writes down: ``1000 xs 500``, not
    ``1,234,567.8901 xs 987,654.3210``. Quantiles land on the FFT grid and carry
    every digit of it, so without this the form produces arithmetic rather than
    a program.

    Three significant figures, which is the resolution a real layer is quoted
    at. Exact zero and non-finite values pass through: there is no leading digit
    to round to.
    """
    if not math.isfinite(value) or value == 0:
        return value
    exp = math.floor(math.log10(abs(value)))
    factor = 10 ** (digits - 1 - exp)
    return round(value * factor) / factor


@router.get("/objects/{oid}/quantiles", response_model=models.QuantilesResponse)
def get_quantiles(
    oid: str,
    p: str = Query(..., description="Comma-separated probabilities in (0, 1)."),
    snap: bool = Query(True, description="Round to 3 significant figures."),
    basis: str = Query(
        "aggregate",
        description="Which distribution to read: aggregate|occurrence."),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Quantiles at the given probabilities, on the annual or the per-claim law.

    Exists for Quick Re, which lets attach and detach be written as
    probabilities (``50%``) as well as as amounts. There was no way to ask for
    ``q(p)`` before it: ``tail_df`` carries VaR by return period, so ``q(0.99)``
    was reachable and ``q(0.5)`` was not.

    Returns both the exact quantile and the snapped one, rather than choosing
    for the caller: the form writes the snapped value into a program a person
    then reads, and the exact value is what anyone checking the arithmetic
    wants.

    Notes
    -----
    **The basis is not a convenience, it is the difference between a layer and a
    no-op.** An occurrence cession applies to a single claim and an aggregate
    cession to the year, so a percentage means a different number on each tier.
    Reading both off the annual distribution produced exactly the failure you
    would expect and this route was shipped with: on
    ``100 claims 1000 xs 0 sev lognorm 50 cv 2``, the annual median is 4,847
    while no single claim can exceed 1,000, so ``occurrence net of 1830 xs 4850``
    is a treaty that can never attach. It builds, it validates, and it cedes
    nothing.

    ``q_sev`` is the per-claim quantile function and is aggregate level, so it
    answers for a mixture too, where the individual ``sevs`` components cannot.
    A kind carrying neither function gets a clean 400 rather than a wrong number.
    """
    if basis not in ("aggregate", "occurrence"):
        raise HTTPException(
            status_code=422,
            detail=f"unknown basis {basis!r}; expected 'aggregate' or 'occurrence'")
    try:
        ps = [float(v) for v in p.split(",") if v.strip()]
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"p must be numbers: {exc}") from exc
    if not ps:
        raise HTTPException(status_code=422, detail="p is empty")
    if not all(0 < v < 1 for v in ps):
        raise HTTPException(
            status_code=422, detail="every p must lie strictly inside (0, 1)")
    name = "q_sev" if basis == "occurrence" else "q"
    q = getattr(entry.obj, name, None)
    if not callable(q):
        raise HTTPException(
            status_code=400,
            detail=f"a {entry.kind!r} carries no {basis} quantile function",
        )
    out = []
    for v in ps:
        try:
            exact = float(q(v))
        except Exception as exc:  # noqa: BLE001 -- reported, not raised
            raise HTTPException(
                status_code=400, detail=f"{name}({v}) failed: {exc}") from exc
        out.append({"p": v, "q": exact,
                    "snapped": _snap(exact) if snap else exact})
    return {"quantiles": out}


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/chart/{name} -- the chart-document route
# ----------------------------------------------------------------------

#: The wire encodings a caller may ask for: the closed vocabulary of
#: ``dev/plan-3d-plot.md`` section 2.3, which the surface block's ``dtype``
#: declares back. Spelled as a ``Literal`` so an unknown name is a 422 off the
#: schema, with the four valid names in the message, rather than a 500 out of
#: an emitter that was handed a word it does not know.
ChartEncoding = Literal["f32b64", "f64b64", "u16log12b64", "json"]


def _chart_options(
    window: float | None,
    detail: int | None,
    encoding: str | None,
    settings: Settings,
) -> dict:
    """The chart parameters the caller actually set, as emitter options.

    Parameters
    ----------
    window : float or None
        Quantile depth: keep ``q(10**-window)`` to ``q(1 - 10**-window)`` of
        each marginal, 0 meaning the whole grid.
    detail : int or None
        Target cells per axis after the display reduction.
    encoding : str or None
        One of :data:`ChartEncoding`.
    settings : Settings
        Live config, read for ``max_chart_detail``.

    Returns
    -------
    dict
        Keyword options for ``charts.build_chart_doc``, holding only what the
        caller named.

    Raises
    ------
    HTTPException
        422 for a ``window`` off the half-step lattice, or a ``detail`` above
        this deployment's ceiling.

    Notes
    -----
    Only what the caller set travels. An option this route supplies by itself
    would be this service having an opinion about a library default, and would
    also make every chart that takes no such option fail the moment the route
    grew a parameter for one that does.

    Both checks are 422 rather than a silent clamp, which is the plan's
    acceptance criterion and the right reading anyway: a request for detail the
    deployment will not serve was asking for something specific, and answering
    it with something else while returning 200 is the response lying about what
    it is. The ceiling is a setting, so it cannot be a ``le=`` on the query
    parameter; the schema carries ``ge=16`` and the description names the env
    var.

    ``window`` is on a half-step lattice because that is what the SPA's spinner
    walks, and because a continuum of depths would make the chart cache and the
    ETag answer for a parameter nobody can reproduce by hand.
    """
    options: dict = {}
    if window is not None:
        if round(window * 2) != window * 2:
            raise HTTPException(
                status_code=422,
                detail=f"window must be a multiple of 0.5; got {window}",
            )
        options["window"] = window
    if detail is not None:
        if detail > settings.max_chart_detail:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"detail {detail} is above this deployment's ceiling of "
                    f"{settings.max_chart_detail}; raise AGGAPI_MAX_CHART_DETAIL "
                    "to serve finer grids"
                ),
            )
        options["detail"] = detail
    if encoding is not None:
        options["encoding"] = encoding
    return options


@router.get("/objects/{oid}/chart/{name}")
def get_chart_document(
    oid: str,
    name: str,
    window: float | None = Query(
        None, ge=0, le=12,
        description=(
            "Quantile depth, in multiples of 0.5: keep q(10**-window) to "
            "q(1 - 10**-window) of each marginal. 0 keeps the whole grid. "
            "Omitted, the library chooses. Grid charts only."
        ),
    ),
    detail: int | None = Query(
        None, ge=16,
        description=(
            "Target cells per axis after the display reduction. A target, not "
            "a promise: the reduction blocks by powers of two, and the "
            "document reports what it reached. Capped by "
            "AGGAPI_MAX_CHART_DETAIL (default 1024). Grid charts only."
        ),
    ),
    encoding: ChartEncoding | None = Query(
        None,
        description=(
            "Wire encoding of the grid block: f32b64 (default upstream), "
            "f64b64, u16log12b64, or json. Grid charts only."
        ),
    ),
    request: Request = None,
    entry: CacheEntry = Depends(_locked_entry),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Return the named chart as a chart document (the chart IR).

    The chart sibling of the frame-document route above. The library emitter
    owns every semantic decision (which series, on which axes, at which
    scales, and the mass-preserving display reduction that used to live in
    ``surfaceGrid`` client side); this route only serializes and
    revalidates. Names resolve through ``aggregate.charts.available_charts``,
    so a new library emitter appears here with zero endpoint changes; an
    unknown or unavailable name is a 404 carrying the capability set.

    Notes
    -----
    The body is ``canonical_json`` bytes rather than a Pydantic model,
    because the document's own content hash is the ETag and re-serializing
    would break the byte determinism that makes the hash mean anything.

    Built through ``charts.build_chart_doc``, the library's one public entry
    point, rather than by reaching into the ``CHARTS`` registry and calling
    the emitter here. That is not a style preference: this route did the
    latter and broke when ``CHARTS`` values grew a third field (``primary``,
    for :func:`aggregate.charts.primary_chart`), because a two-name unpack
    of a three-field record raises. Depending on the accessor instead of the
    container is what makes the next field a non-event.

    Two things come free with the move. ``build_chart_doc`` stamps
    ``generator`` with the producing ``aggregate`` version, so a document on
    the wire now says what built it; and it enforces the emitter's own
    availability predicate, which is a second, narrower gate than the
    ``available_charts`` check below. That check stays, because it is what
    turns an unavailable name into a 404 that names what *is* available.

    The three query parameters (``dev/plan-3d-plot.md`` section 3) are the
    knob, and only the knob: which grid a caller gets is the library's
    decision, taken before the reduction, and this route neither crops nor
    re-reduces what it is handed. Cropping downstream cannot recover
    resolution that was already averaged away, which is the whole argument for
    plumbing the parameters upstream instead of doing the work here: on one
    test surface the same quantile window applied to the fine lattice leaves
    232 cells, and applied to the emitted display grid leaves 8, starting in
    the wrong place.

    They go in the URL rather than a header because they change the bytes, so
    they belong in the thing the ETag answers for, and a URL that names its own
    resolution is shareable and shows up in a log.

    A chart whose emitter takes none of them says so with a 422 naming what was
    sent. Silently dropping an option the caller asked for would return a grid
    that is not the one requested, under a 200 and an ETag that both claim it
    is.
    """
    available = agg_charts.available_charts(entry.obj)
    if name not in available:
        raise HTTPException(
            status_code=404,
            detail=f"no chart {name!r} for this object; available: {available}",
        )
    options = _chart_options(window, detail, encoding, settings)
    key = (oid, name, window, detail, encoding)
    hit = _chart_cached(key)
    if hit is not None:
        etag, body = hit
    else:
        try:
            doc = agg_charts.build_chart_doc(entry.obj, name, **options)
        except TypeError as exc:
            # An emitter that does not take one of these. The message is
            # CPython's "got an unexpected keyword argument", matched rather
            # than guessed at from a signature: reading the signature means
            # resolving the registry entry and the dispatch by hand, which is
            # the reach this route was rewritten to stop making.
            if not options or "unexpected keyword argument" not in str(exc):
                raise
            raise HTTPException(
                status_code=422,
                detail=(
                    f"chart {name!r} takes none of "
                    f"{', '.join(sorted(options))}: those apply to the grid "
                    "charts, whose display lattice is chosen at emission"
                ),
            ) from exc
        except ValueError as exc:
            # Availability is screened above, so with options in hand a
            # ValueError here is the emitter rejecting a parameter value.
            if not options:
                raise
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        body = agg_charts.canonical_json(doc)
        etag = f'"{doc.hash}"'
        _chart_store(key, etag, body)
    if request is not None and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=body,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


# ----------------------------------------------------------------------
# The derivations: a program that reproduces an object you arrived at
# ----------------------------------------------------------------------
# Three buttons, one idea. Sharpening a grid and wrapping an object in a P&L
# both produce a new object, and each returns the DecL that reproduces it, so
# nothing is derived behind the user's back. The grammar knowledge lives in the
# library (``aggregate/dev/done/plan-derived-programs.md``); these routes only
# call it and file the result.


def spread(program: str) -> str:
    """A derived program as the reader gets it: one clause per indented line.

    The text these routes hand back lands in the editor, which is the whole
    point of a derivation: you read what it did, and you can edit it. Through
    a50 all three collapsed it to one line first, and a portfolio wrapped in a
    P&L came back as several hundred characters of unbroken DecL that nobody
    could read or edit with any confidence.

    ``trailer=True`` is **not** optional here, and the default is ``False``.
    Without it ``format_program`` renders the bare declaration and silently
    drops the ``note{}``, ``tags{}`` and ``hints{}`` clauses, which for Sharpen
    is the entire result: the whole contract of a sharpened program is that the
    ``hints{}`` it writes rides along, so building the returned text reproduces
    the grid the probe chose. A Sharpen that returned its program without its
    hints would look right and rebuild on the old grid.

    Best effort. The library declines to render a spec it cannot round-trip
    (minimum and mixture distortions, mostly), and a program that will not
    re-render is still a program worth handing back, so the collapsed form is
    the fallback rather than a 500.

    Parameters
    ----------
    program : str
        Collapsed DecL, as ``collapse_program`` leaves it.

    Returns
    -------
    str
        The spread rendering, or ``program`` unchanged if it will not render.
    """
    if not program.strip():
        return program
    from aggregate.decl_writer import format_program

    try:
        text = format_program(program, layout="spread", trailer=True)
    except Exception:  # noqa: BLE001 -- an unrenderable program is not an error
        return program
    return text.strip() or program


def _manifest(oid: str, entry: CacheEntry) -> dict:
    """The build manifest for an object already in the cache."""
    return {
        "id": oid,
        "kind": entry.kind,
        "name": entry.name,
        "warnings": [],
        "cached": False,
        "elapsed_ms": 0,
        **_summary_fields(entry.obj),
        "capability": capability_for(entry.obj),
    }


@router.post("/objects/{oid}/sharpen", response_model=models.DerivedResponse)
def post_sharpen(
    oid: str,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Audit the grid, move to a better one, and say so in DecL.

    ``update`` chooses a grid from the analytic moments before any FFT runs;
    this audits that choice afterwards and takes the best cell that does not
    cost more. The outcome is pinned onto the object's own ``program``, ``note``
    and ``hints`` by the library, so ``build(program)`` reproduces the sharpened
    object and the three records cannot disagree.

    Notes
    -----
    **The cache entry moves with the object, and nothing is rebuilt.**
    ``sharpen`` moves its object in place while the cache is keyed on a hash of
    ``(decl, log2, bs)``, so left alone the cache would serve, under a key
    asserting one grid, an object sitting on another. Rebuilding to avoid that
    would throw away the probe, which is the expensive part and has already run.
    So the object is re-filed instead: the old id is dropped and the same entry
    goes back under the id its own ``sharpen_program`` hashes to, which is
    exactly the id an ordinary build of that text would produce. Rebuilding the
    derived program from the editor is then a cache hit.

    The entry object itself is reused rather than replaced, so the lock that
    guards reads of this object is the same one before and after the move.

    **The api's own cap reaches the probe.** ``sharpen`` defaults to
    ``log2_cap=20`` and ``AGGAPI_LOG2_CAP`` defaults to 18, so an unattended
    probe could land on a grid the build route would then refuse, leaving the
    user with a derived program the app cannot honor.
    """
    obj = entry.obj
    if not hasattr(obj, "sharpen"):
        raise HTTPException(
            status_code=400,
            detail="sharpening applies to an Aggregate or a Portfolio")
    if not can_sharpen(obj):
        raise HTTPException(
            status_code=400,
            detail=("this program already carries a sharpen verdict; a second "
                    "audit of a confirmed grid is a slow no-op"))

    # Same guards as a build, because a probe is several builds: it re-updates
    # the object across a line search of neighboring cells.
    with _build_semaphore:
        future = _build_executor.submit(
            lambda: obj.sharpen(log2_cap=settings.log2_cap))
        try:
            future.result(timeout=settings.build_timeout_s)
        except FuturesTimeout:
            raise HTTPException(
                status_code=504,
                detail=f"sharpen exceeded {settings.build_timeout_s}s")
        except Exception as exc:  # noqa: BLE001 -- reported to the user
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    program = collapse_program(getattr(obj, "sharpen_program", "") or "")
    if not program:
        # The library declines to pin an object built programmatically, or one
        # whose program cannot be re-parsed. The grid still moved, so this is
        # not an error; there is simply no text to hand back.
        raise HTTPException(
            status_code=422,
            detail="the probe ran but this object carries no program to pin")

    # The id is computed over the **collapsed** text, and stays that way. An
    # ordinary build of the returned program goes through ``post_object``, which
    # collapses before it hashes (see ``:504``), so hashing the spread form here
    # would re-file this entry under an id no build could ever ask for and the
    # editor's rebuild would miss its own cache slot. What the reader gets and
    # what the cache is keyed on differ only in whitespace, which is exactly the
    # difference ``collapse_program`` exists to make irrelevant.
    new_oid = object_id(canonicalize_decl(program), 0, 0.0)
    entry.decl, entry.log2, entry.bs = program, 0, 0.0
    cache.delete(oid)
    cache.put(new_oid, entry)
    return {
        "program": spread(program),
        "description": getattr(obj, "sharpen_description", None) or None,
        **_manifest(new_oid, entry),
    }


@router.post("/objects/{oid}/pnl", response_model=models.DerivedResponse)
def post_pnl(
    oid: str,
    req: models.PnlProgramRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Wrap this object in a P&L and return the program that does it.

    ``pnl NAME_PnL <premium> less <engine> less <expense>``, with the object's
    own body inlined as the engine, so the text is self-contained and builds
    anywhere rather than only in the session that wrote it. The premium head
    is ``derive premium`` when the exposure states one (the engine's technical
    premium grossed up for the expense clause, so premium net of expenses
    returns the technical premium exactly; upstream since ``aggregate``
    1.0.0a270, ``inherit premium`` before that), and otherwise expected loss
    over ``loss_ratio``, rounded where the number is produced
    (``aggregate._program._pnl_consideration``, upstream since ``aggregate``
    1.0.0a251; this route rewrote the text itself until a95).

    Notes
    -----
    Unlike sharpening this mutates nothing, so there is no re-filing to do: the
    derived text goes through the ordinary build path, which is
    :func:`post_object` called directly rather than reimplemented. That is
    deliberate. Every guard the build route carries (the log2 cap, the
    semaphore, the wall-clock timeout, the audit row and the whole parse-error
    surface) applies unchanged to a derived program, and a second
    implementation would be a second place for them to drift.
    """
    obj = entry.obj
    if not hasattr(obj, "pnl_program"):
        raise HTTPException(
            status_code=400,
            detail="a P&L wraps an Aggregate or a Portfolio")
    try:
        program = obj.pnl_program(loss_ratio=req.loss_ratio,
                                  expense_ratio=req.expense_ratio)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    program = collapse_program(program)
    built = post_object(models.BuildRequest(decl=program), request,
                        settings, cache, audit)
    return {"program": spread(program), "description": None, **built}


@router.post("/objects/{oid}/reins", response_model=models.DerivedResponse)
def post_reins(
    oid: str,
    req: models.ReinsProgramRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Cede a layer, and return the program that rebuilds the net object.

    The clause cannot simply be appended to the program text: an occurrence
    cession sits **before** the frequency clause and an aggregate cession after
    it, so anyone splicing strings rather than specs gets it wrong. The library
    mutates the spec and re-renders instead, and this route only asks.

    Like the P&L wrap this mutates nothing, so the derived text goes through
    the ordinary build path. The derived object is ``NAME_net``, and Reset on
    the action row is the way back to the gross one, which is why the
    reinsurance pane needs no reset of its own.

    Notes
    -----
    Two refusals come straight from the library and are 422s here, because both
    are a statement about the program rather than a server fault: a malformed
    clause, and an occurrence cession joined to an ``approximate`` clause, which
    the parser rejects, so returning the text would hand back something that
    cannot build.
    """
    obj = entry.obj
    if not hasattr(obj, "reins_program"):
        raise HTTPException(
            status_code=400,
            detail="a cession applies to an Aggregate")
    try:
        program = obj.reins_program(req.cession)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    program = collapse_program(program)
    built = post_object(models.BuildRequest(decl=program), request,
                        settings, cache, audit)
    return {"program": spread(program), "description": None, **built}


@router.get("/objects/{oid}/narrative", response_model=models.NarrativeResponse)
def get_narrative(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """Everything this object says about itself in prose.

    The ``info`` block first, then one section per text field it carries, each
    with its short form and its long one. Absorbs the old "Info (raw)" view,
    which showed the first of those and none of the rest.

    Derived by suffix rather than from a list, so a narrative the library adds
    upstream appears here with no endpoint change, which is the same contract
    the exhibit and chart routes keep.
    """
    return {
        "info": str(getattr(entry.obj, "info", "") or ""),
        "sections": narrative_for(entry.obj),
    }


# ----------------------------------------------------------------------
# Pricing bounds: how much of the price the distortion decides
# ----------------------------------------------------------------------

def _resolve_risk(obj: Any, text: str, settings: Settings):
    """A named unit of this portfolio, or a line built from a DecL fragment.

    The two ways a user names a second risk, and they are tried in that order
    because a unit name is unambiguous and free while a fragment is a build.

    Parameters
    ----------
    obj : Any
        The reference object, whose units are searched first.
    text : str
        A unit name, or DecL for a line that does not exist yet.
    settings : Settings
        For the log2 cap, which a fragment has to respect exactly as a typed
        program does: it is the same build, reached by a different door.

    Returns
    -------
    (str, object)
        Display name and the risk.
    """
    name = text.strip()
    if not name:
        raise ValueError("name a risk, or write the DecL for one")
    for unit in getattr(obj, "unit_names", []) or []:
        if str(unit) == name:
            return name, obj[name]

    program = collapse_program(name)
    hint_log2 = max((int(m) for m in _HINTS_LOG2.findall(program)), default=0)
    if hint_log2 > settings.log2_cap:
        raise ValueError(
            f"log2 {hint_log2} exceeds AGGAPI_LOG2_CAP={settings.log2_cap}")
    try:
        built = _build_singleton(program)
    except Exception as exc:  # noqa: BLE001 -- reported as a 422
        raise ValueError(
            f"{name!r} is not a unit of this object, and does not build: "
            f"{exc}") from exc
    return getattr(built, "name", name), built


@router.get("/objects/{oid}/bounds/envelope")
def get_bounds_envelope(
    oid: str,
    premium: float = Query(..., gt=0, description="Target premium."),
    assets: float | None = Query(None, gt=0, description="Asset cap."),
    n_resamples: int = Query(50, ge=0, le=500,
                             description="Bracketing curves inside the band."),
    request: Request = None,
    entry: CacheEntry = Depends(_locked_entry),
) -> Response:
    """The envelope: every distortion consistent with this premium.

    A GET because the answer is identified entirely by its query, which is what
    makes it cacheable and revalidatable.

    Serves the **chart document** since a60, not a rendered image. It used to
    ship SVG or PNG from a matplotlib figure and was the last thing in the api
    importing matplotlib; the library's ``chart_envelope`` emitter publishes the
    same picture as semantics, so this route serializes and the browser draws.
    The reader gets a chart they can zoom and read values off, and the two
    renderers cannot disagree about what the envelope is, because there is one
    document behind both.

    See :mod:`aggregate_api.bounds` for why fifty resamples is cheap.
    """
    try:
        body, doc_hash = run_envelope(
            entry.obj, premium=premium, assets=assets,
            n_resamples=n_resamples)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    etag = f'"{doc_hash}"'
    if request is not None and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=body,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


@router.post("/objects/{oid}/bounds/allocation", response_model=models.BoundsResponse)
def post_allocation_bounds(
    oid: str,
    req: models.BoundsRequest,
    ir: bool = Query(False, description="Also return a table document."),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Per-unit natural-allocation ranges consistent with the total premium.

    Portfolio only, and not by our choice: the calculation reads the ``exeqa_*``
    columns of a portfolio's density frame, which a single aggregate has no
    analogue of.
    """
    try:
        return run_allocation(entry.obj, premium=req.premium,
                              assets=req.assets, ir=ir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/objects/{oid}/bounds/pricing", response_model=models.BoundsResponse)
def post_pricing_bounds(
    oid: str,
    req: models.BoundsRequest,
    ir: bool = Query(False, description="Also return a table document."),
    settings: Settings = Depends(get_settings),
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Given this object priced to ``premium``, what can a second risk cost?

    The question behind quoting a new line off an existing book: the
    calibration is carried across, and the width of the answer is how much of
    the second price the choice of distortion decides.

    Each entry in ``against`` is a unit of the current portfolio or a DecL
    fragment for a line that does not exist yet. A fragment is an ordinary
    build and answers to the same log2 cap.

    **An empty ``against`` on a portfolio means every unit.** That is the
    question a portfolio makes you want to ask, and having to type one unit name
    to ask any of it made the default answer nothing at all.
    ``Portfolio.pricing_bounds`` takes a source, a list or a dict, so this is a
    default rather than a loop. Naming a unit narrows to that one; naming a DecL
    fragment prices a line that does not exist yet, and both still work.

    An aggregate has no units to default to, so an empty ``against`` there is
    still the error it always was: there is no second risk to price.
    """
    try:
        against = list(req.against)
        if not against:
            against = [str(u) for u in (getattr(entry.obj, "unit_names", None) or [])]
        targets = dict(_resolve_risk(entry.obj, text, settings)
                       for text in against)
        return run_pricing_bounds(entry.obj, premium=req.premium,
                                  targets=targets, assets=req.assets, ir=ir)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/exhibits and /exhibit/{name} -- business exhibits
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/exhibits")
def list_exhibits(oid: str, entry: CacheEntry = Depends(_locked_entry)) -> dict:
    """List the exhibits this object can serve, with their perspectives.

    A passthrough of ``aggregate.exhibits.available_exhibits``: the library
    owns the capability set (its registrations plus per object predicates),
    so a new library exhibit appears here with zero endpoint changes. No per
    kind tables in the route. The client grays out chips whose capability is
    absent; it never hides them.
    """
    items = agg_exhibits.available_exhibits(entry.obj)
    return {
        "exhibits": [
            {
                "name": name,
                "title": agg_exhibits.EXHIBITS[name][0].title,
                "perspectives": [p.value for p in perspectives],
            }
            for name, perspectives in items
        ]
    }


@router.get("/objects/{oid}/exhibit/{name}")
def get_exhibit(
    oid: str,
    name: str,
    perspective: str = Query("raw", description="raw|insurer"),
    request: Request = None,
    entry: CacheEntry = Depends(_locked_entry),
) -> Response:
    """Return the named exhibit envelope: TableDoc blocks plus metadata.

    The exhibit sibling of the frame-document route. The library owns the
    business translation per perspective (captions, row flags, drops,
    relabeling); this route only serializes and revalidates. An unknown or
    unavailable name is a 404 carrying the capability set; an unsupported
    perspective is a 400 (the enum has four values; raw and insurer are
    served at 1.0).

    Notes
    -----
    The body is deterministic UTF-8 JSON (sorted keys, compact separators,
    ``canonical_dict`` blocks), so the exhibit hash (sha256 over the block
    document hashes) works as the ETag under the same revalidation contract
    as the table and chart documents.
    """
    available = dict(agg_exhibits.available_exhibits(entry.obj))
    if name not in available:
        raise HTTPException(
            status_code=404,
            detail=(f"no exhibit {name!r} for this object; "
                    f"available: {sorted(available)}"),
        )
    try:
        # The same row cap the api's own documents take, so a reader cannot
        # meet two different truncation points depending on which route a leaf
        # happens to use. The library's own default is 200; ``tables.MAX_ROWS``
        # is 500 and is the number this service has been serving all along.
        exhibit = agg_exhibits.build_exhibit(entry.obj, name, perspective,
                                             max_rows=MAX_ROWS)
    except (NotImplementedError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    body = json.dumps(
        exhibit.to_payload(), sort_keys=True, separators=(",", ":"),
        ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")
    etag = f'"{exhibit.hash}"'
    if request is not None and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=body,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )


# ----------------------------------------------------------------------
# POST /v1/objects/{id}/pricing/{preview,calibrate,allocate,evaluate}
# ----------------------------------------------------------------------
# The Pricing group, served through the official channel. Where the three older
# routes below build pandas frames here and hand them over with this repo's
# opinion about how they print, these hold the result object the library returns
# and serve the exhibits registered on it. The frames, the formats, the captions
# and the row emphasis are all the library's, which is the purist ruling applied
# to the last pane that was making its own.
#
# Every library ``ValueError`` on this path is written to be shown to a reader as
# a sentence, so all three routes turn one into a 400 whose ``detail`` is the
# message verbatim. Three reach the app: the unbounded anchor guard on ``p=1``,
# the loss-ratio target that implies a premium above the assets, and the
# "exactly one of" validations. The first two land in the preview line.

@router.post("/objects/{oid}/pricing/preview",
             response_model=models.PricingPreviewResponse)
def post_pricing_preview(
    oid: str,
    req: models.PricingPreviewRequest,
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """The pentagon this anchor and target imply, as scalars.

    The cheapest question in the group and the only one that answers with
    numbers rather than documents: no distortion is fitted and nothing is
    allocated. It feeds the Calibrate form's live preview line, which is also
    where a refusal belongs, since a reader who has typed an impossible anchor
    should learn it where they are looking rather than after pressing a button.

    See :func:`aggregate_api.pricing.run_pricing_preview`.
    """
    try:
        return run_pricing_preview(entry.obj, p=req.p, a=req.a, coc=req.coc,
                                   lr=req.lr, premium=req.premium,
                                   basis=req.basis)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/objects/{oid}/pricing/calibrate",
             response_model=models.PricingExhibitsResponse)
def post_pricing_calibrate(
    oid: str,
    req: models.PricingCalibrateRequest,
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Fit the standard distortion set, and serve the two exhibits it supports.

    One press fills two subtabs. ``pricing.calibrate`` is the per-family receipt
    and ``pricing.stand_alone`` prices each part on its own with those same
    fitted families, the views of a cession or the units of a book, so both come
    back from one POST and stepping between the two leaves costs nothing.

    See :func:`aggregate_api.pricing.run_calibration`.
    """
    try:
        return run_calibration(entry.obj, p=req.p, a=req.a, coc=req.coc,
                               lr=req.lr, premium=req.premium,
                               basis=req.basis)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/objects/{oid}/pricing/allocate",
             response_model=models.PricingExhibitsResponse)
def post_pricing_allocate(
    oid: str,
    req: models.PricingAllocateRequest,
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """Split one calibrated premium across the parts of the object.

    The other half of the calibrate press's old bundle, and the opposite reading
    of it. Where ``pricing/calibrate`` prices each part as a distribution in its
    own right, this decomposes one premium: the book's total across its units,
    or an occurrence program's gross premium into its ceded and net halves, with
    the two footing to the whole exactly.

    Its own press because it is its own cost. On an occurrence program the
    library builds the joint distribution of gross and ceded to read the kappa
    curve off, which is real work and is not what a reader asking for a
    calibration ordered.

    See :func:`aggregate_api.pricing.run_natural_allocation`, whose longer name
    keeps ``bounds.run_allocation`` beside it meaning what it always has.
    """
    try:
        return run_natural_allocation(entry.obj, p=req.p, a=req.a, coc=req.coc,
                                      lr=req.lr, premium=req.premium,
                                      basis=req.basis)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/objects/{oid}/pricing/evaluate",
             response_model=models.PricingExhibitsResponse)
def post_pricing_evaluate(
    oid: str,
    req: models.PricingEvaluateRequest,
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """The breakeven acceptability panel for a premium already held.

    Pricing asks what an obligation is worth at a chosen capital level; this asks
    how much stress the position survives. Anchored at the level a calibration
    was struck at, the two close a round trip: evaluating a family's own implied
    premium recovers that family's calibrated parameters.

    See :func:`aggregate_api.pricing.run_evaluation`.
    """
    try:
        return run_evaluation(entry.obj, premium=req.premium, basis=req.basis,
                              p=req.p, a=req.a)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
