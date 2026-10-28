"""Loss table files are read for private requests only.

Every case builds against a synthetic CSV written to ``tmp_path``. The peer is
loopback, as Caddy's is, and each case varies ``X-Forwarded-For``, which is the
shape of the deployment: ``10.8.0.2`` is a VPN client, ``203.0.113.7`` is the
public internet. See ``src/aggregate_api/loss_table_files.py``.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aggregate_api.loss_table_files import (
    READABLE_SUFFIXES,
    REFUSAL,
    mentions_readable_file,
    spec_names_file,
)

PRIVATE = {"X-Forwarded-For": "10.8.0.2"}
OUTSIDE = {"X-Forwarded-For": "203.0.113.7"}


@pytest.fixture
def lan_client(tmp_path, monkeypatch):
    """A client whose peer is loopback, as Caddy's peer is."""
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "20")
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")

    from aggregate_api.app import create_app

    with TestClient(create_app(), client=("127.0.0.1", 51000)) as made:
        yield made


@pytest.fixture
def elt_file(tmp_path):
    """A synthetic three-event ELT, as a forward-slash absolute path."""
    path = tmp_path / "synthetic_elt.csv"
    path.write_text("event_id,rate,mean\n1,0.1,100\n2,0.2,50\n3,0.05,400\n",
                    encoding="utf-8")
    return path.as_posix()


def _build(client, decl, headers, log2=8):
    return client.post("/v1/objects", json={"decl": decl, "log2": log2},
                       headers=headers)


# ----------------------------------------------------------------------
# The test itself
# ----------------------------------------------------------------------

def test_suffixes_match_the_library():
    """The library's refusal of an unknown suffix lists the readers it has."""
    from aggregate import build

    with pytest.raises(Exception) as caught:
        build.fork()('agg A elt "no_such_table.unreadable"', log2=8)
    message = str(caught.value)
    assert "unsupported file type" in message, message
    listed = message.split("; use ", 1)[1].rstrip(".").split(", ")
    assert set(listed) == set(READABLE_SUFFIXES)


@pytest.mark.parametrize("text, expected", [
    ('agg A elt "x.csv"', True),
    ('agg A elt "X.CSV"', True),
    ('agg A elt unit U as "my unit" "d:/t/x.parquet"', True),
    ('agg A yelt "x.feather" note{see "x.tsv"}', True),
    ('agg A elt "a.csv/."', True),
    ('agg A as "events" elt [[1 .1 100] [2 .2 50]]', False),
    ('agg A yelt [100 200 300]', False),
    ('agg A elt "x.xlsx"', False),
])
def test_mentions_readable_file(text, expected):
    assert mentions_readable_file(text) is expected


def test_spec_names_file_walks_nested_values():
    spec = {"name": "P", "units": [{"elt_sources": ({"path": "a.TSV"},)}]}
    assert spec_names_file(spec)
    assert not spec_names_file({"name": "P", "csv": 1, "note": "inline"})


# ----------------------------------------------------------------------
# The request text, before the library
# ----------------------------------------------------------------------

def test_outside_path_is_refused_before_the_library(lan_client):
    """A missing file returns the refusal, not the library's read error."""
    response = _build(lan_client, 'agg A elt "no/such/file.csv"', OUTSIDE)
    assert response.status_code == 422
    assert response.json()["detail"] == REFUSAL


def test_outside_path_with_label_and_unit_is_refused(lan_client, elt_file):
    decl = f'agg A elt unit U as "my unit" "{elt_file}"'
    response = _build(lan_client, decl, OUTSIDE)
    assert response.status_code == 422
    assert response.json()["detail"] == REFUSAL


def test_outside_json_escape_is_decoded(lan_client, elt_file):
    r"""``\u002e`` is a dot once the JSON is read, so it is refused as one."""
    escaped = elt_file.replace(".csv", "\\u002ecsv")
    body = '{"decl": "agg A elt \\"' + escaped + '\\"", "log2": 8}'
    assert ".csv" not in body
    response = lan_client.post("/v1/objects", content=body, headers={
        **OUTSIDE, "Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"] == REFUSAL


def test_outside_query_value_is_refused(lan_client):
    response = lan_client.get("/v1/meta", params={"x": "a.parquet"},
                              headers=OUTSIDE)
    assert response.status_code == 422


def test_outside_inline_table_builds(lan_client):
    response = _build(lan_client, "agg A elt [[1 .1 100] [2 .2 50]]", OUTSIDE)
    assert response.status_code == 200, response.text


def test_private_path_builds(lan_client, elt_file):
    response = _build(lan_client, f'agg A elt "{elt_file}"', PRIVATE)
    assert response.status_code == 200, response.text


def test_direct_on_the_box_builds(lan_client, elt_file):
    """No proxy header, so the loopback peer is the client: local development."""
    response = _build(lan_client, f'agg A elt "{elt_file}"', {})
    assert response.status_code == 200, response.text


# ----------------------------------------------------------------------
# References, caught on the preview
# ----------------------------------------------------------------------

@pytest.mark.parametrize("decl", [
    "agg B agg.A",
    "agg.A",
    "agg C 1 claim sev agg.A fixed",
])
def test_outside_reference_to_a_file_recipe_is_refused(lan_client, elt_file, decl):
    """Inlined, bare and deferred references all reach the file's recipe."""
    built = _build(lan_client, f'agg A elt "{elt_file}" hints{{log2=8; bs=1}}',
                   PRIVATE)
    assert built.status_code == 200, built.text
    response = _build(lan_client, decl, OUTSIDE)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == REFUSAL


# ----------------------------------------------------------------------
# The cache
# ----------------------------------------------------------------------

def test_file_object_is_hidden_from_outside(lan_client, elt_file):
    decl = f'agg A elt "{elt_file}"'
    oid = _build(lan_client, decl, PRIVATE).json()["id"]

    assert lan_client.get(f"/v1/objects/{oid}", headers=OUTSIDE).status_code == 404
    assert lan_client.get(f"/v1/objects/{oid}/frames",
                          headers=OUTSIDE).status_code == 404
    assert lan_client.get(f"/v1/objects/{oid}", headers=PRIVATE).status_code == 200

    def listed(headers):
        body = lan_client.get("/v1/objects", headers=headers).json()
        return {item["id"] for item in body["objects"]}

    assert oid not in listed(OUTSIDE)
    assert oid in listed(PRIVATE)

    for form in ("raw", "agg"):
        outside = lan_client.get("/v1/session/models.agg", params={"form": form},
                                 headers=OUTSIDE)
        inside = lan_client.get("/v1/session/models.agg", params={"form": form},
                                headers=PRIVATE)
        assert outside.status_code == 200 and inside.status_code == 200
        assert "synthetic_elt" not in outside.text
        assert "synthetic_elt" in inside.text


def test_inline_object_is_served_to_outside(lan_client):
    oid = _build(lan_client, "agg A elt [[1 .1 100] [2 .2 50]]", PRIVATE).json()["id"]
    assert lan_client.get(f"/v1/objects/{oid}", headers=OUTSIDE).status_code == 200

