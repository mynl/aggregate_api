"""What the process costs, from ``psutil`` when it is installed and stdlib when not.

``psutil`` is an optional extra (``uv sync --extra status``), so this module has
two implementations of the same small block of numbers and says which one it
used. Everything here is a read of counters the operating system already
maintains; nothing walks a Python object or touches the cache.

**A field that cannot be filled renders "unavailable" with the reason, never
zero.** A resource panel reporting 0 bytes resident is worse than one reporting
nothing, because the first is a number an operator will act on. So every
absence carries why it is absent, and the page prints the reason beside the
blank.

The extra is worth declaring even though ``psutil`` is usually already there.
It arrives transitively through ``ipython``, which ``aggregate`` pulls, so the
import succeeds today on any box with the dev environment: by accident rather
than by intent, and one unrelated dependency change away from not. Declaring it
also means the stdlib path is never exercised by accident, which is why the
tests force it.

CPU percent must not block
--------------------------

``psutil.Process.cpu_percent(interval=...)`` sleeps for the interval and then
reports. The ``interval=None`` form reports the share since the previous call on
the same object instead, costing nothing, and :func:`seed` makes the first such
call at startup so the first page load has a denominator. The stdlib path does
the same arithmetic by hand off :func:`time.process_time`. A status page that
blocks a worker for a second is a status page that lies about latency.
"""

from __future__ import annotations

import os
import shutil
import sys
import threading
import time
from pathlib import Path

try:  # pragma: no cover (the branch taken depends on the environment)
    import psutil
except ImportError:  # pragma: no cover
    psutil = None

#: Set by :func:`seed`. Held rather than created per call because
#: ``cpu_percent(interval=None)`` measures against the previous call on **this
#: object**, so a fresh Process each time would report zero forever.
_process = None

#: The stdlib path's previous sample, ``(monotonic, process_time)``.
_cpu_mark: tuple[float, float] | None = None

_lock = threading.Lock()

#: Reason strings, spelled once so the tests can assert on them.
NO_PSUTIL = "psutil not installed; install the status extra"
NO_PROC = "no /proc on this platform"
NO_LOADAVG = "no system load average on this platform"


def available() -> bool:
    """True when ``psutil`` imported, which decides which path :func:`snapshot` takes."""
    return psutil is not None


def seed() -> None:
    """Prime the CPU measurement so the first page load has a denominator.

    Notes
    -----
    Called from :func:`aggregate_api.app.create_app`. Both paths need a previous
    sample to measure against, and without one the first reading is either zero
    (``psutil``) or a division by a zero interval (stdlib). Seeding at startup
    means the first reading is the share since boot, which is a fair number
    rather than a placeholder.
    """
    global _process, _cpu_mark
    with _lock:
        _cpu_mark = (time.monotonic(), time.process_time())
        if psutil is None:
            return
        try:
            _process = psutil.Process()
            _process.cpu_percent(interval=None)
        except Exception:  # noqa: BLE001 (a resource panel must never break boot)
            _process = None


def _cpu_percent_stdlib() -> float | None:
    """CPU share since the previous call, from :func:`time.process_time`.

    Notes
    -----
    ``time.process_time`` is stdlib and cross-platform, unlike
    ``resource.getrusage``, and it counts system plus user CPU for the process,
    which is what ``psutil`` reports too. The result exceeds 100 on a
    multi-core box running several threads hot, which is the same convention
    ``psutil`` uses and is left uncapped for that reason.
    """
    global _cpu_mark
    now, cpu = time.monotonic(), time.process_time()
    with _lock:
        previous = _cpu_mark
        _cpu_mark = (now, cpu)
    if previous is None:
        return None
    elapsed = now - previous[0]
    if elapsed <= 0:
        return None
    return round(100.0 * (cpu - previous[1]) / elapsed, 1)


def _load_average(unavailable: dict) -> list[float] | None:
    """System load average, or ``None`` with a reason recorded.

    Notes
    -----
    ``os.getloadavg`` rather than ``psutil.getloadavg``, on both paths and
    deliberately. psutil emulates the figure on Windows by sampling in a
    background thread, and an emulated load average on a page whose whole
    argument is that it reports honestly is worse than a blank. On the Linux VPS
    the two agree because psutil reads the same source.
    """
    try:
        return [round(value, 2) for value in os.getloadavg()]
    except (OSError, AttributeError):
        unavailable["load_average"] = NO_LOADAVG
        return None


def _disk(path: str, unavailable: dict) -> tuple[int | None, int | None]:
    """Free and total bytes on the volume holding ``path``.

    Notes
    -----
    Walks up to the first parent that exists. The audit database is created
    lazily, so on a fresh install the configured path and often its directory
    are both absent, and reporting the volume they *would* land on is the useful
    answer rather than a blank.
    """
    candidate = Path(path).expanduser()
    for parent in [candidate, *candidate.parents]:
        if parent.exists():
            try:
                usage = shutil.disk_usage(parent)
            except OSError as exc:
                unavailable["disk"] = str(exc)
                return None, None
            return usage.free, usage.total
    unavailable["disk"] = f"no existing parent of {path}"
    return None, None


def _proc_memory(unavailable: dict) -> tuple[int | None, int | None]:
    """Resident and virtual bytes from ``/proc/self/statm``, the stdlib path.

    Notes
    -----
    ``statm`` reports pages, first field virtual and second resident, so both
    are multiplied by the page size. Linux only, which covers the VPS; the
    Windows development box gets the reason instead, which is the case the extra
    exists to fix.
    """
    try:
        fields = Path("/proc/self/statm").read_text().split()
    except OSError:
        unavailable["memory"] = NO_PROC if sys.platform != "linux" else NO_PSUTIL
        return None, None
    try:
        page = os.sysconf("SC_PAGE_SIZE")
        return int(fields[1]) * page, int(fields[0]) * page
    except (ValueError, IndexError, OSError, AttributeError) as exc:
        unavailable["memory"] = str(exc)
        return None, None


def _proc_open_files(unavailable: dict) -> int | None:
    """Open file descriptors from ``/proc/self/fd``, the stdlib path."""
    try:
        return len(os.listdir("/proc/self/fd"))
    except OSError:
        unavailable["open_files"] = NO_PROC if sys.platform != "linux" else NO_PSUTIL
        return None


def snapshot(audit_db: str) -> dict:
    """The resource block.

    Parameters
    ----------
    audit_db : str
        Configured path of the audit database, used to pick the volume whose
        free space is reported. It is the one file this process grows without
        bound, so it is the one worth watching.

    Returns
    -------
    dict
        ``source`` names which implementation answered. Every metric is present
        as a key with ``None`` where it could not be read, and ``unavailable``
        maps the missing ones to why. Callers render the reason; nothing here
        substitutes a zero.
    """
    unavailable: dict[str, str] = {}
    free, total = _disk(audit_db, unavailable)
    block = {
        "source": "psutil" if _process is not None else "stdlib",
        "platform": sys.platform,
        "rss_bytes": None,
        "vms_bytes": None,
        "cpu_percent": None,
        "threads": None,
        "open_files": None,
        "load_average": _load_average(unavailable),
        "disk_free_bytes": free,
        "disk_total_bytes": total,
        "unavailable": unavailable,
    }

    if _process is not None:
        try:
            memory = _process.memory_info()
            block["rss_bytes"] = int(memory.rss)
            block["vms_bytes"] = int(memory.vms)
            block["cpu_percent"] = round(float(_process.cpu_percent(interval=None)), 1)
            block["threads"] = int(_process.num_threads())
        except Exception as exc:  # noqa: BLE001 (the process can vanish under us)
            unavailable.setdefault("process", str(exc))
        # Descriptors are ``num_fds`` on Unix and ``num_handles`` on Windows, and
        # the two count different things, so the label travels with the number.
        counter = getattr(_process, "num_fds", None) or getattr(_process, "num_handles", None)
        if counter is None:
            unavailable["open_files"] = "no descriptor count on this platform"
        else:
            try:
                block["open_files"] = int(counter())
                block["open_files_kind"] = ("handles" if sys.platform == "win32"
                                            else "descriptors")
            except Exception as exc:  # noqa: BLE001
                unavailable["open_files"] = str(exc)
        return block

    if psutil is None:
        unavailable["source"] = NO_PSUTIL
    rss, vms = _proc_memory(unavailable)
    block["rss_bytes"] = rss
    block["vms_bytes"] = vms
    block["cpu_percent"] = _cpu_percent_stdlib()
    # ``threading.active_count`` counts Python threads only, so it misses the
    # ones uvicorn's C extensions own. Named so the page can say which it is.
    block["threads"] = threading.active_count()
    block["threads_kind"] = "python"
    block["open_files"] = _proc_open_files(unavailable)
    if block["open_files"] is not None:
        block["open_files_kind"] = "descriptors"
    return block
