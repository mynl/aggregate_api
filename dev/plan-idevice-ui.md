# plan-idevice-ui: the app on an iPhone and an iPad

Status: **FINALIZED 2026-08-14**. Scope and all three review questions ruled by
the author the same day; the rulings are in section 7 and are folded into the
phases. Ready to execute.

SPA only. No api change, no LIB change, no library fork, no new dependency. Two
phases, each its own version bump, then a device round.

The author is demoing on an iPad, so the two chart items are the ones that
matter. Everything here is a fix to a defect, not a new feature.

Version numbers: `plan-pricing-form` has already claimed `1.0.0a100` and
`1.0.0a101`. Take the next two free numbers at execution rather than assuming
these are `a102` and `a103`.

---

## 1. Scope

Four items, from an investigation on 2026-08-14 of two reports from the author:
that the group tabs "float around" on an iPhone or iPad, and that on the iPad
neither the click that places the cuts on the 3-D surface nor the double click
that resets a 2-D chart does anything.

| Item | Phase | Fixes |
|---|---|---|
| The group and leaf strips reflow when a tab is selected | 1 | tabs moving under a thumb |
| Double tap zooms the page | 1 | the page drifting once zoomed |
| A tap on the 3-D surface picks nothing | 2 | tap to place the cuts |
| Only a surface has a `reset`, and it does not clear the zoom | 2 | a zoomed 2-D chart with no way back |

### 1.1 Ruled out by the author, 2026-08-14

**Pinning the group strip under the header.** The investigation proposed
`position: sticky` on `.out-tabs` so the output navigation stays on screen
while a long table scrolls. The author ruled it out: it is the least important
of the four, it is the one with a real chance of needing several rounds on the
device (iOS positions a sticky element against the layout viewport rather than
the visual one, so a zoomed page makes it drift), and scrolling back up to the
strip is something the demo can work around.

Recorded here so it is not raised again as an oversight. If the strip is ever
revisited, note that it also wants the header height as a custom property,
since that height changes at the `lg` breakpoint, and that no ancestor of
`.out-tabs` may carry `overflow`.

---

## 2. The findings each fix rests on

Measured on the live site at `agg.mynl.com` on 2026-08-14, and read off the
shipped `zrender` 5.6.1 and `echarts-gl` 2.1.0 in `web/node_modules`.

### 2.1 Selecting a tab changes its width, so the strip reflows

`site.css:420` gives `.out-tabs .nav-link.active` `font-weight: 700` while the
inactive tabs inherit normal weight. Measured widths on the live strip:

| Tab | inactive | active | delta |
|---|---|---|---|
| Overview | 95.9 px | 101.4 px | 5.5 px |
| More | 70.1 px | 72.0 px | 1.9 px |

Every switch therefore moves every tab to the right of the change by up to
5.5 px. With a mouse that is nothing. With a thumb, the target just moved.

`site.css:443` and `:450` do the same on the leaf strip, 600 against 700, and
that row is `flex-wrap: wrap` (`site.css:438`). So a width change there can
rewrap the row, jump a leaf onto another line, change the row's height, and
move everything below it.

On an iPhone this compounds with `site.css:537`, which makes `.out-tabs` a
horizontal scroller under 576 px. The strip's content measures about 425 px
under the phone rules against roughly 358 px of usable width, so it overflows
by 60 to 70 px, and `scrollbar-width: none` plus the hidden webkit scrollbar
(`site.css:399`, `:401`) means nothing says so.

Note that the defect is the **width change**, not the bold. Section 3.1 fixes
it without altering the look, per the author's ruling.

### 2.2 The page has no `touch-action`, so a double tap zooms it

`index.html:5` is `width=device-width, initial-scale=1` with no
`maximum-scale`, and a sweep of the live page found **not one element** whose
computed `touch-action` is anything but `auto`. So a stray double tap zooms the
page. Once zoomed, the whole page pans under a finger and the sticky header
drifts across the content, which is the most likely reading of "floating
around" as opposed to merely "moving".

### 2.3 A tap on the 3-D surface picks nothing

The chain, each link confirmed in source:

1. `zrender/lib/core/env.js:67` sets `pointerEventsSupported` from
   `'onpointerdown' in window && (browser.edge || (browser.ie && version >= 11))`,
   so it is **false** on Safari. `HandlerProxy.js:197` therefore takes the
   touch branch and zrender listens for `touchstart`, `touchmove`, `touchend`.
2. `zrender/lib/core/event.js:52` normalizes a touch event by reading
   `changedTouches[0]` and writing `zrX` and `zrY` onto it. It does **not**
   write `offsetX` or `offsetY`, and a `TouchEvent` has no such properties.
3. `zrender/lib/Handler.js:17` sets `packet.offsetX = event.zrX`, so anything
   reading the event packet is fine. That is why orbit rotation already works
   on the iPad: `OrbitControl._mouseDownHandler` and `_mouseMoveHandler` read
   `e.offsetX` off the packet.
4. `echarts-gl/src/core/LayerGL.js:503` does `e = e.event` first, dropping from
   the packet to the raw event, then calls
   `this.pickObject(e.offsetX, e.offsetY)`, which on touch is
   `pickObject(undefined, undefined)`. Nothing is picked, so
   `_dispatchDataEvent('click', ...)` never runs, so `chart.on('click')` at
   `mount.js:1127` never fires and the cut is never placed. Lines 442, 458 and
   492 have the same defect, which is why hover and the readout on the surface
   are dead there too.

There is a second, independent limit. `HandlerProxy.js:138` synthesizes a
`click` from touch only when `touchend` lands within `TOUCH_CLICK_DELAY`, which
is 300 ms (`HandlerProxy.js:6`). A carefully aimed tap on an iPad often exceeds
that. The native click iOS sends afterwards is discarded too, because the mouse
listeners at `HandlerProxy.js:205` are guarded by `scope.touching`, which
`setTouchTimer` holds true for 700 ms after any touch (`HandlerProxy.js:44`).

Section 5 is the contingency for that second limit. Phase 2 fixes the first
one and measures before spending anything on the second.

### 2.4 A zoomed 2-D chart has no way back

`mount.js:1142` puts the reset on `zr.on('dblclick')`. On iOS the only route to
that is a native DOM `dblclick`, which lands inside the 700 ms `scope.touching`
guard on the second tap and is discarded. With `touch-action: auto` the double
tap is spent on zoom anyway.

The `reset` button is rendered only inside `if (grid && realized ===
'surface')` at `mount.js:538`, so a 2-D chart has no button. And `onReset`
(`mount.js:1223`) does not clear the held `zoom`; only the dblclick handler
does, at `mount.js:1148`. So the surface's own reset leaves a held zoom in
place, which is a bug on every device, not only on the iPad.

Meanwhile pinch zoom on a 2-D chart works fine, because the `inside` dataZoom
accepts it. So on the iPad a reader can zoom a chart into a corner and the only
recovery is to leave the leaf and come back.

---

## 3. Phase 1: the strips stop moving, and the page stops zooming

Touches `web/src/styles/site.css`, `web/index.html` and `web/src/main.js`. The
`main.js` edit is one line and writes no behavior.

### 3.1 Reserve the bold width, and change nothing about the look

**Author's ruling, 2026-08-14: the bold stays.** The selected state on both
strips keeps exactly the weight and color it has today. What goes is the
reflow, by laying every tab out at its **bold** width whether or not it is the
selected one, so selecting one changes how a tab is painted and not how wide
it is.

The recipe, which needs no JavaScript at paint time:

1. Give each tab a `data-label` carrying its own text.
   * Group strip: six static attributes in `index.html:320` to `:325`, one per
     tab, matching the visible label exactly.
   * Leaf strip: one line where the button is built, `main.js:1019` to `:1023`,
     setting `data-label` from `leaf.label`, which is already in hand there.
     `nav.js` is not touched: it owns the label, and this reads it.
2. In `site.css`, give `.out-tabs .nav-link` and `.sub-tabs .sub-link` an
   `::after` carrying `content: attr(data-label)` at `font-weight: 700`, laid
   out but not painted (`height: 0; overflow: hidden; visibility: hidden;
   pointer-events: none`). A block pseudo element with zero height contributes
   to the element's intrinsic width and to nothing else, so the box is always
   as wide as the bold label and the visible text never moves inside it.
3. Leave `font-weight: 700` on `.active` in both strips exactly as it is
   (`site.css:420` and `:450`), and leave the group tab's `margin-bottom: -2px`
   with its matching `padding-bottom` alone: those change vertical metrics only,
   and the folder tab effect is deliberate.

Two details the pseudo element must inherit and will, being a child of the
button: the leaf strip's `text-transform: uppercase` and its `letter-spacing`
(`site.css:445`, `:446`). Confirm the ghost measures uppercase, since the
`data-label` is written in mixed case.

One measured consequence to record in the CHANGELOG rather than discover later.
Reserving the bold width widens the group strip by about 5 px per tab, roughly
30 px across the six. On an iPad in portrait the strip goes from about 575 px
to about 605 px against roughly 720 px of usable width, so it still fits and
nothing changes. On an iPhone, where the strip already scrolls by 60 to 70 px,
it will scroll by 90 to 100 px instead. That is the price of the ruling and it
is the right side of the trade: a strip that scrolls a little further is a
lesser problem than a strip that moves while you aim at it.

Note also `site.css:488`, where a greyed tab takes `font-weight: 400
!important`. That is a third weight on the same strip and it is unaffected: the
ghost is always 700, so a tab that greys or ungreys does not resize either.

### 3.2 The double tap stops zooming the page

**Author's ruling, 2026-08-14: page wide, and the scoped alternative is
declined.** The author does not use double tap to zoom.

Add `touch-action: manipulation` on `body`. `touch-action` is not an inherited
property, but the effective behavior is computed up the ancestor chain, so one
declaration on `body` covers the page.

`manipulation` keeps panning and keeps **pinch zoom**, which is what preserves
the ability to magnify a dense table and is why this is not an accessibility
regression. What it removes is double tap to zoom, everywhere.

Comment it in the file's own voice, next to the two existing iOS notes at
`site.css:540` and `:768`, which already record that Safari magnifies the page
when a focused input's font is under 16 px. This is the third member of that
family and belongs with them.

### 3.3 Landing phase 1

One version bump, one commit, a `CHANGELOG.md` section carrying the reasoning
above, a `dev/TODO.md` tick. The bump is warranted: this is plan-based work
with a behavior change, not tidying.

---

## 4. Phase 2: the two chart fixes

`web/src/charts/mount.js`, plus one small new module.

### 4.1 Touch events carry a coordinate the pick can read

New module, `web/src/charts/touch.js`, exporting two things:

* `touchPoint(rect, touch)`, a pure function returning the point of a touch
  relative to an element rectangle. Pure so it is testable under `node --test`,
  which is the only kind of test this repo's web suite can run.
* `stampTouchCoordinates(host)`, which attaches one **capture phase** listener
  each for `touchstart`, `touchmove` and `touchend` on `host` and defines
  `offsetX` and `offsetY` on the event from `changedTouches[0]` and the touch
  target's own bounding rectangle. It returns an unsubscribe function, matching
  the `register(off)` convention the strip already uses.

Capture phase on `host` is what makes this work without patching anything:
zrender's listeners are on its viewport root, a descendant of `host`, so ours
runs first and the properties are already there by the time `LayerGL` reads
them. The coordinates must be relative to the **touch target**, which is the
canvas, because that is what a real mouse event's `offsetX` is relative to and
what `LayerGL.pickObject` treats as viewport coordinates.

Call it once from `echartsRenderer` (`mount.js:1362`), on `host` rather than on
the chart instance, so it survives the `dispose` and re-`init` that a switch
between the flat and relief readings performs at `mount.js:1372`.

Note in the docstring **why** this exists, per the house rule: it compensates
for `echarts-gl` reading `offsetX` off the raw event rather than off the
zrender event packet, which is a defect in that library and not in this app.
Name the file and line so the next reader can check whether a later
`echarts-gl` has fixed it and the shim can go.

Expected effect: tap to place the cuts works, and hover and the readout on the
surface come back with it, since lines 442, 458 and 492 have the same defect
and the same cure.

### 4.2 One reset, on every chart, that clears the zoom

Factor a single `resetView()` inside `draw()` and give both callers the same
one:

* clear the held `zoom` (`mount.js:770`), which today only the dblclick handler
  does at `mount.js:1148`;
* `setWalk(false)`;
* when the realization is a surface, put `SURFACE_KEYS` back to
  `VIEW_DEFAULTS` and dispose the renderer so the camera resets, which is what
  `onReset` does now at `mount.js:1223`;
* `renderTools()` then `render()`.

Then `zr.on('dblclick')` calls it, and the button calls it. That alone fixes
the surface reset leaving a held zoom behind.

Move the `reset` button out of the surface-only block at `mount.js:538` so it
is built for every chart. **Rule: reset is always the last control in the
group.** It acts on the whole drawing rather than on one reading, so it belongs
after the readings, after the surface controls and after the realization
control. On a surface that moves it from its current position mid group, ahead
of the mesh cluster, to the end; say so in the CHANGELOG so the author is not
surprised by a button that moved.

**Author's ruling, 2026-08-14: `reset` is unconditional.** The question raised
was whether a chart with no other controls should grow a one-button strip. The
author's reading is that every plot has some controls already, and a check of
`readings` (`chartdoc-to-echarts.js:292`) mostly bears that out while showing
the edge the ruling settles: `kinds` is returned empty unless a panel offers
more than one realization (`:325`), so a document declaring one realization, no
multi-scale axis, no `full_range`, no complement or reciprocal pairing, no
invertible panel and no marks would today render no strip at all.

Consequence to execute rather than leave implicit: with `reset` always
appended, the `if (!box.childNodes.length) return null` guard at
`mount.js:641` becomes unreachable. **Delete it** rather than leave a line that
claims a case that can no longer arise, and note the deletion in the CHANGELOG.

Keep the `title` in the house voice and make it true for both cases, something
along the lines of back to the default view, full range, and the camera with it
on a surface.

### 4.3 Landing phase 2

One version bump, one commit, a `CHANGELOG.md` section, a `dev/TODO.md` tick.

---

## 5. Phase 3: the device round, and the one contingency

Nothing in phases 1 and 2 can be verified from a Windows desktop. Neither the
`node --test` suite nor a Chrome window exercises the iOS code path, because
the whole defect in 4.1 lives in a branch Safari takes and Chrome on a desktop
does not.

So phase 2 ends with a build in the author's hands and ten minutes on the iPad,
checking four things:

1. tapping the group tabs no longer shifts the strip sideways, and the leaf row
   no longer rewraps;
2. a double tap on the page no longer zooms it, and pinch zoom still works;
3. a tap on the 3-D surface places the cuts, and a deliberate, unhurried tap
   works as well as a quick one;
4. `reset` appears on a 2-D chart and undoes a pinch zoom.

Item 3 is the one that can come back negative, and only in its second half: a
tap held longer than 300 ms is refused by `HandlerProxy.js:138` no matter how
good the coordinates are. **Do not build for this in advance.** If it turns out
to bite, the fix is a tap recognizer of our own, and the sketch is:

* record the time and position at `touchstart` in `touch.js`, which is already
  listening;
* on `touchend` in the **bubble** phase, so zrender's own handler has already
  run, treat a gesture under about 700 ms and under about 12 px of movement as
  a tap;
* if zrender did not already emit a click for that gesture, which a
  `zr.on('click')` listener can record with a flag, dispatch one with
  `chart.getZr().handler.dispatch('click', event)`.

`zr.handler` and `Handler.prototype.dispatch` (`zrender/lib/Handler.js:116`)
are public on zrender, so this stays out of `echarts-gl`'s private surface.
Reaching into `LayerGL` through `chart.getZr().painter` would also work and
should **not** be done: it is a private reach into a third party library, and
the house rule against that is not weaker for a third party than for LIB.

If phase 3 changes code it takes its own version bump. If it only confirms, it
does not.

---

## 6. Tests

The web suite is `node --test` with no DOM, so most of this is not unit
testable and the plan should not pretend otherwise.

* `touchPoint(rect, touch)` is pure and gets a test in
  `web/test/touch.test.js`: a touch at a known client position against a known
  rectangle, including a rectangle with a non-zero origin.
* The width reservation in 3.1 and the strip changes in 4.2 need a DOM and get
  none. Their verification is a reading of the diff plus the device round: that
  both `resetView` callers reach one function, that the held `zoom` is cleared
  on the surface path where today it is not, and that every `data-label` matches
  the label beside it.
* Nothing on the Python side is touched, so `uv run pytest` is unchanged and is
  run only to confirm that.

---

## 7. The author's rulings, 2026-08-14

All three review questions are closed. They are folded into the sections above
and repeated here so the record is in one place.

1. **Losing double tap to zoom, page wide.** Accepted, and the scoped
   alternative declined. The author does not use the gesture. Section 3.2.
2. **A one-button strip on charts that have none today.** `reset` is
   unconditional. Every plot has some controls in practice, so the case is
   close to hypothetical, and the dead guard that covered it is deleted rather
   than kept. Section 4.2.
3. **The leaf strip's selected state.** The bold stays, on both strips. The
   look does not change; the width reservation does the work, and it costs six
   attributes in `index.html` and one line in `main.js`. Section 3.1.

## 8. Deliberately not in this plan

* **Pinning the group strip under the header.** Ruled out, section 1.1.
* **A double tap recognizer.** Held as the contingency in section 5, not built
  speculatively. The `reset` button is the answer for a finger, and it is the
  answer for a projector and a keyboard too.
* **Shortening the group tab labels, or wrapping the strip to two rows on a
  phone.** Either would end the horizontal scrolling noted in 2.1 outright.
  Both are a design change to the strip rather than a defect fix, and the
  author is demoing on an iPad, where the strip does not scroll: its content
  measures about 605 px after 3.1 against roughly 720 px of usable width in
  portrait.
* **Anything upstream.** Nothing here is a LIB ask, and no round note is owed.
* **Patching or pinning around the `echarts-gl` defect.** The shim in 4.1 sits
  in our own code and leaves the dependency alone. If a later `echarts-gl`
  fixes `LayerGL`, the shim becomes dead and can be deleted; that is why 4.1
  requires the docstring to name the file and line.
