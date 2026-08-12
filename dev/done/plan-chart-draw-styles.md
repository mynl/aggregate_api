# plan-chart-draw-styles: draw a discretized law as one

Status: **not started.** Written 2026-08-07 after the author reported that the
Overview density is a plain line, when the agreed behavior is steps-mid for a
discretized law and lollipops once a zoom leaves few enough atoms on the page.

This is a regression plus two things that were never built. It is small, and it
is written down because getting it wrong once already cost a round trip.

## What broke, and how

`1.0.0a50` replaced an unconditional `step: 'middle'` on the density with the
library's three-rung ladder from `aggregate/plots/_chartdoc.py`: stems at or
under 40 visible atoms, steps-mid above that, and a plain line under
`STEP_PIXELS = 3.0` pixels per atom.

The third rung is the problem. Measured on this app's panel widths:

| build | grid | visible atoms | px per atom | drawn |
|---|---|---|---|---|
| lognormal, log2=16 | 65,536 | 28,813 | 0.015 | line |
| lognormal, log2=12 | 4,096 | 1,802 | 0.24 | line |
| Dice | 32 | 19 | 22.3 | stem |

The step rung needs between 41 and 141 visible atoms on a 424px panel. No real
book lands there, so steps went from *always* to *never* and the only reachable
rung is the lollipop on a toy.

The ladder is right for the renderer it was written for. `plot_chartdoc` draws a
static figure, and sub-pixel steps and a line really are the same pixels there,
so the cheaper one tells no lie. This chart has `dataZoom`. Importing a
static-figure optimization into an interactive chart, and dropping the app's own
always-steps default to do it, is the error.

## Two things that were never built

**The right panel has never been stepped.** `rightSeries` carries no `step` and
never has, so S, F and the return period have always drawn as plain lines. Note
the correct style there is steps-**post**, not steps-mid: a cumulative jumps at
the atom and holds to the right, which is what `_chartdoc.py:95` does for a
`probability` axis.

**Zoom has never re-evaluated anything.** The option carries `dataZoom` but
nothing listens to it; `redraw()` is called only by the toggles and by resize.
So "lollipops when you zoom in and there are few points" has never existed. a50
did not add it either: `densityStyle` reads `densityWindow`, the *crop*, so it
only ever catches a natively tiny book.

## Not the cause: the chart-IR `support` field

Investigated and ruled out, because the parallel `aggregate` work reported a
serialization bug on it and it is worth recording why that is a different fault.

`ChartSeries.support` was stripped from the canonical dict whenever it equalled
its `'atomic'` default, so the instruction that says "draw steps or stems"
reached nobody while `'continuous'` survived. That is real, and the library has
already fixed it: `_ALWAYS[ChartSeries]` now lists `support`, and measured from
here on `aggregate` 1.0.0a226 a live `reins` chart doc carries
`support=atomic` on all six series.

It cannot be the cause here, because **the Overview plot never reads a chart
document**. `agg`, `port`, `sev` and `pnl` fetch raw frames (`density_df`,
`unit_density_df`, `tail_df`) and build the option client side; `agg`, `port`
and `pnl` register no chart at all, so there is no IR to read. The app's only
consumer of `chartdocToEcharts` is the bivariate `joint_surface`, where steps
and stems are meaningless. The Reinsurance Plot also takes a frame.

## Decisions taken

Taken with the author on 2026-08-07.

1. **No pixel rung at all.** Atomic and over 40 visible atoms is steps-mid, at
   any density. That is what the app did before a50, `sampling: 'minmax'`
   already bounds the vertex cost, and a threshold nobody can defend is worse
   than no threshold.
2. **The right panel steps too**, as steps-post.
3. **Zoom re-evaluates**, so the lollipop rung is reachable by zooming, which is
   the half of the original discussion that was never built.

## The work

* **`densityStyle` loses its pixel rung and its `panelW` argument.** It becomes
  support plus a count: `continuous` is a line, 40 or fewer visible atoms is a
  stem, anything else is a step. `STEP_PIXELS` goes.
* **`rightSeries` takes the same decision** and applies `step: 'end'`, which is
  ECharts' spelling of steps-post: hold at `y_i` across the interval, then jump.
  A continuous series stays a line. The stem rung does not apply to a cumulative
  axis, which takes a value everywhere rather than only at the atoms, so the
  two-rung choice there is line or step.
* **Zoom.** `mountExhibit` keeps a `zoom` window, `opts()` carries it, and
  `echartsBuild` injects it into the args, so none of the four `panelArgs`
  builders change. `twoPanelData` uses `zoom` in preference to `densityWindow`
  **for the drawing decision only**; the axis `min` / `max` stay off the crop,
  because dataZoom owns the visible extent and rewriting the axis on redraw
  would fight it.
* **Preserving the zoom across the redraw.** `renderer.update` calls
  `setOption(next, true)`, which resets a dataZoom to full range, so a
  zoom-triggered redraw would undo the zoom that triggered it. The current
  `start` / `end` are read back off `chart.getOption()` and written into the new
  option's `dataZoom` config, so the replace restores them.
* **Only redraw when the rung actually changes.** A zoom fires continuously;
  rebuilding the option on every wheel notch would be an option rebuild per
  frame. The listener compares the rung it would now choose against the one
  drawn and returns unless they differ.

## Verification

* `node dev/scripts/smoke-exhibits.mjs`. It already prints `draw=` per case and
  asserts the rung against the series built, so the regression is visible in its
  output: `agg`, `port` and `pnl` must read `draw=step`, `sev` `draw=line`, and
  `discrete` `draw=stem`.
* Extend it with the case the ladder is now about: the same frames judged
  against a **narrow window**, proving the stem rung is reachable by zoom rather
  than only by a tiny book.
* `uv run pytest`, which does not touch this, and `node dev/scripts/check-nav.mjs`.
* By eye, since this is a drawing change: build a lognormal aggregate, confirm
  the density reads as steps, zoom until the atoms separate and confirm it
  becomes stems, and confirm the right panel is stepped and the zoom survives
  the change of rung.

Version bump `1.0.0a53`.
