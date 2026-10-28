"""FastAPI application factory.

``create_app()`` is the single entry point: it builds a fresh
:class:`fastapi.FastAPI`, installs CORS if configured, mounts the
``v1`` routers, serves the Excel add-in at ``/excel`` when it has been
built, serves each front end named in ``AGGAPI_APPS`` at ``/<name>/``, and
serves the web bundle at ``/`` when it is present.

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

import logging
from pathlib import Path

from aggregate import plugins as agg_plugins
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from . import __version__ as api_version
from . import apps, resources, status
from .config import Settings, get_settings
from .cors import install_cors
from .library import get_underwriter
from .loss_table_files import refuse_file_text
from .routes import decl as decl_routes
from .routes import examples as examples_routes
from .routes import meta as meta_routes
from .routes import objects as objects_routes
from .routes import status as status_routes

logger = logging.getLogger(__name__)


class GZipExceptParquet:
    """``GZipMiddleware`` for every path but a ``.parquet`` download.

    Parameters
    ----------
    app : ASGIApp
        The application downstream.
    **kwargs
        Passed to :class:`GZipMiddleware` (``minimum_size``, ``compresslevel``).

    Notes
    -----
    Starlette's middleware excludes nothing but ``text/event-stream``, and a
    Parquet body is zstd-compressed already, so the exclusion has to sit in
    front of it. Routing on the path suffix rather than on the response's
    content type keeps the decision before the response starts, where the
    middleware stack can still be bypassed whole.
    """

    def __init__(self, app: ASGIApp, **kwargs) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, **kwargs)
        self.kwargs = kwargs

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path", "").endswith(".parquet"):
            await self.app(scope, receive, send)
        else:
            await self.gzip(scope, receive, send)


def _load_plugins(settings: Settings) -> None:
    """Run third-party ``aggregate.plugins`` registrations, once per process.

    Parameters
    ----------
    settings : Settings
        Read for ``plugins_enabled`` and ``plugins_allow``.

    Notes
    -----
    The library does not auto-load on import, by design: ``build()`` has to be
    reproducible, so a notebook's answers must not depend on what happens to be
    installed. The host decides, and a server is a deployment that may declare
    what it trusts, which is why this is here and behind a setting.

    :func:`aggregate.plugins.load` is idempotent, so the many apps a test run
    builds pay for discovery once. It never raises: a plugin whose import or
    ``register()`` fails is recorded on its own :class:`~aggregate.plugins.LoadedPlugin`
    and skipped, and one broken experiment must not take the server down. The
    failure is logged here, at WARNING, **and** reported on ``GET /v1/meta``,
    because a plugin that silently did not load is otherwise debugged by
    wondering why a tab is empty.
    """
    if not settings.plugins_enabled:
        return
    loaded = agg_plugins.load(allow=settings.plugins_allow)
    for plugin in loaded:
        if plugin.ok:
            continue
        logger.warning("plugin %r failed to load and was skipped: %s",
                       plugin.name, plugin.error)


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
    # Then read it, here, before uvicorn serves anything. ``Underwriter.load()``
    # marks itself loaded before it reads, with no lock, so a second request
    # arriving during a first-request read gets a half-filled base and its
    # session forks that half for the TTL. The SPA's first page load fires two
    # requests at once, which is exactly that. Reading in the factory leaves
    # nothing to race. dev/done/plan-1.13.4-warm-library-at-startup.md.
    get_underwriter()
    # Process-lifetime facts for GET /v1/status. Both are idempotent and both
    # are here rather than at import time, because a module-level record would
    # be made when the first import happens rather than when the process starts
    # serving, and the second is the number an operator reads uptime against.
    # ``status.mark_started`` records once per process even though tests build
    # many apps: see its Notes for why an uptime that resets under a test client
    # would make every "since process start" label on the page a lie.
    status.mark_started()
    resources.seed()
    _load_plugins(settings)

    app = FastAPI(
        title="aggregate api",
        description=(
            "HTTP/JSON wrapper around the aggregate library. "
            "Stand up DecL parsing, FFT-based compound distributions, "
            "and risk-pricing as a web service."
        ),
        version=api_version,
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
    #
    # Level 6, not Starlette's default of 9. On a 52 MB portfolio density
    # frame level 9 took 1.7 s for 16.11 MB and level 6 took 0.75 s for
    # 16.23 MB: half the CPU for under 1% more on the wire. Once the frame
    # itself serializes in 0.08 s, the compressor was most of the request.
    #
    # A `.parquet` download is already zstd inside, so it goes around the
    # compressor: a second pass would spend the same CPU to save nothing.
    app.add_middleware(GZipExceptParquet, minimum_size=1024, compresslevel=6)

    install_cors(app, settings.cors_origins)

    # Mount all routers under /v1. FastAPI's include_router accepts
    # a prefix, similar to Flask's blueprint url_prefix kwarg.
    #
    # Every router that takes a program refuses a loss table file path from
    # outside the private network, before the handler runs and before anything
    # reaches the library. See loss_table_files.py. The status router is private
    # as a whole, so it goes without.
    public = [Depends(refuse_file_text)]
    app.include_router(meta_routes.router, prefix="/v1", tags=["meta"],
                       dependencies=public)
    app.include_router(objects_routes.router, prefix="/v1", tags=["objects"],
                       dependencies=public)
    app.include_router(decl_routes.router, prefix="/v1", tags=["decl"],
                       dependencies=public)
    app.include_router(examples_routes.router, prefix="/v1", tags=["examples"],
                       dependencies=public)
    # The operator's page. Mounted with the rest, and ahead of the static mount
    # below, which is why it lives under /v1: an unmatched top-level path falls
    # through to StaticFiles(html=True) and would be answered with index.html
    # rather than a 404, so a top-level /status could be shadowed by a
    # registration-order mistake and would fail by serving the SPA. Its own
    # routes are include_in_schema=False and behind require_private; the public
    # Caddy block 404s the whole /v1/status prefix before any of that is
    # reached. See routes/status.py.
    app.include_router(status_routes.router, prefix="/v1", tags=["status"])

    # The Excel add-in, when ``scripts/build-excel.ps1`` (or ``.sh``) has
    # built it. **Before** the ``/`` mount: Starlette matches mounts in order,
    # and ``/`` with ``html=True`` would answer ``/excel/...`` with the SPA's
    # index.html. Conditional on the directory existing, like the SPA, so the
    # first deploy needs one restart. Not gated on ``serve_spa``: a headless
    # server may still hand Excel its add-in.
    excel_dir = _resolve_excel_dir()
    if excel_dir.exists():
        app.mount("/excel", _NoCacheStaticFiles(directory=str(excel_dir)),
                  name="excel")

    static_dir = _resolve_static_dir(settings)

    # Other front ends, each from its own repository, named in AGGAPI_APPS.
    # Before ``/`` for the reason ``/excel`` is, and not gated on ``serve_spa``
    # either, so a headless server still serves its apps. ``no-cache`` so an edit
    # to an app's files shows on the next reload without a restart, and
    # ``html=True`` so ``/<name>/`` serves its index.html.
    #
    # The explicit redirect is needed because Starlette's own slash redirect
    # fires only when no route matches, and the SPA's ``/`` mount matches every
    # path, so without it ``/<name>`` is a 404 whenever the bundle is present.
    discovered = apps.discover(settings.apps, apps.reserved_names(static_dir))
    for front_end in discovered:
        app.add_route(f"/{front_end.name}", _redirect_to_trailing_slash,
                      methods=["GET"], name=f"app-{front_end.name}-slash",
                      include_in_schema=False)
        app.mount(f"/{front_end.name}",
                  _NoCacheStaticFiles(directory=str(front_end.directory), html=True),
                  name=f"app-{front_end.name}")
    app.state.apps = discovered

    # Static-file mount for the SPA (Plan D). Conditional because
    # the api ships independently of the web build; if the web
    # bundle isn't present, the api is api-only and ``/`` returns
    # 404 (which is fine for backend-only deploys).
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


class _NoCacheStaticFiles(StaticFiles):
    """``StaticFiles`` whose every response says ``Cache-Control: no-cache``.

    Notes
    -----
    For the Excel add-in, and for the front ends in ``AGGAPI_APPS``, whose
    files are not content hashed either. Office caches add-in files hard, so
    without this a deploy would not reach a workbook until that cache expired.
    ``no-cache`` still lets the client keep a copy; it must revalidate first, and the
    ``ETag`` ``StaticFiles`` sends makes that a 304 when nothing changed. So a
    deploy is picked up when the workbook reopens, for the price of one
    conditional request per file.
    """

    async def get_response(self, path, scope):
        """Serve ``path`` as ``StaticFiles`` does, then mark it ``no-cache``."""
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


async def _redirect_to_trailing_slash(request: Request) -> RedirectResponse:
    """Send ``/<name>`` to ``/<name>/``, keeping the query string.

    Parameters
    ----------
    request : Request
        A GET for an app's bare name.

    Returns
    -------
    RedirectResponse
        307 to the same path with a trailing slash.

    Notes
    -----
    An app's paths are relative, so its page has to be loaded from the
    directory URL or ``style.css`` resolves against the root. The ``Location``
    is relative too: an absolute one would be built from the scope, and behind
    a proxy that is right only when the forwarded headers are, while a relative
    one resolves against whatever the browser asked for. The query string goes
    along so ``/asp?api=...`` arrives at ``/asp/?api=...``.
    """
    target = f"{request.url.path}/"
    if request.url.query:
        target = f"{target}?{request.url.query}"
    return RedirectResponse(target, status_code=307)


def _resolve_excel_dir() -> Path:
    """Where ``scripts/build-excel.ps1`` writes the Excel add-in.

    Returns
    -------
    pathlib.Path
        ``excel_static/`` beside this file, which may not exist.

    Notes
    -----
    A directory of its own rather than a subdirectory of ``static/``, because
    the SPA's build empties ``static/assets`` and Vite owns that tree. It is
    gitignored and kept out of the wheel: the production manifest inside it
    names ``https://agg.mynl.com/excel``, which is right for one deployment
    and wrong for every other.
    """
    return Path(__file__).resolve().parent / "excel_static"


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
