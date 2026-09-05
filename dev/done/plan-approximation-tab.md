# Plan: the Approximation tab ([Approximation-Tab])

Status: DRAFT for review, not executed. Written 2026-09-04. API repo only,
no symlink: the LIB half already shipped (`aggregate` 1.0.0a331 to a333,
`[Approximate-Punchup]` plus `[Approximation-Centered-Mass]`,
`dev/done/plan-approximate-punchup.md` in the LIB repo) and this plan
consumes it. One bump.

## Goal

A reader looking at a built aggregate can open More, press Approximation,
and see the method-of-moments story: a Plot sub tab drawing the library's
`approximation` chart (the realized mass with the five fitted families
overlaid, and an exceedance panel adding the sub-exponential implied tail
`E[N] * S_X(x)`), and a Summary sub tab serving the `approximation`
exhibit (the `approximation_df` frame: fitted DecL fragments and
parameters, achieved moments with the Kolmogorov distance `ks`, and
quantiles on the return period ladder, all read against the `exact`
column). This is the aLL teaching surface the LIB plan was built for
(modules 1, 2 and half of 4).

## What the library serves (context for a reviewer with no context)

Landed upstream at a331 to a333, nothing further owed by LIB:

- **Exhibit `approximation`**, registered for `Aggregate` and `Portfolio`
  (updated objects only), serving the `approximation_df` property through
  the ordinary exhibit envelope. Columns are the approximations,
  `exact | norm | gamma | lognorm | sgamma | slognorm` (axis named
  `approximation`); rows are a `(component, measure)` MultiIndex over
  `meta` / `stats` / `quantiles` blocks. One string row (`distribution`,
  the DecL severity fragment) makes the frame object dtyped, which
  greater tables types per cell. On a portfolio the frame reads the total.
- **Chart `approximation`**, registered for `Aggregate` **only** (the
  implied tail needs a single severity; this is the same shape as
  `chart_reins`, which a portfolio also does not draw). Two `xy` panels
  over one outcome axis: `density` (mass ordinate) and `tail` (a
  `survival` axis declaring linear and log, with the paired
  `return_period` reading via `reciprocal_of`). Thirteen series on an
  ordinary book; a family the subject cannot admit is simply not drawn.
  One new series role appears, `ceiling`, on the implied tail curve; it
  is already in the IR's documented role vocabulary.
- Both are name-addressed through the existing generic routes
  (`available_exhibits` / `build_exhibit`, `available_charts` /
  `build_chart_doc`), so **no server change is expected**. Verification
  item: confirm nothing app side whitelists chart or exhibit names (the
  standing pattern per `_chart_options`; a grep, not an edit).
- `web/src/decl-keywords.json` checked 2026-09-04: it has never listed
  the `approximate` kind words (they are ordinary IDs, not keywords), so
  the a331 widening to `norm | lognorm | gamma` owes it nothing.

## Current app behavior

Nothing shows today, for two reasons. First, the API's environment
predates a331, so the capability payload does not carry the new names;
`uv sync --extra dev` after the LIB bump fixes that (standing agreement
7, version skew). Second, and the reason this plan exists at all: the nav
skeleton is editorial. `web/src/nav.js` says which leaves exist and
`available_exhibits` only decides which are live, so a new upstream
registration reaches the menu only when a leaf names it. No leaf names
`approximation` yet.

## Design

**One new leaf in the More row, `Approximation`, whose pane carries an
internal two state switch, Plot | Summary.** The nav is two levels
(groups, then each group's sub tab row), and `dev/scripts/check-nav.mjs`
guards that shape, so the requested third level lives inside the pane,
the way the raw / insurer perspective flip already lives inside every
exhibit pane. Recommended over the alternative (two sibling leaves in the
More row, `Approx plot` and `Approx summary`) because it matches the
requested shape, keeps the More row at seven pills, and keeps the two
readings of one story on one address. The alternative costs nothing if
preferred; say so at review.

- **Leaf** (`web/src/nav.js`, `NAV_GROUPS.more.leaves`): key
  `approximation`, label `Approximation`, gated `exhibit:
  'approximation'` so it lights exactly where the library serves the
  frame (an updated aggregate or portfolio) with no app side kind logic.
  Placed after `window` and before `dependency`: it is a diagnostic of
  the computed distribution, the natural neighbor of the grid frames.
  `why`: 'needs a computed aggregate or portfolio'. `hint`: 'the five
  moment matched families against the exact law: parameters, achieved
  moments, Kolmogorov distance, and the implied tail'.
- **Loader** (`web/src/main.js`, `LOADERS`): `'more:approximation'`
  renders the switch strip and the active half.
  - **Summary** is one call to the existing machinery:
    `loadExhibitLeaf('pane-more', 'approximation',
    ['more', 'approximation'])`. Greater tables walker, captions,
    perspective flip and CSV export all arrive free; `tables.FORMATS`
    stays empty (the frame carries its readings, and the family columns
    sit under a named column axis, which the library's format sweep
    already treats as data).
  - **Plot** is the `loadReinsPlot` shape: dispose any prior instance,
    mount a host div, `mountChart(host, { id: state.id, chart:
    'approximation' })`, with `fetchFailed()` / `notDrawable()` on the
    empty path. The generic `chartdoc-to-echarts` walker should realize
    the document with no per chart override (its axes and panels are the
    `agg` / `reins` vocabulary); if the tail panel's thirteen series
    legend or the `ceiling` role needs chrome, that lands as a small
    entry in the existing override dict, not as a new pathway.
- **The switch**: two pills inside the pane (Plot active by default on an
  aggregate). On a **portfolio** the exhibit is live but the chart is
  not: the Plot pill greys with a hover why, 'the implied tail needs a
  single severity, so an aggregate only', and the pane opens on Summary.
  Greyed, not hidden, per the house rule. Switch state is per session
  view state like the perspective flip; it does not need to survive a
  reload.

## Choices to rule at review

1. **Shape**: internal Plot | Summary switch (recommended) versus two
   sibling More pills. Ruled by the shape of this plan unless overridden. ==> correct sub pills not two env vars
2. **Default half**: Plot first on an aggregate (the picture leads, as
   Overview and Reinsurance both decided), Summary first where Plot is
   dark. Confirm. ==> pills always plot then summary; first available active (should always be plot)
3. **Leaf position** in the More row: after Window (recommended) or at
   the row's end before Narrative. ==> after tail behavior before window
4. No options beyond that: the library surface is deliberately
   option free (no arguments on either property), and the chart's only
   emitter option (`xmax`) is the same one the app already declines to
   surface on the agg chart. ==> agree

## Order of work and phases (one bump)

- **[Sync]** `uv sync --extra dev` against LIB at 1.0.0a333; confirm
  `/v1/meta` and the About panel report it (agreement 7).
- **[Nav-Leaf]** the `nav.js` entry; `check-nav.mjs` stays green (no
  group added, so `index.html` is untouched).
- **[Pane]** the loader, the switch, the portfolio greying.
- **[Kick-the-tires]** the acceptance list below, on an aggregate, a
  portfolio, and a not yet updated object; then the version bump and
  CHANGELOG per house rules.

## Acceptance checks

- An updated aggregate: More shows Approximation lit; Plot draws two
  panels, the survival axis offers the log reading and the return period
  reading, and the Exact, five family and Implied tail series are
  present; Summary renders the exhibit table whose numbers match
  `qd(a.approximation_df)` in a notebook, with CSV export working.
- An updated portfolio: leaf lit, pane opens on Summary, Plot pill greyed
  with the why text.
- A severity or distortion: leaf dark with its why; a built but not
  updated aggregate: dark.
- No new `from aggregate` import and no private reach (the sanctioned
  surface is unchanged); no server diff beyond none at all.
- `web/src/decl-keywords.json` untouched, per the check above.

## Execution notes

Executed 2026-09-05 at **a141**, one bump, after `[Library-Skew-a333]`
landed at a140 to give this a green tree to start from. Both gates
green: `uv run pytest` 386 passed, `cd web; npm test` 121 passed.
`node dev/scripts/check-nav.mjs` clean, `node dev/scripts/smoke-charts.mjs`
all clear.

Rulings taken as written: the internal Plot | Summary switch rather than
two sibling pills, the pills always in that order with the first
available one active, and the leaf placed after Tail behavior and before
Window rather than after Window as the plan recommended. No options
surfaced.

**[Sync]** ran as part of a140, so nothing was owed here.
`/v1/meta` reports `1.0.0a141` against `aggregate` `1.0.0a333`.

### Divergences

1. **`dev/scripts/check-nav.mjs` needed a row**, which the plan does not
   mention. `EXPECTED` is a hand-written table with one row per
   `group:leaf` and an unlisted leaf reads as "dark for every kind", so
   the new leaf failed the harness until `more:approximation` was added
   as `['agg', 'agg_reins', 'port']`. Its comment records that the row
   is the *leaf's* gate and that the Plot half's narrower gate lives in
   the pane, since a grid of leaves cannot express a split inside one.
2. **`dev/fixtures/capability.json` and `dev/fixtures/charts.json` were
   re-captured**, both gitignored so neither is in the commit. The first
   is what `check-nav.mjs` reads and predated a331, so it carried no
   `approximation` name at all. The second feeds `smoke-charts.mjs`.
3. **`loadExhibitLeaf` grew a fifth parameter, `header`.** The switch
   has to be built inside that function's `draw`, not inserted after it:
   `draw` re-runs on a perspective flip and on the static / interactive
   flip, and each run calls `replacePane`, so a control inserted
   afterwards would vanish the first time the reader touched either
   switch. Optional and trailing, so the six existing callers are
   untouched.
4. **`pane-more` had no chart to dispose until now.** Every other More
   leaf is a table, so `disposePaneChart` had no branch for that pane and
   `clearPanes` no line. Both gained one against a new `moreChart`,
   which is what stops the Plot half leaking an instance over a detached
   canvas, with its ResizeObserver, when the reader steps to Window.
5. **The failed-chart path replaces the host, not the pane.** The plan
   says "the `loadReinsPlot` shape", and that one empties the whole pane
   on a failure. Here that would take the switch with it and strand a
   reader who cannot draw the picture with no way to reach the table, so
   only the host is replaced and the switch survives.
6. **One CSS rule was added**, for a segmented-control member that is
   greyed. `aria-disabled` rather than `disabled`, which is the sub-tab
   rule's reasoning exactly: `disabled` suppresses the tooltip in Chrome
   and emits no pointer events, so the delegated `data-why` footnote in
   `utils/tip.js` would never see the pill. Bootstrap's hover fill is
   neutralized in the same rule, or the dead pill lights up under the
   pointer and reads as live.
7. **No chart override was needed**, which the plan flagged as possible
   for the thirteen-series legend or the `ceiling` role.
   `smoke-charts.mjs` realizes the document as two panels and thirteen
   series (fourteen on a discrete book), with the `density` panel
   offering logX, logY and fullRange and the `tail` panel adding the
   return period reading. The generic walker took it as it stands.
8. **The Reinsurance tab is renamed `Re`**, folded in on the author's
   request mid-run. Out of this plan's scope and recorded here because
   it rode in this commit. The group key stays `reinsurance`; only the
   three UI strings moved, in `nav.js`, the `out-tabs` markup and the
   Help panel entry, whose gloss now opens with the full word so the
   two-letter tab is still explained.

### The finding the plan did not anticipate

**The chart payload is 16.3 MB**, against the `agg` chart's 2.3 MB:
thirteen series over the full 65,536 point grid. Gzip covers the wire
and `_chart_cache` holds 8 documents, so the resident ceiling moves to
roughly 130 MB. Raised with the author, who took it upstream to the LIB
side as a sizing question rather than accepting it here. **Nothing app
side is owed either way**: the route is name addressed and the adapter
takes whatever panels and series the document declares, so a smaller
emission lands with no change here.

### Not verified by either suite

Neither suite renders. What wants a browser, on an aggregate, a
portfolio and a severity in turn: that the switch draws and the pills
swap the pane, that a portfolio opens on Summary with Plot greyed and
the hover reason readable, that the thirteen-series legend is legible at
phone width, and that the renamed `Re` tab actually brings the strip
inside a phone screen, which is the whole point of the rename.
