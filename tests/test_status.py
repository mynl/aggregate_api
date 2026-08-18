"""Tests for the operator's page and the gate in front of it.

The security cases are the ones that matter and they are written against the
**real topology**, not against a laptop. Both Caddy front doors proxy to
``127.0.0.1:8001``, so in production the peer address is loopback for a visitor
from the public internet exactly as much as for one on the VPN. Every gate case
below therefore fixes the peer at ``127.0.0.1`` and varies only the forwarded
header, which is the only thing that actually differs between the two.

``test_the_first_forwarded_element_does_not_admit`` is the regression test for
the rule, and the reason the rule is "last, never first".
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aggregate_api import status as status_state

#: Both routes, because the gate is two registrations and only one of them can
#: be forgotten.
ROUTES = ("/v1/status", "/v1/status/page")

#: A program that resolves nothing, so it keys shared and builds fast.
PROGRAM = "agg StatusProbe 10 claims sev lognorm 100 cv 2 poisson"


@pytest.fixture
def status_client(tmp_path, monkeypatch):
    """A client whose peer is loopback, which is what Caddy's peer would be.

    Notes
    -----
    The shared ``client`` fixture leaves the peer as Starlette's default,
    ``testclient``, which parses as no address at all and is therefore refused.
    That is the gate working, but it makes the default fixture useless here, so
    this one sets a peer explicitly. Every case then varies the header rather
    than the peer, which is the shape of the deployment.
    """
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "20")
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")
    status_state.reset()

    from aggregate_api.app import create_app

    with TestClient(create_app(), client=("127.0.0.1", 51000)) as made:
        yield made


# ----------------------------------------------------------------------
# The gate
# ----------------------------------------------------------------------
@pytest.mark.parametrize("route", ROUTES)
def test_direct_on_the_box_is_admitted(status_client, route):
    """No proxy, so the peer is the client, and the peer is loopback."""
    assert status_client.get(route).status_code == 200


@pytest.mark.parametrize("route", ROUTES)
def test_the_vpn_through_caddy_is_admitted(status_client, route):
    """Caddy on the VPN reports the VPN address it observed."""
    response = status_client.get(route, headers={"X-Forwarded-For": "10.8.0.2"})
    assert response.status_code == 200


@pytest.mark.parametrize("route", ROUTES)
def test_the_public_internet_is_refused(status_client, route):
    """The peer is loopback here too, so only the header can tell them apart."""
    response = status_client.get(route,
                                 headers={"X-Forwarded-For": "203.0.113.7"})
    assert response.status_code == 404


@pytest.mark.parametrize("route", ROUTES)
def test_the_first_forwarded_element_does_not_admit(status_client, route):
    """The regression test for "last, never first".

    Caddy appends what it observed, so a public visitor who sends
    ``X-Forwarded-For: 10.8.0.2`` arrives as ``10.8.0.2, <their address>``.
    Reading the first element would hand them the page.
    """
    response = status_client.get(
        route, headers={"X-Forwarded-For": "10.8.0.2, 203.0.113.7"})
    assert response.status_code == 404


@pytest.mark.parametrize("route", ROUTES)
def test_a_forged_zone_header_does_not_rescue_a_public_request(status_client, route):
    """Layer three is off, and it would not be a way in even when it is on.

    Notes
    -----
    The plan's table wrote this case with a loopback peer and no forwarded
    header, which layer two admits on its own, so it could not have failed. The
    case that carries the intent is a public request that also forges the zone
    header: the header must add a condition and never satisfy one.
    """
    response = status_client.get(route, headers={
        "X-Forwarded-For": "203.0.113.7",
        "X-Aggapi-Zone": "private",
    })
    assert response.status_code == 404


@pytest.mark.parametrize("route", ROUTES)
def test_an_empty_forwarded_header_is_refused(status_client, route):
    """The degenerate parse: present, and saying nothing.

    A naive ``split(',')[-1]`` turns this into the empty string, which must not
    compare equal to anything. And the branch turns on the header being present
    rather than on an address being recovered, so it does not fall back to the
    loopback peer either.
    """
    response = status_client.get(route, headers={"X-Forwarded-For": ""})
    assert response.status_code == 404


@pytest.mark.parametrize("route", ROUTES)
def test_a_trailing_comma_is_refused(status_client, route):
    """``"10.8.0.2,"`` ends in an empty element, and that element is the one read.

    Dropping empty elements would make the last one ``10.8.0.2``, a value the
    client chose, so a proxy that had stopped appending would admit whatever a
    visitor cared to send.
    """
    response = status_client.get(route,
                                 headers={"X-Forwarded-For": "10.8.0.2,"})
    assert response.status_code == 404


def test_a_clients_own_header_line_does_not_win(status_client):
    """Two header lines: the client's first, the proxy's second.

    ``Headers.get`` returns only the first occurrence, so reading it rather than
    the flattened list would treat the client's own line as the whole chain.
    """
    response = status_client.get(
        "/v1/status",
        headers=[("X-Forwarded-For", "10.8.0.2"),
                 ("X-Forwarded-For", "203.0.113.7")],
    )
    assert response.status_code == 404


def test_the_zone_header_can_be_required(tmp_path, monkeypatch):
    """With layer three on, a private address is necessary and not sufficient."""
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_STATUS_REQUIRE_ZONE_HEADER", "true")

    from aggregate_api.app import create_app

    with TestClient(create_app(), client=("127.0.0.1", 51000)) as made:
        assert made.get("/v1/status").status_code == 404
        admitted = made.get("/v1/status",
                            headers={"X-Aggapi-Zone": "private"})
        assert admitted.status_code == 200


def test_the_private_list_is_configurable(tmp_path, monkeypatch):
    """A deploy on a different VPN subnet sets the list rather than patching code."""
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_PRIVATE_CIDRS", "192.168.5.0/24")

    from aggregate_api.app import create_app

    with TestClient(create_app(), client=("127.0.0.1", 51000)) as made:
        # Loopback is no longer in the list, so the direct case now refuses.
        assert made.get("/v1/status").status_code == 404
        allowed = made.get("/v1/status",
                           headers={"X-Forwarded-For": "192.168.5.11"})
        assert allowed.status_code == 200


def test_a_refusal_is_recorded_and_bounded(status_client):
    """Refusals are counted and kept, address and path only, capped at 20."""
    for _ in range(25):
        status_client.get("/v1/status",
                          headers={"X-Forwarded-For": "203.0.113.7"})
    payload = status_client.get("/v1/status").json()
    assert payload["gate"]["refusals"] == 25
    assert len(payload["gate"]["recent"]) == status_state.REFUSAL_BUFFER
    assert set(payload["gate"]["recent"][0]) == {"at", "address", "path"}
    assert payload["gate"]["recent"][0]["address"] == "203.0.113.7"


def test_the_routes_are_absent_from_the_openapi_schema(status_client):
    """Layer one blocks the prefix; the schema must not advertise it either."""
    paths = status_client.get("/openapi.json").json()["paths"]
    assert not [p for p in paths if p.startswith("/v1/status")]


# ----------------------------------------------------------------------
# The payload
# ----------------------------------------------------------------------
def test_the_payload_carries_every_panel(status_client):
    """A 200 means it validated against ``StatusResponse``; this pins the panels."""
    payload = status_client.get("/v1/status").json()
    assert set(payload) == {
        "generated_at", "generated_in_ms", "identity", "settings", "sessions",
        "cache", "chart_cache", "builds", "key_scope", "resources", "gate",
        "watch",
    }


def test_the_payload_reports_its_own_cost(status_client):
    """``generated_in_ms`` is present and inside a stated budget.

    Notes
    -----
    250 ms rather than the 30 the development box measures, because this runs on
    whatever CI or laptop is to hand and the number it is guarding against is a
    regression of a different order: a walk into numpy to size an object, or an
    unwindowed pass over the audit table, would be seconds and not tens of
    milliseconds.
    """
    status_client.post("/v1/objects", json={"decl": PROGRAM, "log2": 12})
    payload = status_client.get("/v1/status").json()
    assert 0 < payload["generated_in_ms"] < 250


def test_the_library_is_not_loaded_just_to_report_on_it(status_client):
    """A cold process must not pay a library read to render its own status."""
    payload = status_client.get("/v1/status").json()
    assert payload["identity"]["library_loaded"] is False
    assert payload["identity"]["library_recipes"] is None
    status_client.post("/v1/objects", json={"decl": PROGRAM, "log2": 12})
    payload = status_client.get("/v1/status").json()
    assert payload["identity"]["library_loaded"] is True
    assert payload["identity"]["library_recipes"] > 0


def test_a_build_moves_the_counters(status_client):
    """One build, and the cache, session, key-scope and audit panels agree."""
    built = status_client.post("/v1/objects", json={"decl": PROGRAM, "log2": 12})
    assert built.status_code == 200
    payload = status_client.get("/v1/status").json()

    assert payload["cache"]["entries"] == 1
    assert payload["cache"]["misses"] == 1
    assert payload["cache"]["puts"] == 1
    assert payload["cache"]["rows"][0]["id"] == built.json()["id"]
    assert payload["cache"]["rows"][0]["program"] == PROGRAM
    assert payload["cache"]["rows"][0]["estimated_bytes"] > 0

    assert payload["sessions"]["live"] == 1
    assert payload["sessions"]["rows"][0]["builds"] == 1

    assert payload["key_scope"]["shared"] == 1
    assert payload["key_scope"]["session"] == 0
    assert payload["key_scope"]["preview_calls"] == 1

    assert payload["builds"]["hour"]["total"] == 1
    assert payload["builds"]["hour"]["by_status"] == {"ok": 1}
    assert payload["builds"]["hour"]["by_key_scope"] == {"shared": 1}


def test_a_session_reference_qualifies_and_is_counted(status_client):
    """Building on a name the session declared keys private, for the right reason."""
    session = {"X-Aggregate-Session": "2026-08-18T10:00:00.000Z-abcdefab-1234-5678-9abc-def012345678"}
    status_client.post("/v1/objects", headers=session,
                       json={"decl": "agg StatusInner 10 claims sev lognorm 100 cv 2 poisson",
                             "log2": 12})
    status_client.post("/v1/objects", headers=session,
                       json={"decl": "port StatusBook agg.StatusInner", "log2": 12})
    payload = status_client.get("/v1/status").json()
    assert payload["key_scope"]["session"] >= 1
    assert payload["key_scope"]["reasons"]["session_reference"] >= 1
    assert payload["key_scope"]["reasons"]["preview_unavailable"] == 0


def test_a_session_id_never_appears_in_full(status_client):
    """The id is a namespace and not a boundary, so the payload must not carry one.

    Truncation is server side rather than in the page, so saving the JSON does
    not save a list of other people's namespaces either.
    """
    full = "2026-08-18T10:00:00.000Z-abcdefab-1234-5678-9abc-def012345678"
    status_client.post("/v1/objects", headers={"X-Aggregate-Session": full},
                       json={"decl": PROGRAM, "log2": 12})
    response = status_client.get("/v1/status")
    assert full not in response.text
    row = response.json()["sessions"]["rows"][0]
    assert row["session_id"] == "2026-08-18T10:00:00.000Z·abcdefab…"


def test_nothing_under_status_mutates_anything(status_client):
    """Read only, asserted rather than promised.

    Takes a snapshot of the cache and of every counter, reads the status route
    and the page, and requires both snapshots to match. The route is not allowed
    to build, evict, register or count anything about itself.
    """
    status_client.post("/v1/objects", json={"decl": PROGRAM, "log2": 12})
    before = status_client.get("/v1/status").json()

    status_client.get("/v1/status")
    status_client.get("/v1/status/page")

    after = status_client.get("/v1/status").json()
    for panel in ("cache", "key_scope", "chart_cache"):
        moved = {k: (before[panel][k], after[panel][k])
                 for k in before[panel]
                 if k not in ("rows", "recent_unpreviewable")
                 and before[panel][k] != after[panel][k]}
        assert not moved, f"{panel} moved: {moved}"
    assert before["sessions"]["taken"] == after["sessions"]["taken"]
    assert before["builds"]["hour"]["total"] == after["builds"]["hour"]["total"]


# ----------------------------------------------------------------------
# The retention invariant, section 4.8 of the plan
# ----------------------------------------------------------------------
def test_the_program_buffer_is_capped():
    """500 in, 50 retained. The cap is ``deque(maxlen=...)`` and is structural."""
    status_state.reset()
    for i in range(500):
        status_state.record_unpreviewable_build(f"agg P{i} 1 claim dsev[1] fixed",
                                                "anonymous", "agg", 1)
    state = status_state.key_scope_state()
    assert state["unpreviewable_builds"] == 500
    assert len(state["recent_unpreviewable"]) == status_state.PROGRAM_BUFFER
    # Newest first, so the last one pushed reads first.
    assert "agg P499 " in state["recent_unpreviewable"][0]["program"]


def test_a_long_program_is_stored_truncated_and_marked():
    """50,000 characters in, 2,000 stored, and the flag says so."""
    status_state.reset()
    status_state.record_unpreviewable_build("x" * 50_000, "anonymous", "agg", 1)
    kept = status_state.key_scope_state()["recent_unpreviewable"][0]
    assert len(kept["program"]) == status_state.PROGRAM_CHARS
    assert kept["truncated"] is True


def test_reset_clears_every_counter_and_buffer():
    """Restarting the process clears the lot, and ``reset`` is the test's stand-in."""
    status_state.record_key_scope("session", "preview_unavailable")
    status_state.record_refusal("203.0.113.7", "/v1/status")
    status_state.reset()
    state = status_state.key_scope_state()
    assert state["shared"] == 0 and state["session"] == 0
    assert state["recent_unpreviewable"] == []
    assert status_state.gate_state() == {"refusals": 0, "recent": []}


# ----------------------------------------------------------------------
# Resources
# ----------------------------------------------------------------------
def test_resources_report_unavailable_with_a_reason_not_zero(monkeypatch, status_client):
    """Without ``psutil``, a field that cannot be read is blank and says why.

    Notes
    -----
    Forced rather than waited for. ``psutil`` arrives transitively through
    ``ipython``, so the stdlib path is never taken by accident on a development
    box and would ship untested otherwise. A resource panel that silently
    reported zero resident bytes would be worse than one reporting nothing,
    because the zero is a number an operator would act on.
    """
    from aggregate_api import resources

    monkeypatch.setattr(resources, "psutil", None)
    monkeypatch.setattr(resources, "_process", None)
    block = resources.snapshot(".")
    assert block["source"] == "stdlib"
    assert block["unavailable"]["source"] == resources.NO_PSUTIL
    # Never zero: either a real reading, or absent with a reason recorded.
    for field in ("rss_bytes", "vms_bytes", "open_files"):
        assert block[field] is None or block[field] > 0
        if block[field] is None:
            assert block["unavailable"]
    assert block["disk_free_bytes"] > 0
    assert block["threads"] > 0


def test_the_resource_block_names_its_source(status_client):
    """The page prints the source, so a number that looks wrong can be traced."""
    block = status_client.get("/v1/status").json()["resources"]
    assert block["source"] in ("psutil", "stdlib")
    assert isinstance(block["unavailable"], dict)


# ----------------------------------------------------------------------
# The page
# ----------------------------------------------------------------------
def test_the_page_is_self_contained(status_client):
    """One file, no external requests, no build step, and no cache.

    A strict reading: the page may fetch its own JSON and nothing else, because
    a status page that depends on a CDN is a status page that goes blank exactly
    when the network is the problem.
    """
    page = status_client.get("/v1/status/page")
    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-store"
    body = page.text
    assert "__REFRESH_MS__" not in body
    assert "src=" not in body
    assert "https://" not in body
    assert "<link" not in body


def test_the_json_route_is_not_cached(status_client):
    """A cached snapshot of a moving process is worse than no snapshot."""
    assert status_client.get("/v1/status").headers["cache-control"] == "no-store"
