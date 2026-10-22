# Plan: aggregate-api on greater-tables 8.1.0

`[Greater-Tables-8]`. Drafted 2026-10-22 at 1.31.1 (`0d0274b`) during the greater_tables 8.1.0 rollout. **Status: executed 2026-10-22 as 1.32.0.** See the Execution log at the foot.

This is the consumer half of a pair. The library half is `V:\worktrees\aggregate_REFACTOR\dev\plan-format-sheet-block-filter.md` (`[Format-Sheet-Block-Filter]`), which stops aggregate's exhibits raising a greater_tables warning for every format sheet column a block lacks. That half lands and is released to PyPI first; this plan does not start until the release is on PyPI.

## Goal

aggregate-api, and the aggregate-relativity plugin that runs inside its environment, run on greater-tables 8.1.0 and on the aggregate release carrying the format sheet filter, with the suite green and no greater_tables warning in any response.

## Current state, verified 2026-10-22

- **`pyproject.toml`:** `greater-tables>=7.0.0`, `aggregate>=1.6.0,<2`, no `[tool.uv.sources]`. **`uv.lock`:** greater-tables 7.0.0, aggregate 1.6.0.
- **`.venv`:** aggregate editable from `V:\worktrees\aggregate_REFACTOR`, aggregate-relativity editable from `V:\dev\aggregate-relativity`, greater-tables 7.0.0. The two editables are not in the lock, and any `uv sync`, including the inexact one a plain `uv run` does, replaces them (`CLAUDE.md`, "`--no-sync`, always").
- **A trial on 2026-10-22** moved the lock and the environment to greater-tables 8.1.0 and was then reverted. `uv run --no-sync pytest` gave 647 passed and 2 failed:
  - `tests/test_pricing_exhibits.py::test_ccoc_allocates_on_an_unbounded_book`: `body["warnings"]` held 538 entries of the form `formatters key 'CV' matches no column and is ignored.`, raised by greater_tables 7.4 and later from aggregate's `build_exhibit`. The library half fixes it. Passes on 7.0.0.
  - `tests/test_decl.py::test_committed_word_file_matches_the_installed_library`: `web/src/decl-words.json` lags the worktree aggregate's `decl_words()`. Fails on 7.0.0 too; unrelated to tables.
- **Already right, no change needed:**
  - `tables.py` (`frame_spec`) filters its `FORMATS` entries to the frame's columns before building, so the app's own tables do not warn.
  - The browser walker and stylesheet come from the installed package: `routes/meta.py` serves `GET /v1/assets/{name}` out of `greater_tables/assets`, and `web/src/tables.js` imports `/v1/assets/gt-render.esm.js`. The browser side moves with the server and cannot skew.
  - The only table document addition since greater_tables 7.0 is a `markdown` flag on cells, set only under `markdown_cols`, which nothing here uses. `ir_version` stays 1.
- **`CLAUDE.md`** gives the greater_tables co-development path as `c:/s/ai/greatest-tables`, an old-machine path. It is `V:/dev/greatest-tables`.

## Steps

### [lock]

1. Stop any running server. A sync rebuilds `Scripts/aggregate-api.exe` and fails with `os error 32` while a server holds it.
2. Raise the floors in `pyproject.toml` (ruling 1): `greater-tables>=8.1.0`, and `aggregate>=` the release carrying the filter, keeping `<2`. That aggregate release itself requires greater_tables 8.1 or later. Update the comments that describe the greater-tables floor (the one at `dependencies`, and "pinned `>=7.0.0` since 1.31.0" in `CLAUDE.md`).
3. `uv lock --upgrade-package aggregate --upgrade-package greater-tables`. Read the lock diff: only those two packages move, plus any dependency they newly need.
4. Install without a sync: `uv pip install greater-tables==8.1.0`. aggregate stays the worktree editable, which carries the filter once the library half has landed there. The documented alternative, `uv sync --extra dev` followed by the restore commands under "Relationship to `aggregate`" in `CLAUDE.md`, ends in the same state with more churn.

### [relativity]

5. In `V:\dev\aggregate-relativity`: `uv lock --upgrade-package greater-tables`, 6.0.0 to 8.1.0. A dry run on 2026-10-22 showed nothing else moving. The plugin has no environment of its own; it runs in this one. Its `FORMATTERS` (`margin`, `SA CoC`, `Div CoC`) all name columns of its actuals frame, so it raises no warning on its own account. Commit there by explicit path, following that repository's rules: the checkout holds uncommitted work in `src/aggregate_relativity/chart.py` that belongs to something else.

### [decl-words]

6. Regenerate the word list with the command the failing test gives: `uv run --no-sync python -m aggregate.decl_words > web/src/decl-words.json`. The drift predates this plan; it is fixed here so the gate is green.

### [docs]

7. In `CLAUDE.md`, replace `c:/s/ai/greatest-tables` with `V:/dev/greatest-tables`.

## Acceptance

- `uv run --no-sync pytest` is green, including the ccoc test (`warnings == []`) and the DecL word test.
- The environment holds greater_tables 8.1.0, aggregate as the worktree editable, and aggregate-relativity as an editable. `/v1/meta` reports the live `aggregate_version`.
- By hand, with the server running: an allocate exhibit and the relativity exhibit render, their responses carry no warnings, and `GET /v1/assets/gt-render.esm.js` contains `GT_RENDER_VERSION = '8.1.0'`.
- One bump with its CHANGELOG entry, committed and pushed under this repository's rules. Tables now come from greater_tables 8.1.0, which changes some output; the CHANGELOG says so.

## Rulings (Steve, 2026-10-22)

1. **Floors.** `greater-tables>=8.1.0`, and `aggregate` at least the release carrying the filter. The app is tested on those, and a re-lock that resolved an older aggregate would bring the warnings back. greater_tables 8.1 is the floor for every consumer: "move everyone onto >=8.1. there was a lot of good work went into 8."
2. **The aggregate floor is 1.11.0** (ruled at execution, 2026-10-22): "floor can be 1.11". The filter landed in 1.10.0, but PyPI went from 1.6.0 to 1.11.0, so 1.11.0 is the first published release carrying it and the one the suite runs on.
3. **The plugin is re-locked only** (ruled at execution, 2026-10-22). Its floor stays where it is, since greater-tables reaches it through the worktree `aggregate`, and a lock re-resolution is not a capability change there, so it does not bump and is left uncommitted for Steve under that repository's rules.

## Execution log

**1.32.0, 2026-10-22**, on `main` after 1.31.1 (`0d0274b`). Review stopped once: aggregate 1.10.0 was not on PyPI, which then held 1.6.0. Steve released 1.11.0 and ruled 2 and 3 above. All four steps then ran as one bump.

Divergences and findings:

1. **[lock] step 1 skipped.** A server was running (PID 9852, presumably the great-servers instance). Nothing here syncs: `uv lock` touches no environment and `uv pip install greater-tables==8.1.0` does not rebuild `Scripts/aggregate-api.exe`, so the server was left up. It needs a restart to pick up greater_tables 8.1.0 and the rebuilt SPA.
2. **[lock] the lock diff is exactly the two packages**, aggregate 1.6.0 to 1.11.0 and greater-tables 7.0.0 to 8.1.0, plus the two specifiers. The private names behind the ceiling, `parser._PARSER` and `parser_errors._TERMINAL_LABELS`, both import from 1.11.0, per the re-check at each library minor that the pin comment asks for.
3. **[lock] the aggregate floor comment** in `pyproject.toml` and the matching paragraph in `CLAUDE.md` ("The pin is `aggregate>=1.6.0,<2`") were rewritten too. The plan named only the greater-tables comments.
4. **[relativity] the plugin's lock picks up one line beyond greater-tables**: `hypothesis` in the editable aggregate's `dev` extra metadata, which the worktree `aggregate` now declares. Nothing installs differently. Left uncommitted (ruling 3), beside Steve's unrelated edit to `src/aggregate_relativity/chart.py`.
5. **[decl-words] overtaken in part.** Steve's uncommitted `web/src/decl-words.json` was already a regeneration at aggregate 1.9.0 (`aad`, `agglimit`, `franchise`). Regenerated against 1.11.0, it adds `disappearing` and sets `version` to 1.11.0. Committed with the bump, since the plan asks for it. The coupling is worth knowing: the committed word list must match the floor, because `release-check.ps1` runs the drift test against the released library.
6. **[docs] a second old path.** `pyproject.toml` carried `c:/s/ai/greatest-tables` as well as `CLAUDE.md`; both now read `V:/dev/greatest-tables`. `human-hints.md` and `dev/TODO.md` keep the old path in historical text and were left alone.
7. **Finding, not done: a redundant guard.** `tests/test_objects.py` gates the `nttagg` cases on `requires_nttagg` because the pin used to admit a library older than 1.1.0. With the floor at 1.11.0 the guard can never skip. Harmless, so it stays until that file is next edited.
8. **The control list `V:/worktrees/dev-files.md` does not exist**, so there was no row to update.
9. **Acceptance, the walker marker is spelled differently.** The served `gt-render.esm.js` carries `var GT_RENDER_VERSION = "8.1.0";`, double quoted, where the plan wrote `'8.1.0'`. The version is right; only the quoting differed.
10. **Acceptance by hand, done in process instead.** The running server was not restarted (divergence 1), so the by-hand checks ran through a `TestClient` probe in the session scratchpad, with `AGGAPI_AUDIT_DB` pointed at a scratch file and every Python warning recorded. `/v1/meta` reported aggregate 1.11.0 and tables 8.1.0, with the relativity plugin 0.10.0 loaded from its entry point; the allocate exhibit on the plan's portfolio returned 200 with `warnings == []`; the relativity exhibit on an `xpnl` returned 200 under both perspectives; zero warnings were recorded. Checking the restarted server by eye is still Steve's.

Tests: `uv run --no-sync pytest`, 649 passed, the ccoc and DecL word tests among them, and the warnings summary holds no greater_tables warning. `cd web; npm test`, 342 passed.
