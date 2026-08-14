// Tiny localStorage-backed history of successful DecL programs.
//
// Stored shape:
//   { entries: ["agg X …", "agg Y …", …], cursor: -1 }
//
// cursor === -1 means "no nav in progress". The next prev() returns the most
// recent entry, unless that is the text already in the editor, in which case it
// returns the one behind it (see prev()). Each successful build pushes the
// program onto the front, dedup-against-latest, capped at MAX entries.
//
// Browser-local by design -- per-user history would need an account.

const KEY  = 'aggregate-web:history';
const MAX  = 20;

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { entries: [], cursor: -1 };
        const obj = JSON.parse(raw);
        if (!Array.isArray(obj.entries)) return { entries: [], cursor: -1 };
        return obj;
    } catch { return { entries: [], cursor: -1 }; }
}

function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { /* storage full or disabled -- silent drop */ }
}

const state = load();

/** Record a successful program. Dedup'd against the most-recent entry. */
export function record(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    if (state.entries[0] === trimmed) return;
    state.entries.unshift(trimmed);
    if (state.entries.length > MAX) state.entries.length = MAX;
    state.cursor = -1;
    save(state);
}

/**
 * Step back one entry; returns text or null if no further history.
 *
 * `current` is the text in the editor, and it settles which of two places the
 * unset cursor is in. Straight after a build the editor holds `entries[0]`, so a
 * step back is a step to `entries[1]`: through a101 the first press handed back
 * the program already on screen, which is a keystroke that visibly does nothing.
 * Once the text has been edited it is a program the walk has not visited, so the
 * newest entry is a real destination and stays the first stop, which is how a
 * shell behaves with a half-typed line.
 */
export function prev(current = '') {
    const n = state.entries.length;
    if (n === 0) return null;
    const at = (state.cursor === -1 && (current || '').trim() === state.entries[0])
        ? 0
        : state.cursor;
    if (at + 1 >= n) return null;
    state.cursor = at + 1;
    save(state);
    return state.entries[state.cursor];
}

/** Step forward one entry; null when we've walked off the front. */
export function next() {
    if (state.cursor <= 0) {
        state.cursor = -1;
        save(state);
        return null;
    }
    state.cursor -= 1;
    save(state);
    return state.entries[state.cursor];
}

/**
 * Where the walk is, as `{m, n}`, for the `[m/n]` readout under the editor.
 *
 * `n` is how many programs the history holds and `m` is which one is on screen,
 * counted **from the newest**: the program you just built is `[1/20]` and the
 * oldest one you can reach is `[20/20]`. So the first press of Ctrl+Up takes
 * you to 2, and `m` is the number of steps back you have taken plus one.
 *
 * It read the other way round through a68, on the argument that a walk
 * *backwards* should count down. The author reads it as a stack, where the
 * thing in your hand is the first one, and a counter whose current position
 * changes every time you build (`[19/19]`, then `[20/20]`, then `[20/20]`
 * again once the cap bites) is telling you about the pile rather than about
 * where you are in it.
 *
 * `cursor` already runs this way, from the newest at 0; `-1` means no walk is
 * in progress, which is the same position as the newest entry, so both map to
 * `m === 1`.
 *
 * **In your history, not in this session.** The entries live in localStorage
 * and outlive the tab, so a session-scoped count is a number this module
 * cannot honestly produce. The label says what is really being counted.
 *
 * @returns {{m: number, n: number}} zeros when nothing has been built.
 */
export function position() {
    const n = state.entries.length;
    if (!n) return { m: 0, n: 0 };
    return { m: Math.max(state.cursor, 0) + 1, n };
}

/** Reset the nav cursor (called after the user types a new char). */
export function resetCursor() {
    if (state.cursor !== -1) {
        state.cursor = -1;
        save(state);
    }
}
