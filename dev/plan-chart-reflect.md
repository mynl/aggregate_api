# Plan [Chart-Reflected-Reading]: the app half, a sixth reading and its button

Status: **not started.** Written 2026-08-13 against LIB
`dev\plan-chart-reflect.md` (drafted the same day, targeting `1.0.0a267`, not
yet executed). The two documents are a **paired plan**, each repo owning its
half, the `plan-chart-ir` with `plan-plot-ir-api` arrangement rather than the
one canonical copy and a symlink. Work here starts after the LIB bump lands
and this repo syncs.

## Context

The chart IR offers five renderer switches: `log`, `full_range`,
`return_period`, `invert`, `kind`. LIB is adding a sixth, `reflect`, the map
`v` to `1 - v` on any axis that declares it. On a Lee panel it turns the
non-exceeding probability into the exceeding probability, so the drawn curve
becomes the survival function, which is the reading an actuary reaches for and
the one a log axis exists for. On the unit square of a distortion or an
envelope it reflects both axes and gives the dual.

The declaration is a paired axis: a new `ChartAxis.complement_of` pointer,
mirroring `reciprocal_of` in every respect. An undrawn axis sits in `doc.axes`
carrying its own label, its own `scales` and its own window, and its presence
is the offer. Six documents gain one: `agg`, `pnl`, `severity`, `reins`
(a `survival` axis paired to `p`), `distortion` and `envelope` (an
`s_complement` and a `g_complement`). `port` gains nothing, having no
probability axis.

Nothing changes on the wire. `reflect` is a renderer switch, so the chart
route, `_chart_options`, the `(oid, name, window, detail, encoding)` cache key
and the ETag at `routes\objects.py:2177-2304` are all untouched, and toggling
it re-realizes the document already in hand rather than refetching. This is an
app-side change to one adapter and one control strip.

The author's use for it: the right-hand panel of the two-panel Overview Plot,
read as `(x, 1 - F(x))`, which is `reflect` composed with `invert`.

## Decisions taken (author, 2026-08-13)

1. **The button says `reflect`.** It matches the library switch name, one
   canonical name per concept, and it stays honest on the unit square where
   the result is the dual rather than a survival function. The actuarial
   reading goes in the tooltip.
2. **It sits before `return period`**, so the strip reads
   `log | full range | reflect | return period | invert | reference lines`.
   LIB's plan calls this the canonical control order and asks that both repos
   state it. The two probability readings sit together and `reflect` precedes
   the reading that composes on top of it. Cost, accepted: three existing
   buttons shift right by one.

## The one thing to settle upstream first

**LIB ruling 4 applies the flip twice.** Reflecting the coordinate and
exchanging `complement` with `reciprocal` are two spellings of one operation,
not two operations that compose:

```
complement(v) = 1 / (1 - v)      reciprocal(v) = 1 / v
complement(1 - v) = 1 / v        = reciprocal(v)
reciprocal(1 - v) = 1 / (1 - v)  = complement(v)
```

Do both, as ruling 4 says to, and they cancel exactly: `reflect` becomes a
no-op whenever `return period` is on, on every document, which is why the
ruling's own payoff for `pnl` reads as unreachable. Do exactly one and the
reading is the one the author is after.

**The intent (author, 2026-08-13): reflect chooses which end of the curve the
return period magnifies.** A log return-period axis opens out whichever end of
the probability axis sends `T` to infinity. `T = 1 / (1 - p)` diverges as `p`
approaches 1, so it stretches the right end of the curve; `T = 1 / p` diverges
as `p` approaches 0 and stretches the left. Reflect swaps which end that is,
and that is the whole reason to ask for both readings at once.

| document | map | return period alone | with reflect |
|---|---|---|---|
| `agg`, a loss | complement | `1 / (1 - p)`, the right end opened out | `1 / p`, the left end |
| `pnl`, a payoff | reciprocal | `1 / p`, the shortfall | `1 / (1 - p)`, the upside |

The `pnl` row is exactly the picture ruling 4 says it wants, "the upside
tail's return period, unreachable any other way", and it is unreachable only
under the double flip.

**So: keep the document's map name and apply it to the reflected coordinate.**
One flip, no `REFLECTED_RETURN_PERIOD_MAP` table needed at all, and it falls
out of the composed map A2 already builds.

**What this costs upstream.** LIB phase 5 lists two composition cases and one
of them has to go. "Reflect plus return period on a `complement` document is
identical to return period alone" *is* the double flip, and it cannot hold
alongside the `reciprocal` case in the next bullet, which does hold and which
matches the intent above. Strike the first and assert the table instead.
LIB phase 1's `REFLECTED_RETURN_PERIOD_MAP` constant is then not needed.

**Raise this with LIB before either half is executed.** The two renderers are
kept in step by hand, so the app cannot pick its own composition. This plan
implements the table above, isolated in one pure function, so following a
different LIB ruling is a one line change and one test edit.

## Two considered divergences from LIB's sketch of this half

**No `VIEW_KEY` bump.** LIB's sketch says move `v4` to `v5`. It is not needed
and it is harmful. The stored view is loaded as
`{ ...VIEW_DEFAULTS, ...JSON.parse(held) }` (`mount.js:112-114`), so a key
absent from a stored blob already takes its default, which is exactly the
forward compatibility a new reading needs. The comment at `mount.js:51-58`
records what a bump is *for*: v2 to v3 and v3 to v4 both happened because a
stored key would now mean something **wrong**, the v3 case being a `window`
request parameter that every 2-D chart then sent. `reflect: false` means
nothing wrong to anybody. Bumping would silently discard every reader's sticky
`log`, `invert`, `reference lines`, cut mode and surface preferences to add a
key that defaults correctly on its own. Keep `v4`.

**The map name is not the return-period flag.** LIB's sketch has the renderer
carry a composed callable, which is right, but in this codebase `xMap`/`yMap`
are doing double duty: they are the map *and* the "a return-period reading is
live" flag, at `chartdoc-to-echarts.js:788`, `:792` and `:793`. Splitting them
is the whole of the risk in this change, and it is what part A2 does.

## The work, five parts

### A1. The probe and the adapter's own default

`web\src\charts\chartdoc-to-echarts.js`:

- `readings(doc)` (`:321-337`) gains
  `reflect: axes.some((a) => a.complement_of)`, placed beside `returnPeriod`
  and taking its comment: a paired axis is named by no panel, so the pairing
  is read off the axis rather than off what is drawn. Update the `Returns`
  block at `:296-302`, which lists the keys.
- The adapter's view defaults (`:1310-1311`) gain `reflect: false`, or the
  pure path reads `undefined` on every call that does not come through
  `mount.js`.

The probe is false for `port`, for every surface and for every heatmap, so the
3-D path publishes `readings` at `:2303` with no button appearing. No gating
needed there.

### A2. `panelAxes`, the composed map, and the flag split

This is the heart. `pairedReading` (`:258-261`) takes the pointer field,
mirroring LIB's `_paired_reading`:

```js
function pairedReading(doc, axisId, attr = 'reciprocal_of') {
    return (doc.axes || []).find((a) => a[attr] === axisId) || null;
}
```

A new pure leaf, `web\src\charts\reading-map.js`, holds the coordinate story
and nothing else. `returnPeriods` (`:180-186`) moves into it unchanged and is
imported back:

```js
export function readingMap(reflected, period) {
    if (!reflected && period == null) return null;
    return (values) => {
        const v = reflected
            ? values.map((u) => (u == null ? null : 1 - u)) : values;
        return period == null ? v : returnPeriods(v, period);
    };
}
```

`panelAxes` (`:726-744`) applies reflection first, then the return period,
then the exchange, and returns the flag alongside the map:

```js
    let xReflected = false, yReflected = false;
    let xPeriod = null, yPeriod = null;
    if (view.reflect) {
        const cx = pairedReading(doc, panel.x_axis, 'complement_of');
        if (cx) { xAxis = cx; xReflected = true; }
        const cy = pairedReading(doc, panel.y_axis, 'complement_of');
        if (cy) { yAxis = cy; yReflected = true; }
    }
    if (view.returnPeriod) {
        // The document's own map, applied to whatever coordinate is being
        // read. No flipped-map table: reflecting the coordinate *is* the
        // flip, and doing both would cancel. Applied to the reflected value
        // it opens out the other end of the curve, which is the point.
        const how = (doc.meta || {}).return_period_map || 'reciprocal';
        const px = pairedReading(doc, panel.x_axis);
        if (px) { xAxis = px; xPeriod = how; }
        const py = pairedReading(doc, panel.y_axis);
        if (py) { yAxis = py; yPeriod = how; }
    }
    let xMap = readingMap(xReflected, xPeriod);
    let yMap = readingMap(yReflected, yPeriod);
    const inverted = Boolean(view.invert) && Boolean(panel.invertible);
    if (inverted) {
        [xAxis, yAxis] = [yAxis, xAxis];
        [xMap, yMap] = [yMap, xMap];
        [xPeriod, yPeriod] = [yPeriod, xPeriod];   // the flag rides too
    }
    return { xAxis, yAxis, xMap, yMap, xPeriod, yPeriod, inverted };
```

Both pairings are looked up against `panel.x_axis`, the document's own axis
id, because `complement_of` and `reciprocal_of` both point at the drawn axis.
When both readings are on, the axis *shown* is the return-period one, whose
label is right either way.

Consumers, all mechanical:

- `xyPanel:756` destructures the two new fields.
- `:759` `const map = (values, how) => (how ? how(values) : values);`
- `:767-769` unchanged, still un-swapping with `inverted ? yMap : xMap`.
- `:949-953`, the marks, call `[at] = how([at])` instead of
  `returnPeriods([at], how)`.

### A3. The two behaviors that must stay keyed on the return period

Both currently gate on bare `xMap`/`yMap` truthiness, and both are wrong for a
reflection. The edit is one word each, `xMap` to `xPeriod`:

- **The `MAX_RETURN_PERIOD` cap** (`:788`). It exists because the quantile
  function saturates and `T` diverges. A reflected probability axis is bounded
  in `[0, 1]` and needs no cap.
- **The companion window release** (`:792-793`). It exists because a
  return-period reading re-slices the panel into the deep tail, so the
  companion axis follows the data instead. Reflection is a bijection of
  `[0, 1]` onto itself and the reflected axis carries its own window from the
  emitter, which is the whole payoff of declaring it as a paired axis. Nulling
  it here would throw away the axis min and max, the `full_range` clamp, the
  nice interval, `zoomExtent` and `option.lossWindow`.

Both sites need a comment saying they are keyed on the period and not on "a
map is present", because the next person to touch this will reach for `xMap`.

### A4. The button

`web\src\charts\mount.js`:

- `VIEW_DEFAULTS` (`:60-93`) gains `reflect: false`, with the one line gloss
  the other readings carry: the complement of every probability axis that
  declares the reading.
- `CONTROLS` (`:145-184`) gains an entry **between `fullRange` and
  `returnPeriod`**, per decision 2, `key: 'reflect'`, `label: 'reflect'`, no
  `offer` (the probe key and the view key agree, so only `refLines` needs that
  indirection). Title: read a probability axis as its complement, `1 - v`; a
  distribution function reflected is the survival function.
- Restate the canonical order in the preamble comment at `:138-144`, which
  currently says each family is appended within its group as it arrives.
  Inserting mid-strip is a deliberate exception and should say so.

Nothing else. The button gets its pressed state, its persistence and its
redraw from `renderControls` (`:486-497`) exactly like the other five, and the
strip's CSS is class generic. No edit to `index.html`, `main.js`,
`request-params.js` or `site.css`: `chartParamsFor` is a whitelist of one key
so `reflect` can never reach a URL, and `migrateChartView` only ever runs
against a stored v3, which cannot contain it.

### A5. Tests

**A node unit test**, `web\test\reading-map.test.js`, over the new leaf. This
is why the leaf exists: `chartdoc-to-echarts.js` imports `theme.js` and so
`echarts`, which needs the global stubs the smoke script installs, and the
`request-params.js` precedent from a92 is exactly this move, extract the
decision so it can be tested. Cases: reflection maps `1 - v` and preserves
nulls; a period alone matches both existing maps; reflect plus period on a
`complement` document reads `1 / p`, the left end, where the period alone
reads `1 / (1 - p)`; reflect plus period on a `reciprocal` document reads
`1 / (1 - p)`, the upside, where the period alone reads `1 / p`. Then the
guard that would have caught ruling 4 on paper: **on neither document do the
two readings agree**, since a composition that cancels is exactly the bug.

**A smoke block**, `dev\scripts\smoke-charts.mjs`, in `checkReadings`
(`:139-208`), mirroring the `returnPeriod` block at `:179-190`: gate on
`offered.reflect`, `checkDrawable`, assert an axis took a new name against
`base`, and assert at least one series' `data` moved. Plus the assertion the
others do not have, which is the regression guard for A3:

> the reflected panel's axis still declares a `min` and a `max`, where the
> return-period reading drops them.

Note `checkLabels` (`:109-137`) requires every axis name reaching the option to
be a string present in the document. The reflected axis is a real `ChartAxis`
in `doc.axes` carrying its own label, so it passes the same way the
`return_period` axis does today. If it ever fails, the document is at fault,
not the adapter.

## What needs no change, and why

- **`labelFormatter` (`:692-701`), `readValue` (`:1478-1484`),
  `axisOption` (`:629-669`), `zoomExtent`, `option.lossWindow`.** All read the
  axis object and its `unit`. A reflected axis keeps `unit: 'probability'`, so
  it inherits the probability formatter and the exponential readout, and its
  window is clamped and made nice like any other.
- **The log reading.** `readings.log` is gated on drawn axes, and the paired
  axis is drawn by no panel, so the offer does not move. It does not need to:
  every affected document already offers `log` from its density panel, and
  `axisScale` reads the *substituted* axis, so a `survival` axis declaring
  `scales=('linear', 'log')` goes log correctly the moment reflect is on. The
  log window comes right for free: `xyPanel:783` releases the window whenever
  an axis goes log, and `axisOption:643-647` snaps it to whole decades, which
  is the same answer `survival_window()` computes.
- **The step ladder.** `drawingFor` (`:474-480`) keys on `unit`, which does
  not change, and ECharts' `step` is defined on the order of the points given,
  not on the axis direction. Reflection maps values and leaves array order
  alone, so the corner mirrors with the curve and a right-continuous step
  becomes left-continuous for free. This is LIB's phase 2 argument and it
  holds identically here. It looks like a bug until worked out, so it wants a
  comment.
- **`heatmapPanel` and `surfaceOption`.** Neither calls `panelAxes`, neither
  has a probability axis, neither can carry a paired reading.
- **The marks.** After `plan-no-reference-lines` no shipped mark sits on a
  probability axis, so nothing reflects in practice. The code is still made
  right, and the `rightmost` label side rule at `:965-968` is left alone: a
  decreasing map reverses which mark is outermost, which is correct behavior
  and moot at one mark per panel.

## Upstream notes for LIB, not blocking

- **Ruling 4, above.** The blocking one, and the reason to read this before
  LIB executes.
- **`survival_window()` is dead code that this makes live.**
  `charts\_two_panel.py:137` is exported, documented and called by nothing. It
  returns `(decade under the deepest survival drawn, 1.0)` and its docstring
  argues exactly why a fixed window "wastes the panel" on a log axis. LIB's
  plan gives the new axis `suggested_range=(0.0, 1.0)`. The app does not need
  more, since it releases a log window to the data extent and snaps to
  decades, but the matplotlib renderer may, and the helper is sitting there.
- **`_emit_portfolio.py:206`** sets `meta['return_period_map'] = 'complement'`
  on a document with no probability axis, so it pairs with nothing and does
  nothing. LIB's plan already notes it; recording it here so it is not lost.

## Order of work and cadence

LIB first, in full, then the API. One version bump here, one `CHANGELOG.md`
section under `[Chart-Reflected-Reading]`, one commit with a one line subject,
this plan moved to `dev\done\`, the `dev\TODO.md` entry ticked.

Before anything is believed, `uv sync --extra dev` with the server stopped, or
`/v1/meta` and the About panel report a stale `aggregate` and the new field
never arrives. The six documents gain an axis, so their hashes move and every
chart ETag invalidates once, which is correct and harmless.

## Verification

1. `uv sync --extra dev`, then `uv run pytest`. No Python changes are
   expected; this is proving the sync, not the feature.
2. `node --test web/test/reading-map.test.js`, the composition and the flip.
3. Re-capture `dev\fixtures\charts.json`
   (`uv run python dev\scripts\capture_fixtures.py`), then
   `node dev\scripts\smoke-charts.mjs` clean, with `reflect` appearing in the
   per-fixture readings line for the six documents that declare it and absent
   for `port`.
4. **Browser pass.** Build an `agg` and a `pnl`, and open a distortion:
   - Overview Plot, right-hand panel: `reflect` alone turns the quantile plot
     into its mirror; `reflect` with `invert` gives `(x, 1 - F(x))`, the
     survival function, which is the picture asked for;
   - add `log` to that and the panel should have room to the deep tail rather
     than a decade ladder inside a linear crop;
   - `reflect` with `return period` opens out the **other end** of the curve:
     on the `agg`, `return period` alone stretches the right end and adding
     `reflect` stretches the left; on the `pnl` the pair swaps the shortfall
     for the upside. If adding `reflect` changes nothing there, the double
     flip is back. This is the check that settles ruling 4 in the picture
     rather than on paper;
   - the distortion square stays square and reflects both axes, with the
     legend names stale by design (LIB ruling 3); confirm `dual=False` reads
     clean;
   - the left density panel is untouched throughout, on every one of these.
5. **Watch the sampler.** Reflected coordinates run descending in array order
   and `sampling: 'minmax'` (`:925`) reduces a gap-free path to the extremes
   of each pixel column. It should be indifferent to direction. If a reflected
   curve draws ragged where the unreflected one does not, that is the cause,
   and the fix is to reverse both coordinate arrays together and flip the
   `STEP_KEY` sense with them, not to drop the sampler.
