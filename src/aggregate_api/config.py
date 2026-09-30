"""Settings for the api, driven by environment variables.

The :class:`Settings` class is built on ``pydantic-settings`` --
a small wrapper around Pydantic that reads env vars (prefixed
``AGGAPI_``) and validates them through the usual Pydantic
machinery. The end result is a typed, validated config object
loaded once at process start.

Flask users: this replaces ``app.config[...]``. The pattern of
"build a settings object once, inject it everywhere" is a FastAPI
idiom -- routes pull the live settings via the
:func:`get_settings` dependency (used with ``Depends``), not via
a global.

To override a value at runtime, set the env var before launching
``aggregate-api`` (e.g. ``AGGAPI_LOG2_CAP=20 aggregate-api``) or
pass it through ``monkeypatch.setenv`` in tests.

The defaults are the team-deploy preset: localhost-only bind,
modest log2 cap, 10 s build timeout, 50 objects in the cache.
"""

from __future__ import annotations

import os
import warnings
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .net import DEFAULT_PRIVATE_CIDRS, parse_cidrs


class Settings(BaseSettings):
    """Process-wide configuration.

    All knobs come from env vars beginning with ``AGGAPI_``.
    Empty strings on list-typed fields mean "unset" rather than
    "single empty element" -- see :meth:`_parse_cors_origins`.
    """

    # ``model_config`` is the Pydantic v2 idiom for class-level
    # config (it replaces v1's inner ``class Config``). ``env_prefix``
    # tells pydantic-settings to look for AGGAPI_HOST -> ``host``,
    # AGGAPI_PORT -> ``port``, etc. ``extra='ignore'`` lets us run
    # in an environment with unrelated env vars without complaint.
    model_config = SettingsConfigDict(
        env_prefix="AGGAPI_",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------
    # Network / server
    # ------------------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8000

    # ------------------------------------------------------------------
    # Build pipeline
    # ------------------------------------------------------------------
    # Default log2 if the client omits it.
    log2_default: int = 16
    # Hard cap: requests above this fail with HTTP 422 (limit_exceeded).
    # The cap exists because 2**N grid points * sizeof(float) is the
    # FFT memory cost; 2**20 is ~8 MB per density array and is well
    # past anything legitimate users need on a team-deploy box.
    log2_cap: int = 18
    # Per-build wall-clock timeout; expires via threadpool.future.
    build_timeout_s: float = 10.0

    # ------------------------------------------------------------------
    # Cache
    # ------------------------------------------------------------------
    cache_max: int = 50

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------
    # How many forked recipe bases to hold, and how long an idle one lives.
    # A fork is microseconds and a few hundred kilobytes, so the count is
    # deliberately generous and the TTL is what bounds the memory. Eight hours
    # outlives any sitting a browser tab survives; ttl 0 disables expiry.
    session_max: int = 500
    session_ttl_s: float = 28800.0

    # ------------------------------------------------------------------
    # Audit log
    # ------------------------------------------------------------------
    # Default is per-user data dir; resolved lazily in audit.py so the
    # directory is only created when an AuditLog is actually opened.
    audit_db: str = str(Path.home() / ".aggregate" / "api" / "audit.db")

    # No plotting settings any more. `plot_default_format` chose svg or png for
    # the server-rendered figure route, which left with matplotlib at a60: every
    # chart is a document now and the browser decides how to draw and export it,
    # so there is no server-side image format to have an opinion about.

    # ------------------------------------------------------------------
    # Charts
    # ------------------------------------------------------------------
    # Ceiling on the chart route's ``detail`` parameter, the target cells
    # per axis of a reduced surface grid.
    #
    # A setting rather than a constant because one route serves two cases
    # that want opposite things. Over the wire the answer is a windowed
    # grid of a few thousand cells and a payload in kilobytes; locally it
    # is a drill-down into fine detail on a machine where bandwidth is not
    # a constraint, and a hard cap there would prevent a use in order to
    # prevent nothing. What stops a client misrepresenting what it got is
    # the document (it reports the realized ``k``, ``bs``, ``nx``, ``ny``),
    # not this number.
    #
    # The public deploy sets AGGAPI_MAX_CHART_DETAIL=256, because chart
    # GETs sit outside the Caddy rate limiter and each parameter
    # combination is a fresh reduction. VPN and local runs keep this
    # default. See dev/plan-3d-plot.md sections 3.1 and 7 answer 2.
    max_chart_detail: int = 1024

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    # Comma-separated list in the env var. Empty -> middleware skipped
    # (same-origin deploys don't pay the per-request CORS handling).
    # ``validation_alias`` overrides the auto-derived AGGAPI_CORS_ORIGINS_RAW
    # name so the env var stays AGGAPI_CORS_ORIGINS (matches docs).
    cors_origins_raw: str = Field(
        default="",
        validation_alias="AGGAPI_CORS_ORIGINS",
    )

    # ------------------------------------------------------------------
    # Static files (Plan D web build)
    # ------------------------------------------------------------------
    # When set, overrides the importlib-resources discovery in
    # app.py. Lets a developer point the running api at a Vite dev
    # build sitting in a sibling tree without reinstalling.
    static_dir: str = ""

    # Whether to serve the SPA at all. False leaves the api headless: the /v1
    # routers, /docs and /openapi.json, and nothing at /.
    #
    # A setting rather than a fact about the filesystem. Headless already worked
    # by accident, because the mount in app.py is conditional on the bundle
    # directory existing and `static/` is gitignored and built at deploy, so an
    # install that never ran the web build is api-only. But "I did not build the
    # SPA" is not a way to *say* headless: it cannot be set on a machine that has
    # the bundle, it is invisible in the config, and the only explicit off was
    # pointing static_dir at a path that does not exist. This states the
    # intention instead.
    #
    # /docs is unaffected. FastAPI registers the doc routes in its constructor,
    # before create_app mounts anything, and Starlette matches in registration
    # order, so this only removes the catch-all at the end.
    serve_spa: bool = True

    # ------------------------------------------------------------------
    # The library
    # ------------------------------------------------------------------
    # When set, the whole process reads its recipes from this .agg file instead
    # of aggregate's bundled library.agg: the Examples dropdown, every build,
    # and the .agg download all resolve against it (see library.py). Lets a
    # deploy ship a curated set without rebuilding the SPA, since the menu is
    # fetched at runtime from GET /v1/examples. Re-read on server restart.
    #
    # Named AGGAPI_EXAMPLES_FILE until a109, when it stopped being about
    # examples: it feeds builds now, so it is the library. The old name is
    # accepted for one release and warns, hence the two-name alias rather than a
    # plain field. ``validation_alias`` bypasses ``env_prefix``, so both names
    # are spelled in full.
    library: str = Field(
        default="",
        validation_alias=AliasChoices("AGGAPI_LIBRARY", "AGGAPI_EXAMPLES_FILE"),
    )

    # ------------------------------------------------------------------
    # The status page
    # ------------------------------------------------------------------
    # Which client addresses may reach /v1/status and /v1/status/page. Loopback,
    # IPv6 loopback, and the VPN subnet from human-hints.md.
    #
    # A setting rather than a constant because the VPN subnet is a deployment
    # fact, and the list is the second of three layers rather than the only one:
    # the public Caddy block 404s the /v1/status prefix before the app is
    # reached at all. See net.py for why this cannot be written as "allow if the
    # peer is loopback" (both front doors proxy to 127.0.0.1, so that rule would
    # publish the page) and for the single-hop assumption the gate rests on.
    #
    # ``validation_alias`` so the env var stays AGGAPI_PRIVATE_CIDRS rather than
    # the auto-derived AGGAPI_PRIVATE_CIDRS_RAW, matching the CORS field above.
    private_cidrs_raw: str = Field(
        default=DEFAULT_PRIVATE_CIDRS,
        validation_alias="AGGAPI_PRIVATE_CIDRS",
    )

    # Layer three: demand X-Aggapi-Zone: private, which the VPN Caddy block sets
    # and the public block strips. Off by default (author ruling, 2026-08-18):
    # layer two is sufficient, and this one couples the app to a Caddyfile edit
    # in a way that fails closed but confusingly, the page simply stopping. It
    # ships built and documented because it is the only layer that survives a
    # mistake in the CIDR list, so turning it on is a setting rather than a
    # change.
    status_require_zone_header: bool = False

    # Seconds between the page's automatic refreshes. The page carries a pause
    # control, so this is the starting cadence rather than a policy.
    status_refresh_s: float = 10.0

    # ------------------------------------------------------------------
    # Plugins
    # ------------------------------------------------------------------
    # Whether this process runs third-party `aggregate.plugins` registrations.
    #
    # The library deliberately does **not** auto-load on `import aggregate`, so
    # that `build()` stays reproducible and a notebook's results are a function
    # of the notebook's own text. The decision belongs to the host, and a server
    # is a deployment, so it is a setting here rather than a fact about what
    # happens to be installed.
    #
    # On by default: the case that exists is a local deployment running the
    # author's own plugin packages. A plugin is Python in this process with full
    # privileges and there is no sandbox, which is acceptable while the bind is
    # 127.0.0.1 and the packages are the author's own, and is exactly why the
    # allowlist below exists for the case where neither holds.
    plugins_enabled: bool = True

    # Which plugins to admit, by name. Empty means all of them, which is what a
    # local deployment wants. A comma-separated list admits only those named, so
    # a hosted deployment can state what it trusts rather than inheriting
    # whatever is on the image.
    #
    # ``validation_alias`` so the env var stays AGGAPI_PLUGINS_ALLOW rather than
    # the auto-derived AGGAPI_PLUGINS_ALLOW_RAW, matching the CORS and CIDR
    # fields above.
    plugins_allow_raw: str = Field(
        default="",
        validation_alias="AGGAPI_PLUGINS_ALLOW",
    )

    # ------------------------------------------------------------------
    # Derived properties
    # ------------------------------------------------------------------
    @property
    def plugins_allow(self) -> list[str] | None:
        """Parse ``AGGAPI_PLUGINS_ALLOW`` into an allowlist, or None for all.

        Returns
        -------
        list of str or None
            None where the setting is empty, which is what
            :func:`aggregate.plugins.load` takes to mean "admit everything
            discovered". An empty *list* would mean the opposite, admit nothing,
            so the distinction is load bearing and is not a tidied-away falsy
            check.
        """
        raw = self.plugins_allow_raw.strip()
        if not raw:
            return None
        return [name.strip() for name in raw.split(",") if name.strip()]

    @property
    def cors_origins(self) -> list[str]:
        """Parse ``AGGAPI_CORS_ORIGINS`` into a list of origins."""
        raw = self.cors_origins_raw.strip()
        if not raw:
            return []
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def private_cidrs(self) -> tuple:
        """Parse ``AGGAPI_PRIVATE_CIDRS`` into networks.

        Raises
        ------
        ValueError
            On a malformed entry, from :func:`aggregate_api.net.parse_cidrs`.
            Loud on purpose: a typo here is a gate that allows the wrong set,
            and a route that refuses to answer says so more clearly than a page
            that has quietly stopped working.

        Notes
        -----
        Parsed per read rather than cached on the instance, because ``Settings``
        is itself the cached singleton and the list is a handful of networks. A
        cached property here would only add a second place for a stale value to
        live.
        """
        return parse_cidrs(self.private_cidrs_raw)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached process-wide settings.

    ``lru_cache`` makes this an effective singleton without the
    pitfalls of a module-level mutable -- and FastAPI's
    ``Depends(get_settings)`` knows how to use it directly.

    Tests that flip env vars via ``monkeypatch.setenv`` must call
    :func:`get_settings.cache_clear` (handled centrally by the
    ``client`` fixture in ``tests/api/conftest.py``) so the next
    read re-evaluates the environment.

    Notes
    -----
    The deprecation notice for ``AGGAPI_EXAMPLES_FILE`` lives here rather than
    on the field, because a field validator sees only the value that won and
    cannot tell which of the two names supplied it. Warning once per settings
    read is right: the cache makes that once per process in production, and once
    per case in a test that clears it.
    """
    if "AGGAPI_EXAMPLES_FILE" in os.environ and "AGGAPI_LIBRARY" not in os.environ:
        warnings.warn(
            "AGGAPI_EXAMPLES_FILE is deprecated and will be removed after one "
            "release; use AGGAPI_LIBRARY. The setting now feeds every build, "
            "not just the Examples menu.",
            DeprecationWarning,
            stacklevel=2,
        )
    return Settings()


# Module-level alias for code that doesn't need DI -- e.g. ``__main__.py``
# launching uvicorn off a single ``settings.host``/``port`` read.
# Reaches through the cache so tests with cleared cache still see
# the right object.
def _settings_attr(name: str):
    """Pass-through accessor that always reads from the cached object."""
    return getattr(get_settings(), name)


class _SettingsProxy:
    """Lazy attribute proxy so ``settings.host`` always hits live config.

    Avoids the trap of ``settings = Settings()`` at import time, which
    would lock in env-var values from before tests had a chance to
    monkeypatch them.
    """

    def __getattr__(self, name):
        return _settings_attr(name)


settings = _SettingsProxy()
