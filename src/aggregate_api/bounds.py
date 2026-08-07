"""Pricing bounds: the range of prices consistent with one calibration.

Three questions, three classes in ``aggregate.bounds``, and this module is the
thin layer that asks them.

Ordinary pricing picks a distortion and reports the number it gives. That
number is only as firm as the choice of distortion, and the choice is a
judgment. Bounds asks the other question: hold the calibration fixed, let the
distortion range over everything consistent with it, and report how wide the
answer can be. A narrow range means the calibration decided the price; a wide
one means the distortion did.

* :class:`aggregate.bounds.Bounds` is the picture. Every distortion pricing the
  risk to the target premium is a point in the (s, g(s)) plane, and the envelope
  is the band they sweep.
* :class:`aggregate.bounds.PricingBounds` carries the calibration across to a
  *second* risk: given that some distortion prices X to P, what can it say about
  Y? That is the question behind quoting a new line off an existing book.
* :class:`aggregate.bounds.AllocationBounds` turns it inward, on the units of
  one portfolio: the range of natural allocation consistent with the total
  premium.

Notes
-----
**The cost worry recorded in the plan was unfounded**, and this is the
measurement that settled it. Constructing a ``Bounds`` is 0.01 s, ``cloud_df``
is 0.12 s, and the fifty-resample envelope figure is 0.5 to 0.8 s, on the
fixtures the tests use. The resamples are overplotted columns drawn from a frame
that is already computed, so asking for fifty rather than none costs the drawing
and nothing else.
"""

from __future__ import annotations

import io
from typing import Any

import matplotlib.pyplot as plt
from aggregate import Aggregate, Portfolio
from aggregate.bounds import AllocationBounds, Bounds, PricingBounds

from .plotting import WEB_OVERRIDES

#: How many bracket columns the envelope overplots. Fifty is enough to read the
#: band as a band rather than a boundary, and cheap for the reason in the module
#: notes.
DEFAULT_RESAMPLES = 50

#: The two panels' worth of named distortions, in the library's own grouping:
#: the two that pin an extreme against the three smooth ones.
#:
#: `plot_envelope` fills panels 2 and 3 only when it is handed a **list of
#: dicts**. Its ``'ordered'`` shorthand builds exactly this list, but only from
#: a ``Portfolio`` that already carries calibrated distortions, and it raises
#: otherwise. The api used to pass ``'space'`` to dodge that raise, and
#: ``'space'`` matches neither the dict branch nor the list branch inside the
#: library, so the whole overlay block was skipped: the figure came back with
#: three axes, one of them drawn and two of them blank. That is what "the Bounds
#: plot only has one panel" was.
#:
#: Building the list here rather than asking for ``'ordered'`` also lifts the
#: Portfolio-only restriction, since only that shorthand carries it.
ENVELOPE_PANELS = (("ccoc", "tvar"), ("ph", "wang", "dual"))


def _document(df, formats: str = "price") -> dict | None:
    """One frame as a table document, or None. Best effort, as in ``pricing``."""
    from .tables import frame_document_dict

    try:
        return frame_document_dict(df, formats=formats)
    except Exception:  # noqa: BLE001 -- a static table is never worth a 500
        return None


def _envelope_overlay(obj: Any, premium: float, assets: float | None):
    """The distortion set to overlay on panels 2 and 3, or ``None``.

    Calibrated to **the premium the request already gave**, which is the whole
    point of the exhibit: panel 1 is every distortion consistent with that
    premium, and panels 2 and 3 name five of them, so they have to be the same
    five the calibration produces or the three panels are answering different
    questions.

    ``calibrate_distortions`` takes a cost-of-capital rather than a premium, and
    the two are one identity apart at a fixed asset level::

        L = E[min(X, a)]        the limited expected loss
        M = premium - L         the margin
        Q = a - premium         the capital
        coc = M / Q

    ``L`` comes from the library's own ``prob_loss_assets``, which returns a
    mutually consistent ``(p, L, a)``, so the only api arithmetic here is the
    pentagon identity itself.

    Returns ``None`` rather than raising, in three cases, and each leaves the
    figure honestly one-panelled instead of falsely three:

    * **no asset cap.** Capital is unbounded, so there is no cost of capital to
      calibrate to. The envelope in panel 1 is still meaningful.
    * **degenerate margin or capital.** ``Bounds`` already refuses a premium
      below the mean or above the cap; this catches the boundary where premium
      equals the cap and capital is zero.
    * **the calibration itself declines**, which it does on a book where a mass
      distortion cannot be fitted.

    Notes
    -----
    This **mutates** the cached object: ``calibrate_distortions`` writes
    ``distortions``, ``distortion_df`` and ``calibration_df`` onto it. That is
    the library's contract for the method and already how ``pricing.run_price``
    uses it, so the object is no more shared-mutable than before; it is worth
    knowing that a Bounds request leaves a calibration behind.
    """
    import math

    if assets is None or not math.isfinite(float(assets)):
        return None
    assets = float(assets)
    premium = float(premium)
    try:
        limited = obj.prob_loss_assets(a=assets)
    except Exception:  # noqa: BLE001 -- an object that cannot answer gets one panel
        return None
    margin = premium - float(limited.L)
    capital = assets - premium
    if not (margin > 0 and capital > 0):
        return None
    try:
        obj.calibrate_distortions(margin / capital, a=assets)
    except Exception:  # noqa: BLE001 -- reported by the figure having one panel
        return None
    fitted = getattr(obj, "distortions", None) or {}
    panels = [{k: fitted[k] for k in group if k in fitted}
              for group in ENVELOPE_PANELS]
    return panels if all(panels) else None


def _drop_empty_panels(fig, axs) -> None:
    """Remove the axes the overlay could not fill.

    The library always builds a one by three grid, so without this an object
    whose distortions would not calibrate shows one drawn panel beside two empty
    boxes, which reads as a broken figure rather than as a smaller one. An axes
    with no lines, collections or patches drew nothing.
    """
    empty = [ax for ax in axs if not (ax.lines or ax.collections or ax.patches)]
    for ax in empty:
        fig.delaxes(ax)
    if empty and len(empty) < len(list(axs)):
        # Give the survivors the width the removed ones were holding.
        fig.set_size_inches(fig.get_size_inches()[0]
                            * (len(list(axs)) - len(empty)) / len(list(axs)),
                            fig.get_size_inches()[1])


def _require_risk(obj: Any) -> None:
    """Reject anything the bounds classes do not take.

    The library's own accepted set, not a kind list of ours: ``Bounds`` takes a
    ``Portfolio``, an ``Aggregate``, a Series or a DataFrame, and the two the
    api can hold are the first two.
    """
    if not isinstance(obj, (Aggregate, Portfolio)):
        raise ValueError("pricing bounds apply to an Aggregate or a Portfolio")


def run_envelope(
    obj: Any,
    *,
    premium: float,
    assets: float | None = None,
    n_resamples: int = DEFAULT_RESAMPLES,
    fmt: str = "svg",
) -> tuple[bytes, str]:
    """The three-panel envelope figure, as image bytes.

    Panel one is the cloud of sampled bracket columns shaded by weight, with the
    min and max envelope drawn over it. Panels two and three put the five named
    distortions, calibrated to this request's own premium, on the same band, so
    you can see which part of the feasible space each one actually occupies.

    Two panels, or one, when the distortions will not calibrate: see
    :func:`_envelope_overlay` for the three cases and :func:`_drop_empty_panels`
    for why the figure shrinks rather than shipping blanks.

    Parameters
    ----------
    obj : Aggregate or Portfolio
        The risk.
    premium : float
        The target premium the distortions are held to. Must sit above the
        expected loss and at or below the asset cap, which the library enforces.
    assets : float, optional
        Asset cap; the class then bounds prices of ``min(X, a)``. Unbounded when
        omitted.
    n_resamples : int
        Bracket columns to overplot.
    fmt : str
        ``'svg'`` or ``'png'``.

    Returns
    -------
    (bytes, str)
        Encoded image and its MIME type.

    Raises
    ------
    ValueError
        Wrong kind of object, or a premium the library will not accept.
    """
    _require_risk(obj)
    if fmt not in ("svg", "png"):
        raise ValueError(f"unknown format {fmt!r}; expected 'svg' or 'png'")

    import aggregate.style as agg_style

    kwargs = {"premium": float(premium)}
    if assets is not None:
        kwargs["a"] = float(assets)
    bounds = Bounds(obj, **kwargs)

    buf = io.BytesIO()
    # The style context restores prior rcParams on exit, so the api does not
    # bleed style state across requests; the figure is always closed, since
    # matplotlib holds figures in ``Gcf`` and would balloon the process.
    overlay = _envelope_overlay(obj, premium, assets)
    with agg_style.context(**WEB_OVERRIDES):
        fig, axs = bounds.plot_envelope(
            n_resamples=int(n_resamples),
            # A list is the only form that fills panels 2 and 3. With nothing to
            # overlay, `'space'`: it matches neither of the library's two
            # branches so the whole block is skipped, which is what the api used
            # to rely on unknowingly for *every* request. An empty list is not
            # the same thing and is not safe, because the block's closing "Avg
            # extreme" line indexes `distortions[-1]`.
            distortions=overlay if overlay else "space",
        )
        try:
            _drop_empty_panels(fig, axs)
            fig.savefig(buf, format=fmt)
        finally:
            plt.close(fig)

    return buf.getvalue(), ("image/svg+xml" if fmt == "svg" else "image/png")


def run_allocation(obj: Any, *, premium: float, assets: float | None = None,
                   ir: bool = False) -> dict:
    """Per-unit natural-allocation ranges consistent with a total premium.

    Portfolio only, and not by our choice: the calculation reads the
    ``exeqa_*`` columns, which are what a portfolio's density frame carries and
    a single aggregate has no analogue of.

    Returns one row per unit with ``lower``, ``upper`` and ``width``. The width
    is the reading: it is how much of each unit's price is decided by the choice
    of distortion rather than by the total premium.

    Parameters
    ----------
    obj : Portfolio
    premium : float
        Total premium for the book.
    assets : float, optional
        Asset cap.
    ir : bool
        Also return the table document for the static view.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.BoundsResponse`.
    """
    from .serializers import frame_to_payload, reset_index_safe

    if not isinstance(obj, Portfolio):
        raise ValueError("allocation bounds apply to a Portfolio")
    engine = AllocationBounds(obj, **({"a": float(assets)} if assets else {}))
    frame = engine.bounds(float(premium))
    return {
        "premium": float(premium),
        "table": frame_to_payload(reset_index_safe(frame)),
        "ir": {"table": _document(frame)} if ir else None,
    }


def run_pricing_bounds(obj: Any, *, premium: float, targets: dict,
                       assets: float | None = None, ir: bool = False) -> dict:
    """Price ranges for other risks, given this one priced to ``premium``.

    The cross-pricing question. Some distortion prices this object to the
    target; every such distortion also prices anything else, and this reports
    how wide that second price can be.

    Parameters
    ----------
    obj : Aggregate or Portfolio
        The reference risk carrying the pricing constraint.
    premium : float
        What the reference is priced to.
    targets : dict of str to object
        The risks whose ranges are wanted, by display name.
    assets : float, optional
        Asset cap, applied to both sides.
    ir : bool
        Also return the table document for the static view.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.BoundsResponse`.
    """
    from .serializers import frame_to_payload, reset_index_safe

    _require_risk(obj)
    if not targets:
        raise ValueError("name a risk to price against this one")
    engine = PricingBounds(obj, targets,
                           **({"a": float(assets)} if assets else {}))
    frame = engine.bounds(float(premium))
    return {
        "premium": float(premium),
        "table": frame_to_payload(reset_index_safe(frame)),
        "ir": {"table": _document(frame)} if ir else None,
    }
