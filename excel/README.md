# AGG: aggregate_api in Excel cells

An Office add-in of Excel custom functions over the `aggregate_api` server. A
cell builds a DecL program on the server and holds a handle to the result;
other cells read its exhibits and quantiles as plain values.

```
=AGG.VERSION()                                                  server and library versions
=AGG.BUILD(decl, [log2], [bs])                                  a handle, such as agg.A#4f40714271198d8f
=AGG.EXHIBITS(handle)                                           spill: name | title | perspectives
=AGG.EXHIBIT(handle, name, [perspective], [block], [headers])   spill: the exhibit, as values
=AGG.Q(handle, p)                                               quantiles; p a number or a range
```

Desktop Excel on Windows and Mac, and Excel on the web. Not Excel on iPad,
which has no custom functions.

## Installing

The add-in is served with the API, from `https://agg.mynl.com/excel/`, and
calls the API on that same origin. Its manifest is
`https://agg.mynl.com/excel/manifest.xml`.

- **Excel on the web:** Home, Add-ins, More add-ins, then Upload My Add-in,
  and give it the manifest (download it first: the dialog takes a file).
- **Desktop Excel:** the same Upload My Add-in in current Microsoft 365 builds
  (Home, Add-ins, More add-ins). In older builds, put the manifest in a shared
  folder, add that folder under File, Options, Trust Center, Trust Center
  Settings, Trusted Add-in Catalogs, restart Excel, and pick it from Shared
  Folder in the add-ins dialog.

The add-in's version is the server's: the build stamps `__version__` into the
manifest, and every file is served `no-cache`, so a deploy is picked up when a
workbook reopens. `=AGG.VERSION()` says which server a workbook is talking to.

## Using it

`decl`, and `handle` wherever a program stands in for a handle, is a cell or a
range. A range's non-empty cells join with newlines in reading order, so a
program can sit one clause per cell.

**References resolve to library entries only.** `agg.Capstone.Gross` works;
`agg.A`, where `A` is something you built in another cell, is refused with a
message saying so. Excel cannot see a dependency made by name: the cell naming
`agg.A` does not depend on the cell that built `A`, so editing `A` would never
recalculate it. Combine programs through text instead, which Excel tracks:

```
A1: agg A 2 claims sev lognorm 10 cv 1 poisson
B1: agg B 3 claims sev gamma 5 cv 0.5 poisson
C1: =AGG.BUILD("port P " & A1 & " " & B1)        edit A1 and C1 recalculates
D1: =AGG.BUILD(A1)                               A on its own
E1: =AGG.EXHIBIT(C1, "summary")
F1: =AGG.Q(C1, {0.5, 0.99})
```

**A program goes wherever a handle goes.** `=AGG.Q(A1, 0.99)` with the
program itself in A1 builds it on the default grid and reads the quantile, and
Excel recalculates when A1 changes. `=AGG.EXHIBIT(A1:A19, "summary")` does the
same for a program laid out down a column. Cells sharing one program post it
once. `AGG.BUILD` is for when you want `log2` or `bs`, or a handle to reuse.

`AGG.EXHIBIT` returns numbers, not formatted text. `block` 0 (the default)
stacks every block under its caption with a blank row between; `block` k
returns block k alone, without a caption, which is the form to use in
formulas. A label that spans several rows or columns is repeated into each of
them, so every row and column of the spill says what it is.

**A refused program returns its reason as text**, readable in the cell:
`#DECL! line L, col C: ...` for a parse error, `#DECL!` and the server's own
message for an unknown reference or a grid over the cap. A spilling function
returns it as a single cell, and a function reading a cell that holds such
text repeats it, so the reason follows the program wherever it is used. Only
transient failures (rate limited, timed out, server unreachable or faulting)
show `#VALUE!`, with the reason on hover, since a recalculation can clear
them.

**Handles survive a restart.** The workbook keeps a table of how each handle
was built, in its document settings (saved inside the .xlsx). When the server
no longer holds an object (evicted, or restarted), the add-in builds it again
from that table and carries on under the same handle. If the server answers
with a different id, its library or version changed: press Ctrl+Alt+F9 to
recalculate every cell.

## Whole frames through Power Query

A density frame is `2**log2` rows by tens of columns, which is a table to load,
not a spill. Power Query (Data, Get Data, From Other Sources, Blank Query, then
Advanced Editor) loads it as Parquet with the query below. It reads the program
from a cell named `Decl`, builds it (a program the server already holds comes
straight back, so a refresh survives a restart), and loads the frame:

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

`Binary.Buffer` is required: without it `Parquet.Document` fails with a
"streamed binary values" error. Any name `GET /v1/objects/{id}/frame/{which}.csv`
serves works in place of `density_df` (`reins_density_df`, `stats_df`, ...).
Desktop Excel on Windows is the tested target. The server needs its `parquet`
extra; `/v1/meta` lists `parquet` under `frame_formats` when it has it.

## Data

Every program a formula builds goes to the server the add-in talks to and is
written to that server's audit log. **On a public server, never put real data
into DecL**, by typing it, by concatenating cells that hold it, or through a
Power Query.

## Development

The add-in lives in this directory and builds with webpack. The API base is
fixed at build time: `http://localhost:19456` for a development build, empty
(the origin that serves the add-in) for a production build. `AGG_API_BASE`
overrides either. The development default is the one local server that also
serves the Lab, so there is one API process to run, not two.

One time, from this directory:

```
npm install
```

Run the API with CORS open to the add-in's development origin. The add-in's
files come from the webpack dev server at `https://localhost:3000` while the
API answers on another port, so the browser treats them as two origins and the
API has to name the first one. From the repository root:

```
$env:AGGAPI_CORS_ORIGINS = "https://localhost:3000"
uv run --no-sync aggregate-api --port 19456
```

If the server is already running under a launcher, put the variable in the
launcher's environment and restart it once. Then, from this directory, build,
serve the add-in at `https://localhost:3000` and sideload it into desktop
Excel:

```
npm start
```

The first run asks to install a development certificate, which Office requires
for `https://localhost`. `npm stop` unloads the add-in. Excel on the web cannot
reach `localhost` at all, so the web is tested against the public server.

Checks:

```
npm test            unit tests: node --test over test/*.test.ts
npm run typecheck   tsc over src/
npm run build       production bundle in dist/
```

The bundle the server serves at `/excel` is built from the repository root:

```
.\scripts\build-excel.ps1                                    # Windows, for agg.mynl.com
./scripts/build-excel.sh                                     # the Linux host
.\scripts\build-excel.ps1 -Base https://other.host/excel     # another origin
```

It lands in `src/aggregate_api/excel_static/` (gitignored, and not in the
wheel), with the production manifest: every URL under the base and the server's
version. The server mounts `/excel` only when that directory exists, so the
first deploy needs one restart.

The tests read exhibit payloads captured from `library.agg` entries. To
capture them again (after a change to the exhibit format), from the repository
root:

```
uv run --no-sync python dev/capture_excel_fixtures.py
```

## Layout

| Path | Role |
|---|---|
| `src/functions/functions.ts` | the five functions, the request layer, the recipe table and the build memo |
| `src/functions/core.ts` | the pure logic, unit tested: handles, exhibit flattening, error messages, the recipe table |
| `src/taskpane/` | a short About page; the shared runtime loads it |
| `manifest.xml` | the development manifest, at `https://localhost:3000`; a production build rewrites it |
| `webpack.config.js` | the build, including the production manifest |
| `test/` | unit tests and their fixtures |
