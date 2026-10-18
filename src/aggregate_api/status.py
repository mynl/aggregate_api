"""Process-lifetime counters and buffers behind ``GET /v1/status``.

The route lives in ``routes/status.py``; this module is the state it reports and
the arithmetic it needs. Split so that the state has no opinion about HTTP and
imports nothing from ``routes``, which is what lets ``routes/objects.py``
increment counters without an import cycle.

The invariant, stated once
--------------------------

**The status subsystem persists nothing and holds nothing unbounded.** Every
number it reports is either computed at request time, or a process-lifetime
counter, or an entry in a fixed-size ring buffer. Restarting the service clears
all of it, by construction rather than by a cleanup step. That is the author's
ruling of 2026-08-18 ("do not let it grow too large, and reset it on each
reboot") held as an invariant rather than as a set of limits, because an
invariant survives the next panel and a set of limits does not.

Concretely: counters are plain integers, so they start at zero when the process
starts and every reading of them is labeled "since ``<process start>``" with the
uptime beside it, so a small number after a restart is never read as a quiet
day. Text lives in :class:`collections.deque` with ``maxlen`` set, so the cap is
structural and cannot be forgotten at a call site. Everything else, the build
statistics and the cache and session rows, is a query against something already
bounded and is not retained here at all.

The budget is a few tens of kilobytes: five hundred float samples, twenty
refusal records, and a few dozen integers. Until 1.14.0 it also held fifty
programs the previewer refused and the builder accepted; that path no longer
exists, because a program the preview refuses is answered 422 and never built.
A future panel that cannot fit the budget is a query and not a buffer.

**This does not touch the audit log.** That is SQLite on disk and survives
restarts, which is the point of an audit log. Section 8 question 4 of
``dev/done/plan-site-status-page.md`` stays open.

Thread safety
-------------

One lock over the whole module. Every counter is incremented from a request
thread and read from another, and the alternative to a lock is a set of numbers
that are individually atomic and collectively inconsistent, which for a page
whose job is to be believed is worse than the nanoseconds. The critical sections
are integer adds and deque appends.
"""

from __future__ import annotations

import os
import re
import threading
import time
from collections import Counter, deque
from datetime import datetime, timezone

#: How much of a program the page shows, in the cache table's rows. Those rows
#: are read from the cache at request time, so nothing here retains them.
PROGRAM_CHARS = 2000

#: How many gate refusals to keep. Address and timestamp only, no bodies.
REFUSAL_BUFFER = 20

#: The shape ``web/src/session.js`` mints: ``<ISO timestamp>-<uuid4>``. Used
#: only to split a display id, so anything else falls through to a plain cut.
_MINTED_ID = re.compile(r"\A(\d{4}-\d{2}-\d{2}T[\d:.]+Z)-(.+)\Z")

#: How many preview durations to retain for the percentile. A lifetime sum and
#: count give the mean; a percentile needs samples, and this many is a recent
#: window rather than a history, which is the honest thing to report anyway.
PREVIEW_SAMPLES = 512

#: Array counts behind :func:`estimated_bytes`. Deliberately round: see its
#: Notes for why this is arithmetic and not a measurement.
_ARRAYS_PER_AGGREGATE = 8
_ARRAYS_PER_UNIT = 4

_lock = threading.Lock()

# ----------------------------------------------------------------------
# Process facts
# ----------------------------------------------------------------------
_started_at: datetime | None = None
_started_monotonic: float | None = None
_library_load_ms: float | None = None

# ----------------------------------------------------------------------
# Counters. Plain integers, zero at process start, read under the lock.
# ----------------------------------------------------------------------
_counts: Counter = Counter()

# ----------------------------------------------------------------------
# Bounded buffers
# ----------------------------------------------------------------------
_preview_ms: deque = deque(maxlen=PREVIEW_SAMPLES)
_refusals: deque = deque(maxlen=REFUSAL_BUFFER)


def _now_iso() -> str:
    """ISO 8601 UTC timestamp, seconds precision. Matches the page's columns."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ----------------------------------------------------------------------
# Lifecycle
# ----------------------------------------------------------------------
def mark_started() -> None:
    """Record the process start time, once.

    Notes
    -----
    Called from :func:`aggregate_api.app.create_app`, which runs once in
    production and once per app in the tests. The guard makes it once per
    process in both: a test that builds ten apps still reports one uptime, and
    an uptime that resets under a test client would make every "since process
    start" label a lie in exactly the place they are checked.
    """
    global _started_at, _started_monotonic
    with _lock:
        if _started_at is None:
            _started_at = datetime.now(timezone.utc)
            _started_monotonic = time.monotonic()


def record_library_load(elapsed_ms: float) -> None:
    """Record what reading the recipe library cost at boot, in milliseconds."""
    global _library_load_ms
    with _lock:
        _library_load_ms = float(elapsed_ms)


def process_facts() -> dict:
    """Start time, uptime, PID, and the boot library load cost.

    Returns
    -------
    dict
        ``started_at`` is ``None`` before :func:`mark_started`, which cannot
        happen through a route (the app has to exist first) but can in a unit
        test importing this module alone.
    """
    with _lock:
        started_at = _started_at
        started_monotonic = _started_monotonic
        library_load_ms = _library_load_ms
    uptime = None
    if started_monotonic is not None:
        uptime = round(time.monotonic() - started_monotonic, 1)
    return {
        "pid": os.getpid(),
        "started_at": started_at.isoformat(timespec="seconds") if started_at else None,
        "uptime_s": uptime,
        "library_load_ms": (round(library_load_ms, 1)
                            if library_load_ms is not None else None),
    }


# ----------------------------------------------------------------------
# Key scope, section 4.5 of the plan
# ----------------------------------------------------------------------
def record_key_scope(scope: str) -> None:
    """Count one keying decision from ``routes/objects.py::_cache_key``.

    Parameters
    ----------
    scope : {'library', 'own'}
        ``library`` when the program touched no declaration of the caller's,
        ``own`` when it did.

    Notes
    -----
    Since 1.14.0 the scope no longer changes the key, which hashes the parsed
    program either way, so this is a description of the traffic rather than a
    count of private slots: how much of it leans on readers' own building
    blocks. The ``preview_unavailable`` reason went with that change, because a
    program the preview refuses is now answered 422 and never keyed.
    """
    with _lock:
        _counts[f"key_{scope}"] += 1


def record_preview_ms(elapsed_ms: float) -> None:
    """Sample one ``Underwriter.preview`` call.

    Notes
    -----
    Worth watching because this parse sits on the cache **hit** path, where it
    did not before a110: ``post_object``'s docstring names it as the
    acknowledged cost of keying on what a program means rather than on how it
    is spelled. A hit that grows to build-like latency would make that trade
    look different.
    """
    with _lock:
        _counts["preview_calls"] += 1
        _counts["preview_total_us"] += int(elapsed_ms * 1000)
        _preview_ms.append(float(elapsed_ms))


def key_scope_state() -> dict:
    """The key-scope panel: library against own counts, and preview timing."""
    with _lock:
        library = _counts["key_library"]
        own = _counts["key_own"]
        calls = _counts["preview_calls"]
        total_us = _counts["preview_total_us"]
        samples = list(_preview_ms)
    keyed = library + own
    return {
        "library": library,
        "own": own,
        "own_rate": round(own / keyed, 4) if keyed else None,
        "preview_calls": calls,
        "preview_mean_ms": round(total_us / calls / 1000, 2) if calls else None,
        "preview_p95_ms": percentile(samples, 0.95),
        "preview_sample_size": len(samples),
    }


# ----------------------------------------------------------------------
# Builds
# ----------------------------------------------------------------------
class build_slot:  # noqa: N801 (a context manager used as a statement reads better lowercase)
    """Hold the build semaphore and count the wait, the run, and the queue.

    Parameters
    ----------
    semaphore : threading.Semaphore
        The single-slot build semaphore from ``routes/objects.py``. Passed in
        rather than imported so this module keeps knowing nothing about routes.

    Notes
    -----
    Written as a context manager so the two gauges cannot drift from each
    other: a ``waiting`` that is decremented on one path out and not another
    would climb forever and the page would report a queue that is not there.
    Entering counts a waiter, acquiring converts it to an in flight holder, and
    leaving releases both regardless of how the body exited.

    **Holding the slot is not the same as building.** Since 1.26.1 a holder
    re-checks the cache first, and one that finds the program already built
    (by the request it was queued behind) is answered from there. So whether a
    build starts is counted at the submit, by :func:`record_build_started`, and
    a holder served from the cache by :func:`record_build_coalesced`.
    """

    __slots__ = ("_semaphore",)

    def __init__(self, semaphore) -> None:
        self._semaphore = semaphore

    def __enter__(self):
        with _lock:
            _counts["build_waiting"] += 1
        self._semaphore.acquire()
        with _lock:
            _counts["build_waiting"] -= 1
            _counts["build_in_flight"] += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        with _lock:
            _counts["build_in_flight"] -= 1
        self._semaphore.release()
        return False


def record_build_started() -> None:
    """Count one build handed to the build worker.

    Notes
    -----
    Called just before each submit to the build executor, in ``post_object``
    and in the sharpen route, so ``started`` counts work the worker actually
    ran rather than requests that held the slot.
    """
    with _lock:
        _counts["builds_started"] += 1


def record_build_coalesced() -> None:
    """Count one request that waited for the slot and was served from the cache.

    Notes
    -----
    The request missed the cache on arrival because the same program was being
    built, waited behind that build, and found its object once it held the
    slot. Ten identical programs arriving together read as one started and
    nine coalesced.
    """
    with _lock:
        _counts["builds_coalesced"] += 1


def record_build_timeout() -> None:
    """Count one build abandoned at ``build_timeout_s``."""
    with _lock:
        _counts["build_timeouts"] += 1


def build_state() -> dict:
    """Live build state: in flight, queued, and the counts since start.

    Returns
    -------
    dict
        ``in_flight`` and ``waiting`` are gauges; ``started``, ``coalesced``
        and ``timeouts`` are process-lifetime counters.
    """
    with _lock:
        return {
            "in_flight": _counts["build_in_flight"],
            "waiting": _counts["build_waiting"],
            "started": _counts["builds_started"],
            "coalesced": _counts["builds_coalesced"],
            "timeouts": _counts["build_timeouts"],
        }


# ----------------------------------------------------------------------
# The chart-document cache
# ----------------------------------------------------------------------
def record_cache(channel: str, event: str) -> None:
    """Count one ``hit``, ``miss``, ``store`` or ``eviction`` on one cache.

    Parameters
    ----------
    channel : str
        Which cache is reporting, ``"chart"`` or ``"exhibit"``. It namespaces
        the counter keys, so the two revalidation caches are counted apart
        while sharing one implementation.
    event : str
        The event to count.

    Notes
    -----
    ``_counts`` is a ``Counter``, so a channel needs no registration here: a
    key that has never been written reads as zero.
    """
    with _lock:
        _counts[f"{channel}_{event}"] += 1


def cache_state(channel: str, entries: int, max_entries: int) -> dict:
    """One revalidation cache's panel. Size is passed in, counters come from here."""
    with _lock:
        hits = _counts[f"{channel}_hit"]
        misses = _counts[f"{channel}_miss"]
        evictions = _counts[f"{channel}_eviction"]
    looks = hits + misses
    return {
        "entries": entries,
        "max": max_entries,
        "hits": hits,
        "misses": misses,
        "hit_rate": round(hits / looks, 4) if looks else None,
        "evictions": evictions,
    }


# ----------------------------------------------------------------------
# Gate refusals
# ----------------------------------------------------------------------
def record_refusal(address: str, path: str) -> None:
    """Keep one refused status request: address, path and time, nothing else.

    Notes
    -----
    A refusal on a correctly configured box means something changed, which is
    why it is retained at all and why ``routes/status.py`` also logs it at
    WARNING. No body and no headers are kept: the useful fact is that an address
    outside the private list reached the app, and everything past that belongs
    to the web server's own log.
    """
    with _lock:
        _counts["gate_refusals"] += 1
        _refusals.append({"at": _now_iso(), "address": address, "path": path})


def gate_state() -> dict:
    """Refusal count and the recent refusals, newest first."""
    with _lock:
        return {
            "refusals": _counts["gate_refusals"],
            "recent": list(reversed(_refusals)),
        }


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def truncate(text: str, limit: int) -> tuple[str, bool]:
    """Cut ``text`` to ``limit`` characters, reporting whether it was cut.

    Returns
    -------
    (str, bool)
        The text and whether anything was dropped. The flag travels rather than
        an ellipsis in the string, so the page can mark the cut and a test can
        assert on the length without parsing prose out of the payload.
    """
    if text is None:
        return "", False
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def short_session_id(session_id: str | None) -> str | None:
    """Shorten a session id for display, keeping the useful half.

    Parameters
    ----------
    session_id : str or None
        A minted id (``<ISO timestamp>-<uuid4>``), :data:`sessions.ANONYMOUS`,
        or anything a client sent that passed the shape check.

    Returns
    -------
    str or None
        The timestamp in full, a middle dot, and eight characters of the uuid.
        Anything not matching that shape is cut to 24 characters. ``None`` in,
        ``None`` out.

    Notes
    -----
    **Applied server side, so the guarantee holds for the JSON and not only for
    the page.** A session id is a namespace and not a security boundary: anyone
    holding one gets that session's objects, which is exactly why no login is
    needed for it. A status page rendering them in full would turn a private
    page into a list of credentials the moment anyone shares a screenshot, and
    a payload carrying them in full would do the same for anyone who saved the
    JSON. Truncating in the page would leave the second hole open.

    Eight characters of a uuid4 is enough to line a row up with an audit row or
    a log line, and is not enough to impersonate. The timestamp travels whole
    because it is the part an operator actually reads.
    """
    if not session_id:
        return session_id
    match = _MINTED_ID.match(session_id)
    if match:
        return f"{match.group(1)}·{match.group(2)[:8]}…"
    if len(session_id) > 24:
        return f"{session_id[:24]}…"
    return session_id


def percentile(samples: list[float], q: float) -> float | None:
    """The ``q`` quantile of ``samples`` by nearest rank, or ``None`` if empty.

    Notes
    -----
    Nearest rank rather than an interpolated quantile, and no numpy. The input
    is at most :data:`PREVIEW_SAMPLES` floats on a page refreshed every ten
    seconds; the difference between the two definitions is smaller than the
    difference between two consecutive samples, and this one has no import.
    """
    if not samples:
        return None
    ordered = sorted(samples)
    index = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return round(ordered[index], 2)


def estimated_bytes(obj, log2: int) -> int | None:
    """An order-of-magnitude size for a built object, computed not measured.

    Parameters
    ----------
    obj : Aggregate or Portfolio or other
        The cached object.
    log2 : int
        The entry's log2, or 0 when the request asked for the library default.

    Returns
    -------
    int or None
        Estimated bytes, or ``None`` when the grid size cannot be established.

    Notes
    -----
    **Deliberately not measured.** ``sys.getsizeof`` reports the shell of a
    Python object and nothing it points at, so sizing an ``Aggregate`` honestly
    would mean walking into numpy arrays and pandas frames: slow, and wrong the
    moment a frame is shared between two entries. Worse, several of those frames
    are built lazily on first access, so a status page that touched them to
    measure them would *create* the memory it is reporting, on a timer.

    So the estimate is arithmetic on what is already known. The density arrays
    are ``2**log2`` float64, and the counts are round numbers standing for "the
    handful an aggregate carries" and "the few more each portfolio unit adds".
    The page labels the column estimated for exactly this reason.
    """
    grid = getattr(obj, "log2", 0) or log2
    if not grid or grid <= 0:
        return None
    cell = (2 ** int(grid)) * 8
    arrays = _ARRAYS_PER_AGGREGATE
    units = getattr(obj, "agg_list", None)
    if units is not None:
        try:
            arrays += _ARRAYS_PER_UNIT * len(units)
        except TypeError:
            pass
    return cell * arrays


def reset() -> None:
    """Drop every counter and buffer. For tests, and for nothing else.

    Notes
    -----
    Not called by :func:`aggregate_api.app.create_app`. In production this
    module's state is exactly process-lifetime, which is what every "since
    process start" label on the page promises, and a reset wired into app
    creation would quietly make that promise false the first time anything built
    a second app. The tests that need a clean slate call this themselves.
    """
    with _lock:
        _counts.clear()
        _preview_ms.clear()
        _refusals.clear()
