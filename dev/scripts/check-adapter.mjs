/* Is a table document interchangeable with a FrameResponse, as far as CsvGrid
 * is concerned?
 *
 * That is the question a35 rests on: the SPA now fetches one `?format=ir`
 * document per table and derives the grid's input from it with
 * `irToGridInput`, instead of fetching a `FrameResponse` alongside. If the two
 * disagree about any cell, the interactive view silently changed.
 *
 * The comparison is done **after csv-grid's own coercion**, which is the only
 * fair place to do it. CsvGrid stringifies every cell before it infers column
 * types (`G()` in csv-grid.es.js), so `2` and `"2"` are the same input to it and
 * comparing raw JS values would report differences that do not exist. The
 * coercion below is lifted from that function verbatim; re-diff it if csv-grid's
 * normalizer changes.
 *
 * Driven by dev/scripts/check-adapter.py, which dumps the pairs and locates the walker
 * inside the installed package. Do not run this directly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , dir, walkerPath] = process.argv;
const { irToGridInput, GT_RENDER_VERSION } =
    await import(pathToFileURL(walkerPath).href);

// csv-grid's cell coercion, from G() in csv-grid.es.js. Null and NaN become the
// empty string; everything else becomes its String().
const cg = (v) => (v == null || (typeof v === 'number' && Number.isNaN(v))) ? '' : String(v);

// csv-grid's numeric regex and parse, from v() in csv-grid.es.js. It accepts
// thousands separators and currency symbols and strips them before parseFloat,
// which is why a difference of *presentation* between the two sides can still be
// the same number to the grid.
const NUMERIC = /^\(?(?:[+-]?[$£€¥￥]?|[$£€¥￥][+-]?)(?:[0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?\)?$/;
function cgNumber(s) {
    if (!NUMERIC.test(s.trim())) return null;
    const n = parseFloat(s.trim().replace(/[$£€¥￥,()%]/g, ''));
    return Number.isFinite(n) ? n : null;
}

/* Does a textual difference survive csv-grid's number parse?
 *
 * Stub columns carry formatted text rather than a raw value (by design: the IR
 * gives `raw` to data columns only), so a return period of 1000 arrives as
 * "1,000" from the document and "1000" from the frame. The grid parses both to
 * 1000, infers the column numeric either way, and sorts it numerically, so this
 * is presentation and not a defect. Anything that does NOT reduce to the same
 * number is a real difference and must fail. */
function benign(a, b) {
    const x = cgNumber(a);
    const y = cgNumber(b);
    return x !== null && y !== null && x === y;
}

console.log(`walker ${GT_RENDER_VERSION}`);
let findings = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.pair.json'))) {
    const which = file.replace('.pair.json', '');
    const { ir, frame } = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));

    let g;
    try {
        g = irToGridInput(ir);
    } catch (e) {
        console.log(`${which.padEnd(18)} THREW: ${e.message}`);
        findings++;
        continue;
    }

    const A = g.records.map((r) => g.columns.map((_, j) => cg(r[j])));
    const B = frame.rows.map((r) => frame.columns.map((_, j) => cg(r[j])));
    const headersSame = JSON.stringify(g.columns) === JSON.stringify(frame.columns);

    const real = [];
    const cosmetic = [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
        for (let j = 0; j < g.columns.length; j++) {
            const a = A[i]?.[j];
            const b = B[i]?.[j];
            if (a === b) continue;
            const line = `r${i} ${g.columns[j]}: IR=${JSON.stringify(a)} `
                       + `frame=${JSON.stringify(b)}`;
            (benign(a, b) ? cosmetic : real).push(line);
        }
    }

    const shape = `${A.length}x${g.columns.length}`;
    const ok = headersSame && real.length === 0;
    const cells = real.length === 0
        ? (cosmetic.length === 0 ? 'same' : `same (${cosmetic.length} reformatted)`)
        : `${real.length} DIFFER`;
    console.log(`${which.padEnd(18)} ${shape.padEnd(9)} `
                + `headers ${headersSame ? 'same' : 'DIFFER'}  cells ${cells}`);
    if (!headersSame) {
        console.log('    IR   :', JSON.stringify(g.columns));
        console.log('    frame:', JSON.stringify(frame.columns));
    }
    real.slice(0, 5).forEach((d) => console.log('    ', d));
    if (real.length > 5) console.log(`     ... ${real.length - 5} more`);
    if (cosmetic.length) console.log(`     e.g. ${cosmetic[0]} (same number to the grid)`);
    if (!ok) findings++;
}

console.log();
if (findings) {
    console.log(`${findings} frame(s) differ: the interactive view is not what it was`);
    process.exit(1);
}
console.log('clean: every document is interchangeable with its FrameResponse');
