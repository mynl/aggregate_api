# Graph interaction notes

Working notes from the a30 engine comparison, 2026-07-30. **Nothing here is
implemented.** Picking this up becomes a `dev/plan-*.md` when we do; it is item
(b) at the top of `dev/TODO.md`.

## The a30 verdict

The author flipped `draw | echarts plotly` on `agg` and `port` and found "not
massive differences between the two".

That settles the question a30 existed to ask. Two independent libraries handed
identical decisions (`twoPanelData`) drew about the same picture, so the library
was not what was holding the exhibits back. It also means every item below is
**configuration, not an engine choice**, and the ECharts path is the one to
configure since it is already the default and already themed off
`/v1/meta/style`.

**Settled since, by the author: consolidate on ECharts.** This note originally
argued for keeping Plotly until the punch list was done, on the grounds that a
second renderer is a useful control when judging whether a change is an
improvement. The author's call is to drop it, and the argument for that is
better: a30 already answered the only question Plotly existed to ask, so the
535 kB lazy chunk and the second code path are now cost with no question behind
them. Keep the `twoPanelData` split, which is what made the comparison possible
and is good structure regardless.

## What the author liked, unprompted

Worth recording so it does not get changed by accident.

- Drag left and right to pan.
- Select by legend.
- Scroll to zoom, in itself.

## Punch list

Items 1 to 4 are open. **Item 5 landed in a37**, along with three things that
were not on this list and only showed up once someone looked at a rendered chart:
`full x` widening one panel of two, the return period capped at 1e5, and
densities drawing as pyramids because ECharts culls sub-pixel segments without
advancing its pen. See `dev/done/plan-a37-quick-hits.md`.

### 1. Zoom rescales the y axis and that is disorienting

`dataZoom.filterMode`. Currently `'filter'`, which drops out-of-window points
from the extent calculation so y refits what is visible. That is deliberate:
without it, zooming into a tail leaves a flat line pinned near zero because the y
range still spans the mode.

| value | effect |
|---|---|
| `'filter'` | out-of-window points removed, other axes refit. Current. |
| `'weakFilter'` | drops only points with every dimension outside |
| `'empty'` | out-of-window becomes NaN, other axes still refit |
| `'none'` | window changes, y axis never moves |

`'none'` is the one-word fix and it costs the tail.

**Try first, before changing the mode**: `animationDurationUpdate: 0`. Much of
the disorientation is probably the tween rather than the rescale, since ECharts
animates the axis change and the curve appears to breathe while scrolling.
Snapping it makes the same rescale read as a step. Log y helps too, because whole
decades stay put as landmarks.

### 2. Double-click to reset the zoom

Not built in. `chart.getZr().on('dblclick', ...)` catches it anywhere on the
canvas including blank areas (plain `chart.on('dblclick')` only fires on graphic
elements), then `chart.dispatchAction({type: 'dataZoom', start: 0, end: 100})`.

`toolbox.feature.dataZoom` and `toolbox.feature.restore` ship buttons that do
this, but they add a corner cluster, which works against how hard a26 to a29
worked to keep the chrome down. Prefer the gesture.

### 3. The odd tick on the left scale

If it is the stray one at the very top or bottom: `axisLabel.showMaxLabel: false`
and `showMinLabel: false` drop exactly the end labels and leave the ticks.

If it is thinning generally: `splitNumber` (how many), `minInterval` /
`maxInterval` (bounds on the step), `axisLabel.interval` (which get text),
`axisTick.interval` (which get a mark). `hideOverlap` is already on for the x
labels. On the log axis, `minorTick` / `minorSplitLine` are available and
currently off.

Confirm which reading was meant before doing anything.

### 4. The uPlot readout: values in a static legend, not a floating tooltip

The best idea on the list. Two routes.

**Cheap**: `tooltip.position` accepts a function, so pin the tooltip to a fixed
corner of the panel instead of following the cursor, plus
`alwaysShowContent: true`. Keeps all the existing formatting.

**Right**: `chart.on('updateAxisPointer', ...)`, whose event carries `axesInfo`
with the axis value under the cursor. Look up each series and write into our own
DOM, so the legend strip becomes the readout in normal page text, styled like the
rest of the page. Also fixes a real problem the floating box has at the tail,
where it covers the region being inspected. The legend strip is already there and
mostly empty.

Prefer the second.

### 5. Horizontal readout: read a y, get the x

**Done in a37.** The reasoning below held; the mechanism needed one correction,
recorded here because the wrong version looks right and costs an afternoon.

`axisPointer.axis: 'y'` is indeed the lever, but it is **not** settable per axis
and the obvious per-axis knob is a decoy. `axisPointer.triggerTooltip` exists,
reads exactly like the switch for this, and is inert under
`axisPointer.type: 'cross'`: ECharts supplies the flag from the tooltip pass, so
the axis's own value is never consulted (`modelHelper.js`,
`saveTooltipAxisInfo`, the `if (triggerTooltip == null)` guard). What makes the
two panels differ is that **each grid is its own coordinate system** and ECharts
reads `tooltip` off the coordinate system's model before the global one, so the
declaration goes on the grid: `grid[1].tooltip.axisPointer.axis = 'y'`. Snapping
then comes for free, because a base axis carrying `triggerTooltip` has `snap`
forced on even though it is a value axis.

**This differs per panel and that is not an inconsistency.**

The mechanism: `tooltip.trigger: 'axis'` with `axisPointer.axis: 'y'` tracks the
y axis and snaps to data by y, so you hover a probability and read off the loss.
`axisPointer.snap: true` locks to real grid points.

- **Survival panel**: correct and genuinely useful. S is monotone decreasing in
  loss, so "at S = 0.005, what loss?" has exactly one answer, and that answer is
  the VaR. It is the quantile function, which is the number being looked for.
- **Density panel**: ill-posed. The density rises and falls, so a horizontal line
  crosses the curve twice and there is no single corresponding x. No option
  configures that away. The honest treatment there is what
  `axisPointer: {type: 'cross'}` already gives: both crosshairs with the cursor
  value on each axis, read as a cursor position rather than a lookup.

## Fonts, placement, and the absence of TeX

The concepts map onto matplotlib closely. `textStyle` at the top level is the
rcParams-ish cascade (fontFamily, fontSize, fontWeight, color, lineHeight), with
every component overriding it (`title.textStyle`, `legend.textStyle`,
`xAxis.nameTextStyle`, `axisLabel`). Placement is `left/right/top/bottom` in px or
percent, so px-first where matplotlib is fraction-first. `grid.left/top/width/
height` is `subplots_adjust`. `echarts.registerTheme` is the style sheet
analogue, which `theme.js` already uses off `/v1/meta/style`.

No TeX. Three partial routes:

1. Rich text (`rich: {}` plus `{styleName|text}`) gives per-fragment size, color
   and vertical offset. Fakes sub and superscripts passably, nothing more.
2. A rich style can carry an image, so a pre-rendered TeX SVG can be dropped into
   a label when one formula matters enough.
3. **The real route**: panel titles do not have to be ECharts `title` components.
   They are text above a canvas and we own that DOM, so rendering them as HTML
   with KaTeX gives actual math. Applies to axis names too, at the cost of
   positioning them ourselves.

### The math decision is one decision, for charts and tables both

Route 3 needs KaTeX or MathJax in the shell, and so does the other half of the
page: the table walker emits `\(...\)` for page MathJax unless a `katex` object
is passed to `renderTable`, and the SPA loads neither. Nothing sends a `$...$`
cell today, so nothing is broken; the moment anything does, both halves want the
same answer. Load one library once in the shell, or keep both plain. Do not
decide it twice.
