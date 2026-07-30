# plan-plotly-spike: two renderers, one set of decisions

Status: **done**, landed as `1.0.0a30`.

## The ask

> how hard is it to implement plotly too, just line graphs, no surfaces yet, just
> to see what they'd look like. And have a switch somewhere to compare. that seems
> like work on plotly but the switch shd be quite easy.

Right on both counts, and the interesting part was neither.

## Why this is a spike

The author is not sold on ECharts (a28). What makes that hard to act on is that
almost everything wrong from a26 to a29 was a design error on our side: the wrong
rectangle measured, the wrong default orientation, binned data, conditional steps,
labels over the title, a reservation aimed at the wrong layout. None of those are
arguments about a library, so swapping on the strength of them would be swapping
on bad evidence. Both engines on the same data behind a switch is the experiment
that separates the two questions.

Scope stays small deliberately: `agg` and `port`, line graphs, no surfaces.

## What the work actually was

Not the Plotly code. The Plotly figure builder is about 250 lines and most of it
is transcription. The work was **separating the chart decisions from the ECharts
option**, because until that was done the second renderer could only be a second
guess at the same chart.

`twoPanelData()` is now that separation: which curves, over which x-window, on
which scales, which verticals are marked and which way their labels open. Both
renderers read it and neither re-derives any of it.

Consequences, all of them improvements on their own:

- The four two-panel specs gained `panelArgs`, doing the column picking, with
  `build: echartsBuild(panelArgs)`.
- `sev` and `pnl` stopped patching titles and axis names onto a built option after
  the fact. Their wording lives in the shared bundle now.
- `anchorMarks()` returns neutral `{x, name, faint, align}`; `anchorLineStyle()`
  does the ECharts dressing.

## The bundle, which was nearly a runtime bug

The first cut used `plotly.js-basic-dist-min` with `scattergl` traces. That bundle
registers **bar, pie and scatter only**. It would have thrown "invalid trace type"
in the browser and nowhere else, since the figure builder is pure and every
offline check passed.

Its `scatter` is the SVG renderer, which is the deeper problem: since a27 the
exhibits carry every one of 2**16 grid points, so a portfolio is half a dozen
curves of 65,536 points. SVG would have made Plotly look bad for a reason with
nothing to do with how it draws. ECharts renders to canvas, so WebGL is the
like-for-like choice, and that means `plotly.js-gl2d-dist-min`.

Cost: 535 kB gzipped against the eager ECharts chunk's 198 kB. Lazy, verified
absent from `index.html`. If Plotly wins, a custom build registering only
`scatter` and `scattergl` cuts it well below gl2d, which also carries parcoords
and splom that nothing here uses.

The smoke test now reads the registered trace list out of the shipped bundle and
fails if a figure uses a type that is not in it.

## Parity, asserted rather than assumed

An unfair comparison answers nothing, so the properties a26 to a29 established are
checked on the Plotly figure too:

- `line.shape: 'hvh'`, Plotly's centered step, the same shape as ECharts'
  `step: 'middle'` and matplotlib's `drawstyle='steps-mid'`
- loss on x in **both** panels, never a transpose
- the same reserved height, so flipping engines does not move the page
- the capital anchors present as shapes with labels opening away from their lines
- one legend entry per unit, not two: Plotly toggles per trace, so the tail trace
  joins its density trace's `legendgroup` and stays out of the legend, or a
  portfolio lists every unit twice and hiding one leaves its tail curve behind
- **Plotly log axes take `range` in exponents.** Handing one 1e-15 where it wants
  -15 collapses the axis while looking correct in the source. The test round-trips
  `10 ** range[0]` against the survival range the shared bundle computed.

## Verification

`node dev/smoke-exhibits.mjs`: 17 checks, including four new `plotly/*` ones at
both breakpoints, all passing. `uv run pytest` 92 passed. `npm run build` clean
with no size warning; app chunk 41.72 kB gzip (39.47 at a29), Plotly 535.42 kB
gzip and lazy.

Not verified: how either of them looks. The Chrome extension has still never
connected, so the comparison this whole stage exists to enable has not been made
by anyone yet. That is the author's next step.

## If Plotly wins

Lift `twoPanelData` into a real intermediate representation and make
`to-echarts` / `to-plotly` proper adapters, covering every kind. If it loses,
`engine.js` and `plotly-panels.js` come out, the dependency goes, and nothing
else moves: the `twoPanelData` split is worth keeping either way.
