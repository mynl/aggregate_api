# Plan [Site-Status-Page]: an operator's view, private by construction

> **Status: EXECUTED, 2026-08-18. S0, S1 and S4 at API `1.0.0a112`, S2 and S3
> at `1.0.0a113`.** API repo only, no LIB half, no symlink. Line anchors are
> API `1.0.0a111`, the tree this was executed against. Execution notes sit in
> section 6 beside the phases they belong to.
>
> **Revised before execution, 2026-08-18, on one finding.** The draft assumed
> `dev/plan-session-isolation.md` in its **v1** shape, which keyed the cache on
> content identity and routed what it could not render to a fallback. That plan
> shipped as v2, and its section 2 records content addressing as dropped and
> parked in its section 9. Section 4.5 below was built entirely on the identity
> and fallback split, so it has been rewritten against what a110 actually
> landed: the shared against session qualified rule of
> `routes/objects.py::_cache_key`. The panel keeps its job, which is to say
> whether that rule is behaving, and it now closes the counting half of session
> isolation phase A3 that a110 left open.
>
> **Assumes `dev/plan-session-isolation.md` has landed**: the per process
> reference underwriter (`library.py::get_underwriter`), the per session fork
> registry (`sessions.py`), and the two key builders in `cache.py` with the rule
> that chooses between them. Sections 4.2 and 4.5 below read those directly.
>
> Filed as `plan-site-status-page.md`; the request said `statut`, read as a slip.
>
> **Author rulings, 2026-08-18**, closing four of the five questions section 8
> opened. (1) `psutil` goes in as an **optional extra**, section 4.6. (2) The
> zone header, layer three, is **off by default**, section 3.3. (3) The page
> **may show program text**, sections 4.3 and 4.5. (5) The HTML page is
> **`/v1/status/page`**, everything under the versioned prefix, section 5.1.
> Plus a standing constraint on retained state: **do not let it grow too large,
> and reset it on each reboot**, section 4.8.

## 1. The design in one paragraph

A read only operator's page at `/v1/status/page`, backed by a JSON contract at
`/v1/status`, showing what the process is doing: which versions are loaded, how
many session forks are live and what they have built, how the object cache is
performing, whether the shared against session key rule is behaving, what the
audit log says about recent builds, and what the process costs in memory and
CPU. It is
**private by construction and by three independent mechanisms**, because the one
thing this page must never do is leak to the public face. It is served as a
single self contained file with no build step, because a status page that
depends on the thing it monitors is not a status page.

## 2. The trap that shapes everything, stated first

**The app cannot tell a public visitor from a VPN one by peer address.** Per
`human-hints.md` section "Running on the Linux VPS", the topology is one backend
and two Caddy front doors:

```
public  ──HTTPS──▶ Caddy agg.mynl.com:443  ─┐
                   (rate-limited, no /docs)  ├─▶ app 127.0.0.1:8001
Windows ──VPN───▶ Caddy 10.8.0.1:19456     ─┘   (private backend)
```

Both blocks `reverse_proxy 127.0.0.1:8001`. So `request.client.host` is
`127.0.0.1` for **public internet traffic just as much as for VPN traffic**.

Two consequences, and the first is the dangerous one.

**A gate written as "allow if the peer is loopback" would publish this page to
the entire internet.** That is the obvious implementation, it would test green on
a laptop, it would test green over the VPN, and it would be wide open in
production. It is written here at the top so it cannot be arrived at
independently later.

**And a pre-existing bug falls out of the same fact.** `_client_ip`
(`routes/objects.py:258`) reads `request.client.host` and nothing else, with no
`X-Forwarded-For` handling. So every production row in the audit log records
`ip = '127.0.0.1'`, the `builds_ip` index (`audit.py:59`) indexes a constant, and
`AuditLog.by_ip` (`audit.py:176`) cannot answer the question it exists for. This
plan needs a correct client address helper anyway, so fixing that is a byproduct
rather than a detour. Phase S0.

## 3. Access control, deny by default, three layers

None of the three is trusted alone.

### 3.1 Layer one: Caddy 404s the route on the public block

**The primary mechanism, and it matches the precedent already in place.** The
public block already hides the API documentation this way: per `human-hints.md`,
`agg.mynl.com` carries a matcher that answers `/docs` and `/openapi.json` with
`respond @apidocs 404`. Add `/v1/status*` to that matcher.

**One prefix covers everything**, which is a direct benefit of ruling 5. With the
page at `/v1/status/page` rather than a top level `/status`, the public block
blocks a single path prefix and there is no second path to forget when a future
status route is added. A matcher with a gap in it is the likeliest way this layer
fails, so removing the opportunity is worth more than the tidiness.

This is the layer that requires no trust in application logic at all. The app is
never reached, so no app side mistake can expose the page.

### 3.2 Layer two: the app gate, `require_private`

Defense in depth, for the case where a Caddy block is edited, reloaded wrong, or
a future front door is added. A FastAPI dependency, modeled on the established
`Depends` pattern at `routes/objects.py:178`. **Deny by default**: a request is
refused unless it positively demonstrates a private origin.

```
if 'X-Forwarded-For' not in headers:
    # Reached the app directly, no proxy: the peer IS the client.
    allow if peer in private_cidrs
else:
    # Exactly one trusted proxy (Caddy). Caddy APPENDS, so the LAST
    # element is the address Caddy itself observed. Never the first.
    allow if xff.split(',')[-1].strip() in private_cidrs
```

**The "last element, never the first" rule is the entire security of this
layer**, and it is the classic way to get `X-Forwarded-For` wrong. Caddy appends
the observed client to whatever arrived, so a public visitor who sends
`X-Forwarded-For: 10.8.0.2` produces `10.8.0.2, <their real address>`. Reading
the first element hands them the page. There is a test for exactly this in
section 6.

`private_cidrs` is a new setting, `AGGAPI_PRIVATE_CIDRS`, defaulting to
`127.0.0.0/8, ::1, 10.8.0.0/24`. The VPN subnet is a deployment fact, so it is
configurable rather than hardcoded, and it is documented in `human-hints.md`
beside the Caddy block that makes it true.

**The single hop assumption is load bearing and must be documented at the
function.** Reading `[-1]` is correct for exactly one trusted proxy. If a second
ever sits in front, the index is wrong and the gate opens. Note it in the
docstring and in `human-hints.md`.

Refusal is **404, not 403**, so the page's existence is not advertised. Log the
refusal at WARNING with the observed address, because a refusal on a correctly
configured box means something changed.

### 3.3 Layer three: an explicit zone header, off by default (ruled)

Belt and braces for anyone who wants it. The VPN Caddy block sets
`header_up X-Aggapi-Zone private`; the public block **deletes** any inbound one,
`header_up -X-Aggapi-Zone`, so it cannot be forged from outside. With
`AGGAPI_STATUS_REQUIRE_ZONE_HEADER=true` the app additionally demands it.

**Off by default, author ruling 2026-08-18.** Layer two is sufficient, and this
one couples the app to a Caddy edit in a way that fails closed but confusingly
(the page simply stops working after a Caddyfile change). It ships built and
documented because it is the only layer that survives a mistake in the CIDR list,
so turning it on is a setting rather than a change. S3 therefore leaves the VPN
Caddy block untouched.

### 3.4 Standing rules for the page

- `Cache-Control: no-store` on both the page and the JSON.
- Never linked from the SPA, never in the sitemap, absent from the OpenAPI
  schema on the public face (`include_in_schema=False`).
- **Read only, always.** No endpoint under `/v1/status` may build, evict, clear, or
  mutate anything. If a "clear the cache" button is ever wanted it is a separate
  plan with its own gate, and it is not this one.

## 4. What the page shows

Grouped as the page is laid out. Everything is cheap to compute; section 5.3
covers the two things that are not.

### 4.1 Identity and configuration

`aggregate_api`, `aggregate` and `greater-tables` versions (the `/v1/meta` set at
`routes/meta.py:141`, reused rather than recomputed), Python version, process
PID, bind host and port, start time, uptime, and the resolved library path with
its recipe count and its boot load time.

Then the live `Settings` snapshot: `log2_cap`, `log2_default`, `build_timeout_s`,
`cache_max`, CORS origins, audit DB path, and the new session and status knobs.

**Version skew is the point of this block.** The standing trap in both repos'
CLAUDE.md is that `importlib.metadata` reports what was recorded at editable
install time, so a LIB bump without `uv sync --extra dev` leaves the server
reporting stale versions. A status page that shows both versions beside the
process start time makes that visible at a glance instead of after an hour.

### 4.2 Sessions (requires plan-session-isolation)

From the fork registry. Aggregate first: forks live now, high water mark since
start, total created since start, evictions split by cause (TTL against
capacity), and the configured capacity and TTL.

Then a row per live fork: created, last seen, age, request count, **recipes
registered beyond the library baseline** (`len(fork._recipes)` minus the
reference underwriter's count, which is the honest measure of what this session
has declared), and how many cache entries this session caused to be built.

**Session ids are truncated before the payload is built, deliberately.** The session isolation
plan rules that a session id is a namespace and not a security boundary, so
anyone holding one gets that session's objects. A status page that renders full
ids would turn a private page into a credential list the moment anyone shoulder
surfs or shares a screenshot, and a payload carrying them in full would do the
same for anyone who saved the JSON. So the cut happens server side rather than in
the page, which is what section 7 asks for and is the stronger of the two
readings the draft carried. Show the timestamp portion in full (it is the useful
part for an operator) and eight characters of the uuid, which is enough to
correlate with a log line and not enough to impersonate.

**`fork._recipes` is a private reach, taken deliberately, author ruling
2026-08-18.** The oversight charter treats a new private name in the api as a
finding whose sanctioned answer is an upstream ask. The public route is
`Underwriter.recipes`, which builds a pandas frame per call, and this page would
call it once per live fork on every refresh: hundreds of frames every ten
seconds to report hundreds of integers. So the reach stands and is recorded in
the charter's tolerated list beside `parser._PARSER` and `GridDistribution`. It
is narrow in the way that matters, being the length of a dict rather than an
opinion about what is in it, and the failure mode if the attribute is ever
renamed is one field reading "unavailable" rather than a broken route: the read
is guarded.

### 4.3 The object cache

Entries against `cache_max`, hits, misses, hit rate, evictions, and total builds
since start. None of these counters exist today: `ObjectCache`
(`cache.py:153`) has `get` / `put` / `delete` / `list` / `clear` /
`__contains__` / `__len__` and no instrumentation at all. Phase S0 adds them.

Then a row per entry in **LRU order**, so what is about to be evicted is visible:
object id, kind, name, `log2`, `bs`, created, age, note count, an estimated
size, and **the program itself** (ruling 3). Sorting by LRU rather than by age is
the deliberate choice; it answers "what will I lose next", which is the question
a 50 slot cache under conference load actually raises.

Program text is truncated per section 4.8 and expandable in the page, so one
pasted portfolio does not push everything else off the screen.

The chart document cache (`_chart_cache` / `_CHART_CACHE_MAX`,
`routes/objects.py`) gets the same treatment in miniature: entries, max, hits,
misses.

### 4.4 Builds

From the audit log, which already records everything needed (`audit.py:45`:
`ts`, `ip`, `object_id`, `kind`, `decl`, `log2`, `bs`, `status`, `error_msg`,
`elapsed_ms`): counts over the last hour and day, the success and failure split,
p50 and p95 `elapsed_ms`, the slowest few recent builds, and the most common
`error_msg` values.

Live build state from the module globals: builds in flight, waiters on
`_build_semaphore` (single slot, `routes/objects.py:171`), and the count of
timeouts hit against `build_timeout_s`.

**Once `_client_ip` is fixed** (section 2), the by-address breakdown becomes
meaningful for the first time and is worth a small table: distinct clients in the
last day, and the busiest few. Before the fix it would be one row reading
`127.0.0.1`, which is why the fix is phase S0 rather than optional.

### 4.5 Key scope health (requires plan-session-isolation)

**The strongest single argument for building this page.** The rule that landed
at a110 decides, per request, whether a program means the same thing to
everybody. `_cache_key` (`routes/objects.py:488`) takes the shared text key when
the preview resolved nothing, or resolved only entries read from a library file,
and the session qualified key otherwise. Phase A3 of the session isolation plan
asked for exactly this to be counted, in these words: "Count shared against
qualified keys ... a qualified rate near 100 percent in a demo would mean the
rule is misfiring." What a110 landed was the audit column, `key_scope`, and
neither the counters nor any way to read them. This panel is where that becomes
visible, and it closes A3's open half: a rule nobody can observe is a rule that
quietly stops working.

So: requests keyed shared against requests keyed session, as counts and a rate,
split by the **reason** the qualified key was taken. There are exactly two and
they mean opposite things.

- **`session_reference`**, the intended one. The preview resolved a name this
  session declared, including a library name it overwrote, so the program is
  private because the rule worked. A room on the hero examples should be near
  zero; a room where everyone declares their own inners should be near one.
  Neither is a fault, which is why the number is shown beside the session count
  rather than alone.
- **`preview_unavailable`**, the one to watch. `_preview` returned `None`, the
  deliberate fail-closed path for a program the previewer will not speak about.
  Most of those are programs that fail the build a moment later and they are
  noise. The finding is the narrow case: a program that previewed `None` and
  then **built successfully**. There the previewer refused what the builder
  accepted, so a shareable object took a private slot and a room pays a build
  each. That is an upstream ask against LIB's `Underwriter.preview`, and it is
  the only thing on this page worth a paragraph in a round note.

Which is why this panel holds the recent offenders **in full, verbatim**
(ruling 3), and holds only that narrow class, previewed `None` and built anyway.
An ask needs the program that failed and a paraphrase of it is worth nothing.
This is the one place the page holds text rather than counting things, so it is
the one place with a retention rule, section 4.8.

Also worth showing here: mean and p95 time spent in `preview`, since that parse
now sits on the cache **hit** path where it did not before, which `post_object`'s
own docstring names as the acknowledged cost of keying on meaning rather than on
text.

**What this panel is not.** The draft of this plan asked for a fallback rate
against an identity function, a histogram of unparser failures, and an ask
against LIB's `[Unparser-Reference-Gaps]`. That was written against session
isolation **v1**, which keyed on content identity. v2 dropped content addressing
and parked it, so there is no unparser on this path and no identity to time. The
numbers above are the ones the shipped rule actually produces.

### 4.6 Process resources

RSS and VMS, CPU percent, thread count, open file descriptors, system load
average, and free disk on the volume holding the audit DB.

**`psutil` goes in as an optional extra, author ruling 2026-08-18.**
`[project.optional-dependencies] status = ["psutil>=5.9"]`, so the lean runtime
list is untouched (today: `aggregate`, `greater-tables`, `fastapi`,
`uvicorn[standard]`, `pydantic`, `pydantic-settings`) and a deployment opts in.

**It is already installed here, and that is the reason to declare it anyway.**
`psutil` arrives transitively through `ipython`, which `aggregate` pulls, so the
import succeeds today on any box with the dev environment and would succeed by
accident rather than by intent. A transitive that disappears when an unrelated
package drops a dependency is exactly what an explicit extra is for. The
practical consequence is for the tests: the stdlib fallback will never be
reached by accident, so section 7 forces its absence rather than waiting for a
machine without it.

The import is guarded and there is a **stdlib fallback**, which covers the VPS
(Linux) nearly fully and the Windows dev box partially: `os.getloadavg`,
`resource.getrusage`, `/proc/self/statm` and `/proc/meminfo`,
`shutil.disk_usage`, `threading.active_count`. Fields that cannot be filled
render as "unavailable" **with the reason**, never as zero, because a resource
panel that silently reports zero RSS is worse than one that reports nothing.

The page states which source it used, `psutil` or stdlib, so a number that looks
wrong can be traced without reading the code. The VPS install line becomes
`uv sync --extra status` and belongs in `human-hints.md` beside the service unit.

**CPU percent must not block.** `psutil.Process.cpu_percent(interval=...)` sleeps
for the interval. Use the `interval=None` form, which reports since the previous
call, seeded by one throwaway call at startup. A status page that blocks its own
worker for a second is a status page that lies about latency.

### 4.7 Anything else worth an operator's eye

Small, cheap, and each earns its place:

- **Notes volume**: how many cached entries carry library warnings, and the most
  frequent warning text. A spike means the library started saying something new
  about ordinary programs, which is a ripple check the oversight charter asks for
  and which nothing currently surfaces.
- **Capability drift**: the exhibit and chart registry counts
  (`available_exhibits` / `available_charts`, via `capability.py`) against the
  numbers the charter records. The charter's state snapshot pins 12 exhibits and
  8 charts; a page that shows the live counts makes a LIB bump that adds one
  self announcing.
- **Static build freshness**: whether `src/aggregate_api/static/` is mounted and
  the mtime of its `index.html`. The two stage build is a documented trap, and
  "the deploy did not rebuild the SPA" is otherwise diagnosed by confusion.
- **Config that is set but unused**, if any remain after the session isolation
  plan deletes `Settings.knowledge_base`. A standing slot for dead knobs.

### 4.8 Retained state: bounded, in memory, gone on restart

Author ruling 2026-08-18: **do not let it grow too large, and reset on each
reboot.** Stated as an invariant, because it is easier to hold than a set of
limits:

> **The status subsystem persists nothing and holds nothing unbounded.** Every
> number it reports is either computed at request time, or a process lifetime
> counter, or an entry in a fixed size ring buffer. Restarting the service
> clears all of it, by construction rather than by a cleanup step.

What that means concretely:

- **Counters are plain integers on module state.** They start at zero when the
  process starts. The page labels every one of them "since `<process start>`"
  and shows the uptime beside it, so a small number after a restart is never
  mistaken for a quiet day.
- **Text lives in ring buffers with hard caps.** Recent fallback programs
  (section 4.5): **50 entries**, each program truncated to **2,000 characters**
  with the truncation marked. Recent gate refusals (section 3.2): **20 entries**,
  address and timestamp only. Both are `collections.deque(maxlen=N)`, so the cap
  is structural and cannot be forgotten at a call site.
- **Everything else is a query, not a store.** The build statistics of section
  4.4 are windowed SQL against the existing audit table at request time, and the
  cache and session rows are read off the live structures, which are already
  bounded by `cache_max` and the registry capacity. None of it is retained by
  this subsystem.
- **A stated budget**: retained status state stays under roughly 250 KB, which
  50 programs at 2 KB plus the counters comfortably meets. If a future panel
  cannot fit that, it is a query and not a buffer.

**This deliberately does not touch the audit log.** That is on disk in SQLite and
survives restarts, which is the point of an audit log, and section 8 question 4
stays open. The ruling here is read as bounding **this page's own** state, not as
a licence to truncate audit history on boot. If the intent was the audit DB as
well, that is a different and destructive change and it has not been made.

## 5. Shape and delivery

### 5.1 Two endpoints, one contract

`GET /v1/status` returns the JSON, and is the contract: scriptable, curl'able
from the VPS, and the thing a future monitor would poll.
`GET /v1/status/page` returns the HTML, which fetches that JSON and re-renders on
a timer. Both under the versioned prefix, author ruling 2026-08-18.

Two things follow from keeping the page under `/v1`, and both are worth having.
The public Caddy block blocks one prefix rather than two (section 3.1). And the
page cannot collide with the SPA, which owns `/` through the `StaticFiles` mount
at `app.py:111` with `html=True`, meaning an unmatched top level path falls
through to `index.html` rather than 404ing. A top level `/status` would have been
shadowed by that mount's ordering the moment anyone got the registration sequence
wrong, and would have failed by serving the SPA rather than by erroring, which is
the confusing direction.

Both carry the same `require_private` dependency. Neither appears in the public
OpenAPI schema (`include_in_schema=False`).

### 5.2 The page is one self contained file, with no build step

**It must not go through Vite and must not live in `static/`.** Two reasons, both
concrete. `scripts/build-web.ps1` wipes `src/aggregate_api/static/` on every
build (`human-hints.md`: "generated, wiped each build (don't edit)"), so anything
placed there is deleted by the next deploy. And a status page whose delivery
depends on the same build pipeline it exists to report on cannot report on that
pipeline failing.

So: one HTML file with inline CSS and inline JS shipped **inside the package**,
served by an explicit route reading it off disk. The precedent is right there in
`routes/meta.py`, the `_ASSETS` allow-list, whose comment reads "Deliberately not
a StaticFiles mount. Two files, an allow-list, and an explicit media type is less
machinery than a mount plus the traversal reasoning a mount invites." Same
argument, one file.

Plain, dense, monospace numbers, tables not charts, auto refresh on a
configurable interval defaulting to 10 seconds with a pause control. It is an
instrument, not a dashboard.

### 5.3 The two things that are not cheap

**Do not walk objects to size them.** `sys.getsizeof` over an `Aggregate` or a
`Portfolio` traverses numpy arrays and pandas frames and is both slow and wrong.
Estimate from what is already known: the density arrays are `2**log2` float64,
so `2**log2 * 8 * <array count>` is the right order and costs nothing. Label the
column "estimated" and say in the docstring why it is not measured.

**Do not compute p50 and p95 in Python over the whole audit table.** SQLite does
it in the query, and the table is indexed on `ts` (`audit.py:58`). Bound every
query with a time window and a `LIMIT`.

The whole endpoint should be a few milliseconds. Add a `generated_in_ms` field to
the payload so the page reports its own cost and any future regression is
self evident.

## 6. Phases

### S0. Instrumentation and the client address fix

The only phase that touches existing modules, and the only one with any risk.
Everything else is additive.

1. **`net.py`**, new: `client_address(request)` implementing section 3.2's rule,
   and `is_private(address, cidrs)` over `ipaddress`. One place, tested hard.
2. **`_client_ip` (`routes/objects.py:258`) delegates to it**, so the audit log
   records real addresses. Note in the CHANGELOG that historic rows read
   `127.0.0.1` and are not retroactively meaningful.
3. **`ObjectCache` counters**: hits, misses, evictions, puts, and a `stats()`
   method. Under the existing lock, so no new concurrency surface.
4. **Chart cache counters**, the same, smaller.
5. **Build counters**: in flight, timeouts, semaphore waiters.
6. **Session registry counters** in `sessions.py`. Partly there already: a110
   left `forks_taken` and `forks_dropped`. What is owed is the split by cause
   (TTL against capacity against an explicit drop) and the high water mark.
7. **Key scope counters** (shared, session by reason, preview timing, and the
   ring buffer of previewed-`None`-but-built programs), at the `_cache_key` and
   `_preview` call sites in `post_object`.
8. **Process start time and boot library load time**, recorded in `create_app`.

### S1. The JSON endpoint and the gate

`routes/status.py` with `require_private` and `GET /v1/status`, mounted under the
existing `/v1` prefix in `create_app` beside the other four routers
(`app.py:97`), a `StatusResponse` model in `models.py`, the
`AGGAPI_PRIVATE_CIDRS` and `AGGAPI_STATUS_*` settings, and the tests in
section 7.

Sections 4.1, 4.3, 4.4 and 4.7 land here. Sections 4.2 and 4.5 land here too if
the session isolation plan has landed, and are omitted from the payload with a
recorded reason if it has not, so this plan can ship first if sequencing changes.

### S2. The page

The single file, its route at `/v1/status/page`, the auto refresh, the pause
control, and the expand control for truncated program text.

### S3. Deployment

**One Caddy edit**: the public `agg.mynl.com` block's matcher gains `/v1/status*`
beside `/docs` and `/openapi.json`. The VPN block is untouched, since layer three
is off by ruling.

Then `human-hints.md` gains a section covering the topology reasoning of section
2, the `AGGAPI_PRIVATE_CIDRS` setting, the single hop assumption, the
`uv sync --extra status` line, and the verification recipe: the page answers over
the VPN, and `curl -so /dev/null -w '%{http_code}' https://agg.mynl.com/v1/status`
returns 404 from outside.

### S4. Resources

Section 4.6, the optional `psutil` extra and its stdlib fallback. Ruled in, so
this is scheduled rather than conditional. Last because the page is useful
without it and this phase is the one that touches `pyproject.toml` and the VPS
install line.

## 7. Tests

The security tests are the ones that matter and they are written against the real
topology, not against a laptop.

| case | headers | peer | expect |
|---|---|---|---|
| direct on the box | none | `127.0.0.1` | 200 |
| VPN through Caddy | `XFF: 10.8.0.2` | `127.0.0.1` | 200 |
| public through Caddy | `XFF: 203.0.113.7` | `127.0.0.1` | **404** |
| **forged, first element** | `XFF: 10.8.0.2, 203.0.113.7` | `127.0.0.1` | **404** |
| forged zone header | `XFF: 203.0.113.7` plus `X-Aggapi-Zone: private` | `127.0.0.1` | **404** |
| empty XFF | `XFF: ` | `127.0.0.1` | **404** |
| trailing comma | `XFF: 10.8.0.2,` | `127.0.0.1` | **404** |
| two header lines | `XFF: 10.8.0.2` then `XFF: 203.0.113.7` | `127.0.0.1` | **404** |

Row four is the regression test for section 3.2 and the reason the rule is "last,
never first". Row six is the degenerate parse that a naive `split(',')[-1]`
turns into an empty string, which must not compare equal to anything, and row
seven is the same case one step subtler: drop the empty element and the last one
becomes a value the client chose.

Row five is corrected from the draft, which paired the forged zone header with a
loopback peer and no forwarded header. Layer two admits that on its own, so the
case contradicted row one rather than testing anything. Pairing it with a public
forwarded address is the case that carries the intent: the header must add a
condition and never satisfy one. Row eight is not in the draft at all; see
execution note 5.

Both routes are tested, since `/v1/status/page` carrying the gate and
`/v1/status` carrying it are two registrations and only one of them can be
forgotten.

Beyond the gate: the payload validates against its model with the session
isolation pieces both present and absent; `generated_in_ms` stays under a stated
budget with a full cache; a session id never appears in full anywhere in the
payload or the page; and no status route mutates anything, asserted by taking a
cache and counter snapshot around a request.

For section 4.8, three tests that pin the ruling rather than the implementation:
pushing 500 fallback programs leaves exactly 50 retained; a 50,000 character
program is stored truncated at 2,000 with the marker set; and the resource block
reports "unavailable" with a reason, not zero, when `psutil` is absent.

## 8. Questions, four closed

Rulings of 2026-08-18, recorded here so the reasoning that produced them is not
lost, and so a reviewer sees what was decided rather than only what was chosen.

1. **`psutil`: an optional extra.** CLOSED. Section 4.6, phase S4.
2. **Layer three, the zone header: off by default.** CLOSED. Section 3.3, and
   S3 shrinks to one Caddy edit as a result.
3. **The page shows program text.** CLOSED. Sections 4.3 and 4.5, bounded by
   4.8. It is a private page and an upstream ask needs the program that failed.
4. **Audit retention.** STILL OPEN, and deliberately untouched by the 4.8
   ruling, which bounds the status page's own memory and not the audit DB on
   disk. The page will make the DB's growth obvious, which is the point at which
   this wants deciding; it is not a prerequisite.
5. **Paths: `/v1/status` and `/v1/status/page`.** CLOSED. Section 5.1, with two
   consequences worth having (one Caddy prefix, no collision with the SPA mount).

Nothing above blocks S0, which is the phase with the risk in it.

## 9. What this does not do

- No metrics export (no Prometheus, no OpenTelemetry). If that is ever wanted it
  is a different plan; this one is a page for a person.
- No history or time series. Every number is current or windowed off the audit
  log at request time. Nothing new is persisted.
- No controls. Read only, section 3.4.
- No alerting.
