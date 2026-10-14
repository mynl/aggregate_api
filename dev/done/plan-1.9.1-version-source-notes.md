# Execution notes, [api] step of plan-1.9.1-version-source

Executed 2026-10-14 as 1.9.1, after [library] landed as aggregate 1.2.1 (`5fbce67`) and [relativity-plugin] as aggregate-relativity 0.10.0 (`f938d04`). [ntt-engine] was executed by a separate session and is not recorded here. These notes are this repository's alone; the plan text is the canonical copy of four.

## Divergences

- **`scripts/release-check.ps1` read the version from `pyproject.toml`'s `version =` line**, which no longer exists. The plan did not name it. It now reads the `__version__` literal from `src/aggregate_api/__init__.py`.
- **The execute-plan skill also leaned on the re-sync** (its description, section 2's grep of `pyproject.toml` versions and its "run `uv sync` when LIB moved" advice, section 6, the report). The plan named only version-bump; acceptance 3 needs both, so section 2 now checks that the worktree `aggregate` is installed editable instead.
- **version-bump section 7's paragraph was rewritten rather than deleted.** Its point (the About panel's number moves at once, so a stale SPA bundle under a new number misleads) holds even more with live versions; only its reliance on section 8 went. Section 8 became a short "No sync" note recording why the step is gone.
- **`importlib.metadata` is gone from `src/` entirely.** Modules import `__version__ as api_version` from the package, which `__init__.py` defines above `from .app import create_app`; a comment there says the order is load bearing.
- **The test** `test_versions_are_read_live_from_the_packages` checks both routes against `aggregate_api.__version__` and `aggregate.__version__`, then patches `aggregate.__version__` to show the read is live rather than merely equal today. Two existing tests that compared against `importlib.metadata` now compare against `__version__`.
- **No `dev/TODO.md` item** existed, so none was ticked. **`T:/worktrees/dev-files.md` no longer exists**, so there was no control row to update.
- **`V:\dev\RELEASE-PROCESS.md`** is outside any repository; its Traps line was edited in place and is not in a commit.

## Checks

- `uv run --no-sync pytest -q` (519 passed) and `cd web; npm test` (294 passed), both green at the bump.
- `.\scripts\release-check.ps1` passed for 1.9.1: the wheel's suite 519 passed in a clean environment, `/` and all 14 assets 200, and `/v1/meta` read 1.9.1 with `aggregate` 1.2.0, the released build a clean install resolves.
- **Acceptance 1 and 2**, against a real server (`python -m aggregate_api --port 8017`): `/v1/meta` read api 1.9.1, aggregate 1.2.1 and plugin relativity 0.10.0. With `__version__` edited to 1.9.2 and the server restarted, no `uv` command between, it read 1.9.2; reverted. `uv pip list` was identical before and after. `aggregate-ntt` was not installed in this environment, so its row was not checked here.
- In the co-development environment, before any reinstall: `aggregate.__version__` 1.2.1 and `aggregate_api.__version__` 1.9.1, against metadata still reading 1.2.0 and 1.9.0.
