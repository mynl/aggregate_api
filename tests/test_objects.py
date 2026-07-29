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

from aggregate_api.serializers import display_log2_for


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


def test_summary_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/summary")
    assert r.status_code == 200
    body = r.json()
    assert "columns" in body and "rows" in body
    # summary_df is a 3-row Freq/Sev/Agg table.
    assert len(body["rows"]) == 3


def test_tail_df_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/tail_df")
    assert r.status_code == 200
    body = r.json()
    # tail_df is a method on Aggregate; the route must call it. Index =
    # return period T; the VaR / TVaR / xsVaR / VaR/Mean columns survive.
    assert "T" in body["columns"]
    for col in ("p", "VaR", "TVaR", "xsVaR", "VaR/Mean"):
        assert col in body["columns"]
    assert len(body["rows"]) > 0


def test_validation_df_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/validation_df")
    assert r.status_code == 200
    body = r.json()
    # validation_df is the old moment-vs-estimate QA table (Freq/Sev/Agg).
    assert "columns" in body and "rows" in body
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
    """A fine grid bins to exactly the display row target, and stays faithful.

    The reduction stays on the power-of-two paradigm (``k = 2**(log2 - m)``),
    so a 2**16-row build collapses to exactly 2**m grid nodes while p_total
    still sums to ~1. Nodes are centered: the loss grid is 0, bs', 2*bs', ...
    (first label 0), and F is the running cumulative so F[i]-F[i-1] == p[i].

    The row target is read from ``display_log2_for`` rather than hardcoded: it
    depends on the column count (the payload is budgeted in cells, not rows), and
    a test that pinned a literal would have to be edited every time the budget
    moved, which is exactly when it should be checking rather than agreeing.
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
    assert len(rows) == 2 ** display_log2_for(3)
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


def test_plot_kappa_portfolio(client):
    """kappa renders for a Portfolio (guard keys off ``unit_names_ex``)."""
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/plot", params={"kind": "kappa"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("image/svg+xml")


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


def test_reins_summary_df_400_on_plain_object(client):
    """reins_summary_df is a 400 (not 500) when there's no reinsurance."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_summary_df")
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
    for which in ("reins_summary_df", "reins_stats_df", "reins_density_df"):
        r = client.get(f"/v1/objects/{oid}/{which}")
        assert r.status_code == 200, f"{which}: {r.text}"
        body = r.json()
        assert "columns" in body and "rows" in body
        assert len(body["rows"]) > 0


def test_reinsured_summary_reports_the_net_mean(client):
    """Under a cession the headline mean is the net one, matching ``summary_df``.

    ``actual_m`` is the analytic mean of the *subject* book and ``est_m`` the
    realized mean of the object's own (net) distribution. Preferring ``actual_m``
    unconditionally, which is right for a gross build, put a gross number on the
    summary bar directly above a table of net ones, and sent the exhibit's mean
    reference line off the end of the loss axis.
    """
    body = client.post("/v1/objects", json={"decl": _REINS}).json()
    oid = body["id"]
    summary = client.get(f"/v1/objects/{oid}/summary").json()
    cols = summary["columns"]
    agg_row = next(r for r in summary["rows"] if str(r[cols.index("X")]) == "Agg")
    net_mean = agg_row[cols.index("Mean")]
    assert body["mean"] == pytest.approx(net_mean, rel=1e-6)

    # And the gross case is untouched: no cession, so the analytic mean stands.
    plain = client.post(
        "/v1/objects",
        json={"decl": "agg NoReins 5 claims 100 xs 0 sev lognorm 10 cv .75 poisson"},
    ).json()
    plain_summary = client.get(f"/v1/objects/{plain['id']}/summary").json()
    pcols = plain_summary["columns"]
    prow = next(r for r in plain_summary["rows"] if str(r[pcols.index("X")]) == "Agg")
    # Analytic vs realized differ only by discretization here, so a loose match
    # is the honest assertion: the point is that it is the same variable.
    assert plain["mean"] == pytest.approx(prow[pcols.index("Mean")], rel=1e-3)


def test_reins_density_preview_is_binned(client):
    """Reins density bins to the display grid (faithful gross/ceded/net mass).

    Ten columns wide, so the cell budget backs the row target off below the
    narrow-frame maximum. That trade is the point of ``display_log2_for``, and
    asserting against it here is what keeps the two in step.
    """
    oid = client.post("/v1/objects", json={"decl": _REINS, "log2": 16}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_density_df")
    assert r.status_code == 200, r.text
    body = r.json()
    cols = body["columns"]
    assert len(body["rows"]) == 2 ** display_log2_for(len(cols))
    # The gross aggregate density column sums to ~1 across the binned grid.
    assert "p_agg_gross" in cols
    gi = cols.index("p_agg_gross")
    total = sum(row[gi] for row in body["rows"] if row[gi] is not None)
    assert total == pytest.approx(1.0, abs=1e-3)


# ----------------------------------------------------------------------
# CSV frame download
# ----------------------------------------------------------------------

def test_frame_csv_summary(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/summary.csv")
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
    r = client.get(f"/v1/objects/{oid}/frame/reins_summary_df.csv")
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
    """A bad distortion kind surfaces as a clean 422 with the message.

    Current ``aggregate`` raises the ``ValueError`` directly from the
    transformer (no longer wrapped in Lark's ``VisitError``); either way the
    build handler returns 422, not the old ugly 500.
    """
    r = client.post("/v1/objects", json={"decl": "dist MYD pd 0.5"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "pd" in detail
    assert "distortion kind" in detail.lower()


def test_infinite_variance_without_bs_returns_422(client):
    """An infinite-variance severity with no explicit bs is a 422, not a 500.

    ``aggregate`` raises ``InfiniteVarianceError`` (a ``ValueError`` subclass)
    when it can't size the grid; the build handler surfaces it in the 422 family
    with the library's "pass an explicit bs" message.
    """
    r = client.post(
        "/v1/objects",
        json={"decl": "agg IMP 3 claims sev 100 * pareto 1.5 - 100 poisson"},
    )
    assert r.status_code == 422, r.text
    assert "bs" in str(r.json()["detail"]).lower()


# ----------------------------------------------------------------------
# BivariateAggregate (bivariate / bv / clash / netceded / grossceded / grossnet)
# ----------------------------------------------------------------------

_BV = (
    "bivariate BV.Copula 25 claims "
    "agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
    "agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 "
    "copula gumbel 0.4 poisson"
)


def test_bivariate_builds_and_reports(client):
    """A BivariateAggregate builds as kind='bvagg' with the common surface.

    ``bvagg`` is the parser's own token. The api used to say ``bivariate``; where
    the two disagree on a name the library wins, so the api moved.
    """
    r = client.post("/v1/objects", json={"decl": _BV})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "bvagg"
    oid = body["id"]
    # Common reporting surface works.
    for which in ("info", "summary", "stats_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which
    # No pricing / reinsurance / bs-window -> clean 400 (not 500).
    assert client.post(
        f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.15}
    ).status_code == 400
    assert client.get(f"/v1/objects/{oid}/reins_summary_df").status_code == 400
    assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 400


# ----------------------------------------------------------------------
# PnL (the pnl / xpnl P&L engine -> kind='pnl')
# ----------------------------------------------------------------------

_PNL = (
    "pnl P.PnL 1000 prem less "
    "agg P.Loss 1000 prem at 70% lr sev lognorm 100 cv 2 poisson"
)


def test_pnl_builds_and_reports(client):
    """A PnL builds as kind='pnl' with the common surface + a headline mean.

    The build route rejected ``pnl`` before this landed (``_classify_object``
    had no ``PnL`` case), so this pins the new kind. A PnL exposes info /
    summary / stats / validation / density / plot; the density synthesis path
    is exercised because its ``density_df`` is a dict of grids, not a frame.
    """
    r = client.post("/v1/objects", json={"decl": _PNL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "pnl"
    # The summary-line mean/cv fall back to est_m / est_cv: a P&L outcome is
    # emergent, so it carries no analytic actual_m to report.
    assert body["mean"] is not None
    oid = body["id"]
    # Common reporting surface works (density exercises the dict->frame path).
    for which in ("info", "summary", "stats_df", "validation_df", "density_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which
    assert client.get(f"/v1/objects/{oid}/plot").status_code == 200
    # density CSV export goes through the grand-result synthesis, not a 500.
    csv = client.get(f"/v1/objects/{oid}/frame/density_df.csv")
    assert csv.status_code == 200
    assert "loss" in csv.text.splitlines()[0]
    # No tail / pricing / reinsurance / bs-window -> clean 400 (not 500).
    assert client.get(f"/v1/objects/{oid}/tail_df").status_code == 400
    assert client.post(
        f"/v1/objects/{oid}/price", json={"p": 0.99, "coc": 0.15}
    ).status_code == 400
    assert client.get(f"/v1/objects/{oid}/reins_summary_df").status_code == 400
    assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 400


# ----------------------------------------------------------------------
# Unbuildable programs are 422s, not 500s
# ----------------------------------------------------------------------

def test_pnl_over_portfolio_builds(client):
    """``pnl`` over a portfolio is supported and reports the whole surface."""
    port = ("port PB.Book agg A 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
            "agg B 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4")
    assert client.post("/v1/objects", json={"decl": port}).status_code == 200
    r = client.post("/v1/objects",
                    json={"decl": "pnl PB.Over 12000 prem less port.PB.Book"})
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    assert r.json()["kind"] == "pnl"
    for which in ("info", "meta", "summary", "stats_df", "density_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which


def test_xpnl_over_portfolio_is_422(client):
    """An unsupported combination is a 422 carrying the library's own reason.

    ``xpnl`` explodes a P&L across its units, and a portfolio total has none to
    expose, so the library raises ``NotImplementedError`` with a message that
    names the fix. That is a statement about the program, not a server fault,
    so it must not fall through to the catch-all 500.
    """
    port = ("port XP.Book agg A 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
            "agg B 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4")
    assert client.post("/v1/objects", json={"decl": port}).status_code == 200
    r = client.post("/v1/objects",
                    json={"decl": "xpnl XP.Over 12000 prem less port.XP.Book"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "xpnl" in detail and "portfolio" in detail


def test_unresolved_reference_is_422(client):
    """A reference to a name that is not in the recipe base is a 422.

    The library raises ``KeyError``, whose ``str()`` re-quotes the message, so
    the detail must come from ``args[0]`` or the user sees stray quotes.
    """
    r = client.post("/v1/objects",
                    json={"decl": "pnl NR.Over 9000 prem less port.NoSuchBook"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "NoSuchBook" in detail
    assert not detail.startswith('"'), f"quoted KeyError leaked through: {detail}"


# ----------------------------------------------------------------------
# Severity (sev -> kind='sev', near-first-class)
# ----------------------------------------------------------------------

def test_sev_builds_and_reports(client):
    """A ``sev`` builds as kind='sev' with info + plot and no library frames.

    ``Severity`` is near-first-class: DecL-creatable and carrying the metadata
    and narrative surface, but a look-through onto a frozen scipy variable
    rather than a compute result, so upstream exempts it from the DataFrame
    quartet. Every frame route must therefore answer a clean 400, not a 500.
    It also arrives as a *subclass* (``SeverityScipy``), which is why
    classification falls back to an isinstance check.

    ``density_df`` is the exception: the api synthesizes a display curve, the
    same presentation-layer move it makes for a ``PnL``. See
    :func:`test_sev_density_is_a_sampled_curve`.
    """
    r = client.post("/v1/objects", json={"decl": "sev SEV.Test lognorm 50 cv 1.5"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "sev"
    oid = body["id"]
    assert client.get(f"/v1/objects/{oid}/info").status_code == 200
    assert client.get(f"/v1/objects/{oid}/plot").status_code == 200
    for which in ("summary", "stats_df", "validation_df",
                  "tail_df", "bs_window_df", "reins_summary_df"):
        got = client.get(f"/v1/objects/{oid}/{which}").status_code
        assert got == 400, f"{which} -> {got}"


def test_sev_density_is_a_sampled_curve(client):
    """A severity's density is ``loss / pdf / F / S``, sampled by quantile.

    The column is ``pdf``, not ``p_total``: it is a density ordinate, not a
    probability mass, and naming it after the aggregate's column would invite
    summing something that has no business being summed.
    """
    oid = client.post(
        "/v1/objects", json={"decl": "sev SEV.Curve lognorm 50 cv 1.5"},
    ).json()["id"]
    r = client.get(f"/v1/objects/{oid}/density_df")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["loss", "pdf", "F", "S"]
    rows = body["rows"]
    assert len(rows) > 100
    at = {c: i for i, c in enumerate(body["columns"])}
    loss = [r[at["loss"]] for r in rows]
    cdf = [r[at["F"]] for r in rows]
    surv = [r[at["S"]] for r in rows]
    # Ascending in loss, so the client can plot it without sorting.
    assert loss == sorted(loss)
    # A cdf rises and S is its complement, both inside the unit interval.
    assert cdf[0] < 0.01 and cdf[-1] > 0.99
    assert all(abs(f + s - 1.0) < 1e-9 for f, s in zip(cdf, surv))
    # Quantile spacing, not linear: the tail step dwarfs the body step, which
    # is the whole point of inverting the survival function to build the grid.
    body_step = loss[len(loss) // 2] - loss[len(loss) // 2 - 1]
    tail_step = loss[-1] - loss[-2]
    assert tail_step > body_step * 10


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/unit_density_df  -- Portfolio only
# ----------------------------------------------------------------------

def test_unit_density_df_carries_every_unit(client):
    """Per-unit densities and survivals on the portfolio's common grid.

    This is what the Overview exhibit draws for a portfolio: a density and an
    exceedance series per unit alongside the total. ``Portfolio.density_df``
    has no per-unit densities (only ``p_total`` and the allocation columns), so
    they come off ``unit_density_df()`` and are unstacked back to wide form.
    """
    decl = ("port UD.Book agg Property 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
            "agg Casualty 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4")
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/unit_density_df")
    assert r.status_code == 200, r.text
    body = r.json()
    cols = body["columns"]
    for name in ("loss", "p_Property", "p_Casualty", "S_Property", "S_Casualty",
                 "p_total", "S"):
        assert name in cols, f"missing {name} in {cols}"

    at = {c: i for i, c in enumerate(cols)}
    rows = body["rows"]
    # Masses survive the display binning: each unit still sums to one. This is
    # the check that catches a binning path treating S_* as a mass, or p_* as a
    # pointwise value.
    for unit in ("p_Property", "p_Casualty", "p_total"):
        total = sum(r[at[unit]] or 0 for r in rows)
        assert abs(total - 1.0) < 1e-6, f"{unit} sums to {total}"
    # Survivals fall from ~1 to ~0 and stay inside the unit interval.
    for surv in ("S_Property", "S_Casualty", "S"):
        series = [r[at[surv]] for r in rows if r[at[surv]] is not None]
        assert series[0] > 0.9 and series[-1] < 1e-6
        assert all(0.0 <= v <= 1.0 + 1e-9 for v in series)


def test_unit_density_df_is_portfolio_only(client):
    """Anything but a Portfolio gets a clean 400, not a 500."""
    oid = client.post(
        "/v1/objects", json={"decl": "agg UD.Single 10 claims sev lognorm 50 cv 1 poisson"},
    ).json()["id"]
    r = client.get(f"/v1/objects/{oid}/unit_density_df")
    assert r.status_code == 400
    assert "Portfolio-only" in str(r.json()["detail"])


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/meta -- the DecL trailer + both programs
# ----------------------------------------------------------------------

def test_meta_reports_trailer_and_programs(client):
    """``/meta`` carries note / tags / hints and both program renderings."""
    decl = (
        "agg META.Probe 10 claims sev lognorm 50 cv 1.5 poisson "
        "note{a stored note} tags{topic:aggregate, role:intro} hints{log2=12}"
    )
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/meta")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert body["name"] == "META.Probe"
    assert body["note"] == "a stored note"
    assert body["tags"] == ["topic:aggregate", "role:intro"]
    assert "log2=12" in body["hints"]
    # pprogram is what the parser understood, re-rendered canonically.
    assert "META.Probe" in body["pprogram"]
    assert body["program"]
    # doc is never served: it is cookbook content, not playground content.
    assert "doc" not in body


def test_meta_empty_clauses_are_null(client):
    """A program with no trailer reports ``None``, not empty strings."""
    oid = client.post(
        "/v1/objects",
        json={"decl": "agg META.Bare 5 claims sev lognorm 10 cv 1 poisson"},
    ).json()["id"]
    body = client.get(f"/v1/objects/{oid}/meta").json()
    assert body["note"] is None
    assert body["hints"] is None
    assert body["tags"] == []


def test_meta_works_for_every_kind(client):
    """One route serves all six kinds, including the frame-less ones."""
    for decl, kind in (
        ("sev META.Sev lognorm 50 cv 1.5", "sev"),
        ("dist META.Dist ph 0.7", "distortion"),
        (_PNL.replace("P.PnL", "META.PnL").replace("P.Loss", "META.Loss"), "pnl"),
    ):
        oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
        body = client.get(f"/v1/objects/{oid}/meta").json()
        assert body["kind"] == kind, decl
        assert body["pprogram"], f"no pprogram for {kind}"


def test_meta_unknown_object_404(client):
    assert client.get("/v1/objects/nope/meta").status_code == 404


# ----------------------------------------------------------------------
# Session models export (/v1/session/models.agg)
# ----------------------------------------------------------------------

def test_session_models_export(client):
    """Both forms download the session's built programs as an .agg attachment."""
    # Empty cache: header-only, graceful (no 500). The object cache is per-app
    # (fresh per test), so raw starts empty.
    r0 = client.get("/v1/session/models.agg", params={"form": "raw"})
    assert r0.status_code == 200
    assert r0.headers["content-type"].startswith("text/plain")
    assert 'filename="session-models.agg"' in r0.headers["content-disposition"]
    assert "0 program(s)" in r0.text

    a = "agg SME.One 5 claims sev lognorm 10 cv 1 poisson"
    b = ("port SME.Book agg U 3 claims sev lognorm 5 cv 1 poisson "
         "agg V 4 claims sev gamma 8 cv 1 poisson")
    for decl in (a, b):
        assert client.post("/v1/objects", json={"decl": decl}).status_code == 200, decl

    # raw = programs verbatim, as typed.
    raw = client.get("/v1/session/models.agg", params={"form": "raw"})
    assert raw.status_code == 200
    assert a in raw.text
    assert "port SME.Book" in raw.text

    # agg = canonical (names present; source is the process-global knowledge, so
    # only assert our programs are included, not exact contents).
    agg = client.get("/v1/session/models.agg", params={"form": "agg"})
    assert agg.status_code == 200
    assert "SME.One" in agg.text and "SME.Book" in agg.text

    # Unknown form -> 422 (Literal validation).
    assert client.get(
        "/v1/session/models.agg", params={"form": "nope"}
    ).status_code == 422


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


def test_pricing_at_ccoc_portfolio(client):
    """ccoc path exercises ``price_ccoc(ccoc, *, p)`` and returns a total row."""
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    r = client.post(f"/v1/objects/{oid}/pricing_at", json={"p": 0.99, "ccoc": 0.1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ccoc"] == 0.1
    assert body["a"] is not None
    assert len(body["rows"]) >= 1
