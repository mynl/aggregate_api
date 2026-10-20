# AGG for Google Sheets

The Excel add-in's nine AGG functions in Google Sheets, as a script bound to a template spreadsheet. A user opens the template's copy link, https://docs.google.com/spreadsheets/d/1bzk9ZJgT9zShiWrbhlEddi8vvcajC1eacLmxsRuXKS8/copy, presses Make a copy, and has `AGG_BUILD`, `AGG_EXHIBIT`, `AGG_Q` and the rest in their own copy: no install, no add-on. Users read the template's **Start here** tab; this file is for whoever builds and publishes the script.

Design and rationale: `dev/done/plan-sheets-template.md`. The functions behave as the Excel add-in's do (`excel/README.md`), with `AGG_` where Excel has `AGG.`, since a Sheets function name cannot hold a dot.

## Layout

```
build.mjs             writes dist/: core.js (the shared core as the AggCore global) and the stripped src/*.ts
appsscript.json       the manifest: V8 and its three scopes
.clasp.json.example   copy to .clasp.json (gitignored) and put the template's script id in it
src/functions.ts      AGG_* and the request layer
src/menu.ts           onOpen and Recalculate AGG cells
src/template.ts       aggSetUpTemplate, which writes the Start here and Example tabs
test/                 node --test over dist/ in a vm, with stub Apps Script services
```

The pure logic is `excel/src/functions/core.ts`, shared with the Excel add-in. `build.mjs` bundles it with esbuild as an IIFE assigned to `AggCore`, and strips the types from `src/*.ts` with TypeScript's `transpileModule`, which keeps the `@customfunction` JSDoc that Sheets reads for autocomplete (esbuild drops comments).

## Build and test

```
npm install
npm run build        # dist/, for https://agg.mynl.com; AGG_API_BASE=<origin> for another server
npm test             # builds, then tests dist/ in a vm against a fake server
npm run typecheck
```

The client's version is the server's `__version__`, stamped in at build, and `=AGG_VERSION()` reports it beside the server's. Google's servers make the requests, so a local server is unreachable from Sheets; test a client change against agg.mynl.com, and deploy a server change before Sheets can see it.

## Publish (the author's, like `git push`)

`npm run push` builds and runs `clasp push`. It publishes to everyone who copies the template from then on, and a copy never updates, so every push freezes a version into the copies made after it.

Once, to set up:

1. Turn on the Apps Script API at https://script.google.com/home/usersettings.
2. `npx clasp login` (credentials land in `~/.clasprc.json`, outside the repo).
3. Create the "AGG template" spreadsheet, open Extensions, Apps Script, and copy the script id from Project Settings into `sheets/.clasp.json`, starting from `.clasp.json.example`.
4. `npm run push`. clasp asks before overwriting the manifest; say yes.
5. In the Apps Script editor, run `aggSetUpTemplate` once and accept the authorization. It writes the Start here and Example tabs. Keep Sheet1, and keep it empty: the `/use` page has a newcomer type the worked example into it, and every copy carries whatever it holds. Rerun it whenever the tab text changes.
6. Share the spreadsheet as anyone with the link can view. Its copy link, `https://docs.google.com/spreadsheets/d/<id>/copy`, is the one above; until it is shared, anyone else who opens it is asked to request access, so nobody copies a half-built template. A new template means a new link in `SHEETS_TEMPLATE_URL` (`web/src/use.js`), `README.md` and here.

## The compatibility surface

Copies never update, so the routes a copy calls must stay backward compatible for as long as old copies circulate:

- `GET /v1/meta`
- `POST /v1/objects` (`decl`, `log2`, `bs`, `library_references_only`)
- `GET /v1/objects/{id}/exhibits`, `/exhibit/{name}?perspective=`, `/quantiles?snap=false&p=`, `/frames`, `/frame/{which}/shape`, `/frame/{which}.csv`
- `GET /v1/examples[?database=]`

A change of shape on any of them needs a new route, not an edit.
