"""Pricing bounds, and the Narrative pane.

Ordinary pricing picks a distortion and reports its number. Bounds hold the
calibration fixed and let the distortion range over everything consistent with
it, so the width of the answer is the reading: narrow means the premium decided
the price, wide means the distortion did.

The plan carried a worry that constructing a ``Bounds`` would be too slow for
the VPS and that fifty resamples would make it worse. Both are settled here by
measurement rather than argument: see ``test_the_envelope_is_not_expensive``.
"""

from __future__ import annotations

import time

AGG = "agg BND.A 10 claims sev lognorm 100 cv 1.5 poisson"
PORT = ("port BND.P agg A 10 claims sev lognorm 100 cv 1.5 poisson "
        "agg B 5 claims sev gamma 50 cv 0.8 poisson")
SEV = "sev BND.S lognorm 50 cv 1.5"
PNL = ("pnl BND.Pnl 1000 prem less "
       "agg BND.PnlL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson")


def _build(client, decl, log2=13):
    r = client.post("/v1/objects", json={"decl": decl, "log2": log2})
    assert r.status_code == 200, r.text
    return r.json()


def _premium(body, factor=1.25):
    """A premium above the expected loss, which is what makes the question real."""
    return round(body["mean"] * factor)


# ----------------------------------------------------------------------
# The envelope figure
# ----------------------------------------------------------------------

def test_the_envelope_serves_a_document_for_both_risk_kinds(client):
    """The envelope is a chart document since a60, not a rendered image.

    What it has to carry is the band: a series with ``y2``, which *is* the
    region between the two edges rather than two curves a reader has to
    associate. Asserted on structure, never on pixels.
    """
    for decl in (AGG, PORT):
        body = _build(client, decl)
        r = client.get(f"/v1/objects/{body['id']}/bounds/envelope",
                       params={"premium": _premium(body), "n_resamples": 50})
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/json"
        doc = r.json()
        assert doc["name"] == "envelope"
        assert doc["panels"], "an envelope with no panel is not an envelope"
        assert all(p["kind"] == "xy" for p in doc["panels"])
        # A unit square, and the document says so rather than the app guessing.
        assert any(p.get("aspect") == "equal" for p in doc["panels"])
        assert any(s.get("y2") for s in doc["series"]), "the band is a y2 series"
        assert r.headers["ETag"] == f'"{doc["hash"]}"'

    # Revalidation, checked at `n_resamples=0` and only there. The bracketing
    # curves are drawn with `weight_df.sample(replace=True)` and no seed
    # upstream, so a resampled document is genuinely different bytes each time
    # and its hash is *supposed* to move. The band itself is deterministic.
    body = _build(client, AGG)
    params = {"premium": _premium(body), "n_resamples": 0}
    first = client.get(f"/v1/objects/{body['id']}/bounds/envelope", params=params)
    assert first.status_code == 200, first.text
    again = client.get(f"/v1/objects/{body['id']}/bounds/envelope", params=params,
                       headers={"If-None-Match": first.headers["ETag"]})
    assert again.status_code == 304


def test_the_envelope_is_not_expensive(client):
    """The plan's cost worry, measured.

    ``plot_bounds_envelope`` overplots columns drawn from a ``cloud_df`` that is
    already computed, so asking for fifty rather than none costs the drawing and
    nothing else. The construction is what costs, and it is paid either way.
    """
    body = _build(client, AGG)
    params = {"premium": _premium(body)}

    t0 = time.monotonic()
    bare = client.get(f"/v1/objects/{body['id']}/bounds/envelope",
                      params={**params, "n_resamples": 0})
    without = time.monotonic() - t0
    assert bare.status_code == 200, bare.text

    t0 = time.monotonic()
    full = client.get(f"/v1/objects/{body['id']}/bounds/envelope",
                      params={**params, "n_resamples": 50})
    with_fifty = time.monotonic() - t0
    assert full.status_code == 200, full.text

    # Generous, because a test machine is not a benchmark. The point is the
    # order of magnitude: fifty resamples is not a different kind of request.
    assert with_fifty < max(without * 4, 8.0), (
        f"fifty resamples took {with_fifty:.2f}s against {without:.2f}s bare")


def test_an_asset_cap_earns_the_second_panel(client):
    """With a cost of capital to calibrate to, the document gains a panel.

    **Two panels where the figure had three.** The five calibrated distortions
    used to be split across the last two, which was an accident of the order
    they were added rather than a reading anyone wants: the question is how the
    five compare, and five curves on one band answer it. Upstream made that
    call and the api no longer has an opinion about panel contents.

    Asserted on panel count rather than on rendered bytes. The old form compared
    SVG sizes, because an empty axes is a handful of paths and a filled one is
    thousands; a document says how many panels it has.
    """
    # A separate object per case, and that is load bearing rather than tidy:
    # calibrating writes `distortions` onto the cached object and leaves it
    # there, so asking the *same* object bare after asking it calibrated
    # returns the calibrated answer. One object per question keeps each honest.
    for decl in (AGG, PORT):
        bare_decl = decl.replace("BND.", "BNDX.", 1)
        bare_body = _build(client, bare_decl)
        one = client.get(f"/v1/objects/{bare_body['id']}/bounds/envelope",
                         params={"premium": _premium(bare_body), "n_resamples": 0})
        assert one.status_code == 200, one.text

        body = _build(client, decl)
        premium = _premium(body)
        full = client.get(f"/v1/objects/{body['id']}/bounds/envelope",
                          params={"premium": premium, "n_resamples": 0,
                                  "assets": round(premium * 2.5)})
        assert full.status_code == 200, full.text

        # No asset cap means no cost of capital to calibrate to, so the second
        # panel is absent rather than present and empty.
        assert len(one.json()["panels"]) == 1
        assert len(full.json()["panels"]) == 2, (
            f"{decl.split()[1]}: calibrated {len(full.json()['panels'])} panels")


def test_the_calibration_declines_rather_than_raising(client):
    """No asset cap, no calibration, and that is a smaller document not an error.

    Capital is ``a - premium``, so an unbounded asset level leaves no cost of
    capital for the distortion set to be fitted to. The envelope itself is
    unaffected and still worth drawing.
    """
    from aggregate import build as agg_build
    from aggregate_api.bounds import _calibrate_for_envelope

    obj = agg_build(AGG, log2=13)
    premium = float(obj.est_m) * 1.25
    assert _calibrate_for_envelope(obj, premium, None) is False
    # And the boundary the Bounds class itself allows: premium equal to the cap
    # leaves zero capital.
    assert _calibrate_for_envelope(obj, premium, premium) is False
    assert _calibrate_for_envelope(obj, premium, premium * 2.5) is True


def test_the_envelope_declines_a_kind_it_cannot_draw(client):
    body = _build(client, SEV)
    r = client.get(f"/v1/objects/{body['id']}/bounds/envelope",
                   params={"premium": 100})
    assert r.status_code == 400
    assert "Aggregate or a Portfolio" in r.json()["detail"]


def test_a_premium_below_the_expected_loss_is_refused(client):
    """The library requires ``E[X] < premium``, and says so rather than 500ing."""
    body = _build(client, AGG)
    r = client.get(f"/v1/objects/{body['id']}/bounds/envelope",
                   params={"premium": round(body["mean"] * 0.5)})
    assert r.status_code == 400


# ----------------------------------------------------------------------
# AllocationBounds
# ----------------------------------------------------------------------

def test_allocation_ranges_one_row_per_unit(client):
    body = _build(client, PORT)
    r = client.post(f"/v1/objects/{body['id']}/bounds/allocation?ir=true",
                    json={"premium": _premium(body)})
    assert r.status_code == 200, r.text
    payload = r.json()
    assert {"lower", "upper", "width"} <= set(payload["table"]["columns"])
    assert len(payload["table"]["rows"]) == 2, "one row per unit"
    assert payload["ir"] is not None

    columns = payload["table"]["columns"]
    lo, hi = columns.index("lower"), columns.index("upper")
    for row in payload["table"]["rows"]:
        assert row[lo] <= row[hi], "a range runs upwards"


def test_allocation_is_a_portfolio_question(client):
    """One unit means nothing to allocate, and the route says which class."""
    body = _build(client, AGG)
    r = client.post(f"/v1/objects/{body['id']}/bounds/allocation",
                    json={"premium": _premium(body)})
    assert r.status_code == 400
    assert "Portfolio" in r.json()["detail"]


# ----------------------------------------------------------------------
# PricingBounds
# ----------------------------------------------------------------------

def test_pricing_bounds_against_a_unit_of_this_object(client):
    body = _build(client, PORT)
    r = client.post(f"/v1/objects/{body['id']}/bounds/pricing",
                    json={"premium": _premium(body), "against": ["A", "B"]})
    assert r.status_code == 200, r.text
    assert len(r.json()["table"]["rows"]) == 2


def test_pricing_bounds_defaults_to_every_unit_of_a_portfolio(client):
    """An empty ``against`` on a portfolio prices all of its units.

    That is the question a portfolio invites, and having to name one unit to
    ask any of it made the default answer nothing at all. Naming one still
    narrows to it, which is the other half of the contract.
    """
    body = _build(client, PORT)
    every = client.post(f"/v1/objects/{body['id']}/bounds/pricing",
                        json={"premium": _premium(body)})
    assert every.status_code == 200, every.text
    assert len(every.json()["table"]["rows"]) == 2

    one = client.post(f"/v1/objects/{body['id']}/bounds/pricing",
                      json={"premium": _premium(body), "against": ["A"]})
    assert one.status_code == 200, one.text
    assert len(one.json()["table"]["rows"]) == 1


def test_pricing_bounds_still_needs_a_target_on_an_aggregate(client):
    """An aggregate has no units, so there is nothing to default to.

    The empty case is a real error there rather than a shorthand, and it says
    so in the same words it always did.
    """
    body = _build(client, AGG)
    r = client.post(f"/v1/objects/{body['id']}/bounds/pricing",
                    json={"premium": _premium(body)})
    assert r.status_code == 422, r.text


def test_pricing_bounds_against_a_line_that_does_not_exist_yet(client):
    """The quoting question: a new line, written as DecL, priced off this book."""
    body = _build(client, AGG)
    r = client.post(f"/v1/objects/{body['id']}/bounds/pricing", json={
        "premium": _premium(body),
        "against": ["agg BND.New 5 claims sev lognorm 80 cv 1.2 poisson"]})
    assert r.status_code == 200, r.text
    assert len(r.json()["table"]["rows"]) == 1


def test_a_target_that_is_neither_is_a_422_naming_both_ways(client):
    body = _build(client, AGG)
    r = client.post(f"/v1/objects/{body['id']}/bounds/pricing",
                    json={"premium": _premium(body), "against": ["Nonsense"]})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "not a unit" in detail and "does not build" in detail


def test_a_fragment_answers_to_the_log2_cap(client):
    """A DecL fragment is an ordinary build reached by a different door.

    So it cannot be the way round the cap: the same clause typed in the editor
    is refused, and it has to be refused here too.
    """
    body = _build(client, AGG)
    r = client.post(f"/v1/objects/{body['id']}/bounds/pricing", json={
        "premium": _premium(body),
        "against": ["agg BND.Huge 5 claims sev lognorm 80 cv 1.2 poisson "
                    "hints{log2=24}"]})
    assert r.status_code == 422
    assert "log2" in r.json()["detail"]


def test_naming_nothing_is_refused(client):
    body = _build(client, AGG)
    r = client.post(f"/v1/objects/{body['id']}/bounds/pricing",
                    json={"premium": _premium(body), "against": []})
    assert r.status_code == 422


def test_the_bounds_flags_match_what_the_routes_answer(client):
    """The gate and the route have to agree, or a lit leaf 400s on click."""
    for decl, bounds, allocate in ((AGG, True, False), (PORT, True, True),
                                   (SEV, False, False), (PNL, False, False)):
        body = _build(client, decl)
        cap = body["capability"]
        assert cap["can_bounds"] is bounds, decl
        assert cap["can_allocate"] is allocate, decl


# ----------------------------------------------------------------------
# Narrative
# ----------------------------------------------------------------------

def test_narrative_collects_the_object_s_own_prose(client):
    """The info block, then a section per text field the object carries."""
    body = _build(client, AGG)
    r = client.get(f"/v1/objects/{body['id']}/narrative")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["info"], "the info block is the lead"
    names = {s["name"] for s in payload["sections"]}
    # These two are written by any ordinary build, so their absence would mean
    # the suffix scan is not finding what it should.
    assert {"validation", "tail"} <= names, names
    for section in payload["sections"]:
        assert section["description"] or section["explanation"], section["name"]


def test_the_absent_is_reported_as_absent(client):
    """"Not run" and "No reinsurance" are content, so they stay.

    The library writes an informative line for a narrative with nothing to
    report rather than leaving it empty, which is better than silence: a
    missing Sharpen heading would read as an app that forgot it, where "Sharpen:
    not run." reads as an audit you have not asked for yet. So the filter drops
    genuinely empty strings and nothing else. No matching on the text, which
    would rot the moment the library rephrased a sentence.
    """
    body = _build(client, AGG)
    sections = {s["name"]: s for s in client.get(
        f"/v1/objects/{body['id']}/narrative").json()["sections"]}
    assert "not run" in sections["sharpen"]["description"].lower()
    assert "no reinsurance" in sections["reins"]["description"].lower()
    # Still dropped when there is truly nothing: every section carries text.
    for section in sections.values():
        assert section["description"] or section["explanation"]


def test_narrative_sections_are_in_reading_order(client):
    """Not alphabetical by attribute stem, which is no order at all.

    The pane used to come out bs, reins, sharpen, tail, validation, sorted over
    names the reader never sees. The order now is the order the questions get
    asked in: what grid it was built on, whether that grid is trustworthy, how
    it behaves in the tail, what was ceded off it, and last the grid audit,
    which is the most specialist of them and the one most often absent.
    """
    body = _build(client, AGG)
    names = [s["name"] for s in client.get(
        f"/v1/objects/{body['id']}/narrative").json()["sections"]]
    expected = [n for n in ("bs", "validation", "tail", "reins", "sharpen")
                if n in names]
    assert names[:len(expected)] == expected, names
    # Anything the library adds later lands after the declared ones rather than
    # disappearing or jumping the queue.
    assert names[len(expected):] == sorted(names[len(expected):]), names


def test_narrative_follows_what_the_object_actually_is(client):
    """A cession changes what the reinsurance narrative says.

    The section list is derived by suffix rather than listed, so this is the
    same mechanism that would surface a narrative the library adds upstream,
    with no edit on either side.
    """
    plain = _build(client, AGG)
    ceded = _build(client, "agg BND.R 10 claims sev lognorm 100 cv 1.5 "
                           "occurrence net of 100 xs 100 poisson")

    def reins_text(body):
        sections = client.get(
            f"/v1/objects/{body['id']}/narrative").json()["sections"]
        return next(s["description"] for s in sections if s["name"] == "reins")

    assert "no reinsurance" in reins_text(plain).lower()
    assert "no reinsurance" not in reins_text(ceded).lower()


def test_narrative_answers_for_every_kind(client):
    """Including the ones carrying almost nothing: an empty list, not a 500."""
    for decl in (AGG, PORT, SEV, PNL):
        body = _build(client, decl)
        r = client.get(f"/v1/objects/{body['id']}/narrative")
        assert r.status_code == 200, decl
        assert isinstance(r.json()["sections"], list)
