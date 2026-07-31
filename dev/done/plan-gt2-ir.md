# plan-gt2-ir: the table document IR, and one global Static / Interactive switch

Status: **done**. Stage A landed as `1.0.0a32`, Stage B as `1.0.0a33`.

Implements `dev/plan-gt2-ir-adoption.md`, the handoff spec written from the
greatest_tables side, plus the author's scoping on top of it:

> Let's start just with the overview page: static = greatest-tables per the
> plan / interactive = CG as current. Then: all tables except the density (and
> others > 500 rows say) get GT|CG switches and can render each way. The switch
> is at the tab level, not the table level, that's too complex. In fact we
> should put it on the hamburger at the top to select one or the other.

## Verdict on the handoff spec

It holds. Every load-bearing claim was checked against a real portfolio before
any code moved (`summary_df`, `tail_df`, `density_df` from a two unit book):

| claim | result |
|---|---|
| clean import, no warnings pollution | confirmed, nothing raised |
| sparsified stub | `{"rowspan": 10, "text": "A"}`, the unit named once per block |
| deterministic bytes | same frame plus same spec, byte identical, twice |
| `doc.hash` usable as an ETag | 12 hex, content addressed, e.g. `61f3e43b427e` |
| graceful truncation | 600 rows at `max_rows=500` gives 500 body rows plus a note |
| `ir_version` survives canonical JSON | present as `1`, so the walker accepts it |

Two things the spec did not promise and the frames got anyway: the `neg` flag is
stamped per cell automatically, and `include_raw='data'` carries the unrounded
float beside the formatted text, so a copy or a CSV export off the walker gives
real numbers rather than display strings.

The installed package is **1.6.0**, not the 1.5.0 the spec names, and its
bundled walker asset reports `1.6.0` too. `ir_version` is 1 in both, which is
the contract that matters.

### Where this deviates, and why

1. **`?format=ir` rides a new `GET /objects/{oid}/frame/{which}`**, not the
   `.csv` route. Verified that Starlette resolves `/frame/summary.csv` to the
   `.csv` route and `/frame/summary` to the new one, because path parameters
   match a dot. Route order carries that, so a test pins it: reordering the two
   would silently turn every CSV download into JSON.
2. **Row flags use the IR vocabulary rather than reproducing the old classes.**
   The bs4 pass stamped `grt-row-hi` (a yellow wash on the capital anchors) and
   `grt-row-em` (bold). The IR vocabulary is total / subtotal / emphasis /
   muted, so the predicates map onto meaning instead of onto styling:

   | frame | condition | old | new |
   |---|---|---|---|
   | summary | `unit == 'total'` | bold | `total` |
   | summary | `X == 'Agg'` | bold | `subtotal` |
   | tail_df | `unit == 'total'` | bold | `total` |
   | tail_df | `T` in (200, 250) | yellow | `emphasis` |

   That is a better fit than it looks. The portfolio total row really is a
   total, a unit's Agg line really is that unit's subtotal, and the capital
   anchors are the only rows left wanting plain emphasis. It also means
   `emphasis` is unambiguous across both frames, so the yellow can come back as
   one scoped rule on `.gt-emph` rather than as a class the server invents.
3. **Cache busting is `ETag` plus `Cache-Control: no-cache`, not `?v=`.** Same
   guarantee, and the client needs to know no version number to get it.
4. **The static / interactive choice is global**, per the author's note above,
   so it is not the per-exhibit toggle the spec assumed. See Stage B.

## Stage A (a32): the IR pipeline, Overview only

The smallest change that answers "does the walker look right in this page".
Everything downstream is built on that answer, so it comes first on its own.

**Dependency.** `greatest-tables` by editable path source, mirroring what
`aggregate` already does. `greater-tables>=5.3` comes out.

**`GET /v1/objects/{oid}/frame/{which}?format=ir`.** Reuses `_CSV_FRAMES` and
`_resolve_frame`, so it reaches every frame the CSV route reaches. Returns
`canonical_json(doc)` bytes as `application/json` with `ETag: doc.hash`, and
honors `If-None-Match` with a 304. The frame goes to `build` **with its index
intact**: no `reset_index_safe`, no flattened MultiIndex. That lossy step stays
on the `FrameResponse` path, which is the grid's, and losing that distinction is
how the whole exercise would become pointless.

**`GET /v1/assets/{name}`** serves `gt-render.esm.js` and `gt.css` out of
`importlib.resources.files('greatest_tables') / 'assets'`. Serving the walker
from the package that emitted the IR is the point: the two cannot version skew,
because one process ships both.

**`web/src/tables.js`** loads the walker once, lazily, by dynamic import of that
served URL, and injects `gt.css` as a one-time `<link>`. The returned handle
goes into the pane teardown registry so `clearGrids` destroys IR tables too, and
no call site has to learn about a second registry.

**Overview** renders its static side from the IR. `renderExhibit` and its
hand-built highlight / emphasis come out, since the walker covers them.

**Deletions**, per the spec's `[delete]`: `tables.py`, the `/frame/{which}.html`
route, `HtmlFrameResponse`, `api.frameHtml`, the `?tables=gt` sticky flag,
`mountStaticTable`, `renderExhibit`, and the `beautifulsoup4` import that
existed only for row emphasis.

## Stage B (a33): every table, one switch in the hamburger

**One global preference**, `aggapi.tableView`, static or interactive, seeded
from the old `aggapi.overviewView` so a returning browser keeps its choice.

**Two affordances, one state.** A Tables section in the hamburger dropdown, and
the Overview's existing pill row, which now writes the global preference. They
stay in sync because there is only one value to read.

**Gating is by row count, not by frame name.** `staticOk(frame)` is
`rows.length <= 500`. That covers the density frames the author named without a
list to maintain, and it covers anything else that grows past readable. When
static is selected and a frame is over the line, the grid renders and says so in
one muted line, rather than the control silently doing nothing.

**Reach**: More (validation, stats, bs window), Reins (summary, stats, and the
per-layer frames), Price (pentagon, calibrated distortions, the four
per-distortion slices, and the reinsurance pricing table).

**`[post-frames]`.** Price frames are computed by POST endpoints, so
`/frame/{which}` cannot reach them. `PriceResponse` and `ReinsPriceResponse`
gain an optional flat `ir` map, keyed to mirror their frame fields, populated
when the request asks with `?ir=true`. The SPA always asks, so flipping the
switch after a pricing run never costs a re-POST.

## Verification

105 pytest passing, `ruff check src` clean, 17 exhibit smoke checks clean, SPA
build clean with the walker confirmed **absent** from the bundle (it is fetched
from `/v1/assets` at runtime).

New tests: the IR route returns `ir_version` 1 and a sparsified stub (a
portfolio's unit named once with `rowspan` 10, not once per return period); rows
carry semantic flags; cells carry raw values beside their text; the ETag round
trip 304s; two builds of one frame are byte identical; a density frame truncates
with a note; `.csv` still returns CSV with the new route declared; the asset
routes serve the walker and its stylesheet with the right content types and
refuse anything else; the Price documents are opt-in and cover every frame the
tab renders, with the index the wire format flattens still intact.

Two checks beyond the suite, both worth repeating if this area moves:

1. **The walker against real documents.** `linkedom` plus the shipped
   `gt-render.esm.js`, fed the actual `summary` and `tail_df` documents from a
   two unit portfolio. Confirms `rowspan="10"` stubs, `gt-total` / `gt-emph` /
   `gt-subtotal` rows, `gt-neg` cells, the stub divider, partial rules at index
   breaks, and `toCSV({values: true})` returning unrounded numbers.
2. **A frame-by-kind sweep.** Every name in `_CSV_FRAMES` against agg, port,
   reinsured agg, dice, sev and distortion. Every cell either builds a document
   or returns a clean 400/404; nothing 500s.

Still not verified, and the reason Stage A stood alone: **how it looks**. Nobody
has seen one of these in the page.

## Left open

- Math. The walker emits `\(...\)` for page MathJax unless a `katex` object is
  passed, and the SPA loads neither. Same decision as the chart titles in
  `dev/graphs.md`, so make it once for both.
- The walker never sorts or filters, by design. A table worth sorting is the
  grid's, which is what the row-count gate already says.
- `requires-python` went from `>=3.11` to `>=3.13`, forced by
  `greatest-tables`. Nothing in its source appears to need 3.13. Raise it there.
