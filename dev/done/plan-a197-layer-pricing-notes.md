# a197 execution notes

Executed 2026-10-06 against `aggregate 1.0.0a395`, from `dev/plan-a197-layer-pricing.md`. Landed as one bump, `1.0.0a197`, one commit. Both gates green: `uv run pytest` 478 passed, `cd web; npm test` 273 passed, and `node dev/scripts/check-nav.mjs` clean.

## What the review confirmed before anything was edited

Every measurable claim in the plan verified against the installed library, and the worked example reproduced end to end before a line was written: `823.26 / 961.30 / 563.51 / 407.34 / 360.07 / 166.24`, loss ratio `85.5%` down to `23.5%`, `dual` binding on the three working layers and `ph` on the three upper ones, `10000 xs 10000` at `1.08%` unfloored and `50000 xs 50000` flooring at `1.00%`. Finding 1's closed form ties `reins_stats_df` to `5e-11` relative on the mean and `8e-8` on the cv across all six layers. `deposit`, `rol`, `cede` and the `as` labels round trip through `reins_program`; `pnl_program` inlines the deposit; `rol` refuses an infinite limit and `cede` refuses a bare layer, both with the messages the plan quotes; the `IgnoredDecLClauseWarning` reads exactly as the plan quotes it. No name collisions for `layer_pricing`, `layer_moments`, `attachment_probability`, `indication`, `layer_quotes`, `price_clause` or `LayerIndication*` anywhere in `src/`, `web/src/` or `tests/`.

## The one blocker, and the ruling

Step **[frame]** says "the per-layer frame on the Reins tab gains the quote columns from the last pricing run". There is no such frame. Reins / Summary and Reins / Stats are the library's `reins` exhibit served whole through `loadReinsExhibit`, and Reins / Density is `reins_density_df` off the frame route, so none of the three has client-side columns to add. The question also has a second half the plan does not raise: the quote rows belong to the **press** and not to the object, so a sub-tab leaf keyed to the object would go on showing the previous book's quote after a switch.

**Author's ruling, 2026-10-06: the quote table goes under the Quick Re row**, in a new `#qr-quotes` div inside `#reins-entry`, labeled as the last quote. No nav change, no `check-nav.mjs` change, and it sits where the press happened. It is emptied by `clearCessionDraft` wherever the editor's program is replaced, and by `renderReinsEntry` on an object that cannot cede. Acceptance check 4 is met there rather than in the pane.

## Divergences

**[clause] step 1 needs no build.** The plan says to read the layer triples off a built net object, "which is the build `post_reins` already does". `uw(program, update=False)` returns `occ_reins`, `agg_reins`, the labels and the `net of` / `ceded to` kinds in 13 ms with no FFT, which is the same authoritative reading of the clause with one build of the net object saved. `post_reins` then builds the **priced** program once, as it always did.

**el and sd come from the closed form, not from the auxiliary build's `est_m` and `est_sd`.** The plan takes them off the log2 16 auxiliary object. Two reasons for the change, both stated in `layer_quotes`'s Notes: the closed form is exact where the auxiliary figures carry the discretization of a coarse lattice, and using the same moments the form used makes `indication` an **exact** lower bound on the press rather than an approximate one, which is the property the plan's own docstring is asked to promise. The auxiliary build is used for the two distortion prices alone, which is the one thing it is needed for. Agreement with the plan's table is in the fifth significant figure, well under the three figures the quote is rounded to.

**No `indication` field on the wire.** The plan's `indication` row carried an `indication` key alongside `premium`, and `LayerQuote` inherits the indication's shape, so a quote row would have had to carry a field that means nothing on it. The two paths both report `premium`, which is the repo's own "one field per fact" rule; the no-build row and the priced row are the same shape with `sd_load`, `ph`, `dual` and `binds` added.

**An unlimited limit is spelled `null` on the wire**, matching how `LayerRequest` spells one, because JSON carries no infinity. `_finish` converts, rather than leaving FastAPI's silent `inf` to `null` coercion to do it where nothing says so.

**Two small edges the plan does not mention**, both handled and tested. A capacity layer above the severity limit has no expected loss, so `cv` is `None` rather than a nan, and its loss ratio is `0.0`, a number and the right one: the floor wrote a premium against no loss. And an **unlimited** layer gets no minimum rate on line, a fraction of an infinite limit not being a number; it is also always spelled `deposit`, since the parser refuses a rate on line without a finite limit.

**`composeCession` split into `clauseFromSpan`.** The preview line writes the clause and asks for the price off **one** reading of the boxes. Calling `composeCession` and then resolving the span again for the price would read the boxes twice, and the second reading could differ from the first, which is the exact lie the preview's stale-ticket guard exists to prevent.

**One test tolerance loosened from the plan's `1e-6`.** `test_share_scales_the_premium_linearly` holds to `1e-4`, not tighter: each placement's distortion price comes off its own auxiliary build and a build picks its own bucket size, so two placements of one layer are priced on two slightly different lattices. The moment ties keep the plan's `1e-6` on occurrence and `1e-3` on aggregate, and both pass with room.

## The observation the plan left for the author

The plan's closing section reports that `main.js` claims Tower "cedes like Add re rather than replacing what is there", while the library measurably **replaces** the tier's program. Confirmed again here. Not acted on: it is a comment that disagrees with behavior, not a defect this plan introduced or fixes, and the plan explicitly parks it. It remains open.

## What was deliberately left uncommitted

`dev/plan-demo-load.md` and `dev/scripts/loadtest/`, both the author's untracked work in progress, and nothing in this bump touches either.
