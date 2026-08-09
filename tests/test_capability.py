"""The capability block: what an object can answer, derived not declared.

The build response carries this and the SPA paints its navigation from it, so a
wrong entry greys a leaf that works or lights one that 400s, and the user
cannot tell either from a leaf that genuinely does not apply. That is why these
run against one object of every kind the api builds rather than against a
representative one.

The strongest test here is :func:`test_capability_reproduces_the_retired_tables`.
The app used to carry two hand-written per-kind tables; deleting them is only
safe if the derived answer agrees with what they said, so the tables are
transcribed here and asserted against the library. Where the two disagree the
library wins, and the one disagreement found is asserted explicitly in
:func:`test_bivariate_serves_its_grid_sizing_frame`, because it was a bug in
this repo rather than a difference of opinion.
"""

from __future__ import annotations

import pytest

# One object of each kind the api builds, small enough to stay quick, plus an
# aggregate carrying a cession and a P&L walk, since both light exhibits their
# plain forms do not.
DECLS = {
    "agg": "agg CAP.Agg 10 claims sev lognorm 100 cv 1.5 poisson",
    "agg_reins": ("agg CAP.Reins 10 claims sev lognorm 100 cv 1.5 "
                  "occurrence net of 100 xs 100 poisson"),
    "port": ("port CAP.Port agg A 10 claims sev lognorm 100 cv 1.5 poisson "
             "agg B 5 claims sev gamma 50 cv 0.8 poisson"),
    "sev": "sev CAP.Sev lognorm 50 cv 1.5",
    "distortion": "distortion CAP.Dist dual 2",
    "bvagg": ("bivariate CAP.Bv 25 claims "
              "agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
              "agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 "
              "copula gumbel 0.4 poisson"),
    "pnl": ("pnl CAP.Pnl 1000 prem less "
            "agg CAP.PnlL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson"),
    "xpnl": ("xpnl CAP.Xpnl 1000 prem less "
             "agg CAP.XpnlL 1000 prem at 70% lr sev lognorm 100 cv 2 "
             "occurrence ceded to 500 xs 500 deposit 100 poisson"),
}


def _build(client, label):
    """Build one fixture and return its (id, build response body)."""
    r = client.post("/v1/objects", json={"decl": DECLS[label], "log2": 12})
    assert r.status_code == 200, f"{label}: {r.text}"
    return r.json()["id"], r.json()


@pytest.mark.parametrize("label", list(DECLS))
def test_every_kind_carries_a_capability_block(client, label):
    """Every build response carries the block, whatever the object can do."""
    _, body = _build(client, label)
    cap = body["capability"]
    assert set(cap) == {"exhibits", "charts", "primary_chart", "has_premium",
                        "can_sharpen", "has_sharpen", "can_pnl", "can_reins",
                        "can_views", "reins_bases", "can_price", "can_evaluate",
                        "can_bounds", "can_allocate", "needs_premium"}
    # Every first-class kind has its own picture as of library a244, and the
    # Overview Plot leaf lights from this rather than from a per-kind table in
    # the browser. It is one of the object's own `charts`, never a name from
    # somewhere else.
    assert cap["primary_chart"] in cap["charts"], f"{label}: {cap['primary_chart']}"
    for item in cap["exhibits"]:
        assert set(item) == {"name", "title", "perspectives"}
        assert item["perspectives"], "an unavailable exhibit is absent, not empty"


def test_can_views_needs_an_occurrence_cession(client):
    """``can_views`` gates the GCN control, and is narrower than ``has_reins``.

    The three view prefixes (``grossceded`` / ``grossnet`` / ``netceded``) build
    the joint **per-occurrence** aggregate of a pair, so they need an occurrence
    cession specifically. A program carrying only an aggregate cession has
    ``has_reins`` true and cannot answer them, and greying with a reason beats
    failing on submit.

    A portfolio is out for the other reason: the grammar's prefixes take an
    ``agg_out``, and a portfolio cedes through its units rather than as a whole.
    """
    _, gross = _build(client, "agg")
    assert gross["capability"]["can_views"] is False, "no cession, nothing to pair"

    _, occ = _build(client, "agg_reins")
    assert occ["has_reins"] is True
    assert occ["capability"]["can_views"] is True

    # Note the clause order: `occurrence net of` sits before the frequency and
    # `aggregate net of` after it, per `agg_body` in the grammar.
    agg_only = ("agg CAP.AggReins 10 claims sev lognorm 100 cv 1.5 poisson "
                "aggregate net of 500 xs 500")
    body = client.post("/v1/objects", json={"decl": agg_only, "log2": 12}).json()
    assert body["has_reins"] is True, "it does cede, just not per occurrence"
    assert body["capability"]["can_views"] is False, \
        "an aggregate-only cession cannot be read as a per-occurrence pair"

    _, port = _build(client, "port")
    assert port["capability"]["can_views"] is False


@pytest.mark.parametrize("label", list(DECLS))
def test_inline_block_matches_the_standalone_route(client, label):
    """The two ways to ask must not drift.

    ``GET /objects/{id}/exhibits`` predates the inline block (a39) and both now
    come from ``capability.exhibits_for``. This is the test that keeps them on
    one helper rather than two that look alike.
    """
    oid, body = _build(client, label)
    standalone = client.get(f"/v1/objects/{oid}/exhibits")
    assert standalone.status_code == 200
    assert body["capability"]["exhibits"] == standalone.json()["exhibits"]


@pytest.mark.parametrize("label", list(DECLS))
def test_every_listed_exhibit_serves(client, label):
    """A leaf the block lights has to be a leaf that answers.

    The navigation greys from this list, so an exhibit named here and then
    refused by its own route would show as available and fail on click, which
    is worse than being greyed.
    """
    oid, body = _build(client, label)
    for item in body["capability"]["exhibits"]:
        for perspective in item["perspectives"]:
            r = client.get(f"/v1/objects/{oid}/exhibit/{item['name']}",
                           params={"perspective": perspective})
            assert r.status_code == 200, f"{label}/{item['name']}/{perspective}"


@pytest.mark.parametrize("label", list(DECLS))
def test_every_listed_chart_serves(client, label):
    """Same contract for the chart leaves."""
    oid, body = _build(client, label)
    for name in body["capability"]["charts"]:
        r = client.get(f"/v1/objects/{oid}/chart/{name}")
        assert r.status_code == 200, f"{label}/{name}"


def test_capability_reproduces_the_retired_tables(client):
    """The derived answer agrees with the hand tables the app used to carry.

    ``NA_MORE_BY_KIND`` said which More views a kind could not answer and
    ``NA_TABS_BY_KIND`` which tabs. Both are transcribed below as they stood at
    1.0.0a42, with the one exception noted in the module docstring: the tables
    said a bivariate had no grid-sizing frame, which was this repo's route
    reading the wrong attribute rather than a fact about the object.
    """
    # More views that map onto an exhibit, and the kinds the table excluded.
    na_more = {
        "distortion": {"bs_window"},
        "bvagg": set(),                       # was {"bs_window"}; see the test below
        "pnl": {"bs_window"},
        "sev": {"validation", "stats", "bs_window"},
    }
    for label, absent in na_more.items():
        _, body = _build(client, label)
        names = {e["name"] for e in body["capability"]["exhibits"]}
        for name in ("validation", "stats", "bs_window"):
            expected = name not in absent
            assert (name in names) is expected, (
                f"{label}: {name} availability disagrees with the retired table")

    # The Reins tab was gated on ``has_reins``, and the exhibit is registered
    # behind the same fact, so the two have to move together.
    for label, expected in (("agg", False), ("agg_reins", True),
                            ("port", False), ("pnl", False)):
        _, body = _build(client, label)
        names = {e["name"] for e in body["capability"]["exhibits"]}
        assert body["has_reins"] is expected, label
        assert ("reins" in names) is expected, label

    # The Price tab was the other half of ``NA_TABS_BY_KIND``, and it is the one
    # gate with no exhibit or chart behind it, so it is a flag.
    for label, expected in (("agg", True), ("agg_reins", True), ("port", True),
                            ("sev", False), ("distortion", False),
                            ("bvagg", False), ("pnl", False)):
        _, body = _build(client, label)
        assert body["capability"]["can_price"] is expected, label


def test_bivariate_serves_its_grid_sizing_frame(client):
    """The one place the hand table and the library disagreed.

    A ``BivariateAggregate`` carries the public ``bs_window_df`` and not the
    private ``_bs_window_df`` the frame route used to read alone, so the
    library reported the ``bs_window`` exhibit as available while the route
    answered 400 and the app's table greyed the pane out. Both now serve.
    """
    oid, body = _build(client, "bvagg")
    names = {e["name"] for e in body["capability"]["exhibits"]}
    assert "bs_window" in names
    assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 200
    assert client.get(f"/v1/objects/{oid}/frame/bs_window_df.csv").status_code == 200


def test_bs_window_keeps_the_richer_frame_where_there_is_one(client):
    """An aggregate still gets the raw probe frame, not the display view.

    ``W`` and ``coverage`` are the pane's whole diagnostic value and only the
    private frame carries them, so the public fallback must not take over where
    the private one exists.
    """
    oid, _ = _build(client, "agg")
    r = client.get(f"/v1/objects/{oid}/bs_window_df")
    assert r.status_code == 200
    assert {"W", "coverage"} <= set(r.json()["columns"])


def test_kinds_without_a_grid_still_answer_cleanly(client):
    """A P&L, a severity and a distortion have no grid frame and say so."""
    for label in ("pnl", "sev", "distortion"):
        oid, body = _build(client, label)
        names = {e["name"] for e in body["capability"]["exhibits"]}
        assert "bs_window" not in names, label
        assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 400, label


def test_can_sharpen_is_the_method_and_the_verdict(client):
    """True where ``sharpen`` exists, and only until a probe confirms the grid."""
    for label, expected in (("agg", True), ("port", True), ("sev", False),
                            ("distortion", False), ("bvagg", False),
                            ("pnl", False), ("xpnl", False)):
        _, body = _build(client, label)
        assert body["capability"]["can_sharpen"] is expected, label


def test_can_sharpen_goes_false_on_a_confirmed_grid(client):
    """A program carrying the library's own verdict does not offer a re-probe.

    The note is namespaced (``sharpen: ``) and merged into whatever the author
    already wrote, so the flag tests the ``;``-separated chunks rather than the
    whole string. Both halves matter: the author's own note must not disable
    the button, and the verdict must.
    """
    mine = ("agg CAP.Note 10 claims sev lognorm 100 cv 1.5 poisson "
            "note{a note of my own}")
    r = client.post("/v1/objects", json={"decl": mine, "log2": 12})
    assert r.json()["capability"]["can_sharpen"] is True

    confirmed = ("agg CAP.Sharp 10 claims sev lognorm 100 cv 1.5 poisson "
                 "note{a note of my own; sharpen: grid confirmed, no change}")
    r = client.post("/v1/objects", json={"decl": confirmed, "log2": 12})
    assert r.json()["capability"]["can_sharpen"] is False


def test_has_sharpen_is_not_the_negation_of_can_sharpen(client):
    """Two questions, not one fact and its complement.

    ``can_sharpen`` asks whether running a probe is worth offering;
    ``has_sharpen`` asks whether one has already run and left an audit to read.
    A fresh object answers False and True. After a probe that *confirms* the
    grid it answers True and False, which is the pair a naive "one flag, two
    readings" implementation would make impossible.
    """
    _, body = _build(client, "agg")
    assert body["capability"]["has_sharpen"] is False
    assert body["capability"]["can_sharpen"] is True

    derived = client.post(f"/v1/objects/{body['id']}/sharpen", json={}).json()
    assert derived["capability"]["has_sharpen"] is True
    assert derived["capability"]["can_sharpen"] is False


def test_the_sharpen_audit_frames_appear_with_the_flag(client):
    """The leaf's gate and the frames behind it agree.

    A flag that lights a leaf whose route 404s is worse than a dark leaf, which
    is the failure this whole capability block exists to prevent.
    """
    _, body = _build(client, "agg")
    # 400, not 404: the name is known and this object cannot answer it yet,
    # which is the route's existing split. 404 is reserved for a frame nobody
    # serves.
    for which in ("sharpen_score", "sharpen_df"):
        assert client.get(
            f"/v1/objects/{body['id']}/frame/{which}?format=ir"
        ).status_code == 400, f"{which} before the probe"

    derived = client.post(f"/v1/objects/{body['id']}/sharpen", json={}).json()
    assert derived["capability"]["has_sharpen"] is True
    for which in ("sharpen_score", "sharpen_df"):
        r = client.get(f"/v1/objects/{derived['id']}/frame/{which}?format=ir")
        assert r.status_code == 200, f"{which}: {r.text}"
        assert r.json()["body"], f"{which} served an empty table"


def test_reins_bases_says_what_the_object_can_be_calibrated_on(client):
    """The list the "calibrate on" row greys from, known at build time.

    All three buttons used to be offered to anything reinsured, and at least one
    of them was wrong on most objects: an occurrence-only program's net occ *is*
    its net, so it would be a third column repeating one already on screen, and
    a portfolio's `reins_density_df` carries no `p_agg_net_occ` at all, so the
    button 400'd. Empty with no cession, which is what greys the whole row
    rather than hiding it.
    """
    _, plain = _build(client, "agg")
    assert plain["capability"]["reins_bases"] == []

    _, reinsured = _build(client, "agg_reins")
    bases = reinsured["capability"]["reins_bases"]
    assert bases, "a reinsured object offers at least one basis"
    assert set(bases) <= {"gross", "net occ", "net"}
    # And it agrees with what the pricing route will accept, which is the point
    # of hoisting it: a lit button that 400s is worse than a dark one.
    priced = client.post(f"/v1/objects/{reinsured['id']}/reins_price",
                         json={"p": 0.99, "coc": 0.15, "basis": bases[0]})
    assert priced.status_code == 200, priced.text
    assert priced.json()["bases"] == bases


def test_has_premium_follows_the_exposure(client):
    """The flag the PnL form reads, and it mirrors the library's own test."""
    priced = ("agg CAP.Prem 1000 premium at 0.65 lr "
              "sev lognorm 100 cv 1 poisson")
    r = client.post("/v1/objects", json={"decl": priced, "log2": 12})
    assert r.json()["capability"]["has_premium"] is True

    _, body = _build(client, "agg")
    assert body["capability"]["has_premium"] is False


def test_capability_survives_the_cache_hit_path(client):
    """The second build of one program answers with the same block as the first.

    The hit path returns early off the cached entry, so it is a separate code
    path and the one likelier to be forgotten. ``can_sharpen`` in particular is
    recomputed rather than stored, since a Sharpen can move an object's note
    under a live id.
    """
    first = client.post("/v1/objects", json={"decl": DECLS["agg"], "log2": 12}).json()
    second = client.post("/v1/objects", json={"decl": DECLS["agg"], "log2": 12}).json()
    assert second["cached"] is True
    assert second["capability"] == first["capability"]
