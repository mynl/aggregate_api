// CodeMirror 6 editor setup -- DecL language mode + extensions.
//
// CM6 is "assemble what you need from extensions" rather than "one big
// editor object with options". We bundle:
//
//   * the DecL StreamLanguage from decl-mode.js
//   * line numbers, history, default keymap (incl. autocompletion shortcut)
//   * autocomplete with our async source
//   * a small theme that picks up the site's monospace font
//   * Ctrl/Cmd-Enter -> build, Ctrl-↑/↓ -> history, Ctrl-Shift-↑/↓ -> examples
//
// `createEditor(host, callbacks)` returns an object with helpers the
// rest of the SPA uses (getText / setText / focus / dispatch).

import { Annotation, EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine,
         highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, emacsStyleKeymap, history, historyKeymap,
         indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, acceptCompletion } from '@codemirror/autocomplete';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

import { declLanguage } from './decl-mode.js';
import { declCompletionSource } from './completion.js';

// Compartment lets us swap parts of the config later without rebuilding
// the whole editor (e.g. toggling a "lint" overlay when /v1/decl/lex
// returns an error). Not used yet but cheap to set up.
const languageCompartment = new Compartment();

// Emacs-style editing keys (Ctrl-A/E line start/end, Ctrl-K kill-line,
// Ctrl-Y yank, Ctrl-N/P next/prev line, Ctrl-F/B/D char nav/delete). Held
// in its own Compartment so the user can flip it on/off at runtime via the
// feedback-line switch without rebuilding the editor. Persisted in
// localStorage under EMACS_KEY.
const emacsCompartment = new Compartment();
const EMACS_KEY = 'aggapi.emacsKeys';

// Marks a document change this module made on the app's behalf, so the app can
// tell "the reader typed something" from "the history walk loaded an entry".
// Both are real changes into CodeMirror's own undo history, which is what makes
// Ctrl+Z recover a program the walk replaced, and the annotation is the only
// thing that distinguishes them afterwards.
const programmatic = Annotation.define();

/**
 * The modifier `Mod-` actually resolves to on this device, as a word.
 *
 * CodeMirror maps `Mod` to Meta on a Mac and to Ctrl everywhere else, and its
 * idea of a Mac includes an iPad: `navigator.platform` reports `MacIntel` in
 * desktop-class Safari and `maxTouchPoints` is 5, so both halves of its test
 * fire. Every hint on the page said `Ctrl` regardless, which on the one device
 * this matters most for taught a key that does nothing.
 *
 * The test is copied from `@codemirror/view` (`browser.mac`, `dist/index.js`)
 * rather than approximated, because the only useful answer is the one the
 * keymap itself will give. Re-read it if a CodeMirror upgrade moves it. The
 * `!ie` guard is dropped: Internet Explorer does not report an Apple vendor and
 * is not a browser this app runs in.
 *
 * @returns {'Ctrl'|'Cmd'}
 */
export function modifierName() {
    const nav = typeof navigator === 'undefined' ? null : navigator;
    if (!nav) return 'Ctrl';
    const safari = /Apple Computer/.test(nav.vendor || '');
    const ios = safari && (/Mobile\/\w+/.test(nav.userAgent || '')
        || (nav.maxTouchPoints || 0) > 2);
    return (ios || /Mac/.test(nav.platform || '')) ? 'Cmd' : 'Ctrl';
}

/** Whether emacs keys should start enabled (persisted choice; default on). */
export function emacsEnabledDefault() {
    try { return localStorage.getItem(EMACS_KEY) !== 'off'; }
    catch { return true; }
}

// Minimal emacs kill-ring. CM's bundled `emacsStyleKeymap` binds Ctrl-K to a
// plain delete (no ring) and has no Ctrl-Y, so killed text was lost and yank
// did nothing. We keep a one-slot ring and bind kill/yank on top of it.
let killRing = '';

/** Ctrl-K: kill the active selection if any, else from cursor to line end
 *  (at EOL, kill the newline). The removed text goes to the ring. */
function killToLineEnd(view) {
    const { state } = view;
    const { from, to, empty } = state.selection.main;
    if (!empty) {
        killRing = state.doc.sliceString(from, to);
        view.dispatch({ changes: { from, to }, scrollIntoView: true });
        return true;
    }
    const line = state.doc.lineAt(from);
    let killTo = line.to;
    if (from === line.to) {                 // at EOL -> kill the newline
        if (line.to === state.doc.length) return true;   // end of doc, nothing
        killTo = line.to + 1;
        killRing = '\n';
    } else {
        killRing = state.doc.sliceString(from, line.to);
    }
    view.dispatch({ changes: { from, to: killTo }, scrollIntoView: true });
    return true;
}

/** Ctrl-Y: insert the ring at the cursor (replacing any selection). */
function yank(view) {
    if (!killRing) return false;
    const { from, to } = view.state.selection.main;
    view.dispatch({
        changes: { from, to, insert: killRing },
        selection: { anchor: from + killRing.length },
        scrollIntoView: true,
    });
    return true;
}

function emacsExtension(on) {
    if (!on) return [];
    // Our kill/yank sit *before* emacsStyleKeymap so our Ctrl-K (stores to the
    // ring) beats its delete-only Ctrl-K; Ctrl-Y is otherwise unbound.
    return keymap.of([
        { key: 'Ctrl-k', run: killToLineEnd, preventDefault: true },
        { key: 'Ctrl-y', run: yank, preventDefault: true },
        ...emacsStyleKeymap,
    ]);
}

const editorTheme = EditorView.theme({
    '&': {
        fontSize: '14px',
        // 'background' is set by site.css via .cm-editor; leave to the cascade.
    },
    '.cm-content': {
        fontFamily: '"Cascadia Mono", Menlo, Consolas, monospace',
        // The right side is a reserved channel, not padding: it is what keeps a
        // long line from running under the history step buttons in the margin.
        // The clear icon has been getting away with a weaker version of this
        // claim, since a glyph a line runs under is ugly and a button a line
        // runs under is broken. 54px covers the 1rem offset plus a 2.1rem
        // button, with a little air.
        //
        // Written here rather than in site.css on purpose. CodeMirror injects
        // its theme rules at load, a plain `.cm-content` selector in the
        // stylesheet has the same specificity, and which one wins would come
        // down to injection order.
        padding: '12px 54px 12px 10px',
        // Floor of six text lines; CM grows past this with content (capped by
        // the scroller's maxHeight below). `em` so it tracks the font size,
        // including the 16px mobile bump. The vertical arithmetic below is
        // about `minHeight` alone and the right-hand reservation does not
        // touch it.
        //
        // The number is the border box, which is what made the previous one
        // wrong about itself: the line box is 1.4em and the padding is 12px on
        // each side, so the `4.5em` that claimed a floor of three lines was
        // really 63px, or two. Six is 6 x 1.4em + 24px, which is 10.1em at
        // 14px; 10.2em rounds it up so the sixth line is never a hair short.
        //
        // Six rather than three because the box is scrolled through as much as
        // it is typed in: stepping the history or the example library past
        // programs of different lengths resized the editor on every press, and
        // everything below it moved.
        minHeight: '10.2em',
    },
    '.cm-scroller': { overflow: 'auto', maxHeight: '40vh' },
    '.cm-gutters': {
        backgroundColor: '#fff',
        color: '#9aa3b0',
        borderRight: '1px solid #eef0f3',
    },
    '.cm-activeLine':       { backgroundColor: '#f7faff' },
    '.cm-activeLineGutter': { backgroundColor: '#eef3fb' },
});

/**
 * Build the editor on `host` (a DOM node).
 *
 * Callbacks:
 *   onBuild()         -- Mod-Enter, so Ctrl-Enter or Cmd-Enter by platform
 *   onHistoryPrev()   -- Ctrl-ArrowUp and Cmd-ArrowUp, both, everywhere
 *   onHistoryNext()   -- Ctrl-ArrowDown and Cmd-ArrowDown
 *   onExamplePrev()   -- Ctrl-Shift-ArrowUp, step through the example library
 *   onExampleNext()   -- Ctrl-Shift-ArrowDown
 *   onEdit(fromApp)   -- the document changed; `fromApp` is true when setText
 *                        made the change rather than the reader
 *
 * The four arrow bindings are the only ones bound twice, and it is deliberate:
 * `Mod-` alone resolves to Cmd on a Mac and on an iPad, and there is no reason
 * a reader with a hardware keyboard should have to know which. `buildKeymap`
 * throws on prefix conflicts, not on duplicates, so on Windows the two spell one
 * name and coexist. The rest of the page still speaks `Mod`; see modifierName.
 *
 * Every one of these is documented in the feedback line under the editor and in
 * the Help panel. The example nav used to be an undisclosed Alt- binding, which
 * meant a working feature nobody could find.
 */
export function createEditor(host, callbacks = {}) {
    const customKeymap = keymap.of([
        {
            key: 'Mod-Enter',
            run: () => { callbacks.onBuild?.(); return true; },
        },
        // Ctrl-↑/↓: load the previous / next history entry, and nothing else.
        // `return true` means the keystroke is consumed, so the cursor does not
        // move: the buffer's whole contents are replaced and where the caret was
        // in the old program says nothing about the new one.
        //
        // Plain ↑/↓ used to do this at the buffer edges, for a REPL feel. On a
        // one line program, which is most of them, *every* press is at an edge,
        // so pressing up to move the caret silently threw the program away. A
        // modifier is the price of not doing that.
        {
            key: 'Mod-ArrowUp',
            run: () => { callbacks.onHistoryPrev?.(); return true; },
        },
        {
            key: 'Mod-ArrowDown',
            run: () => { callbacks.onHistoryNext?.(); return true; },
        },
        // And Ctrl explicitly, which is what `Mod` is not on a Mac or an iPad.
        // Same command, so either key works on every platform.
        {
            key: 'Ctrl-ArrowUp',
            run: () => { callbacks.onHistoryPrev?.(); return true; },
        },
        {
            key: 'Ctrl-ArrowDown',
            run: () => { callbacks.onHistoryNext?.(); return true; },
        },
        // Ctrl-Shift-↑/↓: step through the example library. Loads into the
        // editor and stops there, deliberately: walking a library of 186 recipes
        // at one build each is not a thing to do by accident.
        {
            key: 'Mod-Shift-ArrowUp',
            run: () => { callbacks.onExamplePrev?.(); return true; },
        },
        {
            key: 'Mod-Shift-ArrowDown',
            run: () => { callbacks.onExampleNext?.(); return true; },
        },
        {
            key: 'Ctrl-Shift-ArrowUp',
            run: () => { callbacks.onExamplePrev?.(); return true; },
        },
        {
            key: 'Ctrl-Shift-ArrowDown',
            run: () => { callbacks.onExampleNext?.(); return true; },
        },
        // Tab accepts a completion if the popup is open, otherwise inserts a tab.
        { key: 'Tab', run: acceptCompletion },
    ]);

    const state = EditorState.create({
        doc: '',
        extensions: [
            lineNumbers(),
            highlightSpecialChars(),
            history(),
            // No drawSelection(): we use the browser's native selection so it
            // paints on top of the opaque active-line highlight (drawSelection
            // renders behind it, which hid double-click / shift selections).
            EditorState.allowMultipleSelections.of(true),
            bracketMatching(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            languageCompartment.of(declLanguage),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            autocompletion({
                override: [declCompletionSource],
                // Manual trigger only (Ctrl-Space). Typing-triggered
                // completion fired a /v1/decl/complete round-trip on every
                // keystroke, which made the editor feel laggy and stole
                // Enter/Tab/arrows. The popup now opens only when invoked.
                activateOnTyping: false,
                closeOnBlur: true,
            }),
            customKeymap,
            // Emacs bindings sit above defaultKeymap so Ctrl-A/E/K win, but
            // below customKeymap so Mod-Enter (build) still takes precedence.
            emacsCompartment.of(emacsExtension(emacsEnabledDefault())),
            keymap.of([
                ...defaultKeymap,
                ...historyKeymap,
                ...completionKeymap,
                ...searchKeymap,
                indentWithTab,
            ]),
            // Mark the contenteditable as not-a-form-field: turns off
            // autocorrect/-capitalize/spellcheck (right for code) and, crucially
            // on iOS, suppresses the AutoFill (Passwords / Payment) accessory
            // bar above the keyboard.
            EditorView.contentAttributes.of({
                autocomplete: 'off',
                autocorrect: 'off',
                autocapitalize: 'off',
                spellcheck: 'false',
            }),
            // The document changed, which is the event the history walk was
            // always meant to end on. It listened for a keydown through a115,
            // and a keydown is not typing: Shift held to start a selection, or
            // Home, End, PageUp, Escape or Tab, all silently ended a walk in
            // progress. This fires on a paste and an undo too, and not on a
            // caret move, which is the right set.
            EditorView.updateListener.of((update) => {
                if (!update.docChanged) return;
                const fromApp = update.transactions
                    .some((tr) => tr.annotation(programmatic));
                callbacks.onEdit?.(Boolean(fromApp));
            }),
            editorTheme,
        ],
    });

    const view = new EditorView({ state, parent: host });

    return {
        view,
        getText: () => view.state.doc.toString(),
        setText: (text) => {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text || '' },
                // Annotated so `onEdit` can tell this from the reader typing.
                // Without it the history walk would reset its own cursor every
                // time it loaded an entry.
                annotations: programmatic.of(true),
            });
        },
        focus: () => view.focus(),
        /** Enable/disable emacs editing keys at runtime; persists the choice. */
        setEmacs: (on) => {
            view.dispatch({
                effects: emacsCompartment.reconfigure(emacsExtension(on)),
            });
            try { localStorage.setItem(EMACS_KEY, on ? 'on' : 'off'); }
            catch { /* ignore storage failures (private mode etc.) */ }
        },
    };
}
