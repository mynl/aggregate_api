# plan-echarts-exhibit: a real chart engine and one exhibit per citizen

Status: **done** (1.0.0a21).

Stage 3 of the aLL work, and the substantial one.

## Why

The author's verdict on the old Overview plot was that it was not adequate. It
was not, and only one of the five reasons was the charting library:

1. It cropped x at `q(0.999)` on a linear scale, so the tail (what an accurate
   FFT is *for*) was the part not drawn.
2. Density around 1e-6 shared a chart with an exceedance in [0, 1]. The density
   dominated; S read as a cliff then a flat line.
3. It plotted `p_total` only, so a portfolio's diversification story was
   invisible.
4. Only `agg` and `port` drew anything. Distortion, severity, P&L and bivariate
   all landed on "No risk views for this object", and three of the eight landing
   heroes are portfolios with a bivariate among them.
5. No title, no legend, no export; 10 px canvas-drawn dashed marker labels and
   chips underneath. An instrument, not an exhibit.

## Decisions

**ECharts**, chosen by the author over Plotly, uPlot-and-polish, and Observable
Plot. It brings `dataZoom` (the argument that settled it: the tail is the thing
you want to explore), good defaults, and `echarts-gl` as the eventual path to a
bivariate 3-D surface without a second library.

**Two panels, kind-aware.** Density for shape, EP curve for cost, one spec per
first-class citizen so the tab always lands.

## Revisions to the approved plan

Two, both found by probing rather than assuming, and both made the work smaller:

1. **Per-unit densities come from `unit_density_df()`, not from walking
   `port[unit]`.** The plan assumed `Portfolio.density_df` carried `p_<unit>`
   columns. It does not: it has `p_total` and the per-unit *allocation* columns
   (`exa_*`, `lev_*`). Since the windowed-grid work the densities live on
   `unit_density_df()`, a long frame indexed `(unit, loss)` that also carries
   per-unit `F` and `S`. Unstacking recovers the wide common-index form, so
   **both panels get their per-unit series from one fetch** instead of one fetch
   per unit plus a hand-assembly.
2. **The chart theme is served, not hardcoded.** `aggregate.style.rc_params()`
   exposes the matplotlib color cycle, so `GET /v1/meta/style` hands it to the
   frontend and the interactive exhibit matches the Plot tab by construction.

## What landed

### `web/src/charts/`

- **`theme.js`**: the tree-shaken ECharts build (`echarts/core` plus explicit
  `use()`), the style fetch, and the shared option fragments. The narrow
  `DataZoomInsideComponent` and `VisualMapContinuousComponent` are deliberate:
  the umbrella names pull both halves of each.
- **`exhibits.js`**: the per-kind registry and the two-panel builder.

The cursor link between panels is **exact**. Both are built from the same row
array, so a dataIndex is the same grid bucket in either; a point the EP panel
cannot show is emitted as `null` rather than dropped, keeping the indices
aligned. The mirrored `highlight` dispatch carries a re-entry guard, or the two
panels would highlight each other forever.

Series in the two panels share a `name`, which is what makes one legend entry
toggle a unit in both.

### Backend

- `GET /v1/objects/{id}/unit_density_df` (Portfolio only): `loss`, then
  `p_<unit>` / `S_<unit>` per unit and the total. Binning already does the right
  thing for both families: a `p`-prefixed column sums, everything else takes the
  super-bucket right edge, which is correct for a survival.
- `GET /v1/meta/style`: colors, grid color, line width, font size.
- `density_df` now answers for `sev`, synthesizing `loss / pdf / F / S` from the
  frozen scipy variable. The column is `pdf`, not `p_total`, on purpose.

### Overview header block

Name, kind, tag chips, the note as the lead, and a collapsible canonical
`pprogram`, all from `/meta`. Retires `pendingNote`, so the lead is the note the
object carries rather than one remembered from the last example clicked, and a
hand-typed `note{}` gets one too.

### Bundle

353 kB gzip against 187 kB before, split four ways (app 27.8, bootstrap 24.7,
codemirror 114.2, echarts 186.6). The vendor split is new and is the point: a
redeploy no longer invalidates ~325 kB of cached library code in every returning
browser.

ECharts at 186.6 kB is the price of the capability. It is inside the 150 to
200 kB range quoted when the engine was chosen, but it is not free and the
CHANGELOG says the number out loud rather than burying it.

## Verified

- `uv run pytest`: 81 passed, including the three new route tests.
- `node dev/smoke-exhibits.mjs`: all six kinds build a drawable option against a
  live api. Sample run:

  ```
  OK   agg         panels=2 series=2  SMOKE.A:2048/2048 SMOKE.A:1035/2048
  OK   port        panels=2 series=6  U1:2048 U2:2048 total:2048 (EP 233/722/851)
  OK   sev         panels=2 series=2  SMOKE.S:512/512 SMOKE.S:511/512
  OK   distortion  panels=1 series=2  g(s):102/102 identity:2/2
  OK   pnl         panels=2 series=2  SMOKE.N:2048/2048 SMOKE.N:139/2048
  OK   bvagg       panels=1 series=1  joint density:4717/4717
  ```

  The short EP counts are correct, not a defect: a thin-tailed unit's survival
  reaches the noise floor early, so its curve ends where the numbers stop
  meaning anything.

**Not verified: how it looks.** The Chrome extension was not connected during
this run, so no screenshot was taken and no rendered chart was inspected. The
smoke test proves the data reaches the chart in a drawable shape; it cannot
prove the chart is any good. That eyeball pass is outstanding.

## Follows on

- `echarts-gl` surface for the bivariate, behind a dynamic import, with a
  server-side downsample of the joint matrix.
- The EP window is fixed at 1-in-1 to 1-in-100,000. If a heavy-tailed book wants
  further out, that becomes a control rather than a constant.
