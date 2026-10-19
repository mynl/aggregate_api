// DecL coloring from the generated word list, under `node --test`.
//
// Reads web/src/decl-words.json as the build does, through `wordClasses`, and
// runs the tokenizer over a CM6 `StringStream`, which is what the editor hands
// it. The backend's tests/test_decl.py checks the file against the library; this
// checks what the editor makes of it.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { StringStream } from '@codemirror/language';

import { makeTokenizer, startState, wordClasses } from '../src/decl-tokens.js';

const wordList = JSON.parse(
    readFileSync(new URL('../src/decl-words.json', import.meta.url), 'utf8'));
const classes = wordClasses(wordList.groups);
const token = makeTokenizer(classes);

/** Every colored token of a one-line program, as `[text, class]` pairs. */
function colored(line) {
    const stream = new StringStream(line, 4, 4);
    const state = startState();
    const out = [];
    while (!stream.eol()) {
        stream.start = stream.pos;
        const kind = token(stream, state);
        if (kind) out.push([stream.current(), kind]);
    }
    return out;
}

/** The class one word gets on its own. */
const classOf = (word) => colored(word)[0]?.[1] ?? null;

test('the sets are lowercased, and so is the word looked up', () => {
    for (const w of [...classes.keywords, ...classes.atoms]) {
        assert.equal(w, w.toLowerCase(), w);
    }
    assert.equal(classOf('biTVaR'), 'atom', 'the registry spells it bitvar');
    assert.equal(classOf('neymanA'), 'keyword');
    assert.equal(classOf('AGG'), 'keyword');
});

test('a word in another group as well as distortions is a keyword', () => {
    assert.equal(classOf('beta'), 'keyword', 'a severity and a mixing law too');
    assert.ok(!classes.atoms.has('beta'));
    for (const w of ['ph', 'wang', 'tvar', 'dual', 'ccoc']) {
        assert.equal(classOf(w), 'atom', w);
    }
});

test('the words the hand mirror missed are colored', () => {
    // `[Keyword-Mirror-Gaps]`, and `claim`, which the house-style review found.
    for (const w of ['deposit', 'rol', 'cede', 'reinstatements', 'lr', 'dist',
        'bivariate', 'clash', 'grossnet', 'ssev', 'picks', 'claim']) {
        assert.equal(classOf(w), 'keyword', w);
    }
});

test('words outside the grammar and the registry are not colored', () => {
    // The 25 the hand mirror held that the grammar does not reserve and the
    // distortion registry does not list (ruled 2026-10-19: they stop).
    for (const w of ['between', 'blend', 'build', 'constant', 'convex', 'fast',
        'in', 'infinity', 'kurtosis', 'linear', 'loc', 'mean', 'p0', 'p1',
        'phasefit', 'proportional', 'samples', 'scale', 'shape', 'share',
        'skewness', 'slow', 'update', 'weibull', 'wt']) {
        assert.equal(classOf(w), null, w);
    }
});

test('a severity name with an underscore is one keyword', () => {
    assert.deepEqual(colored('sev gumbel_l 10'),
        [['sev', 'keyword'], ['gumbel_l', 'keyword'], ['10', 'number']]);
});

test('a program colors as the editor shows it', () => {
    assert.deepEqual(colored('agg Dice dfreq [3] dsev [1:6] # three dice'), [
        ['agg', 'keyword'], ['dfreq', 'keyword'], ['[', 'bracket'], ['3', 'number'],
        [']', 'bracket'], ['dsev', 'keyword'], ['[', 'bracket'], ['1', 'number'],
        ['6', 'number'], [']', 'bracket'], ['# three dice', 'comment'],
    ]);
    assert.deepEqual(colored('distortion Calm ph 0.75 note{a calm market}'), [
        ['distortion', 'keyword'], ['ph', 'atom'], ['0.75', 'number'],
        ['note', 'keyword'], ['{a calm market}', 'string'],
    ]);
});
