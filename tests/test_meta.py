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


# ----------------------------------------------------------------------
# The static-table engine: which generation is installed
# ----------------------------------------------------------------------


def test_greater_tables_is_the_new_generation():
    """Guard the name collision that the rename created.

    ``greater_tables`` is now two different packages: the PyPI 5.3 line, and the
    rewrite this service depends on. They share an import name and cannot coexist
    in one environment, and plain ``pip install greater-tables`` still resolves to
    5.3 until 6.0.0 ships. A deploy that misses the ``[tool.uv.sources]`` entry
    would install 5.3.

    So importing it proves nothing: **both** generations export ``GT``. These
    three symbols exist only in the rewrite, and they are the ones this service
    actually uses.
    """
    import greater_tables as gt

    assert hasattr(gt, "build")
    assert hasattr(gt, "canonical_json")
    assert gt.IR_VERSION == 1
    # Not 5.x. The rewrite restarted its own numbering and publishes as 6.0.
    assert int(gt.__version__.split(".")[0]) != 5


def test_meta_reports_the_table_engine_version(client):
    """The About panel's number, which is a front-end version as much as a
    backend one: the same install serves the walker the SPA loads."""
    from importlib.metadata import version

    body = client.get("/v1/meta").json()
    assert body["tables_version"] == version("greater-tables")


# ----------------------------------------------------------------------
# GET /v1/assets/{name}  -- the table-document walker
# ----------------------------------------------------------------------


def test_assets_serve_the_walker_from_the_package(client):
    """The renderer ships with the package that emits the documents it renders.

    Serving it from ``importlib.resources`` rather than bundling a copy is what
    makes version skew between the two impossible: one install ships both, so
    they move together or not at all. This asserts the wiring, and that the
    module really is the walker rather than some other file that happened to be
    readable.
    """
    r = client.get("/v1/assets/gt-render.esm.js")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/javascript")
    assert "renderTable" in r.text
    assert "IR_VERSION_SUPPORTED" in r.text

    r = client.get("/v1/assets/gt.css")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/css")
    assert ".gt" in r.text


def test_assets_revalidate_rather_than_cache_bust(client):
    """ETag plus no-cache, so a `uv sync` is picked up on the next reload.

    The alternative was a ``?v=`` the client computes, which needs the client to
    learn the package version to ask for the right file. This needs it to know
    nothing.
    """
    r = client.get("/v1/assets/gt.css")
    etag = r.headers["etag"]
    assert etag
    assert r.headers["cache-control"] == "no-cache"

    again = client.get("/v1/assets/gt.css", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert not again.content


def test_assets_are_an_allow_list(client):
    """Two files by name, so there is no path to reason about."""
    assert client.get("/v1/assets/nope.js").status_code == 404
    assert client.get("/v1/assets/config.py").status_code == 404
