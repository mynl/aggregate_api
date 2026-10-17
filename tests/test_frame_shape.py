"""``frame/{which}/shape`` and ``cols`` on ``frame/{which}.csv``.

``dev/done/plan-fast-frames.md``, ``[lab-all-rows]``. The Lab's All rows view
asks for the shape first, loads the whole frame when it fits a cell budget, and
otherwise asks the ``.csv`` route for every row of a few columns.
"""

from __future__ import annotations

import io

import pandas as pd

_PORT = (
    "port SH.P agg A 10 claims sev lognorm 10 cv 1 poisson "
    "agg B 5 claims sev gamma 20 cv 0.5 poisson"
)
_REINS = (
    "agg SH.R 10 claims sev lognorm 10 cv 1 "
    "occurrence net of 50% po 20 xs 10 and 90% po 50 xs 30 poisson"
)


def _build(client, decl, log2=10):
    r = client.post("/v1/objects", json={"decl": decl, "log2": log2})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_shape_of_a_portfolio_density(client):
    oid = _build(client, _PORT)
    r = client.get(f"/v1/objects/{oid}/frame/density_df/shape")
    assert r.status_code == 200, r.text
    shape = r.json()
    # 2**10 rows; 13 + 10n columns for n units (the plan's count).
    assert shape == {"rows": 1024, "columns": 33}
    # And it agrees with what the CSV actually carries.
    csv = pd.read_csv(io.StringIO(client.get(f"/v1/objects/{oid}/frame/density_df.csv").text))
    assert csv.shape == (shape["rows"], shape["columns"])


def test_shape_unknown_frame_404_and_absent_400(client):
    oid = _build(client, _PORT)
    assert client.get(f"/v1/objects/{oid}/frame/bogus/shape").status_code == 404
    assert client.get(f"/v1/objects/{oid}/frame/reins_summary_df/shape").status_code == 400


def test_shape_does_not_shadow_the_document_route(client):
    oid = _build(client, _PORT)
    r = client.get(f"/v1/objects/{oid}/frame/summary?format=ir")
    assert r.status_code == 200
    # A table document, not a shape.
    assert "body" in r.json()


def test_csv_cols_subset_in_request_order(client):
    oid = _build(client, _PORT)
    r = client.get(f"/v1/objects/{oid}/frame/density_df.csv",
                   params={"cols": "F,loss,p_total,no_such_column,S"})
    assert r.status_code == 200
    csv = pd.read_csv(io.StringIO(r.text))
    assert list(csv.columns) == ["F", "loss", "p_total", "S"]
    assert len(csv) == 1024


def test_csv_without_cols_is_the_whole_frame(client):
    oid = _build(client, _REINS)
    whole = pd.read_csv(io.StringIO(client.get(f"/v1/objects/{oid}/frame/reins_density_df.csv").text))
    shape = client.get(f"/v1/objects/{oid}/frame/reins_density_df/shape").json()
    assert whole.shape == (shape["rows"], shape["columns"])
    assert shape["columns"] == 10
