# Plan 1.13.0: More ▸ Exact tail, the exact log10 chart of an nttagg

**[Exact-Tail-Leaf]**. One step, one bump. The version is the next free minor
when this executes: `1.10.0` and `1.11.0` are claimed by
`dev/plan-1.10.0-deep-link-view.md` and `1.12.0` by the sibling plan for raw
display on the large grids, so `1.13.0` if those land first.

## Goal

An `nttagg` computes its distribution exactly, as rationals, beside the
ordinary float FFT. The library is adding a chart, `exact_tail`, that draws
that exact answer on a log10 scale all the way down the support, with the float
answer beside it, so a reader sees where the float pipeline dissolves into
noise and the exact line keeps going. On the headline case (`Wilson2017.DiceOfDice`
in the library's `reproductions.agg`) the deepest bucket is about `1e-462.5`,
far below where a float can go.

This plan puts that chart in front of the reader of aLL: a chart leaf **More ▸
Exact tail**, lit for an `nttagg` and dark with a reason for everything else,
and teaches the ECharts adapter the two new axis units the chart uses, so its
ticks, its drawing and its cursor readout are right.

## Current behavior

- **No leaf shows it.** The More row (`web/src/nav.js:348` to `448`) is Tail
  behavior, Approximation, Window, Dependency, Sharpen, Narrative, Density. A
  library chart reaches the page only through an authored leaf naming it, or a
  Lab leaf from a plugin manifest (`labLeavesFromManifest`, `nav.js:510`).
  Lab takes plugin charts only, so a new library chart with no authored leaf is
  served by the api and drawn nowhere.
- **The api needs nothing.** `GET /v1/objects/{id}/chart/{name}`
  (`src/aggregate_api/routes/objects.py:2870`) resolves names through
  `aggregate.charts.available_charts` and serializes whatever
  `build_chart_doc` returns; the capability block passes `available_charts`
  through (`capability.py:79`). A new library chart is listed and served with
  no endpoint change.
- **What an nttagg lights today** (probed in process against `aggregate`
  1.2.1): exhibits `summary, tail, stats, validation, bs_window,
  tail_behavior, approximation`; charts `agg, approximation,
  approximation_tails`, primary `agg`; `can_price`, `can_evaluate`,
  `can_bounds`, `can_hints`, `can_sharpen` true; `can_reins`, `can_pnl` and
  the composed P&L flags false. So its leaves are a plain aggregate's, less
  Pr Ruin (no Poisson or renewal frequency).
- **The adapter does not know the new units.** Every unit dispatch in
  `web/src/charts/chartdoc-to-echarts.js` falls through for an unknown unit:
  - `drawingFor` (`:1098`) sends both to `step-mid` (`:1109`). On the mass
    panel that bridges every omitted exact-zero bucket with a horizontal run,
    drawing mass where the law has none. On the survival panel it centers the
    steps on the grid points where `S` is right-continuous.
  - `labelFormatter` (`:1398`) and `readValue` (`:3018`) fall to `fmt`
    (`web/src/utils/format.js:19`), which groups integers: an exponent of
    `-1200` prints as `-1,200`, and the readout gives the exponent with no
    probability beside it.

  So the renderer half of this plan is required, not polish.
- **The harnesses do not see an nttagg.** `dev/scripts/capture-capability.py`
  (`DECLS`, `:27`) and `dev/scripts/capture_fixtures.py` (`CASES`, `:30`)
  build no `nttagg`, so `check-nav.mjs` has no nttagg column and
  `smoke-charts.mjs` has never replayed an nttagg document.
  `tests/test_capability.py` does build one (`DECLS["nttagg"]`, `:48`, gated
  by `requires_nttagg` in `tests/conftest.py:51`), and
  `test_every_listed_chart_serves` (`:230`) will fetch `exact_tail` for it
  automatically once the library lists it.

## Dependency: the library contract

From the library plan (aggregate worktree, `dev/plan-1.4.0-nttagg-arithmetic-exact-chart.md`,
second bump there, expected `aggregate` 1.5.0). Pinned, and this plan consumes
exactly this:

- Chart **`exact_tail`**, available only for an updated `AggregateNTT`, never
  primary: Overview ▸ Plot stays the `agg` chart.
- Two `xy` panels sharing the x axis `outcome` (unit `currency`, scales
  `('linear', 'log')`, suggested range `(0, top of support)`, full range the
  whole grid). No marks.
- Panel **`mass`**, title "Exact probability mass" (corrected at execution;
  the draft gave the y axis label here). Its y axis has id
  `log10_mass`, unit **`log10_density`**, label `log10 probability mass`,
  scales `('linear',)` only. Series `Exact` and `Float FFT`, role `density`.
  It carries **positive buckets only**: explicit x, exact zeros omitted,
  interior zeros included in the omission. It must be drawn **as markers
  only**: no line, no stems, no steps. A line would bridge the omitted
  buckets, and a log10 axis has no floor for a stem to stand on.
- Panel **`survival`**, title "Exact survival function" (corrected likewise).
  Its y axis has id
  `log10_survival`, unit **`log10_probability`**, label `log10 exceedance
  probability`, scales `('linear',)` only. Series `Exact` and `Float FFT`,
  role `survival`. `S` is positive and gap-free below the top of the support;
  its trailing exact zeros are dropped. It draws as the existing
  `probability` unit does.
- Every y value is a **base-10 exponent** (`-467.7` stands for about
  `2.0e-468`). Nothing non-finite is sent.

**The `aggregate` pin does not move.** It is `aggregate>=1.0.1,<2`
(`pyproject.toml:64`). Against a library without the chart, `exact_tail` is
not in `available_charts`, so the leaf is dark with its reason and nothing
else changes; the adapter's new unit branches are simply never reached. A
floor raise would only stop an older library from installing, which costs
users something and buys nothing. The two api tests that assert the chart is
present are gated instead (below).

**Coordination point: the chart IR version.** The library stamps every
document with the global `CHART_IR_VERSION` (`aggregate/charts/ir.py:119`,
currently 4), and the adapter refuses any document above its own
(`chartdoc-to-echarts.js:48` and `:2780`, also 4). By the library's own rule
(`ir.py:88`), a unit a reader must act on to draw the default reading right
qualifies for a bump, and `log10_density` arguably does: an old reader
bridges its gaps. A bump to 5 would make **every** chart, not just this one,
come back as `notDrawable()` in any aLL whose adapter still says 4.

**Decided by the author (2026-10-14): the IR stays at 4.** The new units appear
only in `exact_tail` documents, which a reader receives only by asking for that
name, and the only readers that ask (this leaf, and the library's
`plot_chartdoc`) learn the units in the same release. The library records the
reasoning in its `CHART_IR_VERSION` comment. Nothing here changes the
adapter's version.

## Change

### [Exact-Tail-Nav] the leaf

In `web/src/nav.js`, More group, a new leaf **after Density**, closing the
row, so the density table and the exact density picture sit side by side and
Density keeps its place as a non-landing leaf (the author's a191 ruling, in the
comment at the head of `leaves`):

```js
exact: {
    label: 'Exact tail',
    chart: 'exact_tail',
    why: 'an exact (nttagg) aggregate only',
    hint: 'the exact probability mass and exceedance probability on a log10 '
        + 'scale, beside the float FFT answer, down to the last bucket of '
        + 'the support',
},
```

Key `exact`, label `Exact tail`. The deep-link plan accepts keys and labels,
case-insensitive, and asserts no label shadows a different key at its level;
neither does here, so `view=more:exact` and `view=more:Exact tail` both reach
it. Update the comment at the head of `leaves` (the row's order and the
"Density sits second to last" sentence) and the "the More row stays at seven
pills" sentence above `loadApproximation` in `main.js`, which becomes eight.

In `web/src/main.js`, a `LOADERS` row and a loader on the approximation
pattern (`loadApproximation`, `:3607`), without the in-pane switch:

```js
'more:exact': () => loadExactTail(),
```

`loadExactTail` builds a root holding `ledeFor('more', 'exact')` and an
`overview-plot` host (full width, not `plot-half`: this is a two-panel
document), calls `replacePane('pane-more', root)` **before** the mount so the
existing disposal drops any previous `moreChart` (`:1477`, `:2625`), then
`moreChart = await mountChart(host, { id: state.id, chart: 'exact_tail' })`,
and on failure replaces the host with `fetchFailed()` or `notDrawable()`
exactly as `loadApproximation` does. Readings (log on x, full range) come from
the document through the mount, with nothing written here.

In `web/index.html`, the Help panel's More line (`:854`) is already stale (it
omits Approximation and lists Density first). Rewrite it in the row's order:
`Tail behavior · Approximation · Window · Dependency · Sharpen · Narrative ·
Density · Exact tail`.

### [Log10-Axis-Rendering] the two units in the adapter

All in `web/src/charts/chartdoc-to-echarts.js`, plus one helper in
`web/src/utils/format.js`.

1. **Drawing.** In `drawingFor` (`:1098`), directly after the category-axis
   rule and before the `continuous` rule, so it holds whatever the series'
   `support` says:

   ```js
   if (yAxis.unit === 'log10_density') return 'points';
   ```

   and fold `log10_probability` into the existing probability rung (`:1106`),
   so the survival panel takes `step-post`, the right-continuous step the
   `probability` unit already takes (on a dense grid it reads as a line, as it
   does today):

   ```js
   if (yAxis.unit === 'probability' || yAxis.unit === 'log10_probability') return 'step-post';
   ```

2. **The `points` drawing.** In the series loop (`:1742` on), a branch for
   `style === 'points'` modeled on the stem's dot series (`:1767` to `:1772`):
   `type: 'line'`, `showSymbol: true`, a small `symbolSize` (3 or 4),
   `lineStyle: { width: 0 }`, `connectNulls: false`, `sampling` as for any
   gap-free series (`gapFree(points) ? SAMPLING : undefined`, the `minmax`
   sampler, which keeps each pixel column's extremes and so stays honest for
   markers). Still `LineChart` only, nothing new to register in `theme.js`.
   If the headline case (about 40,000 positive buckets per series) proves slow
   to draw, the fallback is `ScatterChart` with `large: true`, registered in
   `theme.js`; try the line form first.
   `rungAt` (`:3097`) and the mount's zoom listener (`mount.js:1906`) compare
   rung names only; `points` never changes with the atom count, so a zoom never
   triggers a rebuild on this chart. Grep `drawnAs` and `STEP_KEY` to confirm
   nothing else switches on the rung name.

3. **Ticks.** In `labelFormatter` (`:1398`), both units print the **exponent
   itself**: an integer as a plain integer with no grouping (`-400`, `-1200`),
   anything else to one decimal (`-467.5`). The axis label already says
   log10 and the values are exponents, so printing `1e-400` would state the
   transform twice and contradict the label. The readout carries the
   translation.

4. **Readout.** In `readValue` (`:3018`), both units return the exponent to two
   decimals and the probability it stands for, at the four significant figures
   the `probability` readout uses (`toExponential(3)`):

   ```
   -467.70 (1.995e-468)
   ```

   The probability is formed from the exponent through a new exported helper
   in `web/src/utils/format.js`, `log10ProbabilityText(exponent, digits = 3)`:
   split `e = Math.floor(v)` and the mantissa `m = 10 ** (v - e)`, and never
   form `10 ** v`, which is subnormal below about `-307.65` and zero below
   about `-323.6` in binary64, so most of the headline case would read `0`.
   **Carry the mantissa**: when `m` rounds to `10.000` at the requested digits,
   print `1.000` and add one to the exponent (`-400.00001` must read
   `1.000e-400`, never `10.000e-401`). This is the same rounding carry csv-grid
   misses when it prints `1000m`.

   `readoutModel` (`:3045`) needs no change: both panels are read by x, the
   head is the loss, and each row's value goes through `readValue` with the
   panel's y unit.

5. **The y window.** Both y axes declare `('linear',)`, so `scaled` is false,
   no log button is offered on y, and the `uncapped` rule in `axisWindow`
   (`:460`, density unit only) never applies. No change, but the smoke test
   below confirms a finite y window on both panels.

### [Exact-Tail-Fixtures] harnesses and tests

- `dev/scripts/capture-capability.py`: add
  `"nttagg": "nttagg CAP.Ntt dfreq [1:6] dsev [1:6]"` to `DECLS`, matching
  `tests/test_capability.py`.
- `dev/scripts/check-nav.mjs`: add `nttagg` to every `EXPECTED` row it lights.
  Written out, not derived, per the file's own rule. From the probe above plus
  the new chart: `overview:plot`, `overview:summary`, `overview:tail`,
  `overview:validation`, `overview:stats`, `pricing:calibrate`,
  `pricing:standalone`, `pricing:evaluate`, `bounds:bounds`,
  `bounds:pricing`, `more:density`, `more:behavior`, `more:approximation`,
  `more:window`, `more:narrative`, and the new row
  `'more:exact': ['nttagg']`. Add `nttagg` to the list of kinds that cannot
  cede (`:225`). Confirm each against the printed grid rather than trusting
  this list.
- `dev/scripts/capture_fixtures.py`: two `CASES`, the plain one and one with
  interior exact zeros, which is the case the `points` drawing exists for:
  `"nttagg": "nttagg FIX.Ntt dfreq [1:3] dsev [1:3] [1/3 5/8 1/24]"` and
  `"nttagg_gaps": "nttagg FIX.NttGaps dfreq [1 2] dsev [2 5]"` (support
  2, 4, 5, 7, 10, so buckets 3, 6, 8 and 9 are exact zeros).
- `tests/conftest.py`: `EXACT_TAIL_SUPPORTED = 'exact_tail' in
  aggregate.charts.CHARTS` (`CHARTS` is public, `aggregate.charts.__all__`)
  and a `requires_exact_tail` skip marker beside `requires_nttagg`.
- `tests/test_capability.py`, gated on it: an nttagg lists `exact_tail` and its
  `primary_chart` is still `agg`; a plain `agg` does not list `exact_tail`.
  `test_every_listed_chart_serves` already covers serving.
- `web/test/exact-tail-nav.test.js`, on the `ruin-nav.test.js` pattern: the
  leaf is the last in More, right after `density`; `chart` is `exact_tail`;
  `why` names nttagg; a capability with `exact_tail` in `charts` lights it and
  one without greys it while `more:density` stays lit.
- `web/test/log10-axis.test.js`: `log10ProbabilityText` reads `-400` as
  `1.000e-400`, `-467.7` as `1.995e-468`, `-0.30103` as `5.000e-1`, and
  `-400.00001` as `1.000e-400` (the carry). Then one hand-written two-panel
  document through `chartdocToEcharts`: the `log10_density` series has
  `showSymbol: true` and `lineStyle.width` 0 and no `step`; the
  `log10_probability` series has `step: 'end'`; a tick formatter call on each
  y axis gives `-400` for `-400` and `-1200` for `-1200`.

## Files

`web/src/nav.js`, `web/src/main.js`, `web/src/charts/chartdoc-to-echarts.js`,
`web/src/utils/format.js`, `web/index.html`, `web/test/exact-tail-nav.test.js`
(new), `web/test/log10-axis.test.js` (new), `dev/scripts/check-nav.mjs`,
`dev/scripts/capture-capability.py`, `dev/scripts/capture_fixtures.py`,
`tests/conftest.py`, `tests/test_capability.py`, `CHANGELOG.md`,
`dev/TODO.md`, `src/aggregate_api/__init__.py`. Possibly `web/src/charts/theme.js`
(only if the `ScatterChart` fallback is needed). No route, model or serializer
changes.

## Acceptance check

Run against the library that ships `exact_tail`: after any dependency sync,
`uv pip install -e V:/worktrees/aggregate_REFACTOR`, then `uv run --no-sync`.
`/v1/meta`'s `aggregate_version` confirms which library is live.

- `npm test` from `web/` passes, including the two new files.
- `uv run --no-sync python dev/scripts/capture-capability.py`, then
  `node dev/scripts/check-nav.mjs` is clean with the nttagg column.
- `uv run --no-sync python dev/scripts/capture_fixtures.py`, then
  `node dev/scripts/smoke-charts.mjs` is clean, with `exact_tail` replayed for
  both nttagg cases.
- `uv run pytest` passes; against a library without the chart, the two new
  capability tests skip and nothing else changes.
- Manual, after `.\scripts\build-web.ps1`:
  - `nttagg X dfreq [1:3] dsev [1:3] [1/3 5/8 1/24]`: More ▸ Exact tail lights
    and draws two panels; the mass panel is markers only; ticks on both y axes
    are plain exponents; hovering a bucket reads its exponent and probability
    beside the loss, and both agree with that bucket's `p_exact_log10` and
    `p_exact_float` in More ▸ Density. Overview ▸ Plot is unchanged.
  - `nttagg G dfreq [1 2] dsev [2 5]`: no marker at 3, 6, 8 or 9, and nothing
    drawn across them.
  - **The headline case.** Examples menu, `reproductions.agg`,
    `Wilson2017.DiceOfDice` (builds in about 1.5 s, `log2` 16, deepest exact
    bucket at log10 about `-462.5`). The Exact series descends to the far end
    of the support; the Float FFT series turns into scattered noise near the
    float floor (exponents around `-17` and below) and draws nothing where
    `p_total` or `S` is not positive. The deepest readout reads about
    `-462.51 (3.112e-463)` and not `0`. Note the fetch and first draw time; if either is painful, record it
    for the library (payload) or try the `ScatterChart` fallback (drawing).
  - A plain `agg` and a portfolio: Exact tail is greyed and the hover says
    "an exact (nttagg) aggregate only".
  - Once the deep-link plan has landed:
    `?database=reproductions&example=Wilson2017.DiceOfDice&view=more:exact`
    opens on the leaf.

## Out of scope

- The library chart itself, its payload size and its matplotlib rendering
  (`aggregate.plots.plot_chartdoc`): the library plan's.
- An exact survival or log10 column in the Density grid. The grid shows what
  `density_df` carries (`p_exact_float`, `p_exact_log10` for an nttagg).
- The phone page (`lite.js`), which has no More group.
- Making Exact tail the primary chart, or adding the exact series to the
  Overview plot.

## Version, CHANGELOG, commit

Bump `__version__` in `src/aggregate_api/__init__.py` to the next free minor
(`1.13.0` expected). No `uv sync` at the bump. CHANGELOG section `## 1.13.0`:

> [Exact-Tail-Leaf] **More ▸ Exact tail draws an nttagg's exact probabilities
> on a log10 scale, beside the float FFT.** Plan `dev/plan-1.13.0-exact-tail-leaf.md`.
>
> - New leaf at the end of More, lit when the library publishes `exact_tail`
>   (`aggregate` 1.5.0 or later); dark with its reason otherwise.
> - The chart adapter reads the axis units `log10_density` (markers only) and
>   `log10_probability` (right-continuous steps); ticks print the exponent and
>   the readout gives the exponent and the probability, e.g.
>   `-467.70 (1.995e-468)`.
> - The Help panel's More line lists the row as it is.

plus, only if the IR version moved, the line about older aLL. Tick the
matching `dev/TODO.md` entry (add one if none exists). Commit subject:
`[1.13.0] add More > Exact tail for the nttagg exact log10 chart`. Rebuild the
SPA after the commit; it is gitignored and never staged.

## Execution log

Executed 2026-10-14 as **1.13.0**, one step, against `aggregate` 1.5.0 (`edeffe3`, editable from `V:\worktrees\aggregate_REFACTOR`; `uv pip list` still shows 1.3.0, the harmless install-time record). The library's half landed in full first: `exact_tail` is in `aggregate.charts.CHARTS`, and an nttagg lists `['agg', 'approximation', 'approximation_tails', 'exact_tail']` with `primary_chart` `agg`. Every symbol the plan names was where it said, with line drift from the 1.10.0 to 1.12.0 bumps (`loadApproximation` at `main.js:3735`, the Help More line at `index.html:862`).

**Divergences.**

- **Panel titles.** The library's execution log for its plan found that the contract paragraph above gave the y axis labels as the panel titles. The shipped titles are "Exact probability mass" and "Exact survival function"; the paragraph is corrected in place. Nothing here reads a title.
- **`smoke-charts.mjs` asserted `ir_version === 3`**, stale since the IR moved to 4, so every captured document failed (32 failures before this plan touched anything). Corrected to a restated `IR_VERSION = 4`, in the style of the file's `MAX_RETURN_PERIOD`. Not in the plan's file list; needed for its acceptance check to mean anything.
- **Two smoke failures remain, and they are not this plan's.** `nttagg_gaps/agg [density]` and `nttagg_gaps/approximation [density]`: "full range is offered but no reading widened a window". The library's `agg` chart for `dfreq [1 2] dsev [2 5]` suggests `(-0.2, 10.2)` and offers full `(0, 15)`, and the adapter's nice-number rounding already widens the suggested window to `[0, 15]`, so the full-range button does nothing on this object. The fixture the plan prescribed exposed it; `exact_tail` replays clean on both nttagg cases (`ladder=points->points`). Left for the author: either the harness tolerates a suggested window that rounds out to the full one, or the reading should not be offered there.
- **`uv run pytest` in the acceptance check** was run as `uv run --no-sync pytest`, per `CLAUDE.md`.
- **The control list** `T:/worktrees/dev-files.md` named in the project's execute-plan skill does not exist (nor under `V:/worktrees`), so no row was updated.
- **Extra test cases**: `log10ProbabilityText` returns `''` for a missing or NaN exponent, and the tick test also checks a non-integer (`-467.5`).
- **Float FFT series have no interior gaps** on the headline case: the library ships each on a lattice cut at the first non-positive value (25,646 mass and 25,416 survival points against 40,000 exact), so the survival step never bridges an omitted bucket.

**Measured on the headline case** (`Wilson2017.DiceOfDice`, in process through `TestClient`): build 1.54 s at `log2` 16, `exact_tail` fetch 0.24 s for 2,557,991 bytes, `chartdocToEcharts` 14 ms, y windows `[-500, 0]` on both panels, ticks `-400` and `-460`, deepest exact bucket reads `-462.51 (3.112e-463)`. Browser draw time and the manual checks are the author's to kick.

**Gates.** `uv run --no-sync pytest`: 524 passed. `cd web; npm test`: 310 passed. `capture-capability.py` then `check-nav.mjs`: clean, the derived nttagg column matching the plan's list exactly. `capture_fixtures.py` then `smoke-charts.mjs`: 2 failures, both above.
