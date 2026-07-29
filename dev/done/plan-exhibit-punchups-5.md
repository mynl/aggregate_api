# plan-exhibit-punchups-5: steps, two anchors, a 3-D surface, reserved space

Status: **done** (1.0.0a28). Third round of author feedback on the exhibits.

## Steps, unconditionally

> Can we try step:middle drawstyle (which I understand is the same as matplotlib
> step-mid drawstyle.

Yes, and it should never have been conditional. Every value in a density frame is
the **mass in one bucket**, not a sample of a smooth curve, so joining two of them
with a slope draws probability at values between grid points that carry none.
`step: 'middle'` is exactly `drawstyle='steps-mid'`: the value holds across a
bucket centered on its grid point, which is what the discretized density *is*.

a23 gated it on a count of nonzero points, which was a guess at "is this
discrete". The guess was unnecessary and the gate is gone. Steps are right for a
coarse grid and right for a fine one, where at 2**16 points a bucket is sub-pixel
and the two renderings are indistinguishable anyway. A condition that can only be
wrong in one direction should not be a condition.

## Two anchors, labeled inward and outward

> when we show vertical lines for return periods pls do just two lines: 100 and
> 250; the label for one to the left and other to the right, so they don't
> overlap, and both at the top of the chart (rather than over the top, which
> overlaps the title).

`ANCHORS` is `[100, 250]`. The pair still spans the regulatory range (Solvency II
reads 1-in-200, the US 1-in-250) and the tooltip gives any other return period on
demand, so the third line was buying nothing and costing a label slot.

Labels are `position: 'insideEndTop'`, which for a vertical markLine is inside the
plot at the top rather than above it. That applies to the density panel's `mean`
and `1-in-200` lines too, which had the same collision with their title.

The first anchor's label is `align: 'right'` and the second's `align: 'left'`, so
their text opens away from the lines in opposite directions and they cannot
collide however close the two VaRs are. Ordering is by `ANCHORS` rather than by
frame order, so "first" and "second" mean the same thing every time and the sides
stay put.

## The bivariate surface

> to start to see the power can we have a surface render (log and normal density)
> of the bivariate outputs?

`web/src/charts/surface.js`, `echarts-gl` behind a **dynamic import**. The library
is 602 kB, larger than the rest of the app, and serves one of six object kinds, so
it is its own lazy chunk (165.9 kB gzipped) that a visitor who never builds a
bivariate never downloads. Confirmed absent from `index.html`.

The joint grid is block-**summed** to 128 x 128 (16,384 vertices), not sampled,
for the same reason the heatmap is: dropping cells discards mass and lightens the
tail, which is the region the picture exists to show.

Two z-scalings, both asked for. Linear shows where the mode is. Log is where the
interesting part lives: a joint density spans four or five orders of magnitude, so
on a linear height axis everything except the peak is floor, and tail dependence
is the whole reason anyone models a copula. Log is the default.

**One thing changed after measuring.** The first version sent a zero-mass cell as
`null`, on the honest-looking grounds that zero mass is not a small height, it is
no height. On the real fixture **41% of the mesh came back as holes** (an
FFT-built bivariate has large regions of exact zero), so the surface arrived
moth-eaten, and a shape full of gaps is unreadable whatever it is being accurate
about. Zero now rests on the log floor, one decade under the smallest mass
actually present, so the surface touches down where the model puts nothing and
rises where it puts something. The tooltip says `< 1e-15` there rather than
reporting the floor as data.

Falls back to the flat heatmap when the chunk fails or WebGL is unavailable, so a
bivariate always lands on a picture. Switching between them disposes and re-inits
the instance: ECharts cannot migrate a `grid` option to a `grid3D` one in place.

## Reserved space

> can we leave the space for the graph - so the page doesn't move around when the
> image finally arrives. that jump is distracting / confusing.

The host height is now computed and set **before** the fetch, in `mountExhibit`
and again in `loadOverview` (which has its own `loadStyle()` round trip in front).
The number is exact rather than a guess, because the geometry is a function of the
container width, which is known immediately.

## Aspect: the number and the words disagreed

> Can we also try aspect nearer say 4:3.25 (are we at 4:3 atm?) they are a bit
> too high atm.

These point opposite ways, and the resolution is that a26 was measuring the wrong
rectangle. It applied the house `FIG_W / FIG_H` (3.5 / 2.45, so **4:2.8**) to the
**plot area**, and the chrome around it then made the panel's *footprint* on the
page about **4:3.8**. So:

* "are we at 4:3 atm?" was a good estimate of the footprint, which was 4:3.8;
* "they are a bit too high" is right about that footprint;
* and **4:3.25 is flatter than 4:3.8**, so the number and the complaint agree
  once you measure the footprint rather than the plot rectangle.

`PANEL_ASPECT = 4 / 3.25` is now the target, applied to the footprint (plot area
plus the title strip above and the axis below), and the plot height falls out of
it. Measuring the footprint is also the fairer comparison with matplotlib, where
`FIG_W x FIG_H` describes the whole figure including its margins, not the axes box.

Result at a 1000 px host: panels 398 x 251 with a 323 px footprint, so 1.23, and
the whole exhibit is 347 px tall where it was 375. Stacked at 560 px: 730 px
where it was 777. The smoke test asserts the footprint ratio at both breakpoints,
which is the check a26 should have had; it was asserting 1.43 on the plot
rectangle and passing while the visible shape was 1.06.

`theme.aspect()` stays as the reference point that departure is measured from.
One constant to change if 4:2.8 is ever wanted instead.

## Verified

`uv run pytest` 92 passed, `ruff check src` clean, `node dev/smoke-exhibits.mjs`
over eight fixtures at both breakpoints plus both surface scalings.

The smoke test gained three assertions worth having: the footprint aspect (above),
that every density series carries `step: 'middle'`, and that the surface mesh is
**complete** (no holes) and has **relief** (heights not all equal), which are the
two ways a broken reduction would draw as something plausible.

What it cannot check: whether the surface renders. `surfaceOption` is pure and
assembles fine under node, but nothing offline exercises WebGL, and the browser
extension has never connected in any session. `EXHIBITS.bvagg.build` in 3-D mode
is likewise only reachable through the mount, so the smoke test exercises
`surfaceGrid` + `surfaceOption` directly instead.

## Bundle

| chunk | gzipped | eager? |
|---|---|---|
| app | 39.1 kB | yes |
| bootstrap | 24.7 kB | yes |
| codemirror | 114.2 kB | yes |
| echarts | 197.8 kB | yes |
| **echarts-gl** | **165.9 kB** | **no** |

The eager `echarts` chunk grew 186.1 to 197.8 kB gzipped. That is Rollup hoisting
echarts internals now shared between it and the lazy `echarts-gl` chunk into the
eager one, to avoid shipping them twice. 11.7 kB on the critical path is the
honest cost of the feature.
