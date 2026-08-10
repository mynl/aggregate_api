# plan-ui-round-5: the round that finishes the details

Punchups Round 5 in `dev/api-punchlist.md`, taken 2026-08-09 after a63. Fifteen
items: four new (19, 20, 21, 23), six re-raised from Round 4 (7, 10, 11, 14, 15,
17), three chart items the author lists separately (G1 to G3 here), and two more
found by auditing `dev/graphs.md` against what actually shipped (G4 and G5).

Every diagnosis below was confirmed by reading the code or by driving the api in
process, not inferred. Where a thing is still a guess it says so.

## What went wrong in Round 4, stated plainly

Six items come back. They are not six unrelated slips; they are three habits, and
naming them is the point of writing this section.

**1. The fix was written and never watched.** Item 15 (full precision) and item
23 (perspective) both shipped working server halves and a client that cannot
show them. `setTableView` says in its own comment that moving to `precise`
"re-fetches, because panes hold their own fetch". Panes do not hold their own
fetch: every loader awaits its document *outside* the closure it registers, so
`notifyTableListeners` redraws the bytes already in hand. `loadLeaf` then
declines to re-run a loader for the leaf already on screen
(`state.rendered[group] === key`), so navigating away and back does not clear it
either. Both preferences are inert until you rebuild. One flip of the switch in
a browser would have caught it.

**2. "Done" was recorded against the wrong reading of the item.**
`dev/plan-plot-ir-api.md` marks 7.4 (readout in the legend) and 7.5 (reference
line labels) done at a63 and a62. 7.4 put the readout in a new strip *below* the
chart while the ECharts legend still draws separately, so there are now two
things where the author asked for one. 7.5 alternates label sides by index
parity (`index % 2`), where the item says which side each mark takes by what it
is: mean and 1-in-100 left, the capital anchor right. Neither is close enough to
be called done.

**3. The mechanism was assumed rather than read.** Item 10's plan says the
completion call must splice the draft into the enclosing program so the grammar
sees the clause in position. `completion.complete()` is a **static keyword pool
filtered by prefix**; it does not parse the text at all (its own docstring says
so: Lark's `parse_interactive` is LALR only and DecL is Earley). So the splice
buys nothing, and appending a draft to the end of a finished program returns all
105 keywords in alphabetical order. Worse, the datalist is filled with
`c.text || c.label` and there is no `text` field, so what gets offered for
insertion is the display label: `after' (profit-commission allowance)`, stray
apostrophe and all.

The corrective for this round is at the foot of this document, under
**Acceptance**: every phase names the thing to look at in a browser, and nothing
is written down as done until it has been.

## Diagnosis, item by item

### 19. The P&L premium prints its float dust

**Confirmed.** `post_pnl` calls `obj.pnl_program(loss_ratio, expense_ratio)` and
the library sizes the premium as `est_m / loss_ratio` in `_pnl_consideration`
(`_program.py:640`), then renders it with `decl_writer._fmt_num`, which is
`repr(float)`: the shortest string that round trips. So a computed mean of
12.25 over 0.70 arrives as `17.500000000000018` and is written into the program
text the reader is looking at. Reproduced here: a lognormal example gives
`pnl VT_PnL 7037.883281186453 premium less ...`.

Nothing on the api side can round it cleanly. `pnl_program` takes no premium
argument, so the only local option is a regular expression over the library's
own output, which is the string splicing this codebase refuses everywhere else
(see `post_reins`, which exists precisely so nobody splices a cession by hand).

**Fix, and it belongs upstream**: round in `_pnl_consideration`, which is where
the convention already lives. `_snap` in `routes/objects.py:1976` is the same
idea and the same three lines; six significant figures rather than three, since
a premium is not a layer. One consequence to record in the library docstring at
the same time: it currently promises "the P&L's realized loss ratio is exactly
the one asked for", and a rounded premium makes that true to six figures rather
than to the bit.

Effort **L**, upstream.

### 20. csv-grid should copy unformatted values by default

**Confirmed, and the answer is "not through an option".** CsvGrid 3.9.0 builds
the export menu in `_buildScaffold` (so it exists from construction) and
hard codes the checkbox: `c.checked = !0` at `csv-grid.es.js:824`. `_runExport`
reads the live checkbox, so there is no constructor option and no way to seed it.

**Fix, two parts.** Locally, one line in `mountGrid`: after construction, walk
`host.querySelectorAll('.csvgrid-export-formatted')` and clear them. That is
honest, reversible and commented as a default the widget does not expose.
Upstream, ask the csv-grid author for `exportValues: 'raw' | 'formatted'`, which
is what the author already offered to do.

One decision inside it: there are **two** such checkboxes, Copy and Save. The
recommendation is to clear both. Someone taking a table away wants the numbers
either way, and a Copy that differs from a Save is a surprise nobody asked for.
Say so in the changelog so it is a choice rather than a side effect.

Effort **L**.

### 21. More / Tail behavior and More / Window: where the glitch is

Two separate faults, one of them shared with items 15 and 23.

**a) In the interactive table view, Tail behavior cannot draw at all.**
Confirmed by reading the payloads. `more:behavior` takes the exhibit route
(`loadExhibitLeaf`), and the exhibit route serializes
`build_exhibit(...).to_payload()` straight from the library, which builds each
block as `gt.build(df, gt.TableSpec(**kw))` with the frame stage's own kwargs.
Those kwargs never carry `include_raw`, so the blocks arrive with bare text
cells and no raw values. `irToGridInput` throws on exactly that
(`gt-render.esm.js:275`: "requires raw values on every non-string data column"),
`irToGrid` returns null, and `mountTable` falls to `unavailable()`, which prints
*"Table renderer unavailable. The CSV download still has the data."*

This is not a Tail behavior problem. It is every exhibit-route leaf: Economics
Ledger, Ratios and Waterfall, More Tail behavior and More Dependency. All five
are dead in the interactive view and have been since a62.

**b) The two frames are cosmetically rough, in different ways.**

*Tail behavior*, from the live document: `min` prints at five decimals
(`0.00000`) while `max` prints at two (`1,000.00`), because greater-tables
infers digits per column and the two columns hold different things. An
unbounded `max` is `inf`, which renders as an em dash, so "unbounded" and
"missing" look identical. `cv` is NaN on the frequency and severity rows and
also renders as an em dash. `concentrated` is object dtype holding `None`, so it
prints as an empty cell.

*Window* is in better shape than the punch list implies: `more:window` takes the
**frame** route, not the exhibit, and `FORMATS` there does apply a two decimal
format to `x_min`, `x_max` and `W` and a general format to `bs`. The remaining
roughness is alignment. `bs_window_df` carries `x_min`, `x_max`, `bs`, `log2`
and `coverage` as **object** dtype (they hold mixed content: `coverage` is the
string `1-1e-12`), so the document declares them `dtype: string` and the walker
left aligns them, while `log2_need` and `clipped`, which are real floats, right
align. The result is a table of numbers where most of the numbers are left
aligned and two are not. `clipped` is all NaN on a clean build, so it is a
column of em dashes.

Worth knowing while fixing: the **exhibit** version of `bs_window` is strictly
worse than the frame version (no formats at all, so `x_max` prints
`17319.661747551625`), which is why `more:window` should stay on the frame route
until the exhibit carries `include_raw` and formats.

**Confirmed by the author, 2026-08-09**: what they are looking at is (a), the
grey "Table renderer unavailable" line, so their Tables preference is
Interactive and five leaves have been dead since a62. (b) is fixed in the same
phase because it is the same pane and cheap, but (a) is the item.

Effort **M** for (a), because the clean fix needs one upstream parameter (see the
Upstream asks below). **L** for (b).

### 23. Perspective, and which exhibits actually differ

**The control exists and does nothing.** Same root cause as item 15: see the
Round 4 accounting above. `setPerspective` calls `notifyTableListeners`, and
`loadExhibitLeaf` fetched its envelope before registering its listener, so the
redraw re-renders the perspective already on screen.

**The author's question, answered.** An exhibit differs between raw and insurer
exactly where a class module registers an insurer override. Reading the library's
registry (`aggregate/exhibits/`):

*Rows or columns genuinely change:*

| exhibit | class | what changes |
|---|---|---|
| `stats` | Aggregate, Portfolio, PnL | `ex1`, `ex2`, `ex3` rows dropped (26 rows becomes fewer) |
| `reins` | Aggregate, Portfolio | same raw moment rows dropped from the layering block |
| `economic_ratios` | PnL | one wide frame splits into `amounts` + `ratios`, so two blocks become three |

*Caption and row emphasis only, same numbers:*

| exhibit | class |
|---|---|
| `summary` | Aggregate, Portfolio (plus CV and Skew formats) |
| `tail` | Aggregate, Portfolio (capital anchors emphasized) |
| `validation` | Aggregate, Portfolio, BivariateAggregate, Distortion |
| `economic` | PnL (ledger row flags and formats) |

*No override at all, identical under both:* `economic_waterfall`, `dependency`,
`bs_window`, `tail_behavior`, and every other `register_simple_exhibit`
passthrough.

**The consequence that matters for expectations.** The five leaves wired to the
exhibit route today are Economics Ledger, Ratios and Waterfall, plus More Tail
behavior and Dependency. Of those, only **Ledger** and **Ratios** differ at all,
and Waterfall, Tail behavior and Dependency will never differ. Meanwhile the
exhibits with the biggest difference, `stats` and `reins`, are served to the app
through the *frame* routes, which have no perspective parameter. So even with
the refetch bug fixed, a reader on an Aggregate will flip the switch and see
nothing move.

That is the `[Exhibits-App-Cleanup]` item in `dev/TODO.md` and it is the real
work behind this punch item. It is not in this round: re-pointing Overview
Summary, Tail and Validation, More Stats, and the four Reinsurance leaves at the
exhibit route is a phase of its own and it wants the exhibit blocks to be
grid-renderable first, which is item 21(a). Sequenced, not skipped: fix 21(a) and
the refetch here, then that cleanup becomes a straight substitution.

Effort **L** for the refetch, **H** for the cleanup that makes the control mean
something, deferred with a written reason.

### 7. The GCN dropdown will not close

**Confirmed, and it is a precise Bootstrap interaction.** `renderActionRow`'s
`off()` puts both the `disabled` attribute and the `.disabled` class on
`#gcn-caret`, and `applyViews` additionally sets `gcnCaret.disabled = true` while
it runs. Bootstrap 5.3 finds open dropdowns with

```
SELECTOR_DATA_TOGGLE_SHOWN = '[data-bs-toggle="dropdown"]:not(.disabled):not(:disabled).show'
```

so a disabled toggle is invisible to `clearMenus`, which is the document click
handler that closes menus. `Dropdown.hide()` bails on `isDisabled` too. Now
follow one press: you pick Gross / Net, the item's own handler runs
`applyViews`, which synchronously disables the caret **before** the click bubbles
to document, so `clearMenus` never sees the open menu. The build then returns a
`BivariateAggregate`, `canViews` goes false, and `renderActionRow` leaves the
`.disabled` class on permanently. The menu is now open, unclosable by clicking
away, and unclosable by clicking the caret. Exactly the report.

**Fix**: hide the menu before disabling anything, at the top of `applyViews`:
`bootstrap.Dropdown.getInstance(gcnCaret)?.hide()`. One line, and it is the
correct order of operations rather than a workaround. Note for anyone adding
another split button: never disable a Bootstrap dropdown toggle while its menu
is open.

Effort **L**.

### 10. Completion in the cession box

**Confirmed, three faults, and the item is smaller than a60 thought.**

1. `complete(decl, cursor)` ignores the program. It walks back from the cursor
   over identifier characters and prefix matches a static keyword pool. So the
   a60 splice ("send the enclosing program with the draft spliced in") buys
   nothing, and an empty draft after a complete program returns all 105 keywords.
2. The datalist is filled with `c.text || c.label`, and the payload has no
   `text` field. `_label` in `completion.py:78` does
   `_TERMINAL_LABELS[terminal].strip("'")`, which strips the leading quote of
   `'after' (profit-commission allowance)` and cannot reach the interior one. So
   the offered insertion is `after' (profit-commission allowance)`.
3. Rewriting a `<datalist>`'s options while its input is focused does not reopen
   or refresh the popup in Chrome, so even correct entries would mostly not show.

**Fix.** Add an insertable `text` to the completion payload (the bare token,
which `_TERMINAL_LABELS` already contains inside its quotes) and a `detail` for
the gloss; fix `_label` to split rather than strip. Then the box needs no
program context at all, because the endpoint has none to use: send the draft and
the caret. Replace the datalist with a small suggestion list the box owns, and
wire **Tab** to accept the top suggestion, which is what the author asked for
("you naturally tab"), keeping Ctrl+Space as the explicit trigger.

Record in `dev/TODO.md`, do not attempt here: grammar aware completion needs
either a parallel LALR grammar or token by token stepping upstream. The main
editor has the same static pool and the same label-as-insertion wart, and fixing
the payload fixes both.

Effort **M**.

### 11. Quick Re on one line

**The current shape is a disclosure panel under a text box**, which is option A
of the a60 sketch and is what the author is now replacing. The new sketch:

```
Quick Re [Occ | Agg] [100%] po [50% or 100] attach [99% or 1000] detach [Add re] (?)
```

Concretely, and every one of these is a real edit:

* `<select id="qr-basis">` becomes a two button segmented control, the same
  `btn-check` radio pattern as CoC / LR on Pricing (`index.html:412`).
* The `<details id="reins-quick">` disclosure goes; its four fields come up onto
  the one row beside the existing box, and the free text `#reins-input` stays as
  the thing that receives the composed clause.
* One occurrence line and one aggregate line, so the row can be present twice.
  `composeCession` already emits one clause per basis and `post_reins` already
  takes a list, so this is layout plus a second read. ==> NO, see below
* Both prose paragraphs collapse into one line, with
  "Edit more complex structures directly in the program edit box." appended, and
  the whole thing becomes a tooltip on a trailing `(?)`.
* Everything center aligned and one height. Today `.reins-quick-row input` is
  `.74rem` and `.price-field input` is `.78rem` at `1.7rem` tall while the
  buttons are `btn-sm`, so this is a real pass over `site.css:602-650`, not a
  class rename.
* The third box becomes **detach**, in both readings, and `composeCession`
  computes `limit = detach - attach` whichever way each field was written. See
  Rulings below.
* **No stepper arrows.** The boxes stay `type="text"` so `50%` and `500` both
  parse, which is the reading the author wants kept, and typing is the way in.
  Author's ruling, 2026-08-09, on being shown that `<input type="number">`
  refuses the `%` character outright and that the two cannot share a box.

**One row, and the free text box goes.** Author's ruling, 2026-08-10: "When you
click the add button, it is added to the main text box and you can look at it or
adjust it there. The double transfer at the moment (first to the local text box
and from that to the main box) is unnecessary." So `#reins-input` and its
datalist come out, `Add re` composes the clause and cedes in one press, and the
program that comes back is where you read and adjust it. That is also why the
sketch has no text field in it.

**This supersedes item 10, and the plan says so rather than quietly dropping
it.** Item 10 asks for completion inside the cession box. There is no cession box
after this. The completion payload fix (`text` and `detail`, and `_label`
splitting rather than stripping) is still worth doing, because the **main
editor** inserts the same mangled labels, so item 10 becomes that fix alone and
loses its widget half. Flagged here in case the author would rather keep a free
text box for structures the row cannot express; the argument against is that the
main editor is exactly that box and it has real completion.

**New, and the one substantive addition of 2026-08-10: a live preview.**
Debounced, in the existing small hint font under the row, reading
`Preview: 5,000 xs 2,500 occurrence` and updating as any box changes. It starts
populated from the defaults rather than empty, so the row explains itself before
it is touched. It needs the quantile round trip that `composeCession` already
makes, so the work is the debounce, a cache so the same probability is not
re-fetched per keystroke, and rendering the composed clause instead of writing
it. This is the marketing sugar of the round: you watch the layer resolve while
you type a percentage.

Effort **M**, and it is the largest item in the round.

### 14. The DecL m/n label is far too big

**Confirmed, and the cause is a one-word miss.** `#history-pos` carries class
`fb-text`, but the rule that makes that class small and grey is
`.btnrow .fb-right { font-family: var(--mono); font-size: var(--fs-meta); color: var(--mut) }`,
and `#history-pos` sits **outside** `.fb-right` (`index.html:211` against `:221`).
`.btnrow .fb-text` on its own sets only `white-space` and `overflow`. So the
label renders at the inherited body size, 1rem, in the UI sans face, in body ink:
roughly a third larger than the hints it was meant to match, and darker.

**Fix**, which is also the move the author asks for. Drop the word `DecL` and
render `[3/4]`. Move the node inside `.editor-wrap` (already
`position: relative`) and place it absolutely under the clear icon, which is at
`right: 1rem; top: .85rem`, so roughly `right: 1rem; top: 2.3rem`, with
`pointer-events: none` and the meta font. One caveat to accept: it overlays the
editor's right margin, so a long unwrapped second line would run under it. At
the sizes real programs are, and with the label being four characters of grey,
that is the right trade; the alternative is a slot in the flow that costs a row.

Effort **L**.

### 15. Full precision does not work

**Confirmed, and it is the same defect as item 23.** Diagnosed above: the
document is fetched once, outside the closure that redraws, and `loadLeaf`
declines to re-run the loader for the leaf already on screen. So `precise` takes
effect on the next **build** and never on the flip.

Two more things, both wanted:

* The exhibit route has no `precision` parameter at all, so the five
  exhibit-route leaves will still not respond after the refetch is fixed. Same
  upstream parameter as item 21(a).
* Menu order. The author wants the two statics adjacent and Interactive last:
  **Static**, **Static, full precision**, **Interactive**.

Effort **L** for the refetch and the reorder; the exhibit half rides with item 21.

### 17. The sign convention is not in the strip

**Confirmed, and the reason is worse than "the wrong reading was chosen".**
a57 shipped `value_type` payoff-only, on the argument that loss is the default
and printing it on every build is noise. Checked against the library:

* `Aggregate.value_type` and `Portfolio.value_type` return `'loss'`, so
  `_headline` nulls them and the strip stays quiet.
* `PnL` has **no `value_type` attribute at all** (verified: `getattr` misses),
  so it reports `None` too.

A `PnL` is the one kind that genuinely reads on the payoff convention, which the
Economics ledger caption says out loud ("payoff convention, left tail bad").
So the field prints for **no object the app can build**, which is exactly "not
seeing this".

**Fix, two parts.** Print it always, loss and payoff both, per the author's
re-raise; that is a two line change and covers aggregates and portfolios
immediately. Separately, ask upstream for `PnL.value_type`, since the app should
not be inferring a convention the library owns. Until it lands, a P&L prints
nothing in that slot rather than a guess.

Effort **L** locally, plus one upstream ask.

### G1. One mouseover line, not a cross

**Confirmed.** `chartdoc-to-echarts.js:1066` sets `axisPointer.type: 'cross'`,
with a comment arguing for it ("on a Lee panel the y value *is* the answer").
The author has now ruled the other way. Each panel already declares which axis it
is interrogated on (`grid[i].tooltip.axisPointer.axis`, from `panel.read_axis`),
so `type: 'line'` draws exactly one line and the per-panel axis picks which.
One property, and the comment above it is rewritten rather than left contradicting
the code.

Effort **L**.

### The residue of `dev/graphs.md`, audited

The author raised this after the plan was drafted: the a30 graph notes carried
points that never landed. `dev/graphs.md` is deleted in the working tree (it is
still in `HEAD`, recoverable with `git show HEAD:dev/graphs.md`) on the strength
of `plan-plot-ir-api.md` saying its content had moved into that plan's item 7.
Checked, one item at a time:

| graphs.md | claim | actually |
|---|---|---|
| 1. zoom rescales y | open | **open**, and not on the Round 5 list. Added below as G4 |
| 2. double-click resets | done a63 | **done**, verified: `zr.on('dblclick')` in `wireGestures`, and `ready` is set true after the first render so the guard passes |
| 3. the odd tick | done a62 | **not done.** Added below as G5 |
| 4. uPlot readout | done a63 | **not done.** This is G2 |
| 5. horizontal readout | done a37 | done, and the mechanism survived the a62 rewrite as `panel.read_axis` |
| fonts and the TeX ruling | moved | moved, into `plan-plot-ir-api.md` item 8 and `dev/TODO.md` |

So two of the six were recorded done and are not, which is the same habit as the
one named at the top of this plan, on a second list.

**What the author liked, unprompted, recorded in that file and easy to break.**
Drag left and right to pan, scroll to zoom, and **select by legend**. The first
two come free from `dataZoom: {type: 'inside'}` and are not touched here. The
third is a live constraint on G2 and is called out there.

### G2. The readout belongs in the legend

**Confirmed as not done.** a63 built `writeReadout` and a `.chart-readout` strip,
and appended it **after** the canvas, while `legend.show` is still true whenever
there is more than one series. So the reader has an ECharts legend above and a
values strip below, where the ask was one thing that does both, uPlot style.

**Fix**: turn off the built in legend, move the readout strip above the canvas,
and give it the legend's job as well as its own. It already renders swatch, name
and value per series, so the work is: seed it with every series at idle (name and
swatch, blank value) rather than the "Point at the chart" placeholder, and fill
the values on hover.

**Select by legend has to survive, and that is a correction to the first draft
of this plan.** `dev/graphs.md` records it as one of three things the author
liked unprompted at a30, so dropping it to save an afternoon would be trading a
liked behavior for a chore. Our own strip keeps it: a click on an entry
dispatches `{type: 'legendToggleSelect', name}` and the entry dims, which is what
the built in legend was doing and costs perhaps ten lines.

The alternative considered and rejected: keep the ECharts legend and write values
into it through `legend.formatter`. It preserves the selection behavior for free,
but it needs a `setOption` on every pointer move, which is a redraw per mouse
pixel for a string change.

Effort **M**.

### G3. The annotations

Three findings, and they separate cleanly.

**The toggle is gone, literally.** `CONTROLS` in `mount.js:78` is log, full
range, return period, invert, plus the panel kinds. The `reference lines` button
that `dev/plan-plot-ir-api.md` 7.6 still refers to did not survive the a62
rewrite, and nothing replaced it. Restoring it is a fifth entry in `CONTROLS`
plus dropping `series[0].markLine` when it is off. It cannot come off the
document's `readings`, since marks are data rather than a declared reading, so it
is an app control that is offered when `doc.marks` is non-empty.

**Some of the marks are genuinely missing, and that is upstream.** The live `agg`
chart document publishes four marks: on the density panel `mean` and `1-in-200`;
on the Lee panel `1-in-100` and `1-in-250`, both faint. So the density panel, the
one the author is looking at, carries no 1-in-100 at all. Ask upstream for the
density panel to carry the same anchor ladder the Lee panel does.

**The label placement is wrong on both counts asked about.** `markLineEntry`
picks the side by index parity, so which mark goes left is an accident of
document order, and there is no rotation at all, where the item says the labels
are vertical. The requested rule states cleanly: labels rotate 90 degrees, the
**rightmost** mark on a panel takes the right side and every other takes the
left, and all sit flush with the top of the plot. That gives mean left, 1-in-100
left, the capital anchor right, which is the item, and it survives a fifth mark
being added upstream where parity does not.

The "200 year ends up above the plot" symptom is most likely the shared
`label.distance: 3` pushing an `insideEndTop` label out past the grid, and
rotation will change which axis that distance acts on. This one has to be looked
at in a browser rather than reasoned to a conclusion; budget a round trip.

Effort **M**.

### G4. Zooming rescales the y axis, which is disorienting

Off `dev/graphs.md` item 1, still open, carried into `plan-plot-ir-api.md` 7.1
and never acted on. `dataZoom.filterMode` is `'filter'`
(`chartdoc-to-echarts.js:1029`), which drops out-of-window points from the extent
calculation so y refits what is visible. That is deliberate: without it, zooming
into a tail leaves a flat line pinned near zero.

**Settled by the author, 2026-08-10: `filterMode` does not move.** "I'll put up
with y axis moving. You need that, else with a big mass at 0 you never see the
detail when you zoom outside 0." So the rescale is a feature and the item is
about the *motion*, not the rescale.

That leaves one lever: `animationDurationUpdate: 0`. ECharts tweens the axis
change, so the curve appears to breathe while the wheel turns; snapping it makes
the same rescale read as a step. If that does not settle it the item closes as
accepted behavior rather than escalating to `'none'`.

Effort **L**.

### G5. The odd tick on the left scale

Off `dev/graphs.md` item 3, recorded as done at a62 and not done. That note asked
for the reading to be confirmed before anything was changed, offered two, and the
a62 work took the first without confirming: end labels, fixed with
`showMinLabel: false` and `showMaxLabel: false`. Those are applied, on every value
axis, x and y (`axisOption`, `chartdoc-to-echarts.js:472`). `axisTick.show` is
already `false` in `axisStyle`, so there are no tick *marks* at all and this can
only ever have been about labels.

**The candidate the code supports, and it survives the a62 fix by construction.**
`axisOption` sets **both** `min` and `max` from the panel's window whenever the
document supplies one. Pinning both ends of a value axis defeats ECharts' nice
number algorithm: the interval becomes `(max - min) / splitNumber` over an exact,
unround span, so the interior labels come out as things like 3,463.93 and
6,927.86. Hiding the two end labels leaves the three ugly ones in the middle,
which is exactly the shape of "still there after it was fixed".

**The author's rule, given 2026-08-10, and it is better than either reading on
the original note.** The question is not "end label or general thinning". It is
**is the end value on the lattice of the other ticks**:

> ticks 0, .25, .5, .75, 1 is good. 0.03132, .25, .5, .75, 1 is not. I can gauge
> it is about 0 in the latter case and generally learn nothing by knowing what it
> is exactly.

So a distortion drawn on [0, 1] must keep its 0 and its 1, and a zoomed density
must lose its 3,463.93. Today's unconditional `showMinLabel: false` /
`showMaxLabel: false` gets the second case right and the first case wrong, which
is why the item both did and did not get fixed at a62.

**Fix, and it subsumes the odd interior ticks as well.** Stop pinning the axis to
the raw window and then hiding the consequences. Round the window **outward to a
nice step**, set `min`, `max` and `interval` from that step, and then show every
label including the ends, because by construction they are all on the lattice.
One helper in `axisOption`, with two cases to get right: a log axis wants decades
rather than a linear step, and a return period axis is already drawn on its own
mapping.

The cost is that the plotted range widens slightly to the next round number,
which is what matplotlib does by default and what makes its axes readable. Show
the author a before and after on a density and a distortion before calling it.

**A second half, found on screen 2026-08-10 and measured rather than guessed.**
The author, looking at a copula bivariate's joint density: "the y axis has way
more ticks than the x, that's what we don't want". Counted off that picture, on
one panel:

| axis | labels | length | one label per |
|---|--:|--:|--:|
| x (Wind) | 13 | ~610 px | 47 px |
| y (Flood) | 26 | ~370 px | 14 px |

Four times the density on the shorter axis, in the same picture. The cause is
not the value-axis pinning above; it is a different axis type. A grid panel
draws as a heatmap, which ECharts requires **category** axes for, so
`realizeGrid` hands both axes the full array of cell centers as `data`, with
`hideOverlap: true` and no `interval` (`chartdoc-to-echarts.js:878-885`). A
category axis then defaults to `interval: 'auto'`, meaning "as many labels as
fit without colliding". A label is about 35 px wide and 12 px tall, so
horizontally 13 fit and vertically 26 do. ECharts did exactly as it was told.

"As many as fit" is a legibility rule, not a reading rule, and this is what it
costs: the two axes of one picture get different lattices, and neither lattice
is round, because the labels land on cell centers (300, 1,900, 3,500 stepping by
1,600 against 60, 860, 1,660 stepping by 800).

So G5 is one disease on two axis types, and the cure is one sentence on both:
**put the labels on a round lattice, and put a comparable number on each axis
whatever its length.** On a value axis that is the outward rounding above. On a
category axis, keep `type: 'category'` (the heatmap needs it) and choose which
categories carry a label: pick a round step in data units and label the cell
nearest each multiple, targeting roughly six to eight per axis.

The author's reading the same day, on the xy panels: the ticks "are at least
nice round numbers now, which is better". So the value-axis half is in better
shape than the note implies and the grid panel is the loud remaining case.
Confirm both on screen before closing it.

Effort **M**, up from L: the rule is more work than hiding two labels, and it
now covers two axis types.

## Upstream asks, raise these first

Four, small, and two of them gate work here. Raising them on day one lets them
land while the client phases run.

**Written up for the library agent** in
`T:\worktrees\aggregate_REFACTOR\dev\note-from-aggregate-api-round-5.md`, with
the diagnosis, the suggested signature and the open rulings for each. What
follows is the summary.

1. **`build_exhibit(..., spec_extra=)`**, merged into each block's `TableSpec`
   kwargs, and accepting a callable so `include_raw=list(df.columns)` can be
   computed per block. Six lines at `exhibits/_core.py:462`. Gates item 21(a),
   and with it full precision and perspective on every exhibit leaf. Without it
   the api would have to reimplement `build_exhibit` including the private
   `_title_name` and fork the hash contract, which is not worth it.
2. **Round the P&L consideration** in `_pnl_consideration` (item 19), with the
   docstring's exact-loss-ratio promise softened in the same edit.
3. **`PnL.value_type`** returning `'payoff'` (item 17), so the app reports a
   convention rather than inferring one.
4. **The capital anchor ladder on the density panel** of the `agg` chart, so
   1-in-100 is drawn where the reader is looking (G3).

## Phases

Five, one version bump and one commit each, a64 to a68. Ordered so the deepest
correctness fix goes first, the four cheap re-raised items go second while the
upstream asks are in flight, and the two design-carrying items go last.

### a64: a preference change fetches again

Items 15 (client half), 23 (client half), 20, and the menu reorder. Client only,
no server change, no library change.

The fix has to cover both halves of the staleness, because either alone leaves it
broken. `setTableView` and `setPerspective` learn to distinguish a change that
needs new bytes (`precise` in or out, perspective) from one that does not
(static against interactive, which genuinely renders from the document in hand).
A change that needs bytes clears `state.rendered` for every group and calls
`loadActiveTab()`; the other keeps today's cheap redraw. Clearing every group
rather than the active one is deliberate: the panes you are not looking at are
also holding documents at the old setting, and they must reload when you next
reach them.

Then the menu order in `index.html`, Static, Static full precision, Interactive.
Then `mountGrid` clears the two `.csvgrid-export-formatted` checkboxes.

**Acceptance, in a browser, not in the abstract.** Build a portfolio. Sit on
Overview / Summary and flip Static to Static, full precision: the digits change
under the cursor without a rebuild. Flip back. Walk to More / Stats and do it
again. Then flip Interactive and confirm the flip costs no fetch (network panel:
no request). Then copy a cell out of a grid and confirm the clipboard holds
`17319.661747551625` and not `17,319.66`.

### a65: the strip and the action row tell the truth

Items 7, 14, 17, 19. Four small independent edits, the cheapest phase and the one
that clears four re-raised complaints.

Item 7 is one line and one comment. Item 14 is a CSS move and dropping a word.
Item 17 stops suppressing `'loss'` and prints whatever the object says, with the
P&L case left blank pending upstream ask 3. Item 19 lands upstream (ask 2) and
this phase only re-syncs and verifies; if the author would rather not touch the
library this week, say so and it moves to a later phase rather than being faked
locally.

**Acceptance.** Build an aggregate with occurrence reinsurance, open the GCN
caret, pick Gross / Net, and confirm the menu closes and the page lands on
Overview. Read the strip on any build and find `loss` between `log2` and `mean`.
Read the m/n label and confirm it matches the Ctrl+Enter hints in size, face and
color. Press PnL and read the premium in the editor.

### a66: the exhibits become tables like any other

Item 21, both halves, plus the exhibit-route half of items 15 and 23. Blocked on
upstream ask 1.

With `spec_extra` in hand: the exhibit route grows a `precision` parameter, the
api passes `include_raw`, `max_rows` and, at full precision, the same
`formatters={}` plus `FULL_PRECISION_FLOAT` pair that `frame_spec` uses; and
`api.exhibit` sends the precision alongside the perspective. That makes all five
exhibit leaves renderable in the interactive view and responsive to both
preferences, which is one change closing three complaints.

Then item 21(b), the cosmetics: a `FORMATS` entry for `tail_behavior` so `min`
and `max` agree on their digits, an explicit alignment for the object-dtype
numeric columns of `bs_window_df`, and a decision on what an infinite `max`
should print (it is currently an em dash, indistinguishable from missing).

`more:window` stays on the frame route, deliberately, and the comment says why:
the frame route carries the two diagnostic columns (`W`, `coverage`) that the
public `bs_window_df` drops, and it carries formats the exhibit does not.

**Acceptance.** Flip to Interactive and walk Economics Ledger, Ratios,
Waterfall, More Tail behavior and More Dependency: five grids, no "Table
renderer unavailable". Build a P&L and flip Insurer to Raw on the Ledger and on
Ratios and watch them move; confirm Waterfall does not, and say so in the
changelog so the first reader is not hunting a bug. `uv run pytest`, plus
`dev/scripts/check-exhibits.py`.

### a67: the charts read as one instrument

G1 to G5. All in `chartdoc-to-echarts.js` and `mount.js`, and all needing eyes on
a real chart rather than a reasoned option diff. This is the phase where the
author should expect to be shown a screenshot and asked a question.

Order within the phase: G1 first, since it is one property and it changes what
everything else is looked at against; then G4's one line experiment
(`animationDurationUpdate: 0`), because it is free and it changes how the zoom
reads while the rest is being judged; then G2, which removes the built in legend
and gives the strip both jobs, selection included; then G3, the annotations
control and the label rule; G5 last, since it wants the author to point at the
label they mean.

**Acceptance.** One aggregate, Overview / Plot. Exactly one tracking line per
panel, on the axis that panel is read by. One legend, above the canvas, carrying
the values as the cursor moves, still toggling its series on a click, and nothing
floating over the curve. A reference lines button that turns all of them off and
on. Labels vertical, mean and 1-in-100 to the left of their lines, the capital
anchor to the right, every one of them inside the plot and flush with its top.
Scroll to zoom and drag to pan both still work, because `dev/graphs.md` records
that the author likes them and nothing here should cost them.

### a68: Quick Re on one line

Items 11 and 10. Last because it carries the two open rulings and because it is
the only item here that is new design rather than a correction.

Item 10 first within the phase, because fixing the completion payload (`text` and
`detail`, and `_label` splitting instead of stripping) is what makes the box
worth putting on the new row. Then the row itself.

**Acceptance.** Cede from the row with amounts, then with percentages, then one
of each, on both bases, and confirm each produces a clause the grammar accepts
and a program that rebuilds. Tab in the cession box completes rather than leaving
it. Every control on the row is the same height and the row is centered.

## Execution log

* **a64**, landed 2026-08-10. Items 15 and 23 (client half), 20, menu order.
* **a65**, landed 2026-08-10. Items 7, 14, 17, plus the GCN pair's moments,
  which was not on the list and was found by the acceptance walk.
* **a67 landed as a66**, out of order, 2026-08-10. G1 to G5. Taken before the
  exhibits phase because that one waits on upstream ask 1 and this waited on
  nothing. **G2 turned out to be a non-working feature rather than a misplaced
  one**: `tooltip.showContent: false` returns before the formatter is read, so
  a63's readout never displayed a value. G4 closed with no change.
* **The exhibits phase is next**, and keeps the number it is given at the time.
  Blocked until `build_exhibit(spec_extra=)` lands in the library.

## Rulings, settled 2026-08-09

Both were open when this plan was drafted, both are inside item 11, and both are
now answered. Nothing else in this plan is waiting on a decision.

**A. The third box is a detachment, in both readings.** The sketch labeled it
`detach` while the sentence under it said "limit 95%", and today's code splits
the difference: a percentage is read as a detachment probability and a bare
number as a layer width, so one field means two things depending on how it was
typed. Settled the clean way. The box always names a point on the loss axis,
`99%` is `q(.99)` and `1000` is 1000, and `composeCession` computes
`limit = detach - attach` either way. One line, and the field means one thing.

**B. No stepper arrows; the boxes keep `50%` and `500`.** `<input type="number">`
refuses a `%` character outright, so `step="0.01"` and the dual reading cannot
share a box. Shown that, the author dropped the arrows and kept the dual
reading: "Want to keep ability to input 50% or 500. Manual is fine." So the four
fields stay `type="text"`, and the row loses nothing else from the sketch.

## What is actually the author's to decide

Most of this plan is mechanical: something is broken, the cause is known, the fix
is one shape. These are the places where it genuinely is not, collected here
because they are otherwise scattered across four phases. None blocks starting;
each is asked at the head of its own phase.

**a64, item 20.** The Formatted values checkbox exists twice, on Copy and on
Save. The plan clears both, on the argument that a Copy that differs from a Save
is a surprise. Say if Save should keep its formatting. ==> Correct decision; copy and save should both work with unformatted outout.

**a65, item 17.** Until `PnL.value_type` lands upstream, a P&L prints nothing in
the sign slot. The alternative is for the app to print `payoff` on its own
authority, which it can defend (the Economics captions say so) but which is the
app deciding something the library owns. The plan prints nothing. ==> Print payoff, PnLs are ALWAYS payoff (that's implied by the name profit (positive) and loss (negative) statement.

**a65, item 19.** Six significant figures on the P&L premium. That is a guess at
"sensible"; 7,037.88 rather than 7,037.883281186453. A different convention is
fine, it is one constant. ==> fine.

**a66, item 21(b).** An unbounded `max` on the tail behavior frame currently
prints as an em dash, which is also what a missing value prints as, so "this
distribution has no upper bound" and "we do not know" look identical. Options:
leave it, print `inf`, or print a word. This is a reading question rather than a
formatting one, which is why it is here. ==> print inf

**a66, item 23.** The scope call, and the biggest one in the round. Making
Perspective mean something on an Aggregate needs Overview Summary, Tail and
Validation, More Stats and the four Reinsurance leaves re-pointed from the frame
routes to the exhibit route: the `[Exhibits-App-Cleanup]` item. The plan defers
it to its own phase after this round, because it is a substitution across nine
leaves and it wants a66's `include_raw` fix underneath it first. Folding it into
a66 instead is defensible if the demo needs the switch to visibly work on an
aggregate. ==> library defines scope, you just move from calling for perspective =Raw exhibit to perspective= insurer. If there is no insurer, fall back to Raw. It should be one line of code, a variable like active_perspective changes value, that variable is passed into all get_exhibit calls. Make sense?

**a67, G3.** Whether 1-in-250 joins the mean, 1-in-100 and 1-in-200 on the
density panel, or whether three marks is already the clutter limit. A judgment
about the picture, and it decides part of upstream ask 4. ==> JUST 1-200, sorry, I couldn't remember what we decided on 200 vs 250.

**a67, G4.** If `animationDurationUpdate: 0` does not settle the zoom
disorientation, the next lever is `filterMode: 'none'`, under which the y axis
never moves and zooming into a tail shows a flat line near zero. That is a real
trade between two discomforts and it is the author's to make, at the chart, not
in advance. ==> i'll put up with y axis moving. you need that else with a big mass at 0 you never see the detail when you zoom outside 0.

**a67, G5.** Which label is the odd one. A screenshot with it circled settles it;
two previous attempts guessed and one of them shipped. ==> I see now this is tricky cos sometimes we want to see the range (distortion) and somtimes not (zooming). The rule is really: are the max and min in the grid of the other ticks? So if you have ticks 0, .25, .5, .75, 1 then all is good. but 0.03132, .25, .5, .75, 1 is not. &c at the top. You see? I can guage it's about 0 in the latter case and generally learn nothing by knowing what it is exactly.

**a68, item 11.** The row can be present twice, once per basis. Are both rows
always on screen, or is the second added on demand? Always visible is more
honest about what is possible and costs a row of height on the Reinsurance tab. ==> No it is one row only. When you click the add button, it is added to the main text box and you can look at it or adjust it there. The double transfer ATM (first to the local text box and from that to the main box) is unnecessary. That said, we should add a live preview (debounced) in the current help-string small font below the input. Initially: Preview <<default values>>. Then as you type in any of the boxes it updates. That would be nice marketing sugar, dynamically see the limit and attachment. Will involve a round trip to the server to pull in the relevant quantiles.

## Also noticed, folded into the phases rather than raised as items

Two small dishonesties found while diagnosing, both fixed inside a66 with no
separate discussion.

* The pane that cannot render a table says "Table renderer unavailable. The CSV
  download still has the data." On an exhibit-route pane there **is** no CSV
  download: three of those five exhibits have no frame route behind them. The
  message needs to stop offering a way out that does not exist.
* An exhibit block carries its caption inside its table document, so the static
  walker prints it and the interactive grid does not. The captions are the
  library's own prose about what the frame means, and losing them on a view flip
  is losing the thing the exhibit route exists to carry. `loadExhibitLeaf` should
  render the caption itself, from `envelope.meta.captions`, so it survives both
  views.

## Standing rules for every phase

Per `CLAUDE.md`, repeated because five commits is enough to drift.

* One version bump per phase in `pyproject.toml`, one commit carrying source,
  tests, `CHANGELOG.md`, this plan, `dev/TODO.md`, `pyproject.toml` and
  `uv.lock`. One line subject, `[aNN] <terse summary>`; the changelog section is
  the detail.
* `uv sync --extra dev` after each bump, or `/v1/meta` keeps reporting the old
  version out of the editable install's recorded metadata.
* The built SPA under `src/aggregate_api/static/` is gitignored and is never part
  of the commit.
* The author starts and stops servers. Nothing here binds a port: `uv run pytest`
  and the probe scripts drive the app in process through `TestClient`.
* No dashes as punctuation, anywhere, including the commit subject.
* **New this round**: no phase is written up as done until its acceptance
  paragraph has been walked in a browser. Three of this round's items are here
  because that did not happen last time.
