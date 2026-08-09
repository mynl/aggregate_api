# plan-ui-round-4: the second full pass over the running site

Eighteen items off the author's punch list, taken after a second end-to-end run
on desktop and iPad. The list itself is `dev/api-punchlist.md`, Punchups Round 4,
with a triage table under it giving the diagnosis and the fix for each. This plan
is the execution order: six phases, one version bump and one commit each,
a55 to a60.

Nothing here is chart work. The chart items from the same round (ref line labels,
the readout, double click to reset, centered controls) moved to
`dev/plan-plot-ir-api.md` and are done as part of the IR migration, against the
document rather than against the app's own builders.

## What the round is really about

Three of the six phases are the status strip and the navigation telling the
truth. A bivariate builds and its strip says nothing but its name. A clean object
under reinsurance turns the strip amber. A greyed tab explains itself on one
level of the menu and stays silent on the other. None of these is a missing
feature; each is the page reporting something other than what is true, which is
the failure mode worth clearing first.

The other three add what the second run showed to be missing: a way back from a
program without leaving the keyboard, the two perspectives the exhibit registry
has always carried, and a cession you can build rather than type.

## Phase a55: the nav and its greying

Five items, all in `nav.js`, `site.css` and `renderSubTabs`. No server change.

**Item 4, the greyed tab that says nothing.** Diagnosed, and it is not a styling
problem. `applyCapabilityGating` puts **both** `nav-off` and Bootstrap's
`disabled` on a dark group tab (`main.js:776-777`), and Bootstrap 5.3's
`.nav-link.disabled` sets `pointer-events: none` and `cursor: default`
(`bootstrap.css:3834-3838`). Pointer events off means `:hover` never fires, so
the `data-why` tooltip cannot draw, and `cursor: default` is exactly the "no
change" the author reports. The sub-tabs are plain buttons that never take
`.disabled`, keep their pointer events, and therefore do show the tooltip. That
is the whole asymmetry between the two levels.

The a48 comment above those lines worried about the native `disabled`
**attribute** suppressing the tooltip and set only the class. The class does the
same damage through a different rule, so the comment is half right and needs
correcting along with the code.

Fix, keeping Bootstrap's guard rather than removing it: `.disabled` stays,
because the Tab plugin checks for it and refuses to activate the trigger, and
the capture-phase click refusal at `main.js:805` stays as the second guarantee.
One rule restores the hover:

```css
.out-tabs .nav-link.nav-off { pointer-events: auto; cursor: default; }
```

`cursor: default` rather than `not-allowed`, per the author: no panic sign. The
same goes for the sub-tabs, so `cursor: not-allowed` comes off `site.css:405`.

Then tone the tooltip down, which is the rest of the item. It is currently
`--ink` ground, white text and `0 3px 12px rgba(0,0,0,.22)`, which is what reads
as a box pulsing at you. Drop the shadow, lighten the ground to a surface token,
and let it sit as a quiet note rather than a callout.

**Item 2, the copy buttons go.** All of them, per the author, except CsvGrid's
own export controls, which are built in and used. Four edits: `copy: true` off
both leaves that declare it (`nav.js:170` validation, `nav.js:231` narrative),
the button branch in `renderSubTabs` (`main.js:703-709`), and `copyPane` itself
(`main.js:2024-2034`). The `[data-copy]` wiring at `main.js:2036-2038` goes with
it and is already dead: nothing in `index.html` carries the attribute. The
comment at `index.html:354` mentions the copy button and needs following.

**Item 12, Validation moves to Overview**, after Tail, because key order is row
order. Add `'overview:validation'` to `LOADERS` and drop `'more:validation'`;
the loader body changes only its pane id, `pane-more` to `pane-overview`. No
markup change, since `index.html` lists groups and not leaves.

**Item 13, the Reinsurance row reorders** to Plot, Summary, Stats, Density, to
parallel Overview. Nothing reads the keys positionally. Accept the consequence:
`activeLeaf` lands on the first live leaf, so a reinsured aggregate now opens on
Plot. On a reinsured portfolio Plot is dark (`chart_reins` is registered for
`Aggregate` alone, the standing `replot` item) and it falls through to Summary.

**Item 1, the sub-tab gap.** `site.css:372` is `padding-top: .5rem;
margin-bottom: .55rem`. Take both to `.7rem`: a smidge more, and symmetric.

**Acceptance.** `node dev/scripts/check-nav.mjs` stays green over the captured
capability fixtures, which is what proves item 12 and item 13 did not change
which leaves are live. Then a browser pass on a `grossceded` object, which is
the case the author found item 4 with: Overview and More live, the other four
greyed, and every one of the four naming its reason on hover.

## Phase a56: the strip's verdict and its history

Three items, client side only.

**Item 9, green under reinsurance.** Confirmed and one line. Under a cession the
library returns `'reinsurance; subject not unreasonable'` (`_validation.py:117`),
not the bare phrase. `validationState` (`main.js:423`) tests for the bare phrase,
misses, tests for `mean`, misses, and falls through to `'warn'`, so a clean
object turns the strip amber. Normalize by stripping a leading
`reinsurance; subject ` and grading the remainder. Principled rather than a
second literal: it also makes `'reinsurance; subject fails agg mean'` grade bad
because it names the mean, instead of by accident.

**Item 14, the m/n label, and what it does not fix.** Rendered off `history.js`
as the author agreed, so it says "in your history" and comports with reality:
history is localStorage and outlives the session, so a session-scoped count
would be a number the app cannot honestly produce. The label goes below the
input box, to the right of the GCN button once a56 lands.

The label alone does not answer the complaint that opened the item. `record`
(`history.js:36`) dedups against the most recent entry, so building the *same*
program twice leaves both m and n unmoved and still looks like nothing happened.
So the phase also adds a brief flash on the status strip on every adopted build,
cached or not, which is the signal that actually says "that landed".

**Item 18, drop `cached` from the first row.** One line, `main.js:404`.
`renderTiming` already says "Loaded from cache" on the second line. Sequenced
after the flash deliberately, because `cached` is currently the only on-screen
sign that a repeat build was a no-op, and removing it first would make the page
briefly worse.

**Acceptance.** Build the same program twice and watch the strip: the flash
fires both times, the label holds at m/n, and nothing says "cached" on line one.
Build a reinsured aggregate whose gross is clean and confirm the strip is green.

## Phase a57: the strip's facts

Three items, all through `_headline` (`routes/objects.py:326-374`),
`BuildResponse` and `renderSummary`. Server and client, so this is the phase
that moves the response schema and the one to run `uv run pytest` hardest on.

**Item 3, the bivariate line.** The values exist; the extractor drops them.
`_headline` coerces with `float(...)` and `int(...)`, and a
`BivariateAggregate` carries `bs` as a two element list (`bivariate.py:1117,
1748`), so every coercion raises and `_num` swallows it, leaving name and kind
alone on the strip. `log2` is not an attribute but is one expression per axis,
`int(round(np.log2(len(self.axis_xs[i]))))`, which is what `bs_description`
already computes (`bivariate.py:2521`); mean and cv come off `self.units`, a
list of ordinary `Aggregate` objects.

Shape: an optional `components: list[{name, bs, log2, mean, cv}]` block on
`BuildResponse`, with the scalar fields left alone. Additive, so no existing
type widens, no existing test moves, and every other kind serializes exactly as
it does today. `renderSummary` prints the pair when the block is present.

Validation prints `n/a`, per the author. There is a minimal validation and it is
not a drop-in: the tail deficit against a 1e-5 gate, which checks mass
conservation rather than moments. Raised upstream in `TODO.md` rather than
faked here by relabeling the deficit as a verdict.

**Item 17, the sign convention.** `value_type` is public on `Aggregate`
(`_aggregate.py:3263-3271`), returning the configured label off the internal
`_is_loss_value` role. Read it `getattr`-gated so a kind without it reports
`None`, carry it on `BuildResponse`, and print it between `log2` and `mean`.
**Payoff only**, per the author: loss is the default and stamping it on every
build is noise on a line that has been trimmed twice already.

**Item 16, warnings reach the strip.** `BuildResponse.warnings` exists and is
always empty: every construction site passes `[]` (`routes/objects.py:659, 817,
1868`). Nothing is being dropped by accident, the capture was never written.

The library uses two channels and the larger one is logging, not warnings:
`logger.warning` across `_aggregate.py` (9 sites), `underwriter.py` (13),
`parser.py` (6) and more, against a handful of `warnings.warn`. The author's
splice example arrives through logging. So capture both: a `logging.Handler` on
the `aggregate` logger at WARNING and above, plus
`warnings.catch_warnings(record=True)`, for the duration of the build.

Both mutate global state, and both are safe here for one reason that belongs in
the code comment rather than in anyone's head: builds are already serialized by
`_build_semaphore` (`routes/objects.py:156, 674`), so install inside that lock
and the global mutation has exactly one writer.

Render into the existing `summary-note` slot, which already exists and is
already cleared per build. Do **not** move the strip state: validation owns the
strip's color, and a warning that repainted the strip would compete with a
verdict that means something more specific.

Note the defective-distribution half of the item is already there and merely
quiet: `Validation.DEFECTIVE` reaches the strip as `pmf deficit` through
`validation_description` (`_validation.py:96`).

**Acceptance.** `uv run pytest` green, with new cases for the `components` block
on a bvagg, `value_type` on a payoff object, and a warning-emitting program
reaching `warnings`. Then build the author's example,
`agg A dfreq[1] sev 10 - lognorm 1.5 splice[0 11]`, and read the note line.

## Phase a58: the action row

Three items, in this order, because the third reuses the first.

**Item 8, the reformat button.** Both halves already exist: `POST
/v1/decl/format` (`routes/decl.py:66`), which is `format_program(decl,
fmt="text")` underneath, and `api.formatDecl` (`api.js:139`). The item is a
button before Sharpen calling
`editor.setText((await api.formatDecl(text)).decl)`. One thing to handle:
`_format_decl` catches every exception and echoes the input
(`routes/decl.py:41`), so a malformed program reformats to itself and the button
looks broken. Flash "unchanged" there, which `flash()` (`main.js:2045`) does.

**Item 6, Reset goes.** The up and down arrows already cover the walk back.
Removes the button (`index.html:144`), the handler (`main.js:302-318`), one
`off()` call in `renderActionRow`, and with them `state.base` and
`state.derived`, which have no other consumer.

**Item 7, GCN takes its place.** A split dropdown labeled GCN, default
GrossCeded, with GrossCeded, GrossNet and NetCeded.

These are prefixes, and the grammar is explicit: `GROSSCEDED agg_out ->
bv_out_grossceded` with its two siblings (`decl.lark:249-251`), where `agg_out`
is a full inline agg declaration and not merely an `agg.NAME` reference
(`decl.lark:72-73`). So this is client-side text: prepend the keyword, reformat
through item 8's call, rebuild. No new route.

Two rulings from the author, both settled:

* **Grey, never fail.** The grammar comment (`decl.lark:244-249`) says these take
  an agg carrying **occurrence** reinsurance and build the joint per-occurrence
  aggregate, so gate on the occurrence cession specifically rather than on the
  weaker `has_reins`, and grey with a reason when it does not apply. House rule:
  things never disappear and never fail on submit when they could have said so.
* **Land on Overview.** The result is a `BivariateAggregate`, so
  `_classify_object` returns `bvagg` (`routes/objects.py:868`) and the nav
  re-gates, which would otherwise leave the reader on a Reinsurance tab that just
  went dark. `runDerivation` already carries the mechanism: its `land` parameter,
  which `pnl` uses for Economics (`main.js:289`).

Recorded and deliberately **not** built here: the reader should be able to adjust
the reinsurance from the GCN view rather than going back to rebuild it. Overview
for now.

**Acceptance.** Build an aggregate with occurrence reinsurance, press each of the
three options, and confirm the editor holds a formatted `grossceded agg …`, the
object is a bivariate, and the page lands on Overview. Then build one with only
aggregate reinsurance and confirm the button is grey with a reason.

## Phase a59: two preferences in the hamburger

Both are the Tables switch copied: a `menu-check-item` pair, a module-level
value with localStorage, and a re-render through the existing
`tableViewListeners`.

**Item 5, Raw or Insurer.** `GET /exhibit/{name}?perspective=` exists
(`routes/objects.py:2236`, default `raw`), `api.exhibit` already sends one
(default `insurer`, `api.js:87`), and the capability payload carries
`perspectives` per exhibit, so the control greys itself when the object's
exhibits offer only one.

State plainly in the changelog which leaves respond, so the first use matches
expectation: the five on the exhibit route, Economics Ledger, Ratios and
Waterfall, plus More Tail behavior and Dependency (`main.js:589-647`).
Everything else, Overview Summary and Tail, all four Reinsurance leaves and More
Validation, Stats, Density and Window, goes through `frameIr` / `frameOf` and
will not move. That is the known `[Exhibits-App-Cleanup]` item in `TODO.md`, and
it is not a blocker.

**Item 15, full precision static tables.** Easier than it looks, for one reason:
`TableSpec(include_raw=list(df.columns))` (`tables.py:313`) means the exact
values are **already on the wire** in both views. Nothing is lost server side;
the `formatters` dict is what hides them, and the interactive grid already sorts
on the raw numbers (`tables.js:105`). So the item is a query param that skips the
`FORMATS` lookup (`tables.py:289`) and lets the engine infer, or passes a wide
float format, plus the menu pair.

Check first whether greater-tables 6.0's `table_float_format` house default does
this in one knob, which `TODO.md` already flags as unexplored. If it does, the
server change is a line.

**Acceptance.** Flip each switch on a P&L (the kind with the most exhibit-route
leaves) and confirm the five named leaves change and the others do not. Confirm
both preferences survive a reload.

## Phase a60: the cession box

**Item 10, autocomplete in the box.** `reins-input` is a plain `<input>`
(`main.js:1509`) with no completion machinery; the main box gets it from CM6 plus
`api.complete`. A second small CM6 instance is the consistent answer and
`editor.js` has the wiring.

The work is the **context**, not the widget. `complete(decl, cursor)` wants a
program and an offset, and a bare `250 xs 250` is not a valid prefix of one, so
the call must send the enclosing program with the draft spliced in at the cession
position and the cursor shifted to match. Budget the item on that. The Tab
complaint is separately one `keydown` handler.

**Item 11, Quick Re.** Two parts, and the second is deliberately capped.

*Lifecycle*, which is small and partly reverses a51, whose reasoning sits at
`main.js:1511-1523`: ceding is iterative and a surviving draft is the point of a
draft. Reconcilable on the author's own wording, "when you load a **new** decl":
keep the draft across rebuilds of the same program, clear it when the editor's
program changes identity, which is `loadExample` and `navigateHistory`. "Load
what you have" is a third state and `reins_description` already serves it.

*The panel*, settled by the author 2026-08-09. Named **Quick Re**, laid out as
option A of the sketch: the text box stays as the default path and the form is a
disclosure under it, so nothing is more cluttered until it is asked for.

```
Quick Re  [ 250 xs 250 occurrence                 ]  [ Add re ]
  ▸ quick edit
      share [ 100% ]   attach [        ]   limit [        ]
```

**Scope is capped at one layer, on purpose.** Complex multi-layer programs are
typed in the big box, which is what it is for. This is demo sugar and is worth
building only while it stays that; if it starts growing a second layer it has
failed and should stop.

**One field per quantity, two readings, which is the design's whole trick.** The
author's rule: `nn%` reads as a probability and a bare number reads as currency,
so attach and limit each take one input rather than a pair, and there is no mode
switch and no second set of boxes to keep in step. Three details this implies,
recorded because each is a place it could be built wrong:

* **`share` is exempt.** It is always a share, never a probability, and defaults
  to 100%. The dual reading applies to attach and limit alone.
* **A percentage limit is a detachment probability**, so `attach 50% limit 99%`
  means attach at `q(.5)` and a limit of `q(.99) - q(.5)`. That is the author's
  original formulation and it is the only reading that makes a percentage limit
  mean anything.
* **Mixing is legal.** `attach 50% limit 1000000` is attach at `q(.5)` with a
  currency limit, and needs no special case beyond resolving each field on its
  own.

Emitted clause, per the grammar (`decl.lark:370-373`): `<limit> xs <attach>`,
or `<share> share of <limit> xs <attach>` when the share is not 100%, wrapped in
`occurrence net of` or `aggregate net of` from the existing basis control.

**One thing has to be built first.** The percentage reading needs `ob.q(p)` and
there is **no quantile endpoint**: `tail_df` carries VaR by return period so
`q(.99)` is reachable, but `q(.5)` is not. So `GET /objects/{id}/quantiles?p=…`
comes first, and it is also the natural home for round-number snapping, which the
demo needs: a raw `q(.99) - q(.5)` limit prints as something like
`1,234,567.8901`, and that is not a layer anyone writes.

**Acceptance.** Cede from Quick Re with currency amounts, then with
percentages, then with one of each, and confirm all three produce a clause the
grammar accepts and a program that rebuilds.

## Standing rules for every phase

Per `CLAUDE.md`, and repeated here because six commits is enough to drift:

* One version bump per phase, in `pyproject.toml`, and one commit carrying
  source, tests, `CHANGELOG.md`, this plan, `dev/TODO.md`, `pyproject.toml` and
  `uv.lock`. One-line subject, `[aNN] <terse summary>`; the changelog section is
  the detail.
* `uv sync --extra dev` after each bump, or `/v1/meta` keeps reporting the old
  version from the editable install's recorded metadata.
* The built SPA under `src/aggregate_api/static/` is gitignored and is never
  part of the commit.
* The author starts and stops servers. Nothing here binds a port: `uv run
  pytest` and the capture scripts all drive the app in process through
  `TestClient`.
* No dashes as punctuation, in code, comments, changelog or commit subject.

## Order, and what blocks what

Only three orderings are real. Item 8 precedes item 7, which reuses its call.
Item 14 precedes item 18, which removes the signal item 14 replaces. The quantile
route precedes the quick-edit panel. Everything else is independent, so the phase
order is by risk: the nav first, since it clears a complaint raised twice, and
the cession panel last, since it is the only one carrying a design question.
