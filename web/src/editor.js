// CodeMirror 6 editor setup -- DecL language mode + extensions.
//
// CM6 is "assemble what you need from extensions" rather than "one big
// editor object with options". We bundle:
//
//   * the DecL StreamLanguage from decl-mode.js
//   * line numbers, history, default keymap (incl. autocompletion shortcut)
//   * autocomplete with our async source
//   * a small theme that picks up the site's monospace font
//   * Ctrl/Cmd-Enter -> build, Ctrl-↑/↓ -> history nav
//
// `createEditor(host, callbacks)` returns an object with helpers the
// rest of the SPA uses (getText / setText / focus / dispatch).

import { EditorState, Compartment } from '@codemirror/state';
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
        padding: '12px 10px',
        // Floor of ~3 text lines; CM grows past this with content (capped by
        // the scroller's maxHeight below). `em` so it tracks the font size,
        // including the 16px mobile bump.
        minHeight: '4.5em',
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
 *   onBuild()         -- Ctrl-Enter / Cmd-Enter
 *   onHistoryPrev()   -- Ctrl-ArrowUp / Cmd-ArrowUp
 *   onHistoryNext()   -- Ctrl-ArrowDown / Cmd-ArrowDown
 *   onExamplePrev()   -- Alt-ArrowUp   (undisclosed: step through examples)
 *   onExampleNext()   -- Alt-ArrowDown
 */
export function createEditor(host, callbacks = {}) {
    const customKeymap = keymap.of([
        {
            key: 'Mod-Enter',
            run: () => { callbacks.onBuild?.(); return true; },
        },
        {
            key: 'Mod-ArrowUp',
            run: () => { callbacks.onHistoryPrev?.(); return true; },
        },
        {
            key: 'Mod-ArrowDown',
            run: () => { callbacks.onHistoryNext?.(); return true; },
        },
        // Plain ↑/↓ navigate history at the buffer edges (REPL feel, matches
        // the feedback-line hint); elsewhere they fall through to normal
        // cursor movement by returning false.
        {
            key: 'ArrowUp',
            run: (view) => {
                const { head } = view.state.selection.main;
                if (view.state.doc.lineAt(head).number === 1) {
                    callbacks.onHistoryPrev?.(); return true;
                }
                return false;
            },
        },
        {
            key: 'ArrowDown',
            run: (view) => {
                const { head } = view.state.selection.main;
                if (view.state.doc.lineAt(head).number === view.state.doc.lines) {
                    callbacks.onHistoryNext?.(); return true;
                }
                return false;
            },
        },
        // Alt-↑/↓: step through the example library (undisclosed power-user
        // nav -- deliberately not shown in the feedback line).
        {
            key: 'Alt-ArrowUp',
            run: () => { callbacks.onExamplePrev?.(); return true; },
        },
        {
            key: 'Alt-ArrowDown',
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
