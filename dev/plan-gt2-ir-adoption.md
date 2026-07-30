# Spec: greatest_tables IR adoption in aggregate_api

Handoff spec for the aggregate_api agent. Written by the greatest_tables
side 2026-07-30 (GT2 v1.5.0); mirrored at
`T:/worktrees/aggregate_api/dev/plan-gt2-ir-adoption.md`. Everything the SPA
needs ships in the installed package — this work is entirely in the
aggregate_api repo. Schedule alongside your other work as you see fit; the
pieces are independent and ordered below by dependency.

## Context

aggregate_api currently evaluates greater_tables 5.3 behind the sticky dev
flag `?tables=gt`: a server route returns `{rows, html}` blobs
(`src/aggregate_api/tables.py`, `routes/objects.py` `/frame/{which}.html`),
injected via innerHTML, with row emphasis added by a BeautifulSoup post-pass
stamping `<tr>` classes positionally. That evaluation concludes now:
**greatest_tables** (GT2, `c:/s/ai/greatest-tables`) replaces the whole path
with a semantic JSON IR ("table document") rendered client-side by a bundled
zero-dependency walker. csv-grid keeps the interactive/large-table role
unchanged.

Why this shape: the IR carries semantics only (dtypes, resolved formats,
hierarchy, spans, break depths, flags) — no widths, no CSS. The browser owns
geometry. Row emphasis rides in the IR (`row_flags`), which deletes the bs4
hack and its positional fragility. Full design: `dev/design.md` in the
greatest-tables repo.

## What the package provides (consume, don't reimplement)

- `pip`/uv dependency: unpublished — use an editable path source, the same
  pattern fiscus uses for csv-grid:
  `[tool.uv.sources] greatest-tables = { path = "c:/s/ai/greatest-tables", editable = true }`.
  Remove the old `greater-tables>=5.3` dependency.
- `from greatest_tables import build, TableSpec, canonical_json`:
  `doc = build(df, spec)` → validated, hash-stamped `TableDoc`;
  `canonical_json(doc)` → deterministic UTF-8 JSON bytes (same df + spec ⇒
  same bytes; `doc.hash` is a 12-hex content hash — use it as the ETag).
- Package assets via `importlib.resources.files('greatest_tables') /
  'assets'`: `gt-render.esm.js`, `gt-render.iife.js`, `gt.css`. Serving
  these from the installed package guarantees the walker can never version-
  skew against the IR the same process emits.
- Walker API (`gt-render.esm.js`):
  `renderTable(doc, {mount, allowHtml, katex, fit}) → {el, doc, destroy(), toCSV()}`.
  Instance root dispatches bubbling `gt:cellclick` CustomEvents with
  `{r, c, key, name, text, row}` (row keyed by ` / `-joined column names).
  `destroy()` on pane teardown, same discipline as the csv-grid registry.
- IR contract: `ir_version` 1, JSON Schema at `schema/ir-v1.json` in the
  greatest-tables repo. The walker throws on any other version. Unknown
  fields must be ignored by readers.

## Deliverables

### [dependency] swap greater-tables for greatest-tables
Editable path source as above; delete nothing else yet. Import smoke test:
`python -c "import greatest_tables"` must emit no warnings (GT 5.x's
import-time Pandas4Warning/warnings-filter pollution is gone — if you see
warnings, report upstream).

### [ir-endpoint] IR format on the frame routes
Add `?format=ir` to the existing frame endpoints (the same name map the CSV
route uses). Response: `canonical_json(doc)` bytes, `application/json`,
`ETag: doc.hash`. Build with:

```python
spec = TableSpec(include_raw='data', max_rows=500,
                 caption=..., row_flags=...)   # per exhibit as appropriate
doc = build(df, spec)
```

**Critical**: on this path the serializers must NOT flatten the MultiIndex
(no `.`-join, no reset_index) — pass the real DataFrame straight from the
object layer to `build`. The lossy flattening stays only on the legacy
`FrameResponse` JSON path for csv-grid.

Row emphasis: port the predicates from `tables.py:100-110` (the ones the
bs4 pass consumed) into `TableSpec.row_flags` — either a
`{position: [flags]}` dict or a callable `(row_position, row_series) ->
['total'|'subtotal'|'emphasis'|'muted']`.

### [post-frames] computed frames from POST endpoints
`PriceResponse`/`ReinsPriceResponse` carry computed frames that
`/frame/{which}` can't reach (noted in your `dev/TODO.md`). Add an optional
`ir` field (the parsed canonical JSON object) to those response models,
populated when the request asks for it (query param or request field — your
call). Same `include_raw='data'` spec.

### [serve-walker] static assets from the package
Routes (or StaticFiles mount) serving `gt-render.esm.js` and `gt.css` out of
`importlib.resources`. Cache-bust by GT2 version
(`greatest_tables.__version__`) or `?v=` param.

### [spa-toggle] static view renders the IR client-side
- Import `gt.css` into the SPA bundle (or link the served copy).
- Static/Interactive toggle: static side fetches `?format=ir` (or reads the
  `ir` field on POST responses) and calls
  `renderTable(doc, {mount, allowHtml: true})`; keep the instance in the
  pane registry and `destroy()` on rebuild, exactly like the csv-grid glue.
- csv-grid keeps the interactive side verbatim (its `FrameResponse` path is
  untouched). Note the walker never sorts/filters — by design; a table you
  want to sort belongs to csv-grid.
- Math cells arrive as TeX with a `math: true` flag; the walker emits
  `\(...\)` for page MathJax, or pass `katex` if you bundle it.

### [delete] the 5.x evaluation path
Once [spa-toggle] passes acceptance: delete `tables.py` (bs4 post-pass and
all), the `/frame/{which}.html` route and `HtmlFrameResponse`, the
`?tables=gt` sticky flag machinery, and the `renderExhibit` static renderer
if the walker now covers it. Record the eval conclusion in your TODO/notes.

## Acceptance

1. Dev servers up; portfolio loaded; toggling Static shows book-quality
   tables (multi-level headers with spanners, sparsified stub rowspans,
   partial rules, paren negatives, total-row emphasis) rendered client-side
   from the IR — no bs4, no server-rendered HTML blob.
2. A 70-row tail_df renders without any `large_ok` workaround; a 65k-row
   density frame stays on csv-grid (and `max_rows` truncates gracefully if
   the IR path is hit).
3. `ETag`/`If-None-Match` round-trip returns 304 on unchanged frames.
4. Repeat-render of the same object produces byte-identical IR (determinism
   — this is what makes the caching real).
5. No `beautifulsoup4` import remains for table emphasis.

## Non-goals

- No IR input into csv-grid (a later `irToGridInput` adapter in gt-render
  covers that if ever needed).
- No walker feature growth (sort/filter/virtualization stay out).
- fiscus is unaffected.

## Questions / drift

IR or walker gaps found during implementation: note them in the
greatest-tables repo's `dev/` (or its TODO) rather than working around them
locally — the conformance goldens there are the contract, and local
workarounds are how the bs4 pass happened the first time.
