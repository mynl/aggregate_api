// What a held view asks of the chart route, and the migration that stopped it
// asking for the wrong thing.
//
// **A leaf module: it imports nothing.** The `surface-grid.js` arrangement and
// for the same reason: what is decided here is which query parameters a fetch
// carries, and that decision was untestable while it lived in `mount.js`, next
// to a localStorage read at import time and an echarts import that will not
// load outside a browser. See `dev/plan-plot-2d-fix.md` F3.
//
// The bug that moved it here is worth stating, because the shape of the fix is
// the whole lesson. The window box is offered only on a chart that realizes as
// a surface, but through a91 it wrote a single flat `window` into the one
// sticky view state every chart on every object shares. `chartParams` then
// attached it to every fetch, the route answered 422 for every emitter that
// takes no grid options, which is every 2-D chart, and the app reported that
// refusal as a chart the library does not publish. One number a reader turned
// once, on one surface, and the agg, port, severity, distortion and reins
// charts went dark everywhere until localStorage was cleared.
//
// So: a request parameter is keyed by the chart it is a request about. The map
// needs no list of which charts take the knob, because the box only ever
// renders on a chart whose document realizes as a surface; the stored key set
// maintains itself, and a future grid chart gains its slot the day it offers
// the box.

/**
 * The request parameters a held view implies for one chart.
 *
 * Parameters
 * ----------
 * view : object
 *     The sticky reading state. Only its `windows` map is read, keyed by chart
 *     registry name. A missing or malformed map means no parameters, which is
 *     the library's own default and always a valid request.
 * chartName : str
 *     The chart about to be fetched, which is the key into that map.
 *
 * Returns
 * -------
 * object
 *     `{window}` when this chart holds a finite depth, `{}` otherwise.
 *
 * Notes
 * -----
 * Only when the reader has moved the box off the library's own default.
 * Sending a parameter to say "do what you would have done" would put the app's
 * idea of the default into the URL, the cache key and the ETag, and the first
 * time the library changed its mind the app would be overriding it without
 * anybody deciding to.
 *
 * Zero is a depth like any other (it keeps the whole grid), so the test is
 * finiteness rather than truthiness.
 */
export function chartParamsFor(view, chartName) {
    const windows = (view && view.windows) || {};
    const depth = windows[chartName];
    return Number.isFinite(depth) ? { window: depth } : {};
}

/**
 * The windows map with one chart's depth set, or dropped.
 *
 * Parameters
 * ----------
 * windows : object
 *     The map as held. Not mutated.
 * chartName : str
 *     Which chart the reader turned the box on.
 * depth : number or null
 *     The depth asked for, or null for the box left empty, meaning auto.
 *
 * Returns
 * -------
 * object
 *     A new map.
 *
 * Notes
 * -----
 * Auto deletes the key rather than storing a null, so what is on disk is
 * exactly the set of charts a reader has an opinion about, and a chart put
 * back to auto leaves no trace to explain later.
 */
export function windowsWith(windows, chartName, depth) {
    const next = { ...(windows || {}) };
    if (Number.isFinite(depth)) next[chartName] = depth;
    else delete next[chartName];
    return next;
}

/**
 * A stored v3 reading state, as v4 reads it.
 *
 * Parameters
 * ----------
 * stored : object
 *     The parsed v3 entry, or anything at all: a value that is not a plain
 *     object migrates to nothing rather than throwing, since a corrupt entry
 *     must not cost the reader their charts.
 *
 * Returns
 * -------
 * object
 *     The same readings without the flat `window`.
 *
 * Notes
 * -----
 * The readings themselves are a view the reader chose, so they carry over. The
 * flat `window` is the one thing v3 held that nobody chose for the charts it
 * was never offered on, which is the same argument the v2 to v3 bump recorded
 * in place. A poisoned browser therefore heals on its next load, with no user
 * action and no note in the release telling anybody to clear anything.
 */
export function migrateChartView(stored) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const migrated = {};
    for (const [key, value] of Object.entries(stored)) {
        if (key !== 'window') migrated[key] = value;
    }
    return migrated;
}
