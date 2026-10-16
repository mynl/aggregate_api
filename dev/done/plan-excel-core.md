# Plan: Excel custom functions over the API (`excel/`)

Minor bump. Depends on `plan-cache-key-from-parsed-program.md` (deterministic
ids and `library_references_only`). Hosting on agg.mynl.com is
`plan-excel-hosting.md`; this plan runs against a local server on desktop Excel.

## Goal

An Office JS add-in, in TypeScript, that puts the API in Excel cells:

```
=AGG.VERSION()                                            server and library versions
=AGG.BUILD(decl, [log2], [bs])                            handle such as "port.P#4f40714271198d8f"
=AGG.EXHIBITS(handle)                                     spill: name | title | perspectives
=AGG.EXHIBIT(handle, name, [perspective], [block], [headers])   spill: the exhibit
=AGG.Q(handle, p)                                         quantiles; p a number or a range
```

## Design

**Every function is pure.** Excel is a memoizing evaluator over a dependency
graph; its saved cell values can be trusted only if each function's output
depends on its arguments alone. After the cache-key plan an id is a hash of the
parsed program plus library and plugin versions, so `AGG.BUILD` is pure, and
the other functions read an immutable object.

**References: library entries only.** `AGG.BUILD` always sends
`library_references_only: true`. Excel cannot see a reference made by name: in
`=AGG.BUILD("port P agg.A")`, P's cell does not depend on the cell that built A,
so editing A would never recalculate P, and after a restart P could be
evaluated first. You combine objects through text instead, which Excel tracks
exactly:

```
A1: agg A 2 claims sev lognorm 10 cv 1 poisson
B1: agg B 3 claims sev gamma 5 cv 0.5 poisson
C1: =AGG.BUILD("port P " & A1 & " " & B1)       edit A1 and C1 recalculates
D1: =AGG.BUILD(A1)                              to look at A on its own
```

The SPA keeps resolving your own declarations by name; only Excel asks for
library-only resolution.

**Handles** are `kind.Name#id`. The id after `#` is the server's object id; the
prefix echoes DecL's own reference syntax so a reader knows what the cell holds.

**The recipe table makes saved handles survive restarts.** Every successful
`AGG.BUILD` records `id → {decl, log2, bs}` in the workbook's document settings
(`Office.context.document.settings`, key `aggregate.recipes`, saved inside the
.xlsx). Excel does not reliably recalculate custom functions when a workbook
opens, so cells keep handles from the last session. When a handle route answers
404 (evicted, or the server restarted), the add-in re-posts the recipe, checks
that the same id came back, and retries once. A different id means the server
was upgraded: return an error asking for a full recalculation (Ctrl+Alt+F9) and
clear the memo below. Bound the table at 500 entries, dropping the oldest.

**A session id per workbook**, minted once and stored in the same settings
(`aggregate.session`), in the shape the server accepts (`<ISO timestamp>-<uuid4>`,
matching `[A-Za-z0-9:.\-_]{8,200}`). It no longer affects keys; it gives each
workbook its own rate-limit budget on the public instance (Caddy keys on
`X-Aggregate-Session`) and makes the status page legible.

**A build memo.** Within one runtime session, `(decl, log2, bs)` maps to the
handle last returned, so a recalculation does not re-post unchanged builds.
Library-only programs make that sound for one server version.

**Exhibits flatten from the TableDoc IR.** Verified on `summary`, 2026-10-16:
the payload is `{name, title, perspective, meta, hash, blocks: [...]}`; each
block has `caption`, `head` (one row per header level, cells `{text}`),
`columns` (with `role: "stub"` on row-label columns and a `format` spec such as
`{kind: "pct", digits: 1}`), `n_head_levels`, `n_stub_levels`, and `body` rows
`{cells: [...]}` in which stub cells are plain strings and value cells are
`{raw, text}`. Output: header rows from `head` (when `headers` is true), then
body rows with stub cells as text and value cells as `raw`, an empty string
where `raw` is null. `block` 0 (the default) stacks every block, each preceded
by its caption row and separated by a blank row; `block` k returns block k
alone, without a caption, for use in formulas. Plain numbers in this plan;
cell number formats from the `format` specs are `excel-types` work.

**Errors** throw `CustomFunctions.Error(invalidValue, message)`, so the cell
shows `#VALUE!` and the message on hover:

| Response | Message |
|---|---|
| 422 parse error (`ErrorReport`) | `line L, col C: <message>` |
| 422 `session_reference`, `recipe_not_found` | the server's `message` |
| 404 with no recipe in the table | handle unknown to this workbook; recalculate its AGG.BUILD cell |
| 504 | build timed out; lower log2 or simplify the program |
| 429 | honor `Retry-After` (default 10 s), retry up to 3 times, then: rate limited, recalculate in a minute |
| network failure | server unreachable |

**Load.** At most two requests in flight, through one small semaphore in the
shared runtime. `AGG.BUILD` is `@cancelable`, so a superseded build aborts its
fetch. No function is volatile. Every server limit (log2 cap, 10 s timeout,
one build slot, 500-row exhibits, Caddy's rate limits) applies unchanged.

**Data.** A formula's DecL goes to whichever server the add-in talks to and
lands in its audit log. On the public instance, never concatenate real data
into DecL. The `excel/README.md` says so.

## Change

**[scaffold]** `yo office`: Excel Custom Functions using a Shared Runtime,
TypeScript, XML add-in-only manifest, into `excel/`. Namespace `AGG`.
`node_modules` and build output gitignored. The API base is a build-time
setting: empty (same origin) for production, `http://localhost:8001` for
development, where the dev server serves the add-in at `https://localhost:3000`
and the local API runs with `AGGAPI_CORS_ORIGINS=https://localhost:3000`
(`cors.py` already allows `X-Aggregate-Session`). Chromium lets an https page
call `http://localhost`, so this works on desktop. Excel on the web cannot reach
localhost (see the hosting plan), so web is tested there.

**[version]** `AGG.VERSION()` reading `/v1/meta`, working end to end in desktop
Excel before anything else is built.

**[functions]** `AGG.BUILD`, `AGG.EXHIBITS`, `AGG.EXHIBIT`, `AGG.Q`, with the
recipe table, session id, memo, error mapping and request semaphore described
above. `decl` accepts a cell or a range; non-empty cells join with newlines in
row-major order (the server collapses a program to one statement anyway).
`AGG.Q` calls `GET /v1/objects/{id}/quantiles`; check the route for how it
takes `p` (it requires numbers strictly inside (0, 1)) and spill the result in
the shape of `p`.

**[tests]** Unit tests (the scaffold's runner) for exhibit flattening, handle
parsing, error mapping and the recipe table, against exhibit payloads captured
from library examples only, committed under `excel/test/fixtures/`.

## Files

- `excel/` (new): scaffold, `src/functions/`, `src/taskpane/` (scaffold default,
  left minimal), `manifest.xml` for development, `README.md`, tests.
- `.gitignore`: `excel/node_modules`, `excel/dist`.
- `README.md` (front page): one paragraph pointing at `excel/README.md`.

## Acceptance

On desktop Excel (Windows), sideloaded with `npm start`, against a local server:

- `=AGG.VERSION()` shows the versions `/v1/meta` reports.
- `=AGG.BUILD("agg A 2 claims sev lognorm 10 cv 1 poisson")` returns
  `agg.A#<id>`; `=AGG.EXHIBITS` and `=AGG.EXHIBIT(…, "summary")` spill; editing
  the DecL updates the handle and every dependent spill.
- The A1/B1/C1 composition above: editing A1 recalculates C1 and its exhibits.
- `=AGG.BUILD("port P agg.A agg.B")` after building `agg A` shows the
  `session_reference` message.
- Restart the server: `AGG.EXHIBIT` on a saved handle rebuilds and returns the
  same values under the same handle. Close and reopen the workbook: the same.
- A parse error shows `line L, col C: …`.
- A sheet with 30 `AGG.BUILD` cells survives a full recalculation with no error
  surfacing (the memo absorbs repeats; retries absorb 429s).
- `=AGG.Q(h, {0.5, 0.99})` spills two quantiles.

## Not in scope

- A task pane (DecL editor, insert-exhibit, plots): `[excel-pane]`, later.
- Entity handles (`=A1.Mean`) and formatted numbers from the `format` specs:
  `[excel-types]`, later.
- Large frames such as `density_df` (`AGG.FRAME`), later.
- Excel on iPad, which has no custom functions.

## Execution log

Executed 2026-10-16 as **1.16.0**, after 1.14.0 (`plan-cache-key-from-parsed-program.md`) and 1.15.0. No server code changed: `excel/` is a new subproject. Generated with `yo office excel-functions-shared "Aggregate" excel xml --ts` (generator-office 3.0.4).

**What was verified here, and what is owed.** Verified: `npm test` (22 unit tests), `npm run typecheck`, `npm run lint`, `npm run build` (the generated `functions.json` lists the five functions under the right ids, `BUILD` cancelable), and a Node smoke run of the built functions bundle with `Office` and `CustomFunctions` stubbed, against a live scratch server (`--port 8765`, scratch audit DB): VERSION, BUILD and its memo, EXHIBITS, EXHIBIT (all blocks, one block, no headers, unknown name, bad block), Q and a bad p, a port composed through text, a library reference, a parse error (`line 1, col 43: Unexpected 'oops'.`), a value program, a multi-cell range, a non-handle, recovery after `DELETE /v1/objects/{id}` (same handle, same values), an unknown handle, and 30 concurrent builds (no errors, the memo collapsing them to 10). **Owed, by the author in desktop Excel:** the whole Acceptance list above, which needs `npm start` (sideload plus the dev certificate prompt), a workbook close and reopen, and a server restart.

Divergences, each recorded as it was made:

1. **[scaffold] The generator's last step failed** (`office-addin-manifest modify` was not installed when its post-step ran, with or without `--skip-install`), so the GUID and display name were set by hand. Microsoft's template boilerplate (`CODE_OF_CONDUCT.md`, `SUPPORT.md`, `.vscode/`) was dropped, and so was `src/commands/commands.ts`, an Outlook sample that calls `Office.context.mailbox` and was bundled into the Excel pane for nothing. The sample icons were replaced by the app's logo at 16, 32, 64, 80 and 128 pixels.
2. **[tests] The scaffold has no unit-test runner.** Tests use `node --test` over `test/*.test.ts`, the runner `web/` uses, with Node stripping the types (Node 23.6 or later). That is why `core.ts` imports nothing and uses only erasable TypeScript. `tsconfig.json` was rewritten: the scaffold listed `mocha` and `node` types that are not installed, so `tsc` could never have run. `npm run typecheck` is added.
3. **[functions] The TableDoc differs from the plan's reading in three ways**, found by surveying every exhibit on three library objects. Stub columns carry `level`, and `role` only sometimes, so stubs are found by `n_stub_levels` and cell type. A two-level stub carries `rowspan`, and the rows it covers arrive one cell short; a two-level header carries `colspan`. A spanned label is repeated into every row or column it covers, so each spilled row and column is self-describing for lookups. Value cells may also be plain strings, which spill as text.
4. **[functions] A 404 is read, not retried blindly.** Only the cache's own `object <id> not in cache` triggers the rebuild from the recipe table; `no exhibit 'x'` is shown as it is.
5. **[functions] Small choices the plan left open.** `AGG.EXHIBITS` spills a header row (`name | title | perspectives`). `AGG.BUILD` of a program that means a number, such as `(2+2)`, returns the number. `AGG.VERSION` returns one string, `aggregate_api X, aggregate Y`. `AGG.Q` asks for exact quantiles (`snap=false`). Recipe-table and session settings are saved at most once a second.
6. **[functions] The task pane does not import the functions module**, because webpack would bundle a second copy into the same runtime (two memos, two request limits). It reads `/v1/meta` itself.
7. **[functions] Acceptance nuance.** `=AGG.BUILD("port P agg.A agg.B")` shows the `session_reference` message when both A and B were built in the workbook. With only A built it says `no recipe named 'B' of kind 'agg'`, because the preview stops at the first missing name. Both are accurate; build both when checking.
8. **`excel/package.json` carries no version.** The add-in's version is the server's, which `plan-excel-hosting.md` stamps into the production manifest. The development manifest says 1.0.0.0.
9. **`dev/capture_excel_fixtures.py`** captures the five fixtures from `BasicBook` (summary, stats with its rowspan, exhibits, quantiles) and `AggregateStopLoss` (reins, two blocks, a two-row header with colspan). `BasicPortfolio`'s summary, the first choice for a multi-block exhibit, turned out to be one block with a two-level stub.
10. **The production build copies the development manifest unchanged.** Writing the production manifest is `[build]` in `plan-excel-hosting.md`.
11. **The control list** `T:/worktrees/dev-files.md` does not exist; no row updated.
