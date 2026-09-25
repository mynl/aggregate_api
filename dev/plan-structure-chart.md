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
