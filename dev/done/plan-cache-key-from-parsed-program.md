# Plan: key the object cache on the parsed program, not its text

Minor bump: a correctness fix that also changes which builds share an id.
First of four related plans; the others are
`plan-reformat-explodes-session-references.md`, `plan-excel-core.md` and
`plan-excel-hosting.md`. This one lands first, and `plan-excel-core.md` depends
on it.

## Goal

An object id names what a program **means**. Redefine `agg A`, rebuild
`port P agg.A agg.B`, and you get a fresh P built on the new A. The SPA keeps
resolving exactly the names it resolves today, your own declarations included;
only the key changes. A client can also ask for library-only resolution, which
the Excel add-in will use.

## Current behavior

`_cache_key` in `routes/objects.py` picks one of two keys after a preview:

- a program that resolves nothing, or only entries read from the library file,
  gets `object_id(canonical_text, log2, bs)` (key scope `shared`);
- a program that touches anything the caller's session declared gets
  `qualified_object_id(session_id, canonical_text, log2, bs)` (scope
  `session`), as does any program `_preview` cannot read
  (`preview_unavailable`).

**The bug** (reproduced 2026-10-16 with `TestClient`, one session):

```
agg A 2 claims sev lognorm 10 cv 1 poisson      A mean 20
agg B 3 claims sev gamma 5 cv 0.5 poisson
port P agg.A agg.B                              4f40714271198d8f  mean 35
agg A 2 claims sev lognorm 20 cv 1 poisson      A mean 40
port P agg.A agg.B                              4f40714271198d8f  cached=True  mean 35
```

The second P should have mean 55. The session key hashes the text and the
session, not what `agg.A` resolved to, so a rebound name serves a stale object.
The SPA has this bug today.

**Why hashing referenced recipes' text would not fix it.** The library
(`aggregate` 1.5.2) binds references at two different times:

- **Dotted references are copied in when a statement is parsed.** `sev.Cat`
  inside an agg and `agg.A` inside a port are inlined into the spec, and a
  stored recipe keeps the copy it took when it was registered. Probe on a fork,
  2026-10-16: after `sev Cat` was redefined, A's stored spec still held the old
  Cat while A's program text was unchanged; rebuilding A from identical text
  re-copied the new Cat. So a recipe's text does not determine its spec.
- **`sev agg.X` and `sev port.X` are resolved at each build.** The parsed spec
  keeps a symbolic `sev_ref`; `Underwriter._resolve_sev_ref` rebuilds the
  referent from the current base on the referent's own grid, which the
  library's hygiene rule forces to be pinned by `hints{log2; bs}`. There is no
  cache of built objects behind it.

So the complete description of a build is the parsed spec of the program (which
holds every dotted reference already copied in) plus the stored spec of every
entry a `sev agg.X` chain reaches. `Underwriter.preview` already supplies both:
`preview.statements` carries each statement's spec, and `preview.resolved`
lists every entry the program leans on, following `sev agg.X` chains to the end.

**Two smaller defects the same change removes.**

- On a cache hit, `_register` files the previewed spec. After a redefinition
  that spec can differ from the cached object being served, so the session base
  and the served object disagree.
- `_preview` returns `None` for any failure other than `RecipeNotFound`, and
  such a program gets a session key it cannot honestly have.

**Missing names.** `agg ASV.NoLayer 10 claims sev agg.ASV.Inner poisson` (from
`decl-testers.agg`) fails in a fresh session with `recipe_not_found`: "no recipe
named 'ASV.Inner' of kind 'agg'". `ASV.Inner` exists, in `decl-testers.agg`,
which builds never read. The message does not say so.

## Change

**[key] Hash the parsed program.** Replace `object_id` and
`qualified_object_id` with one function: the first 16 hex characters of
SHA-256 over a canonical JSON document holding

1. each previewed statement's `(kind, name, spec)`, in order;
2. the stored spec of every entry in `preview.resolved`, read from the caller's
   fork (this covers `sev agg.X` chains; library entries in the list are
   harmless redundancy);
3. the requested `log2` and `bs`, as today (0 means "library picks");
4. the `aggregate` version and each plugin's version, as `/v1/meta` reports
   them;
5. a SHA-256 of the library file the process read (`library.agg` or the
   `--library` file), computed once at startup in `library.py`.

Canonical JSON is `serializers.spec_to_payload` per spec, then
`json.dumps(sort_keys=True, separators=(",", ":"))`. The session id leaves the
key: identical meaning shares one object across sessions, which is correct, and
the preview already ran against the caller's fork, so the caller's own
declarations are in the hash. Items 4 and 5 exist so an id saved outside the
process (an Excel workbook) cannot silently change meaning across an upgrade or
a library edit.

Why a hash and not the JSON itself: the document can run to kilobytes (a
`dsev` with many atoms, a Capstone program), and the id travels in URLs, cache
dict keys, audit rows and spreadsheet cells. Sixty-four bits keeps collisions
out of reach at this scale.

**[library-only] Optional library-only resolution.** `BuildRequest` gains
`library_references_only: bool = False`. When true, any `preview.resolved`
entry whose source is not a library file (`_is_library_entry` false) refuses the
build with a 422 before any build work:

```
{"error": "session_reference", "kind": "agg", "name": "A",
 "message": "agg.A is one of your own declarations, and this client resolves
             only library entries. Write it inline, for example
             'port P agg A 2 claims ... agg B ...', or add it to a library."}
```

**[unpreviewable] A program the preview cannot read is refused.** Its
references cannot be checked and it cannot be keyed. `preview` raises the same
structured error `build` does (`ValueError` carrying `err.report`), so return
`422` with `report.to_dict()` when present, else `422` with the message. No
build is attempted. The status page has counted `preview_unavailable` since
a110; the author ruled this acceptable on 2026-10-16.

**[missing-name] Say where a missing name lives.** When a `RecipeNotFound` names
a `(kind, name)` that exists in another shipped file
(`library.shipped_databases()`, `get_database_underwriter`), the 422 `message`
names the file: "agg.ASV.Inner is defined in decl-testers, which builds do not
read. Builds resolve library.agg and your own declarations." Otherwise keep the
library's sentence.

**[key-scope] Relabel the scope.** The audit column and status counters keep
their names but take new values: `library` (the program touched no declaration
of the caller's) and `own` (it did). The `preview_unavailable` reason goes.
Update `status.py`, `routes/status.py`, the status page and its tests.

**Accepted gap, documented in the code.** The key comes from the preview and
the build re-parses the text. A redefinition in the same session landing
between the two would file an object under a key describing the other spec.
The SPA sends one build at a time and Excel resolves library entries only, so
this is documented rather than locked.

## Files

- `src/aggregate_api/routes/objects.py`: `_cache_key`, `post_object`,
  `_preview`, `_missing_entry_detail`, `_register` (docstring only).
- `src/aggregate_api/cache.py`: the key function; remove `qualified_object_id`;
  module docstring.
- `src/aggregate_api/models.py`: `BuildRequest.library_references_only`.
- `src/aggregate_api/library.py`: library file hash at startup.
- `src/aggregate_api/status.py`, `routes/status.py`, `status_page.html`,
  `audit.py` (docstrings): key scope values.
- `tests/test_objects.py`, `tests/test_sessions.py`, `tests/test_status.py`,
  `tests/test_library.py`.

## Acceptance

- The A/P repro above: the second P build has a new id, `cached` false, mean 55.
- Severity chain: `agg In ... hints{log2=8; bs=1}`, then
  `agg Out 2 claims sev agg.In poisson`; redefine In; rebuilding Out gives a
  new id.
- Copy at registration: `sev Cat` v1, `agg A ... sev sev.Cat`, `port P agg.A`
  gives id1. Redefine Cat; rebuilding P gives id1 again (A still holds the old
  Cat, which is what a fresh build reads). Rebuild A, then P: new id.
- A library-only program gives the same id in two sessions. Identical own
  declarations in two sessions now also share an id.
- Every spec in `library.agg` and `decl-testers.agg` serializes to identical
  bytes twice, and a program's id is identical across two separate processes.
- `library_references_only: true` with `port P agg.A` after an own `agg A`:
  422 `session_reference` with the message. A library-only program: 200.
- `ASV.NoLayer` built in a fresh session: 422 whose message names
  `decl-testers`.
- A program the preview rejects: 422 with the report, and no build in the
  audit.
- Full suite green. SPA behavior is unchanged apart from fresh objects where it
  used to serve stale ones.
- Probes and tests point `AGGAPI_AUDIT_DB` at a scratch file, never the live
  `~/.aggregate/api/audit.db`.

## Not in scope

- Refusing `sev agg.X` / `sev port.X`. The author considered a blanket ban and
  ruled against it (2026-10-16): the key above handles both library and own
  referents.
- Reading `decl-testers.agg` or `reproductions.agg` into the build base, and any
  `library.name` namespace syntax. Ruled out 2026-10-16: no DecL change; a user
  who wants cross references across their own building blocks starts the server
  with `--library`, which replaces `library.agg`.
- Locking preview and build together (see the accepted gap).

## Execution log

Executed 2026-10-16 as **1.14.0**, against `aggregate` 1.5.2 (worktree, editable). The repro reproduced exactly before the change (second P `25c83cbc41d0e960`, `cached=True`, mean 35).

Divergences, each recorded as it was made:

1. **[key] The statement text is hashed beside its spec.** Review found that `spec_to_payload` writes a few library objects by their `str`, and those strings round: a Clayton copula prints `clayton(tau=0.312346)` for both `0.3123456` and `0.3123459`, and a distortion inside a mixture prints `PH(0.667)`. Probed: two bivariate programs differing in the copula's seventh digit had byte-identical spec JSON, so a spec-only key would serve one the other's object. Each statement and each resolved entry now contributes `(kind, name, program, spec)`, where `program` is the preprocessed statement text (the stored text for a resolved entry). The text cannot round, so this only ever splits ids the spec would merge. Every acceptance item still holds; `test_a_rounded_spec_value_does_not_merge_two_programs` pins the case. Remaining gap, documented in `cache.object_id`: a referenced entry whose text is unchanged and whose stored spec changed only in such a rounded value (three levels deep). Upstream ask worth raising: a lossless `str` for `Distortion` and `Copula`, or a canonical spec form, which would let the text leave the key.
2. **[key] An `expr` statement's spec is a bare float**, not a dict, so the key coerces non-dict specs with the serializer's own `_spec_value` (a within-package private name).
3. **[unpreviewable] Audit rows.** "No build in the audit" is read as: the row is written, with status `parse_error` (or `build_error` for a non-parse refusal such as an unknown distortion kind), no object id, and no build attempted. That keeps the audit's one-row-per-attempt rule.
4. **[unpreviewable] The refused-then-built panel is removed, not just its reason.** `status.record_unpreviewable_build`, its fifty-program ring buffer, `PROGRAM_BUFFER`, the `unpreviewable_builds` and `recent_unpreviewable` fields and the page's table can never move again, since nothing refused is built. `PROGRAM_CHARS` stays: the cache table uses it.
5. **[key-scope] Payload shape.** The panel is now `{library, own, own_rate, preview_*}`. `reasons` went with `preview_unavailable`, since `own` has a single reason left. The audit column keeps its name; old rows keep `shared` and `session`, documented in `audit.py`.
6. **[library-only] Not counted as a keying.** A refused program writes an audit row with `key_scope='own'` and does not touch the key-scope counters.
7. **Sharpen.** `post_sharpen` keyed its derived program through `_cache_key` and used to get a session key when the preview failed. It now answers 422 "the probe ran but its program cannot be keyed" in that case, which only a library defect or an expired session can reach.
8. **`canonicalize_decl` removed** from `cache.py`. Its only callers were the two old key sites; comment stripping already happens in `collapse_program` before anything is keyed.
9. **[missing-name]** lives in `library.defining_database` and `library.default_database_name`, so the message names the actual default file (a custom `--library` stem, or `library`).
10. **No `dev/TODO.md` entry existed** for this plan; one is added under Landed.
11. **The control list** `T:/worktrees/dev-files.md` named by the project's execute-plan skill does not exist (a pre-migration path), so no row was updated.

Tests: `tests/test_sessions.py` gains the repro, the severity chain, copy at registration, identical own declarations sharing, `library_references_only` both ways, the preview refusal and its audit row, and the copula case; its scope assertions move to `library` / `own`. `tests/test_objects.py` gains spec determinism over `library.agg` and `decl-testers.agg`, a cross-process id check (subprocess), and both missing-name messages. `tests/test_library.py` gains "editing the library file moves every id". `tests/test_status.py` follows the panel.
