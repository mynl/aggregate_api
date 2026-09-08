# plan-color-stretch: gamma and log color stretch for 2-D density panels

Status: **executing, 2026-09-08.** Handed over for execution via
`/execute-plan`; the rulings below are treated as dispositioned. Written
2026-09-08 from a design discussion in the `aggregate` (LIB) repo; this is the
app-side plan. Execution log at the bottom.

## Goal

Let the 2-D charts (the joint surface, its floor image, heatmap panels, and
their contour overlays) reveal faint density structure by stretching the
*coloring* only. The density values, the tooltips, and the colorbar's value
axis are never transformed; only the mapping from value to color changes.
Gamma stretch is the headline addition, log the companion, linear the escape
hatch.

## Background: what a color stretch is and why we want one

A joint density's range is the product of two marginal ranges, so it
essentially always spans many decades. A linear color map spends its whole
ramp on the peak: the body of the distribution lands in the bottom percent of
the ramp and renders as one undifferentiated dark field. That default picture
is nearly useless, which is the motivation.

The gamma stretch replaces the normalized value $u = z / z_{max} \in [0,1]$
by $u^\gamma$ with $0 < \gamma < 1$ before the color lookup. Endpoints are
fixed; everything faint moves up, and more so the fainter it is. On log axes
the map is linear with slope $\gamma$, so gamma stretching is contrast
reduction by factor $\gamma$ in log space: roughly $1/\gamma$ times more
decades of support become visible. Practical values for these densities are
$\gamma$ in 0.2 to 0.4 (field-tested on the `aggregate` art renders,
`aggregate_REFACTOR/hacks/art_bivariate.py`).

Gamma is preferred over log as the default for three reasons: it needs no
special handling of the exact zeros and FFT fuzz that fill every compactly
supported density (log needs an arbitrary floor, and the floor shows); it
preserves peak dominance, so the mode still reads as the mode; and it
degrades gracefully toward the linear reading. Log remains valuable when the
structure of interest spans four or more decades with no meaningful body
versus highlight distinction.

Rulings from the design discussion (author, 2026-09-08):

- 2-D output only. 1-D charts encode probability in axis position and
  already have honest log axes; there is nothing for a color stretch to act
  on there.
- Coloring only, never the z values. On the 3-D surface the geometry stays
  linear; the stretch applies to the color drape (and floor image), which is
  exactly what makes faint support visible without distorting shape.
- A stretch should be the *default* for joint-density panels, not an
  option nobody finds. Gamma about 0.35.

## Current behavior

Every 2-D color mapping in the app is a linear ECharts `visualMap` over the
same six-stop ramp:

- `web/src/charts/theme.js:81` exports `VIRIDIS`, six hex stops, evenly
  spaced by ECharts across `[min, max]`.
- `web/src/charts/surface.js:172` builds the joint surface's two maps (the
  surface drape, which draws the colorbar, and the floor image), both
  `inRange: { color: VIRIDIS }`, linear.
- `web/src/charts/chartdoc-to-echarts.js` (about line 1470) gives each grid
  panel (kind `surface` or `heatmap`) its own `visualMap`, same linear ramp.
  Panel view state already carries per-panel switches (`logX`, `logY`,
  `fullRange`, and the kind toggle), so there is an established control
  pattern to extend.
- Contour overlays take their level values from linearly spaced levels, via
  the helpers in `web/src/charts/cell-reading.js` (`contourPaths`,
  `levelLine`).
- `web/src/charts/mesh-export.js:375` bakes the same viridis stops into
  exported meshes.

ECharts has no analogue of a matplotlib `Normalize`, so the stretch cannot be
expressed as a norm object.

## The mechanism: ramp resampling

The stretch is implemented entirely as a precomputed color ramp, with the
data and the `visualMap` value range untouched:

$$\text{color}(u) = \text{VIRIDIS}\bigl(u^{\gamma}\bigr)$$

realized as a dense stop list (33 stops is ample) sampled from the
interpolated viridis at positions $(i/32)^{\gamma}$ and fed to
`inRange.color`. ECharts spaces the stops evenly over the value range, so
the composite mapping is exactly the gamma stretch. The colorbar then shows
true values on its axis against a visibly warped ramp, which is the honest
presentation: the bar itself documents the nonlinearity. Log works the same
way with stop positions from a floored log map (a `decades` parameter, the
number of decades below the peak that survive; default 6).

One shared helper in `theme.js` (say `stretchedRamp(stretch)`, where
`stretch` is `null` for linear, a float in `(0, 1]` for gamma, or `'log'`)
serves the surface chart, the chartdoc panels, and the mesh export, so the
warped ramp exists in exactly one place.

## The change, by workstream

- **[Color-Stretch-Ramp]** `theme.js`: an interpolator over the `VIRIDIS`
  hex stops plus `stretchedRamp(stretch)` returning the dense stop list.
  Pure function, unit-testable in `web/test`.
- **[Color-Stretch-Surface]** `surface.js`: both visualMaps (drape and
  floor) take the ramp from `stretchedRamp`. The joint surface is always a
  density, so its default is `stretch = 0.35`.
- **[Color-Stretch-Heatmap]** `chartdoc-to-echarts.js`: grid panel
  visualMaps take the ramp from `stretchedRamp`. Default is linear unless
  the chartdoc panel declares a `stretch` hint (see the wire note below).
- **[Color-Stretch-Contours]** contour overlay levels follow the active
  stretch: levels equally spaced in stretched space, that is at
  $z_{max} \cdot (k/n)^{1/\gamma}$ for gamma (geometric for log, unchanged
  for linear). Without this the stretch and the contours disagree about
  where the visual structure is.
- **[Color-Stretch-Controls]** a per-panel color control beside the existing
  kind and log switches, cycling Linear, Gamma, Log. Gamma uses the fixed
  default 0.35; a numeric dial is explicitly out of scope for this pass
  (record it as a possible follow-up, not a requirement).
- **[Color-Stretch-Export]** `mesh-export.js` bakes the currently active
  stretched ramp, so an exported mesh matches the screen.

### Wire note (no LIB dependency)

Everything above works with the grids the API already serves; no LIB or API
schema change is required. As a forward hook, the chartdoc reader treats an
optional per-panel `stretch` field (same values as the control) as the
panel's default when present. LIB can start emitting it whenever its own
matplotlib exhibits grow the matching `stretch` kwarg (tracked separately in
the `aggregate` repo as `[Bivariate-Color-Stretch]`; not part of this plan).

## Defaults ruling

- Joint surface chart (always density): gamma 0.35.
- Chartdoc grid panels: linear unless the document says otherwise, because a
  grid panel's z is not always a density (kappa, quantile and other surfaces
  flow through the same panel kind, and a silent nonlinear default there
  would mislead). The control makes the stretch one click away.

## Acceptance checks

- On the joint surface of a lognormal-ish bivariate example, the default
  view shows the support region and tail structure that the linear view
  renders as black, and the surface *geometry* is pixel-identical to before
  (color drape only).
- The colorbar's value labels are unchanged between Linear and Gamma; only
  the color positions along the bar move.
- Tooltip values are unchanged under every stretch.
- Contour overlays visibly track the color bands under each stretch (no
  contours bunched at the peak while the colors resolve the tail).
- A heatmap panel defaults to linear; switching its control to Gamma and
  back is lossless.
- Exported mesh colors match the on-screen stretch.
- `smoke-charts.mjs` fixtures re-captured if any serialized chart option
  changes.

## Out of scope

- 1-D charts (ruled out; log axes already serve them).
- Any transformation of density values, levels excepted as specified.
- A user-adjustable gamma dial (follow-up candidate).
- Datashader-style histogram equalization (`eq_hist`): right for a future
  interactive explorer, wrong for exhibits someone reads numbers from.
- The matplotlib-side stretch in the `aggregate` library
  (`[Bivariate-Color-Stretch]`, tracked in that repo's `dev/TODO.md`).

## Execution log

Executed in two phases: **[Color-Stretch-Surface]** (the ramp helper, the
relief's default gamma, its contour ladder, and the mesh export) at a148, then
**[Color-Stretch-Heatmap-Controls]** (flat panels, the per-panel control, the
wire hint) at a149. Divergences, recorded as made:

- **Helper location.** The plan puts `contourPaths` and `levelLine` in
  `cell-reading.js`; they live in `surface-geometry.js`. Mechanism unaffected.
- **Ramp module.** The shared helper lives in a new leaf module
  `web/src/charts/color-stretch.js` rather than in `theme.js`: `theme.js`
  imports `echarts/core` and `api.js`, so `node --test` cannot reach it bare,
  and the repo's convention (per `cell-reading.js`) is that testable logic
  lives in leaf modules. `theme.js` re-exports `VIRIDIS` from it, so the ramp
  still exists in exactly one place and no import site moved.
- **Log-z interaction, a gap the plan does not cover.** The relief and the
  flat panel already offer a log reading of z (`log y` on the grid panel),
  and its coloring is linear over log height, itself a color stretch. Filled
  ruling: a log z axis drops the *default* (and the document hint) back to
  linear, so the ruled gamma default never silently stacks on the log
  reading; an explicit reader choice is honored regardless. Today's log view
  is therefore pixel-unchanged.
- **Export wiring.** The effective stretch is resolved once in the surface
  builder, and `option.meshSource` now carries the baked `ramp` beside
  `colorRange`; `mount.js` passes it through. The plan left where the export
  learns the stretch unstated; this way the file cannot disagree with the
  screen by construction.
- **Contour formula generalized.** The plan's gamma levels
  $z_{max} (k/n)^{1/\gamma}$ assume a zero floor; the implemented ladder is
  $z_{min} + (z_{max} - z_{min}) \cdot s(k/(n+1))$ with $s$ the stretch
  inverse, which reduces to the plan's formula on the linear-z relief and
  stays meaningful on the shifted log-z range.
- **Smoke fixtures.** `dev/fixtures/charts.json` holds input documents, not
  serialized options, so the acceptance item about re-capturing fixtures is
  moot; `smoke-charts.mjs` replays clean unchanged.
- **Trackers.** `dev/TODO.md` has no entry for this plan and the control list
  `dev-files.md` was not found on `T:` or `V:` (no `T:\worktrees` exists on
  this machine today), so neither was updated.
