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
 *     `{window}` when this chart holds a finite depth and `{lee}` when the
 *     reader has asked for the quantile curves, either, both or neither.
 *
 * Notes
 * -----
 * Only when the reader has moved a control off the library's own default.
 * Sending a parameter to say "do what you would have done" would put the app's
 * idea of the default into the URL, the cache key and the ETag, and the first
 * time the library changed its mind the app would be overriding it without
 * anybody deciding to. So `lee` travels only when it is on: `lee=false` is the
 * emitter's own default said back to it.
 *
 * Zero is a depth like any other (it keeps the whole grid), so that test is
 * finiteness rather than truthiness.
 *
 * Both are keyed by chart name for the reason the module header gives: a
 * parameter held flat is attached to every fetch, and every emitter that does
 * not take it answers 422. That cost every 2-D chart on every object at a91.
 */
export function chartParamsFor(view, chartName) {
    const depth = ((view && view.windows) || {})[chartName];
    const lee = ((view && view.lee) || {})[chartName];
    return {
        ...(Number.isFinite(depth) ? { window: depth } : {}),
        ...(lee ? { lee: true } : {}),
    };
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
 * The Lee map with one chart's curves asked for, or dropped.
 *
 * `windowsWith`'s sibling, and off for the same reason auto is: what is on
 * disk is exactly the set of charts a reader has an opinion about.
 *
 * Parameters
 * ----------
 * lee : object
 *     The map as held. Not mutated.
 * chartName : str
 *     Which chart the reader pressed the button on.
 * on : bool
 *     Whether the quantile curves are wanted.
 *
 * Returns
 * -------
 * object
 *     A new map.
 */
export function leeWith(lee, chartName, on) {
    const next = { ...(lee || {}) };
    if (on) next[chartName] = true;
    else delete next[chartName];
    return next;
}

/**
 * A stored chart view, with the keys nothing reads any more taken out.
 *
 * Run on a stored v3 entry, which is read once and dropped, and on the current
 * v4 entry every load, because the a121 move of the readings under `panels`
 * left its dead keys in the key that is still current rather than in a
 * superseded one.
 *
 * Parameters
 * ----------
 * stored : object
 *     The parsed entry, or anything at all: a value that is not a plain object
 *     migrates to nothing rather than throwing, since a corrupt entry must not
 *     cost the reader their charts.
 *
 * Returns
 * -------
 * object
 *     The same state without the flat `window` and without the six readings
 *     that went per panel at a121.
 *
 * Notes
 * -----
 * The flat `window` is the one thing v3 held that nobody chose for the charts
 * it was never offered on, which is the same argument the v2 to v3 bump
 * recorded in place. A poisoned browser therefore heals on its next load, with
 * no user action and no note in the release telling anybody to clear anything.
 *
 * The six flat readings are a different case and are stripped for tidiness
 * rather than for correctness. They went per panel at a121, under `panels` and
 * keyed by panel id, and nothing reads them at the top level any more, so a
 * blob still carrying them is inert rather than wrong. That is exactly why
 * `VIEW_KEY` did not need a bump for the move: the test
 * `dev/done/plan-chart-reflect.md` states is whether a stored value would now
 * mean something *wrong*, and an unread key means nothing at all. They come out
 * on the next write so the entry does not carry a generation of dead keys
 * forever. `refLines` is in the list even though it defaulted to true: what it
 * held was a document-wide answer to a question that is now asked per panel.
 */
const DEAD_VIEW_KEYS = new Set([
    'window', 'log', 'fullRange', 'reflect', 'returnPeriod', 'invert', 'refLines',
]);

export function migrateChartView(stored) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const migrated = {};
    for (const [key, value] of Object.entries(stored)) {
        if (!DEAD_VIEW_KEYS.has(key)) migrated[key] = value;
    }
    return migrated;
}

/**
 * The same state with every panel's two log readings taken out.
 *
 * The v4 to v5 half of the migration, run once on the superseded entry. It is
 * the case the bump exists for: a stored `logY: false` used to mean "no request
 * made", and the panel drew whatever its axis declared; from a173 it means
 * "linear", because the button now says linear as well as log. The one axis in
 * the library declaring a log default is the reins chart's occurrence density,
 * and every browser that had ever pressed a button on that panel held a
 * `logY: false` written by the old whole-view write, so without this the fix
 * would have shown up as the panel opening linear.
 *
 * Only these two keys and only inside `panels`: everything else a reader holds,
 * the realization, the surface preferences, the cut and the per-chart windows,
 * survives the bump untouched.
 *
 * Parameters
 * ----------
 * stored : object
 *     A migrated v4 entry.
 *
 * Returns
 * -------
 * object
 */
const PANEL_LOG_KEYS = new Set(['logX', 'logY']);

export function withoutPanelLogs(stored) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const panels = stored.panels;
    if (!panels || typeof panels !== 'object' || Array.isArray(panels)) return stored;
    const cleaned = {};
    for (const [id, blob] of Object.entries(panels)) {
        if (!blob || typeof blob !== 'object' || Array.isArray(blob)) continue;
        cleaned[id] = Object.fromEntries(
            Object.entries(blob).filter(([key]) => !PANEL_LOG_KEYS.has(key)));
    }
    return { ...stored, panels: cleaned };
}
