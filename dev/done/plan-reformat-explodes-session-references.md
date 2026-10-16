# Plan: Reformat inlines your own references, not only the library's

Minor bump. Independent of `plan-cache-key-from-parsed-program.md` and may land
before or after it; together they make Reformat show the self-contained program
the cache key describes.

## Goal

Pressing Reformat on a program renders it with every dotted reference inlined:
library entries, as today, and the caller's own declarations, which today come
back untouched.

## Current behavior

`POST /v1/decl/format` (`routes/decl.py`, `_format_decl`) calls
`aggregate.decl_writer.format_program(decl, fmt="text", trailer=True)` behind
the gate `_every_statement_parses`. Both parse against the shipped
`aggregate.build` singleton, and the route takes no session. Probe, 2026-10-16,
after a session declared `sev Cat` and `agg A`:

| Input | Output |
|---|---|
| `port P2 agg.Capstone.Gross agg.Capstone.Gross` | Capstone.Gross inlined in full |
| `port P agg.A agg.Capstone.Gross` | unchanged (the gate fails on `agg.A`, so the input is echoed) |
| `agg R 2 claims sev sev.Cat poisson` | unchanged |
| `agg Q 2 claims sev agg.A poisson` | unchanged |

The gate's docstring also names a third failure: a second statement that refers
to a name the first statement defines collapses, because each statement is
parsed against `aggregate.build` alone.

## Change

**[session-parse] Parse in the caller's fork.** The route takes the session the
same way the build route does (`X-Aggregate-Session`, `_get_session_uw`;
`web/src/api.js` already sends the header on every request, so the SPA needs no
change). It previews the program in that fork (`uw.preview(text)`: a private
parser over a fork of the base, so nothing is registered) and renders each
statement's parsed spec with `format_program(spec, fmt="text", trailer=True)`.
`format_program` accepts a spec as well as text (its docstring names the
parser's output and a recipe's `.spec`); confirm the exact argument form when
implementing. A multi-statement program whose later statements refer to earlier
ones now renders whole, because preview resolves a program's own declarations.

**[sev-reference] `sev agg.X` stays a reference.** It is resolved at build time
from the referent's computed output and cannot be written inline. Reformat
leaves it as written, which is correct.

**[promise] Keep the promise.** Any failure (preview error, render error)
echoes the input byte for byte, exactly as today. Keep `trailer=True`; confirm
that note, tags and hints survive the spec route the way they survive the text
route.

## Files

- `src/aggregate_api/routes/decl.py`: `decl_format`, `_format_decl`,
  `_every_statement_parses` (the preview replaces the gate's parse, or the gate
  runs in the fork).
- `tests/test_decl.py`.

## Acceptance

- After an own `agg A`: Reformat on `port P agg.A agg.Capstone.Gross` inlines
  both.
- After an own `sev Cat`: Reformat on `agg R 2 claims sev sev.Cat poisson`
  inlines Cat.
- `agg Q 2 claims sev agg.A poisson` comes back with the reference intact.
- A malformed program is echoed exactly.
- Hints written by Sharpen survive a Reformat.
- `sev MySev lognorm 10 cv 1` followed by `agg A 2 claims sev sev.MySev poisson`
  in one program renders both statements, without collapsing either.
- A library-only program renders exactly as it does today.
- No `web/` change, so no SPA rebuild.

## Not in scope

- The writer's round-trip gaps (`ph 2/3` becomes a float, `dsev [1:6]` becomes
  six values), tracked upstream as `[Unparser-Reference-Gaps]`.

## Execution log

Executed 2026-10-16 as **1.15.0**, after `plan-cache-key-from-parsed-program.md` (1.14.0). `format_program((kind, name, spec), fmt="text", trailer=True)` is the argument form; statements are joined with a blank line, as the writer's own text route joins them. Probed before editing: of the 198 `library.agg` entries, 196 render byte for byte as the text route did; the other two are below.

Divergences, each recorded as it was made:

1. **The gate is gone, not moved into the fork.** `_every_statement_parses` existed because the writer's text route answers an unreadable statement with its collapsed preprocessed copy. The spec route never reaches that fallback, so the preview is the only parse and any exception echoes. Its a137 history moved into `_format_decl`'s Notes.
2. **Two library entries now echo where they used to collapse.** `MinimumDistortion` and `MixtureDistortion` (the combinator distortions) raise `NotImplementedError` when rendered from a spec. Today's route returned `MinimumDistortion` unchanged and `MixtureDistortion` as the writer's collapsed copy (doubled spaces around `wts`), which is the a137 failure the promise forbids. Both now echo the input byte for byte. So "a library-only program renders exactly as it does today" holds for 196 entries and moves toward the promise for the other two; `test_reformat_renders_library_programs_as_the_text_route_did` pins exactly that.
3. **A bare name echoes.** On the preview's `'name'` route (`Capstone.Gross` alone) the route returns the input, as it did through 1.14, rather than expanding the entry. It is a lookup, not a program to lay out.
4. **Two existing tests changed meaning.** `test_decl_format_declines_a_program_that_names_its_own_first_statement` became `..._renders_...`, asserting both statements render with the severity inlined. `test_reformat_still_echoes_a_malformed_program_unchanged` used that same shape as its malformed vehicle; it now carries a real typo (`poison`) so it still pins the a137 promise.
5. **`dev/TODO.md`.** No entry existed for this plan; one is added under Landed. The upstream ask "`format_program` cannot read a program whose second statement names something the first defines" is ticked as resolved app side, and the a137 fallback ask notes that the API no longer depends on it.
6. **The format route now advertises `?session=`** in OpenAPI, because it takes `_get_session_uw`, whose query fallback exists for navigation routes. Harmless; the SPA sends the header.
7. **The control list** `T:/worktrees/dev-files.md` does not exist; no row updated.

No `web/` change, so no SPA rebuild.
