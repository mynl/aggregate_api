// Tiny localStorage-backed history of successful DecL programs.
//
// Stored shape:
//   { entries: ["agg X …", "agg Y …", …], cursor: -1, draft: null }
//
// cursor === -1 means "no nav in progress". The next prev() returns the most
// recent entry, unless that is the text already in the editor, in which case it
// returns the one behind it (see prev()). Each successful build pushes the
// program onto the front, dedup-against-latest, capped by MAX and MAX_CHARS.
//
// `draft` is the unbuilt text the walk stepped away from, held so stepping
// forward off the newest entry hands it back. See prev() and DRAFT.
//
// Browser-local by design: per-user history would need an account.

const KEY = 'aggregate-web:history';
/* Two caps, and the second is the one that binds.
   A DecL program is short: the landing program is 63 characters and a large
   portfolio runs to about a thousand. At a generous 300 characters an entry,
   500 entries is 150KB of JSON in an origin that gets about 5MB, so the count
   is nowhere near the real limit and should not pretend to be.

   It was 20 through a115, which is what made the readout stop saying anything
   within a day of use: the counter froze at the cap and the number stopped
   moving on a build. The direction of the counter and this number were settled
   together on 2026-08-21; position() carries that reasoning.

   The character sum is the proxy for bytes. DecL is ASCII in practice, and one
   pass over the lengths beats a JSON.stringify per candidate. */
const MAX = 500;
const MAX_CHARS = 256 * 1024;
/* The walk is showing the stashed draft, which is not an entry and has no
   number. Distinct from -1, which means no walk is in progress. */
const DRAFT = -2;

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { entries: [], cursor: -1, draft: null };
        const obj = JSON.parse(raw);
        if (!Array.isArray(obj.entries)) return { entries: [], cursor: -1, draft: null };
        // `draft` post-dates the stored shape, so an object written by an older
        // build arrives without it.
        if (typeof obj.draft !== 'string') obj.draft = null;
        return obj;
    } catch { return { entries: [], cursor: -1, draft: null }; }
}

/**
 * Trim the oldest entries until both caps hold. Mutates and returns `entries`.
 *
 * The newest entry always survives, even when it alone breaks the character
 * ceiling: dropping the program that was just built is the exact failure this
 * and save()'s retry exist to avoid, and a reader who pastes a 300KB program
 * would rather keep it than be told the store has a rule about it.
 */
function trim(entries) {
    if (entries.length > MAX) entries.length = MAX;
    let chars = 0;
    for (let i = 0; i < entries.length; i += 1) {
        chars += entries[i].length;
        if (chars > MAX_CHARS) { entries.length = Math.max(i, 1); break; }
    }
    return entries;
}

/**
 * Write the state back, and try once more if the write is refused.
 *
 * Through a115 this swallowed the exception without a word, which at 20 entries
 * meant nothing. At 500 it means the program just built is dropped silently, so
 * an exception now trims the oldest quarter and retries. If that fails too the
 * in-memory state is left exactly as it is and the walk still works for this
 * session, which is the whole reason giving up quietly is acceptable.
 *
 * One limit recorded rather than fixed: iOS Safari evicts script-writable
 * storage for an origin the reader has not touched in seven days. A history
 * that vanishes after a fortnight away is that policy working, not a defect
 * here.
 */
function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return; }
    catch { /* full, disabled, or absent; one trim and one retry below */ }
    // The retry runs on a COPY, and the copy is adopted only if it lands. A
    // refusal is not always a full store: it is also a browser with storage
    // switched off and `node --test`, which has no localStorage at all. In both
    // of those every save throws, and trimming the live entries would eat the
    // session's own history a quarter at a time for no gain whatsoever.
    const kept = state.entries
        .slice(0, Math.max(Math.floor(state.entries.length * 0.75), 1));
    try {
        localStorage.setItem(KEY, JSON.stringify({ ...state, entries: kept }));
        state.entries = kept;
    } catch { /* still refused: the session keeps its in-memory walk intact */ }
}

const state = load();

/** Record a successful program. Dedup'd against the most-recent entry. */
export function record(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    if (state.entries[0] === trimmed) return;
    state.entries.unshift(trimmed);
    trim(state.entries);
    state.cursor = -1;
    // The program was built, so it is an entry now and there is nothing left to
    // hand back.
    state.draft = null;
    save(state);
}

/**
 * Where a step back starts from, as an index into `entries`.
 *
 * Three places map onto one number, which is why prev() and canPrev() share
 * this rather than each deciding for itself:
 *
 *   * showing the stashed draft, so a step back lands on the newest entry;
 *   * no walk in progress, and the editor holds the program that was just
 *     built, so the newest entry is where we already are;
 *   * no walk in progress and the text has been edited since, so the newest
 *     entry is a real destination.
 */
function stepFrom(current) {
    if (state.cursor === DRAFT) return -1;
    if (state.cursor !== -1) return state.cursor;
    return (current || '').trim() === state.entries[0] ? 0 : -1;
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
 *
 * That same edited text is what gets stashed. It is about to be replaced by an
 * entry, and through a115 it was simply gone: `next()` ran out at the newest
 * entry and left the reader holding a program they had not written. Ctrl+Z did
 * recover it, since setText dispatches a real change into CodeMirror's own
 * history, but nothing said so and a phone has no Ctrl+Z.
 */
export function prev(current = '') {
    const n = state.entries.length;
    if (n === 0) return null;
    const at = stepFrom(current);
    if (at + 1 >= n) return null;
    if (state.cursor === -1) {
        // The condition is the one `stepFrom` already computed: text that is
        // neither empty nor an entry is text the reader is about to lose.
        const text = (current || '').trim();
        state.draft = (text && text !== state.entries[0]) ? text : null;
    }
    state.cursor = at + 1;
    save(state);
    return state.entries[state.cursor];
}

/**
 * Step forward one entry, then off the newest one onto the stashed draft.
 *
 * Returns null when there is nowhere newer to go. The draft is kept rather than
 * cleared on the way out, so a reader who steps down to it and back up again
 * has not lost it a second time.
 */
export function next() {
    if (state.cursor === DRAFT) return null;
    if (state.cursor <= 0) {
        if (state.cursor === 0 && state.draft) {
            state.cursor = DRAFT;
            save(state);
            return state.draft;
        }
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
 * counted **up from the oldest**: the first program you ever built is `[1/1]`,
 * the second is `[2/2]`, and stepping back from the tenth reads `[9/10]`. The
 * newest entry carries the highest number, JupyterLab's `In[n]` and not a
 * stack.
 *
 * The direction and the cap in MAX were settled together on 2026-08-21, and the
 * order matters. It counted the other way from a68, on the argument that a
 * counter whose current position changes on every build (`[19/19]`, then
 * `[20/20]`, then `[20/20]` again once the cap bites) is telling you about the
 * pile rather than about where you are in it. That is an argument about the
 * **cap**: at 20 entries the number froze within a day of use and stopped
 * saying anything at all. At 500 it climbs on every build for as long as anyone
 * will use the app in one sitting, which is the whole point of a number that
 * moves.
 *
 * `cursor` is untouched by any of this. It still runs from the newest at 0, and
 * so does storage order; only the reported number is flipped.
 *
 * `m === 0` means "not in the history": nothing built yet, or the walk is
 * showing the stashed draft, which is not an entry and so has no number. The
 * readout draws blank in both cases, which is true in both cases. A glyph for
 * the draft position would buy a distinction nothing acts on.
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
    if (state.cursor === DRAFT) return { m: 0, n };
    return { m: n - Math.max(state.cursor, 0), n };
}

/**
 * Is there anything behind where the walk is standing?
 *
 * For the greying on the two step buttons. Exported rather than recomputed in
 * `main.js` because it is the same edge arithmetic `prev` does, and two copies
 * of that is where the two would drift apart. It takes the editor text for the
 * same reason `prev` does: the first step of a walk depends on it, which is
 * also why the control is refreshed on every edit.
 */
export function canPrev(current = '') {
    const n = state.entries.length;
    if (n === 0) return false;
    return stepFrom(current) + 1 < n;
}

/** Is there anything newer, an entry or the stashed draft? See canPrev. */
export function canNext() {
    if (state.cursor === DRAFT) return false;
    if (state.cursor === -1) return false;
    if (state.cursor > 0) return true;
    return Boolean(state.draft);
}

/**
 * The most recent program that declares `<kind> <name>`, or null.
 *
 * For the expiry pane. When a session's forked recipe base is evicted, a program
 * referring to something that session built comes back as a 422 naming the
 * `kind` and `name` that went missing. History still holds the program that
 * declared it, so the pane can offer the rebuild rather than describe it.
 *
 * Matched on the declaration head only: a DecL statement opens
 * `<kind> <Name> ...`, and the entries are stored collapsed to one line, so the
 * head is the first two tokens. Deliberately not a parse. This is a convenience
 * that either finds the program or does not; a wrong guess would show a button
 * that rebuilds something else, so the match is anchored and exact.
 *
 * @param {string} kind e.g. 'agg', 'port', 'sev'
 * @param {string} name the entry name
 * @returns {string|null}
 */
export function findDeclaring(kind, name) {
    if (!kind || !name) return null;
    // Escaped because both halves arrive from a server payload. DecL names are
    // identifiers in practice, so this guards the case where they are not.
    const quote = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const head = new RegExp(`^\\s*${quote(kind)}\\s+${quote(name)}(\\s|$)`);
    return state.entries.find((text) => head.test(text)) || null;
}

/**
 * Reset the nav cursor, called when the reader edits the document.
 *
 * The draft goes with it. Typing is the reader saying the text on screen is the
 * live one, and a stash left behind it would pop out later as a program nobody
 * asked for.
 */
export function resetCursor() {
    if (state.cursor === -1 && !state.draft) return;
    state.cursor = -1;
    state.draft = null;
    save(state);
}
