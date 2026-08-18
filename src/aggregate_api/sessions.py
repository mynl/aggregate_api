"""One recipe base per session, forked from the process's own.

The api builds through an underwriter, and a build registers what it parsed:
every named declaration becomes a ``Recipe`` filed under ``(kind, name)`` with
``source='session'``. One shared base therefore accumulates every visitor's
declarations for the life of the process, last writer wins by name, and one
user's ``agg Cat`` is what another user's ``sev agg.Cat`` means. On a personal
instance that is invisible. On a shared one it is wrong.

The fix is ``Underwriter.fork()``: a copy whose recipe dict is a fresh dict over
the same parsed ``Recipe`` objects, so the library is read and parsed once and
each session gets a private namespace over it for the price of a dict copy.
Measured at about 6 microseconds against the 3,185 milliseconds a fresh load
costs, which is why a registry of hundreds is affordable and why nothing here
tries to be clever about reuse.

What a session id is, and is not
--------------------------------

It is a **namespace**, not a security boundary. Anyone holding your id gets your
objects, which is exactly why no login is needed for it: it separates users who
are not trying to reach each other, which is the demo case. Do not build
anything on it that would matter if it leaked.

It is minted client side and arrives in the ``X-Aggregate-Session`` header, so
the server treats it as untrusted text: bounded in length, restricted in
charset, and anything failing that is read as no header at all. A missing or
unusable header falls back to one per-process anonymous session, so ``curl`` and
the test suite keep working and keep today's collision behavior among
themselves. That is a stated tradeoff, not an oversight.

Eviction is the registry's, on its own clock
--------------------------------------------

Bounded LRU with a TTL, both configurable. The id carries a client timestamp,
which is an audit and display key and nothing more: client clocks are not
trustworthy and eviction does not need them. When a fork is evicted the session
survives as an id, and its next reference to something it built itself raises
``RecipeNotFound``, which the routes turn into a 422 naming the missing entry so
the app can offer a rebuild.
"""

from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone

# The header a browser sends its session id in. Read in ``routes/objects.py``
# and, because a download cannot set headers, accepted in the query string
# there as well.
SESSION_HEADER = "X-Aggregate-Session"

# The id every headerless client shares. Not a valid minted id (a real one
# carries a timestamp and a uuid4), so no browser can collide with it by
# accident, and legible in an audit row.
ANONYMOUS = "anonymous"

# Minted as ``<utc timestamp>-<uuid4>``, so an ISO timestamp's colons, dots and
# hyphens plus hex. Deliberately a shape check and not a parse: the server has
# no use for the timestamp, and a client that formats it differently should not
# be told its session is invalid. Length is bounded because an id is a dict key
# on an untrusted string.
_SESSION_ID = re.compile(r"\A[A-Za-z0-9:.\-_]{8,200}\Z")


def normalize_session_id(raw: str | None) -> str:
    """Return a usable session id, or :data:`ANONYMOUS`.

    Parameters
    ----------
    raw : str or None
        The header (or query parameter) value as it arrived.

    Returns
    -------
    str
        ``raw`` stripped, if it is a plausible minted id; otherwise
        :data:`ANONYMOUS`.

    Notes
    -----
    An unusable id reads as absent rather than as an error. A 400 would teach a
    client nothing it can act on (the id is its own invention) and would break
    the headerless callers this fallback exists for.
    """
    if not raw:
        return ANONYMOUS
    candidate = raw.strip()
    if not _SESSION_ID.match(candidate):
        return ANONYMOUS
    return candidate


@dataclass
class SessionEntry:
    """One session's fork and what the registry knows about it.

    A dataclass rather than the ``(fork, touched)`` tuple this started as,
    because ``GET /v1/status`` reports a row per live session and a tuple grows
    a field at a time until nobody remembers the order. Everything here is
    written by the registry under its lock and read through
    :meth:`SessionRegistry.rows`.

    Attributes
    ----------
    fork : aggregate.underwriter.Underwriter
        The session's own recipe base.
    created_at : datetime
        Wall clock, for display. Not used for eviction: see ``touched``.
    created : float
        Monotonic seconds at creation, for the age.
    touched : float
        Monotonic seconds at the last access, which is what the TTL reads. A
        monotonic clock rather than the wall clock, because a machine adjusting
        its time should not expire or resurrect a session.
    requests : int
        How many times this session asked the registry for its base.
    builds : int
        How many objects this session caused to be built, meaning cache misses
        that produced one. A session with many requests and no builds is a
        reader, and the pair says more than either number alone.
    """

    fork: object
    created_at: datetime
    created: float
    touched: float
    requests: int = 0
    builds: int = 0


class SessionRegistry:
    """Session id to forked ``Underwriter``, bounded LRU with a TTL.

    Modeled on :class:`aggregate_api.cache.ObjectCache`: one lock, an
    ``OrderedDict`` for the LRU, move-to-end on read, ``popitem(last=False)``
    to evict. It differs in one way that matters: a miss is not a miss to
    report but a fork to take, so :meth:`underwriter` always returns a base.

    Parameters
    ----------
    max_sessions : int
        How many forks to hold. Generous is the right setting: a fork is
        microseconds and a few hundred kilobytes, and the TTL is what actually
        bounds the memory.
    ttl_s : float
        Seconds of inactivity after which a fork is dropped. Read on access,
        so an idle session is evicted the next time anything asks the registry
        for anything, not on a timer thread.

    Notes
    -----
    The lock guards the registry, not the forks. A fork is single-session by
    construction, so two concurrent requests from **one** session can still
    race each other inside it, which is the same exposure the shared base
    always had and no worse. What the lock does buy is that two concurrent
    first requests from one session get one fork rather than two, so the
    second does not silently start from a base the first has already written
    to.
    """

    def __init__(self, max_sessions: int = 500, ttl_s: float = 28800.0) -> None:
        self._max = max_sessions
        self._ttl = ttl_s
        self._store: OrderedDict[str, SessionEntry] = OrderedDict()
        self._lock = threading.Lock()
        # Counters for the audit and for anything reporting on the process.
        # Dropped forks are split by cause because the three causes mean
        # different things to an operator: expiry is the TTL working, eviction
        # is the capacity being too small for the room, and an explicit drop is
        # somebody asking. A single total cannot tell them apart, and "sessions
        # keep vanishing" is exactly the report where the difference is the
        # answer. ``forks_dropped`` stays as the total, since it shipped at
        # a110 under that meaning.
        self.forks_taken = 0
        self.forks_expired = 0
        self.forks_evicted = 0
        self.forks_dropped = 0
        self.high_water = 0

    def underwriter(self, session_id: str, parent):
        """Return this session's fork of ``parent``, taking one if needed.

        Parameters
        ----------
        session_id : str
            Already normalized: see :func:`normalize_session_id`.
        parent : aggregate.underwriter.Underwriter
            The process's own base, from
            :func:`aggregate_api.library.get_underwriter`. Passed rather than
            imported so this module knows nothing about configuration.

        Returns
        -------
        aggregate.underwriter.Underwriter
            The fork, already loaded.
        """
        now = time.monotonic()
        with self._lock:
            self._expire(now)
            found = self._store.get(session_id)
            if found is not None:
                found.touched = now
                found.requests += 1
                self._store.move_to_end(session_id)
                return found.fork
        # The fork is taken outside the lock: it is microseconds, but it runs
        # library code, and holding a registry-wide lock across a call into
        # another package is how a deadlock gets written. Two threads racing
        # here both fork and one wins the insert; the loser's fork is empty and
        # unreferenced, so it is garbage rather than a lost registration.
        fork = parent.fork(name=f"session-{session_id}")
        with self._lock:
            found = self._store.get(session_id)
            if found is not None:
                found.touched = now
                found.requests += 1
                self._store.move_to_end(session_id)
                return found.fork
            self._store[session_id] = SessionEntry(
                fork=fork, created_at=datetime.now(timezone.utc),
                created=now, touched=now, requests=1)
            self.forks_taken += 1
            self.high_water = max(self.high_water, len(self._store))
            while len(self._store) > self._max:
                self._store.popitem(last=False)
                self.forks_evicted += 1
                self.forks_dropped += 1
        return fork

    def _expire(self, now: float) -> None:
        """Drop forks idle longer than the TTL. The caller holds the lock.

        Walks from the LRU end and stops at the first live entry, which is
        correct because the order is by last touch.
        """
        if self._ttl <= 0:
            return
        while self._store:
            session_id, entry = next(iter(self._store.items()))
            if now - entry.touched <= self._ttl:
                return
            self._store.pop(session_id)
            self.forks_expired += 1
            self.forks_dropped += 1

    def drop(self, session_id: str) -> bool:
        """Forget one session's fork; return True if it was held."""
        with self._lock:
            dropped = self._store.pop(session_id, None) is not None
            if dropped:
                self.forks_dropped += 1
            return dropped

    def clear(self) -> None:
        """Forget every fork. Used by ``reset_singletons`` and by tests."""
        with self._lock:
            self._store.clear()

    def ids(self) -> list[str]:
        """Snapshot of the session ids held, LRU first."""
        with self._lock:
            return list(self._store.keys())

    def record_build(self, session_id: str) -> None:
        """Note that ``session_id`` caused one object to be built.

        Called on a cache miss that produced an object. A no-op for a session
        whose fork has since been evicted, because the counter lives on the
        entry and there is nothing left to count against. The audit log holds
        that build either way, which is where a permanent record belongs.
        """
        with self._lock:
            entry = self._store.get(session_id)
            if entry is not None:
                entry.builds += 1

    def __contains__(self, session_id: str) -> bool:
        with self._lock:
            return session_id in self._store

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def stats(self) -> dict:
        """Aggregate counters and the configured bounds, in one critical section."""
        with self._lock:
            return {
                "live": len(self._store),
                "max": self._max,
                "ttl_s": self._ttl,
                "high_water": self.high_water,
                "taken": self.forks_taken,
                "dropped": self.forks_dropped,
                "expired": self.forks_expired,
                "evicted": self.forks_evicted,
            }

    def rows(self, baseline: int = 0) -> list[dict]:
        """One row per live session, LRU first, for ``GET /v1/status``.

        Parameters
        ----------
        baseline : int
            The reference underwriter's recipe count, subtracted from each
            fork's so the column reads "what this session declared" rather than
            "the library plus what this session declared", where the second
            number is the same few hundred on every row and says nothing.

        Returns
        -------
        list of dict
            ``session_id``, ``created_at``, ``age_s``, ``idle_s``, ``requests``,
            ``builds`` and ``recipes``, LRU first, so what is about to be
            expired reads first. The id travels in full: truncating it is the
            page's job, since the payload is already behind the private gate and
            a machine reader may want to correlate it with an audit row.

        Notes
        -----
        ``len(fork._recipes)`` is a private attribute of a stable-tier library
        class, taken deliberately and recorded in the oversight charter's
        tolerated list (author ruling, 2026-08-18). The public route is
        ``Underwriter.recipes``, which builds a pandas frame per call, and this
        page would call it once per live session on every refresh: hundreds of
        frames every ten seconds to report hundreds of integers. The read is
        guarded, so a rename upstream costs one field reading ``None`` rather
        than a broken route.
        """
        now = time.monotonic()
        with self._lock:
            entries = list(self._store.items())
        rows = []
        for session_id, entry in entries:
            try:
                recipes = len(entry.fork._recipes) - baseline
            except (AttributeError, TypeError):
                recipes = None
            rows.append({
                "session_id": session_id,
                "created_at": entry.created_at.isoformat(timespec="seconds"),
                "age_s": round(now - entry.created, 1),
                "idle_s": round(now - entry.touched, 1),
                "requests": entry.requests,
                "builds": entry.builds,
                "recipes": recipes,
            })
        return rows
