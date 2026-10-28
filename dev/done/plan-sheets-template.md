# Plan: the AGG functions in Google Sheets, as a template spreadsheet

**Status: drafted 2026-10-18. The author ruled D1 to D6 the same day (below). It waits for the author's go, and for `[Build-Single-Flight]` (`dev/plan-build-single-flight.md`) to land first.** Tracked as `[Sheets-Template]` in `dev/TODO.md`.

## Goal

The nine AGG functions the Excel add-in has, working in Google Sheets cells, with the same behavior wherever the two hosts allow it. A colleague gets them by opening one link and pressing Make a copy: no install, no add-on, no store. The author may share that link publicly (LinkedIn). If it gets traction, a Google Workspace Marketplace editor add-on can follow; that is not this plan.

## Background: the Excel add-in, for a reader without context

`excel/` is an Office add-in of Excel custom functions over this repo's API (`https://agg.mynl.com`). Its README (`excel/README.md`) is the user documentation; this summary covers what the Sheets port has to match.

- **Two files.** `excel/src/functions/core.ts` holds the pure logic: no Office.js, no network, only erasable TypeScript and no imports, so `node --test` runs it directly (`excel/test/core.test.ts`). `excel/src/functions/functions.ts` is the Office and network layer around it.
- **Handles.** `=AGG.BUILD(decl)` posts the program to `POST /v1/objects` with `library_references_only: true` and returns a handle `kind.Name#<16 hex id>`. Other functions take the handle, or a program in its place, which they build on the default grid.
- **Pure functions.** An object id hashes what the program means, and references resolve to library entries only. So a cell's value depends on its arguments alone, and programs combine through text the spreadsheet tracks (`"port P " & A1 & " " & B1`).
- **Refusals as text.** A program or argument the server or the add-in refuses comes back as the cell's value, `#AGG! <reason>`, which a reader can see. Only transient failures (unreachable, rate limited, timed out, server fault) and the recalculate instruction stay spreadsheet errors.
- **The recipe table.** Kept in the workbook's document settings, it maps each id to its `(decl, log2, bs)`. When the server has lost an object (evicted, or restarted), the add-in rebuilds it from that table: the same id back means carry on, and a different id means the server changed, so the cell asks for a full recalculation.
- **Per runtime.** A build memo and an in-flight map, so cells sharing a program post it once. A session id goes in the `X-Aggregate-Session` header, which gives each workbook its own rate-limit budget on the public server.
- **Delivery.** The add-in is served by the API itself at `/excel`, every file `no-cache`, so the client is always the server's version.

## How Google Sheets differs

These facts drive every decision below. Sourced from `https://developers.google.com/apps-script/guides/sheets/functions` (read 2026-10-18) unless marked **[spike]**, in which case the first step verifies them.

1. **Every cell evaluation is its own Apps Script execution on Google's servers.** Cells share no memory, so there is no memo map and no in-flight promise.
2. **Calls are synchronous** (`UrlFetchApp.fetch`). A custom function must return within **30 seconds** or the cell shows `#ERROR!`.
3. **Names.** A custom function is a top-level `function NAME()` declaration, cannot end in `_` (which marks a private function), and is a JavaScript identifier, so **no dots**: `AGG.BUILD` cannot exist and becomes `AGG_BUILD`. Only functions with an `@customfunction` JSDoc tag appear in autocomplete, but every top-level function can be called from a cell.
4. **Arguments and results.** A range arrives as a 2D array, a single cell as a scalar, a date as a `Date`, a percentage as a decimal. A returned 2D array spills, and errors if the spill area is not empty.
5. **Services available to a custom function.** URL Fetch works. Spreadsheet is read-only (`get*`, not `set*`). Properties works, except that user properties are the owner's. Cache "works, but is not particularly useful". Whether a custom function may **write** document properties is not stated **[spike]**.
6. **Authorization.** Custom functions never prompt for it. Whether `UrlFetchApp` in a custom function works in a freshly copied sheet, opened by an account that never authorized the script, is contradictory in the sources **[spike]**.
7. **Recalculation** happens only when a referenced argument changes. There is no equivalent of Excel's Ctrl+Alt+F9.
8. **A thrown error** shows `#ERROR!`, with the message on hover only, which is the same unreadability that made Excel return refusals as text. Whether Sheets caches a thrown error, so that a transient failure sticks until the arguments change, is unknown **[spike]**.
9. **Requests come from Google's IP addresses**, not the user's. CORS does not apply. The server's per-address rate limits and the audit's `ip` column see Google's egress pool.
10. **Google cannot reach `localhost`** or the DOOB instance, so the client is developed and tested against `agg.mynl.com`. A change to the Sheets client needs only a push; a server change must be deployed to the VPS before Sheets sees it.
11. **`IMPORTDATA(url)`** loads a CSV from a public URL into the sheet and refreshes on its own schedule. Third-party sources report a cap of about 50 MB per fetch; a spreadsheet holds at most 10 million cells.
12. **A copied spreadsheet carries a copy of its bound script.** That copy never updates, so every copy freezes the client at the version it was copied from.

## Decisions, ruled by the author 2026-10-18

- **D1 Distribution.** A script bound to a template spreadsheet, shared by a `/copy` link. As painless as possible; if it gets traction, upgrade to a Marketplace editor add-on (Workspace add-ons, the newer card-based kind, cannot carry custom functions).
- **D2 Names.** `AGG_` in place of `AGG.`. A workbook moved between Excel and Sheets breaks (`#NAME?`), and that is accepted.
- **D3 One shared core.** `excel/src/functions/core.ts` serves both hosts. DRY.
- **D4 Server single flight first.** `[Build-Single-Flight]` makes simultaneous identical builds one build, since Sheets cannot dedup on the client. It is its own plan and bump, and lands ahead of this one.
- **D5 Rate limits behind Google's egress.** A known issue with no remedy proposed; cross that bridge when it is a real problem. The client still sends the session header, so the per-session limit (30 builds a minute) applies per spreadsheet.
- **D6 Recalculate.** A menu item, AGG, Recalculate AGG cells, stands in for Ctrl+Alt+F9.

## Design

### The functions

| Excel | Sheets | Same behavior, except |
|---|---|---|
| `AGG.VERSION()` | `AGG_VERSION()` | also reports the client's own version, since a copy freezes it (fact 12) |
| `AGG.BUILD(decl, [log2], [bs])` | `AGG_BUILD` | not cancelable |
| `AGG.EXHIBITS(handle)` | `AGG_EXHIBITS` | |
| `AGG.EXHIBIT(handle, name, [perspective], [block], [headers])` | `AGG_EXHIBIT` | |
| `AGG.Q(handle, p)` | `AGG_Q` | |
| `AGG.FRAMES(handle)` | `AGG_FRAMES` | |
| `AGG.FRAMEURL(handle, which, [format])` | `AGG_FRAMEURL` | the URL feeds `IMPORTDATA` directly; see Whole frames |
| `AGG.LIBRARY([name], [database])` | `AGG_LIBRARY` | |
| `AGG.PROGRAM(name, [database])` | `AGG_PROGRAM` | |

`AGG_VERSION()` reads `AGG for Sheets <client>; aggregate_api <server>, aggregate <library>`, with `<client>` stamped at build time from `__version__`.

Each function is a thin wrapper: join and validate the arguments with core, make the request, shape the result with core. Optional arguments arrive as `undefined` and an empty cell as `""`; core already treats both as omitted.

### State, concern by concern

- **Session id.** `sheets:` followed by the SHA-256 hex digest (`Utilities.computeDigest`) of `SpreadsheetApp.getActiveSpreadsheet().getId()`, a read a custom function may make. It matches the server's session pattern (`^[A-Za-z0-9:.\-_]{8,200}$`). It is stable for a copy, needs no storage, and keeps the raw spreadsheet id (which grants access when link sharing is on) off the server.
- **Build memo.** `CacheService.getDocumentCache()`, key `b:<generation>:<SHA-256 of memoKey(decl, log2, bs)>` (cache keys are limited to 250 characters), value the handle, the number, or the refusal text, kept for the maximum 6 hours. It saves POSTs, which matters for the per-session rate limit even though a server hit is cheap. Refusals are memoized as in Excel, because the key changes when the program is edited.
- **Generation.** A document property `agg.generation`, read by every call and bumped by Recalculate. CacheService cannot list or clear its keys, so putting the generation in every key is how Recalculate empties the memo.
- **In-flight dedup.** None on the client. `[Build-Single-Flight]` makes simultaneous identical POSTs one build on the server; each still counts against the session's rate limit, and the memo absorbs the cells that come after.
- **Recipe table.** Document properties, **one property per id**, `r:<id>` holding `{decl, log2, bs}` as JSON, written after each build. One key per id means no read-modify-write, so cells writing at the same moment cannot lose each other's rows. Apps Script caps a property value at 9 KB and a store at 500 KB, so a write that throws is skipped silently: the handle still works until the server loses the object. Recalculate deletes every `r:` property, which bounds growth; the cells rewrite their rows as they recompute. The rebuild-on-404 logic is Excel's `readFrom`, ported. **If the spike finds that custom functions cannot write document properties,** there is no recipe table. A lost object then answers with the recalculate instruction, and programs passed directly as arguments still rebuild on their own.
- **Library.** `GET /v1/examples` is about 150 KB, over CacheService's 100 KB per value. On a miss, fetch it once and `putAll` one key per entry, `l:<generation>:<database>:<name>` holding its DecL, plus `l:<generation>:<database>:` holding the `name | kind` listing. An unknown database's 422 is cached as its refusal text.
- **Retries.** At most one retry of a 429, and only when `Retry-After` fits the time left in a 20-second budget measured from the call's start (`Utilities.sleep`). Otherwise the cell throws `rate limited, recalculate in a minute`. Excel's `RATE_LIMIT_RETRIES = 3` stays Excel's.

### Errors

- **Refusals** return core's `#AGG! ...` text, exactly as in Excel. A spilling function returns it as a one-cell array.
- **Transient failures** `throw new Error(message)`, which shows `#ERROR!` with the message on hover.
- **The server changed** (a rebuild came back under a different id): throws the Sheets form of the message, which names the menu item instead of Ctrl+Alt+F9.

### Core changes (D3)

Four strings in `core.ts` name Excel: `MESSAGES.programIsValue` and `MESSAGES.unknownHandle` say `AGG.BUILD`, `MESSAGES.upgraded` says Ctrl+Alt+F9, and `noLibraryEntry` says `AGG.LIBRARY()`. They become per host:

- `export interface Host { fn(name: string): string; recalculate: string }`, with `EXCEL` (`AGG.` + name, "press Ctrl+Alt+F9 to recalculate every cell") and `SHEETS` (`AGG_` + name, "use AGG, Recalculate AGG cells, in the menu").
- `hostMessages(host)` replaces the `MESSAGES` constant, and `noLibraryEntry(name, host)` takes the host. `excel/src/functions/functions.ts` binds `const MESSAGES = hostMessages(EXCEL)` once at the top.
- Every Excel string stays byte-identical, and `excel/test/core.test.ts` asserts it, so Excel's behavior does not change.

The rest of core is used as it is: handles, `programOrHandle`, `joinDecl`, `memoKey`, `isRefusal`, `isProgramRefusal`, `refusalText`, `localRefusalText`, `errorMessage`, `isMissingObject`, `probabilities`, `reshape`, `flattenExhibit`, `frameFormat`, `frameDownloadUrl`, `frameRows`, `libraryEntry`, `libraryRows`. `Semaphore`, `powerQuery` and the whole-table recipe functions stay Excel's. `core.ts` stays where it is: importing it from `sheets/` is one path, and moving it to a neutral directory waits for a third client.

### Recalculate AGG cells

- `onOpen` (a simple trigger, which needs no authorization) adds an **AGG** menu with one item, **Recalculate AGG cells**.
- Its handler, `aggRecalculate`, bumps `agg.generation`, deletes the `r:` recipe properties, then on every sheet reads the formulas (`getFormulas()` over the data range). Every formula matching `/\bAGG_[A-Z]+\s*\(/i` is cleared, then `SpreadsheetApp.flush()`, then written back, which makes Sheets evaluate it afresh.
- `=IMPORTDATA(AGG_FRAMEURL(...))` matches too, so Recalculate also refreshes a whole-frame import.
- It writes to the sheet, so it needs authorization (`spreadsheets.currentonly`). The first click shows Google's consent screen, and for an unverified script a "Google hasn't verified this app" page passed through Advanced. The colleague owns their copy, so this is their own script asking. The spike records what the screen says with the scopes below, and the Start here tab tells the user what to expect.

### Whole frames

- `=IMPORTDATA(AGG_FRAMEURL(B1, "stats_df"))` loads a frame as a live table, one formula, re-run when the program changes. Sheets needs no equivalent of Excel's From Web dialog or Power Query.
- **Size.** `density_df` at `log2` 16 is 65,536 rows by about 40 columns, about 2.6 million cells: inside the 10 million cell cap, but its CSV may exceed IMPORTDATA's reported 50 MB. The spike measures it at `log2` 16 and 13. If 16 fails, the Start here tab says to load the big frames at a smaller `log2`, or through Python or R from the `.parquet` route. A `?cols=` selection on the `.csv` route (the JSON `density_df` route already has one) is a later server change, not this plan's.
- **After a restart.** IMPORTDATA refetches on its own schedule and cannot rebuild, so after the server restarts the import shows an error until Recalculate, which re-runs `AGG_FRAMEURL`, which rebuilds through the recipe table.
- `inf` and `-inf` in the CSV most likely arrive as text **[spike]**. Accepted.

### No sidebar in v1

Excel's task pane holds an About list and the Whole frames tools. In Sheets, `=AGG_VERSION()` is the About list, and one formula is the whole-frames tool. A sidebar would also need HtmlService and its authorization for every user. So no sidebar until a real need appears (a library picker, say).

### The template spreadsheet

Two tabs, written by `aggSetUpTemplate()` in `sheets/src/template.ts`, which the author runs from the Apps Script editor. That way the user-facing text is versioned beside the functions it describes, and rerunning the function rewrites both tabs.

- **Start here.**
  - What AGG is, and the data warning: every program goes to the public server and its audit log, so never put real data into DecL.
  - The nine functions, one line each, and `=AGG_VERSION()` live.
  - Programs combine through text; references resolve to library entries only.
  - What Recalculate is for and the consent screen it brings; the IMPORTDATA size note.
  - Links to the repo, and to `https://agg.mynl.com/help.html` once `[Excel-Store]`'s [store-pages] has deployed it. Until then, link to `excel/README.md` on GitHub for the full reference. Whichever of the two plans lands second writes the Sheets sections of `help.html` and `privacy.html`, and points this link at `help.html`.
- **Example.**
  - A library program laid out down column A (from `=AGG_PROGRAM("BasicBook")`, or its text).
  - `AGG_BUILD` of it.
  - `AGG_EXHIBIT(handle, "summary")` spilling.
  - A column of `p` with `AGG_Q` beside it.
  - `AGG_FRAMES`.
  - `=IMPORTDATA(AGG_FRAMEURL(handle, "stats_df"))`.

### Build, test, push

- `sheets/package.json`: `esbuild`, `typescript`, `@google/clasp`, `@types/google-apps-script`.
- **`npm run build`** writes `sheets/dist/`:
  - `core.js`: esbuild of `../excel/src/functions/core.ts` with `--bundle --format=iife --global-name=AggCore --target=es2019`.
  - `functions.js`, `menu.js`, `template.js`: esbuild of each `src/*.ts` **without bundling**, a type strip that leaves top-level functions top level (fact 3). These files contain no `import`. They see core through `declare const AggCore: typeof import("../../excel/src/functions/core")`, which is a type and is erased.
  - The client version comes from `src/aggregate_api/__init__.py` through esbuild's `--define`, read the way `excel/webpack.config.js` reads it.
  - `appsscript.json` is copied in.
  - Apps Script loads files in order. Nothing touches `AggCore` at load time, only inside functions, so order does not matter; `.clasp.json` sets `filePushOrder` with `core.js` first anyway.
- **`appsscript.json`**: V8 runtime, `exceptionLogging: STACKDRIVER`, and explicit `oauthScopes`: `script.external_request` (UrlFetch), `spreadsheets.currentonly` (Recalculate, the template set-up), `script.container.ui` (the menu).
- **`npm test`**: `node --test` over `sheets/test/*.test.ts`. The tests load the built `dist/*.js` into a `node:vm` context with stub `UrlFetchApp`, `CacheService`, `PropertiesService`, `SpreadsheetApp` and `Utilities`, and feed the stub server the payloads already captured under `excel/test/fixtures/` (DRY again). They cover each function's output and refusal text, the memo and its generation, the recipe rebuild after a 404 with the same id and with a different one, the retry budget, the session id shape, and the Recalculate formula match. This tests the very files `clasp` pushes, which matters because nothing else runs Apps Script locally.
- **`npm run typecheck`**: `tsc --noEmit`.
- **`npm run push`**: `clasp push` from `dist/`. **The author's step, like `git push`:** it publishes to everyone who copies the template from then on. It needs `clasp login` (credentials in `~/.clasprc.json`, outside the repo) and the Apps Script API turned on at `script.google.com/home/usersettings`. `sheets/.clasp.json` holds the template's script id and is gitignored; `sheets/.clasp.json.example` is committed.

### Compatibility surface

Copies never update, so the routes a Sheets client calls become a contract that has to stay backward compatible for as long as old copies circulate:

- `GET /v1/meta`
- `POST /v1/objects` (`decl`, `log2`, `bs`, `library_references_only`)
- `GET /v1/objects/{id}/exhibits`, `/exhibit/{name}?perspective=`, `/quantiles?snap=false&p=`, `/frames`, `/frame/{which}/shape`, `/frame/{which}.csv`
- `GET /v1/examples[?database=]`

A change in shape there needs a new route, not an edit. The Sheets README says so, and so does a line in this repo's `CLAUDE.md`.

## Layout

```
sheets/
  README.md             developer notes: build, test, push; users read the template's Start here tab
  package.json, package-lock.json, tsconfig.json
  appsscript.json       Apps Script manifest: V8, scopes
  .clasp.json.example   the script id goes in .clasp.json (gitignored)
  src/functions.ts      AGG_* and the request layer
  src/menu.ts           onOpen and aggRecalculate
  src/template.ts       aggSetUpTemplate
  test/                 node --test over dist/ in a vm, stubs, no fixtures of its own
  dist/                 gitignored
```

`.gitignore` gains `sheets/node_modules/`, `sheets/dist/` and `sheets/.clasp.json`, beside the `excel/` lines.

## Steps

Owners: **Claude** works in this repo once the plan is approved; **Author** needs the author's Google account; **Both** means Claude prepares and the author runs.

1. **[spike] Both.** Claude writes `dev/sheets-spike.md`: a probe script of about 40 lines to paste into a scratch sheet's Apps Script editor, and a checklist. It posts only `agg Dice dfreq [3] dsev [1:6]` and library entries to `agg.mynl.com`, never real data. The author runs it and records each answer in this plan's execution log:
   1. `UrlFetchApp` in a custom function, in a copy opened by a **second** Google account that never authorized anything (fact 6). If it fails, the Start here tab and the menu gain an "Authorize AGG" item that runs a fetch from the menu once, and the template documents the one-time consent.
   2. A custom function writing a document property (fact 5). If it fails, there is no recipe table (see State).
   3. `CacheService.getDocumentCache()` seen across cells. If it is not shared, the memo goes, and the server's single flight carries the load alone.
   4. Whether a thrown error sticks after the cause is gone, on reload and after an hour (fact 8). If it sticks, Recalculate is the documented remedy.
   5. `IMPORTDATA` of `density_df.csv` at `log2` 16 and 13: size, time, and how `inf` arrives (fact 11).
   6. The consent screens for Recalculate under the three scopes (fact 6, and Recalculate above).
   7. Whether AGG cells compute in the Sheets app on a phone. If they do, it is a line in Start here, since Excel on iPad has no custom functions.

   The design above changes only where a fallback is named. An answer outside them comes back to the author before any code is written.
2. **[core-hosts] Claude.** The `Host` change in `core.ts` and the one-line binding in Excel's `functions.ts`. `npm test`, `npm run typecheck` and `npm run lint` in `excel/` stay green, with the Excel strings asserted byte-identical.
3. **[sheets-functions] Claude.** The `sheets/` project, `src/functions.ts`, the build, and the vm tests.
4. **[sheets-menu] Claude.** `src/menu.ts`: `onOpen` and `aggRecalculate`, with tests of the formula match.
5. **[sheets-template] Both.** Claude writes `src/template.ts`. The author:
   1. Creates the "AGG template" Google Sheet, opens Extensions, Apps Script, and copies the script id into `sheets/.clasp.json`.
   2. Runs `clasp login` and `npm run push`.
   3. Runs `aggSetUpTemplate` from the editor.
   4. Shares the sheet as anyone with the link can view.
   5. Takes the copy link, `https://docs.google.com/spreadsheets/d/<id>/copy`.
6. **[docs] Claude.**
   - `sheets/README.md`.
   - A Google Sheets paragraph in the top-level `README.md`, with the copy link once the author has it.
   - The Sheets commands (build, test, push) in `CLAUDE.md`, and the compatibility-surface line.
   - `CHANGELOG.md` and `dev/TODO.md`.

Steps 2 to 6 are one minor bump, since it is a feature: one commit, `[1.x.0] add the AGG functions for Google Sheets as a template script`. The spike changes no code and has no bump. After the bump, a push to the template is the author's, and so is every later push.

## Acceptance

In `excel/` and `sheets/`: `npm test` and `npm run typecheck` pass, and `excel/`'s Excel strings are unchanged.

In the template, by the author:

1. `=AGG_VERSION()` shows the client and server versions, and they agree.
2. The Example tab computes:
   1. `AGG_BUILD` gives a handle.
   2. `AGG_EXHIBIT(..., "summary")` spills numbers.
   3. `AGG_Q` over a column of `p` spills beside it.
   4. `AGG_FRAMES` lists frames.
   5. `IMPORTDATA(AGG_FRAMEURL(..., "stats_df"))` loads a table.
3. A typo in the program shows `#AGG! line L, col C: ...` as text in the build cell and in every cell that uses it. Fixing it recovers them all.
4. `=AGG_LIBRARY()` lists the library, and `=AGG_PROGRAM("BasicBook")` gives its text.
5. Twenty cells passing the same new program as their handle argument compute. `GET /v1/status` shows one build started, with the rest coalesced or memo hits.
6. From a second Google account: the copy link makes a copy, and `=AGG_VERSION()` computes in it (after the one-time consent, if the spike found one is needed).
7. After the server restarts, editing a `p` cell brings back a value from a handle saved before the restart (the recipe rebuild). AGG, Recalculate AGG cells re-runs every AGG cell.

## Later, not this plan

- **Marketplace editor add-on (D1, later).** It needs a Google Cloud project, an OAuth consent screen and a listing review, with links to a privacy policy, terms and a help page. `[Excel-Store]`'s [store-pages] step (`dev/done/plan-excel-store-REJECTED.md`, revised 2026-10-18; the plan was rejected on 2026-10-28 and the step never landed) was to write those pages for the whole service at the site root (`/help.html`, `/privacy.html`, `/terms.html`), including the Sheets specifics, so Google's listing links to them as they are.
- `?cols=` on the `.csv` frame route, for importing a big frame a few columns at a time.
- Rate limits behind Google's egress (D5), when it bites.
- A sidebar, if a library or frame picker proves wanted.
- Converting `AGG.` to `AGG_` (and back) in a workbook moved between the hosts.
- `AGG_INFO`, when `[Excel-Info]` lands: both hosts at once, through core.

## Alternatives considered

- **An Apps Script library** shared by script id. Each sheet would still need wrapper functions, and each user pins a library version, so it neither saves code nor updates centrally. Libraries also add latency to every call.
- **An editor add-on now.** It updates centrally, but costs the Cloud project, consent screen and review up front. Deferred by D1.
- **A Web App wrapper** (the custom function calls a deployed Apps Script web app, which fetches with full authorization). It exists to get around `UrlFetchApp` being unavailable, and is only worth it if spike item 1 fails and the one-time consent proves unacceptable.
- **A sidebar for whole frames**, as in Excel. In Sheets, IMPORTDATA does the job in one formula.

## Execution log

- **2026-10-18, review.** Passed. Step 1's probe and checklist written to `dev/sheets-spike.md`, waiting on the author's run.
- **2026-10-18, ruling [build-route].** esbuild (tested 0.21.5) drops JSDoc, so the `@customfunction` tags would never reach Apps Script and nothing would autocomplete. The author ruled that autocomplete is required. So `src/*.ts` is type-stripped by `typescript`'s `transpileModule` in a small `sheets/build.mjs`, which keeps the comments and the top-level functions and also stamps the version. esbuild bundles the `AggCore` IIFE and nothing else.
- **2026-10-18, spike, first pass** (the author's run, in the owner's account):
  - [spike] 2, property write: **works.** `=SPIKE_PROP("a")` showed `wrote <timestamp>`, so the recipe table stands as designed.
  - [spike] 3, document cache: **shared across cells.** A4 read `hello`, which A3's execution had put. The memo stands.
  - [spike] 5, IMPORTDATA: **not yet tested at size.** The Dice probe returned 32 rows at both log2 13 and 16, because the library builds an exact discrete program on its own 32 buckets and ignores the requested log2 (confirmed locally: `density_df` is (32, 12) at log2 0, 13 and 16, while a lognormal program gives (8192, 12) and (65536, 12)). The probe now uses `agg Spike 5 claims sev lognorm 10 cv 1 poisson`. Already learned: `-inf` arrives as the text `-inf`, and NaN as an empty cell. An orange bar asks to allow access to external data, once per spreadsheet; the Start here tab names it.
  - [spike] 7, phone: **works.** `SPIKE_FETCH` and the other cells compute in the Sheets app.
  - [spike] 8, session id: **works.** `=SPIKE_SESSION()` shows `sheets:` and 64 hex characters.
  - Still open: 1 (a browser signed in to several accounts sent `/copy` back to the owner; retry in an incognito window), 4 (not yet run), 5 at size, 6 (the Apps Script consent pop-up, as distinct from the IMPORTDATA bar).
- **2026-10-18, spike, second pass:**
  - [spike] 1, a fresh copy from a second account: **works without consent.** The custom functions, UrlFetch included, computed in the copy, and the Spike menu appeared. Fact 6 resolves the good way: no "Authorize AGG" item.
  - [spike] 6, consent: the first menu item run went through Google's "Google hasn't verified this app" pages and a scope acceptance, as the plan expected. Only menu items ask; cells never do. The Start here wording is checked against the real screens when the author runs `aggSetUpTemplate` at step 5.
  - [spike] 5, IMPORTDATA at size: **works at log2 13, fails at 14, 15 and 16** ("exceeded max size"). Measured locally, that frame's CSV is 1.74 MB at 13 (8,192 rows by 12 columns) and 3.50 MB at 14, so the limit sits between them, far below the 50 MB third parties report. A rule of thumb for Start here: about 100,000 cells per import. Plan correction: the `.csv` frame route **already takes `?cols=`** (added for the Lab's All rows view), so `=IMPORTDATA(AGG_FRAMEURL(B1, "density_df") & "?cols=loss,p,S")` thins a big frame with no code change. The "later" item for it is void.
  - **Ruling [order], 2026-10-18:** `[Front-End-Apps]` (`dev/plan-front-end-apps.md`) and aSP's `[Serve-From-aLL]` land before this plan's steps 2 to 6.
  - [spike] 4, a thrown error: **sticks.** With the flag off, F2 and re-entering an old `#ERROR!` cell left it `#ERROR!`; only a new argument recomputed. Sheets appears to keep a custom function's result for unchanged arguments. Open: whether clear, flush and rewrite (exactly Recalculate, D6) unsticks it. If it does not, Recalculate needs another mechanism, and that comes back to the author.
- **2026-10-19, [spike] 4(d): the rewrite unsticks.** The author, in A1 with the menu item (not F2): fail on, `=SPIKE_FLAKY(8)` gave `#ERROR!`; fail off, then Spike, Rewrite A1 (clear, flush, `setFormula`) gave `ok <timestamp>`. Also observed: Sheets keeps a result **per cell**, so a new cell with identical formula text evaluates afresh, while F2 and Enter on a stuck cell does not. Recalculate (D6) stands as designed, and so does the transient-throw design. Author's go for steps 2 to 6 the same day.
- **2026-10-19, steps 2 to 6 executed as 1.29.0**, one commit, against `1.28.0` (`4c35c1a`). Gates: `excel/` `npm test` 32 passed, `npm run typecheck` and `npm run lint` clean; `sheets/` `npm test` 25 passed (build, functions, menu, template), `npm run typecheck` clean; root `uv run --no-sync pytest` and `web/` `npm test` green. A smoke run of the built `dist/` against a live local server (a curl-backed `UrlFetchApp`, scratch audit DB) answered every function: a handle, the summary, three quantiles, the frames, a 19-line `stats_df` CSV, `?cols=loss,p_total,S` on `density_df`, the library, parse refusals as text through `AGG_Q`, `(2+2)` as 4, and one stable `sheets:` session id. Divergences:
  - **[core-hosts] `Host` has a third field, `document`.** "this workbook" in `unknownHandle` and `upgraded` reads wrong in Sheets, so Sheets says "this spreadsheet". Excel's strings stay byte-identical, asserted in `excel/test/core.test.ts`. The host-independent messages live in an unexported `COMMON`, which `errorMessage` reads.
  - **[sheets-functions] A changed server clears nothing in the cell.** Excel's `readFrom` clears its memo before asking for Ctrl+Alt+F9, because that recalculation would otherwise hit the memo. In Sheets, Recalculate bumps the generation itself, so the cell only throws the instruction, and cells hitting the same condition at once do not each bump it.
  - **[sheets-functions] `log2` and `bs` are checked in the client.** Sheets hands an empty cell as `""` and any text as text, so a non-number is refused as `#AGG! log2 must be a number; got ...`; Excel's typed parameters never see one.
  - **[build] `AGG_API_BASE` overrides the base at build**, as it does for `excel/webpack.config.js`; used for the smoke run against a local server. The default is `https://agg.mynl.com`.
  - **[build] `npm test` builds first** (`pretest`), so the tests always read a fresh `dist/`. The tests use a fake server fed from `excel/test/fixtures/`, as planned; the live smoke run is a scratch script, not committed.
  - **[build] npm's install-script policy skipped esbuild's postinstall.** The platform binary arrives as an optional dependency, and esbuild 0.28.2 runs without the postinstall.
  - **[sheets-template] The Authorization paragraph of Start here** describes Google's unverified-app screens generically (Advanced, the Go to link, Allow). The author checks it against the real screens when running `aggSetUpTemplate`, as step 5 planned.
  - **The plan stays in `dev/`.** Under the author's 2026-10-19 rule a plan with steps still to run does not move: the author's template creation and push (step 5), the copy link in `README.md` (step 6) and the template acceptance remain.
- **2026-10-19, review for execution: waits for [spike] 4(d).** The dependencies have landed: `[Build-Single-Flight]` as 1.26.1, `[Front-End-Apps]` as 1.27.0, and aSP's `[Serve-From-aLL]` as its 1.36.0. The plan's facts against `excel/src/functions/core.ts` hold: the four Excel strings and all seventeen core functions it names are there. The one open item is 4(d), which Steve has not run yet. Steps 2 to 6 wait for it, since the transient-throw design depends on whether Recalculate unsticks a stuck cell.
- **2026-10-20, step 6's link landed as 1.31.1.** The author created the "AGG template" spreadsheet and set up clasp (steps 1 to 3 of `sheets/README.md`, Publish). Its copy link, `https://docs.google.com/spreadsheets/d/1bzk9ZJgT9zShiWrbhlEddi8vvcajC1eacLmxsRuXKS8/copy`, went into `SHEETS_TEMPLATE_URL` (the `/use` page's Sheets button), `README.md` and `sheets/README.md`, and `tests/test_use_page.py` fails if the three differ. A spreadsheet's id is fixed at creation, so the link could ship before the template is filled; until the author shares it, anyone else is asked to request access rather than handed an empty copy. The author's ruling the same day: **the template keeps a blank Sheet1**, since the `/use` page has a newcomer type the worked Gross program into A1 and the Start here and Example tabs already fill their first columns. README step 5 says so in place of "delete the empty Sheet1". Still to run, the author's: `npm run push` (after 1.31.1, so the copies carry that version), `aggSetUpTemplate`, a check on Sheet1 cleared afterward, the share, and the template acceptance.
