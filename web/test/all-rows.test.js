// The All rows cell budget, under `node --test`.
//
// Run: `npm test` from `web/`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    ALL_ROWS_CELL_BUDGET, DENSITY_ROWS_KEY, allRowsPlan, frameCsvUrl, loadingLine,
    readDensityRows, writeDensityRows,
} from '../src/all-rows.js';

const FOUR = ['loss', 'p_total', 'F', 'S'];

test('the budget is the ruling', () => {
    assert.equal(ALL_ROWS_CELL_BUDGET, 3_500_000);
});

test('an aggregate at the log2 cap loads whole', () => {
    // 12 columns by 2**18 rows is 3.1M cells.
    const plan = allRowsPlan({ rows: 262144, columns: 12 }, FOUR);
    assert.equal(plan.whole, true);
    assert.equal(plan.columns, null);
    assert.equal(plan.note, '');
});

test('a four-unit portfolio at log2 16 loads whole; five units fall back', () => {
    assert.equal(allRowsPlan({ rows: 65536, columns: 53 }, FOUR).whole, true);
    const plan = allRowsPlan({ rows: 65536, columns: 63 }, FOUR);
    assert.equal(plan.whole, false);
    assert.deepEqual(plan.columns, FOUR);
    assert.equal(plan.cells, 65536 * 63);
});

test('the note says what was dropped and where the whole frame is', () => {
    const plan = allRowsPlan({ rows: 262144, columns: 113 }, FOUR);
    assert.equal(plan.note,
        '113 columns by 262,144 rows is 29.6M cells, over this table\'s 3.5M budget, '
        + 'so it shows 4 columns on every row. For the whole frame, download the .csv '
        + 'or work with it in Python through aggregate.');
});

test('a budget passed in is honored', () => {
    assert.equal(allRowsPlan({ rows: 100, columns: 10 }, FOUR, 999).whole, false);
    assert.equal(allRowsPlan({ rows: 100, columns: 10 }, FOUR, 1000).whole, true);
});

test('a missing shape counts as empty and fits', () => {
    assert.equal(allRowsPlan(null, FOUR).whole, true);
    assert.equal(allRowsPlan({}, FOUR).cells, 0);
});

test('the csv url carries the session and, when asked, the columns', () => {
    assert.equal(frameCsvUrl('', 'abc', 'density_df', null, 's-1'),
        '/v1/objects/abc/frame/density_df.csv?session=s-1');
    assert.equal(frameCsvUrl('http://h:8001', 'abc', 'density_df', FOUR, 's 1'),
        'http://h:8001/v1/objects/abc/frame/density_df.csv?session=s%201'
        + '&cols=loss%2Cp_total%2CF%2CS');
    assert.equal(frameCsvUrl('', 'abc', 'reins_density_df', [], 's'),
        '/v1/objects/abc/frame/reins_density_df.csv?session=s');
});

// ----------------------------------------------------------------------
// The All rows preference, persisted like Tables and Perspective
// ----------------------------------------------------------------------

/** A `localStorage` stand-in: a Map behind the two methods the helpers call. */
function storage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        map,
    };
}

test('the preference reads display by default and all only when stored as all', () => {
    assert.equal(DENSITY_ROWS_KEY, 'aggapi.densityRows');
    assert.equal(readDensityRows(storage()), 'display');
    assert.equal(readDensityRows(storage({ [DENSITY_ROWS_KEY]: 'all' })), 'all');
    // An old or hand-edited value is the default, never a third state.
    assert.equal(readDensityRows(storage({ [DENSITY_ROWS_KEY]: 'yes' })), 'display');
});

test('the preference round trips, and anything but all is written as display', () => {
    const store = storage();
    writeDensityRows(store, 'all');
    assert.equal(readDensityRows(store), 'all');
    writeDensityRows(store, 'display');
    assert.equal(store.map.get(DENSITY_ROWS_KEY), 'display');
    writeDensityRows(store, 'nonsense');
    assert.equal(store.map.get(DENSITY_ROWS_KEY), 'display');
});

test('a storage that throws reads as the default and swallows the write', () => {
    const refusing = {
        getItem() { throw new Error('private mode'); },
        setItem() { throw new Error('private mode'); },
    };
    assert.equal(readDensityRows(refusing), 'display');
    assert.doesNotThrow(() => writeDensityRows(refusing, 'all'));
});

test('the loading line reads the shape with thousands separators', () => {
    assert.equal(loadingLine({ rows: 65536, columns: 12 }), 'Loading 65,536 rows by 12 columns…');
    assert.equal(loadingLine(null), 'Loading 0 rows by 0 columns…');
});
