# TODO / Roadmap

Pending work for `aggregate_api`, newest thinking at the bottom of each list.
What has landed is in `CHANGELOG.md` and the git log; completed plans move to
`dev/done/`.

## SM

- [x] Bandwidth limited by caddy page with obscured url; special caddy install
      *(done — `rate_limit` on the public `/Q7M4Z9KP` route, build-only, plus a
      friendly 429 card; see human-hints.)*
- [ ] Set up service to run on vps *(systemd unit documented in human-hints;
      still launched via `nohup`)*
- [x] Limit log2 <= 18 *(`AGGAPI_LOG2_CAP` defaults to 18)*
- [ ] 

## Near term (get it healthy)

- [x] **plan-0001 — bootstrap standalone** (→ 1.0.0a2). Make the extracted code
      import, run, and pass tests as `aggregate_api`. Wire the `aggregate`
      editable source. *(done; moved to `dev/done/`)*
- [x] **plan-ui-enhancements — SPA editor fix & redesign** (→ 1.0.0a3). Tamed
      autocomplete, emacs keys, archivum look-and-feel, tabbed output, native
      plot + reins / CSV endpoints. *(done; moved to `dev/done/`)*
- [x] **plan-0002 — UI tweaks, bug fixes, a4 enhancements** (core → 1.0.0a4).
      Editor fixes, tab reorg + More dropdown, phone-fit, Density + bs-window
      panes, format_program on examples, curated-examples env knob, Price
      pentagon + distortion analysis, friendly 429, bs + timing in the summary.
      Survivors dispersed: C1 + D2 → `plan-misc-01`; D1 superseded by `plan-grid`
      (CsvGrid filters); E is upstream (`aggregate.mplstyle`). *(done; moved to
      `dev/done/`)*
- [x] **plan-misc-01 — p=1 pricing, friendly 422s, standalone Distortions**
      (→ 1.0.0a9). Relaxed `PriceRequest.p` to `(0,1]`; FastAPI validation
      `detail` arrays now render as `"<field>: <msg>"`; `dist …` builds as
      `kind="distortion"` with Info/Describe/Stats/Density/Plot (absorbs
      plan-0002 **C1**); `hints{ log2=N }` now counts against `AGGAPI_LOG2_CAP`
      (absorbs plan-0002 **D2**); csv-grid version shown in the header.
      *(done; moved to `dev/done/`)*
- [x] **plan-misc-02 — assorted playground tweaks** (→ 1.0.0a10). Six small
      fixes: build-time semantic errors (unknown distortion kind) return a clean
      422 (unwrap `VisitError`) not a 500; `MultivariateAggregate`
      (`multivariate`/`mv`/`netceded`) builds as `kind="multivariate"`; input
      newlines/tabs/`\` collapse so multi-line programs build; Stats/Reins-stats
      omit raw-moment rows (`ex1/2/3`); Price defaults CoC 0.15 / LR 0.90;
      density / reins-density / kappa bin to a faithful 2¹¹ power-of-two display
      grid. House rule: tabs grey out (disabled), never hide — retrofits
      plan-misc-01 **C**. *(done; moved to `dev/done/`)*
- [ ] **plan-0003 — dev workflow & smoke test** (later). Document/verify the
      end-to-end loop: `uv run aggregate-api --reload` + `npm run dev`, build the
      SPA, hit `/docs`, build an object in the playground. Add a `ruff` pass.
- [x] **plan-help — short in-SPA help** (→ 1.0.0a5). Always-visible top-right
      `?` opens a compact offcanvas (one-liner, try-it + Load it, keys, controls
      + tab guide, links, fair-use note). *(done; moved to `dev/done/`)*
- [x] **plan-grid — adopt CsvGrid for table output** (→ 1.0.0a7). Every SPA
      table now renders through `csv-grid` (sort / fzf search / per-column
      filters); per-pane chrome, per-column Price formats, destroy lifecycle,
      dead-code sweep (`actions.js` / `pricing-pane.js` / `plot-pane.js` /
      `.tbl` / stale `public/index.html`). Density preview lifted to 2 000 rows.
      *(done; moved to `dev/done/`)*
- [x] **plan-ui-enhancements-01 — small UI polish** (→ 1.0.0a5). Phone-friendly
      form inputs: 16px on mobile (no iOS zoom) + `autocomplete=off` (no AutoFill
      bar) for the Price inputs and the custom-bs input. *(done; moved to
      `dev/done/`)*
- [x] **plan-pwa — installable PWA + retire the obscured prefix** (Phase B →
      1.0.0a6; Phase A VPS cutover 2026-06-13). PWA manifest + `sw.js`; app moved
      to the `agg.mynl.com` subdomain (same-origin, auto-TLS, explicit `/docs`
      404, build rate-limit); `human-hints.md` runbook rewritten. *(done; moved
      to `dev/done/`)*

## Backlog / ideas (unordered)

- [ ] CI: GitHub Actions running `uv run pytest` on the private repo.
- [ ] Decide the canonical `aggregate` dependency story: editable local path for
      dev vs. a pinned version once the `1.0.0a` line publishes.
- [ ] Packaging (was "Plan E"): rebuild the SPA before `uv build` so the wheel
      ships the bundle; confirm `static/*` package-data works.
- [ ] Auth / rate limiting if this is ever exposed beyond localhost.
- [ ] Expand the example library and DecL completion coverage.
- [x] **Density full-frame via CsvGrid `{url}` + worker** (follow-up from
      plan-grid). *(Closed — superseded by the faithful power-of-two density
      binning in 1.0.0a10/a11. The server now bins to a correct 2¹¹ display grid
      with a faithful `p_total`, so the original motivation — escape the lossy
      server downsample — is gone. A live "scroll the entire density" view is a
      possible someday-feature, but it's no longer pending work.)*
- [ ] Persist object cache across restarts (currently in-memory only).
- [x] Revisit `meta` version reporting: report both the `aggregate_api` version
      and the underlying `aggregate` version. *(done in 1.0.0a2 —
      `health`/`meta` carry `version` + `aggregate_version`.)*
- [ ] **`.agg` OS file association** (longer-term, pended from plan-pwa). Once
      the app installs as a PWA, register `file_handlers` for `.agg` + consume
      opens via `launchQueue` → `editor.setText`. Chromium-desktop only, needs
      the PWA installed + HTTPS; value is theoretical until there's a reason to
      double-click a `.agg` into the app. On-ramp: a plain in-page "Open file"
      button (`<input type=file>`). See the "Pended" section of `dev/plan-pwa.md`.
- [ ] Frontend polish: keyboard-shortcut help, sharable URLs for a DecL program.
      *(look-and-feel redesign + emacs keys landed in 1.0.0a3; these specific
      items remain.)*
- [x] Flesh out the **Price** and **More** output tabs. *(a4: Price = pentagon
      + distortion analysis; More = Stats / Density / bs-window.)*
- [ ] Revisit a dedicated **severity-stats** view (the "sev stats" sub-button
      was dropped — no clean upstream accessor).
