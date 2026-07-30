# plan-misc-03 — (gathering) assorted playground tweaks

Status: **gathering.** Open collection plan — specs land here as we discuss
them; nothing is being built yet. When the list is substantial enough to be
worth a build we do a final review, (probably) `/compact`, then implement the
whole batch in one go: one version bump, one CHANGELOG section.

This is the **gather → review → execute** pipeline documented in
`human-hints.md`. Predecessors `plan-misc-01` (→ 1.0.0a9) and `plan-misc-02`
(→ 1.0.0a10, punch-ups → 1.0.0a11) ran the same loop.

Target: **1.0.0a12** (provisional — one bump for the batch).

## Items

| # | Item | Layer | Effort | Status |
|---|------|-------|--------|--------|
| 1 | Show `note` + parsed `hints` on the build summary line | backend + frontend | easy | specced |
| 2 | `fmt()` turns 500000 → "5" (strips integer trailing zeros) | frontend | easy | specced |
| 3 | Promote the VPS launch from `nohup` to a systemd service | ops (no code) | easy | specced |
| 4 | Doc tidy: `examples.py` docstring still says `test_suite.agg` | docs (no code) | easy | **done** (1.0.0a12) |
| 5 | Examples loader: follow new statement syntax (`;` / line breaks) + new keywords | backend | medium | **done** (1.0.0a12) |
| 6 | Migrate `multivariate` -> `bivariate` (new class + kind) and fix `reins_description` attribute | backend + frontend | medium | **done** (1.0.0a12) |
| 7 | Follow `describe` -> `summary_df` rename (Describe tab -> Summary) + `explain_validation` -> `validation_explanation` | backend + frontend | medium | **done** (1.0.0a12) |
| 8 | Full `aggregate` a76-a84 surface sweep: `line` -> `unit`, `price_ccoc` signature, kappa guard; drop transitional fallbacks | backend | medium | **done** (1.0.0a12) |
| 9 | `aggregate` a85-a87 sweep: `reins_describe` -> `reins_summary_df`; InfiniteVarianceError 422; transformer ValueError | backend + frontend | medium | **done** (1.0.0a12) |

> **Note on the version bump.** Items 1–2 are code changes and carry the
> `1.0.0a12` bump + CHANGELOG line. Items 3 (ops) and 4 (doc-only) are pure
> tidying — they ride along in this batch but don't themselves bump the version.

---

## 1. Add note + parsed hints to the build summary line

**Want.** The one-line build summary under the Build button currently reads, e.g.

```
F.ExactGamma · Aggregate · bs = 2 · mean 5000 · CV 0.43589 · not unreasonable · cached
```

Append, after `cached`:
- **note** — the program's `note{...}` text, if any;
- **parsed hints** — the program's `hints{...}` text, if any.

So the line becomes `… · cached · <note> · <hints>` (each only when present).

**Available on the object (verified).** A built object exposes both as plain
strings: `obj.note` (e.g. `'hello world'` from `note{hello world}`) and
`obj.hints` (e.g. `'log2=14, bs=2'` from `hints{...}`); both are `''` when the
program omits the clause. So no DecL re-parsing is needed — read them off the
built object like `mean` / `cv`.

**Fix.**
- *Backend* (`models.py`, `routes/objects.py`): add `note: str | None = None`
  and `hints: str | None = None` to `BuildResponse`. Populate in
  `_summary_fields` (or alongside it): `getattr(obj, "note", "") or None` and
  `getattr(obj, "hints", "") or None` so empties serialize as `null`. Fill on
  both the fresh-build and cache-hit return paths (both already spread
  `_summary_fields`).
- *Frontend* (`web/src/main.js`, `renderSummary`): after the `cached` chip, push
  `sep()` + a `note` span when `res.note`, then `sep()` + a `hints` span (label
  it, e.g. `hints: log2=14, bs=2`) when `res.hints`. Keep the `· ` separator
  style; both are plain mono text.

**Notes.** Note/hints are per-program metadata, not numbers — no formatting
concerns. `hints` is shown verbatim (the raw clause text); a malformed hints
clause already surfaces its own library warning, out of scope here. Tiny test:
build a program with `note{…}` + `hints{…}` and assert the BuildResponse carries
them; build one without and assert both are `null`.

---

## 2. `fmt()` mangles integer-valued floats in [1e5, 1e6): 500000 → "5"

**Problem.** `agg F.ExactGamma 5000 claims sev lognorm 100 cv 2 mixed ig .3`
shows `mean 5` in the summary, but the mean is **500,000**. (The author's hunch
— "eng format without the letter" — was close; it's a trailing-zero strip.)

**Root cause (verified).** `agg_m` is correct: the backend sends
`mean = 500000.00000000023` (theoretical mean; floating noise makes it a
non-integer). In `web/src/utils/format.js`, `fmt()` routes a non-integer in
`[1e-3, 1e6)` through:
```js
value.toPrecision(6).replace(/\.?0+$/, '')
```
`(500000.00000000023).toPrecision(6)` → `"500000"` (a 6-significant-digit
integer string, **no decimal point**). The strip regex `/\.?0+$/` makes the dot
*optional*, so it eats the five trailing zeros of a plain integer string →
`"5"`. Confirmed in node: current result `"5"`. The intent of the strip is only
to trim trailing zeros *after a decimal* (`"1.5000"` → `"1.5"`).

This bites any integer-valued float that `toPrecision(6)` renders without a
decimal — i.e. the `[1e5, 1e6)` band (`200000` → `"2"`, `250000` → `"25"`, …).
Below `1e5`, `toPrecision(6)` pads a `.0`, so the bug hides; `≥ 1e6` goes
scientific.

**Fix.** Only strip trailing zeros when a decimal point is present:
```js
let s = value.toPrecision(6);
if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
return s;
```
Verified in node: `500000.00000000023` → `"500000"`, `250000` → `"250000"`,
`1.5000` → `"1.5"`, `1.000` → `"1"`, `0.301662` → `"0.301662"`.

**Out of scope — the validation message is correct.** `explain_validation()`
returning *"fails sev mean, agg mean"* on this program is **not** a bug: at the
auto-picked `bs = 60`, log2 = 16, the fat tail (`mixed ig .3`, lognorm cv 2)
under-resolves, so the FFT-grid moments diverge from the theoretical ones —
that's the warning doing its job. The *displayed* mean (`agg_m = 500000`) is the
theoretical value and is right; only its rendering was broken.

**Notes.** `fmt()` is shared (summary line + any remaining JS-side number
formatting; tables now render through CsvGrid). The fix is display-only and
strictly narrows the strip. Add a `format.test`-style check or a small node
assertion: `fmt(500000) === "500000"`, `fmt(1.5) === "1.5"`, `fmt(1) === "1"`.

---

## 3. Promote the VPS launch from `nohup` to a systemd service

**Want.** The VPS app is relaunched via `nohup … &` to `~/aggapi.log` (fine for
dev log-watching, but no auto-restart and no start-on-boot). Make it durable by
running it under systemd. *(Ops task — the author creates the unit on the box;
no repo code change.)*

**Boilerplate** (already in `human-hints.md` → "Later: run as a systemd
service"; reproduced here so this item is self-contained). Drop at
`/etc/systemd/system/aggregate-api.service`:
```ini
[Unit]
Description=aggregate_api (FastAPI/uvicorn)
After=network.target

[Service]
Type=simple
User=steve
WorkingDirectory=/home/steve/hacking/aggregate_api
ExecStart=/home/steve/.local/bin/uv run aggregate-api --host 127.0.0.1 --port 8001
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aggregate-api    # start + run on boot
sudo systemctl restart aggregate-api         # after a deploy
journalctl -u aggregate-api -f               # watch logs (replaces tail -f)
```

**Check before enabling.** Confirm the `uv` path with `which uv` (the unit
assumes `/home/steve/.local/bin/uv`); keep `--port 8001` so it stays behind the
existing Caddy `reverse_proxy 127.0.0.1:8001` for `agg.mynl.com`.

**Follow-up.** Once live, `refresh.sh` swaps its `pkill` / `nohup` block for a
single `sudo systemctl restart aggregate-api`, and the `dev/TODO.md` **SM** item
"Set up service to run on vps" gets ticked.

---

## 4. Doc tidy — `examples.py` module docstring names the wrong file

**Problem.** `src/aggregate_api/examples.py`'s module docstring (and a couple of
inline comments) describe the loader as parsing `aggregate/agg/test_suite.agg`.
The loader actually reads `agg/spa_examples.agg` (see `_read_suite_text`, which
falls back to `spa_examples.agg`, with `AGGAPI_EXAMPLES_FILE` as the override).
Stale since the source file was switched.

**Fix.** Update the module docstring and any `test_suite.agg` references in
`examples.py` to `spa_examples.agg` (note the `AGGAPI_EXAMPLES_FILE` override).
Doc-only — no behavior change, no version bump on its own.

**Resolved already (no action):** the earlier nit that `F.ExactGamma` was
byte-identical to `F.ApproxGamma` — the author has since made `F.ExactGamma` a
true exact build (dropped `approximate sgamma`), so the two are now distinct.

**Done (1.0.0a12).** The source file moved on past `spa_examples.agg` to
`examples.agg`; the docstring/comments now name that and describe the statement
model. Folded into item 5's commit.

---

## 5. Examples loader: follow `aggregate`'s new statement syntax + keywords

**Problem.** `aggregate` changed DecL so programs separate statements with a
blank line or a trailing `;` (line breaks replaced the `\` continuation). The
bundled `examples.agg` is now semicolon-terminated and writes the portfolios
across several indented lines. The loader (`examples.py`) only folded
`\`-continuations and only matched a `note{...}` at end-of-line, so under the
new syntax:
- every multi-line `port` (section F) and the `bivariate` example (section H)
  dropped out of the dropdown entirely (`F` → 0 items, `H` → 0 items);
- every `;`-terminated single-line program lost its `note` and kept a stray
  `note{...};` glued onto its decl.

**Fix.** Delegate statement splitting to `aggregate`'s
`UnderwritingLexer.preprocess` (the same routine the default `build` underwriter
runs on the file) instead of the local `_fold_continuations`, then run the
item/note regexes over the resulting clean, one-line, `;`-free statements.
Refresh `_ITEM_LINE` for the current grammar: add `bivariate` / `bv` and
`clash`; add the view-pair prefixes `grossceded` / `grossnet` next to
`netceded`; drop the retired `mv` / `multivariate`.

**Verified.** All ten sections A–J populate (`F` → 6 portfolios, `H` → 1
bivariate); `;`-terminated items keep a clean decl + note. Regression test
`test_multiline_and_keyword_examples_captured` added; `test_examples_contain_dice`
updated for the `A.Dice00` → `A.ThreeDice` rename.

---

## 6. Migrate `multivariate` → `bivariate`; fix `reins_description`

**Problem.** `aggregate` renamed `MultivariateAggregate` → `BivariateAggregate`
and retired the `multivariate` / `mv` keywords for `bivariate` / `bv` (+ `clash`
and the `netceded` / `grossceded` / `grossnet` view-pairs). The api still
classified on the old class name (so a `bivariate` program 422'd as an
unsupported kind) and labeled everything `"multivariate"`. Separately,
`Aggregate.reins_description` became a plain string attribute (was a method), so
the `reins_description` endpoint — which only called a *callable* — returned
empty text for every reinsured object.

**Fix.**
- *Backend* (`routes/objects.py`): `_classify_object` maps `BivariateAggregate`
  → `"bivariate"`; the build-guard kind tuple + error message updated;
  density_df docstring updated. `models.py`: `BuildResponse.kind` `Literal` swaps
  `"multivariate"` → `"bivariate"`. `reins_description` route reads the attribute
  directly (tolerating the legacy callable).
- *Frontend* (`web/src/main.js`): kind label (`Bivariate`), timing word, the
  `NA_TABS_BY_KIND` gating key, and the density-fetch kind switch all move to
  `"bivariate"`. Needs a `scripts/build-web.ps1` rebuild to refresh the bundle.

**Verified.** `test_bivariate_builds_and_reports` (renamed from the `_MV` test;
asserts `kind=="bivariate"`, common surface 200, price/reins/bs-window 400) and
`test_reins_description_present` both pass; full suite 57 passed.

---

## 7. `describe` → `summary_df` (Describe tab → Summary) + validation rename

**Problem.** The live `aggregate` change renames the object-level `describe`
property to `summary_df` (it landed mid-task: `describe` is now gone). It also
replaced the `explain_validation()` *method* with a `validation_explanation`
*string* attribute. On our side that meant: the Describe tab/CSV would 400 once
`describe` disappeared, and the build status line's validation chip already went
blank (`explain_validation` no longer callable).

**Fix (full rename, reins left alone).**
- *Backend* (`routes/objects.py`): `GET /description` → `GET /summary`
  (`get_summary`), reading via a `_summary_frame` helper that prefers
  `summary_df` and falls back to `describe` for the transition window. CSV map
  token `describe` → `summary` with value `summary_df` (same fallback in
  `get_frame_csv`). `_summary_fields` reads `validation_explanation` (fallback to
  the legacy `explain_validation()` callable). Doc/comment sweep, leaving every
  `reins_describe` reference intact.
- *Frontend* (`web/`): tab relabeled **Describe → Summary** — `index.html` tab
  (`data-tab="summary"`, target `#t-summary`), pane (`pane-summary`,
  `data-csv="summary"`), help text; `api.js` `description` → `summary`
  (`/summary`); `main.js` `name === 'summary'` branch, `PANE_OF` entry, and
  comments. Rebuilt the SPA bundle.

**Note.** `reins_describe` / `reins_description` are a separate reinsurance
surface and were explicitly left unchanged (per the author). The
`summary_df`-then-`describe` fallback can collapse to `summary_df`-only once the
library rename is everywhere.

**Verified.** `test_summary_endpoint` + `test_frame_csv_summary` (renamed),
bivariate surface check uses `summary`, and `test_build_summary_fields` (the
validation chip) pass; full suite 57 passed.

---

## 8. Full `aggregate` a76–a84 surface sweep (`line` → `unit`, pricing sigs)

**Problem.** A bigger naming rationalization landed on `aggregate` (commits
a76–a84). Beyond items 5–7, the remaining drift was found by inventorying every
attribute/method the API touches and probing it against the new surface:

- **`line` → `unit` throughout (a81).** `Portfolio.line_names_ex` is gone — the
  kappa **plot** guard (`plotting.py`) keyed off it, so every Portfolio kappa
  plot wrongly 400'd. The `pricing_at` frame index renamed `line` → `unit`.
- **`Portfolio.price_ccoc(ccoc, *, p)` (was `price_ccoc(p, ccoc)`).** Arg order
  swapped and `p` is keyword-only; the constant-CoC `/pricing_at` path raised
  `TypeError` (500).
- **Clean-break removals (a84).** `describe` and `explain_validation` were
  deleted outright (no aliases); the transitional fallbacks added in items 5–7
  are now dead code referencing a removed surface.

**Fix.**
- `plotting.py`: kappa guard + comment `line_names_ex` → `unit_names_ex`.
- `pricing.py`: `price_ccoc(ccoc, p=p)`; `pricing_at` rows keyed `index_name="unit"`;
  docstrings.
- `routes/objects.py`: drop the `describe` and `explain_validation` fallbacks
  (read `summary_df` / `validation_explanation` directly); drop the
  `reins_description` callable fallback; remove the now-unused `_summary_frame`
  helper and the `get_frame_csv` summary special-case. `models.py`: "per-line"
  → "per-unit".

**Confirmed unchanged-and-working** (probed live): `summary_df`, `stats_df`,
`density_df`, `bs_window_df`/`_bs_window_df`, `agg_m`/`agg_cv`,
`price_pentagon(*, p, ROE|LR)`, `calibrate_distortions`,
`analyze_distortions(*, p).pricing_df`, `distortion_df`, `reins_describe` /
`reins_stats_df` / `reins_density_df`, the `exeqa_*` columns, and the parser
imports (`_PARSER`, `UnderwritingLexer`, `parser_errors`, `decl_writer`,
`aggregate.style`).

**Verified.** Two new tests for the previously-untested breakages —
`test_plot_kappa_portfolio` and `test_pricing_at_ccoc_portfolio` — plus the
existing pentagon/distortion tests; full suite **59 passed**. No SPA source
changed in this item, so no rebuild needed.

---

## 9. `aggregate` a85–a87 sweep

**Problem.** Three more library releases landed after a84.
- **a85** renamed the last `describe`-verb frame property: `reins_describe` →
  `reins_summary_df` (on `Aggregate` / `Portfolio`). Also rebuilt the
  `BivariateAggregate` reporting surface (`summary_df` reshaped, `stats_df`
  slimmed, new `dependency_df`) and turned a few accessors into properties
  (`reins_kinds`, `tvar_info_df`, bivariate `corr`/`marginals`).
- **a86** made transformer `ValueError`s surface directly (no longer wrapped in
  Lark's `VisitError`); added `dbvsev` / discrete `bv` DecL forms.
- **a87** raises `InfiniteVarianceError` (a `ValueError` subclass, exported from
  `aggregate.constants`) when an infinite-variance aggregate is built without an
  explicit `bs`.

**Inventory result.** Of all this, only `reins_describe` is on the API's surface.
The other a85 property/redesign changes (`reins_kinds`, `tvar_info_df`,
bivariate `corr`/`marginals`/`dependency_df`, the reshaped frames) are **not**
touched by the api — frames are serialized generically, so no change. `dbvsev`
is a severity clause inside a `bv` statement; the examples loader keys on the
top-level `bivariate`/`bv` keyword, so its regex is unaffected.

**Fix.**
- *Backend* (`routes/objects.py`): endpoint `/reins_describe` → `/reins_summary_df`
  (`get_reins_summary_df`, reads `reins_summary_df`); the `reins_description`
  route's availability signal reads `reins_summary_df`; `_CSV_FRAMES` token +
  value `reins_summary_df`; route-list docstring.
- *Frontend* (`web/`): Reins tab sub-button **"reins describe" → "reins summary"**
  (`data-reins="reins_summary_df"`) and `state.reinsWhich` default. SPA rebuilt.
- *No code change needed* for a86/a87 — the build handler's `except ValueError`
  already maps both the direct transformer `ValueError` and
  `InfiniteVarianceError` to a 422 with the library message. The defensive
  `except VisitError` clause is kept (harmless cover for non-`ValueError`
  transformer exceptions).

**Verified.** Renamed reins tests to `reins_summary_df`; added
`test_infinite_variance_without_bs_returns_422`; updated the distortion-kind
test comment for the direct-`ValueError` path. Full suite **60 passed**; SPA
bundle rebuilt and confirmed (`reins_summary_df`, no stale `reins_describe`).
