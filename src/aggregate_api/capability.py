"""What an object can answer, computed rather than declared.

The app used to carry two hand-written tables saying what each kind cannot do
(``NA_TABS_BY_KIND`` and ``NA_MORE_BY_KIND`` in ``web/src/main.js``). The
library now knows the same thing properly, through
:func:`aggregate.exhibits.available_exhibits` and
:func:`aggregate.charts.available_charts`, and
``aggregate/dev/exhibits-and-charts.md`` states the invariant: capability is
derived, never declared twice. This module is the api's side of that, and the
build response carries its output so the navigation can paint immediately
rather than after a second round trip.

Three kinds of leaf, and the distinction decides where a future one goes. An
**exhibit leaf** lights from :func:`exhibits_for` and needs no app change to
appear when the library registers a new exhibit. A **chart leaf** lights from
:func:`charts_for`. An **app leaf** (the Narrative pane, the pricing forms) is
gated on a flag, because it is a piece of app behavior rather than a library
document.

Notes
-----
**A flag earns its place or it is not here.** Anything the exhibit or chart
list already says must not be repeated as a flag: that is the second
declaration this module exists to delete. ``is_tower`` was dropped from the
plan's draft list for exactly that reason, since ``economic_waterfall`` is
registered against a tower predicate and a single group P&L therefore already
drops it from :func:`exhibits_for`. Each flag below names the consumer that
cannot get its answer any other way.

``kind`` and ``has_reins`` are not repeated here either. Both already ride on
the build response (``has_reins`` through ``_summary_fields``, which the cache
hit path shares), and one field per fact is the whole point.
"""

from __future__ import annotations

import inspect
from typing import Any

import numpy as np
from aggregate import Aggregate, Portfolio
from aggregate import charts as agg_charts
from aggregate import exhibits as agg_exhibits

#: Namespace prefix the library stamps on the sharpen verdict it merges into a
#: program's ``note{}`` (``aggregate._program._SHARPEN_NOTE``). The note body is
#: ``;``-separated and the author's own prose never carries the prefix, which is
#: what makes this a safe test rather than a substring guess.
SHARPEN_NOTE_PREFIX = "sharpen: "


def exhibits_for(obj: Any) -> list[dict]:
    """The exhibits this object can serve, with titles and perspectives.

    A passthrough of :func:`aggregate.exhibits.available_exhibits`, shaped the
    same way ``GET /v1/objects/{id}/exhibits`` shapes it so the inline payload
    and the standalone route cannot drift.

    Parameters
    ----------
    obj : Any
        A built object; an unregistered type yields an empty list.

    Returns
    -------
    list of dict
        ``{"name", "title", "perspectives"}`` in registry order.
    """
    return [
        {
            "name": name,
            "title": agg_exhibits.EXHIBITS[name][0].title,
            "perspectives": [p.value for p in perspectives],
        }
        for name, perspectives in agg_exhibits.available_exhibits(obj)
    ]


def charts_for(obj: Any) -> list[str]:
    """The chart names this object can serve.

    A passthrough of :func:`aggregate.charts.available_charts`. Complete as of
    library a244: every first-class kind publishes its own chart, and the app
    draws nothing it does not find here.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    list of str
        Registry names, in registration order.
    """
    return list(agg_charts.available_charts(obj))


def primary_chart_for(obj: Any) -> str | None:
    """The chart that is this object's own picture, or None.

    :func:`charts_for` answers what *can* be drawn, which for a reinsured
    aggregate is two things. This answers which one to draw when nothing else
    has been asked for, which is exactly the Overview Plot leaf's question and
    the one it used to answer with a per-kind table in the browser. A
    passthrough of :func:`aggregate.charts.primary_chart`, so the answer moves
    when the library's registrations move and never when this file does.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    str or None
        None where no registered chart claims the object, which is the app's
        cue to say the picture does not exist yet rather than to approximate
        one.
    """
    return agg_charts.primary_chart(obj)


def has_premium(obj: Any) -> bool:
    """Does this object's exposure state a premium?

    Consumer: the PnL button's form. :meth:`Aggregate.pnl_program` writes
    ``derive premium`` when there is one (the technical premium grossed up
    for the expense clause; upstream since ``aggregate`` 1.0.0a270) and sizes
    it from a loss ratio when there is not, so this decides whether the app
    offers a loss-ratio input at all rather than showing one that will be
    ignored.

    Mirrors the library's own test in ``aggregate._program._pnl_consideration``:
    the sum of ``exp_premium``, which is an array on a portfolio and a scalar
    on an aggregate.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return premium_for(obj) is not None


def premium_for(obj: Any) -> float | None:
    """This object's own premium, or None when its exposure states none.

    Consumer: the Pricing group's Evaluate form, which prefills the premium box
    from it. ``needs_premium`` says whether the reader **must** type one; this
    says what to put in the box when they need not, so an exposure that states a
    consideration is evaluated as it stands with the number visible rather than
    with an empty field that silently means "use your own".

    Parameters
    ----------
    obj : Any

    Returns
    -------
    float or None
        The total, summed over units on a portfolio. None where there is no
        ``exp_premium`` at all (a ``PnL`` keeps its premium in its ledger) and
        where the total is zero, which is the library's own reading of an
        exposure written without a consideration.
    """
    premium = getattr(obj, "exp_premium", None)
    if premium is None:
        return None
    try:
        total = float(np.sum(np.asarray(premium, dtype=float)))
    except (TypeError, ValueError):
        return None
    return total if total > 0.0 else None


def can_sharpen(obj: Any) -> bool:
    """Is a grid audit worth offering for this object?

    Consumer: the Sharpen button, which has no exhibit or chart of its own.

    Two conditions. The object has to have the method at all, which is
    ``Aggregate`` and ``Portfolio`` and nothing else, and it is read off the
    object rather than from a kind list so a future host needs no edit here.
    And the program must not already carry a sharpen verdict, since a second
    audit of a grid the probe just confirmed is a slow no-op.

    The verdict test is one-sided on purpose. A probe that **moved** the grid
    writes ``hints{}`` and clears its note, so Sharpen stays live: probing again
    from the new center can find more, and the library says as much when a walk
    runs out of its bucket limit while still improving. A probe that
    **confirmed** the grid writes the note and no hints, and that is the case
    worth refusing.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    if not hasattr(obj, "sharpen"):
        return False
    note = str(getattr(obj, "note", "") or "")
    verdicts = (chunk.strip() for chunk in note.split(";"))
    return not any(v.startswith(SHARPEN_NOTE_PREFIX) for v in verdicts)


def has_sharpen(obj: Any) -> bool:
    """Has a grid audit actually run on this object, leaving a table to read?

    Consumer: the More group's Sharpen leaf, which shows what the probe tried.

    **Not the negation of** :func:`can_sharpen`, and the two are not two views of
    one fact. ``can_sharpen`` asks whether running the probe is worth offering;
    this asks whether one has already run. An object that has never been
    sharpened answers False to this and True to that; an object whose probe
    *moved* the grid answers True to both, because the library says a walk that
    ran out of its bucket limit while still improving is worth resuming.

    Read off ``sharpen_df``, which the library leaves at ``None`` until
    ``sharpen()`` runs (``_aggregate.py:814``, ``_portfolio.py:1041``), so this
    is the frame's own account of whether it exists rather than a guess from the
    note.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    df = getattr(obj, "sharpen_df", None)
    return df is not None and not df.empty


#: The whole program views, in the order the two pricing forms draw them.
#:
#: A subset of ``Aggregate.reins_views``, which also carries ``ceded`` and
#: ``ceded occ``: those are a cession read as a position in its own right, which
#: is the seller's question, and both forms here ask the insurer's. The library
#: serves the ceded rows in the ``pricing.stand_alone`` RAW reading, which is
#: where that perspective belongs until there is a REINSURER one.
_CALIBRATION_BASES = ("gross", "net occ", "net")


def reins_bases_for(obj: Any) -> list[str]:
    """Which reinsurance bases this object can be calibrated on.

    Consumers: the Pricing group's "calibrate on" row, and the Evaluate form's
    "premium is" row. Both offered all three of gross, net occ and net to any
    reinsured object before a52, and on most objects at least one of the three
    was a button that either 400'd or repeated a column already on screen.

    Read straight off ``obj.reins_views`` since a85, filtered to the whole
    program views and put in the order the forms draw them. That property is the
    library's own answer to what distributions a program has, so ``net occ``
    appears exactly on the two-stage programs that have a distinct one, and the
    app no longer has to know why. It replaces a local list of
    ``reins_density_df`` column names, which knew three views where the library
    knows five and had to reason about the stages itself.

    Empty for an object carrying no cession, which is what makes both rows grey
    out as a whole rather than vanish.

    **A reinsured Portfolio is locked to net** (author's ruling, 1.0.0a100).
    Reinsurance is placed at the unit level: a book has no cession of its own to
    choose and takes whatever its units produce, so there is no book-wide
    decision for the row to offer. ``Portfolio.reins_views`` has reported
    ``['gross', 'ceded', 'net']`` since library a223 and both this filter's
    survivors were live here through a99, which was wrong in a way a reader
    could not see: ``CalibrationResult.pricing_df`` allocates ``density_df``,
    the net book, whatever view was asked for, so a gross calibration arrived
    beside a net allocation from one press, labeled as one calculation. Measured
    on a two unit book, the two allocations agreed to the last digit while the
    calibrations differed. Net is the only basis a book answers end to end.

    An Aggregate is unaffected: a cession is placed on it directly, and all
    three views are its own.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    list of str
    """
    try:
        views = set(obj.reins_views or ())
    except Exception:  # noqa: BLE001 -- an object that cannot answer offers none
        return []
    live = [name for name in _CALIBRATION_BASES if name in views]
    if live and isinstance(obj, Portfolio):
        return ["net"] if "net" in live else []
    return live


def can_price(obj: Any) -> bool:
    """Can this object answer the pricing forms?

    Consumer: the Pricing group's Calibrate and Allocate leaves, which are app
    behavior rather than a library document, so no exhibit or chart says this.
    They gate together because one press fills both.

    Read off the object as the method the pricing path actually calls, which is
    the same test :func:`aggregate_api.pricing.run_calibration` makes before
    it raises. A kind list would have been a second declaration of a fact the
    object already carries, and the app had exactly that in
    ``NA_TABS_BY_KIND``.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return hasattr(obj, "price_pentagon")


def can_evaluate(obj: Any) -> bool:
    """Can this object answer the acceptability panel?

    Consumer: the Pricing group's Evaluate leaf. A separate flag from
    :func:`can_price` and not a synonym for it: evaluation reaches a ``PnL``,
    which has no ``price_pentagon`` and is the kind the panel says the most
    about, since it evaluates every margin row of the ledger rather than one
    position.

    Read off ``evaluate`` for the same reason the others are read off their
    methods: the object is the authority on what it can do.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return hasattr(obj, "evaluate")


def can_pnl(obj: Any) -> bool:
    """Can this object be wrapped in a P&L?

    Consumer: the action row's PnL button.

    Read off ``pnl_program``, which the library puts only on the two classes
    that can honestly answer, so "does this object have it" is the whole test.
    Deliberately not folded into :func:`can_price`, even though both are true
    for exactly an ``Aggregate`` and a ``Portfolio`` today: they are two
    different questions and a shared flag would tie a future change in one to
    the other.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return hasattr(obj, "pnl_program")


#: Does the installed library's ``pnl_program`` accept ``premium_style``?
#:
#: Feature-detected once at import, off the public method's signature, because
#: the keyword is an upstream ask (``dev/plan-a182-pricing-pnl-forms.md``, the
#: upstream section) and the api must be honest before it ships: while this is
#: False the route refuses ``premium_style='rate'`` with a 400 and the two rate
#: menu items grey through :func:`can_pnl_rate`. No version dance: the next
#: editable-checkout sync flips it.
PNL_PREMIUM_STYLE_SUPPORTED = (
    "premium_style" in inspect.signature(Aggregate.pnl_program).parameters)


def can_pnl_rate(obj: Any) -> bool:
    """Can this object be wrapped with ceded premiums written as rates?

    Consumer: the action row's two rate menu items, ``PnL (rate)`` and
    ``xPnL (rate)``.

    :func:`can_pnl` plus the installed library accepting
    ``pnl_program(premium_style=)``. The second condition is the honest one:
    the keyword is an upstream ask, so a fresh install can carry a library
    that cannot write a ``rate`` clause yet, and the items grey with a why
    rather than the press producing a 400.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return PNL_PREMIUM_STYLE_SUPPORTED and can_pnl(obj)


def can_xpnl(obj: Any) -> bool:
    """Can this object end up exploded, layer by layer, from one press?

    Consumer: the action row's ``xPnL`` menu item (and, with
    :func:`can_pnl_rate`, the ``xPnL (rate)`` one).

    Two shapes answer, because the item means "get me the exploded P&L of
    what is in the box" wherever it starts. A non-P&L wraps and explodes in
    one request, which needs :func:`can_pnl` and a single ``Aggregate``: the
    library refuses to explode a portfolio because the portfolio total hides
    its units. A P&L has only the explode left to do, so it answers through
    the existing :func:`can_explode`, which stays, unchanged, as the explode
    route's own gate.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    if type(obj).__name__ == "PnL":
        return can_explode(obj)
    return can_pnl(obj) and isinstance(obj, Aggregate)


def can_explode(obj: Any) -> bool:
    """Can this P&L be broken out layer by layer?

    Consumer: the action row's PnL button in its second state, where it reads
    ``Explode`` and posts to ``/objects/{id}/explode``.

    True for a ``PnL`` built by ``pnl`` whose engine is a single aggregate.
    False for one already built by ``xpnl``, which has nothing left to do, and
    false for a portfolio engine, which the library refuses to explode because
    the portfolio total hides the units the walk would step through.

    Read off ``PnL.program``, the text the object was built from, because the
    two keywords produce the same class and the source is the only thing that
    tells them apart. The leading ``x`` is the whole test: an object of this
    class leads with one keyword or the other.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    if type(obj).__name__ != "PnL":
        return False
    if type(getattr(obj, "engine", None)).__name__ == "Portfolio":
        return False
    return str(getattr(obj, "program", "") or "").lstrip().startswith("pnl")


def can_hints(obj: Any) -> bool:
    """Can this object pin its realized grid into a ``hints{}`` clause?

    Consumer: the action row's Hints button.

    Read off ``with_hints``, which ``aggregate`` 1.0.0a291 put on ``Aggregate``
    and ``Portfolio``, so "does this object have it" is the whole test.

    Deliberately not folded into :func:`can_pnl`, even though both are true for
    exactly those two classes today. They are two different questions, and one
    flag would tie a future change in either to the other. The same argument
    ``can_pnl`` makes about ``can_price``.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return hasattr(obj, "with_hints")


def can_reins(obj: Any) -> bool:
    """Can a cession be added to this object?

    Consumer: the Reinsurance group's entry box, and the group pill above it.
    This is the flag that makes the group live for an aggregate carrying **no**
    cession, which is the case the entry box exists for: every table and chart
    in there is dark until there is a program to describe, so without this the
    group would grey out exactly when you wanted to add cover.

    Read off ``reins_program``, which the library puts on ``Aggregate`` alone.
    A portfolio cedes through its units rather than as a whole.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return hasattr(obj, "reins_program")


def can_views(obj: Any) -> bool:
    """Can this object be re-read as a gross / ceded / net view pair?

    Consumer: the action row's GCN control, which prepends ``grossceded``,
    ``grossnet`` or ``netceded`` to the program and rebuilds. The result is a
    ``BivariateAggregate`` of the named pair.

    Two conditions, and the second is the one that is easy to get wrong. The
    grammar's three view prefixes take an ``agg_out``, so this is an
    ``Aggregate`` question and a portfolio cannot answer it. And they build the
    joint **per-occurrence** aggregate of the pair, so what they need is an
    **occurrence** cession specifically: ``has_reins`` is the weaker test and
    would light the control for a program carrying only an aggregate cession,
    which then fails on submit. The house rule is that things grey with a
    reason rather than fail when pressed, so the narrower test is the right one.

    Read off ``occ_reins``, the cession spec itself, which is what
    ``routes.objects._has_reinsurance`` reads for the same reason: it costs
    nothing, where materializing ``reins_summary_df`` on every build would.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    if not hasattr(obj, "reins_program"):
        return False
    return getattr(obj, "occ_reins", None) is not None


def can_bounds(obj: Any) -> bool:
    """Can pricing bounds be computed for this object?

    Consumers: the Bounds group's envelope and PricingBounds leaves.

    An ``isinstance`` rather than a ``hasattr``, unlike the flags above, and
    the difference is honest: those name a method the object either has or does
    not, while ``aggregate.bounds.Bounds`` declares the types it accepts and a
    duck-typed near miss would fail somewhere deep instead of at the door. This
    is the library's own accepted set, restricted to the two members the api
    can hold, so it is still the library deciding. A P&L qualifies through its
    engine: the library unwraps ``obj.engine`` itself (aggregate 1.0.0a375,
    [Bounds-PnL-Engine]), so this see-through mirrors the constructor and the
    flag and the constructor cannot disagree.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return isinstance(obj, (Aggregate, Portfolio)) or \
        isinstance(getattr(obj, "engine", None), (Aggregate, Portfolio))


def can_allocate(obj: Any) -> bool:
    """Can allocation bounds be computed?

    Consumer: the Bounds group's AllocationBounds leaf.

    A portfolio and nothing else. The calculation reads the ``exeqa_*`` columns
    that a portfolio's density frame carries, which is the conditional
    expectation of each unit given the total, and a single aggregate has no
    analogue: there is one unit, so there is nothing to allocate.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return isinstance(obj, Portfolio)


def can_natural_allocation(obj: Any) -> bool:
    """Does this object have parts to split one premium across?

    Consumer: the Pricing group's Allocate leaf, and the route behind it. An
    app leaf rather than an exhibit one, because ``pricing.allocate`` dispatches
    on a ``CalibrationResult`` and never appears in :func:`exhibits_for`, so the
    exhibit list cannot light this pill.

    Two shapes qualify. A ``Portfolio`` allocates the book's premium across its
    units, which is what ``analyze_distortions`` has always done. An
    ``Aggregate`` carrying an occurrence program allocates the gross premium
    across the two halves of that program, ceded and net, off the joint
    distribution.

    **Not** :func:`can_allocate`, which is the Bounds group's per-unit range and
    is a ``Portfolio`` alone. The names are close because the questions are
    cousins; the flags are separate because one lights a pricing subtab and the
    other a bounds leaf, and tying them would tie a future change in one to the
    other.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool

    Notes
    -----
    An aggregate cession is deliberately not enough. The natural allocation
    reads the kappa curve off the joint distribution of gross and ceded, which
    the library builds per occurrence; a program that only cedes in the
    aggregate has no such joint to condition on. ``occ_reins`` is the library's
    own public record of whether an occurrence stage was placed, so this asks it
    rather than reasoning about the program text.

    The basis is a second gate and it is not here: the allocation splits a
    **gross** premium, so a fit struck on net has nothing to split. That is a
    property of the calibration rather than of the object, which is why it lives
    on the route and in the library's own availability predicate.
    """
    if isinstance(obj, Portfolio):
        return True
    return isinstance(obj, Aggregate) and obj.occ_reins is not None


def needs_premium(obj: Any) -> bool:
    """Must the Evaluate form ask for a premium before it can run?

    Consumer: the Pricing group's Evaluate leaf, which otherwise shows a form
    with nothing in it and posts straight into a 400.

    Three conditions, and none of them is a kind test. The object can be
    evaluated at all. It is the sort of thing that carries its own
    consideration, which is what ``exp_premium`` being present means: a ``PnL``
    has no such attribute, because its premium lives in its ledger and there is
    nothing to ask for. And it does not actually carry one.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    bool
    """
    return (can_evaluate(obj)
            and hasattr(obj, "exp_premium")
            and not has_premium(obj))


#: Text fields are found by suffix rather than listed, so a narrative the
#: library adds appears with no edit here. Leading-underscore names are the
#: private working copies behind the public properties and would print twice.
NARRATIVE_SUFFIXES = ("_description", "_explanation")

#: Reading order for the Narrative pane, by attribute stem.
#:
#: The sections used to come out sorted by stem, which is alphabetical order over
#: names the reader never sees and has no reason to care about: `bs` before
#: `info` before `reins` before `sharpen` before `tail` before `validation`. That
#: is not an order, it is the absence of one.
#:
#: This is the order the questions actually get asked in. What was built, what
#: grid it was built on, whether that grid is trustworthy, how it behaves out in
#: the tail, what was ceded off it, and finally what the grid audit found, which
#: is the most specialist of the six and the one most often absent.
#:
#: Anything the library adds later is appended, alphabetically among itself, so a
#: new stem still appears without an edit here. That is the same contract the
#: suffix rule above keeps: derived by default, ordered by hand only where the
#: order carries meaning.
#:
#: ``info`` never matches a stem, since the object's ``info`` block is a plain
#: string served alongside these rather than a ``*_description`` pair. It leads
#: the list because that is where the pane puts it, and naming it here is what
#: makes this tuple the whole reading order rather than most of it.
NARRATIVE_ORDER = ("info", "bs", "validation", "tail", "reins", "sharpen")


def narrative_for(obj: Any) -> list[dict]:
    """Every text field this object carries, in one list.

    Consumer: the More group's Narrative leaf, which is the pane that collects
    what the object says about itself in prose rather than in numbers.

    Derived by suffix, in the same spirit as the exhibit list: a new
    ``*_description`` upstream shows up here on its own. Sections are grouped by
    stem, so ``validation_description`` and ``validation_explanation`` arrive as
    one heading with a short form and a long one, which is what they are.

    Empty strings are dropped rather than rendered as blank headings. Most of
    these are empty most of the time: ``sharpen_*`` before a probe has run,
    ``reins_*`` with no cession.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    list of dict
        ``{"name", "description", "explanation"}``, in ``NARRATIVE_ORDER``, with
        anything unlisted appended alphabetically.
    """
    sections: dict[str, dict] = {}
    for attr in dir(obj):
        if attr.startswith("_"):
            continue
        for suffix in NARRATIVE_SUFFIXES:
            if not attr.endswith(suffix):
                continue
            try:
                text = getattr(obj, attr)
            except Exception:  # noqa: BLE001 -- a field that raises is absent
                continue
            text = str(text or "").strip()
            if not text:
                continue
            stem = attr[: -len(suffix)]
            section = sections.setdefault(
                stem, {"name": stem, "description": "", "explanation": ""})
            section[suffix.lstrip("_")] = text

    # Listed stems first in their declared order, then whatever else the object
    # carried, alphabetically among themselves so the tail of the list is at
    # least stable.
    rank = {name: i for i, name in enumerate(NARRATIVE_ORDER)}
    order = sorted(sections, key=lambda n: (rank.get(n, len(rank)), n))
    return [sections[name] for name in order]


def capability_for(obj: Any) -> dict:
    """The whole capability block for one object.

    Parameters
    ----------
    obj : Any
        A built object.

    Returns
    -------
    dict
        The whole block, matching :class:`aggregate_api.models.Capability`.
    """
    return {
        "exhibits": exhibits_for(obj),
        "charts": charts_for(obj),
        "primary_chart": primary_chart_for(obj),
        "has_premium": has_premium(obj),
        "premium": premium_for(obj),
        "can_sharpen": can_sharpen(obj),
        "has_sharpen": has_sharpen(obj),
        "can_pnl": can_pnl(obj),
        "can_pnl_rate": can_pnl_rate(obj),
        "can_xpnl": can_xpnl(obj),
        "can_explode": can_explode(obj),
        "can_hints": can_hints(obj),
        "can_reins": can_reins(obj),
        "can_views": can_views(obj),
        "reins_bases": reins_bases_for(obj),
        "can_price": can_price(obj),
        "can_evaluate": can_evaluate(obj),
        "can_bounds": can_bounds(obj),
        "can_allocate": can_allocate(obj),
        "can_natural_allocation": can_natural_allocation(obj),
        "needs_premium": needs_premium(obj),
    }
