// The /use page's deep links, under `node --test`.
//
// Run: `npm test` from `web/`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXCEL_ROUTES, USE_TABS, parseUseHash, useHash } from '../src/use-route.js';

test('each tab is its own link, in any case', () => {
    assert.deepEqual(parseUseHash('#jupyter'), { tab: 'jupyter', route: 'web' });
    assert.deepEqual(parseUseHash('#R'), { tab: 'r', route: 'web' });
    assert.deepEqual(parseUseHash('#r'), { tab: 'r', route: 'web' });
    assert.deepEqual(parseUseHash('#Sheets'), { tab: 'sheets', route: 'web' });
});

test('Excel takes a route after a hyphen; web is the default', () => {
    assert.deepEqual(parseUseHash('#excel'), { tab: 'excel', route: 'web' });
    assert.deepEqual(parseUseHash('#excel-desktop'), { tab: 'excel', route: 'desktop' });
    assert.deepEqual(parseUseHash('#Excel-Desktop'), { tab: 'excel', route: 'desktop' });
    assert.deepEqual(parseUseHash('#excel-web'), { tab: 'excel', route: 'web' });
    assert.deepEqual(parseUseHash('#excel-mac'), { tab: 'excel', route: 'web' });
});

test('anything else lands on Jupyter, the first tab', () => {
    for (const hash of ['', '#', '#nonsense', '#about', undefined, null]) {
        assert.deepEqual(parseUseHash(hash), { tab: 'jupyter', route: 'web' }, String(hash));
    }
});

test('the leading # is optional', () => {
    assert.deepEqual(parseUseHash('excel-desktop'), { tab: 'excel', route: 'desktop' });
});

test('useHash is the inverse, and leaves the default route out', () => {
    assert.equal(useHash('excel', 'web'), '#excel');
    assert.equal(useHash('excel', 'desktop'), '#excel-desktop');
    assert.equal(useHash('r', 'desktop'), '#r');
    for (const tab of USE_TABS) {
        for (const route of EXCEL_ROUTES) {
            const back = parseUseHash(useHash(tab, route));
            assert.equal(back.tab, tab);
            if (tab === 'excel') assert.equal(back.route, route);
        }
    }
});
