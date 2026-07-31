# GT2 adoption — start here (morning brief)

Written 2026-07-31 by the greater-tables side. Full spec with deliverables
and acceptance criteria: **`dev/plan-gt2-ir-adoption.md`** (this note is the
two-minute orientation; the spec is the contract).

## What exists, in one paragraph

`greater_tables` (GT2, `c:/s/ai/greatest-tables`, v1.9.0, unpublished — use
an editable path dep; see `note-gt2-rename.md`) replaces the 5.3 evaluation this repo
runs behind `?tables=gt`. Its engine turns a DataFrame into a versioned JSON
IR (a "table document": semantics only — dtypes, formats, hierarchy, spans,
break depths, flags; no widths, no CSS). Renderers consume the IR: a bundled
zero-dep JS walker (`gt-render.esm.js`, ships as package data with `gt.css`)
renders book-quality static tables client-side, and `irToGridInput(doc)`
flattens the same document into CsvGrid's `{columns, records}` input. So
**one `?format=ir` fetch feeds both sides of the Static/Interactive toggle**,
and the BeautifulSoup row-emphasis post-pass in `tables.py` dies (emphasis
rides in the IR via `row_flags`).

## The five-minute tour

```python
from greater_tables import build, TableSpec, canonical_json
doc = build(df, TableSpec(include_raw='data', max_rows=500,
                          row_flags={-1: ('total',)}))
body = canonical_json(doc)          # deterministic bytes; ETag = doc.hash
```

Serve `gt-render.esm.js` + `gt.css` from the installed package
(`importlib.resources.files('greater_tables') / 'assets'`) so walker and IR
can never version-skew. Client side: `renderTable(doc, {mount, allowHtml:
true})` for static; `irToGridInput(doc)` → `new CsvGrid(...)` for
interactive (usage snippet at the bottom of the spec).

## Hard rules

1. **Don't flatten the MultiIndex on the IR path** — pass the real DataFrame
   to `build`. The lossy `.`-join stays only on the legacy FrameResponse.
2. **`include_raw='data'` on the IR endpoint** — `irToGridInput` throws
   without it, by design.
3. **Bulk frames (65k density) never touch the IR** — keep the direct
   FrameResponse → CsvGrid fast path; IR is for toggle-able exhibits.
4. Gaps/bugs found: note them in the greater-tables repo's dev/, don't
   work around locally (that's how the bs4 pass happened).

## Confidence

159 tests in the GT2 repo, including byte-level conformance between the
Python HTML renderer and the walker (DOM transcripts), golden IR/text/TikZ
per fixture, and node round-trip tests on the adapter. Working demos:
`c:/s/ai/greatest-tables/demo.html` and `demo2.html` (double-click).
