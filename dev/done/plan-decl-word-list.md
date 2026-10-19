# Plan: aLL takes its DecL words from aggregate

`[DecL-Word-List]`. Drafted 2026-10-19 at 1.27.0 (`41d4fe9`) at Steve's request, from the
house-style review. Not yet ruled.

This is aggregate-api's side of a set of four plans with the same file name. The library side,
`V:\worktrees\aggregate_REFACTOR\dev\plan-decl-word-list.md`, adds `aggregate.decl_words()` and
must be released to PyPI first. aggregate-asp's side reads the route this plan adds, so this lands
before it. house-style's side is independent of this one.

## Goal

aLL colors and offers exactly the words of the DecL grammar, read from the installed `aggregate`,
so a word added to the language colors here with no hand edit. It also serves the same list to
aSP, which has no build step of its own.

## Current behavior

- **`web/src/decl-keywords.json` is kept by hand.** Its `_comment` says it "Mirrors
  _TERMINAL_LABELS in src/aggregate/parser_errors.py". Its groups and counts: structural 6,
  frequency 17, severity 17, parameters 12, reinsurance 12, pnl 9, distortions 9, modifiers 8.
- **`web/src/decl-mode.js`** flattens it: the `distortions` group becomes `ATOMS` and every other
  group `KEYWORDS` (lines 22 to 28). A word is looked up lowercased (lines 115 to 116), but the
  pool lists `biTVaR` in mixed case, so `biTVaR` is never colored. `completion.js` (lines 13 to 17)
  builds its offline fallback pool from the same sets.
- **The mirror has gaps.** `dev/TODO.md` `[Keyword-Mirror-Gaps]` lists `deposit`, `rol`, `cede`,
  `reinstatements`, `lr`, `dist`, `bivariate`, `clash`, `grossnet`, `ssev` and `picks`. The
  house-style review found `claim` and 22 other grammar words missing as well.
- **It also holds 25 words the grammar does not reserve and the distortion registry does not
  list** (computed 2026-10-19): `between blend build constant convex fast in infinity kurtosis
  linear loc mean p0 p1 phasefit proportional samples scale shape share skewness slow update
  weibull wt`. Some are values checked after parsing, such as the approximation kind `phasefit`.
  Some are completion hints. Five are in the `distortions` group without being registry kinds.
- `[Name-Underscore-Comment]`: the comment at `decl-mode.js:31` says identifiers have "NO
  underscore". The code (`ID_BODY`, line 33) allows `_`, as the grammar does. Only the comment is
  wrong.
- The execute-plan skill (`.claude/skills/execute-plan/SKILL.md`, "Grammar mirror") tells every
  plan reacting to a grammar change to check the mirror by hand.
- The api already serves the grammar itself, at `GET /v1/decl/grammar` (`routes/decl.py`, read
  through `importlib.resources`), tested in `tests/test_decl.py`.

## The change

### [DecL-Word-List] the next free minor (1.28.0 if nothing lands first)

- **`GET /v1/decl/words`**, beside `/v1/decl/grammar` in `routes/decl.py`. It returns
  `aggregate.decl_words()` as JSON, with the aggregate version, and has a response model in
  `models.py`. aSP reads it. aLL could read it too, but does not need to (next bullet).
- **`web/src/decl-words.json` replaces `decl-keywords.json`.** It is generated, never edited:
  `uv run python -m aggregate.decl_words > web/src/decl-words.json`. It is committed, so that
  `npm run dev`, `npm test` and the vite build need no Python step. A new backend test fails when
  the committed file differs from `aggregate.decl_words()` for the installed aggregate, and the
  failure message prints the regeneration command. Drift therefore surfaces as a red test, not as
  an uncolored word.
- **`decl-mode.js` classes words as it does today.** Distortion names are atoms; every other
  group (reserved words, frequencies, clauses, `inf`, declarations, severities, mixing
  distributions) is keywords. A word in both, which today is only `beta`, is a keyword, as the
  tokenizer already checks keywords first.
  Both the sets and the looked-up word are lowercased, which fixes `biTVaR` (the registry spells it
  `bitvar`) and keeps `neymanA` working. `completion.js` builds its offline pool from the same
  sets.
- **Words outside the grammar and the registry stop being colored.** This is the open question in the library plan;
  the recommendation is that the grammar decides. The server's `/v1/decl/complete` remains the
  completion source when the api is up.
- The comment at `decl-mode.js:31` is corrected (`[Name-Underscore-Comment]`).
- The skill's "Grammar mirror" rule becomes: regenerate `decl-words.json`, and the drift test
  enforces it.
- `pyproject.toml` floors `aggregate` at the library's release.
- `dev/TODO.md`: `[Keyword-Mirror-Gaps]` and `[Name-Underscore-Comment]` are closed, noting the
  version.

## Files

- `src/aggregate_api/routes/decl.py`, `src/aggregate_api/models.py`
- `tests/test_decl.py`, for the route and the drift test
- `web/src/decl-words.json` (new, generated); `web/src/decl-keywords.json` (deleted);
  `web/src/decl-mode.js`, `web/src/completion.js`
- `pyproject.toml`, `src/aggregate_api/__init__.py` (`__version__`), `CHANGELOG.md`,
  `dev/TODO.md`, `.claude/skills/execute-plan/SKILL.md`
- The built SPA under `src/aggregate_api/static/`, rebuilt by `scripts/build-web.ps1`

## Acceptance

- `uv run pytest` and `cd web; npm test`, both at the bump.
- `GET /v1/decl/words` returns every group of `aggregate.decl_words()` unchanged.
- The drift test passes on the committed file. It fails after any one word is deleted from it,
  checked once by hand and then restored.
- **Coloring, checked mechanically.** A node script runs `decl-mode.js`'s tokenizer over every
  program in aggregate's `library.agg` and `decl-testers.agg`. Every word of `decl_words()` that
  occurs there is classed `keyword` or `atom`. Each word in `[Keyword-Mirror-Gaps]`, together with
  `claim`, is now colored. `biTVaR` is an atom.

## Open question for Steve

The 25 words outside the grammar and the registry (the list above): stop coloring them
(recommended), or keep them in a small aLL-only list for completion. Coloring them is not on
offer, since that is the hand mirror this plan retires.

**Ruled (Steve, 2026-10-19): agreed, they stop being colored.** The same answer disposes of the
library plan's question 1.

## Execution log

- **2026-10-19, review: waits for the library release.** The library half was in progress in
  `aggregate_REFACTOR` (uncommitted, `1.6.0a1`, its plan staged into `dev/done/`) and is not on
  PyPI, where 1.5.3 has no `decl_words`. Landing here first would break a fresh clone. Steve ruled
  to wait for the PyPI release, whose version becomes the `pyproject.toml` floor. The plan's facts
  checked out against 1.27.0: `decl-mode.js` lines 22 to 33 and 115 to 116, `completion.js` lines
  13 to 17, and `python -m aggregate.decl_words` emitting `{version, groups}`, so the drift test
  compares `groups` and ignores the version.
- **2026-10-19, go.** aggregate 1.6.0 reached PyPI (uploaded 09:58 UTC). Executed as 1.30.0, after
  the parallel `[Sheets-Template]` landed as 1.29.0. `python -m aggregate.decl_words` from the
  editable worktree and from a clean PyPI 1.6.0 (`uv run --isolated --no-project --with
  aggregate==1.6.0`) print identical JSON.
- **Divergence [decl-tokens].** The tokenizer and the word classing moved out of `decl-mode.js`
  into a new `web/src/decl-tokens.js` that imports nothing, and `decl-mode.js` is now the
  CodeMirror wrapper that imports the JSON. Node will not import a JSON module without an import
  attribute, which Vite 5 does not reliably carry, so this is what lets `node --test` reach the
  tokenizer. New `web/test/decl-tokens.test.js` checks the classes and tokenizes sample lines
  through a real CM6 `StringStream`. The `[Name-Underscore-Comment]` fix lands in the moved
  comment, and the old ` -- ` glosses in both files and in `completion.js` are rewritten.
- **Divergence [route shape].** `GET /v1/decl/words` returns `{version, groups}`, exactly what
  `python -m aggregate.decl_words` prints, so aSP reads the route and the committed file the same
  way. `version` is the library's; `/v1/meta` calls the same value `aggregate_version`.
- **Divergence [lowercased pool].** The offline completion pool comes from the lowercased sets,
  so it offers `neymana` and `bitvar` where the hand list offered `neymanA` and `biTVaR`. Both
  spellings are valid DecL.
- **Divergence [stale texts].** Beyond the plan's file list: the `CLAUDE.md` pin line (the one
  hunk of that file in the commit), and the `examples.py` comment that cited the hand mirror as
  its precedent.
- **Acceptance.** Drift test: deleting `claim` from the committed file failed it with the
  regeneration command in the message; regenerating restored it. Coloring: a scratch node script
  ran `decl-tokens.js` over `library.agg` and `decl-testers.agg`. 123 of the 212 distinct words
  occur there, all colored, with no failures. Every `[Keyword-Mirror-Gaps]` word and `claim` is a
  keyword, and `biTVaR` an atom. Of the 25 words that stop being colored, only `p1` occurs in
  those corpora, once.
- **No sync.** `uv lock` moved only `aggregate` (1.0.1 to 1.6.0 in the lock). The environment keeps
  the editable worktree `aggregate` and the relativity plugin.
