"""``POST /v1/objects/{id}/pnl/pentagon``: the ledger as a pentagon.

The PnL group's one route, feeding the ``PnL / Pentagon`` figure. A route rather
than an exhibit because the solvency level is a form input and the exhibit route
takes only a perspective.

What these assert is the seam, not the arithmetic. Whether the pentagon closes
is the library's business and is tested there
(``aggregate_REFACTOR/tests/test_pnl_pentagon.py``); what belongs here is that
every requested level comes back in the order asked for, that the frame arrives
with ``Step`` as a column so the figure can pick its three rows, that the strip
can label itself from one call, and that both readable refusals arrive as an
HTTP 400 with the sentence intact.
"""

from __future__ import annotations

import pytest

from aggregate_api.pnl import PENTAGON_RETURN_PERIODS

#: A tower with both an occurrence program and an aggregate one, which is the
#: plan's acceptance case: the figure has a real cession to draw.
TOWER = ("xpnl PT.Tower 1000 premium less agg PT.TowerL 1000 premium at 70% lr "
         "sev lognorm 100 cv 2 "
         "occurrence net of 100 xs 100 deposit 60 and 300 xs 200 deposit 40 "
         "poisson "
         "aggregate net of 100 xs 300 deposit 25 and 200 xs 400 deposit 15 "
         "peel top-down")

#: A P&L with no program at all: one pentagon, nothing ceded.
PLAIN = ("pnl PT.Plain 1000 premium less agg PT.PlainL 1000 premium at 70% lr "
         "sev lognorm 100 cv 2 poisson")

AGG = "agg PT.Agg 250 claims 1000 xs 0 sev lognorm 100 cv 1.5 poisson"


def _build(client, decl):
    r = client.post("/v1/objects", json={"decl": decl})
    assert r.status_code == 200, r.text
    return r.json()["id"], r.json()


def _pentagon(client, oid, **body):
    return client.post(f"/v1/objects/{oid}/pnl/pentagon", json=body)


def _rows(level):
    """``{Step: {column: value}}`` for one level's frame."""
    cols = level["frame"]["columns"]
    return {row[0]: dict(zip(cols[1:], row[1:]))
            for row in level["frame"]["rows"]}


# ----------------------------------------------------------------------
# The capability flag, which is what lights the leaf
# ----------------------------------------------------------------------
@pytest.mark.parametrize("decl,expected", [(TOWER, True), (PLAIN, True),
                                           (AGG, False)])
def test_the_flag_names_a_pnl_and_nothing_else(client, decl, expected):
    """A P&L answers, program or not; nothing else does.

    A plain P&L is deliberately **live**: it has no cession, so the figure
    draws one pentagon with nothing left over, which is the honest picture of a
    book with no program rather than a reason to grey the leaf.
    """
    _oid, manifest = _build(client, decl)
    assert manifest["capability"]["can_pnl_pentagon"] is expected


def test_the_flag_is_not_the_pnl_button_flag(client):
    """``can_pnl`` asks whether a thing can be *wrapped*; this asks whether it
    *is* a ledger. The two are true of disjoint sets of objects."""
    _oid, tower = _build(client, TOWER)
    _oid2, agg = _build(client, AGG)
    assert tower["capability"]["can_pnl"] is False
    assert tower["capability"]["can_pnl_pentagon"] is True
    assert agg["capability"]["can_pnl"] is True
    assert agg["capability"]["can_pnl_pentagon"] is False


# ----------------------------------------------------------------------
# The shape of the answer
# ----------------------------------------------------------------------
def test_one_call_carries_every_level_the_strip_shows(client):
    """The strip labels each mini pentagon with the assets its level implies,
    so it needs all six from one call or it cannot label itself."""
    oid, _ = _build(client, TOWER)
    r = _pentagon(client, oid)
    assert r.status_code == 200, r.text
    levels = r.json()["levels"]
    assert [lv["t"] for lv in levels] == list(PENTAGON_RETURN_PERIODS)


def test_the_levels_come_back_in_the_order_asked_for(client):
    oid, _ = _build(client, TOWER)
    wanted = [500, 100, 2000]
    r = _pentagon(client, oid, periods=wanted)
    assert r.status_code == 200, r.text
    assert [lv["t"] for lv in r.json()["levels"]] == wanted


def test_step_arrives_as_a_column_so_the_figure_can_pick_its_rows(client):
    """The frame's index is reset, and the three rows the figure draws are
    there under the names the ledger spells them with.

    The closing position is ``All``, not ``Net``: that is what the ledger, the
    summary card and the walk all call it, and inventing a second word for it
    here would be the drift the library's own index docstring warns about.
    """
    oid, _ = _build(client, TOWER)
    level = _pentagon(client, oid).json()["levels"][0]
    assert level["frame"]["columns"][0] == "Step"
    rows = _rows(level)
    assert {"Gross", "Ceded", "All"} <= set(rows)
    assert list(rows)[0] == "Gross", "the gross book leads"
    assert list(rows)[-1] == "Ceded", "the whole cession closes the frame"


def test_the_figures_the_level_moves_and_the_ones_it_does_not(client):
    """Acceptance 5 of the plan, read off the wire.

    Capital, assets, leverage and the cost of capital move with the solvency
    level; loss, expense, premium and margin do not, being properties of the
    book rather than of the standard applied to it.
    """
    oid, _ = _build(client, TOWER)
    levels = _pentagon(client, oid, periods=[100, 250]).json()["levels"]
    low, high = _rows(levels[0]), _rows(levels[1])
    for step in ("Gross", "All", "Ceded"):
        for column in ("L", "E", "P", "P_tech", "M", "LR", "CR"):
            assert low[step][column] == pytest.approx(high[step][column]), \
                f"{step} {column} moved with the level"
        for column in ("Q", "a", "PQ", "CoC"):
            assert low[step][column] != high[step][column], f"{step} {column}"


def test_a_plain_pnl_is_one_row_with_no_cession(client):
    oid, _ = _build(client, PLAIN)
    rows = _rows(_pentagon(client, oid).json()["levels"][0])
    assert len(rows) == 1
    assert "Ceded" not in rows


def test_the_cession_declines_its_spread_on_a_stitched_ledger(client):
    """Two layers in each tier makes the walk stitched, so the cession has no
    law of its own and the pair arrives null rather than as a negative standard
    deviation. The figure prints a dot."""
    oid, _ = _build(client, TOWER)
    rows = _rows(_pentagon(client, oid).json()["levels"][0])
    assert rows["Ceded"]["SD"] is None
    assert rows["Ceded"]["CV"] is None
    assert rows["Gross"]["SD"] > 0


# ----------------------------------------------------------------------
# The two refusals, each a sentence
# ----------------------------------------------------------------------
def test_a_non_pnl_is_refused_with_a_sentence(client):
    oid, _ = _build(client, AGG)
    r = _pentagon(client, oid)
    assert r.status_code == 400
    assert "not a P&L" in r.json()["detail"]
    assert "PnL button" in r.json()["detail"], "the refusal says what to do"


def test_a_return_period_at_or_below_one_is_refused(client):
    """The library's own guard, arriving verbatim."""
    oid, _ = _build(client, TOWER)
    r = _pentagon(client, oid, periods=[1])
    assert r.status_code == 400
    assert "return period above 1" in r.json()["detail"]


def test_an_empty_or_oversized_period_list_is_rejected_by_the_model(client):
    """The request model bounds the list, so a caller cannot ask for a
    thousand frames in one press."""
    oid, _ = _build(client, TOWER)
    assert _pentagon(client, oid, periods=[]).status_code == 422
    assert _pentagon(client, oid,
                     periods=list(range(2, 40))).status_code == 422
