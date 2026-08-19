"""SQLite-backed audit log for build attempts.

One row per ``POST /v1/objects`` request, regardless of outcome.
The log captures the DecL source, build knobs, status, error
message (if any), elapsed time, client IP, and timestamp.

Why SQLite
----------

* Stdlib (zero extra deps in the ``[api]`` extra).
* WAL mode lets readers and the audit writer not block each other.
* Trivially inspectable from the shell with ``sqlite3 audit.db
  "select * from builds order by ts desc limit 20"``.

The team-deploy assumption is that audit reads are infrequent and
manual; there's no admin route in v1.

Schema design notes
-------------------

* ``object_id`` is NULLABLE because failed builds (parse errors,
  timeouts) never produce one.
* ``kind`` is NULLABLE for the same reason.
* ``elapsed_ms`` is captured even on failure -- a 9000 ms parse
  error is qualitatively different from a 5 ms one.
* ``status`` is a free-form text label (not an enum) so we can
  add new states ('rate_limited' etc.) without a migration.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ----------------------------------------------------------------------
# DDL
# ----------------------------------------------------------------------
# Wrapped in IF NOT EXISTS so :meth:`AuditLog._ensure_schema` is
# idempotent -- every connection re-runs it cheaply and the schema
# survives server restarts without explicit migrations.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    ip TEXT NOT NULL,
    object_id TEXT,
    kind TEXT,
    decl TEXT NOT NULL,
    log2 INTEGER,
    bs REAL,
    status TEXT NOT NULL,
    error_msg TEXT,
    elapsed_ms INTEGER NOT NULL,
    session_id TEXT,
    key_scope TEXT
);
CREATE INDEX IF NOT EXISTS builds_ts ON builds(ts);
CREATE INDEX IF NOT EXISTS builds_ip ON builds(ip);
"""

# Columns added after the table shipped. ``CREATE TABLE IF NOT EXISTS`` leaves an
# existing table alone, so a database written before a110 has neither of these
# and every insert would fail on the column count. SQLite has no
# ``ADD COLUMN IF NOT EXISTS``, so the check is a table read and the add is
# guarded by it.
_ADDED_COLUMNS = (
    ("session_id", "TEXT"),
    ("key_scope", "TEXT"),
)


class AuditLog:
    """Append-only SQLite log.

    Connections aren't shared across threads (sqlite3 forbids it
    by default and the cost of a fresh connection per write is
    irrelevant for our volume). A single lock serializes writes
    so concurrent build endpoints don't race on the AUTOINCREMENT
    sequence.

    Set ``journal_mode=WAL`` on each connection so the audit file
    can be inspected with the ``sqlite3`` CLI while the server is
    running.
    """

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        # Ensure the parent directory exists. The default audit-db
        # path lives under ``~/.aggregate/api/`` which probably
        # doesn't exist on a fresh install.
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # Trigger initial schema creation, set WAL mode.
        with closing(self._connect()) as conn:
            conn.executescript(_SCHEMA)
            self._add_missing_columns(conn)

    @staticmethod
    def _add_missing_columns(conn: sqlite3.Connection) -> None:
        """Bring a pre-existing table up to the current column list.

        Notes
        -----
        Deliberately not a migration framework. The table is append-only and
        every column added since it shipped is nullable, so "add what is
        missing" is the whole of it, and a database from any earlier version
        reaches the current shape in one pass. Old rows keep NULL, which reads
        correctly as "written before the api knew about sessions".
        """
        held = {row[1] for row in conn.execute("PRAGMA table_info(builds)")}
        for column, sql_type in _ADDED_COLUMNS:
            if column not in held:
                conn.execute(f"ALTER TABLE builds ADD COLUMN {column} {sql_type}")

    def _connect(self) -> sqlite3.Connection:
        """Open a new connection with sensible defaults.

        ``isolation_level=None`` puts the connection in autocommit
        mode -- we use explicit transactions when we want them.
        ``check_same_thread=False`` is *not* set: each call
        produces a fresh connection that lives only for the
        duration of the caller's ``with`` block.

        Notes
        -----
        **Every caller wraps this in** :func:`contextlib.closing`, and the
        wrapper is not decoration. ``with sqlite3.connect(...) as conn`` is
        sqlite3's *transaction* context manager: it commits on a clean exit and
        rolls back on an exception, and it does **not** close the connection.
        So the plain form, which is what this class used through a70, leaked one
        connection per build and one per read, each of them held until the
        garbage collector got to it. The finalizer is what then printed
        ``ResourceWarning: unclosed database in <sqlite3.Connection ...>``, and
        because ``pricing.py`` was capturing warnings unscoped at the time, that
        line reached the reader's status strip as though their program had
        provoked it. Both halves are fixed; this is the half that stops the
        connection leaking in the first place.
        """
        conn = sqlite3.connect(self.db_path)
        # WAL gives readers a stable snapshot while writes proceed,
        # so ``sqlite3 audit.db`` from the shell never deadlocks.
        conn.execute("PRAGMA journal_mode=WAL")
        # NORMAL trades durability of the last ~few writes for ~10x
        # write throughput -- fine for an audit log.
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def record_build(
        self,
        *,
        ip: str,
        decl: str,
        log2: int | None,
        bs: float | None,
        status: str,
        object_id: str | None = None,
        kind: str | None = None,
        error_msg: str | None = None,
        elapsed_ms: int = 0,
        session_id: str | None = None,
        key_scope: str | None = None,
    ) -> None:
        """Append one row.

        Parameters
        ----------
        ip : str
            Client address from ``routes.objects._client_ip``, which reads the
            forwarded chain and falls back to the peer. ``"-"`` when neither
            says anything. Rows written before a112 read the peer alone, so
            every one of them from behind Caddy says ``127.0.0.1``.
        decl : str
            The raw DecL submitted (not the canonicalized form).
        log2, bs : int|None, float|None
            Build knobs as requested -- may be None when omitted.
        status : str
            One of ``'ok' | 'parse_error' | 'build_error' | 'timeout'
            | 'limit_exceeded'``.
        object_id : str|None
            Set on success.
        kind : str|None
            ``'agg'`` or ``'port'`` on success; None on failure.
        error_msg : str|None
            One-line error summary (e.g. ``ErrorReport.message``).
        elapsed_ms : int
            Wall-clock time, including parse + cache check + build.
        session_id : str|None
            The caller's session, or ``'anonymous'`` for a headerless client.
        key_scope : str|None
            ``'shared'`` or ``'session'``: which cache key this request used.
            Recorded because it is the one number that says whether the
            qualification rule is working. A demo where nearly every build is
            ``'session'`` means the rule is firing on programs that do not need
            it, and the room is paying for builds it could have shared.
        """
        # ISO 8601 with UTC; chosen for sortability and unambiguous TZ.
        ts = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        with self._lock, closing(self._connect()) as conn:
            conn.execute(
                """INSERT INTO builds
                   (ts, ip, object_id, kind, decl, log2, bs, status, error_msg,
                    elapsed_ms, session_id, key_scope)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ts, ip, object_id, kind, decl, log2, bs, status, error_msg,
                 elapsed_ms, session_id, key_scope),
            )
            conn.commit()

    def recent(self, n: int = 100) -> list[dict]:
        """Most recent ``n`` rows, newest first."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM builds ORDER BY ts DESC LIMIT ?", (n,)
            ).fetchall()
        return [dict(r) for r in rows]

    def by_ip(self, ip: str, n: int = 100) -> list[dict]:
        """Recent rows from a specific client."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM builds WHERE ip = ? ORDER BY ts DESC LIMIT ?",
                (ip, n),
            ).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def _cutoff(window_s: float) -> str:
        """The ``ts`` value marking the start of a window ``window_s`` back.

        Notes
        -----
        A string comparison, not a date function. Every row's ``ts`` is written
        by :meth:`record_build` as an ISO 8601 UTC timestamp of fixed width, and
        fixed-width ISO 8601 in one timezone sorts lexicographically in time
        order, so ``ts >= ?`` is both correct and able to use the ``builds_ts``
        index. Calling SQLite's ``datetime()`` on the column instead would be
        correct and would scan the table.
        """
        start = datetime.now(timezone.utc) - timedelta(seconds=window_s)
        return start.isoformat(timespec="milliseconds")

    def window_summaries(self, windows, *, top: int = 5,
                         slowest: int = 5) -> dict:
        """Several windows over one connection.

        Parameters
        ----------
        windows : iterable of (str, float)
            Label and window length in seconds, for example
            ``(('hour', 3600.0), ('day', 86400.0))``.
        top, slowest : int
            Passed through to :meth:`window_summary`.

        Returns
        -------
        dict
            Label to summary.

        Notes
        -----
        One connection for the lot. Each :meth:`_connect` runs two ``PRAGMA``
        statements before the first query, which on the status route's two
        windows was the larger half of the cost: the queries themselves are
        indexed and answer in microseconds. The connection is still per call
        rather than held, which is the pattern the rest of this class uses and
        the reason it is safe across threads.
        """
        with closing(self._connect()) as conn:
            return {label: self.window_summary(window, top=top, slowest=slowest,
                                               conn=conn)
                    for label, window in windows}

    def window_summary(self, window_s: float, *, top: int = 5,
                       slowest: int = 5, conn: sqlite3.Connection | None = None) -> dict:
        """Everything ``GET /v1/status`` says about builds in one time window.

        Parameters
        ----------
        window_s : float
            How far back to look, in seconds.
        top : int
            How many error messages and how many clients to name.
        slowest : int
            How many slow builds to list.
        conn : sqlite3.Connection, optional
            An open connection to reuse. Given by :meth:`window_summaries` so
            several windows share one; ``None`` opens and closes its own.

        Returns
        -------
        dict
            ``window_s``, ``total``, ``by_status``, ``by_key_scope``,
            ``p50_ms``, ``p95_ms``, ``slowest``, ``top_errors``,
            ``distinct_clients`` and ``top_clients``.

        Notes
        -----
        **Seven small queries rather than one Python pass over the table.** The
        audit database grows without bound by design, so reading rows into
        Python to count them is a page whose cost rises with the age of the
        deployment. Every query here is bounded by the window, is served by the
        ``builds_ts`` index, and carries a ``LIMIT``.

        The percentiles are offsets into an ordered window rather than an
        interpolated quantile, because SQLite has no percentile function and the
        alternative is loading the column. Nearest rank on a few thousand rows
        is the same number to the millisecond the page prints.

        ``by_key_scope`` covers only rows written since a110, which is when the
        column arrived. Older rows read ``NULL`` and are grouped under
        ``'unknown'`` rather than silently folded into either scope.
        """
        if conn is None:
            with closing(self._connect()) as owned:
                return self.window_summary(window_s, top=top, slowest=slowest,
                                           conn=owned)
        cutoff = self._cutoff(window_s)
        total = conn.execute(
            "SELECT COUNT(*) FROM builds WHERE ts >= ?", (cutoff,)
        ).fetchone()[0]
        by_status = {
            row[0]: row[1] for row in conn.execute(
                "SELECT status, COUNT(*) FROM builds WHERE ts >= ? "
                "GROUP BY status ORDER BY COUNT(*) DESC LIMIT 20", (cutoff,))
        }
        by_key_scope = {
            (row[0] or "unknown"): row[1] for row in conn.execute(
                "SELECT key_scope, COUNT(*) FROM builds WHERE ts >= ? "
                "GROUP BY key_scope ORDER BY COUNT(*) DESC LIMIT 20", (cutoff,))
        }
        percentiles = {}
        for label, q in (("p50_ms", 0.50), ("p95_ms", 0.95)):
            if total == 0:
                percentiles[label] = None
                continue
            offset = min(total - 1, max(0, int(round(q * (total - 1)))))
            percentiles[label] = conn.execute(
                "SELECT elapsed_ms FROM builds WHERE ts >= ? "
                "ORDER BY elapsed_ms LIMIT 1 OFFSET ?", (cutoff, offset)
            ).fetchone()[0]
        slow = [dict(row) for row in conn.execute(
            "SELECT ts, elapsed_ms, status, kind, object_id, session_id "
            "FROM builds WHERE ts >= ? ORDER BY elapsed_ms DESC LIMIT ?",
            (cutoff, slowest))]
        errors = [{"error_msg": row[0], "count": row[1]} for row in conn.execute(
            "SELECT error_msg, COUNT(*) FROM builds WHERE ts >= ? "
            "AND error_msg IS NOT NULL GROUP BY error_msg "
            "ORDER BY COUNT(*) DESC LIMIT ?", (cutoff, top))]
        distinct = conn.execute(
            "SELECT COUNT(DISTINCT ip) FROM builds WHERE ts >= ?", (cutoff,)
        ).fetchone()[0]
        clients = [{"ip": row[0], "count": row[1]} for row in conn.execute(
            "SELECT ip, COUNT(*) FROM builds WHERE ts >= ? GROUP BY ip "
            "ORDER BY COUNT(*) DESC LIMIT ?", (cutoff, top))]
        return {
            "window_s": window_s,
            "total": total,
            "by_status": by_status,
            "by_key_scope": by_key_scope,
            **percentiles,
            "slowest": slow,
            "top_errors": errors,
            "distinct_clients": distinct,
            "top_clients": clients,
        }

    def size_bytes(self) -> int | None:
        """Bytes on disk for the database and its write-ahead log, or ``None``.

        Notes
        -----
        The WAL is counted because it is real disk and can be the larger of the
        two between checkpoints, and the page exists partly so that the audit
        database's growth becomes obvious: section 8 question 4 of
        ``dev/done/plan-site-status-page.md`` is the retention decision this number
        is meant to prompt.
        """
        total = 0
        seen = False
        for suffix in ("", "-wal", "-shm"):
            path = Path(str(self.db_path) + suffix)
            try:
                total += path.stat().st_size
                seen = True
            except OSError:
                continue
        return total if seen else None
