// The deep link parse, under `node --test`.
//
// A link printed beside a figure in a paper has to keep working for as long as
// the paper is read, so the two pure halves are pinned here: reading
// `?database=<stem>&example=<name>` out of a query string, and taking exactly
// those two parameters back out of the address bar while leaving every other
// one (`?full=1`, `?lite=1`) where it was.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readDeepLink, withoutDeepLink } from '../src/examples.js';

test('both parameters', () => {
    assert.deepEqual(readDeepLink('?database=aas-paper&example=Fig3'),
        { database: 'aas-paper', example: 'Fig3' });
});

test('either parameter alone', () => {
    assert.deepEqual(readDeepLink('?database=reproductions'),
        { database: 'reproductions', example: null });
    assert.deepEqual(readDeepLink('?example=BasicBook'),
        { database: null, example: 'BasicBook' });
});

test('neither parameter is no link', () => {
    assert.equal(readDeepLink(''), null);
    assert.equal(readDeepLink('?full=1'), null);
    assert.equal(readDeepLink('?database=&example='), null);
    assert.equal(readDeepLink(undefined), null);
});

test('a dotted name needs no escaping, and an escaped one arrives decoded', () => {
    assert.equal(readDeepLink('?example=Bear1990.BN.One').example, 'Bear1990.BN.One');
    assert.equal(readDeepLink('?example=Bear1990%2EBN%2EOne').example, 'Bear1990.BN.One');
    assert.equal(readDeepLink('?example=A%20B').example, 'A B');
});

test('the leading question mark is optional and other parameters are ignored', () => {
    assert.deepEqual(readDeepLink('lite=1&database=x&example=y'),
        { database: 'x', example: 'y' });
});

test('surrounding whitespace from a pasted link is dropped', () => {
    assert.deepEqual(readDeepLink('?database=%20reproductions%20&example=Fig3%0A'),
        { database: 'reproductions', example: 'Fig3' });
});

test('clearing removes the two link parameters and keeps the rest', () => {
    assert.equal(withoutDeepLink('http://h/?database=r&example=E'), '/');
    assert.equal(withoutDeepLink('http://h/app/?full=1&database=r&example=E#x'),
        '/app/?full=1#x');
    assert.equal(withoutDeepLink('http://h/lite.html?lite=1&example=E'),
        '/lite.html?lite=1');
});
