// The Apps group in the hamburger menu: the other front ends this server
// mounts beside the playground (`AGGAPI_APPS`), as `GET /v1/meta` lists them.
// See dev/done/plan-front-end-apps.md.
//
// A pure renderer returning markup, so `node --test` can check it without a
// DOM. main.js puts the items between the group's header and divider and
// reveals both only when there is something to list.

/** Escape text for an element body or a double-quoted attribute. The titles
    come from each app's own `app.json`, which this repository does not author. */
function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The menu items for the mounted apps, one link each.
 *
 * Each item opens its app in the same tab, with the title as the label and the
 * description as the muted second line, the form the menu's other two-line
 * items use.
 *
 * @param {Array<{name: string, title: string, description: string, url: string}>} apps
 *     the `apps` array from `GET /v1/meta`.
 * @returns {string} one `<li>` per app, or the empty string when there are none.
 */
export function appsMenuHtml(apps) {
    return (apps || []).map((app) => {
        const line = app.description
            ? `<small class="d-block text-muted">${esc(app.description)}</small>`
            : '';
        return `<li><a class="dropdown-item" href="${esc(app.url)}">`
            + `${esc(app.title || app.name)}${line}</a></li>`;
    }).join('');
}
