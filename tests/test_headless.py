"""Tests for ``AGGAPI_SERVE_SPA`` / ``aggregate-api --headless``.

Every test here points ``AGGAPI_STATIC_DIR`` at a real directory holding a real
``index.html``. Without that, ``/`` returns 404 whether or not the flag works,
because the packaged ``static/`` is gitignored and absent in a source checkout,
and the test would pass for the wrong reason.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def bundle(tmp_path):
    """A directory that looks enough like a built SPA to be mounted."""
    d = tmp_path / "static"
    d.mkdir()
    (d / "index.html").write_text("<title>aLL</title>", encoding="utf-8")
    return d


def _client(tmp_path, monkeypatch, bundle, serve_spa):
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")
    monkeypatch.setenv("AGGAPI_STATIC_DIR", str(bundle))
    monkeypatch.setenv("AGGAPI_SERVE_SPA", serve_spa)

    from aggregate_api.app import create_app

    return TestClient(create_app())


def test_the_spa_is_served_by_default(tmp_path, monkeypatch, bundle):
    """The control: with a bundle present and the flag unset, ``/`` answers."""
    with _client(tmp_path, monkeypatch, bundle, "1") as client:
        assert client.get("/").status_code == 200


def test_headless_stops_serving_the_spa(tmp_path, monkeypatch, bundle):
    """The bundle is there and mountable, and the flag refuses it anyway."""
    with _client(tmp_path, monkeypatch, bundle, "0") as client:
        assert client.get("/").status_code == 404


def test_headless_keeps_the_api(tmp_path, monkeypatch, bundle):
    """Headless drops the web app, not the service it wraps."""
    with _client(tmp_path, monkeypatch, bundle, "0") as client:
        assert client.get("/v1/health").status_code == 200


def test_headless_keeps_the_docs(tmp_path, monkeypatch, bundle):
    """``/docs`` and ``/openapi.json`` survive, and this is the point of the test.

    FastAPI registers the documentation routes in its own constructor, before
    ``create_app`` mounts anything, and Starlette matches routes in registration
    order. So the SPA's catch-all mount at ``/`` never shadowed them and removing
    it cannot either. That is true by construction rather than by intent, which
    is exactly the kind of fact that a refactor breaks silently: headless is the
    mode where the Swagger UI is the *only* interface, so it is also the mode
    where losing it would matter most.
    """
    with _client(tmp_path, monkeypatch, bundle, "0") as client:
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200


def test_the_flag_is_the_only_difference(tmp_path, monkeypatch, bundle):
    """Same bundle, same everything: only ``serve_spa`` decides."""
    with _client(tmp_path, monkeypatch, bundle, "1") as on:
        served = on.get("/").status_code
    with _client(tmp_path, monkeypatch, bundle, "0") as off:
        refused = off.get("/").status_code
    assert (served, refused) == (200, 404)
