# Plan: the Lab's All rows switch, the library in Excel, whole frames by URL, readable argument errors

Five steps, one bump each. Drafted 2026-10-17 after kicking the tires on 1.21.0
in desktop Excel and in the Lab. Status: **FINAL, ruled 2026-10-17 (see Rulings
at the end), ready to execute.**

## Goal

Two clients, one afternoon of findings.

**The Lab.** 1.19.0 gave More / Density and Reinsurance / Density an All rows
view behind a two-button segmented control above the table. Two things are
wrong with it. It takes about nine seconds to show 65,536 rows that csv-viewer
(the app built on the same csv-grid) shows instantly from the same CSV, and the
author finds the two buttons horrible. The first is a mounting mistake, the
second is a control in the wrong place: this is a page-wide preference like
Tables and Perspective, and it belongs in the header menu with a keystroke.

**Excel.** The add-in (`excel/`, served at `/excel`, functions under the `AGG.`
namespace) can build a program and read exhibits and quantiles from it. Tire
kicking on 2026-10-17 found four gaps, all small, all Excel-side except one
route:

- **The library is invisible.** Every program a workbook uses has to be typed.
  The server carries 198 library entries (`GET /v1/examples`), and the Lab's
  Examples menu is built on them, but no function reaches them. The author's
  ask: `AGG.LIBRARY("Capstone.Gross")` gives a handle to the entry, and
  `AGG.LIBRARY()` spills the whole list, both taking an optional database stem.
- **Whole frames need a URL nobody can type.** A density frame is 65,536 rows,
  loaded through Power Query rather than spilled (`excel/README.md`, "Whole
  frames through Power Query"). The From Web dialog needs the CSV URL with the
  object id in it, and the refreshable query is M code. Both need to be handed
  to people ready to paste. There is also no way to ask which frames an object
  has: the frame route's 404 is the only listing.
- **`AGG.Q` refuses p = 0 and p = 1.** Both are meaningful (the library's `q(0)`
  and `q(1)` answer, the support's ends), and both are refused on each side with
  "strictly inside (0, 1)".
- **Argument errors are unreadable.** 1.21.0 made a refused *program* return
  `#DECL!` and the reason as cell text, because the author runs Excel with error
  indicators off and a `#VALUE!` message shows only on hover. Errors the add-in
  raises itself (a bad p, a block number past the exhibit's last) still go the
  `#VALUE!` way and so cannot be read.

## Current behavior, with the files

**The Lab (`web/src/`).**

- `main.js`, section "The density tables: Display grid or All rows" (about line
  3567): `_densityRows` (`'display'` or `'all'`, not persisted),
  `densityRowsStrip(group, reload)` builds the segmented control,
  `loadAllRows(paneId, which, leaf, fallbackCols)` asks `frame/{which}/shape`,
  runs `allRowsPlan` (`all-rows.js`, the 3.5 million cell budget) and mounts the
  grid on `{url}` so csv-grid fetches and parses the CSV in its worker.
  `loadMoreDensity` and `loadReinsFrame` branch on `_densityRows`;
  `loadDensityLeaf(leaf)` reloads one leaf in the current view. Only these two
  leaves show a density frame: More / Exact is a chart, and an nttagg's exact
  columns ride inside `density_df` (`DENSITY_COLS_BY_KIND`).
- **The mounting mistake.** `loadAllRows` mounts with
  `renderCap: shape.rows` and no bounded height. csv-grid virtualizes rows only
  when its scroll box has a bounded height (`maxRows` or `height`: it measures
  one row, renders the window in view and swaps rows on scroll; see
  `_computeWindow` and `_windowed` in `node_modules/csv-grid/dist`). With no
  height it renders `min(rows, renderCap)` table rows into the DOM, so 65,536
  `<tr>` elements are built at once. That is the eight seconds the fast-frames
  log attributed to parsing; the parse is in the worker and fast. More /
  Density's Display grid passes `maxRows: 25` and so windows already;
  Reinsurance / Density's Display grid passes `renderCap: 8192` with no height
  and has the same fault at a smaller scale. csv-grid shows nothing while its
  `fetch` runs, and `setData` returns a promise that resolves when the grid is
  installed.
- The page-wide table preferences: `_tableView` and `_perspective` (about line
  2156), persisted in `localStorage`, set from the header dropdown's Tables and
  Perspective sections (`index.html` about line 109, `menu-check-item` buttons
  with `data-table-view` and `data-perspective`), synced by
  `syncPreferenceMenu`, and bound to Ctrl+Shift+U and Ctrl+Shift+V by
  capture-phase `keydown` handlers that stop propagation so CodeMirror never
  sees them (the comment above `cycleTableView` explains why capture is the
  whole trick). `setPerspective` goes through `refetchTables`, which clears
  every pane and reloads the active tab.

**Excel.**

- `excel/src/functions/functions.ts` holds the five functions (`VERSION`,
  `BUILD`, `EXHIBITS`, `EXHIBIT`, `Q`) and the Office and network layer:
  `request`, `postBuild`, `buildOnce` (memo plus in-flight sharing),
  `handleOf`, `readObject` (rebuilds an evicted object from the workbook's
  recipe table), `DeclRefusal` and `rowsOrRefusal` (the `#DECL!` text path).
  `functions.json` is generated from the JSDoc by the metadata plugin, so a
  signature change means `npm stop` and `npm start` for a sideloaded add-in and
  a manifest reinstall for an installed one.
- `excel/src/functions/core.ts` is the pure logic, tested by
  `excel/test/core.test.ts` under `node --test`: `programOrHandle`, `joinDecl`,
  `probabilities` (the `(0, 1)` check, line 293), `flattenExhibit` (raises the
  block-count error), `errorMessage`, `declErrorText`, `isDeclError`,
  `isProgramRefusal`, `DECL_ERROR = "#DECL!"`.
- `excel/src/taskpane/taskpane.html` and `taskpane.ts`: an About page listing
  the functions and showing the server version. It fetches `/v1/meta` itself
  rather than importing the functions module (webpack bundles the entries
  separately; an import would run a second copy with its own memo).
- `src/aggregate_api/routes/objects.py`: `_CSV_FRAMES` (line 2642) maps the
  thirteen frame names to resolvers; `GET /objects/{oid}/frame/{which}.csv`,
  `.parquet`, `/shape` and the table-document form share `_frame_or_404`, whose
  404 for an unknown name lists the valid ones. `GET /objects/{oid}/quantiles`
  (line 2979) refuses `p` outside `(0, 1)` at line 3028.
- `src/aggregate_api/routes/examples.py`: `GET /v1/examples` returns `items`
  (`name`, `kind`, `tags`, `note`, `decl` as the file spells it, `pills`) in
  file order, with `?database=<stem>` for another shipped `.agg` file;
  `GET /v1/examples/databases` lists the stems, default first. Library names
  are unique within a file (`Underwriter._check_library_names_unique`).
- Builds resolve against the process base only (`library.agg` or
  `AGGAPI_LIBRARY`). An entry in another database builds if its program is
  self-contained; one that refers to a sibling in that file is refused with the
  `recipe_not_found` message naming the file (objects.py line 770).

## The steps

### [lab-all-rows-switch] All rows as a page-wide switch, and a grid that windows

**The grid.** `loadAllRows` mounts with a bounded viewport and no `renderCap`
override, so csv-grid windows the rows: `maxRows` chosen to fill the pane
(about 30 at the default row height; measure, and prefer a CSS `height` on the
grid host tied to the pane if `maxRows` reads wrong on a tall window). The
grid's own scrollbar is the one scrollbar for the table, as it already is on
More / Density's Display grid. Reinsurance / Density's Display grid takes the
same `maxRows: 25` as More / Density's. Expected: click to grid in about a
second locally, the fetch dominating.

**The loading line.** While the grid fetches, the host shows one muted line,
"Loading 65,536 rows by 12 columns", from the shape already in hand; `setData`'s
promise resolving is when it goes (csv-grid installs the grid into the host,
which replaces the line, but the line is removed explicitly so a failed fetch,
which csv-grid reports in its own error box, does not leave it standing).

**The switch.** `_densityRows` becomes a persisted page-wide preference like
the other two (`aggapi.densityRows`, default `'display'`), set from three
places that all agree:

- A new checked item at the end of the header dropdown's Tables section, below
  Interactive and above the divider: **All rows in density tables**, hint
  "every row of density_df, scroll to read". It is a `menu-check-item` with
  `data-density-rows`, ticked when on, and `syncPreferenceMenu` takes it on.
  One item that toggles, because the preference is boolean; the Tables trio
  stays a choice of three.
- **Ctrl+Shift+A** toggles it, the A for All, bound exactly as Ctrl+Shift+U is:
  `ev.code === 'KeyA'`, capture phase, `preventDefault` and `stopPropagation`,
  since CodeMirror binds plain Ctrl+A (and our emacs `Ctrl-a`). The browser
  check at execution: Chrome on Windows uses Ctrl+Shift+A for its tab search,
  and whether a page may take it first is to be verified in Chrome, Edge and
  Firefox. If a browser keeps it, record the divergence and fall back to a
  free right-hand letter, the author's rule for these shortcuts; `L` for all
  rows is the first candidate.
- The footer hint beside "Ctrl+Shift+U tables" gains "Ctrl+Shift+A all rows",
  and the help panel's Tables and charts section gains a sentence.

Setting it goes through `refetchTables`, the Perspective path: the density
leaves need a different route, not a redraw, and the panes behind the other
tabs hold the old view too. Cheap, the document routes revalidating to 304s.

**What goes.** `densityRowsStrip`, `DENSITY_ROWS_VIEWS` and the header row
above the two density tables. `replacePaneTable` keeps its `header` parameter
(it is generic) but no caller passes one; note that in its docstring.

**The lede.** Under All rows the density lede still says the frame is binned.
`ledeFor` takes the view into account for the two density leaves, or the lede
is suppressed under All rows and the budget note stands in its place; whichever
reads better in the code, recorded.

Both density leaves and the nttagg exact columns are one setting, so every
density table behaves the same. Tests: `web/test/all-rows.test.js` keeps its
seven; a test over the preference's read and write with a stubbed
`localStorage` if the module exposes it cleanly, else the acceptance below is
the check. The fast-frames log's finding ("csv-grid takes about 8.5 s to parse
and render") is corrected in `dev/done/plan-fast-frames.md` with a dated note
and the `dev/TODO.md` entry's Findings line follows.

### [readable-arguments] One readable prefix, and `p` on the closed interval

Both sides accept `0 <= p <= 1`. The route's check at objects.py line 3028
becomes `0 <= v <= 1` with the message "every p must lie between 0 and 1
inclusive"; `probabilities` in core.ts likewise. A test in
`tests/test_quantiles.py` (or wherever the route's tests live; verify) asks for
`p=0,1` on the dice example and gets 3 and 18.

Errors the add-in raises about its arguments return as cell text under the same
prefix as a refused program, through the existing `DeclRefusal` path:

- `AGG.Q` with a bad p: `every p must lie between 0 and 1 inclusive; got 1.5`.
- `AGG.EXHIBIT` with a block past the last: the flattener's own message
  ("block 3 of an exhibit with 2 blocks", verify the wording in
  `flattenExhibit`).
- `AGG.EXHIBITS`, `AGG.EXHIBIT`, `AGG.Q` with an argument that is neither a
  handle nor a program (`MESSAGES.notAHandle`).

`fail()` stays for transient failures only: unreachable, rate limited after the
retries, timed out, server fault, and `MESSAGES.upgraded` (the recalculate
instruction, which must stay an error so dependents do not compute on it).

**One prefix for every readable refusal: `#AGG!`** (ruled). `DECL_ERROR`
becomes `REFUSAL = "#AGG!"` in core.ts, and the names follow the wider meaning:
`isDeclError` to `isRefusal`, `declErrorText` to `refusalText`, `DeclRefusal`
to `Refusal`. The value changes in one place; the 1.21.0 README paragraph and
the pane are reworded to say a refused program *or argument* comes back as
`#AGG!` text. `#DECL!` existed for one unreleased day, so nothing is kept for
compatibility.

Tests: `core.test.ts` covers the closed interval and the text form of each
local refusal. Gate: pytest, web `npm test`, excel `npm test`, typecheck, lint.

### [frames-route] Which frames an object has, and the URL to load one

**Server.** `GET /v1/objects/{oid}/frames` returns
`{"frames": [{"name", "rows", "columns"}, ...]}` for the frames in
`_CSV_FRAMES` the object actually answers, in `_CSV_FRAMES` order. It resolves
each frame the way `/shape` does and skips the ones that raise the 400 or 404
`_frame_or_404` would raise (no reinsurance, not a PnL, not sharpened). Model
`FramesResponse` with `FrameItem(name, rows, columns)` in `models.py`. The
route is declared beside `/shape`, ahead of `/frame/{which}`. Cost is one pass
over thirteen resolvers, all attribute reads or cached properties on a built
object; a test times it under 100 ms on the dice example and asserts the
reinsurance frames are absent without reinsurance and present with it.

**Add-in.**

- `AGG.FRAMES(handle)` spills `name | rows | columns`, one row per frame, the
  header row first, in the same style as `AGG.EXHIBITS`. `handle` is a cell or a
  range, like the other three.
- `AGG.FRAMEURL(handle, which, [format])` returns the absolute URL that loads
  the frame: `<base>/v1/objects/<id>/frame/<which>.<format>`, `format` `csv`
  (default) or `parquet`. `base` is `__API_BASE__` when the build set one, else
  the page's own origin (`globalThis.location.origin`), which in production is
  the server the add-in came from. A program in place of the handle builds it
  first, so the id exists when the URL is pasted. An unknown `which` returns the
  server's 404 text under the prefix, which lists the valid names.

`core.ts` gains `frameUrl(base, id, which, format)` and the pure part of the
spill; both tested.

### [library-functions] The library from a cell

Two functions over `GET /v1/examples`, which the add-in fetches once per
runtime per database and keeps (198 entries, about 150 KB; a `Map` keyed by the
database stem, `""` for the default).

- `AGG.LIBRARY([name], [database])`.
  - With `name`: the handle of that entry, built from the entry's `decl` text
    (the program as the file spells it, trailers included) through `buildOnce`
    with the default grid, so the memo, the recipe table and the in-flight
    sharing all apply and the cell behaves exactly as `AGG.BUILD` of the same
    text would. Posting the text rather than the `kind.Name` reference means
    an entry from a non-default database builds too when it is
    self-contained; one that refers to a sibling in its file gets the server's
    `recipe_not_found` text, which names the file.
  - Without `name`: a spill of `name | kind`, header first, in file order
    (ruled: no note and no program text; `AGG.PROGRAM` carries the text, and a
    198-row spill stays two narrow columns).
  - `database` is a stem from `GET /v1/examples/databases`. Omitted or empty
    means the default. An unknown stem returns the server's 422 text under the
    prefix, which points at the listing.
  - An unknown `name` returns `no library entry named X; AGG.LIBRARY() lists
    them` as text. Matching is exact on `name`; names are unique per file.
- `AGG.PROGRAM(name, [database])` returns the entry's DecL text, so a program
  can be dropped into a cell, read, edited and passed to `AGG.BUILD`. Newlines
  stay (Excel shows them with Wrap Text). Ruled wanted: it is how a library
  entry becomes a starting point for editing, which is what the Lab's Examples
  menu does.

`core.ts` gains the pure lookup (`libraryEntry(items, name)`, the spill rows)
and tests over a captured fixture of a few items (`excel/test/fixtures/`, by
the existing capture script `dev/capture_excel_fixtures.py`, extended).

### [pane-frames] The task pane hands out the URL and the query

The task pane grows a **Whole frames** section under the function list:

- **Handle**: a text box, prefilled from the selected cell when the pane opens
  and on a **Use selected cell** button (`Excel.run`, read the active cell's
  value; requires the `ExcelApi 1.1` set in the manifest's `<Requirements>`
  beside `SharedRuntime 1.1`; verify the shared runtime already implies it, and
  add it if not). A program in the cell is accepted and built, as everywhere.
- **Frame**: a dropdown filled from `/frames` for that handle, `density_df`
  selected when present.
- **From Web**: a read-only box with the CSV URL and a **Copy** button, then
  three numbered steps: Data, From Web, paste, Load. Below it one line on the
  `-inf` cells: right-click the column, Replace Errors, leave the value empty.
- **Refreshable query**: a read-only box with the M query from
  `excel/README.md`, `base` and the frame name filled in, and a **Copy**
  button, then the steps: Data, Get Data, From Other Sources, Blank Query,
  Advanced Editor, paste, Done. The query reads the program from a cell named
  `Decl`, as the README's does, so the pane says so.
- Copy uses `navigator.clipboard.writeText`, falling back to selecting the
  box's text so Ctrl+C works, since the clipboard API can be refused in an
  add-in web view. The button's label changes to **Copied** for two seconds.

The pane keeps reading `/v1/meta` itself and gains its own small fetch helper
for `/frames`; it does not import the functions module (see Current behavior).
The function list in the pane and in `excel/README.md` gains the four new
functions.

No pure logic beyond the URL and query builders, which live in `core.ts` so
`node --test` covers them; the pane imports those two from `core.ts`, which is
import-free and safe to share.

## Not in this plan

- An **Insert frame** button writing the frame into a new sheet through
  Office.js. It is the macro the author would have written in VBA, and it is
  feasible (chunked writes, a few seconds for 65,536 by 40), but the two paste
  routes cover the need with a refreshable result, which an inserted table is
  not. Revisit if the paste routes prove too fiddly for other people.
- `AGG.FRAME(handle, which)` spilling a frame. A density frame is not a spill;
  the smaller frames (`summary`, `stats_df`, `tail_df`) are exhibits already.
- Power Query creating itself. Office.js exposes a workbook's queries read-only.
- The Lab's density pages offering the From Web URL with a Copy, for people who
  go from the Lab to Excel. Cheap, and a separate tweak.
- Making All rows the default. Instant locally once the grid windows, but on
  the public server every density open would be a multi-megabyte download, and
  on a phone that is the page. The switch is persisted, so a reader who wants it
  sets it once.

## Acceptance

**The Lab, in Chrome against the local server, after `build-web.ps1` and a
hard refresh.** On a BasicBook build at log2 16: More / Density opens on the
display grid with no control row above the table. Ctrl+Shift+A, or the menu
item, reloads it as 65,536 rows inside about a second with a "Loading" line
first, the grid scrolls the whole frame, and the lede no longer says binned.
Reinsurance / Density on a program with a cession follows the same setting.
The tick in the menu follows the keystroke and survives a reload of the page.
Ctrl+Shift+A inside the editor does not select the program or change it.

**Excel, in desktop Excel against the local server.** After each step,
`npm stop` and `npm start` in `excel/`, then in a workbook:

1. `=AGG.Q(C27, {0, 0.5, 1})` spills three numbers; `=AGG.Q(C27, 1.5)` shows
   `#AGG! every p must lie between 0 and 1 inclusive; got 1.5` as text;
   `=AGG.EXHIBIT(C27, "summary", , 9)` shows the block-count text; a typo in
   C27 shows `#AGG! line 1, col N: ...` in every cell reading it.
2. `=AGG.FRAMES(C7)` spills the frames of the Capstone PnL with their shapes;
   `=AGG.FRAMEURL(C7, "density_df")` gives a URL that, pasted into Data, From
   Web, loads 65,536 rows with `loss` first.
3. `=AGG.LIBRARY()` spills 198 rows of name and kind; `=AGG.LIBRARY("Capstone.Gross")` gives a
   handle that `AGG.EXHIBIT` reads; `=AGG.LIBRARY("Nope")` and
   `=AGG.LIBRARY("Capstone.Gross", "nope")` show readable text;
   `=AGG.PROGRAM("BasicBook")` shows the program.
4. The pane's Whole frames section fills from the selected handle cell, both
   Copy buttons put the right text on the clipboard, and both paste routes load
   the frame.

## Rulings (author, 2026-10-17)

The choices below are decisions, not proposals.

- **All rows is a switch, not a pair of buttons:** a page-wide preference in
  the header menu under Tables, with Ctrl+Shift+A, in the manner of Ctrl+Shift+U.
  Display grid stays the default, because on the public server a whole
  portfolio frame is a 16 MB download. Every density table follows the one
  setting.
- **One prefix for every readable refusal, `#AGG!`**, covering a refused
  program and a bad argument alike. `#DECL!` goes.
- **`AGG.LIBRARY()` spills `name | kind` only.** No note, no program text.
- **`AGG.PROGRAM(name, [database])` is wanted.**

## Execution log

Written as the steps run, one entry per bump, every divergence recorded.

### Review, 2026-10-17

- Plan facts against the code: every named file, line and symbol holds, with
  one slip. The helper the plan calls `_frame_or_404` is `_named_frame` in
  `objects.py`; same behavior. The quantiles tests live in
  `tests/test_objects.py`, as the plan allowed.
- `q(0)` and `q(1)` answer finite values on the installed library (dice: 3 and
  18; a lognormal: 0 and the grid's last bucket), so the closed interval needs
  no infinity handling on the wire.
- `V:/worktrees/dev-files.md`, the control list the project skill names, does
  not exist on this machine (the worktrees directory holds the library checkout
  and the release scripts only). No row to update.
- The tree carries the author's uncommitted edits to `CLAUDE.md`, `dev/TODO.md`,
  `excel/README.md`, `.claude/skills/execute-plan/SKILL.md` and
  `dev/done/plan-1.13.4-warm-library-at-startup.md`. They stay behind; the
  files this plan also touches are staged hunk by hunk.
- Name chosen at review: the pure URL builder in `core.ts` is
  `frameDownloadUrl`, not the plan's `frameUrl`, because `frameUrl` is the
  natural TypeScript name for the `AGG.FRAMEURL` custom function in
  `functions.ts`, which imports from `core.ts`.

### [lab-all-rows-switch], 1.22.0, 2026-10-17

- The preference helpers (`DENSITY_ROWS_KEY`, `readDensityRows`,
  `writeDensityRows`) and the loading line (`loadingLine`) live in
  `web/src/all-rows.js`, so `node --test` covers them (four tests added to
  `web/test/all-rows.test.js`). `main.js` holds `_densityRows`,
  `setDensityRows`, `toggleDensityRows`, the menu sync and the keystroke.
- `mountGrid` now constructs the grid empty and calls `setData` itself,
  keeping the promise as `grid.loaded`; the constructor would have dropped it.
  Same behavior otherwise.
- The lede: `ledeFor` took an optional `hint` override rather than the lede
  being suppressed. Under All rows it reads "every row of the frame as the
  library built it, nothing binned".
- `maxRows: 25` on both views of both leaves (`DENSITY_GRID_ROWS`), not
  measured to fill the pane: 25 rows is 756 px at the default row height,
  which fits the pane on the author's display, and it matches what More /
  Density's Display grid already used. The Display grids keep `renderCap: 8192`
  as a fallback for a pane measured while hidden, where csv-grid cannot
  window; All rows passes none.
- csv-grid 3.10.1 writes its status line before applying `maxRows`, so a grid
  that then windows keeps "showing rows 1–2,048" in the status. `loadAllRows`
  calls `grid.renderStatus()` once the load settles. **Upstream ask for
  csv-grid:** `_applyHeight` should refresh the status after it re-renders.
- Chrome on Windows: Ctrl+Shift+A reaches the page ahead of Chrome's tab
  search, toggles the view inside the focused editor without selecting the
  program, and the tick survives a reload. Edge and Firefox not checked, the
  author's. Timings against the local server, BasicBook at log2 16: Display
  grid to All rows in 1.3 s, loading line visible at 60 ms; Reinsurance /
  Density on AggregateStopLoss, 65,536 by 10, the same.
- `dev/done/plan-fast-frames.md` carries a dated correction of the 8.5 s
  finding, and the `[Fast-Frames]` Findings line in `dev/TODO.md` follows.

### [readable-arguments], 1.23.0, 2026-10-17

- The plan's rename kept `refusalText(status, body)` for the server form and
  added `localRefusalText(message)` for the add-in's own sentences; both are
  the one prefix. In `functions.ts` a `refuse(message)` helper throws the
  `Refusal`.
- **Wider than the plan's list, by the plan's own rule** ("`fail()` stays for
  transient failures only"): a GET's 4xx other than the cache's own 404 and
  429 is a `Refusal` carrying the server's sentence, so `AGG.EXHIBIT(h,
  "nope")` reads the exhibit list and, in the next step, `AGG.FRAMEURL` with an
  unknown frame reads the frame list. `MESSAGES.unknownHandle`,
  `MESSAGES.programIsValue` and `MESSAGES.emptyProgram` are refusals too
  (`AGG.BUILD` of an empty range returns the text). A rebuild from the recipe
  table that the server refuses is a `Refusal`; one that faults stays an
  error.
- `probabilities` runs inside `rowsOrRefusal` now, so a bad `p` spills the
  text rather than throwing `#VALUE!` before the spill began.
- The quantiles route's `p` description reads `[0, 1]`; the refusal test
  checks the new message and a new test asks for `p=0,1` on the dice.
- The task pane had no `#DECL!` sentence to reword; it gained one on `#AGG!`.
- Gates: pytest, web `npm test`, excel `npm test` (25), `npm run typecheck`,
  `npm run lint` (one prettier line break fixed).
