"""The recipe base every build in this process resolves against.

One underwriter, reached through :func:`get_underwriter`, and every path that
parses a program or reads a recipe goes through it. Before this module the api
had two: ``examples.py`` built a private :class:`Underwriter` for the menu when
``--library`` was set, while all three build paths used ``aggregate.build``, the
shipped singleton. That split is invisible under the default library, because
both are then the same object, and is wrong under a custom one:

* an entry is browsable in the Examples menu but any entry referencing a sibling
  by name fails to build, because the base the parser resolves against never
  read the file;
* the ``.agg`` download lists the session rows of a base the menu did not come
  from.

Why a function and not a module-level object: the library is chosen by a setting
read at process start, and tests flip that setting per case. ``lru_cache`` gives
the singleton without the import-time evaluation a module-level object would
force, matching :func:`aggregate_api.config.get_settings`, and
``create_app`` clears it for the same reason it clears that one.

The base is process-global and mutable: ``build(program)`` registers what it
parses. Whether that base is shared or per session is a question for the session
work; this module answers only "which library", and answers it once.
"""

from __future__ import annotations

import time
import warnings
from functools import lru_cache
from pathlib import Path

from . import status


@lru_cache(maxsize=1)
def get_underwriter():
    """Return the ``Underwriter`` whose recipe base backs this process.

    Defaults to ``aggregate.build``, the shipped singleton loaded from
    ``library.agg``. ``AGGAPI_LIBRARY`` overrides it with a custom ``.agg``: a
    private :class:`Underwriter` is pointed at that file via ``databases=`` and
    loaded, so a curated library goes through exactly the same recipe machinery
    as the shipped one.

    Returns
    -------
    aggregate.underwriter.Underwriter

    Notes
    -----
    A configured but missing path warns and falls back rather than failing every
    route, which is right for a stale setting on a server. The ``--library``
    flag is deliberately stricter and exits instead: see
    :func:`aggregate_api.__main__.resolve_library` for why the asymmetry is
    intended rather than an oversight.

    **The load is explicit and timed**, for ``GET /v1/status``. ``load()`` with
    no argument is idempotent (it returns an empty list once the configured
    request has been read), so calling it here costs nothing when the base is
    already loaded and moves nothing when it is not: every caller reaches this
    base through ``fork()``, which loads the parent itself. What it buys is a
    number. The recorded figure is what *this* call paid, so a process reading
    the shipped library reports a near-zero time, correctly: the read happened
    when ``aggregate`` was imported, not here. A custom ``.agg`` reports the
    real cost of reading it, which is the case where the number is worth
    knowing.
    """
    from .config import get_settings

    started = time.monotonic()
    custom = get_settings().library
    if not custom:
        from aggregate import build

        uw = build
    else:
        path = Path(custom)
        if not path.is_file():
            warnings.warn(
                f"AGGAPI_LIBRARY={custom!r} not found; using the shipped library",
                stacklevel=2,
            )
            from aggregate import build

            uw = build
        else:
            from aggregate import Underwriter

            uw = Underwriter(databases=(str(path),))
    uw.load()
    status.record_library_load((time.monotonic() - started) * 1000)
    return uw


# The stem the shipped singleton is read from, and so the default database when
# no custom library is configured.
SHIPPED_LIBRARY = "library"


def _custom_library() -> Path | None:
    """The configured custom ``.agg``, when it exists, else ``None``.

    Mirrors the test :func:`get_underwriter` applies, so the listing names the
    file the process base was actually read from: a configured but missing path
    falls back to the shipped library there, and is not listed here.
    """
    from .config import get_settings

    custom = get_settings().library
    if custom and Path(custom).is_file():
        return Path(custom)
    return None


def shipped_databases() -> list[dict]:
    """The ``.agg`` files the Examples menu may read, the default first.

    Returns
    -------
    list of dict
        ``{"name": stem, "default": bool, "path": str or None}`` per file. The
        default is the process base: the custom library when one is configured,
        else ``library``. The rest follow alphabetically. ``path`` is for the
        loader and never leaves the process.

    Notes
    -----
    **Only the package's own directory.** ``available_databases()`` also reports
    the ``cwd`` and ``user`` (``~/.aggregate``) rows, and both are excluded on
    purpose: on a server ``cwd`` is wherever the process happened to be
    launched, and on the author's machine the user directory may hold private
    files. Stems starting with ``_`` (the library's own test suites) are
    excluded too.

    Not cached: three directory globs cost nothing beside a request, and an
    uncached listing follows a reinstalled ``aggregate`` without a restart.
    """
    from aggregate import build

    frame = build.available_databases()
    shipped = frame[(frame["where"] == "default")
                    & ~frame["name"].str.startswith("_")]
    custom = _custom_library()
    default_name = custom.stem if custom else SHIPPED_LIBRARY
    rows = [{"name": default_name, "default": True,
             "path": str(custom) if custom else None}]
    for name, path in sorted(zip(shipped["name"], shipped["path"])):
        # The shipped library is the default unless a custom file displaced it,
        # and then it is listed like any other shipped file. A custom file whose
        # stem matches a shipped one shadows it rather than listing it twice.
        if name != default_name:
            rows.append({"name": name, "default": False, "path": path})
    return rows


@lru_cache(maxsize=16)
def get_database_underwriter(name: str):
    """A private ``Underwriter`` over one non-default shipped ``.agg`` file.

    Parameters
    ----------
    name : str
        A stem :func:`shipped_databases` lists with ``default`` false.

    Returns
    -------
    aggregate.underwriter.Underwriter
        Loaded, and cached for the process on `name`.

    Raises
    ------
    KeyError
        `name` is not a listed non-default file. It is matched against the
        listing and **never** used as a path, so ``../x`` cannot reach a read.
    Exception
        Whatever ``Underwriter.load`` raises on the file's first bad statement.
        One bad statement fails the whole file; ``lru_cache`` does not cache the
        failure, so a fixed file is picked up on the next request.

    Notes
    -----
    A view for the Examples menu only. Builds still run in the session's fork
    of the process base, so an entry from another file builds when it is self
    contained or refers only to ``library.agg`` entries, which holds for every
    file this serves (author, 2026-10-12). ``maxsize`` covers the handful of
    shipped files with room to spare.
    """
    from aggregate import Underwriter

    for row in shipped_databases():
        if row["name"] == name and not row["default"]:
            uw = Underwriter(databases=(row["path"],))
            uw.load()
            return uw
    raise KeyError(name)
