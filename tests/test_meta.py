"""Tests for /v1/health, /v1/meta and /v1/meta/style."""

from __future__ import annotations

import re


def test_health(client):
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert isinstance(body["version"], str) and body["version"]


def test_meta(client):
    r = client.get("/v1/meta")
    assert r.status_code == 200
    body = r.json()
    # log2_cap was set to 20 by the conftest fixture.
    assert body["log2_cap"] == 20
    assert body["plot_default_format"] in ("svg", "png")
    assert body["cache_max"] >= 1


def test_meta_style_comes_from_aggregate(client):
    """The chart style is the library's own, not a second copy of the palette.

    The SPA's interactive exhibits and the server-rendered matplotlib plots on
    the Plot tab draw from this one source, which is the whole point: two
    hardcoded hex lists would drift and the drift would be visible.
    """
    r = client.get("/v1/meta/style")
    assert r.status_code == 200, r.text
    body = r.json()
    colors = body["colors"]
    assert len(colors) >= 4
    assert all(re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in colors), colors
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", body["grid_color"])
    assert body["line_width"] > 0
    assert body["font_size"] > 0

    # It really is aggregate.style's cycle, not the fallback that happens to
    # match it: compare against the library directly.
    from aggregate import style as agg_style

    cycle = agg_style.rc_params().get("axes.prop_cycle")
    if cycle is not None:
        expected = [e.get("color") for e in cycle if e.get("color")]
        if expected:
            assert colors == expected
