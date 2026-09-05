# plan-pk-tab, API execution notes

Execution record for the API half of `dev/plan-pk-tab.md` (the Pricing >
Pr Ruin pill). Started 2026-09-05 at `1.0.0a141`, against LIB `1.0.0a338`;
the LIB half landed concurrently as a339 (engine), a340 (exhibit) and a341
(chart with downsampling), each recorded in the LIB repo's
`dev/plan-pk-tab-LIB.md`, read here before any app code was written. This
file records the API review findings and every divergence.

## Review findings (2026-09-05, at a141)

- All API-side plan facts verified: `createPricingForm` in
  `web/src/pricing-form.js` is already the shared Calibrate premium group
  (five mounts, preview row included), so the extraction the plan hedges
  on is a no-op and Calibrate is untouched by construction.
  `chartdoc-to-echarts.js`, `mountChartDoc` (the Bounds precedent for a
  form-fetched document) and the `chart:` leaf gate in `nav.js` all exist
  as assumed.
- The AD renewal tester exists upstream (`decl-testers.agg` line 861).
- `V:\worktrees\dev-files.md` had no row for this plan and `dev/TODO.md`
  no entry; both are added at the bump.

## Divergences and rulings taken in execution

- **No `can_ruin` capability flag.** The plan has one join the caps
  payload; `leafAvailable` already gates a leaf declared `chart: 'ruin'`
  off `available_charts` (the Plot leaf's `kappa` precedent), and
  `charts_for` is a passthrough of the library's own predicate. The
  frequency test therefore lives upstream only, which is the purist
  ruling's own preference, and `capability.py` is untouched.
- **[Ruin-Route] is one new POST, not "nothing new".** The generic chart
  GET forwards only `window` / `detail` / `encoding` as named, validated
  query parameters, and the `ruin` exhibit registers on `RuinResult`
  (LIB execution ruling 1), which the generic exhibit GET cannot reach.
  So the pane is served by `POST /v1/objects/{oid}/ruin` in the pricing
  family: one debounced request returns the chart document and the
  exhibit envelopes together. A POST also never meets the chart cache,
  which dissolves the Sample-versus-ETag conflict flagged at review.
- **The wire spelling of ruling 2 is `sample: true`.** JSON cannot
  distinguish an omitted `seed` from an explicit null through a typed
  model, so the Sample action sends `sample: true`; the runner then
  materializes one fresh integer seed and passes it to **both** the chart
  emitter and `eventual_ruin`, so the drawn paths and the stats strip
  describe the same draw, and `meta.seed` reports it. The app holds that
  seed and re-sends it on subsequent form edits, so a sampled skeleton
  survives typing.
- **The margin derivation is a pentagon read.** The form states the
  premium the Calibrate way (anchor plus CoC / LR / Premium target); the
  runner passes an `lr` target through and otherwise completes
  `price_pentagon` and reads `LR` off the row, the same bridge
  `run_calibration` uses for a premium target. No pentagon identity is
  written app side.
- **No basis group on the ruin form.** The plan's "base premium group" is
  read as the anchor and target pairs; the ruin reading is of the
  object's own law, and pricing a net-view margin into a gross-law
  simulation would mix views. The form mounts with `basisLabel: null`.
  If a per-basis ruin reading is ever wanted, it is an upstream ask.
- **The pane computes on activation.** The plan's dynamic-behavior
  section has every form change issue a debounced re-request; a pane
  that is live to typing but blank on arrival would be odd, so
  activation issues the same request with the current form values (the
  Plot leaf precedent, not the press-button pricing one).
- **Adapter roles, not a per-chart override.** The generic adapter gains
  three role treatments the ruin document is first to use: `sample`
  (muted thin line, kept out of the legend), `rug` (tick symbols, out of
  the legend), `marker` (a visible symbol point). Reusable vocabulary
  rather than a chart special case.
- **`createPricingForm` gains `opts.onChange`**, called wherever the
  preview refreshes, so the ruin pane can debounce its re-request off
  the same events without reaching into the component's internals. The
  other five mounts are unaffected.

## Phase [Ruin-Route] and [Ruin-Pane] with [Ruin-Sample], a142

What landed, one bump as the plan orders:

- Backend: `RuinRequest` / `RuinResponse` in `models.py`, `run_ruin` in
  `pricing.py` (the fifth runner), `POST /objects/{oid}/ruin` in
  `routes/objects.py`, nine tests in `tests/test_ruin_route.py`.
- Front end: the `ruin` leaf in `nav.js` (a chart leaf, last after
  Evaluate), `api.ruin` in `api.js`, the `onChange` hook in
  `pricing-form.js`, the `leaf-ruin` wrapper in `index.html`, the pane in
  `main.js` (form mount with the Sample verb, the probability box and
  readout as `extras`, the debounced `requestRuin`, `drawRuin` through
  `mountChartDoc` and `drawPricingPane`), the `sample` / `rug` / `marker`
  role treatments in `chartdoc-to-echarts.js`, three tests in
  `web/test/ruin-nav.test.js`, and the `pricing:ruin` expectation row in
  `dev/scripts/check-nav.mjs`.

Verification against the plan's acceptance:

- Poisson and renewal books both serve the pill and the route; a
  gamma-mixed (negbin) book greys it and the POST names the frequency
  gate (`test_the_wrong_frequency_is_refused_with_the_why`).
- Exact psi at the resolved grid point matches the asked probability
  within the grid (`0.0499950` for `0.05` on the smoke book) and the
  simulated check sits within three standard errors.
- The default chart document measured about 173 kB canonical for the
  smoke Poisson book, under the plan's 200 kB, and the budget is pinned
  by `test_the_chart_document_stays_under_the_budget`.
- The Calibrate subtab is untouched by construction: the form component
  was already shared, and the one change to it (`onChange`) defaults off.
- Gates: `uv run pytest` 395 passed; `cd web; npm test` 124 passed;
  `check-nav.mjs` clean after the expectation row; `smoke-charts.mjs` all
  clear over recaptured fixtures including both `ruin` documents.

What wants a browser, since neither suite renders: the rug's tick marks
and the marker point at their first real drawing, the muted sample paths
against the ruin-time ramp, and the debounce feel of the live form. The
author kicks these tires.
