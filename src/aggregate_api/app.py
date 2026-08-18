"""FastAPI application factory.

``create_app()`` is the single entry point: it builds a fresh
:class:`fastapi.FastAPI`, installs CORS if configured, mounts the
``v1`` routers, and -- if the Plan D web bundle is present --
serves it as static files at ``/``.

Flask users
-----------

The factory pattern (``create_app``) lets uvicorn launch the app
lazily (one app per worker) and lets tests build a fresh instance
per test if they want. The Flask-equivalent is the standard
"application factory" used by larger Flask apps.

Routing model
-------------

Each ``routes/*.py`` module defines an :class:`APIRouter`
(``router`` global). The factory mounts all of them under
``/v1``. The OpenAPI schema (``/openapi.json``) and the
Swagger UI (``/docs``) are added by FastAPI automatically.
"""

from __future__ import annotations

from importlib.metadata import version as _pkg_version
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from . import resources, status
from .config import Settings, get_settings
from .cors import install_cors
from .library import get_underwriter
from .routes import decl as decl_routes
from .routes import examples as examples_routes
from .routes import meta as meta_routes
from .routes import objects as objects_routes
from .routes import status as status_routes


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI app.

    Parameters
    ----------
    settings : Settings | None
        Optional pre-built settings object. ``None`` means "read
        from environment via :func:`get_settings`" -- the normal
        path. Tests can inject a custom ``Settings`` to bypass
        env-var setup.

    Returns
    -------
    FastAPI
        Configured app, routers mounted, ready for uvicorn.
    """
    if settings is None:
        # Force a fresh read so config-affecting monkeypatches in
        # tests are honored. Cache the result so subsequent
        # ``Depends(get_settings)`` calls return the same object.
        get_settings.cache_clear()
        settings = get_settings()
    # Drop cached cache+audit singletons -- the next request
    # rebuilds them against the (possibly just-changed) config.
    objects_routes.reset_singletons()
    # And the underwriter, for the same reason: which library it reads is a
    # setting, and a test that just changed that setting would otherwise get the
    # base built for the previous case.
    get_underwriter.cache_clear()
    # Process-lifetime facts for GET /v1/status. Both are idempotent and both
    # are here rather than at import time, because a module-level record would
    # be made when the first import happens rather than when the process starts
    # serving, and the second is the number an operator reads uptime against.
    # ``status.mark_started`` records once per process even though tests build
    # many apps: see its Notes for why an uptime that resets under a test client
    # would make every "since process start" label on the page a lie.
    status.mark_started()
    resources.seed()

    app = FastAPI(
        title="aggregate api",
        description=(
            "HTTP/JSON wrapper around the aggregate library. "
            "Stand up DecL parsing, FFT-based compound distributions, "
            "and risk-pricing as a web service."
        ),
        version=_pkg_version("aggregate_api"),
        # Disable the default Pydantic-validation 422 schema in
        # OpenAPI -- it's noisy and we override the parse path
        # with our own ErrorReport response model.
    )

    # Compress responses. A density payload is the whole point: the exhibits ask
    # for every grid point (2**16 rows), which is 3.6 MB of JSON for one
    # aggregate and 7 MB for a portfolio's per-unit frame. Those are floats
    # rendered as decimal text, so they compress about 10 to 1: 0.35 MB and
    # 1.3 MB on the wire, which is what an image costs.
    #
    # 1 kB minimum, so a health check or a one-row pentagon is not worth the
    # round trip through zlib. Installed before CORS so the middleware stack
    # unwinds with CORS headers on the outside, where a browser needs them even
    # on a compressed response.
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    install_cors(app, settings.cors_origins)

    # Mount all routers under /v1. FastAPI's include_router accepts
    # a prefix, similar to Flask's blueprint url_prefix kwarg.
    app.include_router(meta_routes.router, prefix="/v1", tags=["meta"])
    app.include_router(objects_routes.router, prefix="/v1", tags=["objects"])
    app.include_router(decl_routes.router, prefix="/v1", tags=["decl"])
    app.include_router(examples_routes.router, prefix="/v1", tags=["examples"])
    # The operator's page. Mounted with the rest, and ahead of the static mount
    # below, which is why it lives under /v1: an unmatched top-level path falls
    # through to StaticFiles(html=True) and would be answered with index.html
    # rather than a 404, so a top-level /status could be shadowed by a
    # registration-order mistake and would fail by serving the SPA. Its own
    # routes are include_in_schema=False and behind require_private; the public
    # Caddy block 404s the whole /v1/status prefix before any of that is
    # reached. See routes/status.py.
    app.include_router(status_routes.router, prefix="/v1", tags=["status"])

    # Static-file mount for the SPA (Plan D). Conditional because
    # the api ships independently of the web build; if the web
    # bundle isn't present, the api is api-only and ``/`` returns
    # 404 (which is fine for backend-only deploys).
    static_dir = _resolve_static_dir(settings)
    if static_dir is not None and static_dir.exists():
        # ``html=True`` tells StaticFiles to serve index.html for /
        # *and* fall back to it for unknown paths -- the SPA-style
        # client-side routing behavior the web app needs.
        app.mount(
            "/",
            StaticFiles(directory=str(static_dir), html=True),
            name="static",
        )

    return app


def _resolve_static_dir(settings: Settings) -> Path | None:
    """Locate the SPA bundle directory.

    Order of precedence:

    0. ``AGGAPI_SERVE_SPA=0`` (``settings.serve_spa``) refuses outright, which
       is what ``aggregate-api --headless`` sets. Ahead of the other two so
       this stays the single place that decides whether to mount, rather than
       adding a second condition at the mount site.
    1. ``AGGAPI_STATIC_DIR`` env var (handed via ``settings.static_dir``).
       Useful for developing the SPA out of a separate tree.
    2. ``src/aggregate_api/static`` inside the installed package.

    Returns None if serving is off, or if neither location is set / exists.
    """
    if not settings.serve_spa:
        return None
    if settings.static_dir:
        return Path(settings.static_dir)
    # importlib.resources style: the static dir lives next to
    # this file. We use Path rather than files() because StaticFiles
    # needs a real filesystem path, not a Traversable.
    pkg_root = Path(__file__).resolve().parent
    return pkg_root / "static"
