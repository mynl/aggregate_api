// The More / Exact tail leaf's gate, under `node --test`.
//
// A chart leaf on the Pr Ruin pattern: it lights from `available_charts`
// carrying `exact_tail`, which the library (`aggregate` 1.5.0) registers for an
// updated nttagg only, and greys with its own why otherwise. What these tests
// pin is that the leaf declaration and the generic gate compose, and that the
// leaf closes the More row right after Density, which keeps Density off the
// landing slot. Plan `dev/plan-1.13.0-exact-tail-leaf.md`.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NAV_GROUPS, capsFromResponse, leafAvailable, leafOf,
} from '../src/nav.js';

test('the leaf closes the More row, right after Density', () => {
    const keys = Object.keys(NAV_GROUPS.more.leaves);
    assert.equal(keys.at(-1), 'exact');
    assert.equal(keys.at(-2), 'density');
    const leaf = leafOf('more', 'exact');
    assert.equal(leaf.label, 'Exact tail');
    assert.equal(leaf.chart, 'exact_tail');
    assert.ok(leaf.why.includes('nttagg'));
});

test('a served exact_tail chart lights the leaf', () => {
    const caps = capsFromResponse({ charts: ['agg', 'approximation', 'exact_tail'] });
    assert.equal(leafAvailable(caps, 'more', 'exact'), true);
});

test('an object without the chart greys it and keeps Density', () => {
    // A plain aggregate: everything in More that is not a diagnostic is still
    // live, and the exact picture alone follows the chart list.
    const caps = capsFromResponse({ charts: ['agg'] });
    assert.equal(leafAvailable(caps, 'more', 'exact'), false);
    assert.equal(leafAvailable(caps, 'more', 'density'), true);
});
