"""Meta routes: health check, config introspection, and the plot style.

Routes
------

* ``GET /v1/health``: liveness probe (``{ok: true, version,
  aggregate_version}``). Used by Caddy / k8s health checks and by
  the SPA's "server up?" splash logic.
* ``GET /v1/meta``: runtime config (log2_cap, build_timeout, etc.)
  so the SPA can configure its form widgets (e.g. set the log2
  slider's max to ``log2_cap``).
* ``GET /v1/meta/style``: the house plot style, read off
  ``aggregate.style``, so the SPA's interactive charts and the
  server-rendered matplotlib plots cannot drift apart.

These are cheap reads; they don't touch the cache or audit log.
"""

from __future__ import annotations

from functools import lru_cache
from importlib.metadata import version as _pkg_version

from fastapi import APIRouter, Depends

from .. import models
from ..config import Settings, get_settings


# APIRouter is FastAPI's analogue of a Flask Blueprint -- a group
# of routes that the app factory mounts at a prefix.
router = APIRouter()


@router.get("/health", response_model=models.HealthResponse)
def health() -> dict:
    """Trivial liveness check.

    Returns both the api package version (``version``) and the
    underlying ``aggregate`` library version (``aggregate_version``)
    so a curl-from-prod debugging session can confirm which build of
    each it's talking to without an OpenAPI fetch.
    """
    return {
        "ok": True,
        "version": _pkg_version("aggregate_api"),
        "aggregate_version": _pkg_version("aggregate"),
    }


# Fallbacks for a style key ``aggregate.style`` does not set. These are the
# values the shipped style uses today, so a miss degrades to the same look
# rather than to browser defaults.
_STYLE_FALLBACK = {
    "colors": ["#0d6efd", "#dc3545", "#198754", "#eaab00",
               "#6f42c1", "#0aa2c0", "#d63384", "#6c757d"],
    "grid_color": "#dee2e6",
    "text_color": "#212529",
    "line_width": 1.4,
    "font_size": 8.5,
}


@lru_cache(maxsize=1)
def _plot_style() -> dict:
    """Read the house plot style out of ``aggregate.style``.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.StyleResponse`.

    Notes
    -----
    This exists so the SPA's interactive charts and the server-rendered
    matplotlib plots are the same colors **by construction** rather than by two
    copies of the same hex list drifting apart. The color cycle is the one
    thing that would be noticed immediately if it did.

    ``rc_params()`` returns a matplotlib rc mapping, where the cycle is an
    ``axes.prop_cycle`` ``Cycler`` rather than a plain list, so it is walked
    once here and cached. Every key is read defensively: a style that stops
    setting one falls back rather than 500ing a route the front page calls on
    load.
    """
    style = dict(_STYLE_FALLBACK)
    try:
        from aggregate import style as agg_style

        rc = agg_style.rc_params()
    except Exception:  # noqa: BLE001 (a missing style must not break the page)
        return style

    cycle = rc.get("axes.prop_cycle")
    if cycle is not None:
        colors = [entry.get("color") for entry in cycle if entry.get("color")]
        if colors:
            style["colors"] = colors
    for key, rc_key in (
        ("grid_color", "grid.color"),
        ("text_color", "text.color"),
        ("line_width", "lines.linewidth"),
        ("font_size", "font.size"),
    ):
        value = rc.get(rc_key)
        if value is not None:
            style[key] = float(value) if isinstance(value, (int, float)) else str(value)
    return style


@router.get("/meta/style", response_model=models.StyleResponse)
def plot_style() -> dict:
    """The house plot style, so the SPA charts match the native plots."""
    return _plot_style()


@router.get("/meta", response_model=models.MetaResponse)
def meta(settings: Settings = Depends(get_settings)) -> dict:
    """Echo the live config knobs the SPA needs.

    ``Depends(get_settings)`` is FastAPI's dependency-injection
    primitive -- the function parameter declared with ``Depends``
    is filled by calling the dependency, with result caching
    handled automatically. Flask users: closest analogue is
    ``flask.current_app.config``, but typed and validated.
    """
    return {
        "version": _pkg_version("aggregate_api"),
        "aggregate_version": _pkg_version("aggregate"),
        "log2_cap": settings.log2_cap,
        "log2_default": settings.log2_default,
        "build_timeout_s": settings.build_timeout_s,
        "cache_max": settings.cache_max,
        "plot_default_format": settings.plot_default_format,
    }
