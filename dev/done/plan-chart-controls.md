# Plan: the chart control strip

Item 1 of the author's GUI round 9 punch list, deferred at the time to its own
plan (`dev/TODO.md`, "GUI round 8 / round 9" block; the analysis is under "Out
of scope" in `dev/plan-ui-round-9.md`).

Target version: **a164** and **a165**, two bumps, see "Landing it" below.

The design is settled and drawn. **`dev/prototypes/chart-strip/graphics-prototypes.html`
is the specification**: open it before reading further. It is a standalone page,
no build step and no server, and its geometry is `panelLayout` transcribed from
the adapter rather than approximated, so what lines up there lines up here. The
four way comparison that produced it is `index.html` beside it, kept as the
record of why the other three were rejected.

### What the author settled, and when

Four rounds of review on the prototype, 2026-09-27 and 2026-09-28. Each of these
is a decision, not a suggestion, and the step implementing it is named:

| settled | step |
|---|---|
| the muted red for a pressed toggle, not the house red | `[tone]` |
| the relief's occasional controls folded behind one menu | `[fold]` |
| the figure controls left aligned, not centered | `[box]` |
| everything below the drawing, legend then panel groups then figure box | `[below]` |
| panel groups at their panel's own grid column | `[align]` |
| the figure box at the drawing's width, not the host's | `[box]` |
| short labels at one width, each spelling itself out on hover | `[short]` |
| `ret prd` rather than `RP` | `[short]` |
| the five grid controls move up to the panel | `[scope]` |
| the legend close under the drawing, a clear step down to the buttons | `[trim]` |
| more vertical space between stacked panel groups | `[stack]` |

Rejected along the way, recorded so they are not reopened by accident: the
centered shrink-wrapped box, the `whole figure` caption, the hairline above the
figure controls, the control band behind each panel group, and `RP`.

---

## 1. What the reader sees today

Every chart mount draws three unenclosed rows above its canvas:

```
[ control strip ]        one group per panel, plus a document group at the right
[ legend / readout ]     the series names, values filling in on hover
[ canvas ]               one ECharts canvas holding every panel's grid
```

Two things are wrong with the first row, one of them a plain bug.

**The panel groups point at the wrong panel.** `.exhibit-group-panel` is
`flex: 1 1 0; justify-content: center` (`web/src/styles/site.css:1454`), so the
groups split the row evenly after the document group has taken its natural
width. The panels are not at even shares: `panelLayout` places them with
`AXIS_LEFT = 64`, `GAP_X = 96`, `PAD_RIGHT = 18`. Measured at a 980px host:

```
panel 0    left  64   width 401     group 0 spans   0..373
panel 1    left 561   width 401     group 1 spans 373..758
```

Group 1 drives the right panel and sits almost entirely over the left one, 188px
from where it belongs. The tower is worse and is the case that settles it: its
panels are 1:2:2 by ratio, so there is no even share to be approximately right
about, and the miss changes with width (`-64, -50, -166` at 980, `-64, -34,
-158` at 1100).

The comment at `site.css:1448` says exact alignment "is not attempted and cannot
be: the strip is a DOM row above a single canvas". The first half is true and the
second is false. `documentLayout(doc, width)` returns every grid's `left` and
`width` in CSS pixels against the same host width the strip measures, and
`chartdoc-to-echarts.js:2268` already draws each panel title at `grids[i].left`.
The number is sitting there.

**The document group is a cluster with nothing to explain it.** It holds
everything that is not a panel reading, sits at the right end of the same row,
and carries no label. On a relief it is ten to twelve controls.

### The second defect, which is not visual

Which group a control lands in is decided by **where its state is stored**, not
by what it changes. `setPanelView(panel.id, ...)` makes it a panel control and
the shared `setView(...)` makes it a figure control. That is an implementation
detail standing in for a design decision, and the relief exposes it: one panel,
so every control in the document group is acting on that panel and nothing else,
yet only the color stretch is drawn as a panel control, because only the color
stretch happens to be held per panel id.

`contours`, `marginals`, `mesh`, `wallGrid` and `cut` all change what that one
grid panel draws. They are panel controls by meaning and document controls by
storage. **This is a latent bug, not only a presentation one**: the first
document with two grid panels will have those five driving the wrong one.

---

## 2. The design

Top to bottom, per figure:

```
the drawing            nothing above it
the legend             close under the drawing it reads
the panel groups       one per panel, at that panel's own grid column
the figure controls    a rounded box the width of the drawing, contents left
                       aligned like everything above them
```

Five independent moves, each of which can be taken or dropped on its own.

| tag | move |
|---|---|
| `[scope]` | the five grid rendering controls become panel controls |
| `[align]` | a panel's group sits at that panel's grid column |
| `[below]` | nothing above the drawing at all |
| `[box]` | figure controls in a rounded box at the drawing's width |
| `[short]` | one width for every toggle, each label spelling itself out on hover |

Plus three smaller rulings: `[fold]`, `[trim]`, `[stack]`, `[tone]`, below.

### Why below rather than above

The apparatus above the chart pushes the drawing down, by a different amount on
every chart, and by the most on the charts carrying the most controls. Distance
from the top of the figure block to the top of the chart, two panel 2-D:

```
            980px   700px   390px
today          58     112     158
the design      0       0       0
```

Every drawing then starts at the same height down the page whatever apparatus it
carries, and no row of toggles stands between the sub-tab row and the picture,
which is where a pressed toggle reads as a third rank of tabs.

### Which control goes where

The rule is **what the control changes**, not where its state lives.

| controls | changes | scope |
|---|---|---|
| log x, log y, full range, return period, reflect, invert, reference lines | what this panel shows | panel, already stored per panel id |
| color stretch | what this panel shows | panel, already stored per panel id |
| contours, marginals, mesh, wall grid, cut | what this grid panel draws | **panel, moving** |
| curves / flat / 3D, lee, window | what is fetched and how it is realized | figure |
| Download, reset, walk, SpaceMouse | what happens to the drawing | figure |

`Download` and `reset` are then the only two controls in every figure box on
every chart, which is a useful check on the rule: they are the only two that are
about the drawing rather than about what it shows.

---

## 3. Steps

### [scope] The five grid controls become panel controls

The behavioral change, and the one worth landing on its own.

**The read side needs no change at all.** `chartdoc-to-echarts.js:2147` already
builds a resolver:

```js
view.forPanel = (id) => {
    const resolved = { ...view, ...PANEL_DEFAULTS,
                       ...(companion ? {} : ((view.panels || {})[id] || {})) };
    ...
};
```

and every panel renderer is already handed the resolved per-panel view:
`xyPanel`, `towerPanel` and `heatmapPanel` all receive `pv = view.forPanel(panel.id)`
(line 2188), and `surfaceOption` opens with `const view = documentView.forPanel(panel.id)`
(line 2868), under a comment stating that resolving there "is the whole of the
per-panel change on this path". The six reading sites
(`chartdoc-to-echarts.js:1964, 2967, 3025, 3063, 3095` and `cutSeries` at 2598)
therefore pick up a per-panel value the moment one is written.

So the work is on the write side, in `mount.js`:

1. In `renderControls`, move the `SURFACE_CONTROLS` loop and the `cut` button
   out of the document group and into the panel group, gated as the color
   stretch already is: on `docPanel.kind === 'surface' || docPanel.kind === 'heatmap'`.
   `SURFACE_CONTROLS` entries with `flat: false` stay gated on the realization
   being `surface`.
2. Their handlers change from `setView({[key]: v})` to
   `setPanelView(panel.id, {[key]: v})`, and their pressed state from
   `view[key]` to `panelView(panel.id)[key]`.
3. **Leave the defaults where they are, at the top level of `VIEW_DEFAULTS`
   (`mount.js:85` to `95`), and do NOT add them to `PANEL_DEFAULTS`.** This is
   load bearing. `forPanel` spreads `...view` then `...PANEL_DEFAULTS` then the
   panel blob, so a key in `PANEL_DEFAULTS` overrides the document level one,
   and a reader's stored top-level choice would be silently reset. Left at the
   top level, the document value is the default for any panel that has not been
   touched and the panel blob overrides it when it has. **No storage migration
   is needed.**
4. `SURFACE_KEYS` (`mount.js:114`) is what `reset` puts back. It must now clear
   those keys from every panel blob as well as from the top level.
5. The two `view.cut` reads in `mount.js` (lines 1514 and 1681, the click-to-cut
   and the walk) become panel scoped. Both already know which panel they are
   acting on, since a relief has one.

### [align] Panel groups at their grid columns

1. `draw()` must publish the layout it actually rendered at, and `renderControls`
   must read that rather than calling `documentLayout` a second time. Two
   independent calls drift by a pixel on odd widths, and the strip would be
   wrong exactly when the renderer was right. Hang the box off the `drawn`
   handle the way `cellReader` and `meshSource` already ride it.
2. `.exhibit-controls` becomes `position: relative; display: flow-root`. The
   `flow-root` is not decoration: with absolutely positioned children and an
   in-flow sibling, a top margin on the sibling collapses through the element and
   moves the whole row instead of the sibling. This cost an hour in the
   prototype.
3. Each `.exhibit-group-panel` gets `position: absolute; top: 0` and an inline
   `left` and `width` from `grids[i]`, left aligned. Its first button's left edge
   is then the panel title's left edge and the y-axis line.
4. The row has no height of its own once its children are absolute. Measure the
   tallest group with `offsetHeight` **synchronously after attachment** and set
   `min-height`. Do not do this on `requestAnimationFrame`: a backgrounded tab
   throttles it to nothing and the page comes up with every group on one line.
   This also bit the prototype.
5. Reposition on resize. The strip is currently rebuilt only when `WIDE_PX` is
   crossed (`mount.js:1722`); it now needs its lefts and widths rewritten on
   every resize, which is a style write and not a rebuild.
6. `.exhibit-group + .exhibit-group { border-left }` comes out. The columns are
   separated by a real `GAP_X` of 96px and the rule has nothing left to say.
7. **The single-panel fold at `mount.js:778` comes out**, with its fifteen line
   comment. It exists because a lone centered group floated away from the strip;
   aligned, a single panel's group sits over its only plot and the special case
   has no case.

### [below] Reorder the block

`draw()` currently appends `tools`, inserts `readout` before `host`, then
`host`. The order becomes `host`, `readout`, `tools`, `figure box`. The readout
node must still be created before the first render so it holds its height from
the first paint, which is why it is built where it is; only where it is
*inserted* changes.

Everything under the drawing takes `AXIS_LEFT` as its left margin, so the
readout's `padding-left` moves from `--tabpad` to the drawing's left edge.

### [box] The figure controls

A new element below the canvas: `background: #fff`, `1px solid var(--line)`,
`border-radius: .5rem`, `padding: .45rem .7rem`, `justify-content: flex-start`,
`margin-top: 1.15rem`.

**Width is the drawing's, not the host's.** From `grids[0].left` to the right
edge of the last panel:

```js
function drawnExtent(box) {
    const left = box.grids[0].left;
    const right = Math.max(...box.grids.map((g) => g.left + g.width));
    return { left, width: right - left };
}
```

Axis furniture is excluded at both ends, and that is the rule rather than a
nudge. The left edge is not zero, so the box does not sit under the y-axis tick
labels. By the same argument the right edge is the last plot area and **not** the
colorbar, which `rightPad` reserves beyond it: a colorbar is the value axis of a
grid panel, the same kind of thing as the tick labels on the left, and it belongs
to its panel. It matters most on a relief, where a square panel clamps at
`SQUARE_MAX = 420` and a host width box would span 496px of white space:

```
               box      host
two panel  64 → 962      980
tower      64 → 941      980
relief     64 → 484      980
```

No label on the box. The border and the exact width say what a caption would
have said, and a caption that has to name what its buttons govern is a caption
admitting the arrangement did not.

### [short] One width, and tooltips that spell themselves out

`min-width: 4.4rem` on `.exhibit-toggle`, which is about what `log x` needs, with
the dropdown toggles and the window box exempted. A floor rather than a fixed
width, so `marginals` and `contours` still fit. The row then reads as a row, and
a cycling button stops changing size as it moves through its modes.

Label changes in `CONTROLS` and `SURFACE_CONTROLS`. Most are not contractions,
they are the word the code already uses:

```
reference lines  -> marks      CONTROLS gates it on `offer: 'marks'` and its own
                               tooltip says "show the marks this panel carries"
SpaceMouse       -> puck       what mount.js calls it in every comment
full range       -> range
wall grid        -> walls
return period    -> ret prd    `RP` was the other candidate and was rejected: it
                               is the only capitalized thing in a row of
                               lowercase and it shows
color: gamma     -> c: gam     the mode is the button's state so it stays visible
cut: total       -> cut: tot   modes become off / cpt / tot / all, one width, so
                               the button stops resizing as it cycles
```

**Every shortened button's `title` opens by spelling the short form out**, then
gives the existing explanation: `ret prd` hovers to "Return period: read this
panel's probability axis as the return period it pairs with...". A label already
carrying a colon takes a full stop instead, or you get "Color: gamma: how value
maps", which nobody can read. Lower the explanation's first letter only when its
second is already lowercase, so an acronym or a `3D` opening survives.
`spellOut()` in the prototype is the implementation.

Buttons whose label was not shortened keep their plain tooltip. Prefixing
`log x` with "Log x:" is noise.

### [fold] The relief's occasional controls

`walk`, the SpaceMouse and the window go behind one `relief... ▾` menu in the
figure box, following the `Download` precedent that is already there. The
realization pair and `reset` stay as plain buttons. This leaves a relief's figure
box at five items.

### [trim] The dead legend band

`hostHeight` adds `LEGEND_H = 24` (`chartdoc-to-echarts.js:774`) for the ECharts
legend. That legend is declared `show: false` (line 2278) and has been drawn by
the readout since a63, so the band is dead in every path. Above the canvas nobody
notices a reserved strip at the bottom of the drawing; below it, that band is the
gap between the x-axis labels and the legend.

Take `LEGEND_H` out of `hostHeight`. Check whether anything else reserved space
against it before deleting the constant.

Then tighten `.chart-readout` to `padding: 0 0 1.25rem` in its new position:
close above, so the legend belongs to the drawing, looser below, so the buttons
read as a different kind of thing. Target, measured in the prototype:

```
x-axis label to legend     5px
legend to the buttons     20px
```

The prototype takes a further 6px of slack past where it draws the axis name.
**Do not carry that 6 over.** It places the name by hand; the real figure is
whatever ECharts leaves under its own `nameGap` and has to be measured in the
app.

### [stack] Below the breakpoint

Under `WIDE_PX` there are no columns to align to and the labeled stack the app
already has is right. Two spacing fixes, which is all the author asked for there:

- `.exhibit-controls-stacked .exhibit-group` padding from `.1rem .7rem` to
  `.6rem 0`. The app's value was written for groups side by side in one row,
  where the vertical part does nothing; stacked, it put the hairline three pixels
  under one panel's buttons and three above the next panel's label.
- the panel label takes a line of its own (`flex: 0 0 100%`), so it reads as the
  heading of its group rather than as the first item in it.

Rule weight is unchanged at `var(--line)`.

### [tone] The pressed toggle

`--chart-on: #935353`, the house red at about a third of the saturation, for
`.exhibit-toggle.active` and `:hover`. The house red is the page's selection
mark: it paints the active tab and the active sub-tab, both a few pixels above
the chart, so a pressed chart toggle in the same red reads as a third rank of
tabs. Resting buttons are unchanged.

---

## 4. Files

| file | what changes |
|---|---|
| `web/src/charts/mount.js` | `renderControls` rebuilt; `draw()` DOM order; the layout published off `drawn`; the resize reposition; `SURFACE_CONTROLS` and `cut` move to the panel; `SURFACE_KEYS` reset; labels and tooltips; the `mount.js:778` fold deleted |
| `web/src/charts/chartdoc-to-echarts.js` | `LEGEND_H` out of `hostHeight`; `documentLayout`/`panelLayout` exported for the strip if not already reachable |
| `web/src/styles/site.css` | `.exhibit-controls` positioning; `.exhibit-group-panel`; the figure box; `.chart-readout` in its new place; the stacked spacing; `--chart-on`; the `border-left` and the `1448` comment deleted |

`.exhibit-rubric` (`site.css:1506`) is dead: nothing has ever written it. Delete
it in this pass or say why it stays.

---

## 5. Acceptance

In the running app, on `port A: agg A 100 claims ...` style builds and a joint
severity:

1. **Alignment.** On the two panel Overview, the tower, and the relief, each
   panel group's first button starts at exactly its panel's left edge, at 390,
   700, 820, 980 and 1100 px. The prototype's miss table is the method: group
   left minus `grids[i].left`, expected 0.
2. **Chart top.** The top of the drawing is the top of the figure block on every
   chart and every width.
3. **The five moved.** On a relief, `contours`, `marginals`, `mesh`, `walls` and
   `cut` sit in the panel group; the figure box holds `relief... ▾`, the
   realization pair, `Download` and `reset`. Pressing `mesh` and reloading keeps
   it pressed. A browser holding a pre-a164 view blob keeps its stored choices.
4. **Box width.** The figure box's left and right edges are the first and last
   plot areas'. On a relief it stops at the plot area and not at the colorbar.
5. **Labels.** Every toggle is at least 4.4rem wide; `ret prd` hovers to a
   tooltip opening "Return period:"; `cut` does not change width as it cycles.
6. **Stacked.** Under 720px, panel labels are on their own line with a clear gap
   either side of the rule, and no control is offered twice.
7. **Nothing regressed.** `reset` still puts back the camera, the readings and
   the zoom; `Download` still writes a PNG matching what is on screen and the
   three meshes on a relief; the walk still runs; `uv run pytest` and
   `npm test` green.

`web/test/` has no coverage of `renderControls`, so 1 to 6 are a browser walk.
Worth adding a unit test for `drawnExtent` and for the label map at least.

---

## 6. Landing it

Two bumps, because they are two different kinds of risk:

- **a164 `[scope]`** on its own. It is behavioral, it touches persisted state,
  and it is the one step that can silently do the wrong thing. Under the current
  layout the five simply appear in the panel group instead of the document
  group, which looks odd and works, so it is a legitimate intermediate.
- **a165** the arrangement: `[align] [below] [box] [short] [fold] [trim]
  [stack] [tone]`. All presentation, all judged in the prototype.

Per the repo's release rules each bump takes one commit carrying source, tests,
`CHANGELOG.md`, this plan, `dev/TODO.md` and `pyproject.toml`, followed by
`uv sync --extra dev` so `/v1/meta` stops reporting the old version, and
`.\scripts\build-web.ps1` since `web/` moves in both.

Tick `dev/TODO.md` "Item 1, the chart control strip" and move this doc to
`dev/done/` when the author says it is done, not when the code lands.

---

## 7. Open, and deliberately not decided here

**The single-panel case is still two enclosures for one subject.** On a relief
the panel group and the figure box both belong to the only panel there is, and
`[scope]` improves that (the box drops to five items, all genuinely figure level)
without removing it. Merging them when `panels.length === 1` was considered and
rejected for now: it is a special case, the layout would change shape between
documents, and it is the `mount.js:778` "one group is not a group" trap wearing
a new hat. Revisit after the author has lived with a165.

**`bs_window` still 500s upstream** (`available_exhibits` offers an exhibit
`build_exhibit` cannot produce, dying on a None frame in `aggregate/_labeled.py`).
Unrelated to this plan, logged in `dev/TODO.md`, noted here only so it is not
mistaken for a regression while walking the acceptance list.

---

## 8. Execution notes

Reviewed and executed 2026-09-28 against a163, both suites green at the baseline (`uv run pytest` 399 passed, `npm test` 157 pass).

### Rulings taken at review time, 2026-09-28

Five questions went to the author before a line was written. The answers, which supersede the plan text where they differ:

| question | ruling |
|---|---|
| the relief is not drawn at `documentLayout`'s grids, so `[box]` and `[align]` have no column to use there | agreed: on the 3-D path the extent runs `AXIS_LEFT` to `width - PAD_RIGHT`, the host minus the same furniture margins. `drawnExtent(box)` stays the rule on the 2-D path |
| `lights`, the sixth `SURFACE_CONTROLS` entry the plan never mentions | **stays in the figure box**, as the least used of the six |
| `panelView` does not fall back to the top level, so the plan's step 2 and step 3 contradict each other | agreed: a resolver mirroring `forPanel` |
| `cut` alone, or the three positions with it | **all four move together** |
| `[trim]` shrinks the relief, since the surface host is `box.hostHeight * 1.4` | keep the relief about the size it is: adjust the factor |

Also ruled: the label map is left to the browser walk rather than extracted for a unit test.

### a164 `[scope]`

Divergences from section 3's `[scope]`, all consequences of the rulings above.

- **Four controls move, not five.** `lights` stays at the document level, so `SURFACE_CONTROLS` gains a `panel` flag per entry rather than splitting into two lists: one place still names the relief's six, and the flag says which side of the line each falls on, the way the existing `flat` flag says which realization offers it. Moved: `contours`, `marginals`, `mesh`, `wallGrid`, and the `cut` button.
- **`gridView(id)` is new**, `{...view, ...panelView(id)}`, which is `forPanel`'s precedence exactly. The plan's step 2 said to read the pressed state off `panelView(panel.id)`, and `panelView` (`mount.js:163`) spreads `PANEL_DEFAULTS` and the panel's blob and **not** the top level. With step 3's ruling that the defaults stay in `VIEW_DEFAULTS`, which is right and stands, the four default-on buttons would have rendered unpressed over a drawing that had them on, until each was clicked once. Every pressed state and every read of a moved key goes through the new resolver.
- **The three cut positions move with the mode.** `cutX`, `cutY` and `cutS` are the same state family and `cutSeries` reads all four off one view object, so splitting them would have left the walk reading a stale mode.
- **A third read site the plan did not name.** Besides `mount.js:1514` and `:1681`, the walk's fast path calls `surfaceCuts(drawn, view)` inside the interval. It now takes `gridView(id)`.
- **`setPanelView` gains a `persist` flag**, defaulting true, because the walk writes twenty positions a second and none of them is a position anybody chose. That is what `setView(patch, false)` was already for.
- **`setWalk` resolves the panel id before it moves the flag.** Returning after `walking = on` would leave the flag set with no interval behind it and the button stuck pressed. Unreachable today, since the walk button only exists on a relief, but the guard is free.
- **`reset` clears `PANEL_GRID_KEYS` from every panel blob**, rather than writing the defaults into them: the top level goes on being the default for an untouched panel, which is the whole of step 3's argument.
- **No storage migration**, as the plan predicted. `chartParamsFor` reads only `windows` and `lee`, and `migrateChartView` needs no new dead key.

### a165, the arrangement

- **`[below]` is two files, not one.** `draw()` never appended `tools`: `mountChart` and `mountChartDoc` build the canvas and the strip and append both, so that is where the order changed. Only the readout's insertion point is in `draw()`, and it moved from before `host` to before `tools`, which puts it between them.
- **`[align]` publishes two derived numbers rather than the layout box.** `option.columns`, one `{left, width}` per panel, and `option.extent`, the drawing's own. Publishing `box` alone would have answered neither question on the 3-D path, where there are no grids to read: `hostExtent(width)` is what the relief answers with, per the review ruling, and its single column is that same extent.
- **`.exhibit-controls-aligned` is a new class** rather than the base rule becoming the aligned form. The stacked branch would otherwise have to undo `position: absolute` on every group, and an override that exists to cancel another override is how these two arrangements drift apart.
- **A group carries its document panel index** in `dataset.panel`. A panel declaring nothing gets no group, so the group list and the column list part company the moment one does, and indexing the columns by position would then place every later group one panel to the left.
- **`[box]` is placed with `margin-left` and `width`**, not absolutely: the figure box is the one in-flow thing in the block and it should push the page down by its own height.
- **`[fold]` holds the controls themselves**, not `dropdown-item` links: the walk keeps its pressed state, the puck keeps its watcher and its greyed reason, and the window keeps being a number box. `data-bs-auto-close="outside"`, because these are live controls rather than one-shot actions: a menu that shut on the press would make stopping a walk a two step gesture and typing a window depth impossible. Bootstrap already declines to close on a click landing in an `input`; this extends it to the two buttons beside it.
- **`[trim]`: `SURFACE_HOST_SCALE` goes 1.4 to 1.47**, per the review ruling, so taking the dead band out of `hostHeight` does not shrink the relief by 34px as a side effect. Measured on `dev/scripts/smoke-charts.mjs`: `bvagg/joint_surface` comes out 664px against 666px before. The prototype's further 6px of slack was **not** carried over, as the plan asked, since the prototype places the axis name by hand.
- **`[short]`: `spellOut` and a `short` field on the control specs**, so the long form stays beside the short one and the tooltip is derived rather than written twice. The cut and the color stretch get label maps (`off / cpt / tot / all`, `c: lin / gam / log`) leaving their stored values untouched.
- **The puck's label is `puck`, and its tooltips are not prefixed.** The plan lists it under `[short]`, but its three titles already open by naming the device, and it sits inside the relief menu one item to a row, so there was nothing for `spellOut` to add and no width to save. The rename stands on the plan's own argument, which is that `puck` is what the module calls it in every comment.
- **`drawnExtent` and `hostExtent` live in `chartdoc-to-echarts.js`**, beside `documentLayout`, and `web/test/chart-extent.test.js` covers them in nine cases. The plan put `drawnExtent` in the mount; the adapter is where the layout it reads lives, and a test importing `mount.js` would be importing the whole browser-side chart stack to assert arithmetic.
- **`.exhibit-rubric` is deleted**, as the plan asked: nothing on any path ever wrote one.
- **`.exhibit-controls` comes out of the shared `padding-left: var(--tabpad)` rule.** Absolutely positioned children measure from the padding box, so the indent had become a silent no-op, and the block under the drawing takes its left margin from the drawing instead.

### a166, the first kick of the tires

Three reports from the author on the running a165, all presentation, none of them a change of ruling.

- **`[tone]` overshot.** `#935353` is the house hue at about a third of the saturation, which is what the prototype settled, and in the app it read as a mismatched red rather than a paler one. Washing a red out that far takes it past pink into mauve, and the eye calls that a different color even where the hue is identical. `#bb4747` is `--house` mixed 78% with white, so the two can only ever be the same red with less of it. White text holds at 5.0:1; paler than this the text has to go dark, which is a different design.
- **`[fold]` took one control too many.** The author's report was that the SpaceMouse button had been lost. The puck comes back out as a plain figure control and keeps its long label: it is the one of the three that is reached for before the picture arrives, where the walk and the window are things done to a relief already on screen. `[short]`'s width argument does not reach it either, since it sits at the end of the box beside `Download` and `reset` and the floor width is doing nothing for it.
- **`[short]` went one step too far on the cut.** `cpt` and `tot` name nothing, and the control was reported as no longer cycling. It was: probed against the `bvagg/joint_surface` fixture, the four modes build 20, 30, 30 and 40 series through a per-panel view, exactly as through a document-level one. The labels become `off`, `x,y`, `x+y`, `all`, which say the arithmetic the modes are, and the hover text names the whole cycle rather than spelling out one mode.

### a167, the second kick

- **The click-to-cut gesture loses its cut.** Not a plan step: the behavior predates it, and `mount.js` carried a comment saying so ("changing it is a separate behavior decision"). The author took that decision. `[scope]` is what made it worth taking, since the readout's doubling was the visible symptom: with `cut: all` forced on, the "at cell" line names x, y and the density and the cut's own line names x, y, the total and the density again. With the cut off, `cutSeries` returns empty rows and the clicked cell stands alone.
- **The stacked strip was missing the drawing's left margin.** `placeStrip` set the readout's indent and the figure box's offset in both branches and the groups' lefts in the aligned branch only, so under the breakpoint the buttons sat at the page edge between two things indented to 64. Caught on Approximation, which stacks at every window size because `.plot-half` caps its host at 520px, well under `WIDE_PX`. A single `padding-left` on the row in the stacked branch.

### a172, the third kick: a dead `log x`

Not this plan's doing at all, but found walking its acceptance list, so it is recorded here with the rest. The author reported that `log x` on the right-hand panel of Overview / Plot did nothing.

It did nothing. A sweep of every offered reading, on every panel, of every chart in `dev/fixtures/charts.json`, in all eight combinations of `reflect`, `invert` and the return period, found 18 dead (reading, state) pairs across seven charts. **Every one is a log button, and every one is the same mechanism**: `panelReadings` offers `log` when any member of `positionAxes` admits it, and `positionAxes` is the union of every axis that could occupy the position, while the drawing resolves only the axis that does. On a Lee panel that occupant is the non-exceeding probability, `scales: ["linear"]`, so the offer was made and `axisScale` refused it. Four of the eight readings were dead in the opening state, which is why it read as simply broken.

Nothing else on the strip is affected: `full range`, `reflect`, `ret prd`, `invert` and `marks` change the drawing in every state they are offered in, as do the five grid controls, `lights`, the color stretch and the realization pair.

`full range` shares the same over-broad union (`opens` over `[...x, ...y]`) and no document in the corpus trips it. Worth knowing, not worth pre-emptively changing: the fix would need a document whose `full_range` lives only on a paired axis, and there is none to test against.

### Left for the author

Acceptance 1 through 6 are a browser walk: `web/test/` has no coverage of `renderControls` and the arithmetic behind the placement is what the new test file asserts instead. Item 7's two suites and both harnesses are green.
