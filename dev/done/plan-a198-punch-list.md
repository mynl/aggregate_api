# plan a198: the 2026-10-07 punch list

Six punch-ups from the author after kicking the a197 tires. They land as five
version bumps across three repositories, in the order below. Each bump is a
coherent unit with its own acceptance check; a later batch never depends on an
earlier one, so they can be split across sessions.

The author's rulings of 2026-10-07, taken at review and recorded here because
three of them reverse what the code says today:

1. The Waterfall's **`CR` column is replaced by `Margin ratio`** (`1 - CR`).
   `Margin` stays in currency, since it is the numerator of `MSD` and of the
   three `CoC` columns.
2. **The closing step stays `All`.** Renaming it `Net` was asked for and then
   declined on the blast radius: the label is read by `pentagon.js`, by its
   test, and by the relativity plugin's `FINAL_WALK_STEP`.
3. **The Reinsurance plot's Aggregate panel stays read by loss**, so its
   tracking line stays horizontal. The three annual curves share the outcome
   lattice and nothing else, so reading it by probability would let only one
   curve answer at a time. Labels get clearer instead.

Where a batch touches `web/`, rebuild the SPA at the bump
(`.\scripts\build-web.ps1`) and re-sync (`uv sync --extra dev`) so `/v1/meta`
reports the new version. After a **library** bump, re-sync here and then
reinstall the relativity plugin editable, which `uv sync` prunes:
`uv pip install -e V:/dev/aggregate-relativity`.

---

## [quick-re] api 1.0.0a198: the Quick Re quote sheet

Five faults in the row a197 shipped. All five are this repo's, api and SPA, no
library change.

### Current behavior

`renderQuoteTable` (`web/src/main.js`, around line 3229) mounts the response's
`quotes` with `mountGrid` directly, so:

* the table ignores the page-wide table-view preference and is always the
  interactive grid. Every cycling table in the app goes through
  `mountTable({doc})` plus `onTableViewChange`, which needs a **table
  document**, and the reins route serves none.
* the minimum rate on line is invisible. `layer_pricing._finish` applies
  `MIN_ROL * share * limit` as a floor after the three measures have been
  compared, and records only a boolean `floored`, so a layer priced off the
  floor shows `binds = 'dual'` beside a premium the dual transform did not
  produce.
* the first column is the layer span (`1,000 xs 1,000 @ 95%`). Nothing says
  which tier the layer sits on or where it is in the stack, though
  `price_clause` has the `as "Occ 1"` labels in hand off the spec and drops
  them.
* `composeTower` stacks to the detachment as typed, so a tower can run above
  the policy limit, where an occurrence layer covers nothing.
* the quote's rate on line reaches the editor as `rol 0.12170500000000001`.

The dust is not an api rounding failure. The api writes `rol 12.1705%`, the
parser computes `12.1705 / 100 = 0.12170500000000001`, and
`decl_writer._fmt_num` renders a non-integral float with `repr`, which is the
shortest string that round-trips. Verified both ways through
`Aggregate.reins_program`: the bare fraction spelling `rol 0.121705` comes back
out verbatim, which is what the library's own `_render_reins_clause` docstring
says it is for ("rendered as bare numbers, re-parse identically, no `%` float
dust").

### The change

**[api] `src/aggregate_api/layer_pricing.py`**

* The minimum rate on line becomes a **fourth candidate** rather than a floor
  applied afterward. In `layer_quotes`,
  `candidates = {'sd': …, 'ph': …, 'dual': …, 'min_rol': MIN_ROL * share * limit}`,
  `binds` is the argmax over all four, and the premium is that maximum.
  Arithmetically identical to the floor it replaces, and `binds` now names the
  method that set the price. `floored` stays on the wire: it is still the only
  signal on the `indication` path, which has no distortion candidates. An
  unlimited layer has no rate-on-line base, so its `min_rol` candidate is
  absent (today's `math.isfinite` guard, unchanged).
* `_finish` gains a `label` argument and reports it, so a row says `Occ 1`.
  `price_clause` already reads `spec[f'{prefix}_reins_label']`; it passes each
  label through, and an unlabeled layer (an Add re press writes no `as "..."`)
  falls back to `Occ n` / `Agg n`, numbered within its tier in clause order.
* A `rol`-spelled layer quotes the **rate**, not the premium. `_finish` rounds
  `rol` to `ROL_FIGS = 4` significant figures and sets
  `premium = rol * share * limit`, so the clause and the quote sheet agree to
  the digit. A `deposit`-spelled layer is unchanged: the premium rounds to
  `SIG_FIGS` and the rate is the quotient.
* `_layer_decl` writes `rol {value:g}` as a bare fraction, dropping the `%`
  form. That is the library's canonical spelling and it is what kills the dust.
* New `policy_limit(obj)`: the largest `y xs a` occurrence limit the program
  declares, off `obj.spec['exp_limit']` (`max` over a profile), or `None` when
  the cover is unlimited or the object carries no such clause. The same reading
  the library's own `charts._emit_reins._claim_window` takes.

**[api] the route and the models**

* `models.LayerQuote` gains `label: str` and `min_rol: float | None`; `binds`
  documents its fourth value.
* `models.DerivedResponse` gains `ir: dict[str, Any] | None`, keyed `quotes`,
  matching how `BoundsResponse` carries its document.
* `models.BuildResponse` gains `policy_limit: float | None`, filled in
  `post_object` beside `has_reins`. It is a fact about the program, cheap, and
  the Quick Re row needs it on every build, which is why it rides here rather
  than on `/meta` (the route the status strip's note stopped using at a120 for
  the same reason).
* `post_reins` builds the quote frame and serves it as a document:
  `tables.frame_document_dict(df, which='reins_quotes', formats='reins_quotes')`.
  Columns, in order: `Layer` (the label, as the index), `Span`, `EL`, `CV`,
  `SD load`, `PH`, `Dual`, `Min ROL`, `Binds`, `Premium`, `ROL`, `LR`.
* `tables.FORMATS` gains a `reins_quotes` entry: `MONEY` on the five currency
  columns, `ratio` on `ROL` and `LR`, `.3f` on `CV`, `s` on `Span` and `Binds`.
  This is the one legitimate use of that map, which is empty by design: the
  quote sheet is **this repo's own frame**, not a library exhibit, so nothing
  upstream resolves its formats.

**[spa] `web/src/main.js`, `web/src/tower.js`**

* `renderQuoteTable` takes the response's document and goes through
  `mountTable('qr-quotes', host, { doc })`, registering
  `onTableViewChange('qr-quotes', draw, root)` so the rows redraw on
  Ctrl+Shift+U like every other table. The rows still belong to the press
  rather than to the object, so `clearCessionDraft` still empties it.
* `state.policyLimit` off the build response.
* `generateTower(attach, detach, cap)` takes an optional cap. Bounds stop at
  `min(detach, cap)`; when `cap` is finite the stack's top bound **is** the
  cap, replacing the snapped bound that would have passed it. A policy limit is
  itself a quote-sheet number, so nothing is lost by pinning the top there, and
  a layer above the limit covers nothing.
* `composeTower` passes `state.policyLimit` as the cap **on the occurrence tier
  only**. An aggregate cover above the per-claim limit is a real cover, since
  the year's total is not bounded by one claim's, so the aggregate tier stacks
  to the span as typed. A capped span with no width left refuses in the preview
  line, naming the limit, through the existing `layerRefusal` path.
* The preview line is unchanged: it shows the single-layer reading of the span,
  which is the author's ruling of 2026-10-06.

### Acceptance

* `uv run pytest`, `npm test` in `web/`, `node dev/scripts/check-nav.mjs`.
* New api test: a priced cession on a two-layer tower returns `ir.quotes`, each
  row carries a `label` and a `min_rol`, and the program text matches
  `rol \d+(\.\d{1,4})?\b` with no `%` and no float dust.
* New `tower-stack.test.js` cases: a cap below the asked detachment tops the
  stack at the cap exactly; a cap above it changes nothing; a cap at or below
  the attachment yields no layers.
* By hand: press Tower on `agg Capstone.SelectedLosses` (policy limits
  `[500 1000 5000 10000 5000]`, so the cap is 10,000) with attach 50% and
  detach 99.9%, and read the quote sheet in all three table views.

---

## [narrative-bounds] api 1.0.0a199: two one-liners

### Narrative, item 6

`More / Narrative` renders `payload.info` in a `<pre>` and every section's
`description` and `explanation` in a `<p>`. A P&L's `info` is fine: it is the
fixed-layout row block and it has its newlines. The blob is
`construction_explanation`, which arrives as seven newline-separated sentences
plus an indented `Replay (...)` block and collapses into one paragraph.
`Aggregate.tail_description` collapses the same way, being three fixed-layout
rows.

Fix: `white-space: pre-wrap` on `.narrative-lead` and `.narrative-body` in
`web/src/styles/site.css`. Single-paragraph sections, which is most of them,
are unaffected. Nothing changes server side; the library's strings already
carry their newlines.

### Bounds on a P&L, item 3

`pricing.pricing_preview` reads `source.economic_ratios_df.iloc[0]`, the
**gross** block, so the Bounds form on a P&L seeds 21,000 on Capstone.PnL where
the net position is 4,881.

* The P&L branch reads the **closing** block, `iloc[-1]`, for its pair, and
  reports it as new fields `net_premium` and `net_of_expense_premium`
  (`P` and `P - E` off that block). `gross_premium` keeps its meaning and stays
  the gross block's `P`, so nothing already reading it changes. On a
  single-group ledger the closing block is the gross block and all three agree.
* `models.PricingPreviewResponse` gains `net_premium`.
* `showBoundsLeaf` already seeds from `net_of_expense_premium`, so it now
  computes at the net-of-cession, net-of-expense premium with no edit.
* The preview sentence in `pricing-form.js` names all three on a P&L:
  `gross premium G, net premium N, net of expense premium E`.

### Acceptance

* `uv run pytest`; a test that `pricing_preview` on a peeled P&L reports the
  closing block's pair and the gross block's `gross_premium`.
* By hand: Bounds on `xpnl.Capstone.PnL` opens with 4,881 in the box, not
  21,000; More / Narrative on the same object reads as lines.

---

## [pnl-emphasis] library 1.0.0a397 and plugin 0.8.0: PnL Summary and Waterfall

Item 2. All library, as the author suspected, plus one plugin edit.

### Current behavior

PnL Summary is the `economic_ratios` exhibit's insurer block and PnL Waterfall
is `economic_waterfall`'s two blocks. Both flag their rows the same way
(`exhibits/_pnl.py`, `_ratio_row_flags` and `_economic_waterfall_insurer`):
the last row `total`, every net-of-tier row `muted`, everything else plain. So
on Capstone.PnL the `Gross` row reads as an ordinary step and
`Net of occurrence` reads faded.

`waterfall_df` carries `CR` and a currency `Margin`. The margin ratio is
`1 - CR` and the frame deliberately does not carry it; `'Margin ratio'` was a
column until [Waterfall-Capital] retired it, and the comment recording that is
still in `formats/formats-raw.yaml`.

### The change

**[library] `exhibits/_pnl.py`**

* `_ratio_row_flags` and the waterfall's flag block both flag **row 0** as
  `subtotal` (the gross block is the first block in every builder, which the
  waterfall docstring already relies on) and the net-of-tier rows as
  `subtotal` rather than `muted`. The closing row keeps `total`.
  `gt.css` renders `subtotal` at `font-weight: 600` and `total` the same with a
  rule above, so this is exactly the author's "bold the Gross row and then the
  net of occ and All rows".
* This reverses the muting and its stated reason (a net-of-tier row restates
  the rows above it, so it read quiet). The reason it sits outside the footing
  does not change, so **both captions keep saying so** and lose the word
  "muted": a net-of-tier row is now bold because it is one of the three
  positions a reader looks for, and the caption is what says it does not add.

**[library] `_pnl.py`, `waterfall_df`**

* `CR` becomes `Margin ratio`, computed as `1 - CR` on the same block amounts.
  `Margin`, `MSD` and the three `CoC` columns are untouched.
* The docstring's `CR` entry becomes `Margin ratio` and loses the sentence
  saying the margin ratio is not carried; the waterfall caption in
  `exhibits/_pnl.py` follows.
* `formats/formats-raw.yaml`: `'Margin ratio': ratio` returns, and the comment
  explaining its absence goes. `CR` stays declared: `economic_ratios_df` still
  carries it, and the sheets are keyed by column name across every frame.

**[plugin] `aggregate-relativity` 0.8.0**

`derive.py` reads `walk.loc[step, 'CR']` and derives `margin = 1 - cr` itself,
so the library change breaks the Lab page silently. It reads `Margin ratio`
directly instead, `POINT_COLUMNS` drops `'CR'` (the page listed both and said
in a comment that it was one fact twice), and `FORMATTERS` follows.

### Acceptance

* Library: `uv run pytest -m 'slow or not slow'`, per the library's bump rule.
* Plugin: its own suite, run from the api's environment after
  `uv pip install -e V:/dev/aggregate-relativity`.
* By hand: PnL Summary on `xpnl.Capstone.PnL` shows Gross, Net of occurrence
  and All in bold; PnL Waterfall shows `Margin ratio` 0.0732 on the Gross row
  where `CR` read 0.9268; Lab / Relativity still draws.

---

## [reins-labels] library 1.0.0a398: name the annual triple

Item 4, after the author's ruling that the Aggregate panel keeps its horizontal
read-off.

### Current behavior

`charts/_emit_reins.py` draws six series under three names. The left panel is
the per-claim severity triple (`p_sev_gross`, `p_sev_ceded`, `p_sev_net`); the
right panel is the annual triple (`p_agg_gross`, `p_agg_ceded_occ`,
`p_agg_net_occ`), which is exactly gross, total ceded to the occurrence
program, and net of it, for the year. Both triples take
`REINS_LABEL_GROSS / CEDED / NET`, so the answer to the author's question is
yes, and nothing on the picture says it.

The read-off is correct as it stands and stays: the panel declares
`read_axis='y'`, the renderer sets `grid[i].tooltip.axisPointer.axis` from it,
and the three curves answer together because they share the outcome lattice.
A series drops out of the readout only where the cursor's loss is outside that
curve's own trimmed support, which is honest, and a hidden series is one the
reader clicked off in the legend strip.

### The change

The annual triple is named `Gross`, `Ceded to occurrence` and
`Net of occurrence` in `_emit_reins.py`; the per-claim triple keeps the three
shared constants, where they mean per claim. The three `REINS_LABEL_*`
constants are untouched, since four other emitters use them.

**One consequence to look at, and it is why this is its own bump.** The SPA's
legend strip is document wide and dedupes by name
(`chartdoc-to-echarts.js`, `[...new Set(...)]`), so the strip goes from three
chips to six: hovering either panel fills that panel's three and leaves the
other panel's three blank. In exchange, clicking `Ceded` stops hiding the
annual curve along with the per-claim one, which it does today. If the author
prefers three chips, the revert is the one line that names the series.

### Acceptance

* Library: `uv run pytest -m 'slow or not slow'`.
* By hand: Reinsurance / Plot on `agg.Capstone.XOL`, hover the right panel and
  read `Gross`, `Ceded to occurrence`, `Net of occurrence` filling together at
  one loss.

---

## [capstone] library 1.0.0a399 and api 1.0.0a200: Capstone.Capped

Item 5, as the author ruled: the new entry replaces `Capstone.PC`, and the
inner aggregate is renamed, since it no longer cedes a slide.

**[library] `src/aggregate/agg/library.agg`**, replacing the `xpnl Capstone.PC`
entry in place, so its position in the file and so the Examples menu order is
unchanged:

```
xpnl Capstone.Capped
  derive premium
  less
    agg Capstone.CappedQS agg.Capstone.XOL
      aggregate net of
        75% po 20000 xs 0 rate 1 cede 0.30 as "Capped QS"
  less
    25% premium expenses as "G&A"
  peel top-down
  note{...}
  tags{topic:capstone, role:advanced};
```

The note is rewritten: a capped quota share at a flat 30% ceding commission on
the net of XOL book, the XOL program pulled in by reference so the terms stay
stated once, and peeling available top-down where the slide blocked it. The
old note's sentence about calibrating a slide against `Capstone.XOL.PnL` goes
with the slide.

Both library tests that list the Capstone entries follow the rename:
`tests/test_agg_libraries.py` and `tests/test_library_entries.py`.

**[api] 1.0.0a200**: `web/test/example-search-order.test.js` names
`Capstone.PC` in its expected reading order, so it follows too. That is the
whole api change, and it bumps because the author asked for a version bump with
this item.

### Acceptance

* Library: `uv run pytest -m 'slow or not slow'`.
* api: `npm test` in `web/`, then build `xpnl.Capstone.Capped` from the
  Examples menu and open PnL / Ledger, which is the leaf `peel top-down` is
  there for.
