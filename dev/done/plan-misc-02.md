# plan-misc-02 — (gathering) assorted playground tweaks

Status: **done** (→ 1.0.0a10). All six items implemented in one batch with a
single version bump and CHANGELOG section. Backend: `routes/objects.py`
(VisitError→422, multivariate kind + guard, whitespace collapse, raw-moment
drop, density binning wiring), `serializers.py` (`bin_density`), `models.py`
(`kind` Literal). Frontend: `web/index.html` + `web/src/main.js` (Price
defaults, grey-out gating, multivariate labels + density). Tests in
`tests/test_objects.py` (3 density tests reworked to the binning contract; 4
new regression tests). SPA bundle rebuilt.

This ran the **gather → review → execute** pipeline documented in
`human-hints.md`. Predecessor `plan-misc-01` ran the same loop (→ 1.0.0a9).

Target: **1.0.0a10**.

## Items

| # | Item | Layer | Effort | Status |
|---|------|-------|--------|--------|
| 1 | `dist … <bad kind>` → ugly 500 instead of clean 422 | backend | easy | specced |
| 2 | `mv` / `netceded` (MultivariateAggregate) don't build | backend + frontend | med | specced |
| 3 | Collapse newlines/tabs in input so multi-line works without `\` | backend | easy | specced |
| 4 | Omit raw-moment rows (ex1/ex2/ex3) from stats / reins stats | backend | easy | specced |
| 5 | Price defaults: CoC 0.10→0.15, LR 0.70→0.90 | frontend | easy | specced |
| 6 | Density display: power-of-two binning (faithful p_total) | backend | med | specced |

> **House rule (author, this batch):** the playground **never hides menu items.**
> A tab/control that doesn't apply is **greyed out (disabled)** to signal "not
> applicable", or it renders gracefully / explains itself — the menu set stays
> stable. This **supersedes plan-misc-01 C**, which *hid* Price/Reins/bs-window
> for distortions via `d-none`; item 2 below retrofits that to grey-out.
>
> **Playground mindset:** this is a single-object playground, not a batch
> compiler — one program per build. That removes a class of "what if they submit
> N things" worries (see item 3).

---

## 1. Build-time semantic errors return 500, not 422

**Problem.** `dist MYD pd 0.5` (typo `ph`→`pd`) returns **HTTP 500** with an ugly
body, even though the underlying message is actually informative:
*"Unknown distortion kind 'pd'; available: ['beta', …, 'ph', …]"*.

**Root cause.** The build try/except in `routes/objects.py` (≈ lines 320-367)
maps DecL parse failures to 422 two ways — `except ValueError` (the modern
`ValueError` carrying `.report` / a Lark `UnexpectedInput` on `__cause__`, which
*also* catches generic library validation `ValueError`s → 422) and a defensive
`except UnexpectedInput`. But an unknown distortion kind is raised *inside the
Lark transformer*, so it surfaces as **`lark.exceptions.VisitError`** — neither
a `ValueError` nor an `UnexpectedInput` — and falls through to the catch-all
`except Exception → 500`. (Verified: `type(exc) == VisitError`,
`exc.orig_exc` is a `ValueError("Unknown distortion kind 'pd'; available: …")`.)

This is a *user* error (bad input), so it belongs in the 422 family with the
clean message, not a 500.

**Fix.** Add an `except VisitError` clause (import from `lark.exceptions`) ahead
of the catch-all. Unwrap `exc.orig_exc` (fall back to `exc`) and return
**422** with `str(orig_exc)` as the detail — same audit `status="build_error"`
path the validation-`ValueError` branch already uses. Item B of plan-misc-01
already made the SPA render a plain-string 422 detail legibly, so the playground
will show *"Unknown distortion kind 'pd'; available: …"* in the error pane.

**Notes.** Keep the catch-all `except Exception → 500` for genuine server bugs.
`VisitError` is the lark wrapper for any exception raised while transforming a
parse tree, so this also cleans up other semantic-validation messages that
currently 500. Worth a regression test (`dist X pd 0.5` → 422).

---

## 2. Support `MultivariateAggregate` (`mv` / `netceded`)

**Problem.** `multivariate …` (alias `mv`) and `netceded …` are real DecL
keywords (in `aggregate/decl.lark`) but don't build through the api — they
return **422 "api supports 'agg', 'port' and 'distortion' only; got
'multivariateaggregate'"**. They build a `MultivariateAggregate` object the
api's `_classify_object` doesn't recognize.

(The user's `mv` / `netceded` failures were valid keywords with placeholder
syntax in my first probe; with correct syntax — e.g. `multivariate MV.Indep 25
claims agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 agg B dfreq [0 1] [.5 .5]
sev gamma 50 cv 1.0 poisson` and `netceded agg MV.NetCeded 8 claims sev 300 *
beta 2 3 occurrence net of 0.7 so 60 xs 40 poisson` — they build a
`MultivariateAggregate` in the library.)

**Same pattern as Distortions (plan-misc-01 C).** Relax the build guard + add a
kind, then gate the SPA. Reporting surface, probed on a live object:

| Attribute | Form | Endpoint | Works? |
|---|---|---|---|
| `name` | `str` | manifest | ✅ |
| `info` | `str` | `/info` | ✅ |
| `describe` | `DataFrame` (3×7: kind/mean/sd/cv/skew/corr/copula_tau) | `/description` | ✅ |
| `stats_df` | `DataFrame` (12×3: A/B/joint) | `/stats_df` | ✅ |
| `plot` | method | `/plot` (native) | ✅ (460 KB SVG, renders) |
| `density_df` | **DataFrame 512×512 joint density matrix** (x rows × y cols) | `/density_df` | ⚠ see below |
| `explain_validation`, `agg_m`, `agg_cv` | absent | summary | None (getattr-gated, fine) |
| `bs` | **`list`** (per-component) | summary | `_num("bs")` → `float(list)` raises → None (fine) |

**Work to do.**

*Backend* (`routes/objects.py`, `models.py`)
1. Import `MultivariateAggregate` (confirm top-level export from `aggregate`;
   else walk `type(obj).__mro__`). In `_classify_object`, return `'multivariate'`
   for it (generic, like `'distortion'`). Relax the build guard to accept it.
2. Widen `BuildResponse.kind` Literal to add `'multivariate'` (plan-misc-01 C
   showed the response model 500s on an unlisted kind — same trap).
3. `_summary_fields` already getattr-gates everything; `bs` being a list yields
   `None` via the `float()` guard. Acceptable; optionally special-case to show
   the per-component bs list later (not required for first cut).

*Frontend* (`web/src/main.js`)
4. Summary / timing label: add a `multivariate → "Multivariate"` case.
5. **Tab gating = grey-out, never hide** (house rule above). A
   `MultivariateAggregate` has no pricing / reinsurance / bs-window → mark
   **Price**, **Reins**, **bs window** *disabled* (greyed, non-interactive),
   not removed. Keep Info, Describe, Stats, Plot enabled.
   - Rework `applyKindGating`: toggle Bootstrap's `.disabled` class (on
     `.nav-link` / `.dropdown-item`) instead of `d-none`. Drive it off a
     per-kind "not-applicable tabs" set: `distortion` and `multivariate` share
     `{price, reins, bswin}`; `agg`/`port` disable nothing.
   - **Retrofit plan-misc-01 C**: the a9 distortion path currently *hides* those
     three (`d-none`). Switch it to the same grey-out. (a9 already shipped the
     hide; this corrects it — net behavior change, so call it out in CHANGELOG.)
   - If the active tab becomes disabled by a rebuild (e.g. was on Price, then
     builds a distortion), fall back to Info (keep the existing redirect).
6. **Density tab — show, don't hide.** The frame is a **512×512 joint-density
   matrix** (x rows × y cols), not `loss,p_total,F,S`, so the curated request
   would render empty. Per the house rule, the tab stays and renders something:
   request the **full** `density_df` (no curated `cols`) for `multivariate` —
   it serializes in ~0.2 s and CsvGrid scrolls it in a bounded viewport — with a
   short caption noting it's the joint density. (Mirrors the distortion density
   branch already added in a9, which pulls the full g-curve frame.) A bespoke
   heatmap is a later polish, not this batch.

**Risks.** Low-medium. Native plot is large (~460 KB SVG) but valid; the joint
density is wide but renders. Add a smoke test mirroring the distortion one
(build → info / describe / stats / plot 200; price/reins clean 400).

---

## 3. Collapse newlines/tabs in the input so multi-line works without `\`

**Want.** Let users format a program across several indented lines in the editor
*without* the ugly `\` line-continuation, e.g.

```
agg A
    100 claims
    sev lognorm 10 cv 1
    poisson
```

**Why it's needed (verified).** DecL treats a **newline as a program separator**:
`build("agg A\n100 claims\n…")` parses `agg A` alone → "Unexpected end of input".
The only current way to wrap is `\` continuation. But the *same program collapsed
to one line builds fine* — including a Portfolio: `port P agg A … agg B …` on one
line builds a `Portfolio`. So replacing the newlines/tabs with spaces before the
build gives the multi-line ergonomics for free.

**Proposed transform.** Replace runs of whitespace (incl. newlines/tabs) — and
any `\` line-continuation — with a single space, then strip:
```python
import re
normalized = re.sub(r"\s+", " ", decl.replace("\\", " ")).strip()
```
(Replace, don't delete — deleting would merge tokens: `100\nclaims` → `100claims`.
Dropping `\` first folds existing continuation programs in too.)

**Where — backend (decided).** Normalize `req.decl` at the top of the build
path, before both `aggregate.build()` and `canonicalize_decl()` (the cache key).
Every client benefits (not just the SPA); cache keys become
formatting-insensitive (a dedup win — `cache.py:canonicalize_decl` today
*preserves* interior whitespace and explicitly flags stronger normalization as a
future enhancement, so this lands it); parse-error carets already echo the
server's `source`, so they stay consistent against the collapsed form.

**Downsides / things to check.**
1. **Multiple independent programs — non-issue (playground).** Newline-separated
   *separate* programs would merge into one, but this is a single-object
   playground — one program per build, full stop. Not a supported workflow, no
   regression. (Author confirmed.)
2. **`#` comments** — *not* a downside: `#` isn't accepted in the input box today
   (the grammar errors on it; only the `.agg` *file* reader strips `#`). So
   collapsing newlines can't "eat" a comment. (If inline `#` is ever supported,
   revisit — a joined line would swallow the rest.)
3. **`\` usage** — confirm `\` only ever appears as line-continuation in DecL
   (no severity/dist token uses it) before blanket-replacing it. (Low risk;
   verify during implementation.)
4. Must run *before* parse, so a parse-error report reflects the collapsed source
   the user effectively submitted.

**Size.** Small — one transform (`re.sub(r"\s+", " ", decl.replace("\\", " ")).strip()`)
at the build entry + a test (multi-line agg and multi-line `port` both build).

---

## 4. Omit raw-moment rows (ex1/ex2/ex3) from stats / reins-stats tables

**Want.** The Stats and Reins-stats tables show the raw moments E[X], E[X²],
E[X³] as rows `ex1`, `ex2`, `ex3`. Nobody reads E[X²] — drop those rows and keep
the human-readable `mean`, `cv`, `skew` (and the `meta` block as-is).

**Shape (verified).** Both `stats_df` and `reins_stats_df` carry a **2-level
MultiIndex** on the rows, `(group, statistic)`:
- `stats_df` group ∈ {`meta`, `freq`, `sev`, `agg`} (agg *and* port);
- `reins_stats_df` group ∈ {`gross`, `ceded`, `net`};
- statistic ∈ {`ex1`, `ex2`, `ex3`, `mean`, `cv`, `skew`} for the freq/sev/agg
  (and gross/ceded/net) groups. The `meta` group has its own labels
  (`limit`, `attachment`, `el`, `prem`, …) — no `ex*`, so it's untouched.

**Fix.** Drop rows whose **innermost** index level is in `{"ex1","ex2","ex3"}`,
before serialization. A small shared helper in `routes/objects.py` (or
`serializers.py`):
```python
_RAW_MOMENTS = {"ex1", "ex2", "ex3"}

def _drop_raw_moments(df):
    """Omit E[X], E[X^2], E[X^3] rows; keep mean / cv / skew (and meta)."""
    stat = df.index.get_level_values(-1)   # works for MultiIndex and flat
    return df[~stat.isin(_RAW_MOMENTS)]
```
Apply in the **`stats_df`** and **`reins_stats_df`** endpoint handlers (the
displayed previews), just before `frame_to_payload`.

**Decision — CSV download: leave it FULL (decided).** The full-frame CSV route
(`/frame/stats_df.csv`, `/frame/reins_stats_df.csv`) keeps `ex1/ex2/ex3` — it's
the "give me everything" export, and not touching the CSV path is the easier
change (author: "whichever is easier"). Only the *displayed* stats / reins-stats
endpoints filter.

**Notes.** Row-only filter — columns (units / total / gross-ceded-net)
untouched. Doesn't affect `describe` (already mean/cv/skew-style) or the headline
summary. Add a test asserting `ex1/ex2/ex3` are absent and `mean/cv/skew`
present.

---

## 5. Price defaults: CoC 0.15, LR 0.90

**Want.** The Price tab's target input defaults to CoC `0.10` / LR `0.70`. Bump
to **CoC 0.15** and **LR 0.90** (LR is the *technical* premium ratio — no
expenses — so 0.9 is the natural default).

**Where.** Two spots, both frontend:
- `web/index.html:214` — `#price-target-val` ships `value="0.1"` (CoC is the
  default-checked radio) → `value="0.15"`.
- `web/src/main.js:500` — the radio-toggle sets `isCoc ? '0.1' : '0.7'` →
  `isCoc ? '0.15' : '0.9'`.

**Size.** Trivial. (The `p` default `0.99` is unchanged.)

---

## 6. Density display — bin (aggregate), don't stride-skip

**Problem.** The density downsample (`serializers.py:141-148`) is **even-spaced
row sampling** (`linspace` → keep every ~k-th row, drop the rest). The cumulative
columns survive (F, S at any kept row are still the true CDF/SF there), but the
**`p_total` column is misleading**: each shown value is the mass of a single
bucket while ~k buckets were skipped around it, so the column understates local
probability by ~k× and doesn't sum to 1.

**Measured.** lognorm/100-claims at log2=16: support 44 275 rows, downsample to
2000 ⇒ k=23. The shown `p_total` sums to **0.045**, not 1 — off by ~23×. (The
`p_total>0` filter barely helps: discretized continuous densities carry tiny
nonzero mass across 67–99 % of the grid — fat thin tails — so it's nearly a
no-op; the downsample is what makes the table light. A full frame is 4–19 MB.)

**Fix — power-of-two binning (aggregating) downsample.** Show the density at a
coarser *display* bucket while keeping the fine build. The reduction **must stay
on the power-of-two paradigm** (author): bin by a factor **`k = 2**j`** so the
super-bucket width is `k·bs` (a clean `bs` multiple) and the result is exactly
`2**(log2 − j)` grid-aligned rows — i.e. *as if built at a coarser `bs`*, nothing
off-grid. Target a display size of **`2**11 = 2048` rows**:

```
j = max(0, source_log2 - DENSITY_DISPLAY_LOG2)   # DENSITY_DISPLAY_LOG2 = 11
k = 1 << j                                         # 1, 2, 4, 8, ...
```
e.g. log2=16 → j=5, k=32 → 2048 rows; log2=18 → j=7, k=128 → 2048; log2≤11 →
k=1 (no binning, show the whole grid). `source_log2` comes from
`entry.obj.log2` (agg/port have it; distortions/multivariate take their own
paths, below).

Aggregate over each **grid-aligned** super-bucket (`np.arange(n) // k`, so edges
sit at multiples of `k`, aligned from row 0 — the power-of-two structure):
- **mass columns** (`p_total`, `p_sev`, any `p_*`) → **sum** (probability-conserving);
- **everything else** (`loss`, `F`, `S`, **and the `ex***` series** — `exa_*`,
  `exeqa_*`, `exlea_*`, `lev_*`, …) → **last** (the super-bucket's right edge).

The `ex***` / `F` / `S` columns are pointwise functions of `x` (conditional
expectations, CDFs), not masses — so right-edge sampling is the consistent rule
(author agrees). Only the masses sum. Validated numerically: binned
`sum(p_total)=1.000000`, and `max|binned p_total − F.diff| = 1.2e-15` — the
summed mass equals the CDF increment across each super-bucket, so
`loss`/`F`/`S` = "last" is provably consistent with `p_total` = "sum".

**Implementation.**
- New helper in `serializers.py`, e.g.
  `bin_density(df, source_log2, *, sum_cols, display_log2=11)`: compute `k=2**j`,
  group `np.arange(len(df)) // k`, `groupby(...).agg({col: "sum" if col in
  sum_cols else "last"})` built in column order. `k==1` → return `df` unchanged.
  Keep `frame_to_payload`'s stride-`downsample` for the generic frames (stats —
  summing is meaningless there).
- Wire into **`density_df`**, **`reins_density_df`**, and **`kappa`** (the
  `exeqa_*` slice). For density `sum_cols = {c for c in cols if c.startswith("p")}`
  (so `p_total`/`p_sev` sum, `loss/F/S` last); for kappa `sum_cols = {}` (all
  `exeqa_*` are right-edge). Bin the **full grid** — drop the `nonzero` pre-filter
  on this path (after summing `2**j` buckets almost nothing is exactly zero, and
  binning the full grid is what keeps the clean `2**(log2−j)` count / alignment).
- **Scope:** binning is the curated display path. The **full CSV download stays
  unbinned/exact** (the escape hatch).
- *Optional:* trim leading/trailing all-zero super-buckets for focus — but that
  breaks the exact `2**m` row count, so off by default.

**Frontend.** Essentially no change — the server now bins to a fixed `2**11`
display grid, so the SPA can drop the `downsample`/`nonzero` query params (the
endpoint owns the reduction). The `p_total` column simply becomes correct.
(Optional: a caption noting "binned to 2^11 display buckets at bs·2^j".)

**Supersedes the earlier A/B/C question.** This is an improved "keep server-side
reduction" (A) that's now *faithful*, so it removes the correctness motivation
for (B) full-frame+worker. (B) remains a possible later "scroll the entire
density live" feature — still on the backlog, gated on the clean public origin —
but is **not** needed for this batch.

**Effort.** Med (backend): one helper + three endpoint wirings (density / reins /
kappa) + tests (assert binned row count is `2**11`, `p_total` sums to ≈1, F/S
match the fine frame at super-bucket edges).
