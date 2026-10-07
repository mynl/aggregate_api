# Plan a182+: Evaluate auto-compute, the PnL split button, sentence forms, and expenses

Four parts, each its own version bump and commit, in the order below. One
upstream ask on the `aggregate` library rides with part [pnl-dropdown] and is
specified at the end. Versions are assigned as they land, starting at the next
free `1.0.0a*` (a182 at the time of writing).

Written for a reader with no conversation context. File references are to this
repo unless marked *upstream* (the sibling checkout named in
`[tool.uv.sources]`, currently `../../worktrees/aggregate_REFACTOR`).

---

## Part [evaluate-auto]: Evaluate on a P&L computes itself

### Current behavior

`run_evaluation` (`src/aggregate_api/pricing.py`) takes no arguments for a
P&L: every ledger row evaluates on its own terms, and the route refuses a
premium, basis or anchor. The SPA knows this: `syncEvaluateForm`
(`web/src/main.js:3705`) calls `setFieldsVisible(false)` for a pnl, hiding the
anchor and premium boxes. But the basis group still draws (dead, with its why),
the Evaluate button stays live and primary-colored, and the pane says "Press
Evaluate." until the reader presses a button that takes no input. A form with
one live control whose press is a no-choice formality is worse than no form.

### Change

1. **`web/src/pricing-form.js`**: give the returned handle a way to put the
   whole form to sleep, not just the two field pairs. Extend
   `setFieldsVisible(on)` to also disable the submit button and dim the basis
   group wrapper when `on` is false (or add a sibling `setDormant(on)` if
   overloading reads badly; implementer's choice, one mechanism only). The
   `note()` channel already exists for printing a sentence where the preview
   goes.
2. **`web/src/main.js`**:
   - Factor the body of the Evaluate `onSubmit` into a callable
     `runEvaluation(body)` so the button and the auto path share one
     implementation (busy handling, `_evaluation` write, `holdPricing`,
     `drawPricingPane`, error pane).
   - `syncEvaluateForm`: for a pnl, after putting the form to sleep, print via
     `note()`: "A P&L evaluates every row of its ledger on that row's own
     terms; computed automatically."
   - `showPricingLeaf('evaluate')`: when `state.kind === 'pnl'` and
     `_evaluation` is null, call `runEvaluation({})` instead of waiting for a
     press. `_evaluation` is the cache, cleared by `forgetPricing()` on every
     new object, so revisiting the leaf costs nothing and a new build
     recomputes on next arrival. Guard reentry with the existing busy state.

No api change. The route already accepts the empty body for a pnl.

### Acceptance

- Build any `pnl ...` program; open Pricing / Evaluate: the acceptability
  table appears with no press; the form band is visibly inert (no primary
  button, dimmed basis group) with the sentence above explaining why.
- Leave the leaf and return: no second POST (watch the network tab).
- Build a plain agg: form wakes up, button press required, exactly as today.

---

## Part [pnl-dropdown]: the PnL split button, and the reset bug

### Current behavior, and the bug

One button (`pnl-btn`) flips label and action on `state.kind`
(`web/src/main.js:505` `renderActionRow`): `PnL` wraps via
`POST /objects/{id}/pnl`, `Explode` rewrites via `POST /objects/{id}/explode`.
Two problems:

- **It is a state-changing button**, the play/pause pattern the house UI rules
  ban. The comment at `main.js:514` defends it; the defense has now failed in
  practice.
- **The reset bug.** `state.kind` and `state.id` move only on a build
  (`adoptBuild`, `main.js:334`). Build a program, press PnL (object is now a
  pnl, button says Explode), then type a *new* program without building: the
  button still says Explode and still acts on the stale built object. Pressing
  it replaces the reader's new text with the old object's exploded program.
  GCN never has this failure because it reads the editor and builds
  (`applyViews`, `main.js:779`).

### Change

**UI** (`web/index.html`, `web/src/main.js`, following the GCN split-button
pattern `gcn-btn`/`gcn-caret` exactly, including its dropdown-close-before-
disable rule):

- Main button: **PnL** (wrap, deposit premiums). Caret menu: **PnL (rate)**,
  **xPnL**, **xPnL (rate)**. Labels never change with state. The rate options
  write each ceded layer's premium as a `rate` clause (a fraction of the P&L's
  stated gross premium) instead of a `deposit` amount; see the upstream ask.
- One handler `applyPnl({ form, premiumStyle })` behind all four:
  1. **Derive from the box, not from stale state.** Remember the program text
     that produced `state.id` (set it in `adoptBuild`'s callers where
     `recordProgram` runs; a module-level `_builtDecl` is enough). If the
     editor's trimmed text differs, build it first (reusing the ordinary
     `build()` path) and only then derive from the fresh object. An empty box
     or a failed build stops there with the ordinary failure rendering.
  2. For a non-pnl object: `POST /objects/{id}/pnl` with
     `{form, premium_style, ...}` (route change below). Land on `economics`,
     as the wrap does today.
  3. For a pnl object: `xPnL` means the existing
     `POST /objects/{id}/explode`; `PnL` and the rate wrap grey (the object is
     already a P&L and `can_pnl` is false for it).
- **Greying**, per item, with a why on hover, read off new capability flags
  (below): rate items grey until the library ships `premium_style`; `xPnL`
  greys for a portfolio engine (upstream refuses: the portfolio total hides
  its units) and for an already-exploded pnl.
- `renderActionRow` loses the label flip and the `exploding` branch; it gates
  the four controls off the flags.

**Api** (`src/aggregate_api/models.py`, `routes/objects.py`,
`capability.py`):

- `PnlProgramRequest` gains `form: Literal['pnl', 'xpnl'] = 'pnl'` and
  `premium_style: Literal['deposit', 'rate'] = 'deposit'`.
- `post_pnl`: after `obj.pnl_program(...)`, when `form == 'xpnl'` run the
  program through the existing `explode_program(collapse_program(...))`
  machinery (same peel rule as `post_explode`: `bottom-up` when the engine has
  reinsurance, none otherwise), refusing a portfolio engine with the same 400
  sentence `post_explode` uses. `premium_style='rate'` passes through to
  `pnl_program` **only when the installed library's signature accepts it**
  (feature-detect with `inspect.signature`, once at import); otherwise HTTP
  400 "premium_style='rate' needs aggregate >= <version>", so the api is
  honest before the library lands.
- `capability.py`: two flags, in the house style of one consumer each:
  - `can_pnl_rate`: the signature test above, and `can_pnl`. Lights the two
    rate menu items.
  - `can_xpnl`: for a non-pnl, `can_pnl` and the engine is a single
    `Aggregate` (a portfolio cannot explode); for a pnl, the existing
    `can_explode`. Lights the xPnL item. `can_explode` stays, unchanged, as
    the explode route's own gate.

### Acceptance

- Build program A, press PnL (now a pnl). Type program B without building,
  press PnL: B is built and wrapped; A is gone from the picture. No path
  explodes A.
- On an agg: all four items live (rate pair grey until the library ships).
  On a portfolio: PnL live, xPnL grey with why. On a pnl: PnL grey, xPnL
  explodes in place. On an exploded xpnl or a bivariate: everything grey.
- `uv run pytest` covers: `form='xpnl'` wrap-and-explode on a reinsured agg
  (program leads `xpnl`, carries `peel bottom-up`), portfolio refusal,
  `premium_style='rate'` 400 while unsupported.

---

## Part [sentence-forms]: the pricing form reads like Quick Re

### Current behavior

Quick Re (`web/index.html:505`) reads as a sentence: lede, boxes joined by
operator words in the `qr-op` face, a `?` help button carrying the whole
explanation as a tooltip. The pricing form (`web/src/pricing-form.js`) is the
older idiom: an 'anchor and target' band label in letterspaced small caps, a
`◦` spacer between the halves, a trailing gloss, no help button.

### Change

All in `web/src/pricing-form.js`, `web/src/main.js` (the opts each mount
passes), and `web/src/styles/site.css` (reusing the `qr-op` / `qr-help` rules;
extract shared classes rather than duplicating them).

- The row becomes a sentence with connective words in the Quick Re operator
  face: comma after the basis group, comma between the anchor and target
  clauses, `and` before the last clause, period at the end, then the verb
  button and a `?`:

  `Calibrate on [Gross|Net occ|Net], [0.99][p|assets], and
  [0.15][CoC|LR|Premium]. [Calibrate] [?]`

- The `band-label` ('anchor and target') and the `◦` spacer **go**: the lede
  and the connectives do their job. `opts.bandLabel` is removed from every
  mount; `opts.basisLabel` becomes the sentence lede (same text it carries
  now: 'calibrate on', 'allocate on', 'premium is'), capitalized as the first
  word of the sentence.
- Leaves without a basis group start the sentence at the verb phrase instead:
  Bounds `Compute at [input][p|assets], and [input][CoC|LR|Premium].`; Pr Ruin
  keeps its extras row below, unchanged.
- New `opts.help`: tooltip text for the `?`, one per mount, written at the
  mount in `main.js` (what the anchor means, what the target means, what the
  preview line reports). The existing `opts.gloss` on Evaluate folds into its
  help text and the gloss slot goes if no mount still uses it.
- No behavior change: `read`/`write`/`sync`/preview logic untouched.

### Acceptance

Visual, on all six mounts (Calibrate, Allocate, Evaluate, Pr Ruin, Bounds,
and Evaluate's dormant pnl state from [evaluate-auto]): one sentence per form,
no band label, no `◦`, `?` present and populated, no row-height jump against
the Quick Re row, responsive wrap acceptable on a phone width.

---

## Part [expenses]: an expense ratio, and gross versus net premium

### The problem

`octet.premium` everywhere in the pricing group is a **technical** premium
(net of expenses). A P&L's ledger carries a booked gross premium and an
expense leg; plain aggs carry no expenses at all. A reader pricing against a
real quote types a gross premium, and today the calibration silently treats it
as technical, overstating the target by the expense load.

### Design

Expenses enter **only through the premium leg**. A CoC or LR target calibrates
exactly as today (LR stays the technical loss ratio); the expense ratio then
only translates the resolved technical premium into a gross reading on the
preview line. A Premium target is read as **gross**: the calibration runs on
`premium × (1 − expense_ratio)`.

The arithmetic lives in the api runners, once, not in the SPA (the form "holds
no arithmetic" rule) and not yet upstream: the flat-ratio identity
`gross = net / (1 − e)` matches `pnl_program`'s own `expense_ratio` meaning
(gross expense as a fraction of premium). If the expense model ever grows past
a flat ratio, it moves upstream; note this in `pricing.py`'s module docstring.

### Change

**Api** (`src/aggregate_api/models.py`, `pricing.py`, tests):

- The pricing request bodies for preview, calibrate, allocate and evaluate
  gain `expense_ratio: float | None = None`, validated to `[0, 1)`.
- `run_pricing_preview(expense_ratio=...)`: with a premium target and a ratio,
  feed the pentagon `P = premium × (1 − e)`. The response gains
  `gross_premium`: `premium / (1 − e)` of the resolved technical premium when
  a ratio was sent, else null. (`premium` stays technical, as documented.)
- **P&L preview**: the preview already resolves a pnl to its wrapped engine.
  Additionally, for a pnl, read the ledger's own pair off
  `economic_ratios_df`'s gross (first) block: `gross_premium = P` and report
  `net_of_expense_premium = P − E` in a new response field; a typed
  `expense_ratio` on a pnl is refused 400 ("a P&L states its own expenses in
  the ledger").
- `run_calibration`, `run_natural_allocation`: a premium target scales by
  `(1 − e)` before `_coc_for_premium`. `run_evaluation`: the typed premium
  scales the same way (a pnl takes no premium, unchanged).
- Tests: premium target 1000 at `e = 0.25` calibrates identically to premium
  target 750 with no ratio; preview echoes gross 1000 / technical 750; pnl
  preview reports the ledger pair; `e` with a CoC target changes nothing but
  the preview's gross reading.

**SPA** (`web/src/pricing-form.js`, `web/src/main.js`):

- Per the author's ruling, the expense box rides on **Calibrate, Allocate and
  Evaluate** (Bounds and Pr Ruin unchanged). Opt-in via `opts.expense`.
- The sentence from [sentence-forms] extends:
  `..., [0.15][CoC|LR|Premium], and [0][expense ratio].` An empty or zero box
  sends nothing, so the default path is byte-identical to today.
- One shared current value across the three forms (module state beside
  `priceBasis`, not persisted: it is a fact about the program being priced,
  not a reader preference), and it rides in `holdPricing` so leaves reopen
  consistent.
- Preview line: when the response carries `gross_premium`, lead with
  `gross premium #,###.##, net premium #,###.##, assets ...`; otherwise
  unchanged. On a pnl (Evaluate's dormant band and the Bounds preview), report
  the ledger pair from the new fields.
- The pnl state of the expense box: dead, with why "the ledger states its own
  expenses".

### Acceptance

- Agg, Calibrate, target Premium 1000, expense ratio 0.25: receipt matches a
  target of 750 with the box empty; preview reads gross 1,000.00, net 750.00.
- CoC target with a ratio: identical table to no ratio; preview shows the
  grossed-up premium.
- `pnl` object, Evaluate: band dormant, line reports the ledger's gross and
  net-of-expense premium.
- Empty box everywhere: requests carry no `expense_ratio`; previews unchanged.

---

## Upstream ask (the `aggregate` repo): `pnl_program(premium_style=)`

For the maintainer of `aggregate` (same author); this repo depends on it only
for the two rate menu items, which stay greyed until it ships.

- `pnl_program(ob, ..., premium_style='deposit')`, accepting `'rate'`. Under
  the ladder (`net_combined_ratio` set), `'rate'` writes each priced layer's
  premium as `rate r_j` instead of `deposit d_j`, where `r_j = d_j / P` and
  `P` is the P&L's stated gross premium the ladder has just computed. The
  grammar already reads `rate` as a fraction of the side's subject premium
  quoted at 100% placement (`decl.lark` ~375), so resolution returns
  `s_j × r_j × P = s_j × d_j`, the identical premium; the share invariance
  rule for deposits carries over unchanged.
- Spell `r_j` with enough significant figures that the resolved premium
  round-trips to the deposit form at display precision; the existing deposit
  rounding rule is the model.
- Without the ladder there are no priced layers, so the style is moot;
  accepting and ignoring it there, or refusing it, is the library's call.
  Refusing an unknown style is a `ValueError` in the house message style.
- Two points to verify upstream: (1) building an `xpnl` whose layers carry
  `rate` clauses resolves each side's rate against the stated gross correctly
  (the explode rewrite in this repo carries layer clauses verbatim); (2) the
  existing refusal "a layer already carrying a rate clause" in the ladder is
  about *input* layers and is untouched by this output option.
- This repo feature-detects the keyword by signature, so no version dance is
  needed beyond the ordinary editable-checkout sync.

---

## Housekeeping

- One version bump and one commit per part, `[aNN] <terse summary>` subjects,
  CHANGELOG section per bump, `uv sync --extra dev` after each so `/v1/meta`
  tells the truth, SPA rebuild (`.\scripts\build-web.ps1`) at any bump where
  `web/` moved.
- `dev/TODO.md`: tick or add entries per part; the rate menu items get a line
  noting the upstream dependency until they light.
- Move this plan to `dev/done/` only when the author says done.

---

## Execution log (2026-10-01)

Executed in order: [evaluate-auto] a182, [pnl-dropdown] a183,
[sentence-forms] a184, [expenses] a186. a185 is the unrelated matrix cell
fix, committed in parallel while [expenses] was in flight; the collision was
caught at the bump and [expenses] renumbered. Both gates (427 pytest, 222
node) green at every bump; `check-nav.mjs` clean; SPA rebuilt at each bump.
The `uv sync --extra dev` re-syncs are owed and wait on a server restart, so
`/v1/meta` understates the version until then.

Divergences, all small and recorded here rather than silently absorbed:

- **[evaluate-auto] dormant means nothing hides.** The author's ruling with
  the execute command ("the pricing subbox goes dormant, it does not
  disappear") was read as overriding the plan's letter, which kept the anchor
  and premium pairs `d-none` through `setFieldsVisible`. Implemented as
  `setDormant(on)`: every control stays drawn, disabled and dimmed
  (`.price-form.is-dormant`), the pairs included, and `setFieldsVisible` is
  gone. One mechanism, as the plan asked.
- **[pnl-dropdown] the rate 400 names no version.** The plan's message
  template `"premium_style='rate' needs aggregate >= <version>"` has no
  number to name while the upstream ask is unshipped, so the sentence names
  the gap instead: the installed `pnl_program` does not accept the keyword.
  The signature test (`capability.PNL_PREMIUM_STYLE_SUPPORTED`) flips it on
  the sync that ships it.
- **[pnl-dropdown] `runDerivation` lost its own disabled check.** On a P&L
  the main PnL button is dark while the xPnL item is live and runs through
  that button for its busy label, so the guard moved to the pressed control
  (a disabled control cannot be clicked at all).
- **[sentence-forms] Pr Ruin's lede.** The plan spells only Bounds
  (`Compute at ...`); Pr Ruin takes `Draw at ...` by the same rule, the verb
  phrase of a form with no basis group.
- **[expenses] the dormant Evaluate band's ledger pair** is fetched through
  the preview route with the form's default anchor and target (`p 0.99`,
  `coc 0.15`), because the route requires a complete question and the ledger
  fields do not depend on it; the pair is cached per object (`_pnlLedger`)
  so revisits cost no request. `formContext.canPreview` now also answers for
  a P&L, which is what puts the pair on the Bounds preview line.
- **[expenses] `test_pnl_request_defaults_are_held_to_the_library_signature`**
  carves `form` and `premium_style` out as app routing fields, and asserts
  the `premium_style` default against the library the day the signature
  ships it.

## Upstream ask: shipped (2026-10-01)

`pnl_program(premium_style=)` landed as `aggregate` 1.0.0a386, to this plan's
spec: the rate is a respell of the ladder's finished deposit (occurrence rates
off the stated gross, aggregate rates off the gross less the occurrence
cession, mirroring the resolver), eight significant figures for the round
trip, authored clauses verbatim, moot without the ladder, unknown style a
`ValueError`. The api's a191 sync flipped `PNL_PREMIUM_STYLE_SUPPORTED` and
the two rate menu items lit with no change here. Both points the plan asked
to verify upstream hold: an `xpnl` carrying written rate clauses resolves
each side against its own base (`test_pnl_rate_style_is_a_respelling_of_the_deposits`),
and the ladder's input-side rate refusal is untouched
(`test_pnl_ladder_refuses_a_layer_already_priced_as_a_rate`).
