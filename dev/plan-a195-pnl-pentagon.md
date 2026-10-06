# Plan a195: the Pentagon report on a P&L

**Scope: library (`aggregate`) for the numbers, this repo for the picture.**
One new library frame, one parametrized return period, one new route here, one
new leaf, one new form, and a port of a bespoke SVG figure.

Written for a reader with no conversation context. File references are to this
repo (`V:\dev\aggregate-api`) unless marked *upstream*, which is the sibling
checkout named in `[tool.uv.sources]`, currently
`../../worktrees/aggregate_REFACTOR`. References marked *aSP* are to
`V:\dev\aggregate-asp`, a sibling experiment being retired, whose Pentagon
report is what this plan brings home.

**Depends on `dev/plan-a194-pnl-exhibits.md`**, which renames the capital
columns and takes the return period out of them. Land a194 first.

Date drafted: 2026-10-06.

---

## Goal

A **PnL / Pentagon** leaf drawing aSP's combined pentagon: gross, ceded and net
on one figure, at a solvency level the reader chooses from a strip of six.

The figure is the one thing in aSP that carries a whole report at a glance, and
it works because every node is a disc whose area is the gross amount with a
wedge cut for the net share, so the cession is literally the part left over.

---

## The governing principle, decided 2026-10-06

**The library owns the arithmetic. The browser owns the geometry.**

The pentagon is a clever display of a table. Every number in it comes out of a
library frame; nothing about the economics is computed in JavaScript. The SVG
that draws it lives here, because it is a bespoke figure, not a chart anyone
else emits, and forcing it through the chart IR would be a large extension for
one picture.

This is the same division the table path already uses ("the api asks it for a
semantic table document, never for markup: the browser owns geometry",
`pyproject.toml`). Written down this way it constrains the next bespoke figure
rather than licensing it: a new picture may own its own geometry, and may never
own its own arithmetic.

aSP's actual sin was computing the economics client side (`js/solve.js`,
`js/combined.js` reading from it). That does not come across.

---

## What the figure needs

From aSP `js/combined.js`, `renderCombined(C, N)`. Seven nodes, three chips,
three rows of figures each (gross over ceded over net):

| Node | Rows it prints |
|---|---|
| assets | `a` gross, ceded, net |
| loss and CV | `L` gross, ceded, net, each with the CV of that law |
| capital | `Q` gross, ceded, net |
| margin and SD | `M` gross, ceded, net, each with the SD of that law |
| technical prem | `P` gross, ceded, net |
| expenses and ER | `E` and `E / written premium` on each side |
| gross prem, CR and CV | written premium, `CR`, and `SD / (L + E)` on each side |

| Chip | Rows |
|---|---|
| CoC | `M / Q` gross, the cession's own `dM / dQ`, net |
| TLR and LR | `L / P` and `L / written` on each side |
| P : Q | `written / Q` on each side |

**The ceded column is a difference on every amount, by construction.** That is
what makes the figure work: disc area is the gross number, the blue wedge is
the net share, the red is what is left. The only cells that are not a
difference are the ceded `CV` and `SD`, which want the cession's own law. See
[ceded-law] below, which is the one genuine data problem in this plan.

---

## Current behavior

### What exists already

The pentagon machinery is upstream and public. `src/aggregate/pentagon.py`
carries `Pentagon.solve(L=, P=, M=, a=, Q=, lr=, pq=, roe=)` (line 394), which
completes the octet from any sufficient pair, and `complete_pentagon(df)` for a
frame of them. `Aggregate.price_pentagon` and `Portfolio.price_pentagon` are
built on it, and `src/aggregate_api/pricing.py`'s `run_pricing_preview` already
resolves a P&L to its wrapped engine and completes one.

The ledger supplies the amounts directly. `PnL.economic_ratios_df` carries `P`,
`L`, `E` and `M` per block, signed in the gross direction so they add across
blocks and `M == P - L - E` holds exactly.

The capital is already computed, at one level. `walk_df`'s capital columns
(`M01 standalone`, `M01 div net`, `M01 div gross` today; `Capital standalone`,
`Capital net`, `Capital gross` after a194) are each a block's result in a
1-in-100 state, and `_capital_ratio` already divides margin by the negated
value, which is a cost of capital.

### The identity that makes this nearly free

On a block whose premium and expense are fixed, the result is the loss shifted:

```
M = P - L - E,   so   L = (P - E) - M
```

Write `P_tech = P - E` for the technical premium. Then the capital the
solvency standard calls for at level `p` is

```
Q = -q_M(1 - p)        the negated result in the 1-in-1/(1-p) state
a = P_tech + Q         assets, which is also VaR_p of the loss
```

which is the pentagon's own `a = P + Q`, and `M = P_tech - L` is its
`P = L + M`. So the walk's capital columns **are** the pentagon's capital, at
one hard-wired level, and `Pentagon.solve(L=, P=, a=)` closes the rest.

### What is missing

1. The level is a module constant, `WATERFALL_RETURN_PERIOD = 100`
   (`src/aggregate/_pnl.py:814`), read by `_waterfall_frames`. aSP offers six
   (`js/state.js:105`): 1-in-100, 200, 250, 500, 1000, 2000.
2. There is no frame that puts the ledger's amounts and the walk's capital on
   one row per side with the ratios completed.
3. The cession has no law on a stitched ledger. See [ceded-law].
4. The PnL pane has no form at all (`web/index.html:472` is a bare
   `<div id="pane-economics" class="pane"></div>`), so this is the group's
   first one.

---

## The change, upstream

### [waterfall-level] the return period becomes a parameter

`src/aggregate/_pnl.py`. Turn `_waterfall_frames` into a method taking the
level, keep `walk_df`, `evaluation_df` and (from a194) `waterfall_df` as
properties at the default, and publish a parametrized
`waterfall_frames(p=None, t=None)` beside them, matching the shape
`tail_periods_df` already uses for the same job (a property at the default
ladder, a method for a caller's own).

**Column names do not move with the level.** That is the whole reason a194
renames them off `M01`. The level rides in the frame's `.attrs` and in the
caption and heading, and both format sheets stay keyed on stable names.

`WATERFALL_RETURN_PERIOD` stays as the default and keeps its name.

### [pentagon-frame] `PnL.pentagon_df`

`src/aggregate/_pnl.py`, a new method `pentagon_df(p=None, t=None, basis=...)`.

Three rows, `Gross`, `Ceded`, `Net`:

- `Gross` is the first block of `economic_ratios_df`, which is the gross book
  in every builder.
- `Net` is the `All` block, the closing position.
- `Ceded` is `Net - Gross` on every amount, which is what the figure draws.

Columns: `L`, `E`, `P` (written), `P_tech`, `M`, `a`, `Q`, `LR`, `TLR`, `ER`,
`CR`, `PQ`, `CoC`, `SD`, `CV`.

Built by taking `L`, `E`, `P`, `M` off the ratio frame, `Q` off the walk's
diversified net capital at the requested level, then `Pentagon.solve(L=, P=,
a=)` per row for whatever is left. Nothing is invented here: every input is a
quantity the P&L has already computed, which is the same claim `walk_df`'s
docstring makes, and the method should repeat it.

Two things the docstring must say plainly:

**The capital is notional.** Nothing in the ledger is truncated at these
amounts. No default is modeled, no recovery is limited by them, no premium is
reduced for the possibility of insolvency. They are what the solvency standard
calls for at the stated level, read off a quantile of the result.

**The ceded row is a difference, not a position.** Its amounts are gross less
net by construction. Its `Q` is capital released, its `CoC` is margin given up
per unit of capital released, and its `SD` and `CV` are the one pair that
cannot be formed by subtraction.

### [ceded-law] the cession's own moments

**This is the one real data problem and it must be settled before the figure
ships, because the figure prints a ceded CV and a ceded SD in two places.**

On a stitched ledger the total impact row is a `_DeltaRow`
(`src/aggregate/_pnl.py:556`) backed by a `_DeltaGD` (line 541). Every
statistic on it except the mean is the plain cell-by-cell difference of the two
rows' statistics, which is documented and deliberate: the grand result and the
first step ride different marginals, and their difference has no distribution
without a joint.

Verified against a live exhibit on 2026-10-06, a P&L over a three layer
occurrence tower with an aggregate program. The `All / Impact` row read:

```
SD      -699.99 = 93.01 - 793.00              (net SD less gross SD)
CV        78.4% = 395.6% - 317.2%
Skew      1.065 = -1.099 - (-2.163)
P01    2,508.14 = -122.86 - (-2,631.00)
Median  -558.36 = 72.14 - 630.50
P99     -647.86 = 102.14 - 750.00
```

A negative standard deviation on a sheet, with no mark on the row saying it is
a delta of statistics. It reaches the reader today through both `PnL / Ledger`
and `Overview / Summary`. aSP guards against it client side (`js/main.js`,
`ledgerMoments`, whose `law()` helper rejects a row whose `SD` and `CV` do not
agree against the mean) and filed it upstream.

Three options, in increasing cost:

- (a) **Mark the row.** Surface the fact that a row is a `_DeltaRow` on the
  frame (a boolean column, or an entry in `.attrs`), have the exhibit
  treatments blank or flag `SD`, `CV`, `Skew` and the percentile cells on it,
  and have `pentagon_df` serve `NaN` for the ceded `SD` and `CV`. The figure
  then prints a dot, as aSP's does.
- (b) **Compute the cession's law where a joint exists.** On a shared-atoms
  ledger it already does, so this is about making the stitched route say so and
  fall back cleanly rather than silently differencing.
- \(c) **Build the joint.** Correct everywhere, and much the largest piece.

Recommend (a) as part of this plan and (b) as its own upstream item. \(c) is not
in scope. See **Open question Q1**.

---

## The change, this repo

### [pentagon-route] one POST

`src/aggregate_api/routes/objects.py`:

```
POST /v1/objects/{oid}/pnl/pentagon   { p }   ->  FrameResponse
```

A route rather than an exhibit, because the level is a form input and the
exhibit route (`GET /objects/{oid}/exhibit/{name}`) takes only a perspective.
Model it on `POST /objects/{oid}/pricing/preview`: validate, call one library
method, serialize.

This addition has to survive aSP's own rule, which is worth importing with the
code: *make do with the `/v1` interface; any proposed api addition has to
survive a written "why the make-do route fails" argument first.* It does. The
make-do route is per-ledger-row quantiles at an arbitrary `p`, which this api
does not expose and should not: it would be one frame per level per row, to
reassemble arithmetic the library already does.

Runner in `src/aggregate_api/pricing.py` beside the others, or a new
`src/aggregate_api/pnl.py` if it grows past one function. Same contract: a
`ValueError` written to be read by a person becomes an HTTP 400 whose `detail`
is the message verbatim.

### [capability] one flag

`src/aggregate_api/capability.py`: `can_pnl_pentagon`, true for a P&L whose
walk carries a diversified net capital column (so a kernel P&L and a ledger
with no conditioning are dark, with a `why` that says what does answer). Add it
to the capability payload beside `can_pnl` (line 767).

A flag rather than an exhibit gate, because the leaf is a picture this app
draws, not a library document. That is the third of the three gating kinds
`nav.js` already documents.

### [nav] one leaf

`web/src/nav.js`, `NAV_GROUPS.economics.leaves`, after `tail`:

```js
pentagon: {
    label: 'Pentagon',
    flag: 'canPnlPentagon',
    why: 'needs a P&L whose ledger supports a diversified capital reading',
    hint: 'gross, ceded and net on one figure: assets, loss, capital, '
        + 'margin, premium and the ratios between them',
},
```

### [level-strip] the PnL group's first form

Ported from aSP's regulator card (`js/pricing.js`, `renderPricing`, the
`#minis` strip). Six mini pentagons, one per level, each with the level's label
and the assets it implies, the live one highlighted; pressing one re-asks the
route.

**Not a dropdown.** The point of the strip is that you see the answer at all
six and pick, which is a different act from choosing a parameter. A single
select would make this leaf worse than the thing it is replacing.

`web/src/pricing-form.js` is the template for the form band, the busy handling
and the `note()` channel, though the strip itself is not one of its field
shapes. Put the strip in the control band above the figure, matching
`.control-band` in `web/src/styles/site.css`.

### [pentagon-svg] the figure

Port aSP `js/combined.js`, 347 lines, into `web/src/charts/pentagon.js`. It is
a port, not a rewrite: the vertex order, the spring path on the one statistical
edge, the area-proportional discs, the wedge geometry, the call-out rule for a
sector too thin to hold its own percentage, the three-row label stacks and the
three chips all come across as they are.

Four things change on the way:

1. **Colors come from the theme**, `web/src/charts/theme.js`, not from aSP's
   `--ink` and friends. The gross / ceded / net triple needs tokens that work
   in both the light and dark palettes.
2. **Tooltips** use whatever this app already uses, not aSP's `js/tip.js`.
3. **Responsive**: aSP has a fixed `viewBox="0 0 1000 700"` in a desktop
   layout. Here it has to survive a phone, which the house rules require.
4. **The double asterisk convention** marks a quantity the reader set rather
   than the engine derived. In aSP that was volume, assets, the expense rate
   and the benchmark. Here the only input is the solvency level, so the mark
   goes on `assets` and nowhere else, and the note under the figure says so.

The figure draws from the route's frame and holds no arithmetic beyond the
geometry: radius from amount, wedge fraction from the net share, and the
percentage printed in the sector. Any quotient it wants is a column.

---

## Files touched

**Upstream:**

| File | Steps |
|---|---|
| `src/aggregate/_pnl.py` | `waterfall_frames(p=)`, `pentagon_df`, the `_DeltaRow` marking |
| `src/aggregate/exhibits/_pnl.py` | blanking or flagging the delta cells |
| `tests/` | the new frame, the level parameter, the delta marking |

**Here:**

| File | Steps |
|---|---|
| `src/aggregate_api/routes/objects.py` | the POST route |
| `src/aggregate_api/pricing.py` (or a new `pnl.py`) | the runner |
| `src/aggregate_api/models.py` | request and response models |
| `src/aggregate_api/capability.py` | `can_pnl_pentagon` |
| `web/src/nav.js` | the leaf |
| `web/src/main.js` | the loader and the leaf's wiring |
| `web/src/charts/pentagon.js` | **new**, the figure |
| `web/src/styles/site.css` | the strip and the figure's container |
| `web/src/api.js` | the client call |
| `tests/` | the route |
| `CHANGELOG.md`, `pyproject.toml` | the a195 section and bump |

---

## Acceptance

Build a P&L over a reinsured book with both an occurrence tower and an
aggregate cover.

1. **PnL / Pentagon** draws the figure with the level strip above it, opening
   on 1-in-100.
2. Every amount in the figure reconciles against `PnL / Summary`:
   gross `L`, `E`, written premium and `M` are that leaf's Gross row; net are
   its `All` row; ceded is the difference, to the last printed figure.
3. `Q` on the gross row equals `Capital gross` on **PnL / Waterfall**'s Gross
   row at the same level; `Q` on the net row equals `Capital net` on its
   closing row. `CoC` matches the corresponding waterfall column.
4. The pentagon identities hold on screen: `a = P_tech + Q`,
   `M = P_tech - L`, `CoC = M / Q`, `P:Q = written / Q`.
5. Pressing 1-in-250 re-asks and every assets, capital, P:Q and CoC figure
   moves; every loss, expense, premium and margin figure does not.
6. The ceded `SD` and `CV` print a dot on a stitched ledger rather than a
   negative standard deviation, and print real numbers on a shared-atoms one.
7. The note under the figure says what the three colors are, what the `**`
   marks, and that the capital is notional.
8. The leaf is dark with a `why` on a plain `agg`, a `port`, and a kernel P&L.
9. The figure is legible at 390 px wide.
10. `uv run pytest` green; `node dev/scripts/check-nav.mjs` green.

---

## Open questions for the author

**Q1. The ceded law.** Option (a), (b) or \(c) under [ceded-law]. (a) is in this
plan's estimate; (b) is a separate upstream item; \(c) is a project.

==> Agree - (a), cession here means difference.

**Q2. Which capital basis does the pentagon use?** The walk offers three:
standalone, diversified net, diversified gross. The figure has one capital node
with three rows (gross, ceded, net), so it needs one basis. Diversified net is
the obvious default, since it decomposes the capital the firm actually holds
and the ceded row then reads as capital released. Is the basis a second
control, or fixed with the caption saying which?

==> I say we keep this simple. It is quantile capital on gross / net at the same threshold and ceded is the difference.

**Q3. Three rows, or one pentagon per step?** aSP draws gross, ceded and net,
where ceded is the whole cession taken together. A tower with three occurrence
layers and two aggregate covers has five steps with results of their own.
`pentagon_df` could serve a row per step cheaply. The figure can only draw
three. Serve three, or serve every step and let the figure pick?

==> if it is easy, server all the rows - mirror ledger, and the renderer picsk. this could actually lead to a nice stepper where you incrementally add things. BUT ONLY IF easy. If there are any difficulties just gross, ceded (all), net.

**Q4. The six levels.** aSP's are 1-in-100, 200, 250, 500, 1000, 2000
(`js/state.js:105`). Keep all six, or trim? Six mini pentagons is a wide strip
on a phone.

==> I really liked the aSP's pentagon logos. I think a good solution is to put those across the top of the exhibit, default to 99% and have the exhibit update with the selection. That is not in the plan ATM, but should be a fairly easy add.

**Q5. Does the Waterfall gain the level strip too?** [waterfall-level] makes
its capital columns parametric, and the control would be the same one. Doing
both at once is tidy and makes the PnL group's form shared across two leaves,
which is a larger UI commitment than one leaf's control. Recommend: pentagon
only in this plan, waterfall as a follow-up once the strip has been lived with.

==> YES! with the same pentagons!

**Q6. Does anything else in aSP come home?** The retirement list so far is:
Stack and Round (plan a193), the Pentagon (this plan), the pricing walk (plan
a194). The draggable Lee panels and the DecL emitter are explicitly not
wanted. Worth a note in aSP's `README.md` recording what moved and what died,
so the two repos do not both grow a pricing walk.

==> Agree, that's all we will take. memo-ize in aSP readme.

---

## Execution log

Written as the work ran. Every divergence from the plan above is recorded here rather than absorbed silently.

### Rulings taken before any code was touched, 2026-10-06

The six open questions were answered on the plan. Four more were put and answered at review time, because the review found a claim the code contradicted.

**[waterfall-level] is out of this plan, and Q5 goes with it.** The plan says the level is "a module constant, `WATERFALL_RETURN_PERIOD = 100`, read by `_waterfall_frames`", which understates how bound it is. `PERCENTILE_LADDER` is `(0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)`: its only tail point is 0.01, so there is no 1-in-200, 250, 500, 1000 or 2000 anywhere in the library. `Capital net` reads `economic_df`'s `κ01` column and `Capital gross` reads the gross ladder at `PERCENTILE_LADDER.index(p)`, both conditional means. On the shared-atoms route that would be a cheap fix, `_scenario_ladder` and `_gross_scenario_ladder` both looping the ladder on demand; on a stitched peel it is not, `_palm_scenario_ladder` being build time with its anchor indices computed against the ladder at `_pnl_builders.py:1584`.

The author's Q2 ruling removes the obstacle for the pentagon entirely: quantile capital on gross and net at the same threshold, the cession the difference, is a **marginal** reading, free at any level off each result row's own `GridDistribution`. It is also what aSP did, reading `varsGross` / `varsNet` off its quantiles route. So the Pentagon lands here at all six levels and the **Waterfall strip becomes its own upstream plan**, which has to parametrize the conditioning first. Ruled by the author at review, 2026-10-06, along with dropping the `t` parameter from `_waterfall_frames` rather than publishing a method that refuses five of its six arguments.

**[ceded-law] blanks rather than flags.** Option (a), and the treated cells go blank rather than printing with a marker.

**Q3 serves every row.** Cheap on the marginal basis, so the frame mirrors the ledger's result steps and the renderer picks three.

### Upstream, landed

**`1.0.0a392` [Delta-Row-Marked]**, commit `0c6449c`. `PnL.economic_df`, `economic_marginal_df` and `summary_df` name their per-statistic delta rows in `.attrs['delta_rows']`; the `economic` exhibit blanks those cells under INSURER and the caption says why. Tier 3 gate green, 5560 passed. `tests/data/exhibit_snapshots.json` re-captured: six cells on the two stitched fixtures plus the two captions, nothing else moved.

Three divergences from the plan's [ceded-law] section, all recorded in the code:

- **The `κ` cells are deliberately not blanked.** The plan's option (a) says to blank "`SD`, `CV`, `Skew` and the percentile cells". A `κ` cell on a delta row is the difference of two conditional means under the *same* conditioning event, so by linearity it is the conditional mean of the difference: exact, and it foots down its column like every other cell. Blanking it would throw away a real number. Only the *marginal* `P` cells go, a difference of quantiles being a quantile of nothing. `tests/test_pnl_peel.py::test_the_delta_rows_kappa_cells_stay_exact` pins the reason.
- **`Overview / Summary` is not a second site.** The plan says the negative standard deviation "reaches the reader today through both `PnL / Ledger` and `Overview / Summary`". Library a388 [Overview-Engine] retired that leaf: the `summary` exhibit on a P&L now serves `engine_summary_df`, the wrapped book, so `PnL.summary_df` reaches no exhibit at all. It is marked anyway, being a public frame that carries the delta cells, but there was one presented site to treat, not two.
- **The mark is `.attrs`, not a column.** The plan offered either. A boolean column would widen every ledger sheet and churn every snapshot to carry one row's worth of information.

**`1.0.0a393` [PnL-Pentagon]**, commit `2838d15`. `PnL.pentagon_df(t=None)`, with `tests/test_pnl_pentagon.py`, 17 cases. Tier 3 gate green, 5577 passed, and the `RuntimeWarning` gate green too, the method adding divisions.

Four divergences:

- **`pentagon_df(t=None)`, not `(p=, t=, basis=)`.** `basis` goes with the Q2 ruling, there being one basis. `p` and `t` for one number invites a caller to pass both and disagree, and the strip speaks in return periods, so the method takes `t` alone. The api takes `t` too, end to end, with no unit conversion to get wrong.
- **`Pentagon.solve` is not used.** The plan says to close each row with `Pentagon.solve(L=, P=, a=)`. That runs the derivation backwards: `solve` recovers `Q` from assets, and assets are what this derives *from* `Q`. It would also put its `ratios()` consistency assertion, exact to `1e-14`, between the ledger's own `M` and `P_tech - L`, two numbers that agree mathematically and need not agree in the last bit. The five quotients are computed directly and `_pentagon_row`'s Notes records the choice.
- **A single-group P&L gets its one row.** `_step_result_rows` keys by the ledger's `Step` level, which only a tower has, so on a non-tower it keys its one result row by `Side` instead and the pentagon came out an empty frame. `PnL._block_result_rows` is the new pairing, re-keyed to `economic_ratios_df`'s index; `_block_result_sd` now reads it instead of repeating the same logic inline.
- **Released capital is not monotone in the level.** Found by a test assertion that was wrong rather than by the code being wrong. Every cover in the test peel is bounded, so far enough into the tail the program is exhausted and the net capital grows almost as fast as the gross: the cession releases 956 at 1-in-100 and only 908 at 1-in-2000, and the cost of relief rises rather than falls. Pinned in `test_an_exhausted_program_releases_less_capital_further_out`. It matters for the strip, whose whole point is seeing all six at once, and the note under the figure should not promise that the figures grow with the level.

`dev/FEATURES.csv` gained a `pentagon_df` row by hand, the file being curated rather than generated; `dev/regen_features.py` audits clean. Upstream `dev/TODO.md` was **not** touched: it carries uncommitted work of the author's and has no tracked item for this plan, which the API repo owns.
