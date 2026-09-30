# TODO / Roadmap

Pending work for `aggregate_api`, newest thinking at the bottom of each list.
What has landed is in `CHANGELOG.md` and the git log; completed plans move to
`dev/done/`.

## Landed

- **[Matrix-Renderer]** DONE (`1.0.0a180`), plan `dev/plan-a179-lab-tab.md`
  section 8: the ECharts adapter reads chart IR version 4 and draws the `matrix`
  panel kind. Required for any build running library `a379` or later, since the
  adapter's version check is one-sided and an unraised pin blanks every chart.

- **[Lab-Tab]** DONE (`1.0.0a179`), plan `dev/plan-a179-lab-tab.md`: third-party
  charts and exhibits appear under a new **Lab** tab, discovered through
  `aggregate.plugins` entry points. `AGGAPI_PLUGINS_ENABLED` /
  `AGGAPI_PLUGINS_ALLOW`, the manifest on `GET /v1/meta`, a dynamic seventh nav
  group, one generic `lab:*` loader. `capability.py` deliberately untouched; see
  the plan's section 5. Verified against `aggregate-relativity` 0.1.0, which is
  **not** a dependency of this repo and must not become one.

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

- [x] **[Lite-Shell] [Lite-Reading] the phone lite entry**
      (`dev/done/plan-phone-lite.md`, spec `dev/prototypes/phone.html`),
      **a168 to a169**, for the 2026-10-16 live demonstration. One URL: a
      boot-time branch in `index.html` sends a narrow, coarse-pointer device
      to `lite.html`, a read-mostly showcase (curated chips, read-only
      program, Build, facts, tiles, one chart, one static table, the example
      sheet); `?full=1` / `?lite=1` override. The full app is untouched
      beyond the branch script and a second Vite input.
    - [ ] **[Lite-Device]** the author's hour on a real phone before
          2026-10-16; findings become ordinary tweak bumps (a170 on).

- [ ] **GUI round 9, five punch-ups from kicking round 8's tires**
      (`dev/plan-ui-round-9.md`), **a159 onward**, from an author report on the
      running app. Two of the five were bugs with proven causes; three were
      rulings. The author's sixth item, the chart control strip, is deferred to
      its own plan and is summarized in this one's "Out of scope".
    - [x] Phase 1 [Strip-Fold], **a159**. a158's note slot was unreachable: the
          chevron that opens it was hidden by a `display: none` in its own rule
          and revealed with `more.style.display = ''`, which clears an inline
          value rather than setting one. Build warnings, derivation sentences,
          tags and `note{}` were all on the page and none could be opened. This
          is also what round 8's unwalked acceptance states would have caught.
    - [x] Phase 2 [Grid-Formats], **a160**. The interactive view throws on any
          `g` format spec, which is what `greater_tables` emits for a "general"
          column: six of the twelve exhibit blocks a portfolio publishes, not the
          one that was reported. Fixed upstream in `csv-viewer` 3.10.0 (its own
          `dev/plan-3.10-g-format.md`). a160 lands the honest failure message,
          which the pane never gave, and a second `check-adapter` pass that names
          every unparseable spec.
        - [x] **The pin moved**, **a163**, once CSV_Viewer was pushed and
              csv-grid 3.10.1 was on PyPI for the server-side consumers.
              `check-adapter` now reports `csv-grid 3.10.1 takes [fd%esg]` and
              passes its spec pass clean, and the six exhibit blocks that drew
              nothing draw again.
        - [ ] **Upstream, found while walking every exhibit:** `bs_window` is
              listed by `available_exhibits` for an object that cannot produce
              one (this portfolio at `log2=12, bs=1`), and `build_exhibit` then
              dies on a None frame in `aggregate/_labeled.py` instead of raising
              something the route turns into a 400. The frame route declines the
              same object cleanly with a 400.
    - [x] Phase 3 [Three-Rulings], **a161**. More leads with Tail behavior
          instead of the heavy Density load; Quick Re's refusal names the two
          amounts that collide instead of restating a rule; the control band
          takes the editor's white ground rather than the status strip's tint.
    - [ ] **Item 1, the chart control strip**, its own plan
          (`dev/plan-chart-controls.md`), **a164 onward**. Three unenclosed rows
          stand above every canvas and `.exhibit-group-panel`'s equal-share
          centering promises an alignment to the panels it cannot keep.
        - [x] `[scope]`, **a164**. The four grid rendering controls and the cut
              become panel controls, since what they change is one panel's
              drawing. `lights` stays in the figure box by the author's ruling.
        - [x] `[align] [below] [box] [short] [fold] [trim] [stack] [tone]`,
              **a165**, the arrangement: everything below the drawing, panel
              groups at their own columns, the figure box at the drawing's
              width. Acceptance 1 to 6 are a browser walk and are still to be
              kicked; the plan's "Execution notes" carry the divergences.

- [x] **GUI round 8, where the dividing lines lie**
      (`dev/done/plan-ui-round-8.md`), **a157 to a158**, from an author report
      that the design is good but a lot "floats about" and that the status strip
      gets glazed over. Four rulings taken at review time and eleven divergences
      are in the plan's "Execution notes" section. The five visual states in the
      phase 2 acceptance list still want walking in the running app: no suite
      here exercises `renderSummary` or `syncSummaryMore`.
    - [x] Phase 1 [Rhythm-And-The-Control-Band], **a157**. Three spacing tokens
          replacing a page of local margins, one enclosure on the form row with
          its explaining line gathered inside it, and a name on the Pricing and
          Bounds bands. The largest divergence: the plan's
          `:has(+ .control-band)` selector reached only Bounds, since Pricing
          nests its forms in `#leaf-*` wrappers and Re puts its program lede in
          between.
    - [x] Phase 2 [The-Status-Strip], **a158**. Clusters instead of seven `·`
          separators, the verdict said only when it is not clean, the clock in
          the corner instead of a sentence on a line of its own, and the note
          slot folded behind a chevron that carries the warning count. The
          chevron had been dormant since it was added: it was shown only when
          line one overflowed horizontally, which a freely wrapping line cannot.

- [x] **[Examples-Search] the doubled list and the alphabetized ties**, from an
      author report, **a139**. Searching `capstone` drew the eleven hits twice
      and in alphabetical order. Two independent faults. `renderList` published
      the search needle from between its `empty` and its first `appendChild`, so
      the fanout re-entered the calling surface's own render and the outer pass
      appended everything again; publishing moves to `publishNeedle` on the
      boxes' `input` handlers and the render is a pure draw. And uFuzzy's
      default sort ends in a locale compare, which decided the whole list for a
      query that scored all eleven identically; the tiebreak is the haystack
      index now, which is the position in `library.agg`. Ranking above the tail
      is untouched. The Ctrl+Shift ring inherits both, so a family search walks
      the worked example in the order it is built.

- [x] **GUI round 7, August 27** (`dev/done/plan-ui-round-7.md`), four items at
      **a138**, from an author list of six. The editor wraps; the Economics tab
      becomes PnL (label only, the `economics` key stays); `collapse_program`
      runs the library's `preprocess` so a `#` or `//` comment stops swallowing
      the program behind it, with an empty or comments-only program answered in
      its own words; and the `data-why` footnote moves out of the width ghost's
      `::after` onto a node of its own, so a dark tab no longer narrows on hover.
      Arithmetic joined the first of those: DecL's `answer` rule has always
      carried `expr`, so `(2+2)` is a program, and the api now serves the float
      as `kind: 'value'` rather than building it and refusing it.
      **Two of the six needed no code here.** The bivariate program the author
      asked about is correct (no-frequency production, Poisson by default), but
      checking it found that `format_program` drops `note{}` and `tags{}` on
      every program, now an upstream ask below. On the SpaceMouse the settings
      match the testbed exactly and the load does not: 65,536 vertices against
      the lab's 9,216, plus a full `setOption` merge per frame. Two levers, both
      in the plan's last section, neither pulled yet.

- [x] **Punchups, August 24** (`dev/done/plan-punchups-aug-24-API.md`), all
      ten live items, **a125 to a133**. The author's eleven item list, item 2
      withdrawn the same day. One item per bump except 6 and 7, which are one
      edit, and item 10, whose four sub-items landed together. The author's
      numbering is kept, gap included, because that is how the items got
      named in conversation. Execution notes and every divergence are in the
      plan's own "Execution notes" section.
    - [x] 1 [Example-Load-Strips-Trailer] a picked entry loses `note{}` and
          `tags{}`, and the strip prints the note off the item's own fields
          (→ 1.0.0a132). `hints{}` stays.
    - [x] ~~2~~ withdrawn 2026-08-24: units of a `port` or a `bivariate` are
          not entries, and nothing is owed upstream.
    - [x] 3 [Editor-Margin-Controls] the walk buttons align right and lose
          their boxes (→ 1.0.0a127). Circled arrows, bare, at the icon's size.
    - [x] 4 [Clear-Twice-Clears-History] a second press of the clear icon
          empties the store (→ 1.0.0a128). No dialog; the readout says "cleared".
    - [x] 5 [Example-Ring-Follows-Search] the ring follows the search box as
          well as the pills (→ 1.0.0a133). The pill half had landed with the
          examples dropdown work; the search needle was what was left.
    - [x] 6 [Stats-Joins-Overview] and 7 [Overview-Leaf-Order] (→ 1.0.0a125).
          One edit: Stats moves from More to Overview and the row reads Plot,
          Summary, Validation, Stats, Tail.
    - [x] 8 [Reformat-Keeps-Trailer] Reformat stops deleting the note and the
          hints (→ 1.0.0a126). `trailer=True`, and tags come back with them.
    - [x] 9 [Tooltips-Stay-On-Screen] the `data-why` footnote clamps to the
          viewport (→ 1.0.0a130). `utils/tip.js` writes `--tip-shift`.
    - [x] 10 [Surface-Strip-Punchups] four fixes to the 3-D control strip
          (→ 1.0.0a131), all four in one bump. The Download menu carries
          PNG and is drawn on every chart, so "Download plot" leaves the
          header menu.
    - [x] 11 [Counter-Follows-The-Example-Walk] the `[m/n]` readout numbers the
          example walk (→ 1.0.0a129). The counter follows the last press; the
          two buttons stay bound to history.

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

- [x] **The joint surface, end to end**: `dev/done/plan-3d-plot.md`, three
      parties, the canonical copy here and a symlink in the library, **both
      moved to `dev/done/` 2026-08-21**. This side is complete: a72 the api
      half (section 3, the three query parameters, the ceiling setting and the
      chart document cache), a73 the foundation (section 4.1's one decode,
      section 8.3's `node --test` runner, the `echarts-gl` pin), a74 the
      drawing geometry, a75 the two halves read against each other, a76 the
      relief and both author rulings, a77 the look, a78 the controls, a79 the
      cuts, the marks and the walk, a80 the window box, with later fixes
      through a92.
      **Section 4.2.1 was ruled 2026-08-12**: keep the full grid rule, so the
      derived quantities stay this side and the library emits the whole
      reduced grid with `window` as the drawing range inside it. Section
      4.2.1.1, the library serving the total lattice and kappa, is declined by
      the same ruling.
      **What is left is entirely library**, two edits carried by
      `aggregate_REFACTOR/dev/plan-3d-plot-LIB.md`: `edge = "mid"` and the
      whole reduced grid. Nothing here changes when they land, verified
      2026-08-21 against `windowRange` and the `surface-grid.js` decode. The
      one chore on landing is re-capturing `dev/fixtures/charts.json` and
      re-running `smoke-charts.mjs`. Until then every conditional and every
      mark is computed on the part of the grid that is on screen, up to 4.9
      percent out on kappa, and the `window` box set to 0 is the escape hatch.
      The prototype stays in `dev/prototypes/joint-surface/` under section
      8.0's rule, as the reference the shipped surface is diffed against.

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

- [x] **The app on an iPhone and an iPad**: `dev/done/plan-idevice-ui.md`, FINAL
      2026-08-14, extended and re-verified 2026-08-21. Five defects, SPA only,
      no api or library change. **All three code phases landed 2026-08-21.**
      **a115**: the group and leaf
      strips are laid out at their selected width so they stop moving under a
      thumb, and `touch-action: manipulation` on `body` stops a double tap
      zooming the page. **a116**: a vertical up / readout / down
      control in the editor's right margin, the counter reversed to count up
      JupyterLab style, the cap from 20 to 500 with a 256KB ceiling, the unbuilt
      draft stashed and handed back, the walk ending on a document change rather
      than on any keydown, `Ctrl` bound beside `Mod` and the key hints naming
      whichever modifier the device reports. **a117**: `charts/touch.js`, a
      capture-phase shim giving touch events the `offsetX` that `echarts-gl`
      reads off the raw event, so a tap on the 3-D surface picks again, and one
      `resetView` reached from the button, the double click and the puck, with
      the `reset` button now on every chart and last in its group.

- [ ] **The iPad round for the above, phase 4, owed.** Nothing in a115 to a117
      can be verified from a Windows desktop: the pick defect lives in a branch
      Safari takes and desktop Chrome does not, and the modifier finding rests
      on a platform test that is false on Windows. Fifteen minutes against the
      six checks in the closed plan's section 6. Two things it may send back.
      The tap in check 5 can fail in its second half, a deliberate tap over
      300ms being refused by zrender no matter how good the coordinates are;
      the recognizer for that is sketched in the plan and deliberately unbuilt.
      And section 6.1 is unconfirmed: whether iOS Safari applies focus zoom to a
      `contenteditable` as it does to a form control, which if it does means
      every tap into the editor on an iPhone zooms the page, a larger source of
      the "floating around" report than the double tap and one that
      `touch-action` does nothing about. Its fix is pre-specified, a 16px
      `.cm-content` under 576px in the editor theme, and takes its own bump.
      Also open for a ruling, from the a117 notes: `resetView` restores the
      relief's readings on a surface only, so `contours` toggled off on a
      `heatmap` survives a reset.

- [x] **The 2-D control strip goes per panel, and three axes stop lying**
      (→ 1.0.0a121, against `aggregate 1.0.0a314`).
      `dev/done/plan-2d-punchups.md`, both halves executed 2026-08-21. `log`
      split into `log x` and `log y`, the seven readings moved from one centered
      row into one group per panel keyed on the panel id, `full range` stopped
      falling back to the drawn extent so a probability axis stops being labeled
      to 1.5, and the return-period window stopped being discarded outright,
      which was four independent faults on two lines of `xyPanel`. Properly
      fixes the a-generation punch item "log y on rh plot triggers reshape/draw
      of left plot" (`dev/api-punchlist.md:238`). Two further rulings taken on
      execution and recorded as decisions 10 and 11: the log release acts on a
      density ordinate alone, keyed on the axis unit so it survives `invert`,
      and a panel offers on every axis that can reach a position rather than on
      the one occupying it now. No `VIEW_KEY` bump. Still owed: the **browser
      pass**, sections 5 and 6 of the plan's verification, which is the group
      alignment at both sides of `WIDE_PX` and the sticky state carrying across
      documents.

- [ ] **The companion axis auto-fits over data the return-period ladder no
      longer shows.** Raised in review 2026-08-21, not ruled, recorded rather
      than built. Under a period reading the companion is given no window so
      echarts fits it, which was right when the period axis showed everything
      and is loose now that `aggregate 1.0.0a314` ends the suggested ladder at
      1-in-10,000: the visible part of the curve fills 41% to 100% of the axis
      across the fixtures and 47% on the author's own program. The fix is to
      take the companion's extent over the points whose period coordinate falls
      inside the period window, about three lines in `xyPanel`. See the "left
      behind" section of `dev/done/plan-2d-punchups.md`.

- [ ] **A linear return-period axis is labeled from zero.** `niceWindow` rounds
      the declared `(1, 10000)` outward to a tick interval and floors the low
      end at 0, so the first tick reads `1-in-0`. New at a121 and harmless: the
      axis was unconditionally log before `aggregate 1.0.0a314`, so the question
      could not arise. Not fixed with it because clamping `niceWindow` to a
      declared minimum would act on every axis in every document.

- [ ] **Should the per-panel groups carry their panel title in the wide layout
      too?** a121 labels them only when stacked below `WIDE_PX`, on the grounds
      that panel titles are long ("Probability mass function") and the panel
      headings are already on screen right above them. Turning them on
      everywhere is one condition in `renderControls`. A styling call, open.

- [x] **The Examples dropdown reads the library in file order**:
      `dev/done/plan-examples-dropdown.md`, complete across **a122** to **a124**,
      against the LIB half at `aggregate 1.0.0a320` (`Recipe.seq`,
      `Recipe.as_read`). A122: the payload is one flat file-ordered list with
      pills and facets, the app's three ordering tables are deleted, and the
      editor receives the entry's own text rather than a canonical re-render.
      A123: the three-line row, the pill filter bar with counts, `localStorage`
      persistence shared with the Ctrl+K palette, and the Ctrl+Shift arrow ring
      walking the filtered list. A124: out-of-order search, measured on the real
      payload, so the `fzf` port the plan held in reserve is not needed.
      **Owed upstream, ruled 2026-08-24**: `topic:pnl` and `topic:distortion`
      duplicate their entry's own `kind` on fourteen rows, so the pill row spells
      the same word twice; the author is removing the two tags from
      `library.agg`, and nothing app side changes when they go.

- [x] **Catch the app up to `aggregate` 1.0.0a333**:
      `dev/done/plan-library-skew-a333.md`, one bump at **a140**. Turned up by
      the `[Sync]` step of the approximation tab plan, which is why it exists as
      its own bump: nine backend tests were failing on library skew and none of
      them belonged to that feature. One real defect, a bivariate's moments
      coming back empty since library a330 restructured `stats_df`, and eight
      test expectations describing surfaces the library has restated (the two
      sided return period ladder, the joint surface's centered coordinates and
      whole placed mass). Nothing owed upstream: two of those tests were
      reading `detail` and the emitted mass against quantities the library
      never promised, and both now assert what `_joint_surface` documents.

- [x] **The Approximation tab**: `dev/done/plan-approximation-tab.md`, one bump
      at **a141**. The More row's new leaf, between Tail behavior and Window,
      with a Plot / Summary switch inside the pane rather than two sibling
      pills: the navigation is two levels and `check-nav.mjs` guards that shape,
      and the two are readings of one question so they keep one address. Consumes
      LIB a331 to a333 and needed no server change at all. Eight divergences in
      the plan's execution notes, the load bearing ones being a `header` hook on
      `loadExhibitLeaf` (the switch has to be rebuilt inside `draw`, which
      re-runs on both table flips) and the first chart instance `pane-more` has
      ever held, which `disposePaneChart` and `clearPanes` had no branch for.
      The `Re` rename rode in the same commit on the author's request.
      **Open, upstream and not blocking**: the chart payload is 16.3 MB against
      the `agg` chart's 2.3 MB, thirteen series over the full 65,536 point grid,
      taken to the LIB side as a sizing question. Nothing app side is owed
      either way, since a smaller emission lands here with no change.

- [x] **The Pr Ruin pill**: `dev/done/plan-pk-tab.md`, one bump at **a142**,
      consuming LIB a339 to a341 (the engine lift, `eventual_ruin` with
      `RuinResult` and the `ruin` exhibit, the `ruin` chart with its
      downsampling), which landed concurrently from the same plan; the LIB
      execution notes were read before any app code. Last pill in the Pricing
      row, after Evaluate: the shared pricing form plus a probability of
      default box, over the two-panel chart and the exhibit stats strip, live
      to the form through one debounced POST. Divergences in
      `dev/done/plan-pk-tab-API.md`, the load bearing ones being no
      `can_ruin` flag (the pill gates on the chart, the Plot mechanics), the
      new POST route the plan's "nothing new" line underestimated, and
      `sample: true` as the wire spelling of the seed re-roll. Nothing owed
      upstream.

- [x] **The reinsurance structure diagram**: `dev/done/plan-structure-chart.md`,
      three bumps, consuming LIB a349 to a351 (the `'tower'` panel kind and
      `TowerBlock` on the chart IR, the `structure` emitter, the matplotlib
      renderer). The library half landed first and deliberately left the SPA
      drawing nothing at all, since it pinned `CHART_IR_VERSION = 2` and
      refuses anything later. **a152 [Tower-Panel]** closes that window and
      draws a tower, with the one row ratio layout `panelLayout` had no notion
      of; **a153 [Diagram-Leaf]** puts it at the head of the Re row and lights
      that group for a reinsured P&L, which is the first time that group has
      been live for one; **a154 [Structure-Lee]** carries `lee` and `annotate`
      on the chart route, without which the Lee curves could not be asked for
      at all. Three rulings and nine divergences in the plan's execution log,
      the load bearing ones being the route parameters (the plan called the app
      side "the translator plus one nav leaf" and there was no way to reach
      half of what it described) and the layout, which is in the adapter and
      not in `mount.js` where the plan looked for it. Nothing owed upstream.
      Eyeballed at a154 and three defects came back, all of them the library's
      loss window; they were specified in `aggregate`'s
      `dev/done/plan-tower-window.md`, landed there at a352 and a353, and
      consumed here at **a155 [Tower-Log]** along with the app's own half of
      the log reading: one decade floor per quantity axis rather than per
      panel, the floor strictly under the smallest value drawn, bands and
      boundary ticks that cope with zero, `log y` offered once per axis and
      acting on every panel naming it, and a torn top edge on an unlimited
      block.
      Eyeballed on log and approved, with one defect: the switch appeared to
      drive one stage's quantile curve and not the other's, which turned out
      to be a reading stored against a panel that no longer offers one, from
      the window where a154 ran against a352 documents. Fixed at
      **a156 [Stale-Companion-Reading]**, along with labeling the two control
      groups by their axis, since side by side they were identical and
      unlabeled.

## Raised with `aggregate` (not fixed here)

- [ ] **`format_program`'s fallback answers with the preprocessed statement
      rather than the source, so an unreadable program comes back collapsed onto
      one line.** `decl_writer._render_statement` catches everything and returns
      the statement, and its docstring calls that verbatim, but the statement it
      holds has already been through `UnderwritingLexer.preprocess`: every line
      break and every run of indentation is one space by then, and the bracket
      step has padded `[` and `]` besides. So `pprogram` on a program the writer
      cannot read prints it flattened, and any caller that writes the result back
      where the program came from destroys the reader's layout. That is what it
      did to the API's Reformat button, guarded app side at a137 by asking the
      parser first (`routes/decl.py::_every_statement_parses`). Ask: keep the
      source slice and return that, or report which statements fell back so a
      caller can decline the answer. The guard retires the moment either lands.
- [ ] **`format_program` drops `note{}` and `tags{}`, on every program.** Not a
      fallback case and not confined to any kind: the writer renders no trailer
      at all, so `agg A 5 claims sev lognorm 10 cv 1.2 poisson note{keep me}
      tags{topic:x}` comes back as the four clauses and nothing else. The API
      writes the answer back over the editor with `editor.setText`, so pressing
      Reformat is how a reader loses the note they wrote. Found at a138 while
      checking an author report about a bivariate program, which turned out to
      be a `library.agg` entry after Reformat: correct in every respect except
      that its `note{}` had gone. Ask: render the trailer, or say the answer is
      partial so a caller can decline it. This is the a137 finding one layer
      down, and the a137 guard does not cover it, because a program whose note is
      dropped parses perfectly well. No workaround app side: writing back what
      the library serves is the purist ruling, and the app holds no note of its
      own to put back.
- [ ] **`format_program` cannot read a program whose second statement names
      something the first defines.** It renders statement by statement against
      `aggregate.build` alone, so `sev MySev lognorm 50 cv 1.5` followed by
      `agg A 100 claims sev.MySev poisson` canonicalizes the first and drops the
      second to the fallback above, though the program builds. Ask: resolve
      against the statements already read in the same call, the way `build` does
      when it reads a file. Until then the API declines to reformat such a
      program at all, which is honest but is a working program the button
      cannot help with.

- [ ] **The portfolio's density ordinate should declare its full extent, as the
      aggregate's now does.** `aggregate 1.0.0a314` (L3 of
      `dev/done/plan-2d-punchups.md`) had `charts._emit_aggregate.outcome_doc`
      publish the tallest drawn mass as the `mass` axis' `full_range`, which
      serves `agg`, `pnl`, `discrete` and `reins`. The **portfolio** emitter is
      a separate one and still declines, though it crops the same way: on the
      `port` fixture the ordinate is cropped 3.75 times, suggested top
      `1.60e-4` against a drawn peak of `6.01e-4`, with no extent published.
      App side a121 covers it by falling back to the drawn extent, so nothing is
      broken and the two documents reach the same number by two routes; the
      declaration would retire that fallback and make `full range` open the
      ordinate on a `port` as it does on an `agg`. One line, no contract change,
      which is why it is here rather than in a round note.
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
      `dev/done/plan-pricing-natural-allocation.md` (canonical here, symlinked
      in the library), drafted 2026-08-14. The pane becomes `Calibrate
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
      **Both copies moved to `dev/done/` 2026-08-20**, the canonical one here
      and the library's symlink with it, which is why the two moves waited to
      happen together.
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
      `dev/done/note-session-isolation.md`.
- [x] **One recipe base, many users**: `dev/done/plan-session-isolation.md`, the v2
      rescope of `dev/done/note-session-isolation.md` (the measured evidence file,
      parked 2026-08-17). Two problems, each needing its own fix: session builds
      share one recipe base, so one user's declaration is what another user's
      `agg.NAME` means; and the object cache keys on program text, which no
      longer determines the object once a reference is in it. Phase **A0 landed
      at a109**, the standalone finding the note turned up: `--library` re-pointed
      the Examples menu only while all three build paths used the
      `aggregate.build` singleton, and `Settings.knowledge_base` had never been
      read. **Fully executed 2026-08-18**: A0 at a109, A1 to A4 at a110 (the
      session id, the fork registry, the qualified cache key and every build path
      routed through the caller's own base), A5 to A7 at a111 (the expiry pane
      with its rebuild button, sharpen on a deepcopy, the pricing-residue rule).
      The note, and since 2026-08-18 the plan itself, are in `dev/done/`, the
      library's debrief folded into the plan's section 5 and the symlink in its
      tree moved to `dev/done/` alongside. What it deliberately did not do
      is in the plan's section 8: no content addressing, one browser tab per
      session with no persistence, `cache_max` still 50, and one uvicorn worker
      is now load bearing.

- [x] **A status page, private by construction**:
      `dev/done/plan-site-status-page.md`, phases S0 to S4 at **a112**. An operator's
      view at `/v1/status/page` behind a JSON contract at `/v1/status`: versions
      against process start, live session forks, cache and build behavior,
      whether the a110 shared-against-session key rule is firing correctly, and
      process resources. Three access layers, the primary one being a Caddy
      matcher on the public block, because both front doors proxy to
      `127.0.0.1:8001` and no peer-address test can tell a public visitor from a
      VPN one. The same fact was a live bug: every audit row recorded
      `ip = '127.0.0.1'`, now fixed in `net.py`. Two things it deliberately does
      not do: no metrics export and no controls, section 9 of the plan.
      **Follow-ups**, neither blocking:
      - The **audit database has no retention policy** and the page now shows it
        growing. Section 8 question 4 of the plan is left open on purpose; the
        number on the page is what should prompt deciding it.
      - **Capability drift is live**: 16 exhibits and 9 charts registered
        against the oversight charter's recorded 12 and 8, the difference being
        the four pricing exhibits and the `kappa` chart from LIB a259 to a263.
        The charter's state snapshot wants reconciling, which is an oversight
        task rather than an api one.
      - The page's key-scope panel will report **programs the previewer refused
        and the builder then accepted**, verbatim. Any that appear are an
        upstream ask against `Underwriter.preview`; none have yet.

- [x] **The PnL button, a priced book and one press to explode**:
      `dev/done/plan-pnl-button-punchup.md`, complete across **a113** and
      **a114**. A113: the `explode` route turning a `pnl` into the `xpnl` that
      walks its layers, `can_explode` behind the button's second state, and
      `_has_reinsurance` looking through a `PnL` to its engine, which had been
      reporting `has_reins` false for every reinsured P&L. A114: the three
      combined ratios, so press one prices every cession as a `deposit` against
      LIB a306's ladder. Two things a later reader should know. The drafted
      `working_attach` field never existed, because a `rate` quote against the
      P&L premium is circular and the library removed the split; and a
      portfolio engine keeps the unladdered path, so it is still sized off
      `loss_ratio` while an aggregate is sized off the ladder.
      **Follow-up**, not blocking: LIB's D2, whether `net_combined_ratio`
      eventually takes a `Distortion` and resolves the implied technical
      premium ratio itself. That is the destination the ratio form was chosen
      for, and it would reach this endpoint as a field.

## Raised with `csv-grid` (not fixed here)

- [ ] **No way to default the export to raw values.** CsvGrid 3.9.0 builds the
      "Formatted values" checkbox with `checked = true` hard coded
      (`csv-grid.es.js:824`) and `_runExport` reads it live, so there is no
      constructor option and no export default to set. `mountGrid` clears both
      boxes (Copy and Save) by reaching into the widget's DOM after
      construction, which works only because `_buildScaffold` builds them in the
      constructor. Ask: an `exportValues: 'raw' | 'formatted'` option. The
      workaround deletes the day it lands. Raised 2026-08-10, a64.
