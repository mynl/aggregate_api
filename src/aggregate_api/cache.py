"""In-memory LRU cache for built ``Aggregate`` / ``Portfolio`` objects.

The api's "Option X" cache design: a single, bounded, LRU dict keyed by a hash
of what a program **means**: its parsed statements, the stored spec of every
entry it leans on, the grid it asked for, and the versions and library file it
was resolved against. Same meaning, same id, same cached object, whichever
session asked. See :func:`object_id`.

Why bother
----------

Building a moderately sized portfolio takes seconds; FFTs over
2**18 points across many lines aren't free. The cache lets the
SPA's "per-button-fetch UX" (info, summary, stats_df, plot,
kappa, pricing) all run as O(1) lookups against the prebuilt
object, with the heavy lift paid only once per program and grid.

Why not lru_cache
-----------------

``functools.lru_cache`` is per-function and doesn't expose the
inspection / list / delete operations the api needs
(``GET /v1/objects``, ``DELETE /v1/objects/{id}``). An
``OrderedDict`` does, and the move-to-end / popitem(last=False)
pair gives plain LRU semantics in ~10 lines.

Thread-safety
-------------

A single ``threading.Lock`` wraps every mutation. The cache is
small (≤50 entries by default), so coarse-grained locking is
cheaper than any per-entry alternative.

Why not weakref
---------------

We want explicit bounded retention, not "alive until nobody
holds a reference". The SPA holds the id, not the object,
so weakref would have no live referents and evict immediately.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .serializers import _spec_value, spec_to_payload


def object_id(statements: list, references: list, log2: int, bs: float,
              environment: dict) -> str:
    """The cache id for a parsed program: a hash of what it means.

    Parameters
    ----------
    statements : list of tuple
        ``(kind, name, program, spec)`` per previewed statement, in program
        order. ``program`` is the statement's preprocessed text and ``spec`` the
        parser's output, which already holds a copy of every dotted reference.
    references : list of tuple
        ``(kind, name, program, spec)`` per entry the preview resolved, as the
        caller's own recipe base stores it. This is what covers a
        ``sev agg.NAME`` chain, which the parse records symbolically and the
        build resolves afresh.
    log2, bs : int, float
        The requested grid, 0 meaning "the library picks".
    environment : dict
        The ``aggregate`` version, each plugin's version and a digest of the
        library file, so an id saved outside the process cannot silently change
        meaning across an upgrade or a library edit.

    Returns
    -------
    str
        The first 16 hex characters of SHA-256 over the canonical JSON of the
        five inputs.

    Notes
    -----
    **Canonical JSON** is :func:`aggregate_api.serializers.spec_to_payload` per
    spec, then ``json.dumps(sort_keys=True, separators=(",", ":"))``. Floats
    are written by ``repr``, so 0.1 and 0.1000000000001 key apart, as they
    build apart. Every spec in ``library.agg`` and ``decl-testers.agg``
    serializes to the same bytes in two separate processes.

    **Why the statement text is hashed as well as its spec.** A few spec values
    are library objects that ``spec_to_payload`` can only write as their
    ``str``, and that string rounds: a copula prints ``clayton(tau=0.312346)``
    for ``0.3123456`` and ``0.3123459`` alike, and a distortion inside a mixture
    prints ``PH(0.667)``. The spec alone would then file two programs that build
    differently under one id. The text cannot round, so with it the key can only
    split ids that the spec would merge, never merge ids it would split. The
    remaining gap is three levels deep: a referenced entry whose text is
    unchanged and whose stored spec changed only in such a rounded value.

    **No session id.** Identical meaning shares one object across sessions,
    which is correct, and the preview already ran against the caller's fork,
    so the caller's own declarations are in ``statements`` and ``references``.

    Sixty-four bits rather than the document itself, because the document can
    run to kilobytes and the id travels in URLs, cache keys, audit rows and
    spreadsheet cells.
    """
    def rows(items):
        # An ``expr`` statement's spec is the number itself, not a dict.
        return [[kind, name, program,
                 spec_to_payload(spec) if isinstance(spec, dict)
                 else _spec_value(spec)]
                for kind, name, program, spec in items]

    document = {
        "statements": rows(statements),
        "references": rows(references),
        "log2": log2,
        "bs": float(bs),
        "environment": environment,
    }
    payload = json.dumps(document, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


@dataclass
class CacheEntry:
    """One slot in the LRU.

    ``obj`` is the live ``Aggregate`` or ``Portfolio``. The SPA
    never reaches it directly, but the api's per-button endpoints
    pull data off it on demand.

    The other fields are metadata returned by
    ``GET /v1/objects/{id}`` and used by the build endpoint to
    fill out the response without consulting the underlying object.

    Thread-safety of ``obj``
    ------------------------

    ``lock`` serializes *reads of the built object*, which sounds unnecessary
    and is not. An ``Aggregate`` and a ``Portfolio`` materialize several of
    their frames lazily and cache them on the instance, so a "read" is a write
    the first time. Two requests that touch the same object concurrently can
    therefore see a half-built frame.

    That is not hypothetical. Fetching ``unit_density_df`` and ``tail_df`` for
    one Portfolio at the same moment (which the Overview exhibit does, in a
    single ``Promise.all``) raised
    ``KeyError: "['F', 'S'] not in index"`` from inside
    ``Portfolio.unit_density_df`` roughly half the time on a cold object, and
    never once the frames were warm. FastAPI runs sync handlers in a thread
    pool, so those two requests really are two threads on one object.

    The lock is per entry rather than global so unrelated objects still serve
    in parallel, and contention is confined to the first access of each frame:
    afterwards every read is a cache hit and the critical section is trivial.
    """

    obj: Any
    decl: str
    log2: int
    bs: float
    kind: str
    name: str
    created_at: datetime
    # What the library said while building this object, at WARNING and above.
    # Stored here rather than returned once and forgotten, because a warning
    # ("this splice is coarse", "the grid clips the tail") describes the
    # OBJECT, not the request that happened to build it. Kept on the entry, a
    # cache hit reports the same warnings as the miss that made it, so
    # rebuilding a program does not silently lose the reason to worry about it.
    notes: list[str] = field(default_factory=list)
    # Guards reads *of the object*, not of this dataclass. See below.
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False,
                                 compare=False)


class ObjectCache:
    """Bounded LRU keyed by :func:`object_id`.

    Methods are coarsely thread-safe via a single lock. Reads
    move the entry to MRU; writes evict the LRU when full. The
    ``__contains__`` check does *not* move-to-MRU (peek, not
    promote), the standard idiom for "is this in cache" before
    a separate get/put decision.
    """

    def __init__(self, max_entries: int = 50) -> None:
        self._max = max_entries
        self._store: OrderedDict[str, CacheEntry] = OrderedDict()
        self._lock = threading.Lock()
        # Instrumentation for GET /v1/status. Incremented under the same lock
        # that guards the store, so a reading of them is consistent with the
        # entry list read in the same call and no second lock is introduced.
        # They count this instance, and ``_get_cache`` replaces the instance
        # when ``cache_max`` changes, so the page reports them against the
        # process start time and that is honest for every deployment which does
        # not edit its config while running.
        self.hits = 0
        self.misses = 0
        self.puts = 0
        self.evictions = 0
        self.deletes = 0

    def get(self, oid: str, *, counted: bool = True) -> CacheEntry | None:
        """Return the cached entry for ``oid`` (moving it to MRU) or None.

        Parameters
        ----------
        oid : str
            The object id.
        counted : bool, default True
            Whether this lookup moves ``hits`` and ``misses``. False for the
            re-check ``post_object`` makes once it holds the build slot: that
            request's lookup was already counted on arrival, and counting the
            second look too would report two misses for every build.
        """
        with self._lock:
            entry = self._store.get(oid)
            if entry is None:
                if counted:
                    self.misses += 1
                return None
            if counted:
                self.hits += 1
            # ``move_to_end`` is the OrderedDict primitive that makes
            # LRU work; entries closest to the front are evicted first.
            self._store.move_to_end(oid)
            return entry

    def put(self, oid: str, entry: CacheEntry) -> None:
        """Insert or refresh ``entry`` under ``oid``, evicting LRU if full."""
        with self._lock:
            self.puts += 1
            if oid in self._store:
                self._store.move_to_end(oid)
                self._store[oid] = entry
                return
            self._store[oid] = entry
            while len(self._store) > self._max:
                # ``last=False`` pops the *least* recently used (front).
                self._store.popitem(last=False)
                self.evictions += 1

    def delete(self, oid: str) -> bool:
        """Remove ``oid`` from the cache; return True if it was present."""
        with self._lock:
            dropped = self._store.pop(oid, None) is not None
            if dropped:
                self.deletes += 1
            return dropped

    def list(self) -> list[CacheEntry]:
        """Return a snapshot of cache contents, MRU last.

        Returned list is a copy of the internal values, safe to
        iterate without holding the lock.
        """
        with self._lock:
            return list(self._store.values())

    def items(self) -> list[tuple[str, CacheEntry]]:
        """Snapshot of ``(id, entry)`` pairs, **LRU first**.

        Notes
        -----
        LRU first because the caller that wants ids as well as entries is
        ``GET /v1/status``, whose cache table answers "what will I lose next",
        and the front of the ``OrderedDict`` is exactly that. :meth:`list`
        keeps its MRU-last ordering, which is what its callers already read.

        Exists so callers stop reaching into ``_store`` directly, which two of
        them in ``routes/objects.py`` do, unlocked. The pairs are a copy, so
        iterating them is safe without the lock; the entries themselves are the
        live objects, as :meth:`list` also returns.
        """
        with self._lock:
            return list(self._store.items())

    def clear(self) -> None:
        """Drop every entry. Used by tests."""
        with self._lock:
            self._store.clear()

    def __contains__(self, oid: str) -> bool:
        with self._lock:
            return oid in self._store

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def stats(self) -> dict:
        """Counters and occupancy, read in one critical section.

        Returns
        -------
        dict
            ``entries``, ``max``, ``hits``, ``misses``, ``hit_rate``, ``puts``,
            ``evictions`` and ``deletes``. ``hit_rate`` is ``None`` rather than
            zero before the first lookup, because "no requests yet" and "every
            request missed" are different facts and a status page that renders
            them the same way is misreporting a cold start as a failure.

        Notes
        -----
        One call rather than eight attribute reads so the numbers a caller
        prints together were true together. An eviction landing between two
        reads would otherwise show a hit count that does not reconcile with the
        entry list.
        """
        with self._lock:
            looks = self.hits + self.misses
            return {
                "entries": len(self._store),
                "max": self._max,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(self.hits / looks, 4) if looks else None,
                "puts": self.puts,
                "evictions": self.evictions,
                "deletes": self.deletes,
            }
