# Plan a192 — `POST /v1/decl/parse`, the parser's answer as data

Status: proposed 2026-10-04. One route, one version bump. Requested by
`aggregate-asp` (aSP), whose own plan
(`V:\dev\aggregate-asp\dev\plan-1.32.0-decl-import-and-narrow-walk.md`,
step `[Program-Import]`) names this as a prerequisite and carries the
written case for it. This plan stands alone; nothing here needs aSP to be
read first.

## Goal

Return what the DecL parser understood about a program as **structured
data** — the `(kind, name, spec)` triple — rather than as text. Cheap, no
object built, no cache entry, no FFT.

## Current behavior

`src/aggregate_api/routes/decl.py` is the family of routes that ask the
grammar about text, none of which builds anything:

- `POST /v1/decl/complete` — terminal-level completion candidates
- `POST /v1/decl/lex` — the token stream, for client-side highlighting
- `POST /v1/decl/format` — the program re-rendered canonically
- `GET  /v1/decl/grammar` — `decl.lark` verbatim

Nothing in the api returns a spec. The nearest things are
`GET /v1/objects/{oid}/meta`, which returns `program` and `pprogram` as
**text**, and `POST /v1/objects`, which returns a slim `BuildResponse`
after paying for the full convolution.

The module already calls the exact pair of library functions this route
needs, in `_every_statement_parses` (`routes/decl.py:30`):

```python
from aggregate import build
from aggregate.parser import UnderwritingLexer
statements = UnderwritingLexer.preprocess(decl)
...
build.parser.parse(statement)
```

It calls them for their truth value and discards the result. This route
returns it.

## Why a client cannot get this from `/v1` as it stands

Recorded because the requesting app's standing rule demands the argument,
and because it is the reason to add a route rather than point a caller at
an existing one.

The make-do route is `POST /v1/objects` followed by
`GET /v1/objects/{oid}/meta`, reading structure out of `pprogram`. It
fails twice. It pays an FFT solve to learn a shape — and while
`Underwriter.build` takes `update=False`
(`aggregate/underwriter.py:3046`), which removes that cost, it leaves an
oid with no route that returns the exposures, so the only structural thing
still readable is text. And reading that text means a second parser in the
client, against a canonical form that is not frozen: this module's own
docstrings record it moving at a118, a122, a126 and a137.

The library settled the same question for itself. `aggregate/_program.py`
parses a stored program back to its spec so `sharpen_program`,
`pnl_program` and `reins_program` can mutate it, and says why:
*"All three work the same way: parse the stored program back to its spec,
mutate the spec, render the mutation through the writer. Never string
surgery."* A client deriving structure from a program is in exactly that
position.

## The route

```
POST /v1/decl/parse
  {"decl": "<program text>"}
->
  {"statements": [{"kind": "xpnl", "name": "aSP.PnL", "spec": {...}}, ...]}
```

- Split with `UnderwritingLexer.preprocess`, then `build.parser.parse` each
  statement, in order. One statement in, one entry out; several in,
  several out, so a caller can hand over a whole program.
- A parse failure is the **existing** structured error path, not a 200 with
  an empty list: `aggregate.parser_errors` already gives line, column,
  source and caret, and `POST /v1/objects` already reports it as an
  `ErrorReport`. Reuse that machinery so a client has one error shape to
  handle. The failing statement's index travels with it.
- Statements resolve against the default underwriter, as
  `_every_statement_parses` and `decl_writer.format_program` both do, so
  `sev.X` / `agg.X` references into the recipe base resolve and a builtin
  reference resolves **inline**. Consequence worth documenting on the
  route: a program whose second statement refers to a name its *first*
  statement defines does **not** parse, because each statement is parsed
  against `aggregate.build` alone. This is the same limitation
  `_every_statement_parses` documents at length, and the same one that made
  Reformat collapse such a program before a137.
- No object is created, nothing is cached, nothing is audited as a build.

### Serialization — the part that will break if it is not handled

A raw transformer spec is **not** JSON-safe, and Starlette's `JSONResponse`
runs `json.dumps(..., allow_nan=False)`, so an unhandled value does not
produce bad JSON — it **raises**, and the route 500s. Two cases, both
confirmed 2026-10-04 by parsing an `xpnl` with an unlimited quota share:

- **`Infinity`.** An unlimited layer's limit is `inf`:
  `agg_reins: [[0.2, Infinity, 0.0], ...]`. Also `sev_ub`.
- **numpy arrays.** `exp_el` comes back as `array([11707500., 23415000.])`.

`serializers._safe` already coerces both — non-finite floats to `None`,
numpy arrays to nested lists. **Do not reuse it unmodified for `inf`.** In
a spec, position 1 of a reinsurance triple is a limit, and a limit is never
absent; `None` there would be indistinguishable from a missing value, and
it loses the sign. Serialize non-finite floats in a spec as the strings
`"inf"` / `"-inf"` / `"nan"` instead, and say so on the route. That is the
spelling the grammar itself accepts for an unlimited layer, so a caller
round-tripping a limit back into DecL writes what it read.

This means a spec-specific coercer rather than `_safe`. Put it next to
`_safe` in `serializers.py` (`spec_to_payload`), with a docstring saying
why it differs — the next reader will otherwise "fix" it to call `_safe`.

Everything else in a spec is JSON-native: floats, strings, `None`, and
nested lists of those. The expense clause arrives as
`[["G&A", [["premium", 0.26]]], ["Fixed", [["fixed", 1500000.0]]]]`; the
premium clauses as `[["rate", 1.0], None]` or `[["deposit", 450000.0]]`.
Tuples serialize as arrays, which is correct and worth stating on the
model: a caller reads a layer as a three-element array, not as an object.

### The model

`spec` is an open `dict[str, Any]` on the response model, not a typed
schema. Deliberate, and worth a line in the docstring: the spec's keys are
the **library's** vocabulary and they change when the grammar changes. A
mirrored Pydantic model here would be a second declaration of the
transformer's output, would drift, and would start rejecting specs the
library had legitimately grown. The route's promise is "what the parser
understood, coerced to JSON", and that is the whole contract.

## Files

- `src/aggregate_api/routes/decl.py` — the route, and the shared
  preprocess-and-parse helper that `_every_statement_parses` can then be
  expressed in terms of rather than duplicating.
- `src/aggregate_api/models.py` — `DeclParseRequest`, `ParsedStatement`,
  `DeclParseResponse`.
- `src/aggregate_api/serializers.py` — `spec_to_payload`.
- `tests/` — a test module beside the existing decl-route tests.
- `CHANGELOG.md` — the a192 section.
- `pyproject.toml` — version to `1.0.0a192`.

Nothing in `aggregate` changes. The two names used, `build.parser.parse`
and `UnderwritingLexer.preprocess`, are both public and both already
imported by this module.

## Acceptance

- `POST /v1/decl/parse` on a one-statement `agg` returns `kind: "agg"`,
  the name, and a spec whose `exp_premium`, `exp_limit`, `sev_mean`,
  `sev_cv`, `freq_name` and `occ_reins` match the program.
- An integrated `xpnl` (an inline `agg` engine) returns one statement whose
  spec carries the engine's fields **and** `consideration`,
  `expense_spec`, `peel` and `engine_name`. This is the shape the
  requesting client reads; a fixture is worth keeping.
- An unlimited aggregate layer serializes as `"inf"`, not `null`, and the
  response parses with a strict JSON reader. The direct regression: a
  program containing `20% po inf xs 0 rate 100% cede 28% as QS` must not
  500.
- `exp_el` serializes as an array of numbers.
- A two-statement program returns two entries, in source order.
- A malformed program returns the structured parse error with line, column
  and caret, and the index of the statement that failed — the same shape
  `POST /v1/objects` returns, verified against it.
- No cache entry is created: `GET /v1/objects` is unchanged across a parse
  call.
- The route is fast enough that its cost is not worth measuring — assert
  only that no object was built, not a wall-clock bound.

## Notes for the executor

- Express `_every_statement_parses` in terms of the new shared helper, so
  the preprocess-and-parse pair has one spelling in this module. Keep its
  behavior exactly: it is the gate in front of `POST /v1/decl/format` and
  the reason a malformed program reformats to itself rather than coming
  back collapsed onto one line. Its docstring explains what that cost the
  author at a137 and should survive the refactor.
- Resist adding `update=False` to `POST /v1/objects` in the same bump. It
  is a fair and independently useful addition — validate a program without
  paying for it — but it answers a different question and would mix two
  meanings of "build" into one release. If it is wanted, it is its own
  plan.
- The SPA in `web/` needs no change. This route exists for an external
  client; whether the playground ever uses it is a separate question.

## Execution notes, 2026-10-04, landed as 1.0.0a192

Executed in one bump, as planned. Both gates green before the commit:
`uv run pytest` 439 passed, `cd web; npm test` 235 pass and 0 fail.
`web/` did not move, so the SPA was not rebuilt.

Every plan claim about the spec was re-confirmed by direct experiment against
the installed library (`aggregate` `1.0.0a387`, in sync with
`V:\worktrees\aggregate_REFACTOR`) before a line was written: the
`(kind, name, spec)` triple, `sev_ub` as `inf` on the plainest one-line `agg`,
`agg_reins` as `[(0.2, inf, 0.0)]` under an unlimited quota share, `exp_el` as
a numpy array, and `consideration`, `expense_spec`, `peel` and `engine_name`
on an integrated `xpnl`.

### Divergences

**[Status-Ruled].** The plan's header read *proposed 2026-10-04*, not ruled.
Executed anyway, on two grounds: the plan records no open question, and the
aSP half states the ruling explicitly, *"(Author's ruling, 2026-10-04: plan
it, execute it in the aLL tree.)"*. Stopping to ask whether a plan with
nothing outstanding was approved would have been the wrong call.

**[Preprocess-Splits-On-Blank-Lines].** The plan says "several in, several
out", which holds, but understates the rule. `UnderwritingLexer.preprocess`
splits on **blank** lines, not on every newline: a bare newline plus
indentation is a continuation and folds into one space, which is exactly how a
program spread over five indented lines stays one statement. So two statements
need an empty line between them. Stated on `_parse_statements` and on the
route, and the two-statement test writes its program that way.

**[A-Port-Spec-Nests-Dicts].** The plan's "everything else in a spec is
JSON-native: floats, strings, `None`, and nested lists of those" is not true
of a `port`. Its spec carries the unit list on a nested `spec` key as
`[("agg", "A", {...}), ("agg", "B", {...})]`, so a dict appears three levels
down, each unit carrying its own `sev_ub` of `inf`. `_spec_value` therefore
recurses into dicts as well as lists, tuples and arrays, and a test covers the
`port` case. Without it the route would have 500'd on every `port` program.

**[Percent-Number-Normalized].** `exp_lr` arrives as
`aggregate.parser._PercentNumber`, a `float` subclass that remembers a trailing
`%`. The coercer hands back a plain `float`, so nothing downstream has to
serialize a type it does not know. The marker carries no information the spec
needs: the library's own docstring says the percent form is consumed where it
is read and the spec keeps the resolved fraction.

**[The-Index-Key-Is-statement_index].** The plan asked for the failing
statement's index to travel with the error without naming the key. Chosen
`statement_index`, checked against every `ErrorReport` field for a collision
(`line`, `column`, `source`, `source_line`, `caret`, `got`, `got_type`,
`expected`, `expected_terminals`, `suggestions`, `message`, `hint`) and against
`src/`. The error-shape test asserts it is the **only** key the parse 422 adds
to what `POST /v1/objects` returns, so the two shapes cannot quietly drift.

**[The-Report-Source-Is-The-Statement].** The acceptance criterion asks for
"the same shape `POST /v1/objects` returns, verified against it", and the test
verifies the key set. One value differs by design: `source` is the failing
preprocessed statement rather than the whole program, because `line`, `column`
and `caret` are measured against the text the parser was actually handed.
Pointing `source` at the whole program would put the caret in the wrong place.
Stated on the route.

### Smaller things, absorbed

- The plan cites `_every_statement_parses` at `routes/decl.py:30`; it was at
  line 32 before this change. No consequence.
- The module docstring's Routes list never named `POST /v1/decl/format`. Added
  beside the new `POST /v1/decl/parse` entry, since the list was being edited
  anyway.
- `T:/worktrees/dev-files.md`, the cross-repo control list the project's
  `execute-plan` skill names, does not exist any more, on `T:` or on
  `V:/worktrees`. No row was updated. Worth the author's attention: the skill
  still instructs a reader to update it.
- Neither `dev/TODO.md` nor `dev/api-punchlist.md` carried an entry for this
  work, so a `## Landed` entry was added rather than an existing one ticked.

### Left alone, deliberately

`POST /v1/objects` did not gain `update=False`, as the plan instructs. The SPA
in `web/` is untouched. Nothing in `aggregate` changed.
