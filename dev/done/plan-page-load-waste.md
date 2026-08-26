# Plan: cut the redundant work out of a page load

Status: ready. Drafted 2026-08-26 from a network trace of the running app.

## What prompted it

A DevTools reading suggested the 2D charts were refetching on every visit and
that caching was not working. Measured against the local server, the opposite is
true: the chart route is the one thing on the page that revalidates properly.
`Cache-Control: no-cache` means "revalidate every time", so a row appears in the
network panel on every visit even when no body is transferred, and that is what
was being read as a reload.

Measured on `port BigBook`, a three line portfolio built through the UI:

| | first load | return to the leaf |
|---|---|---|
| `chart/port` | 200, 2,417,700 bytes on the wire, 2302 ms | 304, 300 bytes, 88 ms |

The trace did turn up four real items, three of them client side. None is the
one that was suspected.

## The findings

### 1. The exhibit route rebuilds in order to answer 304

`objects.py` builds the exhibit, serializes it, computes the hash, compares
`If-None-Match`, and on a match throws all of it away. There is no exhibit
cache. Median conditional GET on that same portfolio:

```
  7 ms  /chart/port        LRU hit, no rebuild
  7 ms  /chart/pnl
 48 ms  /exhibit/summary   rebuilt, then discarded
210 ms  /exhibit/tail      30x the chart route for the same "nothing changed"
```

The comment above `_chart_cache` already states this problem exactly, and
solves it for charts only. The frame document route has the same shape.

### 2. `/v1/examples` is fetched twice on every load

`loadExamples` memoizes the resolved payload but not the fetch in flight, so
`cached` is still null when a second caller arrives and both fire. Two callers
race at startup: the example ring and the dropdown mount.

### 3. `pricing/preview` is posted three times on every load

Not three callers. `createPricingForm` is instantiated four times, three of
them with `preview: true`, and each mounts through `write(null)` or `sync()`
into `refresh()`. All three send the identical body `{"p":0.99,"coc":0.15}`.
The two other `pricingPreview` call sites are submit handlers and never fire
at load.

### 4. A `ReferenceError` on every page load

```
ReferenceError: Cannot access 'walkMode' before initialization
```

`main.js` calls `editor.setText(LANDING_DECL)` at module top level. That fires
the CodeMirror update listener synchronously into `onEdit`, which reaches
`renderHistoryNav()` regardless of `fromApp`, which reads `walkMode`. The
`let walkMode` declaration sits 35 lines below the `setText`, so the read lands
in the temporal dead zone. CodeMirror's listener guard swallows it, so the page
recovers and the first `renderHistoryNav()` is simply lost, but it logs on
every single load.

## What is not a finding

Compression is healthy and has no bypass. `GZipMiddleware(minimum_size=1024)`
is installed on the app itself, so it wraps every `/v1/` route, the `.csv`
download and the StaticFiles mount alike. Nothing sets `Content-Encoding`
itself and there are no `StreamingResponse` or `FileResponse` returns, which
are the two things that normally slip past it. Density and the 3D surface both
travel the ordinary JSON routes and are covered.

Worth recording for the separate blob size question: the `app.py` comment
expects roughly 10 to 1 on a density payload, and the chart document measured
2.5 to 1 (6,105,738 raw to 2,417,700 on the wire). Chart documents are full
precision float text with high entropy, so gzip will not rescue a 6 MB chart
document.

Static assets are served from the browser cache with no revalidation request
at all, which is Vite's hashed filenames working as intended.

## The work

### Phase 1, server: one revalidation cache, two users

Lift `_chart_cache` and its two helpers into a small `RevalidationCache` class
parameterized by capacity and by the telemetry channel it reports on, then
instantiate it twice:

- `_chart_cache`, 8 entries, keyed `(oid, name, window, detail, encoding)`
- `_exhibit_cache`, 64 entries, keyed `(oid, name, perspective)`

The safety argument is the one already written above `_chart_cache` and it
transfers verbatim: an `oid` is the content hash of `(decl, log2, bs)`, cached
objects are immutable, and the build is deterministic, so an entry cannot go
stale under its own key. Exhibit payloads run 1.5 kB to 6 kB against a chart's
few MB, so 64 entries is a smaller worst case than the 8 chart entries.

The exhibit route then screens availability first (a 404 must stay a 404), and
only reaches `build_exhibit` on a miss.

`reset_singletons` clears both.

### Phase 2, client: three fixes

- **`examples.js`**: hold the in-flight promise in a second variable so
  concurrent callers share one fetch. `cached` stays the resolved payload
  because `renderList(list, cached, ...)` reads it synchronously.
- **`api.js`**: an in-flight map on `pricingPreview` keyed by `(id, body)`, so
  identical previews in flight at the same moment share one POST and every
  leaf still opens with its line already correct. Entries are dropped as soon
  as the request settles, so this is a request coalescer and not a cache: it
  never answers a later question with an older answer.
- **`main.js`**: move the `walkMode` declaration and its comment up into the
  module state block, above the editor construction, which is where it
  belongs and which puts it in scope before the landing `setText` can fire.

### Phase 3: rebuild the web bundle, bump, changelog, commit.

## Verification

- `uv run pytest`.
- Rebuild the SPA, reload the app, and confirm from a network trace: one
  `/v1/examples`, one `pricing/preview`, a clean console, and a 304 on a
  return to a table leaf answered in single digit ms rather than 210.

## Out of scope

The size of the chart document itself. Handled separately.
