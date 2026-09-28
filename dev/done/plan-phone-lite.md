# Plan: the phone lite entry

A second, stripped entry to the aggregate Loss Lab for phones. The occasion is
a live demonstration on **2026-10-16**: the audience will be told to use a
widescreen device, and a number of them will use a phone anyway. Today those
phones get the full app, which assumes a wide viewport, a keyboard, and hover.
The lite entry gives them a read-mostly showcase instead: pick a curated
example, press Build, see the facts, one chart, and one small table.

Target versions: **a168** and **a169**, two bumps, see the steps below. Device
punchups after the author kicks the tires are ordinary further work (a170 and
on, as needed).

**`dev/prototypes/phone.html` is the specification**: open it before reading
further. It is a standalone page, no build step and no server, drawn in the
app's own tokens (`site.css` :root), with the Capstone programs as
`library.agg` spells them. Its three frames are the lite page's three states:
landing, built, and the example sheet. The callouts on each frame record the
per-element reasoning and are not repeated here.

### What is settled

Agreed in conversation 2026-09-28. Each is a decision, not a suggestion:

| settled | where it lands |
|---|---|
| a phone user never types DecL: the example picker is the primary control | `[Lite-Shell]` |
| the program is displayed read-only, collapsed to its teaching lines | `[Lite-Shell]` |
| one URL, a boot-time branch, no user-agent sniffing, no m-dot redirect | `[Lite-Shell]` |
| the predicate is `matchMedia('(max-width: 640px) and (pointer: coarse)')` | `[Lite-Shell]` |
| `?full=1` forces the full app, `?lite=1` forces lite (desktop testing) | `[Lite-Shell]` |
| a second Vite entry (`lite.html` + `lite.js`); `main.js` is not touched | `[Lite-Shell]` |
| the chart rides the live chartdoc route and the existing adapter | `[Lite-Reading]` |
| one static table, never the interactive grid | `[Lite-Reading]` |
| the examples list is a bottom sheet, notes visible (no hover on touch) | `[Lite-Reading]` |
| absent by design: editor, Re/Pricing/PnL/Bounds/More, csv-grid, 3-D surface | everywhere |
| curated chips: `DiceOfDice`, `BasicBook`, `Capstone.Gross`, `Capstone.XOL`, `Capstone.FullProgram`, easy to change | `[Lite-Shell]` |
| the chart's control apparatus is hidden via `lite.css`, default scales (KISS) | `[Lite-Reading]` |
| tiles are Mean, CV, P99, and the build clock; the prototype's skew tile is dropped | `[Lite-Shell]` |
| the csv-grid bundle weight rider on `tables.js` is a non-issue, accepted | `[Lite-Reading]` |

The last four were ruled by the author 2026-09-28, closing the plan's open
questions; the curated list is a starter list, and the code must keep it a
one-line edit.

A note on the chart dependency that shaped an earlier draft of this thinking:
the aggregate repo's `dev/TODO.md` still says the SPA draws no charts until the
IR 3 adapter work lands. That is stale. The adapter moved to
`CHART_IR_VERSION = 3` at **a152** ("the chart adapter draws a tower") and the
tower work ran through a156; `chartdoc-to-echarts.js:48` carries the pin and
line 2185 the refuse-newer guard. The chart pipeline is fully live. The TODO
entry should be corrected upstream when that file is next touched.

---

## 1. Where the code stands today

One entry. `index.html` loads `src/main.js` as a module; `main.js` (about
4,000 lines) imports Bootstrap, CodeMirror, csv-grid and echarts, and wires
itself to the desktop DOM at import time. There is no mobile branch anywhere:
a phone gets the full app, shrunk.

Everything the lite page needs is already served, none of it new:

- **Examples.** `GET /v1/examples` returns every library entry once, in file
  order. Each `ExampleItem` carries `name`, `kind`, `tags`, `note`, `pills`,
  and crucially `decl`, the program as its `.agg` file spells it
  (`Recipe.as_read`), so the program card shows the author's own spelling.
  `examples.js` exports a DOM-free loader (`loadExamples`, cached) and pure
  search/filter helpers (`rankMatches`, `applyFilters`), tested without a DOM
  in `web/test/example-*.test.js`.
- **Build.** `POST /v1/objects` returns the slim `BuildResponse`: `id`,
  `kind`, `name`, `bs`, `log2`, `mean`, `cv`, `validation`, `elapsed_ms`,
  `has_reins`, `value_type`, plus the capability block. That is the facts
  strip and most of the tiles with no second fetch.
- **Quantiles.** `GET /v1/objects/{id}/quantiles?p=...` answers VaR at any
  probability list (built for Quick Re, public since).
- **The chart.** `caps.primaryChart` names the object's headline chart;
  `mountChart(host, {id, chart})` in `charts/mount.js` fetches the chart
  document and adapts it, placeholder first, style fetched as a bonus. This is
  exactly what the full app's Overview plot leaf does (`loadOverviewPlot`,
  `main.js:2178`).
- **The table.** `GET /v1/objects/{id}/exhibit/tail` returns the
  return-period ladder as a table document with the library's caption and
  formatting; `tables.js` renders a document statically via the walker served
  from `/v1/assets/gt-render.esm.js` (same install as the emitter, no version
  skew).

The build already outputs to `../src/aggregate_api/static/`, which the FastAPI
`StaticFiles` mount serves at `/`. A second HTML entry lands in the same
directory and is served with zero backend change.

## 2. The change

### `[Lite-Shell]` a168: the entry, the branch, the landing, Build

New files:

- **`web/lite.html`**: the lite shell, frame 1 of the prototype: brand line
  with the two versions (from `/v1/meta`), the horizontally scrolling chip row
  of curated examples, the collapsed read-only program card, the full-width
  Build button, the full-site footer link.
- **`web/src/lite.js`**: the lite entry module. Imports `api.js`,
  `session.js`, `config.js`, and `loadExamples` from `examples.js`. Wires:
  chips populate from a `CURATED` array of names at the top of the file (the
  starter list from the settled table; editing it is one line), each resolved
  against the examples payload, and a name that stops resolving logs and
  drops rather than breaking the row. Chip tap swaps the program card, card
  tap expands/collapses, Build posts the card's `decl` and renders the facts
  strip and the four tiles: Mean and CV off the response, P99 off one
  `quantiles` call, and the build clock off `elapsed_ms`. No Bootstrap, no
  CodeMirror.
- **`web/src/styles/lite.css`**: standalone, small. Lifts the tokens block
  from `site.css` :root (color, type scale, the house red as selection mark)
  and carries the phone layout from the prototype. Deliberately not importing
  `site.css`, which is 1,500+ lines coupled to Bootstrap's presence.

Edits to existing files, the entire contact surface with the full app:

- **`web/vite.config.js`**: `rollupOptions.input` gains the second page:
  `{ main: 'index.html', lite: 'lite.html' }`. Nothing else moves; the
  `manualChunks` vendor split applies per-page automatically and the lite page
  simply never references the codemirror or bootstrap chunks.
- **`web/index.html`**: a small inline script in `<head>`, before the module
  script, so the branch runs before any bundle is fetched:

  ```html
  <script>
  (function () {
      var q = new URLSearchParams(location.search);
      if (q.has('full')) return;
      if (q.has('lite')
          || matchMedia('(max-width: 640px) and (pointer: coarse)').matches) {
          location.replace('./lite.html' + location.search + location.hash);
      }
  }());
  </script>
  ```

  Relative target, matching `base: './'`, so it survives a sub-path deploy.
  The predicate requires narrow viewport AND coarse pointer, so a narrow
  desktop window and a touch-screen laptop both stay on the full app.
  `lite.html` carries the mirror escape: the footer link is `./?full=1`, and
  `lite.js` honors `?full=1` the same way in case the page is reached
  directly.

Deliverable: on a phone (or with `?lite=1`), the root URL lands on lite,
chips populate, Build round-trips, and the facts render. The full app is
byte-identical in behavior. CHANGELOG entry, one paragraph.

### `[Lite-Reading]` a169: the chart, the table, the sheet, the failures

- **The chart.** `lite.js` calls the same `mountChart` as the Overview leaf,
  with the build response's `caps.primaryChart`. The control apparatus below
  the canvas (the a163 to a167 strip) is hidden by `lite.css`, ruled 2026-09-28:
  the chart ships the emitter's default scales, and no shared code changes for
  it. Chart failure never blocks the page: the existing `fetchFailed` /
  `notDrawable` cards render in its place, exactly the Overview's rule.
- **The table.** The `tail` exhibit document rendered by `tables.js`'s static
  walker, styled compact by `lite.css`. Reusing `tables.js` pulls in
  `grid.js` (for `registerPaneTeardown`) and with it csv-grid and its CSS.
  Bundle weight, not behavior; ruled a non-issue 2026-09-28.
- **The sheet.** Frame 3 of the prototype: a bottom sheet listing the whole
  library (name, note clamped to two lines, kind pill), with the search box
  wired through `rankMatches` over the same haystack the desktop menu uses.
  Picking an entry sets the program card and closes the sheet. Plain DOM plus
  `lite.css`; no Bootstrap offcanvas.
- **The failures.** Three states, all visible in the prototype's idiom: a
  build in flight (Build disabled, elapsed clock running), a parse or
  validation failure (the error message rendered in the program card's
  vocabulary; `errorMessage` from `api.js` already writes the sentence), and
  a rate-limit response (the retry-after line). No toast library, no modal.

Deliverable: the built state matches frame 2 of the prototype end to end.
CHANGELOG entry, one paragraph.

### After landing: `[Lite-Device]` punch list

The author kicks the tires on a real phone (iOS Safari has opinions about
sticky headers, viewport height, and momentum scroll that DevTools emulation
does not show). Findings become ordinary tweak bumps. Budget an hour on a real
device well before 2026-10-16; the deploy the demo uses must also serve the
api to cell-network phones, which is a deployment fact outside this plan.

## 3. Roads not taken, recorded so they are not reopened by accident

- **A `mountChart` apparatus option.** Considered for keeping the prototype's
  lin/log toggle on lite; rejected 2026-09-28 for the CSS hide (KISS, zero
  shared-code contact). If a later demo wants the toggle, an additive
  `apparatus: 'minimal'` option on `mountChart` is the route, as its own
  reviewed change.
- **A skew tile.** Drawn in the prototype; costs a stats fetch the page
  otherwise does not make. Dropped 2026-09-28.
- **Lifting `registerPaneTeardown` out of `grid.js`** to keep csv-grid out of
  the lite bundle. Ruled a non-issue 2026-09-28.

## 4. What could break, and why it will not

The full app's exposure is exactly two edits. The Vite input addition is
verified by building and diffing the `index.html` output (the bundle file set
and the nav structure; `node dev/scripts/check-nav.mjs` still passes). The
inline branch script is verified by the acceptance list below; its failure
mode, a false positive bouncing a desktop to lite, is constrained by the
two-condition predicate and always escapable via `?full=1`. Every other
touched file is new, and every shared module is imported read-only.

## 5. Acceptance

- `cd web; npm run build` succeeds; `npm test` passes untouched;
  `node dev/scripts/check-nav.mjs` passes.
- Desktop Chrome, wide window: the root URL loads the full app, identical
  behavior. Narrow the window to 500 px: still the full app (fine pointer).
- Desktop with `?lite=1`: the lite page; every chip renders its program;
  Build shows facts, tiles, chart, table; a deliberately broken program shows
  the parse error in place; the footer link returns to the full app with
  `?full=1`.
- Real phone over the network: the root URL redirects to lite; the frame-2
  reading renders for `Capstone.Gross`; the sheet opens, searches, and picks;
  `?full=1` yields the full app.
- The lite page's network tab shows no codemirror and no bootstrap chunks.

---

## Execution log (2026-09-28, a168 and a169)

Executed as ruled. Divergences and findings, recorded as made:

- `KIND_LABEL` and `validationState` are small local copies in `lite.js`: both
  live inside `main.js`, which this plan rules untouched and which imports
  Bootstrap and CodeMirror at module top, so importing them would drag the
  desktop bundle onto the phone.
- `.p-sheet` and `.p-dim` needed an explicit `[hidden] { display: none }` rule
  in `lite.css`: their own `display: flex` / `position: fixed` rules beat the
  `hidden` attribute's UA default. Found in the live smoke, fixed at a169.
- `src/aggregate_api/static/lite.html` was added to `.gitignore`, which ignores
  the built outputs by name rather than by directory.
- No `dev/TODO.md` entry existed for this plan; one was added, marked done, at
  the close.
- `uv sync` could not re-record the editable install at either bump: a running
  `aggregate-api.exe` holds the executable (the documented os error 32 trap).
  `uv.lock` is updated; `/v1/meta` reports a167 until the author stops the
  server and re-syncs.
- Live smoke against a local server (port 8010, desktop Chrome): the root URL
  with `?lite=1` redirects to lite; chips populate and select;
  `Capstone.Gross` builds (mean 18,950, matching the prototype's number);
  the chart draws with the apparatus hidden and the readout legend kept; the
  tail ladder renders static, 20 rows, with the library's caption; the sheet
  opens over 197 entries, ranks a "tower" search, and a pick closes it and
  sets the program; a 422 and a 429 (fetch-intercepted) render the parse
  sentence and the retry-after line in the strip, and a following build
  recovers cleanly; `lite.html?full=1` lands on the full app; the plain root
  URL on a fine pointer stays on the full app. The real-phone hour remains
  `[Lite-Device]`.
