"""Several DecL statements in one program, and the library's parse rule.

``POST /v1/objects`` parses a program the way ``Underwriter.build_many`` does: a
blank line or a line-final ``;`` separates statements, and nothing else does.
The statements before the last are filed in the caller's session and only the
last is built. See ``dev/done/plan-multi-statement-programs.md``.

Every program uses names absent from the library. ``sev.Capstone.Sev`` is a
library entry, so a test built on it would pass with the prelude ignored.
"""

from __future__ import annotations

import re
import sqlite3

import pytest
from aggregate import build
from aggregate.parser import UnderwritingLexer

from aggregate_api.routes.objects import collapse_program, split_program

from .test_loss_table_files import (  # noqa: F401 (fixtures)
    OUTSIDE, PRIVATE, REFUSAL, elt_file, lan_client,
)
from .test_objects import requires_named_laws, requires_stable_arithmetic

SESSION = "X-Aggregate-Session"
SEV = "sev MsSev lognorm 10 cv 1"
AGG = "agg MsAgg 5 claims sev.MsSev poisson"
OTHER = "agg MsOther 3 claims sev lognorm 20 cv 1 poisson"
BACKSLASH = chr(92)


def _post(client, session, decl, **opts):
    """POST a build as ``session`` on a small grid, returning the response."""
    return client.post("/v1/objects", json={"decl": decl, "log2": 8, **opts},
                       headers={SESSION: session})


def _filed(client, session):
    """The ``agg`` form of the session's download."""
    return client.get("/v1/session/models.agg?form=agg",
                      headers={SESSION: session}).text


def _audit_rows(tmp_path):
    """Every audit row, oldest first, as ``(status, decl)``."""
    return sqlite3.connect(tmp_path / "audit.db").execute(
        "SELECT status, decl FROM builds ORDER BY rowid").fetchall()


# ----------------------------------------------------------------------
# [route-split] Split, file the prelude, build the last statement
# ----------------------------------------------------------------------

def test_a_program_means_the_same_as_its_statements_one_at_a_time(client):
    together = _post(client, "ms-together", f"{SEV}\n\n{AGG}")
    assert together.status_code == 200, together.text
    assert together.json()["kind"] == "agg"
    assert _post(client, "ms-apart", SEV).status_code == 200
    apart = _post(client, "ms-apart", AGG)
    assert apart.status_code == 200, apart.text
    assert together.json()["id"] == apart.json()["id"]


def test_a_line_final_semicolon_separates_like_a_blank_line(client):
    blank = _post(client, "ms-blank", f"{SEV}\n\n{AGG}").json()
    semi = _post(client, "ms-semi", f"{SEV};\n{AGG};").json()
    assert semi["id"] == blank["id"]


def test_an_unrelated_prelude_edit_is_a_cache_hit(client):
    first = _post(client, "ms-edit", f"sev MsUnused lognorm 1 cv 1\n\n{OTHER}").json()
    second = _post(client, "ms-edit", f"sev MsUnused lognorm 2 cv 1\n\n{OTHER}").json()
    assert second["id"] == first["id"]
    assert second["cached"] is True


def test_an_edit_to_a_used_prelude_statement_is_a_new_id(client):
    first = _post(client, "ms-edit", f"{SEV}\n\n{AGG}").json()
    second = _post(client, "ms-edit",
                   f"sev MsSev lognorm 11 cv 1\n\n{AGG}").json()
    assert second["id"] != first["id"]


def test_a_change_to_a_deferred_referent_is_a_new_id(client):
    last = "agg MsOut 3 claims sev agg.MsIn poisson"
    first = _post(
        client, "ms-defer",
        f"agg MsIn 2 claims sev lognorm 10 cv 1 poisson hints{{log2=8; bs=1/4}}\n\n{last}")
    assert first.status_code == 200, first.text
    second = _post(
        client, "ms-defer",
        f"agg MsIn 2 claims sev lognorm 12 cv 1 poisson hints{{log2=8; bs=1/4}}\n\n{last}")
    assert second.status_code == 200, second.text
    assert second.json()["id"] != first.json()["id"]


def test_an_unreferenced_statement_that_cannot_build_goes_unnoticed(client):
    """The accepted consequence (author, 2026-10-30): parsed and never built."""
    r = _post(client, "ms-bad",
              f"agg MsBad 1 claim sev lognorm 1 cv -2 poisson\n\n{OTHER}")
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "MsOther"


@requires_stable_arithmetic
def test_stable_law_arithmetic_as_the_last_statement_is_text(client):
    r = _post(client, "ms-stable",
              "stable x1 1.3 0;\nstable x2 1.3 1;\nstable.x1 + stable.x2;")
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "text"
    assert "1.70436" in r.json()["text"]


@requires_named_laws
def test_a_named_law_in_the_prelude_stays_in_the_session(client):
    assert _post(client, "ms-law", f"stable x3 1.3 0\n\n{OTHER}").status_code == 200
    assert _post(client, "ms-law", "stable.x3").json()["kind"] == "text"


def test_a_number_as_the_last_statement_is_a_value(client):
    r = _post(client, "ms-value", f"{SEV}\n\n(2+2)")
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "value"
    assert r.json()["value"] == 4.0
    assert r.json()["decl"] == "(2+2)"


@pytest.mark.parametrize("last", ["MsNamed", "agg.MsNamed"])
def test_a_name_as_the_last_statement_builds(client, last):
    r = _post(client, "ms-name",
              f"agg MsNamed 2 claims sev lognorm 10 cv 1 poisson\n\n{last}")
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "MsNamed"


def test_a_later_single_statement_can_refer_to_the_prelude(client):
    assert _post(client, "ms-later", f"{SEV}\n\n{OTHER}").status_code == 200
    assert "MsSev" in _filed(client, "ms-later")
    assert _post(client, "ms-later", AGG).status_code == 200


def test_the_entry_and_response_hold_the_last_statement(client):
    r = _post(client, "ms-last", f"{SEV}\n\n{AGG}").json()
    got = client.get(f"/v1/objects/{r['id']}", headers={SESSION: "ms-last"})
    assert got.status_code == 200, got.text
    assert got.json()["decl"] == AGG


@pytest.mark.parametrize("second, kind", [
    ("agg MsBad ??? poisson", "parse"),
    ("agg MsBad 2 claims sev.MsNoSuchName poisson", "missing"),
    ("distortion MsBad nonsense 1", "plain"),
])
def test_a_failure_in_statement_two_files_nothing(client, second, kind):
    r = _post(client, "ms-fail", f"{SEV}\n\n{second}\n\n{OTHER}")
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    if kind == "plain":
        assert isinstance(detail, str) and detail.startswith("statement 2: ")
    else:
        assert detail["statement_index"] == 1
    if kind == "parse":
        assert detail["source"].startswith("agg MsBad")
    assert "MsSev" not in _filed(client, "ms-fail")
    assert _post(client, "ms-fail", AGG).status_code == 422


def test_twelve_statements_build_and_thirteen_are_refused(client, tmp_path):
    prelude = [f"sev MsS{i} lognorm 10 cv 1" for i in range(11)]
    twelve = "\n\n".join([*prelude, OTHER])
    assert _post(client, "ms-twelve", twelve).status_code == 200
    thirteen = "\n\n".join(["sev MsExtra lognorm 1 cv 1", *prelude, OTHER])
    r = _post(client, "ms-thirteen", thirteen)
    assert r.status_code == 422, r.text
    assert "13" in r.json()["detail"] and "12" in r.json()["detail"]
    assert _audit_rows(tmp_path)[-1][0] == "limit_exceeded"
    assert "MsExtra" not in _filed(client, "ms-thirteen")


def test_the_limit_comes_from_the_setting(client, monkeypatch):
    from aggregate_api.config import get_settings
    monkeypatch.setattr(get_settings(), "max_statements", 2)
    r = _post(client, "ms-limit", f"{SEV}\n\n{SEV}\n\n{OTHER}")
    assert r.status_code == 422
    assert "AGGAPI_MAX_STATEMENTS" in r.json()["detail"]


def test_the_log2_cap_covers_the_prelude(client, tmp_path):
    """A prelude hint would otherwise reach a build through ``sev agg.NAME``."""
    r = _post(client, "ms-cap",
              "agg MsHuge 2 claims sev lognorm 10 cv 1 poisson hints{log2=25; bs=1/4}"
              "\n\nagg MsOut 3 claims sev agg.MsHuge poisson")
    assert r.status_code == 422, r.text
    assert "log2 25" in r.json()["detail"]
    assert _audit_rows(tmp_path)[-1][0] == "limit_exceeded"
    assert "MsHuge" not in _filed(client, "ms-cap")


def test_a_prelude_reaching_a_file_is_refused_from_outside(lan_client, elt_file):  # noqa: F811
    session = {SESSION: "ms-file"}
    built = lan_client.post(
        "/v1/objects",
        json={"decl": f'agg MsFile elt "{elt_file}" hints{{log2=8; bs=1}}', "log2": 8},
        headers={**session, **PRIVATE})
    assert built.status_code == 200, built.text
    r = lan_client.post(
        "/v1/objects",
        json={"decl": f"port MsBook agg.MsFile\n\n{OTHER}", "log2": 8},
        headers={**session, **OUTSIDE})
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == REFUSAL
    filed = lan_client.get("/v1/session/models.agg?form=agg",
                           headers={**session, **PRIVATE}).text
    assert "MsBook" not in filed


def test_the_prelude_has_its_own_audit_row(client, tmp_path):
    assert _post(client, "ms-audit", f"{SEV}\n\n{AGG}").status_code == 200
    rows = _audit_rows(tmp_path)
    assert ("declared", SEV) in rows
    assert sum(1 for status, _ in rows if status == "declared") == 1


def test_a_client_that_builds_one_at_a_time_is_refused(client):
    r = _post(client, "ms-sheet", f"{SEV}\n\n{AGG}", library_references_only=True)
    assert r.status_code == 422, r.text
    assert "one statement at a time" in r.json()["detail"]
    assert "holds 2" in r.json()["detail"]
    assert "MsSev" not in _filed(client, "ms-sheet")


# ----------------------------------------------------------------------
# [strict-parse] What the library refuses, the route refuses
# ----------------------------------------------------------------------

ONE = "agg MsOne 5 claims sev lognorm 10 cv 1 poisson"

REFUSED = {
    "blank line inside one statement": (
        "agg MsOne 5 claims\n\nsev lognorm 10 cv 1 poisson", 0),
    "blank line before note": (f"{ONE}\n\nnote{{x}}", 1),
    "blank line inside a note body": (f"{ONE} note{{a\n\nb}}", 0),
    "port then blank line": (f"port MsP\n\n{ONE}", 0),
    "backslash then newline": (
        f"agg MsOne 5 claims {BACKSLASH}\n sev lognorm 10 cv 1 poisson", None),
    "backslash in mid-line": (
        f"agg MsOne 5 claims {BACKSLASH} sev lognorm 10 cv 1 poisson", None),
}


@pytest.mark.parametrize("decl, index", REFUSED.values(), ids=REFUSED.keys())
def test_text_the_library_refuses_is_refused(client, decl, index):
    with pytest.raises(ValueError):
        build.fork()(decl, log2=8)
    r = _post(client, "ms-strict", decl)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    if index is None:
        assert "statement_index" not in detail
    else:
        assert detail["statement_index"] == index


@pytest.mark.parametrize("decl, index", REFUSED.values(), ids=REFUSED.keys())
def test_the_same_forms_are_refused_for_every_client(client, decl, index):
    """A form that splits gets the one-at-a-time message, and the rest a parse error."""
    r = _post(client, "ms-strict-sheet", decl, library_references_only=True)
    assert r.status_code == 422, r.text
    if index is not None:
        assert "one statement at a time" in r.json()["detail"]


def test_a_backslash_in_a_note_survives(client):
    note = f"see {BACKSLASH}alpha here"
    decl = f"{ONE} note{{{note}}}"
    assert build.fork()(decl, log2=8).note == note
    r = _post(client, "ms-note", decl)
    assert r.status_code == 200, r.text
    assert r.json()["note"] == note


def test_an_unbalanced_bracket_is_a_422_not_a_500(client, tmp_path):
    decl = "agg MsOne 5 claims dsev [1 2 poisson"
    with pytest.raises(AssertionError):
        build.fork()(decl, log2=8)
    r = _post(client, "ms-bracket", decl)
    assert r.status_code == 422, r.text
    assert "unbalanced" in r.json()["detail"]
    assert _audit_rows(tmp_path)[-1][0] == "parse_error"


@pytest.mark.parametrize("decl", [
    f"# a comment\n{ONE}",
    f"{ONE}  // beside",
    "agg MsOne\n  5 claims\n  sev lognorm 10 cv 1\n  poisson",
    "agg MsOne\r\n  5 claims\r\n  sev lognorm 10 cv 1\r\n  poisson\r\n",
    f"{ONE};",
    f"{ONE}   ;\n",
    ONE.replace(" ", "\t", 1),
])
def test_a_single_statement_keeps_its_id(client, decl):
    plain = _post(client, "ms-same", ONE).json()
    r = _post(client, "ms-same", decl)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == plain["id"]
    assert r.json()["cached"] is True


@pytest.mark.parametrize("decl", [
    ONE,
    f"# a comment\n{ONE}",
    "agg MsOne\n  5 claims\n  sev lognorm 10 cv 1\n  poisson",
    "agg MsOne   5   claims\tsev lognorm 10 cv 1 poisson",
    f"{ONE} note{{a # hash, and   three spaces}}",
    "port MsP\n  agg A 1 claim sev lognorm 1 cv 1 fixed\n  agg B 1 claim dsev [1 2] fixed",
    "agg MsOne 5 claims dsev [1 2\n\n3] poisson",
])
def test_one_statement_is_byte_identical_to_the_old_fold(decl):
    """Every existing cache id depends on this, for a program with no backslash."""
    old_fold = re.sub(r"\s+", " ",
                      " ".join(UnderwritingLexer.preprocess(decl))).strip()
    assert split_program(decl) == [old_fold]
    assert collapse_program(decl) == old_fold


def test_a_blank_line_inside_brackets_still_builds(client):
    r = _post(client, "ms-vector", "agg MsVec 5 claims dsev [1 2\n\n3] poisson")
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "MsVec"


def test_collapse_never_joins_statements():
    assert collapse_program("# only a comment") == ""
    assert collapse_program(ONE) == ONE
    with pytest.raises(ValueError, match="holds 2"):
        collapse_program(f"{SEV}\n\n{AGG}")
    with pytest.raises(ValueError, match="unbalanced"):
        collapse_program("agg MsOne 5 claims dsev [1 2 poisson")


@pytest.mark.parametrize("fragment", [
    f"agg MsFrag 5 claims {BACKSLASH} sev lognorm 10 cv 1 poisson",
    f"{OTHER}\n\nagg MsFrag 5 claims sev lognorm 10 cv 1 poisson",
    "agg MsFrag 5 claims dsev [1 2 poisson",
])
def test_a_bounds_fragment_follows_the_rule_and_files_nothing(client, fragment):
    built = _post(client, "ms-bounds", ONE).json()
    r = client.post(f"/v1/objects/{built['id']}/bounds/pricing",
                    json={"premium": 1000.0, "against": [fragment]},
                    headers={SESSION: "ms-bounds"})
    assert r.status_code == 422, r.text
    assert "MsFrag" not in _filed(client, "ms-bounds")


# ----------------------------------------------------------------------
# [statement-count] and [reformat-refuse]
# ----------------------------------------------------------------------

@pytest.mark.parametrize("decl, count", [
    ("# only a comment", 0),
    ("agg MsOne\n  5 claims\n  sev lognorm 10 cv 1\n  poisson", 1),
    ("agg MsOne 5 claims dsev [1 2\n\n3] poisson", 1),
    (f"{SEV};\n{AGG}", 2),
    (f"{SEV}\n\n{AGG}", 2),
    ("agg MsOne 5 claims dsev [1 2 poisson", 1),
])
def test_the_statement_count_route(client, decl, count):
    r = client.post("/v1/decl/statements", json={"decl": decl})
    assert r.status_code == 200, r.text
    assert r.json() == {"statements": count}


def test_counting_files_nothing_and_leaves_no_trace(client, tmp_path):
    before = client.get("/v1/objects").json()
    client.post("/v1/decl/statements", json={"decl": f"{SEV}\n\n{AGG}"},
                headers={SESSION: "ms-count"})
    assert "MsSev" not in _filed(client, "ms-count")
    assert client.get("/v1/objects").json() == before
    db = tmp_path / "audit.db"
    assert not db.exists() or _audit_rows(tmp_path) == []


def _format(client, session, decl):
    r = client.post("/v1/decl/format", json={"decl": decl},
                    headers={SESSION: session})
    assert r.status_code == 200, r.text
    return r.json()["decl"]


@pytest.mark.parametrize("decl", [
    f"{SEV}\n\n{AGG}",
    f"{SEV};\n{AGG};",
    "stable x1 1.3 0;\nstable x2 1.3 1;\nstable.x1 + stable.x2;",
    "agg MsOne 5 claims dsev [1 2 poisson",
])
def test_format_echoes_several_statements_byte_for_byte(client, decl):
    assert _format(client, "ms-format", decl) == decl


def test_format_of_one_statement_is_unchanged(client):
    out = _format(client, "ms-format-one", ONE)
    assert out.startswith("agg MsOne\n")
    assert "lognorm 10 cv 1" in out
