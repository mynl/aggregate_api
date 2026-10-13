# Plan 1.7.0 and 1.8.0: DecL help from the program box `?` and from the hamburger menu

Status: draft, cross-reviewed 2026-10-13 against the library's plan,
`V:\worktrees\aggregate_REFACTOR\dev\plan-1.2.0a15-decl-help.md`
**[DecL-Help-Pages]**, which answers Q1, Q2, Q3, Q5 and Q6 below and fixes the
contract. The author ruled Q4 the same day. Two steps, two bumps:

* **[anatomy]** 1.6.0 to **1.7.0**: the help route, a `?` in the editor's margin
  column, and the anatomy fragment in a popover under the button row.
* **[card]** 1.7.0 to **1.8.0**: Menu ▸ DecL on one page, the card fragment on a
  printable sheet.

Each step is its own commit, so either can be reverted alone. Version numbers
assume `plan-1.6.0-pentagon-readout.md` lands first; if not, shift both down one.

## Goal

At the 2026-10-13 demo the obvious gap was help for DecL itself: someone new to
the language has nowhere in the app to look up what goes where. The library is
writing that help (it owns the language, so it owns the words), as static HTML
fragments that render the same in the Loss Lab and in a Jupyter cell. This plan
is the api and SPA half: serve the fragments, open them from two places, and
add the two things only the Lab can do (Load buttons and Lab-only notes).

The design comes from the library's mockups (round 3, 2026-10-13), which the
author has chosen:

* **Concept B, "anatomy"**: one aggregate statement taken apart slot by slot,
  portfolio and P&L as two ways to use it, and a table of the forms each slot
  accepts. Hovering a slot lights up its forms. Opened by the `?` in the
  program box, as a popover in front of the output, with the editor still live
  above it.
* **Concept C, "card"**: a dense ten-box reference card that prints to exactly
  one Letter landscape page. Opened from the hamburger menu. No Load buttons.

## Division of labor

| Who | Owns |
|---|---|
| `aggregate` | the fragment HTML, its scoped styles, syntax coloring (pre-rendered with its Pygments DecL lexer), the version stamp, and the Jupyter entry point |
| api | one route serving a fragment as `text/html`, and a `/v1/meta` field listing the forms the installed library offers |
| SPA | where the fragments open, how they close, the Load buttons, the `in-lab` class, and printing |

**The api copies nothing.** Under the house rule against copying library
internals, there is no fallback fragment in this repo. When the installed
library has no help, the two entry points are shown unavailable with a reason.

## The fragment contract

As settled by the library plan (its "Content files" rules 1 to 10 and "The
renderer"). Each point is something the SPA depends on.

1. One `<section class="decl-help dh-anatomy">` or
   `<section class="decl-help dh-card">` per fragment, carrying one `<style>`
   in which **every rule is scoped to its form** (`.decl-help.dh-anatomy ...`),
   enforced by a library test. No script, no external fonts or assets.
2. Syntax colors arrive pre-rendered as `t-kw`, `t-num`, `t-str` and `t-com`
   spans, in the editor's colors. There is no `t-atom`: the library's lexer has
   no category for distortion names.
3. `data-decl-version` on the section carries the library version.
4. `data-load="<program>"` marks a loadable example and carries its program
   verbatim (anatomy only; the card has none).
5. `.dh-lab` notes show only when the host adds `in-lab` to the section;
   `.dh-py` notes show everywhere else.
6. `--dh-*` custom properties let a host retheme. `--dh-size` sets the base
   type size; everything inside is in `em`, so it scales as a whole.
7. The card sets `print-color-adjust: exact` on itself and carries no `@page`
   rule; page size stays the host's (see step [card]).

## Questions for the cross-review

Numbered for the session. Each one carries the api side's recommendation.

**Q1. The entry point.** The api needs one callable, such as
`aggregate.decl_help(form) -> str`, plus a way to list the forms (a module
constant is enough). The name is the library's to choose and vet against
`HelpMixin.help` and the `Underwriter` surface. This plan reads it in exactly
one place (`aggregate_api/decl_help.py`, below), so a rename here is one line.
*Answered:* `aggregate.decl_help(form='anatomy')` returns `DeclHelp`, a `str`
subclass (with `_repr_html_` for Jupyter); the forms are
`aggregate.DECL_HELP_FORMS == ('anatomy', 'card')`. Names vetted by the library.

**Q2. The base rules collide between the two fragments.** Both mockups define
unscoped base rules with different values: `.decl-help { font: 13.5px/1.45 ... }`
in B and `.decl-help { font: 11px/1.4 ... }` in C, and likewise
`.decl-help code` and `.decl-help pre.dh-code`. A `<style>` inside a section
still applies to the whole document. So with both in one page, whichever was
inserted last sets the type size for both. That would happen in the Lab
(open the card, close it, open the anatomy) and in any notebook that shows
both. **Ask:** scope every rule that differs under `.decl-help.dh-b` or
`.decl-help.dh-c`, keeping only identical rules on bare `.decl-help`. The SPA
also keeps at most one fragment in the DOM at a time, but that only protects
the Lab. *Answered:* every rule, identical or not, is scoped to its form
(classes renamed `dh-anatomy` and `dh-card`), and a library test enforces it.
One fragment in the DOM at a time is kept as hygiene, no longer needed for
correctness.

**Q3. Load reads the program from an attribute, not from the markup.** The
mockup's `loadText` rebuilds the program from `.ln` and `.dh-l` spans. That ties
the host to the library's internal markup, and pre-rendered Pygments output
will not use those classes. **Ask:** put the program verbatim on the marked
element, `data-load="agg Book 250 claims ..."`, or `data-decl` if `data-load`
should stay a bare flag. The SPA reads that string and nothing else.
*Answered:* `data-load` carries the program verbatim in the rendered output.

**Q4. Load loads; it does not build.** Recommendation: Load puts the program in
the editor, flashes the box, and leaves the help open, because the reader is
composing with the slot table beside them. Pressing Build closes the help and
shows the result. This differs from the Examples menu, which builds on pick
(author, 2026-09-06: choosing an example is asking to see it). Using the help
is closer to writing than to choosing. *Ruled* (author, 2026-10-13): Load
loads and does not build.

**Q5. Type size in B.** The forms table runs at .64 to .74rem, about 10 to
12px. That is fine at a desk and small on a projector. Library's call.
*Answered:* the scale stays, expressed in `em` off `--dh-size` (default 13.5px
for the anatomy, 11px for the card). If the table proves small on a projector,
this plan sets `--dh-size` on `.decl-pop` and touches nothing in the library.

**Q6. The `?` placement differs from the mockup.** The mockup puts the `?` to
the left of the `✕`, as a red outlined circle. The author asked for it
**above** the `✕`, in the same margin column. That column is drawn in Bootstrap
icons (`bi-x-circle`, `bi-arrow-up-circle`, `bi-arrow-down-circle`; see
`.hist-step` in `site.css`), so this plan uses `bi-question-circle` for one set
at one weight, and shows the house color only while the help is open. The
popover's caret then points at that column. *Library:* no opinion; the caret
and accent edge are the popover's chrome, not the fragment's.

**Q7. Library findings that touch this repo,** from the mockups' index page.
They go to `dev/TODO.md` as separate items, not into this plan:
`web/src/decl-keywords.json` lacks `deposit`, `rol`, `cede`, `reinstatements`,
`lr`, `dist`, `bivariate`, `clash`, `grossnet`, `ssev` and `picks`; and a
comment in `web/src/decl-mode.js` says names may not contain `_`, which the
grammar allows.

## Current behavior

* **Editor margin column** (`web/index.html` about line 199,
  `web/src/styles/site.css` `.editor-clear` and `.editor-hist`, about lines 312
  to 354). The `✕` (`#editor-clear`) sits at `top: .85rem`. The history stack
  (up, readout, down) starts at `top: 2.8rem` and ends near 128px. The editor's
  floor is six lines: `minHeight: '10.2em'` in `web/src/editor.js` (about line
  165), which is 6 × 1.4em + 24px at 14px, about 143px. The text keeps a 54px
  right-hand channel (`padding: '12px 54px 12px 10px'`) so lines never run
  under the column.
* **Button row** `.btnrow` (about line 258): Build, Examples, Reformat, the
  derive group. Below it `#status-strip`, then the group tabs `.out-tabs`, then
  `.tab-content`.
* **Hamburger** (about lines 81 to 158): Examples from, Tables, Perspective,
  Editor, then Help (the Quick help offcanvas), Download models, About.
* **Loading a program**: `loadExample(decl, formatted)` in `web/src/main.js`
  (about line 4574) sets the editor text, clears the cession draft, focuses and
  anchors the editor. `pickExample` adds the caption and builds. `build()` is
  about line 481.
* **`/v1/meta`** (`MetaResponse` in `models.py`) is fetched once at boot and
  already carries `plugins`, which decides whether the Lab tab shows.
* **`routes/decl.py`** serves `/v1/decl/complete`, `lex`, `format`, `parse`
  (POST) and `GET /v1/decl/grammar` (plain text from `importlib.resources`).
* **Installed library**: `aggregate` 1.0.1 from PyPI, which has no help. The
  pin is `aggregate>=1.0.1,<2`.
* **Phones** (max-width 640px with a coarse pointer) are redirected to
  `lite.html`, which this plan does not touch.

## Step [anatomy], 1.7.0

### api

**New module `src/aggregate_api/decl_help.py`**, the one place that knows the
library's entry point:

* `available_forms() -> list[str]`: the forms the installed library offers, or
  `[]` when it has no help:
  `list(getattr(aggregate, 'DECL_HELP_FORMS', ()))`. Feature-detected, so
  this works against 1.0.1 and needs no floor change.
* `fragment(form: str) -> str`: `str(aggregate.decl_help(form))`. The library
  already caches the render per process, so no second cache here. The library
  raises `ValueError` on a form it does not know, so callers check the form
  against `available_forms()` first.

**Route** `GET /v1/decl/help?form=anatomy` in `routes/decl.py`:

* 200 `text/html; charset=utf-8`, the fragment exactly as the library returned
  it, with `Cache-Control: public, max-age=3600`.
* 404 with a JSON `detail` when the installed library has no help or does not
  offer that form, naming the installed library version.
* `form` defaults to `anatomy`. The route checks it against
  `available_forms()` before calling `fragment()`, so an unknown form is a 404,
  never a 500.
* `v` is accepted and ignored. The SPA sends the library version there
  (`meta.aggregate_version`) so that an upgraded library changes the URL and a
  browser cannot serve the old fragment for up to the hour the cache header
  allows.

**Meta**: `MetaResponse.decl_help: list[str] = []`, filled from
`available_forms()`. The SPA learns at boot whether to offer help at all, with
no extra request, the same reasoning `plugins` gives.

### SPA

**The `?` above the `✕`.** In `index.html`, a
`<button type="button" class="editor-help" id="editor-help" aria-label="DecL help" aria-expanded="false">`
holding `bi-question-circle`, before `#editor-clear`. Then:

* `.editor-help` takes `top: .85rem`; `.editor-clear` moves to `top: 2.6rem`;
  `.editor-hist` moves from `2.8rem` to `4.55rem`, ending near 156px.
* The editor floor goes from six lines to seven: `minHeight: '11.6em'`
  (7 × 1.4em + 24px is 11.5em at 14px, rounded up as before). That is about
  162px, so the stack keeps its present slack. The comments that carry this
  arithmetic in `editor.js` and `site.css` are updated to the new numbers.
* The 54px channel is unchanged, since the `?` is in the same column.
* The label never changes. Open, the `?` shows `aria-expanded="true"` and
  `color: var(--house)`. Pressing it again closes the help, which is the same
  action, so it is not a button that changes meaning with state.
* When `meta.decl_help` lacks `anatomy`, the `?` is disabled and its title says
  so: "DecL help arrives with aggregate 1.2.0". The help lands in the library
  at 1.2.0a15 and ships in 1.2.0 (author, 2026-10-13).

**The popover**, as the mockup draws it. In `index.html`, a
`<div class="decl-pop" id="decl-pop" role="dialog" aria-label="DecL help" hidden>`
holding a close `✕` and a slot, inside a new `.editor-area` wrapper around
`.editor-wrap` and `.btnrow`:

* Absolutely positioned under the button row, the full width of the main
  column, `z-index` above the output. Top edge in `var(--house)`, a deep
  shadow, and a caret pointing up at the `?` column.
* While open, the status strip, the group tabs and `.tab-content` dim and blur
  (one class on `main`). The output is not destroyed, so closing restores it
  exactly.
* The editor and the button row stay live above it.
* The page grows if the popover is taller than the output beneath, so there is
  still one scrollbar.

**Opening**: fetch `/v1/decl/help?form=anatomy&v=<aggregate_version>` once,
memoized. Remove any
other `.decl-help` section from the DOM (hygiene; scoping already keeps them
apart, Q2), insert, add `in-lab`, add the Load buttons. A failed fetch shows one
line in the popover saying why.

**Closing**, every route the same function: the popover's `✕`; the `?`; Esc; a
click on the dimmed area; and **any build**, called at the top of `build()`, so
Ctrl+Enter, the Build button and an example pick all close it.

**Load buttons**: one `button.dh-load` per `[data-load]` element, reading the
program from the attribute (Q3), calling `loadExample(program)` with no caption
and no build (Q4), then flashing the editor box. The `.dh-load` styles are the
app's and live in `site.css`, since the library ships no host chrome.

**New module `web/src/decl-help.js`**: `mountDeclHelp({ button, pop, meta })`,
with open, close, fetch and enhance. `main.js` calls it once and calls its
`close()` from `build()`.

### Files

* `src/aggregate_api/decl_help.py` (new), `routes/decl.py`, `models.py`,
  `routes/meta.py`.
* `tests/test_decl_help.py` (new), `tests/test_meta.py`.
* `web/index.html`, `web/src/decl-help.js` (new), `web/src/main.js`,
  `web/src/editor.js`, `web/src/styles/site.css`.
* `CHANGELOG.md`, `pyproject.toml` (1.7.0), `uv.lock`, `dev/TODO.md` (tick, plus
  the Q7 items).

### Tests

`tests/test_decl_help.py`, with the library entry point monkeypatched, since
1.0.1 has none:

* present: 200, `text/html`, the body is the fake fragment byte for byte, the
  cache header is set.
* absent: `available_forms()` is `[]`, the route is 404 with the library
  version in `detail`, and `/v1/meta` reports `decl_help: []`.
* an unknown form: 404, and the fake `decl_help` is never called.
* the `v` parameter is accepted and does not change the body.

And one run against the real sibling worktree once the library code exists
(`uv pip install -e V:/worktrees/aggregate_REFACTOR`, then
`uv run --no-sync pytest`), which is the check that the contract holds.

### Acceptance

* `uv run pytest` and `npm test` pass.
* `.\scripts\build-web.ps1`, then against the worktree library:
  * The `?` sits above the `✕`, the arrows below, all in one right-aligned
    column. An empty editor shows seven lines, and stepping through history
    still moves nothing below the box.
  * `?` opens the anatomy over the dimmed output; hovering a slot lights up its
    forms; Load fills the editor and the help stays open; Build closes it and
    shows the result.
  * The `✕`, Esc, a click on the dimmed area, and the `?` each close it.
  * iPad, both orientations: the fragment stacks to one column below 820px and
    nothing scrolls sideways except the forms table inside it.
* Against PyPI 1.0.1 (after a plain `uv sync`): the `?` is disabled with its
  reason, and nothing else changes.

### CHANGELOG (draft)

```
## 1.7.0

[DecL-Help] **a `?` in the program box opens DecL help**, one statement taken apart slot by slot, written by the `aggregate` library. Plan `dev/plan-1.7.0-decl-help.md`, step [anatomy], the first of two.

- The `?` sits above the `✕` in the editor's margin column; the history arrows move down and an empty editor is seven lines tall.
- The help opens over the dimmed output with the editor live above it. Hover a slot to light up the forms it accepts.
- Load puts an example in the editor without building; Build closes the help and shows the result.
- New route `GET /v1/decl/help?form=anatomy`, and `/v1/meta` lists the forms the installed library offers. With a library that has none, the `?` is unavailable and says why.
```

## Step [card], 1.8.0

### SPA

**Menu item**: "DecL on one page", directly after Help in the hamburger. Disabled
with a reason when `meta.decl_help` lacks `card`.

**The sheet**: a Bootstrap modal, `modal-dialog-scrollable`, sized to the card
(`width: min(1056px, 100vw - 2rem)`, 1056px being 11in at 96 CSS px). The header
holds "Print or save as PDF" and the close `✕`. The body holds the fragment,
fetched as `/v1/decl/help?form=card&v=<aggregate_version>`, with `in-lab` added
and no Load buttons. Before inserting, the anatomy section is removed, and the
reverse when the anatomy next opens. That is hygiene, not correctness: the
library scopes every rule to its form (Q2).

A modal is right here even though the anatomy is not one: the card is for
reading and printing, not for composing beside the editor.

**Printing.** Print adds `printing-decl-card` to `body`, injects a `<style>`
holding `@page { size: letter landscape; margin: 0 }`, and calls
`window.print()`. `afterprint` removes both. Under that class, print CSS hides
everything except the sheet. The card keeps its own colors in print (contract
point 7), so the app sets no `print-color-adjust`. The `@page`
rule is injected rather than written in `site.css` because `@page` cannot be
scoped to a class, and a permanent one would change how every other page of the
app prints. Ctrl+P anywhere else is untouched.

**One page** is the library's guarantee (its typography), and the app adds no
margin or chrome to the printed sheet.

### Files

* `web/index.html` (menu item, modal), `web/src/decl-help.js` (the card path),
  `web/src/styles/site.css` (sheet width, print rules).
* `CHANGELOG.md`, `pyproject.toml` (1.8.0), `uv.lock`, `dev/TODO.md`.

### Acceptance

* Menu ▸ DecL on one page opens the card on a sheet; the `✕` and Esc close it.
* Print, then Save as PDF in Chrome and Edge, gives exactly one Letter
  landscape page with the colors intact and no app chrome.
* Opening the anatomy after the card (and the reverse) shows each at its own
  type size (Q2).
* Ctrl+P on the main page prints as it did before.

### CHANGELOG (draft)

```
## 1.8.0

[DecL-Help] **Menu ▸ DecL on one page** opens the library's DecL reference card, which prints to one Letter page. Plan `dev/plan-1.7.0-decl-help.md`, step [card], the second of two.

- The card opens on a sheet with Print or save as PDF; the printout is exactly one landscape page with nothing else from the app on it.
- Unavailable, with the reason, when the installed library has no card.
```

## Not in this plan

* `lite.html`, the phone page. A phone gets neither form for now.
* Raising the `aggregate` floor. The help is feature-detected, so the floor
  moves only when the author decides help should be guaranteed rather than
  offered.
* The Q7 keyword and comment fixes, which are separate TODO items.

## Execution log

Executed 2026-10-13 on the author's `/execute-plan`, after the library landed its half as `aggregate` 1.2.0a15 (`70081f7`, plan `plan-1.2.0a15-decl-help.md`, executed the same day).

### Review

* The status line reads "draft", but every question is answered by the library or ruled by the author (Q4), and the invocation said the library had landed, so it was taken as the go-ahead, as the library's own execution was.
* Every path, symbol and line in "Current behavior" checked out against 1.5.0. `decl_help`, `available_forms`, `fragment`, `mountDeclHelp` and `decl_help` on `MetaResponse` collide with nothing in `src/` or `web/src/`.
* The library's execution notes carry one ripple for this side: every fragment rule now outranks an unscoped host rule by a class. Nothing here overrides a fragment rule, so nothing breaks.
* `T:/worktrees/dev-files.md`, the control list the project skill names, does not exist (nor under `V:/worktrees`), so no row was updated.

### Divergences

1. **[Version-Numbers] 1.6.0 and 1.7.0, not 1.7.0 and 1.8.0.** `plan-1.6.0-pentagon-readout.md` has not landed (it is "draft, for review"), so both steps shift down one as this plan's header directs. The file name keeps 1.7.0. The pentagon plan's own number is now stale and needs renumbering by the author.
2. **[Fetch-Wrapper] `web/src/api.js` gains `api.declHelp(form, v)`**, not in the file list. The fragment is text, not JSON, so it cannot go through `_json`; the wrapper keeps the session header and `API_BASE` (split origin) that every other request carries.
3. **[Load-From-Help] Load goes through a small `loadFromHelp` in `main.js`, not a bare `loadExample(program)`.** It also clears the example caption and the walk position, as typing does: without that, a Load after an Examples pick left the previous example's caption in the strip, where it survives the next build. The ring on the editor box is a new `is-loaded` animation, since the existing flash is the strip's.
4. **[Load-Placement] the anatomy table's Load sits below the table's bottom right corner; a code block's sits inside its top right.** Inside the top right, as the code blocks have it, the table's button covered the first row's gloss ("keyword, then a label you choose"). Chosen by `pre` or not, which the fragment contract itself distinguishes (library rule 3).
5. **[Meta-Test-Home] the `/v1/meta` assertions live in `tests/test_decl_help.py`**, beside the fixtures that patch the library, rather than in `tests/test_meta.py`, which is unchanged. One further test runs only against a library that has help and checks the contract: each listed form is one `section.decl-help.dh-{form}` stamped with the library version, no script, and a valued `data-load` on the anatomy.
6. **[JS-Test] `web/test/decl-help.test.js`** covers `loadables` (the program comes from the attribute, in document order, and a blank one offers nothing), which the plan did not ask for.
7. **[Popover-Wrapper-Indent] the new `.editor-area` wrapper in `index.html` does not re-indent its contents**, so the diff that added it stays readable; comments mark both ends.
8. **[Plan-Stays] this plan stays in `dev/` at the final step**, per the house rule that a plan moves when the author says it is done, as the library's half did. The project's `version-bump` skill says otherwise.

### Measurements, step [anatomy]

* Headless Edge against the worktree library, at 1280 by 900: the margin column is help 128 to 155px, clear 156 to 183px, history 187 to 269px, inside a box ending at 278px; the empty floor is 162px. The popover opens with the section carrying `in-lab` and `data-decl-version="1.2.0a15"`, and three Load buttons.
* Hover on the severity row lights all four `severity` elements. Load on the portfolio puts `port Two.Books ...` in the editor, rings the box and leaves the help open and the strip unchanged; Build then closes the help and builds `Two.Books`. The `✕`, Esc, the `?` and a real mouse click on the dimmed output each close it.
* At 820 by 1180 (iPad portrait) the fragment is one column and at 1180 by 820 two; neither scrolls the page sideways (`scrollWidth == clientWidth`).
* `uv run --no-sync pytest` against 1.2.0a15: 517 passed. `npm test`: 289 passed.
