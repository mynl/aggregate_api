// A deep link's `view=<group>:<leaf>`, resolved to keys, under `node --test`.
//
// Keys and labels are both accepted, case-insensitive, key first. The key-first
// order only matters if a label ever shadows a different key at its level, so
// the last test pins that none does: today the order decides nothing.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NAV_GROUPS, resolveView } from '../src/nav.js';

test('key, mixed key and label, and label spellings are one view', () => {
    const want = { group: 'economics', leaf: 'pentagon' };
    assert.deepEqual(resolveView('pnl:pentagon'), want);
    assert.deepEqual(resolveView('economics:pentagon'), want);
    assert.deepEqual(resolveView('PnL:Pentagon'), want);
});

test('a leaf label resolves to its key', () => {
    assert.deepEqual(resolveView('pnl:summary'), { group: 'economics', leaf: 'ratios' });
    assert.deepEqual(resolveView('re:diagram'), { group: 'reinsurance', leaf: 'diagram' });
    assert.deepEqual(resolveView('pricing:pr ruin'), { group: 'pricing', leaf: 'ruin' });
});

test('a bare group has no leaf', () => {
    assert.deepEqual(resolveView('pnl'), { group: 'economics', leaf: null });
    assert.deepEqual(resolveView('Overview:'), { group: 'overview', leaf: null });
});

test('anything that matches nothing is null', () => {
    assert.equal(resolveView('pnl:nope'), null);
    assert.equal(resolveView('nope'), null);
    assert.equal(resolveView('nope:pentagon'), null);
    assert.equal(resolveView(''), null);
    assert.equal(resolveView(null), null);
});

test('no label shadows a different key at its level', () => {
    const groups = Object.keys(NAV_GROUPS);
    for (const group of groups) {
        const label = NAV_GROUPS[group].label.toLowerCase();
        const other = groups.find((g) => g !== group && g.toLowerCase() === label);
        assert.equal(other, undefined, `group label ${label} shadows group ${other}`);
        const leaves = NAV_GROUPS[group].leaves || {};
        for (const key of Object.keys(leaves)) {
            const leafLabel = (leaves[key].label || '').toLowerCase();
            const clash = Object.keys(leaves)
                .find((k) => k !== key && k.toLowerCase() === leafLabel);
            assert.equal(clash, undefined,
                `${group}: leaf label ${leafLabel} shadows leaf ${clash}`);
        }
    }
});
