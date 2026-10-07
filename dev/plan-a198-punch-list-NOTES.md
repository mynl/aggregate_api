# Execution notes, plan a198 (the 2026-10-07 punch list)

Companion to `plan-a198-punch-list.md`. One section per bump, divergences
recorded as they are made. Started 2026-10-07 against api `1.0.0a197`,
library `1.0.0a396`, plugin `0.8.0`.

Scope ruling, 2026-10-07: all five bumps across all three repositories in one
session, the plan's order unchanged.

## Review findings, taken before any edit

1. **The plugin's `0.8.0` is already taken.** It shipped as
   `[Waterfall-Capital-Catchup] 0.8.0`, reading the walk's new name and columns.
   The [pnl-emphasis] plugin edit therefore lands as **`0.9.0`**, not the
   `0.8.0` the plan names. Version arithmetic only; nothing about the edit
   changes.
2. **`composeTower` carries a zero-layer fallback** (`web/src/main.js`, around
   line 3070) that synthesizes a single `attach xs detach` layer when
   `generateTower` returns nothing. The plan asks a capped span with no width
   left to refuse through `layerRefusal`, so the cap is checked in the composer
   as well as honored in `generateTower`. One line more than the plan implies.

Everything else the plan asserts was verified against the current code and
holds: the line numbers, the symbol names, the quoted docstrings, and the
three rulings' premises.

## [quick-re] api 1.0.0a198, landed

Gates: `pytest` 482 passed, `npm test` 277 passed, `check-nav.mjs` clean.

Divergences, three:

1. **`_finish` does not gain a `label` argument, and does not report
   `min_rol`.** The plan puts both on `_finish`, which the indication path
   shares, and puts the two fields on `models.LayerQuote`. `_RESPONSE_CFG` is
   `extra="forbid"` and `LayerIndication` declares neither, so a row carrying
   them fails validation on `POST /v1/objects/{id}/layers/indication`. They are
   attached in `layer_quotes` instead, beside `sd_load`, `ph`, `dual` and
   `binds`, where the other quote-only fields already live. The new
   `_min_rol_premium` helper keeps the floor computed in one place, read by
   `_finish` for its floor and by `layer_quotes` for its candidate. Nothing the
   plan asks for is lost; the fallback numbering moves into `layer_quotes`,
   which sees the tier on every layer, so it numbers within tier without
   `price_clause` having to.
2. **`ROL` prints `.3%`, not the `ratio` reading the plan names.** `ratio` is
   `.1%` in the library's own format vocabulary, which would print a rate of
   0.1217 as `12.2%` beside a clause reading `rol 0.1217`. That is exactly the
   agreement `ROL_FIGS = 4` exists to produce, so three places is the format
   that honors it: `12.170%` on a working layer and `1.217%` at the top, across
   both decades a rate on line occupies. `LR` takes `.1%` as asked, and `CV`
   takes the plan's `.3f`, a multiple rather than a percentage.
3. **`composeTower` checks the cap itself**, as the review anticipated: its
   zero-layer fallback would otherwise synthesize a single layer over a span
   the cap has emptied. A cap at or below the attachment throws and names the
   limit; a span merely too narrow to stack still falls back to one layer,
   trimmed to the cap.

Two notes, neither a divergence:

- `generateTower(a, d, cap)` with `cap == d` is **not** a no-op. Uncapped, the
  stack is asked to reach `d` and so passes it, which is the 2026-10-06 ruling;
  capped on the same number, the overshoot is precisely what is disallowed. A
  test asserts both readings, since the first version of that test asserted they
  agreed and was wrong.
- Verified by hand on `agg.Capstone.SelectedLosses`: `policy_limit` reads
  10,000, as the plan predicts, and a cession of `2000 xs 3000 and 5000 xs 5000`
  comes back out of `reins_program` as `rol 0.2101` and `rol 0.03787`, verbatim
  and with no dust.

## [narrative-bounds] api 1.0.0a199, landed

Gates: `pytest` 483 passed, `npm test` 277 passed, `check-nav.mjs` clean.

One divergence, from a blast radius the plan does not mention:

4. **`reportPnlLedger` is a second reader of `net_of_expense_premium`**, and the
   plan accounts only for `showBoundsLeaf`. It writes the dormant Evaluate
   band's note, which said `Ledger: gross premium G, net of expense premium E`
   off the gross block. With the field now reading the closing block that
   sentence stays true of the number and false of the label, so the note names
   all three figures, matching the Calibrate preview line's new wording. Its
   docstring's "off the ledger's gross block (a185)" was wrong the moment the
   field moved and is corrected.

Verified against the real ledger before writing the test. `Capstone.PnL`'s
`economic_ratios_df` runs Gross, four occurrence layers, All occurrence, Net of
occurrence, QS, All; the gross block is 28,000 of premium against 7,000 of
expense (21,000, which is what the form used to seed) and the closing block is
6,015.625 against 1,134.765625, so `P - E` is 4,880.86. That is the plan's
4,881 to the rounding.

The new `PNL_CEDED` fixture's premium figures are grid independent, which is
why they are asserted exactly: `derive premium` grosses 1,000 technical up to
1,333.33 for the 25 percent G&A, the share cedes half of that at `rate 1`, and
`cede 0.2` returns 133.33 of ceding commission as a contra expense. Only the
loss column comes off the FFT.
