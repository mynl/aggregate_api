# plan-misc-01 — pricing p=1, friendly validation errors, standalone Distortions

Status: **final — ready to implement.** Target: **1.0.0a9** (one bump for the
four; small and related as "make the playground less brittle"). No upstream
changes (D's `update=False` route was rejected, so nothing upstream to confirm).

Three independent fixes, found while exercising the Price tab and `dist …`:

| # | Item | Layer | Size |
|---|---|---|---|
| A | Allow `p = 1` (max) in pricing | backend | 2 lines |
| B | Render FastAPI 422 validation errors instead of "HTTP 422" | frontend | ~8 lines |
| C | Allow standalone `Distortion` objects | backend + frontend | medium |
| D | Enforce the log2 cap against `hints{}`, not just the request | backend | small |

C supersedes **plan-0002 C1**; D rehomes **plan-0002 D2** (both plans now retired
into here). plan-0002's **D1** (table filters) was delivered by **plan-grid**
(CsvGrid filters/search), and **E** (mplstyle) is an upstream `aggregate` matter.

---

## A. Allow `p = 1` (max) in pricing

**Problem.** Price tab with `p = 1` returns HTTP 422 before anything runs.

**Root cause.** Two Pydantic constraints:
```python
# src/aggregate_api/models.py
191:  p: float | None = Field(None, gt=0, lt=1, …)   # PricingRequest  (pricing_at)
219:  p: float        = Field(...,  gt=0, lt=1, …)   # PriceRequest    (Price tab)
```
`lt=1` rejects `p = 1`.

**Verified safe.** `q` defaults to the *lower* quantile and `q_lower(1)` returns
the finite maximum of the support (`utilities.py` appends a duplicate last bucket,
so it's robust even when the cumsum lands a hair under 1.0). Ran a bounded
portfolio through the exact `run_price_pentagon` path at `p=1`: pentagon solves
(`a=q(1)=max`) and all four distortion slices (LR/P/PQ/ROE) compute with **no
warnings, no errors**.

**Fix.** `lt=1` → `le=1` on both `p` fields; reword the descriptions to the
half-open interval `(0, 1]`. The SPA needs no change — `#price-p` is already
`max="1"` (inclusive).

**Caveat to document.** On an *unbounded* distribution `p=1` returns the last
grid bucket (grid-dependent), so it is physically meaningful only for **bounded**
ones — which is the motivating use case.

---

## B. Render FastAPI 422 validation errors

**Problem.** Any Pydantic rejection (a bad `p`, an over-cap `log2`, a malformed
`bs`) surfaces in the SPA as a bare **"HTTP 422"** — the real reason is hidden.

**Root cause.** `errorNode()` in `web/src/main.js` handles a `{message}` object or
a string body, but a FastAPI validation error is an **array**:
```json
{ "detail": [ { "loc": ["body","p"], "msg": "Input should be less than 1", "type": "less_than" } ] }
```
`detail.message` is `undefined` and it isn't a string, so the code falls through
to `err.message` = `"HTTP 422"`.

**Fix.** Add an `Array.isArray(detail)` branch that maps each entry to
`"<field>: <msg>"` (field = tail of `loc`) and joins them. Effect: the Price pane
shows **"p: Input should be less than 1"**. General — fixes every validated
endpoint at once. Independent of A (still wanted, so `p=0` / `p=1.5` explain
themselves).

---

## C. Allow standalone `Distortion` objects

**Problem.** `dist MYD ph 0.5` builds a `PHDistortion` in the library but the api
returns **HTTP 422 "api supports 'agg' and 'port' only; got 'phdistortion'"**.

**Root cause.** The build guard (`src/aggregate_api/routes/objects.py:348-360`)
only stores `agg`/`port`; `_classify_object` returns the lowercased class name
(`phdistortion`, `wangdistortion`, …) for everything else, which fails the gate.

**Investigation — no hard blocker.** The common reporting surface was
deliberately built into Distortions. Confirmed on a live `PHDistortion`:

| Attribute | Form | Endpoint | Works? |
|---|---|---|---|
| `info` | `str` | `/info` (`info_to_payload`) | ✅ |
| `describe` | `DataFrame` (attr, **not** callable) | `/description` (`getattr`) | ✅ |
| `stats_df` | `DataFrame` | `/stats_df` (`getattr`) | ✅ |
| `density_df` | `DataFrame` of `g, g_inv, g_dual, g_prime, kusuoka…` over x∈[0,1] | `/density_df` | ✅ (see note) |
| `plot` | method | `/plot` (native) | ✅ (verify `render_plot` native path) |
| `_bs_window_df` | — | `/bs_window_df` | clean 400 (absent) |
| reins / price | — | reins/price routes | clean 400/422 (absent) |

`_summary_fields` is fully `getattr`-gated → returns `None` for bs/mean/cv, so the
build response is fine. So the reporting tabs already work; the gate is the only
hard stop.

**Work to do.**

*Backend*
1. **Relax the build guard** to also accept distortions, and **normalize the
   kind to `'distortion'`** (not the subclass name) so the SPA/endpoints treat
   all distortions uniformly. Detect via `isinstance(obj, aggregate.Distortion)`
   — verify that base class is importable from the top-level namespace; else fall
   back to walking `type(obj).__mro__` for a `Distortion` ancestor.

*Frontend* (`web/src/main.js`, `web/index.html`)
2. **Summary label.** `renderSummary` currently maps `port→Portfolio` else
   `Aggregate`; add a `distortion→Distortion` case (mean/cv/bs are already
   omitted when null).
3. **Density tab columns.** For a distortion the columns are the g-curve, not
   `loss,p_total,F,S` — and `frame_to_payload` silently drops absent columns, so
   the curated request would render *empty*. When `kind==='distortion'`, call
   `density_df` with **no `cols`/`nonzero`** (the table is ~101 rows of x∈[0,1];
   no downsample needed).
4. **Tab gating.** Hide/disable **Price** and **Reins** (and the **bs window**
   More entry) when `kind==='distortion'` — they legitimately 400. Keep Info,
   Describe, Stats, Density, Plot.
5. **Plot.** The SPA already requests the native plot (no `kind`), which maps to
   `Distortion.plot()`. Confirm `render_plot`'s `native` branch just delegates to
   `obj.plot()` and doesn't assume Aggregate-only kinds.

**Decisions**
- *Kind granularity:* store generic `'distortion'` (recommended — uniform UI),
  surface the specific type (PHDistortion, etc.) inside `info`/`describe`.
- *Density labelling:* the "Density" tab shows the g/g_inv curve for a
  distortion, which isn't a loss density. Acceptable as-is for a first cut; a
  later polish could relabel the tab per kind. Not a blocker.

**Risks.** Low. Backend tests stand (`FrameResponse` shape unchanged); SPA is
eyeball-verified. The only new failure surface is the tab-gating logic — verify a
distortion build doesn't leave Price/Reins clickable-into-an-error.

---

## D. Enforce the log2 cap against `hints{}`, not just the request

(Rehomed from **plan-0002 D2**.)

**Problem.** `AGGAPI_LOG2_CAP` (default 18) is a DoS guard, but a program can
dodge it via a DecL `hints{ log2=24 }` clause.

**Root cause.** The cap check (`src/aggregate_api/routes/objects.py:243`) inspects
only `eff_log2 = req.log2 or 0`:
```python
if eff_log2 and eff_log2 > settings.log2_cap:   # request-only
    raise HTTPException(422, …)
```
With no request `log2`, `eff_log2` is 0, the check is skipped, and `build()`
honors the embedded hint — so the *effective* grid is `2**24` regardless of the
cap. The wall-clock timeout bounds *time*, but a `log2=24` grid (~16M buckets ×
several float columns) can OOM the box before the 10 s timeout fires.

**Intent.** Deliberately *allow* `hints{}` to set `bs` **and** `log2` (handy, and
the author uses it) — but enforce the cap against the **effective** `log2`: hints
win *up to* the cap; over the cap → reject. `bs` and every other hint pass through
untouched — this guard only vetoes an over-cap `log2`, it never rewrites the
program.

**Approach — static pre-build scan (chosen).** Don't build to find out: read the
`log2` out of any `hints{}` clause directly from the DecL source, *before* the
build runs. Rejected the alternative `build(decl, update=False)` → `obj.log2`
route because **Distortions have no `log2`** (item C now lets them through), so
reading `obj.log2` is kind-fragile — and even `update=False` still parses/builds.
The scan is kind-agnostic (a `dist …` with no hints simply has nothing to check)
and runs zero compute.

Extract the `log2` from each `hints{ … }` block and fold the max into the
existing cap check:
```python
# any hints{…} block containing log2=N (N before/after other hints, multi-line ok)
HINTS_LOG2 = re.compile(r"hints\s*\{[^}]*\blog2\s*=\s*(\d+)", re.IGNORECASE)

hint_log2 = max((int(m) for m in HINTS_LOG2.findall(req.decl)), default=0)
effective_log2 = max(eff_log2, hint_log2)      # request vs hints, whichever is larger
if effective_log2 > settings.log2_cap:
    raise HTTPException(422, f"log2 {effective_log2} exceeds AGGAPI_LOG2_CAP={settings.log2_cap}")
```
- `[^}]*` keeps the match inside one block (can't cross `}`), so a `bs`-only
  `hints{}` won't false-match and a multi-block `port` is handled per agg line via
  `findall` (take the max).
- Folds into the **existing** check at `objects.py:243` — same 422, same audit
  path, just `effective_log2` instead of `eff_log2`. No new code path.
- Cache key is unaffected: hints live in the decl, which is already part of
  `object_id(canonicalize_decl(decl), …)`, so different hints → different slot.

**Decision.** Reject over-cap with **422** (consistent with the request-log2
path), message naming the *effective* log2 — not a silent clamp. The cap stays at
the **18** default, env-tunable via `AGGAPI_LOG2_CAP` (author confirmed; "16" was
illustrative). Hints may set `log2`/`bs` freely up to that cap.

**Accepted limitation.** This is a guard, not a parser: a non-integer `log2`
expression wouldn't match `\d+` and would slip through — not a real hint form, so
acceptable. (Commented-out `hints{}` false-matches are a non-issue per author.)

---

## Phasing
A and B are trivial and independent — land first (instant payoff; B de-risks the
distortion + p=1 testing by making 422s legible). Then C, then D. One `a9` bump
covers all four; CHANGELOG + TODO updated on landing; tick **plan-0002 C1 + D2**
as delivered here.
