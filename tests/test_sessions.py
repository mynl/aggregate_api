"""One recipe base per session: the fork registry and the cache-key rule.

The matrix in section 7 of ``dev/plan-session-isolation.md``, plus the
concurrency pins that section asks for. Sessions ``x``, ``y`` and ``z`` work
against a fixture library holding ``FixtureSeverity`` and ``FixtureAggregate``,
which inlines it. The deferred ``sev agg.NAME`` form is exercised over session
entries rather than library ones, because that is the case where the two
sessions' answers differ. ``z`` overwrites a library name before it builds,
which by the author's ruling makes that name a session entry in ``z``'s fork and
nobody else's.

What is being asserted, in one sentence: two programs share a built object when
and only when they mean the same thing to everybody.
"""

from __future__ import annotations

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from aggregate_api.sessions import ANONYMOUS, SessionRegistry, normalize_session_id

# ``FixtureAggregate`` pins its grid because a ``sev agg.NAME`` reference to it
# needs that: the reference stands for the distribution the declaration outputs,
# so the declaration has to say at what resolution or the library refuses.
FIXTURE_LIBRARY = """
sev FixtureSeverity 100 * expon
  tags{topic:severity};

agg FixtureAggregate
  5 claims
  sev.FixtureSeverity
  poisson
  hints{log2=12; bs=1}
  tags{topic:aggregate};
"""

SEV = "X-Aggregate-Session"


@pytest.fixture
def library_client(tmp_path, monkeypatch):
    """A client over the fixture library, with a live session registry."""
    path = tmp_path / "fixture.agg"
    path.write_text(FIXTURE_LIBRARY, encoding="utf-8")
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "20")
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")
    monkeypatch.setenv("AGGAPI_LIBRARY", str(path))

    from aggregate_api.app import create_app
    from aggregate_api.examples import load_examples, load_hero_sparklines, load_heroes

    load_examples.cache_clear()
    load_heroes.cache_clear()
    load_hero_sparklines.cache_clear()
    app = create_app()
    with TestClient(app) as client_obj:
        yield client_obj
    load_examples.cache_clear()
    load_heroes.cache_clear()
    load_hero_sparklines.cache_clear()


def build(client, session, decl, **opts):
    """POST a build as ``session`` and return the parsed body."""
    body = {"decl": decl, "log2": 12, **opts}
    r = client.post("/v1/objects", json=body, headers={SEV: session})
    assert r.status_code == 200, r.json()
    return r.json()


def scope_of(client, decl):
    """The ``key_scope`` the audit recorded for the most recent build of ``decl``."""
    from aggregate_api.routes.objects import _get_audit
    from aggregate_api.config import get_settings

    audit = _get_audit(get_settings())
    for row in audit.recent(50):
        if row["decl"] == decl:
            return row["key_scope"]
    raise AssertionError(f"no audit row for {decl!r}")


# ----------------------------------------------------------------------
# The id itself
# ----------------------------------------------------------------------

def test_a_minted_id_survives_normalization():
    """The shape the SPA mints is accepted verbatim, whitespace aside."""
    minted = "2026-08-18T09:15:00.123Z-2f1c8a4e-7b3d-4c9a-8e1f-6d5b4a3c2e10"
    assert normalize_session_id(minted) == minted
    assert normalize_session_id(f"  {minted} ") == minted


@pytest.mark.parametrize("raw", [
    None,
    "",
    "   ",
    "short",                       # under the length floor
    "has spaces in it and more",   # charset
    "semi;colon-injection-attempt-aaaaaaaa",
    "x" * 201,                     # over the length ceiling
])
def test_an_unusable_id_reads_as_no_id_at_all(raw):
    """Not a 400. An id is the client's own invention, so there is nothing to
    tell it that it could act on, and refusing would break every headerless
    caller the anonymous fallback exists for."""
    assert normalize_session_id(raw) == ANONYMOUS


# ----------------------------------------------------------------------
# The registry
# ----------------------------------------------------------------------

def test_one_fork_per_id_and_isolation_runs_both_ways():
    """The property the whole phase rests on."""
    from aggregate import build as parent

    parent.load()
    registry = SessionRegistry()
    a = registry.underwriter("session-aaaaaaaa", parent)
    b = registry.underwriter("session-bbbbbbbb", parent)
    assert a is not b
    assert registry.underwriter("session-aaaaaaaa", parent) is a
    assert len(registry) == 2

    a("agg SessionOnlyMine 3 claims sev lognorm 10 cv 1 poisson", log2=10)
    assert ("agg", "SessionOnlyMine") in a._recipes
    assert ("agg", "SessionOnlyMine") not in b._recipes
    assert ("agg", "SessionOnlyMine") not in parent._recipes

    b("agg SessionOnlyYours 3 claims sev lognorm 10 cv 1 poisson", log2=10)
    assert ("agg", "SessionOnlyYours") not in a._recipes
    assert ("agg", "SessionOnlyYours") not in parent._recipes


def test_a_fork_costs_microseconds():
    """The number the design rests on. Generous bound: the plan measured about
    6 microseconds and this asserts under a millisecond, which is still three
    orders off the 3.2 seconds a fresh load costs."""
    from aggregate import build as parent

    parent.load()
    registry = SessionRegistry()
    t0 = time.perf_counter()
    for i in range(100):
        registry.underwriter(f"session-{i:08d}", parent)
    per_fork = (time.perf_counter() - t0) / 100
    assert per_fork < 1e-3, per_fork


def test_the_registry_evicts_the_least_recently_used():
    from aggregate import build as parent

    parent.load()
    registry = SessionRegistry(max_sessions=2)
    registry.underwriter("session-aaaaaaaa", parent)
    registry.underwriter("session-bbbbbbbb", parent)
    # Touch a, so b is the least recently used when c arrives.
    registry.underwriter("session-aaaaaaaa", parent)
    registry.underwriter("session-cccccccc", parent)
    assert registry.ids() == ["session-aaaaaaaa", "session-cccccccc"]
    assert registry.forks_dropped == 1


def test_an_idle_fork_expires():
    """Expiry is read on access rather than run on a timer thread."""
    from aggregate import build as parent

    parent.load()
    registry = SessionRegistry(ttl_s=0.05)
    first = registry.underwriter("session-aaaaaaaa", parent)
    time.sleep(0.12)
    second = registry.underwriter("session-aaaaaaaa", parent)
    assert second is not first
    assert registry.forks_dropped >= 1


def test_concurrent_first_requests_from_one_session_share_a_fork():
    """The plan's registry-contention pin: N threads, mixed ids, one fork each.

    Two requests from one session arriving together must not each get a fork,
    or the second silently starts from a base the first has already written to.
    """
    from aggregate import build as parent

    parent.load()
    registry = SessionRegistry()
    ids = [f"session-{i:08d}" for i in range(8)]
    got: dict[str, list] = {i: [] for i in ids}
    lock = threading.Lock()
    barrier = threading.Barrier(len(ids) * 4)

    def worker(session_id):
        barrier.wait()
        fork = registry.underwriter(session_id, parent)
        with lock:
            got[session_id].append(fork)

    threads = [threading.Thread(target=worker, args=(sid,))
               for sid in ids for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(registry) == len(ids)
    for session_id, forks in got.items():
        assert len(forks) == 4
        assert all(f is forks[0] for f in forks), session_id


def test_previews_run_concurrently_and_agree_with_serial_ones():
    """The plan's threaded parse hammer.

    The route order moves parsing outside the single build slot for the first
    time, so previews now really do run at once against the module-level Lark
    singleton. Per-call state is clean by construction (a fresh transformer per
    parse, a private cycle guard), and this is the pin that says so.
    """
    from aggregate import build as parent

    parent.load()
    programs = [f"agg Hammer{i} {i + 1} claims sev lognorm 10 cv 1 poisson"
                for i in range(16)]
    serial = [parent.preview(p).statements[0].name for p in programs]

    out: dict[int, str] = {}
    lock = threading.Lock()
    barrier = threading.Barrier(len(programs))

    def worker(i):
        barrier.wait()
        name = parent.preview(programs[i]).statements[0].name
        with lock:
            out[i] = name

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(len(programs))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert [out[i] for i in range(len(programs))] == serial


# ----------------------------------------------------------------------
# The cache-key matrix
# ----------------------------------------------------------------------

def test_a_self_contained_program_is_built_once_for_the_room(library_client):
    """x and y type the same hero example: one build, and y is told so."""
    decl = "agg Hero 7 claims sev lognorm 50 cv 1.5 poisson"
    first = build(library_client, "session-xxxxxxxx", decl)
    second = build(library_client, "session-yyyyyyyy", decl)
    assert first["cached"] is False
    assert second["cached"] is True
    assert first["id"] == second["id"]
    assert scope_of(library_client, decl) == "shared"


def test_a_program_leaning_on_the_library_still_shares(library_client):
    """A library entry is byte-identical in every fork, so a program that
    resolves one still means the same thing to everybody."""
    decl = "agg Leaner 4 claims sev.FixtureSeverity poisson"
    first = build(library_client, "session-xxxxxxxx", decl)
    second = build(library_client, "session-yyyyyyyy", decl)
    assert second["cached"] is True
    assert first["id"] == second["id"]
    assert scope_of(library_client, decl) == "shared"


def test_alice_and_bob(library_client):
    """The case the plan opens with, end to end.

    Identical outer text over different inners. Under a text-keyed cache Bob is
    served Alice's answer, silently and wrongly; both must get their own.
    """
    outer = "port Book agg.Line"
    alice_inner = "agg Line 10 claims sev lognorm 100 cv 1 poisson"
    bob_inner = "agg Line 10 claims sev lognorm 1000 cv 3 poisson"

    build(library_client, "session-alicealice", alice_inner)
    alice = build(library_client, "session-alicealice", outer)
    build(library_client, "session-bobbobbobbo", bob_inner)
    bob = build(library_client, "session-bobbobbobbo", outer)

    assert alice["id"] != bob["id"]
    assert bob["cached"] is False
    assert scope_of(library_client, outer) == "session"
    # And the answers really differ: same program, different severity.
    assert alice["mean"] != pytest.approx(bob["mean"], rel=1e-6)


def test_overwriting_a_library_name_makes_it_a_session_name(library_client):
    """The author's ruling 10, which is where a lexical rule would go wrong.

    ``z`` builds its own ``FixtureSeverity`` over the library's. Registration is
    last-write-wins by ``(kind, name)`` inside ``z``'s fork, so from then on a
    program of ``z``'s that names it is private, while the same text from ``x``
    still shares.
    """
    decl = "agg Leaner 4 claims sev.FixtureSeverity poisson"
    shared = build(library_client, "session-xxxxxxxx", decl)

    build(library_client, "session-zzzzzzzz", "sev FixtureSeverity 900 * expon")
    private = build(library_client, "session-zzzzzzzz", decl)

    assert private["id"] != shared["id"]
    assert private["cached"] is False
    assert scope_of(library_client, decl) == "session"
    assert private["mean"] != pytest.approx(shared["mean"], rel=1e-6)


def test_the_deferred_reference_form_qualifies_too(library_client):
    """``sev agg.NAME`` never inlines: it is resolved at build time and only
    checked for existence at parse time. The preview reports it anyway, which
    is the reason the rule reads the parse rather than the spec."""
    inner = "agg Pinned 5 claims sev lognorm 20 cv 1 poisson hints{log2=12; bs=1}"
    outer = "agg Wrapper 3 claims sev agg.Pinned poisson"

    build(library_client, "session-xxxxxxxx", inner)
    x_outer = build(library_client, "session-xxxxxxxx", outer)

    other_inner = "agg Pinned 5 claims sev lognorm 400 cv 2 poisson hints{log2=12; bs=8}"
    build(library_client, "session-yyyyyyyy", other_inner)
    y_outer = build(library_client, "session-yyyyyyyy", outer)

    assert x_outer["id"] != y_outer["id"]
    assert scope_of(library_client, outer) == "session"


def test_a_bare_library_name_shares_and_a_shadowed_one_does_not(library_client):
    """The one program shape that never reaches the parser.

    ``build('FixtureAggregate')`` is a recipe lookup, not a parse, which is the
    hole every lexical scan of the text would fall through. A bare name is a
    reference and answers to the same rule.
    """
    x = build(library_client, "session-xxxxxxxx", "FixtureAggregate")
    y = build(library_client, "session-yyyyyyyy", "FixtureAggregate")
    assert x["id"] == y["id"]
    assert y["cached"] is True
    assert scope_of(library_client, "FixtureAggregate") == "shared"

    build(library_client, "session-zzzzzzzz",
          "agg FixtureAggregate 5 claims sev lognorm 3000 cv 2 poisson")
    z = build(library_client, "session-zzzzzzzz", "FixtureAggregate")
    assert z["id"] != x["id"]
    assert scope_of(library_client, "FixtureAggregate") == "session"


def test_a_cache_hit_still_registers(library_client):
    """Ruling 9, and the test the plan says its first draft could not have caught.

    ``y`` is served ``x``'s object without parsing anything. Unless the hit
    registers, ``y``'s next reference to that name fails on an entry its own
    base never saw.
    """
    inner = "agg Registered 6 claims sev lognorm 30 cv 1 poisson hints{log2=12; bs=1}"
    build(library_client, "session-xxxxxxxx", inner)
    hit = build(library_client, "session-yyyyyyyy", inner)
    assert hit["cached"] is True

    # Both reference forms, from y's session, against a name y never built.
    inlined = build(library_client, "session-yyyyyyyy", "port YBook agg.Registered")
    assert inlined["kind"] == "port"
    deferred = build(library_client, "session-yyyyyyyy",
                     "agg YWrapper 2 claims sev agg.Registered poisson")
    assert deferred["kind"] == "agg"

    # And it is in y's download, which is the other half of "their own base".
    r = library_client.get("/v1/session/models.agg?form=agg",
                           headers={SEV: "session-yyyyyyyy"})
    assert "Registered" in r.text


def test_a_bare_name_route_does_not_refile_a_library_entry(library_client):
    """The registration exception that keeps the rule honest.

    Registering the bare-name route's single statement would mark a library
    entry as this session's, and every later program naming it would qualify
    for no reason. So x building ``FixtureAggregate`` by name leaves it shared
    for x's own next program too.
    """
    build(library_client, "session-xxxxxxxx", "FixtureAggregate")
    decl = "port XBook agg.FixtureAggregate"
    x = build(library_client, "session-xxxxxxxx", decl)
    y = build(library_client, "session-yyyyyyyy", decl)
    assert x["id"] == y["id"]
    assert scope_of(library_client, decl) == "shared"


def test_the_download_is_scoped_to_the_caller(library_client):
    """Each session's canonical export holds its own programs and no one else's."""
    build(library_client, "session-xxxxxxxx",
          "agg MineAlone 3 claims sev lognorm 11 cv 1 poisson")
    build(library_client, "session-yyyyyyyy",
          "agg YoursAlone 3 claims sev lognorm 12 cv 1 poisson")

    x = library_client.get("/v1/session/models.agg?form=agg",
                           headers={SEV: "session-xxxxxxxx"}).text
    y = library_client.get("/v1/session/models.agg?form=agg",
                           headers={SEV: "session-yyyyyyyy"}).text
    assert "MineAlone" in x and "YoursAlone" not in x
    assert "YoursAlone" in y and "MineAlone" not in y


def test_the_download_accepts_the_session_in_the_query_string(library_client):
    """A download is a navigation and cannot carry a header."""
    build(library_client, "session-xxxxxxxx",
          "agg ViaQuery 3 claims sev lognorm 13 cv 1 poisson")
    r = library_client.get(
        "/v1/session/models.agg?form=agg&session=session-xxxxxxxx")
    assert r.status_code == 200
    assert "ViaQuery" in r.text


def test_a_headerless_client_keeps_working(library_client):
    """``curl`` and the rest of this suite send no header and must not care."""
    r = library_client.post(
        "/v1/objects",
        json={"decl": "agg NoHeader 3 claims sev lognorm 14 cv 1 poisson", "log2": 12},
    )
    assert r.status_code == 200
    from aggregate_api.config import get_settings
    from aggregate_api.routes.objects import _get_audit

    row = next(r for r in _get_audit(get_settings()).recent(20)
               if "NoHeader" in r["decl"])
    assert row["session_id"] == ANONYMOUS


def test_a_derived_program_builds_in_the_callers_base(library_client):
    """The derivation routes hand their own fork to the build they trigger.

    Hints is the cheapest of the three to exercise, and the one whose whole
    point is turning an object into a referable name.
    """
    built = build(library_client, "session-xxxxxxxx",
                  "agg ToPin 4 claims sev lognorm 40 cv 1 poisson")
    r = library_client.post(f"/v1/objects/{built['id']}/hints",
                            headers={SEV: "session-xxxxxxxx"})
    assert r.status_code == 200, r.json()

    x = library_client.get("/v1/session/models.agg?form=agg",
                           headers={SEV: "session-xxxxxxxx"}).text
    y = library_client.get("/v1/session/models.agg?form=agg",
                           headers={SEV: "session-yyyyyyyy"}).text
    assert "ToPin" in x
    assert "ToPin" not in y


# ----------------------------------------------------------------------
# The expiry path, sharpen, and the pricing residue
# ----------------------------------------------------------------------

def test_an_unresolvable_reference_names_the_missing_entry(library_client):
    """The expiry shape, reached the short way: a name nobody built.

    Structured rather than a sentence, because the app acts on it: naming the
    ``kind`` and the ``name`` is what lets the error pane find the program that
    declared it in history and offer the rebuild.
    """
    r = library_client.post(
        "/v1/objects",
        json={"decl": "port Ghost agg.NeverBuilt", "log2": 12},
        headers={SEV: "session-xxxxxxxx"},
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error"] == "recipe_not_found"
    assert detail["kind"] == "agg"
    assert detail["name"] == "NeverBuilt"
    assert "NeverBuilt" in detail["message"]


def test_an_evicted_fork_reports_the_entry_it_lost(library_client):
    """The real expiry case, not a typo: the session outlived its own base.

    A browser's session id survives a server restart and a registry eviction;
    the fork does not. So a program referring to something this session built is
    suddenly a program referring to nothing, and the answer has to say which
    name went and not merely that the program failed.
    """
    from aggregate_api.routes.objects import _get_sessions
    from aggregate_api.config import get_settings

    session = "session-evictedone"
    build(library_client, session,
          "agg WillBeLost 4 claims sev lognorm 60 cv 1 poisson")
    referring = "port LostBook agg.WillBeLost"
    assert build(library_client, session, referring)["kind"] == "port"

    # Drop this session's fork, exactly as the TTL or the LRU would.
    assert _get_sessions(get_settings()).drop(session)

    r = library_client.post("/v1/objects", json={"decl": referring, "log2": 12},
                            headers={SEV: session})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error"] == "recipe_not_found"
    assert (detail["kind"], detail["name"]) == ("agg", "WillBeLost")


def test_the_menu_survives_a_session_overwriting_a_library_name(library_client):
    """Why the Examples menu reads the process base and not a fork.

    ``_library_only`` drops ``source='session'`` rows, and overwriting a library
    name marks it session-sourced in that user's fork. A menu built from the
    fork would therefore lose the entry the reader was looking for. Reading the
    parent keeps the menu a view of the library, which is the same for everyone.
    """
    build(library_client, "session-zzzzzzzz", "sev FixtureSeverity 900 * expon")
    r = library_client.get("/v1/examples", headers={SEV: "session-zzzzzzzz"})
    assert r.status_code == 200
    names = {item["name"] for cat in r.json()["categories"] for item in cat["items"]}
    assert "FixtureSeverity" in names


def test_sharpen_leaves_the_shared_entry_alone(library_client):
    """Ruling 12. One object, two viewers, one of them sharpens.

    Before a111 the probe moved the cached object and re-filed it, so the other
    viewer's grid changed underneath them and their id stopped resolving. Both
    have to survive: the original id still serves, and the object it serves is
    still on the grid it was built on.
    """
    decl = "agg Shareable 10 claims sev lognorm 100 cv 1.5 poisson"
    x = build(library_client, "session-xxxxxxxx", decl)
    y = build(library_client, "session-yyyyyyyy", decl)
    assert x["id"] == y["id"], "the point of the test is that this is shared"

    r = library_client.post(f"/v1/objects/{x['id']}/sharpen", json={},
                            headers={SEV: "session-xxxxxxxx"})
    assert r.status_code == 200, r.text
    assert r.json()["id"] != x["id"]

    # y's id still resolves, and still resolves to the program it was built from.
    still = library_client.get(f"/v1/objects/{y['id']}",
                              headers={SEV: "session-yyyyyyyy"})
    assert still.status_code == 200
    assert still.json()["decl"] == decl

    # And the object under it has not been probed: no verdict on its own note,
    # the grid unmoved (the mean would shift), and it can still be sharpened.
    meta = library_client.get(f"/v1/objects/{x['id']}/meta",
                             headers={SEV: "session-yyyyyyyy"}).json()
    assert "sharpen" not in (meta["note"] or "")
    again = build(library_client, "session-yyyyyyyy", decl)
    assert again["id"] == x["id"] and again["cached"] is True
    assert again["mean"] == pytest.approx(y["mean"], rel=1e-12)
    assert again["capability"]["can_sharpen"] is True


def test_two_sessions_price_one_shared_object_independently(library_client):
    """Ruling 11: the pricing residue is accepted, and this is why it is safe.

    Calibration writes its fit onto the object, and the object is shared. What
    makes that harmless is that no route reads any of it back: every request
    recomputes from its own form. So a session's answer over the shared object
    must equal what it gets over a private one, whatever the other session did
    to it in between.
    """
    shared_decl = "port Priced agg PA 10 claims sev lognorm 100 cv 1.5 poisson"
    shared = build(library_client, "session-xxxxxxxx", shared_decl)
    also = build(library_client, "session-yyyyyyyy", shared_decl)
    assert shared["id"] == also["id"]

    def calibrate(session, coc):
        r = library_client.post(
            f"/v1/objects/{shared['id']}/pricing/calibrate",
            json={"p": 0.99, "coc": coc}, headers={SEV: session})
        assert r.status_code == 200, r.text
        return r.json()

    # x calibrates at one cost of capital, then y at another, then x again.
    x_first = calibrate("session-xxxxxxxx", 0.10)
    y_only = calibrate("session-yyyyyyyy", 0.25)
    x_again = calibrate("session-xxxxxxxx", 0.10)

    assert x_again == x_first, "x's answer moved when y priced the same object"
    assert y_only != x_first, "the two targets should not agree"

    # And y's answer over the shared object is what y gets over a private one.
    # The object name travels in the exhibit labels, and a private object needs a
    # different program to get a private key, so the name is normalized out
    # before the comparison. Everything else, every number included, must match.
    private_decl = shared_decl.replace("port Priced", "port PricedPrivate")
    private = build(library_client, "session-yyyyyyyy", private_decl)
    r = library_client.post(f"/v1/objects/{private['id']}/pricing/calibrate",
                            json={"p": 0.99, "coc": 0.25},
                            headers={SEV: "session-yyyyyyyy"})
    assert r.status_code == 200, r.text
    on_private = json.dumps(r.json()["exhibits"], sort_keys=True)
    assert on_private.replace("PricedPrivate", "Priced") ==         json.dumps(y_only["exhibits"], sort_keys=True)
