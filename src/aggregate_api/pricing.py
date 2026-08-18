"""The Pricing group: validate a form, call the method, serve the exhibits.

Four runners, one shape each. ``run_pricing_preview`` completes the pentagon
and answers with scalars, because a preview line prints numbers.
``run_calibration``, ``run_natural_allocation`` and ``run_evaluation`` hand back
library exhibit envelopes, because everything else on this pane is a table the
library owns.

Two of them calibrate and differ only in what they then ask for.
``run_calibration`` serves the receipt and the parts priced on their own
(``pricing.calibrate``, ``pricing.stand_alone``); ``run_natural_allocation``
serves the one premium split across those parts (``pricing.allocate``). They are
two presses rather than one because the allocation is real work on an
occurrence program, where it builds the joint distribution of gross and ceded,
and a reader who wants a calibration should not pay for one they did not ask
for.

There is no pandas in this file, and that is the point of it. Through 1.0.0a84
it held the other half of the pane: a ``_BasisView`` duck type presenting one
column of ``reins_density_df`` to an unbound ``Aggregate.calibrate_distortions``,
a pentagon completed row by row, a subtraction producing the difference rows, and
four ``tables.FORMATS`` entries saying how the results should print. All of it
was this repo deciding what a price means.

The library owns that now. ``calibrate_distortions`` and ``evaluate`` return
``CalibrationResult`` and ``EvaluationResult``; the registry dispatches
``pricing.calibrate``, ``pricing.stand_alone``, ``pricing.allocate`` and
``pricing.evaluate`` on those, with the frames materialized on the result, the
captions written upstream and the formats resolved into the document.
``calibrate_distortions(reins_view=...)`` does what the shim did and more, since
the library knows five views where the shim knew three.

See ``dev/plan-pricing-exhibits.md``, and for the shipped contract this codes
against, ``aggregate_REFACTOR/dev/plan-pricing-exhibits-LIB.md`` section 4.
The stand-alone / allocate split and the allocation route are
``dev/plan-pricing-natural-allocation.md`` phase B1.

Notes
-----
Every ``ValueError`` raised on this path is written to be read by a person, so
each route turns one into an HTTP 400 whose ``detail`` is the message verbatim.
Three reach the app: the unbounded anchor guard on ``p = 1``, a loss-ratio target
implying a premium above the assets, and the "exactly one of" validations.

**The standing rule that makes this safe on a shared object.** Pricing writes
result attributes onto the object it prices (``distortions``,
``distortion_df``, ``calibration_df``), and since a110 the object cache is
deliberately shared while the recipe base is not, so two sessions can be pricing
one object at once. That residue is accepted, on measured grounds: nothing in
this repo reads any of those attributes back, and every request recomputes from
its own form. The one condition attached to that acceptance is a rule for this
file, so it is written here rather than left as a habit.

**Every call from here passes its own target and its own distortions
explicitly. Never lean on a library default that reads ``self.distortions``.**
A method that falls back to the stored fit would serve this request an answer
struck for whoever priced the object last, silently and plausibly.
``Portfolio.price`` raises when ``distortions`` is unset, which is the guard
that would otherwise have hidden the problem by making it look like a bug in
the first caller rather than in the second. ``tests/test_sessions.py`` pins the
residue directly: two sessions calibrating one shared object at different
targets get the answers their own forms imply.
"""

from __future__ import annotations

from typing import Any

from .capability import can_natural_allocation
from .library_notes import library_warnings

#: Both perspectives travel in every response. The frames are tiny, and bundling
#: is what lets the app's RAW / INSURER toggle flip with no recompute and no
#: server-side result cache: a ``CalibrationResult`` is not in the object cache,
#: so a second request would have to calibrate again to answer the other reading.
_PERSPECTIVES = ("raw", "insurer")


def _one_target(coc: float | None, lr: float | None,
                premium: float | None = None) -> dict:
    """Exactly one pricing target, in the caller's own vocabulary.

    Three members since 1.0.0a100. ``price_pentagon`` has always accepted a
    premium target (``P=``) beside ``ROE`` and ``LR``, so the app's three forms
    are one form over that signature and this is where the third spelling
    enters. :func:`_pentagon_target` translates to the pentagon's vocabulary;
    ``calibrate_distortions`` speaks the caller's, which is why the two
    spellings stay separate rather than one being translated at the call site.
    """
    named = [name for name, value in
             (("coc", coc), ("lr", lr), ("premium", premium))
             if value is not None]
    if len(named) != 1:
        raise ValueError(
            "pass exactly one of coc (CoC/ROE), lr (loss ratio) "
            "or premium (P)")
    return {named[0]: {"coc": coc, "lr": lr, "premium": premium}[named[0]]}


#: The caller's spelling of a pricing target, to the pentagon's own. The
#: pentagon's keywords are the canonical stat names, which is why they are
#: capitalized and the caller's are not.
_PENTAGON_TARGET = {"coc": "ROE", "lr": "LR", "premium": "P"}


def _pentagon_target(target: dict) -> dict:
    """One caller-spelled target as the keyword ``price_pentagon`` takes."""
    (name, value), = target.items()
    return {_PENTAGON_TARGET[name]: value}


def _one_anchor(p: float | None, a: float | None) -> dict:
    """Exactly one capital anchor, as the keyword the library takes."""
    if (p is None) == (a is None):
        raise ValueError("pass exactly one of p (VaR probability) or a (assets)")
    return {"p": p} if p is not None else {"a": a}


def _envelopes(result: Any, name: str) -> dict[str, dict]:
    """One exhibit on one result object, under both perspectives.

    Parameters
    ----------
    result : CalibrationResult | EvaluationResult
        What the pricing call returned. The exhibit registry dispatches on its
        type, which is why these methods return objects rather than frames.
    name : str
        Registry name, e.g. ``'pricing.allocate'``. The dot is part of the name
        and not a namespace this repo has to take apart.

    Returns
    -------
    dict
        Perspective to envelope payload, the same shape
        ``GET /objects/{id}/exhibit/{name}`` serves. That route hands back
        deterministic bytes because its ETag hashes them; these ride inside a
        response model, so the parsed payload is the useful form.
    """
    from aggregate import exhibits as agg_exhibits

    from .tables import MAX_ROWS

    return {
        perspective: agg_exhibits.build_exhibit(
            result, name, perspective, max_rows=MAX_ROWS).to_payload()
        for perspective in _PERSPECTIVES
    }


def _kind_of(obj: Any) -> str:
    """The wire name for what was priced."""
    name = type(obj).__name__
    return {"Portfolio": "port", "PnL": "pnl"}.get(name, "agg")


def _coc_for_premium(obj: Any, anchor: dict, premium: float,
                     basis: str | None) -> float:
    """The cost of capital a premium implies, at one capital anchor.

    Parameters
    ----------
    obj : Aggregate | Portfolio
        The live object.
    anchor : dict
        The single capital anchor, already validated, as ``price_pentagon``
        takes it.
    premium : float
        The premium target.
    basis : str or None
        The reinsurance view, so both legs resolve on the distribution the
        calibration is about to be struck on.

    Returns
    -------
    float

    Notes
    -----
    The bridge between the two vocabularies. ``price_pentagon`` accepts a
    premium target and ``calibrate_distortions`` does not, so a premium becomes
    the cost of capital it implies before the fit. The pentagon identity is
    never written here: the library solves ``{L, a, P}`` and reports ``ROE``,
    and this reads it off. Used by :func:`run_calibration` and by
    ``bounds._calibrate_for_envelope``, which asked the same question with its
    own arithmetic through 1.0.0a100.

    A refusal on the way (the unbounded anchor guard, a premium above the
    assets) is the library's own ``ValueError`` and travels to the caller
    unchanged, which is what puts its sentence in the preview line.
    """
    row = obj.price_pentagon(**anchor, P=premium, reins_view=basis).iloc[0]
    return _scalar(row["ROE"])


def run_pricing_preview(
    obj: Any,
    *,
    p: float | None = None,
    a: float | None = None,
    coc: float | None = None,
    lr: float | None = None,
    premium: float | None = None,
    basis: str | None = None,
) -> dict:
    """Complete the pentagon and report it as scalars, with no calibration.

    Parameters
    ----------
    obj : Aggregate | Portfolio
        The live object.
    p, a : float, optional
        Exactly one capital anchor: a VaR probability, or an asset level the
        library snaps to its grid.
    coc, lr, premium : float, optional
        Exactly one pricing target.
    basis : str, optional
        Which reinsurance view to answer on, passed through as ``reins_view``.
        Both legs of the anchor come off the named view, so the reading is the
        one a reader who chose that calibration basis is about to get.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.PricingPreviewResponse`: the
        pentagon octet under wire names, plus the probability the caller named.

    Notes
    -----
    This feeds the Calibrate form's live preview line, so it is deliberately the
    cheapest question in the group: one completion of five numbers and three
    ratios, no distortion fitting, no allocation. It is also where the library's
    unbounded anchor guard reaches the reader as a sentence, since a preview that
    refuses says why in the place they are already looking rather than after they
    press the button.

    ``p`` is echoed, not resolved. A caller who anchored on assets gets null, and
    the asset level is the answer they asked for; resolving the probability back
    would mean reaching for a grid distribution on a named view, which is a
    private surface and buys a number the line does not print.
    """
    target = _one_target(coc, lr, premium)
    anchor = _one_anchor(p, a)
    if not hasattr(obj, "price_pentagon"):
        raise ValueError("pricing requires an Aggregate or a Portfolio")

    row = obj.price_pentagon(**anchor, **_pentagon_target(target),
                             reins_view=basis).iloc[0]
    return {
        "p": p,
        "assets": _scalar(row["a"]),
        "loss": _scalar(row["L"]),
        "margin": _scalar(row["M"]),
        "premium": _scalar(row["P"]),
        "capital": _scalar(row["Q"]),
        "lr": _scalar(row["LR"]),
        "pq": _scalar(row["PQ"]),
        "coc": _scalar(row["ROE"]),
    }


def run_calibration(
    obj: Any,
    *,
    p: float | None = None,
    a: float | None = None,
    coc: float | None = None,
    lr: float | None = None,
    premium: float | None = None,
    basis: str | None = None,
) -> dict:
    """Fit the standard distortion set, and serve what it says.

    Parameters
    ----------
    obj : Aggregate | Portfolio
        The live object.
    p, a : float, optional
        Exactly one capital anchor.
    coc, lr, premium : float, optional
        Exactly one pricing target. The library owns the loss-ratio conversion
        since 1.0.0a262, including its refusal: a loss ratio can imply a premium
        above the assets, which is a position with negative capital, and it says
        so rather than reporting a receipt of garbage.
    basis : str, optional
        Calibration basis for a reinsured Aggregate, passed as ``reins_view``.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.PricingExhibitsResponse`: the
        ``pricing.calibrate`` and ``pricing.stand_alone`` envelopes, each under
        both perspectives, and any warnings the library raised on the way.

    Notes
    -----
    Two exhibits from one call because the pane draws two subtabs from one press.
    ``pricing.stand_alone``'s frames are materialized lazily off the result, so
    the parts are priced here, inside the warning capture, rather than on the
    reader's next click.

    **The second exhibit is the parts priced alone, not the whole split across
    them.** Through 1.0.0a102 this bundle carried ``pricing.allocate``, and for a
    book that was the ``analyze_distortions`` sweep, which is the more expensive
    of the two questions and the one a Calibrate press does not ask. The split
    moved that sweep behind its own press, :func:`run_natural_allocation`, and
    put the stand-alone reading here: per-part ``Distortion.price`` calls on
    families that are already fitted.

    A distortion the library declines to price (the mass distortion on an
    unbounded book) is a warning, not a failure: the exhibit carries the rows
    that did answer and the warning says which did not. That is why the capture
    wraps the envelope building and not just the calibration.

    **A premium target costs one extra library call.**
    ``calibrate_distortions`` takes a cost of capital or a loss ratio and not a
    premium, so :func:`_coc_for_premium` completes the pentagon first and hands
    over the cost of capital it reports. Two library calls chained, with no
    arithmetic here: the pentagon identity stays upstream where it belongs. The
    tidier form is ``calibrate_distortions(P=...)``, which is an open ask.
    """
    target = _one_target(coc, lr, premium)
    anchor = _one_anchor(p, a)
    if not hasattr(obj, "calibrate_distortions"):
        raise ValueError("calibration requires an Aggregate or a Portfolio")
    if "premium" in target:
        target = {"coc": _coc_for_premium(obj, anchor, target["premium"], basis)}

    warns: list[str] = []
    with library_warnings() as caught:
        result = obj.calibrate_distortions(**target, **anchor, reins_view=basis)
        exhibits = {name: _envelopes(result, name)
                    for name in ("pricing.calibrate", "pricing.stand_alone")}
    warns.extend(caught)
    return {"kind": _kind_of(obj), "exhibits": exhibits, "warnings": warns}


def _allocation_basis(obj: Any, basis: str | None) -> str | None:
    """The one reinsurance view an allocation can be struck on, or a refusal.

    Parameters
    ----------
    obj : Aggregate | Portfolio
        The live object, already known to have parts to allocate across.
    basis : str or None
        What the form sent, which is ``None`` where the object offers no basis
        row at all.

    Returns
    -------
    str or None
        The view to pass as ``reins_view``.

    Notes
    -----
    Structural rather than a preference, in both directions. An occurrence
    program's allocation splits the **gross** premium into its ceded and net
    parts, so a fit struck on net has no gross premium to split and there is
    nothing for the tab to say; the library's own availability predicate makes
    the same test on the result. A book is locked to net by the 1.0.0a100 ruling
    that governs the Calibrate row beside this one: reinsurance is placed at the
    unit level, so a book has no cession of its own to choose.

    An ``Aggregate`` that states nothing is read as gross rather than as the
    library's default. That default is the object's own distribution, which for
    a reinsured aggregate is the net view, and answering a request for the
    allocation by striking the one calibration that cannot produce it would be a
    refusal wearing a 500. The app always states a basis here; this is for
    everyone else.
    """
    if _kind_of(obj) == "port":
        if basis not in (None, "net"):
            raise ValueError(
                "a book is allocated on its net view: reinsurance is placed at "
                "the unit level, so there is no book-wide basis to choose. Pass "
                "net, or drop the basis")
        return basis
    if basis is None:
        return "gross"
    if basis != "gross":
        raise ValueError(
            "the natural allocation splits a gross premium; calibrate on gross")
    return basis


def run_natural_allocation(
    obj: Any,
    *,
    p: float | None = None,
    a: float | None = None,
    coc: float | None = None,
    lr: float | None = None,
    premium: float | None = None,
    basis: str | None = None,
) -> dict:
    """Split one calibrated premium across the parts, and serve the exhibit.

    Parameters
    ----------
    obj : Aggregate | Portfolio
        The live object. A book, whose parts are its units, or an aggregate
        carrying an occurrence program, whose parts are the ceded and net halves
        of it.
    p, a : float, optional
        Exactly one capital anchor, as :func:`run_calibration` takes it.
    coc, lr, premium : float, optional
        Exactly one pricing target, as :func:`run_calibration` takes it.
    basis : str, optional
        The calibration basis, narrowed by :func:`_allocation_basis`.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.PricingExhibitsResponse`, carrying
        the ``pricing.allocate`` envelope under both perspectives.

    Notes
    -----
    **Not** ``bounds.run_allocation``, which sweeps every distortion consistent
    with a premium and reports each unit's range. The names are close because
    both split a total across units; this one is the pricing pane's single
    answer under fitted families, that one is the Bounds group's interval. They
    are imported into the same route module, so the longer name here is what
    keeps the shorter one meaning what it always has.

    **Stateless, like its siblings.** The calibration is struck again here rather
    than read off the one a Calibrate press already made. Nothing about a
    ``CalibrationResult`` is cached server side, so holding one would mean a
    result cache keyed on a form body, and a press that recomputes is the same
    decision the Evaluate route made.

    Two different questions arrive at one registry name, which is the point of
    the name. For a book it is ``analyze_distortions``, the per-unit premium
    allocation the library has always served. For an occurrence program it is
    the natural allocation off the joint distribution of gross and ceded, where
    each family's distorted view of the gross sets the weights and ceded plus
    net foot to gross exactly. The app draws whichever it is served and holds no
    opinion about which arrived.

    The occurrence path is the expensive one on this pane: it builds a joint
    distribution rather than reading a density frame. That is why it sits behind
    its own press.
    """
    target = _one_target(coc, lr, premium)
    anchor = _one_anchor(p, a)
    if not hasattr(obj, "calibrate_distortions"):
        raise ValueError("allocation requires an Aggregate or a Portfolio")
    if not can_natural_allocation(obj):
        raise ValueError(
            "there is nothing to allocate across: the natural allocation splits "
            "one premium among parts, which means the units of a book or the "
            "halves of an occurrence cession")
    basis = _allocation_basis(obj, basis)
    if "premium" in target:
        target = {"coc": _coc_for_premium(obj, anchor, target["premium"], basis)}

    warns: list[str] = []
    with library_warnings() as caught:
        result = obj.calibrate_distortions(**target, **anchor, reins_view=basis)
        exhibits = {"pricing.allocate": _envelopes(result, "pricing.allocate")}
    warns.extend(caught)
    return {"kind": _kind_of(obj), "exhibits": exhibits, "warnings": warns}


def run_evaluation(
    obj: Any,
    *,
    premium: float | None = None,
    basis: str | None = None,
    p: float | None = None,
    a: float | None = None,
) -> dict:
    """The breakeven acceptability panel, as the library's own exhibit.

    Parameters
    ----------
    obj : Aggregate | Portfolio | PnL
        The live object; all three expose ``evaluate``.
    premium : float, optional
        The consideration to measure against. Only an ``Aggregate`` or a
        ``Portfolio`` takes one, and only when its own exposure states none.
    basis : str, optional
        Which premium is being input, for a reinsured ``Aggregate``: the gross
        one, the one net of the occurrence program, or the net. Passed as
        ``reins_view``.
    p, a : float, optional
        At most one asset anchor. The acceptability solve is a function of it
        since 1.0.0a261, so evaluating at the anchor a calibration was struck at
        closes the round trip and recovers that calibration's parameters. Omit
        both for the unlimited reading, which is the library's default and
        reports four families rather than five: ``ccoc`` needs an asset level.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.PricingExhibitsResponse`, carrying
        the ``pricing.evaluate`` envelope under both perspectives.

    Notes
    -----
    ``DegenerateEvaluationWarning`` is not an error and is not swallowed. It
    fires when no breakeven level exists, either because the premium does not
    cover the expected loss or because the position cannot lose. Both report
    ``NaN`` in the panel, so the warning is what tells the reader which of the
    two they are looking at.
    """
    if not hasattr(obj, "evaluate"):
        raise ValueError(
            "evaluation requires an Aggregate, a Portfolio or a P&L")

    is_pnl = type(obj).__name__ == "PnL"
    if is_pnl:
        # Every ledger row is its own position with its own consideration, so
        # there is no single premium to state and no single asset level to
        # anchor on. The anchor question is genuinely open upstream rather than
        # merely unimplemented; see the plan's decision 4.
        if premium is not None:
            raise ValueError(
                "a P&L carries its own premium in the ledger; drop the premium "
                "argument and evaluate it as it stands")
        if basis is not None or p is not None or a is not None:
            raise ValueError(
                "a P&L evaluates every row of its ledger on that row's own "
                "terms; drop the basis and the asset anchor")

    warns: list[str] = []
    with library_warnings() as caught:
        result = (obj.evaluate() if is_pnl
                  else obj.evaluate(premium, p=p, a=a, reins_view=basis))
        exhibits = {"pricing.evaluate": _envelopes(result, "pricing.evaluate")}
    warns.extend(caught)
    return {"kind": _kind_of(obj), "exhibits": exhibits, "warnings": warns}


def _scalar(value):
    """Coerce numpy scalars and non-finite floats for JSON."""
    import math
    import numpy as np

    if value is None:
        return None
    if isinstance(value, (np.integer, np.floating)):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value
