# Plan: aggregate installed editable from the worktree, with a floor that means what the code needs

`[API-Editable-Aggregate-Source]`. Drafted 2026-10-31 against aggregate-api 1.40.0 and aggregate
1.43.1 (the worktree). One minor bump in the API, no library change. Agreed by the author on
2026-10-30 (`D:\Projects\Using\bugs\aggregate-review-answers-1.43.qmd`, item 7). It must land
before the 2.0 release of the library, because of the `<2` ceiling.

## Goal

One word, `aggregate`, means three things in this repository today: the version number of a
build, a release to PyPI, and the dependency declaration in `pyproject.toml`. The declaration
should state what the code needs and nothing more; today it also decides what runs on the
author's machines, which is the source of the owed floors, the `<2` ceiling, and the editable
install that `uv sync` silently replaces. After this plan:

| Audience | Gets `aggregate` from | What they type |
|:--|:--|:--|
| DOOB (`V:\dev\aggregate-api`) | Editable from `V:\worktrees\aggregate_REFACTOR`, permanently | `uv sync`, now safe |
| The VPS | Editable from its clone of the library, on `dev` | `refresh.sh` |
| Everyone else | The PyPI wheel | `pip install aggregate-api` from the GitHub release's wheel |

## Current behavior

- `pyproject.toml:69` declares `"aggregate>=1.11.0,<2"`. The comment at 46 to 68 records why:
  1.11.0 is the first PyPI release carrying the per-block format sheets, and the ceiling is
  caution about two private names, `parser._PARSER` and `parser_errors._TERMINAL_LABELS`.
  Line 77 declares `"eltq>=2.13"` separately, with the note at 70 to 77 that the line becomes
  `aggregate[elt]` once the floor reaches 1.18.0.
- There is no `[tool.uv.sources]` table. The block at 153 to 187 records why it was removed at
  the 1.0.0 commit `6bc7f03` (2026-10-07): uv honors the table when this project is installed
  as a git dependency and resolves the relative path inside the GitHub repository, so
  `uv pip install git+https://github.com/mynl/aggregate_api` failed outright. The same block
  gives the workaround in use since: `uv sync --extra dev` then
  `uv pip install -e V:/worktrees/aggregate_REFACTOR`, which lasts until the next `uv sync`
  puts the lock's 1.11.0 back, and `uv run --no-sync` between.
- The `.venv` is in that swapped state now: `direct_url.json` under
  `aggregate-1.41.0.dist-info` points at `file:///V:/worktrees/aggregate_REFACTOR`, editable.
  `uv.lock:14-16` still records `aggregate 1.11.0` from PyPI.
- The code needs far more than 1.11.0. `tests/test_objects.py` skips at 456, 457, 503 and 505
  under a library before 1.22.0, 1.23.0, 1.42.0 and 1.43.0; `web/src/decl-words.json` is the
  word list of 1.41.0, and `tests/test_decl.py:253-266` compares it with the installed
  library's; `tests/conftest.py:68` notes a kind that arrived in 1.30.0. `dev/TODO.md:28-29`
  and 54-56 hold the owed floors (1.41.0, and `aggregate[elt]` with 1.18.0), and every
  CHANGELOG entry from 1.34.0 to 1.39.0 repeats the release blocker.
- The latest library on PyPI is 1.11.0 (`V:\worktrees\release-logs\1.11.0\progress.json`);
  the worktree is 1.43.1.
- `pip install git+...` of this repository installs an API whose `/` returns 404, because the
  built web page is not in git (`README.md:87-91`, `dev/release-notes.md:8-9`). So the git
  route was never a working install, with or without the table; the wheel attached to the
  GitHub release is the route.
- Precedents: `V:\dev\PMIR\pyproject.toml:50-54` and `V:\dev\aggregate-relativity\pyproject.toml:53-54`
  both carry `aggregate = { path = "../../worktrees/aggregate_REFACTOR", editable = true }`,
  and their `uv.lock` records `source = { editable = "../../worktrees/aggregate_REFACTOR" }`.

## Change

One bump, `[API-Editable-Aggregate-Source]`, in `pyproject.toml` and the files that describe it.

1. **The source table.** Add, with PMIR's comment (relative, never a drive letter; the editable
   install includes the library session's uncommitted changes):

   ```toml
   [tool.uv.sources]
   aggregate = { path = "../../worktrees/aggregate_REFACTOR", editable = true }
   ```

   Then `uv lock` and commit `uv.lock`, which records the editable source with no version.
2. **The declaration.** `"aggregate[elt]>=1.43.1"` replaces lines 69 and 77: no ceiling, the
   `elt` extra in place of the separate `eltq` line, and a floor equal to what the tests and the
   word list use today. The floor moves only when the API starts using something newer, and the
   order at a release is library first, then API.
3. **The guard the ceiling stood for.** A test, `tests/test_private_names.py`, imports
   `aggregate.parser._PARSER` and `aggregate.parser_errors._TERMINAL_LABELS` and asserts the
   two things `src/aggregate_api/completion.py` (33, 37, 115, 136, 204) relies on: `_PARSER.lex`
   is callable and `_TERMINAL_LABELS` is a `dict` of `str` to `str`. A major that moves either
   name fails this test instead of an install.
4. **Dead skips.** The four version gates in `tests/test_objects.py` and the note in
   `tests/conftest.py:68` go, since the floor now covers them.
5. **The words that describe the old state.** `pyproject.toml` 46 to 77 and 153 to 187;
   `CLAUDE.md` 47 to 49, 76 to 78 and 99 to 104; `scripts/release-check.ps1` 15 to 17 (its
   check is unchanged: `uv pip install <wheel>` reads no project metadata, lines 162 to 165);
   `.claude/skills/execute-plan/SKILL.md` 75 to 79 and `.claude/skills/version-bump/SKILL.md`
   48 to 49 and 181 to 186, which tell a session that `uv sync` replaces the editable install;
   `dev/TODO.md` 28 to 29 and 54 to 56 closed; `README.md` 87 to 91 keeps its warning about the
   git route and adds that `uv pip install git+...` now fails outright, so the wheel is the
   route. Outside this repository, `V:\worktrees\RELEASE.md` 52 to 54 becomes true again, and
   `V:\dev\RELEASE-PROCESS.md:13` loses its trap; both are the author's files, listed here and
   left to them.
6. **The VPS.** `refresh.sh` lives on the box at `~/hacking/refresh.sh` and in no repository;
   `human-hints.md` 718 to 722 describes it (pull both repositories, `uv sync --frozen --extra
   dev` in each, rebuild the page, restart) and 576 to 585 the systemd unit running
   `uv run --no-sync aggregate-api`. With the table in place `uv sync` there installs the
   library editable from `../../worktrees/aggregate_REFACTOR` relative to
   `~/hacking/aggregate_api`, which is `~/worktrees/aggregate_REFACTOR`. One symlink makes it
   resolve: `ln -s ~/hacking/aggregate_REFACTOR ~/worktrees/aggregate_REFACTOR`, or whatever
   the clone's path is. **Precondition**: the author pastes `refresh.sh` so the clone path and
   the sync flags are read from it, not assumed; `--frozen` with the new lock is fine, since the
   lock carries the editable source.

## What this gives up

`uv pip install git+https://github.com/mynl/aggregate_api` fails with the table, as it did
before 1.0.0. It installed a dead page without it, so nothing that worked is lost; the README
records this and points at the wheel. Published wheels never contain `[tool.uv.sources]`, so
`pip install` from PyPI or from the release asset is unaffected. The release check can prove the
PyPI route from the tree with `uv sync --no-sources` (a uv flag that ignores the table; confirm
the spelling against the installed uv at execution), once a library carrying 1.43.1 is on PyPI.

## Files

`pyproject.toml`, `uv.lock`, `tests/test_private_names.py` (new), `tests/test_objects.py`,
`tests/conftest.py`, `CLAUDE.md`, `README.md`, `scripts/release-check.ps1`,
`.claude/skills/execute-plan/SKILL.md`, `.claude/skills/version-bump/SKILL.md` (both skill
edits drafted for the author to apply, per the house rule on self-modification), `dev/TODO.md`,
`CHANGELOG.md`, `src/aggregate_api/__init__.py` (the version).

## Acceptance

- After `uv sync --extra dev`, `uv run python -c "import aggregate; print(aggregate.__file__)"`
  prints a path under `V:\worktrees\aggregate_REFACTOR\src`, and a second `uv sync` leaves it
  there.
- `uv.lock` has `source = { editable = "../../worktrees/aggregate_REFACTOR" }` for `aggregate`
  and no `version` line for it.
- The fast suite passes with no skip for a library version, and `tests/test_private_names.py`
  passes.
- `scripts/release-check.ps1` on the built wheel: its result is recorded in the execution log.
  It is expected to fail the word list test until a library at or above 1.43.1 is on PyPI; that
  is the release order, not a defect of this plan.
- `refresh.sh` on the VPS, run once after the symlink, leaves the service importing the library
  from the clone (the same `aggregate.__file__` check over ssh), recorded in the log.

## Execution log

Executed 2026-11-02 as **1.42.0**, after **1.41.0** `[Follow-Aggregate-1.61]` (no plan). The library
worktree was at 1.61.0 (`dev`, pushed), not the 1.43.1 this plan was written against; LIB plans 1 to 7
of the answers document had landed as 1.44.0 to 1.61.0.

### Rulings at review, 2026-11-02

- **Follow-ups first, as their own bump.** Against 1.61.0 the suite was red, 2 failed and 762 passed:
  aggregate 1.59.0 raises a `ValueError` with an `ErrorReport` for an unmatched bracket where it raised
  a bare `AssertionError`, and `test_an_unbalanced_bracket_is_a_422_not_a_500` and
  `test_collapse_never_joins_statements` pinned the old behavior. Aggregate 1.56.0 added a view clause
  to the reinsured verdict, so `validationState` graded every clean reinsured object amber, with no test
  to catch it. Both are named in the library's CHANGELOG as owed by the API. The author ruled a no-plan
  bump first: 1.41.0.
- **Floor `aggregate[elt]>=1.61.0`**, not `>=1.43.1`: the library the suite runs against (author).
- **VPS**: `refresh.sh` is readable and writable at `Z:\hacking\refresh.sh`, the VPS home mounted on
  DOOB (author). Read rather than pasted.
- **Relativity plugin stays a hand install** (author). `uv sync` is exact and uninstalls it, so
  "`uv sync`, now safe" holds for `aggregate` only; `CLAUDE.md` keeps one restore line.

### Divergences

1. **More dead skips than the plan named.** Besides the four gates in `tests/test_objects.py` and the
   note at `tests/conftest.py:68`, the floor makes these dead too, and they went: the `nttagg`
   (1.1.0), `chfagg` (1.30.0) and `exact_tail` (1.5.0) probes in `conftest.py` with their 26 uses in
   `test_capability.py`, `test_decl_parse.py`, `test_examples.py` and `test_objects.py`; the
   `decl_help` skip in `test_decl_help.py`; the stable law gates `test_multi_statement.py` imported
   from `test_objects.py`. Kept: `PNL_PREMIUM_STYLE_SUPPORTED` in `capability.py`, which is source
   rather than a test skip, and the `joint_surface` skip in `test_objects.py`, a capability and not a
   version.
2. **README, Develop.** It said a fresh clone syncs with nothing beside it. With the table, `uv sync`
   needs the library at `../../worktrees/aggregate_REFACTOR`, or `uv sync --no-sources` once a
   release at the floor is on PyPI. A fourth audience the plan's table did not name: a contributor's
   clone. Rewritten, and the `aggregate` half of the co-development paragraph removed.
3. **`CLAUDE.md`** lines 43 to 78 and 99 to 104 rewritten, plus the sync line at 126. Its pointers to
   `V:/worktrees/CLAUDE.md` and `V:/worktrees/dev-files.md` (the latter also in the project
   `execute-plan` skill) name files that do not exist, so no control row was updated. Left for the
   author.
4. **The VPS.** The clone is `~/hacking/aggregate_REFACTOR` on `dev`, at 1.18.2 (unrefreshed since
   2026-10-28). The script had `AGG_DIR="$PARENT/aggregate_REFACTOR"` and ran
   `uv sync --all-extras --inexact --no-install-package aggregate` then
   `uv pip install -e "${AGG_DIR}[elt]"`, without `--frozen` (so it could rewrite `uv.lock`,
   `human-hints.md` 538 to 560). Edited: a guard at the top that stops before any pull when
   `~/worktrees/aggregate_REFACTOR/pyproject.toml` is missing, printing the `ln -s`; the sync becomes
   `uv sync --frozen --all-extras --inexact`, which installs the editable library with its `elt` extra
   from the lock, and the `uv pip install -e "${AGG_DIR}[elt]"` line goes. Relativity and ntt
   installs unchanged. Cost of `--frozen`: a dependency the library adds reaches the VPS only after
   the API is re-locked on DOOB and pulled.
5. **An incident on the share.** The first edit, made with the editor straight onto
   `Z:\hacking\refresh.sh`, left the file at 0 bytes. It was restored with `cp` from
   `~/hacking/refresh/refresh.sh`, a git-tracked copy that `diff` had shown identical beforehand, and
   checked byte for byte. The edits were then made on a local copy, checked with `bash -n`, copied back
   and compared with `cmp`. **`~/hacking/refresh/refresh.sh` is unchanged**, so the two copies now
   differ, and the restore cannot show whether the file still has its exec bit on the Linux side
   (`bash ~/hacking/refresh.sh` runs it either way).
6. **`human-hints.md`** 718 to 722 still describe the old pin (`../aggregate_REFACTOR`), and the plan
   cited `~/hacking/refresh.sh` where the answers document cited `~/hacking/refresh/refresh.sh`; both
   exist. Left for the author.
7. **The lock** records the library's whole `requires-dist`, every extra's metadata included, and
   resolves only `elt`: 66 packages, as before.

### Acceptance

- After `uv sync --extra dev`: `1.61.0 V:\worktrees\aggregate_REFACTOR\src\aggregate\__init__.py`; after
  a second `uv sync --extra dev`, the same path. Each sync uninstalled `aggregate-relativity`, restored
  with `uv pip install -e V:/dev/aggregate-relativity`; a plain `uv run` between them did not.
- `uv.lock`: `name = "aggregate"`, `source = { editable = "../../worktrees/aggregate_REFACTOR" }`, no
  `version` line ("Updated aggregate v1.11.0 -> (dynamic)").
- Suites: `uv run --no-sync pytest -q -p no:cacheprovider -rs`, 766 passed and none skipped (764 at
  1.41.0, plus the two in `tests/test_private_names.py`); `npm test` in `web/`, 351 passed.
- `scripts/release-check.ps1 -SkipWebBuild`: both suites, the build and every wheel inspection pass
  (`aggregate_api-1.42.0-py3-none-any.whl`, 3.14 MB, 16 assets); it stops at "installing the wheel
  failed", because PyPI has no `aggregate` at the floor: "only aggregate[elt]<=1.11.0 is available
  and you require aggregate[elt]>=1.61.0". That is the release order (library first), not a defect,
  and it fails earlier than the plan predicted (at install, not at the word list test) because the
  floor is 1.61.0.
- VPS: open, the author's. Run `mkdir -p ~/worktrees && ln -s ~/hacking/aggregate_REFACTOR
  ~/worktrees/aggregate_REFACTOR`, then `~/hacking/refresh.sh`, then
  `cd ~/hacking/aggregate_api && uv run --no-sync python -c "import aggregate; print(aggregate.__file__)"`,
  which should print a path under `~/worktrees/aggregate_REFACTOR/src` (or the resolved
  `~/hacking/aggregate_REFACTOR/src`).

### Skill edits, drafted for the author

`.claude/skills/execute-plan/SKILL.md`, section 2, lines 75 to 81, in place of the paragraph after the
code block:

> The last line matters more here than anywhere else. Since 1.42.0 `uv sync` installs the worktree
> `aggregate` editable through `[tool.uv.sources]`, so the list should show it pointing at
> `V:\worktrees\aggregate_REFACTOR`. If it does not, `uv sync --extra dev` restores it (stop the
> server first), then `uv pip install -e V:/dev/aggregate-relativity` for the plugin the sync removes.
> Every version is read live as `__version__`, so the numbers in `/v1/meta` are never stale.

`.claude/skills/version-bump/SKILL.md`, lines 48 to 49:

> `--no-sync` is the habit: a plain `uv run` is harmless since 1.42.0, but it is slower, and it is what
> every command in `CLAUDE.md` uses.

and section 8, lines 181 to 186:

> **A bump runs no `uv sync`.** Through 1.9.0 one followed every bump, purely to rewrite the editable
> install's recorded version, and it wiped the co-development environment each time. Since 1.9.1 every
> version the server reports is a live `__version__`, so there is nothing to refresh. A sync is for a
> dependency change only; since 1.42.0 it keeps the worktree `aggregate` and still uninstalls the
> relativity plugin, so the plugin's restore in `CLAUDE.md` follows it.
