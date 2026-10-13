// The DecL help's Load programs, under `node --test`.
//
// Only `loadables` is covered, which is the one decision the module makes about
// the library's page: the program comes from the `data-load` attribute and from
// nothing else, so a change to the page's markup cannot change what Load puts in
// the editor. Opening, closing and inserting are DOM wiring, checked by hand.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadables, UNAVAILABLE } from '../src/decl-help.js';

/** An element's worth of what `loadables` reads. */
const node = (load, text = 'markup the host must not read') =>
    ({ getAttribute: (name) => (name === 'data-load' ? load : null), textContent: text });

/** A root whose `[data-load]` query returns the given nodes. */
const root = (...nodes) => ({
    querySelectorAll: (sel) => { assert.equal(sel, '[data-load]'); return nodes; },
});

test('the program is the attribute, verbatim, in document order', () => {
    const table = node('agg Book\n  250 claims\n  sev lognorm 100 cv 1.5\n  poisson');
    const port = node('port Two.Books\n  agg A 1 claim dsev [1] fixed');
    const got = loadables(root(table, port));
    assert.deepEqual(got.map((x) => x.program), [
        'agg Book\n  250 claims\n  sev lognorm 100 cv 1.5\n  poisson',
        'port Two.Books\n  agg A 1 claim dsev [1] fixed',
    ]);
    assert.equal(got[0].node, table);
});

test('a bare or blank data-load offers nothing to load', () => {
    // A bare attribute is the library's unrendered source form; rendered, it is
    // always valued. A host shown the source must not offer an empty Load.
    assert.deepEqual(loadables(root(node(''), node('   \n'))), []);
});

test('the unavailable text names the release that brings the help', () => {
    assert.match(UNAVAILABLE, /aggregate 1\.2\.0$/);
});
