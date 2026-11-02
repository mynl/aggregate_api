// The validation verdict graded into a strip state, under `node --test`.
//
// The strings are the library's own, from `aggregate._validation`, at 1.61.0.
// The reinsured forms are the ones 1.56.0 introduced, with a clause for the
// reported view after the subject's.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validationState } from '../src/verdict.js';

test('a clean verdict is ok, plain or reinsured', () => {
    assert.equal(validationState('not unreasonable'), 'ok');
    assert.equal(validationState('reinsurance; subject not unreasonable'), 'ok');
    assert.equal(validationState('reinsurance; subject not unreasonable; net not unreasonable'), 'ok');
    assert.equal(validationState('reinsurance; subject not unreasonable; ceded not unreasonable'), 'ok');
    assert.equal(validationState('  Not Unreasonable '), 'ok');
});

test('a failing mean anywhere is bad', () => {
    assert.equal(validationState('fails sev mean, agg mean'), 'bad');
    assert.equal(validationState('reinsurance; subject fails agg mean; net not unreasonable'), 'bad');
    assert.equal(validationState('reinsurance; subject not unreasonable; net fails sev mean'), 'bad');
    assert.equal(validationState(
        'grid infeasible for this severity; reinsurance; subject fails sev mean, agg mean; '
        + 'net fails sev mean, agg mean'), 'bad');
});

test('any other failing clause is a warning', () => {
    assert.equal(validationState('fails sev cv, agg skew'), 'warn');
    assert.equal(validationState('reinsurance; subject not unreasonable; net fails sev cv, agg cv'), 'warn');
    assert.equal(validationState('reinsurance; subject or view fails agg cv'), 'warn');
    assert.equal(validationState('grid infeasible for this severity; not unreasonable'), 'warn');
    assert.equal(validationState(
        'grid infeasible for this lattice (needs log2 17 at bs 1); fails sev cv, agg skew'), 'warn');
    assert.equal(validationState('analytic cv, skew undefined; not unreasonable'), 'warn');
    assert.equal(validationState('n/a, not updated'), 'warn');
    assert.equal(validationState(''), 'warn');
});
