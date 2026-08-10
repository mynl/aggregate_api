"""Telling the library's warnings from everyone else's.

``warnings.catch_warnings(record=True)`` plus ``simplefilter('always')`` is the
only way to capture what ``aggregate`` says on its way to an answer, and it is a
blunt instrument: the filters are process global and ``'always'`` lifts the
default suppressions, so the block catches every warning raised anywhere in the
interpreter for as long as it is open, including ones this service provokes
about itself.

That is not hypothetical. The api's audit log leaked sqlite connections until
a70, and a garbage collection landing inside a capture block reported
``unclosed database in <sqlite3.Connection ...>`` as something the reader's
program had done. The leak is fixed; this module is the other half, and it is
the half that keeps the *next* stray warning, from any library in the
environment, out of a reader's face.

Every capture site in this package goes through :func:`library_warnings`, and
the one site that also needs the logging channel (the build route) uses
:func:`from_library` directly inside its own richer context manager.

The test is **path containment, not the category and not the name.** A library
``UserWarning`` is indistinguishable from anyone else's by type, and
``aggregate_api`` contains the string ``aggregate``, so a substring test would
claim this service's own warnings as the library's.
"""

from __future__ import annotations

import warnings
from contextlib import contextmanager
from pathlib import Path

import aggregate as _aggregate_pkg

#: Where the ``aggregate`` package lives on disk. Resolved once at import: the
#: path cannot move while the process runs, and ``Path.resolve`` on every
#: warning of every build would be work for an answer that never changes.
_LIBRARY_ROOT = str(Path(_aggregate_pkg.__file__).resolve().parent)


def from_library(filename: str) -> bool:
    """Was this warning raised from inside ``aggregate``?

    Parameters
    ----------
    filename : str
        ``warnings.WarningMessage.filename``, the source file of the
        ``warn()`` call.

    Returns
    -------
    bool
        True when the file sits under the installed ``aggregate`` package.

    Notes
    -----
    Resolved on both sides so a junctioned or symlinked checkout compares
    equal, which this repo's ``.venv`` arrangement makes a live concern rather
    than a theoretical one.
    """
    if not filename:
        return False
    try:
        return Path(filename).resolve().is_relative_to(_LIBRARY_ROOT)
    except (OSError, ValueError):  # pragma: no cover -- unresolvable path
        return False


@contextmanager
def library_warnings():
    """Capture ``warnings.warn`` from ``aggregate``, and only from it.

    Yields
    ------
    list of str
        Empty while the block runs and filled on exit, so callers extend their
        own list *after* the ``with``, not inside it.

    Examples
    --------
    >>> with library_warnings() as caught:      # doctest: +SKIP
    ...     panel = obj.evaluate(premium)
    >>> warns.extend(caught)                    # doctest: +SKIP

    Notes
    -----
    Filled on exit rather than as each warning arrives because
    ``catch_warnings(record=True)`` hands back a list it appends to itself, and
    the filtering has to happen once that list is complete.
    """
    kept: list[str] = []
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        yield kept
        kept.extend(str(w.message) for w in caught
                    if from_library(getattr(w, "filename", "")))
