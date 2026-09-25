"""Tests for /v1/objects/* endpoints.

Covers build idempotency, cache listing, the per-button data
endpoints, the plot endpoint (SVG + PNG), parse-error reporting,
and pricing.

The whole suite runs against the in-process ``TestClient`` -- no
network, no port binding -- so it's fast enough to keep on the
default ``uv run pytest`` path.
"""

from __future__ import annotations

import math
import re

import pytest

from aggregate_api.serializers import display_log2_for


_DICE = "agg Dice dfreq [3] dsev [1:6]"

# A small aggregate carrying occurrence reinsurance, for the reins_* paths.
_REINS = (
    "agg ReinsEx 5 claims 100 xs 0 sev lognorm 10 cv .75 "
    "occurrence ceded to 15 xs 5 poisson"
)

# A small two-unit portfolio, for the per-unit paths.
_PORT = (
    "port PF\n"
    "    agg A 50 claims 50 xs 0 sev lognorm 10 cv 1.2 poisson\n"
    "    agg B 30 claims 100 xs 0 sev lognorm 20 cv 2.0 poisson\n"
)


# ----------------------------------------------------------------------
# Build + cache
# ----------------------------------------------------------------------

def test_build_dice(client):
    r = client.post("/v1/objects", json={"decl": _DICE})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert body["name"] == "Dice"
    assert len(body["id"]) == 16  # hex prefix length
    assert body["cached"] is False


def test_build_summary_fields(client):
    """Build response carries the grid, the moments and the verdict."""
    body = client.post("/v1/objects", json={"decl": _DICE}).json()
    assert body["bs"] == pytest.approx(1.0)   # Dice resolves to bs=1
    assert body["mean"] == pytest.approx(10.5, rel=1e-3)
    # Fixed frequency -> agg CV = sd/mean = sqrt(3*Var(U[1..6]))/10.5.
    assert body["cv"] == pytest.approx(0.2817, rel=1e-2)
    assert body["validation"] == "not unreasonable"
    # The convention is reported on every object that has one, loss included.
    assert body["value_type"] == "loss"
    # A scalar object is not a pair, so there is nothing to enumerate.
    assert body["components"] == []


def test_build_carries_the_declared_note(client):
    """The program's own ``note{}`` rides on the build response, verbatim.

    The status strip prints it under the facts line, on every build, which is
    why it cannot come from ``/v1/objects/{id}/meta``: that route is asked for
    once per object and only while the Overview group is open, so a reader
    sitting in Pricing would never see what the program says about itself.

    Verbatim means verbatim: no label, no trimming to a first sentence, and no
    filtering of the ``sharpen: `` verdict a grid audit merges into the same
    field. A program without a note reports ``None``, which is ordinary rather
    than defective, so the strip simply has no prose line.
    """
    plain = client.post("/v1/objects", json={"decl": _DICE}).json()
    assert plain["note"] is None
    text = "three dice, the smallest object that still has a distribution"
    decl = f"{_DICE} note{{{text}}}"
    body = client.post("/v1/objects", json={"decl": decl}).json()
    assert body["note"] == text
    # And on the cache-hit path, which builds its response from the stored
    # object rather than from the one it just made.
    again = client.post("/v1/objects", json={"decl": decl}).json()
    assert again["cached"] is True
    assert again["note"] == text


def test_build_reports_the_sign_convention(client):
    """``value_type`` names the convention on every kind that has one.

    a57 sent it **only** for ``'payoff'``, reasoning that loss is the default
    and reporting it would spend a word to say "normal" on every build. Sound
    reasoning, wrong outcome: the two kinds that answer ``value_type`` at all
    both answer ``'loss'`` and were therefore suppressed, so the field printed
    for nothing the app can build and the author's ask went unfilled from a57 to
    a65. ``None`` now means "this kind has no orientation", not "its orientation
    is ordinary".
    """
    loss = client.post("/v1/objects", json={"decl": _DICE}).json()
    assert loss["value_type"] == "loss"
    decl = "agg PayoffCase 10 claims sev lognorm 50 cv 1 poisson payoff"
    payoff = client.post("/v1/objects", json={"decl": decl}).json()
    assert payoff["value_type"] == "payoff"


def test_pnl_reports_the_payoff_convention(client):
    """A P&L says ``payoff``, which the app asserts rather than reads.

    ``PnL`` carries neither ``value_type`` nor ``_is_loss_value``, yet it is the
    one kind whose whole reading turns on the convention: its own ledger caption
    explains that the kappa columns run payoff convention, left tail bad. The
    author's ruling is that a P&L is always payoff, implied by the name. So the
    app states it, knowingly holding a fact about a library class from outside
    it; ``PnL.value_type`` is asked for upstream and this case goes when it
    lands. The test is here to fail loudly on the day the library disagrees.
    """
    built = client.post("/v1/objects", json={"decl": _DICE}).json()
    derived = client.post(f"/v1/objects/{built['id']}/pnl", json={}).json()
    assert derived["kind"] == "pnl"
    assert derived["value_type"] == "payoff"


def _pnl_premium(program: str) -> str:
    """The consideration as the derived program prints it."""
    head = re.match(r"\Apnl\s+\S+\s+(\S+)\s+premium\b", program)
    assert head, f"unexpected program shape: {program[:80]!r}"
    return head.group(1)


def test_pnl_premium_is_rounded_for_reading(client):
    """The derived premium is a number someone would write down.

    The library sizes an uninherited consideration as expected loss over the
    loss ratio and does not round it, so this route used to drop
    ``1428.5840984231345 premium`` into the editor: sixteen digits of a number
    whose input was "about 70 percent". The author's rule is no decimals above
    100 and two at or below.

    The second assertion is the one worth having. The same program ends
    ``0.25 premium expenses``, which the obvious "number then ``premium``"
    pattern also matches, and rewriting *that* to ``0`` would silently change
    the object rather than only how it reads. The rounding is anchored at the
    head of the program for exactly that reason, and this is what says so.
    """
    decl = "agg RoundMe 10 claims sev lognorm 100 cv 2 poisson"
    built = client.post("/v1/objects", json={"decl": decl}).json()
    program = client.post(
        f"/v1/objects/{built['id']}/pnl", json={}).json()["program"]

    premium = _pnl_premium(program)
    assert float(premium) > 100, "the fixture has to exercise the whole-number arm"
    assert "." not in premium, f"a premium over 100 prints whole, got {premium}"

    assert "0.25 premium expenses" in " ".join(program.split()), \
        "the expense ratio is not the consideration and must not be rounded"


def test_pnl_premium_keeps_the_cents_when_small(client):
    """At or below 100 the cents are the number, so they survive.

    A dice roll at a loss ratio of 1 is a premium of 10.5, and rounding that to
    ``10`` would be a five percent error in the thing the P&L is about. Which is
    the whole reason the rule has two arms.

    Asserted as a **value**, not as the string ``10.50``. The rewrite does write
    two decimals, and ``spread`` then re-renders the program through the
    library's own writer, which normalizes a trailing zero away. That is the
    library's call about how a float prints and not something to pin here; what
    this route owes the reader is a premium rounded to the cent, and 10.5 is
    that number.

    **The ladder is switched off for the first arm, deliberately.** Since a114
    the endpoint defaults to the combined-ratio ladder, which sizes the premium
    from the bottom up and grosses it up once for expenses, so ``loss_ratio``
    sizes nothing unless the ladder is off. That is what makes 10.5 an exact
    expectation. The second arm is the path the button actually presses, and it
    is here because the rounding rule has to hold on both.
    """
    built = client.post("/v1/objects", json={"decl": _DICE}).json()
    program = client.post(f"/v1/objects/{built['id']}/pnl",
                          json={"loss_ratio": 1.0,
                                "net_combined_ratio": None}).json()["program"]
    premium = float(_pnl_premium(program))
    assert premium == round(premium, 2) and premium == 10.5, program[:80]

    laddered = client.post(f"/v1/objects/{built['id']}/pnl",
                           json={}).json()["program"]
    priced = float(_pnl_premium(laddered))
    assert priced <= 100, "the fixture has to stay on the cents arm"
    assert priced == round(priced, 2), laddered[:80]


def test_build_reports_library_warnings(client):
    """What the library says on its way to the object reaches the response.

    Two channels are captured, ``logger.warning`` and ``warnings.warn``, and
    this program exercises the first: a reflected lognormal splice whose
    support reaches below zero, so mass is clamped at 0.

    The second assertion is the one that took a fix. ``catch_warnings`` is
    process-wide, so a first cut reported the api's own sqlite
    ``ResourceWarning`` as something the user's program had provoked. Warnings
    are now kept only when raised from inside the ``aggregate`` package.
    """
    decl = "agg WarnCase dfreq[1] sev 10 - lognorm 1.5 splice[0 11]"
    body = client.post("/v1/objects", json={"decl": decl}).json()
    assert body["warnings"], "the library warns about this program"
    assert any("clamps" in w for w in body["warnings"])
    assert not any("sqlite" in w.lower() for w in body["warnings"]), \
        "only the library's warnings, never the api's own"

    # A warning describes the object, so a cache hit reports what the miss did.
    again = client.post("/v1/objects", json={"decl": decl}).json()
    assert again["cached"] is True
    assert again["warnings"] == body["warnings"]


def test_clean_build_warns_about_nothing(client):
    """The common case: no warnings at all, so the strip's note stays empty."""
    body = client.post("/v1/objects", json={"decl": _DICE}).json()
    assert body["warnings"] == []


def test_build_reports_resolved_log2(client):
    """``log2`` rides beside ``bs``, and reports the grid the object is *on*.

    The pair is what says whether the window covers the distribution: bs alone
    is only how fine the grid is. Both are the **resolved** values, not the
    requested ones, which is the same contract ``bs`` has always kept here.

    Dice is the case that proves it. Its support is 18 points, so the library
    pins it at ``log2=5`` and asking for 8 does not move it; a continuous
    aggregate takes the 13 it was given. A response echoing the request would
    have the strip claim a 256-bucket grid under an object sitting on 32.

    Checked on the cache-hit path too, because that branch assembles its payload
    from a separate literal and is exactly where a new field gets forgotten.
    """
    body = client.post("/v1/objects", json={"decl": _DICE, "log2": 8}).json()
    assert body["cached"] is False
    assert body["log2"] == 5
    assert isinstance(body["log2"], int)

    cached = client.post("/v1/objects", json={"decl": _DICE, "log2": 8}).json()
    assert cached["cached"] is True
    assert cached["log2"] == 5

    big = client.post(
        "/v1/objects",
        json={"decl": "agg Big 100 claims sev lognorm 100 cv 1.5 poisson",
              "log2": 13},
    ).json()
    assert big["log2"] == 13


def test_build_is_idempotent(client):
    r1 = client.post("/v1/objects", json={"decl": _DICE})
    r2 = client.post("/v1/objects", json={"decl": _DICE})
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["cached"] is True


# ----------------------------------------------------------------------
# Comments, empty programs, and a program that means a number
# ----------------------------------------------------------------------
# ``collapse_program`` folds the program onto one line before anything parses
# it, and through a137 it did that with a single ``re.sub`` over the raw text.
# A leading comment therefore ended up in FRONT of the program, the whole
# statement became one comment, and the reader saw an unexplained parse
# failure. It runs the library's ``UnderwritingLexer.preprocess`` now, which is
# where the comment rules live.

@pytest.mark.parametrize("program", [
    f"# a note\n{_DICE}",
    f"// a note\n{_DICE}",
    f"{_DICE}  # trailing",
    f"{_DICE}  // trailing",
    f"# above\n{_DICE}  # and beside",
])
def test_comments_are_transparent(client, program):
    """A comment never changes what a program builds, wherever it sits."""
    r = client.post("/v1/objects", json={"decl": program})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Dice"


def test_a_comment_leaves_the_cache_key_alone(client):
    """The commented and uncommented forms are one object, not two.

    ``collapse_program`` computes the id, so this is the test that the comment
    really came OUT rather than being tolerated somewhere downstream.
    """
    plain = client.post("/v1/objects", json={"decl": _DICE}).json()
    noted = client.post("/v1/objects", json={"decl": f"# why\n{_DICE}"}).json()
    assert noted["id"] == plain["id"]
    assert noted["cached"] is True


def test_a_hash_inside_a_note_is_prose(client):
    """``note{}`` bodies are lifted before the comment strip, so a ``#`` survives.

    The reason to run the library's preprocess rather than a regex here: the
    rule is not "delete from ``#`` to end of line", it is that plus three
    trailer bodies where the character is prose.
    """
    body = client.post("/v1/objects", json={
        "decl": f"{_DICE} note{{a # hash, and a // slash, in prose}}",
    }).json()
    assert body["note"] == "a # hash, and a // slash, in prose"


@pytest.mark.parametrize("program", ["# just a comment", "// just a comment",
                                     "   ", "# one\n# two"])
def test_a_program_with_no_statement_says_so(client, program):
    """Empty, or all comments, answered in its own words.

    The library's answer is about ``build_many``, which is not what a reader who
    typed a comment needs to hear.
    """
    r = client.post("/v1/objects", json={"decl": program})
    assert r.status_code == 422
    assert "holds no statement" in r.json()["detail"]


@pytest.mark.parametrize("program, value", [
    ("(2+2)", 4.0),
    ("2/3", 2 / 3),
    ("(2**10)", 1024.0),
    ("(1e6/7)", 1e6 / 7),
])
def test_a_program_that_means_a_number(client, program, value):
    """DecL's ``answer`` rule carries ``expr``, so arithmetic is a program.

    Built by the library and served, rather than built and then refused at the
    classify step for being a ``float``, which is what happened through a137.
    """
    r = client.post("/v1/objects", json={"decl": program})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "value"
    assert body["value"] == pytest.approx(value)
    assert body["decl"] == program
    # No object, so nothing a later route could fetch against an id, and no
    # cache slot to hold it in.
    assert "id" not in body


def test_a_number_takes_no_cache_slot(client):
    """Arithmetic leaves the object list where it found it."""
    before = len(client.get("/v1/objects").json()["objects"])
    assert client.post("/v1/objects", json={"decl": "(2+2)"}).status_code == 200
    assert len(client.get("/v1/objects").json()["objects"]) == before


def test_list_objects(client):
    client.post("/v1/objects", json={"decl": _DICE})
    r = client.get("/v1/objects")
    body = r.json()
    assert "objects" in body
    assert len(body["objects"]) >= 1
    first = body["objects"][0]
    assert first["kind"] == "agg"
    assert first["name"] == "Dice"


def test_get_manifest(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == oid
    assert body["decl"] == _DICE
    assert body["kind"] == "agg"


def test_delete_object(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.delete(f"/v1/objects/{oid}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    # Second delete is a 404 -- cache no longer holds it.
    r2 = client.delete(f"/v1/objects/{oid}")
    assert r2.status_code == 404


def test_get_unknown_object_is_404(client):
    r = client.get("/v1/objects/deadbeefcafebabe")
    assert r.status_code == 404


# ----------------------------------------------------------------------
# Per-button data endpoints
# ----------------------------------------------------------------------

def test_info_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/info")
    assert r.status_code == 200
    body = r.json()
    assert "info" in body
    assert isinstance(body["info"], str)
    assert "Dice" in body["info"]


def test_summary_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/summary")
    assert r.status_code == 200
    body = r.json()
    assert "columns" in body and "rows" in body
    # summary_df is a 3-row Freq/Sev/Agg table.
    assert len(body["rows"]) == 3


def test_tail_df_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/tail_df")
    assert r.status_code == 200
    body = r.json()
    # tail_df is a method on Aggregate; the route must call it. Index = the
    # probability P; the T / VaR / TVaR / xsVaR / VaR/Mean columns survive.
    # The index spelled itself ``p`` until the ladder went two sided upstream.
    assert "T" in body["columns"]
    for col in ("P", "VaR", "TVaR", "xsVaR", "VaR/Mean"):
        assert col in body["columns"]
    assert len(body["rows"]) > 0


def test_validation_df_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/validation_df")
    assert r.status_code == 200
    body = r.json()
    # validation_df is the old moment-vs-estimate QA table (Freq/Sev/Agg).
    assert "columns" in body and "rows" in body
    assert len(body["rows"]) == 3


def test_stats_df_endpoint(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/stats_df")
    assert r.status_code == 200
    body = r.json()
    assert "columns" in body and "rows" in body
    # stats_df carries Freq/Sev/Agg moment rows in the MultiIndex;
    # at least a handful of standard columns survive the reset.
    assert any(c in {"mixed", "independent", "empirical"} for c in body["columns"])
    assert len(body["rows"]) > 0


def test_density_df_binned_is_faithful(client):
    """Density binning conserves probability: p_total sums to ~1.

    The old even-spaced stride-skip understated p_total by the stride
    factor; the power-of-two binning sums masses per super-bucket, so the
    surfaced p_total column is faithful.
    """
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/density_df", params={"cols": "loss,p_total"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["loss", "p_total"]
    total = sum(row[1] for row in body["rows"] if row[1] is not None)
    assert total == pytest.approx(1.0, abs=1e-6)


def test_density_df_unknown_cols_filtered(client):
    """Caller can request columns that don't exist; api filters them."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/density_df",
        params={"cols": "loss,does_not_exist", "downsample": 5},
    )
    assert r.status_code == 200
    assert r.json()["columns"] == ["loss"]


def test_density_df_bins_to_display_grid(client):
    """A fine grid bins to exactly the display row target, and stays faithful.

    The reduction stays on the power-of-two paradigm (``k = 2**(log2 - m)``),
    so a 2**16-row build collapses to exactly 2**m grid nodes while p_total
    still sums to ~1. Nodes are centered: the loss grid is 0, bs', 2*bs', ...
    (first label 0), and F is the running cumulative so F[i]-F[i-1] == p[i].

    The row target is read from ``display_log2_for`` rather than hardcoded: it
    depends on the column count (the payload is budgeted in cells, not rows), and
    a test that pinned a literal would have to be edited every time the budget
    moved, which is exactly when it should be checking rather than agreeing.

    Binning is now opt-in (``resolution='display'``): the default ships every
    grid point, because binning an atomic density is what made the plots wrong.
    """
    oid = client.post(
        "/v1/objects",
        json={"decl": "agg Big 100 claims sev lognorm 100 cv 1.5 poisson", "log2": 16},
    ).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/density_df",
        params={"cols": "loss,p_total,F", "resolution": "display"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["loss", "p_total", "F"]
    rows = body["rows"]
    assert len(rows) == 2 ** display_log2_for(3)
    total = sum(row[1] for row in rows if row[1] is not None)
    assert total == pytest.approx(1.0, abs=1e-4)
    # Centered nodes: first label 0, then a constant coarse step bs'.
    assert rows[0][0] == pytest.approx(0.0, abs=1e-12)
    step = rows[1][0]
    assert rows[2][0] == pytest.approx(2 * step, rel=1e-9)
    assert rows[3][0] == pytest.approx(3 * step, rel=1e-9)
    # F is cumsum-consistent with the summed masses.
    assert rows[1][2] - rows[0][2] == pytest.approx(rows[1][1], abs=1e-12)


# ----------------------------------------------------------------------
# bs window summary
# ----------------------------------------------------------------------

def test_bs_window_df_present(client):
    """The bucket/window estimator summary is a small per-method frame."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/bs_window_df")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "columns" in body and "rows" in body
    assert len(body["rows"]) >= 1
    # The 'selected' column marks the chosen grid method.
    assert "selected" in body["columns"]


def test_bs_window_df_csv(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/bs_window_df.csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert len(r.text.strip().splitlines()) >= 2


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/quantiles
# ----------------------------------------------------------------------

def test_quantiles_answers_any_probability(client):
    """``q(p)`` at any p, which nothing else served.

    Quick Re lets attach and limit be written as probabilities, and there was no
    way to ask for one: ``tail_df`` carries VaR by return period, so ``q(0.99)``
    was reachable and ``q(0.5)`` was not.
    """
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/quantiles", params={"p": "0.5,0.99"})
    assert r.status_code == 200, r.text
    rows = r.json()["quantiles"]
    assert [row["p"] for row in rows] == [0.5, 0.99], "answered in the order asked"
    assert rows[0]["q"] < rows[1]["q"], "a quantile function is non-decreasing"


def test_quantiles_snap_to_something_writable(client):
    """The snapped value is what goes into a program a person then reads.

    A layer is quoted at three significant figures. Quantiles land on the FFT
    grid and carry every digit of it, so unsnapped the form would produce
    arithmetic rather than a program. Both values travel: the exact one is for
    anyone checking.
    """
    decl = "agg SNAP 10 claims sev lognorm 100000 cv 1.5 poisson"
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    row = client.get(f"/v1/objects/{oid}/quantiles",
                     params={"p": "0.99"}).json()["quantiles"][0]
    assert row["snapped"] != 0
    assert f"{row['snapped']:.15g}".lstrip("-").replace(".", "").rstrip("0"), "no leading zeros"
    # Three significant figures: the snapped value has at most 3 non-zero
    # leading digits, and it sits within half a step of the exact one.
    digits = f"{abs(row['snapped']):.15g}".replace(".", "").lstrip("0")
    assert len(digits.rstrip("0")) <= 3, digits
    assert abs(row["snapped"] - row["q"]) <= abs(row["q"]) * 0.005

    raw = client.get(f"/v1/objects/{oid}/quantiles",
                     params={"p": "0.99", "snap": "false"}).json()["quantiles"][0]
    assert raw["snapped"] == raw["q"], "snap=false leaves it alone"


def test_quantiles_refuses_a_probability_outside_the_unit_interval(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    for bad in ("1.5", "0", "1", "-0.2"):
        r = client.get(f"/v1/objects/{oid}/quantiles", params={"p": bad})
        assert r.status_code == 422, f"{bad}: {r.status_code}"
    assert client.get(f"/v1/objects/{oid}/quantiles",
                      params={"p": "nonsense"}).status_code == 422


def test_quantiles_read_the_tier_they_are_asked_for(client):
    """The occurrence basis reads the per-claim law, not the annual one.

    Not a convenience. An occurrence cession applies to a single claim and an
    aggregate cession to the year, so a percentage means a different number on
    each tier. This program is the case that made the point: severity is capped
    at 1,000 by its own limit, while a hundred claims a year put the annual
    median near 4,850. Read the occurrence attachment off the annual law and
    Quick Re writes ``occurrence net of 1830 xs 4850``, a treaty no claim can
    ever reach. It builds, it validates, and it cedes nothing.
    """
    decl = "agg TIER 100 claims 1000 xs 0 sev lognorm 50 cv 2 poisson"
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]

    def q(basis):
        r = client.get(f"/v1/objects/{oid}/quantiles",
                       params={"p": "0.5", "basis": basis})
        assert r.status_code == 200, r.text
        return r.json()["quantiles"][0]["q"]

    annual = q("aggregate")
    per_claim = q("occurrence")
    assert per_claim <= 1000, "a claim cannot exceed the policy limit"
    assert annual > 1000, "a hundred such claims a year can"
    assert q("aggregate") == annual, "aggregate is the default basis"
    assert client.get(f"/v1/objects/{oid}/quantiles",
                      params={"p": "0.5"}).json()["quantiles"][0]["q"] == annual
    assert client.get(f"/v1/objects/{oid}/quantiles",
                      params={"p": "0.5", "basis": "nonsense"}).status_code == 422


def test_quantiles_occurrence_basis_handles_a_mixture(client):
    """``q_sev`` answers for a mixture, where the components cannot.

    An Aggregate's `sevs` is one entry per mixture component, so a two-component
    severity has no single component to ask. The aggregate-level `q_sev` is the
    per-claim quantile of the mixture itself, which is why the route reads that
    rather than reaching into `sevs[0]`.
    """
    decl = ("agg MIXTIER 100 claims 1000 xs 0 "
            "sev [lognorm gamma] [50 60] cv [2 1] wts [.5 .5] poisson")
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/quantiles",
                   params={"p": "0.5,0.95", "basis": "occurrence"})
    assert r.status_code == 200, r.text
    rows = r.json()["quantiles"]
    assert rows[0]["q"] < rows[1]["q"], "a quantile function is non-decreasing"
    assert rows[1]["q"] <= 1000


# ----------------------------------------------------------------------
# The plot endpoint, and its absence
# ----------------------------------------------------------------------

def test_the_server_renders_no_figures(client):
    """``GET /objects/{id}/plot`` is gone, and that is the assertion.

    Six tests stood here through a59, covering the four legacy kinds, the two
    image formats and the kappa guard. The route rendered matplotlib server
    side and was the last thing in the api importing it; every chart is a
    document now and the browser draws and exports it, so the picture is the
    one on screen rather than a second rendering of the same object.

    Kept as a test rather than deleted outright so the removal is stated
    somewhere an implementer will meet it, instead of being invisible.
    """
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    assert client.get(f"/v1/objects/{oid}/plot").status_code == 404


# ----------------------------------------------------------------------
# Reinsurance endpoints
# ----------------------------------------------------------------------

def test_reins_description_absent_on_plain_object(client):
    """An object with no reinsurance reports available=False."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_description")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert body["text"] == ""


def test_reins_summary_df_400_on_plain_object(client):
    """reins_summary_df is a 400 (not 500) when there's no reinsurance."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_summary_df")
    assert r.status_code == 400


def test_reins_description_present(client):
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/reins_description")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert "xs" in body["text"]


def test_reins_frames_present(client):
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]
    for which in ("reins_summary_df", "reins_stats_df", "reins_density_df"):
        r = client.get(f"/v1/objects/{oid}/{which}")
        assert r.status_code == 200, f"{which}: {r.text}"
        body = r.json()
        assert "columns" in body and "rows" in body
        assert len(body["rows"]) > 0


def test_reins_stats_is_served_as_the_library_publishes_it(client):
    """The layering analysis comes from the `reins` exhibit, unaltered.

    Two tests stood here from round 3 to a71 and both pinned the opposite. The
    api resolved `reins_stats_df`, transposed it so the layers ran down the rows
    rather than across the columns, split it into a terms block and a moments
    block, and served the halves as `reins_stats_terms` and
    `reins_stats_moments`. The reasoning was that a reinsurance reader compares
    gross against ceded against net and the eye makes that comparison down a
    column.

    That reasoning may even be right, and it was still the wrong place to act on
    it. Turning a table on its side is a decision about what the table means,
    the library owns what its tables mean, and this service had quietly taken
    that decision for one frame out of eleven. The author's ruling of
    2026-08-10: publish what the library says, and if the orientation is wrong,
    change the library.

    So both routes are gone with `_reins_stats_transposed`, and the leaf draws
    the `reins` exhibit's first block. This pins the exhibit as the only path.
    """
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]

    # The api no longer manufactures either half.
    for gone in ("reins_stats_terms", "reins_stats_moments"):
        r = client.get(f"/v1/objects/{oid}/frame/{gone}?format=ir")
        assert r.status_code == 404, f"{gone} should not resolve: {r.status_code}"

    # The exhibit answers, and its first block is the layering analysis with the
    # library's own caption on it.
    exh = client.get(f"/v1/objects/{oid}/exhibit/reins").json()
    assert len(exh["blocks"]) == 2, exh["blocks"]
    layering = exh["blocks"][0]
    assert layering["caption"], "the library's sentence about the block travels with it"
    assert layering["body"], "and it carries rows"


def test_the_library_formats_its_own_numbers(client):
    """A served exhibit arrives with its formats resolved, so this repo has none.

    This test used to assert the opposite: that `tables.FORMATS` reached the
    generic frame route, because the route passed no format key through a50 and
    every frame it served was pure dtype inference. Inference drops the decimals
    once a column's mean reaches 20,000, so a book worth pricing reported its
    money as whole units, and naming the columns here was the fix.

    Naming them here was the fix to the wrong problem. A format is a statement
    about what a number *is*, the library knows that and the app does not, and
    the entries this repo held (`summary`, `tail_df`, `validation_df`,
    `reins_summary_df`, `bs_window_df`) were five second opinions that had to be
    kept in step with frames they did not own. They came out at a71 with the
    author's ruling. Note that the library does not agree with what was here,
    and does not have to: it writes a VaR in the tens of millions as `41.864M`
    where this repo said `41,864,000.00`. Its call.

    The six pricing sets followed at a85. They were held one round longer than
    the rest only because the frames behind them were computed from the reader's
    own input and had no exhibit to come from; the library registers the
    `pricing.*` exhibits on its result objects now, and they do. What is left is
    the two `sharpen` frames, whose leaf has not moved onto the exhibit the
    library registered for it at a255.
    """
    from aggregate_api.tables import FORMATS, ROW_FLAGS

    assert not ROW_FLAGS, f"row emphasis belongs to the library: {sorted(ROW_FLAGS)}"
    for gone in ("summary", "tail_df", "validation_df", "reins_summary_df",
                 "bs_window_df", "price", "reins_price",
                 "stat_LR", "stat_P", "stat_PQ", "stat_ROE"):
        assert gone not in FORMATS, f"{gone} is a published exhibit; it formats itself"

    big = "agg FMT.Big 5000 claims 100000 xs 0 sev lognorm 9000 cv 2.5 poisson"
    oid = client.post("/v1/objects", json={"decl": big, "log2": 16}).json()["id"]
    block = client.get(
        f"/v1/objects/{oid}/exhibit/tail?perspective=insurer").json()["blocks"][0]

    head = [h["text"] for h in block["head"][-1]]
    cells = block["body"][0]["cells"]
    var = cells[head.index("VaR")]
    # Formatted, not a bare float: the point is that somebody decided, and that
    # somebody is upstream. The raw value rides alongside for the grid.
    assert var["text"] != str(var["raw"]), var
    # The probability column still separates 0.99 from 0.995 from 0.999. It is
    # the stub now rather than a body column, because the two sided ladder
    # upstream made the probability the frame's index and named it ``P``, and a
    # stub cell serializes as its text alone with no raw value beside it. Read
    # as a string for that reason, not as a `{raw, text}` pair.
    probability = cells[head.index("P")]
    assert isinstance(probability, str), probability
    assert len(probability.split(".")[1]) >= 4, probability


def test_density_df_is_full_resolution_by_default(client):
    """Every grid point, unbinned, and the atoms survive intact.

    The reason binning had to go: a book written over layer limits is atomic, so
    single ``bs``-wide buckets carry whole percentage points of probability. This
    program puts a point mass at each limit; on the binned grid each merged with
    31 neighbours and the plot drew a triangle where the truth is a spine.

    Asserting on the atom rather than only the row count is what makes this test
    about the defect: a row count would pass on a grid that still smeared them.

    The program is the author's own, the one the fat spikes were reported on. It
    builds at ``log2=16, bs=1`` and puts 12.9% of its mass in the single bucket
    at 250, against a continuum of 0.07% per bucket either side.
    """
    decl = (
        "agg ExposureRating2 [1000 2000 10000 500] premium at "
        "[0.9 0.85 0.9 0.8] lr [250 500 1000 2000] xs 0 sev lognorm 120 cv 4 "
        "occurrence ceded to 750 xs 750 mixed gamma 0.2"
    )
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/density_df", params={"cols": "loss,p_total"})
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert len(rows) == 2 ** 16

    mass = {row[0]: row[1] for row in rows}
    step = rows[1][0] - rows[0][0]
    # Each layer limit is an atom standing orders of magnitude above the
    # continuum on either side. Binning to 2**13 dropped that ratio to about 24;
    # unbinned it is in the hundreds.
    for at in (250.0, 500.0, 750.0):
        atom = mass[at]
        neighbours = max(mass[at - step], mass[at + step])
        assert atom > 50 * neighbours, f"{at}: atom {atom} vs neighbour {neighbours}"


def test_bivariate_density_returns_marginals(client):
    """A bivariate answers density_df with its two marginals, not the joint.

    The joint is a matrix of 2**16 cells or more: a picture, not a table. The
    Overview heatmap asks for it explicitly with ``view='joint'``.
    """
    decl = (
        "bivariate BV 25 claims agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
        "agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 poisson"
    )
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]

    marginal = client.get(f"/v1/objects/{oid}/density_df").json()
    assert marginal["columns"] == ["unit", "loss", "p", "F", "S"]
    units = {row[0] for row in marginal["rows"]}
    assert units == {"A", "B"}
    # Each marginal is a pmf over its own grid, so each sums to one on its own.
    for unit in units:
        total = sum(row[2] for row in marginal["rows"] if row[0] == unit)
        assert total == pytest.approx(1.0, abs=1e-6)

    joint = client.get(f"/v1/objects/{oid}/density_df", params={"view": "joint"}).json()
    assert joint["columns"] != marginal["columns"]
    assert len(joint["columns"]) > 5           # the axis-1 grid, as headers


def test_reinsured_summary_reports_the_net_mean(client):
    """Under a cession the headline mean is the net one, matching ``summary_df``.

    ``actual_m`` is the analytic mean of the *subject* book and ``est_m`` the
    realized mean of the object's own (net) distribution. Preferring ``actual_m``
    unconditionally, which is right for a gross build, put a gross number on the
    summary bar directly above a table of net ones, and sent the exhibit's mean
    reference line off the end of the loss axis.
    """
    body = client.post("/v1/objects", json={"decl": _REINS}).json()
    oid = body["id"]
    summary = client.get(f"/v1/objects/{oid}/summary").json()
    cols = summary["columns"]
    agg_row = next(r for r in summary["rows"] if str(r[cols.index("X")]) == "Agg")
    net_mean = agg_row[cols.index("Mean")]
    assert body["mean"] == pytest.approx(net_mean, rel=1e-6)

    # And the gross case is untouched: no cession, so the analytic mean stands.
    plain = client.post(
        "/v1/objects",
        json={"decl": "agg NoReins 5 claims 100 xs 0 sev lognorm 10 cv .75 poisson"},
    ).json()
    plain_summary = client.get(f"/v1/objects/{plain['id']}/summary").json()
    pcols = plain_summary["columns"]
    prow = next(r for r in plain_summary["rows"] if str(r[pcols.index("X")]) == "Agg")
    # Analytic vs realized differ only by discretization here, so a loose match
    # is the honest assertion: the point is that it is the same variable.
    assert plain["mean"] == pytest.approx(prow[pcols.index("Mean")], rel=1e-3)


def test_reins_density_preview_is_binned(client):
    """Reins density bins to the display grid (faithful gross/ceded/net mass).

    Ten columns wide, so the cell budget backs the row target off below the
    narrow-frame maximum. That trade is the point of ``display_log2_for``, and
    asserting against it here is what keeps the two in step.
    """
    oid = client.post("/v1/objects", json={"decl": _REINS, "log2": 16}).json()["id"]
    r = client.get(
        f"/v1/objects/{oid}/reins_density_df", params={"resolution": "display"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    cols = body["columns"]
    assert len(body["rows"]) == 2 ** display_log2_for(len(cols))
    # The gross aggregate density column sums to ~1 across the binned grid.
    assert "p_agg_gross" in cols
    gi = cols.index("p_agg_gross")
    total = sum(row[gi] for row in body["rows"] if row[gi] is not None)
    assert total == pytest.approx(1.0, abs=1e-3)


# ----------------------------------------------------------------------
# CSV frame download
# ----------------------------------------------------------------------

def test_frame_csv_summary(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/summary.csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers.get("content-disposition", "")
    # CSV body has a header row plus data.
    assert len(r.text.strip().splitlines()) >= 2


def test_frame_csv_unknown_name_404(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/bogus.csv")
    assert r.status_code == 404


def test_frame_csv_reins_400_when_absent(client):
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/reins_summary_df.csv")
    assert r.status_code == 400


# ----------------------------------------------------------------------
# Parse / validation errors
# ----------------------------------------------------------------------

def test_parse_error_returns_report(client):
    """A DecL typo surfaces as a 422 with an ErrorReport body."""
    # ``mixd`` close-match typo for ``mixed`` -- exercises Plan B's
    # word extraction + suggestion path through the api boundary.
    r = client.post(
        "/v1/objects",
        json={"decl": "agg X 100 claims sev lognorm 100 cv 2 mixd poisson 0.5"},
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    # ErrorReport shape: line/column/message/suggestions/...
    assert "line" in detail
    assert "message" in detail
    assert "mixd" in detail["got"]


def test_log2_cap_rejected(client, monkeypatch):
    """Setting log2 above the cap returns 422 limit_exceeded."""
    # Lower the cap below the request value.
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "8")
    # Rebuild the app so the new env is honored.
    from aggregate_api.app import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post("/v1/objects", json={"decl": _DICE, "log2": 12})
        assert r.status_code == 422
        # Message says "log2 12 exceeds AGGAPI_LOG2_CAP=8".
        assert "CAP" in r.json()["detail"].upper()


def test_unknown_distortion_kind_returns_422(client):
    """A bad distortion kind surfaces as a clean 422 with the message.

    Current ``aggregate`` raises the ``ValueError`` directly from the
    transformer (no longer wrapped in Lark's ``VisitError``); either way the
    build handler returns 422, not the old ugly 500.
    """
    r = client.post("/v1/objects", json={"decl": "dist MYD pd 0.5"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "pd" in detail
    assert "distortion kind" in detail.lower()


def test_infinite_variance_without_bs_returns_422(client):
    """An infinite-variance severity with no explicit bs is a 422, not a 500.

    ``aggregate`` raises ``InfiniteVarianceError`` (a ``ValueError`` subclass)
    when it can't size the grid; the build handler surfaces it in the 422 family
    with the library's "pass an explicit bs" message.
    """
    r = client.post(
        "/v1/objects",
        json={"decl": "agg IMP 3 claims sev 100 * pareto 1.5 - 100 poisson"},
    )
    assert r.status_code == 422, r.text
    assert "bs" in str(r.json()["detail"]).lower()


# ----------------------------------------------------------------------
# BivariateAggregate (bivariate / bv / clash / netceded / grossceded / grossnet)
# ----------------------------------------------------------------------

_BV = (
    "bivariate BV.Copula 25 claims "
    "agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
    "agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 "
    "copula gumbel 0.4 poisson"
)


def test_bivariate_reports_per_component_grid(client):
    """A bivariate's facts are pairs, and they travel in ``components``.

    Its ``bs`` is a two element list, one grid per axis, so every scalar
    headline field coerces to ``None`` and the status strip had nothing to show
    but a name and a kind. ``log2`` is not an attribute at all on this kind and
    is derived from the axis length, which is what log2 means.

    Asserted as a pair of plausible grids rather than as exact numbers: the
    values are the library's bucket-sizing decision and are free to move.
    """
    body = client.post("/v1/objects", json={"decl": _BV}).json()
    assert body["bs"] is None and body["log2"] is None, \
        "the scalar fields stay null; the pair is the honest answer"
    comps = body["components"]
    assert [c["name"] for c in comps] == ["A", "B"]
    for c in comps:
        assert c["bs"] > 0
        assert 4 <= c["log2"] <= 24
        assert c["mean"] > 0
        assert c["cv"] > 0


def test_gcn_bivariate_reports_its_moments(client):
    """A GCN pair carries moments too, and they come from a different place.

    This is the case a57 missed and the test above did not catch. A bivariate
    built with ``bivariate ... copula ...`` carries ``units``, a list of
    component ``Aggregate`` objects, and the moments were read off those. One
    built by ``grossnet`` (or its two siblings) carries ``units is None``, so
    both moments resolved to ``None`` and the status strip printed
    ``mean (?, ?) . CV (?, ?)`` on every GCN read from a57 to a65, which is
    exactly the reading the ``components`` block was added to fix.

    The moments are in ``stats_df``, whose columns are ``unit_names``, so the
    pair lines up by name. Asserted loosely: the point is that they are numbers
    at all, and Gross must exceed Net because the cession only removes loss.
    """
    decl = ("grossnet agg GcnMoments 100 claims 1000 xs 0 "
            "sev lognorm 50 cv 2 occurrence net of 250 xs 250 poisson")
    body = client.post("/v1/objects", json={"decl": decl}).json()
    assert body["kind"] == "bvagg"
    comps = body["components"]
    assert [c["name"] for c in comps] == ["Gross", "Net"]
    for c in comps:
        assert c["mean"] is not None and c["mean"] > 0
        assert c["cv"] is not None and c["cv"] > 0
    gross, net = comps
    assert gross["mean"] > net["mean"], "ceding a layer cannot raise the mean"


def test_bivariate_builds_and_reports(client):
    """A BivariateAggregate builds as kind='bvagg' with the common surface.

    ``bvagg`` is the parser's own token. The api used to say ``bivariate``; where
    the two disagree on a name the library wins, so the api moved.
    """
    r = client.post("/v1/objects", json={"decl": _BV})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "bvagg"
    oid = body["id"]
    # Common reporting surface works.
    for which in ("info", "summary", "stats_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which
    # No pricing / reinsurance -> clean 400 (not 500).
    assert client.post(
        f"/v1/objects/{oid}/pricing/calibrate", json={"p": 0.99, "coc": 0.15}
    ).status_code == 400
    assert client.get(f"/v1/objects/{oid}/reins_summary_df").status_code == 400
    # A grid-sizing frame it does have, and this used to 400. The route read
    # only the private ``_bs_window_df``, which a bivariate does not carry,
    # while the library serves the public ``bs_window_df`` as an exhibit; the
    # capability payload (a42) put the disagreement on the record. See
    # ``tests/test_capability.py``.
    assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 200


def test_bivariate_chart_document(client):
    """chart/joint_surface serves canonical ChartDoc bytes, hash as ETag.

    The pilot of the chart-IR route (`dev/plan-chart-ir.md` in the library):
    the emitter block-sums the joint to the display grid upstream, so the
    payload is small, byte deterministic, and revalidates on If-None-Match.
    """
    r = client.post("/v1/objects", json={"decl": _BV})
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    r1 = client.get(f"/v1/objects/{oid}/chart/joint_surface")
    assert r1.status_code == 200, r1.text
    doc = r1.json()
    # A deliberate canary on a literal, not a read of the library's own
    # constant, which would make the assertion tautological. It has now fired
    # three times and been right every time, so it earns its keep: version 3
    # (aggregate 1.0.0a349) adds ``ChartDoc.blocks`` and the 'tower' panel
    # kind, whose content is blocks rather than series, so a reader that does
    # not know the field draws an empty panel. When this fails, read the
    # CHART_IR_VERSION note upstream and decide what the adapter owes the new
    # version before changing the number.
    assert doc["ir_version"] == 3
    assert doc["name"] == "joint_surface"
    assert [p["kind"] for p in doc["panels"]] == ["surface"]
    # Whether the height may be read on a log scale is declared by the z AXIS,
    # as the scales it admits, not by a `meta['z_log_ok']` flag. The flag was
    # the surface pilot's placeholder and the library generalized it into
    # `ChartAxis.scales` while keeping `ir_version` at 1, since a consumer that
    # ignores the field still draws the default reading correctly.
    z_axis = next(a for a in doc["axes"] if a["id"] == doc["panels"][0]["z_axis"])
    assert set(z_axis["scales"]) == {"linear", "log"}
    # `.get`, because the canonical form omits a field sitting at its default:
    # an axis drawn on 'linear' carries no `scale` key at all. That is the
    # serializer's business, not the schema's, and reading it any other way
    # makes this test assert the encoding rather than the meaning.
    assert z_axis.get("scale", "linear") == "linear"
    # axes carry the resolved component names; the axisNames stats_df hack
    # is not needed on this route.
    labels = {a["id"]: a["label"] for a in doc["axes"]}
    assert labels["x0"] == "A" and labels["x1"] == "B"
    surf = doc["series"][0]["surface"]
    assert len(surf["z"]) == len(surf["y"])
    assert len(surf["z"][0]) == len(surf["x"])
    # The reduction preserves mass. Through a256 this read "the display cells
    # sum to 1", which was right while the emitted grid was the whole joint and
    # became wrong the moment the window arrived, so it became `kept * (1 -
    # deficit)`. Wrong again since the emitter went back to serving the whole
    # placed mass: the grid holds everything the construction placed, and
    # `window.kept` is a separate report on how much of it the display window
    # frames. So the two are asserted separately rather than multiplied.
    total = sum(v for row in surf["z"] for v in row)
    # The joint's own mass is short of 1 by the construction deficit, and that
    # is the whole of what the grid may lose.
    placed = 1.0 - surf.get("deficit", 0.0)
    assert abs(total - placed) < 1e-9
    assert 0.999 < surf["window"]["kept"] <= 1.0
    # The lattice, as an origin, a step and a count, and what a coordinate
    # names. Both are what the app's decode reads in preference to the arrays
    # beside them, and `edge` is what stops a mean being taken half a bucket
    # off.
    assert surf["nx"] == len(surf["x"]) and surf["ny"] == len(surf["y"])
    assert abs(surf["x0"] - surf["x"][0]) < 1e-9
    assert abs((surf["x"][1] - surf["x"][0]) - surf["dx"]) < 1e-9
    # `edge` read `left` up to a139 and reads `mid` since library a333 centered
    # the mass on the bucket. Asserted as "a value the SPA decodes" rather than
    # as a literal, because the literal is not the risk: `surface-grid.js`
    # normalizes anything that is not `left` to `mid`, so a third spelling would
    # be read as `mid` and would shift every coordinate half a bucket with
    # nothing failing. Both spellings below are ones that file handles.
    assert surf["edge"] in ("left", "mid"), surf["edge"]
    # Phase one emits both forms: the arrays an old reader walks and the
    # encoded block a new one prefers (plan 2.4.1).
    assert surf["z_block"]["dtype"] == "f32b64"
    assert surf["z_block"]["order"] == "yx"
    # The exact marginals come off the object, not off the reduced joint.
    assert len(surf["marginals"]["x"]) == surf["nx"]
    assert len(surf["marginals"]["y"]) == surf["ny"]
    # ETag is the stamped document hash, quoted; a match revalidates.
    etag = r1.headers["ETag"]
    assert etag == f'"{doc["hash"]}"' and len(doc["hash"]) == 12
    r2 = client.get(
        f"/v1/objects/{oid}/chart/joint_surface",
        headers={"If-None-Match": etag},
    )
    assert r2.status_code == 304
    # byte determinism: a fresh GET returns identical bytes.
    r3 = client.get(f"/v1/objects/{oid}/chart/joint_surface")
    assert r3.content == r1.content
    # unknown name -> 404 carrying the capability set.
    r4 = client.get(f"/v1/objects/{oid}/chart/nope")
    assert r4.status_code == 404
    assert "joint_surface" in r4.json()["detail"]


def _surface_takes_grid_options(client, oid) -> bool:
    """Whether the installed library's surface emitter honors the knob yet.

    ``dev/plan-3d-plot.md`` section 6 has the library and this service landing
    in that order, and deliberately: the parameters are a knob on a capability
    only the library can have, since it is the one that chooses the window
    before it reduces. Until LIB items 5.2 and 5.4 land, the route's own
    behavior is fully testable (bounds, the cache, the refusal) and the
    round trip is not, so the two round-trip cases skip on this rather than
    failing on a schedule nobody controls.
    """
    r = client.get(f"/v1/objects/{oid}/chart/joint_surface", params={"detail": 32})
    return r.status_code != 422


def test_chart_parameters_are_bounded(client):
    """The three knobs validate at the edges, and 422 rather than clamp.

    A clamp would answer a request for something specific with something else
    under a 200 and an ETag that both claim to be what was asked for. The
    half-step check on ``window`` is this route's own, not the schema's: the
    SPA spinner walks halves, and a continuum of depths makes the cache key
    and the ETag answer for a parameter nobody can reproduce by hand.
    """
    r = client.post("/v1/objects", json={"decl": _BV})
    oid = r.json()["id"]
    url = f"/v1/objects/{oid}/chart/joint_surface"
    assert client.get(url, params={"window": 13}).status_code == 422
    assert client.get(url, params={"window": -1}).status_code == 422
    off_lattice = client.get(url, params={"window": 0.25})
    assert off_lattice.status_code == 422
    assert "multiple of 0.5" in off_lattice.json()["detail"]
    assert client.get(url, params={"detail": 8}).status_code == 422
    assert client.get(url, params={"encoding": "zip"}).status_code == 422

    # The ceiling is a setting, so it is checked in the handler rather than by
    # the schema, and the message names the env var that raises it.
    monkey = client.get(url, params={"detail": 4096})
    assert monkey.status_code == 422
    assert "AGGAPI_MAX_CHART_DETAIL" in monkey.json()["detail"]


def test_chart_detail_ceiling_is_a_setting(client, monkeypatch):
    """``AGGAPI_MAX_CHART_DETAIL`` moves the ceiling, both ways.

    The public deploy sets it to 256 because chart GETs sit outside the Caddy
    rate limiter; local runs keep the high default so a drill-down into fine
    detail is reachable. Both are the same code path with a different number,
    which is what makes it a setting rather than a constant.
    """
    from aggregate_api.config import get_settings

    r = client.post("/v1/objects", json={"decl": _BV})
    oid = r.json()["id"]
    url = f"/v1/objects/{oid}/chart/joint_surface"

    monkeypatch.setenv("AGGAPI_MAX_CHART_DETAIL", "256")
    get_settings.cache_clear()
    over = client.get(url, params={"detail": 512})
    assert over.status_code == 422
    assert "ceiling of 256" in over.json()["detail"]
    # At the ceiling the parameter is accepted by this route; whether the
    # library honors it is the other half of the plan.
    assert client.get(url, params={"detail": 256}).status_code in (200, 422)
    get_settings.cache_clear()


def test_chart_parameters_refused_by_a_chart_that_takes_none(client):
    """An xy chart handed a grid parameter is a 422 naming what was sent.

    The alternative, dropping an option the emitter cannot take, returns a
    document that is not the one requested under a 200 and an ETag that both
    say it is. The route reports the refusal instead and names the parameters,
    so a caller learns which charts the knob applies to.
    """
    r = client.post("/v1/objects", json={"decl": _DICE})
    oid = r.json()["id"]
    refused = client.get(f"/v1/objects/{oid}/chart/agg", params={"detail": 64})
    assert refused.status_code == 422
    assert "detail" in refused.json()["detail"]
    # Without the knob the same chart serves, which is what makes the 422 a
    # statement about the parameter rather than about the chart.
    assert client.get(f"/v1/objects/{oid}/chart/agg").status_code == 200


def test_chart_parameters_reach_the_openapi_schema(client):
    """The knob is discoverable, with its bounds, from /openapi.json."""
    schema = client.get("/openapi.json").json()
    params = schema["paths"]["/v1/objects/{oid}/chart/{name}"]["get"]["parameters"]
    by_name = {p["name"]: p for p in params}
    assert {"window", "detail", "encoding"} <= set(by_name)
    window = by_name["window"]["schema"]
    # anyOf, because the parameter is optional: the bounds sit on the numeric
    # branch and the other branch is null.
    numeric = window.get("anyOf", [window])[0]
    assert numeric["maximum"] == 12 and numeric["minimum"] == 0
    detail = by_name["detail"]["schema"]
    assert detail.get("anyOf", [detail])[0]["minimum"] == 16


def test_chart_document_cache_serves_the_revalidation(client, monkeypatch):
    """A repeat GET, and a conditional one, do not rebuild the document.

    A conditional GET has to know the hash before it can answer 304, and the
    hash comes from building the document. Without the cache every
    ``If-None-Match`` would redo the window-and-reduce work in order to say
    nothing changed, which on a joint surface at a high ``detail`` is the first
    time in this app that is real work.
    """
    from aggregate_api.routes import objects as objects_routes

    r = client.post("/v1/objects", json={"decl": _BV})
    oid = r.json()["id"]
    url = f"/v1/objects/{oid}/chart/joint_surface"

    calls = []
    real = objects_routes.agg_charts.build_chart_doc

    def counted(obj, name, **options):
        calls.append(name)
        return real(obj, name, **options)

    monkeypatch.setattr(objects_routes.agg_charts, "build_chart_doc", counted)
    first = client.get(url)
    assert first.status_code == 200 and len(calls) == 1
    again = client.get(url)
    assert again.content == first.content and len(calls) == 1
    etag = first.headers["ETag"]
    assert client.get(url, headers={"If-None-Match": etag}).status_code == 304
    assert len(calls) == 1


def test_exhibit_cache_serves_the_revalidation(client, monkeypatch):
    """The same contract on the exhibit route, where the rebuild cost more.

    Through a134 this route built the exhibit, serialized it, hashed it,
    compared ``If-None-Match`` and on a match discarded the lot. That was 210 ms
    on a three unit portfolio's ``tail`` to reply "nothing changed", against
    7 ms for a chart answering off its cache.
    """
    from aggregate_api.routes import objects as objects_routes

    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    url = f"/v1/objects/{oid}/exhibit/summary?perspective=insurer"

    calls = []
    real = objects_routes.agg_exhibits.build_exhibit

    def counted(obj, name, perspective, **kwargs):
        calls.append((name, perspective))
        return real(obj, name, perspective, **kwargs)

    monkeypatch.setattr(objects_routes.agg_exhibits, "build_exhibit", counted)
    first = client.get(url)
    assert first.status_code == 200 and len(calls) == 1
    again = client.get(url)
    assert again.content == first.content and len(calls) == 1
    etag = first.headers["ETag"]
    assert client.get(url, headers={"If-None-Match": etag}).status_code == 304
    assert len(calls) == 1
    # The perspective is part of the key, so the other reading is its own entry
    # and its own build rather than the first one served back under a wrong hash.
    other = client.get(f"/v1/objects/{oid}/exhibit/summary?perspective=raw")
    assert other.status_code == 200 and len(calls) == 2
    assert other.headers["ETag"] != etag


def test_exhibit_cache_does_not_swallow_the_404(client):
    """An unknown name is screened before the cache and still names the set."""
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/exhibit/no_such_exhibit")
    assert r.status_code == 404
    assert "available" in r.json()["detail"]


def test_chart_parameters_change_the_bytes(client):
    """Two detail settings are two documents, two ETags, two cache entries.

    Skipped until the library honors the knob (plan items 5.2 and 5.4): this
    is the round trip, and half of it is upstream.
    """
    r = client.post("/v1/objects", json={"decl": _BV})
    oid = r.json()["id"]
    if not _surface_takes_grid_options(client, oid):
        pytest.skip("library surface emitter does not take window/detail yet")
    url = f"/v1/objects/{oid}/chart/joint_surface"
    coarse = client.get(url, params={"detail": 32})
    fine = client.get(url, params={"detail": 64})
    assert coarse.status_code == 200 and fine.status_code == 200
    assert coarse.headers["ETag"] != fine.headers["ETag"]
    # Each revalidates against its own ETag, and neither against the other's.
    assert client.get(url, params={"detail": 32},
                      headers={"If-None-Match": coarse.headers["ETag"]}
                      ).status_code == 304
    assert client.get(url, params={"detail": 32},
                      headers={"If-None-Match": fine.headers["ETag"]}
                      ).status_code == 200
    # The realized grid is what the document reports, never what was asked for:
    # `detail` is a target and the reduction blocks by powers of two.
    #
    # **`detail` counts cells across the window, not across the emitted axis.**
    # This read `nx <= detail` through a139 and that was always the wrong
    # quantity; it passed while the two happened to agree. `_joint_surface`
    # says it plainly: the window "selects the block factor and says which part
    # of the grid is the subject; it does not crop what is served", and "the
    # emitted axis runs the whole lattice at that step and so is longer, by the
    # ratio of the lattice to the window". So `nx` is the lattice over the
    # block factor and exceeds `detail` by exactly that ratio, which on this
    # fixture is four on x and two on y.
    #
    # Asserted against the window the document itself reports, which is the
    # ceiling that is actually promised, plus the ordering between the two
    # depths so a `detail` that stopped biting at all would still fail.
    coarse_surface = coarse.json()["series"][0]["surface"]
    fine_surface = fine.json()["series"][0]["surface"]
    for axis, step, bound in (("x", "dx", 32), ("y", "dy", 32)):
        lo, hi = coarse_surface["window"][axis]
        cells = math.ceil((hi - lo) / coarse_surface[step])
        assert cells <= bound, (axis, cells)
    for axis in ("nx", "ny"):
        assert coarse_surface[axis] < fine_surface[axis], axis


def test_chart_document_unavailable_kind(client):
    """A chart this object cannot serve 404s, naming the ones it can.

    Asserted as "the requested name is refused and the object's own set is
    reported", never as a literal set. Through a53 this read
    ``"available: []"``, which was true only while an ``Aggregate`` had no
    registered chart at all; ``chart_agg`` upstream made it false and took
    the test with it. What the route promises is the refusal and the
    signpost, so that is what is checked, and the next emitter to land does
    not break it.
    """
    r = client.post(
        "/v1/objects",
        json={"decl": "agg CD.A 10 claims sev lognorm 50 cv 1 poisson"},
    )
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    available = r.json()["capability"]["charts"]
    assert "joint_surface" not in available
    r1 = client.get(f"/v1/objects/{oid}/chart/joint_surface")
    assert r1.status_code == 404
    detail = r1.json()["detail"]
    assert "joint_surface" in detail
    assert f"available: {available}" in detail


# ----------------------------------------------------------------------
# PnL (the pnl / xpnl P&L engine -> kind='pnl')
# ----------------------------------------------------------------------

_PNL = (
    "pnl P.PnL 1000 prem less "
    "agg P.Loss 1000 prem at 70% lr sev lognorm 100 cv 2 poisson"
)


def test_pnl_builds_and_reports(client):
    """A PnL builds as kind='pnl' with the common surface + a headline mean.

    The build route rejected ``pnl`` before this landed (``_classify_object``
    had no ``PnL`` case), so this pins the new kind. A PnL exposes info /
    summary / stats / validation / density / plot; the density synthesis path
    is exercised because its ``density_df`` is a dict of grids, not a frame.
    """
    r = client.post("/v1/objects", json={"decl": _PNL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "pnl"
    # The summary-line mean/cv fall back to est_m / est_cv: a P&L outcome is
    # emergent, so it carries no analytic actual_m to report.
    assert body["mean"] is not None
    oid = body["id"]
    # Common reporting surface works (density exercises the dict->frame path).
    for which in ("info", "summary", "stats_df", "validation_df", "density_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which
    # The `/plot` line that stood here left with the route at a60. The modern
    # form of "and it draws" is that every chart the object claims actually
    # serves, which `test_capability.test_every_listed_chart_serves` asserts
    # for this kind and the seven others, so it is not repeated here.
    # density CSV export goes through the grand-result synthesis, not a 500.
    csv = client.get(f"/v1/objects/{oid}/frame/density_df.csv")
    assert csv.status_code == 200
    assert "loss" in csv.text.splitlines()[0]
    # A P&L **does** have a tail now. `aggregate` 1.0.0a227 gave `PnL` and
    # `BivariateAggregate` the current `tail_df` contract, which is the `kinds`
    # item of the library's own round-3 plan: a P&L outcome has a downside worth
    # reading return periods off, and it carried the old semantics under the new
    # name until then. This asserted the absence, so it is pinned to the new
    # contract rather than deleted.
    #
    # The navigation is deliberately unmoved by that: Overview / Tail gates on
    # the `tail` *exhibit*, which the library has not registered for a P&L, so
    # the frame is reachable through the api and the leaf stays dark. If the
    # exhibit follows upstream, `check-nav.mjs` is what will say so.
    assert client.get(f"/v1/objects/{oid}/tail_df").status_code == 200
    # No pricing / reinsurance / bs-window -> clean 400 (not 500).
    assert client.post(
        f"/v1/objects/{oid}/pricing/calibrate", json={"p": 0.99, "coc": 0.15}
    ).status_code == 400
    assert client.get(f"/v1/objects/{oid}/reins_summary_df").status_code == 400
    assert client.get(f"/v1/objects/{oid}/bs_window_df").status_code == 400


# ----------------------------------------------------------------------
# Unbuildable programs are 422s, not 500s
# ----------------------------------------------------------------------

def test_pnl_over_portfolio_builds(client):
    """``pnl`` over a portfolio is supported and reports the whole surface."""
    port = ("port PB.Book agg A 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
            "agg B 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4")
    assert client.post("/v1/objects", json={"decl": port}).status_code == 200
    r = client.post("/v1/objects",
                    json={"decl": "pnl PB.Over 12000 prem less port.PB.Book"})
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    assert r.json()["kind"] == "pnl"
    for which in ("info", "meta", "summary", "stats_df", "density_df"):
        assert client.get(f"/v1/objects/{oid}/{which}").status_code == 200, which


def test_xpnl_over_portfolio_is_422(client):
    """An unsupported combination is a 422 carrying the library's own reason.

    ``xpnl`` explodes a P&L across its units, and a portfolio total has none to
    expose, so the library raises ``NotImplementedError`` with a message that
    names the fix. That is a statement about the program, not a server fault,
    so it must not fall through to the catch-all 500.
    """
    port = ("port XP.Book agg A 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
            "agg B 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4")
    assert client.post("/v1/objects", json={"decl": port}).status_code == 200
    r = client.post("/v1/objects",
                    json={"decl": "xpnl XP.Over 12000 prem less port.XP.Book"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "xpnl" in detail and "portfolio" in detail


def test_unresolved_reference_is_422(client):
    """A reference to a name that is not in the recipe base is a 422.

    The library raises ``KeyError``, whose ``str()`` re-quotes the message, so
    the detail must come from ``args[0]`` or the user sees stray quotes.
    """
    r = client.post("/v1/objects",
                    json={"decl": "pnl NR.Over 9000 prem less port.NoSuchBook"})
    assert r.status_code == 422, r.text
    detail = str(r.json()["detail"])
    assert "NoSuchBook" in detail
    assert not detail.startswith('"'), f"quoted KeyError leaked through: {detail}"


# ----------------------------------------------------------------------
# Severity (sev -> kind='sev', near-first-class)
# ----------------------------------------------------------------------

def test_sev_builds_and_reports(client):
    """A ``sev`` builds as kind='sev' with info + plot and no library frames.

    ``Severity`` is near-first-class: DecL-creatable and carrying the metadata
    and narrative surface, but a look-through onto a frozen scipy variable
    rather than a compute result, so upstream exempts it from the DataFrame
    quartet. Every frame route must therefore answer a clean 400, not a 500.
    It also arrives as a *subclass* (``SeverityScipy``), which is why
    classification falls back to an isinstance check.

    ``density_df`` is the exception: the api synthesizes a display curve, the
    same presentation-layer move it makes for a ``PnL``. See
    :func:`test_sev_density_is_a_sampled_curve`.
    """
    r = client.post("/v1/objects", json={"decl": "sev SEV.Test lognorm 50 cv 1.5"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "sev"
    oid = body["id"]
    assert client.get(f"/v1/objects/{oid}/info").status_code == 200
    # See the note on the PnL case above: charts are asserted in
    # `test_capability`, and the `/plot` route is gone.
    for which in ("summary", "stats_df", "validation_df",
                  "tail_df", "bs_window_df", "reins_summary_df"):
        got = client.get(f"/v1/objects/{oid}/{which}").status_code
        assert got == 400, f"{which} -> {got}"


def test_sev_density_is_a_sampled_curve(client):
    """A severity's density is ``loss / pdf / F / S``, sampled by quantile.

    The column is ``pdf``, not ``p_total``: it is a density ordinate, not a
    probability mass, and naming it after the aggregate's column would invite
    summing something that has no business being summed.
    """
    oid = client.post(
        "/v1/objects", json={"decl": "sev SEV.Curve lognorm 50 cv 1.5"},
    ).json()["id"]
    r = client.get(f"/v1/objects/{oid}/density_df")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["loss", "pdf", "F", "S"]
    rows = body["rows"]
    assert len(rows) > 100
    at = {c: i for i, c in enumerate(body["columns"])}
    loss = [r[at["loss"]] for r in rows]
    cdf = [r[at["F"]] for r in rows]
    surv = [r[at["S"]] for r in rows]
    # Ascending in loss, so the client can plot it without sorting.
    assert loss == sorted(loss)
    # A cdf rises and S is its complement, both inside the unit interval.
    assert cdf[0] < 0.01 and cdf[-1] > 0.99
    assert all(abs(f + s - 1.0) < 1e-9 for f, s in zip(cdf, surv))
    # Quantile spacing, not linear: the tail step dwarfs the body step, which
    # is the whole point of inverting the survival function to build the grid.
    body_step = loss[len(loss) // 2] - loss[len(loss) // 2 - 1]
    tail_step = loss[-1] - loss[-2]
    assert tail_step > body_step * 10


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/unit_density_df  -- Portfolio only
# ----------------------------------------------------------------------

def test_unit_density_df_carries_every_unit(client):
    """Per-unit densities and survivals on the portfolio's common grid.

    This is what the Overview exhibit draws for a portfolio: a density and an
    exceedance series per unit alongside the total. ``Portfolio.density_df``
    has no per-unit densities (only ``p_total`` and the allocation columns), so
    they come off ``unit_density_df()`` and are unstacked back to wide form.
    """
    decl = ("port UD.Book agg Property 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
            "agg Casualty 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4")
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/unit_density_df")
    assert r.status_code == 200, r.text
    body = r.json()
    cols = body["columns"]
    for name in ("loss", "p_Property", "p_Casualty", "S_Property", "S_Casualty",
                 "p_total", "S"):
        assert name in cols, f"missing {name} in {cols}"

    at = {c: i for i, c in enumerate(cols)}
    rows = body["rows"]
    # Masses survive the display binning: each unit still sums to one. This is
    # the check that catches a binning path treating S_* as a mass, or p_* as a
    # pointwise value.
    for unit in ("p_Property", "p_Casualty", "p_total"):
        total = sum(r[at[unit]] or 0 for r in rows)
        assert abs(total - 1.0) < 1e-6, f"{unit} sums to {total}"
    # Survivals fall from ~1 to ~0 and stay inside the unit interval.
    for surv in ("S_Property", "S_Casualty", "S"):
        series = [r[at[surv]] for r in rows if r[at[surv]] is not None]
        assert series[0] > 0.9 and series[-1] < 1e-6
        assert all(0.0 <= v <= 1.0 + 1e-9 for v in series)


def test_unit_density_df_is_portfolio_only(client):
    """Anything but a Portfolio gets a clean 400, not a 500."""
    oid = client.post(
        "/v1/objects", json={"decl": "agg UD.Single 10 claims sev lognorm 50 cv 1 poisson"},
    ).json()["id"]
    r = client.get(f"/v1/objects/{oid}/unit_density_df")
    assert r.status_code == 400
    assert "Portfolio-only" in str(r.json()["detail"])


# ----------------------------------------------------------------------
# GET /v1/objects/{id}/meta -- the DecL trailer + both programs
# ----------------------------------------------------------------------

def test_meta_reports_trailer_and_programs(client):
    """``/meta`` carries note / tags / hints and both program renderings."""
    decl = (
        "agg META.Probe 10 claims sev lognorm 50 cv 1.5 poisson "
        "note{a stored note} tags{topic:aggregate, role:intro} hints{log2=12}"
    )
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/meta")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "agg"
    assert body["name"] == "META.Probe"
    assert body["note"] == "a stored note"
    assert body["tags"] == ["topic:aggregate", "role:intro"]
    assert "log2=12" in body["hints"]
    # pprogram is what the parser understood, re-rendered canonically.
    assert "META.Probe" in body["pprogram"]
    assert body["program"]
    # The response model forbids extras, so the served block is exactly the
    # trailer the library has. `doc` was the one clause this route declined to
    # serve; `aggregate` 1.0.0a301 retired it, so the assertion now guards
    # against a field being added rather than against one leaking.
    assert "doc" not in body


def test_meta_empty_clauses_are_null(client):
    """A program with no trailer reports ``None``, not empty strings."""
    oid = client.post(
        "/v1/objects",
        json={"decl": "agg META.Bare 5 claims sev lognorm 10 cv 1 poisson"},
    ).json()["id"]
    body = client.get(f"/v1/objects/{oid}/meta").json()
    assert body["note"] is None
    assert body["hints"] is None
    assert body["tags"] == []


def test_meta_works_for_every_kind(client):
    """One route serves all six kinds, including the frame-less ones."""
    for decl, kind in (
        ("sev META.Sev lognorm 50 cv 1.5", "sev"),
        ("dist META.Dist ph 0.7", "distortion"),
        (_PNL.replace("P.PnL", "META.PnL").replace("P.Loss", "META.Loss"), "pnl"),
    ):
        oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
        body = client.get(f"/v1/objects/{oid}/meta").json()
        assert body["kind"] == kind, decl
        assert body["pprogram"], f"no pprogram for {kind}"


def test_meta_unknown_object_404(client):
    assert client.get("/v1/objects/nope/meta").status_code == 404


# ----------------------------------------------------------------------
# Session models export (/v1/session/models.agg)
# ----------------------------------------------------------------------

def test_session_models_export(client):
    """Both forms download the session's built programs as an .agg attachment."""
    # Empty cache: header-only, graceful (no 500). The object cache is per-app
    # (fresh per test), so raw starts empty.
    r0 = client.get("/v1/session/models.agg", params={"form": "raw"})
    assert r0.status_code == 200
    assert r0.headers["content-type"].startswith("text/plain")
    assert 'filename="session-models.agg"' in r0.headers["content-disposition"]
    assert "0 program(s)" in r0.text

    a = "agg SME.One 5 claims sev lognorm 10 cv 1 poisson"
    b = ("port SME.Book agg U 3 claims sev lognorm 5 cv 1 poisson "
         "agg V 4 claims sev gamma 8 cv 1 poisson")
    for decl in (a, b):
        assert client.post("/v1/objects", json={"decl": decl}).status_code == 200, decl

    # raw = programs verbatim, as typed.
    raw = client.get("/v1/session/models.agg", params={"form": "raw"})
    assert raw.status_code == 200
    assert a in raw.text
    assert "port SME.Book" in raw.text

    # agg = canonical (names present; source is the process-global knowledge, so
    # only assert our programs are included, not exact contents).
    agg = client.get("/v1/session/models.agg", params={"form": "agg"})
    assert agg.status_code == 200
    assert "SME.One" in agg.text and "SME.Book" in agg.text

    # Unknown form -> 422 (Literal validation).
    assert client.get(
        "/v1/session/models.agg", params={"form": "nope"}
    ).status_code == 422


# ----------------------------------------------------------------------
# Multi-line input (whitespace collapse)
# ----------------------------------------------------------------------

def test_multiline_input_builds(client):
    r"""Newlines / tabs collapse so a multi-line program builds without `\`."""
    decl = "agg A\n    100 claims\n    sev lognorm 10 cv 1\n    poisson"
    r = client.post("/v1/objects", json={"decl": decl})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "agg"
    # The same program on one line shares the cache slot (formatting-insensitive).
    one_line = "agg A 100 claims sev lognorm 10 cv 1 poisson"
    r2 = client.post("/v1/objects", json={"decl": one_line})
    assert r2.json()["id"] == r.json()["id"]


# ----------------------------------------------------------------------
# Stats tables omit raw moments
# ----------------------------------------------------------------------

def test_stats_df_drops_raw_moments(client):
    """Displayed stats omit ex1/ex2/ex3; keep mean/cv/skew."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    body = client.get(f"/v1/objects/{oid}/stats_df").json()
    cells = {str(c) for row in body["rows"] for c in row}
    assert not ({"ex1", "ex2", "ex3"} & cells)
    assert {"mean", "cv", "skew"} <= cells


# ----------------------------------------------------------------------
# DecL formatting (example standardization)
# ----------------------------------------------------------------------

def test_decl_format_roundtrips_name(client):
    """format returns canonical DecL; the object name survives."""
    r = client.post("/v1/decl/format", json={"decl": _DICE})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "decl" in body and isinstance(body["decl"], str)
    assert "Dice" in body["decl"]


def test_decl_format_echoes_garbage(client):
    """Unparseable input echoes back unchanged (best-effort, never 500)."""
    junk = "this is not decl"
    r = client.post("/v1/decl/format", json={"decl": junk})
    assert r.status_code == 200, r.text
    assert r.json()["decl"] == junk


def test_decl_format_keeps_the_whole_trailer(client):
    """Reformat no longer deletes ``note{}``, ``hints{}`` or ``tags{}``.

    ``format_program`` defaults to ``trailer=False`` and emits the trailer as a
    unit, so through a125 the route dropped all three. The one that mattered was
    ``hints{}``: Sharpen writes it to pin the grid the object was probed onto,
    and a Reformat straight afterward silently threw the pinning away, leaving a
    program the next build is free to put on a different grid.

    Asserted clause by clause rather than on the whole string, because the
    writer is free to move the trailer and to respell what precedes it, and this
    is a test about what survives rather than about layout.
    """
    decl = ('agg TrailerProbe 5 claims sev lognorm 10 cv 0.8 poisson '
            'note{a sentence about the book} hints{log2=12, bs=1/64} '
            'tags{topic:probe}')
    r = client.post("/v1/decl/format", json={"decl": decl})
    assert r.status_code == 200, r.text
    out = r.json()["decl"]
    assert "note{a sentence about the book}" in out
    assert "hints{" in out and "log2=12" in out
    assert "topic:probe" in out


def test_decl_format_keeps_a_trailer_written_after_a_port_name(client):
    """The trailer travels wherever DecL binds it, not only at the end.

    DecL binds a trailer to the declaration it follows, so a portfolio's own
    trailer sits directly after the name and before the first unit. The writer
    decides that placement, and this asserts the round trip preserves the
    clauses without asserting where they land, which is the library's business.
    """
    decl = ('port TrailerPortProbe note{the book itself} tags{topic:probe}\n'
            '    agg UnitA 3 claims sev lognorm 10 cv 0.5 poisson\n'
            '    agg UnitB 4 claims sev lognorm 12 cv 0.6 poisson')
    r = client.post("/v1/decl/format", json={"decl": decl})
    assert r.status_code == 200, r.text
    out = r.json()["decl"]
    assert "note{the book itself}" in out
    assert "topic:probe" in out


def test_decl_format_spreads_a_program_typed_on_one_line(client):
    """The point of the button: one line in, a clause a line out.

    Asserted as "more lines than it arrived with" rather than against an exact
    layout, which is the library's to decide and does change.
    """
    decl = "agg SpreadProbe 100 claims 1000 xs 0 sev lognorm 50 cv 1.5 poisson"
    out = client.post("/v1/decl/format", json={"decl": decl}).json()["decl"]
    assert out.count("\n") >= 3
    assert "SpreadProbe" in out


def test_decl_format_leaves_an_unreadable_program_exactly_as_it_arrived(client):
    """A program the writer cannot read keeps its own line breaks.

    The a137 regression, and the reason the route parses before it formats.
    ``format_program`` answers an unreadable statement with the **preprocessed**
    copy of it, which has every newline folded to a space, so the SPA wrote a
    one-line program over the reader's spread one: pressing the format button
    was how you lost your formatting.

    ``doc{{{...}}}`` is the vehicle because it is a clause the grammar carried
    until ``aggregate`` 1.0.0a301 and does not now, which is exactly the shape
    of the trap: a program that was good yesterday, still spread across lines in
    the editor, and no longer readable.
    """
    decl = ("agg StaleClause\n"
            "  100 claims\n"
            "  sev lognorm 50 cv 1.5\n"
            "  poisson\n"
            "  doc{{{a clause the grammar has retired}}}")
    out = client.post("/v1/decl/format", json={"decl": decl}).json()["decl"]
    assert out == decl


def test_decl_format_declines_a_program_that_names_its_own_first_statement(
        client):
    """Two statements, the second naming the first, come back untouched.

    The writer renders statement by statement against the default underwriter,
    which has never read statement one, so it canonicalizes that and drops the
    second to the fallback. The program builds, so this is a working program the
    button cannot help with; what it must not do is flatten it. Tracked upstream
    in ``dev/TODO.md``.
    """
    decl = ("sev FormatProbeSev lognorm 50 cv 1.5\n"
            "\n"
            "agg FormatProbeAgg\n"
            "  100 claims\n"
            "  sev.FormatProbeSev\n"
            "  poisson")
    out = client.post("/v1/decl/format", json={"decl": decl}).json()["decl"]
    assert out == decl



# ----------------------------------------------------------------------
# GET /v1/objects/{id}/frame/{which}?format=ir  (the table document)
# ----------------------------------------------------------------------


def test_frame_ir_carries_the_numbers_it_formatted(client):
    """Every document ships the exact value beside the rendered string.

    This is what full precision is made of, and since a68 it is **all** it is
    made of: the route had a ``precision=full`` that rebuilt the document with
    the per-column formats dropped, and that existed only because the exhibit
    route once served documents with their numbers thrown away, leaving a client
    nothing local to reprint. Both routes carry raw now (here through
    ``include_raw``, there through the library's ``INCLUDE_RAW``), so reprinting
    is the client's and costs no round trip.

    So the property to hold is the one the app depends on: for every data cell,
    the raw value is present and it is the number the text was rendered from.
    """
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/summary?format=ir")
    assert r.status_code == 200, r.text
    doc = r.json()
    # Stub cells serialize as bare strings, data cells as mappings, so the walk
    # has to say which it wants rather than assume every cell is a mapping.
    cells = [c for row in doc["body"] for c in row["cells"] if isinstance(c, dict)]
    assert cells, "the document has data cells at all"
    assert all("raw" in c for c in cells), "every data cell carries its number"

    numeric = [c for c in cells
               if isinstance(c.get("raw"), (int, float))
               and not isinstance(c.get("raw"), bool)]
    assert numeric, "and some of those numbers are numbers"
    for c in numeric:
        # The text is a rounded reading of the raw value, not a different value.
        shown = c["text"].replace(",", "")
        if shown in ("", "—"):
            continue
        assert abs(float(shown) - c["raw"]) <= max(abs(c["raw"]), 1) * 0.01, c

    # The parameter is gone, and an unknown query parameter is simply ignored
    # rather than being an error, which is FastAPI's behavior and is fine: the
    # point is that it no longer changes anything.
    again = client.get(f"/v1/objects/{oid}/frame/summary?format=ir&precision=full")
    assert again.status_code == 200
    assert again.headers["ETag"] == r.headers["ETag"], "one document per frame"


def test_frame_ir_sparsifies_the_row_index(client):
    """The whole argument for building from the DataFrame, in one assertion.

    A portfolio's ``tail_df`` is indexed by ``(unit, T)``, so unit ``A`` owns ten
    return-period rows. The JSON wire format resets that index into a data column
    and the name is reprinted on every one of them; the document carries it once,
    as a stub cell spanning its block. Anything that flattens the index before
    building loses this, which is why the route reads the frame and not the
    payload.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/tail_df?format=ir")
    assert r.status_code == 200, r.text
    doc = r.json()

    assert doc["ir_version"] == 1
    assert doc["n_stub_levels"] == 2              # (unit, T)
    assert len(doc["body"]) > 10                  # several units' worth of rows

    stubs = [row["cells"][0] for row in doc["body"]]
    named = [c for c in stubs if isinstance(c, dict) and c.get("text") == "A"]
    assert len(named) == 1, "unit name repeated: the index was not sparsified"
    # 19 rungs per unit. The ladder ran 0.001 to 0.999 in 10 rungs up to a139
    # and is two sided upstream now, so this counted 10 before a140.
    assert named[0]["rowspan"] == 19


def test_the_library_flags_the_capital_anchors(client):
    """Row emphasis rides in the document, and the library is what puts it there.

    The flags are semantic (the total row is a ``total``, the 1-in-200 and
    1-in-250 lines carry ``emphasis``) so the SPA decides how they look, which
    is what deleted the positional BeautifulSoup pass the 5.x path needed.

    **Which lines those are is the library's to say**, and that is why the api's
    copy came out at a71. Which return periods a book is capitalized at is a
    fact about the practice, not about this service, and this repo had 200 and
    250 written into `_is_anchor` as a literal. The library flags exactly the
    same rows, so nothing moved on screen.

    Under the **insurer** perspective, which is the app's default and the point
    of the distinction: raw is the frame as computed and carries no emphasis,
    because emphasis is a reading.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    url = f"/v1/objects/{oid}/exhibit/tail"

    block = client.get(f"{url}?perspective=insurer").json()["blocks"][0]
    flags = [row.get("flags") or [] for row in block["body"]]
    # Four anchors per unit, and PF has A, B and total. Two until a139: the
    # ladder was one sided then, so only the 0.995 and 0.996 rungs were
    # anchors. It runs 0.001 to 0.999 now and the library flags the 1-in-200
    # and 1-in-250 lines at each end, which is the same rule on a longer frame.
    assert sum("emphasis" in f for f in flags) == 12
    assert sum("total" in f for f in flags) == 19     # every row of the total unit

    raw = client.get(f"{url}?perspective=raw").json()["blocks"][0]
    assert not any(r.get("flags") for r in raw["body"]), \
        "raw is the frame as computed; emphasis is a reading of it"


def test_frame_ir_carries_raw_values_beside_the_text(client):
    """``include_raw='data'`` is what makes a copy off the static table useful.

    Without it every numeric cell is a display string, so exporting from the
    rendered table would round-trip 1,399.00 rather than the value.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    doc = client.get(f"/v1/objects/{oid}/frame/tail_df?format=ir").json()

    numeric = [c for row in doc["body"] for c in row["cells"]
               if isinstance(c, dict) and "raw" in c]
    assert numeric, "no cell carried a raw value"
    assert any(isinstance(c["raw"], float) for c in numeric)


def test_frame_ir_is_deterministic_and_etagged(client):
    """Same object, same bytes. That is what makes the content hash a real ETag.

    ``canonical_json`` is the contract here, so the route must not re-serialize
    through Pydantic on the way out.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    first = client.get(f"/v1/objects/{oid}/frame/summary?format=ir")
    second = client.get(f"/v1/objects/{oid}/frame/summary?format=ir")

    assert first.content == second.content
    etag = first.headers["etag"]
    assert etag and etag == second.headers["etag"]

    cached = client.get(f"/v1/objects/{oid}/frame/summary",
                        headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert not cached.content


def test_frame_ir_truncates_a_density_frame(client):
    """A density frame degrades rather than failing, and says so.

    The SPA sends anything this long to the interactive grid, which is the honest
    instrument for it. A direct request still gets a readable answer: ``build``
    slices before it formats anything, so this costs nothing even at 2**16 rows.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    doc = client.get(f"/v1/objects/{oid}/frame/density_df?format=ir").json()

    assert len(doc["body"]) == 500
    assert any("Showing first 500" in note for note in doc.get("notes", []))


def test_frame_ir_rejects_an_unknown_frame_and_format(client):
    """Same resolver as the .csv route, so the same 404 and the same hint."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/not_a_frame")
    assert r.status_code == 404
    assert "unknown frame" in r.json()["detail"]

    r = client.get(f"/v1/objects/{oid}/frame/summary?format=html")
    assert r.status_code == 422


def test_frame_csv_still_wins_over_the_document_route(client):
    """Route order is load bearing and this is the tripwire.

    A path parameter matches a dot, so ``{which}`` on the document route would
    happily swallow ``summary.csv``. Starlette matches in declaration order, so
    the ``.csv`` route has to stay declared first. Move it and every download
    silently starts returning JSON.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/frame/summary.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]


# ----------------------------------------------------------------------
# One resolver: the document, the CSV and the screen agree
# ----------------------------------------------------------------------
# The JSON routes, the `.csv` download and `?format=ir` all answer "the frame
# called X". Until a35 they resolved it independently, and two of them drifted:
# `stats_df` and `reins_stats_df` drop their raw `ex*` moment rows on the JSON
# route only, so More > Stats showed 26 rows statically and 17 interactively.
# These are the tripwires for that whole class of bug, not just that instance.

# Which JSON route answers each `_CSV_FRAMES` name. The two densities are
# excluded: they are paginated previews by design, so a row-count match is not
# the invariant there.
_FRAME_ROUTES = {
    "summary": "summary",
    "tail_df": "tail_df",
    "validation_df": "validation_df",
    "stats_df": "stats_df",
    "bs_window_df": "bs_window_df",
    "reins_summary_df": "reins_summary_df",
    "reins_stats_df": "reins_stats_df",
}


@pytest.mark.parametrize("decl", [_DICE, _PORT, _REINS])
def test_document_and_json_routes_agree_on_every_frame(client, decl):
    """Same name, same rows, whichever route asks.

    Parametrized over the kinds because the divergence was shape dependent: a
    frame that an object does not carry 400s on both routes, which is agreement
    too, and only the frames it does carry can drift.
    """
    oid = client.post("/v1/objects", json={"decl": decl}).json()["id"]
    for which, route in _FRAME_ROUTES.items():
        frame = client.get(f"/v1/objects/{oid}/{route}")
        doc = client.get(f"/v1/objects/{oid}/frame/{which}?format=ir")
        if frame.status_code != 200:
            assert doc.status_code != 200, (
                f"{which}: the document route answered where the JSON one did not"
            )
            continue
        assert doc.status_code == 200, f"{which}: {doc.text}"
        assert len(doc.json()["body"]) == len(frame.json()["rows"]), (
            f"{which}: document has {len(doc.json()['body'])} rows, "
            f"JSON has {len(frame.json()['rows'])}"
        )


def test_raw_moment_rows_are_dropped_on_every_path(client):
    """The specific drift, pinned.

    ``stats_df`` carries ``ex1`` / ``ex2`` / ``ex3`` raw moments that nothing
    on screen wants. Dropping them used to happen in the JSON route alone, so the
    static table and the CSV download both carried nine rows the interactive
    table did not.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]

    rows = client.get(f"/v1/objects/{oid}/stats_df").json()["rows"]
    doc = client.get(f"/v1/objects/{oid}/frame/stats_df?format=ir").json()
    csv_text = client.get(f"/v1/objects/{oid}/frame/stats_df.csv").text

    assert len(doc["body"]) == len(rows)
    assert "ex1" not in csv_text
    texts = [c.get("text") if isinstance(c, dict) else c
             for row in doc["body"] for c in row["cells"]]
    assert "ex1" not in texts


def test_the_pricing_documents_declare_their_own_percents(client):
    """Percents resolve into the document, and the library is what resolves them.

    A loss ratio is a float and nothing in the dtype says it reads as a percent.
    ``tables.FORMATS`` said so for the pricing frames until a85, when the six
    entries went with the frames they described: the library registers the
    ``pricing.*`` exhibits and ships their formats resolved. The assertion is the
    same as before and the source of the answer is not, which is the whole of
    what that phase changed.

    Read off the allocate route since a103, which is where the book's per-unit
    allocation moved when Calibrate stopped paying for it.
    """
    oid = client.post("/v1/objects", json={"decl": _PORT}).json()["id"]
    body = client.post(f"/v1/objects/{oid}/pricing/allocate",
                       json={"p": 0.99, "coc": 0.1})
    assert body.status_code == 200, body.text
    blocks = body.json()["exhibits"]["pricing.allocate"]["insurer"]["blocks"]

    target = {"/".join(c["name"]): c.get("format") for c in blocks[0]["columns"]}
    assert target["LR"]["kind"] == "pct"
    assert target["ROE"]["kind"] == "pct"

    # A per-distortion slice's columns are units, so the whole slice takes the
    # statistic's format rather than a per-name one. The LR slice is the second
    # block of the insurer reading.
    for col in blocks[1]["columns"]:
        if (col.get("role") or "data") == "data":
            assert col["format"]["kind"] == "pct", col["name"]


# ----------------------------------------------------------------------
# Exhibits (library-owned business exhibits; [Exhibits-App-Endpoint])
# ----------------------------------------------------------------------

def test_exhibits_capability_listing(client):
    """The capability route passes ``available_exhibits`` through untouched.

    Names, titles and perspectives all come from the library registry; no per
    kind tables in the route. Deliberately not pinned to a literal list: the
    library owns the capability set, and re-pinning here every time an exhibit
    lands upstream would test nothing but our own bookkeeping. What is asserted
    is that the route is a faithful passthrough, over a floor of exhibits any
    aggregate must serve.
    """
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r = client.get(f"/v1/objects/{oid}/exhibits")
    assert r.status_code == 200, r.text
    items = r.json()["exhibits"]
    names = [e["name"] for e in items]
    assert {"summary", "tail", "stats", "validation"} <= set(names)
    assert len(names) == len(set(names)), "duplicate exhibit names"
    for e in items:
        assert e["perspectives"] == ["raw", "insurer"]
        assert e["title"]


def test_exhibits_capability_reins_gated(client):
    """The reins exhibit appears exactly when the object cedes."""
    oid = client.post("/v1/objects", json={"decl": _REINS}).json()["id"]
    names = [e["name"] for e in
             client.get(f"/v1/objects/{oid}/exhibits").json()["exhibits"]]
    assert "reins" in names


def test_exhibit_envelope_contract(client):
    """Envelope shape, ETag revalidation, byte determinism, 404 and 400."""
    oid = client.post("/v1/objects", json={"decl": _DICE}).json()["id"]
    r1 = client.get(f"/v1/objects/{oid}/exhibit/summary?perspective=insurer")
    assert r1.status_code == 200, r1.text
    env = r1.json()
    assert sorted(env) == ["blocks", "hash", "meta", "name", "perspective",
                           "title"]
    assert env["name"] == "summary" and env["perspective"] == "insurer"
    assert env["meta"]["blocks"] == ["summary_df"]
    # blocks are TableDoc canonical dicts (ir_version present, body rows)
    doc = env["blocks"][0]
    assert doc["ir_version"] == 1 and doc["body"]
    # the insurer view carries the migrated caption knowledge
    assert "blank by design" in doc["caption"]
    # ETag is the exhibit hash (sha256 over block doc hashes), quoted
    etag = r1.headers["ETag"]
    assert etag == f'"{env["hash"]}"' and len(env["hash"]) == 12
    r2 = client.get(
        f"/v1/objects/{oid}/exhibit/summary?perspective=insurer",
        headers={"If-None-Match": etag},
    )
    assert r2.status_code == 304
    # byte determinism: a fresh GET returns identical bytes
    r3 = client.get(f"/v1/objects/{oid}/exhibit/summary?perspective=insurer")
    assert r3.content == r1.content
    # raw and insurer are different documents
    r4 = client.get(f"/v1/objects/{oid}/exhibit/summary")
    assert r4.json()["hash"] != env["hash"]
    # unknown name -> 404 carrying the capability set
    r5 = client.get(f"/v1/objects/{oid}/exhibit/nope")
    assert r5.status_code == 404
    assert "summary" in r5.json()["detail"]
    # unavailable name (no cession) -> the same 404 family
    r6 = client.get(f"/v1/objects/{oid}/exhibit/reins")
    assert r6.status_code == 404
    # unsupported / unknown perspectives -> 400
    for p in ("reinsurer", "insured", "bogus"):
        r7 = client.get(f"/v1/objects/{oid}/exhibit/summary?perspective={p}")
        assert r7.status_code == 400, p
