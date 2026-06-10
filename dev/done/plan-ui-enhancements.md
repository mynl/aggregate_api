# plan-ui-enhancements — SPA editor & UI redesign

**Target version:** 1.0.0a3 (bump on first code change landed from this plan)
**Status:** done — landed in 1.0.0a3 (see CHANGELOG)
**Goal:** batch the front-end usability + look-and-feel work for the DecL
playground. Tame the editor first (Item 1), then rebuild the layout to mirror the
**archivum** web app (Items 2–4), then wire the backend tab data (Item 5).

Design was iterated as static HTML in `hacks/` (gitignored). **`hacks/mockup-07.html`
is the agreed, locked target**; mockup-01..06 are the iteration trail. Build from
mockup-07.

## Context

The editor (`web/src/editor.js`) is a standard, full-featured CM6 assembly:
`drawSelection`, `defaultKeymap` (clipboard + nav), `history`, autocomplete,
StreamLanguage highlighting. Selection / cut / copy / paste are CM6 built-ins and
are **independent** of syntax highlighting and autocomplete — so the "no cut and
paste" symptom is not caused by the editor "doing too much."

The genuine offender is autocomplete aggression: `activateOnTyping: true`
(`editor.js:90`) fires `declCompletionSource` on **every keystroke**, and that
source does a **network round-trip to `/v1/decl/complete`** each time
(`completion.js:35`). The popup keeps reappearing, lags behind typing, and grabs
Enter / Tab / arrows. Ruled out: no duplicate `@codemirror/*` core; served bundle
is current.

## Design language (archivum-derived)

Mirror `C:\s\TELOS\Python\archivum_project\src\archivum\web` — *family
consistency, not slavish*. Concretely:

- **One UI font** (kills the "hostage note" feel): system stack
  `-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. Monospace
  (`"Cascadia Mono", SFMono-Regular, Consolas, monospace`) only for code, the
  editor, the feedback line, and numeric table cells. `#a81313` red kept for
  inline `code` (mynl nod). No STIX serif in this app's UI.
- **Bootstrap 5.3 + Bootstrap Icons**, blue `#0d6efd` primary, white body,
  sticky white header with `shadow-sm`, `max-width:1280px` container (no visible
  outer card — the container is the only width bound).
- **`nav-pills` tabbed output** in a faint full-width box (`#f1f3f5`, rounded);
  active pill = white + `shadow-sm` + blue text.
- **Dense booktabs tables**: horizontal rules only (`#1a1a1a` top/header/bottom,
  no verticals, no zebra), `font-variant-numeric: lining-nums tabular-nums`,
  `~0.7rem`, tight padding, `overflow-x:auto`. Numbers right-aligned, label
  column left.
- **Separator dots (`·`)**: one consistent style everywhere (header, build
  summary, reins line) — mono glyph, muted `#6c757d`, matching the feedback
  row. Avoid faint light-grey; it reads as "too small".
- **Sub-button labels**: de-slug the underlying accessor and drop a trailing
  `_df`, but **keep the prefix** — `reins_describe → "reins describe"`,
  `reins_stats_df → "reins stats"`, `reins_density_df → "reins density"`,
  `stats_df → "stats"`. Lowercase.

### Page structure (top → bottom)

1. **Header** — logo (`static/logo.png`, ~40px) + "DecL playground" title with a
   tiny mono `AGGREGATE` kicker; RHS `aggregate <ver> · api <ver> · docs · github`
   with middle-dot separators (versions hide below `md`).
2. **Editor box** — top-level, archivum-search-box treatment: rounded `0.75rem`,
   `shadow-sm`, blue focus glow, **`bi-x-circle` clear** top-right. CM6 mounts
   here.
3. **Feedback line** — archivum `query-feedback` style (mono `0.70rem`, muted,
   single line, ellipsis). Text: `Ctrl+Enter build · Ctrl+Space complete · ↑↓
   history` then, right-aligned, `emacs keys:` + a switch. Whole line is
   `d-none d-sm-flex` (folds away on phones — no Ctrl key there anyway).
4. **Buttons row** — `Build` (primary) · `Examples ▾` · `log2 ▾` · `bs ▾`. All
   `shadow-sm`, one size. `log2` dropdown = `auto | 10..16` (button shows current
   value); `bs` dropdown = `auto | 1 | …​ | custom-input(Enter)`.
5. **Build summary line** (canonical name in code/comments/CSS) —
   `name · kind · mean · CV · validation`. Validation prints the library string
   ("not unreasonable" when all good), green. Single line, ellipsis; the `⌄`
   expand toggle shows **only when the text overflows** (resize-aware), else
   hidden.
6. **Output tabs** — `Info · Describe · Plot · Stats · Reins · Price · More`.
   `Info` is the default/active tab. Each tab has a small sub-button tool row.

## Items

Newest at the bottom; tick as they land.

### Item 1 — tame autocomplete (manual trigger + debounce) — **active**

- **`editor.js`** — `autocompletion({...})`: set `activateOnTyping: false`
  (popup only on Ctrl-Space), keep `closeOnBlur: true`, keep `Tab →
  acceptCompletion` (no-op when closed; `indentWithTab` handles insert).
- **`completion.js`** — only call `api.complete(...)` when `context.explicit`;
  otherwise return the static pool (no network). Optional debounce via
  `web/src/utils/debounce.js` if typing-triggered completion is restored later.
- Rebuild (`.\scripts\build-web.ps1`); verify smooth typing, working
  clipboard/selection, no per-keystroke `/v1/decl/complete` calls.

### Item 2 — emacs editing keys + toggle

- **`editor.js`** — add `emacsStyleKeymap` from `@codemirror/commands` to the
  keymap (gives Ctrl-A/E line start/end, Ctrl-K kill-line, Ctrl-Y yank,
  Ctrl-N/P next/prev line, Ctrl-F/B/D). One import + spread into the keymap
  array. **Order matters**: place emacs bindings where they win over any
  conflicting `defaultKeymap` entry but still let `customKeymap` (Mod-Enter etc.)
  take precedence.
- A **toggle** in the feedback line enables/disables it. Implement via a
  `Compartment` (already imported in `editor.js`) so the keymap can be swapped at
  runtime without rebuilding the editor; expose a `setEmacs(bool)` helper.
  Persist the choice in `localStorage`.
- Note: this only works because we're on CM6; a `<textarea>` can't do it. Keep CM6.

### Item 3 — look-and-feel rebuild (CSS + index.html)

- Port the mockup-05 CSS into `web/src/styles/site.css` (replace the STIX-serif
  identity with the archivum system-sans language above). Keep `cm6.css` token
  colors but align the editor chrome (rounded box, shadow, focus glow, clear-X)
  to the new look.
- Rewrite `web/index.html` to the page structure above: header (logo + versions),
  editor box with clear-X, feedback line (+ emacs switch), buttons row
  (Build/Examples/log2/bs dropdowns), summary line, and the `nav-pills` tab bar +
  `tab-content` panes.
- `main.js` rewiring: build → summary + default Info tab; tab `shown.bs.tab`
  (or click) lazily fetches that tab's data once and caches client-side;
  `log2`/`bs` dropdowns set build options; `Examples` unchanged; clear-X clears
  the editor; emacs switch calls `setEmacs`.

### Item 4 — backend: native plot + tab data endpoints

Verified against `aggregate` source at `../aggregate_REFACTOR/src/aggregate`
(`distributions.py` = Aggregate/Severity, `portfolio.py` = Portfolio). Use a
**`getattr` gate** everywhere: if the attribute/method is missing or returns
`None`/raises, disable that sub-button (frontend) / return a 400 with a clear
"not available for {kind}" (backend) rather than 500. Wrap every accessor in
try/except and surface a tidy message.

**Plot — call the object's own `.plot()`** (replace the bespoke
density/cdf/qq/kappa dispatch in `plotting.py`):
- `Aggregate.plot(axd=None, xmax=0, **kwargs)` (distributions.py:5747) and
  `Portfolio.plot(axd=None, figsize=...)` (portfolio.py:2573) each build their own
  multi-panel figure when `axd=None`.
- New render path: inside `agg_style.context(**WEB_OVERRIDES)`, call `obj.plot()`,
  then capture the figure (`fig = plt.gcf()` — verify whether `.plot()` returns
  the fig/axes and prefer the return value if so), `savefig` (svg default, png
  option), and `plt.close(fig)`. Keep the existing close-to-avoid-leak discipline.
- Frontend Plot tab: single image + `svg` download. Drop the old
  density/cdf/qq/kappa buttons. (The legacy `kind=` endpoint can stay for now or
  be removed — decide during impl; nothing else uses it once main.js changes.)

**Describe** — JUST `obj.describe` (property; Aggregate distributions.py:5956,
Portfolio portfolio.py:1071). Already wired at `objects.py:434`. `head(20)` not
needed (small). Sub-buttons: copy, csv.

**Stats tab**:
- `stats_df` — attribute on both (set distributions.py:3957; MultiIndex). Already
  wired at `objects.py:454`. Small → show in full (it's a `*_stats_*` frame, the
  head(20) cap does **not** apply).
- Second button labelled "sev stats": **`sev_stat_df` / `sev_stats_df` does NOT
  exist** in the source. Resolve the real accessor during impl — candidates: the
  `sev` rows already inside `stats_df` (index level), or `obj.sev` (a `Severity`)
  via `.stats()` (distributions.py:8707) / `.moms()` (8369). If nothing clean
  exists, drop the button. **Open decision for the author.**

**Reins tab** (Aggregate & Portfolio; only meaningful when reinsurance present —
`occ_reins`/`agg_reins` not None, else show "no reinsurance on this object"):
- Always-visible text block above the table = **`reins_description(kind='both',
  width=0)`** → returns a string (Aggregate distributions.py:5588). Portfolio may
  lack it — getattr-gate and fall back to `reins_describe`.
- Buttons → frames: **`reins_describe`** (property; distributions.py:3174 /
  portfolio.py:1310), **`reins_stats_df`** (property; distributions.py:2859 /
  portfolio.py:1266), **`reins_density_df`** (property; distributions.py:2472 /
  portfolio.py:1221). Plus csv.

**More tab** — placeholder for now. The author named `_bs_window_df`, but the
source only has the `_bs_window(...)` **method** (distributions.py:6347 /
portfolio.py:1971), no `_df`. Leave as a placeholder pane; revisit.

**Price tab** — placeholder for now. Pricing is Portfolio-oriented
(`run_pricing` already exists in `pricing.py`); customize later.

**Row-count rules for big frames (apply in `serializers.py` / the route):**
- Default: any large DataFrame → `head(20)`.
- **Except `*_stats_*` frames** (`stats_df`, `reins_stats_df`, sev stats): show in
  full — they're small.
- **Except `*density*` frames** (`density_df`, `reins_density_df`): filter
  `p_total > 0` first (the actual support; cf. Aggregate's own
  `density_df.query('p_total > 0')` at distributions.py:2334), then take every
  *n*-th row so ~20 rows display. `p_total` is the canonical prob column on both
  Aggregate and Portfolio density frames (`p` is an alias).
- A **download (csv)** button on each table gives the full data; the on-screen
  table is intentionally a preview.

### Item 5 — wiring + verify

- Add/adjust routes + `models.py` response shapes for: native plot, reins
  description (text) + reins frames, sev-stats (pending name). Reuse
  `frame_to_payload` (supports `downsample`/`start`/`stop`) for the density
  every-*n*-th-row preview.
- `uv run pytest` green; extend tests for the new endpoints (mirror existing
  `tests/` patterns; `TestClient`, no live server).
- Rebuild SPA, smoke-test: build Dice (Aggregate) and a multi-line Portfolio with
  reinsurance; click every tab; confirm dense tables, native plot, reins text,
  csv downloads, emacs keys, responsive fold on a narrow window.

## Close out (when the batch lands)

- Bump `pyproject.toml` to `1.0.0a3` (first code change triggers it).
- Add a `## 1.0.0a3` section to `CHANGELOG.md` summarizing the UI redesign.
- Tick the frontend-polish entry in `dev/TODO.md`; move this file to `dev/done/`.
- (Author commits.)

## Open decisions for the author

- **Sev stats** accessor name (Item 4) — `sev_stat_df` doesn't exist; pick the
  real source or drop the button.
- **Price** tab placement/behavior and **More** tab contents — deferred,
  placeholders for now.
- Legacy `plot?kind=` endpoint — keep or remove once native `.plot()` lands.

## Notes / decisions

- Keep CM6 — correctly assembled; this plan tunes it (Items 1–2), not replaces it.
- Dropped STIX serif for archivum system-sans to fix "too many fonts."
- Build from `hacks/mockup-07.html`; it encodes the agreed structure + CSS.
