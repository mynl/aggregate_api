// Tiny localStorage-backed history of successful DecL programs.
//
// Stored shape:
//   { entries: ["agg X …", "agg Y …", …], cursor: -1 }
//
// cursor === -1 means "no nav in progress" (next prev() returns the
// most recent entry). Each successful build pushes the program onto
// the front, dedup-against-latest, capped at MAX entries.
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

/** Step back one entry; returns text or null if no further history. */
export function prev() {
    if (state.entries.length === 0) return null;
    if (state.cursor + 1 >= state.entries.length) return null;
    state.cursor += 1;
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
 * `n` is how many programs the history holds and `m` is which one is on
 * screen, counted from the oldest so that stepping back with Ctrl+Up counts
 * *down*, which is the direction the reader feels.
 *
 * `cursor` runs the other way, from the newest at 0, and `-1` means no walk is
 * in progress, which is the same position as the newest entry. Both map to
 * `m === n`.
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
    return { m: n - Math.max(state.cursor, 0), n };
}

/** Reset the nav cursor (called after the user types a new char). */
export function resetCursor() {
    if (state.cursor !== -1) {
        state.cursor = -1;
        save(state);
    }
}
