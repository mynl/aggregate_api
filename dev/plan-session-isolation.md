# Plan [Session-Isolation]: one recipe base, many users

> **Status: IN EXECUTION, 2026-08-18. A0 landed at API `1.0.0a109`, A1 to A4
> at `1.0.0a110`.** Author approved execution 2026-08-18; the library executed
> L1 to L4 concurrently. A5 to A7 remain.
> Drafted as v2, 2026-08-18. v1, drafted earlier
> the same day, was built around content addressing. The author reviewed it the
> same afternoon and rescoped the work: LIB is the product, the API is demo
> ware, so ship the smallest fix that makes the demo correct and park the rest.
> v2 is that scope. The parked material keeps its rulings and its
> implementation caveats in section 9, so nothing is relearned if it is picked
> up later. Written from `aggregate_api/dev/note-session-isolation.md` (PARKED
> 2026-08-17, the evidence file: every number in it was measured, not reasoned
> about) plus the author's rulings recorded in section 3. Canonical copy lives
> in `aggregate_api/dev/`; `aggregate_REFACTOR/dev/plan-session-isolation.md`
> is a symlink to it, the `plan-3d-plot.md` arrangement. Line anchors are LIB
> `1.0.0a301` and API `1.0.0a108`, verified against both trees on 2026-08-18,
> and the API side of them moves as its phases land. The note moves to
> `dev/done/` when this plan lands.

## 1. The design in one paragraph

The library is parsed **once** per process into a reference underwriter, and
every session gets a **fork** of it: a copy whose recipe base is a fresh dict
over the same `Recipe` objects, costing about 6 microseconds against the 3,185
milliseconds a fresh load costs. A session's declarations land in its own fork
and are invisible to every other session. The shared object cache keeps its
text key, with one qualification: a program that touched a **session-sourced**
name in the caller's fork gets the session id added to its key. A program that
resolves nothing, or resolves only unchanged library entries, shares exactly as
today, which is the conference case of a hundred people on one hero example,
one build. A program referencing anything the user declared themselves,
including a library name they overwrote, builds privately. The fork decides
who resolves; the source decides who shares. Failing toward a redundant build
is cheap; failing toward a shared object is silently wrong, so every doubt
qualifies.

## 2. What v2 drops from v1, and why

v1 keyed the cache on the identity of the program's content: the canonical
re-rendering of the parsed spec with references resolved and the deferred
reference form substituted recursively. It is correct and it maximizes
sharing. It also requires a normalization contract pinned forever, a recursive
fold with its own cycle guard, a fallback path for everything the unparser
cannot round trip, a tightening of `format_program`'s silent verbatim fallback,
and two permanent public methods frozen onto stable `Underwriter` at 1.0. The
one case it wins over the source rule is two users whose **session** objects
are byte-identical: under v2 each pays their own build. Measured demo builds
run 0.1 to 0.5 seconds, so the worst realistic case (a dictated line typed by
a room over identical self-built inners) is seconds of queued compute, once,
and never a wrong answer. That trade is right for demo ware. The design is
parked in section 9, where it doubles as the cache-coherence story for any
future multi-process deployment.

## 3. Author rulings

**First set, 2026-08-18 morning (v1).** Rulings 1, 2, and 5 concerned the
identity function and are parked with it in section 9. Still in force:

- **Ruling 3. `log2` and `bs` stay in the cache key.** They arrive as request
  parameters, not program text.
- **Ruling 6. `sev.NAME` keeps inlining.** "It **is** different and is ok to
  keep it so. If a user wants the other treatment they wrap it in a `dfreq[1]`
  agg." Under v2 this is purely a language ruling: the cache no longer takes
  any dependency on it, because qualification is decided by what the parse
  resolved, not by how the writer renders. Recorded in LIB `dev/TODO.md` by
  phase L4.
- **Ruling 7. Session identity carries a timestamp, and there is no carry
  over.** "Same user in different sessions does not see their previous
  programs carried over. They start afresh." Persistence arrives later as
  upload of a saved program. Phase A1.

**Second set, 2026-08-18 afternoon (the v2 rescope).**

8. **Demo scope.** Not a production system. Fork and cache, solve one level of
   the problem, and accept the residue the pricing routes leave on shared
   objects. LIB is the product; anything landing there must stand on its own
   merits.
9. **A cache hit still registers.** The parsed program lands in the caller's
   fork on hit and miss alike, so a user's later references to their own
   builds resolve. Section 4.4.
10. **A modified library entry is a session entry.** Registration is
    last-write-wins by `(kind, name)` (`underwriter.py:1721-1723`), so building
    your own `agg B ...` over a library name marks B `source='session'` in
    your fork, and programs referencing it qualify. Confirmed explicitly.
11. **Pricing residue is accepted.** The pricing and bounds routes recompute
    from form parameters on every request and read none of the attributes a
    previous request stored. Section 6, phase A7.
12. **Sharpen must not disturb the shared entry.** It works on a deepcopy
    (measured 31 ms for a three-unit portfolio) and files its result as a new
    entry. Phase A6.

## 4. The cache rule

Normative. Everything else is plumbing.

### 4.1 What the parse gives us for free

Every reference form funnels through `_safe_lookup` at parse time. Dotted
names of every kind are resolved and inlined into the spec
(`underwriter.py:2052`, returning `deepcopy(parsed.spec)` at `:2077`), and the
one deferred form, `sev agg.NAME` / `sev port.NAME`, still calls
`_safe_lookup` as an existence check before recording its symbolic `sev_ref`
key (`parser.py:1695-1701`). So a report of the names a parse resolved is
complete by construction, for every reference form shipped or added later. No
text scanning, no spec walking.

The one program shape that never parses is the bare name: `Underwriter`'s
build path tries a recipe lookup first and only parses on failure
(`_build_work`, `underwriter.py:1969-1984`). A bare name **is** a reference
and must be checked against the same rule, which is the hole the note's
section 5.2 found in every lexical scan.

### 4.2 The rule

For a request `(text, log2, bs)` from session `s` with fork `f`:

- Preview the program against `f` (phase L2): bare-name lookup first, then
  parse, mirroring `_build_work`'s order so preview and build cannot disagree.
  The preview reports the parsed `(kind, name, spec)` and every reference it
  resolved as `(kind, name, source)` triples, sources as recorded in `f`.
- If **no resolved reference has `source == 'session'`**, the key is the
  shared `object_id(canonicalize_decl(text), log2, bs)` of today
  (`cache.py:80`). The program is self-contained or leans only on library
  entries, which are byte-identical in every fork, so the built object is
  identical too.
- Otherwise the key is qualified: `object_id` over
  `(session_id, canonicalize_decl(text), log2, bs)`.
- **Fail closed.** If the preview raises, or reports anything the rule does
  not recognize, qualify. A parse error still surfaces through the build path
  as today's 422 with the `ErrorReport`.

`canonicalize_decl` (comment stripping, `cache.py:55-58`) stays on both paths.

### 4.3 The route order

Preview, then key, then check the cache, then build. A cache hit now costs a
parse it did not cost before, tens of milliseconds against builds measured in
hundreds, and a miss parses twice (once in the preview, once in the build).
Both costs go in the CHANGELOG rather than being discovered.

### 4.4 Registration on both paths (ruling 9)

On a **miss** the build registers into the fork itself
(`_interpret_program` calls `add_recipe`, `underwriter.py:2046`). On a **hit**
the route registers explicitly: `add_recipe(kind, name, spec, text,
source='session')` on the caller's fork, using the preview's parse. Without
this, a user served a cached object cannot reference it (`agg.NAME` or
`sev agg.NAME` fails on a name their own build never wrote), and the `.agg`
download of their fork omits it. `expr` kind registers on neither path,
matching `underwriter.py:2036-2043`. This changes the note's section 4.2
walkthrough deliberately: b's fork now gains a session card on a hit. The
Examples menu is unaffected because it reads the parent (phase A5).

## 5. LIB phases

Small, one bump, and every item stands on product merit with no demo in
sight.

### L1. `Underwriter.fork()`

```python
def fork(self):
    """Return an isolated copy sharing this underwriter's parsed recipes."""
```

Copy the object, rebind `_recipes` to a shallow `dict()` copy, and reset the
per-instance mutable state:

- `_parser = None` and `_lexer = None`. This is the substance of the method.
  The parser property (`underwriter.py:543-547`) builds
  `UnderwritingParser(self._safe_lookup, self.debug)`, a wrapper holding a
  bound method pointing at whoever built it, so a plain shallow copy writes
  into its own base and reads out of the parent's. Split brain, silent, in
  exactly the direction this plan exists to fix; the note observed it on the
  first attempt. The reset is nearly free: the Lark grammar is a module
  singleton (`parser.py:2422-2432`) and `UnderwritingParser.__init__` is two
  attribute stores, with a fresh transformer built per parse call
  (`parser.py:2494-2495`).
- `_sev_ref_stack = []` (`underwriter.py:531`), the mutable cycle guard.
- `databases = list(self.databases)`, and note `_request` aliases a caller's
  list if one was passed.

Shallow `dict()` is right for `_recipes`: `add_recipe` always rebinds a key to
a brand-new `Recipe` (`underwriter.py:1744`) and `recipe()` hands out
`replace()` copies, so shared `Recipe` objects are never mutated in place.
`interpret_file` already hand-rolls exactly this scratch copy
(`underwriter.py:2657-2659`); refactor it onto `fork()`.

Two hardenings ride along. `_recipes_frame()` iterates the dict; make it
iterate `list(self._recipes.items())`, since a fork's registrations can now
race its own recipes read (the `.agg` download). And document that a fork is
taken after `load()`, that the module alias `build_many = build.build_many`
(`underwriter.py:3116`) stays bound to the singleton, and that
`_refresh_default_underwriter` mutates `build` in place, so forks predating a
refresh keep the old base.

Pin in tests: about 6 microseconds per fork over 100, isolation in both
directions, and containment of the library clobber bug as a side effect.

### L2. The preview

One public method returning what section 4.2 needs: the parsed
`(kind, name, spec)` and the resolved references with their sources, resolved
against `self`, registering nothing, holding no instance state (it runs
concurrently, outside the API's build slot). It mirrors `_build_work`'s
bare-name-then-parse order. Implementation will thread a per-call collector
through the `_safe_lookup` funnel; the seam is small because the transformer
is already per-call. **Vet the name against the existing surface before
landing** (the `plan-approximate.md` shadowing rule); `preview` is the working
suggestion, nothing is attached to it.

### L3. `RecipeNotFound`

A named exception for an unresolved name, subclassing `KeyError` so every
existing `except KeyError` / `except LookupError` site keeps its behavior
(`_build_work` at `underwriter.py:1972`, `_resolve_sev_ref` at `:1578`,
`interpret_file` at `:2693`). Raise it from `Underwriter.recipe()` at
`underwriter.py:1875` and `:1878`, the one place lookup is implemented (its
docstring says so), which covers `__getitem__`, `_safe_lookup`,
`_resolve_sev_ref` and `_build_work` in one edit. Carry `kind` and `name` as
attributes; keep both message texts, including `_resolve_sev_ref`'s "it
parsed, so it was there when the program was read" diagnosis at
`underwriter.py:1579-1582`, which becomes the same exception type.

The note listed this as optional. Under this plan it is not: the expiry path
(A5) cannot be implemented without it.

### L4. Two `dev/TODO.md` records

- **[Session-Build-Clobbers-The-Trailer]**: record that `Underwriter.fork()`
  gives a multi-user host the "namespace the session base" arm of the author's
  2026-08-17 ruling. The single-process overwrite, a Jupyter user clobbering a
  library entry's trailer, remains open on the ruling's other arms (warn, or
  merge the trailer).
- **[Unparser-Reference-Gaps]** item 1: record ruling 6, declined. `sev.NAME`
  stays inlined; reference semantics are spelled
  `agg Wrapper dfreq[1] sev sev.NAME` then `sev agg.Wrapper`. The 8 exempt
  entries stay exempt. Under v2 this is a language ruling only; the cache
  dependency v1 would have created does not exist.

## 6. API phases

### A0. One underwriter for the process (the prerequisite), landed a109

The note's section 6.1, unchanged in substance. Verified at API `1.0.0a108`
that there was no `src/aggregate_api/library.py` and no `get_underwriter`. This is a bug on its own terms, independent of
sessions, and it is the natural parent of every fork, so it goes first.

`--library` re-points the Examples menu only. `examples.py:96` builds a
private `Underwriter(databases=(path,))` for the menu while all three build
paths use the `aggregate.build` singleton: `routes/objects.py:369` (inside
`_run_build`), `:1220` (the `.agg` download's `recipes` read) and `:2689`
(`_resolve_risk`). So under a custom library an entry is browsable, any entry
referencing a sibling by name fails to build, and the download lists session
rows from a different base than the menu came from.

1. New `src/aggregate_api/library.py` with `get_underwriter()`,
   `lru_cache(maxsize=1)`, holding today's `examples.py::_underwriter()` body
   verbatim: `aggregate.build` when unset, a private `Underwriter` when set,
   warn and fall back on a missing path. Behavior unchanged. Note the
   asymmetry to preserve: the env var warns and falls back
   (`examples.py:118-126`) while `--library` itself exits on a missing path
   (`resolve_library`, `__main__.py:32-71`).
2. `examples.py` imports it and deletes its local copy.
3. The three call sites above take `get_underwriter()`. `Underwriter.__call__`
   delegates to `build` with the same signature (`underwriter.py:2518`), so
   this is substitution, not rewrite. Drop `build as _build_singleton` from
   `routes/objects.py:96`.
4. **Delete `Settings.knowledge_base`** (`config.py:69-72`). There is nothing
   to wire it to under that name: LIB retired the knowledge base at
   `1.0.0a164` when `recipes` replaced `knowledge`, the setting is read
   nowhere in `src`, `tests` or `web`, and its comment claims a default
   (`"test_suite"`) its value (`"default"`) contradicts. `--library` already
   carries this job under the right name.
5. `AGGAPI_EXAMPLES_FILE` stops being about examples once it feeds builds.
   Propose `AGGAPI_LIBRARY`, keeping the old name as a deprecated alias for
   one release.
6. `create_app` gains `get_underwriter.cache_clear()` beside its existing
   `get_settings.cache_clear()`; `objects_routes.reset_singletons()`
   (`routes/objects.py:196-207`) is the precedent.
7. Test: a fixture library with two entries, the second referencing the first,
   asserting the reference builds under `--library`. **It fails today.**

**Execution notes, a109.** All seven steps landed as written, with three
observations. Step 5's rename went the whole way rather than half: the field is
`Settings.library`, not `Settings.examples_file` under a new env name, so
`--library`, the setting and the module all read the same word. The deprecation
warning for the old env name lives in `get_settings` rather than on the field,
because a field validator sees only the value that won and cannot tell which of
the two names supplied it. And step 3's "three call sites" is four: `_run_build`
(`:369`), the `.agg` recipes read (`:1220`), `_resolve_risk` (`:2689`), and the
`from aggregate import build as _build_singleton` line itself, which goes. The
regression test is `tests/test_library.py`, and
`test_a_program_may_reference_a_library_entry` was confirmed to fail with the
old build path patched back in.

### A1. Session identity

Ruling 7. The id is `<utc timestamp>-<uuid4>`, minted client side with
`crypto.randomUUID()`, stored in `sessionStorage`, and sent on every request
as `X-Aggregate-Session`.

- **`sessionStorage`, not `localStorage`.** A new tab or browser session mints
  a new id; a reload keeps it. A session is one tab, which is the strictest
  reading of "starts afresh"; the author should confirm it consciously.
- **The timestamp is an audit and display key, nothing more.** Eviction
  belongs to the registry's server-side LRU and TTL (A2); client clocks are
  not trustworthy and are not needed.
- **A session id is a namespace, not a security boundary.** Anyone holding
  your id gets your objects. Say this in the docstring and in
  `human-hints.md`; it is the reason no login is needed.
- **CORS**: `cors.py:50-56` hard-codes `allow_headers=["Content-Type"]`, so
  `X-Aggregate-Session` must be added there. Same-origin deploys skip the
  middleware entirely, so the omission would break only split-origin, which is
  precisely the deploy that needs sessions most.
- **SPA plumbing**: the SPA has exactly one fetch chokepoint (`api.js:59-63`),
  but its headers object is conditional on `body`, so GETs currently send no
  headers at all; the session header moves outside that ternary. Two paths
  bypass `_json` and need the session in the **query string** instead: the
  `.agg` download URL opened via `window.open` (`api.js:271`, `main.js:3098`)
  and the CSV export links (`tables.js:100`).
- **Missing header**: fall back to one per-process anonymous session, so
  `curl` and the existing test suite keep working unchanged. Headerless
  clients therefore share a fork and keep today's collision behavior; that is
  a stated tradeoff, not a discovery.
- **No persistence, by ruling.** The save mechanism is program upload, later.
  The download half exists: `routes/objects.py:1220` serves recipes as
  `.agg`, and under this plan it serves the caller's fork, which is exactly
  the export side of that future feature.

### A2. The fork registry

`src/aggregate_api/sessions.py`: id to fork, bounded, LRU with a TTL, one
lock, modeled on `ObjectCache` and reached through a `_get_session_uw`
FastAPI `Depends`, matching the `_get_cache` / `_get_audit` pattern at
`routes/objects.py:178`. `reset_singletons()` clears it. Forks are 6
microseconds and a few hundred kilobytes; size the registry generously
(hundreds) and let the TTL do the work.

### A3. The key rule and the route order

Section 4 lands here. `cache.py` gains the qualified key builder;
`post_object` reorders to preview, key, look up, register on hit, build on
miss. Both `object_id` call sites move (`routes/objects.py:878-879`,
`:2461`). Count shared against qualified keys, and add the session id and the
key path to the audit row; a qualified rate near 100 percent in a demo would
mean the rule is misfiring.

### A4. Route the build paths through the fork

Every site from A0 step 3 takes `_get_session_uw()` instead of
`get_underwriter()`, plus the derivation routes that build new programs:
`post_hints` (`:2473`), `post_pnl` (`:2538`), `post_reins` (`:2588`), and
`_resolve_risk` (`:2655`, whose non-name branch at `:2689` currently
registers user fragments in the process-global base).

**Not affected**: `completion.py`, which touches only
`aggregate.parser._PARSER` for lexing (`completion.py:33`, `:204`) and never
reads a recipe base. If name completion is ever added, it must read the fork;
note it there now.

**Execution notes, a110 (A1 to A4).** Landed as one bump rather than the
suggested A1 plus A2 then A3 to A7, because A1 and A2 alone are plumbing no
route reads: the registry would have shipped unexercised and the first thing to
touch it would have been the phase that also changed the cache key. A1 to A4 is
the smallest batch that is a working fix, and it is the batch the tests can
speak to. Four notes on what the code says that the plan did not.

1. **The library's `preview` landed better than the plan specified.** It follows
   the deferred `sev agg.NAME` chain to exhaustion with a per-call cycle guard,
   so a program two steps from a redefined entry is reported honestly. The plan
   asked only for the references the parse met. The API takes the stronger
   contract for free.
2. **Provenance is tested for a file, not against the session sentinel.**
   `Recipe.source` is a `pathlib.Path` for a library entry and the string
   `'session'` otherwise, so the rule reads `isinstance(source, PurePath)` and
   everything else qualifies. Written that way round so an unfamiliar
   provenance fails toward a redundant build.
3. **The bare-name route registers nothing**, which the plan's section 4.4 did
   not have to say because the library had not yet drawn the distinction.
   Registering that statement would file a library entry as this session's, and
   every later program naming it would qualify for nothing. `ProgramPreview.route`
   carries the distinction, so the API reads it rather than inferring it.
4. **A5's expiry 422 already half exists.** `RecipeNotFound` subclasses
   `KeyError`, and `post_object` has caught `KeyError` as a 422 carrying the
   library's own sentence since well before this plan. So an evicted fork
   already produces a correct, named error; what A5 adds is the app-side pane
   and the offer to rebuild, not the status code.

The `tables.js` CSV-export path named in A1 no longer exists: per-frame export
became CsvGrid's own client-side control, and `api.js` records that the
`/frame/{which}.csv` endpoints survive for API callers only. So the `.agg`
download is the only path needing the id in the query string, and it is the only
one that got it.

### A5. The Examples menu reads the parent; the expiry path

`examples.py` keeps calling `get_underwriter()`: a menu built from a fork
would lose any library entry the user overwrote, because `_library_only`
filters `source == 'session'` rows (`examples.py:183-198`).

Expiry: a browser's session id outlives the server's fork across a restart or
eviction. Catch `RecipeNotFound` (L3) around **both** the preview and the
build, and return a 422 whose error pane names the missing `kind` and `name`
and says the fix is to rebuild it. The SPA holds program history, so the pane
can offer the rebuild directly.

### A6. Sharpen works on a copy (ruling 12)

Today `post_sharpen` re-updates the cached object in place across a grid line
search and re-files the entry under a new id, deleting the old one
(`routes/objects.py:2420-2464`). On a shared entry that breaks every other
viewer mid-session: their object changes grid underneath them and their oid
dies. Change: `copy.deepcopy(entry.obj)` first (measured 2026-08-18: 10.5 ms
for a log2 16 aggregate, 31.4 ms for a three-unit portfolio, against rebuilds
of 73.5 and 453 ms), probe the copy inside the existing executor and
semaphore, file the sharpened result as a **new** entry under the qualified
key of the sharpened program, and leave the original entry untouched. The
response returns the new oid, which the SPA already follows.

### A7. Pricing and bounds: unchanged, and why that is safe (ruling 11)

The calibrate, allocate and envelope routes call library methods that write
result attributes onto the object (`distortions`, `distortion_df`,
`calibration_df`, LIB `_pricing.py:957-959`; the envelope path via
`bounds.py:147`, which documents the mutation at `bounds.py:124-128`). This
residue is accepted, on measured grounds:

- The API reads none of it back. A grep of `src/aggregate_api` for those
  attributes finds only the `bounds.py` docstring. Every pricing request
  recomputes from its own form parameters.
- The one reused store, `_augmented_dfs`, is keyed
  `(distortion.label, view, role, S_calculation, allocation)`
  (`_portfolio.py:3432`) and the label carries the fitted shape, so identical
  targets reuse identical frames and different targets never collide.

One standing rule keeps it safe: **API pricing calls always pass their
distortions explicitly**, never leaning on LIB defaults that read
`self.distortions` (`_portfolio.py:4114-4118` raises when unset, which is the
guard that would otherwise silently serve another session's fit). A comment at
the call sites, and the section 7 residue test, pin it.

## 7. Tests

Sessions `x`, `y`, `z` against a library holding `A`, `B` referencing `A` in
an inlinable position, and `C` using `A` as a severity (`sev agg.A`). `z`
edits `A` (a **library name**, ruling 10) before building.

| step | expected | mechanism |
|---|---|---|
| x, y build `A` | one build, shared key, second is a hit | self-contained text |
| z builds its edited `A` | qualified key, own object, own card | z's A is session-sourced |
| x, y, z build `B` | x and y share; z qualified | inlined reference reported by the preview |
| x, y, z build `C` | x and y share; z qualified | `sev_ref` existence check reported by the preview |
| x and z build bare `A` | x shared, z qualified | the bare-name branch of the preview |

Plus:

- **Registration on hit** (ruling 9): x builds a new program `P` (miss); y
  builds identical text (hit); y then builds programs referencing `P` both
  inlined and as `sev agg.P`. Both resolve in y's fork. This is the test the
  v1 matrix could not catch, because its names all lived in the library.
- **Expiry**: evict z's fork; z's reference to their own object returns the
  A5 422 naming the missing entry.
- **Sharpen**: two sessions view one shared entry; one sharpens; the other's
  oid still serves and the original object's grid is unchanged.
- **Pricing residue** (ruling 11): session a calibrates the shared object at
  one target, session b at another, concurrently; each answer reflects its own
  form, and b's answer is byte-identical to what b gets on a private object.
- **Fork isolation both directions** and the library clobber containment,
  from the note's section 4.1.
- **Alice and Bob**, the note's section 1 verbatim, end to end: identical
  outer text, different inner, two correct answers.
- **A0 step 7**, the `--library` sibling reference, which fails today.

**Concurrency.** The reorder moves parsing outside the single build slot for
the first time: today every parse runs inside the one-worker executor
(`routes/objects.py:170`, `:176`), so parses are accidentally serialized, and
under this plan previews run concurrently against the shared module Lark
singleton. Per-call state is clean (fresh transformer per parse,
`parser.py:2494-2495`), but the shared `_PARSER.parse` needs its thread safety
pinned:

- threaded parse hammer: N threads previewing distinct programs, results
  equal to serial baselines; if it fails, a dedicated parse lock restores
  today's serialization without occupying the build slot;
- registry contention: N threads, mixed session ids, exactly one fork per id;
- registration racing the recipes read: one thread builds in a session while
  another loops the `.agg` download; no "dictionary changed size during
  iteration" (the L1 `list(items())` hardening);
- simultaneous miss on one shared key from two sessions: both succeed, the
  cache converges to one entry, the duplicate build is tolerated as decided
  semantics;
- eviction mid-request: the in-flight request completes on its reference, the
  next request gets a fresh fork and the expiry path.

LIB side: `fork()` isolation and the `_parser` / `_sev_ref_stack` resets; the
preview agreeing with `_build_work` on bare names; the preview reporting
sources per fork; `RecipeNotFound` from the `recipe()` raise sites and through
`_resolve_sev_ref`; the cycle guard unchanged.

## 8. What this does not do, and what still will not work

- **No content addressing.** Two users who build byte-identical session
  objects and then type the same referencing line each pay their own build.
  Extra compute, never a wrong answer. Section 9 holds the upgrade path and
  the telemetry (A3's counter) that would justify it.
- **A session is one browser tab, and nothing persists.** Ruling 7. Server
  restart or eviction ends it; the recovery is the A5 error pane plus the
  SPA's program history.
- **Headerless clients share one anonymous session** and keep today's
  collision behavior.
- **`cache_max` is 50 built objects globally** (`config.py:77`) and stays 50.
  A very large room still churns slots. It is the real conference-day
  constraint, it is already true today, and it wants deciding separately.
- **One process.** The registry, the forks and the cache are in-process
  memory. Running uvicorn with multiple workers would silently shard them;
  pin workers at 1 in deployment notes.
- **No authentication.** A session id is a namespace.
- **LIB's own single-process trailer clobber remains open** for Jupyter users
  (L4 first bullet); `fork()` contains it for the API only.

## 9. Parked, with reasons and caveats recorded

### 9.1 Content addressing (the v1 design)

Key the cache on the identity of the program's meaning: the canonical
re-rendering of the parsed spec (`format_program` at `layout='terse'`,
`trailer=('hints',)`, matching `Recipe.decl`), with the deferred `sev_ref`
form substituted recursively by the referent's identity. Rulings 1, 2 and 5
(first set) attach here: `format_program` grows a `uw=` parameter so the
string branch stops reaching for the singleton at `decl_writer.py:1357`;
hints are part of the identity; the fold is recursive, unlimited depth. Two
implementation caveats recorded so they are not relearned: `_render_statement`
returns the statement **verbatim** on any exception (`decl_writer.py:1282-1286`),
which would silently compute an identity over unresolved text and must be
tightened first; and the identity must use a per-call cycle guard, never the
instance `_sev_ref_stack`, because it runs outside the build slot. Revisit
when A3's telemetry shows qualified-build duplication that matters, or when
the deployment goes multi-process, where content-addressed keys are what
let caches cohere across workers with no shared mutable state.

### 9.2 Object fork and pickle

Measured 2026-08-18: `copy.copy` of a built object is 5 microseconds;
`copy.deepcopy` 10.5 ms (agg) and 31.4 ms (three-unit port); rebuilds 73.5
and 453 ms; `pickle.dumps` **fails** on the closure family in
`_severity.py:467-687` (`make_layer_attachment_cdf` at `:557`, stored at
`:1577`). Two parked LIB items, each with standalone product merit:

- Replace those closures with module-level callable classes, making built
  objects picklable. Opens process-pool builds, disk warm start and
  cross-machine caches in one move.
- `Aggregate.fork()` / `Portfolio.fork()`: shallow copy sharing the computed
  distribution with fresh pricing slots (`_augmented_dfs`, `_distortion`,
  the calibration attributes), units forked too. Rests on the contract that
  pricing methods bind and never mutate frames in place, which wants a
  both-directions isolation test. Jupyter case on its own: two calibrations
  of one portfolio side by side without rebuilding.

### 9.3 A derived-results cache

Calibration is a pure function of (object, targets), so its results can be
cached and shared keyed `(object key, operation, canonical params)`, the
pattern the chart-doc cache already uses (`routes/objects.py:2213-2233`).
Needs the 9.2 purity contract plus a `store=False` knob through
`calibrate_distortions` / `analyze_distortions` / `apply_distortion`. This is
the eventual dedup for a room calibrating identical targets; ruling 11 makes
it unnecessary now.

## 10. Sizing

LIB is one bump: `fork()`, the preview, `RecipeNotFound`, two TODO records.
The API carries A0 (owed anyway), then the session work. Suggested bump
boundaries: A0 alone (it stands on its own and fixes a live bug), then A1 and
A2, then A3 to A7.
