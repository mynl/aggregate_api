# Plan [Chart-2D-Punchups]: the optional readings, per panel and honestly windowed

Written 2026-08-21 against `web\src\charts\chartdoc-to-echarts.js` at api
`1.0.0a117` and `aggregate` `1.0.0a308`. Six items from the author's review of
the 2-D control strip: the log split, where the buttons live, what `full range`
is allowed to touch, and a return-period axis that draws its own ticks wrong.
Three parts are LIB and are stated here so the pair reads as one change; the
LIB half wants its own copy under that repo's `dev\`, the `plan-chart-reflect`
arrangement rather than a symlink. That copy is
`aggregate_REFACTOR\dev\plan-2d-punchup-requirements.md`, written
2026-08-21 and stating L1 to L3 as requirements against the library rather
than restating the app work around them.

**Status 2026-08-21: EXECUTED, both halves.** The LIB half landed at
`aggregate` `1.0.0a314` (all of L1 and L2, and L3, which this plan records
below as open and the author ruled in during that review); its own execution
log and seven divergences are in
`aggregate_REFACTOR\dev\done\plan-2d-punchup-requirements.md`. The app half,
A1 to A6, landed at api `1.0.0a121`; its execution log and five divergences
are at the foot of this file. Decisions 8 and 9 record the author's rulings on
L1's window and on L2's unlimited case; decisions 10 and 11, added on
execution, record the two the completed LIB half then forced. A1 and A2 carry
two corrections found by replaying the plan against the code it edits, each
noted where it lands. The order of work was as stated: LIB first and in full,
then the app.

## Context

`readings(doc)` (`:292`) offers six switches, `log`, `full range`, `reflect`,
`return period`, `invert` and `reference lines`, under the surfacing rule
signed off in `dev\done\plan-plot-ir-api.md` section 6: a control appears if
**any** axis declares it and acts on **every** axis that declares it, so one
button, never one per panel. That rule is what is being reopened. Three of the
six also have defects that survive it, found by replaying
`dev\fixtures\charts.json` through the real adapter rather than by reading it.

**The evidence, from that replay.** Printing the realized `xAxis` and `yAxis`
options for every fixture document under each view:

| view | what the adapter emits |
|---|---|
| `agg` plain | density `Loss [0, 15000]`, `mass [0, 0.00015]`; lee `p [0, 1]`, `Loss [0, 15000]` |
| `agg` full range | lee x, `Non-exceeding probability`, **`min=0 max=1.5 interval=0.5`** |
| `agg` return period | lee x, `Return period`, **`min=undefined max=undefined`**, labels `1.0, 1k, 1M, 1B, 1000B, 100000000000B` |
| `agg` return period, inverted | the same axis, the same absence of a window, now on y |

The author saw the third row as "odd y axis ticks (1, 10B, 100000000000B)",
which is the fourth row on a heavier book.

**A probability axis drawn to 1.5.** `axisWindow` (`:233`) falls back to the
drawn data's own extent for any axis declaring no `full_range`. The severity
quantile curve's last cumulated probability is `1.000000000000002`, floating
point rather than a reading, and `niceWindow` rounds that outward to 1.5. So
`full range` labels a probability axis past the certain event. The author's
ruling on that is one line: no probabilities materially past 1.

**A return-period axis with no window at all.** Four steps, all in `xyPanel`
(`:788` to `:810`), each of which alone would be enough:

1. `releaseX = view.fullRange || xScale === 'log'`. The `return_period` axis is
   log by declaration, so the release is unconditionally on.
2. `axisWindow` with the release on finds no `full_range` and returns
   `extentOf(allX)`, the divergent data extent, instead of the declared
   `suggested_range` of `(1, 1e9)`. On `agg X 100 claims 10000 xs 0 sev lognorm
   100 cv 2 poisson` the quantile curve reaches `T = 3.3e12`.
3. That came back truthy, so the `MAX_RETURN_PERIOD` clamp on the next line,
   gated on `xPeriod && !declaredX`, never fires. It is dead code today.
4. `xOnly = xPeriod ? null : xWindow` then discards the window outright, and
   `yWindow = yPeriod ? null : ...` does the same on the other orientation.

ECharts is then asked to auto-fit a log axis over twelve decades and picks a
ten-decade tick interval. `compactPeriod` (`:696`) stops its suffix ladder at
`B`, so `1e12` prints `1000B` and `1e20` prints `100000000000B`.

**The same two lines carry a second defect.** The comment above `yWindow`
(`:800` to `:806`) says the **companion** axis follows the data under a
return-period reading, because the deep tail the reading exists to show sits
far outside the window computed for the probability reading. The code keys on
the axis' **own** period instead. So today the period axis loses its window and
the loss axis keeps its crop, which is the pair of behaviors exactly swapped.
The author had already noticed the cropped tail independently.

**One log button cannot separate the loss axis from the ordinate.** It does
already reach both panels, so "apply to both charts" is not the complaint. What
it cannot do is draw a log ordinate over a linear loss axis, which is the
reading wanted most often, and the shared `outcome` axis means a naive split by
screen position would draw the loss axis on log in one panel and linear in the
other.

## Decisions taken (author, 2026-08-21)

1. **The controls go per panel**, one group per panel with the existing rule
   separator, the left group aligned over the left panel and the right group
   over the right. Conditional on the strip not becoming cluttered, which the
   count below answers. This reverses `plan-plot-ir-api.md` section 6's "one
   log y button, not one per panel" and restores
   `dev\done\plan-exhibit-punchups-3.md`'s "left group | both (ref lines) |
   right group", which the a62 chart-IR rewrite collapsed. It also properly
   fixes the punch item "log y on rh plot triggers reshape/draw of left plot;
   left plot should not move/change" (`dev\api-punchlist.md:238`), which
   section 6 resolved by answering it differently rather than by fixing it.
2. **`log` becomes `log x` and `log y`**, per panel, resolved by screen
   position after the invert exchange. Per-panel groups dissolve the shared
   `outcome` axis problem entirely: each panel answers for itself, so there is
   no longer a question of whether a button means a screen position or an axis
   identity.
3. **Return periods are floats**, not integers. `compactPeriod`'s `1.0` is
   correct and the cosmetic item raised against it is withdrawn.
4. **The companion axis swap is real.** Fix it as the comment describes.
5. **`return_period` defaulting to log is ugly.** Remove the log default. LIB.
6. **No probability axis materially past 1.**
7. **`reins`' `sev_density` must offer linear and log.** A bug, not a design
   choice. LIB.
8. **The return-period ladder ends at 1-in-10,000, and `full range` opens it
   to the whole declared extent.** The axis follows the button: without it,
   1 to 10,000; with it, everything. Neither window is asked to do the
   other's job, which is what makes the axis ordinary. L1.
9. **The unlimited program suggests its own full extent.** Where
   `_claim_window` declines, the `claim` axis suggests the extent it would
   otherwise only declare, which is what lets `full_range` be published at
   all. L2.

10. **The log release acts on a density ordinate and on nothing else.** L3
    landing gave the `mass` axis a `full_range`, which put punchlist item 7
    ("when we go to log, get rid of any capping") into direct conflict with
    decision 8: a rule that releases any declared extent under `log` would
    have opened the return-period ladder to 1e9 on `log x` alone and left
    `full range` with nothing to do, and a rule that releases none of them
    would have put the severity spike's head back behind `full range`, which
    is not what item 7 asks for. The split is by what the axis **is**: a
    density's suggested top is the tallest thing worth seeing in the *linear*
    reading, a statement about a picture, and log is exactly the reading that
    changes what is worth seeing; every other axis' suggestion is a reading of
    the quantity and survives the change of scale. Keyed on `unit ===
    'density'`, which is derivable from the document and travels with the axis
    through `invert`, unlike a screen position. A3.
11. **A panel offers on every axis that can reach a position**, not only on
    the one occupying it now, extending A4's invertibility argument to the
    other two substitutions. Without it the P&L's Lee panel offers no log at
    all, because its outcome axis is signed and its `p` is single scaled,
    while the axis `return period` puts there declares both readings as of
    a314 and defaults to linear: a reading that works today under the single
    document-wide button would have been lost to the split. A4.

Ruled during the LIB half's review on 2026-08-21 and no longer open: **the
mass axis declares its own full extent** (L3, below), which landed at a314.

## Clutter, counted

One group per panel, offering only what that panel's own axes declare, across
every document in `dev\fixtures\charts.json`:

| document | left group | right group | total | today |
|---|---|---|---|---|
| `agg` | log x, log y, full range, reference lines | log x, log y, full range, reflect, return period, invert | 10 | 7 |
| `sev` | log x, log y, full range | log x, log y, full range, reflect, return period, invert | 9 | 7 |
| `port` | log x, log y, full range, reference lines | log x, log y, full range | 7 | 5 |
| `pnl` | log y, full range, reference lines | log x, log y, full range, reflect, return period, invert, reference lines | 10 | 7 |
| `reins` | full range | log x, log y, full range, reflect, return period, invert | 7, 9 after L2 | 6 |
| `distortion`, `envelope` | reflect | (one panel) | 1 | 1 |

**Verified on execution** by the per-panel readings line
`dev\scripts\smoke-charts.mjs` now prints, against the re-captured fixtures.
Every row holds bar `pnl`, which reads 10 rather than the 7 drafted here, for
two reasons found only by running it. Its Lee panel gains `log x` and `log y`
from decision 11, since `survival` and `return_period` both declare the log
reading. And it carries **two** marks, one per panel, so `reference lines` is
offered on both groups where this table assumed the density panel alone. The
worst case is therefore 10 in two labeled halves on two documents rather than
one, which is the number the author's condition was tested against and is
unchanged. The other documents the table does not name: `port`'s standalone
`kappa` 3, `reins`' `kappa` 3, `bvagg` 1 plus the realization pair.

"Today" counts the current strip with the log split applied to it. The worst
case is ten buttons in two labeled halves against seven in one undifferentiated
centered row, and ten reads as less cluttered because each half of four to six
visibly belongs to the panel above it, which the current strip cannot say at
all. `pnl`'s left group has no `log x` because its outcome axis is signed and
declares `scales=('linear',)`, which is the IR suppressing a dishonest offer at
the only place that can know. That is also the whole of the author's "ideally
we won't offer log on a negative axis": nothing is owed app side, and a
negativity test added here would start hiding honest offers, `reins`' `annual`
axis among them, whose window low of `-282` is emitter padding on a
non-negative quantity.

## The work, six app parts

### A1. The return-period axis keeps its window

`web\src\charts\chartdoc-to-echarts.js`, `xyPanel` (`:788` to `:810`).

Three edits, and the first two are deletions:

- `xOnly` and the `yPeriod` branch of `yWindow` stop discarding the period
  axis' window. See A2, which rewrites the same two lines.
- The release rule becomes **a reading the reader chose**, not the scale the
  axis happens to be drawn on. It travels in A3's two-field shape rather
  than as one boolean, which is the **first correction**: an earlier draft
  wrote `releaseX = view.fullRange || chosen(...)` and passed that single
  boolean on, re-collapsing here exactly what A3 splits apart. The two
  questions stay separate or A3 buys nothing.

  ```js
  const chosen = (axis, log) => log && (axis.scales || []).length > 1;
  const releaseX = { full: view.fullRange, uncapped: chosen(xAxis, view.logX) };
  const releaseY = { full: view.fullRange, uncapped: chosen(yAxis, view.logY) };
  ```

  An axis whose only honest reading is log never asked for room, and
  `return_period` today and `sev_density` until L2 are exactly those axes. This
  stays correct after L1 and L2, when no axis is log only any more: the rule is
  then simply "log means room, when log is what you pressed".
- The `MAX_RETURN_PERIOD` clamp becomes live rather than dead, and applies to
  whichever axis carries the period:

  ```js
  const capPeriod = (w, period) => (period && w
      ? [w[0], Math.min(w[1], MAX_RETURN_PERIOD)] : w);
  ```

  It is a backstop for a document that declares nothing, not the mechanism. The
  mechanism is the declared window, which is L1's job. Keep the constant and
  its note at `:66` pointing at `_chartdoc.MAX_RETURN_PERIOD`.

Once L1 lands, the axis draws in the ladder window it declares, `full range`
opens it to the deep tail, and `log x` or `log y` makes that tail readable.
Three ordinary readings of an ordinary axis, no special case surviving anywhere
except the backstop.

### A2. The companion axis follows the data, the period axis keeps its window

The same two lines, with the conditions unswapped. The rule the comment states
and the code contradicts: **the axis carrying the period keeps its declared
window; the axis across from it follows the drawn data.**

```js
const declaredX = axisWindow(xAxis, releaseX, allX);
const declaredY = axisWindow(yAxis, releaseY, allY);
let xWindow = capPeriod(declaredX || extentOf(allX) || [0, 1], xPeriod);
let yWindow = xPeriod ? null
    : capPeriod(declaredY || (yPeriod ? extentOf(allY) : null), yPeriod);
let xOnly = yPeriod ? null : xWindow;
```

Read it as: `xPeriod` set means x is the period axis, so **y** is the companion
and follows the data; `yPeriod` set means the mirror. The `atomsInView` call
below keeps taking `xWindow`, which is why `xWindow` and `xOnly` stay two
names.

`capPeriod` reaching **both** windows is the **second correction**. A1 says
the clamp applies to whichever axis carries the period, and an earlier draft
then applied it to `xWindow` alone, which fixes the third row of the evidence
table and leaves the fourth, the same axis under `invert`, still auto-fitting
on any document that declares no window. The `yPeriod ? extentOf(allY) :
null` fallback is the other half of that symmetry: a companion y axis stays
`null` and lets echarts fit it, exactly as today, while a period y axis is
never left without a window for the backstop to clamp. Latent rather than
live once L1 lands, since `return_period` then declares a window on both
emitters, and that is the point: the backstop exists for the document that
declares nothing.

Keep the two comments at `:797` and `:800`, corrected to say which axis each
governs. Their reasoning is right and only their subject was wrong: a
reflection is a bijection of `[0, 1]` onto itself and needs no cap, and a
period reading re-slices the panel so its companion cannot keep a crop computed
for the probability reading.

### A3. `full range` means the declared extents, and nothing else

`axisWindow` (`:233`) loses the data-extent fallback from the `full` path, and
the one parameter splits into the two questions it has been answering at once:

```js
function axisWindow(axis, { full, uncapped }, drawn = null) {
    if (full && Array.isArray(axis.full_range)) return axis.full_range;
    if (uncapped && !Array.isArray(axis.full_range)) {
        const seen = drawn ? extentOf(drawn) : null;
        if (seen) return seen;
    }
    return Array.isArray(axis.suggested_range) ? axis.suggested_range : null;
}
```

`full` is the button and honors what the document declares. `uncapped` is the
log rule and acts on a density ordinate alone, which is decision 10 and is the
**third correction**, forced by L3 landing. An earlier draft wrote the guard as
`uncapped && !Array.isArray(axis.full_range)`, on the assumption that LIB
declares `full_range` on currency axes only. That was true when this plan was
written and a314 made it false: `mass` declares one on `agg`, `pnl`, `discrete`
and `reins`, and `return_period` on all five. Under that guard `log y` on the
density panel would have returned the crop, which is a regression against a120's
shipped behavior on exactly the case `uncapped` exists for.

`dev\api-punchlist.md` item 7 is the author's "when we go to log, get rid of any
capping", whose case is the `agg` ordinate stopping at the aggregate peak
(`_emit_aggregate.ordinate_top`) and cutting the head off a severity block
standing higher: measured at 49 times the suggested top on the `agg` fixture and
79 times on the author's own program. Under a split log button that block is now
read by pressing `log y` on the left panel alone, which is the reading it
wanted, and the declared extent is preferred over the drawn one where the
document gives one so `agg` and `port` reach the same number by two routes.

What still needs the drawn-extent fallback, since `port`'s ordinate declines to
declare its extent (L3 landed in `outcome_doc`, which serves `agg`, `pnl`,
`discrete` and `reins`, and the portfolio emitter is a separate one): `port`'s
`mass`, cropped 3.75 times on the fixture, and `sev`'s `pdf` and `reins`'
`sev_density`, which declare no window at all.

Author ruling 6 no longer falls out for free and is instead delivered by the
`full` branch alone: an axis with no `full_range` has nothing for the button to
open, so `full range` acts on the axes that declare an extent, which since a314
is the loss axis **and** the ordinate over it. Opening both is what L3 is for.
It is invert-safe for the same reason it is position-safe: `panelAxes` (`:723`)
exchanges the axes before any window is computed, so the button follows the loss
axis onto y and back, and the `unit` test travels with the axis for the same
reason.

The probability axis then keeps `[0, 1]` under `full range`, and
`1.000000000000002` never reaches `niceWindow`.

### A4. `log x` and `log y`, resolved per panel

Nothing about `axisScale` (`:206`) changes. Its two call sites take separate
flags, and because `panelAxes` has already exchanged the axes, the flags follow
the screen through an invert with no further work:

```js
const xScale = axisScale(xAxis, view.logX);
const yScale = axisScale(yAxis, view.logY);
```

`heatmapPanel` (`:1200`) and the surface path (`:2095`) take `view.logY`. The
z axis is the height in relief and the ramp of the same quantity flat, and a
density ordinate is a y axis on the panel next door, so one flag rather than a
third button.

`readings(doc)` becomes per panel. It keeps returning `kinds` at the document
level and moves the six switches into a per-panel record:

```js
const scaled = (a) => Boolean(a) && (a.scales || []).length > 1;

export function readings(doc) {
    const axes = index(doc.axes);
    const marked = new Set((doc.marks || []).map((m) => m.panel_id));
    return {
        panels: (doc.panels || []).map((p) => {
            // An invertible panel can put either of its axes in either
            // position, so both positions are offered on what either axis
            // declares. Offering on the current orientation alone would make
            // a button appear and disappear under `invert`, which is worse
            // than one button that waits.
            const x = [axes[p.x_axis], p.invertible && axes[p.y_axis]];
            const y = [axes[p.y_axis], p.invertible && axes[p.x_axis]];
            const paired = (attr) => [p.x_axis, p.y_axis].some(
                (id) => (doc.axes || []).some((a) => a[attr] === id));
            return {
                id: p.id,
                logX: x.some(scaled),
                logY: y.some(scaled),
                fullRange: [...x, ...y].some(
                    (a) => a && Array.isArray(a.full_range)),
                reflect: paired('complement_of'),
                returnPeriod: paired('reciprocal_of'),
                invert: Boolean(p.invertible),
                marks: marked.has(p.id),
            };
        }),
        kinds: /* unchanged, the document-level union */,
    };
}
```

The surface capability line at `:307`, a panel declared `surface` also being
readable flat, stays where it is and keeps its comment.

**The blast radius stays small because the resolution moves up one level, not
down.** `chartdocToEcharts` (`:1380`) resolves the panel's view before
dispatching, and `xyPanel`, `panelAxes`, `heatmapPanel` and the surface path
keep taking one flat view object with `logX`, `logY`, `fullRange`, `reflect`,
`returnPeriod`, `invert` and `refLines`. Only its provenance changes. The pure
path's own defaults at `:1384` become `PANEL_DEFAULTS`, exported so `mount.js`
and the smoke test read one list.

### A5. One group per panel in the strip

`web\src\charts\mount.js`.

**State.** `VIEW_DEFAULTS` (`:61`) keeps `kind`, the ten surface keys and
`windows` at the top level, where they are genuinely document-wide, and the six
readings move under a `panels` map keyed by the document's panel id:

```js
const PANEL_DEFAULTS = {
    logX: false, logY: false, fullRange: false,
    reflect: false, returnPeriod: false, invert: false, refLines: true,
};
const panelView = (id) => ({ ...PANEL_DEFAULTS, ...(view.panels[id] || {}) });
```

Keying on the panel id is what keeps the strip sticky, and it is a real gain
over the flat set rather than a cost. `density`, `lee`, `kappa`, `occurrence`,
`aggregate`, `square` and `cloud` are stable names carrying one meaning across
every document that uses them, so choosing `log y` on a density panel carries
from an `agg` to a `port` to a P&L, which the flat set could not distinguish
from choosing it on a Lee panel.

**No `VIEW_KEY` bump.** `dev\done\plan-chart-reflect.md` records the test: a
key is bumped when a stored value would now mean something **wrong**, as `v3`'s
flat `window` did. Here the stored blob spreads over the new defaults (`:116`),
the six old flat keys become inert, `panels` takes `{}` and every panel takes
`PANEL_DEFAULTS`. Nothing means anything wrong, and `kind`, the surface
preferences, the cut position and the per-chart `windows` all survive, which a
bump would silently discard. `migrateChartView` (`request-params.js:113`)
strips the six dead keys on the next write, beside the `window` strip already
there.

**Layout.** `renderControls` (`:488`) loops panels rather than looping
`CONTROLS` once, emitting one `.exhibit-group` per panel in document order,
each holding that panel's offered buttons in the canonical order `log x, log y,
full range, reflect, return period, invert, reference lines`. The CSS is almost
all there: `.exhibit-group` and its `border-left` separator at `site.css:1105`
already carry the comment "One group per panel, with a rule between adjacent
groups so a button reads as belonging to the panel below it", left over from
the arrangement being restored, and `.exhibit-group-label` at `:1111` is unused
and ready.

What is new is the halving. Each group takes `flex: 1 1 0` and centers its
buttons in its share, so group 0 sits over the left panel and group 1 over the
right. Exact alignment to the ECharts grid columns is not attempted: the strip
is a DOM row above a single canvas holding both grids, so no control can sit
physically under its panel, and equal shares is the honest approximation.
`.exhibit-controls-center` and its comment at `:1099` come out, that comment
being the record of the ruling now reversed.

**The narrow layout.** `panelLayout` stacks panels one per row below
`WIDE_PX = 720` (`chartdoc-to-echarts.js:111`), and the strip sits above the
chart, so left and right stop corresponding to anything. `renderControls`
already has the host width in hand for the height reserve, so it mirrors
`perRow` the same way: below the breakpoint the groups stack one per row, each
taking `.exhibit-group-label` with its panel title. **Styling call for the
author:** whether those labels appear in the wide layout too. Panel titles are
long ("Probability mass function"), so the plan assumes labels only when
stacked, and turning them on everywhere is one condition.

**`reference lines` becomes per panel** and loses its middle-group place. Marks
already carry `panel_id` and `xyPanel` already filters on it (`:1020`), so the
button belongs to the panel whose marks it suppresses. On `agg` and `port` that
is the density group alone, which is why the restored arrangement is two groups
rather than the older three.

### A6. Fixtures, smoke and tests

- Re-capture `dev\fixtures\charts.json` after the LIB parts land, since L1 and
  L2 move three axis declarations and every chart ETag with them.
- `dev\scripts\smoke-charts.mjs`: the `offered.log` block (`:144` to `:165`)
  splits in two and both move inside a per-panel loop, as does `fullRange`. Add
  the assertion the current test cannot make, which is the one that would have
  caught this: **no realized axis may be drawn on log with an undefined
  minimum.** The existing check at `:100` tests `Number.isFinite(ax.min) &&
  ax.min <= 0` and passes cleanly today precisely because the min is
  `undefined`.
- Add a check that a `return_period` axis is never realized above
  `MAX_RETURN_PERIOD` under any view.
- `web\test\reading-map.test.js` is untouched: the coordinate maps do not
  change, only the windows drawn around them.

## The LIB half, three parts

### L1. `return_period` stops defaulting to log, and declares its full extent

`src\aggregate\charts\_emit_aggregate.py:138` and
`src\aggregate\charts\_emit_reins.py:156`, the same axis in two emitters:

```python
ChartAxis(id='return_period', label='Return period',
          unit='return_period', scales=('linear', 'log'),
          reciprocal_of='p',
          suggested_range=(1.0, 10000.0),
          full_range=(1.0, float(round(1.0 / SURVIVAL_FLOOR)))),
```

Dropping `scale='log'` alone is not enough and is actively worse: the declared
window is `(1, 1e9)`, and nine decades read linearly is a curve pinned to the
left edge. The window has to come down with the default, and the deep tail has
to stay reachable, which is what `full_range` is for. That is the whole of why
this is a LIB change rather than an app one: the app cannot invent either
number.

**`suggested_range=(1.0, 10000.0)`, ruled by the author 2026-08-21.** The
instruction was that the axis follow the button: press `full range` and it
shows the full range, leave it alone and it shows 1 to 10,000. So the two
readings are the two declared windows and neither compromises for the other,
which is what a ladder ending at 1-in-250 would have been doing. 1-in-10,000
clears the 1-in-100 and 1-in-200 anchors ruled on elsewhere by two decades,
and the float dust past `SURVIVAL_FLOOR` is one press away rather than
permanently on screen.

What it buys, and it is the reason A1 ends up with no special case at all: the
return-period axis becomes an ordinary axis. It draws in its ladder, `full
range` opens it to `1e9`, `log x` or `log y` makes the opened tail readable,
and `MAX_RETURN_PERIOD` retires to a backstop for documents that declare
nothing.

### L2. The `reins` occurrence panel gets two honest axes

`src\aggregate\charts\_emit_reins.py:136` and `:143`.

- **`sev_density` gains linear.** `scale='log'` stays as the default reading,
  `scales=('linear', 'log')` joins it. The comment at `:140` argues "a layered
  severity is a spike and a tail, and the linear reading of it is a spike and
  nothing else, so there is no second reading to offer". The author's ruling is
  that this is a bug: the linear reading is a reading, the reader can see it is
  a spike, and declaring one scale removes the control rather than the
  temptation. Rewrite the comment to say log is the default because the linear
  reading is usually a spike.
- **`claim` gains log and an unconditional full extent.**
  `scales=('linear', 'log')`, and `full_range` computed from `(min(0.0,
  float(x[0])), float(x[-1]))` whether or not `_claim_window` returned a
  window. This half is `dev\api-punchlist.md` item 12, raised and now
  answered: on an **unlimited** program `_claim_window` returns `None`,
  `full_range` is written `None if claim is None`, and the panel loses `full
  range` too, though the full extent is knowable either way.

  The `ChartAxis.__post_init__` guard is that `full_range` requires
  `suggested_range`, so the unlimited case needs a suggested window as well.
  **Ruled by the author 2026-08-21: it suggests the extent.**

  ```python
  extent = (min(0.0, float(x[0])), float(x[-1]))
  ChartAxis(id='claim', label='Loss per claim', unit='currency',
            scales=('linear', 'log'),
            suggested_range=claim or extent,
            full_range=extent),
  ```

  A limited program is untouched: `claim` is a window, so the suggestion is
  the computed one exactly as today. An unlimited one draws its whole extent
  by default and `full range` on it becomes a button that changes nothing,
  which is the honest reading rather than a defect. There is no crop to undo,
  and a control present and idle says that more clearly than a control that
  is missing.

Together these turn the occurrence group from one button into three, which is
the row in the clutter table reading "7, 9 after L2".

### L3. Does the mass axis declare its full extent? (open)

`_emit_aggregate.outcome_doc` (`:121`) declines `full_range` on the ordinate:
"(0, the peak) already IS the whole extent, and a zoom-out button on it would
do nothing." True of the aggregate alone, and false once the severity companion
overtops it, which is exactly what `ordinate_top` and `COMPANION_HEADROOM`
exist to handle. So the emitter already computes the honest extent,
`max(peak, sev_peak)`, and then declines to publish it.

Declaring `full_range=(0.0, float(max(peak, sev_peak)))` would let A3 delete
the `uncapped` fallback entirely and make `full range` mean one thing on every
axis. Not required for anything above, and the plan does not assume it: A3
keeps the fallback either way, since punchlist item 7's log rule needs it for
any document that still declines.

**Ruled in and landed at a314**, read off the drawn series inside `outcome_doc`
rather than written at the declaration site, so the suggestion and the extent
cannot drift apart. It did not let A3 delete the fallback, and for the reason
this section anticipated: `outcome_doc` serves `agg`, `pnl`, `discrete` and
`reins`, and the **portfolio** emitter is a separate one that still declines.
`port`'s density ordinate is cropped 3.75 times on the fixture with no extent
published, so the fallback stays load bearing and A3 was right not to assume.

Left open for LIB and not blocking anything: the portfolio emitter making the
same declaration, which would retire the fallback for good. Recorded in
`dev\TODO.md` under the asks raised with `aggregate` rather than raised as a
round note, since it changes no contract and costs one line.

## Order of work and cadence

LIB first and in full, then the app, the standing rule for a paired change and
doubly so here: A1 is written to be correct before and after L1, but its
verification cannot distinguish "the window is honored" from "the window was
never wrong" until L1 has moved it.

App side the parts are ordered by dependency, not by size. A3 before A1,
because A1's release rule is written against the split `axisWindow` signature.
A1 and A2 rewrite the same two lines and land together. A4 before A5, because
the strip cannot offer per-panel buttons until `readings` computes per-panel
offers. A6 last, since the fixtures move under L1 and L2.

One version bump, one `CHANGELOG.md` section under `[Chart-2D-Punchups]`, one
commit with a one line subject, this plan moved to `dev\done\`, the matching
`dev\TODO.md` entry ticked. `uv sync --extra dev` with the server stopped
before anything is believed, or `/v1/meta` and the About panel report a stale
`aggregate` and the moved axes never arrive.

## Verification

1. `uv sync --extra dev`, then `uv run pytest`. No Python changes are expected
   app side; this proves the sync.
2. Re-capture `dev\fixtures\charts.json`, then
   `node dev\scripts\smoke-charts.mjs` clean, with the new log-min assertion in
   place. Confirm the per-fixture readings line now prints per panel, and that
   `reins`' occurrence panel gains `log x` and `log y`.
3. `node --test web\test\reading-map.test.js` and
   `web\test\request-params.test.js`, the latter for the migration strip.
4. **Replay the four rows of the evidence table above** and confirm each has
   moved: the Lee probability axis stays `[0, 1]` under `full range`; the
   return-period axis carries `min=1` and a finite max under every combination
   of `log x`, `log y`, `full range` and `invert`; no label leaves the `k`,
   `M`, `B` ladder.
5. **Browser pass**, an `agg` and a `port` at both sides of `WIDE_PX`:
   - the strip shows two groups with a rule between them, the left over the
     left panel, and pressing a button in one group leaves the other panel
     completely still. That is the a-generation punch item finally fixed rather
     than answered;
   - `log y` on the density panel alone gives a log ordinate over a linear loss
     axis, with the severity block's head intact;
   - `full range` on the density panel opens the loss axis, and the Lee panel's
     loss axis does not move until its own `full range` is pressed;
   - `return period` draws the ladder to 1-in-10,000, `full range` on that panel
     opens it to 1-in-1e9, and `log x` makes the opened tail readable. Under
     `invert` all three follow onto y;
   - the loss axis under `return period` now reaches the deep tail rather than
     keeping its probability-reading crop. This is A2, and it is the one item
     visible only in the picture;
   - narrow the window under 720px: the groups stack one per row, each labeled
     with its panel title, in the same order the panels stack.
6. **Watch the sticky state across charts.** Set `log y` on an `agg`, build a
   `port`, and the density group should come back pressed while the kappa group
   does not. Then reload and confirm the surface preferences, the cut mode and
   the per-chart `windows` all survived, which is the claim made for not
   bumping `VIEW_KEY`.

## Execution log, 2026-08-21, api `1.0.0a121`

Executed in one bump against `aggregate 1.0.0a314`, as the cadence section
specifies, after a review that confirmed the LIB half complete. All of A1 to
A6. Five divergences, recorded here at the moment each was made; the first two
are author rulings taken during that review and are written up as decisions 10
and 11 above.

**Divergence 1: the log release is keyed on the axis unit.** A3 as drafted
guarded the `uncapped` branch with `!Array.isArray(axis.full_range)`, which was
correct against the declarations of the day and wrong the moment L3 landed. The
author ruled the role split on 2026-08-21 and `unit === 'density'` is what makes
it derivable from the document rather than a rule stated in the app: it is
exactly `mass`, `pdf`, `sev_density` and `z` across the whole fixture set, it is
the set of axes whose suggestion is a peak rather than a reading, and a unit
travels with its axis when `panelAxes` exchanges the two, which a screen
position does not. Decision 10.

**Divergence 2: offers count the paired axes.** A4 as drafted read a panel's
offers off its declared pair plus, where invertible, the partner. That loses the
P&L's log reading entirely once L1 makes `return_period` choosable, and it is a
reading a120 has: `pnl`'s `mass` axis makes the single document-wide `log`
button true, and it reaches the return-period axis. `positionAxes` therefore
walks the `complement_of` and `reciprocal_of` partners as well, on the argument
A4 already makes for invertibility. Decision 11. It costs `pnl` two buttons and
the clutter table's worst case is unchanged at 10.

**Divergence 3: the smoke test's log assertion is "some offered reading", not
"the plain one".** The first form failed seven documents that draw correctly,
because `log x` on a Lee panel is nothing until `reflect` or `return period` has
put a two-scale axis on x. Asserting the plain reading would have demanded the
strip hide a button until another button was pressed, which is the appearing and
disappearing control the per-panel design exists to avoid. The test now composes
the log flag with every reading the panel offers and requires one of them to
land a log axis in that position.

**Divergence 4: the new axis assertion is scoped to the return period, not to
every log axis.** A6 drafts it as "no realized axis may be drawn on log with an
undefined minimum". That fails three documents that are drawing correctly: a
companion axis under a period reading is handed to echarts to fit on purpose,
which is A2, and `sev_density` and `pdf` declare no window at all and have
always auto-fitted. The assertion that would actually have caught the defect is
narrower and is what landed: the `Return period` axis always carries a finite
window, and never one above `MAX_RETURN_PERIOD`. The old check passed cleanly on
the bug because the min was `undefined` rather than zero, so the defect was an
absent bound rather than a bad one.

**Divergence 5: `migrateChartView` runs on the current key too.** A5 says the
migration "strips the six dead keys on the next write, beside the `window` strip
already there", but that function was only ever run on the superseded v3 entry,
which is read once and dropped. The six readings go dead inside `v4`, which is
still current, so a browser would have carried them forever. It now runs on both
paths and the function is documented as stripping what nothing reads rather than
as a v3 migration. This does not disturb the no-bump argument: the keys are
inert either way, and inert is not wrong.

### Verification, as run

1. `uv sync --extra dev` with no server running, `aggregate` a311 to a314.
   `uv run pytest`: 352 pass, 6 fail, all in `tests/test_objects.py` and all
   frame or chart-document assertions against a moving library. Same six as
   before this work, which touched no Python.
2. `dev\fixtures\charts.json` re-captured, `node dev\scripts\smoke-charts.mjs`
   **all clear** with the new assertions in place. The readings line prints per
   panel and the clutter table above is read straight off it. `reins`'
   occurrence panel gains `log x` and `log y`, as L2 intended.
3. All nine files under `web\test` pass. `reading-map.test.js` was untouched, as
   predicted: the coordinate maps did not change, only the windows drawn around
   them. `request-params.test.js` gained a case for the six dead keys and had
   its v3 case restated, since the readings no longer carry over by name.
4. **The evidence table replayed, all four rows moved.** The Lee probability
   axis holds `[0, 1]` under `full range`. The return-period axis carries
   `[0, 10000]` plain, `[0, 1e9]` under `full range`, `[1, 10000]` on log and
   `[1, 1e9]` on both, and the same four under `invert` with the window on y.
   No label leaves the `k`, `M`, `B` ladder. The loss axis under `return period`
   is released to follow the data, which is A2. Pressing anything on the Lee
   panel leaves both density axes character for character unchanged, which is
   the a-generation punch item fixed rather than answered. `log y` on the
   density panel alone draws `[1e-15, 0.01]` on log against a suggested top of
   `1.5e-4`, so the severity block's head is intact, which is punchlist item 7.
5. `npm run build` clean, 928 modules.
6. Browser pass: **not run**, and it is what is owed on this change. Items 5 and
   6 of the verification section above are the list, and the two that no
   offline check can stand in for are the group alignment over the panels at
   both sides of `WIDE_PX`, and the sticky state carrying a density panel's
   `log y` from an `agg` to a `port` while the kappa group stays unpressed.

### Left behind, deliberately

**The companion axis auto-fits over data the ladder no longer shows.** A2 gives
the companion no window so echarts fits it, which was right when the period axis
showed everything and is looser now that L1 ends the ladder at 1-in-10,000: the
visible part of the curve fills 41% to 100% of the axis across the fixtures and
47% on the author's own program. The fix is to take the companion's extent over
the points whose period coordinate is inside the period window, about three
lines. Raised in review on 2026-08-21 and not ruled on, so it is recorded rather
than built; `dev\TODO.md` carries it.

**A linear return-period axis is labeled from zero.** `niceWindow` rounds the
declared `(1, 10000)` outward to a tick interval and floors the low end at 0, so
the first tick reads `1-in-0`. Harmless and new, since the axis was
unconditionally log before a314 and the question could not arise. Not fixed
here: clamping `niceWindow` to a declared minimum would act on every axis in
every document, which is a wider change than this plan is scoped for.
