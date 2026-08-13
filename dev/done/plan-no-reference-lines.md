# Plan [Chart-Marks-Mean-Only]: the percentile lines come off, the mean stays

> **Status: EXECUTED, LIB `1.0.0a271` and API `1.0.0a98`, moved to done
> 2026-08-13.** L1 to L5 and A1 to A3 landed as written, with no divergence
> from the plan. LIB: the three emitters, the two docstrings, the three tests
> plus a new negative guard `tests/test_chart_marks.py`, the regenerated
> `agg.png` baseline on matplotlib 3.10.9, and the two doc tables. Full suite
> 4202 passed. API: the tooltip and two comments, fixtures re-captured,
> `smoke-charts.mjs` all clear, 242 tests passed. `doc.marks` is 1 for `agg`
> and `port` and 3 for `pnl`, from 4, 3 and 5, exactly as predicted below, and
> the smoke script's own `marks=` column reads 1, 1 and 2.
>
> **Browser pass done, all four points.** One dashed vertical at the mean on
> each density panel and nothing anywhere else except the P&L's two break even
> marks; the `agg` Lee panel and the `port` kappa panel clean; the control
> still hides and shows what is left; the readout strip answers a percentile
> by hover, reading `Return period 1-in-889 · margin −53.0625` on the P&L Lee
> panel under `return period`.
>
> **The one open judgment, left as the plan left it.** The mean's label does
> change side: as the only vertical it takes the right by the `rightmost`
> rule, where a66 said the mean opens left. It reads clean on all three
> charts, and it agrees with the P&L density panel, where break even opens
> left and the mean right, so nothing was changed. The one-line fix in
> `markLineEntry` stands available if the author reads it the other way.
>
> **Not done here, because it cannot be:** `uv sync --extra dev` re-recorded
> `aggregate` at a271, but the API's own a98 could not be recorded. A running
> `aggregate-api.exe` (PID 30900) holds the console script and is not
> terminable from this session, so `/v1/meta` and the About panel report
> `api 1.0.0a97` until that process is stopped and a sync is rerun.

Written 2026-08-13 on the author's instruction: the
percentile reference lines have been a nightmare, they do not really work, and
they are redundant now that the readout strip reports any coordinate the
reader hovers. The mean is handy and stays.

Canonical here, symlinked into `aggregate_REFACTOR\dev\`, the `plan-3d-plot`
and `plan-pricing-exhibits` arrangement. Most of the work is the library's.

Checked against both trees 2026-08-13: every site named below exists and reads
as described. The library line numbers have drifted by a few, because a269
(`[Chart-Reflected-Reading]`) edited the same three emitters, `ir.py`, the
chart tests and the same doc rows; find the code by its name rather than its
line. That also means L5's five doc rows were rewritten hours earlier to carry
`reflect` and the `survival` axis, so the Marks column is a small amendment to
fresh text rather than an edit to stale text.

## Context

Reference lines have been reopened in every punchup round and never settled.
Round III asked the button to govern mean, 100 year and 200 year together
(`dev\api-punchlist.md:226`) and asked for a side rule so the labels stop
overlapping (`:227`). Round 5 reported the annotations "mostly lost", with the
200 year label floating above the plot area. App side the feature was built at
a22, rebuilt at a50, deleted at a62 with the move onto chart documents, and
brought back as a control at a66 with an outermost-goes-right side rule
invented to keep two labels apart. LIB side the anchors moved from
`(100, 250)` to a Solvency II reading and back. The a22 CHANGELOG line already
says the quiet part: "three dashed verticals over a density say nothing three
times".

Meanwhile the thing that made them redundant shipped. `readoutModel`
(`web\src\charts\chartdoc-to-echarts.js:1505`) plus the axis pointer writes
every series value at the hovered coordinate into the legend strip, and
`readValue` (`:1477`) already prints a return-period axis as `1-in-N`. A
reader who wants the 200 year point hovers and reads it. A permanent dashed
vertical asserting the same number costs a label collision rule, a side rule,
a faint weight, and an upstream ask, and returns a number the reader can get
by pointing at it.

So the percentile marks come out. The mean stays, because it is the one
number that is not discoverable by hovering: it is a property of the whole
distribution rather than a point on the curve.

The open pip `- [ ] reference lines JNWTSq?` (`T:\worktrees\dev-files.md:96`)
appears to be the seed of this instruction.

## What this costs, stated plainly

This drops the full-weight 1-in-200 as well, since it is a percentile point.
Three CHANGELOG entries treat that one as the answer the reader came for
(a22, a50, LIB a235), and LIB `_emit_portfolio.py:198-200` argues the kappa
panel's copy is doing analytical work: read up from the capital line and each
unit's share there is its share of the loss. That reading is now a hover
rather than a line. Recorded here so the trade is on the record rather than
discovered later.

It also supersedes a standing dated ruling. Round 5 ask 4 (author,
2026-08-10) asked for the density panel to carry mean, 1-in-100 **and**
1-in-200, with only 1-in-250 coming off. That ask was never executed, so
there is no code to unwind, but the note and the pip are struck rather than
edited.

## Decisions taken (author, 2026-08-13)

1. **Break even stays.** The PnL `break_even` marks at zero, vertical on
   density and horizontal on Lee, are not percentile points. LIB
   `dev\done\plan-chart-ir.md:224` calls the zero of a signed outcome axis
   "the reading, not decoration". Only `capital_anchor` marks go.
2. **Panels left with no marks stay that way.** The `agg` Lee panel and the
   `port` kappa panel lose their only marks. Nothing is added to replace
   them. The change is purely subtractive: no new mark is emitted anywhere.
3. **The app's reference lines control stays.** It still governs the marks
   the document carries, which after this is the mean and break even. Only
   its tooltip text changes, since that text names the capital anchors.

## What does not change, and why

- **`CHART_IR_VERSION` stays 2.** The rule is written at `charts\ir.py:87-104`:
  the version moves when a reader ignoring what it does not know would draw
  something *wrong*, which means a field a reader must act on, a changed
  meaning, or a field removal. Emitting fewer instances of an existing record
  is none of those. Every content hash changes, and `ir.py:91` names that case
  explicitly as not qualifying.
- **The `Mark` dataclass, `ChartDoc.marks`, and `MARK_ROLES` are untouched.**
  The mean and break even still travel as marks, so the whole mechanism
  stays. `'capital_anchor'` stays in `MARK_ROLES`: that tuple documents what a
  mark *may* say, not what the shipped emitters happen to say, and a future
  reader wanting an anchor should find the word already spelled.
- **`Mark.faint` stays a field.** After this no shipped emitter sets it, but
  removing a field is the one edit that would bump the IR version. Its
  docstring gloss loses the capital-anchor example.
- **The matplotlib compositor is untouched.** `plots\_chartdoc.py:535-547`
  loops `doc.marks` generically and keys only off `faint`. Fewer marks arrive
  and it draws fewer lines.
- **The whole app rendering path is untouched.** `markLineEntry` and
  `markLine` (`chartdoc-to-echarts.js:1019-1100`) still draw the mean. Under
  the purist ruling the app draws what it is served, so the lines disappear
  from the browser with no app-side deletion at all.

## LIB work (`aggregate_REFACTOR`, owns the meaning)

### L1. The three emitters

- **`src\aggregate\charts\_emit_aggregate.py`**: delete `CAPITAL_ANCHOR`
  (`:36-38`) and `LEE_ANCHORS` (`:40-44`). Delete the
  `anchors = agg.tail_periods_df(...)` call (`:211`) and both anchor marks, so
  `marks` is the single mean `Mark`. `outcome_doc`'s `marks=` parameter and
  `COMPANION_HEADROOM` are unrelated and stay.
- **`src\aggregate\charts\_emit_pnl.py`**: drop `CAPITAL_ANCHOR, LEE_ANCHORS`
  from the `:31` import, keeping `outcome_doc`. Delete `:73` and the anchor
  comprehension `:80-83`, leaving the two break-even marks and the mean.
  Rewrite the Notes paragraph at `:64-69`, which currently explains the
  anchors and the reciprocal map.
- **`src\aggregate\charts\_emit_portfolio.py`**: drop `CAPITAL_ANCHOR` from
  the `:45` import, keeping `COMPANION_HEADROOM`. Delete
  `anchor = float(port.q(1 - 1 / CAPITAL_ANCHOR))` (`:156`) and reduce
  `marks=` (`:193-204`) to the mean alone, taking the kappa mark and its
  three-line comment with it.

After L1, `tail_periods_df` has no chart-side caller. It is public API used by
the `tail` exhibit and stays.

Untouched and worth stating so nobody widens the edit: `exhibits\_core.py:75`
`CAPITAL_ANCHOR_PERIODS = (200.0, 250.0)` drives row emphasis in the `tail`
**table**, which has room for both. Round 5 ask 4 scoped itself the same way.

### L2. Docstring truth

- `charts\ir.py:903-906`, the `Mark.faint` gloss, loses "the paired capital
  anchors on the tail panel" as its example of a de-emphasized mark.
- `_emit_severity.py:105` currently reads "No marks: a severity chart carries
  no mean line and no capital anchors". Still true, but check the phrasing
  still earns its place once anchors are not a thing other charts have.

### L3. Tests

Update the three that pin the anchors:

- `tests\test_chart_agg.py`: `:25` import, and
  `test_marks_carry_their_reading` (`:156-166`) becomes one mark, the mean at
  `est_m`, not faint. `:214` (`the marks are not curves`) stays valid.
- `tests\test_chart_pnl.py`: `:21` import, `:65-71`, `:74-78`, and `:98-103`,
  the test that the rendered verticals land on 100 and 250 under the
  return-period reading. Break even keeps its coverage.
- `tests\test_chart_port.py`: `:27` import and `:122-128`.

`tests\test_chart_severity.py:56` (`doc.marks == ()`) stays as is.
`tests\test_charts_ir.py` and `tests\test_chartdoc_readings.py` build
synthetic documents, including one with a `capital_anchor` role, and are
deliberately left alone: they test the schema, which keeps the role.

**Add one guard** so this cannot creep back: over every registered chart on a
built `agg`, `port` and `pnl`, assert no emitted mark has
`role == 'capital_anchor'`. A negative test is what stops a future anchor
being reintroduced one emitter at a time.

### L4. The rendered baseline

`tests\data\chartdoc_baselines\agg.png` changes and must be regenerated:
`.venv\Scripts\python.exe tests\test_chartdoc_render.py --regen`. Note the
pin at `tests\test_chartdoc_render.py:42`: the test **skips** on any
matplotlib other than 3.10.9, so a regen on the wrong build silently produces
a baseline nothing checks. `distortion.png` is unaffected, that chart emits no
marks.

### L5. Docs and CHANGELOG

- `dev\summary-exhibits-and-charts.md` first, then re-transcribe into
  `docs\2_aggregate_overview\pipeline-exhibits-and-charts.rst`. The provenance
  note at `:234` says to edit in that order. The Marks column rows to change
  are `:250`, `:256`, `:262`, `:268` and `:280`.
- `docs\3_reference\3_x_Charts.rst`: check the prose at `:8` and the `Mark`
  autodoc entry at `:70` for anchor language.
- CHANGELOG section under the new version, `[Chart-Marks-Mean-Only]`, carrying
  the reasoning from the Context section above rather than a list of deleted
  lines.

## API work (`aggregate_api`, small)

### A1. The control's own words

`web\src\charts\mount.js:177-183`, the title string reads "Show the mean and
the capital anchors the document marks, drawn on the panels that carry them".
Reword to name what survives. The comment at `:65`
(`refLines: true, // the document's marks: mean, capital anchors`) goes the
same way. No behavior change: the control, the `refLines` view key, the
`offer` indirection at `:486` and the stored `aggapi.chartView.v4` all stay,
and a stored `false` stays honored.

### A2. Sync and re-capture

Per the oversight charter's agreement 7, after the LIB bump the API needs
`uv sync --extra dev` or `/v1/meta` and the About panel report a stale
`aggregate` version. Stop any running server first: `uv sync` fails with
`os error 32` on a locked `aggregate-api.exe`. Then re-capture
`dev\fixtures\charts.json`, which is derived and gitignored, and rerun
`node dev\scripts\smoke-charts.mjs`.

Its load-bearing assertion, `drawn === doc.marks.length`
(`smoke-charts.mjs:296-308`), stays correct unchanged: it compares what was
drawn against what arrived, so it verifies the smaller set just as well.
`:115`, which allows mark labels into the "every string came from the
document" check, also stays correct.

### A3. Cleanups while in the files, per the legacy-gloss rule

- `web\src\main.js:65` and `:195-197`: `state.mean` is commented "for the
  exhibit's reference line" and "The exhibit draws a mean reference line".
  Stale since a62. It now feeds only a summary chip (`:589`) and the pricing
  premium default (`:2730`). Fix the comments; do not touch the value.
- `chartdoc-to-echarts.js:957-968`, the `rightmost` side rule, goes inert with
  at most one vertical mark per panel. **Leave it**: it is correct for one
  mark and correct again if a second ever returns. See the browser-pass note
  below for the one thing to look at.

## Ledger: what this closes

| Where | Item | Disposition |
|---|---|---|
| `T:\worktrees\dev-files.md` | `reference lines JNWTSq?` | already gone, struck 2026-08-13 |
| `T:\worktrees\dev-files.md` | LIB pip, round 5 ask 4 | already gone, struck 2026-08-13 |
| API `dev\TODO.md` | round 5 ask 4, app mirror | already struck, records this plan as the supersession |
| API `dev\api-punchlist.md:226` | ref lines button governs mean, 100, 200 | partly superseded: button stays, the quantiles clause dies |
| API `dev\api-punchlist.md:227` | 1-in-200 label to the right so they do not overlap | superseded, there is nothing left to overlap |
| LIB `dev\done\note-from-aggregate-api-round-5.md` | header says ask 4 open at a263 | ask 4 closes by supersession, note is fully done |

Round 5's punchup item "we've lost the Annotations option (mean, 1/100,
1/200 or 250)" is answered by this plan rather than fixed.

## Order of work

LIB first, because it owns the meaning and the app needs nothing to follow.
L1 through L5 in one version bump, then A1 through A3 in one API bump taken
together with the sync. The numbers first written here, LIB `1.0.0a267` and
API `1.0.0a94`, were overtaken while this sat: LIB is at `1.0.0a269` and the
API at `1.0.0a96`, so read them as the next bump on each side rather than as
those two values.

## Verification

**LIB.** `uv run pytest` clean, including the new `capital_anchor` guard.
Regenerate `agg.png` on matplotlib 3.10.9 and read the diff deliberately: the
density panel should lose one vertical and keep the mean, the Lee panel should
lose both.

**API.** Stop the server, `uv sync --extra dev`, `uv run pytest`, re-capture
`dev\fixtures\charts.json`, `node dev\scripts\smoke-charts.mjs` clean with
`doc.marks.length` now 1 (`agg`, `port`) and 3 (`pnl`), from 4, 3 and 5.

Do not read those three numbers off the smoke script's own `marks=` column,
which counts **series carrying a `markLine`**, one per marked panel, rather
than marks (`smoke-charts.mjs:309`). That column reads 2 for both `agg` and
`pnl` today, and afterwards reads 1 for `agg`, whose lee panel empties, 1 for
`port`, and still 2 for `pnl`, which keeps a mark on each panel. The count the
numbers above describe is the one the load-bearing assertion at `:325-328`
compares against.

**Browser pass, and this one matters**, because every prior round of this
feature was signed off on tests and then failed on sight. Build an `agg`, a
`port` and a `pnl`:

- one dashed vertical at the mean on each density panel, none anywhere else,
  except the PnL's two break-even marks;
- the `agg` Lee panel and the `port` kappa panel clean;
- the reference lines control still hides and shows what is left;
- **the mean's label side.** It changes. `rightmost` gives the right side to
  the vertical mark with the largest `at`, which used to be the 1-in-200, so
  the mean drew left; as the only vertical it now draws right. If that reads
  wrong against the a66 layout ruling ("mean opens left"), the fix is one line
  in `markLineEntry`.
