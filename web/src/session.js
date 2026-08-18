// The session id this tab sends on every request.
//
// The server keeps one forked recipe base per session, so what the id buys is
// that your `agg Cat` is yours: your declarations resolve for you and are
// invisible to everyone else on the same process. Without it every visitor
// writes into one namespace and the last writer wins.
//
// It is a **namespace, not a credential**. Anyone holding it gets your objects,
// which is exactly why nothing here asks you to log in. Do not put anything
// behind it that would matter if it leaked.
//
// Shape is `<utc timestamp>-<uuid4>`. The timestamp is for reading in an audit
// row and in the About panel; the server never parses it, and eviction runs off
// the server's own clock, because a client clock cannot be trusted.
//
// `sessionStorage`, not `localStorage`, deliberately: a reload keeps the id, and
// a new tab or a new browser session mints a fresh one. So a session is one tab,
// which is the strictest reading of the author's ruling that a returning user
// starts afresh rather than finding their old programs waiting. Saving work is a
// separate feature (download the `.agg`, upload it back), not an accident of
// where the id was stored.

const KEY = 'aggregate-session-id';

/** The header the id travels in. Matches `aggregate_api.sessions.SESSION_HEADER`. */
export const SESSION_HEADER = 'X-Aggregate-Session';

/**
 * Mint an id.
 *
 * `crypto.randomUUID` needs a secure context (https or localhost), which the
 * app has everywhere it is deployed. The fallback is not a security measure and
 * is not trying to be: it keeps the app working over plain http on a LAN, where
 * the worst case is two tabs sharing a namespace.
 */
function mint() {
    const stamp = new Date().toISOString();
    const uuid = (globalThis.crypto && globalThis.crypto.randomUUID)
        ? globalThis.crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    return `${stamp}-${uuid}`;
}

let cached = null;

/**
 * This tab's session id, minted on first use and stable for the tab's life.
 *
 * Wrapped in try/catch because `sessionStorage` throws rather than returning
 * null when storage is disabled (Safari private browsing, a locked-down policy).
 * The id then lives in this module for the life of the page, which is the same
 * guarantee minus surviving a reload.
 */
export function sessionId() {
    if (cached) return cached;
    try {
        const held = sessionStorage.getItem(KEY);
        if (held) {
            cached = held;
            return cached;
        }
        cached = mint();
        sessionStorage.setItem(KEY, cached);
    } catch {
        cached = cached || mint();
    }
    return cached;
}

/**
 * The id as a query parameter, for the paths a header cannot reach.
 *
 * A download opened with `window.open` is a browser navigation, not a `fetch`,
 * so nothing can attach a header to it. Returns a `&`-prefixed fragment for
 * appending to a URL that already carries a query.
 */
export function sessionParam() {
    return `&session=${encodeURIComponent(sessionId())}`;
}
