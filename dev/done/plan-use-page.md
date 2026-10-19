# Plan: a page on using `aggregate` from Jupyter, R, Excel and Sheets

Status: DONE, landed as 1.31.0 on 2026-10-19 (the author's go the same day).
The last change before release 1.31.0 goes to PyPI. TODO label `[Use-Page]`.

## Goal

One static page, reached from the Loss Lab's Menu and linkable from outside,
that tells a newcomer how to run `aggregate` in each of four environments:
Jupyter, R, Excel and Google Sheets. Each environment is a folder tab, like
the main page's output tabs, and each tab is a numbered list of steps the
reader ticks off as they go. Every tab ends on the same program,

```
agg Gross 20 claims 2000 xs 0 sev lognorm 250 cv 2 mixed gamma 0.4
```

and the same quantiles: 4,257, 8,207 and 12,490 at 50%, 90% and 99%.

The immediate audience is an R programmer at a demo on 2026-10-20; the page is
the link to send afterwards.

## The design is already drawn

`dev/prototypes/use-page/side-by-side.html` is the specification. Open the file
in a browser; it is standalone. The author chose it on 2026-10-19 over the
sibling `checklist.html`, with Excel's routes taken from the latter, and the
prototype has been revised to those choices. In brief:

- Header: logo and wordmark left; the versions line and a **← Back** button
  right.
- Lede: "How to use `aggregate` from other environments." with the terms line.
  The gloss ends with the author's wording: "Each tab includes the same basic
  Gross 20-claim example. Click each step's number as you complete it."
- Four folder tabs: Jupyter, R, Excel, Sheets.
- In each pane, three tiles: **Runs**, **Prerequisites**, **Install time**.
- Below the tiles, two columns: the steps on the left, and on the right a
  sticky "What you end up with" picture of the result, drawn in HTML (a
  JupyterLab cell, the R console, an Excel grid, a Sheets grid). Below about
  990 px the picture drops under the steps.
- A step's numbered circle is its checkbox. Ticking it turns the circle green
  with a check, folds the step's body away, and rings the next unticked step
  as current. A progress bar reads "2 of 5", with **Clear ticks**.
- Excel has two routes, **Excel on the web** and **Desktop Excel, Windows**,
  as the main page's small-caps sub-tab row with the hairline divider
  (`.sub-divider` in `site.css`, the one Pricing uses) between them.
- Every command block has a **Copy** button that keeps its label; a separate
  "copied" readout fades in and out.
- Ticks are kept in this browser's `localStorage`, key `use-page-ticks`, every
  access wrapped in `try`/`catch`. The page works without storage.

## Where it lives, and the links

The page is `/use/`, a third Vite page beside `index.html` and `lite.html`:

| Link | Opens |
|---|---|
| `agg.mynl.com/use` | redirects to `/use/`, the Jupyter tab |
| `agg.mynl.com/use#jupyter` | Jupyter |
| `agg.mynl.com/use#r` | R |
| `agg.mynl.com/use#excel` | Excel, web route |
| `agg.mynl.com/use#excel-desktop` | Excel, desktop route |
| `agg.mynl.com/use#sheets` | Sheets |

The hash is read case-insensitively, so `#R` works. Clicking a tab or a route
rewrites the hash with `history.replaceState`, so the address bar is always a
link to what is on screen, and a `hashchange` listener follows a hash typed or
pasted into the bar.

No server code is needed. The SPA's `StaticFiles(html=True)` mount at `/`
already serves `static/use/index.html` at `/use/` and redirects `/use` to
`/use/` itself (it does that for any directory holding an `index.html`).
Browsers keep the fragment across a redirect whose `Location` has none, so
`/use#r` lands on the R tab. `apps.reserved_names(static_dir)` reads the
top-level entries of `static/`, so an `AGGAPI_APPS` entry named `use` is
refused once the folder exists. The service worker's `isShellPath` admits only
`/`, `/assets/*` and top-level files, so `/use/` is fetched from the network
every time and its hashed assets under `/assets/` cache as the main page's do.
The phone redirect lives in `index.html`, so a phone reaches this page
directly.

## Steps

### [deps] greater-tables 7.0

`greater-tables` 7.0.0 is on PyPI and the pin, `greater-tables>=6.0.0`, has no
ceiling, so every fresh install already resolves 7.0.0 while this checkout's
lock and environment are on 6.0.0. The one removal in 7.0, `TableSpec.math`,
is used neither here nor in `aggregate`. A release check on 2026-10-19 ran the
suite against the 1.30.0 wheel with 7.0.0 resolved from PyPI; its result is in
the execution log below.

- `pyproject.toml`: `"greater-tables>=7.0.0"`. Update the comment on the pin's
  floor: 7.0 is the release this package last checked.
- `uv lock --upgrade-package greater-tables`, then
  `uv pip install "greater-tables==7.0.0"` rather than a full `uv sync`. The
  author's server on port 19456 runs from this `.venv`, and a sync fails with
  `os error 32` on `Scripts/aggregate-api.exe` while it runs; a sync would also
  remove the co-development installs. Installing the one package moves the
  environment to match the lock and touches nothing else.
- The author restarts `agg-api` in great-servers afterwards. Its `--reload`
  watches this repository's Python files only, and `/v1/assets/*` reads the
  table walker from disk, so until the restart that server would pair the 6.0
  builder in memory with the 7.0 walker from disk.
- `CLAUDE.md`, "Relationship to `aggregate`": the floor is now 7.0.0. Keep the
  note about 5.3 on PyPI.

### [page] `web/use/index.html`, `web/src/use.js`, `web/src/styles/use.css`

Realize the prototype, following `lite.html` as the sibling pattern: a page of
its own with its own entry script and a standalone stylesheet, no Bootstrap,
no CodeMirror.

- `web/use/index.html`: the prototype's markup without its "About this mock up"
  footer and with the favicon set wired as `lite.html` wires it (absolute
  `/favicon.ico`, `/favicon-32x32.png`, `/favicon-16x16.png`,
  `/apple-touch-icon.png`, `/site.webmanifest`). Logo `/logo.png`. `<title>`:
  "Using aggregate elsewhere".
- `web/src/styles/use.css`: the prototype's styles. Its tokens are lifted from
  `site.css` `:root`, and its header comment says what `lite.css` says: where
  a value disagrees with `site.css`, `site.css` is right.
- `web/src/use-route.js`: the hash parser as a pure function, so a node test can
  reach it. `parseUseHash('#R')` gives `{tab: 'r', route: 'web'}`;
  `'#excel-desktop'` gives `{tab: 'excel', route: 'desktop'}`; anything else
  gives the Jupyter tab. And its inverse, `useHash(tab, route)`.
- `web/src/use.js`: tabs, routes, ticks, Copy, as the prototype's script does,
  importing the parser. Two additions:
  - **The versions line** is filled from `GET /v1/meta` (`aggregate_version`,
    `version`), blank until it answers and blank if it does not, as `lite.js`
    does. The same values fill the expected `=AGG.VERSION()` and
    `=AGG_VERSION()` output where a step shows it.
  - **Back.** `href="/"`, as asked. When the visitor arrived from this origin
    (`document.referrer` is same-origin and `history.length > 1`), the click
    calls `history.back()` instead, so a Loss Lab session comes back as it was
    left rather than as a fresh landing page.
- The Excel web path is **Home ▸ Add-ins ▸ More Settings ▸ Upload My Add-in**,
  the one proven on 2026-10-17 (`dev/excel-desktop-install.md`).
- **Every "what you end up with" picture and every expected output is copied
  from a real run, not composed**, before the commit:
  - Jupyter: `qd(gross)` and `gross.q([0.5, 0.9, 0.99])` from aggregate 1.6.0
    (the prototype's are real already).
  - R: `print(gross)`, `agg_q(...)` and `nrow(agg_frame(gross))` from aggregateR
    1.5.1 against a local server. The prototype's handle print is a guess and
    is known wrong in one place: `format.agg_handle` prints the mean to six
    significant figures, so it reads `4672.5`, not `4672`.
  - Excel and Sheets: the handle text in A2 (`agg.Gross#<16 hex>`, from
    `core.ts`), shortened with an ellipsis in the picture.
- **Sheets copy link.** The template does not exist yet (the author's step,
  `sheets/README.md` step 5). The page carries the link as one constant at the
  top of `use.js`, `SHEETS_TEMPLATE_URL`, of the form
  `https://docs.google.com/spreadsheets/d/<id>/copy`. While it is empty, step 1
  of the Sheets tab shows no button and says the template link is being
  published; the other steps stand. The author means to create the template
  on 2026-10-20 so the link ships in 1.31.0. When it arrives before the bump,
  it fills the constant and also goes into `README.md` and
  `sheets/README.md`, which closes the `[Sheets-Template]` TODO's "copy link
  goes into `README.md`". If it arrives after, filling it is a patch bump.

### [build] Vite and the wheel

- `web/vite.config.js`: a third input,
  `use: fileURLToPath(new URL('./use/index.html', import.meta.url))`. The output
  is `static/use/index.html`, loading `../assets/use-*.js` and `.css` (Vite
  writes relative paths under `base: './'`; confirm in the first build).
- `pyproject.toml` package-data: add `"static/use/*"`. A package-data glob does
  not recurse; this is the 1.0.0 defect again if forgotten.
- `scripts/release-check.ps1`: step 4 also requires
  `aggregate_api/static/use/index.html` in the wheel and every asset it names
  (the reference pattern must accept a leading `../`, which today's regex does
  not, so it would pass vacuously); step 7 also fetches `/use` (expect the
  redirect), `/use/`, and every file the page references, resolved against
  `/use/`.

### [menu] the Loss Lab Menu

In `web/index.html`, after **Download models** and before **About**:

```html
<li><a class="dropdown-item" href="use/">Using in Jupyter, R, Excel, Sheets</a></li>
```

A link, not a button, since it navigates; relative, so a sub-path mount works.
It opens in this tab, as the Apps items do.

### [docs] README, the Excel README, `CLAUDE.md`

- `README.md`, "What's inside": add an **R package** bullet for aggregateR
  (`https://github.com/mynl/aggregate-R`, the same functions as `agg_build`,
  `agg_q`, `agg_frame` and so on, over HTTP; `agg_start()` runs a private local
  server), and one sentence after the four front ends: "The running app's
  Menu ▸ Using in Jupyter, R, Excel, Sheets (`/use`) walks through each."
- `excel/README.md`, lines 28 to 31: the web path becomes More Settings, and the
  claim that desktop Microsoft 365 has Upload My Add-in goes. Desktop Excel
  never had it (`dev/excel-desktop-install.md`); the desktop route is the
  shared-folder catalog, and the README points at `/use#excel-desktop` for the
  steps.
- `CLAUDE.md`, Frontend: one sentence naming the third page,
  `web/use/index.html`, beside `lite.html`.

### [tests]

- `tests/test_use_page.py`:
  - every DecL program on the page (`web/use/index.html`, read as text) is the
    same string, and building it with `aggregate.build` gives
    `q(0.5), q(0.9), q(0.99)` equal to the three numbers the page prints. This
    guards the page against a library release that moves them.
  - with a built bundle (skip when absent, as `test_packaging.py` does):
    `GET /use` redirects to `/use/`, and `GET /use/` is 200 and HTML.
    Set `AGGAPI_AUDIT_DB` to a temporary path first; nothing here builds, but
    the rule is cheap.
- `tests/test_packaging.py`: parametrize
  `test_built_bundle_references_only_files_that_exist` over `use/index.html`
  too. Resolve each reference against the page's own folder
  (`(page.parent / raw).resolve()`); today's `lstrip("./")` would eat the
  `../` and look in `static/use/assets/`. Add `static/use/*` to what
  `test_package_data_carries_the_asset_directory` requires.
- `web/test/use-route.test.js`: the hash parser and its inverse, including
  `#R`, `#Excel-Desktop`, `#excel-web`, `#nonsense` and the empty hash.

### [storage-guard] the Lab dies when the browser blocks site data

Found on 2026-10-19 during the greater-tables browser check: in a Chrome
profile that blocks site data for `127.0.0.1`, the Loss Lab paints its shell and
does nothing. Build posts to the server and nothing renders. The console shows
`SecurityError: Failed to read the 'localStorage' property from 'Window'`, then
`ReferenceError: Cannot access '<name>' before initialization` out of
`main.js`. The same build on `localhost`, where storage is allowed, works.

The cause is `web/src/main.js` line 2283,
`let _densityRows = readDensityRows(localStorage);`, at module top level. When
storage is blocked, reading `window.localStorage` itself throws. That happens
while the argument is evaluated, before `readDensityRows` reaches its own
`try`. Module evaluation stops there, and every later top-level binding stays
uninitialized. Line 2288 passes `localStorage` the same way. Every other
storage read in `web/src` is already inside a `try`.

- `web/src/all-rows.js`: export `browserStorage()`, returning
  `{getItem, setItem}` whose methods touch `window.localStorage` only when
  called, so the throw lands inside the existing `try`.
- `main.js` lines 2283 and 2288 pass `browserStorage()`.
- `web/test/all-rows.test.js`: `readDensityRows` and `writeDensityRows`, given
  storage whose access throws, read the default and write nothing, without
  throwing.

This is a fix riding in the same release. It is not a separate bump, because 1.31.0 is
the release.

### [release] the bump

- `__version__` to `1.31.0`. `CHANGELOG.md` `## 1.31.0`, `[Use-Page]`, a
  handful of bullets: the page and its links; the Menu item; greater-tables
  7.0; the Lab loading with site data blocked; the README additions. `dev/TODO.md`: a ticked `[Use-Page]` entry. This
  plan to `dev/done/` in the same commit, with its execution log.
- One commit, `[1.31.0] add the /use page on running aggregate from Jupyter, R,
  Excel and Sheets`.
- After the commit: `scripts/build-web.ps1`, `scripts/build-excel.ps1` (its
  manifest carries the version), then `scripts/release-check.ps1`, which must
  pass before anything is published.

## Acceptance

1. `uv run --no-sync pytest` and `npm test` in `web/` pass.
2. `release-check.ps1` passes, reporting greater-tables 7.0.0 resolved, the
   wheel carrying `static/use/index.html` and its assets, and the installed app
   serving `/use/` and every file it loads.
3. In a browser against the local server: Menu ▸ Using in Jupyter, R, Excel,
   Sheets opens the page; each of the six links in the table above lands on
   its tab and route; ticks survive a reload; Back returns to the Lab as it was
   left; at phone width the tabs scroll, the picture drops below the steps, and
   there is no sideways scroll.
4. The versions line and the expected `AGG.VERSION` output show 1.31.0.
5. A table on the main page still renders (the greater-tables 7.0 walker).
6. With site data blocked for the origin (Chrome, site settings), the Lab
   loads, builds and renders; the use page works too, keeping no ticks.

## The author's, not part of this plan

- Create the Sheets template and hand over its `/copy` link
  (`sheets/README.md`, step 5); a patch bump puts it on the page.
- Restart `agg-api` in great-servers after `[deps]`.
- Deploy 1.31.0 to agg.mynl.com before the demo: R, Excel and Sheets all
  build there. Still owed on the server: `AGGAPI_CACHE_MAX=100` and the systemd
  unit.
- Publish, tag and the GitHub release.

## Execution log

- 2026-10-19, before the plan: `release-check.ps1 -KeepVenv` on 1.30.0
  resolved greater-tables 7.0.0 and aggregate 1.6.0 from PyPI into a clean
  environment and passed: 598 passed, 1 skipped against the installed wheel;
  the installed app served `/` and all 14 files it loads; `/v1/meta` reported
  tables 7.0.0. That install, served on `localhost:8766` with a scratch audit
  database, built a program and rendered the Summary table through the 7.0
  walker with no console errors. The `[storage-guard]` defect turned up in the
  same session.
- New warning in the clean environment, not ours to fix yet: starlette 1.9
  deprecates `httpx` under `TestClient` in favor of `httpx2`. Test-only; the
  `dev` extra will want `httpx2` when FastAPI follows.
- 2026-10-19, aggregate-R: 1.5.1 (`08a09fa`) removed the stale "until 1.26 is
  on PyPI" caveat from its README and from `agg_start()`'s failure message.
  Tests and `R CMD check` clean. Not pushed.

### Executed 2026-10-19, as 1.31.0

All steps landed in one bump. Gates: `uv run --no-sync pytest` 648 passed;
`npm test` in `web/` 342 passed. `dev/scripts/check-frames.py`,
`check-adapter.py` and `check-exhibits.py` (the harnesses `dev/TODO.md` says to
run when greater-tables moves) all clean on 7.0.0, with `AGGAPI_AUDIT_DB` on
scratch. Browser checks against a scratch server from this checkout:
`/use#R` redirects to `/use/#R` on the R tab; `#Excel-Desktop` opens the
desktop route; ticks survive a reload; the Menu item opens the page and Back
returns to the Lab with its object still built; the terms link opens About;
at 390 and 360 px there is no sideways scroll; and on `127.0.0.1`, where this
Chrome profile blocks site data (`localStorage` access throws
`SecurityError`), the Lab builds and renders and the use page ticks within
the page.

Real outputs, captured before the page was written: `qd(gross)` and
`gross.q(...)` from aggregate 1.6.0 matched the prototype. aggregateR 1.5.1
against a local server printed `mean, cv    4672.52, 0.562` (the prototype's
`4672` was a guess, as the plan said) and the id `4107713eaacc3d6d`; the page
shows that capture with the server line as `https://agg.mynl.com`.
`tests/test_use_page.py` ties the mean, the cv and the quantiles to the library.

Divergences, each small and taken without asking:

- **`#about` deep link, not in the plan.** The prototype's terms link pointed at
  `/#about`, and the Lab had no such link. `main.js` now opens the About panel
  when the hash is `#about`, on arrival and on a hash change. The alternative
  was a terms link landing on a page without the terms.
- **Menu link color, not in the plan.** The new item rendered grey: `site.css`
  mutes every `a` inside `.nav-meta`, and the Menu sits there. The Apps
  entries, also links, had the same defect unnoticed. `.nav-meta
  .dropdown-item` now takes Bootstrap's dropdown link colors.
- **One Copy per worksheet cell.** The prototype put A1, A2 and A3 in one block,
  whose Copy pasted all three cell names and formulas as nonsense. Each cell is
  now its own block, its name outside it.
- **No `AGG.VERSION()` output is shown**, because no step in the prototype shows
  one; only the header's versions line is filled from `/v1/meta`.
- **`release-check.ps1` checks `lite.html` too**, since the loop over pages cost
  nothing extra; it also refuses a page whose pattern finds no assets, so it
  cannot pass vacuously again.
- **Brand and Back link to `../`**, not `/`: the same place at the site root,
  and the right one under a sub-path mount.
- **Phone tweaks**: the folder tabs are no longer a scroll container (it showed
  a stray scrollbar), and the Excel route row tightens its spacing so both
  routes stay on one line at 360 px.
- The notebook picture includes `qd`'s first line, as JupyterLab shows it; the R
  console's title is `Console · R`, without a version.
- `V:/worktrees/dev-files.md`, which the `execute-plan` skill updates, does not
  exist; nothing was written there.

Left for the author: restart `agg-api` in great-servers (its `.venv` now holds
greater-tables 7.0.0, while the running process has 6.0 in memory and would serve
the 7.0 walker from disk); the Sheets template and its link
(`SHEETS_TEMPLATE_URL` in `web/src/use.js`, plus both READMEs); deploy; push
both repositories; publish, tag and release.
