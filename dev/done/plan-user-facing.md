# Plan — user-facing first impression ("wow factor")

> **Status: EXECUTED (1.0.0a13).** Reworks the landing experience of the web
> SPA from an internal tool into an immediately impressive demo. Grew out of the
> "lacks demo wow" review. The upstream dependency landed in `aggregate`
> 1.0.0a113 (new `summary_df` / `tail_df` risk views, `validation_df` /
> `tail_behavior_df` renames), so all three sequencing steps shipped together.
>
> **What shipped:** new `/tail_df` + `/validation_df` api routes (the latter
> carrying the old `summary_df` payload); `/summary` repointed to the new risk
> view. SPA: "Description to distribution" header + subhead, a random group-A
> hero gallery with load-time auto-build, the Overview tab (note + interactive
> uPlot density/exceedance chart + `summary_df` + `tail_df` exhibits, with the
> 1-in-200 / 1-in-250 rows highlighted), and Info/Summary/Validation/Stats/
> Density/bs-window demoted under **More ▾**.
>
> **Decisions taken during execution:** (1) the Overview *graceful-degrades* for
> objects without the new frames (a bivariate / distortion shows whatever it
> carries rather than erroring) — heroes are not filtered by kind. (2) Hero
> thumbnails are name-seeded CSS gradients (no network), not remote placeholder
> images. (3) Per the plan's "Decided", a plain **Summary** tab (the `summary_df`
> grid + CSV) is kept under **More** alongside the richer Overview exhibit.

---

## Why

The magic is: **type one plain sentence → get a full compound loss distribution
with a plot, risk metrics, and a price.** The current landing buries all of it —
empty panes until the visitor knows to press Ctrl+Enter, and the default tab is
the internal `Info` key-value dump. A first-time visitor sees a code box and
jargon. This plan makes the payoff visible in zero clicks.

## Page layout (top to bottom)

### Header (item: headline)

- **Brand title** text → **"Description to distribution"** (replaces "DecL
  playground"; `index.html:31`).
- **Brand kicker** "AGGREGATE" **unchanged** (`index.html:32`).

### Subhead (below the header hline)

A static one-liner under the header rule:

> Describe an insurance book and get its full loss distribution, tail risk, and
> price.

### Hero buttons (below the subhead)

**Four buttons**, sourced from **group A** of the examples file (`/v1/examples`).
Group A is the curated "Showcase" set and **will grow** beyond four over time, so
the SPA must **pick four from group A at random on each load** — never assume the
group has exactly four. The chosen four populate the buttons; one of them is the
load-time auto-build (below). Scale to fit a phone (wrap / shrink as needed).

- On **page load**: pick four from group A at random; load + **auto-build** one
  of them → the visitor lands on a fully populated front page, zero clicks.
- Clicking a button loads + builds that example.

**Labels & note — for now:**
- Button **label** = the object's **`.name`** (e.g. `CatXOLTower`). (Later the
  `note` may also feed the label, a tooltip, or the gallery caption — but for v1,
  just `.name`.)
- The example's **`note`** is **displayed at the top** of the result (the
  Overview's lead line / description), not on the button.
- **Button images:** use **random placeholder images** for now — final art /
  per-example sparklines are a later decision.

**Note plumbing (general):** `note` is intended to populate several surfaces
(top-of-result description, future tooltips/captions/labels). v1 wires only the
top-of-result display; everything else reads `.name`.

**Where:** `web/index.html` (button row below the subhead); `web/src/main.js`
(filter `api.examples()` to letter `A`, random-pick four, `build()` one on load —
replaces the `setText`-dice-and-wait at `main.js:67`).

### Editor (as current)

Editor box unchanged. Examples load in the **new expanded multiline DecL format**
(the `format_program` spread layout — each clause on its own indented line).
`loadExample` already round-trips through `api.formatDecl` (`main.js:573`); ensure
it requests the multiline/spread form, not terse.

### Output tabs (reordered)

`Info` → **Overview**, and it becomes the default landing tab. Order:

> **Overview | Plot | Price | Reins | More ▾**

**Overview** contents, top to bottom:
1. **Top line = the example's `note`** (for v1). The object's `note` text is
   shown at the top of the result as its description. (A generated plain-English
   narrative — claims, severity, expected loss, 1-in-100 / 1-in-200 — is a later
   enhancement that can replace or augment the note line.)
2. **`summary_df`** exhibit — moments + key percentiles (mean / SD / CV / skew /
   p01 / p50 / p99, Freq·Sev·Agg), `Agg`/`total` row emphasized.
3. **`tail_df`** exhibit — return-period table (VaR · TVaR · xsVaR · VaR/Mean),
   1-in-200 (S2) and 1-in-250 (US) highlighted.

**More ▾** collects what's no longer front-and-center: **Summary, Stats, Density,
bs window**, plus **`validation_df`** and the raw **`Info`** dump. Note the original
summary has been renamed validation_df in Aggregate (as of 1.0.0a109).

**Where:** `web/index.html` output-tabs markup (`#t-info` → `#t-overview`
default; move Summary into the More dropdown); `web/src/main.js` (`loadTab`
overview branch, tab gating); `web/src/renderers.js` (narrative builder +
two-exhibit layout). Needs the new api fields for `summary_df` / `tail_df` (see
*Dependencies*).

## Interactive plots (item 6)

Today plots are server-side matplotlib (SVG/PNG). The front-page density/CDF only
needs `(loss, p_total, F, S)` — already served by `density_df` as JSON — so the
interactive exhibit needs **no server render**.

**Library options (ranked for this use):**
- **uPlot** — ~45 KB, canvas, handles 2¹¹–2¹⁶ points instantly, cursor readout +
  zoom; tooltips are DIY. *Best perf / phone fit.* ← recommended.
- **Plotly.js** — fastest path to wow (hover, box-zoom into tail, log-y toggle),
  but ~3 MB without a custom bundle.
- **Observable Plot** — D3-based, ~150 KB, elegant defaults; lighter middle.

**Plan:** interactive density + CDF on the front page (uPlot), with a hover
crosshair reading loss ↔ exceedance probability and markers at the
1-in-100/200/250 points. **Keep matplotlib** as the downloadable SVG on the
`Plot` tab (publication-quality export for LaTeX/slides) — don't lose it.
Existing plots (eg Plot tab) remain as server-side generated SVG until
we see how this lands.

**Selection:** Use uPlot. 

**Where:** new `web/src/plot-interactive.js`; feed from `api.density_df`.

## Dependencies

- Items 2 (and the narrative's tail numbers) need the upstream `aggregate` frames
  from `../aggregate_REFACTOR/dev/plan-summary-tail-tables.md`: the new
  `summary_df` (moments + percentiles) and `tail_df` (return-period table), plus
  `validation_df` / `tail_behavior_df` renames. The api's `routes/objects.py`
  and `models.py` must expose the new frames once they land.
- The header/subhead, hero row + auto-build, multiline-example loading, and the
  interactive plot are **independent** and can ship against today's library.

## Sequencing

1. Header text + subhead + hero button row + random auto-build, and load
   examples in multiline format — pure SPA, immediate win.
2. Interactive density/CDF exhibit (uPlot) — pure SPA, uses existing
   `density_df`.
3. Overview front page (narrative + `summary_df` + `tail_df`; old tabs into
   More) — gated on the upstream library frames + new api fields.

## Decided

- **Headline** = "Description to distribution" (brand title); kicker "AGGREGATE"
  unchanged. Subhead text fixed (above).
- **Heroes** = **four picked at random from group A** on each load (group A grows
  over time; never assume exactly four). One auto-builds on load.
- **Labels** = `.name` for v1; **note** shown at top of the result; **random
  placeholder images** on the buttons for now.
- **Overview replaces Info** as default; **Summary moves into More** along with
  Stats / Density / bs window / validation / raw Info.

## Open questions

- Final button art (random placeholders for now) — per-example sparklines vs
  fixed icons vs generated.
- Whether/how `note` later feeds the button label / tooltip too (v1: `.name` only).
