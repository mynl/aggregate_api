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
* ``GET    /v1/objects/{id}/plot``        -- SVG/PNG image (native .plot()).
* ``POST   /v1/objects/{id}/pricing_at``  -- distortion / ccoc pricing.

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

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from lark.exceptions import UnexpectedInput, VisitError

from aggregate import Distortion, Severity, build as _build_singleton
from aggregate.constants import FIRST_CLASS_CLASSES, NEAR_FIRST_CLASS
from aggregate.parser_errors import ErrorReport, format_error

from .. import models
from ..audit import AuditLog
from ..cache import CacheEntry, ObjectCache, canonicalize_decl, object_id
from ..config import Settings, get_settings
from ..plotting import render_plot
from ..pricing import run_price_pentagon, run_pricing
from ..serializers import (
    DENSITY_DISPLAY_LOG2,
    bin_density,
    frame_to_payload,
    info_to_payload,
    pnl_density_frame,
    reset_index_safe,
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


def _run_build(decl: str, log2: int, bs: float):
    """Invoke the underlying ``build()``.

    Pulled into a helper so the thread-pool target is a plain
    function -- closures over ``log2=0`` / ``bs=0`` are the
    library's "let me pick" signal, so we forward the request's
    values verbatim.
    """
    # log2=0 / bs=0 are the underlying ``build()``'s "use defaults"
    # sentinels; pass them through when the request omitted those
    # knobs.
    return _build_singleton(decl, log2=log2, bs=bs)


def _resolve_object(oid: str, cache: ObjectCache) -> CacheEntry:
    """Fetch an entry or raise 404."""
    entry = cache.get(oid)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"object {oid} not in cache")
    return entry


def _summary_fields(obj: Any) -> dict:
    """Headline ``mean`` / ``cv`` / ``validation`` for the build summary.

    ``Aggregate`` and ``Portfolio`` carry the analytic moments on ``actual_m`` /
    ``actual_cv`` and the realized (model-output) ones on ``est_m`` / ``est_cv``.
    The summary shows the analytic value, which is what the program asked for,
    and falls back to the estimate: a ``PnL`` has only ``est_*`` (its outcome is
    emergent, so there is no input mean to report).

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

    return {
        "bs": _num("bs"),
        "mean": _num("actual_m", "est_m"),
        "cv": _num("actual_cv", "est_cv"),
        "validation": validation,
    }


# Raw-moment statistic labels (E[X], E[X^2], E[X^3]). The displayed stats /
# reins-stats tables drop these rows -- nobody reads E[X^2]; the human-readable
# mean / cv / skew (and the ``meta`` block) carry the story. The full-frame CSV
# download keeps them (the "give me everything" export).
_RAW_MOMENTS = frozenset({"ex1", "ex2", "ex3"})


def _drop_raw_moments(df):
    """Drop the ``ex1`` / ``ex2`` / ``ex3`` rows; keep mean / cv / skew (+ meta).

    Parameters
    ----------
    df : pandas.DataFrame
        ``stats_df`` / ``reins_stats_df``, whose rows carry a 2-level
        ``(group, statistic)`` MultiIndex (the ``meta`` group has its own
        labels and no ``ex*``, so it's untouched).

    Returns
    -------
    pandas.DataFrame
        The frame with the raw-moment rows removed. Filters on the
        *innermost* index level, so it works for a flat index too.
    """
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

    # Collapse newlines / tabs / `\` line-continuations to single spaces so a
    # program formatted across several indented lines builds without the ugly
    # `\` continuation. DecL treats a bare newline as a *program separator*, but
    # the same program on one line parses fine. We replace (not delete) runs of
    # whitespace so tokens don't merge (``100\nclaims`` → ``100 claims``), drop
    # any `\` first to fold existing continuation programs in too, then strip.
    # Done up front so the hints scan, cache key, build, and any parse-error
    # caret all see the same collapsed source. This is a single-object
    # playground (one program per build), so merging newline-separated programs
    # is not a regression. ``#`` comments aren't accepted in the input box, so
    # nothing gets swallowed.
    req.decl = re.sub(r"\s+", " ", req.decl.replace("\\", " ")).strip()

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
            "warnings": [],
            "cached": True,
            "elapsed_ms": elapsed,
            **_summary_fields(cached_entry.obj),
        }

    # Cache miss -- fire the build, gated by the semaphore +
    # wall-clock timeout. Note: the semaphore only serializes the
    # *future submission*, not the wait. With one worker the
    # semaphore is technically redundant (the worker serializes
    # naturally), but it makes intent explicit.
    with _build_semaphore:
        future = _build_executor.submit(_run_build, req.decl, eff_log2, eff_bs)
        try:
            obj = future.result(timeout=settings.build_timeout_s)
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
        "warnings": [],
        "cached": False,
        "elapsed_ms": elapsed,
        **_summary_fields(obj),
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
            try:
                text = format_program(text, fmt="text")
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
def get_info(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    entry = _resolve_object(oid, cache)
    return info_to_payload(entry.obj)


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/meta
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/meta", response_model=models.ObjectMetaResponse)
def get_meta(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
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
    entry = _resolve_object(oid, cache)
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
def get_summary(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """At-a-glance risk view -- moments + key percentiles (``summary_df``).

    Since ``aggregate`` 1.0.0a113 ``summary_df`` is the user-facing risk
    frame (Freq / Sev / Agg rows; ``E[X] | SD | CV | Skew | p0.01 | p0.50 |
    p0.99``), not the old moment-validation table -- that moved to
    :func:`get_validation_df` (``validation_df``). ``CV`` and the Freq-row
    percentiles are blank (NaN -> JSON ``null``) by design.
    """
    entry = _resolve_object(oid, cache)
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
def get_tail_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
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
    entry = _resolve_object(oid, cache)
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
def get_validation_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Moment-vs-estimate QA table (``validation_df``).

    The old ``summary_df`` payload, renamed upstream: theoretical vs
    empirical moments with the per-moment error, reading "not unreasonable"
    on a clean build. Demoted under the SPA's **More** menu now that
    ``summary_df`` is the headline risk view.
    """
    entry = _resolve_object(oid, cache)
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
def get_stats_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    entry = _resolve_object(oid, cache)
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
    cache: ObjectCache = Depends(_get_cache),
) -> dict:
    """Density_df reduced to a faithful power-of-two display grid.

    For an object with a build grid (agg / port; ``log2`` present) the
    2**log2-row frame is binned to a fixed 2**11 display grid: masses
    (``p_total`` / ``p_sev`` / ``p_*``) are summed and the pointwise columns
    (``loss`` / ``F`` / ``S`` / ``ex***``) take the super-bucket right edge, so
    ``p_total`` stays faithful (sums to ~1) instead of being understated by an
    even-spaced stride. The full-frame CSV download stays exact / unbinned.

    A ``PnL`` has no DataFrame ``density_df`` (it is a dict of per-leg grids);
    its grand-result density is synthesized (:func:`pnl_density_frame`) into the
    same ``loss / p_total / F / S`` shape and binned like an aggregate.

    Objects without a build grid (a distortion's g-curve, a
    ``BivariateAggregate`` joint matrix) skip binning and honor the legacy
    ``cols`` / ``start`` / ``stop`` / ``downsample`` / ``nonzero`` params.
    """
    entry = _resolve_object(oid, cache)
    col_list = [c.strip() for c in cols.split(",")] if cols else None

    if entry.kind == "pnl":
        # A PnL's density_df is a dict of per-leg GridDistributions, not a
        # DataFrame. Synthesize the grand-result density in the standard
        # loss / p_total / F / S shape and bin it to the 2**11 display grid the
        # way an aggregate is binned -- the positional binning tolerates the
        # signed P&L outcome axis. ``(n - 1).bit_length()`` is ceil(log2(n)),
        # so a grid already at or under the display size skips binning.
        df = pnl_density_frame(entry.obj)
        if col_list:
            df = df[[c for c in col_list if c in df.columns]]
        sum_cols = {c for c in df.columns if c.startswith("p")}
        source_log2 = max(DENSITY_DISPLAY_LOG2, (len(df) - 1).bit_length())
        return frame_to_payload(bin_density(df, source_log2, sum_cols=sum_cols))

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

    source_log2 = getattr(entry.obj, "log2", None)
    if source_log2 is not None:
        # Bin the full grid to 2**11 rows. Apply the column subset first (so we
        # only sum the masses the SPA asked for), then bin: p_* columns sum,
        # loss/F/S right-edge.
        if col_list:
            existing = [c for c in col_list if c in df.columns]
            df = df[existing]
        sum_cols = {c for c in df.columns if c.startswith("p")}
        return frame_to_payload(bin_density(df, source_log2, sum_cols=sum_cols))

    # No build grid: leave the frame as-is and honor the legacy slice params.
    if nonzero and "p_total" in df.columns:
        df = df[df["p_total"] > 0]
    return frame_to_payload(
        df, cols=col_list, start=start, stop=stop, downsample=downsample,
    )


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/kappa  -- Portfolio only
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/kappa", response_model=models.FrameResponse)
def get_kappa(
    oid: str,
    downsample: int | None = Query(None, ge=1, le=10_000),
    cache: ObjectCache = Depends(_get_cache),
) -> dict:
    """Per-unit conditional expected losses (the ``exeqa_*`` slice)."""
    entry = _resolve_object(oid, cache)
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
        df = bin_density(df, source_log2, sum_cols=set())
    return frame_to_payload(df, downsample=downsample)


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/bs_window_df  -- bucket/window estimator summary
# ----------------------------------------------------------------------

@router.get("/objects/{oid}/bs_window_df", response_model=models.FrameResponse)
def get_bs_window_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Bucket/window estimator summary (``_bs_window_df``).

    A small per-method frame the library builds while choosing the grid
    (``bs`` / ``log2`` / ``x_min``); the ``selected`` row marks the method
    actually used. Stored on the private ``_bs_window_df`` attribute, so a
    getattr miss (e.g. on a Portfolio) yields a clean 400.
    """
    entry = _resolve_object(oid, cache)
    df = _frame_attr(entry.obj, "_bs_window_df")
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
# faithful 2**11 display grid instead -- see ``bin_density``. The csv download
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
def get_reins_description(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Always-visible text block describing the reinsurance program.

    ``Aggregate.reins_description`` is a short string attribute (e.g.
    ``"Ceded to 100% share of 15 xs 5 per occurrence"``), empty when the
    object carries no reinsurance. ``Portfolio`` has no such attribute --
    there we report availability from ``reins_summary_df`` and leave the text
    empty (the Reins table carries the detail).
    """
    entry = _resolve_object(oid, cache)
    obj = entry.obj
    # ``reins_summary_df`` is None exactly when the object has no reinsurance, so
    # it's the canonical availability signal. ``reins_description`` is a plain
    # string property carrying the human-readable blurb (empty otherwise).
    has_reins = _frame_attr(obj, "reins_summary_df") is not None
    text = str(getattr(obj, "reins_description", "") or "").strip() if has_reins else ""
    return {"available": has_reins, "text": text}


@router.get("/objects/{oid}/reins_summary_df", response_model=models.FrameResponse)
def get_reins_summary_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Per-layer gross/ceded/net reference-vs-model frame."""
    entry = _resolve_object(oid, cache)
    df = _frame_attr(entry.obj, "reins_summary_df")
    if df is None:
        raise HTTPException(status_code=400, detail="no reinsurance on this object")
    return frame_to_payload(reset_index_safe(df))


@router.get("/objects/{oid}/reins_stats_df", response_model=models.FrameResponse)
def get_reins_stats_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Per-layer summary statistics (small frame -> shown in full)."""
    entry = _resolve_object(oid, cache)
    df = _frame_attr(entry.obj, "reins_stats_df")
    if df is None:
        raise HTTPException(status_code=400, detail="no reinsurance on this object")
    return frame_to_payload(reset_index_safe(_drop_raw_moments(df)))


@router.get("/objects/{oid}/reins_density_df", response_model=models.FrameResponse)
def get_reins_density_df(oid: str, cache: ObjectCache = Depends(_get_cache)) -> dict:
    """Reinsurance density preview, binned to the power-of-two display grid.

    The full frame spans the whole loss grid (2**log2 rows). We bin it to a
    fixed 2**11 display grid: every gross/ceded/net density column (``p_*``)
    sums and ``loss`` right-edges, so the previewed masses stay faithful. The
    csv download has the full, exact frame.
    """
    entry = _resolve_object(oid, cache)
    df = _frame_attr(entry.obj, "reins_density_df")
    if df is None:
        raise HTTPException(status_code=400, detail="no reinsurance on this object")
    df = reset_index_safe(df)
    source_log2 = getattr(entry.obj, "log2", None)
    if source_log2 is not None:
        sum_cols = {c for c in df.columns if c.startswith("p")}
        return frame_to_payload(bin_density(df, source_log2, sum_cols=sum_cols))
    return frame_to_payload(df, downsample=DENSITY_PREVIEW_ROWS)


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/frame/{which}.csv  -- full-frame download
# ----------------------------------------------------------------------
# Maps a download name to the attribute that yields its DataFrame. The
# on-screen tables are previews; this route always returns the complete
# frame as CSV for "save the real data" workflows.
_CSV_FRAMES = {
    "summary": "summary_df",
    "tail_df": "tail_df",
    "validation_df": "validation_df",
    "stats_df": "stats_df",
    "density_df": "density_df",
    "bs_window_df": "_bs_window_df",
    "reins_summary_df": "reins_summary_df",
    "reins_stats_df": "reins_stats_df",
    "reins_density_df": "reins_density_df",
}


@router.get("/objects/{oid}/frame/{which}.csv")
def get_frame_csv(
    oid: str, which: str, cache: ObjectCache = Depends(_get_cache)
) -> Response:
    """Return the full named frame as a CSV download."""
    attr = _CSV_FRAMES.get(which)
    if attr is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown frame {which!r}; expected one of {sorted(_CSV_FRAMES)}",
        )
    entry = _resolve_object(oid, cache)
    if entry.kind == "pnl" and which == "density_df":
        # A PnL's density_df is a dict of GridDistributions, not a frame; export
        # the grand-result density instead (the full, unbinned shape the Density
        # tab previews). All the PnL's other frames are real DataFrames and flow
        # through the generic path below.
        df = pnl_density_frame(entry.obj)
    else:
        # ``tail_df`` is a method on agg / port; ``_resolve_frame`` calls it.
        df = _resolve_frame(entry.obj, attr)
    if df is None:
        raise HTTPException(
            status_code=400, detail=f"{which} not available for {entry.kind!r}"
        )
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

@router.get("/objects/{oid}/plot")
def get_plot(
    oid: str,
    kind: str = Query("native", description="native|density|cdf|qq|kappa"),
    format: str = Query("svg", description="svg|png"),
    width: float | None = Query(None, gt=0, le=30),
    height: float | None = Query(None, gt=0, le=30),
    dpi: float | None = Query(None, gt=0, le=600),
    cache: ObjectCache = Depends(_get_cache),
) -> Response:
    """Render the requested plot.

    Returns the image bytes directly (no JSON wrapper) with the
    matching ``Content-Type``. Streamed as a single ``Response``
    rather than ``StreamingResponse`` because plot bytes are
    already in-memory.
    """
    entry = _resolve_object(oid, cache)
    try:
        payload, media_type = render_plot(
            entry.obj, kind, fmt=format, width=width, height=height, dpi=dpi,
        )
    except ValueError as exc:
        # ValueError from render_plot is a 400 (bad request param).
        raise HTTPException(status_code=400, detail=str(exc))
    return Response(content=payload, media_type=media_type)


# ----------------------------------------------------------------------
# POST /v1/objects/{id}/pricing_at
# ----------------------------------------------------------------------

@router.post("/objects/{oid}/price", response_model=models.PriceResponse)
def post_price(
    oid: str,
    req: models.PriceRequest,
    cache: ObjectCache = Depends(_get_cache),
) -> dict:
    """Pricing-pentagon completion (+ distortion analysis for Portfolios).

    Fix the capital level with ``p`` and supply exactly one target (``coc``
    or ``lr``); see :func:`aggregate_api.pricing.run_price_pentagon`.
    """
    entry = _resolve_object(oid, cache)
    try:
        return run_price_pentagon(entry.obj, p=req.p, coc=req.coc, lr=req.lr)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/objects/{oid}/pricing_at", response_model=models.PricingResponse)
def post_pricing(
    oid: str,
    req: models.PricingRequest,
    cache: ObjectCache = Depends(_get_cache),
) -> dict:
    entry = _resolve_object(oid, cache)
    try:
        return run_pricing(
            entry.obj,
            p=req.p,
            a=req.a,
            ccoc=req.ccoc,
            distortion=req.distortion,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
