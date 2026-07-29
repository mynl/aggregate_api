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
- [x] **plan-user-facing — landing "wow factor"** (→ 1.0.0a13). "Description to
      distribution" header + subhead, random group-A hero gallery with load-time
      auto-build, the Overview tab (note + interactive uPlot density/exceedance +
      `summary_df` / `tail_df` exhibits), old tabs under More; new `/tail_df` +
      `/validation_df` api routes off the upstream `aggregate` 1.0.0a113 frames.
      *(done; moved to `dev/done/`)*
- [x] **plan-pnl-kind — first-class `pnl` kind** (→ 1.0.0a14). Picked up the
      `aggregate` a114→a145 surface (a full two-sided audit; almost all internal /
      generic). `build()` now returns a `PnL` for `pnl`/`xpnl`; classify → `"pnl"`,
      guard + `BuildResponse.kind` Literal widened, density synthesized from the
      grand-result grid (dict `density_df`), mean/cv + `construction_explanation`
      fallbacks, `_ITEM_LINE` gains `xpnl`, SPA label/timing/gating + rebuild.
      *(done; in `dev/done/`)*
- [x] **plan-overview-polish — Overview landing punch-ups** (→ 1.0.0a15). Overview
      tables get a `Static | Interactive` toggle (curated exhibit default, CsvGrid
      on demand; the one table exception to the all-CsvGrid rule, since it's the
      demo landing); density/exceedance uPlot capped at 720px; x-axis cropped to
      ~`q(0.001)..q(0.999)` (client-side, mirroring `Aggregate._limits`). Design
      call: no upstream `plot_hero` (FCCs share no base; our uPlot is the hero).
      *(done; in `dev/done/`)*
- [x] **plan-grid-full-chrome — useful CsvGrid** (→ 1.0.0a16). Bumped csv-grid
      3.1.0 → 3.9.0 (pinned commit; 3.1.0 predated copy/save export). Full chrome
      on by default (fzf + column filters + status bar + copy/save); Expand/
      Contract only from 6 cols up; removed the custom per-tab CSV download buttons
      (grid handles export; `/frame/*.csv` endpoints stay for full-frame access).
      *(done; in `dev/done/`)*
- [x] **plan-chrome-about-download — hamburger + About + session download**
      (→ 1.0.0a17). Top-right hamburger (Help / Download / About) replaces the `?`;
      About panel holds the tool versions (moved from the header, + uPlot/Bootstrap
      defines); new `GET /v1/session/models.agg?form=raw|agg` downloads the
      session's built programs (raw = as typed; agg = canonical/re-loadable).
      *(done; in `dev/done/`)*
- [x] **Example-source switcher** *(closed — superseded by `plan-relink-library`
      / 1.0.0a19. `aggregate` merged its three shipped libraries into one
      `library.agg` at a159, so there is no longer a set of sources to switch
      between. The axis that replaced it is `GET /v1/examples?group=topic|kind|role`
      over the tag namespaces. The hamburger's greyed-out "Example source…"
      placeholder should be retired or repointed at the grouping picker.)*
- [ ] Revisit a dedicated **severity-stats** view (the "sev stats" sub-button
      was dropped — no clean upstream accessor). Note `sev` became a buildable
      kind in a19, so the object is now reachable from the playground.

## aggregate Loss Library (aLL) work, staged

The plan behind these is the harness plan of 2026-07-29; one `dev/plan-*.md` and
one version bump each.

- [x] **plan-relink-library — catch up with `aggregate` a148 to a174**
      (→ 1.0.0a19). Examples read off `build.recipes` / `Recipe` instead of the
      deleted `examples.agg`; `?group=topic|kind|role` + `/examples/heroes`;
      `bivariate` → `bvagg`; `sev` buildable; new `/objects/{id}/meta`; the
      `actual_*` / `validation_description` / `recipes` renames followed.
      *(done; in `dev/`, move to `dev/done/` when the stage set closes)*
- [x] **plan-all-branding — aggregate Loss Library (aLL)** (→ 1.0.0a20).
      Two-line banner (name over "description to distribution" in grey small
      caps); name through title / meta / manifest / sw / About / Help / README /
      package description. No-dashes-as-punctuation rule adopted into
      `CLAUDE.md`, user-visible strings swept. *(done; in `dev/`)*
- [ ] **Dash tidy: the ~190 legacy ` -- ` glosses** in internal docstrings and
      comments. Deliberately deferred out of a20 so it does not bury the staged
      diffs; the rule in `CLAUDE.md` says they are cleaned as their file is next
      edited. Promote to its own tidying commit if the author would rather have
      it in one go.
- [x] **plan-echarts-exhibit — ECharts engine + two-panel Overview**
      (→ 1.0.0a21). uPlot retired; `web/src/charts/` with a served house theme
      (`/v1/meta/style`) and an exhibit per kind; density + EP panels with an
      exact index-aligned cursor link and `dataZoom`; new
      `/objects/{id}/unit_density_df`; `sev` gains a sampled `density_df`;
      Overview header block off `/meta`; duplicate Summary dropped from More.
      Bundle 187 → 353 kB gzip, now split four ways.
      *(done; in `dev/`)*
- [x] **plan-exhibit-punchups — first inspection acted on** (→ 1.0.0a22).
      Control row (log y / survival / full x / reference lines), sticky per
      browser; `dataZoom` rescales the y-axis; distortion and bivariate drawn
      square; program disclosure dropped; exhibit titles trimmed. Plus two bugs
      the inspection surfaced: a per-object read race that made the landing page
      500 intermittently for portfolios, and `xpnl`-over-port /
      unresolved-reference turned from 500s into 422s. *(done; in `dev/`)*
- [x] **plan-exhibit-punchups-2 — second pass** (→ 1.0.0a23). Discrete
      densities drawn as steps (`steps-mid`); capital anchors are faint dashed
      verticals with top labels instead of points that could never sit on the
      curve; return periods rounded to integers. Smoke test reworked to replay
      captured fixtures so it needs no server. *(done; in `dev/`)*
- [ ] **Eyeball the Overview.** Still outstanding. The smoke test proves the
      data reaches each chart in a drawable shape, not that any of them looks
      right, and the Chrome extension has not been connected in any session so
      far. Check all six kinds, both breakpoints, and the four toggles.

> **Server policy (2026-07-29).** The author starts and stops servers; the
> tooling here must not. `dev/capture_fixtures.py` and `uv run pytest` both
> drive the app in-process through `TestClient`, binding no port.
- [ ] **Examples: topic groups, fuzzy find, hero sparklines** (→ a22). Pinned
      search + Ctrl+K palette over name / kind / tags / note; sparkline
      thumbnails from a cached heroes payload, built lazily with a fallback.
- [ ] **More as a tab, Bounds placeholder, Reins graphs** (→ a23). More becomes
      a pill with a Reins-style sub-button row; Bounds ships greyed out; Reins
      gains a gross / net / ceded density + EP overlay.
- [ ] **Bivariate 3D viewer** (later). `echarts-gl` surface on the joint density
      behind a dynamic import, with a server-side downsample to ~128x128.

## Raised with `aggregate` (not fixed here)

- [ ] Two `role:hero` portfolios carry `note{}` after the last unit, where the
      positional rule binds it to that unit: `TwoLineBook` and
      `BodoffWindQuake`. Visible as a blank tooltip and Overview lead on the
      landing gallery.
- [ ] `DefectivePareto` has no `topic:` tag, only `role:paper`; it is the sole
      occupant of the topic view's `other` bucket.
- [ ] `Recipe.decl` is `''` for `MinimumDistortion`: `spec_to_decl` has no case
      for a composite distortion whose spec holds constructed `Distortion`
      objects. Worked around with a stored-program fallback.
