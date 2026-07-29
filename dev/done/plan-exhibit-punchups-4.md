# plan-exhibit-punchups-4: every point, one orientation, reinsurance pricing

Status: **done** (1.0.0a27). Second round of author feedback, plus the two
questions from a26 answered.

## Give me all the points

> Why can't i have all the points? I've tried to distinguish jumps from cts part
> and trust me, it is hard/impossible. Fool's errand. We happily download images
> that are 1-2MB, so why not graph data? Let's not solve a payload problem before
> we **have** a problem!

Right on all three counts, and the middle one is the load-bearing part. a26 kept
binning and only made the buckets smaller, which improved the picture without
fixing it: an atom in a `bs=1` bucket, binned by 8, is still 8 units wide and
located to within 4. And the reason a26 did not just detect the atoms and treat
them separately is exactly the one given: from the frame alone a tall bucket and
a point mass are the same number. There is no threshold. The only honest answer
is to ship the grid.

`density_df`, `unit_density_df` and `reins_density_df` now default to
`resolution='full'`: every row, unbinned. `resolution='display'` keeps the binned
form, and the only caller is the More to Density **table**, where 65,536 rows is
not a reading experience and the CSV download is the exact export anyway.

The payload objection was worth about ten minutes of work rather than a design
compromise. There was **no compression on the api at all**, so:

| | rows | raw | gzipped |
|---|---|---|---|
| `ExposureRating2` density (4 cols) | 65,536 | 3.65 MB | **0.35 MB** |
| `PropertyCasualty` per-unit (7 cols) | 65,536 | 6.99 MB | **1.29 MB** |

`GZipMiddleware` at a 1 kB floor. These are floats rendered as decimal text, so
they compress about 10 to 1, and both land inside the 1 to 2 MB the author was
already happy to spend on an image. Installed before CORS so the stack unwinds
with CORS headers outside, where a browser needs them even on a compressed
response.

Verified on the reported program: the atoms at 250 / 500 / 750 now stand more
than 50x above the buckets either side of them, asserted in
`test_density_df_is_full_resolution_by_default` against the author's own DecL.

## One orientation

> Return period AND EP should both be loss on x-axis. Don't switch it! And
> presumably it is actually S, the survival function, not EP. EP means something
> else. Pls change label.

Both correct. Loss is on x in both modes now, and the toggle changes the y-axis
only: `S(x)`, or its reciprocal as a return period. Same curve, two readings,
never a transpose, so following a loss from the density panel to the tail panel
never means swapping axes. Whichever reading is not on the primary axis is the
twin on the right, so both stay legible without touching the toggle.

And "EP" is gone. In catastrophe modeling EP is a term of art (OEP and AEP,
occurrence and aggregate exceedance probability) and this is neither of those. It
is `S(x) = P(X > x)`, so it says Survival, and the axis says `S(x)`.

Consequences worth noting: every reference line on the right panel is now a
vertical (they are all loss values), and the tooltip head is the same sentence in
both panels. The tooltip gives whichever of `S` and the return period is not on
the axis, in parentheses, because they are reciprocals and showing one alone
makes the reader do arithmetic.

## Reinsurance-aware pricing

The a26 blocker was calibrating on the gross basis. The author's answer:
`reins_density_df` already carries the distributions, `prob_loss_assets` gives
the `(p, L, a)` anchor, and **do not reinvent the wheel**.

That is the whole solution, and no wheel was reinvented:

| step | library |
|---|---|
| basis distribution | `GridDistribution` over a `reins_density_df` column |
| capital anchor | `gd.prob_loss_assets(p=)` to `(p, L, a)` |
| premium target | `Pentagon().solve(L=, a=, roe=/lr=)` |
| fit the set | `Aggregate.calibrate_distortions` |
| price the others | `Distortion.price(ser, a=)` |

The api contributes which distribution goes in and the subtraction at the end.
The one piece of glue is `_BasisView`, a small object presenting a chosen basis
with the surface `calibrate_distortions` reads (`bs`, `density_df`, `q` / `cdf` /
`snap`), so the library's own calibration runs against it unchanged. Everything
else delegates to a real `GridDistribution`.

`POST /v1/objects/{id}/reins_price` returns one row per (distortion, basis) plus
a difference row per non-calibrated basis. The calibrated basis is starred. On an
occurrence-only program the bases are `gross` and `net`, so it is exactly the
three rows per distortion that were asked for; `net occ` appears only when
**both** stages exist, since otherwise it repeats a column already on screen
under a third name.

The difference row differences the **levels** and **recomputes** the ratios. A
difference of two loss ratios is not a loss ratio; the loss ratio of the
differenced levels is the rate the cession is being bought at, which is the
number the endpoint exists to produce. On a two-unit portfolio: gross premium
1362.4, net 1257.4, so the cover costs 105.1 against 60.4 of expected ceded loss,
an implied LR of 0.575.

Each basis takes its **own** `a = q(p)`, holding the threshold fixed rather than
the capital, per "at the same p threshold". A reinsured book needs less capital
and that saving is part of what the cession bought, so it belongs in the
difference.

Pinned by two tests: the calibrated row hits its ROE target on every family, and
calibrating on `net` reproduces the object's own `calibrate_distortions` to 1e-9,
which is the check that would catch a mis-built view and nothing else would.

## Smaller items

- **Bivariate More to Density** returns the two **marginals** (long frame,
  `unit / loss / p / F / S`), not the joint matrix. Long rather than wide because
  the two axes have different grids and different lengths (2048 and 512 on one
  build); aligning them side by side would invite comparing row `i` of one
  against row `i` of the other, which means nothing. The Overview heatmap asks
  for `view='joint'` explicitly.
- **Tab persistence.** `has_reins` rides along on the build response, so the
  Reins pill greys out when there is no cession instead of opening a pane that
  says "No reinsurance on this object", which is the tab telling you it was the
  wrong tab after you clicked it. The active tab is otherwise left alone.
- **Button shape.** Every button takes `--bs-border-radius`, Bootstrap's own
  token, so the exhibit toggles, the output tabs and the hero cards cannot drift
  from Build and Examples. The pill radius is gone.
- **Banner.** The kicker is centered under the title, with a matching indent so
  the trailing letter-space on the last small cap does not push it half a space
  left of true center.

## Heroes on first load: not reproduced

> The first time i load the page there are no heroes?

Not reproducible from here, and the server side is clean: `/v1/examples/heroes`
answers 200 in about 2 s cold (it loads the whole recipe library on first call)
and returns all eight, including when fired concurrently with `/v1/examples` and
`/v1/meta` on four separate cold processes. The service worker never touches
`/v1/*`.

The old code could not have told us why either: **one `.catch` covered both the
fetch and the rendering**, and swallowed whatever it caught in silence. That is
now split, with one retry after 750 ms on a fetch failure (a 2 s cold route is
the sort of window a transient failure hides in) and a `console.warn` on the
paths that give up. If it recurs, the console will say which half failed.

## Verified

`uv run pytest` 92 passed, `ruff check src` clean, `node dev/smoke-exhibits.mjs`
over eight fixtures at both breakpoints with panels at the house 1.43 aspect, and
a rebuilt bundle.

Appearance beyond the geometry stays unverified: the browser extension has never
connected in any session.
