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
* ``GET /v1/assets/{name}``: the ``greater_tables`` table-document
  walker and its stylesheet, served out of the installed package so
  the renderer cannot skew from the documents this process emits.

These are cheap reads; they don't touch the cache or audit log.
"""

from __future__ import annotations

from functools import lru_cache
from importlib.metadata import version as _pkg_version
from importlib.resources import files

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

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
    # The house panel size in inches. Only the *ratio* travels to the SPA (a
    # browser panel is sized in CSS pixels), but both are served so the client
    # never has to hardcode a divisor and a future absolute use has the numbers.
    "fig_w": 3.5,
    "fig_h": 2.45,
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

    ``fig_w`` / ``fig_h`` come from ``aggregate.constants`` rather than from the
    rc mapping, because ``figure.figsize`` is not what the library's own plots
    use: they pass explicit multiples of ``FIG_W`` / ``FIG_H`` per panel
    (``figsize=(2 * FIG_W, FIG_H)`` and so on). The SPA wants the **per-panel**
    aspect, which is exactly that pair.
    """
    style = dict(_STYLE_FALLBACK)
    try:
        from aggregate.constants import FIG_H, FIG_W

        style["fig_w"] = float(FIG_W)
        style["fig_h"] = float(FIG_H)
    except Exception:  # noqa: BLE001 (fall back to the shipped ratio)
        pass

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
        "tables_version": _pkg_version("greater-tables"),
        "log2_cap": settings.log2_cap,
        "log2_default": settings.log2_default,
        "build_timeout_s": settings.build_timeout_s,
        "cache_max": settings.cache_max,
    }


# ----------------------------------------------------------------------
# GET /v1/assets/{name}  -- the table-document walker, out of the package
# ----------------------------------------------------------------------
# The SPA renders static tables from the IR that `tables.py` emits, using a
# walker that ships inside `greater_tables` itself. Serving it from the
# installed package rather than bundling a copy is what makes version skew
# between the document and its renderer impossible: one install ships both, so
# they move together or not at all.
#
# Deliberately not a StaticFiles mount. Two files, an allow-list, and an
# explicit media type is less machinery than a mount plus the traversal
# reasoning a mount invites.
_ASSETS = {
    "gt-render.esm.js": "text/javascript",
    "gt.css": "text/css",
}


@lru_cache(maxsize=None)
def _asset(name: str) -> bytes:
    """Read one packaged asset. Cached: these are small and never change."""
    return (files("greater_tables") / "assets" / name).read_bytes()


@router.get("/assets/{name}")
def asset(name: str, request: Request) -> Response:
    """Serve a ``greater_tables`` front-end asset.

    Notes
    -----
    Revalidation rather than cache busting. The ETag is the package version, and
    ``no-cache`` asks the browser to check it every load, so a `uv sync` that
    moves ``greater_tables`` is picked up on the next reload with no ``?v=``
    for the client to compute and no stale-asset window.
    """
    media_type = _ASSETS.get(name)
    if media_type is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown asset {name!r}; expected one of {sorted(_ASSETS)}",
        )
    etag = f'"{_pkg_version("greater-tables")}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=_asset(name),
        media_type=media_type,
        headers={"ETag": etag, "Cache-Control": "no-cache"},
    )
