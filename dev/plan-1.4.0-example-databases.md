# Plan 1.4.0 and 1.5.0: choose the shipped `.agg` file behind the Examples menu, and link to one example

Status: final, awaiting the go. Two steps, two bumps:

* **[databases]** 1.3.0 to **1.4.0**: the hamburger chooses which shipped `.agg`
  file feeds the Examples menu.
* **[deep-link]** 1.4.0 to **1.5.0**: a page URL that selects a file and opens
  one of its examples, built.

Each step is its own commit, so either can be reverted alone.

## Goal

A reader of the forthcoming `aggregate` paper clicks a link printed beside a
figure, and the app opens with that figure's program in the editor, built.
Alternatively the reader picks the paper's `.agg` file from the hamburger menu
and browses every example from the paper in the Examples menu. The same
mechanism serves `reproductions.agg` (the *Reproductions* book, 140 programs),
`decl-testers.agg`, and any later file `aggregate` ships.

## Current behavior

* `src/aggregate_api/library.py`: `get_underwriter()` returns one process-wide
  `Underwriter`: `aggregate.build` (which loads `library.agg`), or a private
  one over `AGGAPI_LIBRARY` / `--library` when set. Every build route takes a
  per-session fork of it (`sessions.py`).
* `src/aggregate_api/examples.py`: `load_examples()` (an `lru_cache(maxsize=1)`)
  walks that base's `recipes` frame, drops `source == 'session'` rows, sorts on
  `seq`, and serves one flat list plus pill facets. `load_heroes()` serves the
  `role:hero` entries.
* `src/aggregate_api/routes/examples.py`: `GET /v1/examples` (optional
  `kind`/`topic`/`role` filters), `GET /v1/examples/heroes`, the sparklines.
* `web/src/examples.js`: `loadExamples()` memoizes one payload (`cached`) read
  by the dropdown, the palette, the Ctrl+Shift ring and `lite.js`. Active pill
  filters persist in `localStorage` under `aggapi.examples.filters`.
* `web/src/main.js`: `pickExample(item)` (about line 4615) captions, loads and
  builds an entry; `loadLanding()` (about line 4691) builds the fixed
  `LANDING_DECL` already in the editor at startup.
* `web/index.html` lines 81 to 158: the hamburger dropdown, with checked-item
  sections (Tables, Perspective, Editor) using `menu-check-item`. Lines 22 to 31:
  the phone redirect to `lite.html`, which carries `location.search` across.
* `web/src/lite.js`: `initChips()` loads the payload; `pick(item)` shows a
  program; `build()` runs it.

## Step [databases], 1.4.0

### The choice is per viewer, not per process

The public server is shared. Swapping `get_underwriter()` would change every
user's menu at once, so the process base stays exactly as it is. The selected
file is **a view parameter on the examples route**, held in the browser:

```
GET /v1/examples?database=reproductions
```

`database` is `aggregate`'s own word for a `.agg` file (`Underwriter(databases=)`,
`available_databases()`). Absent, it means the process base, which is today's
behavior byte for byte.

### Builds still resolve against the process base

Picking an entry puts its full program text in the editor, as now, and the build
runs in the session's fork of the process base. So a program from another file
builds correctly **provided it is self-contained or refers only to entries in
`library.agg`** (`sev.X`, `agg.Y`). That holds for `reproductions.agg`: it is in
canonical form and contains no by-name references (checked by grep on
2026-10-12). It is an authoring constraint on `aas-paper.agg`, accepted by the
author, and matches how a reader runs the paper in Python: `build(...)` with the
default library.

Loading the chosen file into the session's base as well was considered and
rejected: a fork per (session, database), a decision about a session's prior
builds on switching, and a second dimension in the session registry, all to
support cross-references neither file needs.

### Discovery: shipped files only

`build.available_databases()` returns files found in `cwd`, `user`
(`~/.aggregate`) and `default` (the package's `agg/` directory). The app offers
**only `where == 'default'`**, minus names starting with `_`. Today that is
`library`, `decl-testers` and (in the worktree) `reproductions`. `decl-testers`
is included deliberately (author, 2026-10-12). The `cwd` and `user` rows are
excluded on purpose: on a server `cwd` is wherever the process was launched,
and on the author's machine the user directory may hold private `.agg` files.

The request parameter is matched against that discovered list by stem and is
**never** used as a path, so `?database=../../x` is a 422, not a read.

When `AGGAPI_LIBRARY` is set, the process base is the custom file; it is listed
first under its own stem and marked default, and the shipped files follow. When
it is not, `library` is the default and is not listed twice.

### Loading, caching, failure

* One private `Underwriter(databases=(path,))` per non-default file, built on
  first request and cached per process (`lru_cache` keyed on the stem; the key
  space is the handful of shipped files). Measured: `reproductions.agg` loads
  in 0.7 s, `decl-testers.agg` in 1.5 s.
* `load_examples(database=None)` is keyed on the stem (`maxsize` raised to
  cover the shipped files). The body is unchanged: `seq` order, `_entry` per
  row (already resolving by `(kind, name)`, so the one name `decl-testers.agg`
  reuses across kinds is fine), facets.
* **One bad statement fails the whole file.** `Underwriter.load` raises on the
  first parse error (verified: the installed `aggregate` 1.0.1 rejects
  `reproductions.agg` at its first `nttagg`). The route catches it and returns
  HTTP 422 with the parse message; the SPA shows that message in the Examples
  menu rather than an empty list. The default file's path is untouched.
* Heroes and sparklines stay on the process base.

### The listing route

`GET /v1/examples/databases`:

```json
{"databases": [{"name": "library", "default": true},
               {"name": "decl-testers", "default": false},
               {"name": "reproductions", "default": false}]}
```

Default first, then alphabetical. A directory listing; nothing is parsed, so no
entry counts.

### The menu

A new section at the top of the hamburger in `web/index.html`, in the same
checked-item form as Tables and Perspective, items rendered from the listing
route at startup:

```
Examples from
  ✓ library.agg          default
    decl-testers.agg
    reproductions.agg
```

Picking one:

1. stores the stem in `localStorage` (`aggapi.examples.database`), wrapped in
   try/catch like the other preferences;
2. clears the memoized payload in `examples.js` (`cached`, `flat`, `haystack`,
   and the ring cursor) and refetches with `?database=`;
3. re-renders the Examples dropdown and palette.

The Examples dropdown's header line names the active file when it is not the
default (`from reproductions.agg`), so a reader cannot forget where the list
came from.

**Pill filters are stored per database** (`aggapi.examples.filters.<stem>`).
`reproductions.agg` carries no `tags{}`, so its facet bar has only kind pills,
and a persisted `role:intro` from `library.agg` would otherwise hide every row
with nothing on screen to say why.

A stored stem the server no longer lists (a file dropped in a later `aggregate`)
falls back to the default silently and clears the stored value.

`lite.js` shares `loadExamples()`, so the phone page follows the stored choice
with no selector of its own. Its curated chips are `library.agg` names, so under
another file they simply find nothing and the existing `console.warn` path
covers it; the search box still reaches every entry.

### Files

| File | Change |
|---|---|
| `src/aggregate_api/library.py` | `shipped_databases()` (discovery, filter, order); `get_database_underwriter(stem)` (cached private base) |
| `src/aggregate_api/examples.py` | `load_examples(database=None)` keyed on stem |
| `src/aggregate_api/routes/examples.py` | `database` query param on `/examples`; `GET /examples/databases`; 422 on unknown stem or failed load |
| `src/aggregate_api/models.py` | `DatabasesResponse` |
| `web/src/api.js` | `examples(database)`, `databases()` |
| `web/src/examples.js` | selected-database state, cache reset, per-database filter key |
| `web/index.html` | **Examples from** section in the hamburger |
| `web/src/main.js` | wire the menu items, header line |
| Help offcanvas | one paragraph on the new section |
| `tests/test_examples.py`, `tests/fixtures/agg/` | below |

### Tests

Against a synthetic fixture directory monkeypatched in as the default database
directory, so the suite does not depend on what the installed `aggregate` ships
(1.0.1, the pin floor, has no `reproductions.agg`):

* the listing excludes `_hidden.agg` and the `cwd` and `user` rows, and puts
  the default first;
* `?database=alpha` returns alpha's entries in file order; absent returns the
  default unchanged;
* `?database=../x` and `?database=nope` are 422;
* `broken.agg` (one unparseable line) is a 422 carrying the parse message, and
  the default listing still works afterwards;
* `node --test`: the per-database filter key, in
  `web/test/example-filters.test.js`.

### Acceptance

1. `uv run pytest` and `node --test` green.
2. With the worktree installed editable (`uv pip install -e
   V:/worktrees/aggregate_REFACTOR`), the hamburger lists `library.agg`,
   `decl-testers.agg` and `reproductions.agg`.
3. Choosing `reproductions.agg` fills the Examples menu with 140 entries in
   file order; `Bear1990.BN.One` loads and builds; an `nttagg` and an `xpnl`
   entry load and build. Ctrl+K and the Ctrl+Shift ring read the same list.
4. Reload: the choice persists. A private window still sees `library.agg`.
   The landing build is unchanged.

## Step [deep-link], 1.5.0

### The URL

```
/?database=aas-paper&example=Fig3
```

* `database` selects the file, exactly as the menu does, and stores it. Same
  word as the api parameter, which also keeps it clear of `example`, one letter
  away from the `examples` the draft proposed.
* `example` names an entry in that file. The app loads it into the editor with
  its caption and **builds it**, through `pickExample`, which is what a menu
  pick does.
* Either may appear alone. `example` without `database` resolves in the stored
  or default file, but links printed in the paper should always carry both so
  they do not depend on the reader's state.
* Names are matched exactly; the first match in file order wins (only
  `decl-testers.agg` reuses a name). Dotted names such as `Bear1990.BN.One` need
  no escaping in a query string; `URLSearchParams` decodes anything that does.

### Startup on a deep link (desktop)

`loadLanding()` checks the URL first. With `example` present it skips the
`LANDING_DECL` build, awaits `loadExamples()` for the selected file, finds the
entry and calls `pickExample(item)`. So the editor shows `BasicBook` until the
payload arrives and then the linked program, with one build, not two. This
waits on the examples fetch (about 2 s against a cold server, plus the file's
own load the first time), which is acceptable because the reader asked for that
program and not the landing one.

Not found (unknown file or unknown entry): the landing build runs as usual and
the status strip says `example "Fig3" not found in aas-paper.agg`, so a broken
link in a printed paper is visible rather than silently replaced.

After the link is applied, `history.replaceState` removes `database` and
`example` from the address bar. The file choice is already stored; leaving the
parameters would make a later reload discard whatever the reader has picked
since and rebuild the linked example over their work.

### Phones

The redirect in `web/index.html` already carries `location.search` to
`lite.html`. `lite.js` reads the same two parameters after `initChips()`, calls
`pick(item)` and then `build()`, and strips them the same way. Same not-found
message in the lite status line.

### Making the links

URLs are predictable, so the paper's build can write them from the entry names
with no app support: `https://<host>/?database=aas-paper&example=<name>`. A
"copy link to this example" control in the menu is not part of this plan; it is
an easy follow-on if writing them by hand proves tedious.

### Files

| File | Change |
|---|---|
| `web/src/examples.js` | `readDeepLink()` / `clearDeepLink()`, pure parse exported for tests |
| `web/src/main.js` | `loadLanding()` branch; not-found message |
| `web/src/lite.js` | same branch after `initChips()` |
| Help offcanvas | one sentence on link form |
| `web/test/example-deep-link.test.js` | parse cases: both, either, neither, encoded name |

### Acceptance

1. `node --test` and `uv run pytest` green.
2. `/?database=reproductions&example=Bear1990.BN.One` opens with that program
   built, the menu set to `reproductions.agg`, and a clean address bar.
3. `/?example=BasicBook` builds `BasicBook` from the default file.
4. `/?database=reproductions&example=Nope` builds the landing program and shows
   the not-found message.
5. `/?lite=1&database=reproductions&example=Bear1990.BN.One` does the same on
   the phone page.
6. Reload after step 2: the reader's current editor contents are not replaced.

## Both steps: housekeeping

Each bump updates `CHANGELOG.md`, `dev/TODO.md`, `pyproject.toml` and `uv.lock`,
re-syncs (then reinstalls the relativity plugin and the worktree editable), and
rebuilds the SPA with `.\scripts\build-web.ps1`, since both steps move `web/`.

## Outside this plan

* **Release dependency.** The feature lists whatever the installed `aggregate`
  ships and needs no pin change. But `reproductions.agg` uses `nttagg`, which
  `aggregate` 1.0.1 cannot parse, and `aas-paper.agg` is in no release yet. When
  the release carrying `aas-paper.agg` ships, raise the pin floor to it and
  deploy, so the paper's links cannot land on a server without the file.
* **Self-containment of `aas-paper.agg`**, as above. An upstream test that each
  of its entries builds against `build` alone would enforce it.

## Execution log

### [databases], 1.4.0 (2026-10-12)

Landed as planned: `shipped_databases()` and `get_database_underwriter()` in `library.py`, `load_examples(database=None)`, `?database=` and `GET /v1/examples/databases`, `DatabaseItem` / `DatabasesResponse`, the Examples from section, per-file filters, the header line, the Help paragraph, and the tests against `tests/fixtures/agg/`. Divergences, each small:

* **The default file keeps the pre-1.4.0 filter key** `aggapi.examples.filters`; every other file uses `aggapi.examples.filters.<stem>`. A returning reader's filters survive the upgrade, and the key follows the selection (null for the default) rather than the default's stem, which moves under `AGGAPI_LIBRARY`.
* **The header line is drawn in `examples.js`** (`mountExamples`), where the dropdown is built, rather than in `main.js` as the Files table said.
* **A stored stem is checked against the listing before the first examples fetch**, one cheap extra request, made only when a non-default stem is stored. That is how the silent fallback for a dropped file is implemented; a listing that does not answer leaves the stem alone and the examples request reports it.
* **The surfaces draw from the current payload**, not one captured at mount, with three states (loading, loaded, failed). As a consequence the Ctrl+K palette now opens on a loading or failure line where through 1.3.0 it refused to open when the fetch failed. A generation counter drops a payload that lands after the file changed.
* **`broken.agg` fails on a bad keyword, not an unbalanced bracket.** An unbalanced bracket trips a bare `assert` in `aggregate.parser.UnderwritingLexer.preprocess`, an `AssertionError` with no message, so the route falls back to the exception's name when the message is empty. Worth an upstream ask: that path should raise the ordinary parse error.
* The listing is not cached (three directory globs). A custom library whose stem matches a shipped file shadows it rather than listing it twice. `create_app` does not clear `get_database_underwriter`, matching `load_examples`, which it never cleared either.
* `T:/worktrees/dev-files.md`, the control list the project skill names, no longer exists anywhere on the machine, so no row was updated.
* **Acceptance** run against the worktree (`aggregate` 1.2.0a13, installed editable) on a scratch server: the hamburger lists the three files with the default ticked; `reproductions.agg` gives 140 entries in file order, header `from reproductions.agg`, the palette reads the same 140; `Bear1990.BN.One`, `Wilson2016a.Wilson` (`nttagg`) and `Bear1990.BN.TreatyII` (`xpnl`) load and build (HTTP 200); the choice survives a reload and the landing is still `BasicBook`; a stored stem the server does not list falls back to `library.agg` and is cleared. Checked on `localhost` because the browser profile blocks storage on `127.0.0.1`. The private window case was exercised as empty storage rather than a literal private window, and the lite page was not driven in this step.
