"""Identical builds arriving together build once.

A request that misses the cache while another request is building the same
program waits for the build slot, then re-checks the cache and is answered as a
hit. Without that, twenty Sheets cells passing one new program (each its own
Apps Script execution, so twenty POSTs) ran twenty serial builds. See
``dev/done/plan-build-single-flight.md``.

The concurrent test holds the first build open on an event, so the second
request is provably queued on the slot (``waiting == 1``) before the first one
finishes. That poll is what stops the test passing vacuously: run one after the
other, the second request would be an ordinary hit on arrival and never wait.
"""

from __future__ import annotations

import threading
import time

PROGRAM = "agg Dice dfreq [3] dsev [1:6]"


def _wait_for(predicate, timeout: float = 5.0) -> bool:
    """Poll ``predicate`` until it holds or ``timeout`` seconds pass."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def test_identical_builds_arriving_together_build_once(client, monkeypatch):
    """The second of two identical POSTs waits, then is served from the cache."""
    from aggregate_api import status as status_state
    from aggregate_api.routes import objects as objects_routes

    real_run_build = objects_routes._run_build
    release = threading.Event()
    calls: list[str] = []

    def gated_run_build(uw, decl, log2, bs):
        calls.append(decl)
        if len(calls) == 1:
            # Bounded, and under the 10 s build timeout: a failing test must not
            # park the one build worker, which every later test shares.
            release.wait(timeout=8)
        return real_run_build(uw, decl, log2, bs)

    monkeypatch.setattr(objects_routes, "_run_build", gated_run_build)

    before = status_state.build_state()
    responses = {}

    def post(label: str) -> None:
        responses[label] = client.post("/v1/objects", json={"decl": PROGRAM})

    first = threading.Thread(target=post, args=("first",))
    second = threading.Thread(target=post, args=("second",))
    try:
        first.start()
        assert _wait_for(
            lambda: status_state.build_state()["in_flight"] == before["in_flight"] + 1
        ), "the first build never took the slot"
        second.start()
        assert _wait_for(
            lambda: status_state.build_state()["waiting"] == before["waiting"] + 1
        ), "the second request never queued on the slot, so nothing was coalesced"
    finally:
        release.set()
        first.join(timeout=15)
        second.join(timeout=15)
    assert not first.is_alive() and not second.is_alive(), "a request never returned"

    assert len(calls) == 1, f"the program was built {len(calls)} times"
    first_body = responses["first"].json()
    second_body = responses["second"].json()
    assert responses["first"].status_code == 200, responses["first"].text
    assert responses["second"].status_code == 200, responses["second"].text
    assert first_body["cached"] is False
    assert second_body["cached"] is True
    assert first_body["id"] == second_body["id"]

    after = status_state.build_state()
    assert after["started"] == before["started"] + 1
    assert after["coalesced"] == before["coalesced"] + 1
    assert after["in_flight"] == before["in_flight"]
    assert after["waiting"] == before["waiting"]

    # One counted lookup per request, on arrival: both missed there, and the
    # waiter's re-check under the slot is not counted again.
    from aggregate_api.config import get_settings

    cache = objects_routes._get_cache(get_settings())
    assert (cache.misses, cache.hits, cache.puts) == (2, 0, 1)


def test_a_plain_hit_counts_as_neither_started_nor_coalesced(client):
    """Coalesced counts waiters served from the cache, not every hit."""
    from aggregate_api import status as status_state

    built = client.post("/v1/objects", json={"decl": PROGRAM})
    assert built.status_code == 200, built.text
    before = status_state.build_state()

    hit = client.post("/v1/objects", json={"decl": PROGRAM})
    assert hit.status_code == 200, hit.text
    assert hit.json()["cached"] is True

    after = status_state.build_state()
    assert after["started"] == before["started"]
    assert after["coalesced"] == before["coalesced"]
