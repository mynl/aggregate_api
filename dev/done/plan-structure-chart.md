# Plan: render the `structure` chart (reinsurance program diagram) in the SPA

Status: **unblocked and in execution**, 2026-09-25. The lib plan
`aggregate_REFACTOR/dev/done/plan-reins-structure.md` landed at a349, a350 and
a351, adding the `'structure'` chart, the `'tower'` panel kind, and
`CHART_IR_VERSION` 3. Read that plan first; the design decisions live there and
are not restated. Three rulings taken before any file was touched, and the
divergences from this plan's own text, are in the execution log at the foot.

## Goal

When a build's object carries reinsurance, the SPA offers the new `structure`
chart: gross block, per-occurrence and aggregate towers of layer rectangles
with label stacks, optional Lee curves beside each tower, boundary ticks in
currency. It lives as **Diagram, the first leaf of the Re group**, ahead of
Plot. The API side is intentionally thin: the chart id flows through the
existing chart route and capability plumbing; the work is in the ECharts
translator plus one nav leaf.

## Current behavior

`web/src/charts/chartdoc-to-echarts.js` pins `CHART_IR_VERSION = 2` and
returns `null` for any newer document, so once the lib bumps to 3 the SPA
refuses every chart, not just the new one. It realizes panel kinds `xy`,
`heatmap` and `surface`; there is no rectangle-block rendering.
`capability.py` reports whatever `available_charts` answers, so `'structure'`
appears in build responses automatically once the lib lands; the SPA chart
menu then shows an entry it cannot draw.

The Re group in `web/src/nav.js` reads Plot | Summary | Stats | Density.
Plot has been first since a55 ("the picture, then the tables that quantify
it"), and `activeLeaf` lands on the first live leaf, so a reinsured
aggregate opens on Plot today.

## The change

- **Bump the pin**: `CHART_IR_VERSION = 3` in `chartdoc-to-echarts.js`, in
  the same version as the lib floor moves (the editable path source means the
  sibling checkout advancing is the floor; note it in the CHANGELOG entry).
- **Translate `'tower'` panels**: a new branch rendering
  `doc.blocks` for the panel as an ECharts `custom` series of rectangles.
  Per block: fill by role (`layer`, `retention` grey, `co_participation`
  hatched or muted, `gap` transparent with a border, `gross` neutral),
  `open_top` drawn without a top edge. The block's `label` draws centered
  when the rectangle is large enough; the full `label_lines` stack always
  goes in the tooltip, which is the SPA's advantage over the static render.
- **Marks**: the tower panel's horizontal marks become the currency-labeled
  boundary ticks on the loss axis; `faint` marks (the tower-to-Lee joining
  rules) draw as hairlines. Reuse the existing mark translation if it fits;
  extend it only where the tower panel needs labels-as-ticks.
- **Layout**: tower panels narrow, Lee panels wide (the 1:2 ratio of the
  prior art), sharing the loss axis per the document's axis ids. The Lee
  panels are ordinary `xy` and need no translator work.
- **Panel toggles**: the tower panel offers no log toggle on the share axis
  (it is not a quantity); the loss axis honors the document's declared
  scales as usual.
- **Diagram leaf, first in the Re group** (author's ruling, 2026-09-25):
  the row becomes Diagram | Plot | Summary | Stats | Density. New leaf in
  `nav.js` with key `diagram`, label `Diagram`, `chart: 'structure'`,
  `why: 'needs a cession; add one below'`, and a hint along the lines of
  `'the program as a tower: layers, shares, retention'`. Diagram leads
  because it answers "what is the program" before Plot answers "what does
  it do", and because the Re group's whole point is the entry box below the
  row: the tower is the most legible confirmation that a just-typed cession
  means what was intended. This deliberately changes the a55 landing
  behavior: `activeLeaf` now lands a reinsured aggregate on Diagram, not
  Plot. Update the group's Plot-first comment in `nav.js` to record the new
  order and reasoning; the a55 rationale (picture before tables) survives,
  Diagram is also a picture. Availability rides the leaf's `chart` key like
  Plot's: live exactly when capability lists `'structure'`, dark with the
  standard `why` otherwise. Verify a P&L object routes to its engine's
  chart exactly as `reins` does today.

## Files

- `web/src/charts/chartdoc-to-echarts.js`: version pin, tower branch, mark
  handling.
- `web/src/charts/mount.js`: only if panel layout hints need plumbing.
- `web/src/nav.js`: the Diagram leaf, first in the Re group; updated group
  comment. `dev/scripts/check-nav.mjs` if it asserts the leaf roster.
- `tests/test_capability.py` fixtures and `dev/scripts/capture-capability.py`
  captures: `'structure'` joins the expected chart lists for reinsured
  objects.
- `web/test/`: translator unit tests (see acceptance).
- `pyproject.toml`, `CHANGELOG.md`, `uv.lock`: version bump per the release
  workflow; rebuild the SPA and re-sync at the bump as the housekeeping
  rules require.

## Acceptance

- A fixture `ChartDoc` (ir_version 3, one occ tower + Lee pair, one agg
  tower, blocks with every role, an open-top block, boundary marks)
  translates to an option whose rect coordinates and tick labels are
  asserted in a `web/test` unit test; no live server needed.
- An ir_version 3 document with **no** blocks (any pre-existing chart after
  the lib bump) still translates: proves the pin bump did not regress the
  existing kinds.
- In the running app against a reinsured example (occurrence and aggregate
  program), the Re group opens on Diagram and renders towers with
  retention, layer labels, tooltip stacks, and boundary ticks; the row
  reads Diagram | Plot | Summary | Stats | Density. A gross-only program
  shows the Re group with every leaf dark and the entry box as its
  content, exactly as today.
- Capability capture matches: reinsured objects list `'structure'`,
  un-reinsured do not.

## Execution log

Phases, one bump each: `[Tower-Panel]` (the pin and the translator),
`[Diagram-Leaf]` (the navigation), `[Structure-Lee]` (the route parameters and
the control that reaches the Lee curves). The plan describes one change; it is
split because each of the three is independently useful, independently
testable, and `[Tower-Panel]` alone closes the window in which the SPA draws no
charts at all.

### Rulings taken at execution, 2026-09-25

Three of the plan's premises did not survive review against `1.0.0a151` and the
landed library. The author ruled on each before any file was touched.

- **The route grows a `lee` parameter.** The plan's goal and its layout bullet
  both assume Lee curves beside each tower, and `lee` is an *emitter* argument:
  the chart route passes `window`, `detail` and `encoding` and nothing else, so
  `structure` would always have arrived as towers alone and the Lee half would
  have been dead code. The author ruled for the parameter rather than for
  dropping the curves, which is what `[Structure-Lee]` is.
- **The layout is real work, and it is not in `mount.js`.** The plan calls the
  app side "the ECharts translator plus one nav leaf" and names `mount.js`
  "only if panel layout hints need plumbing". Layout is `panelLayout` and
  `documentLayout` in the adapter, it places at most two panels per row at
  uniform width, and it has no notion of a ratio, so a three panel structure
  document drew **Gross | Per occurrence** over **In the aggregate**, which is
  a row break through the middle of the picture. The author ruled for per panel
  width ratios and a single row.
- **A reinsured P&L lights the Re group, and keeps it.** `chart_structure` is
  registered for `PnL`, so the `xpnl` fixture now answers `['pnl', 'structure']`
  and the Diagram leaf goes live, which makes `groupAvailable('reinsurance')`
  true for a P&L for the first time. The plan's line "verify a P&L routes to
  its engine's chart exactly as `reins` does today" reads as though this were
  the status quo; it is not, `chart_reins` is Aggregate only. The author ruled
  to keep it: the diagram is the most useful thing a reinsured P&L can say
  about its program, and the Quick Re box below the row already greys itself
  with "a cession applies to an aggregate".

### Divergences

- **The plan's file list is short by five.** `web/src/main.js` needs the
  `'reinsurance:diagram'` LOADERS row, or `check-nav.mjs` fails and the pill
  lights and does nothing. `dev/scripts/smoke-charts.mjs` and
  `tests/test_objects.py` each carry the IR version as a literal.
  `dev/scripts/check-nav.mjs` carries the leaf roster twice. Both fixture
  captures regenerate.
- **`dev/fixtures/capability.json` was stale beyond this change**: the live
  library already answers `approximation_tails` on an aggregate, which the
  capture predates. It arrives in the `[Diagram-Leaf]` recapture and is nothing
  to do with the tower.
- **The zoom out was being offered on every tower panel and did nothing.** Both
  tower axes declare `full_range`, and the emitter sets it equal to
  `suggested_range`, so `smoke-charts` failed with "full range is offered but
  neither window widened". `readings` now gates the offer on the extent
  actually reaching past the window, which is the honest form of the same rule
  every other control keeps.
- **The realization control was being offered on a mixed document.** `readings`
  collected kinds across panels, so a structure document with Lee curves
  answered `['tower', 'xy']` and offered a document wide switch with no word
  for itself. It now collects only where one panel declares more than one kind.
- **Marks on a tower realize as axis ticks, not markLines.** The plan says the
  marks become "currency-labeled boundary ticks on the loss axis", which is
  what `_render_tower_panel` does, and it is the right picture: the block edges
  already draw at every boundary, so a dashed rule on top of each would be the
  same fact in ink twice. `smoke-charts`' mark accounting learned the second
  realization, counting distinct tick positions per tower panel and markLine
  entries everywhere else.
- **No hatching.** Matplotlib hatches `co_participation` and `gap`; a custom
  series renders through zrender, which has no hatch, and a fan of clipped
  diagonals is a lot of geometry for a texture. The dashed edge and the
  tooltip's role line carry it instead.
- **A tower's width follows its height, not the free space.** Dividing the row
  among the ratios alone gave three towers 401 pixels wide and 260 tall in a
  980 pixel pane, which is not a tower. One ratio unit is `1.75 / 4.41` of the
  row height, which is `_chartdoc`'s own figure arithmetic, capped by what the
  row can afford. There is deliberately no floor on the width: a floor the row
  cannot afford is an overflow, and five panels at 980 hit one and ran off the
  right edge.

### Landed

- a152 `[Tower-Panel]`: `CHART_IR_VERSION` 3, `towerPanel` in
  `chartdoc-to-echarts.js`, the one row ratio layout, the two `readings` gates,
  the harness literals, `web/test/tower-panel.test.js`, fixtures regenerated.
- a153 `[Diagram-Leaf]`: the leaf at the head of the Re group in `nav.js`, its
  LOADERS row in `main.js`, the `check-nav.mjs` expectations including the
  reinsured P&L, and `test_the_structure_chart_tracks_a_cession`.
  `loadReinsPlot` became `loadReinsChart(chart)` rather than being copied: the
  two chart leaves in that group differ only in the name they mount.
- a154 `[Structure-Lee]`: `lee` and `annotate` on the chart route, in the
  option builder, the 422 message and the chart cache key; `leeWith` and the
  `lee` branch of `chartParamsFor` in `request-params.js`; the `quantiles`
  button in the control strip, beside the grid window box and on the same
  refetch hook, which is renamed `onRefetch` since it now serves two controls.

Three further divergences, all found while replaying the mixed document:

- **The refetch did not rebuild the control strip.** Harmless for the window
  box, whose panel set never moves, and wrong for the Lee toggle, which adds a
  panel per cession stage. Rebuilt when the panel count moved, and only then:
  an unconditional rebuild tears focus out of the number box the reader is
  still typing in.
- **The smoke harness asked the wrong reading about the zoom out.** A Lee panel
  beside a tower shares the tower's loss axis, which has nothing to open, while
  its paired return period runs from 10^4 to the 10^9 cap, so the button is
  legitimately offered and the plain reading is the one place it does nothing.
  The check now composes the panel's other readings, which is what the log
  check beside it already did and for the same stated reason.
- **`capture_fixtures.py` captures a `lee` variant.** Nothing in the fixture
  set was a document of more than one panel kind, so the harness had no way to
  see a tower and a curve in one picture. The two-stage case, two towers and
  two curves, is covered by the hand-written document in
  `web/test/tower-panel.test.js` rather than by another 46 MB of capture.

### a155, after the author eyeballed it

Three defects came back from first use, all of them the library's loss window,
and all three were specified in `aggregate`'s `dev/done/plan-tower-window.md`
and landed there at a352 and a353. This side consumed them at a155 along with
its own half of the log reading. Four divergences from what that plan's
companion section anticipated, each found by a gate rather than by reading:

- **`decadeFloor` had the same exact-decade defect the library's
  `_decade_floor` did**, and the smoke harness caught it on the first run after
  the re-sync: a gross panel holding one slab from 0 to 1000 has exactly one
  positive coordinate, so the floor came back as 1000 and the window collapsed
  to `[1000, 1000]`. Now the decade strictly under, which is what the
  docstring already claimed.
- **The floor is threaded through `ctx`, so `xyPanel` takes it too.** The plan's
  companion note said the SPA needed a per-axis floor; it did not say the Lee
  panel is the panel that most needs it, since its own series would floor three
  decades lower than the tower it sits beside.
- **`log y` had to become an axis reading rather than a panel reading**, which
  the library has no analogue of because matplotlib takes one `log` for the
  whole figure. Pressed on one panel of a shared axis it drew the same loss at
  two heights. Offered once per axis now, on the stage tower, which also
  disposes of the duplicate button two towers on one axis would otherwise
  show.
- **The smoke harness's per-panel isolation rule needed the same exception.**
  a121's rule is that a reading moves nothing but its own panel; a tower
  document shares a quantity axis by construction, so the assertion is now that
  a reading must not move a panel on a *different* axis.

The torn top edge landed here too, held back from a152 deliberately: until the
library's a352 the window cropped nearly every gross slab, so nearly every
block was open and a tear would have meant nothing.

### The Lee curve's default reading: closed, 2026-09-26

Raised at a154 and again at a155, and **ruled: the curve stays on the
non-exceeding probability.** The proposal was to have the emitter name the
return-period axis as the panel's own, on the reading that the lib plan's
stated point of the curve is that "every attachment reads off as a return
period". The author's answer is that the Re pane is geared around setting limit
and attachment **by probability** rather than by return period, and that the
reciprocal is arithmetic most readers do in their heads, so the probability is
the coordinate the rest of the tab already works in.

This closes the item with **nothing owed upstream**: probability is what
`_emit_structure` already names as the Lee panel's `x_axis`, so the shipped
default is the ruled one. The return-period axis stays declared and paired, and
a reader who wants it can still reach it from any other Lee panel in the app;
it is only the structure chart's companion that offers no switch, per the a155
rule that a companion panel carries no readings of its own.

### a156, the log switch on `Capstone.PnL`

Reported as "the log button drives the Lee chart on agg but not occ", and the
a155 coupling was not the fault. **A companion panel offers no controls, and
was still honoring a reading stored against it.** Between library a352 and app
a155 the shipped bundle offered `log y` on every panel of a structure document,
since the loss axis had just begun declaring the scale; readings are held per
browser, so pressing it on a Lee panel in that window left that panel stuck on
log with nothing able to clear it. The tower's own button then appeared inert
because the companion was already where it would have put it, and the untouched
stage behaved correctly, which is the whole of the reported asymmetry.

Reproduced before changing anything, by resolving the document with
`{panels: {occ_lee: {logY: true}}}` held: `occ_lee=log` with `occ=value`
beside it. The fix is to drop a companion's stored blob rather than merge it,
so the reading resolves from the axis and nowhere else, which also heals a
browser already holding one.

The second half is presentational and was the other reason it read as broken:
a tower document shows one control group per cession stage, and the strip
labeled a group only when stacked, so side by side they were two identical
unlabeled pairs of buttons. Titled by the **axis** now, since that is what the
group acts on.

### Left for the author

The chart has not been eyeballed, on either scale. Every gate is green, both
suites and both harnesses, and the smoke test's own header says what that is
worth: it proves the document reached the renderer in a drawable shape, not
that the picture looks right. The things most likely to want a tweak:

- **The tower width.** One ratio unit is `1.75 / 4.41` of the row height,
  `_chartdoc`'s figure arithmetic, capped by what the row can afford.
- **The label point size**, 10 CSS pixels, with the fits or does not fit
  arithmetic hanging off it.
- **The boundary ticks**, axis ticks as they are now, or labeled rules on the
  plot.
- **The torn top edge**, new at a155: `TEAR_W` 9 pixels by `TEAR_H` 4 in
  `chartdoc-to-echarts.js`.
- **The log reading itself**, which is the one nobody has looked at and the one
  the a352 and a353 work was for. Press `log y` on a balanced program, the
  `250 xs 250`, `500 xs 500`, `1000 xs 1000` shape, which is the case where the
  bands should come out close to equal height.
