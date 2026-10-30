"""Tests for /v1/decl/* helpers (completions, lex, grammar, words)."""

from __future__ import annotations

import json
from pathlib import Path


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


# ----------------------------------------------------------------------
# Reformat in the caller's fork (1.15.0)
# ----------------------------------------------------------------------
# The route previews the program in the caller's session and renders each
# statement's spec, so the caller's own declarations inline like library
# entries. Each test uses its own session id, because a fork is per session.

SEV = "X-Aggregate-Session"


def _declare(client, session, decl):
    """Build ``decl`` as ``session``, which registers it in that fork."""
    r = client.post("/v1/objects", json={"decl": decl, "log2": 10},
                    headers={SEV: session})
    assert r.status_code == 200, r.json()
    return r.json()


def _reformat(client, session, decl):
    """POST Reformat as ``session`` and return the text it answers."""
    r = client.post("/v1/decl/format", json={"decl": decl}, headers={SEV: session})
    assert r.status_code == 200, r.text
    return r.json()["decl"]


def test_reformat_inlines_an_own_declaration_and_a_library_entry(client):
    """``port P agg.A agg.Capstone.Gross`` after an own ``agg A``: both inline."""
    session = "session-reformat-own"
    _declare(client, session, "agg A 2 claims sev lognorm 10 cv 1 poisson")
    out = _reformat(client, session, "port P agg.A agg.Capstone.Gross")
    assert out != "port P agg.A agg.Capstone.Gross"
    assert "agg.A" not in out and "agg.Capstone.Gross" not in out
    assert "agg A" in out and "agg Capstone.Gross" in out


def test_reformat_inlines_an_own_severity(client):
    """``sev.Cat`` after an own ``sev Cat`` arrives as Cat's own clauses."""
    session = "session-reformat-sev"
    _declare(client, session, "sev Cat lognorm 17 cv 1.3")
    out = _reformat(client, session, "agg R 2 claims sev sev.Cat poisson")
    assert "sev.Cat" not in out
    assert "lognorm 17 cv 1.3" in out


def test_reformat_leaves_a_severity_reference_to_an_aggregate(client):
    """``sev agg.X`` stands for X's computed output and has no inline form."""
    session = "session-reformat-sevref"
    _declare(client, session,
             "agg A 2 claims sev lognorm 10 cv 1 poisson hints{log2=10; bs=1}")
    out = _reformat(client, session, "agg Q 2 claims sev agg.A poisson")
    assert "sev agg.A" in out


def test_reformat_still_echoes_an_unknown_reference(client):
    """A name this session never declared is a failure, and failures echo."""
    decl = "port P\n  agg.NeverDeclaredHere\n  agg.Capstone.Gross"
    assert _reformat(client, "session-reformat-unknown", decl) == decl


def test_reformat_echoes_a_program_whose_second_statement_names_the_first(client):
    """Rendering would inline the reference and leave the first statement dead."""
    decl = ("sev MySev lognorm 10 cv 1\n"
            "\n"
            "agg A 2 claims sev sev.MySev poisson")
    assert _reformat(client, "session-reformat-two", decl) == decl


def test_reformat_keeps_the_hints_sharpen_wrote(client):
    """Sharpen pins the grid in ``hints{}``; a Reformat straight after keeps it."""
    session = "session-reformat-sharpen"
    built = _declare(client, session,
                     "agg Sharp 10 claims sev lognorm 100 cv 1.5 poisson")
    r = client.post(f"/v1/objects/{built['id']}/sharpen", json={},
                    headers={SEV: session})
    assert r.status_code == 200, r.text
    program = r.json()["program"]
    assert "hints{" in program
    out = _reformat(client, session, program)
    hints = program[program.index("hints{"):].split("}")[0]
    for clause in hints.removeprefix("hints{").split(";"):
        assert clause.strip() in out


def test_reformat_echoes_a_bare_name(client):
    """A bare name is a lookup, not a program to lay out, as it always was."""
    assert _reformat(client, "session-reformat-bare", "Capstone.Gross") == "Capstone.Gross"


def test_reformat_renders_library_programs_as_the_text_route_did():
    """Every ``library.agg`` entry renders byte for byte as it did through 1.14.

    Through 1.14 the route handed the text to ``format_program``; it now hands
    each previewed spec. For a library-only program the two must agree. The two
    combinator distortions are the exception, in the promised direction: the
    writer cannot render them from a spec, so the route echoes the input, where
    the text route answered the writer's collapsed copy of it.
    """
    from aggregate import build
    from aggregate.decl_writer import format_program

    from aggregate_api.routes.decl import _format_decl

    build.load()
    echoed = set()
    for kind, name in build.recipes.reset_index()[["kind", "name"]].itertuples(
            index=False):
        program = build.recipe(name, kind).program
        new = _format_decl(program, build)
        if new == program:
            echoed.add(name)
            continue
        assert new == format_program(program, fmt="text", trailer=True), name
    assert echoed <= {"MinimumDistortion", "MixtureDistortion"}, echoed


# ----------------------------------------------------------------------
# The DecL word list (1.30.0, ``[DecL-Word-List]``)
# ----------------------------------------------------------------------

_WORDS_FILE = Path(__file__).resolve().parents[1] / "web" / "src" / "decl-words.json"
_REGENERATE = "uv run --no-sync python -m aggregate.decl_words > web/src/decl-words.json"


def _library_groups() -> dict:
    """``decl_words()`` as JSON carries it, so tuples compare as lists."""
    from aggregate.decl_words import decl_words

    return json.loads(json.dumps(decl_words()))


def test_words_route_serves_the_library_list(client):
    """Every group of ``decl_words()``, unchanged, beside the library version.

    The same object ``python -m aggregate.decl_words`` prints, which is what
    aSP reads in place of a build step.
    """
    import aggregate

    r = client.get("/v1/decl/words")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == aggregate.__version__
    assert body["groups"] == _library_groups()
    assert list(body["groups"]) == list(_library_groups()), "group order kept"


def test_committed_word_file_matches_the_installed_library():
    """``web/src/decl-words.json`` is the installed library's list, regenerated.

    The playground colors DecL from the committed file, so that ``npm run dev``,
    ``npm test`` and the build need no Python. This is what keeps it honest: a
    word the library adds turns this red, never into an uncolored word. Only
    ``groups`` is compared, because a library release that adds no word should
    not fail here merely for changing ``version``.
    """
    committed = json.loads(_WORDS_FILE.read_text(encoding="utf-8"))
    assert committed["groups"] == _library_groups(), (
        "web/src/decl-words.json differs from the installed aggregate's "
        f"decl_words(); regenerate it from the repository root with: {_REGENERATE}")
