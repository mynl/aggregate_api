"""Response compression: big JSON bodies gzip, small ones do not.

``create_app`` installs ``GZipMiddleware`` with a 1 kB floor and level 6
(``dev/done/plan-fast-frames.md``, ``[gzip-level]``). ``TestClient`` sends
``Accept-Encoding: gzip`` by default and decodes the body transparently, so
``r.json()`` reads as usual while the ``Content-Encoding`` header says what
went over the wire.
"""

from __future__ import annotations

_AGG = "agg GZ.A 10 claims sev lognorm 10 cv 1 poisson"


def _build(client, log2=12):
    r = client.post("/v1/objects", json={"decl": _AGG, "log2": log2})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_density_frame_is_gzipped(client):
    oid = _build(client)
    r = client.get(f"/v1/objects/{oid}/density_df",
                   headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert "Accept-Encoding" in r.headers.get("vary", "")
    body = r.json()
    assert len(body["rows"]) == 2 ** 12


def test_small_response_is_not_gzipped(client):
    r = client.get("/v1/health", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers


def test_no_gzip_when_the_client_declines(client):
    oid = _build(client)
    r = client.get(f"/v1/objects/{oid}/density_df",
                   headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers


def test_middleware_level_is_six():
    """The level is the plan's ruling, so a drift back to Starlette's 9 fails here."""
    from aggregate_api.app import create_app

    app = create_app()
    levels = [
        m.kwargs.get("compresslevel")
        for m in app.user_middleware
        if m.cls.__name__ in ("GZipMiddleware", "GZipExceptParquet")
    ]
    assert levels == [6]
