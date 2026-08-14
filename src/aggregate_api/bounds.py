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

from typing import Any

from aggregate import Aggregate, Portfolio
from aggregate import charts as agg_charts
from aggregate.bounds import AllocationBounds, Bounds, PricingBounds

#: How many bracket columns the envelope overplots. Fifty is enough to read the
#: band as a band rather than a boundary, and cheap for the reason in the module
#: notes.
DEFAULT_RESAMPLES = 50

#: Gone at a60, with the figure it grouped: ``ENVELOPE_PANELS`` split the five
#: named distortions two-and-three because the matplotlib compositor drew three
#: panels, and a52 built that list here to work around ``plot_envelope``
#: silently ignoring the ``'space'`` shorthand the api had been passing. Both
#: problems left with the figure. The emitter puts all five on one band, which
#: is the comparison the panel is for, and the api no longer has an opinion
#: about panel contents at all.


def _document(df, formats: str = "price") -> dict | None:
    """One frame as a table document, or None. Best effort, as in ``pricing``."""
    from .tables import frame_document_dict

    try:
        return frame_document_dict(df, formats=formats)
    except Exception:  # noqa: BLE001 -- a static table is never worth a 500
        return None


def _calibrate_for_envelope(obj: Any, premium: float, assets: float | None) -> bool:
    """Calibrate the named distortions onto ``obj``, for the envelope's panel 2.

    Calibrated to **the premium the request already gave**, which is the whole
    point of the exhibit: panel 1 is every distortion consistent with that
    premium, and panel 2 names the ones the calibration produces, so they have
    to be the same premium or the two panels answer different questions.

    Returns ``True`` when the object came away carrying a calibration, which is
    what decides whether the emitter has a second panel to draw. It does not
    build or group anything itself: which distortions go on which panel is the
    emitter's business now, and through a59 this function split them across two
    panels because the matplotlib compositor drew three.

    ``calibrate_distortions`` takes a cost-of-capital rather than a premium, so
    the premium is resolved through :func:`aggregate_api.pricing._coc_for_premium`,
    which completes the pentagon and reads the cost of capital off it.

    Through 1.0.0a100 that identity was written out here::

        L = E[min(X, a)]        the limited expected loss
        M = premium - L         the margin
        Q = a - premium         the capital
        coc = M / Q

    which was this repo deciding what a price means, and it predated
    ``price_pentagon`` being reachable from the api. The pentagon is one library
    call and the identity stays upstream where it belongs.

    **That hand form was also wrong, in a small way.** ``prob_loss_assets``
    snaps the asset level to the loss grid and reports ``L`` there, while ``Q``
    was computed from the caller's raw request, so the margin and the capital
    came off two different asset levels and the cost of capital they implied
    belonged to no consistent pentagon. On a 50 claim lognormal book at
    ``log2=13``, a request for 15625.068 snaps to 15624.0 and the two readings
    are 0.13334437 against 0.13335957, about 1.1e-4 relative; it scales with the
    distance from a grid point. Panel 2 is calibrated on one asset level now,
    the one the band is drawn at.

    Returns ``False`` rather than raising, in three cases, and each leaves the
    document honestly one-panelled instead of falsely two:

    * **no asset cap.** Capital is unbounded, so there is no cost of capital to
      calibrate to. The envelope in panel 1 is still meaningful.
    * **degenerate margin or capital.** ``Bounds`` already refuses a premium
      below the mean or above the cap; this catches the boundary where premium
      equals the cap and capital is zero, which now reaches this function as the
      library's own refusal out of the pentagon rather than as a comparison here.
    * **the calibration itself declines**, which it does on a book where a mass
      distortion cannot be fitted.

    All three are rarer than they were. Since a100 the app carries a real
    calibration into this pane rather than opening on ``mean * 1.25``, and an
    implied ``(P, a)`` has ``M > 0`` and ``Q > 0`` by construction, so panel 2
    draws where it used to vanish. They stay because a hand typed premium can
    still hit them.

    Notes
    -----
    This **mutates** the cached object: ``calibrate_distortions`` writes
    ``distortions``, ``distortion_df`` and ``calibration_df`` onto it. That is
    the library's contract for the method and already how the pricing runners
    use it, so the object is no more shared-mutable than before; it is worth
    knowing that a Bounds request leaves a calibration behind.
    """
    import math

    from .pricing import _coc_for_premium

    if assets is None or not math.isfinite(float(assets)):
        return False
    assets = float(assets)
    try:
        coc = _coc_for_premium(obj, {"a": assets}, float(premium), None)
    except Exception:  # noqa: BLE001 -- an object that cannot answer gets one panel
        return False
    # A premium at or above the cap is negative capital and a premium below the
    # limited expected loss is a negative margin. The library reports either as
    # a non-positive cost of capital, so one test covers both boundaries.
    if not (coc is not None and coc > 0):
        return False
    try:
        obj.calibrate_distortions(coc, a=assets)
    except Exception:  # noqa: BLE001 -- reported by the document having one panel
        return False
    return bool(getattr(obj, "distortions", None))


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
) -> tuple[bytes, str]:
    """The envelope as a chart document: canonical bytes and their hash.

    Panel one is the band of admissible prices with the bracketing cloud inside
    it. Panel two puts the named distortions, calibrated to this request's own
    premium, on the same band, so you can see which part of the feasible space
    each one occupies; it is absent rather than empty when the calibration does
    not come off, and :func:`_calibrate_for_envelope` gives the three cases.

    Notes
    -----
    **Nothing is drawn here any more.** Through a59 this rendered a matplotlib
    figure and shipped SVG or PNG bytes, and it was the last thing in the api
    importing matplotlib. The emitter ``charts.chart_envelope`` now publishes
    the same picture as a document, so the api serves semantics and the browser
    realizes them, which is the same split every other chart already keeps.

    Two consequences worth stating. The reader can zoom and read values off the
    band rather than squinting at a fixed raster. And the figure is no longer
    two pictures maintained apart: the matplotlib compositor and the browser
    now draw the same document, so they cannot disagree about what the envelope
    is.

    The document arrives with **two panels where the figure had three**. That is
    upstream's decision and the right one: the five calibrated distortions used
    to be split across the last two panels, which was an accident of the order
    they were added rather than a reading anyone wants, since the question is
    how the five compare and five curves on one band answer it.

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
        Bracketing curves drawn inside the band.

    Returns
    -------
    (bytes, str)
        Canonical document JSON and its 12-hex content hash, the second so a
        caller can set an ETag without parsing the body back.

    Raises
    ------
    ValueError
        Wrong kind of object, or a premium the library will not accept.
    """
    _require_risk(obj)

    kwargs = {"premium": float(premium)}
    if assets is not None:
        kwargs["a"] = float(assets)
    bounds = Bounds(obj, **kwargs)

    # Before the document, not after: the emitter reads the calibration off the
    # priced object, so panel two exists only if this has already run.
    _calibrate_for_envelope(obj, premium, assets)

    doc = agg_charts.build_chart_doc(bounds, "envelope",
                                     n_resamples=int(n_resamples))
    return agg_charts.canonical_json(doc), doc.hash


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
