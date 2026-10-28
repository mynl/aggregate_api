# Plan: show conversion answers in the status bar, Excel and Sheets

`[Status-Bar-Text-Answers]`. Drafted 2026-10-28 against aggregate-api 1.35.1 and
aggregate 1.18.2. **Status: DONE at 1.36.0, 2026-10-28; see the execution log.** One minor bump. It serves two
library plans in the aggregate repository (`V:/worktrees/aggregate_REFACTOR`):

| Library plan | What it adds |
|---|---|
| `dev/plan-tweedie-statement.md`, `[Tweedie-Statement]` | the `conversion` statement kind; `tweedie 1.5 100 2` returns a `TweedieConversion` |
| `dev/plan-stable-statement.md`, `[Stable-Statement]` | `stable 1.5 1 2 0` returns an `aggregate.stable.Stable` |

This one plan serves both, because the api change is the same for every
conversion; the two class names are listed together. Recommended order: land
this plan straight after `[Tweedie-Statement]`; the `Stable` entry is inert until
`[Stable-Statement]` lands, by the same string-key rule that made the `nttagg`
entry inert under older libraries.

## Goal

A program whose answer is a parameter conversion shows that answer as text: in
the aLL status strip, where an expression's number appears today, and as the
cell value of the Excel and Sheets build functions. Typing `tweedie 1.5 100 2`
in aLL shows

```
tweedie 1.5 100 2 = tweedie 1.5 100 cv 0.447214 = tweedie 10 claims sev gamma 10 cv 1, Pr(X=0) 4.54e-05
```

## Current behavior, 1.35.1

- `POST /v1/objects` (`src/aggregate_api/routes/objects.py`) builds the program
  with `_run_build` (`:498`), which returns the object alone; the statement kind
  is on the library's `Recipe`, not on the object. A number (`numbers.Real`,
  not `bool`) is returned at about `:1895` as
  `{"kind": "value", "value": float(obj), "decl": ..., "elapsed_ms": ...}`, with
  audit status `"value"`. Any other object is classified by `_classify_object`
  (`:1998`), which looks the class name up in `_KIND_OF_CLASS` (`:1962`) and then
  the base classes in `_KIND_OF_BASE`; a kind outside `SUPPORTED_KINDS` (`:1983`)
  is refused with 422 "api supports ... only".
- Under aggregate with `[Tweedie-Statement]`, `tweedie 1.5 100 2` would therefore
  be refused as the unsupported kind `tweedieconversion`.
- The SPA (`web/src/main.js:574`) sends `kind === 'value'` to `renderValue`
  (`:542`), which shows `decl = value` in the status strip through
  `renderStripLine` (`:496`).
- Excel (`excel/src/functions/functions.ts:338`) and Sheets
  (`sheets/src/functions.ts:243`) return `made.value` for `kind === "value"` and
  otherwise format an object handle from `made.id`; a new kind would reach the
  handle branch with no id. Both functions already return `string | number`.
  The Excel task pane (`excel/src/taskpane/taskpane.ts:79`) throws "this program
  is a number, not an object" for a value. The Sheets test harness stubs `(2+2)`
  (`sheets/test/harness.ts:137`).
- The api installs the released library; working against the worktree is
  `uv pip install -e V:/worktrees/aggregate_REFACTOR` after any dependency sync
  (`CLAUDE.md`, "Consequence for co-development").

## Design

### [Text-Answer-Route] the api

- `_KIND_OF_CLASS` gains `"TweedieConversion": "conversion"` and
  `"Stable": "conversion"`, with a comment that string keys keep both inert under
  a library that predates them.
- Before the `SUPPORTED_KINDS` check, beside the number branch: when the kind is
  `"conversion"`, return
  `{"kind": "text", "text": str(obj), "decl": req.decl, "elapsed_ms": elapsed}`,
  audited with status `"value"` (a program that means an answer rather than an
  object). Update the audit docstring (`audit.py:181`) to say a value is a number
  or a text answer. Nothing is cached and no recipe is registered, exactly as for
  a number.
- The response kind is `"text"`, not `"value"`, because every client casts
  `value` to a number.
- No dependency floor change. Under an older library the statements are parse
  errors and the branch is never reached; raise the floor when an aggregate
  release containing both library plans is on PyPI and something here depends on
  it.

### [Text-Answer-Clients] the SPA, Excel and Sheets

- SPA: `kind === 'text'` goes to a new `renderText(res)`, which clears the panes
  as `renderValue` does and shows the text alone in a `mono` span in the status
  strip (the program is already in the editor, and the text contains the
  program's own spelling). Check that a line of about 110 characters wraps or
  scrolls in the strip at phone width; if it is clipped, let the text kind wrap.
- Excel `functions.ts` and Sheets `functions.ts`: a `kind === "text"` branch that
  returns and memoizes `made.text`, and `text?: string` on the reply type.
- Excel task pane: a text answer throws "this program is a conversion, not an
  object", beside the number message.
- The Sheets harness gains a stub for `tweedie 1.5 100 2` returning
  `{kind: "text", text: ...}`.

## Steps

### [Status-Bar-Text-Answers], one minor bump

1. `[Text-Answer-Route]` and `[Text-Answer-Clients]` as above.
2. Tests (below), with the worktree library installed.
3. Release: `__version__` in `src/aggregate_api/__init__.py`, `CHANGELOG.md`,
   `dev/TODO.md`; move this plan to `dev/done/`; commit and push; then rebuild the
   SPA with `.\scripts\build-web.ps1` (the house rule for a bump that moves
   `web/`). Publishing the Sheets template (`npm run push`) is the author's.

## Files

| Area | Files |
|---|---|
| Route | `src/aggregate_api/routes/objects.py`, `src/aggregate_api/audit.py` (docstring) |
| SPA | `web/src/main.js` |
| Excel | `excel/src/functions/functions.ts`, `excel/src/taskpane/taskpane.ts` |
| Sheets | `sheets/src/functions.ts`, `sheets/test/harness.ts` |
| Tests | `tests/test_objects.py`, the Excel and Sheets test files beside their value cases |
| Release | `src/aggregate_api/__init__.py`, `CHANGELOG.md`, `dev/TODO.md` |

## Acceptance and tests

- `tests/test_objects.py`, beside the value test at `:430`: building
  `tweedie 1.5 100 2` returns status 200, `kind == "text"`, a `text` containing
  `tweedie 10 claims sev gamma 10 cv 1`, no `id`, and leaves the cache listing
  unchanged; the audit row has status `"value"`. A `stable 1.5 1 2 0` case does
  the same, guarded by `pytest.importorskip("aggregate.stable")`.
- `(2+2)` still returns `kind == "value"` and `4`.
- A program that is not a conversion and has an unknown class is still refused
  with 422.
- Excel: `npm test`, `npm run typecheck`, `npm run lint` in `excel/`; Sheets:
  `npm test`, `npm run typecheck` in `sheets/`, with the new stub returning the
  text as the cell value.
- In aLL, `tweedie 1.5 100 2` and `stable 1000 claims sev 100 * lomax 1.5` show
  their text in the status strip, light and dark, and at phone width.
- Suite: `uv run --no-sync pytest`.

## Deferred

- The aLL help card lines for the two statements are in the library plans
  (`src/aggregate/data/decl-help/card.html`), since the help HTML belongs to the
  library.
- A copy button on the status strip for text answers.
- The object kind for `[Characteristic-Function-Engine]`
  (`dev/plan-characteristic-function-engine.md` in aggregate), a separate api plan
  when that work is scheduled.

## Execution log

**1.36.0, 2026-10-28**, against the worktree aggregate 1.23.0 (both library plans landed: `[Tweedie-Statement]` 1.22.0, `[Stable-Statement]` 1.23.0). Rulings asked at review and given the same day: the three items marked *ruled* below.

Divergences:

- **[Classify-By-Statement-Kind]**, *ruled*: the route does not add `TweedieConversion` and `Stable` to `_KIND_OF_CLASS`. The plan's premise that the kind lives only on the `Recipe` was incomplete: the preview the route already makes carries it, `preview.statements[-1].kind == 'conversion'` (`underwriter.ANSWER_KINDS`). `_is_conversion(preview)` in `routes/objects.py` decides the branch, so the library's next conversion needs no edit here and the list of class names never exists. The branch sits after the build, beside the number branch, as planned.
- **[Text-Response-Model]**: the plan did not cover the response model. `POST /v1/objects` validates against a discriminated union, so `models.TextResponse` (`kind`, `text`, `decl`, `elapsed_ms`) was added and the union, renamed `_BuildOrAnswer`, gained it. Without it the route 500s on its own answer.
- **[Old-Template-Copies]**, *ruled, accepted*: a Sheets template copy made before 1.36.0 takes `kind: "text"` down its handle branch and shows `text.#undefined` instead of the 422 it got through 1.35.1. Only the new statements reach it, so no working sheet changes. Stated in the CHANGELOG.
- **[Program-Is-Value-Message]**: `core.ts` `programIsValue` now reads "this program is a number or a conversion, not an object; ..." in both hosts, since a conversion passed where a handle is expected (`AGG.STATS("tweedie 1.5 100 2")`) reaches the same refusal. `excel/test/core.test.ts` and `sheets/test/functions.test.ts` follow; the Excel test is renamed from "byte-identical to the constant the hosts replaced", which is no longer true.
- **[YELT-Rename]**, *ruled, folded in*: regenerating `web/src/decl-words.json` (asked by the author alongside this plan) adds `stable` and replaces `ylt` with `yelt`, per aggregate 1.20.0. The same bump renames `ylt` to `yelt` in `loss_table_files.py` (the 422 refusal text and the module docstring) and `tests/test_loss_table_files.py`, the downstream list in the library's 1.20.0 entry. `tweedie` was already in the word list as a severity.
- **Excel tests**: Excel has no function level test of the value kind (its node suite covers `core.ts` only), so the Excel side is checked by `npm run typecheck` and `npm run lint`, plus the message test above. The Sheets harness carries the `tweedie 1.5 100 2` stub and a test of it.
- **SPA strip**: no CSS change. `.status-strip` has `overflow-wrap: anywhere` and the mono span wraps at spaces, so the 110 character line wraps at phone width.
- **Phone edition**: `lite.js` builds only menu examples, which a conversion never is (it is never stored in the recipe base), so it has no text branch.
- The stale `Pr(X=0) 4.54e-05` in the Goal is `4.53999e-05` from the library (six significant figures). The tests match on a fragment.

Gates: `uv run --no-sync pytest` (see the commit's CHANGELOG), `npm test` in `web/`, `excel/` and `sheets/`, `npm run typecheck` in `excel/` and `sheets/`, `npm run lint` in `excel/`.
