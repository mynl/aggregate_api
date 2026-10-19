// The /use page's deep links: which tab and which Excel route a hash names.
//
// `agg.mynl.com/use#r` and friends are links people paste into mail and
// slides, so the reading is forgiving: case is ignored (`#R`), an unknown tab
// lands on Jupyter, and an unknown route on the web one. Pure, so it tests
// under `node --test` without a DOM. See `dev/done/plan-use-page.md`.

/** The tabs, in the order the page shows them. The first is the default. */
export const USE_TABS = ['jupyter', 'r', 'excel', 'sheets'];

/** Excel's two routes. The first is the default. */
export const EXCEL_ROUTES = ['web', 'desktop'];

/**
 * Read a location hash as a tab and an Excel route.
 *
 * @param {string} hash `location.hash`, with or without its leading `#`.
 * @returns {{tab: string, route: string}} The route is read for any tab, so
 *     `#jupyter` followed by a click on Excel still opens the web route.
 */
export function parseUseHash(hash) {
    const [tab, route] = String(hash || '').replace(/^#/, '').toLowerCase().split('-');
    return {
        tab: USE_TABS.includes(tab) ? tab : USE_TABS[0],
        route: EXCEL_ROUTES.includes(route) ? route : EXCEL_ROUTES[0],
    };
}

/**
 * The hash that names a tab and route: the inverse of `parseUseHash`.
 *
 * The web route is Excel's default, so it is left out: `#excel`, never
 * `#excel-web`. Only Excel carries a route.
 *
 * @param {string} tab one of `USE_TABS`.
 * @param {string} route one of `EXCEL_ROUTES`.
 * @returns {string} The hash, with its `#`.
 */
export function useHash(tab, route) {
    return tab === 'excel' && route === 'desktop' ? '#excel-desktop' : `#${tab}`;
}
