# Plan a150: clamp the navigation scroll to what there is to see

Target version: 1.0.0a150. Front-end only; no backend changes. Files:
`web/src/scroll.js`, `web/src/main.js`, plus the standing housekeeping set
(`CHANGELOG.md`, `pyproject.toml`, `uv.lock`, this plan, `dev/TODO.md`).

## Goal

The author's rule for a navigation gesture (a group tab, a sub-tab, an
in-pane view pill), replacing the a147 rule "strip to the top, down only":

1. If, once the requested exhibit or chart has loaded, its bottom is already
   visible with no scrolling: do nothing.
2. Otherwise scroll the viewport **down** until the first of:
   a. the group tab strip sits at the top of the page (the a147 target), or
   b. the bottom of the exhibit becomes visible.
   Under (a) the exhibit bottom is not necessarily visible; a tall exhibit
   still gets the full strip-at-top anchor.

Program gestures (Build, examples, derive buttons) keep the a147 editor
anchor untouched, and the closed rule stands: a form inside a pane never
scrolls.

## Current behavior (a147 to a149) and why it feels wrong

`anchorNav()` in `web/src/scroll.js` scrolls to put the `.out-tabs` strip
under the sticky header, down only, one scroll at gesture time. For a short
exhibit (Overview / Summary is two screens' worth of scroll away from a
one-table answer) that overshoots: the page glides a long way down to show a
table that would have been fully visible after a fraction of the distance,
and the editor the reader was just working in leaves the screen for no
benefit. The strip-at-top target is only the right amount of scroll when the
content below it actually fills a viewport.

## Interpretation, stated so it can be challenged

"Bottom of the page" in rule 1 is read as **bottom of the loaded content**,
measured on the active `.tab-pane` (which wraps the sub-tab row, any group
furniture such as the Reinsurance description and Quick Re row, and the
pane). It cannot be the literal document bottom: the `.tab-content` floor
(`min-height: calc(100vh - var(--anchor-band))`, site.css, the a147
keystone) pads the document to a full viewport below short content
precisely so scroll targets stay reachable, so the document bottom sits far
below a short exhibit and rule 1 would never fire. The floor stays; the
measurement just ignores it.

## Design

### [geometry] One formula in `scroll.js`

All three rules are one clamped target plus the existing down-only guard:

```js
stripTarget  = targetFor(strip)                      // a147, unchanged
bottomTarget = pane.getBoundingClientRect().bottom + scrollY
               - innerHeight + BREATH                // pane bottom visible
target       = max(0, min(stripTarget, bottomTarget))
if (scrollY >= target - EPS) return;                 // rules 1 and down-only
scrollTo({ top: target, behavior: 'smooth' });
```

- `bottomTarget >= stripTarget` (tall exhibit): the strip tops the page,
  rule 2a.
- `bottomTarget < stripTarget` (short exhibit): the scroll stops the moment
  the pane bottom clears the viewport, rule 2b.
- `bottomTarget <= scrollY`: the bottom is already visible, no scroll,
  rule 1. A reader below the strip still never scrolls up.

`anchorNav()` grows an optional `pane` argument (the active `.tab-pane`
element); with no pane it behaves as today, the safe fallback. `targetFor`,
`anchorEditor`, `EPS` and `BREATH` are untouched. The policy comment at the
top of `scroll.js` is rewritten: the sentence "one scroll per gesture, fired
at gesture time, and none after" becomes "one scroll per gesture, fired once
the gesture's content is in place, and none after".

### [timing] The anchor moves from gesture time to settle time

Rule 1 is defined on post-load geometry, so the measurement must wait for
the leaf's loader. This deliberately revisits ground a147 cleared: the
a145/a146 settle pass was deleted for three defects, and each gets a
specific answer rather than a hope:

- **The clamp** (a pane swap collapsing the document under a scroll in
  flight): the `.tab-content` floor stays and keeps `stripTarget` reachable
  at every moment; `bottomTarget` is by construction at most the document's
  own max scroll once the content it measures exists.
- **The layout race** (measuring while things still move): measure after
  `await load()` plus a double `requestAnimationFrame`, so the DOM the
  loader built has laid out and painted once. The Bootstrap `fade` is
  opacity-only and never changes geometry. Grids cap their own height
  (CsvGrid `maxRows`) and charts render into sized hosts, so post-load
  geometry is stable.
- **The yanked reader** (a deferred scroll dragging the page after the
  reader moved on): record `scrollY` at gesture time; at settle, if the
  position has moved more than a small threshold (24px, tuned at
  kick-the-tires), the reader took control and the anchor is skipped.

Perceived behavior: for a pane already rendered (`state.rendered` hit, the
common case stepping between groups) the load resolves in a microtask and
the scroll fires effectively at gesture time, same feel as a147. For a real
fetch the page holds still and then makes its one move when the exhibit
appears, which is what the rule asks for.

One new helper carries all of this so every call site stays one line, living
in `scroll.js` beside the policy it implements:

```js
/** Navigation gesture: anchor once `loading` settles, clamped to `pane`,
 *  unless the reader moved in the meantime. */
export async function anchorNavSettled(pane, loading) { ... }
```

It anchors on the error path too: a failed loader renders an error node into
the pane, and that is then the content to read.

### [wiring] Three call sites in `main.js`

- **Sub-tabs**, `selectLeaf`: from `renderSubTabs; anchorNav(); loadLeaf;`
  to `renderSubTabs(group); anchorNavSettled(paneOf(group), loadLeaf(group));`
  where `paneOf` resolves the group's `.tab-pane` (`#t-<group>`).
- **Group tabs**: the anchor rides the click and the load rides
  `shown.bs.tab`, and the two must now meet. A pending-gesture token: the
  live-click listener records `{group, scrollY}`; when `loadTab(group)`
  completes in the `shown` handler, it consumes the token if the group
  matches and calls the settled anchor. This is correct in either event
  order (the measured a145 note says Bootstrap's capture handler starts the
  load before the click listeners run; with the fade, `shown` can instead
  fire long after the click), because load *completion* is always at least a
  microtask behind the synchronous click bubble. A programmatic activation
  (`applyCapabilityGating` falling back to Overview, the initial page) finds
  no token and never scrolls, preserving the a147 property. Re-clicking the
  active tab fires no `shown`, so the click listener anchors directly there:
  content already rendered, geometry already known.
- **The Approximation half pill** (the one in-pane view pill):
  `anchorNavSettled(paneOf('more'), loadApproximation())`.

Two gestures racing (tab A clicked, then B before A's fetch lands): the
token holds one group and the completing load consumes it only on a match,
so the latest gesture wins and the stale one moves nothing.

## What was considered and set aside

- **Clamping at gesture time against the current DOM**: no settle machinery,
  but for any leaf that fetches, the measurement sees the old pane (or the
  floor's padding) and the clamp is wrong exactly when it matters. Rule 1
  names the post-load page explicitly, so this fails the spec, not just the
  feel.
- **Scroll at gesture time, correct at settle**: the a145/a146 two-pass
  design, removed at a147 for cause. One scroll at settle keeps the "no
  scroll after the scroll" property that removal bought.
- **Shrinking the `.tab-content` floor** so the document bottom means
  something: the floor is what makes `stripTarget` reachable mid-swap
  (measured at a146: without it a tall-to-short swap threw the reader to
  scrollY 0). Measuring the pane instead costs one `getBoundingClientRect`.

## Steps

1. [geometry] `scroll.js`: the clamped target in `anchorNav(pane)`, the
   `anchorNavSettled` helper, the policy comment rewritten.
2. [wiring] `main.js`: the three call sites above; the group-tab
   pending-gesture token; the tab click comment updated.
3. [housekeeping] Bump to 1.0.0a150, CHANGELOG entry, commit the batch,
   rebuild the SPA (`.\scripts\build-web.ps1`), `uv sync --extra dev`.

## Acceptance checklist (kick the tires in the browser)

1. From the top of the page, click a group or sub-tab with a **short**
   exhibit (Overview / Summary on a plain aggregate): the page glides down
   just far enough that the table's bottom is on screen, and stops with the
   strip still mid-viewport, not at the header.
2. Same gesture on a **tall** exhibit (More / Density): the strip tops the
   page under the header, exactly the a147 behavior, bottom not visible.
3. Position the page so a short exhibit's bottom is already visible, then
   click across to it: the page does not move at all.
4. A reader below the strip never scrolls up on any navigation gesture.
5. On a leaf that genuinely fetches: one scroll, after the content appears;
   wheel-scrolling during the fetch suppresses the anchor entirely.
6. Program gestures unchanged: Build, Ctrl+Enter, an example pick each put
   the editor box at the top, both directions.
7. Ruin Draw and Sample, pricing form posts: still no scroll at all.
8. Repeat 1 to 4 at phone width.
9. Rapid tab A then tab B while A is in flight: the page settles per B's
   content and never twitches for A.

## Execution log (2026-09-15, landed as 1.0.0a150)

- The interpretation in this plan (bottom of the loaded content, measured on
  the active `.tab-pane`) was ratified by the author before execution.
- The Bootstrap event order was pinned rather than hedged. `shown.bs.tab`
  fires synchronously inside Bootstrap's capture handler: Tab's completion
  callback defers only when the element it queued on carries `.fade`, and
  that element is the trigger button, which never does (verified in
  `web/node_modules/bootstrap/js/src/tab.js`, `_activate` and
  `_queueCallback`). So within one click the order is always shown, then the
  click bubble, then load completion at least a microtask later. Re-click
  detection therefore uses a same-task `navShown` flag set in the shown
  handler and read by the click listener; the button's `active` class cannot
  serve, because Bootstrap has already flipped it by the time the bubble
  listeners run.
- `anchorNavSettled` grew a third argument `gestureY` so the group-tab token
  can carry gesture-time `scrollY` into a consumption that runs at load
  completion; every other call site takes the default, which is gesture time
  there.
- The `scroll.js` policy comment was updated beyond the single sentence the
  plan named: the navigation-gesture paragraph and the a145/a146 removal
  paragraph both stated the pre-a150 rule as current, and each defect's a150
  answer is now recorded where the removal was.
- No `dev/TODO.md` entry existed for this work, so there was nothing to tick.
- No automated tests were added: the plan's acceptance is the browser
  checklist, and `scroll.js` has no DOM-free surface for the node suite.
- Gates at the bump: `npm test` 136 passed, 0 failed; `uv run pytest` 395
  passed, 4 warnings.
