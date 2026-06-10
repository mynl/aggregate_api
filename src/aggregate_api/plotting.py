"""Server-side plot dispatch with SVG/PNG output.

The api offers one plot endpoint per object: ``GET
/v1/objects/{id}/plot?kind=native|density|cdf|qq|kappa&format=svg|png``.
``kind=native`` (the default) renders the object's own ``.plot()``
multi-panel figure; the others are legacy single-panel renderers kept
for backward compatibility. This module owns the matplotlib mechanics.

Why the SVG default
-------------------

Aggregate plots are smooth line / curve plots (densities, CDFs,
kappas). At a typical 2**16 grid, matplotlib's default path
simplification keeps SVG payloads in the 30-150 KB range -- on par
with a PNG, but resolution-independent. Users can save the SVG
and embed it in LaTeX / PDFs / slides without raster artifacts.
PNG is offered for "paste into Slack / Word" workflows.

Why a per-format dispatcher
---------------------------

``fig.savefig(buf, format="svg")`` vs ``format="png"`` is a
one-arg switch, so the dispatch is small. We just pick the
matching MIME type and ship the bytes.

Style isolation
---------------

The block runs inside ``aggregate.style.context(...)`` so the
api's plot styling doesn't leak into a user's interactive
session. ``WEB_OVERRIDES`` makes figures smaller (5.5" × 3.5"
@ 100 dpi) than the default 8" @ 150 dpi -- right size for a
typical 800 px-wide content column without a downscale step.
"""

from __future__ import annotations

import io
from typing import Any

import matplotlib
# 'Agg' = the non-interactive backend; required when the api runs
# under uvicorn with no display attached. set_backend before any
# `import matplotlib.pyplot` avoids backend-switch warnings.
matplotlib.use("Agg", force=True)

import matplotlib.pyplot as plt

import aggregate.style as agg_style


# Style overrides that shape figures for screen embedding (smaller
# than print defaults, sized for a typical content column). Layered
# on top of the package mplstyle inside ``aggregate.style.context``.
WEB_OVERRIDES: dict[str, Any] = {
    "figure.figsize": (5.5, 3.5),
    "figure.dpi": 100,
    "savefig.dpi": 100,
    # Save with the actual canvas dimensions (no bbox_inches="tight"
    # surprise resizing) so client-side aspect-ratio assumptions hold.
    "savefig.bbox": "standard",
    "savefig.pad_inches": 0.1,
}


# Whitelist of plot kinds; centralised so the error message in
# render_plot lists them all. ``native`` (the default) delegates to the
# object's own ``.plot()``; the rest are the legacy bespoke renderers,
# retained for backward compatibility with the old ``?kind=`` callers.
_PLOT_KINDS = ("native", "density", "cdf", "qq", "kappa")


def render_plot(
    obj: Any,
    kind: str = "native",
    *,
    fmt: str = "svg",
    width: float | None = None,
    height: float | None = None,
    dpi: float | None = None,
) -> tuple[bytes, str]:
    """Render ``obj`` to (bytes, media_type).

    Parameters
    ----------
    obj : Aggregate | Portfolio
        Live object from the cache.
    kind : str
        ``'native'`` (default) calls the object's own ``.plot()`` to
        produce its canonical multi-panel figure. The legacy values
        ``'density' | 'cdf' | 'qq' | 'kappa'`` use the api's bespoke
        single-panel renderers; ``kappa`` is Portfolio-only.
    fmt : str
        ``'svg'`` (default) or ``'png'``.
    width, height : float | None
        Figure size in inches for the *legacy* single-panel renderers.
        Ignored for ``'native'`` -- the object sizes its own multi-panel
        mosaic.
    dpi : float | None
        Override ``WEB_OVERRIDES['figure.dpi']`` (honored for both paths).

    Returns
    -------
    (bytes, str)
        Encoded image and the matching MIME type
        (``"image/svg+xml"`` or ``"image/png"``).
    """
    if kind not in _PLOT_KINDS:
        raise ValueError(
            f"unknown plot kind {kind!r}; expected one of {_PLOT_KINDS}"
        )
    if fmt not in ("svg", "png"):
        raise ValueError(f"unknown format {fmt!r}; expected 'svg' or 'png'")

    overrides = dict(WEB_OVERRIDES)
    if width is not None or height is not None:
        # Pick up the default for whichever side wasn't overridden.
        default_w, default_h = WEB_OVERRIDES["figure.figsize"]
        overrides["figure.figsize"] = (
            float(width) if width is not None else default_w,
            float(height) if height is not None else default_h,
        )
    if dpi is not None:
        overrides["figure.dpi"] = float(dpi)
        overrides["savefig.dpi"] = float(dpi)

    buf = io.BytesIO()
    # The context manager restores prior rcParams on exit so the
    # api doesn't bleed style state across requests.
    with agg_style.context(**overrides):
        fig = _native_figure(obj) if kind == "native" else _dispatch(obj, kind)
        try:
            fig.savefig(buf, format=fmt)
        finally:
            # Always close the figure -- matplotlib leaks figures
            # by default (held by ``Gcf``) which would balloon the
            # process memory under load.
            plt.close(fig)

    media_type = "image/svg+xml" if fmt == "svg" else "image/png"
    return buf.getvalue(), media_type


# ----------------------------------------------------------------------
# Native plot -- the object's own .plot()
# ----------------------------------------------------------------------

def _native_figure(obj: Any):
    """Call ``obj.plot()`` and return the matplotlib ``Figure`` it built.

    Both :meth:`Aggregate.plot` and :meth:`Portfolio.plot` construct their
    own multi-panel mosaic when called with no ``axd`` and stash it on
    ``obj.figure`` (they don't return it). We read that attribute back,
    falling back to ``plt.gcf()`` if a future version stops setting it.

    Raises
    ------
    ValueError
        If the object has no ``plot`` method, or plotting produced no
        figure -- surfaced by the route as HTTP 400.
    """
    plot = getattr(obj, "plot", None)
    if not callable(plot):
        raise ValueError(f"{type(obj).__name__} has no plot() method")
    plot()
    fig = getattr(obj, "figure", None)
    if fig is None:
        fig = plt.gcf()
    if fig is None:
        raise ValueError("plot() produced no figure")
    return fig


# ----------------------------------------------------------------------
# Per-kind dispatch (legacy single-panel renderers)
# ----------------------------------------------------------------------

def _dispatch(obj: Any, kind: str):
    """Return a matplotlib ``Figure`` for ``obj`` under ``kind``."""
    if kind == "density":
        return _plot_density(obj)
    if kind == "cdf":
        return _plot_cdf(obj)
    if kind == "qq":
        return _plot_qq(obj)
    if kind == "kappa":
        return _plot_kappa(obj)
    # Defensive; should be unreachable because render_plot validated.
    raise ValueError(f"unknown plot kind {kind!r}")


def _plot_density(obj):
    """PMF / PDF over the loss support.

    Aggregate exposes ``density_df['p_total']``; Portfolio uses the
    same column for the total. Both indexes are loss levels, so a
    plain step plot works for either.
    """
    fig, ax = plt.subplots()
    df = obj.density_df
    ax.plot(df.index, df["p_total"], lw=1.2, drawstyle="steps-mid")
    ax.set(xlabel="Loss", ylabel="Probability mass", title=f"{obj.name} -- density")
    return fig


def _plot_cdf(obj):
    """CDF over loss."""
    fig, ax = plt.subplots()
    df = obj.density_df
    ax.plot(df.index, df["F"], lw=1.2)
    ax.set(xlabel="Loss", ylabel="F(x)", title=f"{obj.name} -- CDF", ylim=(0, 1.02))
    return fig


def _plot_qq(obj):
    """Quantile-quantile plot of empirical vs theoretical (normal).

    Uses ``density_df`` to walk the empirical CDF and compares to
    normal quantiles at matching probabilities. A more sophisticated
    QQ vs lognorm/severity-specific is a future enhancement.
    """
    import numpy as np
    from scipy import stats

    fig, ax = plt.subplots()
    df = obj.density_df
    # Use unique strictly-increasing F values to avoid the
    # plateaus that appear after the support ends.
    F = df["F"].to_numpy()
    x = df.index.to_numpy()
    mask = (F > 0) & (F < 1)
    F = F[mask]
    x = x[mask]
    if len(F) == 0:
        ax.set(title=f"{obj.name} -- QQ (insufficient support)")
        return fig
    # Theoretical quantiles from N(mean, std) of the empirical
    # distribution.
    mean = (df.index * df["p_total"]).sum()
    var = ((df.index - mean) ** 2 * df["p_total"]).sum()
    std = float(np.sqrt(var))
    theoretical = stats.norm.ppf(F, loc=mean, scale=std if std > 0 else 1.0)
    ax.plot(theoretical, x, lw=1.0)
    # Reference line y=x.
    lo, hi = min(theoretical.min(), x.min()), max(theoretical.max(), x.max())
    ax.plot([lo, hi], [lo, hi], "k--", lw=0.8, alpha=0.5)
    ax.set(xlabel="Normal quantile", ylabel="Empirical quantile",
           title=f"{obj.name} -- QQ vs Normal")
    return fig


def _plot_kappa(obj):
    """Per-unit conditional expected loss (``exeqa_*``) for a Portfolio.

    Each ``exeqa_<unit>`` column is plotted vs ``loss`` (the index)
    as a line; the legend tags units. Aggregate has no kappa --
    we raise so the API layer can return HTTP 400.
    """
    if not hasattr(obj, "line_names_ex"):
        raise ValueError("kappa plot requires a Portfolio")
    fig, ax = plt.subplots()
    df = obj.density_df
    # Filter to ``exeqa_*`` columns; their order matches
    # ``line_names_ex`` from the Portfolio.
    exeqa_cols = [c for c in df.columns if c.startswith("exeqa_")]
    for col in exeqa_cols:
        ax.plot(df.index, df[col], lw=1.0, label=col.replace("exeqa_", ""))
    ax.set(xlabel="Loss", ylabel="E[X_i | X=x]",
           title=f"{obj.name} -- kappa (conditional unit losses)")
    ax.legend(loc="best", fontsize="small")
    return fig
