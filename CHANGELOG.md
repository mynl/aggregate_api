# Changelog

Running release-notes draft for `aggregate_api`. Newest first. The cadence
mirrors the main `aggregate` project: every plan-based change bumps the
`1.0.0a*` version and adds a section here.

## 1.0.0a41

Coverage, not capability. `aggregate` `1.0.0a206` and `a207` landed the
economic insurer treatments and `economic_waterfall`, and both reached the api
through the generic exhibit routes with no endpoint change, which is the whole
point of that design. What was missing was a fixture to prove it.

`check-exhibits.py` gains an `xpnl` case. The existing `pnl` fixture is a
single group ledger, which correctly declines to serve `economic_waterfall`
(one margin row, no walk to draw), so the flagship exhibit was showing as
absent everywhere in the sweep and nothing exercised it app side. The walk
fixture covers it: the waterfall now reports 6 rows across its two blocks, and
`economic_ratios` shows 7 raw against 10 insurer, the extra block being the
amounts-from-ratios split that keeps one unit per column.

Still clean: every exhibit serves, revalidates, and agrees with the frame
routes wherever the two overlap.

## 1.0.0a40

Keeping step with `aggregate` `1.0.0a204` and `a205`
(`[PnL-Economic-Frames]`, `[Exhibits-Package-Split]`). No new routes; this is
the app catching the library's renames and staying honest about who owns the
capability set.

`_CSV_FRAMES` gains `economic_df` and `economic_ratios_df`. Upstream, a P&L's
`stats_df` now delegates to its wrapped engine and means what it means
everywhere else (the moment store of a book), while the ledger sheet that used
to answer to that name became `economic_df`. Without these two entries the
ledger would have been unreachable from the api until the economics tab lands.
Visible in the sweep: `stats` on a P&L now reads 26 rows raw and 17 insurer,
the ordinary raw-moment drop, where it used to be the ledger's 3.

`check-exhibits.py` reads the exhibit list from `aggregate.exhibits.EXHIBITS`
rather than a literal, so an exhibit landing upstream joins the sweep with no
edit here. It picked up `bs_window` and `tail_behavior` on its own, and reports
clean.

`test_exhibits_capability_listing` no longer pins a literal list of exhibit
names. The library owns the capability set; re-pinning on every upstream
addition would test nothing but our own bookkeeping. It now asserts the route
is a faithful passthrough over a floor of exhibits any aggregate must serve.

## 1.0.0a39

The app side of the business exhibits surface, first slice
(`dev/plan-exhibits.md` in the library repo, `[Exhibits-App-Endpoint]`;
library phases landed there as `1.0.0a200`, `a201` and `a203`). Additive
only: the two routes and the regression sweep. The menu-from-capability
rewrite (`applyKindGating` reading the capability response, the migrated
`ROW_FLAGS` / `FORMATS` / caption deletions) waits until the library's PnL
insurer framing clears its author gate, so nothing is deleted here and the
frame routes are untouched.

### Two exhibit routes

`GET /v1/objects/{oid}/exhibits`: a passthrough of
`aggregate.exhibits.available_exhibits`, `{name, title, perspectives}` per
served exhibit. The library owns the capability set, so a new library
exhibit appears here with zero endpoint changes.

`GET /v1/objects/{oid}/exhibit/{name}?perspective=raw|insurer`: the envelope
`{name, title, perspective, meta, blocks, hash}` with TableDoc canonical
dicts as blocks. Deterministic UTF-8 body; the exhibit hash (sha256 over the
block document hashes) is the ETag under the same revalidation contract as
the table and chart documents. Unknown or unavailable names are a 404
carrying the capability set; unsupported perspectives (insured, reinsurer,
or an unknown string) are a 400.

### `check-exhibits.py`, the sweep

`dev/scripts/check-exhibits.py`, the sibling of `check-frames.py`: sweeps
every exhibit across every buildable kind, asserts the capability and
envelope routes agree, that every envelope is byte deterministic, and that
the INSURER blocks match the frame-document routes row for row where they
cover the same frame (the frame routes already serve the app presentation:
`_drop_raw_moments` on the two stats stores). Clean at capture: the stats
26/17 and reins 35/26 drops line up exactly.

Envelope contract tests join `tests/test_objects.py` (capability listing,
reins gating, ETag / 304, byte determinism, 404 and 400 families). Left
open, deliberately: extending `capture_fixtures.py` to the new envelopes.
Its output file is already named `dev/fixtures/exhibits.json` for the chart
panel fixtures, a vocabulary collision with the new table exhibits that the
author should settle before the file grows a second meaning.

## 1.0.0a38

The app side of the chart-IR surface pilot (`dev/plan-chart-ir.md` in the
library repo, `[Chart-Surface-Pilot]`; library side landed there as
`1.0.0a199`). The bivariate 3-D surface is the first chart whose semantics
live upstream: the app keeps a translator and its chrome, not a rebuild.

### One chart-document route

`GET /v1/objects/{oid}/chart/{name}`: the chart sibling of the
frame-document route. Names resolve through
`aggregate.charts.available_charts`, so a new library emitter appears here
with zero endpoint changes; an unknown or unavailable name is a 404 carrying
the capability set. The body is the document's `canonical_json` bytes and
the stamped content hash is the ETag, same revalidation contract as the
table documents. `api.chartDoc(id, name)` on the client.

### `chartdoc-to-echarts.js`, the generic adapter

One walker from ChartDoc vocabulary to an ECharts option, pure so the node
smoke test exercises it offline. It realizes the 'surface' panel kind today
(the xy family joins as its conversions land upstream) and merges a small
per-chart override dict over the semantic skeleton: `surfaceOverrides` in
`surface.js` carries exactly the renderer-specific chrome (colors, tooltip
dressing, the visualMap ramp and placement, lighting, and the
down-the-diagonal camera). The log-height toggle is honored only when the
document declares `meta.z_log_ok`, because whether a log reading is
meaningful is the emitter's call.

### `surfaceGrid` deletes; the reduction lives upstream

The mass-preserving block-sum to the display grid now happens inside the
library emitter, which also ships both resolved component labels, so the
`axisNames` stats_df hack is unnecessary on the surface path (the heatmap
still uses it until its own conversion). The surface payload arrives display
sized (128 per side) however fine the model grid is, which is dramatically
lighter than the full joint frame the old path reduced client side. The
joint frame is still fetched for the heatmap fallback; a WebGL-less browser,
a failed chunk, or a failed document fetch all still land on a picture.

`capture_fixtures.py` captures the chart document per bvagg fixture and
`smoke-exhibits.mjs` assembles the surface through the adapter plus override
(same mesh invariants as before, plus the document's own: display cells sum
to the joint's mass, axis names resolved upstream). Server contract pinned
in `tests/test_objects.py`: canonical bytes, quoted 12-hex ETag, 304 on
If-None-Match, 404 with the capability set, byte determinism across GETs.

## 1.0.0a37

From `dev/done/plan-a37-quick-hits.md`. The first list written after actually
looking at the exhibits in a browser rather than at the code. Frontend only, but
for one keyword forced by the dependency.

### The tail panel is read by picking a probability

`S(x)` is monotone in loss, so "at S = 0.005, what loss?" has one answer and that
answer is the VaR. Hovering the tail panel now snaps to the survival axis and
reports the loss. The density panel is unchanged and still read by loss, because
a horizontal line crosses a density twice and the lookup has no single answer
there.

Declared **per grid**, not per axis. `axisPointer.triggerTooltip` looks like the
switch for this and is inert: under `type: 'cross'` ECharts supplies the flag
from the tooltip pass and never consults the axis. Each grid is its own
coordinate system, though, and its model carries a `tooltip`, which is what lets
two panels in one chart be read two ways.

### `full x` widens both panels

It only ever widened one. The window went to auto-fit, and the two panels do not
hold the same data: `rightPairs` drops whole entries past the log floor, so the
tail panel fitted a shorter run and the panels stopped sharing an x axis at
exactly the moment the reader asked to see everything. The window is now always
an explicit pair, computed once and given to both. The button moved to the middle
control group to match.

### The tail runs to 1-in-1 billion

`T_MAX` was 1e5, which cut the curve off while it still had shape to show. The
guard against `1 - cumsum` arithmetic dust is unchanged. Axis labels and the
tooltip gained a compact form, since neither could carry ten digits.

### Densities draw as steps again

They were drawing as little pyramids: the risers leaned. Not a `step` setting and
not an ECharts limitation. `step: 'middle'` is applied correctly, and then
`drawSegment` discards any segment under sqrt(0.5) px **without advancing its
`prev` point**, so a point is emitted only once it is ~0.7 px from the last one
emitted. A bucket here is ~0.006 px wide, so the step's horizontal moves were all
culled and the risers lost the base points that made them vertical.

`sampling: 'minmax'` reduces to the min and max per device pixel column before
the path is built, so the riser is drawn and the peak survives rather than being
averaged away, which matters because these peaks are atoms. Zoom still restores
full resolution, since the sampler runs after the dataZoom filter. It is switched
off per series where the data has an interior gap, because ECharts' sampler seeds
each frame from the frame's first point and would discard a frame that opens on
one.

### Keys: history on Ctrl, examples on Ctrl+Shift

Plain up and down are ordinary cursor movement again. They used to walk history
at the buffer edges, and on a one line program every press is at an edge, so
moving the caret silently threw the program away. History is Ctrl+↑/↓ and does
not move the cursor; the example library is Ctrl+Shift+↑/↓ and loads without
building. Both are now documented in the feedback line and the Help panel; the
example nav was an undisclosed Alt- binding.

### Chrome

The hero cards are gone from the top of the page, replaced by a two line lede
(placeholder copy). One hero is still picked at random and built on load, so the
landing page still arrives populated on a different book each visit; the gallery
is to resurface inside the Examples dropdown. Tables got more vertical space, and
both table hosts now share one box, so flipping Static to Interactive no longer
reflows the page under the reader.

### Breaking, from the dependency

`greater-tables` renamed `TableSpec.formats` to `formatters` somewhere in its
1.9.0 to 6.0.0a4 run, which took 13 tests down. a37 follows the rename and
nothing else of that move; catching up with the rest of 6.0 is in `dev/TODO.md`.

## 1.0.0a36

From `dev/done/plan-tidy-and-library.md`. A batch of four: consolidate on
ECharts, load an alternate example library, and drop two bits of chrome.

### ECharts only

a30 shipped Plotly to answer one question, and a30 answered it: "not massive
differences between the two". A second renderer with no question behind it is a
535 kB lazy chunk and a second code path, so it comes out.

Gone: `charts/engine.js`, `charts/plotly-panels.js`, the `draw` control on the
exhibit row, the `plotly.js-gl2d-dist-min` dependency, the `__PLOTLY_VERSION__`
define and its chunk entry, the About panel row, and the parity block in the
smoke test. The bundle drops the 1,599 kB chunk entirely, and
`chunkSizeWarningLimit` comes back from 1600 to 700 now that `echarts-gl` is the
only lazy vendor chunk left.

**`twoPanelData` stays.** It is the split that made the comparison possible, and
it earns its keep regardless: chart decisions are worth reading on their own
rather than interleaved with an ECharts option literal.

### `--library PATH`

Points the Examples dropdown at an alternate `.agg` instead of `aggregate`'s
shipped `library.agg`, so a short library makes a review pass quick. The default
is unchanged.

The plumbing already existed as `AGGAPI_EXAMPLES_FILE`; the flag sets that in the
environment before uvicorn starts, which is what survives `--reload` (the app is
built in a child process and would never see a value poked into this process's
cached `Settings`).

**It fails rather than falling back.** The env var warns and drops back to the
full library when the path is wrong, which is right for a stale setting on a
server and wrong for a flag typed on purpose: silently loading everything is the
exact outcome someone passing `--library` is avoiding. The flag resolves the
path, checks it, and exits naming what it could not read.

### Removed chrome

- The subhead ("Describe an insurance book and get its full loss distribution,
  tail risk, and price.") and its `.subhead` style.
- The Overview's Static / Interactive pill row. a33 put the same preference in
  the header menu, and one preference with two controls on one screen reads as
  two settings. The menu still re-renders the tab, so nothing else moves.

## 1.0.0a35

From `dev/plan-gt2-ir.md`, Stage B of the follow-on. Every table is switchable,
and one fetch feeds both renderers.

### One document per table, not a document and a frame

GT 1.8.0 shipped `irToGridInput(doc)`, which flattens a table document into
CsvGrid's input. So the SPA now fetches **one** `?format=ir` per table and
renders either way from it: the walker draws it, or the adapter derives the
grid's `{columns, records}` from the same bytes. The paired fetch is gone, the
flip costs no round trip, and the two views cannot disagree about a number
because there is only one number.

Bulk frames are untouched: the densities go `FrameResponse` straight to CsvGrid
and never become a document. A document the server truncated is not rendered
either; the SPA sees the note, refetches the whole frame and hands it to the
grid, so nothing shows 500 of 4,096 rows without saying so.

### Fixed: two views of one button showed two different tables

`stats_df` and `reins_stats_df` drop their raw `ex1` / `ex2` / `ex3` moment rows.
That step lived in the JSON route alone, so a portfolio's More > Stats showed
**26 rows static and 17 interactive**, and the `.csv` download exported 26. Three
paths resolved "the frame called X" independently and drifted.

`_CSV_FRAMES` is now a map of name to **callable**, and the CSV and document
routes both go through one `_named_frame`. All three agree at 17 rows, which
changes the CSV download. A test asserts row-count parity for every frame across
four object kinds, which is the invariant that was silently broken rather than
the one instance of it.

### Formats are declared server side

`PRICE_FMT_CODE`, `REINS_PRICE_FMT` and `statFormats` are gone from `main.js`.
A loss ratio is a float, so nothing in the dtype says it reads as a percent;
`tables.FORMATS` says so once, the engine resolves it into the document, and both
views render from that. The strings are the same ones the SPA carried.

### Also

- `include_raw` is the **explicit column list**, not the `'data'` shorthand the
  handoff spec names. `'data'` covers numeric, date and bool columns only, so a
  string data column gets no raw value and `irToGridInput` then throws on the
  whole document. Three Price frames carry one. Reported upstream.
- `api.reinsFrame` is now `api.frameOf`: it was always generic, and it is the
  bulk path for every frame too long to carry as a document.
- Two harnesses kept rather than rewritten each time: `dev/scripts/check-frames.py`
  sweeps every frame across every kind and asserts both routes agree, and
  `dev/scripts/check-adapter.py` proves a document is interchangeable with its
  `FrameResponse` after csv-grid's own cell coercion.
- Losing the walker now costs both views rather than one, so the pane says so
  instead of sitting empty.

## 1.0.0a34

From `dev/plan-gt2-ir.md`, Stage A of the follow-on. The static-table engine
renamed itself, so this lands the rename before anything is built on top of it.

### The package is `greater_tables` again

`greatest_tables` was a working name it carried for a day. It publishes as
**`greater-tables` 6.0**, a major version of the existing package, so the import
goes back to `from greater_tables import ...` and the dependency key with it. Its
checkout folder stays `c:/s/ai/greatest-tables`, deliberately, so the
`[tool.uv.sources]` path is unchanged.

**This is not a revert to the PyPI 5.3 that a32 removed.** It is the same
rewrite, under the name it will publish as. The two generations share an import
name and cannot coexist in one environment, and plain `pip install
greater-tables` still resolves to 5.3 until 6.0.0 ships, so a deploy that misses
the source entry gets 5.3 and dies at import.

Because importing proves nothing (both generations export `GT`), a test asserts
the symbols that exist only in the rewrite: `build`, `canonical_json` and
`IR_VERSION == 1`, plus a major version that is not 5.

### Also

- Engine moves 1.6.1 to **1.9.0**, which brings 1.7.x **spanner rules**: a
  trimmed rule under each labeled column-group header, the booktabs `\cmidrule`
  pattern, made full width in 1.7.1. Visible only on frames with multi-level
  column headers.
- `/v1/meta` `tables_version` and the About panel now read `greater-tables`, and
  a test pins them to each other.

## 1.0.0a33

From `dev/plan-gt2-ir.md`, Stage B. a32 built the pipeline and pointed it at the
Overview; this gives it the whole page and one place to steer it from.

### One switch, in the header menu

> The switch is at the tab level, not the table level, that's too complex. In
> fact we should put it on the hamburger at the top to select one or the other.

So the header dropdown gains a **Tables** section, Static or Interactive, ticked.
It writes the same page-wide preference the Overview's pill row writes, and the
two follow each other because there is only one value to read. Nothing else on
the page grew a control.

### Every table honors it

Overview (summary, tail risk), More (validation, stats, bs window, density),
Reins (per-layer summary, stats, density) and Price (pentagon, calibrated
distortions, the four per-distortion slices, and the reinsurance pricing table
with its parameters).

The gate is the **row count, not a list of frame names**: past 500 rows a frame
stops being a reading experience and stays interactive, which covers the density
frames the author named and anything else that grows. When static is selected and
a frame is over the line, the grid renders and one muted line says why, rather
than the control appearing to do nothing.

### New

- `POST /v1/objects/{id}/price?ir=true` and `.../reins_price?ir=true` return an
  `ir` map of table documents beside the frames. These frames are *computed* by
  the POST, so the generic `frame/{which}` route cannot reach them. The SPA
  always asks, so flipping the view after a pricing run never costs a re-POST.
  Documents are built before `reset_index_safe` flattens the frames, which is
  what keeps `analyze_distortions`'s distortion index as a stub.

### Fixed

- A view listener keyed on a pane would have survived `clearPanes` and redrawn
  the *previous* object's frames on the next flip. Listeners now key on the node
  they created, and a disconnected node prunes them.

## 1.0.0a32

From `dev/plan-gt2-ir.md`, Stage A, implementing the `greatest_tables` handoff
spec in `dev/done/plan-gt2-ir-adoption.md`. The a31 evaluation of `greater_tables` 5.x
concludes and its whole path is replaced.

### The static table is a document now, not markup

The server no longer renders html. It builds a **table document**: `ir_version` 1
JSON carrying dtypes, resolved formats, hierarchy, spans, break depths and flags,
and carrying no widths and no CSS. The browser owns geometry. A walker that ships
inside the same `greatest_tables` install renders it.

The point is not tidiness. Row emphasis used to be stamped onto emitted html by a
positional BeautifulSoup pass, which is fragile in exactly the way that matters:
it silently gave up whenever the row counts disagreed. Emphasis now rides in the
document as `row_flags`, so there is nothing to stamp and nothing to get wrong.

### New

- **`GET /v1/objects/{oid}/frame/{which}?format=ir`**, replacing the a31
  `.html` route and resolving the same `_CSV_FRAMES` names through the same
  `_resolve_frame`. Returns `canonical_json` bytes with `ETag: <doc.hash>` and
  honors `If-None-Match` with a 304. Built from the **DataFrame**, index intact.
- **`GET /v1/assets/{name}`** serves the walker (`gt-render.esm.js`) and its
  stylesheet out of `importlib.resources.files('greatest_tables')`. Serving it
  from the package that emits the documents is what makes version skew between
  the two impossible.
- **`web/src/tables.js`**: lazy-loads the walker on the first static table a
  session draws, and mounts documents into a pane.
- `/v1/meta` gains `tables_version`, shown in the About panel. It is a front-end
  version as much as a backend one, since one install serves both halves.

### Changed

- The Static / Interactive preference is now **page-wide** (`aggapi.tableView`),
  seeded from the old `aggapi.overviewView` so a returning browser keeps its
  choice. Reach is still the Overview in this version; a33 extends it.
- Static falls back to the interactive grid, with a line saying why, when the
  frame is past 500 rows or the walker cannot be loaded. Never an empty pane.
- The pane teardown registry in `grid.js` is generic: anything with `destroy()`
  registers, so the existing `clearGrids` sweep tears down IR tables too and no
  call site had to learn about a second registry.
- Row emphasis uses the IR's own vocabulary rather than reproducing css class
  names. A portfolio's total row is a `total`, a unit's Agg line is that unit's
  `subtotal`, and the capital anchors carry `emphasis`. The anchors keep the
  `#fff7e6` wash they have had since the hand-built exhibit.

### Removed

- `greater-tables`, `tables.render_html`, the `/frame/{which}.html` route,
  `HtmlFrameResponse`, `api.frameHtml`, the `?tables=gt` sticky dev flag,
  `mountStaticTable`, `renderExhibit` and its `.exhibit-table` styles, and the
  `beautifulsoup4` import that existed only for row emphasis.

### Breaking

- **`requires-python` is now `>=3.13`**, up from `>=3.11`. `greatest-tables`
  declares that floor and it is the binding one. Nothing in its source needs
  3.13, so relax it there if 3.11 or 3.12 ever matters here again.

## 1.0.0a31

From `dev/done/plan-greater-tables.md`. A second static-table renderer, alongside
the first, for the same reason a30 added a second chart renderer.

### The argument is structure, not prettiness

`serializers.py` flattens MultiIndex columns to dotted strings and resets the row
index into ordinary data columns. That is right for a grid and lossy for a printed
exhibit: `port.summary_df` and `port.tail_df` both carry a **two level row index**,
so today a unit name is reprinted on all ten of its return-period rows.
`greater_tables` sparsifies it to once per block, and it can only do that where
the real DataFrame still exists, which is server side.

### New

- **`src/aggregate_api/tables.py`**, `render_html(df, *, which, caption)`.
- **`GET /v1/objects/{oid}/frame/{which}.html`**, an exact mirror of the existing
  `.csv` route, resolving the same `_CSV_FRAMES` names through the same
  `_resolve_frame`. Returns `HtmlFrameResponse {which, rows, html}`.
- `greater-tables>=5.3` as a dependency. **No `[tool.uv.sources]` override**: the
  published 5.3.0 is byte identical to the local checkout, so there is nothing to
  co-develop against and the repo stays installable anywhere.

Three constraints, all read out of the source rather than its documentation, and
all load bearing: `tikz` defaults to **True** and would compute LaTeX we discard
on every request; `GT` **raises** above 50 rows rather than warning, and a six
unit portfolio's `tail_df` is 70; its CSS is scoped to `#{df_id}`, a content hash
of the frame, which is what makes the blob safe to inject. A density frame (65,536
rows) is refused with a 422 and stays the grid's job permanently.

### Row emphasis is preserved, not dropped

The premise that it would be lost was wrong, as the author pointed out.
`greater_tables` passes markup in a cell straight through: `core.py` emits
`<td class="...">{c}</td>` with no escaping, and `clean_html_tex` only rewrites
`$...$` into MathJax delimiters.

The design still avoids cell markup. `cast_to_floats` is what earns the number
formatting and the right alignment, so a numeric column carrying `<b>1,234</b>`
would fail the float cast and drop to unformatted left-aligned strings. The
1-in-200 highlight and the bold total are therefore classes on the `<tr>`, added
by a short bs4 pass (already a `greater_tables` dependency) that maps frame rows
to body rows positionally, verified rather than assumed.

### Nothing is deleted, and there is no switch

`renderExhibit` stays and stays the default. The server-rendered table is reached
by a dev flag, `?tables=gt` (and `?tables=native` to go back), sticky per browser,
with **no user-facing control**. The two can be compared on real frames before
either is chosen. The highlight color is deliberately the same `#fff7e6` as the
built-in table, so the comparison is about structure rather than about a different
shade of yellow.

Deferred: the Price tab. `PriceResponse`, `ReinsPriceResponse` and
`PricingResponse` carry *computed* frames from POST endpoints, so the generic
route cannot reach them.

## 1.0.0a30

From `dev/done/plan-plotly-spike.md`. A second renderer, so the question "is it
the library or the charts" can be answered by looking rather than by arguing.

### Why a spike and not a migration

The author is not sold on ECharts (a28). The difficulty is that almost everything
wrong from a26 to a29 was a design error on our side, not something ECharts did:
the wrong rectangle measured, the wrong default orientation, binned data,
conditional steps, labels over the title, a reservation aimed at the wrong layout.
None of those are arguments about a library. So this ships both engines on the
same data, behind a switch, and leaves the judgment to a look.

### One set of decisions, two renderers

The work that makes the comparison worth anything is not the Plotly code, it is
`twoPanelData()`: which curves, over which x-window, on which scales, which
verticals are marked and which way their labels open. That was interleaved with
ECharts option construction; it is now a separate step both renderers read, so
neither can quietly draw a different chart.

Falling out of that: the four two-panel specs gained a `panelArgs` that does the
column picking, `build` is `echartsBuild(panelArgs)`, and `sev` and `pnl` stopped
patching titles onto a built option after the fact. Their wording (`pdf` rather
than `density`, `Downside probability` rather than `Survival`) now lives in the
shared bundle where both engines can read it. `anchorMarks()` returns neutral
`{x, name, faint, align}` and `anchorLineStyle()` does the ECharts dressing.

### The switch

A `draw` group at the right of the exhibit control row, muted rather than primary
because it changes what draws the chart, not what the chart shows. Sticky per
browser. On `sev`, `pnl`, `distortion` and `bvagg` the Plotly button is **greyed
out, not hidden**, per the house rule.

`plotly.js-gl2d-dist-min` sits behind a dynamic import in its own chunk, 535 kB
gzipped, verified absent from `index.html`, so nobody who leaves the default alone
pays for it.

### gl2d, not basic, and the smoke test now checks that

The first cut used `plotly.js-basic-dist-min` (378 kB) with `scattergl` traces.
That bundle registers **bar, pie and scatter only**, so it would have thrown
"invalid trace type" in the browser and nowhere else. Its `scatter` is the SVG
renderer, and since a27 every exhibit carries all 2**16 grid points, so a
portfolio is half a dozen curves of 65,536 points. Asking SVG to draw that would
make Plotly look bad for a reason that has nothing to do with how it draws.
ECharts renders to canvas, so WebGL is the like-for-like choice.

`dev/smoke-exhibits.mjs` now reads the registered trace list out of the shipped
bundle and fails if a figure uses a type that is not in it.

### Parity, asserted

An unfair comparison answers nothing, so the properties a26 to a29 established are
checked on the Plotly figure too: `line.shape: 'hvh'` (its centered step, the same
shape as ECharts' `step: 'middle'`), loss on x in **both** panels, the same
reserved height, the capital anchors present as shapes with labels opening away
from their lines, and one legend entry per unit rather than two (Plotly toggles
per trace, so the tail trace joins its density trace's `legendgroup` and stays out
of the legend).

The mapping most likely to break silently gets its own check: **Plotly log axes
take `range` in exponents**, so handing one 1e-15 where it wants -15 collapses the
axis while looking right in the source. The test round-trips `10 ** range[0]`
against the survival range the shared bundle computed.

## 1.0.0a29

From `dev/done/plan-graph-placeholder.md`. The chart box stops moving, and it says
a graph is coming instead of leaving a hole.

### The reservation was for the wrong exhibit

a28 reserved the chart's height before fetching, which was the right idea aimed at
the wrong rectangle. `reservedHeight(width)` took **only a width** and always
returned the two-panel geometry, but two of the six kinds do not use that layout:

| kind | host 1000 (wide) | host 560 (narrow) |
|---|---|---|
| agg / port / sev / pnl | reserved 347, rendered 347 | reserved 730, rendered 730 |
| distortion | reserved 347, rendered **498** | reserved 730, rendered **498** |
| bvagg | reserved 347, rendered **498** | reserved 730, rendered **478** |

So a distortion or a bivariate shoved the page down 133 to 151 px on a wide screen
and snapped it up 232 to 252 px on a narrow one, every load.

Each exhibit now declares a `layout(width)` returning the geometry **and** the host
height. The mount calls it once before the fetch and hands the same box to
`build()`, which never derives geometry again. Reservation and render cannot
disagree, because there is only one of them. `chartHeight()` and its
`grid.height + top + 52` guess are gone.

Two related leaks closed with it. `reservedHeight` hardcoded the return-period twin
axis, running about 21 px short whenever it was off; it reads `view.rightLogY` now.
And the three square call sites disagreed, the surface declaring `side + 60` while
the others fell through to `side + 78`, so flipping the 3-D toggle resized the box
by 18 px. One `SQUARE_CHROME` constant, declared once.

The bivariate's pads are no longer per renderer. Sizing the surface from its own
narrower pads made `layout` depend on `surfaceReady`, which only turns true once
the lazy chunk lands, so on a narrow screen the box was reserved as a heatmap and
drawn as a surface. A layout that depends on async state cannot be reserved ahead
of that state resolving.

### The skeleton

`showPlaceholder()` fills the reserved box with the exhibit's outline: panels at
the exact grid geometry the chart will use, titles where the chart will put its
own, a centered glyph, a dashed border and a slow shallow pulse (dropped under
`prefers-reduced-motion`). The arriving chart lands on top of its own outline
rather than replacing a differently shaped block. A reserved but empty box says
nothing; this says a graph is coming, and where.

### The control row was the other half of the jump

Reserving the chart perfectly and then rendering the toggle row on arrival pushed
everything down by a button row anyway. The controls depend on the width and the
spec, never on the payload, so they are drawn up front. `redraw()` no-ops until
there is something to draw, so a toggle pressed mid-fetch records the view and is
picked up when the data lands.

`loadStyle()` moved from the two call sites into the mounts, so its round trip also
happens behind the skeleton, and `main.js` no longer juggles `minHeight` around a
guess it should never have been making.

### Verification

`dev/smoke-exhibits.mjs` now asserts `reservedHeight(width, kind)` equals the built
option's `hostHeight` for every kind at both breakpoints. That is the invariant a29
is about, and nothing checked it before because nothing compared the two numbers.

## 1.0.0a28

From `dev/done/plan-exhibit-punchups-5.md`. Third round of exhibit feedback: step
rendering, two capital anchors, the bivariate 3-D surface, reserved space, and the
panel aspect measured on the right rectangle at last.

### Steps everywhere

`step: 'middle'`, matplotlib's `drawstyle='steps-mid'`, on every density series
unconditionally. Every value in the frame is the mass in **one bucket**, not a
sample of a curve, so joining two with a slope draws probability at values between
grid points that carry none. a23 gated this on a count of nonzero points, guessing
at "is this discrete"; the guess was unnecessary, since steps are right for a
coarse grid and right for a fine one. A condition that can only be wrong in one
direction should not be a condition.

### Two anchors, labels inside the panel

`ANCHORS` drops to `[100, 250]`. The pair still spans the regulatory range and the
tooltip gives any other return period, so the third line cost a label slot and
bought nothing.

Labels move to `position: 'insideEndTop'`: inside the plot at the top rather than
above it, where they were landing on the panel title. That fixes the density
panel's `mean` and `1-in-200` lines too. The first anchor's text is right-aligned
and the second's left-aligned, so they open away from each other and cannot
collide however close the two VaRs sit.

### The bivariate 3-D surface

New `web/src/charts/surface.js`: the joint density in relief, with linear and log
height scaling (log the default, since a joint density spans four or five orders
of magnitude and on a linear axis everything but the mode is floor). Dependence
shows as a ridge off the diagonal, which a flat heatmap can only imply.

`echarts-gl` sits behind a **dynamic import** in its own lazy chunk, 165.9 kB
gzipped, absent from `index.html`, so a visitor who never builds a bivariate never
downloads it. The joint grid is block-summed to 128 x 128, not sampled, for the
same reason the heatmap is. Falls back to the heatmap when the chunk fails or
WebGL is missing.

One thing changed after measuring: a zero-mass cell was first sent as `null`, on
the grounds that zero mass is no height rather than a small one. On the real
fixture **41% of the mesh came back as holes**, because an FFT-built bivariate has
large regions of exact zero, and the surface arrived moth-eaten. Zero now rests on
the log floor, one decade below the smallest mass present, so the surface touches
down where the model puts nothing. The tooltip says `< 1e-15` there rather than
reporting the floor as data.

### Reserved space

The chart host's height is computed and set **before** the fetch, so the page no
longer shifts when the density payload lands. Exact rather than a guess: the
geometry is a function of the container width, known immediately.

### The aspect was measured on the wrong rectangle

a26 applied the house `FIG_W / FIG_H` (4:2.8) to the **plot area**, and the chrome
around it made the panel's footprint on the page about **4:3.8**. That is what
read as too tall, and it is why the author's "4:3.25" and "a bit too high" looked
like they pointed opposite ways: 4:3.25 is *flatter* than 4:3.8.

`PANEL_ASPECT = 4 / 3.25` now targets the **footprint** (plot area plus title
strip and axis), with the plot height falling out of it. That is also the fairer
comparison with matplotlib, where `FIG_W x FIG_H` is the whole figure including
margins, not the axes box.

At a 1000 px host: panels 398 x 251, footprint 323, so 1.23, and the exhibit is
347 px tall where it was 375. Stacked at 560 px: 730 px, was 777.

The smoke test now asserts the **footprint** ratio at both breakpoints, which is
the check a26 should have had: it was asserting 1.43 on the plot rectangle and
passing while the visible shape was 1.06. It also asserts every density series is
stepped, and that the surface mesh is complete and has relief.

### Bundle

Eager: app 39.1, bootstrap 24.7, codemirror 114.2, echarts 197.8 kB gzipped. Lazy:
echarts-gl 165.9. The echarts chunk grew 186.1 to 197.8, which is Rollup hoisting
internals now shared with the lazy chunk into the eager one rather than shipping
them twice.

## 1.0.0a27

From `dev/done/plan-exhibit-punchups-4.md`. Second round of author feedback, and
the two questions a26 left open are answered.

### Every point

a26 raised the display grid and kept binning. That improved the picture without
fixing it: an atom in a `bs=1` bucket, binned by 8, is still 8 units wide and
located only to within 4. And detecting atoms to treat them separately is not
possible from the frame, because a tall bucket and a point mass are the same
number. There is no threshold.

`density_df`, `unit_density_df` and `reins_density_df` now default to
`resolution='full'`: every row, unbinned. `resolution='display'` keeps the binned
form and its only caller is the More to Density **table**, where 65,536 rows is
not a reading experience and the CSV download is the exact export anyway.

The payload objection turned out to cost ten minutes rather than a design
compromise, because there was **no compression on the api at all**:

| | rows | raw | gzipped |
|---|---|---|---|
| one aggregate's density (4 cols) | 65,536 | 3.65 MB | **0.35 MB** |
| a 2-unit portfolio's per-unit frame | 65,536 | 6.99 MB | **1.29 MB** |

`GZipMiddleware` at a 1 kB floor. Float text compresses about 10 to 1, so both
land inside what an image costs. Installed before CORS so the stack unwinds with
CORS headers on the outside, where a browser needs them even on a compressed
response.

### Both tail views put loss on x

The right panel no longer transposes. Loss is on x in both modes and the toggle
changes only the y-axis, between `S(x)` and its reciprocal as a return period.
Whichever is not primary is the twin axis on the right, so both readings stay
available without touching the toggle, and following a loss across the two panels
never means swapping axes.

"EP" is gone. In catastrophe modeling EP is a term of art (OEP / AEP) and this is
neither: it is `S(x) = P(X > x)`. The panel says Survival and the axis says
`S(x)`. Every reference line on that panel is now a vertical, since they are all
loss values.

### Reinsurance-aware pricing

`POST /v1/objects/{id}/reins_price`. Calibrate the standard distortion set on one
basis (gross, net of the occurrence program, or the object's own net) and apply
it unchanged to the others, so the spread between them is attributable to the
distribution rather than to two separate fits. The difference between the gross
and the net premium is the implied **allowance for reinsurance in the rate**.

Built entirely on library machinery: `GridDistribution` over a `reins_density_df`
column, `prob_loss_assets` for the `(p, L, a)` anchor, `Pentagon.solve` for the
premium target, `Aggregate.calibrate_distortions` for the fit, `Distortion.price`
to apply it. The one piece of glue is `_BasisView`, which presents a chosen basis
with the surface `calibrate_distortions` reads.

One row per (distortion, basis), the calibrated one starred, plus a difference
row per other basis. `net occ` is offered only when **both** cession stages
exist, so an occurrence-only program gives exactly three rows per distortion. The
difference row differences the levels and **recomputes** the ratios: a difference
of two loss ratios is not a loss ratio, while the loss ratio of the differenced
levels is the rate the cover is being bought at. Each basis takes its own
`a = q(p)`, holding the threshold fixed rather than the capital, because a
reinsured book needs less capital and that saving is part of what the cession
bought.

The Price tab grows a `calibrate on` selector, shown only when the object carries
a cession.

### Smaller items

- **Bivariate More to Density** returns the two component **marginals**
  (`unit / loss / p / F / S`), not the joint matrix. Long rather than wide
  because the two axes have different grids and lengths; aligning them would
  invite comparing row `i` of one against row `i` of the other. The Overview
  heatmap asks for `view='joint'`.
- **Tab persistence.** `has_reins` on the build response greys out the Reins
  pill when there is no cession, instead of opening a pane that says "No
  reinsurance on this object" after you clicked it. The active tab is otherwise
  left where it was.
- **Button shape.** Everything takes `--bs-border-radius`, Bootstrap's own token,
  so the exhibit toggles, the output tabs and the hero cards cannot drift from
  Build and Examples. The pill radius is gone.
- **Banner.** The kicker centers under the title.
- **Hero gallery** retries once and reports. The old single `.catch` covered both
  the fetch and the rendering and swallowed either in silence. The empty-first-
  load the author saw is **not reproduced**: the route answers 200 in ~2 s cold
  and returns all eight, including fired concurrently with `/v1/examples` and
  `/v1/meta` across four cold processes, and the service worker never touches
  `/v1/*`. If it recurs the console now says which half failed.

## 1.0.0a26

From `dev/done/plan-exhibit-punchups-3.md`. Author feedback after the first
visual inspection of the exhibits: resolution, panel shape, orientation, and
where the controls sit. Plus one wrong number the verification turned up.

### The density had lost its atoms

A discretized aggregate is routinely **atomic**, not merely spiky, and the
display grid was destroying that. On the reported program (limits
`250 500 1000 2000 xs 0`, a `750 xs 750` occurrence cession, `log2=16`, `bs=1`)
single buckets at 0 / 250 / 500 / 750 hold 8.6% / 12.9% / 10.0% / 5.7% of the
mass against a continuum of 0.07% per bucket. Layer limits and an occurrence
cession put point masses in the severity; the aggregate inherits them at every
multiple.

At `2**11` display rows the server was summing **32** fine buckets into one, so
the atom at 250 landed in a bucket labeled 256 carrying its 12.9% plus 31
neighbours' worth of continuum, located only to within 16 loss units, and drawn
as a straight line to the next bucket center: a triangle 64 units wide where the
truth is a spine one unit wide.

`DENSITY_DISPLAY_LOG2` goes 11 to 13, under a new **cell budget** rather than a
flat row count. `display_log2_for(n_cols)` keeps the full `2**13` for a narrow
frame and steps down for a wide one, so a Portfolio's per-unit densities
(`2 * units + 3` columns) ship the same number of JSON numbers however many units
there are, instead of scaling with the unit count.

Measured on that program: the peak now stands 23x above its neighbours in an
8-unit bucket, roughly 1.4 px on a 400 px panel. Payload 0.12 MB to 0.46 MB.

Not fixed: the atom still occupies one display bucket rather than being drawn at
its exact loss. Doing that properly means splitting the frame into atoms (exact
loss, stem) and continuum (binned, line). Recorded in `dev/TODO.md`.

### Panels hold the house aspect

`FIG_W` / `FIG_H` from `aggregate.constants` ride along on `/v1/meta/style` with
the colors, and every panel is sized `width / (FIG_W / FIG_H)` from the host
width. Nothing is hardcoded, which was the bug: the stacked layout pinned
`height: 150` against a full-width panel and drew at roughly 3.5:1 against a
house ratio of 1.43:1. The smoke test now asserts the ratio at both breakpoints,
since panel shape is the one property of a rendered chart an offline test can
genuinely verify.

### Exceedance stops being a transpose

Loss on x and exceedance probability on y is now the default; the transposed
return-period view is the toggle. A second y-axis on the right of that panel
reads the same curve as a return period, so `1e-5` and `1-in-100,000` are the
same gridline and the capital question needs no re-orientation. It appears only
against a log probability axis, because `T = 1/p` is log-linear in `p` and on a
linear axis the twin would not line up.

Tracking is now a **cross**: on that panel the y value is the answer, so a
horizontal line reading it off the axis is worth as much as the vertical one.

### Controls sit over the panel they drive

Three groups with rule separators: density controls, the shared reference lines,
then the exceedance-panel controls, pushed into the right half when the panels
are side by side. `log y` becomes two independent toggles, one per panel.

The Overview's Static | Interactive table switch takes the same pill shape in the
code red rather than the primary blue: the same kind of control, steering a
different half of the tab.

### Reinsurance: the frame's own structure

`reins_density_df` is not one gross / ceded / net triple, it is three, read at
different points in the program. The exhibit now asks which: **occurrence** (the
severity views), **after occurrence** (the aggregate of each, where gross is the
true gross aggregate), **after aggregate** (the aggregate cover's subject, ceded
and net). Plus which of the three curves to draw.

The third triple's first column is labeled `subject`, not `gross`, for the reason
the library's own docstring gives: `p_agg_subject` equals the true gross only
when there is no occurrence cover, so calling it gross would quietly understate
the cession whenever both stages are present.

### A gross mean over a net distribution

Found while verifying the density fix, not reported. Under a cession `actual_m`
and `est_m` describe **different random variables**: `actual_m` is the analytic
mean of the subject book, while the density, the percentiles, `summary_df` and
everything plotted are net. The summary bar preferred `actual_m` unconditionally,
so on the reported program it read `mean 12000` directly above a table whose Agg
row said `549.48`, and the exhibit drew its mean reference line off the end of
the axis. A Portfolio has the same problem via its units (1150 against 411).

`_summary_fields` now prefers the realized moments when the object carries a
cession and the analytic ones otherwise, where they are exact. The library was
never wrong here: `validation_description` says "reinsurance; subject not
unreasonable", which is it naming which variable `actual_m` belongs to.

### Smaller things

- Log axes floor at `1e-15`. Below that a survival built by `1 - cumsum` is
  plotting its own accumulated rounding error, and the fringe reads as tail.
- Expand / Contract on a grid now needs **more than 10** columns, was 6. Every
  frame on the Price tab is under that and carried a pair of dead controls.
- Reins moves ahead of Price in the tab bar: you decide what you are keeping
  before you decide what to charge for it.
- The sticky exhibit-view key is `aggapi.exhibitView.v2`. The default
  orientation changed and a toggle was added, so a stored v1 state would have
  restored a view nobody chose.

### Not done

Two of the twelve reported items are open questions rather than work, both put
back to the author: what "better rules for what to plot" refers to, and how to
calibrate a distortion set on the **gross** basis for the reinsurance-aware
pricing table. The latter has no public route today (`calibrate_distortions`
reads the object's own `density_df`, which under reinsurance is the net), and
reproducing `aggregate._pricing._calibration_survival` here would break the
standing rule against copying library internals.

## 1.0.0a25

From `dev/plan-more-tab.md`. The output tabs stop having two different kinds of
control in one bar, Bounds takes its place, and Reins gets the exhibit.

### More is a tab

Overview · Plot · Price · Reins · Bounds · **More**, and More's pane carries a
sub-button row: Validation | Stats | Density | bs window | Info (raw). Exactly
the Reins pattern.

The dropdown it replaces was the one control on the page that behaved
differently from everything around it: a menu nested inside a pill bar, so half
the output views opened like tabs and half like a menu. Five panes collapse into
one, with the per-view hint line and copy button rendered from a small registry
rather than duplicated in the markup.

**Info moved with it**, which changes one thing worth knowing: a *failed* build
used to dump its parse-error report into the Info pane and switch there. A
failed build has no object, so sending the reader into a sub-menu to find out
why was the wrong direction. The error now renders on the landing tab.

### Bounds

A sixth pill, greyed out. The house rule is that the menu set never changes
shape, so what is coming is visible and plainly not ready rather than absent and
unmentioned. Its pane exists and says so.

### The Reins exhibit

The same two-panel instrument, pointed at three views of one book instead of at
the units of a portfolio: **gross, ceded and net** densities on the left and
their exceedance curves on the right, above the per-layer tables. That is the
question a reinsurance structure exists to answer, and until now the tab
answered it only in numbers.

`reins_density_df` carries the masses but no survival column, so `S` is
accumulated from them. Exact, not approximate: each `p_agg_*` column is a pmf
over the same grid and sums to one, so `1 - cumsum` **is** its survival. Clamped
at zero, because accumulating 2,048 floats to 1 overshoots by a few parts in
1e15 and a survival of `-3.6e-15` is not a number to hand a log axis.

The smoke test checks the derived survivals are non-increasing, bounded and
finish at zero. It deliberately does **not** assert they start at 1: the ceded
distribution is small next to the gross, so on a grid scaled for the gross its
whole mass lands in the first display bucket and its survival legitimately
starts at 0. Writing that assertion the obvious way is what found this.

### Gating

Reworked for the new shape. Top-level tabs gate to `price` and `reins`; the
frames that a kind lacks are now sub-views, so they grey out inside More
instead. A sticky sub-view that the current kind cannot answer falls back rather
than firing a request that would 400.

## 1.0.0a24

From `dev/plan-examples-find.md`. The examples menu becomes findable, and the
hero cards show what they build.

### Finding, not remembering

The library is 186 entries. Grouping them by topic was the right successor to
the letter categories, but scrolling nine groups to reach `CatXOLTower` is not
finding, it is remembering where it lives. The author's verdict on a19 was
short: "no filtering on examples yet, right? if there is i don't understand it".

One list component, two surfaces, both fed by the same payload:

- **the dropdown**, grouped by topic, with a search box pinned at the top and
  focused when the menu opens, so it is type-to-find;
- **`Ctrl+K`**, the same rows full width with room for the note on its own line.

Matching is `@leeoniya/ufuzzy` (about 5 kB gzipped) over
`name + kind + tags + note`, so "cat xol", "reins tower" and "ilw" all reach the
same entry, and `intraMode: 1` means "porfolio" and "distorton" still land. Tags
keep their namespace, so `topic:reinsurance` and `reinsurance` both match.

Typing switches both surfaces from grouped to a **flat ranked list**. A search
result is already ordered by relevance and re-grouping it would scatter the best
matches down the page. Once you are searching, the grouping is noise.

Search keystrokes are stopped from reaching Bootstrap's dropdown handler, which
otherwise steals the arrow keys and closes the menu on Escape mid-word.

### Hero cards show their distribution

New `GET /v1/examples/heroes/sparklines`: a peak-normalized 48-point density
silhouette per hero, rendered as a small inline SVG on the card. Shape only, no
axes and no way to read a number off it, which is what a card thumbnail should
promise.

**Deliberately a separate endpoint from `/heroes`, and called after first
paint.** It builds every hero, and one of them (`CatXOLTower`) carries
`hints{log2=16}`, so a cold call costs seconds. Cards mount immediately on their
placeholder gradient and upgrade in place when the payload lands; a hero that
fails to build keeps its gradient. Nothing on the landing path waits on it.

The silhouette **sums** into its buckets rather than sampling every n-th point.
On a spiky discrete support, sampling lands between the atoms and returns a row
of zeros, so a dice book's thumbnail would be a flat line.

### Bundle

The app chunk goes 28.8 to 34.1 kB gzip; the vendor chunks are untouched.

## 1.0.0a23

From `dev/plan-exhibit-punchups-2.md`. The author's second pass on the exhibit,
and a test harness that no longer needs a server.

### A discrete density is drawn as steps

`drawstyle='steps-mid'`, or ECharts' `step: 'middle'`. `agg Dice dfreq [3]
dsev [1:6]` puts mass on sixteen integers, and joining those with a sloped line
draws probability at values that **cannot occur**. For a discrete book the step
plot is not a nicer rendering of the distribution, it is the distribution.

Triggered by counting points that carry mass: at or below 256, steps. The
threshold is generous because the failure is one-sided, steps being honest for
a coarse continuous grid too, whereas a line over a lattice is a lie. The smoke
test asserts the discrete case steps and the continuous ones do not, so a
harness that stopped discriminating would fail rather than pass quietly.

### The capital anchors are lines, not dots

The dots did not sit on the curve, and could not: the curve is a binned display
grid while the anchor is the library's quantile function at that return period,
so the marker landed slightly off every time. A point has to be *on* the line to
look right; a faint dashed vertical does not, because it makes a claim about the
x-axis rather than about the curve, and reads correctly however coarse the grid
is. Labels sit at the top of each line.

`tail_df` remains the source, for the reason it always was: where it and the
plotted curve differ, the library is right.

### Return periods are integers

`1-in-247`, not `1-in-247.0000003`. In tooltips and axis labels; below 1-in-10
one decimal survives, where the difference is real.

### The smoke test runs offline

`dev/smoke-exhibits.mjs` replayed against a live server, which is no longer
something this project's tooling should assume. New `dev/capture_fixtures.py`
drives the app through FastAPI's `TestClient` (in-process, no port bound) and
writes one payload set per kind to `dev/fixtures/exhibits.json`; the smoke test
replays that by default and still accepts a base URL for a live run.

The fixture file is gitignored: it is derived data and ~17 MB of it.

It also gained a check it should have had at a21: a single-panel exhibit must be
**square**. The distortion aspect ratio was wrong for a whole release and no
automated check would have caught it.

## 1.0.0a22

From `dev/plan-exhibit-punchups.md`. The author's first inspection of the a21
Overview, acted on, plus two bugs that inspection led to.

### A race that made the landing page fail intermittently

**The one that matters.** Fetching `unit_density_df` and `tail_df` for the same
Portfolio at the same moment raised
`KeyError: "['F', 'S'] not in index"` from inside
`Portfolio.unit_density_df`, about half the time on a cold object and never on
a warm one. That is exactly what the portfolio exhibit does, in a single
`Promise.all`, and three of the eight landing heroes are portfolios, one of
which auto-builds on load. So a11 in ten cold visits to the front page got a
500 where a chart should be.

An `Aggregate` or `Portfolio` materializes several frames lazily and caches
them on the instance, so the first read *is* a write. FastAPI runs sync
handlers in a thread pool, so two requests for different frames of one object
are two threads racing to build them. Bisected to that and nothing else:
sequential fetches always passed, concurrent ones failed on cold objects across
repeated fresh server starts.

`CacheEntry` gains a `threading.Lock`, and the eighteen routes that read object
data now take their entry from a `_locked_entry` dependency that holds it for
the request, rather than resolving it unlocked in the body. Structural rather
than a habit each new handler has to remember. Per entry, so unrelated objects
still serve in parallel, and contention is confined to the first access of each
frame. Verified across four fresh cold starts, four passes.

(The dependency is a bare generator, deliberately not wrapped in
`@contextmanager`: FastAPI drives a yield-dependency as an iterator itself and
the wrapper breaks it.)

### Two unbuildable programs were 500s

Both are statements about the program, not server faults, and the library
already reports both well:

- **`xpnl` over a portfolio** raises `NotImplementedError` ("the portfolio
  total hides its units, so there is nothing to explode. Use 'pnl' ...").
- **An unresolved `port.X` / `agg.X` / `sev.X` reference** raises `KeyError`
  ("no recipe named 'X' of kind 'port'").

Neither was caught, so both fell to the catch-all 500 with no useful body. Both
are 422s now, carrying the library's own message. `str()` on a `KeyError`
re-quotes its argument, so the detail is read from `args[0]` or the user would
see a message wrapped in stray quotes.

`pnl` over a portfolio, which does work, gained the regression test it never
had.

### The exhibit gets a control row

Four toggles, sticky per browser like the Static | Interactive table switch, so
a chosen view survives a rebuild and a reload:

| toggle | what it does |
|---|---|
| **log y** | log density, where a heavy tail becomes readable. Zeros are emitted as gaps: a log axis cannot place zero, and the tail of a discretized density is full of exact zeros. The area fill turns off with it, since shading to a log axis floor is a different and false area |
| **survival** | swaps the right panel from loss against return period to exceedance against loss. Same numbers transposed, and in this view both panels share the loss axis, so they read as one picture |
| **full x** | drops the q(0.001) to q(0.999) crop. Answers "what am I not being shown", which the crop otherwise hides silently |
| **reference lines** | the mean and the 1-in-200 anchor, on both panels. One anchor, not three: three dashed verticals over a density say nothing three times |

Each exhibit declares which toggles it honors, so a distortion never offers a
log-y button that would do nothing.

**Zoom now rescales.** The `dataZoom` `filterMode` moves from `none` to
`filter`, so the y-axis re-fits to what is left visible. Without it, zooming
into a heavy tail zoomed into a flat strip near zero, which made the feature
look present and useless.

### Distortion and bivariate are square

`aspect='equal'`, and it was a real error not to have it. A g(s) curve lives on
the unit square and the only thing anyone reads off it is **concavity**, which
a 1000-by-300 aspect ratio misrepresents. The joint-density heatmap is square
for the same reason: stretched wide it lies about where the mass sits. Both now
size a square plot area from the container width, bounded to 240 to 420 px.

### Also

- **The Overview program disclosure is gone.** It repeated what the editor
  shows a few centimetres up the page, which is a poor use of the most valuable
  strip of the tab. The toggle row takes that space. The hints line went with
  it, same redundancy.
- **Exhibit titles trimmed** to `Summary` and `Tail risk`. The captions stay:
  unlike the titles they carry content, naming which anchor is Solvency II and
  why the Freq percentiles are blank.
- The build response's `mean` is now kept in the SPA's state, so the reference
  line costs no extra fetch.

## 1.0.0a21

From `dev/plan-echarts-exhibit.md`. The Overview gets a real chart engine and an
exhibit per first-class citizen. uPlot retires.

### What was wrong with the old plot

Not the library, the design. Five separate faults, only one of which was uPlot's:

1. **It cropped away the subject.** x stopped at `q(0.999)` on a linear scale,
   so the tail (the thing an accurate FFT is *for*) was the part not drawn.
2. **Two y-axes with incomparable scales.** Density around 1e-6 against an
   exceedance in [0, 1]: the density dominated and S read as a cliff then a flat
   line.
3. **Portfolio blind.** It drew `p_total` and nothing else, so the best story in
   the library, diversification, was invisible.
4. **Only agg and port drew anything.** A distortion, severity, P&L or bivariate
   landed on "No risk views for this object", and three of the eight landing
   heroes are portfolios with a bivariate among them.
5. **An instrument, not an exhibit.** No title, 10 px canvas-drawn dashed
   labels, marker chips underneath, no legend, no export.

### The exhibit

Two panels for anything with a loss distribution:

```
density (what it looks like)      exceedance (what it costs)
x = loss, linear, cropped         x = return period, log
y = probability mass              y = loss
```

The EP curve gets equal billing rather than living behind a toggle, because it
is the chart an insurance reader looks at first. The 1-in-100 / 200 / 250
anchors become labeled points **on** the curve instead of dashed lines floating
over a density, and they are read from `tail_df` rather than off the plotted
line: that frame is the library's own quantile function, while the curve is a
binned display grid, and where they differ the library is right.

**The cursor link is exact, not an approximation.** Both panels are built from
the same row array, so a point's index is the same grid bucket in either. A
point the EP panel cannot show (S out in the numerical noise, or a return period
past 1-in-100,000, where the survival function is FFT noise rather than tail) is
emitted as `null` rather than dropped, which keeps the indices aligned and draws
a clean trailing gap. Hovering a loss on the left therefore highlights its
return period on the right because it is literally the same bucket.

Series in the two panels share a `name`, so one legend entry toggles a unit in
both at once.

### One exhibit per kind

The registry is total over the six kinds, so the Overview always lands:

| kind | exhibit |
|---|---|
| `agg` | density + EP, anchors marked |
| `port` | one density and one EP curve per unit, plus the total, legend-toggled |
| `sev` | sampled density + EP; the y-axis says `pdf`, because it is an ordinate |
| `pnl` | signed density with a break-even line; the EP panel runs off **F**, not S, since a P&L's bad tail is the low end |
| `distortion` | g(s) against the diagonal, the load shaded between, tooltip reporting `g(s) - s` |
| `bvagg` | the joint density as a heatmap, block-summed to 96 cells a side |

The bivariate is **summed** into its display cells, not sampled: dropping cells
would silently discard mass and lighten the tail. Its axis names come from
`stats_df`, because the joint frame names only axis 0 (axis 1 arrives as bare
grid values for column headers).

### Two new routes, and why

- **`GET /v1/objects/{id}/unit_density_df`** (Portfolio only). A
  `Portfolio.density_df` carries `p_total` and the per-unit *allocation* columns
  but no per-unit densities; since the windowed-grid work those live on
  `unit_density_df()`, a long frame indexed `(unit, loss)`. Unstacked back to
  wide it gives `p_<unit>` and `S_<unit>` on the portfolio's own grid, which is
  what the portfolio exhibit draws. Verified to align even when the units are on
  wildly different scales.
- **`GET /v1/meta/style`**. The color cycle, grid color and line width read off
  `aggregate.style.rc_params()`. The alternative was a second hardcoded copy of
  the palette in the frontend, which would drift from the Plot tab's matplotlib
  output and the drift would be visible. Falls back to the current values if the
  style is unreadable, so the front page cannot be broken by it.

A **severity now has a `density_df`**: the api samples the frozen scipy variable
onto a quantile-spaced grid, the same presentation-layer move it already makes
for a `PnL`. Columns are `loss / pdf / F / S`, and `pdf` is deliberately not
called `p_total`: it is a density ordinate, not a mass, and reusing the
aggregate's name would invite summing it. The grid inverts the survival function
over log-spaced probabilities rather than walking loss linearly, because a
severity is routinely heavy-tailed with unbounded support, where a linear grid
either truncates the tail or spends every point on it.

### The Overview header block

`/v1/objects/{id}/meta` (new at a19) now feeds a header: name, kind, tag chips,
the note as the lead, and a collapsible canonical `pprogram` with its hints.

This replaces the `pendingNote` module variable, which could only ever show a
note remembered from whichever example was last clicked. The lead is now the
note the built object actually carries, so a **hand-typed** `note{...}` gets one
too. A missing note remains ordinary: no lead paragraph, no empty element.

### Bundle

ECharts is not small and the split says so honestly:

| chunk | gzip |
|---|---|
| app | 27.8 kB |
| bootstrap | 24.7 kB |
| codemirror | 114.2 kB |
| echarts | 186.6 kB |

353 kB total against 187 kB on uPlot. The vendor chunks are new: they change
only with their own version while the app chunk changes every release, so a
redeploy no longer invalidates ~325 kB of cached library code in every returning
browser, and the four download in parallel. `echarts/core` with explicit `use()`
registration keeps the unused two thirds of the library out; the narrow
`DataZoomInsideComponent` and `VisualMapContinuousComponent` are imported
deliberately, since the umbrella names pull both halves of each.

### Also

- **Summary is gone from More.** `summary_df` is an Overview exhibit; showing it
  twice was the same table in two places.
- `dev/smoke-exhibits.mjs` builds one object per kind against a live api and
  asserts each option is drawable: series present, EP panel not entirely null,
  density window not collapsed. It is a smoke test, not a rendering test, and
  says so.
- `config.js` guards `import.meta.env` with optional chaining, which is what
  lets that smoke test import the chart code under bare node.
- `CLAUDE.md` records the re-sync trap: `/v1/meta` reports the version recorded
  when the editable install was built, so a bump without `uv sync` leaves the
  running server (and the About panel) reporting the old one.

## 1.0.0a20

From `dev/plan-all-branding.md`. The app gets a name and the house prose rule.

### aggregate Loss Library (aLL)

`aggregate_api` is the package; **aggregate Loss Library** is the app it serves.
The banner reads the app name on the first line with *description to
distribution* under it in grey small caps, which inverts the old pair
("Description to distribution" set as the title, over "AGGREGATE" as a kicker).
The tagline was doing the title's job.

The name follows through the page `<title>`, the `meta description`, the PWA
manifest (`short_name` is `aLL`, so an installed icon is labeled), the service
worker header, the Help and About leads, `README.md` and the package
description. The lower-case `a` is deliberate throughout: `aggregate` is the
package, `Aggregate` is the class.

`.brand-kicker` moves from mono, `.52rem`, `.3em` tracking to
`font-variant: small-caps` at `.6rem` with `.18em` tracking. Real small caps
where the face has them, synthesized where it does not, and legible either way.

### No dashes as punctuation

The `aggregate` house rule is adopted verbatim into `CLAUDE.md`: not the em dash
`—`, not the ASCII double `--`, not a spaced hyphen. Rewrite rather than
substitute, so a comma, a colon, parentheses or a full stop does the work.
Hyphenated compounds, CLI flags and CSS custom properties are unaffected, since
those are not punctuation.

Every user-visible string is swept: the tab captions and hint lines in
`index.html`, the Overview exhibit titles ("Summary: what it's made of", "Tail
risk: how bad it gets"), the rate-limit card, the build-failure line, the
empty-Overview message, and `CLAUDE.md` itself. The About panel's placeholder
`—` becomes `…`, which reads as "loading" rather than as an em dash.

It is an **authoring** rule, so it binds strings as they are written or touched.
Roughly 190 legacy ` -- ` glosses remain in internal docstrings and comments;
those are cleaned as their file is next edited, rather than in one mechanical
sweep that would bury the real diffs. Recorded in `CLAUDE.md` so the policy is
explicit rather than looking like an oversight.

### Also

`CLAUDE.md`'s frontend section listed `actions.js`, `plot-pane.js` and
`pricing-pane.js`, all deleted at 1.0.0a7. Replaced with the modules that exist.

## 1.0.0a19

From `dev/plan-relink-library.md`. The api catches up with `aggregate`
1.0.0a148 to 1.0.0a174. The library moved a long way in that span (the recipe
layer, one merged `library.agg`, and a declared first-class-citizen contract),
and the api had stopped tracking it. Everything here is a consequence of
following upstream rather than a new idea.

### The example library was dead

`examples.py` read `agg/examples.agg`, which stopped existing when a159 merged
the three shipped libraries into one `library.agg`. `load_examples()` raised
`FileNotFoundError`, so `/v1/examples` returned 500 and took both the Examples
dropdown and the landing hero gallery with it.

The whole text-parsing layer is gone with it: no Contents block to read
(`_CONTENTS_LINE`), no `<Letter>.<Name>` convention to match (`_ITEM_LINE`), no
`note{...}` to pick out of a folded statement (`_NOTE`), no
`UnderwritingLexer.preprocess` call. The library is now read the way the library
asks to be read, off `build.recipes` and `build.recipe(name)`.

Grouping moved from filing letters to the tag namespaces a161 introduced, with
`?group=` selecting the axis:

| | |
|---|---|
| `topic` (default) | the successor to the letters: aggregate 31, severity 55, frequency 16, reinsurance 13, portfolio 29, distortion 8, pnl 24, bivariate 12, numerics 17 |
| `kind` | the object type, off the recipe index: agg 114, port 29, sev 13, bvagg 12, pnl 10, distortion 8 |
| `role` | hero, intro, reference, paper, plus an `other` bucket for the untagged majority |

An entry tagged in two topics appears under both, which is intended.
`GET /v1/examples/heroes` is new and is exactly
`build.discover(tags='role:hero')`, the eight landing-gallery entries.

Two details worth knowing:

- **`Recipe.decl` is already canonical.** It is the entry re-rendered from its
  spec: doc-free, in spread layout, carrying `hints{}` because those change how
  the object builds. So the SPA's post-load `POST /v1/decl/format` round-trip is
  gone. It comes back *empty* for a spec the unparser cannot render (the shipped
  case is `dist MinimumDistortion minimum dist.A dist.B`, whose spec holds
  constructed `Distortion` objects rather than names); the loader falls back to
  the stored program with the same trailer trim.
- **Session builds no longer leak into the menu.** Every program built through
  `POST /v1/objects` is added to the underwriter's recipe base with
  `source='session'`, and the api shares the `build` singleton, so an unfiltered
  walk put the user's own untagged programs in the Examples dropdown. Filtered
  out in both the listing and the hero lookup.

### `bivariate` is `bvagg`

**Breaking.** The parser's kind vocabulary is `agg`, `sev`, `port`, `bvagg`,
`pnl`, `distortion`; the api said `bivariate`. Where the two disagree on a name
the library wins and the api adapts. `BuildResponse.kind` changes accordingly,
along with the SPA's gating keys, labels and density switch.

`_classify_object` is now a table keyed on the class name, and the classes are
exactly `aggregate.constants.FIRST_CLASS_CLASSES` plus `NEAR_FIRST_CLASS`, with
a startup warning if upstream adds a first-class class the api has no kind for.
`Distortion` and `Severity` reach the api as *subclasses* (`DistortionPH`,
`SeverityScipy`), so those two taxonomies flatten to their base kind.

### `sev` builds

`Severity` is DecL-creatable and near-first-class, and the merged library ships
13 `sev` entries that the Examples menu now offers, so refusing to build them was
no longer defensible. It is a look-through onto a frozen scipy variable rather
than a compute result, so it carries `info`, `plot` and the metadata surface and
none of the frames: every frame route answers a clean 400 and the SPA greys out
the tabs that do not apply.

### Renames followed

Three upstream renames were live bugs here, all silent:

- **`agg_m` / `agg_cv` are `actual_m` / `actual_cv`** (a149). The build summary
  line had been showing a blank mean and CV. A `PnL` carries only `est_m` /
  `est_cv` (its outcome is emergent, so there is no input mean), which is now the
  documented fallback rather than an accident.
- **`validation_explanation` is the long form** (a172). It used to return
  `'not unreasonable'`; it now returns a paragraph, and the terse verdict moved
  to `validation_description`. The one-line summary chip reads the description.
- **`Underwriter.knowledge` is `recipes`** (a164). The session `.agg` export
  raised `AttributeError` on every `form=agg` download.

Also corrected: `tail_df` is a property on `Aggregate` and `Portfolio` (a149,
not a method), and a `BivariateAggregate` has no `tail_df` at all since a171
renamed its same-named frame to `axis_support_df` because the two reports were
unrelated.

### `GET /v1/objects/{id}/meta`

New. The object's own DecL metadata in one call: `note`, `tags`, `hints`,
`program` (what the parser was handed, after preprocessing) and `pprogram` (what
it understood, re-rendered canonically). One route for all six kinds.
`doc{{{...}}}` is never served: it is the cookbook's long-form recipe, not
playground content. Empty clauses serialize as `null` so the client can test
presence without trimming.

### Note

A `note{}` is **preferred, never required**. 146 of the 186 shipped entries carry
one; an entry without a note is ordinary, and the dropdown blurb, hero card and
Overview lead all degrade to nothing rather than showing an empty element.

## 1.0.0a18

Punch-ups to the a17 chrome/download pass.

- **Header docs / github links removed.** They're now in both the Help and About
  panels, so the header cluster is just the hamburger.
- **Session `agg` download is line-wrapped.** The `agg` form now runs each
  canonical program through `format_program` (spread/text layout) after
  `spec_to_decl`, so the download reads as tidy multi-line DecL. The `raw` form is
  deliberately **left verbatim** — `format_program` re-parses and would expand
  compact syntax (a range `[10:100:10]` becomes `[10 20 … 100]`), which is exactly
  the difference the two forms exist to preserve: `raw` = your exact source,
  `agg` = canonical/re-flowed. *(Rebuild the SPA bundle.)*

## 1.0.0a17

From `dev/plan-chrome-about-download.md` — header chrome refresh + session-model
download (first cut of a UI refresh).

- **Top-right hamburger menu** replaces the `?` help button: Help, Download models
  (raw / .agg), About, and a greyed-out **"Example source… (soon)"** placeholder
  for a coming example-source switcher.
- **About panel** (new right offcanvas): lists internal-tool versions —
  `aggregate` / `aggregate_api` (from `/v1/meta`) and `csv-grid` / `uPlot` /
  `Bootstrap` (Vite build-time `define`s; two new defines added). The three
  version strings are **removed from the header** and now live here.
- **Download session models** — new `GET /v1/session/models.agg?form=raw|agg`.
  `raw` emits the programs exactly as typed (from the object cache); `agg` emits
  canonical, dependency-ordered DecL from the underwriter's session knowledge
  (best-effort, verbatim fallback), re-loadable. Empty session ⇒ header-only file.
  **Note:** scope is *process-global* (shared cache/underwriter) — every build
  since server restart, not per-browser; fine for a personal/local instance.
  *(Rebuild the SPA bundle — `scripts/build-web.ps1`.)*

## 1.0.0a16

From `dev/plan-grid-full-chrome.md` — turn on the CsvGrid feature set so the grids
are actually useful, and consolidate export onto the grid. Frontend only.

- **csv-grid 3.1.0 → 3.9.0 (dependency bump).** The pinned 3.1.0 (`6033b20`)
  predated the copy / save export controls, so they couldn't be "enabled" — 3.9.0
  (`01a9773`) adds them (a default-on `exportButtons` option) plus row selection.
  The `web/package.json` spec is now **pinned to the exact commit** (was a bare
  git URL): with the bare URL, `npm install` re-resolved from npm's cache to the
  old commit and silently reverted the build to 3.1.0. (Lockfile still records
  `git+ssh://`; a deploy host needs GitHub SSH or the `insteadOf` git config — see
  a7.)
- **Every grid gets the full chrome by default.** fzf global search, per-column
  filters, the status bar, and copy / save export — all CsvGrid defaults — are no
  longer stripped. The `GRID_PLAIN` (chrome-off) preset is gone.
- **Expand/Contract is conditional on width.** Shown only from 6 columns up,
  omitted below that (`grid.js`), so it doesn't clutter narrow tables.
- **Custom per-tab CSV download buttons removed.** The `data-csv` buttons
  (summary / validation / stats / density / bs-window) and the reins `csv` button
  are gone — CsvGrid's own copy / save is the single export path; the unused
  `api.frameCsvUrl` helper is dropped. The Info-text **copy** and the Plot **SVG**
  download stay (not table exports). **Note:** the grid exports the *displayed*
  data, so for density (binned) and stats (raw moments dropped) that isn't the
  full frame the old buttons gave — the `/frame/{which}.csv` backend endpoints
  remain for full-frame access. *(Rebuild the SPA bundle — `scripts/build-web.ps1`.)*

## 1.0.0a15

From `dev/plan-overview-polish.md` — punch-ups to the a13 Overview landing
("demo-central"). Frontend only; no backend or api change.

- **Overview tables get a `Static | Interactive` toggle (Static default).** Every
  table in the app is a CsvGrid except the two Overview exhibits (`summary_df`,
  `tail_df`), which stayed hand-built because the landing demo reads better with
  the curated static exhibit — lit **1-in-200 / 1-in-250** capital anchors, bold
  **Agg / total** — and CsvGrid has no row-highlight to reproduce it. Rather than
  force one, the exhibits now carry a small `Static | Interactive` segmented
  toggle: Static (the curated exhibit) is the default, Interactive swaps in the
  CsvGrid (sort / filter / search); the choice is sticky per browser. All other
  tables are unchanged (CsvGrid).
- **Overview density / exceedance plot width capped.** The uPlot chart was
  full-bleed (`width: 100%`); now `max-width: 720px`, reflowing to the container.
- **Overview density plot x-axis cropped to a sensible window.** The plot auto-fit
  to the whole FFT grid, so a heavy tail squashed the visible mass into a sliver.
  It now crops to ~`q(0.001)..q(0.999)` with 2% padding — the window
  `aggregate`'s `Aggregate._limits` / `Portfolio._limits` use — computed
  client-side from the `F` column already in the payload, which handles signed
  (PnL) vs non-negative (agg / port) grids automatically. Drag still zooms.

## 1.0.0a14

From `dev/plan-pnl-kind.md` — pick up the `aggregate` a114→a145 surface (the
library advanced ~30 releases since a13 rode a113). An audit of both sides found
almost all of it internal or serialized generically; the one thing that reached
our surface was the **P&L engine**, which now builds a real object.

- **New `pnl` object kind (breaking-ish surface addition).** `aggregate.build`
  returns an `aggregate._pnl.PnL` for a `pnl` / `xpnl` DecL program (`xpnl` is
  the same class built with a multi-group walk). `_classify_object` had no `PnL`
  case, so it fell through to an unaccepted `"pnl"` kind and **every `pnl` /
  `xpnl` build 422'd** — and the bundled `examples.agg` now ships a `pnl H.PnL …`
  example that surfaced in the dropdown and failed on click. `PnL` now maps to a
  new `kind="pnl"`; `BuildResponse.kind`'s `Literal` and the accepted-kind guard
  gain `"pnl"`. **Clients that switch on `kind` will now see `"pnl"`.**
- **PnL density synthesis.** A `PnL`'s `density_df` is an `OrderedDict` of per-leg
  grid distributions, not a DataFrame, so the generic density path would 500. The
  density route (and its CSV export) now synthesize the grand-result density
  (`obj.result`) into the standard `loss / p_total / F / S` frame
  (`serializers.pnl_density_frame`) and bin it to the 2¹¹ display grid like an
  aggregate. The P&L outcome axis is signed (losses negative); the existing
  positional `bin_density` handles it, and `p_total` stays faithful (sums to ~1).
- **PnL reporting surface.** Info / Summary / Validation / Stats / Density / Plot
  work (the Overview tab too — the absent `tail_df` is skipped gracefully); the
  build summary line's mean/CV fall back to `PnL.mean` / `PnL.cv` (no `agg_m`),
  and the Info tab falls back to `construction_explanation` (no `info` string).
  Price / Reins / bs-window are inapplicable and return a clean 400 (the SPA
  greys those tabs out — `NA_TABS_BY_KIND.pnl`, mirroring `bivariate`).
- **SPA:** the summary line and timing word read **P&L** for a `pnl`; kind gating
  added. *(Rebuild the bundle — `scripts/build-web.ps1` — to ship the frontend.)*
- **Examples loader recognizes `xpnl`.** The `_ITEM_LINE` keyword set gains
  `xpnl` (latent — no `xpnl` item in the bundled file yet, but it's a valid
  top-level statement keyword).
- **No change needed** for the rest of the a114→a145 drift (verified
  non-breaking): the `summary_df` a142 column renames (`E[X]`→`Mean`,
  `p0.99`→`P99`, values now computed) are cosmetic to us — the Overview
  emphasizes by row index (`Agg`/`total`/`T`), not header names; the
  `VariableRatingAnalysis` / `ReinstatementAnalysis` removal (a144) was never on
  our surface; the a145 bs-window rework leaves the public `bs_window_df` columns
  unchanged; the labels namespace and reins premium scaling change values, not
  the serialized frame shapes.

## 1.0.0a13

From `dev/plan-user-facing.md` — rework the SPA landing from an internal tool
into an immediate demo, riding the upstream `aggregate` 1.0.0a113 risk frames.

- **New risk-view endpoints.** `GET /v1/objects/{id}/tail_df` (return-period /
  exceedance table — `p · VaR · TVaR · xsVaR · VaR/Mean`) and
  `GET /v1/objects/{id}/validation_df` (the moment-vs-estimate QA table). Both
  are CSV-downloadable via `/frame/{which}.csv`. A `_resolve_frame` helper calls
  `tail_df` when it is a method (Aggregate / Portfolio) and reads it when it is a
  property (BivariateAggregate), so one route covers both.
- **`/summary` now serves the user risk view.** Upstream repurposed `summary_df`
  in place (moments + percentiles, Freq/Sev/Agg), so the existing route changed
  meaning; the old moment-validation payload moved to the new `validation_df`
  route. Docstrings updated; no path change.
- **SPA: "Description to distribution" landing.** Brand title + one-line subhead;
  a hero gallery of four random group-A showcase examples (the set grows — the
  count is not assumed), one of which auto-builds on load so the page lands fully
  populated with zero clicks. Examples load in the new multiline/spread DecL
  layout (now `format_program`'s default).
- **SPA: Overview tab (new default).** Replaces Info as the landing tab: the
  example's `note` as a lead, an interactive density / exceedance chart (uPlot,
  fed from `density_df` with 1-in-100/200/250 markers off `tail_df`), then the
  `summary_df` and `tail_df` exhibits (the 1-in-200 / 1-in-250 capital rows lit,
  `Agg` / `total` emphasized). Degrades gracefully when an object lacks a frame.
  Info / Summary / Validation / Stats / Density / bs-window move under **More ▾**.
  The matplotlib SVG export stays on the **Plot** tab.

## 1.0.0a12

Batch from `dev/plan-misc-03.md` (gather → review → execute).

- **Examples loader follows `aggregate`'s new statement syntax.** DecL programs
  now separate statements with a blank line or a trailing `;` (line breaks
  replaced the old `\` continuation), so the bundled `examples.agg` is
  semicolon-terminated and writes the portfolios across several indented lines.
  The old loader only folded `\`-continuations and only stripped a `note{...}`
  at the very end of a line, so under the new syntax every multi-line `port`
  (section F) and the `bivariate` example (section H) vanished from the dropdown,
  and every `;`-terminated program lost its `note` and carried a stray
  `note{...};` in its decl. The loader now delegates statement splitting to
  `aggregate`'s own `UnderwritingLexer.preprocess` (so the SPA sees exactly the
  statements the default `build` underwriter does) and runs the item/note
  regexes over those clean statements. The item-keyword set is refreshed for the
  current grammar: `bivariate` / `bv` and `clash` added, the view-pair prefixes
  `grossceded` / `grossnet` added alongside `netceded`, and the retired
  `mv` / `multivariate` keywords dropped.
- **Docs:** `examples.py`'s module docstring and comments now name `examples.agg`
  (the file the loader actually reads) and describe the statement model
  (closes `plan-misc-03` item 4).
- **Bivariate objects replace the `multivariate` vocabulary.** `aggregate`
  renamed `MultivariateAggregate` to `BivariateAggregate` and retired the
  `multivariate` / `mv` keywords in favor of `bivariate` / `bv` (plus `clash`
  and the `netceded` / `grossceded` / `grossnet` occurrence view-pairs). The api
  follows suit: `_classify_object` maps `BivariateAggregate` to a new
  `kind="bivariate"` (replacing `"multivariate"`), `BuildResponse.kind`'s
  `Literal` is updated, and the SPA's kind label / timing word / tab-gating /
  density-fetch switch all key off `"bivariate"`. The reporting surface is
  unchanged — info / summary_df / stats_df / density_df / plot work; price /
  reins / bs-window return a clean 400. **Breaking:** clients that special-cased
  `kind == "multivariate"` must switch to `"bivariate"`. *(Rebuild the SPA bundle
  — `scripts/build-web.ps1` — to ship the frontend half.)*
- **`reins_description` reads the library's string attribute.** `aggregate`
  turned `Aggregate.reins_description` from a method into a plain string
  attribute (e.g. *"Ceded to 100% share of 15 xs 5 per occurrence"*). The
  `reins_description` endpoint returned empty text because it only called a
  *callable*; it now reads the string property directly, so the always-visible
  reinsurance blurb renders again.
- **`describe` → `summary` (object moment table).** `aggregate` renamed the
  object-level `describe` property to `summary_df`. The api endpoint is renamed
  `GET /v1/objects/{id}/description` → `GET /v1/objects/{id}/summary`, the CSV
  download token `describe` → `summary` (`/frame/summary.csv`), and the SPA tab
  is relabeled **Describe → Summary** (tab id `desc` → `summary`, pane
  `pane-desc` → `pane-summary`, `api.description` → `api.summary`). **Breaking:**
  the `/description` path and the `describe.csv` download token are gone — use
  `/summary` and `summary.csv`. *(`reins_describe` / `reins_description` are a
  separate reinsurance surface and are unchanged.)*
- **Build-summary validation reads `validation_explanation`.** `aggregate`
  replaced the `explain_validation()` method with a `validation_explanation`
  string property (e.g. *"not unreasonable"* / *"fails sev mean, agg mean"*).
  `_summary_fields` now reads the property, so the build status line's validation
  chip is populated again instead of going blank.
- **`line` → `unit` and pricing-method signatures (full `aggregate` a76–a84
  surface sweep).** Brought the rest of the API into line with the renamed
  library surface:
  - **kappa plot** keyed off the removed `Portfolio.line_names_ex`; now
    `unit_names_ex`. Without this, every per-unit kappa plot 400'd ("kappa plot
    requires a Portfolio") even for a real Portfolio.
  - **`Portfolio.price_ccoc`** signature changed to `price_ccoc(ccoc, *, p)`
    (arg order swapped, `p` keyword-only). The constant-CoC `/pricing_at` path
    called `price_ccoc(p, ccoc)` → `TypeError`/500; now `price_ccoc(ccoc, p=p)`.
  - **`pricing_at` frame index** renamed `line` → `unit` upstream; the per-row
    breakdown is now keyed `unit` (was a hard-coded `index_name="line"`).
  - Confirmed unchanged-and-working against the new surface: `summary_df`,
    `stats_df`, `density_df`, `bs_window_df` / `_bs_window_df`, `agg_m` /
    `agg_cv`, `price_pentagon(*, p, ROE|LR)`, `calibrate_distortions`,
    `analyze_distortions(*, p).pricing_df`, `distortion_df`, `reins_*`, and the
    `exeqa_*` density columns. New tests cover the two previously-untested
    breakages (Portfolio kappa plot, ccoc `/pricing_at`).
  - The transitional `describe`/`explain_validation`/callable-`reins_description`
    fallbacks added earlier this batch are removed — `aggregate` made clean
    breaks (no aliases), so the API matches the single canonical name.
- **`reins_describe` → `reins_summary_df` (aggregate a85).** The last
  `describe`-verb frame property was renamed to join the `_df` family. The api
  follows: the endpoint `GET /v1/objects/{id}/reins_describe` →
  `GET /v1/objects/{id}/reins_summary_df`, the CSV token / `_CSV_FRAMES` entry
  `reins_describe` → `reins_summary_df`, the reinsurance-availability signal in
  the `reins_description` route now reads `reins_summary_df`, and the SPA Reins
  tab's first sub-button is relabeled **"reins describe" → "reins summary"**
  (`data-reins="reins_summary_df"`, `state.reinsWhich` default). **Breaking:**
  the `/reins_describe` path and `reins_describe.csv` token are gone — use
  `reins_summary_df`. The text blurb endpoint `reins_description` (a string
  property) is unchanged, as are `reins_stats_df` / `reins_density_df`. The
  `BivariateAggregate` reporting redesign (a85: rebuilt `summary_df`, slimmed
  `stats_df`, new `dependency_df`) needs no api change — those frames are
  serialized generically. *(SPA bundle rebuilt.)*
- **Infinite-variance builds return 422 (aggregate a87).** Building an
  infinite-variance aggregate (e.g. `pareto` shape ≤ 2) without an explicit `bs`
  now raises `InfiniteVarianceError` (a `ValueError` subclass) instead of
  silently sizing. The build handler's existing `except ValueError` already maps
  it to a 422 carrying the library's "pass an explicit `bs`" message; a
  regression test pins the behavior.
- **Transformer errors now arrive as plain `ValueError` (aggregate a86).** A bad
  distortion kind (and other transformer `ValueError`s) surface directly rather
  than wrapped in Lark's `VisitError`. The build handler's `except ValueError`
  catches them and still returns 422; the `except VisitError` clause is retained
  as defensive cover for any non-`ValueError` transformer exception. (Test
  comment updated; no behavior change.)

## 1.0.0a11

Punch-ups from the a10 demo pass — two small fixes on top of 1.0.0a10.

- **Build-time semantic errors render legibly in the SPA.** The a10 fix returned
  these as a 422 with a *plain-string* `detail` (e.g. *"Unknown distortion kind
  'dualx'; available: …"*), but the error pane only knew how to render the
  `ErrorReport` *dict* shape, so a string fell through to a generic "Request
  failed". The renderer now shows a string `detail` directly. (Frontend only;
  the backend was already correct.)
- **Density binning uses centered "around xᵢ" buckets.** The 2¹¹ binning now
  labels each coarse node at `i·bs'` (0, bs', 2·bs', …) and sums the fine mass
  in the window *centered* on it — node `i` owns `(i·bs' − bs'/2, i·bs' + bs'/2]`
  (so with `bs'=320` the first row is `0` covering `loss ≤ 160`, the second is
  `320` covering `160 < loss ≤ 480`, …). Masses sum; `loss` takes the node
  center; `F`/`S`/`ex***` take the window right edge, so `F` reads as the running
  cumulative and `F[i] − F[i−1] == p_total[i]` exactly (the native coarse-build
  convention). Still exactly 2048 rows; `p_total` sums to ~1. (Replaces the a11
  right-edge labeling shipped earlier in this section.)
- **Density grid shows all 2048 rows.** CsvGrid's default `renderCap` (2,000)
  truncated the binned grid with a "show all" prompt; the Density pane now sets
  `renderCap: 2048` so the full grid renders directly.
- **Examples loader recognizes more object kinds.** The `GET /v1/examples`
  item parser only matched programs starting with `agg` / `sev` / `port` /
  `dist`, so `pnl`, `mv` / `multivariate`, and `netceded agg …` examples never
  surfaced in the dropdown. The item regex now covers those (the `netceded agg
  X.Name …` two-keyword form included). The bundled `spa_examples.agg` was
  reformatted to the `# <Letter>. <Title>` contents + `<Letter>.<Name>`
  convention so the curated set populates the categorized dropdown.

## 1.0.0a10

Assorted playground tweaks (`dev/done/plan-misc-02.md`) — six small fixes
gathered while demoing the playground.

**Backend**

- **Build-time semantic errors now return 422, not 500.** An unknown distortion
  kind (`dist X pd 0.5`, a `ph`→`pd` typo) is raised *inside* the Lark
  transformer and surfaced as a `lark.exceptions.VisitError`, which fell through
  to the catch-all 500. A new `except VisitError` clause unwraps `.orig_exc` and
  returns 422 with the clean message (*"Unknown distortion kind 'pd';
  available: …"*), rendered legibly in the SPA error pane. The catch-all 500 is
  retained for genuine server bugs.
- **`MultivariateAggregate` objects build.** The `multivariate` / `mv` /
  `netceded` DecL keywords now build and cache as `kind="multivariate"` instead
  of being rejected with "api supports … only; got 'multivariateaggregate'".
  They expose the common reporting surface — Info, Describe, Stats, Density (the
  joint-density matrix), and the native Plot. Pricing, reinsurance, and the bs
  window legitimately return a clean 400 (the SPA greys those tabs out — see
  below). `BuildResponse.kind` widened to include `"multivariate"`.
- **Multi-line input builds without `\`.** The build entry collapses newlines,
  tabs, and `\` line-continuations to single spaces before parsing, so a program
  formatted across several indented lines builds (DecL otherwise treats a bare
  newline as a program separator). Applies before the hints scan, cache key, and
  parse, so cache keys become formatting-insensitive and parse-error carets
  reflect the submitted source.
- **Stats / Reins-stats tables omit raw moments.** The displayed `stats_df` and
  `reins_stats_df` drop the `ex1` / `ex2` / `ex3` rows (E[X], E[X²], E[X³]),
  keeping the human-readable `mean` / `cv` / `skew` (and the `meta` block). The
  full-frame CSV download keeps everything.
- **Faithful power-of-two density binning.** The density display reduction was
  even-spaced row sampling (stride-skip), which understated `p_total` by the
  stride factor (summed to ~0.045 instead of 1). Density / reins-density / kappa
  now bin the full grid to a fixed 2¹¹ = 2048 grid-aligned rows — "as if built
  at a coarser `bs`" — summing the mass columns (`p_*`) and right-edging the
  pointwise columns (`loss` / `F` / `S` / `ex***`). `p_total` is now correct
  (sums to ~1). The full-frame CSV download stays exact / unbinned.

**Frontend**

- **Price defaults bumped** to CoC `0.15` (was `0.10`) and LR `0.90` (was
  `0.70`) — LR is the technical premium ratio (no expenses), so 0.9 is the
  natural default. The `p` default (`0.99`) is unchanged.
- **Tabs grey out, never disappear (house rule).** Tabs that don't apply to the
  built object (Price / Reins / bs window for a distortion or multivariate) are
  now *disabled* (greyed, non-interactive) rather than hidden — the menu set
  stays stable. **Behavior change vs 1.0.0a9**, which *hid* those tabs for
  distortions via `d-none`; that path is retrofitted to the grey-out.
- Multivariate gets its own summary / timing label ("Multivariate"), and its
  Density tab renders the full joint-density frame.

## 1.0.0a9

Make the playground less brittle (`dev/done/plan-misc-01.md`) — five small,
related fixes found mostly while exercising the Price tab and `dist …`. Absorbs
plan-0002 **C1** (standalone Distortions) and **D2** (hints log2 cap).

**Backend**

- **Pricing accepts `p = 1` (max).** `PriceRequest.p` and `PricingRequest.p`
  relaxed from `(0, 1)` to `(0, 1]` (`lt=1` → `le=1`). On a *bounded*
  distribution `p=1` resolves to the finite max of support via the lower
  quantile — the motivating use case (bounded distortions). On an unbounded one
  it returns the last grid bucket, so it's grid-dependent there.
- **Standalone `Distortion` objects build.** `dist MYD ph 0.5` (and every other
  `Distortion` subclass) now builds and caches as `kind="distortion"` instead of
  being rejected with "api supports 'agg' and 'port' only". Distortions expose
  the common reporting surface — Info, Describe, Stats, Density (the g-curve over
  x∈[0,1]), and the native Plot all work. Pricing, reinsurance, and the bs window
  legitimately return a clean 400 (the SPA hides those tabs — see below).
- **`log2` cap enforced against `hints{}`.** `AGGAPI_LOG2_CAP` (default 18) was a
  request-only guard; a program could dodge it with an embedded
  `hints{ log2=24 }` clause. A static pre-build scan now folds any `hints{}`
  `log2` into the cap check (effective = max(request, hint)); over-cap → 422
  naming the effective `log2`. `bs` and every other hint pass through untouched —
  the guard only vetoes an over-cap `log2`, it never rewrites the program.

**Frontend**

- **FastAPI 422 validation errors render legibly.** A Pydantic rejection (bad
  `p`, over-cap `log2`, malformed `bs`) used to surface as a bare "HTTP 422"; the
  error pane now maps the `detail` array to `"<field>: <msg>"` (e.g.
  *"p: Input should be less than or equal to 1"*). General — covers every
  validated endpoint.
- **Distortion-aware UI.** Summary line and timing label say "Distortion"; the
  Density tab pulls the whole g-curve frame (no `loss,p_total,F,S` columns to
  request); Price / Reins / bs-window tabs are hidden for a distortion (and
  re-shown for agg / port) so they can't be clicked into a guaranteed 400.
- **csv-grid version in the header.** The top-right line now reads
  `… · api <ver> · grid <ver> · docs · …`. The version is a build-time constant
  (Vite `define` reads `csv-grid`'s `package.json`), not an api/meta field — the
  backend has no knowledge of which `csv-grid` the SPA bundled.

## 1.0.0a8

CsvGrid polish (follow-up to a7). No backend changes.

- **Force grids to light mode.** CsvGrid auto-follows the OS via
  `prefers-color-scheme`, so on a dark-mode browser the grids rendered dark while
  the (light-only) SPA around them stayed light. `mountGrid` now sets
  `data-theme="light"` on every grid host to opt out. A real SPA-wide dark mode
  is intentionally out of scope (it would also need dark plots — a whole thing).
- **Describe loses its per-column filter row** (kept the global fzf search bar):
  the frame is narrow enough that the column filters were just noise.

## 1.0.0a7

Adopt **CsvGrid** for every table in the SPA (`dev/done/plan-grid.md`). No
backend changes — the `FrameResponse` `{columns, rows}` shape is unchanged and
maps straight onto CsvGrid `records`.

**Frontend — one grid everywhere**

- **All output tables now render through CsvGrid** (`mynl/CSV_Viewer`, git
  dependency) instead of the hand-rolled `.tbl` renderer: Describe, Stats,
  Density, bs window, the three Reins frames, and the Price set (pentagon,
  calibrated distortions, and the LR/P/PQ/ROE distortion slices). Substantive
  frames get click-to-sort, fzf-style global search, and per-column filters;
  the small 3–8 row frames (bs window, pentagon, distortion slices) keep sort
  but strip the search/filter chrome. The Price-stat slices keep their exact
  formatting via CsvGrid per-column `formats` (`.1%`, `,d`, `.3f`, `.0%`).
- **Density preview lifted** from 300 to 2 000 server-downsampled rows, shown in
  a bounded 25-row scroll viewport (CsvGrid lazy-formats and caps the DOM at its
  render cap). Full-frame `{url}` + worker parsing remains a future option — the
  Vite build already emits a correctly-pathed worker asset; we ship with
  `worker: false` for determinism until it is browser-verified.
- **Teardown lifecycle** (`web/src/grid.js`): CsvGrid instances are tracked per
  pane and `destroy()`ed on re-render and on rebuild, so listeners (and any
  future worker) don't leak.
- **Dead code removed:** `web/src/actions.js`, `pricing-pane.js`, `plot-pane.js`
  (an unimported pre-redesign action layer), the `renderTable` /
  `renderFrameTable` / `renderBuildBanner` renderers, the dense `.tbl` styles,
  and the stale pre-redesign `web/public/index.html`.

**Deployment note**

- The new `csv-grid` git dependency is fetched at `npm install`. npm rewrites
  the lockfile's `resolved` URL to `git+ssh://` regardless of the `git+https`
  spec; the repo is public, so the VPS build host needs either GitHub SSH access
  or `git config --global url."https://github.com/".insteadOf "git@github.com:"`.
  Pinned to commit `6033b20` (csv-grid 3.1.0) via the lockfile.

## 1.0.0a6

Installable PWA (`dev/plan-pwa.md`, Phase B). No backend changes.

**Frontend — PWA**

- **Completed the web app manifest** (`web/public/site.webmanifest`): real
  `name` / `short_name` / `description`, `start_url` and `scope` of `/`,
  `display: standalone`, and a white `theme_color` matching the header (also
  added as `<meta name="theme-color">`). Icons kept `purpose: "any"` — the logo
  runs edge-to-edge with no maskable safe zone, so claiming `maskable` would crop
  it on Android; a padded maskable variant is future polish.
- **Service worker** (`web/public/sw.js`, served at `/sw.js`, scope `/`):
  deliberately minimal — it exists to make the SPA installable and to speed
  repeat loads, not for offline use (a build requires the backend). `/v1/*` is
  **never** cached (network-only); HTML navigations are network-first (so a
  redeploy is picked up); content-hashed assets are cache-first; old caches are
  purged on `activate`. Registered from `main.js` in the **production bundle
  only** (so it never intercepts the Vite dev server) and only in a secure
  context.

**Deployment — retire the `/Q7M4Z9KP` obscured prefix (Phase A, operational)**

- The PWA is only clean at an origin **root**, so the deploy moves off the
  obscured `www.mynl.com/Q7M4Z9KP/` subpath to a dedicated **`agg.mynl.com`**
  subdomain (same-origin api, so the SPA builds with **no** `-ApiBase`). The
  prefix strip used to hide `/docs` by accident; the new Caddy block does it
  **explicitly** (`respond /docs … 404`) while keeping `/v1/*` open and the
  build rate-limit in place. Full DNS + Caddy + `refresh.sh` cutover steps are in
  `dev/plan-pwa.md`; these are server-side and applied at deploy. `build-web.ps1`
  usage notes trimmed to the same-origin default.
  - **Sequencing:** do the subdomain cutover **before** deploying this bundle —
    under the old `/Q7M4Z9KP/` subpath the manifest `start_url`/`scope` and the
    `/sw.js` registration resolve to the wrong path and the PWA simply won't
    activate (no breakage, just inert). It works at `localhost` root today.

## 1.0.0a5

Two small, client-only SPA additions (`dev/plan-help.md`,
`dev/plan-ui-enhancements-01.md`). No backend changes.

**In-SPA help (plan-help)**

- **Always-visible `?` in the header** (after `docs · github`) opens a right-side
  Bootstrap **offcanvas** quick-help panel: a one-line intro, a paste-ready
  example with a **Load it** button (drops it into the editor via the same
  `format_program`-normalized path as the Examples dropdown), the key bindings
  (incl. `↑↓` history and `Alt+↑↓` examples), a one-line guide to the Build /
  Examples / log2 / bs controls and every output tab, doc links, and the
  fair-use note tying into the rate-limit card. Static content; only **Load it**
  is interactive (closes the panel and refocuses the editor).

**Phone-friendly form inputs (plan-ui-enhancements-01)**

- **No iOS zoom-on-focus:** the Price form inputs (`#price-p`,
  `#price-target-val`) and the custom-bs input (`#bs-custom`) bump to 16px on
  phones (≤575.98px) so focusing them no longer magnifies the layout. Desktop
  keeps the tighter `.78rem`.
- **No AutoFill bar:** those inputs get `autocomplete="off"` (and
  `autocorrect`/`autocapitalize="off"` on the text `#bs-custom`) to suppress the
  iOS key/credit-card accessory bar. `#bs-custom` keeps `type="text"` (it accepts
  fractions like `1/64`) and intentionally takes **no** `inputmode` so the `/`
  key stays available.

## 1.0.0a4

In progress (`dev/plan-0002.md`). Iterating on the SPA via
`hacks/mockup-08.html`, then porting agreed changes here.

**Frontend — layout (plan-0002 step 1)**

- **Tab bar reorg:** the output tabs are now `Info · Describe · Plot · Price ·
  Reins · More`, where **More** is a dropdown holding `Stats · Density ·
  (reserved)`. Stats moved off the top row to bound its width; a new **Density**
  tab is stubbed (a placeholder pane; wired to `density_df` in step 2). The tab
  wiring in `main.js` now selects triggers by `[data-tab]` rather than
  `.nav-link` so the dropdown items lazy-load like the top-level pills.
- **Phone-fit button row:** on extra-small screens the live `log2` / `bs`
  values and the *Examples* label collapse (icon/label only); the values still
  show from ≥sm and inside the dropdowns.

**Frontend — editor + data panes (plan-0002 step 2)**

- **Editor selection fixed:** dropped `drawSelection()` in favor of the
  browser's native selection. The opaque active-line highlight was painted over
  drawSelection's (behind-the-text) selection layer, so double-click-word and
  shift-arrow selections were invisible; native selection paints on top.
- **Real kill/yank:** CM's bundled `emacsStyleKeymap` binds Ctrl-K to a
  delete-only command and leaves Ctrl-Y unbound. Added a small kill-ring so
  Ctrl-K stores (line-end or active selection) and Ctrl-Y yanks.
- **↑/↓ history:** plain Up/Down now navigate build history at the buffer edges
  (and no longer reset the history cursor), matching the feedback-line hint;
  Ctrl-↑/↓ still work mid-buffer.
- **Density pane** (under **More**): wired to `density_df` with the SPA default
  `loss · p_total · F · S`, `nonzero` (p_total>0) filter, and a ~300-row
  downsample; full frame via the CSV button.
- **bs window pane** (under **More**): the bucket/window estimator summary
  (`_bs_window_df`), with the `selected` row marking the chosen grid.
- **Example standardization:** picking an Example now runs it through
  `format_program` (new `POST /v1/decl/format`) so the editor shows canonical
  DecL; the raw text shows instantly and is replaced when the format returns.
- **Friendly rate-limit card:** a build that hits the public demo's per-IP
  build cap (HTTP 429) now shows a warm "shared, free resource" card (with a
  Retry-After hint and a "run it locally" link) instead of a raw error.
  `ApiError` carries `retryAfter`; the card lives in `error-pane.js`.

**Backend (plan-0002 step 2)**

- `GET /v1/objects/{id}/density_df` gains a `nonzero` flag (drop zero-mass rows
  before slicing).
- `GET /v1/objects/{id}/bs_window_df` — new; serves the private `_bs_window_df`
  frame (400 when absent, e.g. on a Portfolio). Added to the `/frame/*.csv` map.
- `POST /v1/decl/format` — new; canonicalizes a DecL program via
  `aggregate.decl_writer.format_program`, echoing the input unchanged on any
  parse/format failure (best-effort, never 500s).
- **Curated Examples via env:** `AGGAPI_EXAMPLES_FILE` points the Examples
  dropdown at a custom `.agg` file (same `# A. Title` + `agg A.Name …` format),
  falling back to the bundled `spa_examples.agg`. Runtime-fetched, so swapping
  the file needs only a server restart — no SPA rebuild.

**Price tab (plan-0002 step 3)**

- New `POST /v1/objects/{id}/price` — `price_pentagon(p, ROE=coc | LR=lr)`
  returns the one-row `[L, M, P, Q, a, LR, PQ, ROE]` completion for an
  Aggregate *or* Portfolio. For a Portfolio it also calibrates distortions to
  the pentagon's CoC at the same `p` and runs `analyze_distortions(p)`,
  surfacing the `LR / P / PQ / ROE` slices of `pricing_df` (per distortion ×
  unit + total). Skipped distortions (e.g. mass/ccoc on an unbounded
  portfolio) come back as `warnings`, not errors.
- The **Price** tab is now a live form (p + CoC/LR), replacing the
  placeholder. The pentagon renders for any object; Portfolios additionally
  show the calibrated-distortions detail (`distortion_df`, one row per
  ccoc/ph/wang/dual/tvar) directly below the pentagon, then the four stacked
  distortion tables, formatted per stat (LR/ROE as percents, P
  thousands-grouped, PQ to 3 dp). `renderFrameTable` gained an optional
  per-cell formatter. `/price` is intentionally not rate-limited.

**Build summary (plan-0002 step 3)**

- The summary line now shows the **resolved bucket size** —
  `name · kind · bs = 1/64 · mean … · CV …` (sub-unit bs rendered as a
  power-of-two fraction). `BuildResponse` carries `bs` (the library's auto-pick
  when the request said "auto").
- A **timing sub-line** under the summary: `Calculated aggregate in 0.000
  seconds` (or "Loaded … from cache"), from the existing `elapsed_ms`.

**Frontend — mobile (plan-0002 step 2)**

- **No more iOS zoom-on-tap:** the editor text is bumped to 16px on phones
  (≤575px) so Safari stops magnifying the page when the editor is focused;
  desktop keeps 14px.
- **Tab row fits a phone:** the output pills get tighter padding on ≤575px so
  `Info · Describe · Plot · Price · Reins · More` stays on one line.
- **Editor floor of ~3 lines:** the editor never shrinks below ~3 text lines
  (`min-height: 4.5em`, font-relative) and grows with content as before.
- **No iOS AutoFill bar:** the editor's contenteditable is marked
  `autocomplete/autocorrect/autocapitalize=off, spellcheck=false`, which (on
  iPhone) suppresses the Passwords/Payment accessory bar above the keyboard and
  stops autocorrect mangling DecL keywords.
- **Undisclosed example browsing:** **Alt-↑/↓** steps through the whole example
  library into the editor (format-standardized, wrap-around), seeded from
  `/v1/examples` — separate from build history, not shown in the UI.

## 1.0.0a3

SPA editor fix and look-and-feel redesign (`dev/plan-ui-enhancements.md`). The
DecL playground now mirrors the **archivum** visual language (one UI font,
dense booktabs tables, blue accent, sticky header) and a `nav-pills` tabbed
output. Backend grows native plotting and per-tab data endpoints.

**Frontend**

- **Tamed autocomplete:** completion is now manual-trigger only
  (`activateOnTyping: false`); the per-keystroke `/v1/decl/complete` round-trip
  is gone (`completion.js` only calls the network on an explicit Ctrl-Space).
  This restores smooth typing, selection, and clipboard behavior.
- **Emacs editing keys:** optional `emacsStyleKeymap` (Ctrl-A/E/K/Y/N/P/F/B/D)
  behind a feedback-line switch, swapped at runtime via a CM6 `Compartment` and
  persisted in `localStorage`.
- **Redesign:** rebuilt `index.html` + `styles/site.css` from
  `hacks/mockup-07.html` — header with logo + versions, rounded editor box with
  focus glow and clear-X, mono feedback line, `Build / Examples / log2 / bs`
  button row, a one-line **build summary** (`name · kind · mean · CV ·
  validation`, overflow-only ⌄ expander), and the `Info · Describe · Plot ·
  Stats · Reins · Price · More` tab bar. Tabs fetch their data lazily and cache
  per built object. Price / More are placeholders.

**Backend**

- **Native plot:** `GET /v1/objects/{id}/plot` defaults to `kind=native`,
  rendering the object's own multi-panel `.plot()` figure (captured from
  `obj.figure`). The legacy `density|cdf|qq|kappa` single-panel renderers are
  retained for backward compatibility.
- **Reinsurance endpoints:** `reins_description` (text block, `available` flag),
  `reins_describe`, `reins_stats_df`, and `reins_density_df` (the density frame
  is filtered to `p_total > 0` then downsampled to ~20 rows for preview). All
  getattr-gated → a clean 400 ("no reinsurance on this object") rather than 500.
- **CSV download:** `GET /v1/objects/{id}/frame/{which}.csv` returns the full
  frame (describe / stats_df / density_df / reins_*) for "save the real data".
- **Build summary fields:** `BuildResponse` now carries `mean`, `cv`, and
  `validation` (from `agg_m` / `agg_cv` / `explain_validation()`) for the SPA's
  one-line summary.

**Notes**

- The "sev stats" sub-button was dropped: no clean `sev_stat_df` accessor exists
  upstream; the Stats tab shows `stats_df` (which already carries the Freq / Sev
  / Agg breakdown). Revisit if a dedicated severity-stats view is wanted.
- The SPA bundle now vendors Bootstrap Icons via npm (no runtime CDN).

## 1.0.0a2

Bootstrap the standalone package (`dev/plan-0001-bootstrap-standalone.md`). The
1.0.0a1 verbatim copy now imports, runs under uvicorn, serves the SPA, and
passes the suite.

- Wired the `aggregate` dependency to a local editable checkout
  (`[tool.uv.sources]` → `../aggregate_REFACTOR`), where the `parser_errors` /
  `parser._PARSER` internals the api needs live.
- Rewrote the `aggregate.api` → `aggregate_api` self-references: the uvicorn
  target in `__main__.py`, the OpenAPI `version` in `app.py`, the test imports
  (`conftest.py`, `test_objects.py`, `test_cors.py`), and cosmetic docstrings /
  comments across the package.
- **Version reporting:** `GET /v1/health` and `GET /v1/meta` (and the OpenAPI
  `version` field) now report the api's own version, plus a new
  `aggregate_version` field carrying the wrapped library version.
  `HealthResponse` / `MetaResponse` gained the `aggregate_version` field.
- Pointed the web build output at the renamed package: `web/package.json`,
  `web/vite.config.js`, and the `scripts/build-web.{ps1,sh}` headers now target
  `src/aggregate_api/static/`.
- **Parse-error path fix:** tracked an upstream `aggregate` change — a DecL parse
  failure now attaches its structured `ErrorReport` as `exc.report` and raises
  with `from None` (empty `__cause__`) rather than chaining the Lark
  `UnexpectedInput`. `routes/objects.py` now recognizes a parse error by either
  convention, so parse errors again audit as `parse_error` and return HTTP 422
  with the structured report (was misclassifying them as `build_error` with a
  flat string body).

## 1.0.0a1

Initial extraction and scaffolding.

- Extracted the FastAPI service and web SPA verbatim from the `aggregate` repo
  (last good state: commit `6f828ce`, before the `473bcd8` deletion) into a
  standalone project.
  - Python backend: `src/aggregate_api/` (was `src/aggregate/api/`) and its
    `routes/` + committed `static/` icons.
  - Web SPA: `web/` (Vite + Bootstrap 5 + CodeMirror 6), verbatim.
  - Tests: `tests/` (was `tests/api/`), verbatim.
  - Build scripts: `scripts/build-web.{ps1,sh}`, verbatim.
- Added project scaffolding: `pyproject.toml` (package `aggregate_api`, console
  script `aggregate-api`, `aggregate` as a dependency), `.gitignore`,
  `README.md`, `CLAUDE.md`, this `CHANGELOG.md`, and `dev/TODO.md`.

**Not yet runnable.** This release is a faithful copy in the new layout; the
package directory was renamed to `aggregate_api` but file *contents* are
unchanged, so internal `aggregate.api` self-references and the web build's
output path still point at the old location. `dev/plan-0001-bootstrap-standalone.md`
makes it import, run, and pass tests (→ 1.0.0a2).
