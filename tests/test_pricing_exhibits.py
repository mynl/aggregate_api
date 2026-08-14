"""The Pricing group, served through the library's official channel.

Three routes and one shape. ``pricing/preview`` answers with scalars because a
preview line prints numbers; ``pricing/calibrate`` and ``pricing/evaluate``
answer with exhibit envelopes, because everything else on this pane is a table
the library owns.

What these assert is the seam, not the arithmetic. Whether a calibration is
right is the library's business and is tested there; what belongs here is that
the result object reaches the registry, that both perspectives travel, that a
served block reconstructs hash for hash, and that each of the library's three
readable refusals arrives as an HTTP 400 with the sentence intact.
"""

from __future__ import annotations

import json

import pytest
from greater_tables import TableDoc

# The author's reference programs, from the plan. `BasicBook` is unbounded
# despite the 1000 xs 0 severity limit, because a Poisson count has no maximum:
# that is what makes it the test case for the anchor guard.
BASIC_BOOK = ("agg PX.BasicBook 250 claims 1000 xs 0 "
              "sev lognorm 100 cv 1.5 poisson")
BASIC_BOOK_RE = ("agg PX.BasicBookRe 250 claims 1000 xs 0 "
                 "sev lognorm 100 cv 1.5 occurrence net of 276 xs 55 poisson")
PORT = ("port PX.Basic agg A dfreq [1] sev gamma 12 cv 0.3 "
        "agg B dfreq [1] sev gamma 10 cv 0.5")
PNL = ("pnl PX.Pnl 1000 prem less "
       "agg PX.PnlL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson")
XPNL = ("xpnl PX.Tower 1000 prem less "
        "agg PX.TowerL 1000 prem at 70% lr sev lognorm 100 cv 2 "
        "occurrence ceded to 500 xs 500 deposit 100 poisson")
SEV = "sev PX.Sev lognorm 50 cv 1.5"

PERSPECTIVES = {"raw", "insurer"}


def _build(client, decl, log2=None):
    body = {"decl": decl}
    if log2 is not None:
        body["log2"] = log2
    r = client.post("/v1/objects", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"], r.json()


def _calibrate(client, oid, **body):
    body.setdefault("p", 0.99)
    body.setdefault("coc", 0.15)
    return client.post(f"/v1/objects/{oid}/pricing/calibrate", json=body)


def _text(block) -> str:
    """Every rendered cell of a block, run together, for a containment test.

    A cell is a bare string or a mapping carrying ``text`` (and ``raw``, and a
    ``rowspan`` where the stub is sparsified). Reading the stub positionally
    would mean reproducing that sparsification here, which is exactly the kind
    of second opinion about a served document this pane exists to stop having.
    """
    return " ".join(_cells(row) for row in block["body"])


def _cells(row) -> str:
    """One body row's rendered cells, run together."""
    return " ".join(
        cell["text"] if isinstance(cell, dict) else str(cell)
        for cell in row["cells"]
    )


# ----------------------------------------------------------------------
# preview
# ----------------------------------------------------------------------

def test_preview_completes_the_pentagon_as_scalars(client):
    """The line under the form: five levels and three ratios, no calibration."""
    oid, _ = _build(client, BASIC_BOOK)
    r = client.post(f"/v1/objects/{oid}/pricing/preview",
                    json={"p": 0.99, "coc": 0.15})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["p"] == 0.99
    assert body["premium"] > body["loss"] > 0
    assert body["assets"] > body["premium"]
    # The identities the pentagon is: M = P - L, Q = a - P, and the three
    # ratios read off those. Asserting them here is not re-deriving the
    # library's work, it is checking that the octet arrived intact and in the
    # right boxes, which is what renaming eight columns onto wire names risks.
    assert body["margin"] == pytest.approx(body["premium"] - body["loss"])
    assert body["capital"] == pytest.approx(body["assets"] - body["premium"])
    assert body["lr"] == pytest.approx(body["loss"] / body["premium"])
    assert body["pq"] == pytest.approx(body["premium"] / body["capital"])
    assert body["coc"] == pytest.approx(0.15)


def test_preview_on_assets_reports_no_probability(client):
    """``p`` is echoed, not resolved, so anchoring on assets answers null.

    The preview line does not print it, and resolving it back on a named
    reinsurance view would mean reaching for a grid distribution the library
    keeps private.
    """
    oid, _ = _build(client, BASIC_BOOK)
    by_p = client.post(f"/v1/objects/{oid}/pricing/preview",
                       json={"p": 0.99, "coc": 0.15}).json()
    by_a = client.post(f"/v1/objects/{oid}/pricing/preview",
                       json={"a": by_p["assets"], "coc": 0.15})
    assert by_a.status_code == 200, by_a.text
    assert by_a.json()["p"] is None
    assert by_a.json()["premium"] == pytest.approx(by_p["premium"])


def test_preview_answers_on_the_basis_it_is_given(client):
    """Both legs of the anchor come off the named view, so the views differ."""
    oid, _ = _build(client, BASIC_BOOK_RE)
    gross = client.post(f"/v1/objects/{oid}/pricing/preview",
                        json={"p": 0.99, "coc": 0.15, "basis": "gross"})
    net = client.post(f"/v1/objects/{oid}/pricing/preview",
                      json={"p": 0.99, "coc": 0.15, "basis": "net"})
    assert gross.status_code == 200, gross.text
    assert net.status_code == 200, net.text
    assert gross.json()["premium"] > net.json()["premium"]
    assert gross.json()["assets"] > net.json()["assets"]


@pytest.mark.parametrize("body", [
    {"p": 0.99},                                   # no target
    {"p": 0.99, "coc": 0.15, "lr": 0.7},           # two targets
    {"p": 0.99, "coc": 0.15, "premium": 30000},    # two targets, one new
    {"p": 0.99, "lr": 0.7, "premium": 30000},      # two targets, one new
    {"coc": 0.15},                                 # no anchor
    {"premium": 30000},                            # no anchor, new target
    {"p": 0.99, "a": 5000, "coc": 0.15},           # two anchors
])
def test_preview_wants_exactly_one_of_each(client, body):
    oid, _ = _build(client, BASIC_BOOK)
    r = client.post(f"/v1/objects/{oid}/pricing/preview", json=body)
    assert r.status_code == 400
    assert "exactly one" in r.json()["detail"]


def test_a_premium_is_the_third_pricing_target(client):
    """``price_pentagon`` has always taken ``P=``, and a100 offers it.

    It is the spelling the Bounds group and Evaluate have always used, so
    accepting it is what makes those forms and the Calibrate form one form. The
    octet is the same octet whichever leg the caller states, which is the whole
    claim: the pentagon is one identity and the target is a choice of which
    corner to hold.
    """
    oid, _ = _build(client, BASIC_BOOK)
    by_coc = client.post(f"/v1/objects/{oid}/pricing/preview",
                         json={"p": 0.99, "coc": 0.15})
    assert by_coc.status_code == 200, by_coc.text
    premium = by_coc.json()["premium"]

    by_premium = client.post(f"/v1/objects/{oid}/pricing/preview",
                             json={"p": 0.99, "premium": premium})
    assert by_premium.status_code == 200, by_premium.text
    for key, value in by_coc.json().items():
        assert by_premium.json()[key] == pytest.approx(value, rel=1e-9), key


def test_a_premium_target_calibrates_what_its_own_coc_does(client):
    """The round trip, through the calibrate route.

    ``calibrate_distortions`` takes a cost of capital and not a premium, so a
    premium target completes the pentagon first and hands over the cost of
    capital it reports. Two library calls chained, and the fitted families have
    to come out the same to the last few bits: agreement here is what says the
    api added no arithmetic of its own on the way.

    Exact equality is the wrong assertion. A premium is reached from a cost of
    capital and read back, so the derived target lands one or two ULPs off
    (``0.15`` against ``0.14999999999999997``) and every fitted parameter
    inherits that at around 1e-15.
    """
    oid, _ = _build(client, BASIC_BOOK)
    premium = client.post(f"/v1/objects/{oid}/pricing/preview",
                          json={"p": 0.99, "coc": 0.15}).json()["premium"]

    by_coc = _calibrate(client, oid, p=0.99, coc=0.15)
    by_premium = _calibrate(client, oid, p=0.99, coc=None, premium=premium)
    assert by_coc.status_code == 200, by_coc.text
    assert by_premium.status_code == 200, by_premium.text

    left = by_coc.json()["exhibits"]["pricing.calibrate"]["raw"]["blocks"][0]
    right = by_premium.json()["exhibits"]["pricing.calibrate"]["raw"]["blocks"][0]
    assert len(left["body"]) == len(right["body"])
    for a_row, b_row in zip(left["body"], right["body"]):
        for a_cell, b_cell in zip(a_row, b_row):
            a_raw = a_cell.get("raw") if isinstance(a_cell, dict) else None
            b_raw = b_cell.get("raw") if isinstance(b_cell, dict) else None
            if isinstance(a_raw, (int, float)) and isinstance(b_raw, (int, float)):
                assert b_raw == pytest.approx(a_raw, rel=1e-6, abs=1e-9)


def test_the_unbounded_anchor_guard_reaches_the_reader(client):
    """``p=1`` on an unbounded book is a 400 whose detail is the preview line.

    The library's guard, landed at 1.0.0a260. It refuses because the level
    ``p=1`` resolves to is the top of the FFT grid, which moves with ``log2``
    rather than with the risk. The message names the escape hatches, so it is
    worth showing whole rather than replacing with anything this repo writes.
    """
    oid, _ = _build(client, BASIC_BOOK)
    r = client.post(f"/v1/objects/{oid}/pricing/preview",
                    json={"p": 1, "coc": 0.15})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "unbounded" in detail
    assert "tail_behavior_df" in detail


def test_a_loss_ratio_that_leaves_no_capital_is_refused(client):
    """A ``coc`` target cannot ask for the impossible; an ``lr`` target can.

    ``P = L / lr`` is free to land above the assets, which is negative capital
    and a receipt of garbage. The library refuses at 1.0.0a262 and names the
    three numbers, so the reader can see which one to move. Landing on the
    calibrate route rather than the preview one is not an oversight: completing
    a pentagon at that loss ratio is arithmetic, and it is the *calibration*
    that would chase a premium above the essential supremum.
    """
    oid, _ = _build(client, BASIC_BOOK_RE)
    r = _calibrate(client, oid, coc=None, lr=0.7)
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "no capital" in detail
    assert "loss ratio" in detail


# ----------------------------------------------------------------------
# calibrate: two exhibits, both perspectives, per source shape
# ----------------------------------------------------------------------

def test_calibrate_serves_both_exhibits_under_both_perspectives(client):
    oid, _ = _build(client, BASIC_BOOK)
    r = _calibrate(client, oid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert set(body["exhibits"]) == {"pricing.calibrate", "pricing.allocate"}
    for name, views in body["exhibits"].items():
        assert set(views) == PERSPECTIVES, name
        for perspective, envelope in views.items():
            assert envelope["name"] == name
            assert envelope["perspective"] == perspective
            assert envelope["blocks"], f"{name}/{perspective} drew nothing"
            # The title delegates to the source through the result, which is
            # the whole reason the results carry a `_source` back reference.
            assert envelope["title"].endswith("PX.BasicBook")


def test_a_plain_aggregate_allocates_to_its_calibration_line(client):
    """No units and no views, so the allocation story is the one target row."""
    oid, _ = _build(client, BASIC_BOOK)
    allocate = _calibrate(client, oid).json()["exhibits"]["pricing.allocate"]
    assert len(allocate["raw"]["blocks"]) == 1
    assert allocate["raw"]["hash"] == allocate["insurer"]["hash"], (
        "nothing to restructure, so the two readings are the same document")


def test_a_reinsured_aggregate_reads_wider_raw_than_insurer(client):
    """The first exhibit where RAW carries strictly more rows than INSURER.

    RAW serves every view the cession has, including ``ceded``, which is the
    seller's price. INSURER keeps the whole program views, stars the calibrated
    one and appends the difference rows, because ``gross less net`` is the
    buyer's reading of what the cover costs in the rate.
    """
    oid, _ = _build(client, BASIC_BOOK_RE)
    allocate = _calibrate(client, oid, basis="gross").json()["exhibits"]["pricing.allocate"]
    assert allocate["raw"]["hash"] != allocate["insurer"]["hash"]

    raw = _text(allocate["raw"]["blocks"][0])
    insurer = _text(allocate["insurer"]["blocks"][0])
    assert "ceded" in raw
    assert "ceded" not in insurer, "the seller's price is not the insurer's"
    assert "gross*" in insurer, "the calibrated basis is starred"
    assert "gross less net" in insurer, "the difference row is the buyer's reading"


def test_a_portfolio_allocates_across_its_units(client):
    """RAW is the whole pricing frame; INSURER is the four stat slices.

    The example the RAW / INSURER framework has been waiting for: two genuinely
    different readings of one calculation rather than a subset.
    """
    oid, _ = _build(client, PORT)
    body = _calibrate(client, oid).json()
    allocate = body["exhibits"]["pricing.allocate"]
    assert len(allocate["raw"]["blocks"]) == 2, "the target, then the allocation"
    assert len(allocate["insurer"]["blocks"]) == 5, "the target, then four slices"


def test_ccoc_allocates_on_an_unbounded_book(client):
    """The mass distortion on an unbounded book: every family answers.

    This test used to pin the opposite: the library declined to allocate
    ``ccoc`` on an unbounded book and the route surfaced its warning. Upstream
    `[Allocation-Default-Linear]` (``aggregate`` 1.0.0a265) made ``ccoc``
    allocate at a finite anchor instead, so the warning legitimately stopped
    firing; caught at the 1.0.0a270 sync. The warnings passthrough itself is
    exercised by whatever family next declines.
    """
    oid, _ = _build(client, PORT)
    r = _calibrate(client, oid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exhibits"]["pricing.allocate"]["insurer"]["blocks"]
    assert "ccoc" in json.dumps(body["exhibits"]["pricing.allocate"])
    assert body["warnings"] == [], body["warnings"]


def test_calibrate_refuses_an_object_that_cannot_price(client):
    oid, body = _build(client, SEV)
    assert body["capability"]["can_price"] is False
    r = _calibrate(client, oid)
    assert r.status_code == 400
    assert "Aggregate or a Portfolio" in r.json()["detail"]


def test_a_portfolio_has_no_basis_to_calibrate_on(client):
    """It calibrates on its output basis, whatever the program made that."""
    oid, _ = _build(client, PORT)
    r = _calibrate(client, oid, basis="gross")
    assert r.status_code == 400
    assert "reins_view" in r.json()["detail"]


# ----------------------------------------------------------------------
# evaluate
# ----------------------------------------------------------------------

def test_evaluate_serves_the_panel_as_an_exhibit(client):
    oid, _ = _build(client, BASIC_BOOK)
    r = client.post(f"/v1/objects/{oid}/pricing/evaluate",
                    json={"premium": 25000, "p": 0.99})
    assert r.status_code == 200, r.text
    envelope = r.json()["exhibits"]["pricing.evaluate"]
    assert set(envelope) == PERSPECTIVES
    assert envelope["raw"]["blocks"]
    # Same frame, different sentence under it: the caption is the whole of what
    # INSURER adds here, which is why the hashes differ.
    assert envelope["raw"]["hash"] != envelope["insurer"]["hash"]


def test_an_anchored_panel_carries_ccoc_and_an_unanchored_one_does_not(client):
    """Decision 3: ``ccoc`` joins the families when there is an anchor.

    Its closed form reads an asset level directly, which the unanchored
    acceptability question does not supply, so the default keeps today's four.
    """
    oid, _ = _build(client, BASIC_BOOK)

    def panel(body):
        r = client.post(f"/v1/objects/{oid}/pricing/evaluate", json=body)
        assert r.status_code == 200, r.text
        return r.json()["exhibits"]["pricing.evaluate"]["raw"]["blocks"][0]

    anchored = panel({"premium": 25000, "p": 0.99})
    unanchored = panel({"premium": 25000})
    assert len(anchored["body"]) == len(unanchored["body"]) + 1
    assert "ccoc" in _text(anchored)
    assert "ccoc" not in _text(unanchored)


def test_the_round_trip_closes_through_the_routes(client):
    """Calibrate, take the implied premium, evaluate at the same anchor.

    The library's own acceptance test, run end to end over HTTP: the ``ccoc``
    row of the panel has to come back at the cost of capital that was asked
    for. It is the sharpest of the five because its closed form reads the assets
    and the expected loss rather than solving for a shape.
    """
    oid, _ = _build(client, BASIC_BOOK)
    preview = client.post(f"/v1/objects/{oid}/pricing/preview",
                          json={"p": 0.99, "coc": 0.15}).json()
    r = client.post(f"/v1/objects/{oid}/pricing/evaluate",
                    json={"premium": preview["premium"], "p": 0.99})
    assert r.status_code == 200, r.text
    block = r.json()["exhibits"]["pricing.evaluate"]["raw"]["blocks"][0]
    # The raw value beside the formatted text, which is what `include_raw` puts
    # in every document so a reader (and a test) never has to parse a rendering.
    param = [column["name"][-1] for column in block["columns"]].index("param")
    ccoc = next(row for row in block["body"]
                if "ccoc" in _cells(row).split())
    assert ccoc["cells"][param]["raw"] == pytest.approx(0.15, rel=1e-6)


def test_a_pnl_evaluates_its_ledger_and_takes_nothing_else(client):
    """Every row is its own position, so there is no premium and no anchor.

    The anchor semantics for a ledger row are genuinely open upstream (a
    purchased layer's asset level is not obviously anything), so the route
    refuses rather than passing a number the library would have to guess about.
    """
    oid, body = _build(client, PNL)
    assert body["capability"]["premium"] is None

    ok = client.post(f"/v1/objects/{oid}/pricing/evaluate", json={})
    assert ok.status_code == 200, ok.text
    assert ok.json()["kind"] == "pnl"
    assert ok.json()["exhibits"]["pricing.evaluate"]["insurer"]["blocks"]

    for refused_body, word in (({"premium": 1500}, "ledger"),
                               ({"p": 0.99}, "anchor"),
                               ({"basis": "gross"}, "anchor")):
        refused = client.post(f"/v1/objects/{oid}/pricing/evaluate",
                              json=refused_body)
        assert refused.status_code == 400, refused_body
        assert word in refused.json()["detail"]


def test_a_tower_evaluates_every_margin_row(client):
    """The case the panel says the most about.

    A walk evaluates the gross deal, each layer as a position in its own right,
    and the running net after each purchase, so it carries several ``Step``
    blocks where a plain P&L carries one. That is the whole reading: a layer
    whose breakeven sits above the net row over it is priced above the holder's
    own acceptability.
    """
    def panel(decl):
        oid, _ = _build(client, decl)
        r = client.post(f"/v1/objects/{oid}/pricing/evaluate", json={})
        assert r.status_code == 200, r.text
        return r.json()["exhibits"]["pricing.evaluate"]["raw"]["blocks"][0]

    plain = panel(PNL)
    tower = panel(XPNL)
    assert len(tower["body"]) > len(plain["body"])


def test_a_severity_has_no_position_to_evaluate(client):
    """No position, no panel, and a clean 400 rather than a 500."""
    oid, body = _build(client, SEV)
    assert body["capability"]["can_evaluate"] is False
    assert body["capability"]["needs_premium"] is False
    r = client.post(f"/v1/objects/{oid}/pricing/evaluate", json={})
    assert r.status_code == 400


def test_a_position_with_no_consideration_still_has_to_state_one(client):
    """The library refuses to guess, so the form asks and the route relays."""
    oid, body = _build(client, BASIC_BOOK)
    assert body["capability"]["needs_premium"] is True
    assert body["capability"]["premium"] is None
    r = client.post(f"/v1/objects/{oid}/pricing/evaluate", json={})
    assert r.status_code == 400
    assert "premium" in r.json()["detail"].lower()


def test_the_capability_carries_the_premium_to_prefill_with(client):
    """``has_premium`` is the yes or no; ``premium`` is the number itself."""
    priced = "agg PX.Priced 1000 premium at 0.65 lr sev lognorm 100 cv 1 poisson"
    _, body = _build(client, priced)
    assert body["capability"]["has_premium"] is True
    assert body["capability"]["needs_premium"] is False
    assert body["capability"]["premium"] == pytest.approx(1000, rel=1e-6)


# ----------------------------------------------------------------------
# the standing envelope contract
# ----------------------------------------------------------------------

def test_every_served_block_reconstructs_hash_for_hash(client):
    """The contract every exhibit route on this service answers to.

    A block is a table document and its hash is over its content, so a document
    that reconstructs to a different hash means the wire lost something. Run
    over all three exhibits, both perspectives, and all three source shapes,
    because the pricing exhibits are the first whose blocks depend on what the
    dispatched object was made from.
    """
    for decl in (BASIC_BOOK, BASIC_BOOK_RE, PORT):
        oid, _ = _build(client, decl)
        envelopes = list(_calibrate(client, oid).json()["exhibits"].values())
        evaluated = client.post(f"/v1/objects/{oid}/pricing/evaluate",
                                json={"premium": 100, "p": 0.99})
        assert evaluated.status_code == 200, evaluated.text
        envelopes.append(evaluated.json()["exhibits"]["pricing.evaluate"])
        for views in envelopes:
            for perspective, envelope in views.items():
                for block in envelope["blocks"]:
                    doc = TableDoc.model_validate(block)
                    assert doc.hash == block["hash"], (decl, perspective)


def test_the_pricing_exhibits_stay_off_the_object(client):
    """``available_exhibits(built_object)`` does not move because these exist.

    They dispatch on the result of a pricing call, not on the object, so the
    capability payload that paints the navigation is untouched. If one of these
    names ever appears here, a Pricing leaf would light on the exhibit gate and
    the pane's forms would be bypassed.
    """
    oid, body = _build(client, BASIC_BOOK)
    names = {e["name"] for e in body["capability"]["exhibits"]}
    assert not any(name.startswith("pricing.") for name in names)
    listed = client.get(f"/v1/objects/{oid}/exhibits").json()["exhibits"]
    assert not any(e["name"].startswith("pricing.") for e in listed)
