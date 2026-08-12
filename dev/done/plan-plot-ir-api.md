# plan-plot-ir-api: plotting via the IR in the api

> **Status: DONE, moved to `dev/done/` 2026-08-12.** Items 2 to 6 and 8
> landed at `a62` and `a63` against library `a244` (all eight emitters). The
> heatmap declaration question resolved at `a76`: the flat reading became a
> control the renderer offers rather than one the document declares, so
> nothing waits on the emitter. The one residue is **item 7.1** (chart
> responsiveness under `dataZoom`, the `filterMode` trade), a judgment that
> needs a browser; tracked in the worktrees `dev-files.md`, "Getting to 1.0".

Getting every chart in the app onto the chart IR, and deleting the two paths
that predate it. Terse for now; each item fleshes out into the plan proper.

> Renamed from `plan-plotting-punchups.md` on 2026-08-09, which was both a poor
> description and a collision with the library's file of that name.
> `aggregate_REFACTOR/dev/plan-plotting-punchups.md` remains, scoped to the
> matplotlib compositors.

## The target, stated once

An object owns the semantics of its own picture. `Object.plot()` builds a
`ChartDoc` and hands it to the matplotlib renderer (`plots/_chartdoc.py`); the
api serves the same document over `GET /v1/objects/{id}/chart/{name}`; the
browser realizes it with ECharts through `chartdoc-to-echarts.js`. One set of
semantic decisions upstream, two renderers downstream, and the app holds nothing
but vocabulary translation and chrome. A need the document cannot express is a
schema change upstream, never a patch here.

Rulings from the author, 2026-08-09, that follow from that and settle the
architecture:

* **The app assumes IR-based charts, always,** and **purist** about it: no
  legacy builder survives the switch. A chart that works because the old path is
  still there is worse than a chart that says it does not exist yet.
* **"The" chart for an object is whatever the library publishes.** The app does
  not get a vote on panel count or panel content.
* **View toggles are part of the document.** Which readings an axis supports is
  a statement about the axis, so it belongs upstream with everything semantic.
* **The document carries both TeX and plain-text labels.** The renderer picks
  one; neither renderer derives the other.

## Status, 2026-08-09 evening: items 2, 3, 4, 5, 6 and 8 landed at api a62

Read this before the survey below, which is a54-era and is kept for its
reasoning rather than for its facts.

**Upstream finished first.** The plan was written against a230 and executed
against **a244**, which ships all eight emitters: `agg`, `port`, `pnl`,
`severity`, `distortion`, `reins`, `envelope` and `joint_surface`. So items 3
and 5 were one adoption pass, and item 4's accepted consequence never happened.

Landed: the 2-D adapter (item 2) with plain labels (item 8); adoption of all
seven documents the app reaches, each app-side builder deleted with it (items 3
and 5); the purist availability rule (item 4); the control strip off the
document (item 6); and 7.3 and 7.5, which fell out of the adapter.

Five things the plan did not know, all found while executing it:

* **`Panel.invertible` and `inverse_title` (a240) are a fourth control family.**
  Item 6 listed three axis readings plus heatmap/surface; `invert` is a panel
  realization and appends after them per the plan's own ordering rule.
* **`primary_chart(obj)` exists upstream** and is exactly the Overview Plot
  leaf's question. It rides on the capability block, and the per-kind table the
  app was going to keep for it is gone.
* **The ladder is chosen from axis units, not series roles.** The library
  renderer settled this and the reason is decisive: a reinsurance series is
  called gross in every panel it appears in, so its role cannot say which panel
  carries mass and which carries probability.
* **Item 7.5 was wrong.** Mark label sides do not come off the document; `Mark`
  carries `panel_id`, `orient`, `at`, `label`, `role`, `faint` and no side. It
  is a renderer decision and stays one.
* **`chart_reins` is Aggregate-only on purpose** (a244, the author's decision
  for 1.0), so `TODO.md`'s `replot` item is answered rather than pending.

Still open, and the only thing this plan is now waiting on:

* **The heatmap declaration.** `chart_joint_surface` declares
  `kinds: ('surface',)`, so the `heatmap | surface` control of items 5 and 6 has
  nothing to read. Per the author, 2026-08-09, the app draws the grid **flat**
  for now while the final 3-D design is settled separately; the flat reading
  comes off the same document, so no app-side builder survives. When the emitter
  declares both kinds the control lights up with no app change beyond deleting
  one special case in `realization()`.
* **Item 7.1 alone**, and it is a judgment rather than a job. 7.2 (double-click
  reset) and 7.4 (the readout in the page) landed at a63; 7.6 landed at a62,
  early, because the strip was being rewritten anyway and centering it was less
  work than reproducing the split layout in order to remove it. 7.1's
  recommended first move, `animationDurationUpdate: 0`, was already in place and
  had been since the exhibits landed (`baseOption()` sets `animation: false`),
  so the tween was never the cause and the only remaining lever is
  `dataZoom.filterMode`. That trade needs a browser, not a guess.

## Where we actually are (2026-08-09)

Three pipelines run side by side.

1. **Server-rendered matplotlib image.** `GET /v1/objects/{id}/plot` calls
   `obj.plot()` and ships SVG/PNG (`plotting.py`, `routes/objects.py:2281`). Its
   only consumer in the SPA is the plot-download button (`main.js:2042`). Also
   the mechanism behind the Bounds envelope figure, through `bounds.py`.
   **Old school. Goes (item 1).**
2. **The app builds the chart itself from frames.** `twoPanelData`
   (`exhibits.js:862`) is the app-side de facto IR: it takes `density_df` /
   `unit_density_df` / `tail_df` / `reins_density_df` and resolves curves, the x
   window, scales, floors, verticals and label sides before any ECharts key
   exists. It is what draws Overview Plot and Reinsurance Plot, and it is
   precisely the thing the library's IR replaces: **it becomes whatever the
   object emits.** The distortion and heatmap builders sit beside it.
   **All of it goes (items 3, 4, 5).**
3. **The chart IR.** Emitter to `/chart/{name}` to `chartdocToEcharts`. Wired
   for `joint_surface` and nothing else. **Correct, and one chart wide.**

Library side there are four converted charts (`joint_surface` a199, `distortion`
a202, `reins` a210, `severity` a212), schema v1 signed off. App side we have
adopted one of the four.

### Update, 2026-08-09 (a230 upstream, found at api a54)

Two things landed upstream while this plan was being written, and both change
what is blocked. Found by the api's own test suite going red on `main`, not by
reading the library's changelog, which is worth noting: nothing here watches
upstream, so the next such move will be found the same way.

**`chart_agg` has shipped.** A plain aggregate now answers `available_charts ==
['agg']`, and the document is the two-panel family: `density` (probability mass)
and `lee` (the quantile plot), both `kind: 'xy'`, with `marks`, per-axis `unit`,
and a `meta` of `{'ordinate': 'mass', 'return_period_map': 'complement'}`. That
is **item 4's blocker gone**: the purist switch was waiting on this and on
nothing else, so item 4 and item 6 can now land whenever the app's 2-D adapter
is ready, and the critical path is item 2 alone.

**Item 6's schema half is done, and it is additive.** The question this plan
left open, whether the toggle declarations would replace `scale` and
`suggested_range` or sit beside them, is answered: they sit beside them, and
`ir_version` stayed at **1**.

* `ChartAxis.scales`, a tuple of the readings the axis admits, with `scale`
  remaining the default reading. `meta['z_log_ok']` is gone, generalized into
  this. So `chartdoc-to-echarts.js:95` loses its special case as predicted.
* `ChartAxis.full_range`, the zoom-out declaration. Presence is the declaration
  and it requires `suggested_range`, exactly the "not every axis has a
  meaningful full x" case this plan raised: a distortion's unit square sets only
  the one.
* `ChartAxis.reciprocal_of`, the return-period pairing, with the map in
  `meta['return_period_map']`. A paired axis sits in `axes` and is named by no
  panel, which is the renderer's cue that it is an alternative reading rather
  than a drawn axis.
* `ChartPanel.kinds`, the realization list, which is where the `heatmap |
  surface` control of item 5 is declared.

Consequences for this plan. The axis walker of item 2 can be written now against
the real declarations rather than against a guess, so the "effective reading"
seam it needed is a function of `(axis, viewState)` returning `{type, min, max}`
off `scales`, `scale`, `suggested_range` and `full_range`. And the note under
item 6 about whether this bumps `CHART_IR_VERSION` is settled: it did not, and
the reason is sound, since a consumer that ignores every new field still draws
the default reading correctly.

One caveat learned the hard way at a54: the canonical form **omits a field at
its default**, so an axis drawn on linear carries no `scale` key at all. The
adapter must read it as `axis.scale ?? 'linear'`, never as `axis.scale`.

### Correction, same day (a238 upstream, found at api a57)

`CHART_IR_VERSION` **is now 2**, so the paragraph above is right about the
toggle declarations and wrong about the version staying put. The bump is for a
different change and the library's own rule for when to bump is worth quoting,
because it is the rule this plan should read the next one against: the version
moves when a reader that ignores what it does not know would draw something
*wrong*, never merely for a new field.

**Version 2 is `ChartSeries.x_lattice` and `y_lattice`**: a coordinate carried
as `(start, step, count)` instead of every value spelled out. An old reader sees
a series with no coordinates and draws nothing, which is the wrong-drawing case,
so the version moves and an old reader can refuse by name.

Measured across every shipped emitter, which matters for sequencing:

| chart | coordinate form |
|---|---|
| `joint_surface` | explicit `surface` grid, no lattice |
| `agg` | `x_lattice` + `y` on the density panel, `x` + `y_lattice` on the Lee panel |
| `reins` | `x_lattice` + `y`, all three series, both panels |
| `severity`, `distortion` | explicit `x` + `y` |

Two consequences. **Nothing in the app is broken today**, because the only chart
the adapter realizes is the surface and it carries no lattice, so the running
3-D view is unaffected. And **item 2 must expand lattices as its first job**,
not as a refinement: the two charts this plan calls the critical path are
exactly the two that use them, so an adapter that reads only `x` and `y` draws
an empty panel for `chart_agg` and `chart_reins` and would look like a data bug
rather than a missing feature. Expansion is `start + i * step` for `count`
points, and the array form must stay supported, since half the emitters still
use it.

Also worth carrying into item 2: every series now declares `support`, and both
panels of `chart_agg` declare `kinds: ['xy']`.

## Items

### 1. Delete the server-rendered figure route — **done at api a60**

Landed early, together with the bounds half of item 5 and the first slice of
item 2, because upstream a239 removed the `plot_envelope` keyword `bounds.py`
was passing and there was no sense repairing a route about to be deleted.
`plotting.py`, the `/plot` route, `plot_default_format` and `api.plotUrl` are
gone; the download button exports the live chart through `getDataURL`; the
envelope is served as a document and drawn by the new 2-D path. Matplotlib is
no longer imported anywhere in the api. It remains *installed*, since
`aggregate` depends on it, which is the one thing the note below got wrong.

The original item, kept for the reasoning:


**Settled: delete, and ECharts exports the picture client side.**

* `src/aggregate_api/plotting.py` deletes whole, `render_plot`, the `native`
  path and the four legacy kinds (`density`, `cdf`, `qq`, `kappa`) with it.
* `GET /v1/objects/{id}/plot` deletes (`routes/objects.py:2281`), plus the
  module-docstring route list at `objects.py:28`.
* `api.plotUrl` (`web/src/api.js:152`), the `[data-plot-download]` handler
  (`main.js:2042`) and the button's current wiring in `index.html`.
* `plot_default_format` in `config.py` and the matching `/v1/meta` field
  (`models.py:765`, asserted in `tests/test_meta.py:22`).
* Plot tests in `tests/test_objects.py:281-330`; the incidental
  `client.get(.../plot)` assertions at 779 and 878 need a replacement smoke.
* CLAUDE.md architecture table loses its `plotting.py` row.

**Client-side export replaces it.** The download button stays where it is and
changes what it does: `chart.getDataURL({type: 'png', pixelRatio: 2})` for the
paste-into-Slack case, and the SVG renderer for the vector case. Two properties
the server route never had: the saved image is exactly the one on screen,
including the reader's zoom and toggles, and the export costs no round trip.
ECharts is instantiated per canvas, so the handler needs the live chart instance
rather than an object id; `overviewChart` and `reinsChart` in `main.js` are
already held for `dispose()`.

**Bounds is not an exception, only later.** `bounds.py:38,42` is the other
matplotlib consumer: the envelope figure is server-rendered and shipped as bytes,
and it is an in-page feature rather than a download, so it cannot go in this
item. It goes the same way as every other chart, when its emitter lands (item 5).
Until then `WEB_OVERRIDES` moves into `bounds.py` rather than dying with
`plotting.py`, and matplotlib stays an api dependency. It stops being one the day
the bounds emitter arrives, and that is the last thing holding it.

### 2. Grow the ECharts adapter: the 2-D path — **done at api a62**

The critical path. `chartdocToEcharts` bails to `null` on any panel that is not
`kind: 'surface'` (`chartdoc-to-echarts.js:88`), so no converted chart can be
adopted until this lands. The matplotlib renderer already grew every piece of
this; the adapter has grown none of it.

Needs, all of it already in the schema and exercised by `plot_chartdoc`:

* `xy` panels; multi-panel layout with shared x axes.
* Axes: `scale`, `suggested_range` (the a211 reading, extent of the data inset
  by the renderer's own margin), `unit`, and the label pair from item 8.
* `Mark` realization (orient, at, label, role, faint) and the label-side rule.
* The atomic support ladder from `ChartSeries.support` (`[Chart-Atomic-Support]`,
  a214): stems, then steps, then a plain line, counted in **visible** atoms so a
  zoom re-evaluates, and cumulative functions stepping right-continuously off
  the axis. a53 built this app side against frames; it moves onto the flag.
* Series pairing across panels by **name**, retiring the emission-order
  arithmetic in `linkPanels`.

Note the duplication this closes: a53 built the atom ladder here against frames
and `[Chart-Atomic-Support]` built the same ladder upstream at a214, three days
apart, in two repos. That is the cost of the app holding semantics, and it is
the argument for doing this item before any further chart polish lands here.

**The seam, settled: `chartdoc-to-echarts.js` bifurcates 2-D against 3-D at the
top.** One entry point, two paths under it, no shared realization code below the
split. This plan owns the 2-D path; the surface workstream owns the 3-D path and
handles its own items. The shared skeleton above the split stays small on
purpose: the panel walk, `merge`, and the axis and mark helpers both sides read.

Note the split is by **renderer capability**, not by panel kind. A bivariate
heatmap is a 2-D drawing of the same grid the surface draws in 3-D, so it lands
on the 2-D side of a bifurcation that a kind-based split would put with the
surface. See item 5.

### 3. Adopt the three emitters already shipped upstream — **done at api a62**

The transition to IR-based charts. In the order the library landed them, one app
commit each, each deleting its app-side builder in the **same** commit.

* **distortion** (`chart_distortion`): retires the g(s) builder and its identity
  diagonal.
* **reins** (`chart_reins`): retires `reinsSeries`, the client-side
  `S = max(0, 1 - cumsum)` accumulation, and the triple-selection logic. Closes
  today's oddity where the Reinsurance Plot leaf lights from `available_charts`
  while its drawing comes from a frame. Note `chart_reins` is registered for
  `Aggregate` alone, which is the `replot` item already logged in `TODO.md`.
* **severity** (`chart_severity`): retires the server-side
  `serializers.severity_density_frame` log-spaced sf inversion, which the
  emitter absorbed.

### 4. The availability contract: IR or a plain "not yet" — **done at api a62**

**Settled: purist.** The app loses its fallback drawing path entirely, in one
commit, rather than keeping legacy builders alive on borrowed time. The author's
reason is the right one: a chart that appears to work, but works because the old
pathway is still wired, teaches everyone the wrong thing about where the project
stands.

* Every chart leaf lights from the capability response's `charts` list (already
  a passthrough of `available_charts`, `capability.py:78`).
* A kind with no registered chart greys its pill with a tooltip, and its pane
  shows a plain "not yet implemented" placeholder. Not an error, not an empty
  box, not a spinner.
* As the library converts, leaves light up with no app change beyond the
  adoption commit.

**Accepted consequence:** Overview Plot reads "not yet implemented" for an
aggregate, a portfolio and a pnl from the moment this lands until `chart_agg`,
`chart_port` and `chart_pnl` ship. That is the landing demo, so **the purist
ruling makes `chart_agg` the critical path for the whole app**, not just an item
in the library's queue. Sequence the two sides accordingly: item 2 here can run
in parallel with `chart_agg` upstream, and item 4 lands when they meet.

Charts unaffected, because their emitters exist: the bivariate surface (already
on the IR), and distortion, reins and severity once item 3 lands.

### 5. Adopt the remaining charts as they land upstream — **done at api a62**, bar the heatmap declaration

Three object charts, one second view, and the bounds figure:

* `chart_agg`, `chart_port`, `chart_pnl`, the two-panel family.
* the **bounds envelope**, whose api-side matplotlib rendering (`bounds.py`)
  survives item 1 only because it has no emitter yet. It joins on the same terms
  as everything else, and when it does, `bounds.py` stops rendering, matplotlib
  leaves the api's dependency set, and `WEB_OVERRIDES` goes with it.
* the **bivariate heatmap**, which is not an object kind: it is the flat 2-D
  reading of the same joint density the surface draws in 3-D. **Settled: it is
  an option button, `heatmap | surface`**, taking its place in the control strip
  beside the axis readings (item 6), rather than the hidden WebGL fallback it is
  today (`exhibits.js`, `surfaceReady`). Two consequences: the reader chooses
  the reading rather than discovering which one their hardware allowed, and a
  machine with no WebGL simply has one of the two options disabled with a reason,
  which is the same greying rule as everything else in item 4.

  This one control straddles the item 2 bifurcation, since `heatmap` realizes on
  the 2-D path and `surface` on the 3-D path. It is the single point where the
  two workstreams must agree, and it is a control question rather than a
  realization one, so it belongs here while both realizations stay where they
  are.

When the last one lands, `twoPanelData`, `aggPanelArgs`, `portPanelArgs`,
`sevPanelArgs`, `pnlPanelArgs`, `densityWindow`, `survivalRange`, `gapFree`,
`anchorMarks`, `heatmapData` and `axisNames` all delete, and `exhibits.js` keeps
only geometry, controls, zoom, theme and the per-chart override dicts.

**Settled: the app does not choose the chart.** Whatever the library publishes
is the chart, panel count included. If the Overview should be density plus
exceedance rather than `plot_aggregate`'s density, log density and Lee, that is
a decision made in the emitter, upstream. The app's current design is not lost
in the move: `aggregate_REFACTOR/dev/chart-inventory.md` row 1 documents the
two-panel semantics column by column and is the input `chart_agg` is written
against.

**Panel arrangement is the renderer's job, settled.** The document hands over
panels in a sensible order and says nothing about rows and columns; the renderer
decides whether four panels are 1 by 4 or 2 by 2. So the app owns this and needs
nothing from upstream for it, which is the opposite of what the previous draft
assumed.

What has to change here: `twoPanelBox`, `squareBox` and `PANEL_ASPECT` hardcode
two panels side by side or one square, per kind. They become one layout function
of panel count, each panel's aspect flag (equal-aspect is already a panel-level
field, inventory item D8) and the viewport width, with the same
reserve-before-fetch discipline the current boxes have. The breakpoint rule the
app already uses, side by side when wide and stacked when narrow, generalizes to
the arrangement choice rather than being replaced by it.

### 6. Toggles move into the document — **done at api a62**

**Settled: the IR carries them.** The document declares which readings an axis
supports; the app surfaces a control for each declared reading and holds only
which one the reader picked. The three families, per the author:

1. **log or linear**, per axis.
2. **full or zoomed**, per axis.
3. **probability or return period**, the reciprocal reading of a survival axis.

**Surfacing rule:** a control appears if **any** axis in the document declares
it, and applies to **every** axis that declares it. So one "log y" button, not
one per panel.

A fourth control exists and is not an axis reading: **heatmap or surface**
(item 5), which picks how a grid panel is realized rather than how an axis is
read. It follows the same surfacing rule, declared by the panel instead of by an
axis, and it is the only member of its family.

**Canonical order, left to right:** log/linear, then full/zoom, then p/return,
then heatmap/surface. Fixed as a house rule so the strip does not reorder itself
between charts and a reader's hand learns one layout. Axis readings come before
panel realizations; a later family appends within its group.

Schema notes for the library-side work, mostly promotion of hooks that already
exist rather than new invention:

* Log or linear generalizes `meta['z_log_ok']` from the surface pilot into a
  per-axis declaration of the scales the axis may be read on, with `scale`
  staying as the default reading. `chartdoc-to-echarts.js:95` then stops
  special-casing `z_log_ok`.
* Full or zoomed is already half-expressed: `suggested_range` **is** the zoom.
  What is missing is the statement that the full data extent is a legitimate
  alternative reading, which is not true of every axis (a distortion's unit
  square has no meaningful "full x").
* Probability or return period is J1 from the inventory, resolved as semantic
  and drafted as `ChartAxis.reciprocal_of` naming the paired axis. Present means
  offer the control.

App-side consequences: `logY` and `rightLogY` collapse into one control;
`xFull`, `epMode` and the per-kind `controls` array in `EXHIBITS` all come off
the document; `renderControls` becomes a function of the document rather than of
the kind. The adapter ignores a declared reading it does not recognize rather
than guessing.

Two notes. This is the second deliberate reopening of a signed-off v1 schema
after `[Chart-Atomic-Support]` at a214, so whether it bumps `CHART_IR_VERSION`
is upstream's call and the app reads the version rather than assuming. And
`dev/api-punchlist.md` Punchups II records "log y on rh plot triggers
reshape/draw of left plot; left plot should not move/change": under the
surfacing rule both panels change together **by design**, which resolves that
complaint by answering it differently rather than by fixing it.

### 7. Moved punch items

Moved here from the a30 graph interaction notes (`dev/graphs.md`, deleted once
its content landed here) and from `dev/api-punchlist.md`, which now points here.
Several change shape once the document carries the marks and the toggles. The
surface and heatmap punch items are **not** here: that workstream owns them,
including `api-punchlist.md` Punchups Round 4 item 6.

#### 7.1 Zoom rescales the y axis and that is disorienting — **open, and narrowed at a63**

`dataZoom.filterMode`. Currently `'filter'`, which drops out-of-window points
from the extent calculation so y refits what is visible. That is deliberate:
without it, zooming into a tail leaves a flat line pinned near zero because the
y range still spans the mode.

| value | effect |
|---|---|
| `'filter'` | out-of-window points removed, other axes refit. Current. |
| `'weakFilter'` | drops only points with every dimension outside |
| `'empty'` | out-of-window becomes NaN, other axes still refit |
| `'none'` | window changes, y axis never moves |

`'none'` is the one-word fix and it costs the tail. **Try first, before changing
the mode:** `animationDurationUpdate: 0`. Much of the disorientation is probably
the tween rather than the rescale, since ECharts animates the axis change and the
curve appears to breathe while scrolling. Snapping it makes the same rescale read
as a step. Log y helps too, because whole decades stay put as landmarks.

#### 7.2 Double-click to reset the view — **done at api a63**

Not built in. `chart.getZr().on('dblclick', ...)` catches it anywhere on the
canvas including blank areas (plain `chart.on('dblclick')` only fires on graphic
elements), then `chart.dispatchAction({type: 'dataZoom', start: 0, end: 100})`.

`toolbox.feature.dataZoom` and `toolbox.feature.restore` ship buttons that do
this, but they add a corner cluster, which works against how hard a26 to a29
worked to keep the chrome down. Prefer the gesture.

#### 7.3 Drop the exact end labels on a scaled axis — **done at api a62**

**Settled:** the complaint is the end label, not general thinning. When an axis
is zoomed, its lowest and highest values are exact rather than round, so they
print with more decimals than their neighbors and look silly beside them. They
carry nothing the neighbors do not, so they go: `axisLabel.showMinLabel: false`
and `showMaxLabel: false`, which drop exactly those two labels and leave the
ticks in place.

Applies to every value axis on every chart, so it belongs in the adapter's axis
walker rather than in any override dict.

#### 7.4 The readout goes in the legend, not a floating box — **done at api a63**

The best idea on the list. The author does not want the "rando popup mouse over
box floating around"; uPlot puts values in a fixed strip and that is the model.
Two routes.

**Cheap**: `tooltip.position` accepts a function, so pin the tooltip to a fixed
corner of the panel instead of following the cursor, plus
`alwaysShowContent: true`. Keeps all the existing formatting.

**Right**: `chart.on('updateAxisPointer', ...)`, whose event carries `axesInfo`
with the axis value under the cursor. Look up each series and write into our own
DOM, so the legend strip becomes the readout in normal page text, styled like
the rest of the page. Also fixes a real problem the floating box has at the tail,
where it covers the region being inspected. The legend strip is already there and
mostly empty. a37's per-grid axis reading is the natural thing to build it on.

Prefer the second.

#### 7.5 Reference-line labels sit wrong — **done at api a62**

Mean to the left of its line, 1-in-100 to the left, 1-in-200 to the right, all
flush with the **top** of the plot. Today 1-in-200 renders *above* the plot area.
Under item 6 the marks and their label sides come off the document
(`Mark.label`, and the label-side rule the inventory's J2 settled), so this is
adapter work, not a per-chart patch.

#### 7.6 Center the controls that govern both panels — **done at api a62**

`full x` and `reference lines` govern both panels, so they sit centered under the
pair rather than aligned to one of them. `renderControls` already splits the
strip across the two panels when they are side by side (`exhibits.js:1919`); this
is the third position it needs. Applies exactly as written in the new world,
where item 6 makes every control a both-panels control by construction, so
centered becomes the only layout the strip needs.

### 8. Labels: ECharts takes the plain form — **done at api a62**

**Settled: charts use the document's alternative text rendering, not TeX.** The
document carries both forms (`[Chart-Plain-Text-Names]`, a209, added the
plain-text naming rule and the `ChartDoc.tex` lookup); the adapter reads the
plain one and ignores the TeX. No math renderer in the shell for the charts, no
DOM label overlay, no pre-rendered formula images.

The reasoning behind the ruling, kept because it is the answer to "can ECharts
do TeX" and that question will be asked again. ECharts cannot typeset math
inside its own text components: it draws text to canvas under a limited
rich-text model. It is not literally impossible to get math in, because titles,
axis names and legend entries could be rendered as our own DOM and a rich style
can carry a pre-rendered image. But every route that gets real math costs
positioning we currently get free, and buys little, because the plain form is
not ASCII: Greek, sub and superscript digits, `𝔼`, `≤`, `√` are ordinary
characters, and `ǧ(s)` in `constants.py` already shows the technique. Unicode
carries actuarial axis names honestly. Fractions and big operators do not
belong on an axis label anyway.

Two consequences worth stating. The plain form is now what every reader of a
chart sees, so it is worth care upstream: it is the label, not a fallback. And
the app's math question narrows to the tables alone, which is where it started:
the table walker emits `\(...\)` for page MathJax unless a `katex` object is
passed to `renderTable`, and the SPA loads neither. Nothing sends a `$...$` cell
today, so nothing is broken. That decision is now independent of the charts and
stays in `dev/TODO.md` rather than here.

Adapter work: read the plain label off the document for panel titles, axis names
and series names. That is all item 8 is.

## Order of work: digging from both ends

Both sides start now and meet in the middle. The library digs emitters; the app
digs the 2-D adapter. Neither waits for the other, and the meeting point is
already surveyed, because the schema is signed off and four documents exist
today.

**Information flows one way, library to app.** The library publishes; the app
consumes what it finds. Nothing in this plan asks upstream for anything or
assumes a delivery order there. Where the app needs a chart that does not exist
yet, item 4 says what the reader sees, and that is the whole answer.

### What the app digs, needing nothing from upstream

1. **Item 1.** Delete the matplotlib route, move the export client side.
   Independent of everything else here.
2. **Item 2, the long pole.** The 2-D path in the adapter, built against the
   three documents that already exist rather than against a spec. That is the
   part worth saying twice: **`chart_distortion`, `chart_reins` and
   `chart_severity` ship today**, so the adapter can be written and verified
   against real payloads immediately. Take them in that order, because it is
   also the order of increasing difficulty:
   * **distortion**: one panel, unit square, equal aspect, an identity mark. The
     smallest possible xy realization.
   * **severity**: two panels, shared x, log survival, no marks. Adds
     multi-panel layout and `suggested_range`.
   * **reins**: two panels, multi-series, draw order and roles. Adds series
     pairing by name across panels.

   7.3 (end labels) and 7.5 (mark placement) fall out of this work rather than
   being separate jobs.
3. **Item 3.** Adopt those same three as each one's realization passes, deleting
   its app-side builder in the same commit.
4. **Item 8.** Read the plain label. A few lines, do it inside item 2.
5. **Items 7.1, 7.2, 7.4, 7.6.** Small, independent, and 7.4 (the DOM readout
   strip) is the largest of them. None blocks anything.

By the time the two-panel emitters land, the adapter will have drawn three real
documents and `chart_agg` should be mostly marks and anchors on machinery that
already works.

### Where the two digs meet

**Item 4, the purist switch, plus item 6's control rework.** These land together,
when the app's adapter and the library's `chart_agg` are both ready. That is the
only genuinely coupled moment in the plan, and it is coupled because the app
chose to be purist, not because the architecture demands it.

### Keeping the tunnels aligned

Two mechanisms, both already built, and worth using from the first commit rather
than at the join:

* **Fixtures.** The library has `capture_fixtures.py`; the app has
  `dev/fixtures/` and `dev/scripts/smoke-exhibits.mjs`. Capture a ChartDoc per
  emitter and run the adapter over it in the node smoke test, with no DOM and no
  browser. That is the app's half of the acceptance gate and it works on
  documents from any library version.
* **`CHART_IR_VERSION`.** The app reads it rather than assuming. Item 6's toggle
  declarations may or may not bump it upstream; either way the adapter should
  notice a version it was not written against and say so, rather than silently
  drawing something wrong.

## Outstanding

Nothing on the design side. Every question this plan raised has been answered:
purist (item 4), the library owns the chart (item 5), toggles in the document
(item 6), panel arrangement is the renderer's (item 5), plain labels in ECharts
(item 8), and the 2-D / 3-D bifurcation (item 2).

Two things carried elsewhere rather than closed here:

* **Math in tables**, now independent of the charts. Stays in `dev/TODO.md`.
* **The surface workstream** owns the 3-D path, the `surface` realization, and
  `api-punchlist.md` Punchups Round 4 item 6. The single point of contact is the
  `heatmap | surface` control in item 5.
