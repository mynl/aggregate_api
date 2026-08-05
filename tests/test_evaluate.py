"""The evaluation half of the Pricing group.

Pricing asks what an obligation is worth at a chosen capital level. Evaluation
asks how much stress a position already held survives: per distortion family,
the shape at which the risk-adjusted margin reaches zero, indexed by Cherny and
Madan's ``gini_p``.

One library method serves three shapes and the api has to keep all three
straight, which is what these cover: an aggregate or a portfolio evaluates one
position, a plain P&L evaluates its margin row, and a tower evaluates every
margin row of its ledger so the layers can be read against the running net.
"""

from __future__ import annotations

PRICED_AGG = "agg EV.Priced 1000 premium at 0.65 lr sev lognorm 100 cv 1 poisson"
BARE_AGG = "agg EV.Bare 10 claims sev lognorm 100 cv 1.5 poisson"
PORT = ("port EV.Port agg A 10 claims sev lognorm 100 cv 1.5 poisson "
        "agg B 5 claims sev gamma 50 cv 0.8 poisson")
PNL = ("pnl EV.Pnl 1000 prem less "
       "agg EV.PnlL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson")
XPNL = ("xpnl EV.Tower 1000 prem less "
        "agg EV.TowerL 1000 prem at 70% lr sev lognorm 100 cv 2 "
        "occurrence ceded to 500 xs 500 deposit 100 poisson")
SEV = "sev EV.Sev lognorm 50 cv 1.5"

PANEL_COLUMNS = {"Step", "distortion", "role", "param_name", "param",
                 "gini_p", "error", "status"}


def _build(client, decl):
    r = client.post("/v1/objects", json={"decl": decl, "log2": 12})
    assert r.status_code == 200, r.text
    return r.json()["id"], r.json()


def test_priced_aggregate_evaluates_its_own_position(client):
    """An exposure that states a premium needs no input at all."""
    oid, body = _build(client, PRICED_AGG)
    assert body["capability"]["can_evaluate"] is True
    assert body["capability"]["needs_premium"] is False

    r = client.post(f"/v1/objects/{oid}/evaluate", json={})
    assert r.status_code == 200, r.text
    panel = r.json()["panel"]
    assert PANEL_COLUMNS <= set(panel["columns"])
    assert panel["rows"], "one row per distortion family"
    assert r.json()["kind"] == "agg"


def test_a_position_with_no_consideration_asks_for_one(client):
    """The library refuses to guess a premium, so the app has to ask.

    ``needs_premium`` is what tells the form to show the input, and it is not a
    kind test: it means the object is the sort that carries its own premium and
    does not carry one. A P&L keeps its premium in its ledger and has no such
    attribute, so it never asks.
    """
    oid, body = _build(client, BARE_AGG)
    assert body["capability"]["can_evaluate"] is True
    assert body["capability"]["needs_premium"] is True

    refused = client.post(f"/v1/objects/{oid}/evaluate", json={})
    assert refused.status_code == 400
    assert "premium" in refused.json()["detail"].lower()

    supplied = client.post(f"/v1/objects/{oid}/evaluate", json={"premium": 1500})
    assert supplied.status_code == 200, supplied.text
    assert supplied.json()["panel"]["rows"]


def test_portfolio_evaluates_the_book(client):
    oid, body = _build(client, PORT)
    assert body["capability"]["can_evaluate"] is True
    r = client.post(f"/v1/objects/{oid}/evaluate", json={"premium": 2000})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "port"
    assert r.json()["panel"]["rows"]


def test_a_plain_pnl_evaluates_its_margin(client):
    """No premium to ask for and none accepted: the ledger already carries it."""
    oid, body = _build(client, PNL)
    assert body["capability"]["can_evaluate"] is True
    assert body["capability"]["needs_premium"] is False

    r = client.post(f"/v1/objects/{oid}/evaluate", json={})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "pnl"
    assert r.json()["panel"]["rows"]

    refused = client.post(f"/v1/objects/{oid}/evaluate", json={"premium": 1500})
    assert refused.status_code == 400
    assert "ledger" in refused.json()["detail"]


def test_a_tower_evaluates_every_margin_row(client):
    """The case the panel says the most about.

    A walk evaluates the gross deal, each layer as a position in its own right,
    and the running net after each purchase, so it carries several ``Step``
    blocks where a plain P&L carries one. That is the whole reading: a layer
    whose breakeven sits above the net row over it is priced above the holder's
    own acceptability.
    """
    plain_oid, _ = _build(client, PNL)
    tower_oid, _ = _build(client, XPNL)
    plain = client.post(f"/v1/objects/{plain_oid}/evaluate", json={}).json()
    tower = client.post(f"/v1/objects/{tower_oid}/evaluate", json={}).json()

    assert len(tower["panel"]["rows"]) > len(plain["panel"]["rows"])
    steps = {row[0] for row in tower["panel"]["rows"]}
    assert len(steps) > 1, "a tower reads as several positions, not one"


def test_a_severity_cannot_be_evaluated(client):
    """No position, no panel, and a clean 400 rather than a 500."""
    oid, body = _build(client, SEV)
    assert body["capability"]["can_evaluate"] is False
    assert body["capability"]["needs_premium"] is False
    r = client.post(f"/v1/objects/{oid}/evaluate", json={})
    assert r.status_code == 400


def test_evaluate_carries_its_document_when_asked(client):
    """The static table view reads the same bytes as the interactive one."""
    oid, _ = _build(client, PRICED_AGG)
    r = client.post(f"/v1/objects/{oid}/evaluate?ir=true", json={})
    assert r.status_code == 200, r.text
    assert r.json()["ir"] is not None
    assert "panel" in r.json()["ir"]


def test_price_takes_either_capital_anchor(client):
    """``a`` joins ``p``: a program is written to an attachment, not a quantile.

    The library's ``price_pentagon`` has always taken either. Asking for the
    same capital level both ways has to complete to the same pentagon, which is
    what makes the new anchor a second door rather than a second answer.
    """
    oid, _ = _build(client, PRICED_AGG)
    by_p = client.post(f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.15})
    assert by_p.status_code == 200, by_p.text
    columns = by_p.json()["pentagon"]["columns"]
    assets = by_p.json()["pentagon"]["rows"][0][columns.index("a")]

    by_a = client.post(f"/v1/objects/{oid}/price", json={"a": assets, "coc": 0.15})
    assert by_a.status_code == 200, by_a.text
    assert by_a.json()["pentagon"]["rows"] == by_p.json()["pentagon"]["rows"]


def test_price_needs_exactly_one_anchor(client):
    """Neither and both are 400, the same rule the target keywords follow."""
    oid, _ = _build(client, PRICED_AGG)
    neither = client.post(f"/v1/objects/{oid}/price", json={"coc": 0.15})
    assert neither.status_code == 400
    both = client.post(f"/v1/objects/{oid}/price",
                       json={"p": 0.99, "a": 5000, "coc": 0.15})
    assert both.status_code == 400
