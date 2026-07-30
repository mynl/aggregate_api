# plan-exhibit-punchups-2: second pass on the exhibit

Status: **done** (1.0.0a23).

## Why

The author's second inspection. Three specific corrections, plus a change of
working practice that the test harness had to follow.

## What landed

### Steps for a discrete density

`drawstyle='steps-mid'` in matplotlib terms, `step: 'middle'` in ECharts.

The reasoning matters more than the setting: `agg Dice dfreq [3] dsev [1:6]`
puts mass on sixteen integers. A line joining them draws probability at values
that cannot occur, which is not a cosmetic complaint. For a discrete book the
step plot *is* the distribution.

Fires when the number of points carrying mass is at or below 256. Generous on
purpose: steps are honest for a coarse continuous grid as well, while a line
over a lattice is wrong, so the threshold errs toward steps.

### Anchors as lines

The 1-in-100 / 200 / 250 dots did not sit on the curve. They could not: the
curve is a binned display grid and the anchor is `tail_df`'s quantile function
at that return period. A marker point has to be on the line to look correct.

Replaced with faint dashed verticals labeled at the top. A vertical line asserts
something about the x-axis rather than about the curve, which is both true and
robust to grid coarseness.

### Integer return periods

`1-in-247`, not `1-in-247.0000003`. One decimal survives below 1-in-10, where
the fraction carries information.

## The harness follows a change of practice

**The author starts and stops servers from now on; this project's tooling does
not.** `dev/smoke-exhibits.mjs` assumed a live api, so it was reworked:

- `dev/capture_fixtures.py` drives the app through FastAPI's `TestClient`,
  in-process with no port bound, and writes one payload set per kind to
  `dev/fixtures/exhibits.json`.
- The smoke test replays that file by default, and still takes a base URL for a
  live run when one happens to be up.
- The fixture file is gitignored: derived data, ~17 MB.

The fixture set gained a `discrete` case (the dice) precisely so the step
rendering has something to fire on, and the test asserts the continuous cases do
**not** step. A check that cannot tell them apart would pass forever with the
feature broken in either direction.

It also gained the check that a single-panel exhibit is square. The distortion
aspect ratio was wrong for a whole release and nothing automated would have
caught it.

## Verified

`uv run pytest` 86 passed; `node dev/smoke-exhibits.mjs` all seven cases clean,
with `steps=[FIX.Dice]` on the discrete case and no others.

Appearance is still unverified. No rendered chart has been inspected in any
session so far.
