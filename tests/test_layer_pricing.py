"""The layer quote: one deterministic price per reinsurance layer.

What these assert divides in two, and the division is deliberate.

The **arithmetic** is this repo's own, so it is pinned here against the only
thing that can check it: the engine's exact per-layer figures from
``Aggregate.reins_stats_df``, which reaches each layer's annual distribution by
FFT where :func:`aggregate_api.layer_pricing.layer_moments` reaches it in closed
form. Two independent routes to the same numbers.

The **shape of the method** is pinned as the properties the plan claims for it
rather than as a table of quotes, because the constants are meant to be tunable
and a golden-value test would make every tuning a test failure. So: the loss
ratio falls up a tower, the floor binds only at the top, an aggregate cover
costs more per unit of expected loss than the occurrence layer at the same
percentile pair, the cede grosses up exactly, the spelling follows the annual
attachment probability, share scaling is linear, the clause round trips and the
premium survives ``pnl_program``, and two identical presses produce identical
text.

Notes
-----
``agg`` ignores a ceded premium clause with ``IgnoredDecLClauseWarning``, since
a plain ``agg`` has no premium context and the price only bites inside a ``pnl``
or ``xpnl``. Every build of a priced program here therefore warns, which is
accurate and is not worked around; see the module docstring of
:mod:`aggregate_api.layer_pricing`.
"""

from __future__ import annotations

import math
import warnings

import pytest
from aggregate import Underwriter, build

from aggregate_api.layer_pricing import (
    LAMBDA, MIN_ROL, ROL_THRESHOLD, attachment_probability, indication,
    layer_moments, layer_quotes, price_clause,
)

#: The plan's worked book. A heavy-tailed lognormal with a hundred claims a
#: year, so a six-layer tower over it has working layers at the bottom and
#: genuine capacity layers at the top, which is what makes the ladder visible.
BOOK = "agg LP.Demo 100 claims 20000 xs 0 sev lognorm 50 cv 4 poisson"

#: The same book with a mixed frequency. The closed form takes the frequency
#: through its first two moments alone, so a mixing variance is the case that
#: would catch a formula that had quietly assumed Poisson.
MIXED = ("agg LP.Mixed 100 claims 20000 xs 0 sev lognorm 50 cv 4 "
         "mixed gamma 0.3")

#: The plan's tower, bottom up.
TOWER = [(100, 100), (300, 200), (500, 500), (1000, 1000), (3000, 2000),
         (5000, 5000)]


@pytest.fixture(scope="module")
def uw():
    """One underwriter for the module. Builds are the cost here, not state."""
    return Underwriter()


@pytest.fixture(scope="module")
def gross():
    """The worked book at log2 19, which is where the plan measured it."""
    return build(BOOK, log2=19)


@pytest.fixture(scope="module")
def quiet_quotes(uw, gross):
    """The tower quoted once, since each layer costs an auxiliary build."""
    layers = [("occurrence", 1.0, limit, attach) for limit, attach in TOWER]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return layer_quotes(uw, gross, layers)


# ----------------------------------------------------------------------
# The arithmetic, against the engine's own per-layer figures
# ----------------------------------------------------------------------

def _engine_layer_stats(obj, tier, layers):
    """``(mean, cv)`` per layer, the engine's way: one ceded program, by FFT.

    ``ceded to`` puts every layer of the tower on the object at once, so
    ``reins_stats_df`` reports each one's own annual distribution and the
    comparison is against a single build rather than one per layer.

    The program is rendered by ``reins_program`` rather than spliced together
    here, for the reason the route gives: an occurrence cession sits **before**
    the frequency clause and an aggregate cession after it, so anyone joining
    strings gets one of the two wrong.
    """
    spans = " and ".join(f"{limit} xs {attach}" for limit, attach in layers)
    ceded = build(obj.reins_program(f"{tier} ceded to {spans}"), log2=19)
    frame = ceded.reins_stats_df
    # Column 0 is Gross and the last two are Ceded and Net; the layers sit
    # between, in the order the clause spells them.
    columns = list(frame.columns)[1:1 + len(layers)]
    return [(float(frame.loc[("agg", "mean"), c]),
             float(frame.loc[("agg", "cv"), c])) for c in columns]


def test_layer_moments_tie_to_the_engine_on_occurrence(gross):
    """Closed form against FFT, layer by layer, on a Poisson book."""
    engine = _engine_layer_stats(gross, "occurrence", TOWER)
    for (limit, attach), (mean, cv) in zip(TOWER, engine):
        el, sd = layer_moments(gross, "occurrence", attach, limit)
        assert el == pytest.approx(mean, rel=1e-6)
        assert sd / el == pytest.approx(cv, rel=1e-6)


def test_layer_moments_tie_to_the_engine_on_a_mixed_frequency():
    """The same, with a mixing variance, which the second moment carries."""
    obj = build(MIXED, log2=19)
    engine = _engine_layer_stats(obj, "occurrence", TOWER)
    for (limit, attach), (mean, cv) in zip(TOWER, engine):
        el, sd = layer_moments(obj, "occurrence", attach, limit)
        assert el == pytest.approx(mean, rel=1e-6)
        assert sd / el == pytest.approx(cv, rel=1e-6)


def test_layer_moments_tie_to_the_engine_on_aggregate(gross):
    """The aggregate tier, to the looser tolerance the interpolation costs.

    The midpoint grid falls between lattice points, so ``density_df.S`` is
    interpolated rather than read, and that is the whole of the disagreement.
    """
    layers = [(2000, 3000), (4000, 5000), (5000, 10000)]
    engine = _engine_layer_stats(gross, "aggregate", layers)
    for (limit, attach), (mean, cv) in zip(layers, engine):
        el, sd = layer_moments(gross, "aggregate", attach, limit)
        assert el == pytest.approx(mean, rel=1e-3)
        assert sd / el == pytest.approx(cv, rel=1e-3)


def test_share_scales_the_loss_linearly_and_leaves_the_cv_alone(gross):
    """A placement is a multiplier, so it cannot change the risk's shape."""
    whole_el, whole_sd = layer_moments(gross, "occurrence", 1000, 1000)
    part_el, part_sd = layer_moments(gross, "occurrence", 1000, 1000, 0.4)
    assert part_el == pytest.approx(0.4 * whole_el, rel=1e-12)
    assert part_sd == pytest.approx(0.4 * whole_sd, rel=1e-12)
    assert part_sd / part_el == pytest.approx(whole_sd / whole_el, rel=1e-12)


def test_share_scales_the_premium_linearly(uw, gross):
    """And so it scales the quote, since every measure is positive homogeneous."""
    layers = [("occurrence", s, 1000, 1000) for s in (1.0, 0.4)]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        whole, part = layer_quotes(uw, gross, layers)
    # Loose by 1e-4, not by 1e-12: each layer's distortion price comes off its
    # own auxiliary build, and a build picks its own bucket size, so the two
    # placements are priced on two slightly different lattices.
    for key in ("sd_load", "ph", "dual"):
        assert part[key] == pytest.approx(0.4 * whole[key], rel=1e-4)
    assert part["loss_ratio"] == pytest.approx(whole["loss_ratio"], rel=1e-2)


def test_attachment_probability_is_annual_not_per_claim(gross):
    """The reading that decides the spelling, and it is not the frame's.

    ``reins_stats_df`` reports ``pr_attach`` on the occurrence tier as the
    severity survival, the chance one claim pierces the attachment. On a book
    with a hundred claims a year the annual reading is two orders of magnitude
    larger, and it is the annual one that says whether a layer is a working one.
    """
    per_claim = float(gross.sev.sf(100))
    annual = attachment_probability(gross, "occurrence", 100)
    assert per_claim == pytest.approx(0.1050, abs=1e-4)
    assert annual > 0.99
    assert annual == pytest.approx(-math.expm1(-gross.n * per_claim), rel=1e-12)


def test_an_empty_capacity_layer_reports_zero_rather_than_nan(gross):
    """Above the severity limit there is no loss, and no cv to divide for."""
    el, sd = layer_moments(gross, "occurrence", 50_000, 50_000)
    assert (el, sd) == (0.0, 0.0)
    row = indication(gross, "occurrence", 50_000, 50_000)
    assert row["cv"] is None
    # A loss ratio of zero, which is a number and is the right one: the floor
    # wrote a premium against no expected loss at all.
    assert row["loss_ratio"] == 0.0
    assert row["floored"] is True


# ----------------------------------------------------------------------
# The shape of the method
# ----------------------------------------------------------------------

def test_the_loss_ratio_falls_up_the_tower(quiet_quotes):
    """The ladder, and it is a theorem rather than a clamp.

    A layer hit with annual probability ``p`` satisfies
    ``cv >= sqrt((1 - p) / p)``, so ``LR <= 1 / (1 + LAMBDA * cv)`` is bounded
    by an increasing function of ``p``. Nothing enforces the ordering; it comes
    out of the standard deviation load.
    """
    ratios = [row["loss_ratio"] for row in quiet_quotes]
    assert all(a > b for a, b in zip(ratios, ratios[1:])), ratios
    assert ratios[0] > 0.8 and ratios[-1] < 0.3


def test_the_rate_on_line_falls_up_the_tower(quiet_quotes):
    """The other monotone column, which is what a quote sheet is read down."""
    rates = [row["rol"] for row in quiet_quotes]
    assert all(a > b for a, b in zip(rates, rates[1:])), rates


def test_both_distortions_take_turns_binding(quiet_quotes):
    """The dual loads the body, the proportional hazard loads the tail.

    Not decoration: it is the reason there are two, and a change that left one
    of them never binding would have quietly become a one-measure method.
    """
    binds = [row["binds"] for row in quiet_quotes]
    assert "dual" in binds and "ph" in binds, binds
    assert binds.index("dual") < binds.index("ph"), binds


def test_the_standard_deviation_load_is_the_loss_ratio_it_claims(quiet_quotes):
    """``LR = 1 / (1 + LAMBDA * cv)`` on the load itself, before the maximum."""
    for row in quiet_quotes:
        assert row["el"] / row["sd_load"] == pytest.approx(
            1.0 / (1.0 + LAMBDA * row["cv"]), rel=1e-9)


def test_the_minimum_rate_on_line_binds_at_the_top_and_nowhere_lower(
        uw, gross, quiet_quotes):
    """The floor is the end of the ladder, not a patch on it."""
    assert not any(row["floored"] for row in quiet_quotes)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        remote, = layer_quotes(
            uw, gross, [("occurrence", 1.0, 50_000, 50_000)])
    assert remote["floored"] is True
    assert remote["rol"] == pytest.approx(MIN_ROL, rel=1e-9)


def test_an_aggregate_cover_costs_more_than_the_occurrence_layer(uw, gross):
    """At the same percentile pair, which is what the Quick Re boxes mean.

    Each tier's band is resolved on its own distribution, so "corresponding"
    means the same two probabilities and not the same two amounts. The aggregate
    layer is then a genuinely rare event, its cv says so, and the lower loss
    ratio follows with no surcharge anywhere in the method.
    """
    # The same two quantile functions the quantiles route reads: ``q_sev`` is
    # the per-claim law and ``q`` the annual one.
    layers = []
    for tier, quantile in (("occurrence", gross.q_sev), ("aggregate", gross.q)):
        lo, hi = float(quantile(0.90)), float(quantile(0.99))
        assert hi > lo, (tier, lo, hi)
        layers.append((tier, 1.0, hi - lo, lo))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        occ, agg = layer_quotes(uw, gross, layers)
    assert agg["loss_ratio"] < occ["loss_ratio"], (occ, agg)


def test_cede_grosses_up_exactly(uw, gross):
    """The quote is the reinsurer's net, so the written premium carries the
    commission. Exact up to the quote-sheet rounding, which is the only
    approximation in the chain."""
    layers = [("occurrence", 1.0, 1000, 1000)]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        bare, = layer_quotes(uw, gross, layers)
        grossed, = layer_quotes(uw, gross, layers, cede=0.2)
    assert grossed["premium"] * 0.8 == pytest.approx(bare["premium"], rel=2e-3)
    assert grossed["cede"] == 0.2


# ----------------------------------------------------------------------
# The spelling, and the clause it lands in
# ----------------------------------------------------------------------

def test_a_remote_layer_quotes_on_a_rate_and_a_working_one_on_a_deposit(gross):
    """The spelling follows the annual attachment probability, nothing else."""
    working = indication(gross, "occurrence", 100, 100)
    remote = indication(gross, "occurrence", 5000, 5000)
    assert working["pr_attach"] > ROL_THRESHOLD
    assert working["spelling"] == "deposit"
    assert remote["pr_attach"] < ROL_THRESHOLD
    assert remote["spelling"] == "rol"


def test_an_unlimited_layer_is_always_a_deposit(gross):
    """The parser refuses a rate on line without a finite limit, a rate on line
    being a fraction of ``share * limit``."""
    row = indication(gross, "occurrence", 10_000, math.inf)
    assert row["pr_attach"] < ROL_THRESHOLD
    assert row["spelling"] == "deposit"
    assert row["limit"] is None and row["rol"] is None


def test_the_indication_can_only_be_revised_upward(uw, gross, quiet_quotes):
    """What makes showing a no-build number on the form honest.

    The press takes the maximum of the same standard deviation load and two
    distortion prices, over the same moments, and applies the same floor.
    """
    for row in quiet_quotes:
        shown = indication(gross, "occurrence", row["attach"], row["limit"])
        assert row["premium"] >= shown["premium"]


def test_the_priced_clause_round_trips_and_reaches_the_ledger(uw, gross):
    """The whole point: a priced program parses, and the P&L carries the price."""
    cession = ('occurrence net of 1000 xs 1000 as "Occ 1" '
               'and 5000 xs 5000 as "Occ 2"')
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        clause, rows = price_clause(uw, gross, cession)
        net = build(gross.reins_program(clause), log2=16)
    assert len(rows) == 2
    assert 'deposit' in clause and 'rol' in clause
    assert net.occ_reins == [(1.0, 1000.0, 1000.0), (1.0, 5000.0, 5000.0)]
    assert net.spec["occ_reins_label"] == ["Occ 1", "Occ 2"]
    # The premium is carried in the text and inlined by the wrap, which is where
    # it starts to bite: a plain ``agg`` has no premium context.
    program = net.pnl_program(0.76, 0.25)
    assert "deposit" in program and "rol" in program


def test_an_aggregate_cession_is_priced_on_its_own_tier(uw, gross):
    """Both tiers in one clause, each read off its own distribution."""
    cession = ['occurrence net of 1000 xs 1000 as "Occ 1"',
               'aggregate net of 2000 xs 5000 as "Agg 1"']
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        clauses, rows = price_clause(uw, gross, cession)
    assert [row["tier"] for row in rows] == ["occurrence", "aggregate"]
    assert all("deposit" in c or "rol" in c for c in clauses)


def test_the_quote_is_deterministic(uw, gross):
    """Same boxes, same program text, byte for byte. No solving anywhere."""
    cession = 'occurrence net of 95% po 1000 xs 1000 as "Occ 1"'
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        first, _ = price_clause(uw, gross, cession)
        second, _ = price_clause(uw, gross, cession)
    assert first == second


# ----------------------------------------------------------------------
# The two routes
# ----------------------------------------------------------------------

def _build_via_api(client, decl, log2=18):
    r = client.post("/v1/objects", json={"decl": decl, "log2": log2})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_the_indication_route_answers_in_the_order_asked(client):
    oid = _build_via_api(client, BOOK)
    r = client.post(f"/v1/objects/{oid}/layers/indication", json={"layers": [
        {"tier": "occurrence", "attach": 100, "limit": 100},
        {"tier": "occurrence", "attach": 5000, "limit": 5000},
        {"tier": "occurrence", "attach": 10_000},
    ]})
    assert r.status_code == 200, r.text
    rows = r.json()["indications"]
    assert [row["attach"] for row in rows] == [100.0, 5000.0, 10_000.0]
    assert [row["spelling"] for row in rows] == ["deposit", "rol", "deposit"]
    # The unlimited layer has no rate-on-line base, and says so rather than
    # reporting an infinity JSON cannot carry.
    assert rows[2]["limit"] is None and rows[2]["rol"] is None
    assert rows[0]["loss_ratio"] > rows[1]["loss_ratio"]


def test_the_indication_route_refuses_an_object_that_cannot_cede(client):
    oid = _build_via_api(client, "port LP.Book agg LP.One 10 claims "
                                 "sev lognorm 50 cv 2 poisson", log2=16)
    r = client.post(f"/v1/objects/{oid}/layers/indication",
                    json={"layers": [{"attach": 100, "limit": 100}]})
    assert r.status_code == 400
    assert "aggregate" in r.json()["detail"].lower()


def test_the_reins_route_prices_when_asked(client):
    oid = _build_via_api(client, BOOK)
    cession = ('occurrence net of 1000 xs 1000 as "Occ 1" '
               'and 5000 xs 5000 as "Occ 2"')
    r = client.post(f"/v1/objects/{oid}/reins",
                    json={"cession": cession, "price": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "deposit" in body["program"] and "rol" in body["program"]
    quotes = body["quotes"]
    assert len(quotes) == 2
    assert all(q["binds"] in {"sd", "ph", "dual"} for q in quotes)
    assert quotes[0]["loss_ratio"] > quotes[1]["loss_ratio"]


def test_the_reins_route_leaves_an_unpriced_cession_alone(client):
    """The unpriced path is untouched, which is why every older test holds."""
    oid = _build_via_api(client, BOOK)
    cession = 'occurrence net of 1000 xs 1000 as "Occ 1"'
    plain = client.post(f"/v1/objects/{oid}/reins", json={"cession": cession})
    assert plain.status_code == 200, plain.text
    assert plain.json()["quotes"] is None
    assert "deposit" not in plain.json()["program"]
    assert "rol" not in plain.json()["program"]


def test_the_reins_route_grosses_up_a_ceding_commission(client):
    oid = _build_via_api(client, BOOK)
    cession = 'occurrence net of 1000 xs 1000 as "Occ 1"'
    bare = client.post(f"/v1/objects/{oid}/reins",
                       json={"cession": cession, "price": True})
    grossed = client.post(f"/v1/objects/{oid}/reins",
                          json={"cession": cession, "price": True,
                                "cede": 0.25})
    assert bare.status_code == grossed.status_code == 200
    one = bare.json()["quotes"][0]["premium"]
    two = grossed.json()["quotes"][0]["premium"]
    assert two * 0.75 == pytest.approx(one, rel=2e-3)


def test_the_reins_route_refuses_a_commission_of_one(client):
    """A full commission writes an infinite premium, so the edge says no."""
    oid = _build_via_api(client, BOOK)
    r = client.post(f"/v1/objects/{oid}/reins",
                    json={"cession": 'occurrence net of 1000 xs 1000',
                          "price": True, "cede": 1.0})
    assert r.status_code == 422
