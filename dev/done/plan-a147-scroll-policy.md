# Plan a147: one scroll policy, implemented once, and the a145/a146 mechanics retired

Target version: 1.0.0a147. Front-end only; no backend changes. Files:
`web/src/main.js`, a new `web/src/scroll.js`, `web/src/styles/site.css`,
plus the standing housekeeping set (`CHANGELOG.md`, `pyproject.toml`,
`uv.lock`, this plan, `dev/TODO.md`).

## Goal

The page repositions predictably and gently for exactly two kinds of gesture,
and never otherwise:

1. **A program gesture** (Build, Ctrl+Enter, Reformat, Occ/Reins/GCN derive
   buttons, picking an example from the menu, palette, or Ctrl+Shift ring):
   scroll so the editor box sits at the top of the page, under the sticky
   header. Always, both directions: these gestures mean "start reading from
   the program".
2. **A navigation gesture** (group tab, sub-tab, in-pane view pill): scroll
   **down** so the group tab strip (Overview | Re | Pricing | PnL | Bounds |
   More) sits at the top, under the header, **but only if the reader is above
   that point**. A reader who has already scrolled past the strip is reading
   content; the page stays where it is.

Everything else (typing, forms inside panes, the ruin Draw and Sample buttons,
pricing form posts, page load and the landing auto-build) moves the page not
at all. The page never scrolls up except for a program gesture, and no scroll
ever fires after the gesture that asked for it, so nothing can yank the reader
later.

## Current behavior (a146) and why it misfires

The rule was introduced at a145 and patched at a146, in three layers, all in
`web/src/main.js`:

- `scrollAnchor(el)` (line 1187): computes the element's document position
  minus the sticky header height minus 6px and calls
  `window.scrollTo({behavior: 'smooth'})`.
- Two anchors on it: `scrollTabsTop()` (the `.out-tabs` strip) and
  `scrollEditorTop()` (`#editor-box`).
- Two "two-pass" wrappers, `anchorTabs(loading)` / `anchorEditor(loading)`
  (lines 1215 to 1224): scroll immediately, then again when the passed promise
  settles. The second pass exists because a pane swap momentarily empties the
  content, the document height collapses below the scroll target, and the
  browser clamps the first scroll (measured at a145: a tab click ended at
  scrollY 0 with the strip 400px down).

Call sites use three different patterns:

- `anchorEditor(build())`: Build button, Ctrl+Enter, example pick, the
  debounced example ring (lines 124, 842, 3701, 3800).
- Hand-rolled `scrollEditorTop()` pairs at the top and in the `finally` of
  `runDerivation`, the Reformat handler, and `applyViews` (556/578, 718,
  766/813), plus one unpaired call in `setDecl` (3654).
- `anchorTabs(...)`: group tab clicks via a module-level `_tabLoading` promise
  recorded in the `shown.bs.tab` handler (1578 to 1600), sub-tab clicks via
  `selectLeaf` (1471), and one in-pane pill, the Approximation half toggle
  (2830).

Six defects, and together they explain "not working well, if at all":

1. **The down-only guard does not exist.** `scrollAnchor` scrolls in both
   directions unconditionally. Clicking a sub-tab while reading below the
   strip yanks the page up. This is the behavior the author most wants gone,
   and no code implements it.
2. **The settle pass races the layout.** The second scroll fires when the
   fetch promise resolves, but the tab panes carry Bootstrap `fade`
   (`web/index.html:396` on), so the opacity transition is still running, and
   charts and grids finish laying out after the promise settles. A target
   computed against a mid-flux layout lands wrong, and nothing corrects it.
3. **The settle pass ignores the reader.** After a slow build, the deferred
   `scrollEditorTop()` in the `finally` blocks drags the page back even if the
   reader scrolled away in the meantime.
4. **Smooth scrolls are fragile.** A `behavior: 'smooth'` animation is
   cancelled by any wheel or touch input and by competing programmatic
   scrolls: `editor.focus()` (3651) triggers a native scroll-into-view, and
   CodeMirror dispatches its own `scrollIntoView`. A cancelled animation stops
   wherever it was.
5. **The root cause was compensated for, not fixed.** The clamp that
   motivated the whole two-pass apparatus is the document height collapsing
   during a pane swap. The only floor is `.pane { min-height: 1rem }`
   (`site.css:741`). The dev-tree UI rules already require stable swap-target
   heights; this page does not follow them.
6. **Three patterns across roughly ten call sites** drift independently, and
   coverage is inconsistent (the Approximation pill anchors, other in-pane
   controls do not, by accident rather than by rule).

Feasibility, for the record: the page knows exactly where it is.
`window.scrollY` is the scroll offset to the pixel and
`el.getBoundingClientRect().top` is any element's position relative to the
viewport, so "is the strip above or below the current view line" is a one-line
comparison. The requested "down only" rule is a two-line guard.

## Design

### [height] Stabilize the height so no scroll can clamp

The keystone. Give the swap region a floor so the document is never shorter
than either anchor target needs:

- `.tab-content { min-height: calc(100vh - <offset>); }` in `site.css`, where
  `<offset>` approximates header + strip + sub-tab heights (about 150px;
  tuned at implementation, a CSS custom property so the number is named). The
  invariant it must satisfy: with the strip anchored at the top, the document
  extends at least a full viewport below it, so `scrollTo` reaches its target
  even while a pane is empty mid-swap. The editor anchor, whose target is
  smaller, is covered by the same floor.
- `overflow-anchor: none` on `.tab-content`, so the browser's own scroll
  anchoring does not fight the explicit policy during content swaps. Verify
  during kick-the-tires; drop if it changes nothing.

With the height stable, the clamp disappears, and with the clamp gone the
entire two-pass mechanism, the `_tabLoading` promise plumbing, and every
`finally` re-scroll become dead weight. One scroll, at gesture time, suffices.

### [scroll module] One primitive in a new `web/src/scroll.js`

A small module (about 50 lines with the policy comment), following the
`nav.js` precedent of separating a checkable rule from the wiring:

```js
/** Document-space target: el's top sitting just under the sticky header. */
function targetFor(el) { ... }                 // rect.top + scrollY - headerH - 6

/** Program gesture: the editor box leads. Always scrolls. */
export function anchorEditor() { ... }         // scrollTo(target, smooth)

/** Navigation gesture: the tab strip leads, down only.
 *  If the reader is already at or past the strip, do nothing. */
export function anchorNav() {
    // if (window.scrollY >= target - EPS) return;   the author's rule
    ...
}
```

`behavior: 'smooth'` stays for the polished feel; with reachable targets it
completes, and a reader's wheel input cancelling it is the reader taking
control, which is correct. The policy comment currently at `main.js:1173`
moves here, rewritten for the new mechanics; the a145/a146 archaeology
(the measured Bootstrap event-order note, the clamp note) goes, because
nothing depends on it any more.

### [wiring] Every call site becomes one line, and the set is closed

Program gestures, all become a bare `anchorEditor()` at gesture time:

- Build button and `onBuild` keybinding: `anchorEditor(); build();`
  (unwrap `anchorEditor(build())`).
- `pickExample` and the ring's debounced `buildSoon`: same unwrap.
- `runDerivation`, Reformat, `applyViews`: keep the call at the top, delete
  the `finally` re-scrolls and their settle-pass comments.
- `setDecl`: keep the single call after `editor.focus()` (the focus scroll is
  instant, the anchor then wins; note this in place).
- `build()` itself stays scroll-free, so the landing auto-build and the
  examples auto-build never move the first paint.

Navigation gestures, all become a bare `anchorNav()`:

- Group tab click handler: drop the `_tabLoading` capture entirely; the
  `shown.bs.tab` handler keeps loading the tab, the click handler just calls
  `anchorNav()` when the tab is live. Re-clicking the active tab still
  anchors: same gesture, same answer.
- `selectLeaf`: `renderSubTabs(group); anchorNav(); loadLeaf(group);`.
- The Approximation half pill: `anchorNav(); loadApproximation();`.

And the closed rule, stated in the `scroll.js` comment so future leaves know
where they stand: **a form inside a pane never scrolls** (pricing forms, the
ruin Draw and Sample buttons, the bounds form, quick re). The reader operating
a form is already looking at it.

Deleted outright: `scrollAnchor`, `scrollTabsTop`, `scrollEditorTop`,
`anchorTabs`, `anchorEditor` (the wrapper), `_tabLoading`, and every
settle-pass call and comment. Net line count goes down.

## What was considered and set aside

- **A sticky tab strip** (position: sticky under the header) would make
  navigation scrolling unnecessary altogether, but costs a permanent band of
  viewport, raises the same question for the sub-tab row, and the author has
  specified the down-only anchor instead. Not pursued.
- **`scrollIntoView` + CSS `scroll-margin-top`** is the tidy platform idiom
  for plain anchoring, but the down-only rule needs the manual computation
  anyway, so one mechanism, manual, is simpler than two.
- **Dropping `fade` from the tab panes** would make swaps synchronous and was
  a candidate fix for the settle race. With the settle pass deleted the race
  is gone, and the fade is part of the app's feel. Kept.
- **A user-motion guard** (suppress deferred scrolls if the reader moved) is
  unnecessary once no scroll is deferred. Not built.

## Steps

1. [height] `site.css`: `.tab-content` floor and `overflow-anchor: none`.
2. [scroll module] `web/src/scroll.js` with `anchorEditor` / `anchorNav` and
   the policy comment.
3. [wiring] Rewire the call sites listed above; delete the old mechanism.
4. [housekeeping] Bump to 1.0.0a147, CHANGELOG entry, commit the batch,
   rebuild the SPA (`.\scripts\build-web.ps1`), `uv sync --extra dev`.

## Acceptance checklist (kick the tires in the browser)

1. Page load with the landing build: the first paint does not move.
2. From the top of the page, click each live group tab: the page glides down
   until the strip sits under the header; no bounce, no second jump, and the
   pane content appears below without the position shifting.
3. Scroll deep into a long pane (a density table), then click a sub-tab or
   another group tab: the page **stays put**; only the content swaps.
4. Press Build (button and Ctrl+Enter) from anywhere on the page: the editor
   box tops the page, once.
5. Pick an example from the menu, the Ctrl+K palette, and the Ctrl+Shift
   ring: editor anchors, the build lands, nothing jumps afterward.
6. Occ / Reins / GCN and Reformat: editor anchors at the press; when the
   response lands the page does not move again, even if you scrolled while it
   was in flight.
7. The Approximation half pill obeys the navigation rule (down only).
8. Ruin Draw and Sample, and every pricing form post: no scroll at all.
9. Repeat 2 to 4 at phone width (strip in horizontal-scroll mode).
10. No scroll ever clamps: after each gesture the anchored element actually
    sits under the header (the height floor is doing its job).

## Measured at a146 (2026-09-07, live instrumentation)

The running app was instrumented in the browser (wrapping `window.scrollTo`,
logging scroll events and document height). Three measurements, and together
they show the a145/a146 **wiring works exactly as designed and the geometry
defeats it**:

1. **On a desktop window the rule is a structural no-op.** With the BasicBook
   landing built, the document was exactly viewport height (1099px, a wrapper
   stretches short content to 100vh), so maximum scroll was **zero**. A
   Pricing tab click fired both passes correctly, `scrollTo({top: 362,
   smooth})` twice, and the page could not move a pixel. Grids scroll
   internally (CsvGrid caps its own height), so the document rarely exceeds
   the viewport and the anchor target is chronically unreachable.
2. **When content is tall the anchor still falls short.** With the More
   Density grid loaded, the document reached 1377px against an 1099px
   viewport: maximum scroll 278, anchor target 362. The scroll ran and
   stopped 84px shy of the strip, in a visually arbitrary place.
3. **A tall-to-short pane swap hurls the reader to the top.** From scrollY
   278 (page bottom), clicking the Tail sub-tab fired `scrollTo(362)`; 16ms
   later the pane swap collapsed the document from 1377px to 1099px, maximum
   scroll became zero, and the browser clamped the position from 278 **to
   0**. The settle pass re-fired `scrollTo(362)` against the collapsed
   document and could do nothing. The reader lands at the top of the page
   with the strip nowhere near the header.

So defect 5, the missing height floor, is not one defect among six: it is the
dominant cause of everything the author observed, and the [height] step is
the keystone exactly as designed. The floor must satisfy the invariant
`document height >= strip target + viewport height` at every moment,
including mid-swap, which `calc(100vh - <offset>)` on `.tab-content` does.
Defects 1 and 3 (the missing down-only guard, the deferred yank) remain real
and code-certain; they become visible the moment the floor makes scrolling
possible at desktop sizes, so fixing the floor without them would trade
"nothing happens" for "the page yanks", the worse failure.

## Execution notes (2026-09-07, landed as 1.0.0a147)

All three code steps landed as designed, in one bump. Divergences, all small:

- [name] The plan calls the example loader `setDecl`; the code spells it
  `loadExample` (`main.js`, the call after `editor.focus()`). Same site, same
  edit.
- [reformat] The plan lists Reformat among the handlers carrying a `finally`
  re-scroll pair. Reformat carried only the top call, so there was nothing to
  delete there; `runDerivation` and `applyViews` had the pairs as described.
- [floor] `--anchor-band` set to 140px rather than the plan's sketch of about
  150px: header about 57px, group strip about 34px, sub-tab band about 46px,
  totaling about 137px. A number to revisit at kick-the-tires if the strip
  lands short of the header.
- [tab comment] The measured capture-order comment on the group tab handler
  was rewritten rather than deleted: the fact that `shown.bs.tab` fires
  during the capture phase still explains why the anchor rides the click and
  why programmatic activations never scroll. The `_tabLoading` half went with
  the plumbing.
- [control list] The control list lives at `V:\worktrees\dev-files.md` (the
  skills say `T:\worktrees\`, which is not mounted on this machine); no row
  existed for this plan, so one was added at the bump.
- [todo] `dev/TODO.md` carries no entry for this work (the plan arose
  directly from the author's a145/a146 reports), so there was nothing to
  tick.
