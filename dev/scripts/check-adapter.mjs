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
 * **The specs are checked too, since a160.** Cell values are only half of what
 * the adapter hands over; the other half is `formats`, and csv-grid parses every
 * one of them inside its constructor and THROWS on a spec it does not know,
 * which loses the whole table rather than one column. That is how `.5g` took
 * Overview / Validation out of the interactive view while every gate here
 * stayed green: this file compared numbers and nothing compared grammars.
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

/* Which presentation characters the INSTALLED csv-grid accepts, read out of its
 * bundle rather than copied into this file. A copy going stale is the exact
 * failure being guarded against, so a copy would be the wrong instrument. Null
 * when the literal cannot be found, which reports as a skip: a gate that cannot
 * read its own reference says so instead of passing.
 *
 * The literal is `/^(,)?(?:\.(\d+))?([fd%es])$/` in `parseFormatSpec`
 * (`src/grid/util.js` upstream). Matched on its distinctive tail. */
const GRID_DIR = new URL('../../web/node_modules/csv-grid/', import.meta.url);
function installedGrid() {
    let chars = null;
    let version = '?';
    try {
        const src = readFileSync(new URL('dist/csv-grid.es.js', GRID_DIR), 'utf8');
        const m = /\(\?:\\\.\(\\d\+\)\)\?\(\[([^\]]+)\]\)\$/.exec(src);
        chars = m ? m[1] : null;
    } catch { /* not installed; reported as a skip below */ }
    try {
        version = JSON.parse(
            readFileSync(new URL('package.json', GRID_DIR), 'utf8')).version || '?';
    } catch { /* same */ }
    return { chars, version };
}

/* Everything else `parseFormatSpec` takes before it reaches that regex: a
 * strftime pattern for a date column, and the two named number specs. */
function specParses(spec, chars) {
    if (spec === null || spec === undefined || spec === '') return true;
    if (/%[YymdHMSf%]/.test(spec)) return true;
    if (spec === 'year' || spec === 'eng') return true;
    return new RegExp(`^(,)?(?:\\.(\\d+))?([${chars}])$`).test(spec);
}

const grid = installedGrid();
console.log(`walker ${GT_RENDER_VERSION}, csv-grid ${grid.version}`
            + (grid.chars ? ` takes [${grid.chars}]` : ' grammar UNREADABLE'));
let findings = 0;
let specFindings = 0;

/** Report the specs this document carries that the installed grid would throw
 *  on. True when there are any. */
function checkSpecs(which, g) {
    if (!grid.chars) return false;
    const bad = (g.formats || [])
        .map((spec, j) => ({ spec, name: g.columns[j] }))
        .filter(({ spec }) => !specParses(spec, grid.chars));
    if (!bad.length) return false;
    const list = bad.map(({ spec, name }) => `${name}=${spec}`).join(', ');
    console.log(`${which.padEnd(24)} SPECS csv-grid cannot parse: ${list}`);
    return true;
}

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

    if (checkSpecs(which, g)) specFindings++;

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

/* Pass two: the exhibit blocks, for their specs alone. There is no
 * `FrameResponse` behind an exhibit, so nothing here can be compared against a
 * second rendering; what can be checked is whether the grid would accept the
 * grammar, and that is the half that broke. An exhibit whose document will not
 * adapt at all is reported too, since that loses the table just as completely. */
const specFiles = readdirSync(dir).filter((f) => f.endsWith('.spec.json')).sort();
for (const file of specFiles) {
    const which = file.replace('.spec.json', '');
    const doc = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
    let g;
    try {
        g = irToGridInput(doc);
    } catch (e) {
        console.log(`${which.padEnd(24)} THREW: ${e.message}`);
        specFindings++;
        continue;
    }
    if (checkSpecs(which, g)) specFindings++;
}
console.log(`${specFiles.length} exhibit block(s) checked for parseable specs`);

console.log();
if (specFindings) {
    console.log(`${specFindings} table(s) carry a format spec csv-grid `
                + `${grid.version} cannot parse. Every one of them draws NOTHING `
                + 'in the interactive view: the parse is in the constructor and '
                + 'it throws.');
    console.log('  `g` support landed in csv-viewer 3.10.0. If that is what is '
                + 'listed above, move the pin in web/package.json.');
}
if (findings) {
    console.log(`${findings} frame(s) differ: the interactive view is not what it was`);
}
if (findings || specFindings) process.exit(1);
console.log('clean: every document is interchangeable with its FrameResponse, '
            + 'and every spec it carries parses');
