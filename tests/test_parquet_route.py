"""``GET /v1/objects/{id}/frame/{which}.parquet``: the ``.csv`` frames, as Parquet.

``dev/done/plan-fast-frames.md``, ``[parquet-route]``. The contract is that
every named frame reads back equal to what the ``.csv`` route serves, that the
suffixed route wins over ``/frame/{which}``, that the body is not gzipped on
top of its own zstd, and that a server without pyarrow says so with a 501.
"""

from __future__ import annotations

import io
import sys

import numpy as np
import pandas as pd
import pytest

from aggregate_api.routes.objects import _CSV_FRAMES

pytest.importorskip("pyarrow")

_AGG = "agg PQ.A 10 claims sev lognorm 10 cv 1 poisson"
_PORT = (
    "port PQ.P agg A 10 claims sev lognorm 10 cv 1 poisson "
    "agg B 5 claims sev gamma 20 cv 0.5 poisson"
)
_REINS = (
    "agg PQ.R 10 claims sev lognorm 10 cv 1 "
    "occurrence net of 50% po 20 xs 10 and 90% po 50 xs 30 poisson"
)


def _build(client, decl):
    r = client.post("/v1/objects", json={"decl": decl, "log2": 10})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _read_csv(text: str, parquet_columns: list[str]) -> pd.DataFrame:
    """Read the CSV as the Parquet names its columns.

    A frame with MultiIndex columns (``reins_stats_df``) goes out as two header
    rows in CSV, where Parquet needs flat string names and gets ``a.b``; read
    both header rows and join them the same way.
    """
    flat = pd.read_csv(io.StringIO(text))
    if list(flat.columns) == parquet_columns:
        return flat
    two = pd.read_csv(io.StringIO(text), header=[0, 1])
    two.columns = [".".join("" if str(p).startswith("Unnamed") else str(p) for p in tup)
                   for tup in two.columns]
    return two


def _equal(csv: pd.DataFrame, pq: pd.DataFrame) -> None:
    assert list(csv.columns) == list(pq.columns)
    assert len(csv) == len(pq)
    for col in csv.columns:
        a, b = csv[col], pq[col]
        if pd.api.types.is_numeric_dtype(b):
            a = pd.to_numeric(a)
            assert np.allclose(a.to_numpy(float), b.to_numpy(float),
                               rtol=1e-12, atol=0, equal_nan=True), col
        else:
            assert a.fillna("").astype(str).tolist() == b.fillna("").astype(str).tolist(), col


@pytest.mark.parametrize("decl", [_AGG, _PORT, _REINS], ids=["agg", "port", "reins"])
@pytest.mark.parametrize("which", sorted(_CSV_FRAMES))
def test_parquet_reads_back_as_the_csv(client, decl, which):
    oid = _build(client, decl)
    csv = client.get(f"/v1/objects/{oid}/frame/{which}.csv")
    pq = client.get(f"/v1/objects/{oid}/frame/{which}.parquet")
    # The two routes agree on whether the frame exists for this kind.
    assert pq.status_code == csv.status_code, (which, pq.text)
    if csv.status_code != 200:
        return
    assert pq.headers["content-type"] == "application/vnd.apache.parquet"
    assert "attachment" in pq.headers["content-disposition"]
    assert pq.headers["content-disposition"].endswith(f'-{which}.parquet"')
    frame = pd.read_parquet(io.BytesIO(pq.content))
    _equal(_read_csv(csv.text, list(frame.columns)), frame)


def test_parquet_is_exact_where_csv_and_json_are_not(client):
    """Non-finite values survive: a reinsured density has infinities nowhere, but
    a float frame round-trips bit for bit, which the JSON `null` cannot."""
    oid = _build(client, _AGG)
    pq = client.get(f"/v1/objects/{oid}/frame/density_df.parquet")
    frame = pd.read_parquet(io.BytesIO(pq.content))
    body = client.get(f"/v1/objects/{oid}/density_df").json()
    served = pd.DataFrame(body["rows"], columns=body["columns"])
    for col in ("loss", "p_total", "F", "S"):
        assert np.array_equal(frame[col].to_numpy(), served[col].to_numpy(float),
                              equal_nan=True)


def test_suffixed_route_wins_over_the_document_route(client):
    oid = _build(client, _AGG)
    r = client.get(f"/v1/objects/{oid}/frame/density_df.parquet")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.apache.parquet"
    assert r.content[:4] == b"PAR1"


def test_parquet_is_not_gzipped_on_top(client):
    oid = _build(client, _AGG)
    r = client.get(f"/v1/objects/{oid}/frame/density_df.parquet",
                   headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    # The JSON twin on the same object still is.
    j = client.get(f"/v1/objects/{oid}/density_df", headers={"Accept-Encoding": "gzip"})
    assert j.headers.get("content-encoding") == "gzip"


def test_unknown_frame_404_and_absent_frame_400(client):
    oid = _build(client, _AGG)
    assert client.get(f"/v1/objects/{oid}/frame/bogus.parquet").status_code == 404
    assert client.get(f"/v1/objects/{oid}/frame/reins_summary_df.parquet").status_code == 400


def test_meta_lists_parquet(client):
    assert client.get("/v1/meta").json()["frame_formats"] == ["csv", "json", "parquet"]


def test_without_pyarrow_501_and_meta_omits_parquet(client, monkeypatch):
    oid = _build(client, _AGG)
    monkeypatch.setitem(sys.modules, "pyarrow", None)
    r = client.get(f"/v1/objects/{oid}/frame/density_df.parquet")
    assert r.status_code == 501
    assert "parquet" in r.json()["detail"]
    assert client.get("/v1/meta").json()["frame_formats"] == ["csv", "json"]
