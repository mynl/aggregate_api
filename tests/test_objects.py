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
    assert body["bs"] == pytest.approx(1.0)   # Dice resolves to bs=1
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


def test_density_df_binned_is_faithful(client):
    """Density binning conserves probability: p_total sums to ~1.

    The old even-spaced stride-skip understated p_total by the stride
    factor; the power-of-two binning sums masses per super-bucket, so the
    surfaced p_total column is faithful.
    """
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/density_df", params={"cols": "loss,p_total"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["loss", "p_total"]
    total = sum(row[1] for row in body["rows"] if row[1] is not None)
    assert total == pytest.approx(1.0, abs=1e-6)


def test_density_df_unknown_cols_filtered(client):
    """Caller can request columns that don't exist; api filters them."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/density_df",
        params={"cols": "loss,does_not_exist", "downsample": 5},
    )
    assert r.status_code == 200
    assert r.json()["columns"] == ["loss"]


def test_density_df_bins_to_display_grid(client):
    """A fine grid (log2 > 11) bins to exactly 2**11 = 2048 display rows.

    The reduction stays on the power-of-two paradigm (``k = 2**(log2-11)``),
    so a 2**16-row build collapses to exactly 2048 grid nodes while p_total
    still sums to ~1. Nodes are centered: the loss grid is 0, bs', 2*bs', ...
    (first label 0), and F is the running cumulative so F[i]-F[i-1] == p[i].
    """
    oid = client.post(
        "/v1/objects",
        json={"decl": "agg Big 100 claims sev lognorm 100 cv 1.5 poisson", "log2": 16},
    ).json()["id"]
    r = client.get(f"/v1/objects/{oid}/density_df", params={"cols": "loss,p_total,F"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["loss", "p_total", "F"]
    rows = body["rows"]
    assert len(rows) == 2048
    total = sum(row[1] for row in rows if row[1] is not None)
    assert total == pytest.approx(1.0, abs=1e-4)
    # Centered nodes: first label 0, then a constant coarse step bs'.
    assert rows[0][0] == pytest.approx(0.0, abs=1e-12)
    step = rows[1][0]
    assert rows[2][0] == pytest.approx(2 * step, rel=1e-9)
    assert rows[3][0] == pytest.approx(3 * step, rel=1e-9)
    # F is cumsum-consistent with the summed masses.
    assert rows[1][2] - rows[0][2] == pytest.approx(rows[1][1], abs=1e-12)


# ----------------------------------------------------------------------
# bs window summary
# ----------------------------------------------------------------------

def test_bs_window_df_present(client):
    """The bucket/window estimator summary is a small per-method frame."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/bs_window_df")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "columns" in body and "rows" in body
    assert len(body["rows"]) >= 1
    # The 'selected' column marks the chosen grid method.
    assert "selected" in body["columns"]


def test_bs_window_df_csv(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/bs_window_df.csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert len(r.text.strip().splitlines()) >= 2


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


def test_reins_density_preview_is_binned(client):
    """Reins density bins to the 2**11 display grid (faithful gross/ceded/net mass)."""
    oid = client.post("/v1/objects", json={"decl": _REINS, "log2": 16}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_density_df")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["rows"]) == 2048
    # The gross aggregate density column sums to ~1 across the binned grid.
    cols = body["columns"]
    assert "p_agg_gross" in cols
    gi = cols.index("p_agg_gross")
    total = sum(row[gi] for row in body["rows"] if row[gi] is not None)
    assert total == pytest.approx(1.0, abs=1e-3)


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


def test_unknown_distortion_kind_returns_422(client):
    """A bad distortion kind is raised inside the Lark transformer (VisitError).

    It should surface as a clean 422 with the underlying message, not the old
    ugly 500.
    """
    r = client.post("/v1/objects", json={"decl": "dist MYD pd 0.5"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "pd" in detail
    assert "distortion kind" in detail.lower()


# ----------------------------------------------------------------------
# MultivariateAggregate (multivariate / mv / netceded)
# ----------------------------------------------------------------------

_MV = (
    "multivariate MV.Indep 25 claims "
    "agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
    "agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 poisson"
)


def test_multivariate_builds_and_reports(client):
    """A MultivariateAggregate builds as kind='multivariate' with the common surface."""
    r = client.post("/v1/objects", json={"decl": _MV})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "multivariate"
    oid = body["id"]
    # Common reporting surface works.
    for which in ("info", "description", "stats_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which
    # No pricing / reinsurance / bs-window -> clean 400 (not 500).
    assert client.post(
        f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.15}
    ).status_code == 400
    assert client.get(f"/v1/objects/{oid}/reins_describe").status_code == 400
    assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 400


# ----------------------------------------------------------------------
# Multi-line input (whitespace collapse)
# ----------------------------------------------------------------------

def test_multiline_input_builds(client):
    r"""Newlines / tabs collapse so a multi-line program builds without `\`."""
    decl = "agg A\n    100 claims\n    sev lognorm 10 cv 1\n    poisson"
    r = client.post("/v1/objects", json={"decl": decl})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "agg"
    # The same program on one line shares the cache slot (formatting-insensitive).
    one_line = "agg A 100 claims sev lognorm 10 cv 1 poisson"
    r2 = client.post("/v1/objects", json={"decl": one_line})
    assert r2.json()["id"] == r.json()["id"]


# ----------------------------------------------------------------------
# Stats tables omit raw moments
# ----------------------------------------------------------------------

def test_stats_df_drops_raw_moments(client):
    """Displayed stats omit ex1/ex2/ex3; keep mean/cv/skew."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    body = client.get(f"/v1/objects/{oid}/stats_df").json()
    cells = {str(c) for row in body["rows"] for c in row}
    assert not ({"ex1", "ex2", "ex3"} & cells)
    assert {"mean", "cv", "skew"} <= cells


# ----------------------------------------------------------------------
# DecL formatting (example standardization)
# ----------------------------------------------------------------------

def test_decl_format_roundtrips_name(client):
    """format returns canonical DecL; the object name survives."""
    r = client.post("/v1/decl/format", json={"decl": _DICE})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "decl" in body and isinstance(body["decl"], str)
    assert "Dice" in body["decl"]


def test_decl_format_echoes_garbage(client):
    """Unparseable input echoes back unchanged (best-effort, never 500)."""
    junk = "this is not decl"
    r = client.post("/v1/decl/format", json={"decl": junk})
    assert r.status_code == 200, r.text
    assert r.json()["decl"] == junk


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


# ----------------------------------------------------------------------
# Price -- pentagon completion + distortion analysis
# ----------------------------------------------------------------------

# A small two-unit portfolio for the distortion-analysis path.
_PORT = (
    "port PF\n"
    "    agg A 50 claims 50 xs 0 sev lognorm 10 cv 1.2 poisson\n"
    "    agg B 30 claims 100 xs 0 sev lognorm 20 cv 2.0 poisson\n"
)


def test_price_pentagon_aggregate(client):
    """An Aggregate gets the one-row pentagon; no distortion slices."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.post(f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert "columns" in body["pentagon"] and "rows" in body["pentagon"]
    # Pentagon carries the canonical stats.
    assert {"L", "P", "Q", "LR", "ROE"} <= set(body["pentagon"]["columns"])
    assert body["distortions"] is None


def test_price_requires_exactly_one_target(client):
    """Neither / both of coc & lr -> 400."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    assert client.post(
        f"/v1/objects/{oid}/price", json={"p": 0.99}
    ).status_code == 400
    assert client.post(
        f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.1, "lr": 0.7}
    ).status_code == 400


def test_price_portfolio_distortions(client):
    """A Portfolio gets the pentagon plus per-distortion LR/P/PQ/ROE slices."""
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    r = client.post(f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "port"
    # Calibrated-distortions detail: one row per standard distortion.
    assert body["distortion_df"] is not None
    assert len(body["distortion_df"]["rows"]) == 5
    assert body["distortions"] is not None
    # At least the loss-ratio slice should come back, framed by distortion.
    assert "LR" in body["distortions"]
    lr = body["distortions"]["LR"]
    assert "columns" in lr and len(lr["rows"]) >= 1
