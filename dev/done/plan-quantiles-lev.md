# Plan: the quantiles route reports the limited expected loss at each quantile

**Status: drafted 2026-10-19, requested by aSP; awaiting the author's go.** Tracked as `[Quantiles-LEV]`. Requested by aSP's `[Loss-Input-Pricing]` (`V:/dev/aggregate-asp/dev/plan-loss-input-derived-premium.md`), whose phase [default-haircut] waits on it. Nothing else in that plan does.

## Goal

`GET /v1/objects/{id}/quantiles` returns, beside each quantile, the expected loss limited to it, $\mathsf{P}(X \wedge q(p))$. That is the loss a pentagon prices when the insurer can default at assets $a = q(p)$, and the one number aSP's default haircut needs that it cannot get today.

## Background

- The route (`routes/objects.py`, `get_quantiles`) answers `p` (comma separated), `snap`, and `basis` (`aggregate` or `occurrence`), returning `{p, q, snapped}` per probability (`models.Quantile`). On the aggregate basis it reads the object's own `q` (for a reinsured object, its own law is net), falling back to `total.q` for a pair.
- aggregate's public `Aggregate.prob_loss_assets(p=..., L=..., a=...)` returns the consistent, grid-snapped triple `(p, L, a)` with `L == lev(a)`, over the same `p_total` grid the library's pentagon pricing reads.
- aSP calls this route twice per build, at its six solvency levels, once on a bare gross object and once on the program object.

## The change

- `models.Quantile` gains `lev: float | None = None`, documented as $\mathsf{P}(X \wedge q)$ on the law the route read, null where the route cannot form it.
- `get_quantiles`, aggregate basis only: for each `p`, `lev = obj.prob_loss_assets(a=exact).L` (or `total.prob_loss_assets` for a pair). The occurrence basis leaves it null, as does a kind without `prob_loss_assets`. A failure there leaves `lev` null rather than failing the quantile, since the quantile is what Quick Re and the Excel functions ask for.
- No new query parameter: one float per row, computed only on the aggregate basis.

Executor to verify first: on a reinsured `Aggregate`, `obj.q` and `obj.prob_loss_assets` read the same (net) law, so `lev` and `q` are consistent. If they differ, stop and report, since that difference is the whole question.

## Files

- `src/aggregate_api/models.py`, `src/aggregate_api/routes/objects.py`, the route's test file, `CHANGELOG.md`, `dev/TODO.md`, `src/aggregate_api/__init__.py`

## Tests

1. On an unreinsured fixture, `lev` at each p equals `obj.prob_loss_assets(a=q).L`, is below the mean, and rises with p.
2. On a reinsured fixture, `lev` is computed on the net law: it is at most the net mean.
3. `basis=occurrence` gives `lev` null; existing fields are unchanged.

## Version

A feature, a minor: the next free one after whatever is in flight, one commit, `[x.y.0] quantiles route reports the limited expected loss at each quantile`.

## Execution log

- **2026-10-19, review.** Passed. The go came with the `/execute-plan` request that also named `[DecL-Word-List]` and `[Sheets-Template]`. Executed as 1.28.0.
- **2026-10-19, the executor's check.** On a reinsured `Aggregate`, `q` and `prob_loss_assets` read the same law: both go through `Aggregate._grid_distribution()`, the `GridDistribution` over `density_df.p_total`, which is net. Probed on `agg Net 5 claims sev lognorm 10 cv 1 occurrence net of 50 xs 20 poisson aggregate net of 50 xs 80` at log2 13: the `p_total` mean equals `est_m` (42.80), and `L` at `p = 1` is that mean, not the gross 50. A `Portfolio` and a pair's `total` (a `GridDistribution`) carry `prob_loss_assets` too, so all three aggregate basis kinds get `lev`. No stop.
- **Divergence [tests 1 and 2].** "Below the mean, rises with p" is tested as at most the mean and non-decreasing: at `p = 1` the limit is the top of the support, so `lev` equals the mean to float precision, and a grid quantile can sit still across two probabilities (three dice: `q(0.999) = q(1) = 18`). Test 2 also builds the gross program and checks its `lev` at `p = 0.999` passes the net mean, so the net bound is not met by accident.
- **Divergence [extra tests].** Two beyond the plan's three: a `prob_loss_assets` that raises nulls `lev` and keeps the quantile, and a portfolio's `lev` matches its library value. The pair test (`test_bivariate_total_moments_and_quantiles`) gains one assertion.
- **Divergence [non-finite].** A non-finite `L` is reported as null, since JSON has no NaN and a NaN would fail the whole response.
- **Noted, not acted on [payoff].** The library documents `prob_loss_assets` as a loss-side construction, meaningful only on a loss oriented, zero based grid. A `payoff` aggregate still gets a `lev`, because telling the orientation apart would need a private name (`_is_loss_value`). aSP builds loss objects only.
- **Divergence [TODO entry].** `dev/TODO.md` had no `[Quantiles-LEV]` entry; one is added, ticked.
