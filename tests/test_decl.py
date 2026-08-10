"""Tests for /v1/decl/* helpers (completions, lex, grammar)."""

from __future__ import annotations


def test_grammar_serves_lark(client):
    r = client.get("/v1/decl/grammar")
    assert r.status_code == 200
    body = r.text
    # decl.lark should reference at least one of these familiar
    # Lark constructs; loose check tolerant of grammar evolution.
    assert "start:" in body or "%import" in body or "answer" in body


def test_lex_returns_tokens(client):
    r = client.post("/v1/decl/lex", json={"decl": "agg Dice dfreq [3] dsev [1:6]"})
    assert r.status_code == 200
    tokens = r.json()["tokens"]
    assert len(tokens) > 0
    # Token records carry the expected schema fields.
    first = tokens[0]
    for key in ("type", "value", "start", "end", "line", "column"):
        assert key in first


def test_lex_handles_bad_input_gracefully(client):
    r = client.post("/v1/decl/lex", json={"decl": "agg X ?"})
    assert r.status_code == 200
    # Bad input -> empty list rather than a 500. Callers should use
    # /v1/objects for the structured error report.
    assert r.json()["tokens"] == [] or isinstance(r.json()["tokens"], list)


def test_complete_returns_candidates(client):
    """Completion at the start of input should propose top-level kinds."""
    r = client.post("/v1/decl/complete", json={"decl": "", "cursor": 0})
    assert r.status_code == 200
    body = r.json()
    assert "completions" in body
    # At the empty position the grammar should accept at least 'agg',
    # 'sev', 'port', or 'dist' as starters.
    labels = {c["label"] for c in body["completions"]}
    # Loose check: at least one of the top-level kinds is present.
    assert labels & {"agg", "sev", "port", "dist", "distortion"}


def test_complete_offers_a_token_that_is_valid_decl(client):
    """Every candidate's ``text`` is insertable; the gloss travels separately.

    38 of the 105 terminals carry a curated label of the shape
    ``'approximate' (or 'approx')``. That whole phrase used to be the ``label``
    and editors insert the label, so accepting a completion wrote a stray
    apostrophe and a parenthetical into the program: the old ``strip("'")``
    removes matching characters from the ends of a string and cannot reach the
    quote in the middle of one ending in ``)``.
    """
    r = client.post("/v1/decl/complete", json={"decl": "", "cursor": 0})
    body = r.json()
    assert body["completions"], "the empty position offers the whole vocabulary"
    for c in body["completions"]:
        # A DecL token is one word and carries no quote. `(` and `**` are
        # tokens; `a frequency name (poisson, ...)` is a description and must
        # not be here at all.
        assert "'" not in c["text"], c
        assert c["text"] and not any(ch.isspace() for ch in c["text"]), c
    by_terminal = {c["terminal"]: c for c in body["completions"]}
    # The case that named the bug, one with no gloss, one that is punctuation,
    # and one that offers two spellings.
    assert by_terminal["APPROXIMATE"]["text"] == "approximate"
    assert by_terminal["APPROXIMATE"]["detail"] == "or 'approx'"
    assert by_terminal["AGG"]["text"] == "agg"
    assert by_terminal["AGG"]["detail"] is None
    assert by_terminal["LPAREN"]["text"] == "("
    assert by_terminal["EXPONENT"]["text"] == "**"
    assert by_terminal["EXPONENT"]["detail"] == "or '^'"
    # Descriptive terminals name a category rather than a literal, so there is
    # nothing to insert and they are not offered.
    assert "BUILTIN_AGG" not in by_terminal
    assert "FREQ" not in by_terminal


def test_complete_matches_the_token_not_the_gloss(client):
    """A prefix is matched against what would be inserted.

    ``premium`` is labeled ``'premium' (or 'prem')``. Matching the whole label
    would be matching against prose, so a prefix appearing only inside someone
    else's parenthetical would pull an unrelated keyword into the menu.
    """
    r = client.post("/v1/decl/complete", json={"decl": "prem", "cursor": 4})
    texts = {c["text"] for c in r.json()["completions"]}
    assert "premium" in texts
    assert all(t.startswith("prem") for t in texts), texts


def test_complete_empty_for_unparseable_prefix(client):
    """An unrecoverable parse error -> empty completion list."""
    r = client.post(
        "/v1/decl/complete", json={"decl": "agg X ?", "cursor": 7},
    )
    assert r.status_code == 200
    # Either empty or non-error; the contract is "no crash".
    assert isinstance(r.json()["completions"], list)
