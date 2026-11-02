/**
 * Grade the library's validation verdict into one of the three strip states.
 *
 * Shared by `main.js` and `lite.js`, which each held a copy until 1.41.0.
 *
 * The library's verdict is prose, and "not unreasonable" is the *good* one: it
 * is the phrase a clean build reports. Anything mentioning the mean is a hard
 * failure, because a wrong mean means the grid cannot represent the
 * distribution at all; everything else (cv, skew, a defective distribution, an
 * infeasible grid) is a warning about accuracy rather than about correctness.
 *
 * The verdict is a list of clauses separated by `;`. Under a cession it opens
 * with a bare `reinsurance` clause, then one clause for the subject (gross) and,
 * since aggregate 1.56.0, one for the reported view, each closing in its own
 * reading: `reinsurance; subject not unreasonable; net not unreasonable`, or
 * `reinsurance; subject not unreasonable; net fails sev cv, agg cv`. A leading
 * reading about the grid or the analytic side, such as
 * `grid infeasible for this severity; not unreasonable`, is a clause of its own.
 *
 * So the grading is per clause: clean when every clause other than the bare
 * `reinsurance` closes in `not unreasonable`, a hard failure when any clause
 * names the mean, and a warning otherwise. Through 1.40.0 the reinsurance prefix
 * was stripped and the rest compared whole with `not unreasonable`, which read
 * the view clause 1.56.0 added as a failure and turned every clean reinsured
 * object amber.
 *
 * @param {string} text the `validation` field off the build response.
 * @returns {'ok'|'warn'|'bad'}
 */
export function validationState(text) {
    const clauses = String(text).trim().toLowerCase().split(';')
        .map((clause) => clause.trim())
        .filter((clause) => clause && clause !== 'reinsurance');
    if (clauses.length && clauses.every((clause) => /(^|\s)not unreasonable$/.test(clause))) {
        return 'ok';
    }
    return clauses.some((clause) => /\bmean\b/.test(clause)) ? 'bad' : 'warn';
}
