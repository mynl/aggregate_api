# Plan: several DecL statements in the playground's editor box

`[Multi-Statement-Programs]`. Drafted 2026-10-30 against aggregate-api 1.39.0 and
aggregate 1.43.0 (the worktree). One minor bump; the version is assigned when
the plan executes. No library change and no change to the `aggregate` floor. No
background work: no watcher, timer or poller is added. No `excel/` or `sheets/`
change. **Status: final, 2026-10-30. Executed as 1.40.0, 2026-10-30; see the
execution log at the end.**

## Goal

Two things, in one bump, because both replace the same line of code.

1. **The playground's editor (the box) accepts several statements**, separated
   the way the library already separates them: a blank line, or a `;` at the end
   of a line. The result on screen is the last statement. For example:

   ```
   stable x1 1.3 0;
   stable x2 1.3 1;
   stable.x1 + stable.x2;
   ```

   ```
   sev My.Sev (250 / exp(1/2)) * lognorm 1

   agg My.Agg 100 claims sev.My.Sev poisson
   ```

   Several statements are expected to be the exception: three to five in
   ordinary use, twelve at most.

2. **The API stops accepting text the library refuses.** `POST /v1/objects`
   accepts today several things `build()` rejects as parse errors. Those become
   parse errors here too, for every client. The rule after this plan: the route
   parses a program the way `Underwriter.build_many` does, and nothing else.

## The rule for several statements

A program is a chain of bindings and one term: let x1 = e1 in ... in en. Each
statement before the last (the prelude) is parsed and filed as a recipe in the
caller's session, exactly as an entry of `library.agg` is filed. Only the last
statement is built. **A program of several statements means the same as
submitting its statements one at a time**, with one difference: a parse failure
anywhere files nothing.

How a prelude entry comes into use, confirmed by counting constructions in the
library (see Evidence):

- `sev.X` and `agg.X` in a later statement: the referent's stored spec is copied
  into that statement's spec at parse time. `X` is never built as an object of
  its own.
- `port P agg.A agg.B`: the portfolio builds `A` and `B` as its units.
- `sev agg.X`: the library builds `X` when the referring statement builds, and
  requires `X` to pin its grid with `hints{}`.
- `stable.x1 + stable.x2`: the stored parameters are combined when the last
  statement parses. Nothing is built, because a stable law has no grid.

**Accepted consequence (author, 2026-10-30).** A prelude statement that parses but
cannot build gives no error until something refers to it. `agg Bad 1 claim sev
lognorm 1 cv -2 poisson` above an unrelated last statement goes unnoticed. A
reference to a name that does not exist is still refused, since that fails at
parse.

## Current behavior, 1.39.0

- `collapse_program` (`src/aggregate_api/routes/objects.py:1414`) replaces every
  backslash with a space, calls the library's `UnderwritingLexer.preprocess`,
  which splits a program into statements, and then joins them back into one line
  (`:1475`). `post_object` applies it at `:1610`. Both examples under Goal
  therefore fail with a parse error at the start of the second statement.
- That same line is the source of the tolerated forms, measured against `build()`:

  | Text | `POST /v1/objects` | `build()` |
  |---|---|---|
  | blank line inside one statement | 200 | parse error |
  | blank line before `note{}` | 200 | parse error |
  | blank line inside a `note{}` body | 200 | parse error |
  | backslash then newline | 200 | parse error |
  | backslash in mid-line | 200 | parse error |
  | backslash in a `note{}` body | 200, backslash deleted from the note | builds, backslash kept |
  | unbalanced `[` | 500 | `AssertionError` |

  Trailing `;`, CRLF line ends, comment lines, tabs, and a blank line inside
  `[ ]` all behave the same on both sides.
- `Underwriter.build` raises on more than one output. `Underwriter.build_many`
  builds every statement. `Underwriter.preview` parses without filing anything,
  and `Underwriter.add_recipe` files one statement; `_register` (`:714`) already
  uses it on the cache hit path.
- `POST /v1/decl/format` (`routes/decl.py:125`) renders each statement from its
  previewed spec, so Reformat inlines every dotted reference. See
  [reformat-refuse].
- Two places replace the box with a derived program: `runDerivation`
  (`web/src/main.js:741`, used by Sharpen, Hints, P&L, Explode and Cede) and
  `applyViews` (`:1044`). No code outside `main.js` does.
- The status strip has a first row, always visible, and a note slot
  (`#summary-note`), which `site.css:675` hides behind a chevron when the strip
  shows an object.

## Decisions taken by the author, 2026-10-30

- Earlier statements are declared and not built. The silent failure above is
  accepted.
- Multi-statement programs need not work in Excel and Sheets.
- The limit is 12 statements.
- Sharpen, Hints and every other control that transforms the box **refuse** a
  program of more than one statement, with feedback in the status bar.
- Reformat refuses too, with the same feedback. This was decided after the
  alternative under "Reformat: the alternative of splitting and recombining" was
  laid out.
- A blank line always separates statements. "aLL should not parse things that
  build will not parse": `port P`, blank line, `agg A ...` becomes a parse error,
  with no fallback to the old join.

Two further points were put to the author, who then finalized the plan without
changing them:

- The stricter parse applies to every client, Excel and Sheets included, so there
  is one parse rule and no branch. See [strict-parse].
- The overwrite of an edited single statement by Sharpen, Hints and Cede stays out
  of this plan. See Not in scope.

## Change

### [strict-parse] Remove what the API accepts and the library refuses

In `routes/objects.py`:

- Add `split_program(decl) -> list[str]` beside `collapse_program`: `preprocess`
  with whitespace normalized per statement, and **no backslash replacement**. An
  `AssertionError` from `preprocess` (an unbalanced `[`) becomes a `ValueError`
  with the message "unbalanced [ ] in this program". `post_object` returns that
  as a 422 with audit status `parse_error`, in place of today's 500.
- `post_object` no longer folds. It uses `split_program` for every client.
- `collapse_program` remains for the five derivation sites (`:3814`, `:3928`,
  `:4043`, `:4125`, `:4249`), which flatten programs the library rendered or
  `entry.decl`. It becomes `split_program` plus a check: more than one statement
  raises `ValueError`, an empty program returns `''` as today. It never joins
  statements again. The check is loud on purpose: `format_program` over all 206
  library entries, and the 697 tests of the suite, produced nothing that splits.
- `_resolve_risk` (`:4364`), the one other site, takes text typed by a reader into
  the Bounds form. It passes that text to `uw(...)` unchanged and runs the log2
  scan over it, so it follows the library's rule by construction.
- For one statement, `split_program(decl)[0]` is byte-identical to today's fold
  on any program with no backslash, so every existing cache id is unchanged. A
  test pins this.

**This reaches Excel and Sheets.** A cell with a blank line inside one statement,
or a stray backslash, builds today and becomes a 422. `joinDecl`
(`excel/src/functions/core.ts:189`) drops empty cells and joins with a single
newline, so only a blank line typed inside one cell is affected. The routes a
copy of the Sheets template calls keep their shape, so this is not a contract
change in the sense of `CLAUDE.md`, but it does refuse an input that used to
work. The author has not knowingly used it and asked for it to go.

### [route-split] Split, file the prelude, build the last statement

In `post_object`, replacing `:1610`:

```python
parts = split_program(req.decl)       # 422 on unbalanced brackets
# every statement, for the empty check, the log2 scan and their audit rows
req.decl = " ".join(parts)
# existing empty check and log2 cap check, unchanged
if len(parts) > 1:
    # refuses, or files all but the last
    _declare_prelude(uw, parts, req, request, settings, audit, ...)
req.decl = parts[-1]
```

Everything after that point (preview, key, lookup, build, classify, audit) runs
unchanged on the last statement. `_declare_prelude` does, in order:

1. Refuse over `settings.max_statements` with a 422 and audit status
   `limit_exceeded`, with a message giving the count and the limit.
2. Refuse when `req.library_references_only` is set, with a 422 and audit status
   `build_error`: "this client builds one statement at a time; this program holds
   N". That flag is sent by every Excel and Sheets build. Without this refusal a
   program would build once and then fail on resubmission, because the preview
   would list its own names as session entries and `_own_reference` would refuse
   them.
3. Take `scratch = uw.fork(...)`. For each statement in order, call
   `scratch.preview(statement)`, then `_register(scratch, preview)` so that the
   next statement resolves against it. On failure, audit and raise exactly as the
   single-statement path does, reusing `_missing_entry_detail` and
   `_unpreviewable_detail`, and add `statement_index` (zero-based, the key
   `/v1/decl/parse` already uses) to a dict detail, or prefix `statement N: ` to a
   string detail.
4. For a request outside the private network, run `preview_names_file(scratch,
   preview)` on each statement and refuse with `FILE_REFUSAL` if any is true.
5. Only after every statement has passed: `_register(uw, preview)` for each
   statement but the last, then record one audit row with the new status
   `declared` and the prelude's text. Without that row the audit holds only the
   last statement. `audit.py` has no check constraint on status and the status
   page groups by it, so a new value needs only the docstring list.

The response of `POST /v1/objects` does not change shape. `CacheEntry.decl` and a
number or text response's `decl` hold the last statement.

**Why the log2 cap covers every statement.** The cap scans `hints{log2=...}` in the
request text. A prelude `agg Huge ... hints{log2=25; bs=1/4}` would otherwise be
filed unscanned and reach a build through `sev agg.Huge`, which would bypass
`AGGAPI_LOG2_CAP`. Today every declaration submitted to a session has passed the
scan, and this must remain true. An over-cap hint on any statement is refused,
referenced or not.

**Why statement by statement and not one whole-program preview.** The loop gives
the failing index for every kind of failure with no string matching, including
the plain `ValueError` messages that have no `ErrorReport`. A bare name in last
position also keeps working, as it does alone: `preview` tries the bare-name
lookup only when given that name as its whole input.

### [statement-count] The limit, and a route to count statements

- `config.py`: `max_statements: int = 12` (`AGGAPI_MAX_STATEMENTS`), beside
  `log2_cap`.
- `routes/decl.py`, `models.py`: `POST /v1/decl/statements`, body `{decl}`,
  response `{"statements": n}`. It calls `split_program` and parses nothing, so it
  costs string work only. A `ValueError` from unbalanced brackets returns 1, and
  the control the reader pressed then reports the problem in its usual way.
- `web/src/api.js`: `countStatements(decl)`.

**Why a route.** The statement rule belongs to the library, and the client must not
hold a copy: a blank line inside `[ ]`, a comment line, and a `;` inside a
multi-line `note{}` all defeat a client-side regex. The module docstring of
`routes/decl.py` already describes this family: routes that ask the grammar about
text and build nothing.

### [refuse-transforms] Controls that transform the box refuse, in the status bar

In `web/src/main.js`, one helper:

```js
/**
 * Refuse a transform of a box holding several statements, in the status bar.
 *
 * @param {string} label the control, for the message
 * @returns {Promise<boolean>} true when refused
 */
async function refusedForSeveral(label) {
    let statements = 1;
    try {
        ({ statements } = await api.countStatements(editor.getText()));
    } catch { return false; }   // the control's own request reports any failure
    if (statements <= 1) return false;
    anchorEditor();
    renderStripLine(`${label} works on one statement at a time; `
        + `this box holds ${statements}.`, 'warn');
    flashStrip();
    return true;
}
```

Called first in each of six handlers, before anything is built, busied or written:

| Control | Handler | Label |
|---|---|---|
| Sharpen | listener at `:888` | `Sharpen` |
| Hints | listener at `:896` | `Hints` |
| P&L, rate, xPnL, Explode | `applyPnl` (`:918`) | `P&L` |
| Views | `applyViews` (`:1008`), after the menu closes | `Views` |
| Cede, Tower | `cedeWith` (`:3603`) | `Cede` |
| Reformat | listener at `:961` | `Reformat` |

Design points, each a decision:

- **The count comes from the box's text at the moment of the press**, so the
  refusal holds in every state: built and unchanged, or typed over a built single
  statement and not yet built. No state is kept, and `can()`, `renderActionRow`
  and `pnlItemWhy` are untouched.
- **The buttons stay live.** Greying a button removes the press that would produce
  the feedback, and a tooltip on a disabled button does not exist on a phone.
  Reformat is already never greyed, for a similar reason.
- **The first row of the strip, not the note slot.** The note slot sits behind a
  chevron whenever the strip shows an object, so `noteDerivation` would hide the
  refusal. `renderStripLine` replaces the row, tints the strip with `warn` and
  clears the note.
- **Accepted cost.** The object's readings leave the strip until the next build.
  Its panes stay. Ctrl+Enter restores the readings, from the cache.
- **`anchorEditor()`** brings the strip into view for Cede, whose button sits far
  down the Reinsurance pane.
- **No note after a multi-statement build.** The build shows the last statement's
  result, as a notebook cell does.
- **The refusal is in the client.** The derivation routes take an object id, and
  the cache is process-wide and keyed by meaning, so one id is reachable from a
  one-statement program and from a prelude. Only the box records which it was.

### [reformat-refuse] Reformat refuses more than one statement

Today's Reformat is unsafe on a multi-statement program, because it inlines the
references the prelude exists to provide:

| Input | Output today |
|---|---|
| `sev S lognorm 10 cv 1`, `agg A 5 claims sev.S poisson` | `sev S` kept, `agg A` with `sev lognorm 10 cv 1` inlined |
| `agg A ...`, `agg B ...`, `port P agg.A agg.B` | both `agg` statements kept, `port P` with both inlined |
| `stable x1 ...`, `stable x2 ...`, `stable.x1 + stable.x2` | echoed: the writer raises on kind `conversion` |

In the first two rows the prelude survives as dead text: editing `sev S` afterward
no longer changes `agg A`, with no warning. That is a silent change of meaning
from a button whose purpose is layout.

- The button refuses through `refusedForSeveral`, above.
- `_format_decl` also returns `decl` byte for byte when `split_program` finds more
  than one statement, inside its existing promise that a failure echoes the input,
  so a direct API caller gets the same safety.
- A single statement behaves as it does today, including inlining its references.

This supersedes the 1.15.0 acceptance "a second statement naming the first renders
both statements" (`dev/done/plan-reformat-explodes-session-references.md`).
`tests/test_decl.py:167` and `tests/test_objects.py:2364` change to assert the echo.

### [history] Keep multi-statement programs in the ring

In `web/src/`:

- `main.js:590`, `:591`: a number or text result is not recorded in history. When
  `api.countStatements(decl)` is above 1, record it, or a stable program of several
  lines cannot be recovered with Ctrl+Up.
- `history.js:269` `findDeclaring`: extend the anchored match so a declaration may
  also follow a blank line or a line-final `;`, using
  `(?:^|\n\s*\n|;\s*\n)\s*kind\s+name(\s|$)` with no multiline flag. An indented
  clause such as `  agg A` inside a `port` must not match, because the expiry pane
  would then offer a rebuild that restores nothing. Correct the comment there,
  whose "stored collapsed to one line" is out of date.

### [error-pane] Name the failing statement

`detail.line` is relative to the statement, so it is always 1 and misleads in a
program of several lines.

- `web/src/error-pane.js:138`: when `detail.statement_index` is present, show
  `Parse error in statement N, column C.`
- `failureLine` (`main.js:1404`): same wording for the strip.
- `source` and `caret` need no change: `format_error` already reports the failing
  statement (confirmed).

### [docs]

- `collapse_program` docstring: rewrite. Remove "This is a single-object
  playground", and the passages on backslash continuation and on joining.
- `loss_table_files.py:24`: "replaces continuations and whitespace with spaces"
  becomes "collapses whitespace".
- `BuildRequest.decl` description, and the `audit.py` status list.
- `CLAUDE.md`, under Build pipeline guards: one sentence for the statement cap and
  the rule that the route parses what `build_many` parses.
- `CHANGELOG.md`, listing the refused forms from [strict-parse] as a behavior
  change. `dev/TODO.md` under Landed, and the owed items under Not in scope.
  `__init__.py` version.

## Reformat: the alternative of splitting and recombining

The question: would it be hard to split a program into units, reformat each
separately, and recombine?

**Splitting is not the obstacle, because `_format_decl` already does exactly
that.** It previews each statement, renders each with `format_program` and joins
them with a blank line. The table under [reformat-refuse] is that method's output.
The obstacle is the render: the writer works from a parsed spec, and by then
parsing has replaced `sev.S` with a copy of `S`, so the reference no longer exists
to be written. The text route of `format_program` parses too, and gives the same
result, or echoes when a name is unknown. Three ways forward:

**[a] Refuse. This plan.** About ten lines.

**[b] Render a statement only when it has no references, and keep the others as
typed.** About fifteen lines and no library change: `preview.resolved` shows whether
a statement has references, and `UnderwritingLexer.raw_statements` returns the typed
text. A prototype ran on 2026-10-30, and every result reparsed to the same
statements. It is safe but gives little:

```
stable x1              (typed: stable x1 1.3 0)
  1.3 0

stable x2              (typed: stable x2 1.3 1)
  1.3 1

stable.x1 + stable.x2  (kept as typed)
```

```
sev Rf1 lognorm 10 cv 1            (rendered)

agg Rf2 5 claims sev.Rf1 poisson   (kept as typed)
```

- The statement most in need of layout is usually the last, and the last usually
  has references, so it is the one this cannot touch.
- A stable statement comes back longer than it was typed.
- `raw_statements` removes comments, so a kept statement loses its comments.
- A `;` separator becomes a blank line.

**[c] Teach the library to keep references.** The parser records each reference it
inlines and the writer gets a mode that outputs the reference. This is the real
solution and a library plan of its own: six parser sites inline a reference
(`parser.py:816`, `:1248`, `:1326`, `:1561`, `:2628`, `:2701`), and a new spec key
would enter the API's cache key, which hashes the spec, unless excluded. It would
also let a single statement keep its references, which is a new Reformat mode to
decide on.

**Rejected outright:** substituting a sentinel for each reference and replacing it
in the rendered text. Fragile, and exactly the clever workaround the house rules
warn against.

**Decision: [a]** (author, 2026-10-30). Several statements are the exception, and
refusal loses nothing the reader typed. If Reformat on such a program proves to be
missed in use, the next step is [c], skipping [b].

## Files

- `src/aggregate_api/routes/objects.py`, `routes/decl.py`, `config.py`, `models.py`,
  `audit.py`, `loss_table_files.py`, `__init__.py`
- `web/src/main.js`, `web/src/api.js`, `web/src/history.js`, `web/src/error-pane.js`
- `tests/test_multi_statement.py` (new), `tests/test_decl.py`,
  `tests/test_objects.py`, `web/test/history-walk.test.js`
- `CHANGELOG.md`, `CLAUDE.md`, `dev/TODO.md`

## Acceptance

Automated, with `uv run --no-sync pytest` and `npm test` in `web/`. Test programs
use names absent from the library: `sev.Capstone.Sev` is a library entry, so a
test built on it passes with the prelude ignored. Tests that use named stable laws
take the existing `requires_named_laws` and `requires_stable_arithmetic` marks from
`tests/test_objects.py`, so `release-check.ps1` is not newly broken against an
older released library.

[route-split]

- `sev` then `agg sev.X`: 200, kind `agg`, and the same id as the two statements
  posted separately.
- An unrelated prelude edit gives the same id with `cached` true. An edit to a used
  prelude statement gives a new id. With `sev agg.X` and a pinned grid, a change to
  `X` gives a new id.
- `agg` with `cv -2`, unreferenced, above a good last statement: 200.
- Stable law arithmetic as the last statement: `kind` text. `(2+2)` last: `kind`
  value.
- Bare name and `agg.NAME` as the last statement: 200.
- A later single statement can refer to a prelude name, and the `agg` form of
  `/v1/session/models.agg` lists it.
- Parse failure, missing reference and plain `ValueError` each in statement 2: 422
  with the right index, and **nothing filed** from statement 1.
- 12 statements: 200. 13: 422 with status `limit_exceeded`.
- Prelude `hints{log2=25; bs=1/4}` reached by `sev agg.NAME`: 422 `limit_exceeded`,
  nothing filed.
- A prelude statement that reaches a loss table file by reference, from a public
  request: 422 `FILE_REFUSAL`, nothing filed.
- One `declared` audit row holding the prelude's text.
- With `library_references_only`, two statements: 422 with the one-statement
  message, nothing filed.

[strict-parse]

- Each row of the table under Current behavior gives the same outcome as `build()`:
  422 for the blank line and stray backslash forms, with the right `statement_index`
  where there are several statements. `port P`, blank line, `agg A ...` gives
  `statement_index` 0; `agg A ...`, blank line, `note{x}` gives 1.
- A backslash in a `note{}` body survives into the object's note.
- An unbalanced `[`: 422, not 500.
- The same forms with `library_references_only`: the same refusals.
- A single statement with comments, multi-line layout, CRLF or a trailing `;` keeps
  its id.
- A blank line inside `[ ]` still builds.
- `_resolve_risk` with a fragment holding a stray backslash, or two statements: 422.

[statement-count] and [reformat-refuse]

- `/v1/decl/statements`: 0 for comments only, 1 for a multi-line statement, 1 for a
  blank line inside `[ ]`, 2 for a line-final `;`, 1 for unbalanced brackets. It
  files nothing and adds no cache entry and no audit row.
- `/v1/decl/format` on two statements: input echoed byte for byte. On one statement:
  as today.

[history]

- `findDeclaring`: finds `sev X` after a blank line and after a line-final `;`; does
  not match an indented `agg A` inside a `port`.

By the author in the browser after `.\scripts\build-web.ps1`:

- The two programs under Goal give the expected result.
- With several statements in the box, built or not: Sharpen, Hints, P&L, Views, Cede
  and Reformat each leave the box untouched and show the refusal in the first row of
  the strip, flashed and tinted. Cede's refusal comes into view.
- After a refusal, Overview and pricing still work, and Ctrl+Enter restores the
  strip's readings.
- With one statement, each control behaves as in 1.39.0.
- The stable program returns with Ctrl+Up.

## Not in scope

- `;` in the middle of a line. `a; b` stays a parse error pointing at the `;`,
  because `preprocess` fires only on a line-final `;`. Any change belongs upstream.
- **Sharpen, Hints and Cede on an edited single statement.** They act on the last
  built object and replace the box, while P&L builds the box first. This exists
  today and affects typed text of any length. The refusal does not depend on
  building first, so this is left for its own decision.
- `POST /v1/decl/parse` still parses each statement against the default base, so a
  later statement that refers to an earlier one fails there. The playground does not
  call this route.
- The `raw` form of `/v1/session/models.agg` lists each cached object's program,
  which is now the last statement alone. The `agg` form, the one the menu offers,
  includes the prelude.
- The per-statement whitespace normalization, which also collapses repeated spaces
  inside a `note{}` body and a quoted string, unlike `build()`. It changes no
  acceptance, and the cache key depends on it.
- Excel, Sheets and the phone edition accepting several statements. The phone
  edition has no text box for DecL.
- Showing several results, one per statement.

**Owed upstream, in the library:**

- `UnderwritingLexer.preprocess` raises a bare `AssertionError` on an unbalanced
  `[`, so `build()` does too. It should be a `ValueError` with an `ErrorReport`. Once
  it is, the catch in `split_program` can go.
- [c] under the Reformat alternatives, if wanted.

## Alternatives considered

- **`build_many`, building every statement (the literal Jupyter behavior).** One
  line of code. Rejected: cost is the sum over statements under one build slot and
  the 10 s timeout, every object but the last is discarded, and the whole text
  would enter the cache key, so an unrelated prelude edit would miss the cache.
- **Falling back to the old join when the split fails to parse.** Kept every existing
  blank-line layout building. Rejected by the author: such a program is a syntax
  error, and the tolerance was never wanted.
- **Keeping the fold for `library_references_only` requests.** Left Excel and Sheets
  byte-identical, but kept two parse rules and a branch for a form nobody uses.
- **Refusing derivations on the server.** Rejected: an object id does not determine
  whether the program had several statements.
- **A `statements` field on the build response, with the buttons greyed from it.**
  Rejected: it fails when the box was edited after the build, needs state in the
  client, and leaves nothing to press for feedback.
- **Counting statements in the client.** Rejected: a second copy of the library's
  rule.
- **Filing the prelude on the real fork as each statement passes.** Rejected: a
  failure in statement 5 would leave 1 to 4 filed.

## Evidence

Probes on 2026-10-30, using aggregate 1.43.0, on DOOB. The route design was run by
hand in a scratch script: previews and filing as above, then a real
`POST /v1/objects` of the last statement.

Constructions during the build of the last statement, counted by wrapping
`Aggregate.__init__` and `Portfolio.__init__`:

| Program | Constructed |
|---|---|
| unused `agg`, then another `agg` | 1 Aggregate, the last |
| `sev X`, then `agg sev.X` | 1 Aggregate |
| `agg A`, `agg B`, `port P agg.A agg.B` | 1 Portfolio, 2 unit Aggregates |
| `agg In` with pinned grid, then `agg Out sev agg.In` | 2 Aggregates, `In` then `Out` |
| `stable`, `stable`, `stable.x1 + stable.x2` | none |

Timings, median of 3 to 5 runs:

| Case | ms |
|---|---|
| whole-program preview, 1 statement | 5 |
| whole-program preview, 10 `sev` statements | 23 |
| whole-program preview, 50 `sev` statements | 140 |
| three `agg` and a `port`, building every statement | 573 |
| three `agg` and a `port`, last statement only | 410 |

So the prelude step costs about 30 ms at the 12 statement limit. The
statement-by-statement loop was not timed separately; record its measured cost in
the execution log.

Other results:

- Same id from one box and from two; unrelated prelude edit cached; used prelude
  edit and changed deferred referent each a new id.
- Refusals in statement 2 file nothing from statement 1.
- `format_error` gives `source` as the failing statement, with the caret correct.
- `format_program` over all 206 library entries, by spec and by text, produced no
  output that splits into more than one statement, and no `as_read` or `program`
  does. The writer's layout is therefore safe under the new split.
- The full suite (697 tests) sent no program through `collapse_program` that the
  library rule splits; a control program confirmed the detector works. No existing
  test depends on the old join. Backslash programs were checked by searching the
  test files, which found none; the execution run confirms this.
- `stable.x1 + stable.x2` with betas 0 and 1 gives `stable 1.3 0.5 1.70436`, as the
  stable sum rule requires: scale (1 + 1)^(1/1.3) = 1.70436 and beta 1/2.

## Execution notes

- `dev/TODO.md` holds uncommitted work by the author. Stage only this plan's hunk,
  with `git apply --cached`, and do not `git add` the file.
- Move this file to `dev/done/` in the commit that lands the work.
- One commit with a one-line subject, for example
  `[x.y.z] build the last of several statements and match the library's parse rule`.
- Run `.\scripts\build-web.ps1` after the commit. Never stage the bundle.
- Use `uv run --no-sync`: a sync would undo the co-development installs.

## Execution log, 1.40.0

Executed 2026-10-30 in one bump, against aggregate 1.43.1 (the worktree, one patch past the 1.43.0 the plan was written on). The plan's parse table was reprobed before any edit and held.

**Measured.** The statement-by-statement loop, a fork and twelve previews with each statement filed in the fork, takes 18 ms (five runs, 17.7 to 19.5). Twelve is the limit, so that is the most this step costs. The earlier estimate of about 30 ms came from a whole-program preview.

**Divergences.**

- **`_resolve_risk` keeps `collapse_program`.** The plan passes the fragment to `uw(...)` unchanged. A probe showed that `uw` given two statements builds both and files both before raising `build() expects a single output`, so a 422 would leave two declarations behind and run two builds. Keeping the call refuses two statements before any build, and a stray backslash still reaches `uw` and fails there. Both acceptance cases are 422 as the plan asks, and a test also asserts nothing is filed.
- **"The same forms with `library_references_only`: the same refusals" means the same status.** Each is a 422, but `_declare_prelude` step 2 runs first by the plan's own order, so a form that splits gets the one-at-a-time message rather than a parse error with `statement_index`. A form that does not split, the stray backslash, gets the parse error.
- **Numbers shown to a reader count from one.** `statement_index` is zero-based on the wire as the plan says. The `statement N: ` prefix on a string detail, `Parse error in statement N`, and the strip's `statement N, column C` all count from one, which the plan left open.
- **The plan's table says a backslash in a `note{}` is deleted.** It became a space. The CHANGELOG states the actual behavior.
- **`V:/worktrees/dev-files.md` does not exist**, so there is no control list row to update.
- **`uv.lock` is unchanged.** `aggregate-api` has no version line there, since the version is dynamic.
- **The usage doc** is at `hacks/using/using-multi-statement-programs.qmd`, in this repository's gitignored `hacks/`, because `D:/Projects/Hacks` has no `aggregate-api` folder.

**Browser acceptance, run ahead of the author's own pass**, on a private `127.0.0.1` server with a scratch audit file:

- Both programs under Goal give the expected result: `My.Agg` with mean 25000, and `stable 1.3 0.5 1.70436`.
- Built and unchanged: Sharpen, Hints, P&L, Views (main button and menu item), Cede, Tower and Reformat each left the box untouched and showed the refusal in the first row of the strip, tinted and flashed. Typed over a built statement and not yet built: Sharpen refuses the same way.
- After a refusal the Overview pane stays, and Build restores the readings from the cache.
- With one statement, Hints, Reformat and P&L change the box as before.
- The stable program returns with Ctrl+Up.
- A parse failure shows `Parse error in statement 2, column 14.` in the pane and `statement 2, column 14:` in the strip. No console errors.

Not exercised there, and left to the author: Sharpen, Views and Cede with one statement in the browser (their routes are covered by the suite and only a guard line changed in each handler); a pricing press after a refusal; Cede's refusal scrolling into view from far down the Reinsurance pane, since the press there was scripted and started near the top of the page.
