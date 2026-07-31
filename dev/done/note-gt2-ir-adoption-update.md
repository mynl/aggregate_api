
## UPDATE 2026-07-31 (GT2 v1.8.0): irToGridInput shipped

`gt-render.esm.js` (and the iife global) now exports **`irToGridInput(doc)`**:
flattens a table document into CsvGrid input, so the Static/Interactive
toggle can run BOTH renderers off ONE `?format=ir` fetch:

```js
import { renderTable, irToGridInput } from '/assets/gt-render.esm.js';
// static side
const handle = renderTable(doc, { mount: host, allowHtml: true });
// interactive side — csv-grid unchanged
const g = irToGridInput(doc);
new CsvGrid(host2, { columns: g.columns, records: g.records },
            { formats: g.formats, align: g.align, worker: false, ... });
```

Notes: requires the endpoint to build with `include_raw='data'` (throws
otherwise); stubs un-sparsify, names join with ' / ', raw values ride
(nulls become ''), IR formats map to csv-grid format-spec strings.
Hierarchy/flags/foot rows are deliberately dropped (incompatible with
sort). Keep the direct FrameResponse → CsvGrid path for bulk frames
(density 65k etc.) — the IR path is for toggle-able exhibit tables only.
