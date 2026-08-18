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

import warnings
from functools import lru_cache
from pathlib import Path


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
    """
    from .config import get_settings

    custom = get_settings().library
    if not custom:
        from aggregate import build

        return build

    path = Path(custom)
    if not path.is_file():
        warnings.warn(
            f"AGGAPI_LIBRARY={custom!r} not found; using the shipped library",
            stacklevel=2,
        )
        from aggregate import build

        return build

    from aggregate import Underwriter

    uw = Underwriter(databases=(str(path),))
    uw.load()
    return uw
