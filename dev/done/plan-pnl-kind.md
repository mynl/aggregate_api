# plan-pnl-kind — first-class `pnl` kind (aggregate a114→a145 pickup)

Status: **done (1.0.0a14).**

Target: **1.0.0a14** (one bump).

## Why

`aggregate_api` last synced against `aggregate` 1.0.0a113 (the a13 landing). The
editable checkout had since advanced to **1.0.0a145** — ~30 releases (PnL/XPnL
engine, labels namespace, reinstatements, variable rating, bivariate expansion,
reins premium scaling, an a145 bs-window rework). A full two-sided surface audit
(every import, attribute, method, class-name check, frame token and DecL keyword
the api touches, cross-checked against the library's CHANGELOG + git log a114–a145)
found **almost all of it internal or serialized generically — no api change**.

The one thing that reached our surface: **the P&L engine now builds a real
object.** `build()` returns `aggregate._pnl.PnL` for a `pnl` / `xpnl` program.
`_classify_object` had no `PnL` case, so it fell through to an unaccepted
`"pnl"` kind → **every `pnl`/`xpnl` build 422'd.** Worse, the bundled (read-live)
`examples.agg` now ships a `pnl H.PnL …` example that appeared in the dropdown
and **failed when a user clicked it**. This plan makes `pnl` a first-class kind.

## PnL surface (probed live at a145)

`class PnL(LabeledMixin)`; `xpnl` builds the same class (no subclass), so one
name check covers both.

| Tab | PnL | Mechanism |
|---|---|---|
| Overview | YES (partial) | density (synthesized) + `summary_df`; absent `tail_df` skipped |
| Info | YES | `info` absent → `construction_explanation` |
| Summary | YES | `summary_df` |
| Validation | YES (often empty) | `validation_df` (empty when legs `bs=0` — 200, 0 rows) |
| Stats | YES | `stats_df` |
| Density | YES (synthesized) | `density_df` is a **dict** of `GridDistribution`s, not a frame |
| Plot | YES | native `.plot()` → sets `.figure` |
| Price / Reins / bs-window | NO → 400 | those accessors absent |

Present scalars: `name`, `mean`/`cv` (no `agg_m`/`agg_cv`), `construction_explanation`
(no `info`), `result` (grand-result `GridDistribution`, `.x` signed / `.p`).
Absent: `validation_explanation`, `bs`, `log2`, `tail_df`, all `reins_*`,
`_bs_window_df`, all pricing methods.

## What landed

**Backend.**
- `routes/objects.py`: `_classify_object` maps `PnL` → `"pnl"` (name check, no new
  import); accepted-kind guard + error text gain `"pnl"`; `_summary_fields` mean/cv
  fall back `agg_m→mean` / `agg_cv→cv`; the `density_df` route special-cases `pnl`
  (synthesize + bin), as does the `frame/density_df.csv` export.
- `serializers.py`: new `pnl_density_frame(obj)` (grand-result → `loss/p_total/F/S`);
  `info_to_payload` falls back to `construction_explanation`.
- `models.py`: `BuildResponse.kind` `Literal` gains `"pnl"`.
- `examples.py`: `_ITEM_LINE` gains `xpnl`.

**Frontend** (`web/src/main.js`, bundle rebuilt): kind label + timing word read
**P&L**; `NA_TABS_BY_KIND.pnl = ['price','reins','bswin']` (mirrors `bivariate`).
The density-fetch switches needed no change — `pnl` correctly uses the
`loss,p_total,F,S` branch the backend synthesizes.

## Verified

`test_pnl_builds_and_reports` (kind=`pnl`, mean populated, info/summary/stats/
validation/density/plot 200, density CSV 200, tail/price/reins/bs-window 400)
and `test_xpnl_item_recognized` (loader regex) added. Full suite **64 passed**.
Live smoke: PnL density returns 2048 binned rows over a signed axis
(−261140…876) with `p_total` summing to 1.0; Info renders the construction
explanation; a142's `summary_df` rename confirmed cosmetic (index column still
`X`/`Agg`, only headers → `Mean`/`P01`/`Median`/`P99`).

## Out of scope (verified non-breaking, no action)

`summary_df` a142 renames; `VariableRatingAnalysis`/`ReinstatementAnalysis`
removal (a144, never on our surface); a145 bs-window rework (public
`bs_window_df` columns unchanged); labels `use_labels` and reins premium scaling
(values, not frame shapes); new `aggregate.constants` warnings. Also deferred:
the two pending `plan-misc-03` code items (note+hints line, `fmt()` bug).
