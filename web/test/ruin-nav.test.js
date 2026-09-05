// The Pr Ruin pill's gate, under `node --test`.
//
// The pill is a chart leaf: it lights from `available_charts` carrying `ruin`
// and greys with its own why otherwise, exactly the Plot leaf's mechanics.
// There is deliberately no `can_ruin` capability flag (see the API execution
// notes for `dev/plan-pk-tab.md`), so what these tests pin is that the leaf
// declaration and the generic gate compose: a served chart list is the whole
// switch, and the pill sits last in the Pricing row, after Evaluate.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NAV_GROUPS, capsFromResponse, leafAvailable, leafOf,
} from '../src/nav.js';

test('the pill sits fenced between Plot and Evaluate', () => {
    // `... Plot | Pr Ruin | Evaluate`: dividers both sides, so the reader
    // stepping between the two form-bearing leaves sees the row hold still.
    const keys = Object.keys(NAV_GROUPS.pricing.leaves);
    assert.equal(keys.at(-1), 'evaluate');
    assert.equal(keys.at(-2), 'ruin');
    const leaf = leafOf('pricing', 'ruin');
    assert.equal(leaf.label, 'Pr Ruin');
    assert.equal(leaf.chart, 'ruin');
    assert.equal(leaf.dividerBefore, true);
    assert.equal(leafOf('pricing', 'evaluate').dividerBefore, true);
    assert.ok(leaf.why.includes('frequency'));
});

test('a served ruin chart lights the pill', () => {
    const caps = capsFromResponse({ charts: ['density', 'ruin'] });
    assert.equal(leafAvailable(caps, 'pricing', 'ruin'), true);
});

test('a book without the chart greys it', () => {
    // A negbin book: priceable, so the group is live, but the library's own
    // frequency predicate withholds the chart and the pill follows it.
    const caps = capsFromResponse({ charts: ['density'], can_price: true });
    assert.equal(leafAvailable(caps, 'pricing', 'ruin'), false);
    assert.equal(leafAvailable(caps, 'pricing', 'calibrate'), true);
});
