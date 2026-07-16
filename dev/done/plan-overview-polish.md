# plan-overview-polish — Overview landing punch-ups

Status: **done (1.0.0a15).**

Target: **1.0.0a15** (one bump).

## Why

Demo feedback on the a13 "Description to distribution" Overview landing, plus a
table-consistency question. Three punch-ups and one design call.

## What landed

- **Overview tables get a `Static | Interactive` toggle (Static default).** The
  house rule is "every table is a CsvGrid" (sort / filter / search), and the two
  Overview exhibits (`summary_df`, `tail_df`) were the only hold-outs, still
  hand-built. But the Overview is the landing *demo* ("demo-central"): the
  curated static exhibit -- lit **1-in-200 / 1-in-250** anchors and bold
  **Agg / total** "what's my number" -- tells the story better than a bare grid,
  and these frames are 3-11 rows so CsvGrid's interactivity buys little.
  CsvGrid also has **no row-highlight** option, so the two are genuinely
  different instruments, not a restyle. Rather than force one, the exhibits carry
  a small `Static | Interactive` segmented toggle: **Static** (the curated
  exhibit) is the default, **Interactive** swaps in the CsvGrid; the choice is
  sticky per browser (`localStorage`). Every other table in the app stays CsvGrid.
- **Density / exceedance plot width capped.** The uPlot Overview chart was
  `width: 100%` (full-bleed, silly on a wide screen); now `max-width: 720px`.
  uPlot's ResizeObserver reflows to the capped container.
- **Density plot x-axis cropped to a sensible window.** The plot auto-fit to the
  whole FFT grid, so a heavy tail squashed the visible mass into a sliver. It now
  crops to roughly `q(0.001)..q(0.999)` with 2% padding -- the same window
  `aggregate`'s `Aggregate._limits` / `Portfolio._limits` use (`hi = q(0.999)`;
  signed grids use the low quantile too). Computed **client-side from the `F`
  column we already ship** (a deliberate one-off, flagged as not-a-pattern),
  which distinguishes signed (PnL) from non-negative (agg / port) automatically.
  Drag still zooms. Measured crop: agg 131k -> 14k grid width (11%), signed PnL
  262k -> 5.5k (2%), port 131k -> 4.7k (3.6%).

## Design call: no upstream `plot_hero`

Considered requiring every first-class citizen (FCC) to expose a `plot_hero`
returning "the one plot" for the landing. Declined: the FCCs
(`Aggregate` / `Portfolio` / `BivariateAggregate` / `PnL` / `Severity` /
`Distortion`) share **no common base class** and each implements its own
multi-panel `.plot()`, so a `plot_hero` would be N duplicated upstream methods
for our benefit. Our interactive uPlot density / exceedance already *is* the
hero for the gridded kinds (agg / port / pnl), fed from `density_df` with the
x-window from the shared `q()` logic. The one place a library "primary figure"
would genuinely help is `bivariate` / `distortion` (object-specific plots our
uPlot doesn't cover) -- deferred until one of those lands on the landing. The
matplotlib `.plot()` itself is being improved upstream separately.

## Files

`web/src/main.js` (toggle + dual-mode exhibit renderers, restoring
`renderExhibit` for the static view), `web/src/plot-interactive.js` (x-range
crop), `web/src/styles/site.css` (plot `max-width`, toggle styles). SPA bundle
rebuilt (`scripts/build-web.ps1`). No backend change.

## Verified

SPA builds clean; the x-range crop measured sane windows across agg / pnl / port
(above). Static remains the default; Interactive swaps in CsvGrid and back
without leaking grids (teardown keyed on `pane-overview`).
