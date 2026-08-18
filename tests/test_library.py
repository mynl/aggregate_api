"""One recipe base per process: the ``--library`` / ``AGGAPI_LIBRARY`` setting.

Through a108 the setting pointed the Examples menu at a custom ``.agg`` while
every build path went on resolving against ``aggregate.build``, the shipped
singleton. Under the default library that split is invisible, because both names
reach the same object. Under a custom one it is a bug with two faces, and the
first test here is the one that fails on the old code: an entry is browsable in
the menu, and any program naming one of its siblings does not build, because the
base the parser resolves against never read the file.

The fixture library is deliberately two entries, the second referencing the
first, which is the smallest shape that can tell one base from two.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

# A severity, and an aggregate that reaches for it by name. The reference is
# resolved and inlined at parse time, so it is the parser's base that has to
# know ``FixtureSeverity``, not the caller's.
FIXTURE_LIBRARY = """
sev FixtureSeverity 100 * expon
  note{a severity for the fixture library}
  tags{topic:severity};

agg FixtureAggregate
  5 claims
  sev.FixtureSeverity
  poisson
  note{an aggregate that names its severity}
  tags{topic:aggregate};
"""


@pytest.fixture
def library_client(tmp_path, monkeypatch):
    """A client whose process reads the two-entry fixture library."""
    path = tmp_path / "fixture.agg"
    path.write_text(FIXTURE_LIBRARY, encoding="utf-8")
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "20")
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")
    monkeypatch.setenv("AGGAPI_LIBRARY", str(path))

    from aggregate_api.app import create_app
    from aggregate_api.examples import load_examples, load_hero_sparklines, load_heroes

    # The menu caches per grouping and the underwriter caches per process;
    # ``create_app`` clears the second, and these clear the first.
    load_examples.cache_clear()
    load_heroes.cache_clear()
    load_hero_sparklines.cache_clear()
    app = create_app()
    with TestClient(app) as client_obj:
        yield client_obj
    load_examples.cache_clear()
    load_heroes.cache_clear()
    load_hero_sparklines.cache_clear()


def test_a_program_may_reference_a_library_entry(library_client):
    """The regression this phase exists for. **This fails on a108.**

    A program that names ``sev.FixtureSeverity`` builds only if the base doing
    the parsing is the one that read the fixture file. On the old code the menu
    read it and the build path did not, so this came back 422 with the
    library's "no recipe named" message.
    """
    r = library_client.post(
        "/v1/objects",
        json={"decl": "agg Probe 3 claims sev.FixtureSeverity poisson", "log2": 12},
    )
    assert r.status_code == 200, r.json()
    assert r.json()["kind"] == "agg"


def test_a_library_entry_builds_by_its_bare_name(library_client):
    """The other door into the same base: lookup rather than parse.

    ``build('FixtureAggregate')`` tries a recipe lookup before it tries to
    parse, so a bare name reaches the base without going near the parser. Both
    doors have to open onto the same room.
    """
    r = library_client.post("/v1/objects", json={"decl": "FixtureAggregate", "log2": 12})
    assert r.status_code == 200, r.json()
    assert r.json()["name"] == "FixtureAggregate"


def test_the_menu_reads_the_same_library(library_client):
    """And the Examples menu shows those two entries and nothing else."""
    r = library_client.get("/v1/examples")
    assert r.status_code == 200
    names = {item["name"] for cat in r.json()["categories"] for item in cat["items"]}
    assert names == {"FixtureSeverity", "FixtureAggregate"}


def test_the_download_lists_the_same_base(library_client):
    """The canonical ``.agg`` export reads the base the builds registered into.

    A session entry only appears here if the build wrote it to the base this
    route reads. Under the old split it wrote to one and this read the other.
    """
    library_client.post(
        "/v1/objects",
        json={"decl": "agg Probe 3 claims sev.FixtureSeverity poisson", "log2": 12},
    )
    r = library_client.get("/v1/session/models.agg?form=agg")
    assert r.status_code == 200
    assert "Probe" in r.text


def test_a_missing_library_warns_and_falls_back(tmp_path, monkeypatch):
    """A stale setting on a server is not a reason to refuse every route.

    Deliberately unlike ``--library``, which exits; see
    :func:`aggregate_api.__main__.resolve_library` for the asymmetry.
    """
    from aggregate_api.config import get_settings
    from aggregate_api.library import get_underwriter

    monkeypatch.setenv("AGGAPI_LIBRARY", str(tmp_path / "nope.agg"))
    get_settings.cache_clear()
    get_underwriter.cache_clear()
    try:
        with pytest.warns(UserWarning, match="not found"):
            uw = get_underwriter()
        from aggregate import build

        assert uw is build
    finally:
        get_settings.cache_clear()
        get_underwriter.cache_clear()


def test_the_old_env_var_still_works_and_says_it_is_deprecated(tmp_path, monkeypatch):
    """``AGGAPI_EXAMPLES_FILE`` is accepted for one release.

    It stopped being about examples the moment it started feeding builds, so
    the name is wrong now. Keeping it for a release costs an alias; dropping it
    without notice would silently return a deploy to the shipped library.
    """
    from aggregate_api.config import Settings, get_settings

    path = tmp_path / "fixture.agg"
    path.write_text(FIXTURE_LIBRARY, encoding="utf-8")
    monkeypatch.delenv("AGGAPI_LIBRARY", raising=False)
    monkeypatch.setenv("AGGAPI_EXAMPLES_FILE", str(path))
    get_settings.cache_clear()
    try:
        with pytest.warns(DeprecationWarning, match="AGGAPI_EXAMPLES_FILE"):
            assert get_settings().library == str(path)
    finally:
        get_settings.cache_clear()

    # And the new name wins when both are set, without a warning to give.
    monkeypatch.setenv("AGGAPI_LIBRARY", "chosen.agg")
    assert Settings().library == "chosen.agg"
