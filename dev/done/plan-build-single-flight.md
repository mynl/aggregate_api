# Plan: identical builds arriving together build once

**Status: DONE, landed as 1.26.1 on 2026-10-18.** Drafted 2026-10-18; executed the same day on the author's `/execute-plan`. See the execution log at the end. Tracked as `[Build-Single-Flight]` in `dev/TODO.md`. It lands ahead of `[Sheets-Template]` (`dev/plan-sheets-template.md`), which depends on it; the author ruled that order on 2026-10-18.

## Goal

When several `POST /v1/objects` requests for the same program arrive while that program is not yet in the cache, the server builds it once. The first request builds; the others wait for the build slot as they do today, then find the object in the cache and are answered as cache hits.

## Why now

The Google Sheets client (`[Sheets-Template]`) runs every cell as its own Apps Script execution on Google's servers, with no memory shared between cells. A sheet where twenty cells pass the same new program therefore sends twenty simultaneous POSTs. The Excel add-in never showed the problem, because its `inflight` map in `excel/src/functions/functions.ts` shares one promise among cells and sends one POST; the SPA rarely sends duplicates. Sheets cannot do that on the client, and it limits each cell to 30 seconds, so the dedup has to happen on the server.

## Current behavior

In `create_object` (`src/aggregate_api/routes/objects.py`, around line 1612):

1. The id is computed from the parsed program and `cache.get(oid)` is checked. A hit returns the slim response at once (`cached: true`).
2. On a miss the request enters `status_state.build_slot(_build_semaphore)`, which admits one build at a time (the semaphore is `threading.Semaphore(1)`, line 202), and submits `_run_build` to the one-worker executor with the `build_timeout_s` wall clock (default 10 s).
3. After the `with` block exits, the object is classified (`_classify_object`), wrapped in a `CacheEntry`, and stored with `cache.put(oid, entry)`.

Two defects follow:

- **A waiter never looks at the cache again.** Request B, which missed at step 1 while request A was building the same program, waits in step 2 and then builds the program a second time. Twenty such requests run twenty serial builds, and the last waits about twenty build times, far past the 30-second limit Sheets puts on each cell.
- **The store happens after the slot is released.** A re-check inside the slot alone would race: B can acquire the slot in the moment between A leaving it and A's `cache.put`, miss, and build again.

There is one counter wrinkle as well: `build_slot.__enter__` (`src/aggregate_api/status.py`, line 245) increments `builds_started` when the slot is acquired, so a waiter that is then served from the cache would still count as a build on `GET /v1/status`.

## The change

1. **Extract the hit response.** Lines 1613 to 1638 (the `_register(uw, preview)` call, the `ok` audit row, and the slim dict with `cached: True`) become one helper, `_hit_response(...)`, called from both places below. The audit row and the response stay byte-for-byte what a hit returns today.
2. **Re-check inside the slot.** The first statement inside `with status_state.build_slot(_build_semaphore):` is `cache.get(oid)`. On a hit it counts a coalesced build and returns `_hit_response(...)`. Leaving the `with` by `return` releases the slot as usual.
3. **Store while holding the slot.** Everything from `kind = _classify_object(obj)` through `cache.put(oid, entry)` moves inside the `with` block. This is an indentation move. The value branch (`kind == "value"`) and the unsupported-kind refusal move with it and still return or raise as they do now. The success audit row and the response dict may stay outside. With this, once the first build succeeds, every waiter's re-check sees the object.
4. **Count builds that actually ran.** Take the `builds_started += 1` out of `build_slot.__enter__` and add `status.record_build_started()`, called just before each `_build_executor.submit`: in `create_object`, and in the sharpen route (around line 3567), which uses the same slot. Add a `builds_coalesced` counter with `status.record_build_coalesced()`. Report it in `build_state()` as `coalesced`, and show it on the status page (`src/aggregate_api/status_page.html`, line 394) as "coalesced since boot", beside "started since boot". Update the `build_slot` docstring: entering counts a waiter and acquiring makes it in flight; whether a build then starts is counted at the submit.

## Out of scope, noted

- **A program that fails or times out is not coalesced.** If A's build fails, B re-checks, misses, and builds it itself; it will usually fail the same way. For a timeout that means N waiters each spend `build_timeout_s` in turn, and since a timed-out build keeps running in the one-worker executor, later submits queue behind it. This is pathological but no worse than today. If it bites, the remedy is a short negative cache of timeouts keyed by `oid`. Not now.
- The sharpen route gets the counter move only. It builds no new id, so it has nothing to coalesce.

## Files

- `src/aggregate_api/routes/objects.py`: `_hit_response`, the re-check, the store moved under the slot, `record_build_started` at both submits
- `src/aggregate_api/status.py`: the counter move, `builds_coalesced`, `record_build_started`, `record_build_coalesced`, `build_state()`
- `src/aggregate_api/status_page.html`: the "coalesced since boot" row
- `tests/test_build_single_flight.py`: new
- `CHANGELOG.md`, `src/aggregate_api/__init__.py`, `dev/TODO.md`

## Test

`tests/test_build_single_flight.py`, using the `client` fixture from `tests/conftest.py` (which already points the audit at `tmp_path`):

1. Monkeypatch `objects_routes._run_build` with a wrapper that counts its calls and, on the first call, blocks on a `threading.Event` before calling the real function.
2. Thread A posts a small new program (`agg Dice dfreq [3] dsev [1:6]`). Poll `status.build_state()` until `in_flight == 1`, with a timeout of a few seconds.
3. Thread B posts the same program. Poll until `waiting == 1`. This poll is what keeps the test from passing vacuously: if the harness ran the requests one after the other, B would be an ordinary hit at the first check and the poll would time out and fail.
4. Set the event and join both threads, again with a timeout.
5. Assert: the wrapper was called once; A answered `cached: false` and B `cached: true` under the same id; `build_state()` shows `started` up by 1 and `coalesced` up by 1.

`tests/test_entry_lock.py` notes that `TestClient` drives the app through one portal thread. Sync handlers still run in anyio's worker threads, so two concurrent requests should proceed. If they do not, the step 3 poll fails loudly; in that case use two `TestClient` instances over the same app object.

## Acceptance

- The new test passes, and `uv run --no-sync pytest` is green.
- On a running server (optional, the author's): fire ten concurrent POSTs of one program not yet in the cache, with `dev/scripts/loadtest/blitz.ps1` or a short loop. `GET /v1/status` then shows `started` up by 1 and `coalesced` up by 9.

## Version

A patch bump, since this is a fix. The CHANGELOG entry goes under Fixed and reads roughly: identical builds arriving together now build once, and the rest are answered from the cache; `/v1/status` reports them as `coalesced`.

## Execution log

Executed 2026-10-18 as **1.26.1**, one bump. Every line number, symbol and snippet the plan names matched the code at 1.26.0. Gates: `uv run --no-sync pytest` 624 passed; `cd web; npm test` 321 passed. `web/` did not move, so the SPA was not rebuilt (the status page is `src/aggregate_api/status_page.html`, served by the backend).

Divergences:

- **[cache-accounting] `ObjectCache.get` gains `counted=False`, used by the re-check.** Not in the plan's file list. The re-check is a second `cache.get`, and `ObjectCache.get` moves `hits` and `misses`, so every build read as two misses on the status page's cache panel; `tests/test_status.py::test_a_build_moves_the_counters` caught it (`misses` 2, expected 1). The rule now: one counted lookup per request, on arrival. A coalesced waiter therefore counts as a cache miss (true of what the cache could answer when it arrived) and as `coalesced` on the build panel. The concurrent test pins it: `(misses, hits, puts) == (2, 0, 1)`.
- **[hit-fields] The audit fields travel to `_hit_response` as one `hit_fields` dict**, built once after the key is known, so the two call sites cannot pass different values.
- **[extra-test] A second test**, `test_a_plain_hit_counts_as_neither_started_nor_coalesced`, guards the counter move: before 1.26.1 entering the slot counted a start, and a plain hit never enters the slot, so this pins that `coalesced` means waiters only.
- **[mutation-check] Non-vacuity checked by hand:** with the re-check replaced by `cached_entry = None`, the concurrent test fails on `len(calls) == 1` (built twice). Restored before the gates ran.
- **[plan-wording] The value branch** is `isinstance(obj, numbers.Real)`, not `kind == "value"` as the plan put it. It moved inside the slot unchanged; a number is never cached, so a value program is never coalesced, which is harmless since it costs nothing to build.
- **[dash-glosses] Legacy ` -- ` glosses:** the four in `cache.py` cleaned, since the file was edited; in `routes/objects.py` only those in the touched hunks ("Cache hit --", "Cache miss --"), leaving 72 for later rather than burying this diff.
- **[control-list] No `dev-files.md` row to update:** `V:/worktrees/dev-files.md` no longer exists. The project `execute-plan` skill still names it.
