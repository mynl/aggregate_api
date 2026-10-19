// CodeMirror 6 StreamLanguage definition for DecL.
//
// The words come from decl-words.json, which is generated from the installed
// library and never edited:
//
//     uv run --no-sync python -m aggregate.decl_words > web/src/decl-words.json
//
// A backend test fails when the committed file and the library disagree. The
// word classes and the tokenizer live in decl-tokens.js, where `node --test`
// can reach them.

import { StreamLanguage } from '@codemirror/language';
import wordList from './decl-words.json';
import { makeTokenizer, startState, wordClasses } from './decl-tokens.js';

const { keywords: KEYWORDS, atoms: ATOMS } = wordClasses(wordList.groups);

export const declLanguage = StreamLanguage.define({
    name: 'decl',
    startState,
    token: makeTokenizer({ keywords: KEYWORDS, atoms: ATOMS }),
    languageData: {
        commentTokens: { line: '#' },
        // Surface a hint to CM6's autocomplete that '.' is part of identifiers.
        wordChars: '._:~-',
    },
});

export { KEYWORDS as DECL_KEYWORDS, ATOMS as DECL_ATOMS };
