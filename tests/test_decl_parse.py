"""Tests for ``POST /v1/decl/parse``, the parser's answer as data.

The route's promise is narrow: the ``(kind, name, spec)`` triple the parser
understood, coerced to JSON, with no object built and no cache entry made. The
cases below are the plan's acceptance list, and the serialization ones are the
reason the route needed its own coercer rather than reusing ``_safe``.
"""

from __future__ import annotations

import json

import pytest

from tests.conftest import requires_nttagg


# A one-statement aggregate with an occurrence cession, so the spec carries
# exposure, severity, frequency and reinsurance together.
AGG = (
    "agg P.Book 1000 premium at 70% lr 500 xs 0 "
    "sev lognorm 100 cv 2 "
    "occurrence ceded to 250 xs 250 "
    "poisson"
)

# The shape the requesting client reads: an integrated xpnl over an inline agg
# engine, with an unlimited aggregate quota share, two expense groups and a
# peel direction. The unlimited layer is the direct regression.
XPNL = (
    'xpnl X.PnL 1000 premium less '
    'agg X.Engine [1000 2000] premium at 70% lr [500 1000] xs 0 '
    'sev lognorm 100 cv 2 mixed gamma 0.3 '
    'aggregate ceded to 20% po inf xs 0 rate 100% cede 28% as QS '
    'less 26% premium expense as "G&A" 1500000 fixed expense as "Fixed" '
    'peel bottom-up'
)


def _parse(client, decl):
    """POST the program and return the parsed statement list, asserting 200."""
    r = client.post("/v1/decl/parse", json={"decl": decl})
    assert r.status_code == 200, r.text
    return r.json()["statements"]


def test_an_agg_returns_its_kind_name_and_spec(client):
    """The plain case: one statement in, one triple out, matching the program."""
    statements = _parse(client, AGG)
    assert len(statements) == 1
    one = statements[0]
    assert one["kind"] == "agg"
    assert one["name"] == "P.Book"
    spec = one["spec"]
    assert spec["exp_premium"] == 1000.0
    assert spec["exp_lr"] == pytest.approx(0.7)
    assert spec["exp_limit"] == 500.0
    assert spec["sev_name"] == "lognorm"
    assert spec["sev_mean"] == 100.0
    assert spec["sev_cv"] == 2.0
    assert spec["freq_name"] == "poisson"
    # A layer is a three-element array, not an object: (share, limit, attach).
    assert spec["occ_reins"] == [[1.0, 250.0, 250.0]]


def test_an_integrated_xpnl_carries_the_engine_and_the_wrapper(client):
    """The shape the external client reads, engine fields and wrapper together.

    Worth keeping as a fixture: this one program exercises every awkward corner
    at once, a vectorized exposure, an unlimited aggregate layer, two expense
    groups and a peel direction.
    """
    statements = _parse(client, XPNL)
    assert len(statements) == 1
    one = statements[0]
    assert one["kind"] == "xpnl"
    assert one["name"] == "X.PnL"
    spec = one["spec"]
    # The wrapper's own fields.
    assert spec["consideration"] == 1000.0
    assert spec["engine_name"] == "X.Engine"
    assert spec["peel"] == "bottom-up"
    assert spec["expense_spec"] == [
        ["G&A", [["premium", 0.26]]],
        ["Fixed", [["fixed", 1500000.0]]],
    ]
    # The engine's fields, flat in the same spec.
    assert spec["exp_premium"] == [1000.0, 2000.0]
    assert spec["exp_limit"] == [500.0, 1000.0]
    assert spec["sev_name"] == "lognorm"
    assert spec["freq_name"] == "gamma"
    # The cession and the three companions a client reads beside it.
    assert spec["agg_kind"] == "ceded to"
    assert spec["agg_reins_premium"] == [["rate", 1.0]]
    assert spec["agg_reins_cede"] == [0.28]
    assert spec["agg_reins_label"] == ["QS"]


def test_an_unlimited_layer_serializes_as_the_string_inf(client):
    """``inf`` travels as ``"inf"``, and the response is strict JSON.

    The direct regression. ``json.dumps`` runs with ``allow_nan=False`` under
    Starlette's ``JSONResponse``, so an uncoerced ``inf`` raises and the route
    500s rather than shipping bad JSON. ``None`` is not the answer either: a
    limit is never absent, so ``null`` could not be told from a missing value
    and would lose the sign.
    """
    r = client.post("/v1/decl/parse", json={"decl": XPNL})
    assert r.status_code == 200, r.text
    # A strict reader, with no NaN / Infinity extension.
    body = json.loads(r.text, parse_constant=lambda c: pytest.fail(
        f"the payload carried the JSON extension {c!r}"))
    spec = body["statements"][0]["spec"]
    assert spec["agg_reins"] == [[0.2, "inf", 0.0]]
    # The plainest one-line agg carries one too, on the severity's upper bound.
    assert spec["sev_ub"] == "inf"


def test_exp_el_serializes_as_an_array_of_numbers(client):
    """A numpy array in the spec arrives as a plain list."""
    spec = _parse(client, XPNL)[0]["spec"]
    assert spec["exp_el"] == [700.0, 1400.0]


def test_a_port_spec_coerces_its_nested_unit_triples(client):
    """A ``port`` nests ``(kind, name, spec)`` triples under its own ``spec``.

    The recursion has to reach a dict, not just lists and tuples. Each unit's
    ``sev_ub`` is an ``inf`` three levels down, so an unhandled nesting shows
    up as a 500 rather than as a quietly wrong value.
    """
    statements = _parse(client, (
        "port P.Port "
        "agg U.A 10 claims sev lognorm 100 cv 1.5 poisson "
        "agg U.B 5 claims 500 xs 0 sev gamma 50 cv 0.8 poisson"
    ))
    assert len(statements) == 1
    assert statements[0]["kind"] == "port"
    units = statements[0]["spec"]["spec"]
    assert [u[0] for u in units] == ["agg", "agg"]
    assert [u[1] for u in units] == ["U.A", "U.B"]
    assert units[0][2]["sev_ub"] == "inf"
    assert units[1][2]["exp_limit"] == 500.0


def test_two_statements_return_two_entries_in_source_order(client):
    """Separate statements, separate entries, the order they were written in.

    A blank line is what separates two statements. ``preprocess`` folds a bare
    newline plus indentation into one space, which is how a program spread over
    several lines stays a single statement.
    """
    statements = _parse(client, (
        "agg First 100 claims sev lognorm 50 cv 1 poisson\n"
        "\n"
        "agg Second 50 claims sev gamma 25 cv 0.5 poisson"
    ))
    assert [s["name"] for s in statements] == ["First", "Second"]
    assert statements[0]["spec"]["sev_name"] == "lognorm"
    assert statements[1]["spec"]["sev_name"] == "gamma"


def test_a_malformed_program_returns_the_structured_parse_error(client):
    """422 carrying the ``ErrorReport`` dict, plus which statement failed."""
    r = client.post("/v1/decl/parse", json={"decl": "agg Bad ??? poisson"})
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["line"] == 1
    assert detail["column"] > 0
    assert detail["caret"]
    assert "?" in detail["message"]
    assert detail["statement_index"] == 0


def test_the_error_shape_matches_the_one_post_objects_returns(client):
    """Same keys as the build route's 422, with the statement index added.

    A client that already handles one parse error handles both. Verified
    against the other route rather than against a remembered key list, so a
    library change to ``ErrorReport`` cannot quietly split the two shapes.
    """
    bad = "agg Bad ??? poisson"
    parse = client.post("/v1/decl/parse", json={"decl": bad})
    build = client.post("/v1/objects", json={"decl": bad, "log2": 10})
    assert parse.status_code == 422 and build.status_code == 422, build.text
    parse_keys = set(parse.json()["detail"])
    build_keys = set(build.json()["detail"])
    assert parse_keys - build_keys == {"statement_index"}
    assert build_keys - parse_keys == set()


def test_the_failing_statements_index_travels_with_the_error(client):
    """The second statement failing reports index 1, not 0."""
    r = client.post("/v1/decl/parse", json={"decl": (
        "agg Good 100 claims sev lognorm 50 cv 1 poisson\n"
        "\n"
        "agg Bad ??? poisson"
    )})
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["statement_index"] == 1
    # ``source`` is the failing statement, because that is what the column and
    # the caret are measured against.
    assert detail["source"].startswith("agg Bad")


def test_a_forward_reference_between_statements_does_not_parse(client):
    """Each statement resolves against the default underwriter alone.

    Documented on the route because it surprises: a ``sev`` a program declares
    is not in scope for the ``agg`` that follows it, since nothing feeds the
    first statement's result back into the second's namespace. The same
    limitation ``_every_statement_parses`` records for Reformat.
    """
    r = client.post("/v1/decl/parse", json={"decl": (
        "sev P.MySev lognorm 50 cv 1.5\n"
        "\n"
        "agg P.Uses 100 claims 1000 xs 0 sev.P.MySev poisson"
    )})
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["statement_index"] == 1


def test_parsing_creates_no_object(client):
    """No cache entry, so the object list is unchanged across a parse call."""
    before = client.get("/v1/objects")
    assert before.status_code == 200
    assert _parse(client, XPNL)
    after = client.get("/v1/objects")
    assert after.status_code == 200
    assert after.json() == before.json()


def test_reformat_still_echoes_a_malformed_program_unchanged(client):
    """The a137 promise, which the shared helper must not have disturbed.

    ``_every_statement_parses`` is now expressed in terms of the same helper
    the parse route uses. Its job is unchanged: a program the writer cannot
    read comes back as the text that was sent, not as its preprocessed copy
    with every line break folded into a space.
    """
    spread = (
        "sev P.MySev lognorm 50 cv 1.5\n"
        "\n"
        "agg P.Uses 100 claims\n"
        "    1000 xs 0\n"
        "    sev.P.MySev\n"
        "    poisson"
    )
    r = client.post("/v1/decl/format", json={"decl": spread})
    assert r.status_code == 200, r.text
    assert r.json()["decl"] == spread


@requires_nttagg
def test_exact_probabilities_serialize_as_the_fractions_they_are(client):
    """An ``nttagg``'s probabilities go out as ``"1/4"``, and that is intended.

    The kind reads its inputs text-exactly: ``0.3`` is the rational 3/10, not
    the nearest double, which is the whole point of computing over prime fields.
    The spec therefore carries ``Fraction`` objects, and ``_spec_value`` has no
    branch for them, so they fall through to the final ``str``.

    That fallback is load bearing rather than accidental, which is why this test
    exists: ``str(Fraction(1, 4))`` is ``"1/4"``, exact and the spelling the
    grammar itself accepts, so the value round-trips back into a program.
    Coercing to ``float`` would throw away the exactness the kind exists for.
    Same reasoning as the unlimited layer going out as ``"inf"``.

    Note the ``dsev`` weights: ``0.3 0.5 0.2`` is written as decimals and comes
    back as thirds and fifths, which is the text-exact reading made visible.
    """
    decl = ("nttagg X.Exact dfreq [0 1 2] [1/4 1/2 1/4] "
            "dsev [1 2 10] [0.3 0.5 0.2]")
    statements = _parse(client, decl)
    assert len(statements) == 1
    one = statements[0]
    assert one["kind"] == "nttagg"
    assert one["name"] == "X.Exact"
    spec = one["spec"]
    assert spec["ntt_freq_outcomes"] == [0, 1, 2]
    assert spec["ntt_freq_probs"] == ["1/4", "1/2", "1/4"]
    assert spec["ntt_sev_outcomes"] == [1, 2, 10]
    assert spec["ntt_sev_probs"] == ["3/10", "1/2", "1/5"]
    # JSON-native throughout, which is the route's promise.
    json.dumps(one)
