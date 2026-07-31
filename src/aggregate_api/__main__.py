"""Entry point for ``python -m aggregate_api`` and ``aggregate-api``.

This is the bootstrap that turns the :func:`create_app` factory
into a running uvicorn process. CLI flags (``--host``, ``--port``,
``--reload``, ``--library``) override the env-var-driven config; with
no flags the server picks up everything from ``AGGAPI_*``.

``--library`` points the Examples dropdown at an alternate ``.agg``
instead of ``aggregate``'s shipped ``library.agg``, which is how you
get a short list to review against.

Flask users
-----------

Equivalent to ``flask run`` -- but with the production server
(uvicorn) baked in. There's no equivalent of Flask's dev/prod
switch; uvicorn is fast enough to be both, and ``--reload``
gives you the dev-mode file-watching behavior.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def resolve_library(raw: str) -> str:
    """Validate a ``--library`` path and return it absolute.

    Parameters
    ----------
    raw : str
        The path as typed.

    Returns
    -------
    str
        The resolved absolute path.

    Raises
    ------
    SystemExit
        If the path is not a readable file.

    Notes
    -----
    Deliberately stricter than the environment variable it feeds.
    ``examples.py`` warns and falls back to the shipped library when
    ``AGGAPI_EXAMPLES_FILE`` names a missing file, which is right for a stale
    setting on a server. It is wrong for a flag typed on purpose: falling back to
    the full library is the exact outcome someone passing ``--library`` is trying
    to avoid, and a warning scrolling past in a server log is not a refusal. So
    this exits, naming the path it could not read.

    Absolute because the api resolves the library through an ``Underwriter``
    pointed at the file's directory, and a relative path would be read against
    whatever the working directory happens to be by then.
    """
    path = Path(raw).expanduser()
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise SystemExit(f"aggregate-api: --library: no such file: {path}") from None
    if not resolved.is_file():
        raise SystemExit(f"aggregate-api: --library: not a file: {resolved}")
    return str(resolved)


def main() -> None:
    """Parse CLI flags and launch uvicorn."""
    parser = argparse.ArgumentParser(
        prog="aggregate-api",
        description="Launch the aggregate api (FastAPI + uvicorn).",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="Bind address (defaults to AGGAPI_HOST, then 127.0.0.1).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="TCP port (defaults to AGGAPI_PORT, then 8000).",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Auto-reload on source changes (dev only -- prohibits "
             "multi-worker mode and adds a watchgod thread).",
    )
    parser.add_argument(
        "--library",
        default=None,
        metavar="PATH",
        help="Load the Examples library from this .agg file instead of "
             "aggregate's shipped library.agg. A short library makes review "
             "quicker. Same as AGGAPI_EXAMPLES_FILE, but it fails rather than "
             "falling back when the path is wrong.",
    )
    args = parser.parse_args()

    # Set the environment, not the Settings object. `--reload` builds the app in
    # a *child* process, which inherits os.environ and would never see a value
    # poked into this process's cached Settings. It also has to happen before the
    # first `get_settings()` below, which caches.
    if args.library is not None:
        os.environ["AGGAPI_EXAMPLES_FILE"] = resolve_library(args.library)

    # Import inside ``main`` so ``aggregate-api --help`` doesn't pay
    # the cost of loading FastAPI / uvicorn / aggregate.
    import uvicorn

    from .config import get_settings

    settings = get_settings()
    if args.library is not None:
        print(f"examples library: {settings.examples_file}", file=sys.stderr)
    # The ``factory=True`` flag tells uvicorn that the target is a
    # *callable* returning an app rather than an app instance --
    # so we hand it ``aggregate_api.app:create_app`` and it calls
    # the factory itself. This plays nicely with --reload: the
    # factory re-runs on each worker restart, picking up code edits.
    uvicorn.run(
        "aggregate_api.app:create_app",
        factory=True,
        host=args.host or settings.host,
        port=args.port or settings.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
