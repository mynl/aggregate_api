# Plan a194: the P&L exhibits, rationalized

**Scope: library (`aggregate`) plus this repo.** Most of the work is upstream.
The api needs no new route; the SPA needs one new leaf and a handful of label
and ordering edits.

Written for a reader with no conversation context. File references are to this
repo (`V:\dev\aggregate-api`) unless marked *upstream*, which is the sibling
checkout named in `[tool.uv.sources]`, currently
`../../worktrees/aggregate_REFACTOR`. References marked *aSP* are to
`V:\dev\aggregate-asp`, a sibling experiment that is being retired; the parts
of it worth keeping are being folded back here, and this plan is one of three
doing that. The other two are `dev/plan-a193-quick-re-tower.md` and
`dev/plan-a195-pnl-pentagon.md`.

Land this one **after** a193 and **before** a195, which depends on its column
rename and its parametrized capital.

Date drafted: 2026-10-06.

---

## Goal

A reader who builds a P&L should find the engine's view of the book under
**Overview** and the P&L's own view under **PnL**, with no overlap, and the
P&L group should answer the three questions an underwriter actually asks: what
did we write, where did the margin go, and what does the line by line look
like.

Today those readings are spread across both groups, two of them duplicate each
other, and the pricing walk that aSP proved out has no home at all.

---

## Current behavior

### What the two groups serve

`web/src/nav.js`, `NAV_GROUPS`. For a P&L:

| Leaf | Exhibit | Frame it draws |
|---|---|---|
| Overview / Plot | primary chart | the engine's |
| Overview / Summary | `summary` | `PnL.summary_df`, the P&L's own card |
| Overview / Validation | `validation` | **the engine's** `engine_validation_df`, plus the ledger audit when non-empty |
| Overview / Stats | `stats` | the engine's moment store |
| Overview / Tail | `tail` | `PnL.tail_df`, the closing margin's return periods |
| PnL / Summary (key `ratios`) | `economic_ratios` | `economic_ratios_df` and `legs_df` |
| PnL / Waterfall | `economic_waterfall` | `walk_df` and `evaluation_df` |
| PnL / Ledger | `economic` | `economic_df`, plus `economic_marginal_df` on RAW |

So Overview is already *mostly* the engine: Plot, Validation and Stats all look
through to the wrapped book. Only Summary and Tail serve the P&L's own
quantities, which is why the group reads as two things at once.

### The duplication

`PnL / Ledger` under INSURER (upstream `exhibits/_pnl.py`, `_economic_insurer`)
shows `EX`, `SD`, `CV` and the adverse scenario state `κ01`, by Step, Side and
Label. `Overview / Summary` shows `EX`, `SD`, `CV`, `Skew`, `P01`, `Median`,
`P99`, by Step and Side. The Ledger is the better of the two for daily reading
because it splits loss from expense inside the obligation; the card is better
only in carrying `Skew` and a three-point marginal ladder.

Nothing is actually lost by retiring the card from the app: the RAW Ledger's
second block is `economic_marginal_df`, which is the full marginal percentile
ladder, and `Skew` is one entry in a tuple away from the INSURER ledger.

### The PnL Summary and Waterfall

`PnL / Summary` draws two tables under INSURER, because
`_economic_ratios_insurer` splits amounts from ratios under the reporting rule
that a column carries one unit. The ratio table carries eight columns: `LR`,
`ER`, `CR`, `E_LR`, `E_ER`, `E_CR`, `P_share`, `M_share`.

`PnL / Waterfall` draws two tables: `walk_df`
(`Margin`, `M01 standalone`, `M01 div net`, `M01 div gross`) and
`evaluation_df` (`Premium spent`, `Margin spent`, `CR`, `Margin ratio`, `MSD`,
`SA CoC`, `Div CoC net`, `Div CoC gross`). The split is by unit: currency, then
ratios.

### What aSP proved out

aSP's Pricing card (`js/pricing.js`, `renderWalk`) draws **one** table whose
rows are exactly the blocks of `economic_ratios_df` and whose columns are
`premium, loss, expense, margin, sd, LR, ER, CR`, with four balance sheet
columns appended on the two rows that are a whole book. It reads better than
either of the two tables it replaces, because the thing an underwriter does
with it is read across a row.

The only column it has that this repo cannot already serve is `sd`, which is
the standard deviation of that block's result. With premium and expense fixed
on a block, the result is the loss shifted, so this is the loss standard
deviation. It already exists, on the ledger's own result row for the same step.

---

## Target layout

| Group | Leaf | Source |
|---|---|---|
| Overview | Plot | engine (unchanged) |
| Overview | Summary | **the engine's** `summary_df` |
| Overview | Validation | engine (unchanged) |
| Overview | Stats | engine (unchanged) |
| Overview | Tail | **the engine's** `tail_df` |
| PnL | Summary | the aSP walk: amounts, `SD`, and the three plain ratios, in **one** table |
| PnL | Waterfall | the merged walk, two blocks, split after `MSD` |
| PnL | Ledger | as today, plus `Skew` |
| PnL | Tail | **new**: the closing margin's return periods |
| PnL | Pentagon | **not in this plan**; see `dev/plan-a195-pnl-pentagon.md` |

Overview becomes uniformly the engine. The PnL group becomes uniformly the
ledger. The P&L's own card (`PnL.summary_df`) stays a public library frame and
keeps its place in `qd` and the notebook repr; it simply no longer has a leaf.

---

## The change, upstream

All in the sibling checkout. Each step names the file.

### [overview-engine] `summary` and `tail` look through to the engine

`src/aggregate/exhibits/_pnl.py`. Register PnL frames builders for the generic
`summary` and `tail` exhibits that serve `obj.engine`'s frames, exactly as
`_validation_frames` already does for `validation` (that function is the
template, and the precedent: a P&L's exhibit under a generic name serving the
wrapped engine's frame is already the established treatment).

Captions must say which book is being described, since a reader arriving from a
P&L needs to know these are the **gross** book's moments and ladder and not the
ledger's.

A kernel P&L (built from grids, carrying no engine) serves neither, so Overview
greys for it. That is honest and the capability machinery already handles it:
`available_exhibits` drives the nav gating and `nav.js` needs no edit.

### [pnl-summary-sd] an `SD` column on `economic_ratios_df`

`src/aggregate/_pnl.py`, the `economic_ratios_df` property (around line 2216).

Add one column, `SD`, the standard deviation of that block's result, read off
the same row `_waterfall_frames` reads for its `Margin` and `MSD`
(`self.economic_df.iloc[pos]['SD']`, via `_step_result_rows`).

Put it on the frame rather than joining it in the exhibit treatment, so the
walk's `MSD` and the Summary's `SD` cannot come from two sources and disagree.

**The row sets are not identical by construction.** `_waterfall_frames` already
iterates `ratios.index` and skips any step with no result row of its own, so
some ratio rows may have no SD. Follow the declining rule the rest of the
presentation code uses (`_ledger_row_flags`, `_ratio_row_flags`): where there
is no result row, the cell is `NaN`, never a guess.

Column order on the frame: `P, L, E, M, SD, LR, ER, CR, E_LR, E_ER, E_CR,
P_share, M_share`. `_RATIO_COLS` moves accordingly.

### [pnl-summary-one-table] one block, amounts and ratios together

`src/aggregate/exhibits/_pnl.py`, `_economic_ratios_insurer` (line 270).

Replace the two-block split with one block carrying
`P, L, E, M, SD, LR, ER, CR`, in that order. Keep `_ratio_row_flags` exactly as
it is: the total on the last row and the net-of-tier rows muted.

This **reverses the reporting rule** that a column carries one unit, which is
what produced the split. Reverse it here, in the treatment, with the reason
written down: the walk is read across a row, the money and the ratio of that
money belong beside each other, and `greater_tables` resolves formats per
column name so nothing about the mixed block is hard to render. Do not work
around it in the app.

The `E_LR`, `E_ER`, `E_CR`, `P_share` and `M_share` columns, and the `legs_df`
block, stay on RAW. They are not deleted. The author's instruction was to lose
the expected ratios from the sheet that gets read every time; the RAW toggle is
exactly the mechanism for that, and the `E_` columns are the one thing that
tells you a retro, swing or profit-commission cession is behaving as
advertised. aSP never had a RAW toggle, which is why it never had to choose.

The caption keeps the existing explanation of what `LR`, `ER` and `CR` are
(ratios of means, the convention of a rate filing, re-derived from each block's
own amounts) and gains one sentence saying where the `E_` columns went.

### [capital-rename] six columns renamed, three signs flipped

`src/aggregate/_pnl.py`, `_waterfall_frames` (line 2368) and the docstrings on
`walk_df` and `evaluation_df`. Also both format sheets,
`src/aggregate/formats/formats-raw.yaml` and `formats-insurer.yaml`, which are
keyed by column name.

| Today | Becomes | Note |
|---|---|---|
| `M01 standalone` | `Capital standalone` | **sign flips**: the column is now `-M01` |
| `M01 div net` | `Capital net` | sign flips |
| `M01 div gross` | `Capital gross` | sign flips |
| `SA CoC` | `CoC standalone` | unchanged value |
| `Div CoC net` | `CoC net` | unchanged value |
| `Div CoC gross` | `CoC gross` | unchanged value |

Three things fall out of this at once, which is why it is worth the breaking
rename:

1. **The return period leaves the column name.** `M01` hard-codes 1-in-100 into
   a header. a195 makes that level a parameter, and a parametrized frame whose
   column names change with the parameter would churn both format sheets on
   every level. With the level out of the name, the sheets are stable and the
   level rides in the caption, in the block heading and in the frame's
   `.attrs`.
2. **The sign becomes the thing you read.** Capital held, not margin in the bad
   state. On a ceded row the value goes negative and reads correctly as capital
   released.
3. **`_capital_ratio`'s double negative disappears.** It becomes margin over
   capital, on every row, with no explanation. The function
   (`src/aggregate/_pnl.py:826`) keeps its guard on a vanishing denominator and
   loses its negation and most of its docstring.

**These capital amounts are notional.** Nothing in the ledger is truncated at
them, no default is modeled, no loss is limited by them. They are the capital
the state calls for, read off a quantile. Every caption that carries them must
say so in a sentence. This is the author's standing correction and it belongs
in the frame's own documentation, not just in a plan.

### [pnl-waterfall-merge] one frame, two blocks, split after MSD

`src/aggregate/_pnl.py`: `_waterfall_frames` already builds both frames in one
pass, so publish the join as well. Keep `walk_df` and `evaluation_df` as they
are (they are public and documented), and add `waterfall_df`, the two joined on
`Step` in this column order:

```
Premium spent | Margin spent | CR | Margin | MSD |
Capital standalone | Capital net | Capital gross |
CoC standalone | CoC net | CoC gross
```

`Margin ratio` is dropped from the merged frame: it is `1 - CR` and sits
beside `CR`.

`src/aggregate/exhibits/_pnl.py`, `_economic_waterfall_frames` (line 319):
serve `waterfall_df` as two blocks, split after `MSD`.

The split is now **by question rather than by unit**, and that is the point of
the change. The first block is the walk: what each step spends and what it
earns. The second block is three capital bases, each beside its own cost of
capital, which is the comparison the frame exists to support and which today
requires reading across two tables.

Captions: the two existing ones (`walk_caption`, `evaluation_caption`) carry
real content about the two conditionings, the two-sided standalone reading and
the sign convention, and most of it survives. Rework rather than rewrite, and
add the notional-capital sentence.

### [pnl-ledger-skew] `Skew` back on the abbreviated ledger

`src/aggregate/exhibits/_pnl.py`, `LEDGER_MOMENTS` (line 163):
`('EX', 'SD', 'CV', 'Skew')`.

The comment above it explains why it came off ([Ledger-Insurer-Abbreviated]:
level, spread and one tail is the reading a ledger is scanned for). Replace the
comment rather than leaving it to contradict the tuple: the card that carried
`Skew` is being retired from the app, and the ledger inherits it.

### [pnl-tail] a new exhibit for the closing margin's ladder

`src/aggregate/exhibits/_core.py` and `_pnl.py`: register a new exhibit,
`economic_tail`, serving `PnL.tail_df`. It joins the accounting family
(`economic`, `economic_ratios`, `economic_waterfall`), which is the family of a
P&L's own frames; the plain `tail` name now belongs to the engine, per
[overview-engine].

**Read the warning on `tail_periods_df` before writing the treatment**
(`src/aggregate/_pnl.py:1623`). `GridDistribution.tvar` is the upper tail
measure `E[X | X > VaR(p)]` at every `p`, with no orientation flip. A P&L is a
payoff, read off the lower half of the ladder, so on the small-`p` rows (the
ones this leaf exists for) the `TVaR` column averages almost the whole
distribution and sits near the mean. It pairs the downside `VaR` with the other
side's conditional mean. The library records this and has not fixed it; the
matching measure, `E[X | X <= VaR(p)]`, is not computed today.

A new leaf makes that column prominent exactly where it misleads. See
**Open question Q2**.

---

## The change, this repo

### [nav] one new leaf, one reorder

`web/src/nav.js`, `NAV_GROUPS.economics.leaves`. Add `tail` after `ledger`:

```js
tail: {
    label: 'Tail',
    exhibit: 'economic_tail',
    why: 'a P&L only',
    hint: 'VaR, TVaR and xsVaR on the closing margin, by return period',
},
```

Key order is row order and `activeLeaf` lands on the first live leaf, so a
freshly built P&L still opens on Summary. Nothing else in the skeleton moves:
Overview's `summary` and `tail` leaves keep their names and simply resolve to
different frames for a P&L, which is the whole point of gating on
`available_exhibits`.

Update the `why` on `overview.tail`, which currently reads "needs a full loss
distribution: an aggregate, a portfolio, or a P&L over its closing margin". The
closing margin clause moves to the new leaf.

`web/index.html` needs no edit: the sub-tab rows are generated by `nav.js` and
only the seven group tabs are written in markup. `dev/scripts/check-nav.mjs`
asserts that group list and is unaffected.

### [loader] one new entry

`web/src/main.js`, `LOADERS`:

```js
'economics:tail': () => loadExhibitLeaf('pane-economics', 'economic_tail',
    ['economics', 'tail']),
```

Both halves of the key matter: the pane id decides where the table draws and
the reading-map key decides where its reading is filed.

### [gate] the exhibit harness

`dev/scripts/check-exhibits.py` walks the exhibit set; add `economic_tail` to
whatever it pins, and re-record any fixture that carries the renamed waterfall
columns (`dev/fixtures/`).

### [sync] the usual

`uv sync --extra dev` after the library moves, and again after the version
bump, or `/v1/meta` reports a stale version. `.\scripts\build-web.ps1` after
the commit, since `web/` moved.

---

## Files touched

**Upstream:**

| File | Steps |
|---|---|
| `src/aggregate/_pnl.py` | `economic_ratios_df` (+SD), `_waterfall_frames`, `waterfall_df`, `_capital_ratio`, the three docstrings |
| `src/aggregate/exhibits/_pnl.py` | `summary` / `tail` / `economic_tail` registrations, `_economic_ratios_insurer`, `_economic_waterfall_frames`, `LEDGER_MOMENTS` |
| `src/aggregate/exhibits/_core.py` | the `economic_tail` exhibit function |
| `src/aggregate/formats/formats-raw.yaml` | six renamed keys |
| `src/aggregate/formats/formats-insurer.yaml` | six renamed keys |
| `tests/` | the frames' own tests |

**Here:**

| File | Steps |
|---|---|
| `web/src/nav.js` | the `tail` leaf, the `overview.tail` why |
| `web/src/main.js` | the `economics:tail` loader |
| `dev/scripts/check-exhibits.py`, `dev/fixtures/` | the gate |
| `CHANGELOG.md`, `pyproject.toml` | the a194 section and bump |

---

## Acceptance

Build a P&L with an occurrence tower and an aggregate program (the author's
demo program, or any `xpnl` over a reinsured book).

1. **Overview / Summary** shows the gross book's moment card, with a caption
   saying it is the wrapped book and not the ledger. **Overview / Tail** shows
   the gross book's return periods on the same footing.
2. **PnL / Summary** (INSURER) draws **one** table with columns
   `P L E M SD LR ER CR`, one row per block, the total flagged and the
   net-of-tier rows muted. The same leaf on RAW still carries `E_LR`, `E_ER`,
   `E_CR`, `P_share`, `M_share` and the `legs_df` block.
3. The `SD` on a block equals that block's `Margin` row `SD` on the Ledger, to
   the last printed figure. A block with no result row of its own prints blank,
   not zero.
4. **PnL / Waterfall** draws two tables. The first is
   `Premium spent | Margin spent | CR | Margin | MSD`. The second is three
   capital columns then three CoC columns. Every capital figure is the negative
   of what the a193 build printed under `M01 ...`. Every CoC figure is
   unchanged.
5. Both waterfall captions say the capital is notional and that nothing is
   limited by it.
6. **PnL / Ledger** carries `Skew` beside `CV`.
7. **PnL / Tail** draws the closing margin's return period ladder, read off the
   lower half.
8. Build a plain `agg` and a `port`: Overview is unchanged in every respect,
   and the PnL group is dark.
9. `uv run pytest` green; `node dev/scripts/check-nav.mjs` green;
   `dev/scripts/check-exhibits.py` green.

---

## Open questions for the author

**Q1. The capital column qualifiers.** The rename above keeps aSP's and the
library's existing words: `standalone`, `net`, `gross`. The current names spell
the middle two `div net` and `div gross`, where `div` is short for
diversified, which is the real distinction (standalone versus diversified, then
two anchors for the diversified reading). Options:

- (a) `Capital standalone` / `Capital net` / `Capital gross` (shortest, loses
  the word diversified)
- (b) `Capital standalone` / `Capital div net` / `Capital div gross` (keeps it)
- \(c) `Capital alone` / `Capital held` / `Capital stressed`, which names what
  each one *is* rather than how it was computed

\(c) is the most readable and the biggest departure. My preference is (a), with
the diversification distinction carried by the caption, which already explains
it at length.

==> agree

**Q2. `TVaR` on PnL / Tail.** Three options:

- (a) drop the `TVaR` column from the `economic_tail` treatment and ship with
  `VaR`, `xsVaR` and `VaR/Mean`. Cheap, honest, and reversible.
- (b) ship all four with a caption warning. The warning will not save a reader
  who is scanning.
- \(c) get `E[X | X <= VaR(p)]` onto `GridDistribution` upstream first and show
  the correct measure. The right answer, and a bigger piece of work than this
  whole plan.

Recommend (a) now, \(c) when the lower TVaR exists. Note that the same defect
already affects `Aggregate.tail_df` and `Portfolio.tail_df` on any payoff
object and predates all of this.

==>  agree, this is not the overview->tail and can be slightly different.

**Q3. Row order on PnL / Summary.** The frame is in ledger order, so an
occurrence tower reads `Occ 1, Occ 2, Occ 3` bottom up. aSP's walk sorts the
tower **top down**, highest attachment first, which is how a reinsurance
submission is laid out. Changing it means reordering `_blocks()` upstream for
every P&L frame, since the Summary, the Waterfall and the Ledger must agree.
Worth doing, or leave the ledger's order alone?

==> ledger order defined by decl botton-up or top-down. follow that order.

**Q4. Is the P&L card genuinely surrendered?** `PnL.summary_df` loses its leaf.
Its `Skew` moves to the Ledger and its `P01 / Median / P99` are already the RAW
Ledger's `economic_marginal_df` block, so nothing is unreachable. But the card
is a different shape (Step and Side, three or four rows per step, currency
only) and some readers like it. Confirm it goes, or it earns a More leaf.

==> it goes; the consolidated obligation rows made it very hard to read. it was not a good exhibit.

**Q5. Does `waterfall_df` replace the two frames or join them?** This plan
keeps `walk_df` and `evaluation_df` public and adds a third property. The
alternative is to retire them, which is tidier upstream and breaks anyone
reading them directly. Author's call; I lean to keeping all three, since the
cost is one property.

==> retire - again, they are development ephemera; we have come up with a better approach.



---

## Execution log

Written as the work ran. Each entry is a divergence from the plan above, or a
plan claim the code contradicted. Recorded rather than absorbed.

**Bumps.** Four upstream, then one here, rather than the plan's seven steps.
Two pairs cannot be separate commits: `[pnl-summary-sd]` with
`[pnl-summary-one-table]`, and `[capital-rename]` with `[pnl-waterfall-merge]`,
since Q5 retires `walk_df` and a rename landing on a frame the next commit
deletes is not a bisectable state. `[overview-engine]` absorbed `[pnl-tail]`
for the same reason: the `tail` name transfers from the margin to the engine in
one move, and splitting them would leave the closing margin's ladder
unreachable as an exhibit for three versions.

| Bump | Label | Plan steps |
|---|---|---|
| LIB a388 | `[Overview-Engine]` | `[overview-engine]`, `[pnl-tail]` |
| LIB a389 | `[PnL-Summary-One-Table]` | `[pnl-summary-sd]`, `[pnl-summary-one-table]` |
| LIB a390 | `[Waterfall-Capital]` | `[capital-rename]`, `[pnl-waterfall-merge]` |
| LIB a391 | `[Ledger-Skew]` | `[pnl-ledger-skew]` |
| API a194 | `[PnL-Exhibits]` | `[nav]`, `[loader]`, `[gate]`, `[sync]` |

### LIB a388, `[Overview-Engine]`

**`engine_summary_df` and `engine_tail_df` are owed.** The plan says to serve
`obj.engine`'s frames "exactly as `_validation_frames` already does". That
function serves `engine_validation_df`, a real public frame, which is what keeps
the RAW invariant (a RAW block is exactly one public frame) intact. Reaching
`obj.engine.summary_df` from inside the exhibit layer would break it, so the two
delegating properties were added beside `engine_validation_df`. Checked for
collisions across `src/` first; there are none.

**A kernel P&L gets an empty frame with a caption, not a grayed leaf.** The plan
says `available_exhibits` already grays Overview for an engineless P&L. It does
not. `summary`'s predicate is `_perspectives_always`, and a predicate is per
exhibit **name**, not per type, so graying one class alone would mean a
type-aware predicate in the class-agnostic registry. The precedent for exactly
this case sits in the same file: `_stats_insurer_pnl` serves the empty frame and
says why. Followed it.

**The engine's view is not gross.** The plan's acceptance criterion 1 says
Overview / Summary shows "the gross book's moment card". Measured: it shows what
the engine's own grid realizes, so a book declaring `occurrence net of` reports
**net** (441.86 on the Peel fixture, matching the ledger's `All / Obligation`,
not its `Gross` row of 691.81) and one declaring `occurrence ceded to` reports
the cession. Captions therefore say "the book this P&L is a ledger over" and
carry a rider naming the view, and nothing claims gross.

**`Overview / Tail` was already live for a P&L** before this plan, serving
`PnL.tail_df`. The plan's Current behavior table is right about that; it is
`dev/scripts/check-nav.mjs` whose `EXPECTED` table is stale. See the API entry.

**`economic_tail` keeps `TVaR` on RAW.** Q2 ruled (a), drop the column. Dropping
it from a RAW passthrough would break the RAW invariant, so RAW serves the frame
whole and INSURER drops it, which is the ledger's own abbreviation precedent
([Ledger-Insurer-Abbreviated]). The misleading column stays one toggle away
rather than being deleted.

**`dev/FEATURES.csv`** gained rows for the two new properties and its
`table-version` moved a372 to a388; `dev/regen_features.py` had flagged them as
undocumented capabilities. `docs/2_aggregate_overview/features.rst`'s version
matrix was **not** touched: it stops at a353 and is 34 versions behind, so
adding one row would misrepresent it as current.

**Docs updated:** the exhibit catalogue and per-class list in
`pipeline-exhibits-and-charts.rst` (including the `economic_ratios` row, which
still said three INSURER blocks after a387 made it two), the frame list and
frame table in `pipeline-pnl.rst`, the registered-exhibit list in
`features.rst` (which said twelve and named twelve, omitting the four pricing
receipts, `approximation` and `ruin`), and the PnL ledger-surface row in
`3_x_API_Stability.rst`. Docs are not rebuilt at a bump, per the house rule.

**Gate:** `uv run pytest -m 'slow or not slow'`, 5551 passed. Snapshot
regeneration touched exactly 8 added `economic_tail` keys and 16 changed
`summary` / `tail` keys on the four P&L fixtures, nothing else.

**Left uncommitted, the author's:** `CLAUDE.md`, `uv.lock`, and a block in
`dev/TODO.md` on `ccoc` and the `bounded` domain. The TODO tick was staged as a
hand-built index entry so that block stayed behind.

### LIB a389, `[PnL-Summary-One-Table]`

**`SD` needed a non-tower case.** The plan prescribes reading it off
`_step_result_rows`, which keys on the `Step` level of the ledger index. Only a
tower has that level: on a plain `pnl` the index is `(Side, Label)`, so the
helper returns `{'Margin': ...}` against a ratios index of `['SWP']` and every
plain P&L would print a blank `SD`. That is the leaf's commonest appearance. New
`PnL._block_result_sd()` pairs the single block with the single result row
directly on a non-tower rather than teaching the walk's helper about a shape the
walk never sees. Measured: the plain P&L now reads 592.39, and on a tower the
column agrees with `Margin / MSD` to 3e-14.

**One block, not two.** The INSURER view is one block named `walk`. Accepted the
plan's reversal of the one-unit reporting rule; the reversal is written on
`_SUMMARY_COLS` with the reason, and `greater_tables` formats the mixed block
from the sheets with no selector of its own.

**Gate:** 5553 passed. Snapshot diff: the 8 `economic_ratios` keys, nothing else.

### LIB a390, `[Waterfall-Capital]`

**The RAW invariant forced a better split than the plan's.** The plan says serve
`waterfall_df` as two blocks. Written that way, `test_every_raw_block_is_a_public_frame`
failed: a RAW block must *be* a public frame, and `walk` and `capital` are column
slices. RAW now serves `waterfall_df` whole and INSURER does the split, which is
what `[Perspective-May-Restructure]` is for and what `economic_ratios` and
`sharpen` already do. Worth noting in its own right: the module docstring
celebrates this exhibit as the last RAW exception, promoted rather than exempted
at a253, and the invariant caught it a second time here.

**No third home for the return period.** The plan has the level riding in the
caption, the block heading and `.attrs`. There is no visible block heading: the
SPA draws the table and the caption and never prints the block name, which is an
identifier in `meta['blocks']`. So the blocks are `walk` and `capital`, snake
case like every other block name, and the level rides in the caption and in
`waterfall_df.attrs['return_period']`.

**`walk_df` and `evaluation_df` removed** per Q5. Retiring `PnL.evaluation_df`
also removes a real collision: `EvaluationResult.evaluation_df` is a different
frame (the pricing panel), and `PnL.evaluate()` still returns it.

**Only `formats-raw.yaml` carried the six keys**, as recorded above.
`Margin ratio` was removed from the sheet too, nothing serving it now.

**Verified unchanged, which is the plan's acceptance criterion 4:** every CoC
figure on the capstone program is byte-for-byte what a389 printed
(`test_waterfall_capstone_acceptance`), and the capital cells are exactly the
negatives of the old `M01` cells. The negation moved out of `_capital_ratio` and
into the column, so the quotient is invariant.

**Docs:** the `features.rst` waterfall section rewritten around one frame, with
the breaking note; the frame list, frame table and exhibit catalogue updated;
`3_x_API_Stability.rst`'s ledger-surface row; the `exhibits/__init__.py` module
docstring, which cited the two retired frames by name. `dev/FEATURES.csv`'s two
rows merged into one.

**Gate:** 5553 passed. Snapshot diff: the 6 `economic_waterfall` keys, nothing
else.

### LIB a391, `[Ledger-Skew]`

As specified. The comment above `LEDGER_MOMENTS` was replaced rather than left
to contradict the tuple, and the "four columns" prose in three places became
five. **Gate:** 5553 passed. Snapshot diff: the 4 `economic/insurer` keys.

### API a194, `[PnL-Exhibits]`

**No gate edit needed for the new exhibit.** `dev/scripts/check-exhibits.py`
already reads `EXHIBITS` from the library, so `economic_tail` joined the sweep
with no change; its fallback literal is for an older `aggregate` and must not
gain the name. `dev/fixtures/` is gitignored, so "re-record any fixture" is just
rerunning `capture-capability.py`.

**`check-nav.mjs` was already red, by eleven findings, before this plan.** Two
rows were a194's (`overview:tail` for both P&L kinds, and the new
`economics:tail`); the rest were the library moving and `EXPECTED` not
following. Brought the whole table current on the author's instruction:

- `reinsurance:plot` / `summary` / `stats` / `density` gain `xpnl`. Library a367
  ([PnL-Reins-Passthrough]) widened the Re row to a reinsured P&L. `nav.js`'s own
  comment already said so in full; only the gate was behind.
- The four assertions that those leaves are "an aggregate's, not a P&L's" were
  true until a367 and are **inverted**, now asserting the row is lit.
- `pricing:plot` gains `xpnl`: `kappa` is registered against an occurrence
  program, which a reinsured P&L is through its engine. The comment claiming
  this row equals `pricing:allocate` no longer holds and says so.
- `bounds:bounds` / `bounds:pricing` gain both P&L kinds, from a191's
  `can_bounds` passthrough.

**Two stale app comments fixed in passing.** `loadExhibitLeaf`'s docstring said
`economic_waterfall` has no frame behind it (untrue since library a253) and
cited `economic_ratios` as the multi-block example (reversed at a389; the
example is now the waterfall). The Perspective help note in `index.html` gained
the fourth PnL leaf.

**Hints rewritten** on PnL Summary (which now names `SD`) and PnL Waterfall
(which named "standalone and diversified 1-in-100 margin" and now names the
capital bases). `overview.tail`'s `why` no longer claims the closing margin.

**Gates:** `uv run pytest` 439 passed; `node dev/scripts/check-nav.mjs` clean,
green for the first time since a186; `dev/scripts/check-exhibits.py` clean;
`check-adapter.py` and `check-frames.py` clean. SPA rebuilt after the commit.

**Acceptance, walked through the real api in process** (`/v1/meta` reports
`1.0.0a194` over `aggregate 1.0.0a391`):

| # | Criterion | Result |
|---|---|---|
| 1 | Overview Summary / Tail serve the engine | `engine_summary_df`, `engine_tail_df` |
| 2 | PnL Summary is one table | INSURER `P L E M SD LR ER CR`; RAW keeps `E_*`, the shares and `legs_df` |
| 3 | `SD` equals the walk's denominator | agrees to 3e-14; a plain P&L prints a number, not a blank |
| 4 | Waterfall is two tables, capital negated | `walk` then `capital`; Gross +1,820, each cession negative, closing +880 |
| 5 | Captions say the capital is notional | both |
| 6 | Ledger carries `Skew` | `EX SD CV Skew κ01` |
| 7 | PnL Tail draws the margin ladder | INSURER `P T VaR xsVaR VaR/Mean`, RAW keeps `TVaR` |
| 8 | A plain `agg` is unchanged, PnL group dark | same seven exhibits; `economic_tail` 404s |
| 9 | Gates green | above |

**Left for the author.** The lower tail measure `E[X | X <= VaR(p)]` on
`GridDistribution`, after which `economic_tail` can serve all four columns and
the warning on `PnL.tail_periods_df` comes off (Q2's option (c), logged in the
library's `dev/TODO.md` under `[Overview-Engine]`). Untouched in this tree:
`dev/plan-a195-pnl-pentagon.md`, `dev/plan-demo-load.md` and
`dev/scripts/loadtest/`; upstream, `CLAUDE.md`, `uv.lock` and the `ccoc` block
in `dev/TODO.md`.
