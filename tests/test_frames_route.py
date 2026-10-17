"""``GET /v1/objects/{id}/frames``: which frames an object has, with their shapes.

``dev/plan-excel-library-and-frames.md``, ``[frames-route]``. The Excel add-in's
``AGG.FRAMES`` and its task pane ask here before handing out a frame's URL;
before this route the only listing was the 404 an unknown name draws.
"""

from __future__ import annotations

import time

import pytest

_DICE = "agg Dice dfreq [3] dsev [1:6]"
_REINS = (
    "agg FR.R 10 claims sev lognorm 10 cv 1 "
    "occurrence net of 50% po 20 xs 10 and 90% po 50 xs 30 poisson"
)
_PORT = (
    "port FR.P agg A 10 claims sev lognorm 10 cv 1 poisson "
    "agg B 5 claims sev gamma 20 cv 0.5 poisson"
)


def _build(client, decl, log2=10):
    r = client.post("/v1/objects", json={"decl": decl, "log2": log2})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_frames_are_the_ones_the_object_answers_in_table_order(client):
    oid = _build(client, _DICE)
    r = client.get(f"/v1/objects/{oid}/frames")
    assert r.status_code == 200, r.text
    frames = r.json()["frames"]
    names = [f["name"] for f in frames]
    # The core frames every aggregate has, in the frame table's order.
    assert names[:4] == ["summary", "tail_df", "validation_df", "stats_df"]
    assert "density_df" in names
    # Nothing an aggregate without a cession, a ledger or a sharpen run has.
    for absent in ("reins_summary_df", "reins_stats_df", "reins_density_df",
                   "economic_df", "economic_ratios_df", "sharpen_df", "sharpen_score"):
        assert absent not in names, absent


def test_each_shape_agrees_with_the_shape_route(client):
    oid = _build(client, _PORT)
    for item in client.get(f"/v1/objects/{oid}/frames").json()["frames"]:
        shape = client.get(f"/v1/objects/{oid}/frame/{item['name']}/shape").json()
        assert shape == {"rows": item["rows"], "columns": item["columns"]}, item["name"]


def test_reinsurance_frames_appear_with_a_cession(client):
    oid = _build(client, _REINS)
    names = [f["name"] for f in client.get(f"/v1/objects/{oid}/frames").json()["frames"]]
    assert {"reins_summary_df", "reins_stats_df", "reins_density_df"} <= set(names)
    density = next(f for f in client.get(f"/v1/objects/{oid}/frames").json()["frames"]
                   if f["name"] == "reins_density_df")
    assert density == {"name": "reins_density_df", "rows": 1024, "columns": 10}


@pytest.mark.parametrize("decl", [
    "sev FR.S lognorm 10 cv 1",
    "distortion FR.D ph 0.5",
])
def test_other_kinds_list_without_a_fault(client, decl):
    oid = _build(client, decl)
    r = client.get(f"/v1/objects/{oid}/frames")
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["frames"], list)


def test_the_listing_is_cheap_once_the_frames_exist(client):
    """One pass over thirteen resolvers on a built object: milliseconds.

    The first call may materialize frames the object has not built yet, as the
    first ``/shape`` would, so the clock starts on the second call.
    """
    oid = _build(client, _DICE)
    client.get(f"/v1/objects/{oid}/frames")
    start = time.perf_counter()
    r = client.get(f"/v1/objects/{oid}/frames")
    elapsed = time.perf_counter() - start
    assert r.status_code == 200
    assert elapsed < 0.1, f"{elapsed:.3f}s"


def test_an_unknown_object_is_the_cache_404(client):
    r = client.get("/v1/objects/0123456789abcdef/frames")
    assert r.status_code == 404
