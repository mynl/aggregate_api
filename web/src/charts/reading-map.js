// The coordinate maps a declared reading applies to an axis, composed.
//
// **A leaf module: it imports nothing.** The `request-params.js` and
// `surface-grid.js` arrangement, and for the same reason: what is decided here
// is arithmetic, and it was untestable while it lived in
// `chartdoc-to-echarts.js`, which imports `theme.js` and so `echarts` and will
// not load outside a browser without stubs. See `dev/plan-chart-reflect.md` A2.
//
// Two readings map an axis' values rather than merely relabeling it, and both
// act on the same probability axis of a Lee panel, so they have to compose:
//
//   reflect        v to 1 - v, a non-exceeding probability read as the
//                  exceeding one, which turns a distribution function into a
//                  survival function
//   return period  v to T, through the document's own map
//
// **Reflecting the coordinate and exchanging `complement` with `reciprocal`
// are two spellings of one operation, not two that compose.** Written out,
//
//   complement(v) = 1 / (1 - v)      reciprocal(v) = 1 / v
//   complement(1 - v) = 1 / v        = reciprocal(v)
//   reciprocal(1 - v) = 1 / (1 - v)  = complement(v)
//
// so doing both cancels exactly and reflect becomes a no-op wherever the
// return period is on. This module does exactly one: it reflects the value and
// leaves the document's map name alone. There is deliberately no flipped-map
// table here, and the absence is the point.
//
// What that buys is the reading the author asked for. A log return-period axis
// opens out whichever end of the probability axis sends T to infinity:
// `1 / (1 - p)` diverges as p approaches 1 and stretches the right end of the
// curve, `1 / p` diverges as p approaches 0 and stretches the left. So on a
// loss, where the map is 'complement', the return period alone opens the right
// end and adding reflect opens the left; on a signed payoff, where the map is
// 'reciprocal', the pair swaps the shortfall for the upside. Either way the
// two readings never draw the same curve, which is the property the tests
// pin, because a composition that cancels is precisely the bug above.

/**
 * Return periods from the probabilities on a paired axis.
 *
 * Parameters
 * ----------
 * values : Array<number|null>
 *     Probabilities, gaps included.
 * how : str
 *     'reciprocal' (`T = 1 / v`, the literal reading and the default) or
 *     'complement' (`T = 1 / (1 - v)`), off `ChartDoc.meta.return_period_map`.
 *
 * Returns
 * -------
 * Array<number|null>
 *
 * Notes
 * -----
 * The quantile function saturates at its far end, where T diverges, so a
 * non-finite or non-positive result becomes a gap: the curve stops where the
 * grid stops knowing rather than running out to an invented bound.
 * `_chartdoc._return_periods`.
 */
export function returnPeriods(values, how) {
    return values.map((v) => {
        if (v == null) return null;
        const t = how === 'complement' ? 1 / (1 - v) : 1 / v;
        return (Number.isFinite(t) && t > 0) ? t : null;
    });
}

/**
 * The composed coordinate map for one axis, or null when it is the identity.
 *
 * Parameters
 * ----------
 * reflected : bool
 *     The axis is being read as its complement, `1 - v`.
 * period : str or null
 *     The return-period map name, or null for no return-period reading. The
 *     document's own name, applied to whatever coordinate is being read: see
 *     the module note on why this is not flipped when `reflected`.
 *
 * Returns
 * -------
 * function or null
 *     A function of an array of values, or null when neither reading applies,
 *     which callers pass through as "draw the coordinates as they arrived".
 *
 * Notes
 * -----
 * Null rather than an identity function so that the caller can keep telling
 * "a map is active" from "no map", which is a distinction two behaviors in the
 * panel realizer still need to make.
 *
 * Reflection preserves gaps and array order. Order matters: the step drawing
 * is defined on the order of the points given rather than on the direction of
 * the axis, so mirroring the values mirrors the ladder with them and a
 * right-continuous step becomes left-continuous for free. `_chartdoc`'s
 * `_render_xy_panel` records the same argument for matplotlib's drawstyles.
 */
export function readingMap(reflected, period) {
    if (!reflected && period == null) return null;
    return (values) => {
        const v = reflected
            ? values.map((u) => (u == null ? null : 1 - u))
            : values;
        return period == null ? v : returnPeriods(v, period);
    };
}
