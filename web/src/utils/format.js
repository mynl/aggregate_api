// Numeric formatting picked by magnitude.
//
// The aggregate library frequently produces values that span many
// decades inside a single table (loss = 0..1e7, probability = 1e-12..1).
// A single format string can't render both nicely, so fmt() picks per
// cell.

const INT_PATTERN = /^-?\d+$/;

/**
 * Format one value for display.
 *
 *   null / undefined / NaN  -> ""
 *   strings                  -> verbatim
 *   integers (|x| < 1e9)     -> "1,234"
 *   |x| in [1e-3, 1e6)       -> 6-significant-digit fixed
 *   else                     -> "1.234e+05" scientific
 */
export function fmt(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        // Already-formatted strings come through stats_df sometimes.
        return INT_PATTERN.test(value) ? value : value;
    }
    if (typeof value !== 'number') return String(value);
    if (!Number.isFinite(value)) return '';
    if (value === 0) return '0';

    const abs = Math.abs(value);
    if (Number.isInteger(value) && abs < 1e9) {
        return value.toLocaleString('en-US');
    }
    if (abs >= 1e-3 && abs < 1e6) {
        // 6 sig figs is a good readable default.
        return value.toPrecision(6).replace(/\.?0+$/, '');
    }
    // Scientific. toExponential(4) -> "1.2345e+05".
    return value.toExponential(4);
}

/**
 * The probability a base-10 exponent stands for, in scientific notation.
 *
 * Parameters
 * ----------
 * exponent : number
 *     A base-10 logarithm, as the `log10_density` and `log10_probability`
 *     chart units carry: `-467.7` stands for about `2.0e-468`.
 * digits : number
 *     Digits after the mantissa's point, as `toExponential` takes them.
 *
 * Returns
 * -------
 * string
 *     `'1.995e-468'`, or `''` for a missing or non-finite exponent.
 *
 * Notes
 * -----
 * The probability is never formed as `10 ** exponent`. In binary64 that is
 * subnormal below about -307.65 and zero below about -323.6, so the deep tail
 * this exists to read would print `0`. Instead the exponent splits into its
 * integer floor `e` and a mantissa `m = 10 ** (exponent - e)` in `[1, 10)`,
 * and the two are printed side by side.
 *
 * The mantissa carries. When `m` rounds to `10` at the requested digits
 * (`-400.00001` gives `m = 9.99997...`), it prints as `1.000` with the exponent
 * one higher, never as `10.000e-401`.
 */
export function log10ProbabilityText(exponent, digits = 3) {
    if (exponent == null || !Number.isFinite(Number(exponent))) return '';
    const v = Number(exponent);
    let e = Math.floor(v);
    let mantissa = (10 ** (v - e)).toFixed(digits);
    if (Number(mantissa) >= 10) {
        mantissa = (1).toFixed(digits);
        e += 1;
    }
    return `${mantissa}e${e < 0 ? '-' : '+'}${Math.abs(e)}`;
}

/** True if the value should align right in a table (numeric-ish). */
export function isNumeric(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return true;
    return false;
}
