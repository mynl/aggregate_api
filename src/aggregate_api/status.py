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

The budget is roughly 250 kB: fifty programs at two kilobytes, five hundred
float samples, twenty refusal records, and a few dozen integers. A future panel
that cannot fit that is a query and not a buffer.

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

#: How many programs the key-scope buffer keeps, and how much of each. Fifty at
#: two kilobytes is the bulk of this module's memory budget.
PROGRAM_BUFFER = 50
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
_programs: deque = deque(maxlen=PROGRAM_BUFFER)
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
def record_key_scope(scope: str, reason: str | None = None) -> None:
    """Count one keying decision from ``routes/objects.py::_cache_key``.

    Parameters
    ----------
    scope : {'shared', 'session'}
        Which key builder the request used.
    reason : {'session_reference', 'preview_unavailable'}, optional
        Why the session key was taken. Ignored for ``'shared'``.

    Notes
    -----
    The two reasons mean opposite things and are counted apart for that reason.
    ``session_reference`` is the rule working: the program touched a name its own
    session declared, so it cannot share a slot. ``preview_unavailable`` is the
    previewer declining to speak about the program at all, which is a fail-closed
    path that is usually a program about to fail its build and is occasionally a
    previewer refusing what the builder accepts. Only the second is a finding,
    and telling them apart is the whole value of the panel.
    """
    with _lock:
        _counts[f"key_{scope}"] += 1
        if scope == "session" and reason:
            _counts[f"key_reason_{reason}"] += 1


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


def record_unpreviewable_build(program: str, session_id: str, kind: str | None,
                               elapsed_ms: int) -> None:
    """Keep a program the previewer refused and the builder then accepted.

    Parameters
    ----------
    program : str
        The DecL as it arrived. Truncated to :data:`PROGRAM_CHARS`.
    session_id : str
        The caller's session. Shortened on the way in by
        :func:`short_session_id`, so nothing here ever holds a full one.
    kind : str or None
        What the build produced.
    elapsed_ms : int
        What the request cost.

    Notes
    -----
    **This narrow class is the only text this module keeps.** A program that
    previewed ``None`` and then failed its build is an ordinary parse error and
    is already in the audit log with a better message. A program that previewed
    ``None`` and then **built** is the previewer refusing what the builder
    accepted: a shareable object took a private cache slot, so a room pays a
    build each instead of one between them. That is an upstream ask against the
    library's ``Underwriter.preview``, and an ask needs the program verbatim,
    which is why author ruling 3 of 2026-08-18 lets this page hold program text.
    """
    text, truncated = truncate(program, PROGRAM_CHARS)
    with _lock:
        _counts["unpreviewable_builds"] += 1
        _programs.append({
            "at": _now_iso(),
            "session_id": short_session_id(session_id),
            "kind": kind,
            "elapsed_ms": elapsed_ms,
            "program": text,
            "truncated": truncated,
        })


def key_scope_state() -> dict:
    """The key-scope panel: counts, rate, reasons, preview timing, programs."""
    with _lock:
        shared = _counts["key_shared"]
        session = _counts["key_session"]
        reasons = {
            "session_reference": _counts["key_reason_session_reference"],
            "preview_unavailable": _counts["key_reason_preview_unavailable"],
        }
        calls = _counts["preview_calls"]
        total_us = _counts["preview_total_us"]
        samples = list(_preview_ms)
        programs = list(_programs)
        unpreviewable_builds = _counts["unpreviewable_builds"]
    keyed = shared + session
    return {
        "shared": shared,
        "session": session,
        "session_rate": round(session / keyed, 4) if keyed else None,
        "reasons": reasons,
        "preview_calls": calls,
        "preview_mean_ms": round(total_us / calls / 1000, 2) if calls else None,
        "preview_p95_ms": percentile(samples, 0.95),
        "preview_sample_size": len(samples),
        "unpreviewable_builds": unpreviewable_builds,
        "recent_unpreviewable": list(reversed(programs)),
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
    Written as a context manager so the three counters cannot drift from each
    other: a ``waiting`` that is decremented on one path out and not another
    would climb forever and the page would report a queue that is not there.
    Entering counts a waiter, acquiring converts it to an in-flight build, and
    leaving releases both regardless of how the body exited.
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
            _counts["builds_started"] += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        with _lock:
            _counts["build_in_flight"] -= 1
        self._semaphore.release()
        return False


def record_build_timeout() -> None:
    """Count one build abandoned at ``build_timeout_s``."""
    with _lock:
        _counts["build_timeouts"] += 1


def build_state() -> dict:
    """Live build state: in flight, queued, started and timed out since start."""
    with _lock:
        return {
            "in_flight": _counts["build_in_flight"],
            "waiting": _counts["build_waiting"],
            "started": _counts["builds_started"],
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
        _programs.clear()
        _refusals.clear()
