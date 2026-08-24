"""Tests for /v1/examples and /v1/examples/heroes (aggregate's recipe base)."""

from __future__ import annotations

import pytest

from aggregate_api.examples import filter_examples, load_examples, load_heroes


def test_examples_is_one_flat_list(client):
    """The payload is items plus facets, with no groups and no headings."""
    r = client.get("/v1/examples")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"items", "facets"}
    assert len(body["items"]) > 100
    assert set(body["facets"]) == {"kind", "topic", "role"}


def test_every_entry_appears_exactly_once(client):
    """The grouped payload repeated an entry per topic tag; this one does not.

    182 rows for 151 entries was the cost of the grouped view, and the SPA then
    deduplicated them again to build its search index.
    """
    names = [item["name"] for item in client.get("/v1/examples").json()["items"]]
    assert len(names) == len(set(names))


def test_the_list_is_in_the_library_file_order(client):
    """``Recipe.seq`` is the order, so the served list matches it exactly.

    The frame arrives alphabetical by ``(kind, name)``, since
    ``Underwriter._recipes_frame`` ends in ``.sort_index()``, so this is not the
    order anything falls into by accident: file order has to be asked for.
    """
    from aggregate_api.library import get_underwriter

    uw = get_underwriter()
    frame = uw.recipes
    frame = frame[frame["source"] != "session"] if "source" in frame.columns else frame
    expected = list(frame.sort_values("seq").index.get_level_values("name"))
    served = [item["name"] for item in client.get("/v1/examples").json()["items"]]
    assert served == expected
    assert served != sorted(served), "file order is not alphabetical order"


def test_pills_are_kind_then_topics_then_roles(client):
    """The pill row is render-ready, so the SPA draws it as given."""
    for item in client.get("/v1/examples").json()["items"]:
        pills = item["pills"]
        assert pills[0] == {"ns": "kind", "value": item["kind"]}
        order = [p["ns"] for p in pills]
        assert order == sorted(order, key=["kind", "topic", "role"].index), item["name"]
        # Every tag reaches a pill, and every non-kind pill came from a tag.
        assert len(pills) == 1 + len(item["tags"])
        for pill in pills[1:]:
            assert f"{pill['ns']}:{pill['value']}" in item["tags"]


def test_a_value_repeating_across_namespaces_keeps_both_pills(client):
    """``topic:pnl`` sits on the ``pnl`` entries, and both pills are drawn.

    The library owns its vocabulary, so the app serves what is there rather than
    deciding one of the two is redundant (author ruling, 2026-08-24: ship it,
    and the tags come out of ``library.agg`` upstream). Suppressing one here
    would leave a topic filter selecting rows showing no matching topic pill.
    """
    items = {i["name"]: i for i in client.get("/v1/examples").json()["items"]}
    doubled = [
        i for i in items.values()
        if sum(p["value"] == i["kind"] for p in i["pills"]) > 1
    ]
    assert doubled, "library.agg still carries topic:pnl / topic:distortion"
    for item in doubled:
        assert item["kind"] in ("pnl", "distortion"), item["name"]


def test_facets_count_the_pills_in_order_of_first_appearance(client):
    """Facet lists read in file order too, not alphabetically or by count."""
    body = client.get("/v1/examples").json()
    for namespace, values in body["facets"].items():
        counted = {}
        first_seen = []
        for item in body["items"]:
            for pill in item["pills"]:
                if pill["ns"] != namespace:
                    continue
                if pill["value"] not in counted:
                    first_seen.append(pill["value"])
                counted[pill["value"]] = counted.get(pill["value"], 0) + 1
        assert [v["value"] for v in values] == first_seen
        assert {v["value"]: v["count"] for v in values} == counted


def test_server_side_filters_or_within_and_and_across(client):
    """OR within a namespace, AND across them, and the facets recount."""
    everything = client.get("/v1/examples").json()["items"]
    intro = client.get("/v1/examples?role=intro").json()
    assert intro["items"], "library.agg ships role:intro entries"
    assert all("role:intro" in i["tags"] for i in intro["items"])
    # Facets are counted over what came back, so the payload adds up.
    role_counts = {v["value"]: v["count"] for v in intro["facets"]["role"]}
    assert role_counts["intro"] == len(intro["items"])

    both = client.get("/v1/examples?role=intro&role=intermediate").json()["items"]
    assert len(both) > len(intro["items"]), "two roles is the union"

    crossed = client.get("/v1/examples?role=intro&kind=agg").json()["items"]
    assert crossed, "the library ships intro aggregates"
    assert all(i["kind"] == "agg" and "role:intro" in i["tags"] for i in crossed)
    assert len(crossed) < len(intro["items"]), "the kind narrows the roles"

    # Filtering never reorders: the survivors keep their file positions.
    order = [i["name"] for i in everything]
    assert [i["name"] for i in crossed] == [n for n in order
                                            if n in {i["name"] for i in crossed}]


def test_an_unmatched_filter_value_is_an_empty_list_not_an_error(client):
    """An unknown value narrows to nothing rather than 422ing."""
    r = client.get("/v1/examples?topic=nosuchtopic")
    assert r.status_code == 200
    assert r.json()["items"] == []
    assert r.json()["facets"] == {"kind": [], "topic": [], "role": []}


def test_example_items_carry_decl_kind_and_tags(client):
    """Every item has runnable DecL, a kind and at least one tag."""
    seen = 0
    for item in client.get("/v1/examples").json()["items"]:
        seen += 1
        assert item["decl"].strip(), f"empty decl for {item['name']}"
        assert item["name"]
        assert item["kind"]
        assert item["tags"], f"untagged entry {item['name']}"
        # A note is preferred but never required, so None is ordinary.
        assert item["note"] is None or isinstance(item["note"], str)
    assert seen > 100, "the shipped library runs to about 150 entries"


def test_the_served_decl_is_the_file_text_not_a_re_render(client):
    """``Recipe.as_read``: the entry arrives spelled the way it was written.

    ``spec_to_decl`` then ``format_program`` round trips through the spec, and
    the parser evaluated or expanded each of these on the way in and kept only
    the result. An example that exists to teach ``ph 2/3`` has to arrive
    carrying ``ph 2/3``, not ``ph 0.6666666666666666``.
    """
    items = {i["name"]: i for i in client.get("/v1/examples").json()["items"]}
    assert "ph 2/3" in items["PHDistortion"]["decl"]
    assert "tower [0 25 50 75 100 125]" in items["ReinsuranceOccurrenceTower"]["decl"]
    # Multi-line, as the file lays it out, rather than the parser's one-liner.
    assert "\n" in items["BasicBook"]["decl"]


def test_example_decl_carries_its_whole_trailer(client):
    """The served declaration keeps ``note{}`` and ``tags{}``.

    ``Recipe.as_read`` keeps the trailer the file wrote, which is what makes the
    built object carry the note and the tags its own program declares, so the
    status strip has something to print. An entry served without them builds an
    object with neither.

    ``hints{}`` matters as much and travels the same way: a program without it
    rebuilds on a different grid from the one the entry was written for.
    """
    noted = tagged = 0
    for item in client.get("/v1/examples").json()["items"]:
        decl = item["decl"]
        if item["note"]:
            noted += 1
            assert f"note{{{item['note']}}}" in decl, item["name"]
        else:
            assert "note{" not in decl
        if item["tags"]:
            tagged += 1
            for tag in item["tags"]:
                assert tag in decl, f"{item['name']} lost {tag}"
    assert noted > 100, "most of the shipped library carries a note"
    assert tagged > 100, "the shipped library is tagged throughout"


@pytest.mark.parametrize(
    "kind,name",
    [("agg", "BasicBook"), ("port", "BasicPortfolio"),
     ("distortion", "PHDistortion"), ("pnl", "PnLLoss")],
)
def test_a_library_entry_builds_an_object_that_keeps_its_trailer(client, kind, name):
    """One of several kinds: note and tags reach the object, so the strip prints them.

    The ``port`` case is the one worth having. DecL binds a trailer to the
    declaration it follows, so a note written after the last unit belongs to that
    unit and the portfolio's own note is empty. ``library.agg`` writes it
    directly after the name, before the first unit, and this asserts that the
    served text kept it there rather than trusting it, because the wrong
    placement fails silently: the program parses, the object builds, and the
    note is simply on something else.

    The ``bvagg`` kind is left out on cost, not on principle. Its entries build a
    joint grid, which is the slowest thing in the suite, and the placement rule
    it exercises is the one ``agg`` already covers.
    """
    items = {i["name"]: i for i in client.get("/v1/examples").json()["items"]
             if i["kind"] == kind}
    item = items[name]
    assert item["note"], f"{name} is chosen because it carries a note"
    assert item["tags"], f"{name} is chosen because it carries tags"
    body = client.post("/v1/objects", json={"decl": item["decl"]}).json()
    assert body["note"] == item["note"]
    assert sorted(body["tags"]) == sorted(item["tags"])


def test_heroes_are_the_role_hero_entries(client):
    """``/examples/heroes`` is ``discover(tags='role:hero')``, in file order."""
    r = client.get("/v1/examples/heroes")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "library.agg ships role:hero entries"
    for item in items:
        assert "role:hero" in item["tags"]
        assert item["decl"].strip()
    order = [i["name"] for i in client.get("/v1/examples").json()["items"]]
    names = [i["name"] for i in items]
    assert names == [n for n in order if n in set(names)]


def test_heroes_subset_of_examples(client):
    """Every hero also appears in the full listing, under the same decl."""
    heroes = {i["name"]: i for i in client.get("/v1/examples/heroes").json()["items"]}
    everything = {i["name"]: i for i in client.get("/v1/examples").json()["items"]}
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
    """Repeat calls return the identical object; building the heroes is not free."""
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
        names = {i["name"] for i in client.get("/v1/examples").json()["items"]}
    finally:
        load_examples.cache_clear()
    assert "SessionLeakProbe" not in names


def test_filter_examples_does_not_mutate_the_cached_payload():
    """The loader's payload is shared, so filtering has to leave it alone."""
    payload = load_examples()
    before = len(payload["items"])
    narrowed = filter_examples(payload, role=["intro"])
    assert len(payload["items"]) == before
    assert len(narrowed["items"]) < before
    # Nothing asked for is the identical object, not a copy.
    assert filter_examples(payload) is payload


def test_loaders_are_cached():
    """Repeat calls return the identical object (``lru_cache``)."""
    assert load_examples() is load_examples()
    assert load_heroes() is load_heroes()
