# Plan: PnL button emits derive premium

> **Status: EXECUTED at `1.0.0a97`, 2026-08-13**, the same day LIB landed
> `dev/done/plan-derived-premium.md` at `aggregate` 1.0.0a270 (the `derive
> premium` DecL head and the `pnl_program` flip). One divergence from the
> steps below: `models.py`'s `loss_ratio` field description also quoted the
> inherit wording, so B2 covered three strings rather than two. The editor
> highlighting check in B5 is a build time consequence of the
> `decl-keywords.json` edit; confirm visually at the next deploy.

---

## What changes

Nothing in the button chain itself. The PnL button posts an empty body to
`POST /v1/objects/{id}/pnl` (`web/src/main.js:371`, `web/src/api.js:190`);
the server calls `obj.pnl_program(loss_ratio=0.70, expense_ratio=0.25)`
(`routes/objects.py:2497`, defaults in `models.py` lines 271 to 276) and
the app echoes the returned program into the editor. Once LIB flips
`pnl_program`, the button emits

    pnl Name_PnL derive premium less agg ... less 0.25 premium expenses

The 25% expense clause is already auto added by the `expense_ratio`
default. The derived premium resolves to T/0.75 for engine premium T, so
premium net of expenses returns exactly T and the expected underwriting
result carries the engine risk load and nothing else.

## Steps

- **B1 Sync.** After the LIB bump lands, `uv sync --extra dev` (version
  skew, oversight charter agreement 7); confirm `/v1/meta` reports the new
  LIB version.
- **B2 Text.** Reword the two docstrings quoting `inherit premium`:
  `routes/objects.py` lines 2473 to 2479 (the `post_pnl` docstring) and
  `capability.py:125` (the `has_premium` gloss).
- **B3 Tests.** `tests/test_derive.py:222` and `:226` assert the old
  keyword; update to `derive premium`. Other test programs use explicit
  `<amount> prem` heads and are unaffected.
- **B4 Keywords.** Add a `pnl` group to `web/src/decl-keywords.json`
  carrying `pnl`, `xpnl`, `inherit`, `derive`, `retro`, `peel`, `less`,
  `expense`, `expenses` (author approved 2026-08-13; the file currently
  has no pnl clause vocabulary at all). `decl-mode.js` (lines 22 to 28)
  and `completion.js` (lines 13 to 18) flatten every group not prefixed
  with an underscore automatically, so no consumer edit.
- **B5 Verify.** The button on a premium bearing object produces the
  derive program and builds clean; the economics premium equals T/0.75;
  `/v1/decl/complete` offers `derive` (it flows from `_TERMINAL_LABELS`
  with no app edit); the editor highlights the new group; an object
  without premium keeps the loss ratio sized head, so its button behavior
  is unchanged.
- **B6 Release.** Version bump and CHANGELOG per house rules.

## Not in scope

No request model change; `loss_ratio` and `expense_ratio` keep their
meanings and defaults.
