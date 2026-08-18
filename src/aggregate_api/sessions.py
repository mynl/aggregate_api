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
        # id -> (fork, last-touched monotonic seconds).
        self._store: OrderedDict[str, tuple] = OrderedDict()
        self._lock = threading.Lock()
        # Counters for the audit and for anything reporting on the process:
        # how many forks were taken, and how many were dropped again.
        self.forks_taken = 0
        self.forks_dropped = 0

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
                self._store[session_id] = (found[0], now)
                self._store.move_to_end(session_id)
                return found[0]
        # The fork is taken outside the lock: it is microseconds, but it runs
        # library code, and holding a registry-wide lock across a call into
        # another package is how a deadlock gets written. Two threads racing
        # here both fork and one wins the insert; the loser's fork is empty and
        # unreferenced, so it is garbage rather than a lost registration.
        fork = parent.fork(name=f"session-{session_id}")
        with self._lock:
            found = self._store.get(session_id)
            if found is not None:
                self._store.move_to_end(session_id)
                return found[0]
            self._store[session_id] = (fork, now)
            self.forks_taken += 1
            while len(self._store) > self._max:
                self._store.popitem(last=False)
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
            session_id, (_, touched) = next(iter(self._store.items()))
            if now - touched <= self._ttl:
                return
            self._store.pop(session_id)
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

    def __contains__(self, session_id: str) -> bool:
        with self._lock:
            return session_id in self._store

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)
