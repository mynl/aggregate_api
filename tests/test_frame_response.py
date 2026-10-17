"""``frame_response`` writes the document ``frame_to_payload`` used to.

The frame routes hand orjson a numpy array instead of coercing cells one at a
time and running the dict through pydantic and ``json.dumps``
(``dev/done/plan-fast-frames.md``, ``[orjson-frames]``). The contract is that
nothing on the wire changes: same columns, same rows, every non-finite float a
``null``. These tests hold the new response against the old payload, directly
on hand-built frames and through every switched route on live objects.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from aggregate_api import serializers
from aggregate_api.serializers import frame_response, frame_to_payload

_AGG = "agg FR.A 10 claims sev lognorm 10 cv 1 poisson"
_PORT = (
    "port FR.P agg A 10 claims sev lognorm 10 cv 1 poisson "
    "agg B 5 claims sev gamma 20 cv 0.5 poisson"
)
_REINS = (
    "agg FR.R 10 claims sev lognorm 10 cv 1 "
    "occurrence net of 50% po 20 xs 10 and 90% po 50 xs 30 poisson"
)


def _same(df: pd.DataFrame, **kwargs) -> None:
    resp = frame_response(df, **kwargs)
    assert resp.media_type == "application/json"
    assert json.loads(resp.body) == frame_to_payload(df, **kwargs)


def test_numeric_frame_takes_the_array_path():
    df = pd.DataFrame({"loss": np.arange(5.0), "p": np.linspace(0, 1, 5)})
    _same(df)


def test_non_finite_floats_are_null():
    df = pd.DataFrame({
        "x": [1.0, np.nan, np.inf, -np.inf],
        "y": [np.nan, 2.0, 3.0, 4.0],
    })
    body = json.loads(frame_response(df).body)
    assert body["rows"][1][0] is None
    assert body["rows"][2][0] is None
    assert body["rows"][3][0] is None
    assert body["rows"][0][1] is None
    _same(df)


def test_mixed_int_and_float_columns_upcast_as_before():
    df = pd.DataFrame({"n": [1, 2, 3], "x": [0.5, np.nan, 2.5]})
    _same(df)


def test_text_column_takes_the_coercing_path():
    df = pd.DataFrame({"name": ["a", "b"], "x": [1.5, np.nan], "n": [1, 2]})
    _same(df)


def test_bool_column_takes_the_coercing_path():
    df = pd.DataFrame({"flag": [True, False], "x": [1.0, 2.0]})
    _same(df)


def test_multiindex_columns_flatten_the_same_way():
    cols = pd.MultiIndex.from_tuples([("freq", "mean"), ("sev", "cv")])
    df = pd.DataFrame(np.arange(6.0).reshape(3, 2), columns=cols)
    _same(df)


def test_slicing_arguments_match():
    df = pd.DataFrame({"a": np.arange(100.0), "b": np.arange(100.0) ** 2, "c": 1.0})
    _same(df, cols=["b", "a", "missing"])
    _same(df, start=10, stop=50)
    _same(df, start=0, stop=1000, downsample=7)
    _same(df, cols=["c"], downsample=3)


def test_empty_frame():
    _same(pd.DataFrame({"a": pd.Series([], dtype=float)}))
    _same(pd.DataFrame())


@pytest.fixture
def captured(monkeypatch):
    """Every ``frame_response`` call a route makes, paired with the old payload.

    The routes look the name up in their module at call time, so a wrapper
    there sees each frame exactly as the route hands it over, and the test can
    compare the two serializers on it without re-deriving the frame.
    """
    from aggregate_api.routes import objects as routes

    seen: list[tuple[str, dict, dict]] = []

    def wrapper(df, **kwargs):
        resp = serializers.frame_response(df, **kwargs)
        seen.append((json.loads(resp.body), frame_to_payload(df, **kwargs)))
        return resp

    monkeypatch.setattr(routes, "frame_response", wrapper)
    return seen


_ROUTES = (
    "summary", "tail_df", "validation_df", "stats_df",
    "density_df", "density_df?resolution=display",
    "unit_density_df", "unit_density_df?resolution=display",
    "kappa", "bs_window_df",
    "reins_summary_df", "reins_stats_df",
    "reins_density_df", "reins_density_df?resolution=display",
)


@pytest.mark.parametrize("decl", [_AGG, _PORT, _REINS], ids=["agg", "port", "reins"])
def test_every_switched_route_matches_the_old_payload(client, captured, decl):
    r = client.post("/v1/objects", json={"decl": decl, "log2": 10})
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    served = 0
    for which in _ROUTES:
        r = client.get(f"/v1/objects/{oid}/{which}")
        # A kind that lacks the frame answers 400, which is not this test's
        # concern; a 500 or a 422 would be.
        assert r.status_code in (200, 400), (which, r.text)
        if r.status_code == 200:
            served += 1
            assert r.headers["content-type"].startswith("application/json")
            assert set(r.json()) == {"columns", "rows"}
    assert served >= 6
    assert len(captured) == served
    for new, old in captured:
        assert new == old
