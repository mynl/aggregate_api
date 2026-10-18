"""Front ends named in ``AGGAPI_APPS``, served at ``/<name>/`` (``dev/done/plan-front-end-apps.md``).

Each test builds a stand-in app in a temporary directory, and a stand-in SPA
bundle beside it through ``AGGAPI_STATIC_DIR``, so the catch-all ``/`` mount is
present whether or not this checkout has run the web build. That mount is what
an app's mount has to win against.
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from aggregate_api.apps import RESERVED_NAMES, reserved_names
from aggregate_api.config import get_settings

INDEX = "<!doctype html><title>demo</title>\n"
SPA_INDEX = "<!doctype html><title>playground</title>\n"


def _stand_in_app(folder, *, manifest=None):
    """Write a minimal app: ``index.html``, ``js/main.js``, optionally ``app.json``."""
    folder.mkdir(parents=True)
    # Bytes, so Windows does not turn the newline into CRLF on the way to disk.
    (folder / "index.html").write_bytes(INDEX.encode("utf-8"))
    (folder / "js").mkdir()
    (folder / "js" / "main.js").write_bytes(b"// main\n")
    if manifest is not None:
        text = manifest if isinstance(manifest, str) else json.dumps(manifest)
        (folder / "app.json").write_bytes(text.encode("utf-8"))
    return folder


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    """Build a client for a given ``AGGAPI_APPS`` value, against scratch state."""
    spa = tmp_path / "spa"
    (spa / "assets").mkdir(parents=True)
    (spa / "index.html").write_bytes(SPA_INDEX.encode("utf-8"))
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")
    monkeypatch.setenv("AGGAPI_STATIC_DIR", str(spa))
    clients = []

    def make(apps: str | None):
        if apps is None:
            monkeypatch.delenv("AGGAPI_APPS", raising=False)
        else:
            monkeypatch.setenv("AGGAPI_APPS", apps)
        from aggregate_api.app import create_app

        client = TestClient(create_app())
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.close()
    get_settings.cache_clear()


@pytest.fixture
def demo_client(tmp_path, make_client):
    """A client serving one stand-in app, with an ``app.json``, at ``/demo/``."""
    folder = _stand_in_app(tmp_path / "demo-app", manifest={
        "title": "Demo <App>", "description": "a stand-in & nothing more"})
    return make_client(f"demo={folder}")


def test_the_app_is_served_and_never_cached_blind(demo_client):
    """``/demo/`` is its index.html, its files serve, and both say ``no-cache``."""
    r = demo_client.get("/demo/")
    assert r.status_code == 200
    assert r.text == INDEX
    assert r.headers["cache-control"] == "no-cache"
    js = demo_client.get("/demo/js/main.js")
    assert js.status_code == 200
    assert js.text == "// main\n"
    assert js.headers["cache-control"] == "no-cache"


def test_the_bare_name_redirects_to_the_directory(demo_client):
    """``/demo`` goes to ``/demo/``, relative, with the query string kept.

    The SPA's ``/`` mount is present here, which is the case Starlette's own
    slash redirect does not cover.
    """
    r = demo_client.get("/demo", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/demo/"
    r = demo_client.get("/demo?api=http://127.0.0.1:9", follow_redirects=False)
    assert r.headers["location"] == "/demo/?api=http://127.0.0.1:9"
    assert demo_client.get("/demo").text == INDEX


def test_a_missing_file_is_a_404_not_the_spa(demo_client):
    """Mounted before ``/``, so the playground never answers under ``/demo/``."""
    r = demo_client.get("/demo/nope.js")
    assert r.status_code == 404
    assert "playground" not in r.text


def test_meta_lists_the_app_from_its_manifest(demo_client, tmp_path):
    """``{name, title, description, url}``, and no field holds the folder."""
    r = demo_client.get("/v1/meta")
    assert r.status_code == 200
    assert r.json()["apps"] == [{
        "name": "demo",
        "title": "Demo <App>",
        "description": "a stand-in & nothing more",
        "url": "/demo/",
    }]
    folder = tmp_path / "demo-app"
    for spelling in (str(folder), folder.as_posix(), json.dumps(str(folder))[1:-1]):
        assert spelling not in r.text


@pytest.mark.parametrize("manifest", [None, "{not json", '["a list"]', '{"title": 7}'])
def test_without_a_usable_manifest_the_title_is_the_name(tmp_path, make_client, manifest):
    """A missing or unreadable ``app.json`` costs the label, never the app."""
    folder = _stand_in_app(tmp_path / "plain", manifest=manifest)
    client = make_client(f"plain={folder}")
    assert client.get("/v1/meta").json()["apps"] == [
        {"name": "plain", "title": "plain", "description": "", "url": "/plain/"}]
    assert client.get("/plain/").status_code == 200


def test_bad_entries_are_skipped_with_a_warning(tmp_path, make_client, caplog):
    """Each bad entry is logged and skipped, the good one serves, the server starts."""
    good = _stand_in_app(tmp_path / "good")
    other = _stand_in_app(tmp_path / "other")
    empty = tmp_path / "empty"
    empty.mkdir()
    entries = [
        f"v1={other}",                      # reserved
        f"My App={other}",                  # bad name
        f"good={good}",                     # admitted
        f"good={other}",                    # duplicate
        f"gone={tmp_path / 'absent'}",      # missing folder
        f"bare={empty}",                    # no index.html
        "asp",                              # no '='
    ]
    with caplog.at_level(logging.WARNING, logger="aggregate_api.apps"):
        client = make_client(", ".join(entries))
    assert [a["name"] for a in client.get("/v1/meta").json()["apps"]] == ["good"]
    assert client.get("/good/").text == INDEX
    warned = [rec.getMessage() for rec in caplog.records if rec.name == "aggregate_api.apps"]
    assert len(warned) == 6
    for needle in ("reserved", "a name is", "earlier entry", "does not exist",
                   "no index.html", "expected name=folder"):
        assert any(needle in line for line in warned), needle
    assert client.get("/v1/health").json()["ok"] is True


def test_no_setting_no_apps(make_client):
    """With ``AGGAPI_APPS`` unset, meta lists none and no app route exists."""
    client = make_client(None)
    assert client.get("/v1/meta").json()["apps"] == []
    names = {getattr(route, "name", "") or "" for route in client.app.routes}
    assert not any(name.startswith("app-") for name in names)


def test_a_headless_server_still_serves_its_apps(tmp_path, make_client, monkeypatch):
    """Not gated on ``serve_spa``, like ``/excel``."""
    monkeypatch.setenv("AGGAPI_SERVE_SPA", "0")
    folder = _stand_in_app(tmp_path / "demo-app")
    client = make_client(f"demo={folder}")
    assert client.get("/demo/").text == INDEX
    assert client.get("/").status_code == 404


def test_the_bundle_entries_are_reserved(tmp_path):
    """A directory the web build adds cannot be shadowed by an app."""
    spa = tmp_path / "spa"
    (spa / "prototypes").mkdir(parents=True)
    (spa / "index.html").write_bytes(b"")
    assert reserved_names(spa) == RESERVED_NAMES | {"prototypes", "index.html"}
    assert reserved_names(None) == RESERVED_NAMES
    assert reserved_names(tmp_path / "absent") == RESERVED_NAMES
