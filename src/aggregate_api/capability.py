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

from typing import Any

import numpy as np
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

    A passthrough of :func:`aggregate.charts.available_charts`. Sparse today:
    the conversions have reached distortion, reins, severity and the joint
    surface, so an aggregate or a portfolio still reports nothing and the app
    draws those from its own two-panel path until the emitters land.

    Parameters
    ----------
    obj : Any

    Returns
    -------
    list of str
        Registry names, in registration order.
    """
    return list(agg_charts.available_charts(obj))


def has_premium(obj: Any) -> bool:
    """Does this object's exposure state a premium?

    Consumer: the PnL button's form. :meth:`Aggregate.pnl_program` writes
    ``inherit premium`` when there is one and sizes it from a loss ratio when
    there is not, so this decides whether the app offers a loss-ratio input at
    all rather than showing one that will be ignored.

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
    premium = getattr(obj, "exp_premium", None)
    if premium is None:
        return False
    try:
        return float(np.sum(np.asarray(premium, dtype=float))) > 0.0
    except (TypeError, ValueError):
        return False


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


def can_price(obj: Any) -> bool:
    """Can this object answer the pricing forms?

    Consumer: the Pricing group, whose two modes are app behavior rather than
    a library document, so no exhibit or chart says this.

    Read off the object as the method the pricing path actually calls, which is
    the same test :func:`aggregate_api.pricing.run_price_pentagon` makes before
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
        "has_premium": has_premium(obj),
        "can_sharpen": can_sharpen(obj),
        "can_pnl": can_pnl(obj),
        "can_price": can_price(obj),
        "can_evaluate": can_evaluate(obj),
        "needs_premium": needs_premium(obj),
    }
