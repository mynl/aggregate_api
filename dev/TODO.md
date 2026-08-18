# TODO / Roadmap

Pending work for `aggregate_api`, newest thinking at the bottom of each list.
What has landed is in `CHANGELOG.md` and the git log; completed plans move to
`dev/done/`.

## Next up: three things, and then we are in good shape

The author's plan, set out 2026-07-31 (Friday), to finish over the weekend. Each
becomes its own `dev/plan-*.md` and its own version bump.

### a) One payload per table, and move the switch — **done** (a34, a35)

The connector arrived while this was being planned. GT 1.8.0 shipped
`irToGridInput(doc)`, 1.9.0 renamed the package back to `greater_tables`, and
both landed: a34 the rename, a35 the single fetch. Every table under 500 rows is
now switchable off one document, the densities stay on the bulk path, and the
`stats_df` divergence that a33 introduced is fixed and guarded.

**The switch did not move.** It is still in the header menu, deliberately: where
it belongs depends on (c), so settle that first. The argument recorded last time
still stands, and is now cheaper to act on: the flip costs no round trip, which
is a point in favor of putting it back next to the table.

Left over from this work:

- **Look at the tables.** Still nobody has seen one in the page, and there is now
  more to look at: 1.7.x spanner rules, and an interactive view whose numbers
  arrive as raw values with IR-declared formats rather than pre-rounded off the
  wire. Build a **portfolio**, then walk Overview, More, Reins and Price flipping
  the switch on each.
- **Upstream, reported**: `include_raw='data'` and `irToGridInput` do not
  compose. `'data'` covers numeric, date and bool columns only, so a string data
  column gets no raw value and the adapter then throws on the whole document.
  Three Price frames carry one. We pass the explicit column list instead. Written
  up in `c:/s/ai/greatest-tables/dev/note-from-aggregate-api-include-raw.md`.
- Two harnesses in `dev/scripts/`: `check-frames.py` (every frame, every kind,
  both routes agree) and `check-adapter.py` (a document is interchangeable with
  its `FrameResponse`). Run both when `greater-tables` moves. A third joined at
  a39: `check-exhibits.py` (every exhibit, every kind: capability and envelope
  agree, byte determinism, insurer blocks match the frame routes row for row).
  A fourth at a44, and it is the app side rather than the server:
  `capture-capability.py` writes one build response per kind to
  `dev/fixtures/capability.json`, then `node dev/scripts/check-nav.mjs` runs the
  real rules from `web/src/nav.js` over them and prints a leaf-by-kind grid.
  Run it whenever a leaf, a gate or a library registration moves.

### Exhibits endpoint, remaining slices (a39 landed the routes)

The `[Exhibits-App-Endpoint]` phase of the library's `dev/plan-exhibits.md`
landed its additive slice at a39: the capability and envelope routes plus
`check-exhibits.py`. Still open, gated on the library's PnL insurer framing
review: the menu-from-capability rewrite (`applyKindGating` and the
hardcoded NA tables read the capability response; `has_reins` gating folds
in; chips gray out, never hide; unknown-to-the-page exhibits list under
More), deleting the migrated `ROW_FLAGS` / `FORMATS` entries and the
`main.js` title and caption literals (pricing FORMATS were to stay; as of
2026-08-12 they delete too, per `dev/plan-pricing-exhibits.md`), wiring
`check-exhibits.py` into CI, and extending `capture_fixtures.py` to the
envelopes. *(The name collision that blocked the last of those is
settled: a62 renamed the chart fixtures to `dev/fixtures/charts.json`,
so `exhibits.json` is free for the library's exhibit envelopes.)* The
`[Exhibits-App-Cleanup]` decision (retire `_drop_raw_moments` by
re-pointing the frame routes at exhibit raw and insurer, or keep the frame
routes as the raw CSV path forever) is taken during the endpoint phase
proper.

**Settled at a71: every table the library publishes is drawn as published.**
Twelve of the nineteen table leaves take the exhibit route, which is all of them
that can. `ROW_FLAGS` is empty and `FORMATS` holds only frames no exhibit
serves. The `[Exhibits-App-Cleanup]` decision above is therefore taken: the
migrated entries are deleted, and the frame routes stay as the raw / CSV api
path, rendered by inference.

What is left, and none of it is a published table: **Bounds** (stays with the
library's `dev/plan-exhibit-official-channels.md` phase 10, the one open item
of that plan), and the **two densities**, bulk and the one exception the
author scoped out. **More Sharpen** closed at a94: `loadSharpenAudit` became
`loadExhibitLeaf` on the a255 `sharpen` exhibit, the two block ledes went
with it, and `tables.FORMATS` is empty. **Pricing** closed at a83 to a85 via
`dev/plan-pricing-exhibits.md` (three subtabs served by three exhibits on
result objects, `[Pricing-Keyed-On-Result]`). The asks were written up as
`aggregate_REFACTOR/dev/note-from-aggregate-api-round-6.md`; items 1, 2, 3, 5
and 6 closed upstream at a251 to a256, and item 4 closed through the pricing
plan.

### b) Consolidate the graphs on ECharts, and fix the options

**Most of the way (a36, a37).** a36 took the Plotly path out: `engine.js`,
`plotly-panels.js`, the `draw` control, the dependency and the 535 kB chunk.
`twoPanelData` stayed.

a37 did item 5 of the a30 graph notes, the horizontal y-to-x readout, plus three
things the first browser look turned up: `full x` widening only one panel, the
return period capped at 1e5, and densities drawing as pyramids rather than steps.

**Superseded, 2026-08-09, by `dev/plan-plot-ir-api.md`.** Configuring ECharts
turned out to be the smaller half. The author's ruling is that the app assumes
IR-based charts always, and purist about it, so the open items from the a30 graph
notes moved into that plan (item 7) alongside the chart-rendering items from
`dev/api-punchlist.md`, and they are done as part of the migration rather than
against the app's own builders. `dev/graphs.md` was deleted once its content
landed there. The plan also carries the deletion of the server-rendered
matplotlib route and the adoption of the four converted emitters.

**Most of that plan landed at a62**: the 2-D adapter, all seven documents
adopted, the purist availability rule, and the control strip off the document.
`exhibits.js` is gone. What is left of it is item 7's remaining punch items
(7.1 zoom disorientation, 7.2 double-click reset, 7.4 the readout in the
legend) and the heatmap declaration upstream.

**Every chart on the page is a different picture now and nobody has seen one.**
Ten documents replay clean through the real adapter in node
(`dev/scripts/smoke-charts.mjs`), which proves they reach the renderer in a
drawable shape and that each declared reading changes the drawing. It proves
nothing about how any of them looks. Worth one browser pass, and there is more
to look at than usual: a **portfolio** now draws a kappa panel instead of an
exceedance panel, a **P&L** carries break-even marks in both panels, a
**bivariate** draws flat and no longer square, and the four controls (log, full
range, return period, invert) are new words in a new place.

### c) Fix what is shown where

The one that decides whether the rest was worth doing, and the least specified.
Feeds back into (a): the switch cannot find its home until the tabs settle.

Reviewing this is what `--library` (a36) is for: point the server at a short
`.agg` and the dropdown and hero gallery narrow to it, so a pass over the tabs
is not a walk through 186 recipes.

```
uv run aggregate-api --port 8001 --library T:\tmp\short.agg
```

Still open from before and probably part of this: the Bounds tab has no content,
and the standing REMINDER below about what is worth plotting.

- [x] **plan-loss-lab-navigation — the answer to (c)**, and it absorbed the
      Bounds item above. Seven stages, one version bump each (a42 to a46): the
      Loss Lab rename, the capability payload that killed `NA_TABS_BY_KIND` and
      `NA_MORE_BY_KIND`, six nav groups with their own sub-tab rows, the
      Sharpen / PnL / Reset action row, the reinsurance entry box, Bounds, and
      the Narrative pane. *(done; moved to `dev/done/`)*

      Left open by it, deliberately: the header's **Perspective** control. The
      plan lists it under page-wide preferences and no stage owns it, so the
      exhibit fetches take `insurer`, which is the plan's stated default. The
      Tables switch beside it is live; this one is not built.

      **Nobody had clicked any of it.** The gating was proved by
      `check-nav.mjs` against real payloads and every route has tests, but the
      six groups, the three derivation buttons, the cession box, the three
      bounds forms and the Narrative pane had never been used in a browser.
      The author's first pass found the Bounds group dark for every object
      (fixed at a48, below), and the rest of that first pass became
      `plan-ui-round-3`, immediately below.

- [x] **plan-ui-round-4 — the second full pass** (a55 to a61, with a54 the
      upstream catch-up that unblocked it). Eighteen items off
      `dev/api-punchlist.md` Round 4, six phases: the nav and its greying; the
      strip's verdict and history; the strip's facts; the action row; two
      hamburger preferences; the cession box and Quick Re.

      Three of the six were the page telling the truth rather than new
      features. The greyed group tab had been unable to draw its own tooltip
      since a48, because Bootstrap's `.disabled` class carries
      `pointer-events: none`. A clean gross under reinsurance tinted the strip
      amber. A bivariate's status line said nothing but its name, because its
      `bs` is two numbers. And `BuildResponse.warnings` had been declared from
      the start and never filled.

      **a60 was not in the plan.** Upstream removed the `plot_envelope` keyword
      the api was passing, and rather than repair a route already marked for
      deletion the author's call was to take matplotlib out: the envelope is a
      chart document now, drawn by a new 2-D path in the adapter, and
      `plotting.py` and the `/plot` route are gone. That is
      `plan-plot-ir-api.md` item 1 and the bounds half of item 5, landed early.
      *(done; move the plan to `dev/done/` once the browser pass below is made)*

      **Nobody has looked at any of it.** Every phase is proved by tests,
      `check-nav.mjs` and a node run of the adapter over real documents, and
      not one of the six has been seen in a browser. Worth one pass: a
      `grossceded` object for the tooltips, a bivariate for the status line, a
      reinsured aggregate for the green verdict and Quick Re, and the Bounds
      envelope for the new 2-D chart.

- [x] **plan-ui-round-3 — the first full pass over the running site**
      (a49 to a52). Roughly forty items off the author's punch list, taken after
      the first end-to-end run. Four phases: the shell and the status strip; the
      charts; the text and the tables; the reinsurance and pricing forms.
      *(phases 1 to 4 done; the doc stays in `dev/` until phase 5 lands)*

      **Phase 5 is not done and is blocked**, on
      `aggregate_REFACTOR/dev/plan-loss-lab-round-3.md` phase A, which has not
      started. Four items wait on it:

      - `evaluate`, gross / net occurrence / net on the Evaluate form, which
        needs the library's basis keyword rather than more of the `_BasisView`
        shim.
      - `alloc`, the per-unit allocation tables a reinsured portfolio silently
        loses, same keyword.
      - `cession`, pricing a cession with a distortion; the library has no glue
        between reinsurance and distortions at all.
      - ~~`replot`, the Reinsurance Plot leaf on a reinsured **portfolio**,
        which greys because `chart_reins` is registered for `Aggregate`
        alone.~~ **Answered, not fixed.** Library a244 rewrote `chart_reins`
        as the occurrence plot and states the restriction as the author's
        decision for 1.0: a book's units cede on different stages, so a
        portfolio-level gross / ceded / net triple would have to pretend they
        cede on the same one, and the aggregate cover is a separate contract
        with a separate picture. The leaf is dark there on purpose and
        `nav.js` says so.

      Two things the round turned up that are the library's and are recorded
      here rather than acted on:

      - `plot_envelope(distortions='space')` is a documented value that does
        nothing: it matches neither of the overlay branches, so panels 2 and 3
        draw empty. a52 stopped asking for it and builds the list itself.
      - `format_program(width=)` is accepted and ignored, which is the agg
        plan's `width` item.

## SM

- [x] Bandwidth limited by caddy page with obscured url; special caddy install
      *(done — `rate_limit` on the public `/Q7M4Z9KP` route, build-only, plus a
      friendly 429 card; see human-hints.)*
- [ ] Set up service to run on vps *(systemd unit documented in human-hints;
      still launched via `nohup`)*
- [x] Limit log2 <= 18 *(`AGGAPI_LOG2_CAP` defaults to 18)*
- [ ] 

## Near term (get it healthy)

- [x] **Bounds was dark for every object** (→ 1.0.0a48). `can_bounds` and
      `can_allocate` reached the browser and were never copied onto the flags
      the rules read, so the group greyed everywhere while `check-nav.mjs`
      passed: the checker called `capsFromResponse` and the app hand-rolled its
      own equivalent. The app now uses that one function, so the two cannot
      drift again. Found on the first browser pass, which is the note above
      earning its place.

- [x] **plan-revamp-aug-06 — the shell revamp** (→ 1.0.0a47). One type scale
      replacing twenty sizes, the press ramp with the house red as the accent
      and blue gone, real folder tabs over a small caps sub menu, one action
      row and one status strip, a merged title-and-gloss line per exhibit,
      greyed items that say why on hover, and keyboard navigation over both
      strips. `site.css` fully tokenized on the way through. Designed in
      `hacks/mockup-10-concepts.html`. Follow-up, still Bootstrap-colored:
      `gt.css`, `csv-grid.css` and the ECharts palette in `charts/theme.js`.
      *(done; moved to `dev/done/`)*
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
- [x] **plan-envelope-band-render, the bounds envelope band draws in the wrong
      place.** The adapter realized the document's `y2` band as an ECharts
      stacked pair, and stacking on twin value axes sums the x coordinates, so
      the upper half drew at doubled x with the raw gap as y (the wavy 0.2
      line) and the fill painted the triangle under the diagonal. Served
      document verified correct; broken since a62. Fixed at a99 with a
      `custom` polygon plus two plain edge lines, and the smoke test gained
      `checkBands`. *(done; moved to `dev/done/`)*

## Backlog / ideas (unordered)

- [ ] CI: GitHub Actions running `uv run pytest` on the private repo.
- [ ] Decide the canonical `aggregate` dependency story: editable local path for
      dev vs. a pinned version once the `1.0.0a` line publishes.
- [ ] Packaging (was "Plan E"): rebuild the SPA before `uv build` so the wheel
      ships the bundle; confirm `static/*` package-data works.
- [ ] Auth / rate limiting if this is ever exposed beyond localhost.
- [ ] **One Underwriter per session.** Raised 2026-08-05, superseded by
      `dev/plan-session-isolation.md` (see the entry at the end of this file),
      which carries the design and the measurements. Kept here because the
      diagnosis is still the shortest statement of the problem: every named
      declaration a build sees is stored as a `Recipe` under `(kind, name)` with
      `source='session'`, so one shared store accumulates every visitor's
      declarations for the life of the process. Two users building different
      `port ABC` collide, last writer wins, and the store grows unbounded. The
      fix is a fork per session, which also gives the session download an honest
      scope.
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

## aggregate Loss Lab (aLL) work, staged

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
      data reaches each chart in a drawable shape and that the panels hold the
      house aspect at both breakpoints, but not that any of them looks right,
      and the Chrome extension has not been connected in any session so far.
      Check all six kinds, both breakpoints, and the five toggles.

- [x] **Watch the full-resolution render cost.** *(Closed by a37, and by an
      answer better than either option recorded here. `sampling: 'minmax'`
      reduces each series to the min and max per device pixel before the path is
      built, so a portfolio hands ECharts a few hundred points rather than six
      polylines of 65,536, and it re-expands on zoom because the sampler runs
      after the dataZoom filter. It was adopted to fix the step rendering, not
      the cost; the cost went with it. No server-side binning, as required.)*

- [x] **Draw atoms as atoms.** Solved in a27 by dropping the binning entirely
      rather than by detecting atoms, which is not possible from the frame: a
      tall bucket and a point mass are the same number, so there is no
      threshold. The plots take every grid point; `resolution='display'`
      survives for the Density *table*. Gzip made the payload a non-issue
      (3.65 MB to 0.35 MB on the wire). *(done)*

- [ ] **The author is not sold on ECharts** (raised a28, alongside the step /
      anchor / surface asks). Recorded so it is not lost: if the exhibits still
      do not earn their keep after a28's changes are *seen*, the question is
      whether the library is the problem or the chart designs are. Worth
      separating before any swap, because most of the a26 to a28 fixes were
      design errors (wrong rectangle measured, wrong default orientation,
      binned data) rather than anything ECharts did. a29 adds one more to that
      column: the reservation was aimed at the wrong rectangle for two kinds.
      **Being settled by experiment**: the a30 Plotly spike puts both engines on
      the same data behind a switch.

- [x] **Plotly evaluation spike** (→ 1.0.0a30). `agg` and `port`, behind a `draw`
      switch in the exhibit control row. The work turned out to be `twoPanelData`,
      the engine-neutral decision step both renderers now read, rather than the
      Plotly code. `plotly.js-gl2d-dist-min` and **not** basic: basic registers
      bar, pie and scatter only, and its SVG `scatter` would choke on the 2**16
      points a27 ships. Parity asserted in the smoke test, including that Plotly
      log ranges are in exponents. *(done; moved to `dev/done/`)*

- [ ] **Look at the two engines side by side.** This is the whole point of a30
      and nobody has done it: the Chrome extension has never connected in any
      session, so no rendered chart from either library has been inspected. Build
      an `agg` and a `port`, flip `draw`, and decide. If Plotly wins, lift
      `twoPanelData` into a real IR with `to-echarts` / `to-plotly` adapters and
      shrink the bundle with a custom build registering only `scatter` and
      `scattergl`. If it loses, `engine.js` and `plotly-panels.js` come out and
      the dependency with them; keep the `twoPanelData` split either way.
      **Update (a38):** the real IR arrived, upstream rather than app side:
      the library's chart IR (`dev/plan-chart-ir.md` there) with the surface
      pilot at a38 (`/chart/{name}` route, `chartdoc-to-echarts.js`,
      `surfaceGrid` deleted). The two-panel family migrates onto it chart by
      chart as the library conversions land; `twoPanelData` remains the app
      side seam until then.

      **Closed 2026-08-09.** The engine comparison is moot: the app assumes
      IR-based charts always, so there is one renderer and no second engine to
      weigh it against. `twoPanelData` is not lifted into an app-side IR, it is
      deleted as each emitter lands. See `dev/plan-plot-ir-api.md`.
      *(Done at a62: it and the whole of `exhibits.js` are gone.)*

- [x] **greater_tables alongside the current tables** (→ 1.0.0a31). One new
      `GET frame/{which}.html` route mirroring the `.csv` one, rendering server
      side on the real DataFrame so the row index sparsifies. `renderExhibit`
      stays and stays the default; GT is reached by `?tables=gt`, no user facing
      switch. Row emphasis preserved as a `<tr>` class. *(done; moved to
      `dev/done/`)*

- [x] **Compare the two static table renderers** (→ 1.0.0a32). Settled by the
      author: "the GT tables are a delight". The comparison ended by replacing
      both sides, since `greatest_tables` (GT2) arrived with a semantic document
      IR and a client-side walker, which is a better answer than either. The
      hand-built `renderExhibit` and the 5.x html path are both gone.

- [x] **Upstream `greater_tables` nit** (closed by the same move). GT2 has no
      import side effects at all, by design, so the `Pandas4Warning` and the
      warnings-filter pollution are gone with the 5.x dependency.

- [x] **Table view everywhere, one switch** (→ 1.0.0a33). The header menu's
      Tables section steers the whole page; the Overview keeps a second
      affordance for the same value. Price frames travel with their documents,
      since a POST computes them. Gated on row count, so density stays
      interactive.

- [ ] **Look at the static tables.** The walker has been verified end to end
      against real documents in Node (sparsified stubs, flags, negative cells,
      raw values in the CSV export), but nobody has *seen* one in the page. Build
      a **portfolio**, since the two level row index is the whole argument and an
      Aggregate does not show it. Then walk the tabs: More, Reins and Price all
      render statically now and none of those have been looked at either.

- [ ] **Math in tables and titles.** The walker emits `\(...\)` for page MathJax
      unless a `katex` object is passed, and the SPA loads neither, so a `$...$`
      cell would render as literal delimiters. Nothing sends one today. It is the
      same decision as the chart labels, so make it once for both; it is now
      pressing on the chart side, because documents arrive carrying
      `ChartDoc.tex` (library a209) and the adapter drops it. Held with the
      chart half at `dev/plan-plot-ir-api.md`, item 8, where the ruling is that
      the IR emits a TeX and a plain-text form of every label and the renderer
      picks one.

- [x] **Report to the greater-tables side**: its `requires-python = ">=3.13"`
      forced this repo's floor up from 3.11. *(Fixed upstream: 6.0.0a2 puts the
      floor back to 3.11 and says it verified 3.11, 3.12 and 3.13. Acting on it
      here is part of the catch-up below.)*

- [ ] **Catch up with `greater-tables` 6.0.** The sibling checkout ran from 1.9.0
      to **6.0.0a4** while this repo was elsewhere, and a37 followed exactly one
      thing from it: `TableSpec.formats` became `formatters`, which had 13 tests
      red on `main`. Both harnesses (`check-frames.py`, `check-adapter.py`) are
      clean against 6.0.0a4, so nothing is broken; these are opportunities, not
      breakage.
      - **Put `requires-python` back to `>=3.11`.** a34 raised this repo's floor
        to 3.13 solely because GT declared it, and 6.0.0a2 reverses that. The
        classifiers go back too.
      - **The deploy pin is now actionable.** GT is publishing on the 6.0
        pre-release line, so the standing note below about pinning `6.0.0rc1`
        has something to point at. Check what is actually on PyPI before
        pinning; pip still ignores pre-releases unless the pin is explicit.
      - **6.0.0a4 gives `ratio_cols` percent rendering again**, and adds house
        format defaults (`float_format`, `int_format`, `ratio_format`,
        `date_format`, `table_float_format`). `tables.py` currently spells out
        its own per-column strings in `FORMATS`; some of that may now be a
        default worth inheriting rather than restating.
      - **The walker moved with it.** `/v1/assets/gt-render.esm.js` serves
        whatever the install carries, so 1.10's docs pass and 1.11's "string
        columns pass through as text" are already live in the browser and have
        not been looked at.

- [ ] **The 3-D surface is sugar, not substance** (author's verdict after
      seeing it, a29). "Quite impressive. Fast. But more sugar than substance."
      It stays, since it is built and its chunk is lazy, so it costs the landing
      path nothing. Do not invest further there. The verdict sharpens the
      standing reminder above: the open question is what is worth plotting, not
      what can be rendered.

- [ ] **REMINDER for SM: better things to plot.** The author's note, verbatim:
      "this was a general comment that i need to work out better things to plot.
      Just remind me if i don't come back to it." Not an api task. Raise it next
      time the exhibits come up.

- [x] **Reinsurance-aware pricing.** Landed in a27 as
      `POST /v1/objects/{id}/reins_price`. The a26 blocker (no public way to
      calibrate on the gross basis) dissolved once the author pointed at
      `prob_loss_assets`: a `GridDistribution` over the `reins_density_df`
      column supplies the `(p, L, a)` anchor, `Pentagon.solve` the premium
      target, and `Aggregate.calibrate_distortions` runs against a small view of
      that basis. No library internals reproduced. *(done)*

- [x] **Upstream, small: let `calibrate_distortions` take its distribution.**
      Landed upstream better than asked: `calibrate_distortions(reins_view=...)`
      at a223, fixed for the shapes this api needs at a250
      (`[Reins-Density-Fuzz]`), and richer than `_BasisView`'s three bases
      (`gross`, `ceded`, `net`, plus the occurrence intermediates on two stage
      programs, per `Aggregate.reins_views`). `GridDistribution` is public. The
      shim and `_REINS_BASES` are deletable on a sync to a250 or later, and
      their deletion is scheduled as phase A3 of
      `dev/plan-pricing-exhibits.md`. *(done upstream; app-side deletion
      pending in that plan)*

- [ ] **Hero gallery empty on a first page load (not reproduced).** Reported by
      the author; populated on the next load. The server side is clean:
      `/v1/examples/heroes` answers 200 in ~2 s cold and returns all eight,
      including fired concurrently with `/v1/examples` and `/v1/meta` across
      four separate cold processes, and the service worker never touches
      `/v1/*`. a27 split the fetch and render error paths (they shared one
      silent `.catch`), added one retry after 750 ms, and logs on give-up. Next
      recurrence: check the browser console for `[aLL] hero gallery`.

> **Server policy (2026-07-29).** The author starts and stops servers; the
> tooling here must not. `dev/scripts/capture_fixtures.py` and `uv run pytest`
> both drive the app in-process through `TestClient`, binding no port.
- [x] **plan-examples-find — fuzzy find + hero sparklines** (→ 1.0.0a24).
      Pinned search box in the dropdown and a Ctrl+K palette, both uFuzzy over
      name / kind / tags / note, flat ranked list while searching; hero cards
      upgrade from a placeholder gradient to a real density silhouette from a
      cached `heroes/sparklines` payload fetched after first paint.
      *(done; in `dev/`)*
- [ ] **Put the hero gallery in the Examples dropdown.** a37 took the cards off
      the top of the page, where the author did not want them, and left the
      landing build: one `role:hero` entry is still picked at random and built,
      so the page arrives populated. What is gone is the *showcase*, and it
      should come back somewhere findable. `pickRandom` is still in `main.js` and
      `/v1/examples/heroes/sparklines` is still on the server for it; the SPA
      wrapper for the sparklines came out and is two lines to restore.

- [ ] **Replace the lede.** `web/index.html` carries placeholder copy where the
      hero row was, sized at two lines. The author's to write.

- [x] **Retire or repoint the hamburger's "Example source…" placeholder.**
      *(retired at a69. Shipped greyed-out in a17 for a source switcher that
      a159 made moot: the three shipped libraries are one. The live axis is
      `?group=topic|kind|role`, reachable from the Examples menu, so there was
      nothing left to repoint it at.)*
- [x] **plan-more-tab — More as a tab, Bounds, Reins exhibit** (→ 1.0.0a25).
      More is a pill whose pane carries a Reins-style sub-button row (Validation
      / Stats / Density / bs window / Info); Bounds ships greyed out; Reins gains
      the gross / ceded / net two-panel exhibit above its tables. Build errors
      now render on Overview rather than in a sub-menu. *(done; in `dev/`)*
- [ ] **Reins ceded density is a first-bucket spike** on the shared linear
      window, since the ceded distribution is small next to the gross. The
      `log y` and `full x` toggles cover it for now; if it stays hard to read,
      give each series its own crop rather than one shared window.
- [x] **Bivariate 3D viewer** (→ 1.0.0a28). `echarts-gl` surface on the joint
      density behind a dynamic import (own lazy chunk, 165.9 kB gzipped),
      linear and log height, falling back to the heatmap without WebGL. The
      downsample to 128x128 is client-side after all: the joint payload is
      already only 2,560 rows, so a server-side reduction would have saved
      nothing and added a route. *(done)*

- [ ] **Nobody has seen the 3-D surface render.** `surfaceOption` is pure and the
      smoke test checks the mesh is complete and has relief, but WebGL is not
      exercisable offline. First look should check: does the ridge read on
      `CopulaWindFlood`, is the log floor the right depth, and do the wall
      projections show the marginals usefully or just add clutter.

- [x] **The percentile reference lines come off**:
      `dev/done/plan-no-reference-lines.md`, canonical here and pointed at from
      the library's `dev/done/`. Executed both sides the day it was written,
      2026-08-13: LIB a271 deleted `CAPITAL_ANCHOR` and `LEE_ANCHORS` and the
      marks they built, app a98 is one tooltip and two stale comments, since
      the app draws what it is served. What is left is the mean, and break
      even on a P&L. Browser pass done on all three kinds. One thing to know:
      the mean's label changes side, taking the right as the only vertical
      under the `rightmost` rule, and the rule was left alone. *(done)*

- [ ] **The reflected reading, verification only**:
      `dev/done/plan-chart-reflect.md`, the app half of the library's plan of
      the same name, paired rather than symlinked since each repo owns its
      side. **Both halves are written**: the app at a96, the library at a269,
      which is in the library's working tree rather than committed. The
      upstream question closed the app's way, a269 composing the two
      probability readings with one flip and no `REFLECTED_RETURN_PERIOD_MAP`,
      so `reading-map.js` and its tests need no edit.

      Verification steps 1 to 3 ran clean on the a269 sync, 2026-08-13:
      `dev/fixtures/charts.json` re-captured and `smoke-charts.mjs` all clear,
      with `reflect` offered on exactly the six documents that declare a
      complement axis (`agg`, `severity`, `distortion`, `pnl`, `reins`,
      `envelope`) and absent from `port` and the joint surface.

      **What is left is the browser pass**, step 4, whose load-bearing check is
      that `reflect` with `return period` opens out the *other* end of the
      curve. If it changes nothing there, a double flip is back somewhere.

- [ ] **The joint surface, end to end**: `dev/plan-3d-plot.md`, three parties,
      the canonical copy here and a symlink in the library. In flight rather
      than pending: a72 landed the api half (section 3, the three query
      parameters, the ceiling setting and the chart document cache), a73 the
      app's foundation (section 4.1's one decode, section 8.3's `node --test`
      runner, the `echarts-gl` pin) and a74 the drawing geometry (the window
      range, the sampler, the level line, the cuts, the fit rule).
      **Blocked on the author for section 4.2.1**: the full grid rule and the
      payload budget cannot both be had, measured at 181k to 551k cells against
      the budget's 4,158, and the way out is the library serving the four one
      dimensional curves the rule protects (the total's density, kappa, both
      conditional means) so that the app computes none of them. Everything left
      on this side (the walls, the cuts on screen, the walk, the eight controls)
      draws that answer, so it waits on it. Also waiting on the library for the
      corrected block coordinates, the window chosen before the reduction, and
      the emitted fields, without which the knob is a knob on nothing and two of
      the api tests stay skipped.

- [x] **The Pricing pane through the official channels**:
      `dev/plan-pricing-exhibits.md` (canonical here, symlinked in the
      library), FINAL 2026-08-12. Calibrate, Allocate, Evaluate subtabs served
      by `pricing.calibrate` / `pricing.allocate` / `pricing.evaluate`
      exhibits keyed on new result objects; a debounced pentagon preview line;
      `[Calibrate]` replacing `[Price]`. The library's five phases landed at
      `aggregate` 1.0.0a259 to a263, with execution notes and nine recorded
      divergences in the library's `dev/plan-pricing-exhibits-LIB.md`. Three
      phases here, all landed: **A1 routes a83, A2 pane a84, A3 deletions
      a85.** `pricing.py` is thin runners with no pandas, and `tables.FORMATS`
      holds the two sharpen entries alone, which the sharpen leaf's own cutover
      (above) deletes.

- [x] **SpaceMouse on the joint surface, and the surface out of the app**:
      `dev/done/plan-spacemouse.md`, app repo only, CLOSED 2026-08-12. **Four
      phases: a86 the mesh export, a87 the probe page, a88 the device layer
      plus the camera integrator, a89 the feel**, then **a90 the probe
      findings from the author's unit** (the combined 12-byte layout, travel
      of plus or minus 350, one multi axis collection, no double action from
      3DxWare) with the two bugs that run found, a button mask that could fire
      its own camera reset and a vertical pan running against the hand, and
      **a91 the color ruling**, GLB with per vertex viridis read against the
      colorbar. The relief's row carries `mesh | .glb | .obj | .stl`,
      `spacemouse` and `feel`; Chromium only, feature-detected, greyed
      elsewhere, iPad path untouched and the `echarts-gl` pin unmoved.
      Five residual readings (session lifecycle under the puck, sleep and
      wake, zoom and twist direction, the GLB in 3Dconnexion's viewer and the
      STL in a slicer, the greyed control in Firefox, Safari and iPad) are
      recorded in the closed plan's "What stays unread" section, and come back
      as punchlist entries if they matter.

## Raised with `aggregate` (not fixed here)

- [ ] Two `role:hero` portfolios carry `note{}` after the last unit, where the
      positional rule binds it to that unit: `TwoLineBook` and
      `BodoffWindQuake`. Visible as a blank tooltip and Overview lead on the
      landing gallery.
- [ ] `DefectivePareto` has no `topic:` tag, only `role:paper`; it is the sole
      occupant of the topic view's `other` bucket.
- [ ] **`chart_envelope` resamples without a seed, so its document is not byte
      deterministic.** `_emit_bounds._envelope` draws the bracketing curves with
      `weight_df.sample(n=n_resamples, replace=True)` and no `random_state`, so
      two identical requests produce different bytes and different content
      hashes. That is at odds with what the chart IR's hash is for: the api
      serves `doc.hash` as an ETag, and revalidation therefore never succeeds
      whenever `n_resamples > 0`. The band itself is deterministic, so the api
      asserts revalidation only at `n_resamples=0`
      (`tests/test_bounds.py`). Ask: take a `random_state` / seed argument, or
      derive one from the bounds state, so the document is reproducible. Raised
      2026-08-09 while moving the envelope onto the IR.

- [ ] **A `BivariateAggregate` has no `validation_description`**, so the api has
      nothing to put in the status strip's verdict slot and prints `n/a` there
      (`dev/api-punchlist.md` Round 4 item 3). There *is* a minimal validation
      and it is already computed: the tail **deficit** against a 1e-5 gate,
      surfaced in `bs_description` and `bs_explanation`. But it is a
      mass-conservation check rather than the moment comparison every other kind
      reports, so it is not a drop-in and the api should not fake one by
      relabeling it. Ask: either a `validation_description` on the bv that grades
      the deficit in the same terse vocabulary (`'not unreasonable'` /
      `'pmf deficit 3.2e-04'`), or an explicit statement that a bv is validated
      on mass alone, so consumers can say so in the reader's words rather than
      guessing. Raised 2026-08-09 while triaging the status line.

- [ ] `Recipe.decl` is `''` for `MinimumDistortion`: `spec_to_decl` has no case
      for a composite distortion whose spec holds constructed `Distortion`
      objects. Worked around with a stored-program fallback.

- [x] **Round 5's four asks, all resolved** (the note is
      `aggregate_REFACTOR/dev/note-from-aggregate-api-round-5.md`).
      1. Landed better than asked: raw values travel in every exhibit
         (`include_raw`, LIB a246) with caller-set extent (`max_rows`, a247),
         so `spec_extra=` was never needed.
      2. Consideration rounding landed upstream at LIB a251
         (`_pnl_consideration` rounds at the source); the app's
         `_round_pnl_premium` text rewrite, idempotent since then, deleted at
         a95.
      3. `PnL.value_type` landed at LIB a248; the app's local special case is
         gone.
      4. Superseded 2026-08-13 by `[Chart-Marks-Mean-Only]`, executed the same
         day (`dev/done/plan-no-reference-lines.md`, LIB a271 and app a98):
         the percentile reference lines
         come off entirely, the readout strip answers the same question by
         hover, and the mean stays, so the redesign this ask requested is
         moot.

- [x] **Five Pricing subtabs, and the natural allocation**:
      `dev/plan-pricing-natural-allocation.md` (canonical here, symlinked in
      the library), drafted 2026-08-14. The pane becomes `Calibrate
      Stand-alone  Allocate  Plot | Evaluate`. Stand-alone prices the parts
      alone, Allocate splits the whole across them, Plot draws the kappa
      curves behind the split. **Three api phases, all landed: B1 the routes
      (a103), B2 the pane (a104), the sync (a105).** The library half is
      phases N1 to N5 (`aggregate` 1.0.0a281 to a285) plus the phases of
      `aggregate_REFACTOR/dev/notes-net-natural-allocation.md` (a277 to a280).
      The api went first by the author's instruction and carried a
      `needs_split_allocation` marker and a temporarily dark `pricing:plot`
      row meanwhile; both are deleted at a105. Every acceptance criterion of
      the plan is met, checked in the browser on both reference programs.
      **The plan doc has not moved to `dev/done/`**: the library symlinks the
      canonical copy, so the two moves have to happen together.
- [x] **Hints, the doc catch-up, and a headless flag**:
      `dev/done/plan-hints-docs-headless.md`, drafted and executed 2026-08-17
      against the library at 1.0.0a301. Three independent phases, one bump each.
      **a106**: `--headless` / `AGGAPI_SERVE_SPA=0`, declaring what the
      conditional static mount already did by accident, plus a test pinning that
      `/docs` survives it. **a107**: the Hints button and
      `POST /objects/{id}/hints` over `with_hints` (library a291), which pins the
      realized grid into the declaration's own `hints{}` so a `sev agg.NAME`
      reference to it means one fixed thing. **a108**: the app's `doc{{{...}}}`
      defenses deleted, the library having retired the clause at a301. Two ideas
      from the same list did not land: the PnL face toggle was dropped by the
      author (the two faces are one statement shape, so it is a typed
      character), and the custom-library work is parked in
      `dev/note-session-isolation.md`.
- [ ] **One recipe base, many users**: `dev/plan-session-isolation.md`, the v2
      rescope of `dev/note-session-isolation.md` (the measured evidence file,
      parked 2026-08-17). Two problems, each needing its own fix: session builds
      share one recipe base, so one user's declaration is what another user's
      `agg.NAME` means; and the object cache keys on program text, which no
      longer determines the object once a reference is in it. Phase **A0 landed
      at a109**, the standalone finding the note turned up: `--library` re-pointed
      the Examples menu only while all three build paths used the
      `aggregate.build` singleton, and `Settings.knowledge_base` had never been
      read. Phases **A1 to A4 landed at a110**: the session id, the fork
      registry, the qualified cache key and every build path routed through the
      caller's own base. A5 to A7 remain (the Examples menu pinned to the parent
      and the expiry pane, sharpen on a deepcopy, the pricing-residue comment).

## Raised with `csv-grid` (not fixed here)

- [ ] **No way to default the export to raw values.** CsvGrid 3.9.0 builds the
      "Formatted values" checkbox with `checked = true` hard coded
      (`csv-grid.es.js:824`) and `_runExport` reads it live, so there is no
      constructor option and no export default to set. `mountGrid` clears both
      boxes (Copy and Save) by reaching into the widget's DOM after
      construction, which works only because `_buildScaffold` builds them in the
      constructor. Ask: an `exportValues: 'raw' | 'formatted'` option. The
      workaround deletes the day it lands. Raised 2026-08-10, a64.
