# plan-demo-load: survive fifty people on 2026-10-16

Status: draft, awaiting review
Target versions: a179 onward (current is a178)
Owner: author
Occasion: a live demonstration to roughly fifty people on 2026-10-16

## Why this plan exists

On 2026-10-16 the app is demonstrated to about fifty people who will drive it
themselves, from a mix of one corporate WiFi network and their own phones. The
author will lead, so almost everyone runs the **same library example at the same
moment** and very little free-form DecL gets typed.

That audience profile is unusually cache friendly and the box should be bored.
It is not bored today. Three mechanisms turn synchronized demand into the worst
case rather than the best, and two of the three fire on page load, before anyone
has clicked anything.

Nothing here is a capacity problem. No part of this plan makes the server
faster or adds a worker. Every item removes duplicated work or corrects a
budget.

## Measured on 2026-10-07, at a200

Everything below was reproduced locally with
`dev/scripts/loadtest/blitz.ps1`, against one api process and no Caddy. These
are observations, not predictions.

**The headline: more than 40 concurrent requests on one cached object kills the
server process permanently.** Not slowly, not partially. Every synchronous
route stops answering, `/v1/health` included, the process sits at 0% CPU, and
nothing short of a restart recovers it.

Concurrent `GET /objects/{oid}/density_df` on a single `PropertyCasualty`
object, each round from a fresh server:

| callers | succeeded | wall  | server afterwards |
|---|---|---|---|
| 20 | 20 of 20 | 24.7 s | alive |
| 30 | 23 of 30 | 30 s   | alive |
| 39 | 25 of 39 | 30 s   | alive |
| 45 | 3 of 45  | 30 s   | **dead** |

The cliff sits at 40, which is exactly anyio's default thread-limiter token
count. Reproduced identically on **Python 3.13**, which is what the VPS runs, so
this is not an artifact of the local 3.14 environment.

Two further numbers from the same runs:

- **Reads of one object are strictly serial.** Twenty concurrent `density_df`
  reads took 24.7 s, about 1.2 s each in sequence. Even with the deadlock fixed,
  fifty people on one shared object is a minute of queue.
- **The build stampede is real and milder than expected.** Fifty simultaneous
  landing builds produced **17** builds of the same program rather than one. The
  window is as wide as one build takes, so BasicBook at about 175 ms caught 17 of
  50 arrivals. A 2 s example would catch nearly all of them, and
  `distinct ids: 1` with `key_scope: shared 51, session 0` confirms the room does
  share one cache entry.

A theory worth recording as **wrong**, because it looks right and wasted an
hour: this is not caused by client disconnects. Aborting a read mid-flight with
a TCP reset, inside a 1.4 s critical section, releases the lock correctly every
time. The deadlock needs no disconnect at all, only concurrency above 40.

## The mechanism, traced

Read this first. Every finding below is a consequence of it.

1. `web/src/main.js:3936`, `loadLanding()`, calls `build()` on **every page
   load**, with no user action. It builds `BasicBook` (the author's ruling of
   2026-09-06, replacing the earlier random-hero landing). So a page load is a
   `POST /v1/objects`.
2. `routes/objects.py:1321` looks the program up in the object cache and, on a
   miss, falls through to `objects.py:1353`, which takes a **one-slot
   semaphore** (`objects.py:185`) and submits to a **one-worker thread pool**
   (`objects.py:190`). Builds are strictly serialized.
3. There is **no in-flight deduplication** anywhere in the request path. Every
   cache in the app is check, compute, store. Fifty callers who arrive before
   the first one finishes all miss, all queue, and all compute the same answer.
4. `objects.py:1356` gives each build `build_timeout_s` (default 10 s) via
   `future.result(timeout=...)`. That abandons the **waiter**, not the work: the
   worker thread keeps computing, and `status.build_slot.__exit__`
   (`status.py:308`) releases the semaphore, so the next queued build submits
   behind a thread that is still busy and is likely to time out too. One slow
   build poisons the requests behind it.
5. On the public route, Caddy rate limits `POST /v1/objects` at 5 per minute and
   100 per hour, keyed `{remote_host}`. Caddy sits **in front of** the object
   cache and cannot tell a hit from a miss, so a warm cache buys nothing at the
   limiter.

Put 1 and 5 together: fifty people opening the page from one shared egress IP
means forty five of them get a 429 on the landing build, and the room's hourly
budget is gone inside the first minute.

Put 1, 2, 3 and 4 together: on a cold cache those same fifty page loads build
`BasicBook` fifty times, serially, and everyone past the ten second mark gets a
504 where the landing object should be.

## What is NOT a problem (checked, so nobody re-opens it)

- **`cache_max = 50` is fine** (`config.py:77`). A library example run verbatim
  resolves only library entries, so `_cache_key` (`objects.py:578`) returns the
  **shared** id with no session in the hash, and the whole room shares one entry
  per example. Six examples is six entries, not three hundred.
- **Exhibits and charts are already cached.** `_exhibit_cache` and
  `_chart_cache` (`objects.py:355,364`) are keyed
  `(oid, name, perspective)` and serve ETag revalidation. On shared objects that
  absorbs most of the tab-click fan-out. Only the sizing of the chart one is
  wrong, and it is item 3 below.
- **Hero sparklines are not on any path a visitor takes.** The gallery left the
  UI at a36/a37 (`web/index.html:174`) and the random hero build at a93.
  `load_hero_sparklines` (`examples.py:592`) builds every hero, one at
  `hints{log2=16}`, under an `@lru_cache(maxsize=1)` with no dogpile
  protection, so it would be the worst offender in the codebase **if anything
  called it**. Nothing does, in either the full app or the phone lite path. It
  is reachable only by hand or through `/docs` on the VPN. See item 5.
- **`session_max = 500`** is comfortable for fifty tabs.

## The changes

Six items. **Item 0 is the one that decides whether the demonstration happens
at all**, and it is unrelated to everything that was in this plan before
2026-10-07. Items 1 and 2 are mandatory and independent of each other: item 1
without item 2 still 429s the room, and item 2 without item 1 still builds the
same object fifty times. Items 3 to 5 are worth having and can be dropped
without endangering the demo.

### [Entry-Lock] item 0, the deadlock that kills the process

**Problem.** `_locked_entry` (`routes/objects.py:654`) is a synchronous
generator dependency that acquires a `CacheEntry`'s lock with an unbounded
`with entry.lock:` and holds it for the whole request. FastAPI runs a sync
dependency in an anyio worker thread, which consumes one of the thread
limiter's 40 tokens, and then runs the sync handler in a **second**
`run_in_threadpool` call, which needs another token.

So a request that holds the lock must obtain a second token to reach its
handler and finish. Once 40 requests are blocked inside the dependency waiting
for that same lock, all 40 tokens are held by threads that will never make
progress, the lock holder can never get a token to run its handler, and it
therefore never releases the lock. Nothing breaks the cycle. The process parks
at 0% CPU with every synchronous route unreachable.

**Why the demonstration meets this immediately.** The shared cache key means
the whole room reads **one** `CacheEntry`, so the room's requests all queue on
one lock. Fifty people at three or four requests per page view is 150 or more
concurrent requests on that entry, against a cliff at 40. The room will cross
it in the first minute, and the only remedy on the day is a restart that puts
everyone back on the cold path, which crosses it again.

The irony to keep in view: the shared key is what makes builds cheap, and it is
also what concentrates every read onto a single lock.

**Change, in three parts. The first is the safety net and must land first.**

1. **Never block indefinitely while holding a token.** Replace the bare `with`
   with a bounded acquire and an explicit release:

   ```python
   if not entry.lock.acquire(timeout=settings.entry_lock_timeout_s):
       raise HTTPException(status_code=503, detail="object busy, retry")
   try:
       yield entry
   finally:
       entry.lock.release()
   ```

   This does not fix the serialization and under a fifty-person room it will
   hand out 503s. It converts a dead process into slow requests, which is the
   difference between a recoverable moment and an ended demonstration. New
   setting `AGGAPI_ENTRY_LOCK_TIMEOUT_S`, defaulting to something close to the
   build timeout.

2. **Stop holding the lock across the whole request.** The lock exists for one
   documented and measured reason, lazy frame materialization on first access,
   and it currently spans serialization, table rendering and response send as
   well. Narrow it to the materialization itself, so the per-request reduction
   work (which `density_df` does on every call, and which is most of that 1.2 s)
   happens outside the critical section.

3. **Materialize the frames at build time**, inside the build's own critical
   section, before the entry is published to the cache. The lock's docstring
   already says contention is confined to the first access of each frame and
   was never reproducible once the frames were warm. For a room sharing one
   object this is what turns the entry from a bottleneck into a read-only
   value, and it is what makes the pre-warm step in the runbook actually
   effective.

**Also, so the server can be diagnosed when something like this happens
again:** make `/v1/health`, `/v1/meta` and `/v1/status` `async def`. They do no
blocking work, and as sync routes they need a token, which is why an exhausted
pool makes the status page built for exactly this purpose unreachable. This
investigation needed `py-spy` on a core dump because nothing in the app could
answer.

**Rejected: raising the token count.** It moves the cliff without removing it.
Fifty people at four requests each is 200, and 200 threads of pandas work on one
GIL is a different disaster. The limiter is not the bug.

**Files.** `routes/objects.py` (`_locked_entry` and the routes that depend on
it), `cache.py` (`CacheEntry`), `config.py`, `routes/meta.py`,
`routes/status.py`, and a new test that holds the lock and asserts a 503 rather
than a hang.

**Acceptance.** `dev/scripts/loadtest/blitz.ps1` and the 45-caller
`density_df` round both leave `/v1/health` answering. That round is the
regression test; it is the only one that failed before.

### [Single-flight] item 1, one computation per key

**Problem.** Stated above: no in-flight deduplication, so synchronized identical
demand multiplies rather than collapses.

**Change.** A small `SingleFlight` helper, new module
`src/aggregate_api/single_flight.py`: the first caller for a key computes, later
callers for the same key wait on a `threading.Event` and then re-read the cache.

Sketch, to be filled in at execution:

```python
class SingleFlight:
    """Admit one computation per key, whatever the arrival rate."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._waiters: dict[Any, threading.Event] = {}

    def claim(self, key) -> tuple[bool, threading.Event]:
        """Return (is_leader, event). The leader must call `release`."""

    def release(self, key) -> None:
        """Drop the claim and wake every follower, however the leader exited."""
```

Applied at the build path in `routes/objects.py`, between the cache lookup at
`:1321` and the build slot at `:1353`:

- leader: proceed into the existing `build_slot` block unchanged, and
  `release` in a `finally` so a leader that raises does not hang its followers;
- follower: wait up to `build_timeout_s`, then loop back to `cache.get(oid)` and
  fall into the **existing hit path**.

**Three traps, all load bearing.**

1. **The follower must not hold the semaphore while it waits.** The wait goes
   strictly outside the `build_slot` context, or the followers deadlock against
   the leader they are waiting for.
2. **The follower re-enters the hit path rather than being handed the leader's
   response.** The hit path calls `_register(uw, preview)` (`objects.py:1325`,
   and see `_register`'s own docstring for why a hit has to register), and writes
   its own audit row. Short-circuiting that would leave a follower unable to
   refer to the object it was just served.
3. **A leader whose build times out must release, and its followers must then
   see the same 504 the leader got**, not hang and not silently retry into a
   second identical build. A follower whose wait expires with nothing in the
   cache returns 504 with the same detail. Semantics for the failing case are
   unchanged; only the succeeding case changes, from N serial builds to one.

**Keyed on the `oid` the cache already computed**, so a session-private build
dedups only inside its own session, which is the correct scope.

**Also apply to** `_exhibit_cache` and `_chart_cache` misses, for the same
reason and with the same shape. Fifty people clicking the same exhibit on the
same shared object is one computation after this and fifty before it.

**Files.** New `src/aggregate_api/single_flight.py`; `routes/objects.py` at the
build, exhibit and chart paths; new `tests/test_single_flight.py`.

**Instrumentation.** Count leaders and followers and expose them in the
`GET /v1/status` build block beside `build_waiting` and `build_timeouts`
(`status.py:321`). A demo where followers vastly outnumber leaders is this item
working, and that is the number to read on the day.

### [Limiter-Key] item 2, a rate limit that does not punish a shared network

**Problem.** The public Caddy route limits `POST /v1/objects` to 5 per minute
and 100 per hour keyed `{remote_host}`. One corporate network is one key, so the
room shares one person's allowance, and because the landing page builds on load
the budget is spent by people arriving rather than by people working.

**The Caddyfile is not in this repository.** It lives at `/etc/caddy/Caddyfile`
on the VPS. Read the live `agg.mynl.com` block before editing; the shape
described in `human-hints.md` under "Rate limiting" is the reference.

**Change.** Two zones instead of one, both matching only `POST /v1/objects`:

- a **per-session** zone keyed `{http.request.header.X-Aggregate-Session}`,
  which the SPA sends on every request (`web/src/session.js:26`). Each browser
  tab then gets its own allowance, which is the semantics actually wanted.
  Roughly 30 per minute: no hand builds thirty programs a minute, and a tab that
  does is misbehaving.
- a **per-host** zone keyed `{remote_host}`, kept as the abuse backstop and
  widened to fit a whole room rather than one person. Roughly 300 per minute and
  3000 per hour. Fifty tabs times a few builds a minute at peak is around 150
  per minute, so 300 leaves headroom for refreshes.

Both zones are enforced, so a hostile client that mints fresh session ids to
evade the first still meets the second.

**Two things to know before choosing the numbers.**

- **A missing header collapses to one bucket.** Caddy resolves the absent
  placeholder to the empty string, so every headerless client (curl, the test
  suite, bots) shares a single session bucket. That is the desirable direction,
  but it means a bot sweep and your own `curl` compete. The per-host zone is
  what actually governs those.
- **The session id is a namespace, not a credential** (`human-hints.md`,
  "Sessions"). Keying a limit on it is therefore weaker than keying on an
  address, which is exactly why the per-host zone stays. The real compute guard
  is the semaphore and the cache, not the limiter; the limiter's job here is to
  keep the open internet from finding the box, and it still does that.

**Mark the change as dated in the Caddyfile** with a comment naming
2026-10-16, and revert the widened numbers after the demo.

**Verify** with the recipe in `human-hints.md`: a tight loop of
`POST /v1/objects` carrying **one** session header should 429 at about thirty in
a minute; the same loop with a **fresh** header per request should keep going
until the per-host zone bites; and a loop on `/v1/health` should stay all 200.
Testing only the first of those is how this ships broken.

### [Chart-Cache] item 3, size the chart cache for a room

**Problem.** `_CHART_CACHE_MAX = 8` (`objects.py:352`), sized by its own comment
for one reader returning to a leaf. Each chart plus parameter combination is an
entry, so a room wandering across charts on two or three shared objects thrashes
it, and every miss is a full surface reduction.

**Change.** Make it a setting, `AGGAPI_CHART_CACHE_MAX`, defaulting to the
current 8, and set 64 on the VPS. A setting rather than a raised constant for
the reason the existing comment already gives about `max_chart_detail`: the
public deploy caps detail at 256 cells per axis, where an entry is a few hundred
kilobytes and 64 of them is tens of megabytes, while a local run at the default
1024 can make an entry a few megabytes and would not want 64 of them.

**Files.** `config.py`, `routes/objects.py:352`, `routes/status.py` (the
`exhibit_cache` and chart cache blocks report the max), `tests/`.

Leave `_EXHIBIT_CACHE_MAX = 64` alone; an exhibit envelope is kilobytes and 64
already covers a reader's working set on a shared object.

### [Heavy-Guard] item 4, the uncached compute family

**Problem.** `/objects/{oid}/bounds/envelope`, `/bounds/allocation`,
`/bounds/pricing`, `/pricing/allocate`, `/pnl` and `/sharpen` have no cache, no
timeout, no semaphore and no rate limit. They are sync `def` routes, so they run
in Starlette's anyio threadpool (40 slots by default) in one process on one GIL.
Recent work has been in Pricing and P&L, so the demo probably visits them.

**Change.** Give them what the exhibit route already has: a `RevalidationCache`
keyed on the object id plus the request's own parameters, wrapped in the item 1
single-flight. Caching is the bigger win by far and should land first; on shared
objects with a led room, most of these become one computation.

Do **not** put them behind the one-slot build semaphore. Serializing the whole
room's tab clicks would make the app feel worse than the thing this fixes. If a
concurrency guard is wanted after caching, it should be a separate, wider
semaphore with its own timeout, sized around four, and that is a later decision
informed by the measurements in the next section.

**Measure before tuning the thread pool.** Lowering anyio's default limiter from
40 could reduce GIL thrash and make latency more predictable, but it is a guess
until the load test says otherwise. Record it, do not change it blind.

This item is the one to drop if time runs short.

### [Hero-Endpoint] item 5, the dormant stampede

**Problem.** `load_hero_sparklines` (`examples.py:592`) builds every hero under
an `@lru_cache(maxsize=1)` with no dogpile protection. Nothing calls it, so it
is harmless today, and the comment at `main.js:3934` says the gallery is meant
to return inside the Examples dropdown, which is what would call it.

**Change.** Leave the endpoint in place and put a comment on it recording that
it must be single-flighted (item 1) or precomputed before anything in the UI
calls it again. Precomputing is the better end state: the heroes change only
when `library.agg` changes, so 48 floats per card could be a committed fixture
and the route becomes a file read.

No behavior change, so this item does not bump the version on its own.

## Load test harness

The point of the harness is to reproduce the synchronized room, because that is
the shape the demo has and the shape every finding above depends on.

### [Harness] the tool

**k6** (Apache-2.0, free, single binary, `winget install k6`). The deciding
feature is the `constant-arrival-rate` executor: it holds the **arrival** rate
whatever the server does, where a closed-loop virtual-user tool stops generating
load exactly when the server starts queueing, which flatters the server in
precisely the place this test exists to be honest about.

Alternatives, recorded so they are not re-litigated. **Locust** (MIT) is the
Python option and its distributed mode is easy; it is closed-loop by default,
so read its concurrency numbers with more suspicion. **loader.io** cannot
extract a value from a response body, so it cannot build an object and then
request that object's exhibits, which is the entire chain under test; it also
egresses from a small set of addresses. **check-host.net** is not a load tester
at all and is still worth one run: it fires a single GET from roughly 30 to 50
nodes worldwide and reports status, timing and TLS, which answers "is
`agg.mynl.com` reachable, valid and quick from networks that are not mine" and
incidentally puts 50 distinct real source addresses on the app at once, so it is
a free check that the limiter keys per visitor rather than globally.

### [Harness] the scenario

`dev/scripts/loadtest/room.js`, one iteration being one person arriving:

1. `GET /` plus the bundle, or skip the assets and note they are Caddy's problem
   rather than the app's;
2. `GET /v1/meta` and `GET /v1/examples`, as the SPA does;
3. `POST /v1/objects` with the landing program, carrying a **unique**
   `X-Aggregate-Session` per virtual user, so the per-session limiter is
   exercised the way a real room exercises it;
4. `GET /objects/{oid}/summary`, one exhibit and one chart off the returned id.

Executor `constant-arrival-rate`, 50 iterations over 10 s, which is the
observed shape of a room told to open a URL. Thresholds: no 504s at all, no
5xx, and p95 on the landing POST under 2 s.

**Read the object id out of the POST response** and use it in step 4. A test
that skips that step tests nothing that is at risk.

### [Harness] the runs, in order

0. **Baseline, on the VPS over loopback**, no Caddy and no network: time one
   build of each program the demo will use, at the log2 and bs the SPA actually
   sends. With a one-slot queue that number times fifty is the worst case, and
   it decides whether anything else matters.
1. **Cold versus warm.** Restart, run the scenario, record. Then warm and run it
   again. Before item 1 this difference is the whole finding; after item 1 it
   should be small, and that is the acceptance check for item 1.
2. **Poisoned queue.** Deliberately include one slow build and confirm that the
   requests behind it still answer. This is finding 4 in the trace above and it
   is the one no amount of caching fixes.
3. **Fan-out.** Hold the shared objects, then hit summary, exhibit, chart,
   density, and if item 4 landed, pricing and bounds, concurrently across fifty
   sessions.
4. **Limiter**, on the public route, from at least two real addresses, with the
   three-way verification in item 2.

Runs 0 to 3 go against the **VPN route** (`:19456`, unlimited) so the limiter
does not mask the app's behavior. Only run 4 uses the public route. Watch
`GET /v1/status/page` throughout: `build_waiting`, `build_timeouts`, the cache
hit rates, the leader and follower counts from item 1, and RSS.

### [Harness] multiple source addresses, free

Needed only for run 4, since runs 0 to 3 deliberately avoid the limiter.

- **A GitHub Actions matrix** is the free generator: N parallel jobs, each on a
  runner with its own public egress address, each running the same k6 script.
  Gate the workflow to `workflow_dispatch` only, with the target URL and the
  rate as inputs, so it never fires on a push. A private repo's free monthly
  minutes cover a full rehearsal many times over.
- **Oracle Cloud Always Free** gives two permanently free micro VMs, so two
  stable addresses to script against.
- **A phone hotspot** on a second laptop is a third genuine address, and it
  doubles as the test of the `lite.html` phone path (a168 to a169), which the
  demo audience will actually be on.

**You cannot fake this at either layer, by design.** Caddy keys on the TCP peer,
and `net.py` reads the **last** `X-Forwarded-For` element precisely so a forged
header cannot win. Do not waste time trying.

### [Harness] files

- `dev/scripts/loadtest/room.js`, the k6 scenario
- `dev/scripts/loadtest/warm.ps1`, the pre-demo warm-up (see the runbook)
- `.github/workflows/loadtest.yml`, `workflow_dispatch` only

Fixtures and programs come from the library. Nothing in the harness touches
real data, and nothing it writes belongs in the repository.

## Demo-day runbook

To be pinned somewhere the author will actually read it on the day.

1. `git pull`, `uv sync --frozen --extra dev`, rebuild the SPA, restart the app.
   Confirm `/v1/meta` reports the expected version, since an editable install
   reports what was recorded at install time and not what `pyproject.toml` says
   (`CLAUDE.md`, "Re-sync after a version bump").
2. **Warm the cache**: walk the UI and Build every example the demo will use.
   Through the real SPA rather than by curl, so the `log2` and `bs` warmed are
   the ones the app sends and the shared `oid` actually matches. Open each
   exhibit and chart to be shown, which warms those caches too.
3. Confirm the widened limiter zones are live and dated.
4. `GET /v1/status/page` open on a second screen. Hit rates near one and
   followers outnumbering leaders is the demo working.
5. **Do not restart the app after step 2.** A restart empties every cache and
   every session fork, and puts the room back on the cold path.
6. After the demo, revert the limiter numbers.

## Acceptance

- **Forty five concurrent reads of one object leave `/v1/health` answering.**
  This is the gate. Nothing else on this list matters if it fails.
- Fifty landing loads inside ten seconds against a **cold** server produce
  **one** build of the landing program, no 504s, and p95 under 2 s.
- The same fifty from one source address against the public route produce no
  429s, and fifty from one address with a **single** shared session header do
  produce them.
- A slow build in the queue does not fail the requests behind it.
- `GET /v1/status` reports leader and follower counts, and the chart cache max.
- The suite is green, and the new tests cover the follower paths including the
  leader-times-out case.

## Out of scope

- **A landing page that needs no build.** The durable fix for finding 1 is for
  first paint not to POST at all, whether by shipping a precomputed landing
  object or by having the SPA treat the landing as content rather than as a
  build. That is a design conversation, not a fortnight's work, and item 1 plus
  a warm cache makes it unnecessary for 2026-10-16.
- **More than one uvicorn worker.** The session registry, the session forks and
  the object cache are all in-process, so a second worker shards them silently
  (`human-hints.md`, "Facts to remember"). The cache would have to move out
  first. Not before October.
- **Cancelling an abandoned build.** Making the timeout actually stop the work
  means the build becoming interruptible, which is upstream in `aggregate`.
  Item 1 reduces how often it matters; it does not fix it.
- **The Examples-dropdown gallery** that would revive the heroes endpoint.
