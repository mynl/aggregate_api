# Execution notes, plan a198 (the 2026-10-07 punch list)

Companion to `plan-a198-punch-list.md`. One section per bump, divergences
recorded as they are made. Started 2026-10-07 against api `1.0.0a197`,
library `1.0.0a396`, plugin `0.8.0`.

Scope ruling, 2026-10-07: all five bumps across all three repositories in one
session, the plan's order unchanged.

## Review findings, taken before any edit

1. **The plugin's `0.8.0` is already taken.** It shipped as
   `[Waterfall-Capital-Catchup] 0.8.0`, reading the walk's new name and columns.
   The [pnl-emphasis] plugin edit therefore lands as **`0.9.0`**, not the
   `0.8.0` the plan names. Version arithmetic only; nothing about the edit
   changes.
2. **`composeTower` carries a zero-layer fallback** (`web/src/main.js`, around
   line 3070) that synthesizes a single `attach xs detach` layer when
   `generateTower` returns nothing. The plan asks a capped span with no width
   left to refuse through `layerRefusal`, so the cap is checked in the composer
   as well as honored in `generateTower`. One line more than the plan implies.

Everything else the plan asserts was verified against the current code and
holds: the line numbers, the symbol names, the quoted docstrings, and the
three rulings' premises.

## [quick-re] api 1.0.0a198, landed

Gates: `pytest` 482 passed, `npm test` 277 passed, `check-nav.mjs` clean.

Divergences, three:

1. **`_finish` does not gain a `label` argument, and does not report
   `min_rol`.** The plan puts both on `_finish`, which the indication path
   shares, and puts the two fields on `models.LayerQuote`. `_RESPONSE_CFG` is
   `extra="forbid"` and `LayerIndication` declares neither, so a row carrying
   them fails validation on `POST /v1/objects/{id}/layers/indication`. They are
   attached in `layer_quotes` instead, beside `sd_load`, `ph`, `dual` and
   `binds`, where the other quote-only fields already live. The new
   `_min_rol_premium` helper keeps the floor computed in one place, read by
   `_finish` for its floor and by `layer_quotes` for its candidate. Nothing the
   plan asks for is lost; the fallback numbering moves into `layer_quotes`,
   which sees the tier on every layer, so it numbers within tier without
   `price_clause` having to.
2. **`ROL` prints `.3%`, not the `ratio` reading the plan names.** `ratio` is
   `.1%` in the library's own format vocabulary, which would print a rate of
   0.1217 as `12.2%` beside a clause reading `rol 0.1217`. That is exactly the
   agreement `ROL_FIGS = 4` exists to produce, so three places is the format
   that honors it: `12.170%` on a working layer and `1.217%` at the top, across
   both decades a rate on line occupies. `LR` takes `.1%` as asked, and `CV`
   takes the plan's `.3f`, a multiple rather than a percentage.
3. **`composeTower` checks the cap itself**, as the review anticipated: its
   zero-layer fallback would otherwise synthesize a single layer over a span
   the cap has emptied. A cap at or below the attachment throws and names the
   limit; a span merely too narrow to stack still falls back to one layer,
   trimmed to the cap.

Two notes, neither a divergence:

- `generateTower(a, d, cap)` with `cap == d` is **not** a no-op. Uncapped, the
  stack is asked to reach `d` and so passes it, which is the 2026-10-06 ruling;
  capped on the same number, the overshoot is precisely what is disallowed. A
  test asserts both readings, since the first version of that test asserted they
  agreed and was wrong.
- Verified by hand on `agg.Capstone.SelectedLosses`: `policy_limit` reads
  10,000, as the plan predicts, and a cession of `2000 xs 3000 and 5000 xs 5000`
  comes back out of `reins_program` as `rol 0.2101` and `rol 0.03787`, verbatim
  and with no dust.

## [narrative-bounds] api 1.0.0a199, landed

Gates: `pytest` 483 passed, `npm test` 277 passed, `check-nav.mjs` clean.

One divergence, from a blast radius the plan does not mention:

4. **`reportPnlLedger` is a second reader of `net_of_expense_premium`**, and the
   plan accounts only for `showBoundsLeaf`. It writes the dormant Evaluate
   band's note, which said `Ledger: gross premium G, net of expense premium E`
   off the gross block. With the field now reading the closing block that
   sentence stays true of the number and false of the label, so the note names
   all three figures, matching the Calibrate preview line's new wording. Its
   docstring's "off the ledger's gross block (a185)" was wrong the moment the
   field moved and is corrected.

Verified against the real ledger before writing the test. `Capstone.PnL`'s
`economic_ratios_df` runs Gross, four occurrence layers, All occurrence, Net of
occurrence, QS, All; the gross block is 28,000 of premium against 7,000 of
expense (21,000, which is what the form used to seed) and the closing block is
6,015.625 against 1,134.765625, so `P - E` is 4,880.86. That is the plan's
4,881 to the rounding.

The new `PNL_CEDED` fixture's premium figures are grid independent, which is
why they are asserted exactly: `derive premium` grosses 1,000 technical up to
1,333.33 for the 25 percent G&A, the share cedes half of that at `rate 1`, and
`cede 0.2` returns 133.33 of ceding commission as a contra expense. Only the
loss column comes off the FFT.

## [pnl-emphasis] library 1.0.0a397 and plugin 0.9.0, landed

Gates: library `pytest -m 'slow or not slow'` 5621 passed; plugin suite 58
passed; api `pytest` 483 passed after the re-sync.

Divergences:

5. **The plugin landed as `0.9.0`, not the `0.8.0` the plan names.** Taken by
   `[Waterfall-Capital-Catchup]`. Recorded at review; see above.
6. **The golden CSVs lost their `CR` column by deletion, not regeneration.**
   `reference/data/gini_view45_actuals*.csv` are the approved outputs and the
   file's own docstring says any drift is a porting bug. Dropping `CR` from each
   file and leaving every other number alone is what keeps that guarantee: the
   suite then passes with the approved values untouched, which is the proof that
   reading `Margin ratio` directly reproduces the `1 - cr` the page computed.
   Regenerating the files would have hidden any other drift.
7. **`_ratio_row_flags` and the waterfall flag block gained a `len(df)` guard**
   before flagging row 0, which the plan's "flag row 0" does not mention. An
   empty frame has no row 0.
8. **`docs/2_aggregate_overview/features.rst` follows the rename**, in two
   passages the plan does not list: the `waterfall_df` walkthrough said "the
   combined ratio (the margin per unit of premium being `1 - CR`)", and the
   a390 breaking-change note said the `Margin ratio` column "is gone". Both
   would have been wrong on the shipped version.
9. **The new row-flags test builds its own two-tier ledger.** A net-of-tier row
   needs **both** tiers, and no `test_exhibits.py` fixture has them: `Tower`
   cedes one occurrence layer and `Peel` cedes two, and neither closes a tier,
   so `_net_span_labels` is empty on both. The first two versions of this test
   asserted against those fixtures and failed for that reason.

`tests/data/exhibit_snapshots.json` regenerated, 137 insertions and 71
deletions, and the diff read line by line before committing: eleven cases, each
showing the `CR` to `Margin ratio` header rename, one `subtotal` flag added, the
two rewritten captions, and the column's values flipped. Every flipped pair is
exactly `1 - old`: 70.0 to 30.0, 50.3 to 49.7, 51.1 to 48.9, 72.1 to 27.9, and
on the ceded rows 309.7 to -209.7, 206.3 to -106.3, 247.7 to -147.7. Nothing
else moved.

## [reins-labels] library 1.0.0a398, landed

Gate: library `pytest -m 'slow or not slow'` 5622 passed.

One divergence:

10. **`NAMES` splits into `SEV_NAMES` and `AGG_NAMES`** rather than the annual
    names being inlined. `tests/test_chart_reins.py` imports `NAMES` and asserts
    both panels against it, so a module constant was already the surface; two
    named constants keep the test able to say which triple it means, and keep
    the one-line revert the plan promises a one-line revert.

## [capstone] library 1.0.0a399 and api 1.0.0a200, landed

Gates: library `pytest -m 'slow or not slow'` 5622 passed; api `pytest` 483
passed, `npm test` 277 passed, `check-nav.mjs` clean.

No divergences from the plan's text. The entry is the plan's verbatim, including
its bare-fraction `rate 1 cede 0.30` spelling, where the surrounding entries
write `rate 100% cede 32.5%`. Left as the plan spells it, the author having
written the entry out; worth a glance if the file is meant to read uniformly.

Verified before writing it: the program builds, `peel top-down` produces the
nine-row ledger (gross, four occurrence layers top-down, All occurrence, Net of
occurrence, Capped QS, All), and the cap bites. Ceded loss is 11,963.79 against
`Capstone.FullProgram`'s unlimited 12,131.25, so the 20,000 cap is doing visible
work rather than being decoration. `build.recipe('Capstone.Capped').seq` is 20,
the position `Capstone.PC` held, so the Examples menu order is unchanged.

## What was left behind, deliberately

In `V:/dev/aggregate-api`: `dev/plan-demo-load.md` and `dev/scripts/loadtest/`,
both untracked and the author's.

In `V:/worktrees/aggregate_REFACTOR`: a concurrent tidying pass, running in
another session during this one. Modified `.gitignore`, `README.md`, `CLAUDE.md`,
`dev/TODO.md`, `dev/FEATURES.csv`, `uv.lock`, `.claude/skills/execute-plan` and
`.claude/skills/test-tiers`; `plan-for-v1.md` deleted; a rename of
`dev/plan-a376-plugins-and-extension-surface.md` into `dev/done/` **staged in
the index**, and left staged.

**One file collided and it is worth recording.** That pass removes
`pytest-testmon` from the dev extras in `pyproject.toml`, which is also where
the version line lives, and `git commit -- <path>` takes working-tree content
rather than the index. So the removal rode into a397 and then into a398, and
both were amended to carry the version line alone. a399 was committed as one
atomic block instead: restore the four lines, commit, remove them again. All
three bumps show `pyproject.toml | 2 +-` and the removal is still uncommitted
for the author.

In `V:/dev/aggregate-relativity`: `src/aggregate_relativity/chart.py`, one
line, the author's.

## The re-sync dance, three times

`uv sync --extra dev` prunes the relativity plugin on every run, so each library
bump needed `uv pip install -e V:/dev/aggregate-relativity` after it or the Lab
tab would go dark for a reason unrelated to anything in this plan. Final state:
`aggregate 1.0.0a399`, `aggregate-api 1.0.0a200`, `aggregate-relativity 0.9.0`.
