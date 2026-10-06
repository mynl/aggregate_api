"""The PnL group's own runner: the ledger read as a pentagon.

One function, and it has a module to itself for a reason. The obvious home was
``pricing.py``, beside the four runners that already complete pentagons, but
that file opens by saying there is no pandas in it and that this is the point of
it: everything there hands back library exhibit envelopes or scalars, and the
frames are materialized upstream. This runner serializes a DataFrame, so putting
it there would quietly retire a claim worth keeping.

The division of labor is the plan's governing principle (``dev/plan-a195-pnl-
pentagon.md``, ruled 2026-10-06): **the library owns the arithmetic and the
browser owns the geometry**. Every number the figure draws comes out of
``PnL.pentagon_df``; nothing about the economics is computed in JavaScript, and
nothing about the picture is computed here. The SVG lives in ``web/src/charts/
pentagon.js`` because it is a bespoke figure rather than a chart anyone else
emits, and forcing it through the chart IR would be a large extension for one
picture.

Why this is a route at all, rather than the app making do with ``/v1`` as it
stands. The make-do route would be per-ledger-row quantiles at an arbitrary
level, which this api does not expose and should not: it would be one frame per
level per row, fetched so the browser could reassemble arithmetic the library
already does in one call.
"""

from __future__ import annotations

from typing import Any

from .capability import can_pnl_pentagon
from .serializers import frame_to_payload, reset_index_safe

#: The strip's own six solvency levels, in reading order, so the first is the
#: default the leaf opens on.
#:
#: Carried here rather than in the SPA so one list drives both: the response
#: states which levels it answered at and the strip renders exactly those, which
#: means a change here needs no matching edit in the browser. The six are the
#: ones the retired ``aggregate-asp`` experiment offered (``js/state.js``), which
#: are the standards a reader of a solvency filing expects to be shown.
PENTAGON_RETURN_PERIODS = (100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0)


def run_pnl_pentagon(obj: Any, *, periods=None) -> dict:
    """The ledger as a pentagon, at each of several solvency levels.

    Parameters
    ----------
    obj : Any
        The live object, which must be a ``PnL``.
    periods : list of float, optional
        Return periods to answer at, each above 1. Defaults to
        :data:`PENTAGON_RETURN_PERIODS`.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.PnLPentagonResponse`: one entry per
        level, in the order asked for, each carrying the level and the frame
        struck at it with ``Step`` as its first column.

    Raises
    ------
    ValueError
        If the object is not a P&L, or if the installed library does not serve
        ``pentagon_df``, or, from the library itself, if a period does not
        exceed 1. Every message here is written to be shown to a reader, and the
        route turns one into a 400 whose ``detail`` is the message verbatim.

    Notes
    -----
    **Every level in one answer**, which is what the control needs. The leaf's
    control is a strip of mini pentagons, each labeled with the assets its level
    implies, so the reader chooses from figures they can already see rather than
    pressing six times to find out. Serving one level per request would leave
    the strip unable to label itself.

    The cost of the extra five is a handful of quantile reads per ledger row.
    The amounts, the expenses and the margin do not move with the level at all,
    being properties of the book rather than of the standard applied to it; only
    capital, assets and the two ratios over capital do.

    A reader should not assume the figures grow with the level. A bounded
    program exhausted in the far tail releases *less* capital at a remoter
    standard, so the cession's own capital can shrink as the level rises while
    the gross and net both grow. That is the reading the strip exists to make
    visible, and it is pinned upstream in
    ``tests/test_pnl_pentagon.py::test_an_exhausted_program_releases_less_capital_further_out``.
    """
    if not can_pnl_pentagon(obj):
        raise ValueError(
            "the pentagon reads a P&L ledger, and this object is not a P&L. "
            "Wrap it with the PnL button first, or explode it into a tower to "
            "see a cession in the figure.")
    wanted = (PENTAGON_RETURN_PERIODS if not periods
              else tuple(float(t) for t in periods))
    levels = []
    for t in wanted:
        frame = reset_index_safe(obj.pentagon_df(t=t))
        levels.append({"t": t, "frame": frame_to_payload(frame)})
    return {"levels": levels}
