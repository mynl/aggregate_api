# [nttagg] admit the library's exact-compound kind to the api

Status: EXECUTED 2026-10-09 as `1.1.0`. Every step landed as written except
where the **Execution notes** at the end of this file record a divergence; five
are recorded, all small, and one of them fixes a claim this plan got wrong.

Status when written: PROPOSED 2026-10-09. Nothing implemented. Every open question ruled on
by the author the same day; see **Rulings** at the end. Two edits are owed by
`aggregate` rather than by this repo, neither gating the work; see **What is
owed to `aggregate`**.

## Goal

`aggregate` 1.1.0 (2026-10-09) adds a DecL kind `nttagg`, an exact bounded
discrete compound computed over 32-bit prime fields with CRT reconstruction.
`build('nttagg Dice dfreq [1:6] dsev [1:6]')` returns an
`aggregate.ntt.AggregateNTT`, a subclass of `Aggregate`. Make the api build it,
serve it, and label it, and make the SPA color and complete the keyword.

## Current behavior

Nothing admits it. The api classifies a built object by **class name**
(`routes/objects._KIND_OF_CLASS`), `AggregateNTT` is not a key, and the two
fallbacks after it cover only the `Distortion` and `Severity` taxonomies. So
`_classify_object` returns the lower-cased class name `'aggregatentt'`, which
fails the `SUPPORTED_KINDS` membership test, and the build ends in

```
422  api supports 'agg', 'port', 'sev', 'distortion', 'bvagg', 'pnl' only;
     got 'aggregatentt'
```

Under the installed `aggregate` 1.0.1 the program does not parse at all, so
today the route answers 422 with a parse error instead. Either way there is no
path to an exact compound through this service.

## The release gate, and why the work can still land now

**`aggregate` 1.1.0 is not on PyPI.** Checked 2026-10-09: the latest published
version is 1.0.1 and no 1.1.x file exists. The worktree at
`V:\worktrees\aggregate_REFACTOR` is at 1.1.0 and its own `.venv` carries it,
which is where every fact in this plan was verified.

The pin `aggregate>=1.0.1,<2` already admits 1.1.0, so **no pin change is
required** and none is proposed. The floor stays at 1.0.1 because every edit
below is additive and inert without the library: a class-name key that no
object will ever match, a kind string no parser will ever emit, a keyword the
highlighter will never see in a program that parses. Moving the floor to
`>=1.1.0` would make the api refuse to install against a library a user can
actually get from PyPI, in exchange for nothing.

Two consequences for whoever implements this.

- **The tests must be gated**, because `uv sync` installs 1.0.1 and the suite
  has to stay green against it. See `[tests]`.
- **To work against 1.1.0 at all**, follow the recipe in `CLAUDE.md`:
  `uv pip install -e V:/worktrees/aggregate_REFACTOR` after a sync, then
  `uv run --no-sync ...`. Any `uv sync`, including the one the version bump
  runs, silently puts 1.0.1 back. `/v1/meta` reports `aggregate_version`, so
  that is where to look when behavior does not match the worktree.

**A library minor means the private-name re-check is due** (`CLAUDE.md`: the pin
carries a ceiling because of it). Done, and both hold at 1.1.0:
`aggregate.parser._PARSER` is still a `Lark` with `.lex`, and
`parser_errors._TERMINAL_LABELS` still exists, now 106 entries, gaining
`NTTAGG` and `NTT_NUMBER`. `Recipe.seq` and `Recipe.as_read` are both still
columns on `recipes`.

## What an AggregateNTT actually answers

Probed in the worktree venv on `nttagg Probe dfreq [1:6] dsev [1:6]`. This is
the evidence behind every step below.

| Question | Answer |
|---|---|
| class | `AggregateNTT`, and `isinstance(obj, Aggregate)` is True |
| grid | `log2=16`, `bs=1.0` (the library's auto-pick; the support is only 36) |
| moments | `actual_m=12.25`, `actual_cv=0.553`, `est_*` present |
| `value_type` | `'loss'` |
| exhibits | summary, tail, stats, validation, bs_window, tail_behavior, approximation |
| charts | agg, approximation, approximation_tails |
| `density_df` columns | the usual twelve, plus `p_exact` (object, `Fraction`) and `p_exact_float` |
| `stats_df` | gains an `exact` column; `mixed` rebased on it |
| new members | `accuracy_df` (5 columns, full grid), `ntt_audit` (12-row Series) |
| `with_hints(log2=10)` | works, writes `hints{log2=10; bs=1; normalize=True}` |
| `sharpen()` | works |
| `pnl_program()` | **raises** `ValueError: pnl_program: cannot wrap a 'nttagg' declaration in a P&L` |
| `reins_program(cession)` | **raises** `ValueError: reins_program: 'Probe' is a 'nttagg' declaration; a cession clause belongs to an aggregate` |

So the common surface works unchanged, because the object is an `Aggregate` and
because capability is derived from the library's own registries rather than from
a table here. The exceptions are the last two rows, which are step
`[capability]`.

The parser spec round-trips cleanly as well, which matters for
`POST /v1/decl/parse` and for the `.agg` export:

```
kind='nttagg'  name='Probe2'
ntt_freq_outcomes [0, 1, 2]     ntt_freq_probs [Fraction(1,4), Fraction(1,2), Fraction(1,4)]
ntt_sev_outcomes  [1, 2, 10]    ntt_sev_probs  [Fraction(3,10), Fraction(1,2), Fraction(1,5)]
spec_to_decl -> 'nttagg Probe2 dfreq [0 1 2] [1/4 1/2 1/4] dsev [1 2 10] [3/10 1/2 1/5]'
```

`serializers._spec_value` has no `Fraction` branch and falls through to
`str(value)`, which yields `"1/4"`. That is the right wire form and needs no
code change: it is exact, and it is the spelling the grammar itself accepts, the
same reasoning that sends a non-finite limit out as `"inf"`. It does want a test
and a line of comment, because the next reader will not guess that the fallback
is load bearing here.

## Steps

### [kind] admit the kind, four touchpoints

All in `src/aggregate_api/`, all one-liners.

1. `routes/objects.py` `_KIND_OF_CLASS`: add `"AggregateNTT": "nttagg"`. A
   string key, so nothing imports `aggregate.ntt` and the dict is harmless
   under 1.0.1. The kind spelling is the library's, since
   `Underwriter._factory` dispatches on `'nttagg'`, which is the rule the
   comment already standing over that dict states.
2. `routes/objects.py` `SUPPORTED_KINDS`: append `"nttagg"`.
3. `models.py` `BuildResponse.kind`: add `"nttagg"` to the `Literal`. **This is
   not cosmetic.** Without it the route returns `kind='nttagg'`, pydantic
   rejects the api's own response model, and the build 500s after doing all the
   work.
4. `routes/objects.py` `_KIND_ORDER` (the `.agg` session export): add
   `"nttagg": 3`, the slot the library's own `_KIND_WRITE_ORDER` gives it,
   beside `bvagg`. Nothing can reference an `nttagg`, so its rank is free;
   mirroring the library is the defensible choice rather than an arbitrary one.

Note what is **not** on this list. `_UNMAPPED_FCC`, the guard that warns when an
upstream class has no kind mapping here, stays silent either way: 1.1.0 did not
add `AggregateNTT` to `FIRST_CLASS_CLASSES`. The guard is not wrong to stay
quiet, but it is worth knowing it is not the alarm that would have caught this.

### [capability] no api change: the fix is one override in the library

**This step exists to record that there is nothing to do here, and why, so the
next reader does not re-derive it.** An earlier draft of this plan proposed a
`NON_COMPOSABLE_KINDS` constant in `capability.py`. That was wrong, and the
author's reading on 2026-10-09 is the correct one: the whole point of
`capability.py` is to pick up what the library delivers, so a fact about what an
`AggregateNTT` can do belongs in `AggregateNTT`.

**The symptom.** On an `nttagg` the app lights the P&L button (`nav.js` ->
`canPnl` -> `main.js:583`) and the Reins tab (`nav.js:137`, Quick Re at
`main.js:2729`, `3151`, `3308`). Both fail on use, with the two `ValueError`s
quoted in the surface table above. `can_pnl_rate` and `can_xpnl` compose on
`can_pnl` and follow it.

**Where the fault actually is.** `can_pnl` is `hasattr(obj, "pnl_program")` and
`can_reins` is `hasattr(obj, "reins_program")`. That is not a loose proxy for
capability: **it is a contract the library maintains deliberately**, and
measured across the classes it holds everywhere except on the new one.

| class | `pnl_program` | `reins_program` | correct? |
|---|---|---|---|
| `Aggregate` | present | present | yes |
| `PnL` | absent | absent | yes, cannot be re-wrapped, cannot cede |
| `Portfolio` | present | absent | yes, can be `xpnl`'d, cannot cede directly |
| `AggregateNTT` | present | present | **wrong on both** |

The library states the convention in its own suite, in
`tests/test_derived_programs.py:537`:

```python
def test_reins_program_rejects_a_portfolio_program():
    """A portfolio has no cession clause; its units do."""
    p = build(PORT)
    assert not hasattr(p, 'reins_program')
```

The corroborating tell: both `ValueError` branches the NTT work added, the
`'nttagg'` message in `pnl_program` and the one in `reins_program`, are
reachable **only** from an `AggregateNTT`. Every other class that would trip
them does not carry the method. The guard went in one layer too deep.

**The fix, upstream, and it is small.** `AggregateNTT` overrides both members so
that absence says what the guard says:

```python
@property
def pnl_program(self):
    raise AttributeError(
        "pnl_program: cannot wrap a 'nttagg' declaration in a P&L; "
        "the engine must be an aggregate or a portfolio.")
```

Verified in the worktree venv: `hasattr` returns False, because it swallows
`AttributeError` and nothing else; a direct call still prints the full
explanation; and `dir()` still lists the name, so tab completion and
discoverability are unaffected. Two facts that make it safe here. The exception
type changes from `ValueError` to `AttributeError` for a caller invoking it
directly, which breaks nobody because the class is new in 1.1.0. And
`constants.FCC_REQUIRED` lists neither method (nor is `AggregateNTT` in
`FIRST_CLASS_CLASSES`), so there is no contract member being dropped.

**What this repo does: nothing.** `capability.py` is untouched, no `kind`
argument, no constant, no call-site changes. `can_pnl` and `can_reins` then
report False on their own, and they go back to True by themselves on the day the
library relaxes the restriction and deletes the override. That is the behavior
the module was built for.

**Written up on the library side** as
`V:\worktrees\aggregate_REFACTOR\dev\plan-nttagg-composability.md`, which
carries the override, the dead-branch deletion and the `library.agg` entry as
one `1.1.1` bump.

**Sequencing, which does matter.** The api bump cannot fix this and must not
pretend to. Until the library override lands, an `nttagg` built in this app
offers two controls that fail. Since 1.1.0 is **not yet on PyPI**, publishing
1.1.1 as the first 1.1.x means no released version ever carries the defect;
that is the clean outcome and what the library plan aims for. If 1.1.0
publishes without it, the api's `[tests]` assertions on `can_pnl` /
`can_reins` fail honestly against the released library, which is the right way
round: the suite names the library defect rather than papering over it.

### [density] keep the exact column out of the JSON payload

`density_df` on an `AggregateNTT` carries `p_exact`, an object column of
`Fraction`. Three facts decide what to do.

- **The SPA's Density pane is already safe.** `nttagg` is not in
  `WHOLE_DENSITY_KINDS`, so `main.js:1550` asks for `cols=loss,p_total,F,S`,
  and the route applies `col_list` **before** `bin_density`. Verified by
  reading the route, not assumed.
- **The default JSON route is not safe.** `GET /v1/objects/{id}/density_df`
  with no `cols` keeps every column. `p_exact` matches the
  `c.startswith("p")` test that builds `sum_cols`, so `bin_density` sums
  `Fraction`s across 2**16 rows in bigint arithmetic, and then
  `serializers._safe` falls through to `str()` on every surviving cell. For
  the library plan's own headline case, `dfreq [1:100] dsev [1:100]`, the
  common denominator is `100 * 100**100`, so one cell is a roughly
  410-character string and the payload runs to tens of megabytes. For the 6 by
  6 case it is harmless, which is exactly how this reaches production
  unnoticed.
- **`p_exact_float` is the honest display column** and is already there,
  correctly rounded from the rational.

**Settled (author, 2026-10-09): drop it.** `p_exact` comes out of the JSON
`density_df` payload, `p_exact_float` stays, and `p_exact` survives only in
`frame/density_df.csv`, which is the "give me exactly what the library built"
export and streams rather than buffering a JSON tree. One guarded drop in the
density route, with the reason in a comment.

**The table document path takes the same drop**, that is
`frame/density_df?format=ir`, which renders through `greater_tables`. Read as
following from the same ruling rather than as a separate decision: the reason to
drop the column is that a 410-character rational is not a value a payload should
carry, and it is even less a value a reader can read out of a table cell. The
CSV stays the one way to get the exact numbers, which is the right place for
them, because a caller who wants 200-digit rationals wants them in a file and
not on a screen. Implement the drop once, in a helper both paths call, so the
two cannot drift.

### [frames] accuracy_df and ntt_audit stay unreachable, on purpose

`accuracy_df` (`p_exact_float`, `p_fft`, `err`, `abs_err`, `rel_err` over the
full grid) and `ntt_audit` (sizes, primes, timings, error summaries) are new and
reach nothing: `_CSV_FRAMES` is a whitelist and neither is in it, and
`ntt_audit` is a Series, so it has no shape on the frame routes at all.

Leave both out of this bump. They are the raw material for an accuracy exhibit,
which is a pane with a chart and a reading rather than a dictionary entry, and
the library's own plan puts that exhibit out of its scope too. Add a
`dev/TODO.md` entry instead: **[NTT-Accuracy]**, an exhibit comparing the exact
and the float answer per bucket, waiting on the library registering one so the
api can light it from `available_exhibits` rather than hand-wiring a route.

### [web] the keyword and the two label tables

1. `web/src/decl-keywords.json`: add `"nttagg"` to **`"structural"`**, beside
   `agg`, `port`, `sev`, `distortion`, `note`.

   **This departs from the instruction that came with the ripple**, which said
   to put it in the group with `dfreq` / `dsev` at the top of the file. That is
   right for the library's own `decl_pygments.py`, where those three sit in one
   `words(...)` tuple as a lexer token class. This file is a different shape: it
   groups by **role in a program**, `dfreq` lives under `"frequency"` and `dsev`
   under `"severity"`, and `nttagg` is a kind keyword that opens a declaration,
   so it belongs with the other kind keywords. Nothing breaks either way, since
   `decl-mode.js` flattens every group into one `KEYWORDS` set and only the
   group named `distortions` is special (it routes to `ATOMS` instead). The
   grouping exists for the person editing the file, and this is where that
   person will look.

2. `web/src/main.js` `KIND_LABEL`: add `nttagg: 'NTT Aggregate'`. The fallback
   at `main.js:1058` is `|| 'Aggregate'`, so without an entry the facts line
   calls an exact compound an Aggregate, which is silently wrong rather than
   visibly missing.

3. `web/src/lite.js` `KIND_LABEL`: the same entry. This is a deliberate local
   copy of the map, because importing from `main.js` would drag Bootstrap and
   CodeMirror onto the phone, so it has to be edited twice by hand. Its fallback
   prints the raw kind, so the cost of forgetting is smaller here.

**The label is `NTT Aggregate`** (author, 2026-10-09). The map holds
human-readable type names and nothing else: the value is the second item on the
status strip, directly after the object's name (`main.js:1058` into the `.kind`
span, `lite.js:231` into `.p-kind`), where its neighbors read "Aggregate",
"Portfolio", "Severity", "Distortion", "Bivariate" and "P&L". So it names the
class, it does not describe the method, and it reads in that company.

### [examples] no entry here, one test to widen, and the entry comes from upstream

The second item that came with the ripple was whether an `nttagg` example
belongs in `examples.py`. **No, and nothing in this repo is the right place for
one.**

- `examples.py` has had no hand-maintained entry, order or title table since
  a121; they were deleted precisely because they were the app deciding what the
  library means. Every item is derived from `Underwriter.recipes`.
- The four `nttagg` entries 1.1.0 ships (`NTT.DiceOfDice`, `NTT.Skewed`,
  `NTT.Stepped`, `NTT.Scientific`) live in
  `src/aggregate/agg/_test_suite.agg`. The api loads `library.agg` only
  (`config.build.databases` defaults to `('library',)`, and `library.py` loads
  that singleton), so the Examples menu will not show them, and nothing needs
  excluding either.
- None of the four carries `tags{role:hero}`, so the landing gallery is
  unaffected *by them*. See the hero test below, which is affected by what
  comes next.

**An upstream entry is coming** (author, 2026-10-09: the library side will add
one to `library.agg`). It needs no api change to appear: it arrives in the menu,
in the facets, and, if tagged `role:hero`, in the landing gallery.

**But one api test will fail when it lands, and it is this plan's job to widen
it first.** `tests/test_examples.py:283`, in `test_hero_example_builds`, picks
the **shortest** hero decl (deliberately, to dodge the heroes carrying
`hints{log2=16}`) and asserts

```python
assert r.json()["kind"] in ("agg", "port", "sev", "bvagg", "pnl", "distortion")
```

`nttagg NTT.DiceOfDice dfreq [1:6] dsev [1:6]` is about 40 characters, which
makes it a strong candidate for shortest hero in the base, so a `role:hero` tag
upstream turns that assertion red. Add `"nttagg"` to the tuple as part of this
bump, **ungated**, unlike the tests in `[tests]`: the line is a plain string
tuple and widening it is correct under 1.0.1 too, where no hero can be an
`nttagg` and the extra member is simply never matched. Ungated also means the
widening cannot be skipped away on the machine that would have caught the
failure.

This is the general shape of the hazard, worth stating once: **an upstream
library entry can break this repo's suite without a line changing here.** The
kind tuple in that assertion is the only hard-coded kind list left in the test
suite that a new library entry can reach.

### [tests] gated on the library, not on a version string

The suite must stay green under 1.0.1, where `nttagg` does not parse.

Gate on **capability, not on a version number**: a module-level
`pytest.mark.skipif` whose condition is whether the installed parser accepts the
keyword, decided by parsing a trivial `nttagg` program once inside a `try`. A
version comparison would be a second declaration of the same fact, and would be
wrong the moment the library backports or renames.

Behind the gate, in `tests/test_objects.py` unless noted:

- an `nttagg` build returns 200 with `kind == "nttagg"`, a name, a resolved
  grid, and finite `mean` / `cv`;
- the response validates against `BuildResponse`, which is the regression for
  step 3 and the one that fails loudest if the `Literal` is missed;
- `can_pnl` and `can_reins` are both False, and `can_hints`, `can_sharpen`,
  `can_price` are True (`tests/test_capability.py`, adding `"nttagg"` to its
  label table);
- `density_df` with no `cols` carries `p_exact_float` and **not** `p_exact`;
- `frame/density_df.csv` **does** carry `p_exact`;
- `POST /v1/decl/parse` on `nttagg X dfreq [0 1 2] [1/4 1/2 1/4] dsev [1 2 10]
  [0.3 0.5 0.2]` returns `ntt_freq_probs == ["1/4", "1/2", "1/4"]` and
  `ntt_sev_probs == ["3/10", "1/2", "1/5"]`, which pins the `str(Fraction)`
  fallback as intended behavior rather than an accident
  (`tests/test_decl_parse.py`);
- `GET /v1/session/models.agg?form=agg` round-trips an `nttagg` build.

Use `dfreq [1:6] dsev [1:6]` throughout. It is the cheap case; the 100 by 100
headline is not a test.

## Files

| File | Change |
|---|---|
| `src/aggregate_api/routes/objects.py` | `_KIND_OF_CLASS`, `SUPPORTED_KINDS`, `_KIND_ORDER`, the `p_exact` drop on both the JSON and the `format=ir` paths, three `capability_for` call sites |
| `src/aggregate_api/models.py` | `BuildResponse.kind` Literal |
| `src/aggregate_api/capability.py` | **nothing.** See `[capability]`: the fix is one override in `aggregate` |
| `src/aggregate_api/serializers.py` | a comment only, on the `Fraction` fallback |
| `web/src/decl-keywords.json` | `nttagg` in `structural` |
| `web/src/main.js`, `web/src/lite.js` | the `KIND_LABEL` entry, twice |
| `tests/test_objects.py`, `tests/test_capability.py`, `tests/test_decl_parse.py` | the gated tests |
| `tests/test_examples.py` | `"nttagg"` into the `test_hero_example_builds` kind tuple, ungated. See `[examples]` |
| `pyproject.toml` | version only, `1.0.0` to `1.1.0`. **The `aggregate` pin does not move.** |
| `CHANGELOG.md`, `dev/TODO.md` | the 1.1.0 section, and the `[NTT-Accuracy]` entry |

## Acceptance check

Under the released library (`uv sync --extra dev`, `aggregate` 1.0.1):

```
uv run pytest                 # green, the nttagg tests skipped
```

Under the worktree library:

```
uv pip install -e V:/worktrees/aggregate_REFACTOR
uv run --no-sync pytest       # green, the nttagg tests running
```

Then, with the worktree library installed and the SPA rebuilt
(`.\scripts\build-web.ps1`), in the app:

1. `nttagg Dice dfreq [1:6] dsev [1:6]` builds, and the facts line names the
   kind with its own label rather than "Aggregate".
2. `nttagg` is colored as a keyword in the editor, and completes.
3. The P&L button and the Reins tab are both grey. **This one checks the
   library, not this bump**: it passes once `AggregateNTT` carries the override
   from `[capability]` and fails until then, with no api edit able to change
   either outcome.
4. Overview plot, summary, stats, validation, bs_window, tail_behavior and
   approximation all open.
5. More > Density opens and the payload is small.
6. The session `.agg` downloads and reloads.

## Rulings

All settled by the author on 2026-10-09; recorded here so the implementing
session does not reopen them.

1. **`KIND_LABEL` is `NTT Aggregate`.** See `[web]`.
2. **`p_exact` is dropped from both display payloads**, JSON and `format=ir`,
   and survives in the CSV alone. See `[density]`.
3. **An `nttagg` entry is being added to `library.agg`** on the library side.
   The api's only obligation is the ungated test widening in `[examples]`, which
   has to land before or with the library entry. See ask 2 below.
4. **The composability fix is the library's, not the api's.** No
   `NON_COMPOSABLE_KINDS`, no declared kind list in `capability.py`:
   `AggregateNTT` overrides `pnl_program` and `reins_program` so their absence
   says what their guards say. See `[capability]` for the mechanism and the
   evidence, and ask 1 below for what to send upstream.

## What is owed to `aggregate`

Two asks, both settled in substance, and both now written up on the library
side as a single plan,
`V:\worktrees\aggregate_REFACTOR\dev\plan-nttagg-composability.md`, landing as
`aggregate` 1.1.1. Neither gates this bump. Both are places where a fact about
the library was about to be written down in this repo, which is what
`CLAUDE.md` says to raise upstream rather than work around.

### Ask 1: AggregateNTT should not carry the two methods it refuses

**The ask, in one line.** Override `pnl_program` and `reins_program` on
`AggregateNTT` as properties that raise `AttributeError` carrying the message
the current `ValueError` carries, and delete the two `'nttagg'` branches from
the base methods' guards if nothing else can reach them.

**Why it is the library's job and not the api's.** Step `[capability]` has the
full argument and the evidence. The short form: presence of those two methods
is an existing, deliberate contract in the library (`PnL` carries neither,
`Portfolio` carries `pnl_program` and not `reins_program`), asserted by
`aggregate`'s own `test_reins_program_rejects_a_portfolio_program`.
`AggregateNTT` is the single class where presence lies. An api-side constant
would be this repo restating a library restriction, and it would go stale
silently on the day the library relaxes it, because `aggregate`'s
`dev/done/plan-nttagg.md` files that restriction under **Known limits** as a v1
decision, explicitly relaxable. With the override instead, relaxing it is one
deletion in the library and the app lights up by itself.

**Not to be asked for:** a public predicate (`can_wrap_in_pnl`, a public
`declaration_kind`). It was the earlier draft's suggestion and it is the worse
of the two: it adds public library surface, and it leaves the lying `hasattr`
in place for every other consumer. Also not to be reached for:
`_program._require_program`, the private helper that computes the kind. The two
tolerated private names are the reason the pin carries a `<2` ceiling, and a
boolean does not earn a third.

**Sequencing.** 1.1.0 is not on PyPI yet, so this can go into 1.1.0 and no
released version ever carries the defect. That is the outcome to aim for.

### Ask 2: an `nttagg` entry in `library.agg` (settled, it is being added)

**Settled (author, 2026-10-09): the library side will add one.** The rest of
this section is the reasoning, kept because it says what this repo owes in
return, which is the ungated test widening in `[examples]`. The api is
otherwise a spectator: the entry appears in the menu with no change here.

**What the api cannot do about it.** Nothing, which is the point. From
`[examples]`: the four shipped `nttagg` entries are in `_test_suite.agg`, the
api loads `library.agg`, and `examples.py` has had no hand-maintained entry
table since a121 because those tables were the app deciding what the library
means. So the Examples menu will carry no exact compound, and there is no edit
in this repo that would change that without rebuilding the thing a121 deleted.

**Why it is worth asking for.** The menu is how a reader discovers that a
feature exists. A kind nobody can find from the front door is, for most users,
a kind that is not there. One entry upstream, tagged `topic:` and `role:`,
appears in the menu, in the facets, and (with `role:hero`) in the landing
gallery, with no api change at all. `NTT.DiceOfDice` is the natural candidate:
it is the plan's own warm-up, it builds in well under a second, and the exact
dice-of-dice answer is the result that motivated the whole feature.

**One thing to know about going first.** Until **[NTT-Accuracy]** lands, the
app cannot show what makes the kind interesting: a reader who clicks the entry
gets an ordinary aggregate that happens to be exact, with nothing on screen
saying so. That is a reason to keep the exhibit on the roadmap, not a reason to
hold the entry, and the author has ruled to add it now.

## Execution notes

Executed 2026-10-09 in one bump, `1.0.0` to `1.1.0`, one commit. The plan's
phase order holds: every step is one coherent change to one kind, so there is
one bump rather than one per step.

### Verification before any edit

The private-name re-check the plan records was re-run against the worktree, and
the probe of what an `AggregateNTT` answers was repeated through the api rather
than against the object. Everything in the surface table holds. Both halves of
the acceptance check pass, and the measured numbers are in **Gates** below.

### Divergence 1: the library is at 1.2.0a3, not 1.1.0

The plan was written against a worktree at 1.1.0 and projected the composability
fix as `aggregate` 1.1.1. The library has since moved to **1.2.0a3**, and that
is where the fix landed: `V:\worktrees\aggregate_REFACTOR\dev\done\plan-nttagg-composability.md`,
retired. Verified in the worktree venv: `hasattr(o, 'pnl_program')` and
`hasattr(o, 'reins_program')` are both False on an `nttagg`, so the override is
in and the app greys both controls by itself. Nothing in this plan changes: the
pin `aggregate>=1.0.1,<2` admits 1.2.0a3 as readily as 1.1.0, and step
`[capability]` was always "do nothing here".

1.1.0 is still not on PyPI, so the clean outcome the plan aimed for is still
available: whatever publishes first in the 1.1.x or 1.2.x line carries the
override, and no released library ever lies about composability.

### Divergence 2: the upstream `library.agg` entry is here, and it is not a hero

Ask 2 has landed. The entry is **`nttagg ExactDiceOfDice`**, not the
`NTT.DiceOfDice` the plan guessed, tagged `topic:numerics, role:intermediate`,
and it sits in the Numerical character section. Two consequences.

It is **not** tagged `role:hero`, so the hero hazard the plan predicted does not
fire. `test_hero_example_builds` was widened anyway, exactly as ruled, because
the widening is correct under any library and because leaving it undone would
park a known trap for the day the tag changes.

And the entry's `note{}` is the one place a reader currently learns what the
kind does, which strengthens the case for **[NTT-Accuracy]** rather than
weakening it: the app shows an ordinary aggregate that happens to be exact.

### Divergence 3: a second hard-coded kind list, and the plan named the wrong one

The plan states that the kind tuple in `test_hero_example_builds` is "the only
hard-coded kind list left in the test suite that a new library entry can reach."
**That is wrong.** `tests/test_examples.py` also carries a `heads` set, the words
a DecL program may open with, swept over every entry in the shipped library, and
it was already red against the worktree:

```
FAILED tests/test_examples.py::test_example_decl_arrives_without_its_filing_clauses
AssertionError: ExactDiceOfDice opens with 'nttagg'
```

So the failure the plan anticipated did happen, through the other list and
without a `role:hero` tag anywhere near it. Both lists are now widened, both
ungated, with the hazard written down beside the one that fired. The general
statement the plan makes is right and worth keeping; it was the inventory that
was incomplete.

### Divergence 4: the Files table contradicted its own ruling

The Files table lists "three `capability_for` call sites" against
`routes/objects.py`, a leftover from the draft that passed a `kind` argument.
Step `[capability]` rules the opposite and the ruling is the one that was
followed: `capability.py` is untouched, no call site moved, and no constant was
added. Confirmed by test rather than by inspection, in
`test_an_exact_compound_can_neither_be_wrapped_nor_cede`.

### Divergence 5: the gated capability fixture needed a marked parametrize list

The plan asks for `"nttagg"` in `tests/test_capability.py`'s label table. Four
tests parametrize over `list(DECLS)` and one sweeps the dict directly, so a bare
entry would build an `nttagg` five times under a library that cannot parse one.
Rather than skip inside each test, the dict gains the entry and the module gains
two derived constants: `LABELS`, the parametrize cases with the gated one
marked, and `BUILDABLE`, for the loop that sweeps the dict. One gate expression,
and the new kind flows through the two sweeps that are the reason to put it in
the table at all, `test_every_listed_exhibit_serves` and
`test_every_listed_chart_serves`. Both pass: all seven exhibits and all three
charts an `AggregateNTT` lists actually serve.

### One test fixed after the fact, worth recording

`test_an_exact_compound_round_trips_through_the_session_export` passed alone and
failed in the full run, asserting the exported `nttagg` was the *first*
statement. The session recipes live on the process-wide underwriter, so a full
suite exports whatever earlier tests built, and the export is dependency
ordered: a severity sorts ahead of everything. The assertion now picks the kind
out of the list, which is what it meant to say.

### What was implemented beyond the letter of the plan

Two small things, both inside the plan's intent.

The `p_exact` drop is a named helper, `_drop_exact_rationals`, with the
reasoning on a module constant, `_EXACT_DENSITY_COLUMNS`. The plan asks for one
helper called from both paths; it is placed beside `_drop_raw_moments`, which is
the same shape of thing (a frame filter that composes and passes `None`
through), so the two read as a pair.

The JSON route drops the column **before** the `cols` filter, so
`?cols=loss,p_exact` is answered the same way as no `cols` at all rather than
specially. Asserted, because the alternative is a payload shape that depends on
how it was asked for.

### Gates

Both halves of the plan's acceptance check, both green.

```
uv sync --extra dev                                   # aggregate 1.0.1
uv run pytest                   490 passed, 9 skipped, 108s

uv pip install -e V:/worktrees/aggregate_REFACTOR     # aggregate 1.2.0a3
uv run --no-sync pytest         499 passed, 110s

cd web; npm test                277 passed
```

The nine skips name the gate in their reason, so the released-library run says
plainly that the exact-compound tests were not run rather than hiding it.

### Left for the author

- The six-item in-app check in **Acceptance check** above, under the worktree
  library and a rebuilt SPA. Item 3 (both controls grey) now checks a library
  that already carries the override, so it should pass rather than fail.
- Publishing. 1.1.0 is a bump, not a release; `.\scripts
elease-check.ps1`
  is the gate on that, and `uv publish`, the tag and the GitHub release are the
  author's.
