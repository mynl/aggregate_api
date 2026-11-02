/**
 * Short links, `/x/<entry code><view code>` (1.43.0).
 *
 * The entry code, 5 characters, is the server's: every `/v1/examples` item
 * comes with it as `link_code`, a hash of the file's stem and the entry name
 * (`src/aggregate_api/short_links.py`). The view code, 3 characters, is made
 * here, because the tabs are defined here (`NAV_GROUPS`, plus whatever Lab
 * leaves the server's plugins install). The server passes it back on the long
 * link as `view=~<code>`, and `resolveView` turns it into a tab by hashing every
 * view this page has until one matches.
 *
 * Nothing is stored anywhere, so **printed links depend on both hashes never
 * changing**. `short-link.test.js` pins a value of each.
 *
 * Pure: no DOM, no fetch.
 */

/**
 * The 57 characters a code is written in: `a-zA-Z0-9` without `0 O 1 l I`,
 * which a reader typing from a PDF cannot tell apart. The same string as
 * `ALPHABET` in `short_links.py`; the tests on both sides pin it.
 */
export const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Characters in a view code. */
export const VIEW_CODE_LENGTH = 3;

/**
 * FNV-1a, 32 bits, over the UTF-8 of `text`.
 *
 * Not SHA-256, which the server uses for entries: `crypto.subtle` exists only
 * in a secure context, and plain http on the VPN address is not one (the same
 * constraint behind `copyText`'s fallback). A view code distinguishes some
 * forty strings, so a short non-cryptographic hash is plenty, and the test
 * holds that no two views collide.
 *
 * @param {string} text
 * @returns {number} an unsigned 32-bit integer.
 */
function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(text)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}

/**
 * The view code for a view written in keys, `group:leaf` or a bare `group`.
 *
 * @param {string} view keys, as in a long link's `view`.
 * @returns {string} `VIEW_CODE_LENGTH` characters of `ALPHABET`.
 */
export function viewCode(view) {
    const base = ALPHABET.length;
    let value = fnv1a(String(view)) % base ** VIEW_CODE_LENGTH;
    let code = '';
    for (let i = 0; i < VIEW_CODE_LENGTH; i += 1) {
        code = ALPHABET[value % base] + code;
        value = Math.floor(value / base);
    }
    return code;
}

/**
 * A short link to `base` for one entry, on one view.
 *
 * Parameters
 * ----------
 * base : string
 *     An absolute URL, the public site or the page's own address. The link is
 *     `x/<code>` resolved against it, so a site served under a sub-path keeps
 *     its prefix, and a page address such as `/index.html` drops its file.
 * entryCode : string
 *     The item's `link_code`.
 * view : string or null
 *     Keys, `group:leaf` or `group`; null leaves the view code off, and the
 *     link opens the entry on its default tab.
 *
 * Returns
 * -------
 * string
 *     The link, absolute.
 */
export function shortLinkFor(base, entryCode, view) {
    const code = view ? `${entryCode}${viewCode(view)}` : entryCode;
    return new URL(`x/${code}`, base).href;
}
