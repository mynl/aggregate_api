# [Envelope-Band-Render] The bounds envelope band draws in the wrong place

Status: EXECUTED at 1.0.0a99, 2026-08-14. Diagnosed 2026-08-14 from the
oversight session; the served document is correct and the defect is entirely
in this repo's ECharts realization, so the fix belongs here and raises no
upstream ask. Execution notes at the foot.

## Symptom

The Bounds pane's envelope chart (both panels) shows a wavy line at roughly
g = 0.2 labeled Envelope, a shaded triangle under the identity diagonal, and
no band around the resampled or calibrated curves. The library's reference
rendering of the same document (`bd.plot_envelope(10)` in LIB
`hacks/distortions.ipynb`, matplotlib through `plot_chartdoc`) shows the true
band: lower edge just above the diagonal, concave upper edge, every sampled
curve inside it.

## Diagnosis, with evidence

The envelope is the only chart whose document carries a band series: `y` is
the lower edge, `y2` the upper (LIB `charts/_emit_bounds.py`, the single
`y2=` in the emitters). The adapter's band branch
(`web/src/charts/chartdoc-to-echarts.js`, the `if (y2)` block around line
866) realizes it as two line series sharing an ECharts `stack`: the lower
edge with an invisible area, then the gap `hi - lo` stacked on top with the
fill. The comment calls this exact because the two share one x array.

That holds only on a category x axis. Both axes here are `type: 'value'`,
and ECharts data stacking on twin value axes stacks the **x dimension**:
it sums the x coordinates and leaves y raw. Reproduced outside the browser
with this repo's own tree shaken ECharts 5.6 registration (theme.js list),
by feeding the adapter's option into `echarts.init(null, null, {ssr: true})`
and reading the stack result dimension: for `Envelope (upper)` at index 280
the stacked value is 1.0898, which is 0.5449 + 0.5449, the two series' x
values summed.

Every visible artifact follows. The upper half draws at doubled x with the
raw gap as y, so the wavy 0.2 line is `hi(s) - lo(s)` for s in [0, 0.5]
stretched across the panel (its right endpoint is the gap at s = 0.5, not
zero, which is why it does not close). Everything past s = 0.5 is clipped.
The area fill spans from that stretched curve to the lower edge, painting
the triangle under the diagonal. Each panel has its own stack and fails
identically. The code arrived at a62 with the adapter adoption and has never
rendered correctly; no ECharts version change is involved.

## Fix

In the `if (y2)` branch, drop `stack` entirely and emit three series, all
carrying the document series' name so the one legend entry toggles them
together (the stem branch a few lines below is the precedent for two series
sharing a name):

1. The fill, a `custom` series polygon: vertices are the lower edge walked
   forward then the upper edge walked back, mapped per vertex with
   `apiRef.coord`, filled `fade(color, 0.18)`, `silent: true`,
   `tooltip: { show: false }`, `clip: true`, z under the edge lines.
   `CustomChart` is already registered (theme.js) and the contour overlay in
   this same file (`type: 'custom'` around line 1206) is the pattern to
   follow, including how it re renders under zoom. Build the vertex list
   from the already mapped `x`, `y`, `y2` arrays of the drawn record, so the
   axis exchange and the reflected reading ride along unchanged; skip null
   entries (the log hide produces them, and a polygon must not bridge a
   gap).
2. The lower edge, a plain line at `(x, lo)`: the existing `base` styling
   (width 0.8, series color), keeps the tooltip, no `stack`, no area.
3. The upper edge, a plain line at `(x, hi)`: same styling, `silent: true`
   with tooltip hidden, matching the old upper half's chrome.

Nothing else changes: `legend.push(s.name)` stays, the emitter stays, the
document stays. The library owns meaning and this is realization, so the
purist ruling is untouched.

## Verification

1. Generate a document (LIB checkout beside this repo):
   `..\aggregate_REFACTOR\.venv\Scripts\python.exe` running
   `build_chart_doc(Bounds(build(BasicBook), 25500, a=31000), 'envelope',
   n_resamples=10)` through `canonical_dict` to JSON. BasicBook is the
   program in LIB `hacks/distortions.ipynb`: 250 claims, 27500 premium as
   GWP, 1000 xs 0, sev lognorm 100 cv 1.5, poisson.
2. From `web/`, import `chartdocToEcharts` in Node, run it on the JSON, and
   assert no series carries `stack` and that the three Envelope series per
   panel are the polygon and the two edges at the document's `y` and `y2`
   values.
3. Visual check against the reference figure: band contains every resampled
   curve, lower edge hugs just above the diagonal, upper edge is concave and
   reaches 1 near s = 0.8, and the second panel shows the same band under
   the five calibrated distortions plus Avg extreme. Check the reflect
   toggle still draws the band (the dual envelope), and that zooming keeps
   the fill glued to the edges.

## Housekeeping

Version bump, `CHANGELOG.md` section (this file is the long form), one line
commit `[aNN] ...`, move this plan to `dev/done/`, tick the `dev/TODO.md`
entry. House rules apply, the no dash rule included.

## Execution notes, a99

Executed as written. Three divergences and one addition, all small.

1. **The fill goes last in the series array, not first.** Order in the array
   is free because the layering is set by `z` (fill 1, edges 2), and two
   things in the assembler read position rather than z: `series[0].markLine`
   places the panel's marks, and `legendItems` takes its swatch from the first
   series matching the name. Both want a line series. The envelope document
   carries no marks today, so this is defensive rather than a fix.
2. **The fill's `data` is the ring's first vertex, not a bare `0`.** A custom
   series contributes its data to the axis extent like any other. The
   envelope's axes carry an explicit window off `suggested_range`, so `0`
   would have been harmless here, but the branch is generic and a band on an
   undeclared axis would have had a spurious origin pulled into its extent. A
   vertex the edges already carry costs nothing. `renderItem` never reads it;
   it is there because a series with no data is not rendered at all.
3. **The rings are built as a list, not as one polygon.** A null on either
   edge closes the current ring and opens the next, so a gapped band draws as
   several closed regions. The envelope has no gaps, so this drew as one ring
   of 1028 vertices over the document's 514 points.
4. **Added `checkBands` to `dev/scripts/smoke-charts.mjs`**, run per document
   alongside the other checks. It asserts three series per `y2` series, no
   `stack`, the two edges carrying the document's own `y` and `y2`, and a ring
   that runs lower out and upper back, with `apiRef.coord` standing in as the
   identity so the geometry is checkable without a canvas. Confirmed it bites:
   suppressing the fill fails the run rather than passing quietly, which is
   what the old realization did for thirty six versions.

Verification, all three steps done. The document was generated as specified
and the diagnosis confirmed numerically: the document places `x = 0.544921875`
at index 280, exactly half the 1.0898 the old stack produced. The adapter run
gives no series carrying a `stack`, three Envelope series on each of the two
panels, and edges equal to the document's `y` and `y2` to the last bit. The
option was then rendered offline to SVG through the full ECharts build: two
band polygons, one per panel, each 1028 vertices, spanning the panel's whole
width and the unit square's whole height, filled `rgb(13,110,253)` at 0.18.
Rasterized and set beside `bd.plot_envelope(10)`, the two agree: the band
contains every resampled curve and every calibrated distortion, the lower edge
sits just above the diagonal, the upper edge is concave and reaches 1 near
`s = 0.8`. The reflected reading draws the dual band, mirrored about the
center to the pixel. `uv run pytest` 242 passed, `npm test` 71 passed,
`node dev/scripts/smoke-charts.mjs` all clear.
