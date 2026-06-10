"""Tests for /v1/objects/* endpoints.

Covers build idempotency, cache listing, the per-button data
endpoints, the plot endpoint (SVG + PNG), parse-error reporting,
and pricing.

The whole suite runs against the in-process ``TestClient`` -- no
network, no port binding -- so it's fast enough to keep on the
default ``uv run pytest`` path.
"""

from __future__ import annotations

import pytest


_DICE = "agg Dice dfreq [3] dsev [1:6]"

# A small aggregate carrying occurrence reinsurance, for the reins_* paths.
_REINS = (
    "agg ReinsEx 5 claims 100 xs 0 sev lognorm 10 cv .75 "
    "occurrence ceded to 15 xs 5 poisson"
)


# ----------------------------------------------------------------------
# Build + cache
# ----------------------------------------------------------------------

def test_build_dice(client):
    r = client.post("/v1/objects", json={"decl": _DICE})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert body["name"] == "Dice"
    assert len(body["id"]) == 16  # hex prefix length
    assert body["cached"] is False


def test_build_summary_fields(client):
    """Build response carries mean / cv / validation for the SPA summary."""
    body = client.post("/v1/objects", json={"decl": _DICE}).json()
    assert body["mean"] == pytest.approx(10.5, rel=1e-3)
    # Fixed frequency -> agg CV = sd/mean = sqrt(3*Var(U[1..6]))/10.5.
    assert body["cv"] == pytest.approx(0.2817, rel=1e-2)
    assert body["validation"] == "not unreasonable"


def test_build_is_idempotent(client):
    r1 = client.post("/v1/objects", json={"decl": _DICE})
    r2 = client.post("/v1/objects", json={"decl": _DICE})
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["cached"] is True


def test_list_objects(client):
    client.post("/v1/objects", json={"decl": _DICE})
    r = client.get("/v1/objects")
    body = r.json()
    assert "objects" in body
    assert len(body["objects"]) >= 1
    first = body["objects"][0]
    assert first["kind"] == "agg"
    assert first["name"] == "Dice"


def test_get_manifest(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == oid
    assert body["decl"] == _DICE
    assert body["kind"] == "agg"


def test_delete_object(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.delete(f"/v1/objects/{oid}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    # Second delete is a 404 -- cache no longer holds it.
    r2 = client.delete(f"/v1/objects/{oid}")
    assert r2.status_code == 404


def test_get_unknown_object_is_404(client):
    r = client.get("/v1/objects/deadbeefcafebabe")
    assert r.status_code == 404


# ----------------------------------------------------------------------
# Per-button data endpoints
# ----------------------------------------------------------------------

def test_info_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/info")
    assert r.status_code == 200
    body = r.json()
    assert "info" in body
    assert isinstance(body["info"], str)
    assert "Dice" in body["info"]


def test_description_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/description")
    assert r.status_code == 200
    body = r.json()
    assert "columns" in body and "rows" in body
    # describe is a 3-row Freq/Sev/Agg table.
    assert len(body["rows"]) == 3


def test_stats_df_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/stats_df")
    assert r.status_code == 200
    body = r.json()
    assert "columns" in body and "rows" in body
    # stats_df carries Freq/Sev/Agg moment rows in the MultiIndex;
    # at least a handful of standard columns survive the reset.
    assert any(c in {"mixed", "independent", "empirical"} for c in body["columns"])
    assert len(body["rows"]) > 0


def test_density_df_paginated(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/density_df",
        params={"cols": "loss,p_total", "downsample": 20},
    )
    body = r.json()
    assert body["columns"] == ["loss", "p_total"]
    assert len(body["rows"]) <= 20


def test_density_df_unknown_cols_filtered(client):
    """Caller can request columns that don't exist; api filters them."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/density_df",
        params={"cols": "loss,does_not_exist", "downsample": 5},
    )
    assert r.status_code == 200
    assert r.json()["columns"] == ["loss"]


# ----------------------------------------------------------------------
# Plot endpoint
# ----------------------------------------------------------------------

def test_plot_svg_default(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/plot", params={"kind": "density"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("image/svg+xml")
    body = r.content.lstrip()
    assert body.startswith(b"<?xml") or body.startswith(b"<svg")


def test_plot_png_explicit(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/plot",
        params={"kind": "density", "format": "png"},
    )
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_plot_native_default(client):
    """No ``kind`` -> the object's own multi-panel .plot() (SVG)."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/plot")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("image/svg+xml")
    body = r.content.lstrip()
    assert body.startswith(b"<?xml") or body.startswith(b"<svg")


def test_plot_kappa_rejects_aggregate(client):
    """kappa needs a Portfolio; on an Aggregate it should return 400."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/plot", params={"kind": "kappa"})
    assert r.status_code == 400


def test_plot_unknown_kind_400(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/plot", params={"kind": "nonsense"})
    assert r.status_code == 400


# ----------------------------------------------------------------------
# Reinsurance endpoints
# ----------------------------------------------------------------------

def test_reins_description_absent_on_plain_object(client):
    """An object with no reinsurance reports available=False."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_description")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert body["text"] == ""


def test_reins_describe_400_on_plain_object(client):
    """reins_describe is a 400 (not 500) when there's no reinsurance."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_describe")
    assert r.status_code == 400


def test_reins_description_present(client):
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_description")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert "xs" in body["text"]


def test_reins_frames_present(client):
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]
    for which in ("reins_describe", "reins_stats_df", "reins_density_df"):
        r = client.get(f"/v1/objects/{oid}/{which}")
        assert r.status_code == 200, f"{which}: {r.text}"
        body = r.json()
        assert "columns" in body and "rows" in body
        assert len(body["rows"]) > 0


def test_reins_density_preview_is_bounded(client):
    """Density preview drops zero-mass rows and downsamples to ~20."""
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_density_df")
    assert r.status_code == 200, r.text
    assert len(r.json()["rows"]) <= 20


# ----------------------------------------------------------------------
# CSV frame download
# ----------------------------------------------------------------------

def test_frame_csv_describe(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/describe.csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers.get("content-disposition", "")
    # CSV body has a header row plus data.
    assert len(r.text.strip().splitlines()) >= 2


def test_frame_csv_unknown_name_404(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/bogus.csv")
    assert r.status_code == 404


def test_frame_csv_reins_400_when_absent(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/reins_describe.csv")
    assert r.status_code == 400


# ----------------------------------------------------------------------
# Parse / validation errors
# ----------------------------------------------------------------------

def test_parse_error_returns_report(client):
    """A DecL typo surfaces as a 422 with an ErrorReport body."""
    # ``mixd`` close-match typo for ``mixed`` -- exercises Plan B's
    # word extraction + suggestion path through the api boundary.
    r = client.post(
        "/v1/objects",
        json={"decl": "agg X 100 claims sev lognorm 100 cv 2 mixd poisson 0.5"},
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    # ErrorReport shape: line/column/message/suggestions/...
    assert "line" in detail
    assert "message" in detail
    assert "mixd" in detail["got"]


def test_log2_cap_rejected(client, monkeypatch):
    """Setting log2 above the cap returns 422 limit_exceeded."""
    # Lower the cap below the request value.
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "8")
    # Rebuild the app so the new env is honored.
    from aggregate_api.app import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post("/v1/objects", json={"decl": _DICE, "log2": 12})
        assert r.status_code == 422
        # Message says "log2 12 exceeds AGGAPI_LOG2_CAP=8".
        assert "CAP" in r.json()["detail"].upper()


# ----------------------------------------------------------------------
# Pricing -- Aggregate-side rejection
# ----------------------------------------------------------------------

def test_pricing_rejects_aggregate(client):
    """pricing_at is Portfolio-only; on an Aggregate -> 400."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.post(
        f"/v1/objects/{oid}/pricing_at",
        json={"p": 0.99, "ccoc": 0.1},
    )
    assert r.status_code == 400
