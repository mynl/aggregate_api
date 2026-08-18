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
from datetime import datetime, timezone
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
            Client IP from ``request.client.host`` (or ``"-"`` in tests).
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
