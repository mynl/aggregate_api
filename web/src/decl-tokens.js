// DecL word classes and the tokenizer behind the editor's syntax coloring.
//
// Kept apart from decl-mode.js, which imports the word list as JSON through
// Vite, so that `node --test` can load this module as it is: it imports
// nothing, and its caller hands it the word list's groups.
//
// The tokenizer is a CM6 StreamLanguage state machine, the right tool for a
// small DSL where we don't want to ship a real parser to the browser. It is
// intentionally permissive (a few false positives in coloring are fine; the
// server-side parser is authoritative for errors).
//
// Token classes (mapped to CM6 standard tags by tags.js):
//   "keyword"   a DecL word: reserved words, frequencies, declarations,
//               clauses, `inf`, severity and mixing names
//   "atom"      a distortion name, and only that
//   "number"    100, 1.5, 1e-3, the leading integer of 1/4
//   "string"    'x', "x", note{...}
//   "comment"   # to end of line
//   "bracket"   [ ] ( )

/**
 * Split the word list's groups into the two colored classes.
 *
 * @param {Object<string, string[]|Object<string, number|null>>} groups
 *     The `groups` of `python -m aggregate.decl_words`: each a list of words,
 *     except `severities`, an object whose keys are the words.
 * @returns {{keywords: Set<string>, atoms: Set<string>}}
 *     Lowercased word sets. `atoms` holds the words found only in
 *     `distortions`; every other word is a keyword.
 *
 * Notes
 * -----
 * The library's rule for a word in several groups: it is a keyword, and only a
 * word found solely in `distortions` is colored as a distortion name. Today
 * that word is `beta`, a severity, a mixing distribution and a distortion, and
 * a colorizer reading words without their context cannot tell `sev beta` from
 * `distortion beta`.
 *
 * Both the sets and the looked-up word are lowercased, which is how the
 * registry's `bitvar` colors `biTVaR` and how `neymanA` keeps working.
 */
export function wordClasses(groups) {
    const keywords = new Set();
    const atoms = new Set();
    for (const [group, words] of Object.entries(groups)) {
        if (group === 'distortions') continue;
        const list = Array.isArray(words) ? words : Object.keys(words);
        for (const w of list) keywords.add(w.toLowerCase());
    }
    for (const w of groups.distortions ?? []) {
        const word = w.toLowerCase();
        if (!keywords.has(word)) atoms.add(word);
    }
    return { keywords, atoms };
}

// Identifier shape mirrors decl.lark's ID terminal,
// [A-Za-z][A-Za-z0-9._:~-]*, underscore included.
const ID_START = /[A-Za-z]/;
const ID_BODY  = /[A-Za-z0-9._:~\-]/;
const DIGIT    = /[0-9]/;

function readIdent(stream) {
    stream.eat(ID_START);
    while (!stream.eol() && ID_BODY.test(stream.peek())) stream.next();
    return stream.current();
}

/** The tokenizer's state at the start of a document. */
export function startState() {
    return { inBraceString: false };
}

/**
 * Make the StreamLanguage `token` function over two word sets.
 *
 * @param {{keywords: Set<string>, atoms: Set<string>}} classes
 *     From {@link wordClasses}.
 * @returns {function(object, object): (string|null)}
 *     `token(stream, state)`, which consumes one token from a CM6
 *     `StringStream` and returns its class, or null for an uncolored token.
 */
export function makeTokenizer({ keywords, atoms }) {
    return function token(stream, state) {
        // ----- brace string continuation (note{...} multi-line) -----
        if (state.inBraceString) {
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '}') { state.inBraceString = false; return 'string'; }
            }
            return 'string';
        }

        // ----- whitespace -----
        if (stream.eatSpace()) return null;

        // ----- comment -----
        if (stream.peek() === '#') {
            stream.skipToEnd();
            return 'comment';
        }

        // ----- brace string (note{...}) -----
        if (stream.peek() === '{') {
            stream.next();
            state.inBraceString = true;
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '}') { state.inBraceString = false; return 'string'; }
            }
            return 'string';
        }

        // ----- quoted strings -----
        if (stream.peek() === '"' || stream.peek() === "'") {
            const quote = stream.next();
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') { stream.next(); continue; }
                if (ch === quote) break;
            }
            return 'string';
        }

        // ----- numbers (a fraction such as 1/4 colors its leading integer) -----
        if (DIGIT.test(stream.peek()) || (stream.peek() === '-' && DIGIT.test(stream.string[stream.pos + 1] || ''))) {
            stream.eat('-');
            while (!stream.eol() && DIGIT.test(stream.peek())) stream.next();
            // optional fractional part
            if (stream.peek() === '.' && DIGIT.test(stream.string[stream.pos + 1] || '')) {
                stream.next();
                while (!stream.eol() && DIGIT.test(stream.peek())) stream.next();
            }
            // optional exponent
            if (stream.peek() === 'e' || stream.peek() === 'E') {
                stream.next();
                if (stream.peek() === '+' || stream.peek() === '-') stream.next();
                while (!stream.eol() && DIGIT.test(stream.peek())) stream.next();
            }
            return 'number';
        }

        // ----- brackets -----
        if ('()[]'.includes(stream.peek())) {
            stream.next();
            return 'bracket';
        }

        // ----- identifier / keyword -----
        if (ID_START.test(stream.peek())) {
            const word = readIdent(stream).toLowerCase();
            if (keywords.has(word)) return 'keyword';
            if (atoms.has(word)) return 'atom';
            return null;
        }

        // ----- fallback: consume one char so we don't loop -----
        stream.next();
        return null;
    };
}
