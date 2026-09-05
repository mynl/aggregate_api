"""The Pr Ruin route: ``POST /v1/objects/{id}/ruin``.

One POST answers with the two-panel ``ruin`` chart document and the ``ruin``
exhibit envelopes together (see ``dev/plan-pk-tab.md`` and its API execution
notes). These tests cover the frequency gate, the deterministic default seed,
the Sample re-roll, the capital lookup, the pentagon bridge for a premium
target, and the payload budget the plan accepts.
"""

from __future__ import annotations

import json

import pytest

POISSON_BOOK = "agg Ruin.Poisson 5 claims sev 10 * expon poisson"
RENEWAL_BOOK = "agg Ruin.Renewal 5 years sev 10 * expon wait gamma 2"
NEGBIN_BOOK = "agg Ruin.Negbin 5 claims sev 10 * expon mixed gamma 0.3"

FORM = {"p": 0.99, "coc": 0.15, "ruin_p": 0.05}


def _build(client, decl):
    r = client.post("/v1/objects", json={"decl": decl})
    assert r.status_code == 200, r.text
    return r.json()["id"], r.json()


def _ruin(client, oid, **body):
    merged = {**FORM, **body}
    return client.post(f"/v1/objects/{oid}/ruin", json=merged)


def test_poisson_book_serves_the_ruin_reading(client):
    """The whole answer: capability, chart shape, exhibit, deterministic seed."""
    oid, built = _build(client, POISSON_BOOK)
    assert "ruin" in built["capability"]["charts"]
    r = _ruin(client, oid)
    assert r.status_code == 200, r.text
    body = r.json()
    chart = body["chart"]
    assert chart["name"] == "ruin"
    assert {p["id"] for p in chart["panels"]} == {"paths", "psi"}
    roles = {s["role"] for s in chart["series"]}
    assert {"sample", "mean", "band", "survival", "marker"} <= roles
    meta = chart["meta"]
    assert meta["seed"] is not None
    assert 0 < meta["psi_exact"] < 1
    # The default seed is fixed, so the same question twice is the same
    # document twice: what makes the pane's re-requests cheap to reason about.
    again = _ruin(client, oid).json()["chart"]
    assert again["meta"]["seed"] == meta["seed"]
    assert again["hash"] == chart["hash"]


def test_renewal_book_serves_the_ruin_reading(client):
    """The Wiener-Hopf path answers through the same route and shape."""
    oid, built = _build(client, RENEWAL_BOOK)
    assert "ruin" in built["capability"]["charts"]
    r = _ruin(client, oid)
    assert r.status_code == 200, r.text
    chart = r.json()["chart"]
    assert {p["id"] for p in chart["panels"]} == {"paths", "psi"}


def test_the_wrong_frequency_is_refused_with_the_why(client):
    """A negbin book neither lists the chart nor answers the POST."""
    oid, built = _build(client, NEGBIN_BOOK)
    assert "ruin" not in built["capability"]["charts"]
    r = _ruin(client, oid)
    assert r.status_code == 400
    assert "frequency" in r.json()["detail"]


def test_sample_rerolls_the_seed(client):
    """``sample: true`` draws fresh; the default stays put beside it."""
    oid, _ = _build(client, POISSON_BOOK)
    fixed = _ruin(client, oid).json()["chart"]["meta"]["seed"]
    s1 = _ruin(client, oid, sample=True).json()["chart"]["meta"]["seed"]
    s2 = _ruin(client, oid, sample=True).json()["chart"]["meta"]["seed"]
    assert s1 != fixed
    assert s2 != fixed
    assert s1 != s2


def test_the_capital_lookup_lands_near_the_asked_probability(client):
    """``ruin_p`` resolves to a grid point whose exact psi is what was asked."""
    oid, _ = _build(client, POISSON_BOOK)
    meta = _ruin(client, oid).json()["chart"]["meta"]
    assert meta["psi_exact"] == pytest.approx(0.05, rel=0.2)
    assert meta["u"] > 0
    # The simulated check describes the same model: within a few standard
    # errors of exact, which is the plan's own acceptance bound.
    assert abs(meta["psi_sim"] - meta["psi_exact"]) < 3 * meta["se_sim"] + 1e-9


def test_the_exhibit_rides_both_perspectives(client):
    """The stats strip arrives as envelopes, the pricing-response shape."""
    oid, _ = _build(client, POISSON_BOOK)
    body = _ruin(client, oid).json()
    views = body["exhibits"]["ruin"]
    assert set(views) == {"raw", "insurer"}
    for envelope in views.values():
        assert envelope["blocks"], "an envelope with no block is no exhibit"


def test_at_most_one_capital_level(client):
    """``ruin_p`` and ``u`` together are refused rather than guessed between."""
    oid, _ = _build(client, POISSON_BOOK)
    r = _ruin(client, oid, u=100.0)
    assert r.status_code == 400
    assert "at most one" in r.json()["detail"]


def test_a_premium_target_bridges_through_the_pentagon(client):
    """A premium states the same margin the pentagon reads off it as LR."""
    oid, _ = _build(client, POISSON_BOOK)
    octet = client.post(f"/v1/objects/{oid}/pricing/preview",
                        json={"p": 0.99, "coc": 0.15}).json()
    by_coc = _ruin(client, oid).json()["chart"]["meta"]
    by_premium = _ruin(client, oid, coc=None,
                       premium=octet["premium"]).json()["chart"]["meta"]
    assert by_premium["lr"] == pytest.approx(by_coc["lr"], rel=1e-6)


def test_the_chart_document_stays_under_the_budget(client):
    """The plan accepts 200 kB canonical JSON for the default settings."""
    oid, _ = _build(client, POISSON_BOOK)
    chart = _ruin(client, oid).json()["chart"]
    assert len(json.dumps(chart, separators=(",", ":"))) < 200_000
