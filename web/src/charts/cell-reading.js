// One clicked cell of a relief, as rows the fixed strip can draw.
//
// **A leaf module: it imports one formatter and nothing else.** The
// `reading-map.js`, `request-params.js` and `surface-grid.js` arrangement, and
// for the same reason. This lived inside `surfaceOverrides` in `surface.js`
// until a131, and `surface.js` imports `theme.js` and so `echarts`, which will
// not load outside a browser without stubs, so the arithmetic below was
// untestable where it stood.
//
// **No floating tooltip on the relief, per the author (2026-08-24).** Through
// a130 this was a `tooltip.formatter`, with a `tips` button asking whether the
// reader wanted it at all, and it had the two faults a tooltip has on a 3-D
// scene: it follows the cursor over the very thing it is describing and hides
// it, and it asks its question every time the cursor crosses the box. The
// reading goes in the strip above the chart now, beside the cut's own numbers,
// which is where the 2-D charts put theirs and where it neither moves nor covers
// anything.
//
// The two careful cases below are what make this more than a `toExponential`
// call at the call site, and they are why it is worth a test.

import { fmt } from '../utils/format.js';

/**
 * A reader turning a clicked `[x, y, h]` into named rows.
 *
 * Parameters
 * ----------
 * xName, yName : str
 *     The two component axis names, as the document spells them.
 * logZ : bool
 *     Whether the drawn height is a base-10 logarithm of the density.
 * zMin : number
 *     The log floor, in drawn units. Only meaningful when `logZ`.
 * digits : int, default 7
 *     Significant figures the encoding actually carried. Seven on float32, four
 *     on the log-quantized form. Comes off the document's declared dtype rather
 *     than a constant, which is what keeps the reading in step with the wire
 *     when the default encoding changes.
 * quantized : bool, default false
 *     Whether that encoding was the quantized one, which the reading says out
 *     loud rather than implying four figures are seven.
 *
 * Returns
 * -------
 * function
 *     Takes `[x, y, h]` or null, returns three `{name, value}` rows.
 *
 * Notes
 * -----
 * **A null reads as placeholders**, the three names with blank values, rather
 * than as nothing. The strip draws them from the first paint, so it holds its
 * height and nothing below the chart jumps on the first click. That is the same
 * reason the readout node is created before the first render.
 *
 * **A cell resting on the log floor reads `< 1e-12`, not `1e-12`.** The floor is
 * where the encoding stopped being able to say anything, not a density the model
 * puts there, and printing it as a number would be reporting the floor as data.
 */
export function makeCellReader({ xName, yName, logZ, zMin, digits = 7,
                                 quantized = false } = {}) {
    const readHeight = (v) => Number(v).toExponential(Math.max(0, digits - 1));
    const blank = () => [
        { name: xName, value: '' },
        { name: yName, value: '' },
        { name: 'density', value: '' },
    ];
    return (value) => {
        if (!Array.isArray(value) || value.length < 3) return blank();
        const [x, y, h] = value;
        if (![x, y, h].every(Number.isFinite)) return blank();
        const density = logZ ? 10 ** h : h;
        const height = (logZ && h <= zMin)
            ? `< ${(10 ** zMin).toExponential(0)}`
            : readHeight(density);
        return [
            { name: xName, value: fmt(x) },
            { name: yName, value: fmt(y) },
            { name: 'density', value: height,
              hint: quantized ? 'height is quantized' : undefined },
        ];
    };
}
