/**
 * Stack and Round: the arithmetic behind the Quick Re row's Tower button.
 *
 * Three pure functions, no DOM and no fetch, so the web suite can exercise them
 * directly. The row itself lives in `main.js`, which owns the boxes, the
 * quantile lookup and the cede; this module only does the layering.
 *
 * `snap125` and `generateTower` are ported from the sibling experiment
 * `aggregate-asp` (`js/format.js` and `js/panels.js`). They are reproduced here
 * rather than shared because they are arithmetic, not a surface worth a
 * dependency between two repositories, and aSP is likely to be retired.
 *
 * The ladder is **not** aSP's. aSP walks the share down the stack, which is the
 * wrong way round for this row: see `shareLadder`.
 */

/** The quote-sheet grid, one decade of it. Multiplied by a power of ten. */
const SNAP_GRID = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/**
 * Snap an amount to the nearest quote-sheet number.
 *
 * A layer bound is something an underwriter writes on a slip, so 1,234,567 is
 * not a bound and 1,000,000 is. The grid is the usual one, `1, 1.5, 2, 2.5, 3,
 * 4, 5, 7.5, 10` times a power of ten.
 *
 * Nearest is measured in **log space**, not on the number line, which is what
 * makes the grid read evenly: 1,300 sits between 1,000 and 1,500 linearly but
 * is closer to 1,500 as a ratio, and a ratio is how a layer is judged. On the
 * line, every value in a decade would pull toward the sparse top of the grid.
 *
 * Parameters
 * ----------
 * x : number
 *     The amount to snap. Zero and negatives return zero: there is no
 *     quote-sheet number below the ground.
 *
 * Returns
 * -------
 * number
 *     The grid value nearest `x` in log space.
 */
export function snap125(x) {
    if (!(x > 0)) return 0;
    const decade = Math.pow(10, Math.floor(Math.log10(x)));
    let best = SNAP_GRID[0] * decade;
    let bestDistance = Infinity;
    for (const g of SNAP_GRID) {
        const v = g * decade;
        const d = Math.abs(Math.log(v / x));
        if (d < bestDistance) { bestDistance = d; best = v; }
    }
    return best;
}

/** At most this many bounds, so at most one fewer layer. aSP's cap. */
const MAX_BOUNDS = 10;

/**
 * Lay a span out as a stack of doubling, quote-sheet-rounded layers.
 *
 * Bounds start at `snap125(attach)` and then repeatedly `snap125(previous *
 * 2.1)`. The `2.1` rather than `2` is deliberate: doubling exactly lands
 * halfway between grid points as often as not, and the extra tenth biases the
 * snap upward so the stack keeps a doubling *feel* rather than oscillating
 * between a 1.5 step and a 2.5 step. The `previous * 1.5` floor is the
 * guarantee of progress: without it a snap could return the bound it was given
 * and the loop would never terminate.
 *
 * The top bound **reaches or passes** `detach` rather than stopping below it,
 * because the loop runs while the last bound is still under the detachment.
 * So a stack asked to reach 10,000 may top out at 15,000. That is the author's
 * ruling of 2026-10-06, carried over from aSP: every bound stays a quote-sheet
 * number, which is worth more than honoring the detachment to the digit. The
 * detachment is read as "reach at least this high".
 *
 * A ground-up span starts the stack at `snap125(detach / 64)` and keeps a first
 * layer running from zero, so a ground-up tower has layers rather than one
 * unbounded bottom.
 *
 * Parameters
 * ----------
 * attach : number
 *     Where the stack starts. Zero or less means ground up.
 * detach : number
 *     Where the stack is asked to reach.
 *
 * Returns
 * -------
 * Array<{attach: number, limit: number}>
 *     Bottom-up, disjoint, contiguous. Empty when the span is too narrow to
 *     stack at all, which happens when the snap carries the bottom bound above
 *     the detachment: the caller decides what one layer means there.
 */
export function generateTower(attach, detach) {
    const groundUp = !(attach > 0);
    const start = groundUp ? snap125(Math.max(detach, 1) / 64) : snap125(attach);
    const bounds = groundUp ? [0, start] : [start];
    while (bounds[bounds.length - 1] < detach && bounds.length < MAX_BOUNDS) {
        const previous = bounds[bounds.length - 1];
        bounds.push(Math.max(snap125(previous * 2.1), previous * 1.5));
    }
    const layers = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        layers.push({ attach: bounds[i], limit: bounds[i + 1] - bounds[i] });
    }
    return layers;
}

/** The top of the ladder, unless the row asked for more. */
const LADDER_TOP = 0.95;

/**
 * Walk a placed share **up** the stack, bottom to top.
 *
 * The author's ruling of 2026-10-06, and a reversal of aSP, which walks
 * `[0.95, 0.90, 0.90, 0.85]` downward and ignores whatever the share box says.
 * Shares never decrease with increasing attachment: the market places the
 * working layers it is nervous about thinly and the remote ones fully, so the
 * share the row typed belongs to the bottom layer and the ladder climbs from
 * there to `max(share, 0.95)` at the top.
 *
 * The endpoints are exact and the values between them are interpolated and
 * rounded to the whole percent, because a ladder of 68.75% and 77.5% is
 * arithmetic showing through rather than an underwriting judgment. Rounding can
 * in principle step a value a fraction of a point below the one under it, so
 * the result is clamped monotone afterward.
 *
 * A single-layer stack keeps the typed share untouched: it is the bottom layer,
 * and raising it to 95% because it is also the top would overrule the box.
 *
 * Parameters
 * ----------
 * share : number
 *     The bottom layer's placed share, a fraction in (0, 1].
 * count : number
 *     How many layers the stack has.
 *
 * Returns
 * -------
 * number[]
 *     One share per layer, bottom first, non-decreasing. All ones when the row
 *     asked for a fully placed program.
 */
export function shareLadder(share, count) {
    if (count <= 1) return count === 1 ? [share] : [];
    const top = Math.max(share, LADDER_TOP);
    const step = (top - share) / (count - 1);
    const out = [share];
    for (let i = 1; i < count - 1; i++) {
        const raw = Math.round((share + step * i) * 100) / 100;
        out.push(Math.max(raw, out[i - 1]));
    }
    out.push(Math.max(top, out[out.length - 1]));
    return out;
}
