# Plan: catch the app up to `aggregate` 1.0.0a333 ([Library-Skew-a333])

Status: RULED and executing. Written 2026-09-05. API repo only. One bump.
Author ruling of 2026-09-05: this lands as its own bump **before**
`dev/plan-approximation-tab.md`, so the approximation work starts on a
green tree and the two CHANGELOG sections stay separable.

## Why this exists

`dev/plan-approximation-tab.md` opens with a `[Sync]` step, `uv sync
--extra dev` against LIB at 1.0.0a333. Running it exposed nine failing
backend tests that have nothing to do with the approximation tab. They
are version skew: LIB moved a327 to a333 while the app stood still, and
six of those bumps changed a surface this repo reads.

Strictly the skew predates the sync. `aggregate` is an editable path
source, so the interpreter has been importing a333 source ever since the
author's LIB worktree moved to `V:\worktrees\aggregate_REFACTOR`; only
the version `importlib.metadata` reports was stale at a327. The sync did
not break anything, it made a standing breakage legible.

The LIB bumps that matter, from `git log a327..a333` in the LIB tree:

| LIB | What changed | What it costs here |
|---|---|---|
| `4e49cab` | the `checks` tag namespace leaves `library.agg` | one test's subject no longer exists |
| `cd63309` a327 | 43 worked examples join `library.agg`, `clash` among their heads | one test's head vocabulary is short a word |
| `b9aa7ba` a330 | bivariate `stats_df` takes the Portfolio layout | **a real app regression**, see below |
| various | `tail_df` becomes two sided: index `P`, 19 rungs, anchors on both tails | four tests read the old shape |
| various | the joint surface reports the whole placed mass, and `detail` overshoots | two tests read the old contract |

## Current behavior

`uv run pytest` on a clean checkout at a139, against LIB a333:
`9 failed, 378 passed`. `cd web; npm test` is green at 121 passing, and
stays untouched by this plan: nothing here reaches the SPA.

## The change

### [Bivariate-Moments] the one real regression

`routes/objects.py::_component_fields._from_stats` reads a bivariate's
moments out of `stats_df` at `("theoretical", stat)` and falls back to
`("empirical", stat)`. LIB a330 gave the bivariate the Portfolio layout,
so that frame is now indexed `(component, measure)` over `meta` /
`freq` / `sev` / `agg` blocks, with the unit names plus `independent`
and `total` as columns. Neither old key exists, `_from_stats` returns
`None` for both moments, and the status strip prints `mean (?, ?) . CV
(?, ?)` on every pair. That is exactly the reading the `components`
block was added at a57 to fix, and exactly the way it broke the first
time, so this is the same bug arriving by a new route.

The fix is one line of key: read `("agg", stat)`. The `agg` block is
the analytic aggregate moment, which is what the old `theoretical`
basis meant, so the preference the docstring records is preserved
rather than dropped. There is no empirical fallback to keep, because
the new layout carries no second basis to fall back to; a missing key
already resolves to `None` through the existing `except`.

### [Test-Expectations] eight tests read surfaces that moved

None of these is an app defect. Each asserts a library fact that the
library has since restated.

1. `test_examples.py::test_a_value_repeating_across_namespaces_keeps_both_pills`
   **deleted.** It asserted that `library.agg` carries a value repeating
   across two namespaces (`topic:pnl` on a `pnl` entry) and that the app
   draws both pills rather than deduping. The library removed the
   namespace, so there is no doubled entry left to find and the test
   fails on its own premise. The app rule it guarded is not lost: the
   test immediately above it asserts `len(pills) == 1 + len(item["tags"])`
   for every item, which **is** the no-dedupe rule, stated without
   needing a duplicate to exist.
2. `test_examples.py::test_example_decl_arrives_without_its_filing_clauses`
   gains `clash` to its `heads` set. `BivariateClash` arrived with the
   a327 examples and opens `clash BivariateClash`, a bivariate view
   keyword the set predates.
3. `test_objects.py::test_tail_df_endpoint`: the probability column is
   `P`, not `p`.
4. `test_objects.py::test_the_library_formats_its_own_numbers`: the same
   rename, read through `head.index`.
5. `test_objects.py::test_frame_ir_sparsifies_the_row_index`: the
   ladder is 19 rungs per unit, not 10, so the sparsified rowspan is 19.
6. `test_objects.py::test_the_library_flags_the_capital_anchors`: the
   ladder is two sided, running 0.001 to 0.999, so the library flags the
   1-in-200 and 1-in-250 anchors at **both** ends. Four emphasis rows
   per unit against three units is 12, and the total unit is 19 rows.
7. `test_objects.py::test_bivariate_chart_document`: the emitted surface
   now carries the whole placed mass. It used to hold `kept * (1 -
   deficit)`, the fraction inside the display window; it now sums to
   `1 - deficit` while `window.kept` reports the window separately. The
   assertion moves to the relation that holds, and says which one it is.
8. `test_objects.py::test_chart_parameters_change_the_bytes`: it
   asserted `nx <= detail`, which is the wrong quantity. See below.

### [Detail-Counts-The-Window] the ceiling is real, and it is not on `nx`

This was drafted as an upstream ask and is not one. Recorded in full
because the wrong reading is easy to reach twice.

`charts._emit_bivariate._block_factor` says "`detail` is honored as a
ceiling rather than as a target to straddle", and the emitted grid
plainly exceeds it. Measured on the app's `_BV` fixture, straight
through `charts.build_chart_doc` with no api in the path:

```
detail  32  ->  nx  128  ny  64   k [16, 8]
detail  64  ->  nx  256  ny 128   k [ 8, 4]
detail 256  ->  nx 1024  ny 512   k [ 2, 1]
```

`nx` is four times the requested value and `ny` twice it, at every
depth, which reads like a scaling error. It is not. `_block_factor` is
an internal helper and its ceiling is over the **window span**;
`_joint_surface`, which is the public docstring and the one that
governs, states both halves of what is actually happening. `window`
"selects the block factor and says which part of the grid is the
subject; it does **not** crop what is served", and `detail` is "target
cells per axis **across the window**", with "the emitted axis runs the
whole lattice at that step and so is longer, by the ratio of the lattice
to the window".

Both are exactly what is measured. The x lattice is 2048 cells and the y
lattice 512, and `nx == len(lattice) // k` holds at every depth above.
The ratio is four on x and two on y because the window is that much
narrower than the lattice, and it is a property of this fixture rather
than a constant. The ceiling the library promises does hold: cells
across the reported window come to 24, 47 and 188 against the three
`detail` values of 32, 64 and 256.

The same sentence explains finding 7. Nothing crops what is served, so
the served grid carries the whole placed mass and `window.kept` reports
the window's share of it separately. Both tests predate the emitter
saying so, and both passed while the two quantities happened to agree.

So the test asserts the documented ceiling, computed off the document's
own `window` block, rather than the weaker "coarser request, coarser
grid" property that a first pass settled for. Nothing is owed upstream.

## Files

- `src/aggregate_api/routes/objects.py`, `_component_fields`
- `tests/test_examples.py`
- `tests/test_objects.py`
- `dev/TODO.md`, `CHANGELOG.md`, `pyproject.toml`, `uv.lock`

## Acceptance checks

- `uv run pytest` green, 0 failed.
- `cd web; npm test` green, 121 passing, unchanged by this plan.
- A `grossnet` bivariate's `components` block carries a finite `mean`
  and `cv` per component, with Gross exceeding Net.
- No new import from `aggregate`, and no private name.
- The `detail` finding is recorded in `dev/TODO.md` and nothing app side
  works around it.

## Execution log

Executed 2026-09-05 at **a140**. Both gates green: `uv run pytest` 386
passed, `cd web; npm test` 121 passed with nothing touched on that side.
`uv run --no-sync python dev/scripts/check-exhibits.py` reports clean,
and already lists `approximation` serving 27 rows on every kind that has
one, which is the approximation plan's premise confirmed a phase early.

Divergences from the plan as written above, all found while running it:

1. **Two more skew items surfaced, both hidden behind assertions that
   failed earlier in the same test.** Neither was visible in the first
   pytest run, because a test stops at its first failure.
   `test_the_library_formats_its_own_numbers` reads the probability cell
   as a `{raw, text}` pair, and the two sided ladder made `P` the
   frame's **index**, so it serializes as a stub, a bare string with no
   raw value beside it. Read as a string now, with an `isinstance`
   assertion so the shape is stated rather than assumed.
   `test_bivariate_chart_document` asserts `surf["edge"] == "left"`, and
   library a333 (`[Approximation-Centered-Mass]`) centers the mass on
   the bucket, so it reads `mid`.
2. **The `edge` assertion is not restated as a literal.** The literal
   was never the risk. `web/src/charts/surface-grid.js` normalizes
   anything that is not `left` to `mid`, so a third spelling would be
   silently read as `mid` and would shift every coordinate half a bucket
   with nothing failing. The assertion is now membership in the pair
   that file handles, which is the check that was wanted. Checked
   before writing it: the SPA already decodes `mid` correctly and
   `centerX` accounts for it, so no plot moved when the library changed
   and no app edit is owed.
3. **`_from_stats` loses its fallback loop rather than keeping a
   two-layout read.** The plan said one line of key. Keeping the old
   `(basis, stat)` pair beside the new `("agg", stat)` was considered
   and rejected as speculative: the repo pins LIB as an editable path
   source, a missing key already resolves to `None` through the existing
   `except`, and a second key that can never match is a comment
   pretending to be code. The docstring records the move instead.
4. **The `detail` finding was filed as an upstream ask and withdrawn**
   before the bump, on the author's question of whether LIB owed a fix.
   Reading `_joint_surface`'s docstring rather than `_block_factor`'s
   showed the library documents exactly the measured behavior, so the
   `dev/TODO.md` entry came back out and the test asserts the ceiling
   the library actually promises, over the window rather than over the
   emitted axis. That is a stronger assertion than the one the first
   pass wrote, not a weaker one. Recorded at length in
   `[Detail-Counts-The-Window]` above because the wrong reading is easy
   to reach twice.

**Nothing is owed upstream by this plan.** Every other item is the app
catching up to a deliberate library change. No new import from
`aggregate` and no private name; the web suite was not touched.
