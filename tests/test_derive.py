"""The derivations behind the action row: Sharpen and PnL.

Every derivation in this app is a program you can see. The route returns the
DecL that reproduces the object alongside the object itself, so the text lands
in the editor, you read what was built, and history, sharing and rebuild all
keep working.

The load-bearing tests here are the cache ones. ``sharpen`` moves its object in
place while the cache is keyed on a hash of ``(decl, log2, bs)``, so a naive
implementation leaves the cache serving, under a key asserting one grid, an
object sitting on another. The rule is that the entry moves with the object and
nothing is rebuilt, and these are what hold it to that.
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


def test_the_entry_moves_with_the_object(client):
    """The old id is gone rather than still serving the moved object.

    This is the failure the cache rule exists to prevent: the id asserts a
    ``(decl, log2, bs)`` triple, and after a probe the object may sit on a
    different grid, so leaving it under the old key would make the cache lie.
    """
    first = _build(client, AGG)
    old_id = first["id"]
    r = client.post(f"/v1/objects/{old_id}/sharpen", json={})
    assert r.status_code == 200, r.text
    assert r.json()["id"] != old_id
    assert client.get(f"/v1/objects/{old_id}").status_code == 404


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


def test_pnl_inherits_a_premium_when_the_exposure_states_one(client):
    """And sizes one from the loss ratio when it does not."""
    priced = _build(client, PRICED)
    r = client.post(f"/v1/objects/{priced['id']}/pnl", json={})
    assert "inherit premium" in r.json()["program"]

    bare = _build(client, AGG)
    r = client.post(f"/v1/objects/{bare['id']}/pnl", json={"loss_ratio": 0.65})
    assert "inherit premium" not in r.json()["program"]
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
