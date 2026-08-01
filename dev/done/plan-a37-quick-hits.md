# a37: six quick hits on the Overview, the tables, and the keys

*Landed. The author's list of 2026-08-01, the first one written after actually
looking at the exhibits rather than at the code.*

Six items, one version bump, one commit. Item (d) was asked for as discussion, so
it is written up here and no code went with it. Nothing on the backend changed
except one keyword forced by the dependency, below.

---

## (a) The two-panel exhibit

### a1. Read a y on the tail panel, get the loss

`S(x)` is monotone decreasing in loss and the return period monotone increasing,
so "at S = 0.005, what loss?" has exactly one answer, that answer is the VaR, and
it is the number the reader came for. The same gesture on a density is ill posed,
because a horizontal line crosses it twice, so that panel keeps loss. This is
item 5 of `dev/graphs.md`, and the reasoning there held.

**The obvious knob does not work.** `axisPointer.triggerTooltip` per axis reads
like the switch for this and is inert: under `axisPointer.type: 'cross'` ECharts
passes the flag in explicitly from the tooltip pass, so the axis's own value is
never consulted (`modelHelper.js`, `saveTooltipAxisInfo`, the
`if (triggerTooltip == null)` guard).

What does work is that **each grid is its own coordinate system** and ECharts
reads `tooltip` off the coordinate system's model before the global one. So the
declaration goes on the grid:

```js
grid: grids.map((g, i) => ({
    ...g, tooltip: { axisPointer: { axis: PANEL_READ_AXIS[i] } },
}))    // ['x', 'y']
```

Snapping comes for free: a base axis with `triggerTooltip` gets `snap` forced on
even though it is a value axis, so the pointer lands on grid points instead of
sliding between them and reporting a loss the book does not contain. The tooltip
needed no change at all, because its head was already `loss ${fmt(value[0])}`.

### a2. Why the tail panel misbehaved under `full x`

`densityWindow()` returned `null` for "auto fit" whenever `full x` was pressed or
there was no usable cdf, and both x axes then fell back to `dataMin` / `dataMax`.

The two panels do not hold the same data. `rightPairs()` emits a whole `null`
entry rather than `[x, null]` wherever the tail probability leaves the plotted
range, and ECharts drops null entries from an axis extent, so the tail panel's
`dataMax` was the last loss carrying a survival while the density panel's was the
end of the grid. The panels stopped sharing an axis at exactly the moment the
reader pressed the button that says show me the whole thing.

`densityWindow()` now always returns an explicit `[lo, hi]`, with `full x` and
the no-cdf case returning the grid ends. Both axes carry the same numbers by
construction rather than by both happening to fit the same data. The 2% padding
is applied in both modes, so pressing the button widens the window without also
changing how the curve is inset in it.

### a3. `full x` moved to the middle group

One line in `CONTROL_GROUPS`. It steers both panels, so it belongs over neither.

### a4. The tail runs to 1-in-1 billion

`T_MAX` 1e5 to 1e9, the author's choice from three options. `LOG_FLOOR` is
unchanged and still keeps `1 - cumsum` dust off the axis. Two label formatters
could not carry the range (`1000000k` on the axis, `1-in-3184000000` in the
tooltip), so `compactPeriod` steps k, M and B on the decade ticks a log axis
produces. `returnPeriod` stays exact and keeps its one job, naming the capital
anchors.

The smoke test now prints each book's tail floor. `agg`, `port` and `pnl` reach
1e-9 where they used to stop at 1e-5; `sev` lands at 1e-6 and the dice at 1e-3,
both limited by their own data rather than by the cap.

## (b) Vertical space around tables

The defect was not the tightness, it was that the two renderers did not share it:
`.gt-host` carried a margin and `.grid-host` carried none, so flipping Static to
Interactive reflowed everything below the table. One rule now covers both hosts,
and the added air is spent above, on `.exhibit-title`, so a caption stays tucked
under the table it belongs to instead of floating midway to the next one.

## (c) Keys

Plain up and down are ordinary cursor movement again. They used to walk history
at the buffer edges, and on a one line program, which is most of them, *every*
press is at an edge, so pressing up to move the caret silently threw the program
away.

- **Ctrl-↑/↓**: history. Consumed, so the cursor does not move; the buffer is
  replaced wholesale and where the caret was in the old program says nothing
  about the new one.
- **Ctrl-Shift-↑/↓**: step the example library. Loads and stops there,
  deliberately: walking 186 recipes at one build each is not a thing to do by
  accident.

All of it documented now, in the feedback line and the Help panel. The example
nav was an undisclosed Alt- binding, which is a working feature nobody can find.

## (d) A stack of built programs: discussion, no code

Three pieces already exist and none of them talk to each other: `history.js` (the
last 20 successful programs, text, localStorage), the `exampleRing`, and server
side an LRU object cache plus `GET /v1/session/models.agg`, which already knows
the session's built programs. So this is mostly a naming and a UI question.

**Text or objects.** A text slot holds a decl: push, pop and roll are trivial, it
survives a reload for free, and nothing can go stale because a program is its own
truth. Restoring costs a build, though the LRU makes a repeat of the same
`(decl, log2, bs)` close to instant. An object slot holds
`{decl, id, kind, name, mean, log2, bs}`: restoring is a tab reload with no build
at all, and a slot can show what it is rather than a line of code. It costs an
eviction path, which is why the decl stays in the slot either way. Objects is the
better answer and the fallback makes it safe.

**The axis nobody said out loud: what is it for.** Two wants hide behind the one
word. *Getting back to something* is what history already does, and a stack does
it with explicit control: real, small, either option serves. *Comparing two
books* is the one worth building, and a stack is not its shape. The two-panel
exhibit already draws N series against a shared legend, which is exactly how a
portfolio's units are drawn, so overlaying two or three held objects is mostly
plumbing that exists. Slots, named and pinned, beat a LIFO stack the moment you
want to see two at once rather than one after another.

**Push on build, or push on purpose.** The RPN metaphor pushes every result,
which makes the stack a synonym for history and fills it with experiments nobody
meant to keep. Explicit push makes a slot mean "something I decided to keep",
which is what makes it worth naming.

**Recommendation.** Object slots, explicit push, four of them, a small strip under
the button row showing kind and name. `history.js` stays untouched underneath as
the implicit record. If comparison turns out to be the real want, the same four
slots become the overlay set and nothing is redesigned.

**Open, for the author**: navigation or comparison. It changes the verb set.

## (e) The density steps: not a limitation, and not the setting

`step: 'middle'` is applied correctly, by `turnPointsIntoStep`
(`echarts/lib/chart/line/LineView.js`), and computes exactly matplotlib's
`drawstyle='steps-mid'`.

The damage is one layer down, in `drawSegment` (`.../line/poly.js`):

```js
var dx = x - prevX, dy = y - prevY;
if (dx * dx + dy * dy < 0.5) { idx += dir; continue; }   // ignore tiny segment
```

`prevX` and `prevY` are assigned at the **bottom** of the loop body, which that
`continue` skips, so the culling accumulates: a point is emitted only once it is
more than ~0.7 px from the last point actually emitted. At 2\*\*16 grid points
across a ~400 px panel a bucket is about 0.006 px wide, so every horizontal move
the step inserted is culled, the risers lose the base points that made them
vertical, and what survives is joined by a plain `lineTo`. A point mass draws as
a rise and a fall over a couple of pixels: a little pyramid, where the whole
point of steps is a Haar function.

**`sampling: 'minmax'`** (ECharts 5.5, present in the installed 5.6.0) reduces to
the smallest and largest value per device pixel column before the path is built.
The pair is at most one frame apart in x and as far apart in y as the data goes,
so the riser is drawn, and the peak is preserved rather than averaged away, which
is what matters when the peaks are atoms. It runs *after* the dataZoom filter, so
zooming in drops the visible count and the full grid comes back.

**It is not safe on every series**, and `gapFree` is the guard.
`minmaxDownSample` seeds each frame's min and max from the frame's first point,
and every comparison against NaN is false, so a frame opening on a gap keeps that
gap as both and discards the rest of itself. Trailing gaps are harmless, since a
frame wholly inside one should draw as a gap anyway; an interior gap would
silently delete a frame's worth of real curve. The linear density has no gaps, a
survival's are the trailing block past the log floor, and the log density of a
discrete book is gaps all the way through, which is the one case the sampler is
switched off for.

This also closes "watch the full-resolution render cost": a portfolio no longer
hands ECharts six polylines of 65,536 points.

## (f) Heroes out of the top

The cards are gone, with `mountHeroes`, `upgradeThumb`, `gradientFor`, the
`.hero-*` rules and `api.heroSparklines`. In their place is a two line lede,
whose copy is a **placeholder for the author to replace**.

`loadHeroes` stays, per the author's call: it still fetches
`/v1/examples/heroes`, still picks at random, but picks one and builds it, so the
page lands populated on a different book each visit. Its retry and its `[aLL]`
console reporting are unchanged, so the open "hero gallery empty on a first page
load" note keeps its diagnostic. The sparkline route stays on the server, because
resurfacing the gallery inside the Examples dropdown will want it.

---

## One thing that was not in the plan

The test suite was **already red** on `main`. The co-developed `greater-tables`
checkout has moved from 1.9.0 to 6.0.0a4 and renamed `TableSpec.formats` to
`formatters`, which 13 tests hit through `tables.py`. Following the rename is one
keyword and it is what a37 does; the rest of that move is its own piece of work
and is recorded in `dev/TODO.md`. Both GT harnesses (`check-frames.py`,
`check-adapter.py`) run clean against 6.0.0a4 afterwards.

## Verification

- `uv run pytest`: 115 pass. `ruff check src dev/scripts tests`: clean but for
  the pre-existing `tests/test_cors.py` F401.
- `node dev/scripts/smoke-exhibits.mjs`: clean, with three new invariants. The
  two x axes carry identical explicit min and max, checked under `full x` as well
  as cropped, which is the a2 bug and the one that was silent. Each grid declares
  which axis it is read off. Every series with no interior gap carries the
  sampler.
- `dev/scripts/check-frames.py` and `check-adapter.py`: both clean against the
  moved dependency.
- `npm run build`: clean, 914 modules, main bundle 106.99 to 105.99 kB.

**Not provable offline**, and left for the author in the browser: that the y
lookup reads the way it should and snaps rather than slides; that `full x` moves
both panels together; whether the far decades out to 1-in-1B read as shape or as
noise; the density on a discrete book with `log y` both ways; that nothing moves
below a table when the Static / Interactive switch is flipped; and the landing
page with its lede.
