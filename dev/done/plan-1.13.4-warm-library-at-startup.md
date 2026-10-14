# Plan: read the library at startup, before the first request

Patch bump (1.13.x). Companion to the library plan
`V:/worktrees/aggregate_REFACTOR/dev/plan-thread-safe-load.md`, which fixes the
root cause in `aggregate`. This plan lands first and does not wait for it.

## Goal

A freshly started server must never hand a session a partial recipe base. The
shipped library is read completely, once, before uvicorn accepts a request.

## The symptom (author, 2026-10-14)

Restart the server, open the app, pick `Capstone.ExposureRating` from the
Examples menu (or open a deep link to it) and Build: it fails with no recipe
named `Capstone.Gross` of kind `agg`. The entry is plainly in `library.agg`,
which is selected. Reformat on the same text works, which proves the name
resolves. It happens only on a freshly started server, and once it happens it
stays for that browser tab: every later build that references an entry from
the back half of `library.agg` fails the same way.

## Root cause

Three facts combine.

1. **`build` is not loaded at import.** `from aggregate import build` gives an
   underwriter with `_loaded` False and zero recipes (true of 1.0.1 and 1.5.0).
   The first call to `aggregate_api.library.get_underwriter()` is what reads
   `library.agg`, about three seconds. The docstring of `get_underwriter` says
   the read "happened when `aggregate` was imported"; that is wrong.
2. **`Underwriter.load()` is not thread safe.** It sets `self._loaded = True`
   *before* it reads the files (`underwriter.py`, `load`, the `request is None`
   branch), and there is no lock. A second thread that calls `load()` while the
   first is still reading sees `_loaded` True, returns at once, and proceeds
   against a half-filled `_recipes` dict. `fork()` checks the same flag, so it
   too snapshots the half-filled dict. Released 1.0.1 has the same code, so
   every library in this package's pin range carries the defect.
3. **The SPA's first page load fires two requests at once.** The server log at
   restart shows `GET /v1/examples` and `POST /v1/objects` in the same second.
   FastAPI runs both sync handlers on threadpool workers. The first reaches
   `get_underwriter()` and starts the read. The second also enters
   `get_underwriter()` (an `lru_cache` is not a lock: a call made while the
   first is still computing runs the body again), whose `uw.load()` returns at
   once, and `sessions.underwriter()` then forks the half-read base. That fork
   is the session's base for the TTL (eight hours). Reformat is unaffected
   because `/v1/decl/format` parses against `build` itself, which finishes
   loading a moment later.

Reproduced in a fresh process: one thread calls `get_underwriter()`, another
takes a session fork 0.3 s later. The base ends with 198 recipes and the fork
with 113. Neither the test suite nor a warm server can see this, because both
have the library loaded before any concurrency arises.

## Change

**[startup read]** In `create_app()` (`src/aggregate_api/app.py`), immediately
after the existing `get_underwriter.cache_clear()`, call `get_underwriter()`.

- `__main__.py` runs uvicorn with `factory=True`, so the factory runs in the
  worker before it serves anything, including under `--reload`. By the time any
  request can arrive, `build` (or the custom `AGGAPI_LIBRARY` underwriter) is
  fully read and every later `load()` is the idempotent no-op it is meant to be.
- Cost: about three seconds added to server startup, the same three seconds
  removed from the first request. The `/v1/status` "library load" figure becomes
  the real read time, recorded at startup.
- Tests build an app per test. For the default library the singleton stays
  loaded across tests, so this costs nothing after the first. A custom-library
  test pays one small read per app, as it already does on its first request.
- The bad-path warning (`AGGAPI_LIBRARY` names a missing file) now fires inside
  `create_app()` rather than on the first request. Check that the tests which
  expect it (`tests/test_library.py`, the `pytest.warns(UserWarning, ...)` case)
  still wrap the call that now emits it.

No lock in `get_underwriter()`. With the read done before serving there is
nothing left to race, and the library plan fixes the race where it lives.

**[docstrings]** Correct `get_underwriter`'s Notes: the read happens on its
first call, which is now `create_app()`, not at import. Update the Notes of the
status helper in `routes/status.py` (the "reporting on the library must not
cause the library to be read" passage): in a served process the library is
always loaded by the time the page can be requested, so "not loaded" is now a
state only a test can reach. The guard stays; it is still correct and costs
nothing.

**[tests]**

- `tests/test_status.py::test_the_library_is_not_loaded_just_to_report_on_it`
  asserts the library is unloaded before the first build. That is no longer
  true and is no longer the point. Replace it with a test that a freshly created
  app reports `library_loaded` True and `library_recipes` > 0 before any build.
- New, in `tests/test_library.py`: after `create_app()`, `get_underwriter()` is
  already in the cache (`cache_info().currsize == 1`), and a session fork taken
  immediately holds every entry the base holds (`len(fork._recipes) ==
  len(base._recipes)`), with `("agg", "Capstone.Gross")` present as the named
  witness.

## Files

- `src/aggregate_api/app.py`
- `src/aggregate_api/library.py` (docstring)
- `src/aggregate_api/routes/status.py` (docstring)
- `tests/test_status.py`, `tests/test_library.py`
- `CHANGELOG.md`, `src/aggregate_api/__init__.py` (patch bump)

## Acceptance

- Both suites green (`uv run --no-sync pytest`, `cd web; npm test`).
- Manual, the case that found it: restart the great-servers instance, open
  `/?example=Capstone.ExposureRating` in a fresh tab straight away, and it
  builds. Then pick another entry from the back half of `library.agg` that
  references a sibling by name, and it builds too.
- `GET /v1/status` on a just-started server reports the library loaded.

## Not in scope

- The library fix (lock in `load()`, `fork()` refusing a half-read base): the
  companion plan.
- A server already running with a poisoned session recovers when that session's
  fork expires or the server restarts on this build.

## Execution log (2026-10-14, landed as 1.13.4)

One phase, one bump. Both gates green at the bump: `uv run --no-sync pytest`
(525 passed) and `cd web; npm test` (310 passed). The env had the worktree
`aggregate` 1.5.0 installed editable.

- [startup read], [docstrings], [tests] landed as written. The bad-path warning
  test calls `get_underwriter()` directly, not `create_app()`, so it needed no
  change.
- Divergence: the new test in `tests/test_library.py` builds its own app with
  `AGGAPI_LIBRARY` and `AGGAPI_EXAMPLES_FILE` removed, rather than using the
  shared `client` fixture, so the witness `Capstone.Gross` cannot be hidden by a
  custom library set in the environment. Its regression teeth are the
  `cache_info().currsize == 1` assertion; the fork comparison cannot fail in a
  single-threaded test and is there as the named witness the plan asked for.
- Divergence: no `dev/TODO.md` entry existed, so one was added under Landed.
- Divergence: `T:/worktrees/dev-files.md` does not exist (nor
  `V:/worktrees/dev-files.md`), so no control-list row was updated.
- Not run: the manual acceptance check (restart the great-servers instance and
  open `/?example=Capstone.ExposureRating` at once). That is the author's.
