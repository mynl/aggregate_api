"""Tests for /v1/examples and /v1/examples/heroes (aggregate's recipe base)."""

from __future__ import annotations

import pytest

from aggregate_api.examples import load_examples, load_heroes


def test_examples_grouped_by_topic(client):
    """The default grouping is the ``topic:`` tag namespace."""
    r = client.get("/v1/examples")
    assert r.status_code == 200
    body = r.json()
    assert body["grouping"] == "topic"
    keys = {c["key"] for c in body["categories"]}
    # The shipped vocabulary; every one of these carries entries in library.agg.
    assert {"aggregate", "severity", "portfolio", "distortion"} <= keys
    # Almost every entry is topic-tagged, so the catch-all stays negligible.
    # (One shipped entry, DefectivePareto, carries role:paper and no topic.)
    other = next((c for c in body["categories"] if c["key"] == "other"), None)
    assert other is None or len(other["items"]) <= 5


def test_examples_group_by_kind(client):
    """``group=kind`` files entries by the parser's own type token."""
    r = client.get("/v1/examples?group=kind")
    assert r.status_code == 200
    body = r.json()
    assert body["grouping"] == "kind"
    keys = {c["key"] for c in body["categories"]}
    # All six DecL-creatable kinds are represented in the shipped library.
    assert {"agg", "port", "sev", "bvagg", "pnl", "distortion"} <= keys
    for cat in body["categories"]:
        for item in cat["items"]:
            assert item["kind"] == cat["key"]


def test_examples_group_by_role(client):
    """``group=role`` is sparse, so it carries the ``other`` bucket."""
    r = client.get("/v1/examples?group=role")
    body = r.json()
    keys = [c["key"] for c in body["categories"]]
    assert "hero" in keys
    assert keys[-1] == "other", "the untagged majority sorts last"


def test_examples_rejects_unknown_grouping(client):
    """An unknown ``group`` is a 422 from FastAPI's Literal validation."""
    assert client.get("/v1/examples?group=letter").status_code == 422


def test_example_items_carry_decl_kind_and_tags(client):
    """Every item has runnable DecL, a kind and at least one tag."""
    r = client.get("/v1/examples")
    seen = 0
    for cat in r.json()["categories"]:
        for item in cat["items"]:
            seen += 1
            assert item["decl"].strip(), f"empty decl for {item['name']}"
            assert item["name"]
            assert item["kind"]
            assert item["tags"], f"untagged entry {item['name']}"
            # A note is preferred but never required, so None is ordinary.
            assert item["note"] is None or isinstance(item["note"], str)
    assert seen > 100, "the shipped library has ~186 entries"


def test_example_decl_is_doc_free_and_reloadable(client):
    """``Recipe.decl`` is canonical DecL: no trailer noise, no doc payload.

    It carries ``hints{}`` (which change how the object builds) and drops
    ``note`` / ``tags`` / ``doc``. The doc matters most: a stored program holds
    the preprocessor's base64 one-liner, and leaking that into the editor would
    be unreadable.
    """
    r = client.get("/v1/examples")
    for cat in r.json()["categories"]:
        for item in cat["items"]:
            decl = item["decl"]
            assert "doc{{{" not in decl
            assert "note{" not in decl
            assert "tags{" not in decl


def test_heroes_are_the_role_hero_entries(client):
    """``/examples/heroes`` is ``discover(tags='role:hero')``."""
    r = client.get("/v1/examples/heroes")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "library.agg ships role:hero entries"
    for item in items:
        assert "role:hero" in item["tags"]
        assert item["decl"].strip()
    names = [i["name"] for i in items]
    assert names == sorted(names)


def test_heroes_subset_of_examples(client):
    """Every hero also appears in the full listing, under the same decl."""
    heroes = {i["name"]: i for i in client.get("/v1/examples/heroes").json()["items"]}
    everything = {
        i["name"]: i
        for c in client.get("/v1/examples").json()["categories"]
        for i in c["items"]
    }
    for name, hero in heroes.items():
        assert name in everything
        assert everything[name]["decl"] == hero["decl"]


def test_hero_example_builds(client):
    """A hero's decl is runnable as shipped: load it, build it, get an object.

    This is the landing-page path (the gallery auto-builds the first card), so a
    hero that does not build is a blank front page.
    """
    heroes = client.get("/v1/examples/heroes").json()["items"]
    # Pick the cheapest hero rather than the first: some carry hints{log2=16}.
    hero = min(heroes, key=lambda i: len(i["decl"]))
    r = client.post("/v1/objects", json={"decl": hero["decl"]})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] in ("agg", "port", "sev", "bvagg", "pnl", "distortion")


def test_hero_sparklines(client):
    """Thumbnail silhouettes: peak-normalized, short, keyed by entry name.

    Deliberately a separate endpoint from ``/heroes`` because it *builds* every
    hero and one of them carries ``hints{log2=16}``. The SPA calls it after
    first paint, so the landing page never waits on it.
    """
    r = client.get("/v1/examples/heroes/sparklines")
    assert r.status_code == 200, r.text
    sparks = r.json()["sparklines"]
    assert sparks, "no hero produced a sparkline"

    heroes = {i["name"] for i in client.get("/v1/examples/heroes").json()["items"]}
    for name, values in sparks.items():
        assert name in heroes, f"{name} is not a hero"
        assert len(values) == 48
        assert all(0.0 <= v <= 1.0 for v in values), name
        # Peak-normalized: something must reach the top of the frame or the
        # thumbnail would render as a flat line.
        assert max(values) == 1.0, name
        # And it must not be flat, or the silhouette says nothing.
        assert min(values) < 1.0, name


def test_hero_sparklines_are_cached(client):
    """Repeat calls return the identical object; building 8 heroes is not free."""
    from aggregate_api.examples import load_hero_sparklines

    assert load_hero_sparklines() is load_hero_sparklines()


def test_session_builds_do_not_leak_into_examples(client):
    """A program built through the api must not show up as a library example.

    ``build()`` adds every program it parses to the underwriter's recipe base
    with ``source='session'``. Since the api and the example library share the
    ``build`` singleton, an unfiltered walk would put the user's own untagged,
    unnamed programs in the Examples menu.
    """
    decl = "agg SessionLeakProbe 7 claims sev lognorm 42 cv 1.1 poisson"
    assert client.post("/v1/objects", json={"decl": decl}).status_code == 200
    load_examples.cache_clear()
    try:
        names = {
            i["name"]
            for c in client.get("/v1/examples").json()["categories"]
            for i in c["items"]
        }
    finally:
        load_examples.cache_clear()
    assert "SessionLeakProbe" not in names


def test_loader_rejects_unknown_grouping():
    """The loader validates too, not just the route."""
    with pytest.raises(ValueError, match="unknown grouping"):
        load_examples("letter")


def test_loaders_are_cached():
    """Repeat calls return the identical object (``lru_cache``)."""
    assert load_examples("topic") is load_examples("topic")
    assert load_heroes() is load_heroes()
