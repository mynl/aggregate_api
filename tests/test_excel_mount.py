"""The Excel add-in mount at ``/excel`` (``dev/done/plan-excel-hosting.md``).

The mount reads ``src/aggregate_api/excel_static/``, which only a build writes,
so each test points it at a temporary directory holding a stand-in bundle.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

MANIFEST = "<OfficeApp><Version>1.0.0.0</Version></OfficeApp>\n"


@pytest.fixture
def excel_client(tmp_path, monkeypatch):
    """A client whose app serves a stand-in add-in bundle at ``/excel``."""
    bundle = tmp_path / "excel_static"
    bundle.mkdir()
    # Bytes, so Windows does not turn the newline into CRLF on the way to disk.
    (bundle / "manifest.xml").write_bytes(MANIFEST.encode("utf-8"))
    (bundle / "functions.js").write_bytes(b"// functions\n")
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")

    from aggregate_api import app as app_module

    monkeypatch.setattr(app_module, "_resolve_excel_dir", lambda: bundle)
    with TestClient(app_module.create_app()) as client:
        yield client


def test_the_manifest_is_served_and_never_cached_blind(excel_client):
    """Office caches add-in files hard; ``no-cache`` makes it revalidate."""
    r = excel_client.get("/excel/manifest.xml")
    assert r.status_code == 200
    assert r.text == MANIFEST
    assert r.headers["cache-control"] == "no-cache"
    assert excel_client.get("/excel/functions.js").headers["cache-control"] == "no-cache"


def test_a_revalidation_is_a_304_that_still_says_no_cache(excel_client):
    """The ETag makes reopening a workbook cost one small request per file."""
    first = excel_client.get("/excel/manifest.xml")
    again = excel_client.get("/excel/manifest.xml",
                             headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    assert again.headers["cache-control"] == "no-cache"


def test_a_missing_file_is_a_404_not_the_spa(excel_client):
    """Mounted before ``/``, so the SPA's index.html fallback never answers here."""
    r = excel_client.get("/excel/nope.js")
    assert r.status_code == 404
    assert "<html" not in r.text.lower()


def test_no_bundle_no_mount(tmp_path, monkeypatch):
    """Like the SPA, the mount exists only when a build has written the directory."""
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")

    from aggregate_api import app as app_module

    monkeypatch.setattr(app_module, "_resolve_excel_dir", lambda: tmp_path / "absent")
    app = app_module.create_app()
    assert "excel" not in {getattr(route, "name", None) for route in app.routes}
