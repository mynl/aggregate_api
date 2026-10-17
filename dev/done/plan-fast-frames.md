# Plan: fast frames for the Lab, Excel and R

Five steps, one bump each. Drafted 2026-10-17. Status: **questions ruled
2026-10-17 (see Rulings at the end), ready for review**.

## Goal

Every client gets a full density frame quickly. A full frame is `density_df`
at `2**log2` rows: 65,536 at the default log2 of 16, and 262,144 at the cap of 18.

- **The Lab** shows every row in its density tables on request, and the grid's
  own export downloads them.
- **Excel** loads a whole frame as a table through Power Query.
- **R and Python** read a whole frame as Parquet.
- **Excel functions** accept a DecL program wherever they accept a handle.

The R client is not in this plan. It lives in its own repository under its own
plan, written after this one lands and built against the routes this plan
delivers.

## Evidence

Measured on DOOB on 2026-10-17. The frame is the `density_df` of a synthetic
three-unit portfolio at log2 16, bs 1/4: 65,536 rows by 43 numeric columns,
2.8 million cells.

```
port BenchP agg A 10 claims sev lognorm 10 cv 1 poisson
            agg B 5 claims sev gamma 20 cv 0.5 poisson
            agg C 3 claims sev lognorm 50 cv 2 poisson
```

Where the time goes when the JSON route serves it today:

| stage | ms |
|---|---|
| `frame_to_payload`, the per-cell `_safe` loop | 703 |
| `response_model` validation | 5 |
| `response_model` serialization | 80 |
| `json.dumps` | 842 |
| gzip at level 9, Starlette's default and ours | 1,663 |
| gzip at level 6 | 755 |

`orjson.dumps` of the frame's contiguous numpy array, with
`OPT_SERIALIZE_NUMPY`, takes **68 ms**. Its output parses to exactly the same
JSON as today's, NaN to `null` included (checked by `json.loads` equality).

The same frame in other formats:

| format | wire MB | encode ms | decode ms (Python) |
|---|---|---|---|
| JSON as served today, gzip 6 | 16.5 | 2,150 | 530 |
| CSV, gzip 6 | 16.2 | 1,950 | 240 |
| Parquet, snappy | 20.2 | 155 | 17 |
| Parquet, zstd | 17.9 | 167 | 8 |
| **Parquet, zstd, byte stream split** | **9.2** | **27** | **5** |
| Arrow IPC, gzip 6 | 11.9 | 305 | 35 |

The Parquet round trip is bit-exact. Plain Parquet is no smaller than gzipped
JSON, because full-precision floats are close to incompressible. The byte
stream split encoding groups the bytes of each float by position, which is
where all of the saving comes from.

The scratch scripts behind these numbers become `dev/bench_frame_encodings.py`
in `[orjson-frames]`, so each step can re-measure.

## Decisions taken in conversation, 2026-10-17

- **orjson for JSON frames, unconditionally.** The saving needs more than
  swapping `json.dumps`: it needs the numpy array handed to orjson directly,
  bypassing the per-cell loop and the `response_model` pass.
- **One fast binary format, Parquet**, beside the existing CSV route. Arrow IPC
  is faster to decode, but fewer readers handle it: Power Query reads Parquet
  and not IPC.
- **Excel takes full frames through Power Query**, not through custom
  functions. A spill of millions of cells is the wrong channel, and a frame
  that large belongs in a table anyway.
- **Build first, never a decl-in-the-URL route.** The object id has been a hash
  of the parsed program since 1.14.0, so posting a DecL the server already
  holds is a cache hit that returns the id at once. A client that posts and
  then fetches is therefore immune to eviction and restart, and no new build
  entry point is needed. A second build path would have to copy every guard
  `post_object` carries (the log2 cap, the semaphore, the timeout,
  `library_references_only`, the audit row), and it would escape Caddy's build
  rate limit, which matches POST `/v1/objects` alone.
- **DecL travels in POST bodies only.** A program in a URL lands in Caddy's
  access log and in browser history, and long programs hit URL length limits.
- **The Lab's density tables keep their fast first view** and gain an explicit
  All rows view. The download of all rows is the grid's own export, two clicks,
  rather than a second download path.

## Current behavior

- **JSON frames.** About 20 routes in `routes/objects.py` return
  `frame_to_payload(...)` (`serializers.py:201`) under
  `response_model=models.FrameResponse`. `frame_to_payload` coerces every cell
  through `_safe` (`serializers.py:27`). FastAPI then validates and serializes
  the dict through the model, and Starlette's `JSONResponse` runs `json.dumps`.
- **Compression.** `app.py:152` installs
  `GZipMiddleware(minimum_size=1024)`, which defaults to `compresslevel=9`.
  The middleware compresses every response over 1 kB unless it already carries
  `Content-Encoding` or is `text/event-stream`.
- **Full-frame export.** `GET /v1/objects/{oid}/frame/{which}.csv`
  (`objects.py:2712`) serves any frame named in `_CSV_FRAMES`
  (`objects.py:2640`) with pandas `to_csv`. It is declared before
  `/frame/{which}` because a path parameter would otherwise swallow the dot,
  and a test pins that order. Nothing in the SPA links to it
  (`web/src/api.js:383`).
- **Lab density tables.** Two leaves show a density frame in a grid:
  - More > Density (`web/src/main.js:1658`). For an `nttagg` it adds the exact
    columns `p_exact_float` and `p_exact_log10`.
  - Reinsurance > Density (`loadReinsFrame`, `main.js:3597`).

  Both ask for `resolution: 'display'`, the frame binned to at most 8,192 rows,
  with `renderCap: 8192`. More > Density also asks for a curated column list
  (`DENSITY_COLS`, `main.js:1092`). The comment at `main.js:1661` says "the CSV
  download is the exact export", but no control in the Lab reaches that route:
  the grid's export saves the binned, curated grid.
- **The csv-grid worker is off.** `web/src/grid.js:101` passes
  `worker: false`. The note at `grid.js:10` gives the reason: csv-grid resolves
  its worker relative to `import.meta.url`, which under Vite is the hashed
  bundle, where no worker file sits. csv-grid 3.10.1 also accepts `worker` as a
  URL string (`new Worker(this.opts.worker)`), and its package exports
  `csv-grid/worker`. The worker parses CSV text of 1 MB or more (`_parse`). A
  grid fed `{records}` never uses it, so the worker matters only for `{csv}`
  and `{url}` data.
- **Excel functions.** `AGG.EXHIBITS`, `AGG.EXHIBIT` and `AGG.Q` take a handle.
  `readObject` (`excel/src/functions/functions.ts:191`) fails with
  `MESSAGES.notAHandle` on anything `parseHandle` rejects.

## Steps

### [orjson-frames]

Patch bump: the same output, faster.

- Add `orjson` as a runtime dependency. This is a dependency change, so it
  needs a real sync followed by the co-development restore. Stop the server
  first, because `uv sync` fails with `os error 32` while
  `aggregate-api.exe` is locked:
  ```
  uv sync --extra dev
  uv pip install -e V:/worktrees/aggregate_REFACTOR
  uv pip install -e V:/dev/aggregate-relativity
  ```
- In `serializers.py`, add `frame_response(df, *, cols=None, start=None,
  stop=None, downsample=None) -> Response`. It applies the same slicing as
  `frame_to_payload`, then takes the frame's values as a contiguous array.
  - If the array's dtype kind is `f`, `i` or `u`, it is passed straight to
    `orjson.dumps(..., option=OPT_SERIALIZE_NUMPY)`.
  - Otherwise (object, bool or mixed columns), the rows go through today's
    `_safe` coercion and are then encoded with orjson.

  It returns a small `Response` subclass with media type `application/json`.
  Today's path also upcasts a mixed int and float frame to float64 through
  `to_numpy()`, so the output is unchanged.
- The routes in `routes/objects.py` that return a bare frame payload switch
  from `return frame_to_payload(...)` to `return frame_response(...)`. They
  keep `response_model=models.FrameResponse` so OpenAPI still documents the
  shape. FastAPI skips validation for a returned `Response`, which is the
  point. `frame_to_payload` stays as it is for the callers that embed a frame
  inside a larger payload (`bounds.py:288`, `bounds.py:329`, `pnl.py:100`),
  since those are small.
- Add `dev/bench_frame_encodings.py`, built from the scratch benchmarks: the
  stage table, the format table and the gzip levels, against the synthetic
  portfolio above. It builds the object directly and never goes through
  `TestClient`, so it writes no audit row.

**Acceptance.**
- For each switched route, a test compares `json.loads` of the new response
  with the old `frame_to_payload` path on:
  - an aggregate;
  - a portfolio;
  - a frame holding NaN and ±inf, all of which must arrive as `null`;
  - a frame with a text column, which takes the fallback.
- `bench_frame_encodings.py` reports the full portfolio `density_df` serialized
  in under 150 ms, gzip excluded.

### [gzip-level]

Patch bump.

- `app.py:152` becomes `GZipMiddleware(minimum_size=1024, compresslevel=6)`.
  The comment above it says why: level 9 cost 1.7 s on a 52 MB frame, against
  0.75 s at level 6.

**Acceptance.**
- `bench_frame_encodings.py` reports the level 6 and level 9 sizes, and the
  level 6 size is within 5% of level 9. Record the figures in the execution
  log.
- The existing compression tests still pass.

### [parquet-route]

Minor bump.

- `GET /v1/objects/{oid}/frame/{which}.parquet`, declared beside the `.csv`
  route and, like it, before `/frame/{which}`. It serves the same `_CSV_FRAMES`
  names through `_named_frame`.
  - The index is reset with `reset_index_safe`, and the columns are flattened
    with `_flatten_columns`, because Parquet needs string column names.
  - It is written with pyarrow: zstd, byte stream split on the float columns,
    dictionary encoding on the rest.
  - Media type `application/vnd.apache.parquet`, with
    `Content-Disposition: attachment; filename="{name}-{which}.parquet"`.
- **pyarrow is an optional extra**, `parquet`, in
  `[project.optional-dependencies]`, written in the same style as the `status`
  extra. It is also added to `dev`, so the suite covers the route. Without
  pyarrow the route answers 501 with a message naming the extra. `/v1/meta`
  gains `frame_formats` (`["csv", "json"]`, plus `"parquet"` when pyarrow
  imports).
- **No gzip on top of zstd.** The body is already compressed, so a second pass
  costs CPU and gains nothing. Starlette's middleware has no way to exclude a
  content type, so `app.py` wraps it: a small ASGI class that passes paths
  ending `.parquet` straight to the app and sends everything else through
  `GZipMiddleware`.
- The host syncs with `--extra parquet` added to its existing extras.

**Acceptance.**
- Every `_CSV_FRAMES` name on an aggregate, a portfolio and a reinsured
  program writes and reads back equal to the frame the `.csv` route serves:
  numerically equal, with the same column names.
- A test pins the route order (`density_df.parquet` is not answered as JSON).
- A `.parquet` response carries no `Content-Encoding`, even when the request
  sends `Accept-Encoding: gzip`, while JSON frames are still gzipped.
- With pyarrow made unimportable by monkeypatch, the route answers 501 and
  `/v1/meta` omits `parquet`.
- On the host, `curl -sI -H 'Accept-Encoding: gzip, zstd'` through
  agg.mynl.com shows that Caddy does not encode the Parquet response either.

### [lab-all-rows]

Minor bump. The two density leaves, More > Density (with the exact columns on
an `nttagg`) and Reinsurance > Density, gain an All rows view.

- **Turn the worker on.** `grid.js` imports `csv-grid/worker?url` (Vite copies
  it as a hashed asset) and passes that URL as `worker`, replacing
  `worker: false`. Rewrite the module note at `grid.js:10`. Any CSV of 1 MB or
  more then parses off the main thread, in every grid.
- **A two-way control above each density grid: Display grid | All rows.** It
  has two fixed labels. A single button that toggled its own meaning would
  break the house UI rule.
  - Display grid is today's view and stays the default, because it is the fast
    first paint.
  - All rows remounts the grid from
    `{url: <base>/v1/objects/{id}/frame/{which}.csv?session=<id>}`. That is the
    whole frame, every row and every column, fetched and parsed by the grid's
    worker. The `session` query parameter exists for exactly this, a request
    that cannot carry a header. `renderCap` rises to the frame's row count.
- **A 3.5M cell budget on All rows** (ruled 2026-10-17). Width grows with the
  number of units and height with log2, so a whole frame can far exceed what a
  browser tab should hold: ten units at log2 18 is 113 columns by 262,144 rows,
  about 30M cells and 600 MB of CSV. At that size, the place for the frame is
  Python and `aggregate`, not a table.
  - **A new shape route** tells the Lab what it is about to load. `GET
    /v1/objects/{oid}/frame/{which}/shape` returns `{"rows": r, "columns": c}`
    through `_named_frame`, after `reset_index_safe`. The frame is already in
    memory, so this is cheap. Its extra path segment cannot collide with
    `/frame/{which}`.
  - **The `.csv` route gains `cols`**, a comma-separated subset with the same
    semantics as the JSON density route's: names absent from the frame are
    dropped silently. Without `cols` it serves the whole frame, as today.
  - **Within the budget** (`rows * columns <= 3_500_000`), All rows loads the
    whole frame.
  - **Over the budget**, it loads every row of the Display grid's columns:
    `densityCols(kind)` for More > Density, which is at most 1.6M cells at the
    log2 cap. A line above the grid says why, for example "113 columns by
    262,144 rows is 29.6M cells, over this table's 3.5M budget, so it shows 4
    columns on every row. For the whole frame, download the .csv or work with
    it in Python through aggregate", with a plain link to the `.csv`.
  - The budget is one constant in `web/src/main.js`,
    `ALL_ROWS_CELL_BUDGET = 3_500_000`. The server does not enforce it.
  - **Where it bites.** `density_df` has 12 columns for an aggregate, 14 for
    an `nttagg` (the two exact columns) and 13 + 10n for a portfolio of n
    units. `reins_density_df` has a fixed 10. So:
    - an aggregate fits whole at every log2 up to the cap of 18 (3.1M cells);
    - an `nttagg` fits through log2 17. At 18 it is 3.7M cells and takes the
      fallback, which is rare, since exact compounds sit on small grids;
    - a portfolio of up to four units fits at log2 16 (53 columns, 3.47M
      cells), while five units (63 columns, 4.1M) take the fallback;
    - at log2 17 only a one-unit portfolio fits (23 columns, 3.0M); two units
      (4.3M) take the fallback;
    - no portfolio fits at log2 18;
    - Reinsurance > Density always fits (2.6M cells at log2 18).
- **Download is the grid's own export.** In All rows, the grid holds the
  frame's source text, so its raw CSV export is the whole frame. No separate
  download button, and no Parquet button in the Lab; Parquet is for R, Python
  and Power Query.
- Rewrite the comments at `main.js:1658` to `1676` and `main.js:3587` to
  `3596`. They describe display binning as the permanent bulk path and promise
  a CSV export that did not exist.

**Acceptance.**
- `npm test` in `web/` passes. Build with `.\scripts\build-web.ps1`.
- A log2 16 four-unit portfolio's More > Density in All rows shows 65,536
  rows and all 53 of the frame's columns.
- A log2 18 aggregate's All rows shows 262,144 rows and all 12 columns.
- A log2 16 five-unit portfolio's All rows shows 65,536 rows of the Display
  grid's columns, with the budget line and the `.csv` link. The link downloads
  all 63 columns.
- Tests cover the shape route, for a portfolio's `density_df` and an unknown
  frame name, and `cols` on the `.csv` route.
- The page stays responsive while the worker parses. Record the time from click
  to filled grid in the execution log.
- The grid's raw CSV export of All rows matches the `.csv` route file. An
  `nttagg`'s `p_exact_log10` keeps its `-inf` cells, which csv-grid reads as
  numbers.
- Reinsurance > Density behaves the same on a reinsured program.
- Display grid is unchanged from today.

### [excel-decl-arguments]

Minor bump.

- **A DecL program wherever a handle goes.** Anything `parseHandle` rejects is
  treated as a program and built with the default log2 and bs, through the same
  path as `AGG.BUILD`: the memo, the recipe table and `library_references_only`.
  It then proceeds as a handle.
  - The in-flight build is memoized as a promise, so a sheet of cells sharing
    one program posts it once.
  - A program that builds to a value rather than an object, such as `(2+2)`,
    fails with a message saying so.
  - The test of handle versus program is a pure helper in `core.ts`, unit
    tested.
  - The JSDoc for the `handle` parameter of `EXHIBITS`, `EXHIBIT` and `Q`
    becomes "A handle from AGG.BUILD, or a DecL program", which regenerates
    `functions.json`.
- **Power Query, in `excel/README.md`.** A new section gives the query that
  builds first and then fetches. It reads the program from a cell named `Decl`, posts it, and
  loads the Parquet as a table:
  ```
  let
      base  = "https://agg.mynl.com",
      decl  = Excel.CurrentWorkbook(){[Name = "Decl"]}[Content]{0}[Column1],
      built = Json.Document(Web.Contents(base, [RelativePath = "v1/objects",
                Headers = [#"Content-Type" = "application/json"],
                Content = Json.FromValue([decl = decl, log2 = 16,
                                          library_references_only = true])])),
      frame = Parquet.Document(Binary.Buffer(Web.Contents(base,
                [RelativePath = "v1/objects/" & built[id]
                                & "/frame/density_df.parquet"])))
  in
      frame
  ```
  - `Binary.Buffer` is required: without it `Parquet.Document` fails with a
    "streamed binary values" error.
  - Repeat the data warning: the program goes to the public server.
  - Desktop Excel on Windows is the tested target.
- Rebuild with `.\scripts\build-excel.ps1` after the bump.

**Acceptance.**
- `npm test`, `npm run typecheck` and `npm run lint` pass in `excel/`.
- Author checks in desktop Excel:
  - `=AGG.Q("agg A 2 claims sev lognorm 10 cv 1 poisson", 0.99)` equals the
    same quantile read through an `AGG.BUILD` handle.
  - Twenty cells sharing one program post it once, by the server's audit
    count.
  - The Power Query loads a log2 16 portfolio's `density_df` as a table of
    65,536 rows.
  - The query refreshes after a server restart.
  - Power Query reads byte stream split. If it does not, drop the split
    globally in a follow-up patch (17.9 MB instead of 9.2 MB) and record that
    here.

## Files

- `pyproject.toml`, `uv.lock`: `orjson`, the `parquet` extra, pyarrow in `dev`.
- `src/aggregate_api/serializers.py`: `frame_response`.
- `src/aggregate_api/routes/objects.py`: the switched routes, the `.parquet`
  route, the shape route, `cols` on the `.csv` route.
- `src/aggregate_api/routes/meta.py`, `models.py`: `frame_formats`.
- `src/aggregate_api/app.py`: the gzip level, the Parquet bypass.
- `tests/`: the comparisons, route order, encoding headers, the 501.
- `dev/bench_frame_encodings.py`: new.
- `web/src/grid.js`, `web/src/main.js`: the worker, the two-way control, the
  comments.
- `excel/src/functions/functions.ts`, `core.ts`, `excel/test/core.test.ts`,
  `excel/README.md`.
- `CHANGELOG.md`, `dev/TODO.md`, `README.md` (one line on Parquet under the
  API's formats).

## Not in scope

- **The quantile frame:** `density_df` read at q(p) for a caller's
  probability grid. It is a library change in `aggregate` with its own plan;
  the API, `AGG.FRAME` and the R client consume it afterwards.
- **The R client**, in its own repository and plan, after this one.
- **A server-side recipe store** (id to DecL, log2 and bs, rebuilt on a 404).
  The audit table already holds those columns for every build. It would give
  ids that work as permanent links, but with build-first clients none of the
  three clients needs it. If wanted, it is its own plan, with four rules:
  library-scope programs only; an upgrade answers with the new id; a rebuild
  triggered by a GET is charged to the build budget; its own table, not the
  audit.
- **Display binning of `exeqa_` columns.** `bin_density` takes the right-edge
  value of every column that is not a mass. For a conditional mean such as
  `exeqa_`, the correct coarse value is the mass-weighted mean, and on an
  atomic grid the right edge can be an empty bucket. All rows sidesteps it in
  the Lab, but the API's `resolution=display` still has it. Track it in
  `dev/TODO.md`.
- **A faster CSV writer.** pandas `to_csv` takes about 1.2 s on the benchmark
  frame, and that sits on the All rows click. Measure it in `[lab-all-rows]`.
  A pyarrow CSV writer is a follow-up only if the click feels slow, and it must
  produce the same text.

## Rulings, 2026-10-17

1. **All rows carries every column of the frame, within a 3.5M cell budget.**
   Over the budget it falls back to the Display grid's columns on every row,
   says so, and links the `.csv`. Beyond that size, the frame belongs in
   Python and `aggregate`. The detail is in `[lab-all-rows]`.
2. **pyarrow is an optional extra**, not a hard dependency (the wheel is
   28 MB).
3. **No Parquet button in the Lab.** The grid's export covers CSV in two
   clicks.
4. **The server-side recipe store is deferred** to its own plan.

## Execution log

### [orjson-frames], 1.17.1, 2026-10-17

- Landed as written. `frame_response` returns a plain `Response` with orjson
  bytes rather than a `Response` subclass; nothing needed the subclass.
- The fast path is gated on an explicit dtype set (`_ORJSON_DTYPES`), not on
  `dtype.kind in "fiu"` as the plan said: `float16` is a float kind orjson
  refuses, and a bool array must take the coercing path to serialize as it did.
- The slicing shared by both serializers moved into `_slice_frame`, so
  `frame_to_payload` and `frame_response` cannot drift on `cols`, `start`,
  `stop` or `downsample`.
- Route coverage is one parametrized test over fourteen route and query
  combinations on an aggregate, a portfolio and a reinsured aggregate, with
  `frame_response` wrapped in the route module so each frame is compared on both
  serializers exactly as the route hands it over.
- Benchmark on DOOB: `frame_response` 81 ms on the 2.8M-cell frame against
  719 + 5 + 87 + 893 ms before, same document. gzip 9 is 1,707 ms for
  16.11 MB; gzip 6 is 754 ms for 16.23 MB; gzip 1 is 185 ms for 26.26 MB.
- `uv sync` failed on the locked `aggregate-api.exe` (a `uv run --no-sync
  aggregate-api --port 8001` from the Excel session was still running). The
  lock file was written and orjson was installed with `uv pip install`; the
  editable `aggregate-api` metadata is the only thing the failed step would
  have refreshed, and nothing reads it. The author's server was left alone.
- `dev/TODO.md` had no entry for this plan; a `[Fast-Frames]` entry was added
  under Landed, ticked step by step. `T:/worktrees/dev-files.md` does not
  exist, so no control-list row.

### [gzip-level], 1.17.2, 2026-10-17

- Landed as written: `compresslevel=6`.
- The plan said "the existing compression tests still pass"; there were none.
  `tests/test_compression.py` is new: a density frame gzips, `/v1/health` and
  an `identity` request do not, and the installed level is 6.
- Sizes from the benchmark: level 9 16.11 MB, level 6 16.23 MB (0.7% larger),
  level 1 26.26 MB. Times 1,707 ms, 754 ms, 185 ms.

### [parquet-route], 1.18.0, 2026-10-17

- Landed as written, with pyarrow 26.0.0 in the lock and a `>=15` floor (the
  release where `use_byte_stream_split` started taking a column list).
- The gzip bypass is `GZipExceptParquet` in `app.py`, an ASGI wrapper that
  routes on the path suffix and holds a `GZipMiddleware` for everything else.
  `test_compression.test_middleware_level_is_six` reads the level off it.
- `frame_to_parquet` retries with object columns rewritten as strings when
  Arrow's inference fails on a mixed object column; no served frame needed it
  in the suite, but a summary frame could.
- A MultiIndex frame (`reins_stats_df`) goes out as two CSV header rows and as
  `a.b` names in Parquet, which is `_flatten_columns`, the JSON route's
  spelling. The test joins the CSV header rows the same way to compare.
- `uv sync` still cannot replace the locked `aggregate-api.exe`, so the lock
  was written with `uv lock` and pyarrow installed with `uv pip install`.
- Not run: the host check (`curl -sI` through agg.mynl.com showing Caddy does
  not encode the Parquet response). That is the author's, with the deploy.

### [lab-all-rows], 1.19.0, 2026-10-17

- The budget constant and the decision live in a new pure module,
  `web/src/all-rows.js` (`ALL_ROWS_CELL_BUDGET`, `allRowsPlan`,
  `frameCsvUrl`), not in `main.js` as the plan said, so `node --test` covers
  them (`web/test/all-rows.test.js`, 7 tests). `main.js` holds the switch
  (`densityRowsStrip`), `loadAllRows`, `loadMoreDensity` and the reworked
  `loadReinsFrame`; `replacePaneTable` takes a `header` factory as
  `loadExhibitLeaf` does.
- The worker is `import workerUrl from 'csv-grid/worker?url'` in `grid.js`;
  Vite emits `assets/csv-grid.worker-<hash>.js`. `mountGrid` accepts
  `{url, name}` beside `{columns, rows}`.
- Smoked in Chrome against a scratch server on 127.0.0.1:8011 (scratch audit
  database, built SPA). BasicBook at log2 16, More / Density, All rows:
  65,536 rows by 12 columns, `-inf` in `log_p` as numbers, no console errors.
  **9.4 s from click to filled grid**, of which the `.csv` fetch was 0.6 s
  (11.5 MB; the server writes it in 0.4 s). The worker was in use (verified on
  the instance). So about 8.5 s is csv-grid's parse, inference and render of
  786k cells, which is slower than the author expected of it and is a finding
  for `csv-grid`, not for this repo. A five-unit portfolio at log2 16 took the
  fallback: 65,536 rows by 4 columns with the budget line and the whole-frame
  link.
- The lede under the switch still reads "binned probability mass, distribution,
  and survival functions" in All rows, where nothing is binned. It is the
  leaf's shared sentence (`ledeFor`); left as is, noted here.
- Not run: Reinsurance / Density in the browser (the route and the shape are
  covered by tests; the leaf shares `loadAllRows` with More / Density), and the
  grid's Save compared byte for byte with the `.csv` route.

### [excel-decl-arguments], 1.20.0, 2026-10-17

- `programOrHandle` in `core.ts` is the pure helper (a handle, a program, or
  null for a number or an empty cell), unit tested. `functions.ts` gains
  `handleOf` and `buildOnce`; `AGG.BUILD` now goes through `buildOnce` too, so
  the in-flight sharing covers it as well as the argument builds.
- One edge recorded rather than engineered around: a build shared between an
  `AGG.BUILD` cell and other cells is aborted for all of them if Excel cancels
  the `AGG.BUILD` cell. They fail with the abort rather than a message, and a
  recalculation posts again.
- `MESSAGES.notAHandle` now names both forms; `programIsValue` is new.
- `functions.json` regenerates from the JSDoc (`npm run build` through
  `scripts/build-excel.ps1`); the three `handle` descriptions read "A handle
  from AGG.BUILD, or a DecL program".
- `excel/README.md`: the program-as-argument paragraph and the Power Query
  section, with the data warning extended to queries.
- Not run, the author's in desktop Excel: the acceptance list (the quantile
  equality, twenty cells posting once by the audit count, the Power Query over
  a log2 16 portfolio, the refresh after a restart, byte stream split).
