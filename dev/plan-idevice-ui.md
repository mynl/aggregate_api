# plan-idevice-ui: the app on an iPhone and an iPad

Status: **FINALIZED 2026-08-14, extended and re-verified 2026-08-21**. The
original scope and its three review questions were ruled by the author on
2026-08-14. A fourth item, the program history walk, was raised and ruled on
2026-08-21 and is now phase 2; the chart work moves to phase 3 and the device
round to phase 4. Every line reference below was re-read against the tree on
2026-08-21. Ready to execute.

SPA only. No api change, no LIB change, no library fork, no new dependency.
Three phases, each its own version bump, then a device round.

The author is demoing on an iPad, so the two chart items and the history walk
are the ones that matter. Everything here is a fix to a defect, not a new
feature.

Version numbers: the repo is at `1.0.0a114`, so the three bumps are `a115`,
`a116` and `a117`. Take the next free numbers at execution rather than assuming
these, since the author commits between sessions.

The three phases touch disjoint files and can land in any order.

---

## 1. Scope

Five items. Four come from an investigation on 2026-08-14 of two reports from
the author: that the group tabs "float around" on an iPhone or iPad, and that
on the iPad neither the click that places the cuts on the 3-D surface nor the
double click that resets a 2-D chart does anything. The fifth comes from a
report on 2026-08-21, that `Ctrl+↑` and `Ctrl+↓` do not step the program
history on a phone or an iPad, and are not good enough where they do work.

| Item | Phase | Fixes |
|---|---|---|
| The group and leaf strips reflow when a tab is selected | 1 | tabs moving under a thumb |
| Double tap zooms the page | 1 | the page drifting once zoomed |
| The history walk is keys only, and the keys are wrong | 2 | no route to your own history on a touch device |
| A tap on the 3-D surface picks nothing | 3 | tap to place the cuts |
| Only a surface has a `reset`, and it does not clear the zoom | 3 | a zoomed 2-D chart with no way back |

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
`.out-tabs` may carry `overflow`. Note further, since 2026-08-14, that
`.out-tabs` now declares `overflow: visible` on itself (`site.css:398`), added
deliberately so a greyed tab's tooltip is not clipped. That declaration is
compatible with sticky, being `visible` rather than a scroll container, but the
comment beside it has to be read before anything moves it.

---

## 2. The findings each fix rests on

Sections 2.1, 2.2, 2.4 and 2.5 were measured on the live site at
`agg.mynl.com` on 2026-08-14, read off the shipped `zrender` 5.6.1 and
`echarts-gl` 2.1.0 in `web/node_modules`, and re-verified against the tree on
2026-08-21. Section 2.3 was investigated on 2026-08-21.

### 2.1 Selecting a tab changes its width, so the strip reflows

`site.css:420` gives `.out-tabs .nav-link.active` `font-weight: 700` while the
inactive tabs inherit normal weight. Measured widths on the live strip:

| Tab | inactive | active | delta |
|---|---|---|---|
| Overview | 95.9 px | 101.4 px | 5.5 px |
| More | 70.1 px | 72.0 px | 1.9 px |

Every switch therefore moves every tab to the right of the change by up to
5.5 px. With a mouse that is nothing. With a thumb, the target just moved.

`site.css:445` and `:450` do the same on the leaf strip, 600 against 700, and
that row is `flex-wrap: wrap` (`site.css:438`). So a width change there can
rewrap the row, jump a leaf onto another line, change the row's height, and
move everything below it.

On an iPhone this compounds with `site.css:537`, which makes `.out-tabs` a
horizontal scroller under 576 px. Above that width the strip does not scroll:
the base rule takes `overflow: visible` (`site.css:398`) so a greyed tab's
tooltip is not clipped, and six group names fit. Under 576 px the strip's
content measures about 425 px against roughly 358 px of usable width, so it
overflows by 60 to 70 px, and `scrollbar-width: none` plus the hidden webkit
scrollbar (`site.css:399`, `:401`) means nothing says so.

Note that the defect is the **width change**, not the bold. Section 3.1 fixes
it without altering the look, per the author's ruling.

### 2.2 The page has no `touch-action`, so a double tap zooms it

`index.html:5` is `width=device-width, initial-scale=1` with no
`maximum-scale`, and a sweep of the live page found **not one element** whose
computed `touch-action` is anything but `auto`. Re-checked 2026-08-21: there is
still no `touch-action` declaration anywhere in `web/src` or in `index.html`.
So a stray double tap zooms the page. Once zoomed, the whole page pans under a
finger and the sticky header drifts across the content, which is the most
likely reading of "floating around" as opposed to merely "moving".

### 2.3 The program history walk cannot be reached on a touch device, and is poor where it can

Five separate defects, which is why this gets a phase of its own rather than a
line in phase 1.

**The keys do not exist on the device.** The author's report, 2026-08-21: the
iPad's on-screen keyboard has no arrow keys, so `Ctrl+↑` and `Ctrl+↓` cannot be
typed at all, with or without a modifier. The same holds on an iPhone. The app
already half knows this: `index.html:272` says in its own comment that the key
hints fold away below `sm` because "phones have no Ctrl key", and `.fb-right`
at `index.html:279` is `d-none d-sm-flex`. So on a phone the `[m/n]` readout at
`index.html:187` is visible and describes a control the reader has no way to
operate.

**On an iPad with a hardware keyboard the binding is not `Ctrl`.**
`editor.js:161` binds `Mod-ArrowUp`. CodeMirror resolves `Mod` in
`normalizeKeyName` (`@codemirror/view/dist/index.js:8983`): `platform == "mac"`
gives **Meta**, otherwise `Ctrl`. `currentPlatform` (`:8966`) is `"mac"` when
`browser.mac`, which is `ios || /Mac/.test(nav.platform)`, and `ios` is
`safari && (/Mobile\/\w+/.test(ua) || maxTouchPoints > 2)`. Both halves fire on
an iPad, where `navigator.platform` is `"MacIntel"` in desktop-class Safari and
`maxTouchPoints` is 5. So the real binding there is `Cmd+↑` and `Cmd+↓`, and
every hint on the page says `Ctrl`: the action row (`index.html:280`), the help
panel key table (`index.html:577`, `:578`), and the prose comments at
`index.html:172` and `:231`. The same is true on a Mac desktop, which is why
this has never surfaced on Windows.

**An unbuilt draft is thrown away and the walk cannot hand it back.**
`navigateHistory` (`main.js:119`) calls `editor.setText(text)` with no stash.
Walking forward runs out at `history.next()` returning `null` when
`cursor <= 0` (`history.js:68`), and `navigateHistory` does nothing on `null`,
so the reader is left holding `entries[0]` rather than what they had typed. A
shell keeps the half-typed line at the front of the walk and returns it when
you step forward off the end. `Ctrl+Z` does recover it, since `setText`
dispatches a real change into CodeMirror's own history (`editor.js:237`), but
nothing says so and a phone has no `Ctrl+Z`.

**A refused press is silent, and one accepted press is silent too.** Both ends
of the walk return `null` and the readout does not move, so a press at the
oldest entry is indistinguishable from a dropped keystroke. That is the exact
question the readout was added to answer. Worse, there is an accepted press
that moves the program on screen without moving the counter: in `history.prev`
(`history.js:55`), when the cursor is unset and the editor holds something
edited, `at` stays `-1`, the cursor lands on `0`, and `position()` reports the
same number it reported before.

**The walk ends on keys that are not typing.** `main.js:115` passes `ArrowUp`
and `ArrowDown` through and calls `history.resetCursor()` on every other
unmodified keydown. So `Shift` pressed alone to start a selection, or `Home`,
`End`, `PageUp`, `Escape` or `Tab`, all silently end a walk in progress. The
intent is "the reader typed something new"; the test is "a key went down".

**And the store is too small for the numbering the author wants.** `MAX` is 20
(`history.js:14`). Section 4.2 explains why the cap and the direction of the
counter are one question rather than two.

### 2.4 A tap on the 3-D surface picks nothing

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

Section 6 is the contingency for that second limit. Phase 3 fixes the first
one and measures before spending anything on the second.

### 2.5 A zoomed 2-D chart has no way back

`mount.js:1143` puts the reset on `zr.on('dblclick')`. On iOS the only route to
that is a native DOM `dblclick`, which lands inside the 700 ms `scope.touching`
guard on the second tap and is discarded. With `touch-action: auto` the double
tap is spent on zoom anyway.

The `reset` button is rendered only inside `if (grid && realized ===
'surface')` at `mount.js:538`, so a 2-D chart has no button. And `onReset`
(`mount.js:1223`) does not clear the held `zoom`; only the dblclick handler
does, at `mount.js:1147`. So the surface's own reset leaves a held zoom in
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
   * Group strip: six static attributes in `index.html:335` to `:340`, one per
     tab, matching the visible label exactly. The six are Overview,
     Reinsurance, Pricing, Economics, Bounds, More.
   * Leaf strip: one line where the button is built, around `main.js:1090` to
     `:1097` (the `className: 'sub-link…'` line is `main.js:1094`), setting
     `data-label` from `leaf.label`, which is already in hand there. `nav.js`
     is not touched: it owns the label, and this reads it.
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

Note also `site.css:489`, where a greyed tab takes `font-weight: 400
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
`site.css:540` and `site.css:793`, which already record that Safari magnifies
the page when a focused input's font is under 16 px. This is the third member
of that family and belongs with them.

### 3.3 Landing phase 1

One version bump, one commit, a `CHANGELOG.md` section carrying the reasoning
above, a `dev/TODO.md` tick. The bump is warranted: this is plan-based work
with a behavior change, not tidying.

---

## 4. Phase 2: the history walk reaches a finger, and starts counting up

Touches `web/src/history.js`, `web/src/main.js`, `web/src/editor.js`,
`web/index.html`, `web/src/styles/site.css` and
`web/test/history-walk.test.js`. Unlike the rest of this plan, most of it is
unit testable: `history.js` is module state with a localStorage fallback, and
`node --test` already exercises it.

### 4.1 The store gets much bigger

**Author's ruling, 2026-08-21: hundreds of entries, because it is only a little
text.** `MAX` at `history.js:14` rises from 20 to **500**, and a byte ceiling
joins it as the guard that actually matters.

The arithmetic. A DecL program is short: the landing program is 63 characters
and a large portfolio runs to about a thousand. At a generous 300 characters
per entry, 500 entries is 150 KB of JSON in an origin that gets about 5 MB. So
the count cap is not the binding constraint and should not pretend to be. Set
`MAX = 500` and a companion `MAX_CHARS = 256 * 1024`, and trim from the oldest
end until both hold. Sum the entry lengths as the proxy for bytes: DecL is
ASCII in practice, and a proxy that runs in one pass beats a `JSON.stringify`
per candidate.

Fix `save()` (`history.js:26`) while there. It swallows a quota exception
silently today, which at 20 entries meant nothing and at 500 means the newest
program is dropped without a word. On an exception, trim the oldest quarter and
retry once; if that fails too, leave the in-memory state alone and give up
silently, as now. Say in the comment that the in-memory walk still works for
the session, which is the whole reason giving up is acceptable.

One limit to record rather than fix: iOS Safari's tracking prevention will
evict script-writable storage for an origin the reader has not interacted with
in seven days. An actively used `agg.mynl.com` is not in that class, but a
history that vanishes after a fortnight away is the storage behaving as
designed and not a defect here.

### 4.2 The counter counts up, and the cap raise is what makes that honest

**Author's ruling, 2026-08-21: count up, JupyterLab style. The newest entry
carries the highest number.** So the first program built is `[1/1]`, the second
is `[2/2]`, and stepping back from the tenth reads `[9/10]`.

**This reverses the a68 ruling, deliberately, and the reversal only works
because of 4.1.** The docstring at `history.js:77` records the old reasoning:
it read this way through a68 and was flipped on the argument that "a counter
whose current position changes every time you build (`[19/19]`, then
`[20/20]`, then `[20/20]` again once the cap bites) is telling you about the
pile rather than about where you are in it". The parenthesis is the whole
argument, and it is an argument about **the cap**, not about the direction. At
20 entries the counter froze at `[20/20]` within a day of use and stopped
saying anything. At 500 it climbs on every build for as long as anyone will
ever use the app in one sitting, which is exactly the JupyterLab `In[n]` feel
the author asked for: the number changes on each entry, so you can see that
something happened.

Rewrite that docstring rather than amending it. The old reasoning is now
wrong and a reader who finds both arguments in one comment learns nothing.
Record instead that the direction and the cap were settled together on
2026-08-21, and why.

The code change is one line in `position()` (`history.js:104`). `cursor` runs
from the newest at 0 and stays that way; only the reported number flips:

```js
return { m: n - Math.max(state.cursor, 0), n };
```

Check it: with three entries, `cursor` unset or 0 gives `m = 3`, the newest;
`cursor = 2` gives `m = 1`, the oldest. Storage order is untouched, so
`record`, `prev`, `next` and `findDeclaring` are unaffected.

**The direction of the arrows follows from this and must be drawn to match.**
Up goes to older, which is now the **lower** number. Down goes to newer, the
higher number. That is what makes the control vertical rather than horizontal:
stacked, the buttons draw the list they walk, oldest above and newest below,
the way a notebook puts earlier cells higher and a terminal puts newer output
lower. Say so in the comment beside the markup, because it is the one thing a
later reader could get backwards.

### 4.3 The unbuilt draft is stashed and handed back

**Author's ruling, 2026-08-21: not a disaster, but it should be automatic.**

Add `draft` to the stored state, alongside `entries` and `cursor`, and one
sentinel:

```js
const DRAFT = -2;   // the walk is showing the stashed draft, which is not an entry
```

The four rules:

* `prev(current)`: if `cursor === -1` and `current` is non-empty and differs
  from `entries[0]`, stash it as `state.draft` before stepping. That is exactly
  the condition under which the reader is about to lose something, and it is
  the condition `prev` already computes for its own `at`, so it costs no new
  test. From `DRAFT`, treat `at` as `-1`, so up out of the draft lands on the
  newest entry.
* `next()`: at `cursor === 0` with a draft held, set `cursor = DRAFT` and
  return the draft. At `cursor === DRAFT`, return `null`: there is nowhere
  newer. Keep `state.draft` held rather than clearing it on the way out, so the
  reader can walk down to it again without having lost it a second time.
* `record()`: clear the draft. The program was built, so it is an entry now.
* `resetCursor()`: clear the draft. Typing is the reader saying the text on
  screen is the live one, and a stale stash behind it would pop out later as a
  program nobody asked for.

`position()` returns `{m: 0, n}` while `cursor === DRAFT`, and
`renderHistoryNav` renders the readout blank on `m === 0`, exactly as it does
today on `n === 0`. The reasoning to put in the docstring: the draft is not an
entry, so it has no number, and a blank readout says "you are not in the
history", which is true in both cases. The alternative, inventing a glyph for
the draft position, buys a distinction nothing acts on.

Export two predicates so `main.js` does not reimplement the edge logic, which
is where it would drift:

* `canPrev(current)`: false when there are no entries; otherwise the same `at`
  computation as `prev`, returning `at + 1 < n`.
* `canNext()`: false at `cursor === -1` and at `cursor === DRAFT`; true at
  `cursor > 0`; at `cursor === 0`, true only when a draft is held.

`canPrev` takes the editor text because the first step of a walk depends on it,
which is also why 4.5 refreshes the control on every edit.

### 4.4 The vertical control in the editor's right margin

**Author's ruling, 2026-08-21: up, readout, down, stacked vertically in the
right margin, and not in the action row beside Build.** The nav belongs with
the box it navigates, and the action row already carries Build, Examples,
Reformat and a five-wide derive group.

Markup, in `index.html` inside `.editor-wrap` (`index.html:167`), replacing the
lone `<span class="editor-pos">` at `index.html:187` with a wrapper holding
three children: a previous button, the existing readout span unchanged in id
and `aria-live`, and a next button.

Geometry, and it fits with room to spare. `.editor-clear` sits at
`top: .85rem` with a 28 px line box, so it ends at 41 px, which is what the
existing comment at `site.css:253` says. `.cm-content` has
`minHeight: '10.2em'` at 14 px (`editor.js:119`), a floor of six text lines, so
the box interior is never shorter than about 143 px. The stack starts where
`.editor-pos` starts today, `top: 2.8rem`, or 44.8 px, leaving about 98 px.
Two buttons at 2.1 rem square (33.6 px) with a 13 px readout and two .1 rem
gaps come to about 83 px, ending near 128 px with roughly 15 px of slack above
the floor.

2.1 rem is below Apple's 44 px touch guidance and that is a deliberate trade,
to be stated in the CHANGELOG. There is no more room without pushing the stack
outside the editor box or moving the clear icon, and the risk 44 px guards
against is pressing the wrong control, which does not arise here: everything
around these two buttons is dead margin, so a near miss moves the caret and
nothing else. If the device round in section 6 says it is still too small, the
escape hatch is to move `.editor-clear` to the bottom right and give the stack
the full height of the box, which buys 44 px squares. Do not build that in
advance.

**Reserve a channel so text cannot sit under the buttons.** `.cm-content`
carries `padding: '12px 10px'` at `editor.js:104`. Widen the right side to
about 54 px, written in the theme in `editor.js` rather than in `site.css`:
CodeMirror injects its theme rules at load and a plain `.cm-content` selector
in the stylesheet has the same specificity, so which one wins depends on
injection order, and the editor's own padding already lives in the theme. The
vertical arithmetic in the comment at `editor.js:106` is about `minHeight` and
is unaffected. Note in that comment that the reservation exists so the history
nav is always pressable, which is a stronger claim than the one the clear icon
has been getting away with: a glyph a long line runs under is ugly, a button a
long line runs under is broken.

Details:

* **Glyphs**: `bi-arrow-up` and `bi-arrow-down`, so the button and the key hint
  show the same mark. Not `bi-chevron-up` and `bi-chevron-down`: the page
  already uses `bi-chevron-down` for the GCN split-button caret
  (`index.html:257`), where it means "a menu opens here", and reusing it for
  stepping would blur two meanings.
* **Greying at the ends**: `disabled` from `canPrev` and `canNext`, refreshed
  wherever the readout is. **Author's ruling, 2026-08-21: yes, a good visual
  clue.** It answers "did that do anything" for the mouse in the one case the
  readout cannot, and it is what makes the end of the walk visible instead of
  silent.
* **No refocus.** **Author's ruling, 2026-08-21: agreed.** The clear icon
  refocuses (`main.js:154`) because clearing is a prelude to typing. Walking is
  not, and on a phone a refocus pops the on-screen keyboard over the thing the
  reader is trying to look at.
* **Always present.** Both buttons render greyed before the first build, with
  the readout blank, so nothing moves when the first program lands. The readout
  is already present-and-empty today.
* **`pointer-events`.** The wrapper keeps `pointer-events: none`, per the
  existing note at `site.css:251`, and only the two buttons take `auto`. The
  readout must not start eating clicks meant for the editor's right margin.
* **Labels.** `aria-label` on each ("step back through your history", "step
  forward through your history"), and a `title` carrying the key hint through
  the platform helper from 4.5 rather than a hardcoded `Ctrl`.

### 4.5 The keys tell the truth, and the walk stops dying on a Shift

Three small repairs that ride with the control.

**Bind `Ctrl` as well as `Mod`.** Add `Ctrl-ArrowUp` and `Ctrl-ArrowDown`
beside the existing `Mod-` bindings at `editor.js:161` and `:165`, and the same
for the `Mod-Shift-` example pair at `:172` and `:176`. `buildKeymap` throws
only on prefix conflicts, not on duplicate bindings, so on Windows the two
normalize to one name and coexist, and on a Mac or an iPad either key then
works. Update the callback docstring at `editor.js:136` to `:139`, which
currently names `Ctrl` and `Cmd` as if they were the same choice everywhere.

**One helper for the modifier name.** A small function returning `'Ctrl'` or
`'Cmd'` from the same test CodeMirror uses (`ios || /Mac/.test(nav.platform)`),
read by the action row hint (`index.html:280`), the help panel key table
(`index.html:577`, `:578`) and the two button titles. Without it the new
buttons teach the wrong key on the one device this plan is about. The comments
at `index.html:172` and `:231` name `Ctrl+↑` in prose and want the same pass,
by hand, since they are comments.

**Reset the cursor on an edit, not on a keydown.** Replace the listener at
`main.js:110` to `:117` with a CodeMirror `updateListener` gated on
`update.docChanged`, and mark the transaction that `setText` dispatches
(`editor.js:237`) with an annotation so the walk does not reset itself when it
loads an entry. Then `Shift`, `Home`, `End`, `PageUp`, `Escape` and `Tab` stop
ending a walk in progress, because the test becomes the event that was always
meant: the document changed. The listener also calls `renderHistoryNav`, since
`canPrev` reads the editor text.

Rename `renderHistoryPos` (`main.js:143`) to `renderHistoryNav`, have it set
the readout and both `disabled` states, and call it from the five sites that
call it today (`main.js:127`, `:239`, `:257`, `:352`, `:526`) plus the new
update listener. One function, one source of truth for what the control shows.

### 4.6 Landing phase 2

One version bump, one commit, a `CHANGELOG.md` section, a `dev/TODO.md` tick.
The CHANGELOG carries four things the author should not have to rediscover: the
counter reversed direction and why the cap raise is what licensed it, the cap
went from 20 to 500, the draft is stashed now, and the touch targets are 2.1 rem
rather than 44 px on purpose.

---

## 5. Phase 3: the two chart fixes

`web/src/charts/mount.js`, plus one small new module.

### 5.1 Touch events carry a coordinate the pick can read

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
between the flat and relief readings performs at `mount.js:1374`.

Note in the docstring **why** this exists, per the house rule: it compensates
for `echarts-gl` reading `offsetX` off the raw event rather than off the
zrender event packet, which is a defect in that library and not in this app.
Name the file and line so the next reader can check whether a later
`echarts-gl` has fixed it and the shim can go.

Expected effect: tap to place the cuts works, and hover and the readout on the
surface come back with it, since lines 442, 458 and 492 have the same defect
and the same cure.

### 5.2 One reset, on every chart, that clears the zoom

Factor a single `resetView()` inside `draw()` and give both callers the same
one:

* clear the held `zoom` (`mount.js:770`), which today only the dblclick handler
  does at `mount.js:1147`;
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
after the readings, after the surface controls, after the mesh export cluster
and after the realization control, which is the loop ending at `mount.js:640`.
On a surface that moves it from its current position mid group, ahead of the
mesh cluster, to the end; say so in the CHANGELOG so the author is not
surprised by a button that moved. **Move its comment with it.** The comment at
`mount.js:573` opens "Reset, last of the group", which is true where it sits
today and false the moment the button lands after the mesh buttons and the
realization buttons.

Two notes on the surrounding code, both new since this plan was drafted. A
`heatmap` realization now exists: `mount.js:520` gates the surface controls on
`surface || heatmap` and `KIND_LABELS` (`mount.js:256`) reads
`{xy: 'curves', heatmap: 'flat', surface: '3D'}`, so the flat reading has
controls of its own. And the mesh export cluster (`glb`, `obj`, `stl`) landed
inside the surface block after `reset`, with a `feelPanel` appended after the
control box at `mount.js:643`. Neither changes the fix; both change what "the
end of the group" means, which is why the rule above spells the order out.

**Author's ruling, 2026-08-14: `reset` is unconditional.** The question raised
was whether a chart with no other controls should grow a one-button strip. The
author's reading is that every plot has some controls already, and a check of
`readings` (`chartdoc-to-echarts.js:292`) mostly bears that out while showing
the edge the ruling settles: `kinds` is returned empty unless a panel offers
more than one realization (`:325`), so a document declaring one realization, no
multi-scale axis, no `full_range`, no complement or reciprocal pairing, no
invertible panel and no marks would today render no strip at all. The heatmap
realization makes that case rarer still, since a grid panel now offers two.

Consequence to execute rather than leave implicit: with `reset` always
appended, the `if (!box.childNodes.length) return null` guard at
`mount.js:641` becomes unreachable. **Delete it** rather than leave a line that
claims a case that can no longer arise, and note the deletion in the CHANGELOG.

Keep the `title` in the house voice and make it true for both cases, something
along the lines of back to the default view, full range, and the camera with it
on a surface.

### 5.3 Landing phase 3

One version bump, one commit, a `CHANGELOG.md` section, a `dev/TODO.md` tick.

---

## 6. Phase 4: the device round, and the two contingencies

Nothing in phases 1 to 3 can be fully verified from a Windows desktop. Neither
the `node --test` suite nor a Chrome window exercises the iOS code path,
because the whole defect in 5.1 lives in a branch Safari takes and Chrome on a
desktop does not, and the modifier finding in 2.3 depends on a platform test
that is false on Windows.

So phase 3 ends with a build in the author's hands and fifteen minutes on the
iPad, checking six things:

1. tapping the group tabs no longer shifts the strip sideways, and the leaf row
   no longer rewraps;
2. a double tap on the page no longer zooms it, and pinch zoom still works;
3. the two arrows step the history, the counter climbs toward the newest, the
   greying lands at both ends, and a stashed draft comes back;
4. with a hardware keyboard attached, both `Ctrl+↑` and `Cmd+↑` step the
   history, and the hints on the page name whichever one the device reports;
5. a tap on the 3-D surface places the cuts, and a deliberate, unhurried tap
   works as well as a quick one;
6. `reset` appears on a 2-D chart and undoes a pinch zoom.

Item 5 is the one that can come back negative, and only in its second half: a
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

### 6.1 One more thing to look at on the device, with its fix pre-specified

**Unconfirmed, raised 2026-08-21.** iOS Safari magnifies the page when an
editable element takes focus and its font is under 16 px. The app already knows
this and applies the 16 px cure in three places (`site.css:544`, `:704`,
`:796`). The DecL editor is not one of them: `editorTheme` sets `fontSize:
'14px'` at `editor.js:98`, and there is no phone bump for `.cm-content`
anywhere, though the comment at `editor.js:106` writes `minHeight` in `em`
specifically so it would track one.

Whether Safari applies focus zoom to a `contenteditable` as it does to a form
control is the part that has to be settled on the device rather than argued
from here. If it does, then **every tap into the editor on an iPhone zooms the
page**, which is a second and larger source of the "floating around" report
than the double tap in 2.2, and one that `touch-action: manipulation` does
nothing about: only a 16 px font or a `maximum-scale` on the viewport stops
focus zoom.

The fix, if the round confirms it: bump `.cm-content` to 16 px under 576 px, in
the theme in `editor.js` beside the other editor metrics. `minHeight` is in
`em` already, so the six-line floor grows with the face and nothing below the
editor jumps. It takes its own version bump.

If phase 4 changes code it takes its own version bump. If it only confirms, it
does not.

---

## 7. Tests

The web suite is `node --test` with no DOM, so much of this is not unit
testable and the plan should not pretend otherwise. Phase 2 is the exception.

* **Phase 2 is largely testable and gets real coverage.**
  `web/test/history-walk.test.js` exists and asserts `position()` directly, so
  the reversal in 4.2 breaks it by design: the seeding case flips from
  `{m: 1, n: 3}` to `{m: 3, n: 3}` and the first step back from `{m: 2, n: 3}`
  to `{m: 2, n: 3}`, which happens to be unchanged and is worth a comment
  saying so rather than leaving it looking untouched. Add cases for the stash
  (walk away from a draft, walk back to it, confirm `record` and an edit both
  clear it), for `canPrev` and `canNext` at both ends and on the draft, and for
  the trim in 4.1 driving the count and the char ceiling.
* `touchPoint(rect, touch)` is pure and gets a test in
  `web/test/touch.test.js`: a touch at a known client position against a known
  rectangle, including a rectangle with a non-zero origin.
* The width reservation in 3.1, the control in 4.4 and the strip changes in 5.2
  need a DOM and get none. Their verification is a reading of the diff plus the
  device round: that both `resetView` callers reach one function, that the held
  `zoom` is cleared on the surface path where today it is not, and that every
  `data-label` matches the label beside it.
* Nothing on the Python side is touched, so `uv run pytest` is unchanged and is
  run only to confirm that.

---

## 8. The author's rulings

### 8.1 2026-08-14

1. **Losing double tap to zoom, page wide.** Accepted, and the scoped
   alternative declined. The author does not use the gesture. Section 3.2.
2. **A one-button strip on charts that have none today.** `reset` is
   unconditional. Every plot has some controls in practice, so the case is
   close to hypothetical, and the dead guard that covered it is deleted rather
   than kept. Section 5.2.
3. **The leaf strip's selected state.** The bold stays, on both strips. The
   look does not change; the width reservation does the work, and it costs six
   attributes in `index.html` and one line in `main.js`. Section 3.1.

### 8.2 2026-08-21

4. **The history cap.** Hundreds of entries, not 20. It is only a little text
   and it is client side. Section 4.1.
5. **The direction of the counter.** Count up, JupyterLab style, so the number
   changes on each entry and the newest carries the highest number. This
   reverses a68 and is licensed by ruling 4. Section 4.2.
6. **The lost draft.** Suboptimal rather than a disaster, and it should be
   stashed automatically. Section 4.3.
7. **Where the control goes.** Up, readout, down, stacked vertically in the
   editor's right margin. Not in the action row beside Build. The arrows must
   be drawn to match the numbering settled in ruling 5. Section 4.4.
8. **Greying at the ends.** Yes, a good visual clue. Section 4.4.
9. **Refocus after a press.** No. Section 4.4.
10. **Buttons for the example walk.** No. Section 9.

## 9. Deliberately not in this plan

* **Pinning the group strip under the header.** Ruled out, section 1.1.
* **Buttons for the example walk (`Ctrl+Shift+↑↓`).** Ruled out by the author,
  2026-08-21. The Examples dropdown and `Ctrl+K` are already its mouse route,
  so a second pair of arrows would be a third way to do one thing.
* **Buttons for `Alt+1`…`6`.** Not raised and not needed: the group strip is
  that shortcut's mouse route and always has been.
* **Deduplicating the history globally.** At 500 entries, alternating between
  two programs fills the store with alternating copies, and a move-to-front
  dedup would fix it. It is declined because it would renumber everything above
  the moved entry on every build, and ruling 5 asks for numbers that mean
  something. Dedup against the most recent entry only, as `record` does today.
* **A double tap recognizer.** Held as the contingency in section 6, not built
  speculatively. The `reset` button is the answer for a finger, and it is the
  answer for a projector and a keyboard too.
* **Shortening the group tab labels, or wrapping the strip to two rows on a
  phone.** Either would end the horizontal scrolling noted in 2.1 outright.
  Both are a design change to the strip rather than a defect fix, and the
  author is demoing on an iPad, where the strip does not scroll: its content
  measures about 605 px after 3.1 against roughly 720 px of usable width in
  portrait.
* **Anything upstream.** Nothing here is a LIB ask, and no round note is owed.
* **Patching or pinning around the `echarts-gl` defect.** The shim in 5.1 sits
  in our own code and leaves the dependency alone. If a later `echarts-gl`
  fixes `LayerGL`, the shim becomes dead and can be deleted; that is why 5.1
  requires the docstring to name the file and line.
