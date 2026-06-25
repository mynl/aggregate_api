"""Tests for /v1/examples (examples.agg loader)."""

from __future__ import annotations


def test_examples_grouped_by_category(client):
    r = client.get("/v1/examples")
    assert r.status_code == 200
    body = r.json()
    cats = body["categories"]
    letters = {c["letter"] for c in cats}
    # At least the canonical A-Z categories from the Contents block
    # should be present (or close to it). A is the showcase heroes.
    assert "A" in letters
    assert "B" in letters


def test_examples_contain_dice(client):
    """The B.ThreeDice example from examples.agg should appear in section B
    (section A is now the showcase heroes)."""
    r = client.get("/v1/examples")
    cats = {c["letter"]: c for c in r.json()["categories"]}
    b = cats["B"]
    names = {item["name"] for item in b["items"]}
    assert any("Dice" in n for n in names)


def test_example_items_have_decl(client):
    """Each example carries non-empty DecL text."""
    r = client.get("/v1/examples")
    for cat in r.json()["categories"]:
        for item in cat["items"]:
            assert item["decl"].strip(), f"empty decl for {item['name']}"
            assert item["name"]
            # note may be None; if present it's a string.
            assert item["note"] is None or isinstance(item["note"], str)


def test_multiline_and_keyword_examples_captured(client):
    """Statement-model parsing: multi-line ``port`` and ``bivariate`` items
    survive folding, and ``;``-terminated programs keep a clean decl + note.

    Regression for the switch to ``aggregate``'s statement syntax (line
    breaks instead of ``\\`` continuations, ``;`` terminators). A multi-line
    ``port`` must fold whole (not just its header), the ``bivariate``/``bv``
    keyword must be recognized, and a trailing ``;`` must not leak into the
    decl or swallow the ``note{...}``.
    """
    r = client.get("/v1/examples")
    items = {i["name"]: i for c in r.json()["categories"] for i in c["items"]}
    # Multi-line portfolio folds whole: header + both component aggs.
    book = items["G.Book"]
    assert book["decl"].startswith("port G.Book agg ")
    assert book["decl"].count("agg ") == 2
    assert ";" not in book["decl"]
    assert book["note"] and "note{" not in book["decl"]
    # bivariate keyword recognized.
    assert "I.Copula" in items
    assert items["I.Copula"]["decl"].startswith("bivariate I.Copula ")
    # ``;``-terminated single-line program: no stray terminator, note kept.
    dice = items["B.ThreeDice"]
    assert ";" not in dice["decl"]
    assert "note{" not in dice["decl"]
    assert dice["note"]
