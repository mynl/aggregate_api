# Plan 1.6.0: the Pentagon's notes move to a readout in the figure's lower left

Status: draft, for review. One step, one bump: **[pentagon-readout]** 1.5.0 to
**1.6.0**.

## Goal

The PnL group's Pentagon leaf explains each node and chip in a paragraph. Today
each paragraph pops up as a Bootstrap tooltip over the figure, next to the node
under the pointer. At the 2026-10-13 demo of the aggregate Loss Lab (aLL) the
author found them too distracting: they cover the very numbers being explained,
and they jump around as the pointer crosses the figure.

After this step the same paragraphs appear in one fixed, quiet **readout** in
the figure's empty lower-left corner. Hovering, focusing or tapping a node or
chip fills it; leaving restores a faint resting hint. Nothing pops up over the
figure.

## Current behavior

* `web/src/charts/pentagon.js`. `pentagonSvg(frame, t)` builds the figure as one
  SVG string. Each of the seven nodes (`place(...)`) and the three chips
  (`wrap(...)`) is a `<g class="pent-node" data-bs-toggle="tooltip"
  title="...">`. The paragraphs are authored inline as `opt.tip` and the
  `wrap` first argument, escaped by `esc()`.
* `mountPentagon(host, levels, onTooltips)` draws the strip, the figure and the
  note, and calls `onTooltips(host)` after each draw so the caller can attach
  tooltips. It is kept free of Bootstrap so it tests under `node --test`.
* `web/src/main.js`, `loadPentagon()` (about line 2663). It passes a callback
  that disposes the previous `bootstrap.Tooltip` instances and creates new ones
  with `container: 'body'`. The docstring and a comment explain why disposal
  matters.
* `noteMarkup(t)` ends the note under the figure with "Hover any node or chip."
* `web/test/pentagon.test.js`. One test counts ten `class="pent-node"`; the
  last test asserts ten non-empty `title="..."` attributes and that a quote
  cannot break out of one.

### The free corner

All in viewBox units (`VIEW_BOX` is `235 78 620 580`, so x runs 235 to 855 and
y 78 to 658):

* The lowest item on the left is the P:Q chip, centered at about (412, 448),
  72 wide and 67 tall, so it ends near x 449 and y 482.
* The dashed arc from capital (357, 296) to gross premium (500, 600) passes
  x 443 at y 480 and x 500 at y 600. Everything left of it below the chip is
  empty.
* Gross premium's disc is at most 40 in radius around (500, 600) and its label
  stack is on the right.

So **x 240 to 398, y 488 to 654** (158 by 166) is clear on every book, since
the vertices are fixed and `R_MAX` caps every disc. That is the readout box.

## The change

### [pentagon-readout] 1.6.0

**1. The readout lives inside the SVG, as a `foreignObject`.** An HTML overlay
positioned over the figure would have to track the SVG's scale by hand. The
figure scales from its 600px floor to its 780px cap and scrolls horizontally
below 600px. A `foreignObject` scales with the figure and wraps text natively,
so the readout keeps its size relative to the labels at every width.

```
export const READOUT = { x: 240, y: 488, w: 158, h: 166 };
```

`pentagonSvg` appends, last:

```
<foreignObject class="pent-readout-fo" x=".." y=".." width=".." height="..">
  <div xmlns="http://www.w3.org/1999/xhtml" class="pent-readout" aria-live="polite">
    <b class="pent-readout-name"></b>
    <span class="pent-readout-text">Hover or tap a node or chip to read what it shows.</span>
  </div>
</foreignObject>
```

The resting hint is exported as `READOUT_REST` so the mount and the test share
one string.

**2. Nodes carry their note as data, not as a tooltip.** On every
`<g class="pent-node">`:

* `data-bs-toggle="tooltip"` and `title` go.
* `data-tip="<paragraph>"` and `data-tip-name="<node name>"` come in, both
  through `esc()`. The name is the node's own label (`capital`, `loss and CV`)
  or the chip's heads (`CoC`, `TLR and LR`, `P:Q`). The `**` stays off the
  name.
* `tabindex="0"`, so keyboard users can reach every node. Bootstrap tooltips on
  an SVG `<g>` never fired on focus, because a `<g>` cannot take focus without
  a `tabindex`.

**3. `mountPentagon` drives the readout itself.** It needs no Bootstrap, so it
stays testable under `node --test` and the `onTooltips` parameter is dropped.
The listeners are attached **once** to `host` and delegate to
`closest('.pent-node')`. `draw()` replaces `host.innerHTML` on every level
change, and delegation means nothing has to be re-wired:

* `pointerover` or `focusin` on a node: write its name and note into the
  readout by `textContent`, so no markup is interpreted. Mark the node
  `is-read`.
* `pointerleave` on the figure, or `focusout` with no node receiving focus:
  restore `READOUT_REST` and clear `is-read`.
* `click` on a node: the same as hover. That is what makes a tap on an iPad
  work, where Bootstrap's hover tooltips are unreliable. A click on the figure
  away from any node restores the rest state.

`is-read` gets one quiet CSS rule (a thin ink stroke on that node's disc or chip
rect). The readout sits far from the node it explains, so this links the two.
Drop it at review if it reads as noise.

**4. `main.js` loses the tooltip wiring.** `loadPentagon()` calls
`mountPentagon(host, payload.levels)`. The `tips` array, the dispose loop and
the comment about `container: 'body'` go, and the docstring's sentence about
attaching Bootstrap tooltips is rewritten to name the readout.

**5. Styles, in `site.css` beside the other `pent-` rules.**

* `.pent-readout`: UI face, about 10.5px in viewBox units, so it renders 10 to
  13px across the figure's width range. Text in `var(--mut)`, no box, or at most
  a hairline top rule in `var(--line-2)`. `overflow: hidden` as a guard.
* `.pent-readout-name`: `var(--ink)`, bold, on its own line.
* Nothing positioned, transformed or given opacity inside the `foreignObject`;
  see Risks.

**6. Trim the two longest notes.** At 10.5px a 158-unit line holds about 28
characters, so the box takes about 9 lines of note plus the name. The assets
note (about 245 characters) and capital (about 230) are near that limit. Cap
every note at 240 characters, enforced by a test, and trim those two:

* assets: "Assets the solvency standard calls for at 1-in-100: a = P + Q, with P the
  technical premium. The one figure you set, through the strip above. Notional:
  nothing is truncated and no default is modeled."
* capital: "Capital behind the book: Q = a − P. The red share is what the cession
  released. It need not grow with the level: a program exhausted in the far
  tail releases less at a remoter standard."

The other eight are unchanged.

**7. The note under the figure** ends "Hover or tap any node or chip; its note
appears at the lower left." in place of "Hover any node or chip."

### Files

* `web/src/charts/pentagon.js`: `READOUT`, `READOUT_REST`, the `foreignObject`,
  the node attributes, the trimmed notes, `mountPentagon` without `onTooltips`,
  `noteMarkup`, and the module header's last paragraph.
* `web/src/main.js`: `loadPentagon()`.
* `web/src/styles/site.css`: `.pent-readout*`, `.pent-node.is-read`.
* `web/test/pentagon.test.js`: see below.
* `CHANGELOG.md`, `pyproject.toml` (1.6.0), `uv.lock`, `dev/TODO.md`.

### Tests (`node --test`)

* Replace "a tooltip with a quote cannot break out of its attribute" with the
  same check on `data-tip=`: ten of them, none empty, a quote stays inside.
* Assert no `data-bs-toggle` and no `title=` remain in the figure.
* Assert every `data-tip` is at most 240 characters.
* Assert the readout box lies inside `VIEW_BOX` and is clear of the fixed
  geometry: its right edge is left of the capital to gross premium arc at its
  top y, its top is below the P:Q chip's bottom, and it does not reach gross
  premium's disc at `R_MAX`. Compute these from `GEOM` and `VERTS`, not from
  literals, so a geometry change fails the test rather than silently colliding.
* Assert the figure carries exactly one `pent-readout` holding `READOUT_REST`.

The DOM wiring in `mountPentagon` is not unit tested, on the same reasoning as
`tip.test.js`: it creates nodes and listens, and testing it would be testing the
DOM. The browser check below covers it.

## Risks

* **Safari and `foreignObject`.** WebKit has long-standing bugs where HTML
  inside a `foreignObject` is drawn in the wrong place when that content is
  positioned, transformed or given opacity. Plain block text with none of those
  renders correctly. Hence the rule in item 5. If the iPad check still shows it
  misplaced, the fallback is SVG `<text>` with `<tspan>` lines broken in JS at a
  fixed character width. That is more code, so it is the fallback, not the
  plan.
* **Losing the native `title`.** Nothing else read it. Screen readers get the
  readout through `aria-live`.

## Acceptance

* `npm test` from `web/` and `uv run pytest` both pass.
* `.\scripts\build-web.ps1` after the commit, then in the browser on a book
  with a program (any library example with reinsurance):
  * No tooltip appears anywhere on the figure.
  * Hovering each of the ten nodes and chips fills the lower-left readout with
    its name and note; leaving the figure restores the hint. Every note fits
    without clipping at the 600px floor and at the 780px cap.
  * Tab walks the nodes and the readout follows focus.
  * Switching solvency level keeps the readout working (delegation survives the
    redraw).
  * On the iPad: tapping a node shows its note in the right place; tapping
    empty figure restores the hint.

## CHANGELOG (draft)

```
## 1.6.0

[Pentagon-Readout] **the Pentagon's notes appear in a fixed readout at the figure's lower left** instead of as tooltips over the figure. Plan `dev/plan-1.6.0-pentagon-readout.md`.

- Hover, focus or tap a node or chip and its note fills the empty lower-left corner; leaving restores a faint hint. Nothing pops up over the numbers any more.
- Tapping works on an iPad, and every node is reachable by Tab.
- The assets and capital notes are shorter so every note fits the box.
```

## Execution log

Executed 2026-10-13 on the author's request ("execute plan/1.6.0-pentagon-readout"), as **1.8.0**.

### Review

* Status read "draft, for review" with no open question; the request was taken as the go-ahead. The one soft item, "drop `is-read` at review if it reads as noise", is kept for the author to judge on the page.
* App only, no library half, and no served payload changes, so no round trip to verify.
* Every symbol and claim checked against 1.7.0: `pentagonSvg`, `place`, `wrap`, `esc`, `noteMarkup`, `mountPentagon(host, levels, onTooltips)`, `loadPentagon()` and its tooltip wiring, `VIEW_BOX`, `GEOM`, `VERTS`, `R_MAX`. The free corner was rechecked by hand: the P:Q chip ends at (449, 482), the capital to gross premium arc passes x 447 at y 488, so the box's right edge at 398 is clear.

### Divergences

1. **[Version-Number] 1.8.0, not 1.6.0.** The DecL help plan landed first as 1.6.0 and 1.7.0. The file name keeps 1.6.0.
2. **[Figure-Role] the `<svg>` is `role="group"`, no longer `role="img"`.** An image role makes its children presentational, which would hide both the focusable nodes and the `aria-live` readout from a screen reader, defeating the plan's own accessibility claim.
3. **[Touch-Leave] leaving the figure restores the hint for a mouse pointer only.** A touch pointer fires `pointerout` the moment the finger lifts, which would wipe the note a tap had just shown. On touch the hint comes back from a tap on empty figure, as the plan already provides. Leaving is detected with a delegated `pointerout` checked against `relatedTarget`, since `pointerleave` does not bubble and the figure is replaced on every redraw.
4. **[Note-Cap-Export] the 240 character cap is exported as `NOTE_MAX`**, so the test and the module share one number, as `READOUT_REST` does. The cap test also runs at a 1-in-100,000 level, since the level is interpolated into the assets note.
5. **[Assets-Note-Level] the trimmed assets note keeps `${levelLabel(t)}`** where the plan's text shows "1-in-100" as an example.
6. **[Focus-Ring] `.pent-node:focus { outline: none }`**, with `is-read` standing in for the focus ring, which an SVG group draws badly. The `is-read` stroke goes on the disc's three shapes (so the wedge's radial edges show in ink too) or the chip's rect.
7. **[Quote-Test] the quote test checks that every `data-tip` attribute is followed by the `>` closing its tag**, which an unescaped quote would break; the old test only counted titles.
8. **[Plan-Stays] this plan stays in `dev/`** until the author says it is done, per the house rule.

### Measurements

* `npm test`: 294 passed (31 in `pentagon.test.js`). `uv run pytest` against 1.0.1 after the bump's re-sync: 506 passed, 11 skipped.
* Headless Edge, the anatomy page's `xpnl Book.PnL` example, PnL ▸ Pentagon: no `.tooltip` in the document; real mouse hovers on assets, capital, P:Q, gross premium and the TLR chip each fill the readout with that name and note and mark that node alone `is-read`; moving off the figure restores the hint; focus and Tab follow; after switching to 1-in-250 the readout starts at rest and hover still works; a click on empty figure restores the hint.
* The longest note uses 118 of the box's 165 units with the figure at its 600px floor and at its 780px cap (the `foreignObject` lays out in viewBox units, so the fit does not depend on scale). The readout's type renders at 13.2px at the cap. The page does not scroll sideways at either width.
* Not run: a real iPad, for WebKit's `foreignObject` placement and the tap behavior. That is the plan's named risk, and it is left for the author.
