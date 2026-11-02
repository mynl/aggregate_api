// Short links, `/x/<entry code><view code>`, under `node --test`.
//
// The entry code is the server's (`tests/test_short_links.py` pins it); the
// view code is made here, and a printed link depends on it never changing, so
// one value is pinned. No two views may share a code, or a link would open on
// the wrong tab.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NAV_GROUPS, resolveView } from '../src/nav.js';
import { ALPHABET, VIEW_CODE_LENGTH, shortLinkFor, viewCode } from '../src/short-links.js';

test('the alphabet is 57 characters without the confusable five', () => {
    assert.equal(ALPHABET, '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');
    assert.equal(new Set(ALPHABET).size, 57);
    for (const char of '0O1lI') assert.ok(!ALPHABET.includes(char), char);
});

test('the view code is pinned', () => {
    assert.equal(viewCode('overview:plot'), 'tfx');
    assert.equal(viewCode('economics:pentagon'), 'qtB');
});

test('a view code is three characters of the alphabet', () => {
    for (const view of ['overview', 'more:density', 'lab:anything', '']) {
        const code = viewCode(view);
        assert.equal(code.length, VIEW_CODE_LENGTH);
        for (const char of code) assert.ok(ALPHABET.includes(char), char);
    }
});

test('no two views share a code', () => {
    const seen = new Map();
    for (const [group, def] of Object.entries(NAV_GROUPS)) {
        for (const view of [group, ...Object.keys(def.leaves || {}).map((l) => `${group}:${l}`)]) {
            const code = viewCode(view);
            assert.equal(seen.get(code), undefined, `${view} and ${seen.get(code)} share ${code}`);
            seen.set(code, view);
        }
    }
    assert.ok(seen.size > 30);
});

test('a short link view resolves to its keys', () => {
    assert.deepEqual(resolveView(`~${viewCode('economics:pentagon')}`),
        { group: 'economics', leaf: 'pentagon' });
    assert.deepEqual(resolveView(`~${viewCode('overview')}`), { group: 'overview', leaf: null });
    assert.equal(resolveView('~zzz'), null);
    assert.equal(resolveView('~'), null);
});

test('a short link is x/<code> against the base', () => {
    assert.equal(shortLinkFor('https://agg.mynl.com/', 'GTDNc', 'overview:plot'),
        'https://agg.mynl.com/x/GTDNctfx');
    assert.equal(shortLinkFor('https://agg.mynl.com/', 'GTDNc', null),
        'https://agg.mynl.com/x/GTDNc');
    assert.equal(shortLinkFor('http://127.0.0.1:8001/index.html', 'GTDNc', null),
        'http://127.0.0.1:8001/x/GTDNc');
    assert.equal(shortLinkFor('https://host/app/', 'GTDNc', 'overview:plot'),
        'https://host/app/x/GTDNctfx');
});
