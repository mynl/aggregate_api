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
* ``POST   /v1/objects/{id}/sharpen``     -- audit the grid, move to a better
  one, and pin the outcome. Derivation: answers with DecL plus the object.
* ``POST   /v1/objects/{id}/hints``       -- pin the realized grid into the
  object's own ``hints{}``. Derivation.
* ``POST   /v1/objects/{id}/pnl``         -- wrap the object in a P&L. Derivation.
* ``POST   /v1/objects/{id}/explode``     -- the same P&L walked layer by layer,
  ``pnl`` to ``xpnl``. Derivation.
* ``POST   /v1/objects/{id}/reins``       -- cede a layer. Derivation.
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

import copy
import json
import logging
import math
import numbers
import re
import threading
import time
import warnings
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Annotated, Any, Literal

import pandas as pd

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import Field

from lark.exceptions import UnexpectedInput, VisitError

from aggregate import Distortion, Severity
from aggregate import charts as agg_charts
from aggregate import exhibits as agg_exhibits
from aggregate.constants import FIRST_CLASS_CLASSES, NEAR_FIRST_CLASS
from aggregate.parser import UnderwritingLexer
from aggregate.parser_errors import ErrorReport, format_error
from aggregate.underwriter import RecipeNotFound

from .. import models
from ..audit import AuditLog
from ..cache import (
    CacheEntry, ObjectCache, canonicalize_decl, object_id, qualified_object_id,
)
from ..bounds import run_allocation, run_envelope, run_pricing_bounds
from ..capability import (
    PNL_PREMIUM_STYLE_SUPPORTED, can_sharpen, capability_for, narrative_for,
)
from ..config import Settings, get_settings
from ..library import get_underwriter
from ..library_notes import from_library
from ..net import client_address
from ..sessions import SESSION_HEADER, SessionRegistry, normalize_session_id
from .. import status as status_state
from ..pricing import (
    run_calibration, run_evaluation, run_natural_allocation,
    run_pricing_preview, run_ruin,
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
_sessions_singleton: SessionRegistry | None = None

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


def _get_sessions(settings: Settings = Depends(get_settings)) -> SessionRegistry:
    """Lazy-init the session registry at the configured size and TTL."""
    global _sessions_singleton
    with _cache_lock:
        if (_sessions_singleton is None
                or _sessions_singleton._max != settings.session_max
                or _sessions_singleton._ttl != settings.session_ttl_s):
            _sessions_singleton = SessionRegistry(
                max_sessions=settings.session_max, ttl_s=settings.session_ttl_s)
    return _sessions_singleton


def _get_session_uw(
    request: Request,
    session: str | None = Query(
        None,
        alias="session",
        description=(
            "Session id, for the two paths a browser cannot set a header on: "
            "this download and the CSV exports. Everything else sends "
            "X-Aggregate-Session."
        ),
    ),
    sessions: SessionRegistry = Depends(_get_sessions),
) -> Any:
    """Dependency: the caller's own recipe base.

    Reads ``X-Aggregate-Session``, falling back to the ``session`` query
    parameter for the routes a browser reaches by navigation rather than by
    ``fetch``, and to one shared anonymous session when neither is present.

    Notes
    -----
    Returns the fork itself rather than the id, because every caller wants the
    base. Where the id is also wanted (the audit row, the qualified cache key)
    the route reads it through :func:`session_id_of` off the same request.
    """
    sid = normalize_session_id(request.headers.get(SESSION_HEADER) or session)
    return sessions.underwriter(sid, get_underwriter())


def session_id_of(request: Request, session: str | None = None) -> str:
    """The caller's session id, normalized, from header or query parameter.

    Separate from :func:`_get_session_uw` so a route can record the id without
    taking a fork it does not need, and so the two can never disagree about
    which id a request carries.
    """
    return normalize_session_id(request.headers.get(SESSION_HEADER) or session)


def reset_singletons() -> None:
    """Drop the cached cache + audit + sessions so the next request re-inits.

    Hook for tests that swap env vars across cases -- the
    ``client`` fixture in ``tests/api/conftest.py`` calls this.
    """
    global _cache_singleton, _audit_singleton, _sessions_singleton
    with _cache_lock:
        _cache_singleton = None
        _audit_singleton = None
        _sessions_singleton = None
    _chart_cache.clear()
    _exhibit_cache.clear()


# ----------------------------------------------------------------------
# The revalidation caches
# ----------------------------------------------------------------------
class RevalidationCache:
    """An LRU of ``(etag, body)``, keyed on everything that changes the bytes.

    Parameters
    ----------
    channel : str
        The telemetry channel this instance reports on, which namespaces its
        counters on the status page.
    max_entries : int
        How many entries to hold.

    Notes
    -----
    A key carries everything that changes the bytes, which is what makes it the
    same key the ETag answers for. The cache sits *above* the object cache and
    can never cause a build, so no document parameter is ever a reason to re-run
    an FFT. An ``oid`` is the content hash of ``(decl, log2, bs)``, cached
    objects are immutable and the builds are deterministic, so an entry cannot
    go stale under its own key: the only way to get different numbers is a
    different key.

    What it buys is the revalidation path. A conditional GET has to know the
    document's hash before it can answer 304, and the hash is only known by
    building the document; without a cache every ``If-None-Match`` would redo
    the whole build in order to reply "nothing changed". Measured on a three
    unit portfolio, that was 210 ms on ``exhibit/tail`` and 48 ms on
    ``exhibit/summary``, against 7 ms for a chart answering off this cache.

    Bounded by entries rather than by bytes, because what a reader generates in
    one sitting is one object's documents at a few settings, and the payloads
    within a channel are the same order of size as each other.
    """

    def __init__(self, channel: str, max_entries: int) -> None:
        self.channel = channel
        self.max_entries = max_entries
        self._entries: OrderedDict[tuple, tuple[str, bytes]] = OrderedDict()
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def get(self, key: tuple) -> tuple[str, bytes] | None:
        """Return the cached ``(etag, body)`` for ``key``, or None, marking it used."""
        with self._lock:
            hit = self._entries.get(key)
            if hit is not None:
                self._entries.move_to_end(key)
        status_state.record_cache(self.channel,
                                  "hit" if hit is not None else "miss")
        return hit

    def store(self, key: tuple, etag: str, body: bytes) -> None:
        """File ``(etag, body)`` under ``key``, evicting the least recently read."""
        evicted = 0
        with self._lock:
            self._entries[key] = (etag, body)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
                evicted += 1
        status_state.record_cache(self.channel, "store")
        for _ in range(evicted):
            status_state.record_cache(self.channel, "eviction")

    def clear(self) -> None:
        """Drop every entry, for ``reset_singletons``."""
        with self._lock:
            self._entries.clear()


# Small on purpose. A joint surface at the public ceiling of 256 cells per axis
# is a few hundred kB; at the local default of 1024 it can be a few MB, so eight
# entries is a worst case of a few tens of MB.
_CHART_CACHE_MAX = 8
_chart_cache = RevalidationCache("chart", _CHART_CACHE_MAX)

# Exhibit envelopes run a few kB against a chart's few MB, so a much larger
# count is still a far smaller worst case. Sixty four holds every exhibit a
# reader is likely to open on one object under both perspectives, which is the
# working set that matters: the cost this removes is paid on the *return* to a
# leaf, and returning is what reading an exhibit pane consists of.
_EXHIBIT_CACHE_MAX = 64
_exhibit_cache = RevalidationCache("exhibit", _EXHIBIT_CACHE_MAX)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    """The address this request came from, honoring one trusted proxy.

    Notes
    -----
    A one-line delegation to :func:`aggregate_api.net.client_address`, kept as a
    name here because every audit call site reads it and the indirection is the
    point: the rule for which forwarded element to trust is written once, beside
    the gate that depends on it being right.

    Through a111 this read ``request.client.host`` and nothing else. Both Caddy
    front doors proxy to ``127.0.0.1:8001``, so every production row recorded
    ``ip = '127.0.0.1'``, the ``builds_ip`` index indexed one value, and
    :meth:`aggregate_api.audit.AuditLog.by_ip` could not answer the question it
    exists for. Rows written before a112 are not retroactively meaningful.
    """
    return client_address(request)


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


def _run_build(uw, decl: str, log2: int, bs: float):
    """Invoke the caller's ``build()``, collecting what it says.

    Pulled into a helper so the thread-pool target is a plain
    function -- closures over ``log2=0`` / ``bs=0`` are the
    library's "let me pick" signal, so we forward the request's
    values verbatim.

    Parameters
    ----------
    uw : aggregate.underwriter.Underwriter
        The caller's fork, from :func:`_get_session_uw`. Passed in rather than
        reached for, because which base builds a program is the whole of what
        keeps one user's ``agg Cat`` out of another user's program, and a
        helper that reached for a global could not be told otherwise.

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
        obj = uw(decl, log2=log2, bs=bs)
    return obj, notes


def _preview(uw, text: str):
    """What ``text`` resolves to in ``uw``, or ``None`` if it will not say.

    Raises only :class:`aggregate.underwriter.RecipeNotFound`. A program that
    cannot be previewed for any other reason is one that cannot be keyed
    either, and the answer to that is to give it a private key and let the
    build path report the real error, which it does better than this could: a
    parse failure comes back as the library's ``ErrorReport``, with line,
    column and caret.

    The missing name is the exception, and it is let through on purpose. It is
    the shape an expired session takes: the fork holding what this user built
    has been evicted, so their own ``agg.NAME`` now names nothing. Swallowing
    it here would qualify the key and then possibly find an object still
    cached under it, answering a program whose reference no longer resolves.
    Better to say what is missing.

    Notes
    -----
    This runs **outside** the build slot, which is new. Every parse used to be
    serialized by accident, being inside the one-worker executor. The library
    documents ``preview`` as holding no instance state (a private parser, a
    private cycle guard) and the Lark grammar it leans on is a module
    singleton, so concurrent previews are safe by construction rather than by
    luck; ``tests/test_sessions.py`` pins it.
    """
    try:
        return uw.preview(text)
    except RecipeNotFound:
        raise
    except Exception:  # noqa: BLE001 -- fail closed, see the docstring
        return None


def _is_library_entry(source) -> bool:
    """True when a resolved reference means the same thing to everybody.

    The library records provenance as the ``.agg`` file an entry was read from,
    or the sentinel string ``'session'`` for one a build wrote. So the test is
    "did this come from a file", and it is written that way round on purpose:
    anything unrecognized answers False and the program gets a private key.
    Failing toward a redundant build costs one build; failing toward a shared
    one serves somebody else's answer.
    """
    return isinstance(source, PurePath)


def _cache_key(preview, session_id: str, canonical: str, log2: int, bs: float):
    """The cache id for this request, and which rule produced it.

    A program that resolved nothing, or resolved only entries read from the
    library file, means the same thing in every session: the shared key, one
    build for the whole room. A program that touched anything its own session
    declared, **including a library name that session overwrote**, is private:
    the session id joins the hash.

    Returns
    -------
    (str, str, str or None)
        The id, ``'shared'`` or ``'session'`` for the audit row, and why the
        session key was taken. The reason is ``None`` for a shared key, and
        otherwise one of two that mean opposite things. ``'session_reference'``
        is the rule working: the program touched a name its own session
        declared, so it cannot share a slot. ``'preview_unavailable'`` is the
        previewer declining to speak about the program at all, which is usually
        a program about to fail its build and is occasionally the previewer
        refusing what the builder accepts. Only the second is a finding, and
        ``GET /v1/status`` counts them apart for that reason.
    """
    if preview is None:
        return (qualified_object_id(session_id, canonical, log2, bs),
                "session", "preview_unavailable")
    if all(_is_library_entry(ref.source) for ref in preview.resolved):
        return object_id(canonical, log2, bs), "shared", None
    return (qualified_object_id(session_id, canonical, log2, bs),
            "session", "session_reference")


def _register(uw, preview) -> None:
    """File a previewed program's declarations in the caller's own base.

    The build path registers what it parses, so on a cache **miss** this has
    already happened. On a **hit** nothing was parsed, and without this the
    user who was served a cached object could not then refer to it: their next
    ``agg.NAME`` or ``sev agg.NAME`` would fail on a name their own base never
    saw, and their ``.agg`` download would omit it. So a hit registers too, and
    the two paths leave the same base behind.

    Notes
    -----
    The bare-name route registers nothing: the entry was already there, and
    filing it again would re-mark a library entry as this session's, which is
    exactly the flag the cache rule reads. ``expr`` is skipped for the reason
    the library skips it, being an answer rather than a declaration.
    """
    if preview is None or preview.route != "program":
        return
    for statement in preview.statements:
        if statement.kind == "expr":
            continue
        uw.add_recipe(statement.kind, statement.name, statement.spec,
                      statement.program)


def _missing_entry_detail(exc: RecipeNotFound) -> dict:
    """The 422 body for a name the caller's own recipe base does not hold.

    Structured rather than a bare sentence, because the app can act on it. The
    common cause is not a typo: it is an expired session. A fork is dropped when
    it goes idle past the TTL, when the registry evicts it under pressure, or
    when the server restarts, and after that a user's reference to something
    they built themselves names nothing. Their program is still in the SPA's
    history, so naming the ``kind`` and ``name`` lets the error pane offer the
    rebuild rather than describing it.

    Returns
    -------
    dict
        ``error``, ``kind``, ``name`` and ``message``. The ``message`` is the
        library's own sentence, kept verbatim: it already explains the case
        where the name parsed and then went away.
    """
    return {
        "error": "recipe_not_found",
        "kind": getattr(exc, "kind", None),
        "name": getattr(exc, "name", "") or "",
        "message": getattr(exc, "message", None) or str(exc),
    }


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
    units, and a ``PnL`` carries none either, so it is asked about its engine.
    Both recursions are gated on the class name rather than on iterability: an
    ``Aggregate`` is iterable too, and walking one here would be a loop with no
    base case.

    Notes
    -----
    **The P&L case was wrong until a113**, and silently: a ``PnL`` has no
    ``occ_reins`` attribute at all, so a P&L over a reinsured engine reported
    ``has_reins`` False on every build response since the P&L work landed. Two
    things follow it. The summary strip's flag, and the choice of moments in
    :func:`_summary_fields`, which prefers the realized pair net of a cession
    because those are the ones describing what is on screen, and was handing a
    reinsured P&L the analytic pair.

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
    if type(obj).__name__ == "PnL":
        return _has_reinsurance(getattr(obj, "engine", None))
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
    ``mean``, ``cv``, ``validation``, plus the program's own ``note`` and
    ``tags``.

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

    # The program's own ``note{}`` and ``tags{}``, so the status strip can say
    # them on every build without a second request. They ride with the moments
    # rather than on fields of their own because all three call sites (cache
    # miss, cache hit, the manifest a derivation returns) want them, and one of
    # them would otherwise forget to ask.
    #
    # **The note is verbatim, and it is not only the author's prose.** A grid
    # audit merges its own verdict into the same field
    # (``aggregate._program._SHARPEN_NOTE``, the ``sharpen: `` chunk
    # :mod:`aggregate_api.capability` tests for), so after a Sharpen the note
    # carries the library's sentence beside the author's. That is what the note
    # says, and editing it down is not the app's call.
    note = getattr(obj, "note", None)
    note = str(note).strip() if note is not None else ""
    tags = [str(t) for t in (getattr(obj, "tags", ()) or ())]

    # An object built from a pair carries no scalar moments of its own (its
    # ``bs`` is genuinely two numbers, and ``actual_m`` describes a single
    # ``Aggregate``), but its TOTAL does: the joint's total distribution is
    # the pair's headline reading, and ``stats_df`` publishes it in the
    # ``total`` column of the ``(component, measure)`` frame (library
    # ``[Bivariate-Punchup]``, a330). Filled only when the scalar path found
    # nothing, so every other kind is untouched. The desktop strip is also
    # untouched: its pair branch renders from ``components`` and never reads
    # these scalars. The consumer is the lite page's tiles, empty for a pair
    # through a170.
    mean = _num(*m)
    cv = _num(*cv)
    if mean is None and cv is None:
        mean = _total_stat(obj, "mean")
        cv = _total_stat(obj, "cv")

    return {
        "bs": _num("bs"),
        "log2": log2,
        "mean": mean,
        "cv": cv,
        "validation": validation,
        "has_reins": reinsured,
        "value_type": str(value_type) if value_type is not None else None,
        "note": note or None,
        "tags": tags,
        "components": _component_fields(obj),
    }


def _total_stat(obj: Any, stat: str) -> float | None:
    """One aggregate statistic of a pair's total, off ``stats_df['total']``.

    Parameters
    ----------
    obj : Any
        The built object; only one carrying a ``stats_df`` with a ``total``
        column and the ``(component, measure)`` row index answers.
    stat : str
        ``'mean'`` / ``'cv'`` / ``'skew'``, a row of the ``agg`` block.

    Returns
    -------
    float or None
        The statistic, or ``None`` wherever the frame, the column, or the row
        is absent or non-finite: this is a fallback, never a requirement.
    """
    stats = getattr(obj, "stats_df", None)
    if stats is None or "total" not in getattr(stats, "columns", ()):
        return None
    try:
        value = float(stats.loc[("agg", stat), "total"])
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


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

    **The row key is ``("agg", stat)``, and it moved at library a330.** Until
    then a bivariate's ``stats_df`` was indexed by basis, so this read
    ``("theoretical", stat)`` and fell back to ``("empirical", stat)``.
    ``[Bivariate-Punchup]`` gave the pair the Portfolio layout: the index is now
    ``(component, measure)`` over ``meta`` / ``freq`` / ``sev`` / ``agg``
    blocks, and the columns are the unit names plus ``independent`` and
    ``total``. Neither old key exists, so both moments resolved to ``None``
    again and the strip went back to printing ``mean (?, ?) . CV (?, ?)``,
    which is the a57 bug arriving by a new route.

    ``agg`` is the analytic aggregate moment, which is what ``theoretical``
    meant, so the preference this docstring used to record is kept rather than
    dropped. There is no second basis to fall back to any more, and a key that
    is not there already resolves to ``None`` through the ``except`` below.
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
        try:
            value = float(stats.loc[("agg", stat), column])
        except (KeyError, IndexError, TypeError, ValueError):
            return None
        return value if math.isfinite(value) else None

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
    not a regression.

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
        One line, or ``''`` for a program that holds no statement.

    Notes
    -----
    **Comments go through the library, not through a regex here.** Until
    1.0.0a138 this was one ``re.sub`` over the raw text, on a documented
    assumption that had stopped being true: "``#`` comments are not accepted in
    the input box, so nothing gets swallowed". They are, and it did. Flattening
    first puts a leading ``# a note`` in front of the program, so the whole
    statement became one comment and the library preprocessed it to nothing,
    which the reader saw as an unexplained parse failure. ``//`` failed the same
    way. A trailing comment survived, but only because ``build()`` preprocesses
    downstream; the rule was never working here.

    :meth:`aggregate.parser.UnderwritingLexer.preprocess` is where the comment
    rules live: full-line and inline, ``#`` and ``//``, with ``note{}`` /
    ``tags{}`` / ``hints{}`` bodies lifted out first so a ``#`` in prose stays
    prose. Reimplementing that here would be a second copy of a rule the library
    owns, and it would drift. It is public and already imported by
    ``routes.decl`` for the same reason, so the sanctioned import surface does
    not move.

    The statements come back as a list, and they are joined with a space rather
    than answered as a list, because merging is what this function has always
    done. The trailing ``re.sub`` stays for the same reason: it is what makes
    the output **byte identical** to the old one on every program without a
    comment, which is not tidiness but the cache key. Checked against nine, from
    a multi-line ``port`` through the bivariate's nested ``dbvsev`` matrices to
    a ``note{}`` body holding a ``#``.
    """
    text = decl.replace("\\", " ")
    statements = UnderwritingLexer.preprocess(text)
    return re.sub(r"\s+", " ", " ".join(statements)).strip()


# ----------------------------------------------------------------------
# POST /v1/objects
# ----------------------------------------------------------------------

# Discriminated on ``kind``, which both members already declare as a ``Literal``:
# the six object kinds on one side and ``'value'`` on the other. A union rather
# than six null fields on ``BuildResponse``, because almost nothing a build
# manifest carries applies to a number. See :class:`models.ValueResponse`.
_BuildOrValue = Annotated[
    models.BuildResponse | models.ValueResponse,
    Field(discriminator="kind"),
]


@router.post("/objects", response_model=_BuildOrValue)
def post_object(
    req: models.BuildRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
    uw: Any = Depends(_get_session_uw),
    sessions: SessionRegistry = Depends(_get_sessions),
) -> dict:
    """Build (or retrieve from cache) an aggregate object.

    Returns the slim manifest; the SPA fetches heavier panes on
    demand via the per-button GETs. Same (decl, log2, bs) is
    idempotent -- the second call returns ``cached=True`` with
    the same ``id``.

    Notes
    -----
    **The program is previewed before it is keyed.** What a program means
    depends on what its references resolve to, and that is a fact about the
    caller's own recipe base rather than about the text, so the text alone
    cannot decide which cache slot the answer belongs in. The order is
    therefore preview, key, look up, build; :func:`_cache_key` holds the rule
    and the reasoning.

    **What it costs.** A cache hit now pays a parse it did not pay before, tens
    of milliseconds against builds measured in hundreds, and a miss parses
    twice, once here and once inside the build. Both are stated rather than
    discovered: the alternative is keying on text that no longer determines the
    object, which is not a slower answer but a wrong one.
    """
    # Resolve effective knobs: a missing log2 / bs from the request
    # means "use library defaults" -- which the underlying build()
    # signals via 0. We hash the *requested* values (0 included)
    # so two callers asking for "defaults" share the same cache slot.
    eff_log2 = req.log2 if req.log2 is not None else 0
    eff_bs = req.bs if req.bs is not None else 0.0
    ip = _client_ip(request)
    sid = session_id_of(request)
    t0 = time.monotonic()

    req.decl = collapse_program(req.decl)

    # A program that holds no statement, which since a138 is a real arrival
    # rather than an impossible one: the collapse strips comments now, so a box
    # holding nothing but ``# a note`` reaches here empty. Answered in its own
    # words. The library's answer is "build() expects a single output, got 0;
    # use build_many() for batched programs", which is about ``build_many`` and
    # is addressed to a reader who wrote a comment.
    #
    # Screened here rather than in the SPA because the comment rules are the
    # library's, and a client that could tell a comments-only program from an
    # empty one would be holding a copy of them.
    if not req.decl:
        elapsed = int((time.monotonic() - t0) * 1000)
        message = "this program holds no statement: it is empty, or all comments"
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="build_error", error_msg=message,
            elapsed_ms=elapsed, session_id=sid,
        )
        raise HTTPException(status_code=422, detail=message)

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
            session_id=sid,
        )
        raise HTTPException(
            status_code=422,
            detail=f"log2 {effective_log2} exceeds AGGAPI_LOG2_CAP={settings.log2_cap}",
        )

    canonical = canonicalize_decl(req.decl)
    preview_t0 = time.monotonic()
    try:
        preview = _preview(uw, req.decl)
    except RecipeNotFound as exc:
        detail = _missing_entry_detail(exc)
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="build_error", error_msg=detail["message"],
            elapsed_ms=elapsed, session_id=sid,
        )
        raise HTTPException(status_code=422, detail=detail) from None
    status_state.record_preview_ms((time.monotonic() - preview_t0) * 1000)
    oid, key_scope, key_reason = _cache_key(
        preview, sid, canonical, eff_log2, eff_bs)
    status_state.record_key_scope(key_scope, key_reason)

    # Cache hit -- return slim manifest immediately.
    cached_entry = cache.get(oid)
    if cached_entry is not None:
        # File the program in the caller's own base even though nothing was
        # built: see :func:`_register` for why a hit has to register too.
        _register(uw, preview)
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="ok", object_id=oid, kind=cached_entry.kind,
            elapsed_ms=elapsed, session_id=sid, key_scope=key_scope,
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
    with status_state.build_slot(_build_semaphore):
        future = _build_executor.submit(_run_build, uw, req.decl, eff_log2, eff_bs)
        try:
            obj, build_notes = future.result(timeout=settings.build_timeout_s)
        except FuturesTimeout:
            status_state.record_build_timeout()
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="timeout",
                error_msg=f"build exceeded {settings.build_timeout_s}s",
                elapsed_ms=elapsed,
                session_id=sid, key_scope=key_scope,
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
                    session_id=sid, key_scope=key_scope,
                )
                raise HTTPException(status_code=422, detail=report.to_dict())
            # Library-side validation error (e.g. invalid spec).
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=str(exc),
                elapsed_ms=elapsed,
                session_id=sid, key_scope=key_scope,
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
                session_id=sid, key_scope=key_scope,
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
                session_id=sid, key_scope=key_scope,
            )
            raise HTTPException(status_code=422, detail=str(orig))
        except RecipeNotFound as exc:
            # The same case the preview reports, reached the other way: a
            # deferred ``sev agg.NAME`` resolves at build time, not parse time,
            # so a referent that went away between the two lands here.
            detail = _missing_entry_detail(exc)
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=detail["message"],
                elapsed_ms=elapsed, session_id=sid, key_scope=key_scope,
            )
            raise HTTPException(status_code=422, detail=detail) from None
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
                session_id=sid, key_scope=key_scope,
            )
            raise HTTPException(status_code=422, detail=str(detail))
        except Exception as exc:
            elapsed = int((time.monotonic() - t0) * 1000)
            audit.record_build(
                ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
                status="build_error", error_msg=str(exc),
                elapsed_ms=elapsed,
                session_id=sid, key_scope=key_scope,
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

    # A program that means a number, which DecL has always allowed: the
    # top-level ``answer`` rule carries ``expr``, so ``(2+2)`` and ``2/3`` are
    # programs and ``build()`` answers each with a float. Through a137 the api
    # built them and then refused the result two lines below, reporting the
    # library's own answer as an unsupported kind.
    #
    # Nothing is cached and no recipe is registered: there is no object, so
    # there is no slot to fill and nothing a later route could fetch against an
    # id. The audit records it under its own status, so the operator's page does
    # not read arithmetic as object builds.
    #
    # ``isinstance`` against ``numbers.Real`` rather than a kind-name test:
    # ``(2+2)`` comes back a Python float and ``(exp(1))`` a ``numpy.float64``,
    # and asking what a thing *is* beats keeping a list of the names it answers
    # to. ``bool`` is excluded because it is a Real in Python and is not what
    # any DecL expression means.
    if isinstance(obj, numbers.Real) and not isinstance(obj, bool):
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="value", elapsed_ms=elapsed,
            session_id=sid, key_scope=key_scope,
        )
        return {
            "kind": "value",
            "value": float(obj),
            "decl": req.decl,
            "elapsed_ms": elapsed,
        }

    if kind not in SUPPORTED_KINDS:
        elapsed = int((time.monotonic() - t0) * 1000)
        audit.record_build(
            ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
            status="build_error",
            error_msg=f"unsupported kind {kind!r}",
            elapsed_ms=elapsed,
            session_id=sid, key_scope=key_scope,
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
    sessions.record_build(sid)
    if preview is None:
        # The previewer refused a program the builder then accepted, so a
        # shareable object took a private slot and a room pays a build each
        # instead of one between them. Kept verbatim because that is an upstream
        # ask against the library's ``preview`` and an ask needs the program.
        # The previewed-None-and-then-failed case is an ordinary parse error and
        # is deliberately not kept: the audit log already has it, with a better
        # message.
        status_state.record_unpreviewable_build(req.decl, sid, kind, elapsed)
    audit.record_build(
        ip=ip, decl=req.decl, log2=eff_log2, bs=eff_bs,
        status="ok", object_id=oid, kind=kind, elapsed_ms=elapsed,
        session_id=sid, key_scope=key_scope,
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
            "recipes (re-loadable)."
        ),
    ),
    cache: ObjectCache = Depends(_get_cache),
    uw: Any = Depends(_get_session_uw),
) -> Response:
    """Download every DecL program built this session as one ``.agg`` file.

    Two forms, kept deliberately distinct. ``raw`` walks the api object cache and
    emits each built object's program **verbatim** -- your exact source, compact
    syntax and all (a range ``[10:100:10]`` stays ``[10:100:10]``). ``agg`` reads
    the shared underwriter's recipe base, keeps the entries it
    flagged ``source='session'`` (every in-session ``build(...)``), renders each
    through ``decl_writer.spec_to_decl`` (verbatim fallback) and then
    ``format_program`` for the spread / line-wrapped layout, in dependency order
    -- a **canonical, re-flowed, re-loadable** set (ranges expanded to
    ``[10 20 ... 100]``). Formatting ``raw`` too would collapse it into ``agg``,
    so it is intentionally left un-reflowed.

    Notes
    -----
    **Scope differs between the two forms, and that is not a wart.** ``agg``
    reads the caller's own recipe base, so it is exactly this session's
    programs. ``raw`` walks the object cache, which is process-wide and shared
    by design (that sharing is what lets a room on one hero example pay for one
    build), so on a busy deployment it returns programs other people typed. The
    canonical form is the one the menu offers, and the one to reach for.

    The session travels in the query string here rather than in a header,
    because this URL is opened by navigation and a navigation cannot carry one.
    A request with neither lands in the anonymous session, whose base holds
    whatever other headerless clients put there.
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
        # Read off the caller's own fork, which is the base their builds
        # registered into: the same base under ``--library`` since a109, and
        # theirs alone rather than the process's since a110.
        recipes = uw.recipes
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
    Those three clauses are the whole trailer since ``aggregate`` 1.0.0a301
    retired ``doc{{{...}}}``, which this route had always declined to serve.

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
    # A pair carries no ``q`` of its own, but its total does: the joint's
    # total distribution is the pair's aggregate law, so its quantile function
    # is the honest ``aggregate``-basis answer (it is what the lite tiles read
    # P99 from). The occurrence basis stays a 400, since there is no single
    # per-claim law behind a pair.
    if not callable(q) and basis == "aggregate":
        total = getattr(entry.obj, "total", None)
        q = getattr(total, "q", None) if total is not None else None
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
    lee: bool | None,
    annotate: str | None,
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
    lee : bool or None
        Draw the quantile curve beside each tower of the structure chart.
    annotate : str or None
        Comma-separated annotation fields for the structure chart's layer
        labels. The empty string is a real request, for bare rectangles, and
        is not the same as the parameter being absent.
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

    ``annotate`` is **not** validated here. The emitter owns the vocabulary and
    raises ``ValueError`` naming the whole of it for a word it does not know,
    which the route already turns into a 422; a copy of the list here would be
    a second place to keep it, and the first one to go stale.
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
    if lee is not None:
        options["lee"] = lee
    if annotate is not None:
        # ``annotate=`` is bare rectangles, a real request and not an absent
        # one, so the split is guarded rather than the string being falsy
        # checked: `"".split(",")` is `['']`, one field named nothing.
        options["annotate"] = tuple(
            field.strip() for field in annotate.split(",") if field.strip()
        )
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
    lee: bool | None = Query(
        None,
        description=(
            "Draw the quantile curve of the distribution each tower is read "
            "against beside it, sharing its loss axis, so every boundary "
            "reads off as a return period. Structure chart only, and it "
            "needs a built object: asked of one that has not been updated it "
            "is a 422 rather than a silently plainer chart."
        ),
    ),
    annotate: str | None = Query(
        None,
        description=(
            "Comma-separated annotation fields beside each layer, any subset "
            "of geometry, premium, el, lr, rol, lol, sd, pr_attach, "
            "pr_detach, reinstatements, cede, rendered in that order whatever "
            "order they are given. Empty for bare rectangles. A field whose "
            "source is absent is omitted, so one selection serves an "
            "un-updated object, a built one and a priced one. Structure "
            "chart only."
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

    ``window``, ``detail`` and ``encoding`` (``dev/plan-3d-plot.md`` section 3)
    are the grid knob, and only the knob: which grid a caller gets is the
    library's decision, taken before the reduction, and this route neither
    crops nor re-reduces what it is handed. Cropping downstream cannot recover
    resolution that was already averaged away, which is the whole argument for
    plumbing the parameters upstream instead of doing the work here: on one
    test surface the same quantile window applied to the fine lattice leaves
    232 cells, and applied to the emitted display grid leaves 8, starting in
    the wrong place.

    ``lee`` and ``annotate`` are the structure chart's, added at a154. They
    are content options in the sense the library's ``charts/__init__``
    docstring allows, which is the only kind this route carries: what the
    document *says*, never how it is drawn. Without them the Lee curves the
    emitter offers could not be asked for at all, and every structure document
    would arrive at the library's default label selection.

    They all go in the URL rather than a header because they change the bytes,
    so they belong in the thing the ETag answers for, and a URL that names its
    own resolution is shareable and shows up in a log.

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
    options = _chart_options(window, detail, encoding, lee, annotate, settings)
    key = (oid, name, window, detail, encoding, lee, annotate)
    hit = _chart_cache.get(key)
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
                    f"{', '.join(sorted(options))}: window, detail and "
                    "encoding apply to the grid charts, whose display "
                    "lattice is chosen at emission, and lee and annotate to "
                    "the structure chart"
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
        _chart_cache.store(key, etag, body)
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


# The ``pnl`` head of a P&L program, with the grammar's own boundary rule so
# ``pnlx`` is not mistaken for it. Mirrors the ``PNL`` terminal in ``decl.lark``.
_PNL_HEAD = re.compile(r"pnl(?![a-zA-Z0-9._:~\-])")

# Where the trailer starts, if there is one. The ``peel`` clause goes in front
# of it: see :func:`explode_program`.
_TRAILER_HEAD = re.compile(r"(?:note|tags|hints)\{")


def explode_program(program: str, peel: str | None = "bottom-up") -> str:
    """The ``xpnl`` that walks a consolidated P&L layer by layer.

    ``pnl`` and ``xpnl`` share an identical body in the grammar, so the whole
    transform is the leading keyword plus the optional ``peel`` clause. The text
    is a rewrite of the program the object was built from, not a re-render of
    the object, so nothing about the P&L is recomputed here.

    Parameters
    ----------
    program : str
        Collapsed DecL for a ``pnl`` program, as :func:`collapse_program`
        leaves it.
    peel : str or None, default 'bottom-up'
        The walk direction, or ``None`` to write no ``peel`` clause. Omitted
        for an engine with no reinsurance, which has no layers to walk and
        which the library refuses to peel.

    Returns
    -------
    str
        Collapsed DecL for the exploded program.

    Raises
    ------
    ValueError
        If ``program`` does not lead with the ``pnl`` keyword, which includes
        the ``xpnl`` that is already exploded.

    Notes
    -----
    **The clause goes before the trailer, and that is the whole difficulty.**
    The rule is ``... expense_less peel_clause trailer`` (``decl.lark:133``),
    and a P&L inherits its engine's trailer: an engine carrying
    ``note{...} hints{...}`` wraps into a P&L carrying both after the expense
    clause, verified against ``pnl_program`` on 1.0.0a305. Sharpen and Hints
    write exactly those clauses, so appending at the end would be a parse error
    for any program that had been through either button.

    Taking the **earliest** of ``note{``, ``tags{`` and ``hints{`` is safe
    because a P&L carries at most one trailer. The inline engine slot has no
    trailer of its own (``agg_source`` in the grammar), which is why
    ``pnl_program`` lifts the engine's onto the wrapper, and reading the first
    match also does the right thing for a note whose text happens to mention
    another clause.
    """
    program = program.strip()
    if not _PNL_HEAD.match(program):
        raise ValueError(
            "an explode rewrites a 'pnl' program, and this one does not "
            "start with the pnl keyword")
    program = "x" + program
    if peel is None:
        return program
    clause = f"peel {peel}"
    trailer = _TRAILER_HEAD.search(program)
    if trailer is None:
        return f"{program} {clause}"
    head = program[:trailer.start()].rstrip()
    return f"{head} {clause} {program[trailer.start():]}"


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
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    entry: CacheEntry = Depends(_locked_entry),
    uw: Any = Depends(_get_session_uw),
) -> dict:
    """Audit the grid, move to a better one, and say so in DecL.

    ``update`` chooses a grid from the analytic moments before any FFT runs;
    this audits that choice afterwards and takes the best cell that does not
    cost more. The outcome is pinned onto the object's own ``program``, ``note``
    and ``hints`` by the library, so ``build(program)`` reproduces the sharpened
    object and the three records cannot disagree.

    Notes
    -----
    **The probe runs on a copy, and the original entry is left alone.**
    ``sharpen`` moves its object in place, and until a111 it moved the cached
    one: the entry was re-filed under the id its new ``sharpen_program`` hashes
    to and the old id was deleted. On a personal instance that is invisible,
    because the only viewer is the one who pressed the button. On a shared one
    it breaks everybody else looking at that object: their grid changes
    underneath them and the id they hold stops resolving. The object cache is
    deliberately shared, so that a room on one hero example pays for one build,
    which is what makes an in-place sharpen everybody's business.

    So the probe takes ``copy.deepcopy`` of the object first, and the sharpened
    copy is filed as a **new** entry under the key of its own program while the
    original entry stays exactly as it was. The response carries the new id,
    which the SPA already follows.

    **The copy is affordable, measured rather than assumed.** 10.5 ms for a
    log2 16 aggregate and 31.4 ms for a three-unit portfolio, against rebuilds
    of 73.5 and 453 ms for the same two. Rebuilding instead would also throw
    away the probe, which is the expensive part and has already run.

    **The new id is the one an ordinary build would produce**, so rebuilding the
    derived program from the editor is a cache hit rather than a second probe.

    **The api's own cap reaches the probe.** ``sharpen`` defaults to
    ``log2_cap=20`` and ``AGGAPI_LOG2_CAP`` defaults to 18, so an unattended
    probe could land on a grid the build route would then refuse, leaving the
    user with a derived program the app cannot honor.
    """
    if not hasattr(entry.obj, "sharpen"):
        raise HTTPException(
            status_code=400,
            detail="sharpening applies to an Aggregate or a Portfolio")
    if not can_sharpen(entry.obj):
        raise HTTPException(
            status_code=400,
            detail=("this program already carries a sharpen verdict; a second "
                    "audit of a confirmed grid is a slow no-op"))

    # The copy is taken under the entry lock this route already holds, so
    # nothing can be mid-write in the object being copied.
    obj = copy.deepcopy(entry.obj)

    # Same guards as a build, because a probe is several builds: it re-updates
    # the object across a line search of neighboring cells. Counted the same way
    # too, so the queue depth GET /v1/status reports is the real one: a probe
    # holding the slot blocks a build exactly as another build would.
    with status_state.build_slot(_build_semaphore):
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
    #
    # Through the same rule as a build, for the same reason: the sharpened text
    # carries whatever references the original had, so if a rebuild of it would
    # be keyed privately then this entry has to be filed privately too, or the
    # rebuild misses the slot this just wrote.
    # Not counted toward the key-scope panel, deliberately. That panel measures
    # how often a *submitted program* shares, and a derived id re-keyed here
    # would double-count the program the reader is about to submit anyway.
    new_oid, _, _ = _cache_key(_preview(uw, program), session_id_of(request),
                            canonicalize_decl(program), 0, 0.0)
    # A new entry, with its own lock. The sharpened object is a different object
    # from the one still serving under ``oid``, so sharing a lock between them
    # would serialize two unrelated readers for nothing.
    new_entry = CacheEntry(
        obj=obj,
        decl=program,
        log2=0,
        bs=0.0,
        kind=entry.kind,
        name=getattr(obj, "name", entry.name),
        created_at=datetime.now(timezone.utc),
        # The build's warnings travel with the copy, because they describe the
        # object rather than the request: this one was built by that build.
        notes=list(entry.notes),
    )
    cache.put(new_oid, new_entry)
    return {
        "program": spread(program),
        "description": getattr(obj, "sharpen_description", None) or None,
        **_manifest(new_oid, new_entry),
    }


@router.post("/objects/{oid}/hints", response_model=models.DerivedResponse)
def post_hints(
    oid: str,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
    entry: CacheEntry = Depends(_locked_entry),
    uw: Any = Depends(_get_session_uw),
    sessions: SessionRegistry = Depends(_get_sessions),
) -> dict:
    """Pin this object's realized grid into its own ``hints{}`` clause.

    The declaration comes back carrying ``log2``, ``bs`` and ``normalize`` as the
    object actually computed them, merged into whatever ``hints{}`` it already
    had rather than replacing the clause, so a declared ``padding`` survives and
    only the grid moves. ``aggregate._program.with_hints``, upstream since
    ``aggregate`` 1.0.0a291.

    Notes
    -----
    **Why this earns a button next to Sharpen.** A ``sev agg.NAME`` reference
    requires the referenced declaration to state ``log2`` and ``bs``, because the
    reference stands for the distribution that declaration *outputs* and so the
    declaration has to say at what resolution, or the severity moves with the
    ambient defaults instead of with the model. The library's resolver refuses an
    unpinned target and its error names this very method. So this is the step
    that turns a candidate inner into one an outer may reference: get it right
    interactively, press this, build the text it hands back.

    **No request body**, unlike ``pnl``. ``with_hints(**extra)`` accepts further
    hint keys, but the app has no opinion to offer about ``padding`` or
    ``normalize``, and a form for them would be the app holding a view about the
    library's settings. Everything it needs comes off the object.

    **No cap guard**, unlike ``sharpen``. The probe can land on a grid the build
    route would then refuse, which is why ``post_sharpen`` clamps to
    ``AGGAPI_LOG2_CAP``. This one writes down the grid the object **already built
    on**, and it only exists because the build route let that grid through, so
    the pinned ``log2`` is at or under the cap by construction.

    **Nothing is mutated and nothing is re-filed.** Unlike sharpening, this
    reads the object and writes text; the derived program then goes through the
    ordinary build path, which is :func:`post_object` called directly rather
    than reimplemented, so the log2 cap, the semaphore, the wall-clock timeout,
    the audit row and the whole parse-error surface all apply unchanged.

    ``description`` is left empty on purpose. Sharpen fills it because its
    verdict is a fact about a probe that the reader cannot see; here the result
    *is* the text, and the ``hints{}`` clause is sitting in the editor.
    """
    obj = entry.obj
    if not hasattr(obj, "with_hints"):
        raise HTTPException(
            status_code=400,
            detail="pinning a grid applies to an Aggregate or a Portfolio")
    try:
        program = obj.with_hints()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    program = collapse_program(program)
    built = post_object(models.BuildRequest(decl=program), request,
                        settings, cache, audit, uw, sessions)
    return {"program": spread(program), "description": None, **built}


@router.post("/objects/{oid}/pnl", response_model=models.DerivedResponse)
def post_pnl(
    oid: str,
    req: models.PnlProgramRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
    entry: CacheEntry = Depends(_locked_entry),
    uw: Any = Depends(_get_session_uw),
    sessions: SessionRegistry = Depends(_get_sessions),
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

    **The cover is priced too**, since a114. The three combined ratios engage
    the library's technical premium ladder (``aggregate`` 1.0.0a306): the net
    book and each cession are priced separately and added, then grossed up once
    for expenses, and each ceded premium is written into the program as a
    ``deposit``. That is what silences the ``ZeroPremiumCessionWarning`` a bare
    cession raises, and it is the difference between the button writing a book
    with reasonable numbers in it and one whose reinsurance is free.

    Two request fields route rather than pass through, since a183.
    ``form='xpnl'`` runs the wrapped program through :func:`explode_program`,
    so one press answers with the book broken out layer by layer; it refuses a
    portfolio engine with the same sentence :func:`post_explode` uses.
    ``premium_style='rate'`` asks for each priced layer's premium as a ``rate``
    of the stated gross premium and is refused with a 400 until the installed
    library's ``pnl_program`` accepts the keyword.

    Notes
    -----
    **A portfolio engine takes the old path, and that is the library's scope
    rather than this route's timidity.** The ladder prices the cessions of a
    single aggregate engine and refuses a portfolio by name, so sending the
    app's default ratios to one would turn every portfolio press into an error
    pane. The ratios are dropped for a portfolio **only when the caller did not
    ask for them**: an explicit ``net_combined_ratio`` in the body reaches the
    library and is refused there, with a message naming the reason, because
    silently ignoring what a caller asked for is worse than refusing it. The
    consequence worth knowing is that a portfolio P&L is still sized off
    ``loss_ratio`` while an aggregate one is sized off the ladder.

    **A layer already carrying a ``rate`` clause is a 422**, from the library.
    A rate resolves against the P&L premium, and the premium is what the ladder
    is computing, so it cannot enter the sum at a known amount. The library's
    ruling is to refuse and name the layer rather than solve a circularity or
    break its own margin identity, and the message tells the reader to restate
    the layer as a deposit. Surfacing that beats writing a book whose numbers
    quietly do not add up.

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

    # The two gates on the request's own fields, before any work. The explode
    # refusal is `post_explode`'s sentence, so the two routes cannot disagree;
    # the rate refusal is the api being honest about the installed library,
    # whose `pnl_program` does not take `premium_style` until the upstream ask
    # ships (see `capability.PNL_PREMIUM_STYLE_SUPPORTED`).
    if req.form == "xpnl" and type(obj).__name__ == "Portfolio":
        raise HTTPException(
            status_code=400,
            detail=("the portfolio total hides its units, so there is nothing "
                    "to explode"))
    style: dict = {}
    if req.premium_style == "rate":
        if not PNL_PREMIUM_STYLE_SUPPORTED:
            raise HTTPException(
                status_code=400,
                detail=("premium_style='rate' needs an aggregate library whose "
                        "pnl_program accepts it; this install's does not yet"))
        style = {"premium_style": "rate"}

    ladder = {"net_combined_ratio": req.net_combined_ratio,
              "occ_combined_ratio": req.occ_combined_ratio,
              "agg_combined_ratio": req.agg_combined_ratio}
    if (type(obj).__name__ == "Portfolio"
            and not req.model_fields_set & set(ladder)):
        ladder = {}

    try:
        program = obj.pnl_program(loss_ratio=req.loss_ratio,
                                  expense_ratio=req.expense_ratio,
                                  **ladder, **style)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    program = collapse_program(program)
    if req.form == "xpnl":
        # The same transform press two applies, run here so one press answers
        # "the exploded P&L of what is in the box". The peel rule is
        # `post_explode`'s: walk the layers when the engine has reinsurance,
        # write no clause otherwise.
        try:
            program = explode_program(
                program,
                peel="bottom-up" if _has_reinsurance(obj) else None)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    built = post_object(models.BuildRequest(decl=program), request,
                        settings, cache, audit, uw, sessions)
    return {"program": spread(program), "description": None, **built}


@router.post("/objects/{oid}/explode", response_model=models.DerivedResponse)
def post_explode(
    oid: str,
    request: Request,
    settings: Settings = Depends(get_settings),
    cache: ObjectCache = Depends(_get_cache),
    audit: AuditLog = Depends(_get_audit),
    entry: CacheEntry = Depends(_locked_entry),
    uw: Any = Depends(_get_session_uw),
    sessions: SessionRegistry = Depends(_get_sessions),
) -> dict:
    """Break this P&L out layer by layer: the ``xpnl`` of the same program.

    Press two of the P&L button's two step story. Press one wraps an object in a
    P&L and shows the consolidated total; this swaps ``pnl`` for ``xpnl`` and
    adds ``peel bottom-up``, so the same book comes back as the walk up through
    its reinsurance layers, lowest attaching first.

    **No request body.** There is one thing to do here and no convention to
    state, which is the ``hints`` shape rather than the ``pnl`` one.

    Notes
    -----
    **A route rather than a text edit in the browser.** The transform needs a
    rebuild either way, so there is no round trip to save. Here it sits beside
    the grammar knowledge the other derivations already keep server side, it is
    covered by ``pytest``, and both gates below are read off the live object
    instead of guessed from the text.

    **The two gates.** A portfolio engine is refused outright: ``xpnl`` over a
    portfolio raises ``NotImplementedError`` upstream ("the portfolio total
    hides its units, so there is nothing to explode"), and refusing here as a
    400 lets the button go dark rather than making the press produce an error
    pane. An engine with no reinsurance still explodes, and simply writes no
    ``peel`` clause: that is the correct ``xpnl``, one group per step with a
    single step, where a peel clause would be refused for having no layers to
    walk.

    **The reinsurance gate looks through** ``PnL.engine``. It reads the engine
    rather than the P&L because the cession lives on the wrapped object, which
    is the same reason :func:`_has_reinsurance` learned to look through a P&L.

    **Nothing is mutated.** The exploded text goes through the ordinary build
    path, :func:`post_object` called directly rather than reimplemented, so the
    log2 cap, the semaphore, the wall-clock timeout, the audit row and the whole
    parse-error surface apply unchanged.

    ``description`` is left empty, as for ``pnl`` and ``hints``: the result is
    the text, and it is sitting in the editor.
    """
    obj = entry.obj
    if entry.kind != "pnl":
        raise HTTPException(
            status_code=400,
            detail="an explode applies to a P&L")

    engine = getattr(obj, "engine", None)
    if type(engine).__name__ == "Portfolio":
        raise HTTPException(
            status_code=400,
            detail=("the portfolio total hides its units, so there is nothing "
                    "to explode"))

    try:
        program = explode_program(
            collapse_program(entry.decl),
            peel="bottom-up" if _has_reinsurance(engine) else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    built = post_object(models.BuildRequest(decl=program), request,
                        settings, cache, audit, uw, sessions)
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
    uw: Any = Depends(_get_session_uw),
    sessions: SessionRegistry = Depends(_get_sessions),
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
                        settings, cache, audit, uw, sessions)
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

def _resolve_risk(obj: Any, text: str, settings: Settings, uw):
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
    uw : aggregate.underwriter.Underwriter
        The caller's own base. A fragment is a declaration and registers itself,
        so building it in the process base would file a user's ad-hoc line where
        every other user's programs resolve names, which is the collision this
        whole phase removes.

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
        built = uw(program)
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
    uw: Any = Depends(_get_session_uw),
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
        targets = dict(_resolve_risk(entry.obj, text, settings, uw)
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

    That determinism is also what lets ``_exhibit_cache`` answer a conditional
    GET without rebuilding. Through a134 this route built the exhibit,
    serialized it, computed the hash, compared ``If-None-Match`` and on a match
    discarded all of it, which cost 210 ms on a three unit portfolio's
    ``tail`` to reply "nothing changed". Availability is still screened first,
    so an unknown name is a 404 before any cache is consulted.
    """
    available = dict(agg_exhibits.available_exhibits(entry.obj))
    if name not in available:
        raise HTTPException(
            status_code=404,
            detail=(f"no exhibit {name!r} for this object; "
                    f"available: {sorted(available)}"),
        )
    # ``MAX_ROWS`` is a constant, so it is not part of the key: were it ever to
    # become a query parameter it would have to join, since it changes the
    # bytes.
    key = (oid, name, perspective)
    hit = _exhibit_cache.get(key)
    if hit is not None:
        etag, body = hit
    else:
        try:
            # The same row cap the api's own documents take, so a reader cannot
            # meet two different truncation points depending on which route a
            # leaf happens to use. The library's own default is 200;
            # ``tables.MAX_ROWS`` is 500 and is the number this service has been
            # serving all along.
            exhibit = agg_exhibits.build_exhibit(entry.obj, name, perspective,
                                                 max_rows=MAX_ROWS)
        except (NotImplementedError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        body = json.dumps(
            exhibit.to_payload(), sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False,
        ).encode("utf-8")
        etag = f'"{exhibit.hash}"'
        _exhibit_cache.store(key, etag, body)
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
                                   basis=req.basis,
                                   expense_ratio=req.expense_ratio)
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
                               basis=req.basis,
                               expense_ratio=req.expense_ratio)
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
                                      basis=req.basis,
                                      expense_ratio=req.expense_ratio)
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
                              p=req.p, a=req.a,
                              expense_ratio=req.expense_ratio)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/objects/{oid}/ruin", response_model=models.RuinResponse)
def post_ruin(
    oid: str,
    req: models.RuinRequest,
    entry: CacheEntry = Depends(_locked_entry),
) -> dict:
    """The Pr Ruin pane: sample surplus paths and the probability of ruin.

    One POST answers with both halves the pane draws, the two-panel ``ruin``
    chart document and the ``ruin`` exhibit envelopes, because both move
    together under the debounced form and neither can travel the generic
    GETs: the chart needs options the chart route does not carry, and the
    exhibit registers on the ``RuinResult`` the request builds rather than
    on the cached object. A POST also never meets the chart cache, so the
    Sample action (``sample: true``) re-rolls honestly instead of replaying
    the first draw from under a seedless cache key.

    See :func:`aggregate_api.pricing.run_ruin`, and ``dev/plan-pk-tab.md``.
    """
    try:
        return run_ruin(entry.obj, p=req.p, a=req.a, coc=req.coc, lr=req.lr,
                        premium=req.premium, ruin_p=req.ruin_p, u=req.u,
                        seed=req.seed, sample=req.sample, n_plot=req.n_plot,
                        detail=req.detail)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
