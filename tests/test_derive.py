"""The derivations behind the action row: Sharpen, Hints, PnL and Reins.

Every derivation in this app is a program you can see. The route returns the
DecL that reproduces the object alongside the object itself, so the text lands
in the editor, you read what was built, and history, sharing and rebuild all
keep working.

The load-bearing tests here are the cache ones. ``sharpen`` moves its object in
place while the cache is keyed on a hash of ``(decl, log2, bs)``, so a naive
implementation leaves the cache serving, under a key asserting one grid, an
object sitting on another. The rule since a111 is that the probe runs on a
**copy** and files the result as a new entry, leaving the original where it was:
the object cache is shared between sessions on purpose, so a sharpen that moved
the cached object would change the grid under everyone else reading it. These
are what hold it to that.
"""

from __future__ import annotations

import pytest

AGG = "agg DRV.A 10 claims sev lognorm 100 cv 1.5 poisson"
# A program whose automatic grid clips the right tail at log2=12, so the probe
# has somewhere better to go and the *moved* branch gets exercised. The
# confirmed branch is the one AGG takes.
CLIPPED = "agg DRV.Heavy 100 claims sev lognorm 100 cv 2 poisson"
PORT = ("port DRV.P agg A 10 claims sev lognorm 100 cv 1.5 poisson "
        "agg B 5 claims sev gamma 50 cv 0.8 poisson")
PRICED = "agg DRV.Priced 1000 premium at 0.65 lr sev lognorm 100 cv 1 poisson"
PNL = ("pnl DRV.Pnl 1000 prem less "
       "agg DRV.PnlL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson")
SEV = "sev DRV.S lognorm 50 cv 1.5"


def _build(client, decl, log2=12):
    body = {"decl": decl}
    if log2 is not None:
        body["log2"] = log2
    r = client.post("/v1/objects", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ----------------------------------------------------------------------
# Sharpen
# ----------------------------------------------------------------------

def test_sharpen_returns_the_program_that_rebuilds_the_object(client):
    """The whole contract: what comes back builds what you are looking at."""
    first = _build(client, AGG)
    r = client.post(f"/v1/objects/{first['id']}/sharpen", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"], "a derivation without its program is hidden state"
    assert body["description"], "the probe says what it did"
    assert body["kind"] == "agg"


def test_a_derived_program_comes_back_spread(client):
    """One clause per indented line, not one long line.

    The text lands in the editor and the whole point of a derivation is that you
    read what it did and can edit it. Through a50 all three derivations
    collapsed their program first, and a wrapped portfolio came back as several
    hundred characters of unbroken DecL.
    """
    first = _build(client, AGG)
    program = client.post(f"/v1/objects/{first['id']}/sharpen",
                          json={}).json()["program"]
    lines = [ln for ln in program.splitlines() if ln.strip()]
    assert len(lines) > 1, f"still one line: {program!r}"
    assert lines[0].startswith("agg "), "the statement opens undented"
    assert any(ln.startswith("  ") for ln in lines[1:]), "clauses are indented"


def test_the_spread_program_keeps_its_trailer(client):
    """`format_program` drops `note{}` / `tags{}` / `hints{}` unless told not to.

    Which would be fatal here rather than cosmetic: Sharpen's entire contract is
    that the `hints{}` it writes rides on the returned text, so building that
    text reproduces the grid the probe chose. A program rendered without its
    trailer looks right and rebuilds on the old grid.
    """
    first = _build(client, AGG)
    body = client.post(f"/v1/objects/{first['id']}/sharpen", json={}).json()
    # AGG's grid is confirmed rather than moved, so the trailer it carries is
    # the `note{}` verdict. Either clause proves the trailer survived.
    assert "note{" in body["program"] or "hints{" in body["program"], body["program"]


def test_the_sharpened_object_is_a_new_entry(client):
    """A new id, and the old one still serving the object it always did.

    Two things at once. The id asserts a ``(decl, log2, bs)`` triple, so a
    probed object cannot stay under the key of the text that built it, or the
    cache lies about what it holds. And the object cache is shared across
    sessions by design, so the original cannot be moved or dropped either: some
    other reader is holding that id. So the sharpened object is filed alongside
    rather than in place of.
    """
    first = _build(client, AGG)
    old_id = first["id"]
    r = client.post(f"/v1/objects/{old_id}/sharpen", json={})
    assert r.status_code == 200, r.text
    assert r.json()["id"] != old_id

    still_there = client.get(f"/v1/objects/{old_id}")
    assert still_there.status_code == 200
    assert still_there.json()["decl"] == AGG


def test_rebuilding_the_derived_text_is_a_cache_hit(client):
    """The derived id is the id an ordinary build of that text would produce.

    Which is what makes the round trip free: the program lands in the editor,
    and pressing Build on it finds the object already there rather than paying
    for a second one. It only works because the id is computed over the same
    collapsed, canonicalized bytes the build route hashes.
    """
    first = _build(client, AGG)
    derived = client.post(f"/v1/objects/{first['id']}/sharpen", json={}).json()

    again = client.post("/v1/objects", json={"decl": derived["program"]})
    assert again.status_code == 200, again.text
    assert again.json()["id"] == derived["id"]
    assert again.json()["cached"] is True, "the derived object was rebuilt"


def test_a_confirmed_grid_refuses_a_second_audit(client):
    """A second probe of a grid just confirmed is a slow no-op.

    The flag and the route agree, so the button greys and the endpoint refuses:
    the app never has to be the only thing standing between the user and a
    pointless thirty seconds.
    """
    first = _build(client, AGG)
    derived = client.post(f"/v1/objects/{first['id']}/sharpen", json={}).json()
    assert derived["capability"]["can_sharpen"] is False

    again = client.post(f"/v1/objects/{derived['id']}/sharpen", json={})
    assert again.status_code == 400
    assert "verdict" in again.json()["detail"]


def test_a_moved_grid_pins_hints_and_stays_sharpenable(client):
    """The other branch: the probe finds better, so hints carry the record.

    A move writes ``hints{}`` and clears the note, and the button stays live,
    because probing again from the new center can find more. That asymmetry is
    deliberate and this is what holds it.
    """
    first = _build(client, CLIPPED)
    r = client.post(f"/v1/objects/{first['id']}/sharpen", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    if "hints{" not in body["program"]:
        pytest.skip("this program's grid was confirmed, not moved")
    assert "sharpen:" not in body["program"], "a move clears the stale verdict"
    assert body["capability"]["can_sharpen"] is True
    # And it still rebuilds to itself, hints and all.
    again = client.post("/v1/objects", json={"decl": body["program"]})
    assert again.status_code == 200, again.text
    assert again.json()["id"] == body["id"]


def test_the_probe_respects_the_api_log2_cap(client, monkeypatch):
    """A derived program the app could not rebuild is worse than no move.

    ``sharpen`` defaults to ``log2_cap=20`` and ``AGGAPI_LOG2_CAP`` defaults to
    18, so the api has to pass its own cap in. Without that the probe can land
    on a grid the build route then refuses with a 422, and the user is holding
    a program that will not build.
    """
    first = _build(client, CLIPPED)
    r = client.post(f"/v1/objects/{first['id']}/sharpen", json={})
    assert r.status_code == 200, r.text
    program = r.json()["program"]
    # Whatever the probe chose has to survive the build route's own cap check.
    rebuilt = client.post("/v1/objects", json={"decl": program})
    assert rebuilt.status_code == 200, rebuilt.text


def test_sharpen_declines_where_there_is_no_grid(client):
    """A severity has no grid to audit, and says so rather than 500ing."""
    obj = _build(client, SEV)
    r = client.post(f"/v1/objects/{obj['id']}/sharpen", json={})
    assert r.status_code == 400
    assert "Aggregate" in r.json()["detail"]


# ----------------------------------------------------------------------
# PnL
# ----------------------------------------------------------------------

def test_pnl_wraps_an_aggregate_and_leaves_it_alone(client):
    """The source object is untouched: this derivation mutates nothing.

    Which is why, unlike sharpening, there is no re-filing to do. Reset going
    back to the base object is a cache hit rather than a rebuild.
    """
    source = _build(client, AGG)
    r = client.post(f"/v1/objects/{source['id']}/pnl", json={"loss_ratio": 0.65})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "pnl"
    assert body["id"] != source["id"]
    assert body["program"].startswith("pnl DRV.A_PnL")
    assert client.get(f"/v1/objects/{source['id']}").status_code == 200


def test_pnl_text_is_self_contained(client):
    """It builds anywhere, not only in the session that wrote it.

    The load-bearing choice from the library's plan, and the reason the app can
    hand the text to a user at all. A reference (``agg.NAME`` / ``port.NAME``)
    resolves only against the underwriter holding that name, so a shared server
    would be writing every visitor's book into one store to make it work.
    """
    for decl in (AGG, PORT):
        source = _build(client, decl)
        r = client.post(f"/v1/objects/{source['id']}/pnl", json={})
        assert r.status_code == 200, r.text
        program = r.json()["program"]
        assert "agg." not in program and "port." not in program, program


def test_pnl_derives_a_premium_when_the_exposure_states_one(client):
    """And sizes one from the loss ratio when it does not.

    ``derive premium`` since ``aggregate`` 1.0.0a270: the engine's technical
    premium grossed up for the expense clause, ``inherit premium`` before.
    """
    priced = _build(client, PRICED)
    r = client.post(f"/v1/objects/{priced['id']}/pnl", json={})
    assert "derive premium" in r.json()["program"]

    bare = _build(client, AGG)
    r = client.post(f"/v1/objects/{bare['id']}/pnl", json={"loss_ratio": 0.65})
    assert "derive premium" not in r.json()["program"]
    assert "premium" in r.json()["program"]


def test_pnl_expense_ratio_zero_omits_the_clause(client):
    """Zero means no clause, not a clause reading zero."""
    source = _build(client, AGG)
    r = client.post(f"/v1/objects/{source['id']}/pnl",
                    json={"expense_ratio": 0})
    assert r.status_code == 200, r.text
    assert "expense" not in r.json()["program"]


def test_pnl_derived_text_rebuilds_to_the_same_object(client):
    """Same contract as sharpen: the editor's Build finds it already there."""
    source = _build(client, AGG)
    derived = client.post(f"/v1/objects/{source['id']}/pnl", json={}).json()
    again = client.post("/v1/objects", json={"decl": derived["program"]})
    assert again.status_code == 200, again.text
    assert again.json()["id"] == derived["id"]
    assert again.json()["cached"] is True


def test_pnl_declines_what_it_cannot_wrap(client):
    """A severity has no exposure to wrap, and a P&L is already one.

    Both answer 400 from the route rather than 422 from the library, because
    neither kind carries ``pnl_program`` at all: the library puts the method
    only on the two classes that can honestly answer, so "does this object have
    it" is the whole test and the guard never has to name a kind.
    """
    for decl in (SEV, PNL):
        obj = _build(client, decl)
        r = client.post(f"/v1/objects/{obj['id']}/pnl", json={})
        assert r.status_code == 400, decl
        assert "Aggregate or a Portfolio" in r.json()["detail"]


# ----------------------------------------------------------------------
# Hints
# ----------------------------------------------------------------------

def test_hints_pins_the_grid_the_object_built_on(client):
    """The clause comes back stating the grid, and it is the one that was used."""
    source = _build(client, AGG, log2=13)
    r = client.post(f"/v1/objects/{source['id']}/hints", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "hints{" in body["program"]
    assert "log2=13" in body["program"].replace(" ", "")
    # The grid did not move: this writes down where the object already was,
    # which is the whole difference from Sharpen.
    assert body["log2"] == source["log2"]
    assert body["bs"] == source["bs"]


def test_hints_says_nothing_because_the_text_says_it(client):
    """Empty ``description``, unlike Sharpen.

    Sharpen fills it because a probe's verdict is a fact the reader cannot
    otherwise see. Here the result *is* the returned text.
    """
    source = _build(client, AGG)
    body = client.post(f"/v1/objects/{source['id']}/hints", json={}).json()
    assert body["description"] is None


def test_hints_derived_text_rebuilds_to_the_same_object(client):
    """The `DerivedResponse` contract, same as sharpen and pnl."""
    source = _build(client, AGG)
    derived = client.post(f"/v1/objects/{source['id']}/hints", json={}).json()
    again = client.post("/v1/objects", json={"decl": derived["program"]})
    assert again.status_code == 200, again.text
    assert again.json()["id"] == derived["id"]
    assert again.json()["cached"] is True


def test_hints_works_on_a_portfolio(client):
    """``with_hints`` is on both classes the flag claims, not just the aggregate."""
    source = _build(client, PORT)
    r = client.post(f"/v1/objects/{source['id']}/hints", json={})
    assert r.status_code == 200, r.text
    assert "hints{" in r.json()["program"]


def test_hints_keeps_the_rest_of_the_trailer(client):
    """The clause is merged key by key, so a declared setting survives.

    The library's contract, and the reason this is not "write a hints clause":
    a program that already says something about how it builds must not lose it
    to a button whose subject is the grid.
    """
    decl = f"{AGG} note{{keep me}}"
    source = _build(client, decl)
    program = client.post(f"/v1/objects/{source['id']}/hints",
                          json={}).json()["program"]
    assert "keep me" in program
    assert "hints{" in program


def test_hints_declines_what_has_no_grid_to_pin(client):
    """A severity has no realized grid, and the route says so before the library.

    400 from the guard rather than 422 from ``with_hints``, because the method
    is absent rather than unhappy: ``aggregate`` puts it on exactly the two
    classes that can answer, so ``hasattr`` is the whole test.
    """
    obj = _build(client, SEV)
    r = client.post(f"/v1/objects/{obj['id']}/hints", json={})
    assert r.status_code == 400
    assert "Aggregate or a Portfolio" in r.json()["detail"]


def test_the_hints_flag_rides_on_the_build(client):
    """The button greys off the manifest, so the flag has to be in it."""
    assert _build(client, AGG)["capability"]["can_hints"] is True
    assert _build(client, PORT)["capability"]["can_hints"] is True
    assert _build(client, SEV)["capability"]["can_hints"] is False


# ----------------------------------------------------------------------
# Reinsurance
# ----------------------------------------------------------------------

def test_ceding_a_layer_returns_the_net_program(client):
    """The derived object is ``NAME_net``, built from self-contained text."""
    source = _build(client, AGG)
    r = client.post(f"/v1/objects/{source['id']}/reins",
                    json={"cession": "occurrence net of 500 xs 500"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert body["has_reins"] is True
    assert "agg." not in body["program"] and "port." not in body["program"]
    # And the gross object is untouched, which is what makes Reset a cache hit.
    assert client.get(f"/v1/objects/{source['id']}").status_code == 200


def test_a_cession_lights_the_reinsurance_group(client):
    """Before, only the entry box; after, the tables and the chart.

    The group is live either way, which is the point of ``can_reins``: an
    aggregate with no cession has nothing to tabulate and is exactly the object
    you want to add cover to.
    """
    source = _build(client, AGG)
    gross = source["capability"]
    assert gross["can_reins"] is True
    assert "reins" not in {e["name"] for e in gross["exhibits"]}
    assert "reins" not in gross["charts"]

    net = client.post(f"/v1/objects/{source['id']}/reins",
                      json={"cession": "occurrence net of 500 xs 500"}).json()
    assert "reins" in {e["name"] for e in net["capability"]["exhibits"]}
    assert "reins" in net["capability"]["charts"]


def test_a_clause_per_tier(client):
    """Occurrence and aggregate cessions land in different slots.

    Which is the whole reason this is a library question: a clause cannot be
    appended, since an occurrence cession sits before the frequency clause and
    an aggregate cession after it.
    """
    source = _build(client, AGG)
    r = client.post(f"/v1/objects/{source['id']}/reins", json={
        "cession": ["occurrence net of 500 xs 500",
                    "aggregate net of 1000 xs 1000"]})
    assert r.status_code == 200, r.text
    program = r.json()["program"]
    assert "occurrence net of" in program
    assert "aggregate net of" in program


def test_a_malformed_cession_is_a_422(client):
    """The error pane already knows how to render one."""
    source = _build(client, AGG)
    r = client.post(f"/v1/objects/{source['id']}/reins",
                    json={"cession": "net of 500 xs 500"})
    assert r.status_code == 422


def test_ceding_declines_where_it_cannot_apply(client):
    """A portfolio cedes through its units, not as a whole."""
    port = _build(client, PORT)
    r = client.post(f"/v1/objects/{port['id']}/reins",
                    json={"cession": "occurrence net of 500 xs 500"})
    assert r.status_code == 400
    assert port["capability"]["can_reins"] is False


def test_the_net_program_rebuilds_to_the_same_object(client):
    """Same contract as the other two derivations."""
    source = _build(client, AGG)
    derived = client.post(f"/v1/objects/{source['id']}/reins",
                          json={"cession": "occurrence net of 500 xs 500"}).json()
    again = client.post("/v1/objects", json={"decl": derived["program"]})
    assert again.status_code == 200, again.text
    assert again.json()["id"] == derived["id"]
    assert again.json()["cached"] is True


def test_a_derived_program_goes_through_the_ordinary_build_guards(client):
    """The P&L route calls the build endpoint rather than reimplementing it.

    So the log2 cap, the timeout, the audit row and the whole parse-error
    surface apply to a derived program exactly as they do to a typed one. The
    visible consequence is that the response is a full build manifest, not a
    thinner thing that happens to look like one.
    """
    source = _build(client, AGG)
    body = client.post(f"/v1/objects/{source['id']}/pnl", json={}).json()
    assert set(body) >= {"id", "kind", "name", "cached", "elapsed_ms",
                         "capability", "program"}
    assert body["capability"]["can_evaluate"] is True, "a P&L evaluates"
