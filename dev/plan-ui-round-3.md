# plan-ui-round-3: the first full pass over the running site

Status: **in progress.** Written 2026-08-07 from the author's punch list, taken
after the first end-to-end run of the whole site. That list survives verbatim at
the foot of this file. Reviewed against the code on the same day before any of
it was executed; the five corrections that review turned up are recorded under
"Corrections from the review" below and are folded into the phases.

Roughly forty items. Most are this repo's, a handful belong in `aggregate`, and
two api items cannot start until a library change lands. The companion doc is
`aggregate_REFACTOR/dev/plan-loss-lab-round-3.md`, which opens with the same
table so either side reads without the other.

## The round at a glance

| code | problem and impact | side | effort |
|---|---|---|---|
| `wrap` | derived DecL returns on one line; needs spread layout, and the `hints{}` trailer must ride along or Sharpen stops reproducing | api | M |
| `ledger` | exhibit prose is unbounded inside the table's horizontal scroll box so it runs off screen; exhibits need vertical air between them | api | L |
| `lollipop` | every density draws as steps; the library's own ladder says stem and dot under 40 visible atoms | api | M |
| `parse` | a syntax error renders in the Overview pane while the strip says only "build failed" | api | M |
| `tooltip` | greyed main tabs and sub-tabs explain themselves by different rules, and a main tab collapses to a generic reason | api | L |
| `blue` | five buttons and the emacs switch are Bootstrap blue; the house accent is a custom token Bootstrap never sees | api | L |
| `recap` | the name and kind under the status strip repeat the status strip | api | L |
| `tabsize` | the main tab strip is too tall and its label is the one size off the type scale | api | L |
| `hints` | the history keys are undocumented on the action row | api | L |
| `emacs` | the emacs switch belongs in the hamburger as a checked item, not on the action row | api | L |
| `order` | tab order puts Economics second, and the order is hardcoded in two files with nothing checking they agree | api | L |
| `status` | the strip carries no log2, repeats the kind on line two, and the sharpen note overwrites the timing line | api | M |
| `reflines` | the ref-lines toggle covers the mean and one anchor; it should cover mean, 1-in-100 and 1-in-200 | api | M |
| `label` | the 1-in-200 label sits on top of its own rule | api | L |
| `twin` | the second right-hand axis is redundant against S vs RP, and its width is what re-lays-out the left panel | api | L |
| `ticks` | a padded explicit min and max put a six-significant-digit label at each end of every x axis | api | L |
| `severity` | a severity pdf is a sampled ordinate, not bucket mass, so drawing it as steps is wrong | api | L |
| `cede` | the cession row's label, button text, layout and spacing | api | L |
| `shortcut` | "occurrence net of" is long to type and the box forgets what you last ceded | api | M |
| `rubric` | the reinsurance plot's basis buttons explain themselves only in hover titles | api | L |
| `transpose` | reins stats reads measures down and layers across, wanted the other way, and carries no formats | api | M |
| `replot` | Re to Plot greys out on a reinsured portfolio because the chart is registered for Aggregate only | agg | M |
| `split` | "calibrate on" stacks three visual languages: house-red toggles, Bootstrap grey radios, a blue button | api | L |
| `assets` | `ReinsPriceRequest` takes only `p`, so the assets anchor 422s on a reinsured object | api | L |
| `decimals` | money columns are declared or inferred as integers, so a pricing table shows whole numbers only | api | L |
| `evaluate` | Evaluate offers no gross, net occurrence or net choice | agg then api | M |
| `cession` | nothing prices a cession with a distortion; the library has no glue between reinsurance and distortions | agg | M |
| `params` | an aggregate with no reinsurance gets pentagon rows and no distortion parameter table | api | L |
| `alloc` | reinsuring one unit of a portfolio silently drops every per-unit allocation table | agg then api | M |
| `grey` | the calibration basis row vanishes without reinsurance instead of greying, against house style | api | L |
| `panels` | the bounds envelope returns one panel where the library draws three | api | M |
| `units` | PricingBounds on a portfolio should default to every unit, with the box naming one | api | L |
| `behavior` | the `tail_behavior` exhibit reaches no leaf, and Overview reads it as part of Tail | api | L |
| `window` | x_max and W print unformatted, and nothing says the window is `[x_min, x_max]` of width W | agg and api | L |
| `narrative` | narrative sections come out alphabetical by attribute stem | api | L |
| `sharpen` | `sharpen_df` is shown nowhere, so the grid audit is invisible | api | M |
| `caption` | passthrough exhibits return no kwargs, so raw frames arrive with no caption at all | agg | M |
| `writer` | the api re-implements the dependency-ordered `.agg` writer and its order disagrees with the library's | agg | L |
| `kinds` | PnL and BivariateAggregate carry old semantics under the new `summary_df` / `tail_df` names and have no `tail_df` | agg | M |
| `width` | `format_program(width=)` is accepted and ignored, a documented lie | agg | L |

## Two findings that changed the list

**`replot` is not a missing feature.** The Reinsurance Plot leaf is built and
wired: declared at `web/src/nav.js:108`, loader registered at
`web/src/main.js:515`, implementation at `main.js:1247`. It greys because it is
the only leaf gated on the *chart* registry, and `chart_reins` is registered for
`Aggregate` alone (`aggregate/charts/_emit_reins.py:91`), so a reinsured
Portfolio never sees `'reins'` in `available_charts`. The item is agg-side.

**Punch list items 22 and 23 are one bug.** The twin right-hand axis costs
`RP_AXIS = 52` px (`web/src/charts/exhibits.js:98`) and `panelGeometry`
(`exhibits.js:609`) divides the *remaining* width between the panels. So
toggling right-panel log y changes the left panel's size. Deleting the twin
axis, which item 23 asks for on its own merits, fixes item 22 for free.

## Decisions taken

Taken with the author on 2026-08-07 unless noted.

1. **`recap` keeps a slim line.** Name and kind go, since they duplicate the
   status strip. The tag chips and the note paragraph stay as one quiet line
   above the tab strip.
2. **Basis-dependent pricing goes agg first.** `evaluate` and `alloc` wait for
   the library's basis keyword rather than growing the api's `_BasisView` shim.
   They are phase 5 and block on the agg plan's phase A.
3. **Reason strings stay client-side.** `nav.js` already declares a `why` per
   leaf and there is no server-side reason mechanism. `tooltip` fixes the two
   code paths in the SPA; it does not become a `Capability` field.
4. **`transpose` is filed as presentation, so api-side.** If the reshape turns
   out to need stage or view knowledge it moves to the agg plan.

## Corrections from the review

Five findings from reading the plan against the code before executing it. Each
changes what gets built, so they are recorded here rather than folded in
silently.

1. **`behavior` was misdiagnosed, twice over.** `tail_behavior_df` is not
   leaf-less: Overview / Tail asks for it as a second block (`main.js:505-506`,
   rendered at `:931-935`, promised by the sub-tab hint at `nav.js:53`). It has
   never rendered, because that leaf takes the **frame** route and
   `tail_behavior_df` is absent from `_CSV_FRAMES` (`objects.py:1473-1491`), so
   the fetch 404s and `loadOverviewFrames` swallows it at `.catch(() => null)`.
   The **exhibit** route serves it today with no backend change at all:
   `available_exhibits` answers `tail_behavior` and
   `GET /objects/{id}/exhibit/tail_behavior` returns 200 with the title
   "Tail behavior: NAME". Pairing it with `tail_df` was also wrong on the
   merits, which is the author's point: `tail_df` is the return-period ladder
   read off the grid, and `tail_behavior_df` is the analytic classification of
   the frequency, severity and aggregate tails, sub or super exponential,
   bounded, concentrated. Two different questions. So: a real More leaf gated
   on the `tail_behavior` exhibit and drawn by `loadExhibitLeaf`, the second
   block comes out of Overview / Tail, and the hint there is corrected to speak
   only of return periods.
2. **`wrap` needs no cache-key change.** `post_object` runs `collapse_program`
   at `objects.py:504`, *before* `canonicalize_decl` at `:527`, so a spread
   program already hashes to its collapsed twin's id on the build path. The one
   place that needs care is `post_sharpen:1759`, which must keep hashing the
   collapsed text while returning the spread text; `post_pnl` and `post_reins`
   hand their text to `post_object`, which collapses it anyway. Touching
   `canonicalize_decl` would be a wider change buying nothing.
3. **`reflines` was under-specified against its own goal.** `anchorMarks(tail)`
   is computed at `exhibits.js:701`, **outside** the `view.refLines` guard, so
   the tail panel's anchors ignore the toggle today. Replacing 250 with 200 on
   its own does not make the toggle govern both panels. What lands: mean,
   1-in-100 and 1-in-200 on both panels, all three under the toggle, with the
   alternating label alignment `label` asks for. `REF_ANCHOR` goes away, since
   `ANCHORS` then serves both.
4. **`transpose` is two reshapes, not one.** The two kinds carry different
   frames. An Aggregate's `reins_stats_df` is `(component, measure)` rows by
   `(view, layer)` columns, component being `meta / freq / sev / agg`; a
   Portfolio's is `(view, measure)` rows by unit columns. Note also that
   `reins_summary_df` **already** reads units down and measures across, so a
   plain transpose of the moments would largely duplicate it. What
   `reins_stats_df` uniquely holds is the per-layer column and the meta terms.
   Decided with the author: two blocks. Layer terms first (rows are the layers,
   columns `share, limit, attach, pr_attach, pr_detach, pr_loss, lol`), then
   the moments (rows are the layers, columns `freq / sev / agg` spanning
   `mean, cv, skew`). A Portfolio takes the same shape with view by unit down
   the rows.
5. **Phase 5 cannot start.** The companion agg plan is still "not started", so
   `evaluate`, `alloc`, `cession` and `replot` stay where they are and this
   round lands at `1.0.0a52`.

## Phase 1: shell and status

`blue`, `recap`, `tabsize`, `hints`, `emacs`, `order`, `status`, `parse`,
`tooltip`. Almost all SPA, with one backend field.

* **`blue`.** `web/src/styles/site.css:58-59` defines `--house: #a81313` and
  `--primary: var(--house)`, but neither is a Bootstrap token, so
  `.btn-primary` stays Bootstrap blue at `index.html:222` (Cede), `:265`
  (Price), `:274` (Evaluate), `:302` (Compute), `:335` (Load it), and so does
  the emacs `.form-switch`. One rule mapping `--bs-primary` and the `.btn`
  background and border tokens onto `--house` fixes all six. The comment at
  `site.css:47-48` claiming Bootstrap blue is gone becomes true.
* **`recap`.** `renderOverviewHeader` (`main.js:977-991`) drops its
  `.overview-ident` block at `:981-983`; the `.overview-tag` chips (`:984-986`)
  and `.overview-note` (`:989`) stay, on one line. Trim `site.css:532-547` to
  match, including the 1.45rem `.overview-name` rule that no longer has a
  subject.
* **`tabsize`.** `site.css:270-274`: `padding: .42rem` to about `.34rem`, and
  the bare `font-size: 1rem` onto the `--fs-*` scale (`site.css:20-24`). It is
  the only label on the page off the scale. Keep the 2px overhang arithmetic at
  `:276-280` consistent with whatever padding lands.
* **`hints`.** `index.html:135` becomes two rows, split by kind: row one
  `Ctrl+Enter build · Ctrl+Space complete`, row two
  `Ctrl+↑↓ history · Alt+1…6 groups`. `.fb-right` is `d-none d-sm-flex`
  (`site.css:186-189`), so it needs to become a column at sm and up. Ctrl+K and
  Ctrl+Shift+↑↓ stay in the help panel only (`index.html:343-346`); the hint
  line is a reminder, not a mirror of the key table.
* **`emacs`.** Move it into the hamburger as a checked `dropdown-item` under an
  `Editor` header, copying the `table-view-item` pair at `index.html:47-52` and
  its CSS at `site.css:644-652` (the reserved `bi-check2` column, the `<small>`
  gloss pushed right, `.active` with Bootstrap's background killed). Not a
  `form-switch` in a menu: a form control inside a `dropdown-menu` closes it on
  click unless `data-bs-auto-close="outside"`, and a check-style item that
  toggles and closes is the behavior Tables already has. `main.js:128-130`
  rewrites to read the item's state; the backing store at `editor.js:38-44` and
  `setEmacs` at `:232-237` are unchanged.
* **`order`.** To Overview, Reinsurance, Pricing, Economics, Bounds, More. That
  is the demo flow: gross, add reinsurance, think about pricing, then evaluate.
  Bounds is orthogonal and sits late. The order lives twice, in `index.html:181-188`
  and in the `NAV_GROUPS` key order at `nav.js:35-187`, and `Alt+1…6` indexes the
  latter (`main.js:754-763`). Change both, then extend
  `dev/scripts/check-nav.mjs` to parse `index.html` and assert the two agree, so
  this cannot drift again.
* **`status`.** Line one becomes name, kind, `bs`, `log2`, mean, cv, validation,
  each separated by the existing `·` from `sep()` (`main.js:340`); note the kind
  currently joins with a bare `ms-2` margin (`main.js:359`) and should take a
  separator like everything else. Line two becomes `Calculated in 0.000 seconds`
  with no kind word, since the kind now sits above (`renderTiming`,
  `main.js:410-418`, and drop `KIND_WORD` at `:330-333`). The sharpen message
  and a failing validation description need their own slot between the two:
  today `noteDerivation` (`main.js:257-261`) writes the sharpen text into the
  timing line, where the next `renderTiming` clobbers it.
  **Backend:** `log2` is on `ObjectManifest` (`models.py:297`) but not on
  `BuildResponse` (`models.py:109-144`), so add it there and populate it in
  `_summary_fields` (`objects.py:297-362`) beside `bs`.
* **`parse`.** `renderBuildFailure` (`main.js:420-439`) writes the literal
  `'build failed'` into `#summary-inner` and throws the real message away, then
  renders the rich report into `#pane-overview` at `:433-437`, below the tab
  strip. Put the report's one-line substance into the strip: line and column
  plus the message, from the `ErrorReport` dict the server already sends
  (`objects.py:583-590`, fields at `parser_errors.py:210-220`). Keep the full
  caret pane where it is. While in `error-pane.js`, its header comment
  (`:1-19`) documents a shape that no longer exists (`kind`, `expected_labels`);
  correct it. Note 422 is not a parse-error signal on its own, the client sniffs
  `detail.line` (`error-pane.js:70`), which stays.
* **`tooltip`.** Both paths already set `data-why`, so nothing is missing
  outright; they differ in three ways. Main tabs (`main.js:667-689`) add
  `.disabled` and no `aria-label`, and derive the reason with `whyGroup`
  (`nav.js:218-226`), which falls back to the generic
  `'not available for this object'` unless every leaf agrees. Sub-tabs
  (`main.js:596-603`) set a per-leaf reason and an `aria-label`. Make the two
  consistent: per-leaf specificity where it exists, `aria-label` on both. Then
  confirm the Severity case live before changing anything else; its reasons are
  declared at `nav.js:46` and `:51` and should already render, so if they do not
  the cause is layering or the `.tab-pane fade` transition, not a missing
  branch. The phone override at `site.css:353-358` sets `overflow-x: auto` on
  the strip, which clips the tooltip; the desktop rule at `:257-267` keeps
  `overflow: visible` deliberately.

Version bump `1.0.0a49`.

## Phase 2: charts

`lollipop`, `reflines`, `label`, `twin`, `ticks`, `severity`. All in
`web/src/charts/`.

* **`lollipop`.** Mirror the library's stated ladder rather than inventing one.
  `aggregate/charts/ir.py:88-102` states it renderer-agnostically and
  `aggregate/plots/_chartdoc.py:41,46,67-104` implements it with
  `LOLLIPOP_ATOMS = 40` and `STEP_PIXELS = 3.0`: a cumulative axis is always a
  step, whatever the count, because a cdf takes a value everywhere; a mass axis
  with 40 or fewer *visible* atoms is a stem with a dot; otherwise steps-mid;
  and under three pixels per atom a plain line, since steps and a line are the
  same picture at that size. The count is of atoms in view, not in the frame, so
  a zoomed window is judged on what it shows. The tombstone at
  `exhibits.js:136-146` argues against the old count-of-nonzero-points guess and
  is right; this replaces it with the library's rule rather than restoring the
  guess. `densitySeries` (`exhibits.js:423-446`) grows the branch;
  `theme.js:32-37` registers `LineChart` and `HeatmapChart` only, so the stem
  needs its series type imported there or it will not render at all. Note the
  author's list says 32, the library says 40; take 40 and stay in step with
  upstream.
* **`reflines`.** The toggle (`exhibits.js:199-202`) should govern mean,
  1-in-100 and 1-in-200 across both panels. Today `ANCHORS = [100, 250]`
  (`exhibits.js:64`) drives the right panel and `REF_ANCHOR = 200`
  (`:69`) puts one line on the left, and the mean goes to both
  (`:706-707`). Replace 250 with 200, so the pair is `q(0.99)` and `q(0.995)`;
  200 is on the library's default ladder (`_aggregate.py:79`) so the row is
  there to read. Two further changes the goal needs and the first draft of this
  item missed: `anchorMarks(tail)` is evaluated at `:701` **outside** the
  `view.refLines` guard, so it moves inside it, and the density panel takes the
  same pair rather than the single `REF_ANCHOR`, which then has no user and
  goes.
* **`label`.** `anchorMarks` alternates `align` per anchor at
  `exhibits.js:535`, so the pair opens away from each other; the 1-in-200 line
  needs the same treatment on the left panel, where `refLine`
  (`exhibits.js:564-576`) currently gives every entry `insideEndTop` with a
  fixed 3px distance. Put the label to the right of its rule as 1-in-100 already
  does.
* **`twin`.** Delete the twin axis at `exhibits.js:827-840` and the `RP_AXIS`
  allowance at `:98` and `:611`. S against return period is the point of the
  toggle; showing both is what the toggle exists to avoid. Removing it also
  removes the geometry change that re-lays-out the left panel, since
  `twoPanelBox` (`:948-954`) passes `view.rightLogY` into `panelGeometry` purely
  to reserve that width.
* **`ticks`.** The x axes take explicit `min` and `max` (`exhibits.js:791-792`,
  `:860-861`) from `densityWindow`, which pads by two percent (`:374-375`), so
  the endpoints are arbitrary reals; ECharts always draws a tick at an explicit
  min and max, and `fmt()` renders it at six significant figures
  (`utils/format.js:33-36`). Suppress the endpoint labels rather than rounding
  the window, so the window itself is unchanged. `scale: true` at `:790` and
  `:859` is inert once min and max are set, and `splitNumber` and `boundaryGap`
  appear nowhere in the tree today.
* **`severity`.** `sevPanelArgs` (`exhibits.js:1023-1037`) feeds `pdf` through
  the shared `densitySeries`, which sets `step: 'middle'` unconditionally at
  `:434`. A severity pdf is a density ordinate sampled on a grid, not the mass
  in a bucket, so the module's own justification for steps does not hold for
  this kind. `densitySeries` needs a style argument; there is no per-kind hook
  today.

Version bump `1.0.0a50`.

## Phase 3: text and tables

`wrap`, `ledger`, `decimals`, `transpose`, `narrative`, the api half of
`window`, `behavior`, `sharpen`.

* **`wrap`.** Three derivations produce a program and all three collapse it:
  `post_sharpen` (`objects.py:1750`), `post_pnl` (`:1809`), `post_reins`
  (`:1855`), all through `collapse_program` (`:442-473`). Render with
  `format_program(text, layout='spread', trailer=True)` from
  `aggregate.decl_writer`, which the repo already imports in two places
  (`objects.py:861`, `routes/decl.py:38-42`).
  **`trailer=True` is not optional.** The default is `False` and silently drops
  `note{}`, `tags{}` and `hints{}` (`decl_writer.py:1258-1272`), and Sharpen's
  whole contract is that `hints{}` rides on the returned text. The same default
  is a live bug in the session download, where `objects.py:887` strips the
  trailer `spec_to_decl` emitted ten lines earlier at `:877`. Fix both.
  **Cache key.** No change needed, contrary to this plan's first draft.
  `post_object` collapses at `objects.py:504` before `canonicalize_decl` runs at
  `:527`, so a spread program already hashes to its collapsed twin's id on the
  build path, and Reset, history and sharing keep working on pretty text for
  free. The one place to be careful is `post_sharpen`, which computes
  `new_oid` itself at `:1759`: it re-files the entry, so it must keep hashing
  the **collapsed** text while returning the spread text. `post_pnl` and
  `post_reins` hand their text to `post_object` and need nothing.
* **`ledger`.** The ledger's descriptive text comes from the library inside the
  table document (`objects.py:2026-2065`) and is drawn by the walker inside
  `.gt-host`, whose only rule is `overflow-x: auto` (`site.css:636`). Because
  that is a horizontal scroll container, long caption text stretches the scroll
  width and runs off screen. Cap the walker's caption element at `--measure`
  (`site.css:86`), as `.exhibit-lede` and `.exhibit-caption` already are at
  `:663-668`. The table itself keeps scrolling. Separately, `loadExhibitLeaf`
  (`main.js:1117-1136`) mounts blocks back to back with no spacing; add vertical
  air between exhibits when there is more than one, and check the caption's
  weight reads as a caption rather than as bold body.
* **`decimals`.** Two dials, both server-side. `tables.FORMATS`
  (`tables.py:132-145`) declares `P` as `,d` for `"price"` and all five money
  columns as `,d` for `"reins_price"`, and every column it does not name falls
  to greater-tables inference, which returns zero digits once the column mean is
  at or above 20000 (`greatest-tables/.../engine/formats.py:114-121`). So `a`,
  `L`, `M` and `Q` on a real book are integers by inference and `P` by
  declaration. Widen the declarations and add the money columns the map does not
  name. Also note the generic frame route passes no formats at all
  (`objects.py:1604`), so `summary`, `tail_df`, `stats_df`, `validation_df` and
  every reins frame are pure inference.
* **`transpose`.** `reins_stats_df` arrives with measures down the rows and
  layers across the columns (`objects.py:1489`), and it is two different frames
  behind one name: an Aggregate's is `(component, measure)` by `(view, layer)`,
  a Portfolio's is `(view, measure)` by unit. Both reshape to two blocks, per
  correction 4. **Layer terms** first, rows the layers, columns `share, limit,
  attach, pr_attach, pr_detach, pr_loss, lol`, which is the layering analysis
  and the part `reins_summary_df` does not carry. **Moments** below it, rows the
  layers again, columns `freq / sev / agg` spanning `mean, cv, skew`; the raw
  moments stay dropped, as `_drop_raw_moments` already does. Give both a
  `tables.FORMATS` entry, which the frame has none of today: the layer terms are
  money, a share, and three probabilities, which are three different formats
  sitting in one block.
* **`narrative`.** `capability.py:369` returns `[sections[name] for name in
  sorted(sections)]`, so the order is alphabetical by attribute stem. Replace
  with an explicit order: info, bs, validation, tail, reins, sharpen, with
  anything unlisted appended alphabetically so a new library stem still appears.
* **`window`, api half.** `frame_document(df, which)` at `objects.py:1604`
  passes no `formats`, so `tables.FORMATS` is never consulted for
  `bs_window_df`. Add an entry and pass `formats=which`. Then say what the
  exhibit shows: the window is `[x_min, x_max]` of width `W = x_max - x_min`.
  The prose half, where `:g` produces the ugly number, is the agg plan's phase D.
* **`behavior`.** Add a More leaf for the `tail_behavior` exhibit, which the
  library already registers and the api already serves: `available_exhibits`
  answers it for anything carrying the frame, `_aggregate.py:953` and
  `_portfolio.py:1130`, and the route returns it with the title
  "Tail behavior: NAME". So the leaf is `exhibit: 'tail_behavior'` in `nav.js`
  and `loadExhibitLeaf('pane-more', 'tail_behavior')` in `main.js`, with no
  backend change. It reports the family, support minimum and maximum, left and
  right tail class, bounded, concentrated and cv, which is the analytic
  classification and a different question from `tail_df`'s return-period ladder.
  At the same time Overview / Tail stops asking for `tail_behavior_df` through
  the frame route (`main.js:505-506`), loses the block at `:931-935` that has
  never drawn, and its hint at `nav.js:53` stops promising "how each tail
  behaves". Add the leaf to `EXPECTED` in `check-nav.mjs`.
* **`sharpen`.** Show `sharpen_df` when it exists, which is after `sharpen()`
  has run and `None` before (`_aggregate.py:814`, `_portfolio.py:1041`). Lead
  with `sharpen_df.score.unstack('d_log2')`, the library's own documented
  picture (`_bucket_window.py:1835`): rows are `d_bs`, columns are `d_log2`,
  cells are the score, lower is better, ragged rows come out `NaN`. Then the
  full frame below as detail, including the `selected` flag that marks the
  winner.

Version bump `1.0.0a51`.

## Phase 4: reinsurance and pricing forms

`cede`, `shortcut`, `rubric`, `split`, `assets`, `params`, `grey`, `units`,
`panels`.

* **`cede`.** The row at `index.html:217-225` becomes
  `Adjust cession [box] [Add reinsurance]` with the small description below it
  rather than trailing the button, and more vertical space beneath. The label is
  currently the bare lowercase `cession` (`:218`) and the button says `Cede`
  (`:222`). The hint span at `:223-224` carries a hardcoded `.7rem`; move it to
  `--fs-meta`. Layout CSS at `site.css:451-461`. Note `renderReinsEntry`
  (`main.js:1287-1291`) hides the row rather than greying it when a cession is
  impossible, which is the same house-style problem as `grey`.
* **`shortcut`.** Keep it simple: prefill buttons or a datalist that drop
  `occurrence net of ` or `aggregate net of ` into the box, and remember the
  last cession across a reload so it can be iterated. Insertion still goes
  through `obj.reins_program` (`objects.py:1851`), never string splicing: an
  occurrence cession sits before the frequency clause and an aggregate cession
  after it (`aggregate/decl.lark:81-85`), so concatenation is wrong even when it
  looks right. There are no abbreviations in the grammar, `occ` and `agg` are
  not accepted in this position (`decl.lark:347-353`), which is exactly why the
  typing is long.
* **`rubric`.** `renderTools` (`exhibits.js:1428-1454`) builds the basis and
  show groups and appends nothing after them; the explanation exists only as
  native `title` tooltips sourced from `REINS_VIEWS` (`:1301`, `:1307`, `:1314`).
  Put a crisp line under the buttons. Include the subtlety documented at
  `:1293-1296` and currently invisible: the third triple's first column is
  `subject`, not gross, because calling it gross would understate the cession.
* **`split`.** `renderPriceBasis` (`main.js:1417-1437`) draws house-red
  `.exhibit-toggle` buttons directly above Bootstrap grey `.btn-check` radios
  and a blue Price button, three visual languages stacked. Make "calibrate on" a
  divided button group like `derive` (`index.html:124-132`, label CSS
  `site.css:184-185`), with grey for active as the p and assets pair already
  does. `blue` in phase 1 has already dealt with the third.
* **`assets`.** `ReinsPriceRequest` (`models.py:516-531`) requires `p` and has
  no `a`, so choosing the assets anchor on a reinsured object posts `a` and gets
  a 422, while `PriceRequest` (`models.py:415-434`) takes either. No library
  work is needed: `prob_loss_assets(a=...)` returns a mutually consistent
  `(p, L, a)` on both kinds (`_grid_distribution.py:574`, exposed at
  `_aggregate.py:6212` and `_portfolio.py:3617`). Add `a` to the model, enforce
  exactly one anchor as `PriceRequest` does, and convert. The model's docstring
  claim of "same shape as PriceRequest" becomes true again.
* **`params`.** An Aggregate with no reinsurance returns pentagon rows and
  `distortion_df=None` (`pricing.py:191`) with an early return at `:203-204`,
  while the Portfolio path calls `calibrate_distortions` at `:215-227`. The
  method exists on Aggregate too (`_aggregate.py:6251`), so call it and return
  the same table. That closes the first of the four cases in the author's
  pricing-consistency list.
* **`grey`.** `renderPriceBasis` returns early at `main.js:1420-1421` when
  `state.hasReins` is false, emptying the row. Render the buttons disabled
  instead; `.exhibit-toggle:disabled` styling already exists at
  `site.css:622-626`. While there: `PRICE_BASES` (`main.js:1400-1404`) always
  offers all three, but a Portfolio's `reins_density_df` has no `p_agg_net_occ`
  (`_portfolio.py:1622-1640`), so picking Net occ raises at `pricing.py:399-402`
  and 400s. The response already carries `bases` (`models.py:547`) and the SPA
  ignores it; grey what the object does not offer, with a reason.
* **`units`.** `PricingBounds` on a Portfolio should default to every unit.
  `Portfolio.pricing_bounds(y_sources, ...)` (`_portfolio.py:517`) takes a
  source, a list or a dict, so when `against` is empty
  (`models.py:214-231`, resolved at `objects.py:1883-1922`) pass
  `obj.unit_names`; a name in the box then narrows to that unit. Note the SPA
  sends exactly one `against` despite the list type (`main.js:1626-1629`).
* **`panels`.** Diagnose before changing. `run_envelope` passes
  `distortions=DISTORTION_OVERLAY` with `DISTORTION_OVERLAY = "space"`
  (`bounds.py:53`, call at `:133-134`), which is not the library's `'ordered'`
  default. `plot_envelope` (`aggregate/bounds.py:476`) builds a one by three
  grid, and panels two and three need a Portfolio carrying calibrated
  distortions or they raise, which is exactly why `"space"` was chosen. Find out
  whether the figure genuinely comes back with one axes or whether all three are
  drawn and two are empty. If the library cannot fill them for the objects the
  app builds, the item moves to the agg plan.

Version bump `1.0.0a52`.

## Phase 5: blocked on the agg plan

**Deferred.** The agg plan is still "not started", so this phase did not run in
this round and nothing here is built. Phases 1 to 4 landed at `1.0.0a49` through
`1.0.0a52`.

Do not start until the agg plan's phase A has landed and `uv sync --extra dev`
has re-recorded the editable install. Until then `/v1/meta` reports the old
`aggregate_version` and the work will look broken for the wrong reason.

* **`evaluate`.** Offer gross, net occurrence and net, matching the Determine
  form. `run_evaluate` calls `obj.evaluate(premium)` (`pricing.py:605`), which
  reads the object's own density, so there is no basis parameter anywhere on the
  path. Once the library takes a basis keyword, pass it and drop the
  `_BasisView` shim (`pricing.py:267-321`) rather than extending it here.
* **`alloc`.** `run_reins_price` never calls `analyze_distortions` and has no
  `distortions` field in its response (`models.py:534-560`), so reinsuring one
  unit of a Portfolio routes to that path (`_has_reinsurance` recurses into
  units at `objects.py:292-293`, the SPA branches at `main.js:1503-1506`) and
  silently loses every per-unit table. Add allocations for all three bases once
  the keyword exists. Surface, rather than swallow, the `UserWarning`
  `analyze_distortions` raises when it skips a mass distortion on an unbounded
  book (`_portfolio.py:3770-3776`); the runner already captures warnings at
  `pricing.py:229-233`.
* **`cession`, consumer side.** Show total occurrence and aggregate cessions
  priced with the calibrated distortions on the Determine leaf, once the library
  method exists.
* **`replot`, consumer side.** Nothing to build if the agg registration lands
  cleanly, beyond confirming the leaf lights up for a reinsured Portfolio and
  that `check-nav.mjs` expectations still hold.

Version bump `1.0.0a53`.

## Verification

Per phase, not at the end.

* `uv run pytest` after every phase. Backend phases are 1, 3, 4 and 5.
* `node dev/scripts/check-nav.mjs` after phase 1, once it also parses
  `index.html`. Refresh `dev/fixtures/capability.json` with
  `dev/scripts/capture-capability.py` first.
* `.\scripts\build-web.ps1`, then `uv run aggregate-api --port 8001`, and walk
  the six groups against this list. The chart and form items are only provable
  by eye. Use an aggregate with and without a cession and a portfolio with and
  without, which are the four cases the author photographed.
* After the agg plan lands anything: `uv sync --extra dev` here, then check
  `/v1/meta` reports the new `aggregate_version`.
* `curl /v1/health` after each bump, since `version` comes from
  `importlib.metadata` and reports what the editable install recorded, not what
  `pyproject.toml` says now.

## Also found, not on the list

Worth a line each while the surrounding code is open.

* `BuildResponse.warnings` is set to `[]` at `objects.py:543`, `:701` and
  `:1682` and never populated. Either fill it or drop it.
* `error-pane.js:1-19` documents `kind` and `expected_labels`, neither of which
  the server sends; `:104` survives on a fallback.
* Raw hexes that should be tokens: `#b6bdc4` (`site.css:326`), `#d4a017`
  (`:671`), `#fff7e6` (`:642`), the rate-limit card at `:464-472`, and `#6c757d`
  repeated eleven times across `exhibits.js` and `theme.js`.
* Hardcoded font sizes off the scale: `index.html:223`, `:275`, `:336`.

## Author's original notes

Kept verbatim, including the four screenshots, as the record of what was seen on
the first full run.

### Throughout

1. when the decl is changed it must be reprinted in format-program form with line breaks and indents. atm it comes back in one lone line.
2. any text output (eg descriptions of exhibits such as ledger) should fit within the screen size. ATM ledger is a very wide table, ok, that has to scroll, but the text needn't flow off screen. put it in a suitable container. Standard font, look bold? More v space between exhibits when more than one.
3. All plots - we had a long discussion about using steps-mid but that we'd move to lollipops with fewer than 32 points plotted. that does not appear to happen. Not a biggie, but an inconsistency vs what you said.
4. Syntax error on build: the error comes back at the bottom of the page. It should appear in the status box, same as "build failed". Take the content of the parse error output and put in the status.
5. There should be tooltips on greyed options explaining why they are grey. These are missing on Severity tabs but appear with scary sign on the summary and tail subtabs. Tab and subtab treatment should be consistent.
6. Blue "go" button??
7. Remove the repeat [Object name] [object type] display below the status line. That is duplication and not needed. (said again: Main page: text box, buttons, status bar, then there is a title that recaps the name and type of the object. This row is redundant and should be deleted. After the status box we go to the tab strip.)
8. Main tabs (Overview ... Main) should be slightly less tall. About 80% of what they are currently.

### Specific

* Hints below the main text box:  add Ctrl UP/DOWN arrow history hint below Ctrl + Enter (we'll end up with two rows of hints there; i think that' ok. split is by kind rather than by frequency: Ctrl+Enter build · Ctrl+Space complete \n Ctrl+↑↓ history · Alt+1…6 groups
* At the same time move the emacs keys under the hamburger. Make it a checked dropdown-item under an Editor header, exactly like the Static / Interactive pair.
* Main tab order: Overview | Reinsurance | Pricing | Economics | Bounds | More; that goes with the demo-flow, which goes gross, add re, then think about pricing, then evaluate, so that's the order. Bounds is a bit orthogonal.
* status bar should add log2 after bs value with \cdot separator as current. Second line: just "calculated in 0.000 seconds" No need for type name, that is in previous row. So for example using . for cdot: "**ObName** type . bs = . log2 = . mean . cv . validation\n<<sharpen message if appropriate>><<validation_description if fail>>\nCalculated in xx seconds."

#### Overview->Plot:
* ref lines button should control all ref lines; mean, 100 and 200 year quantiles (ie q(.99), q(0.995).
* label for 1-in-200 is like 1 in 100 (within plot figure) but to the right of its vertical line so they do not overlap
* log y on rh plot triggers reshape/draw of left plot; left plot should not move/change
* right plot: get rid of second rhs y axis - that's the point of S vs RP. we don't need to show both; that triggers some of the redraw problems.
* all plots: when you scale do NOT bother putting a label on the lowest / highest x axis value - this comes through with more decimals and looks silly. presumably this is an echarts setting.
* Severity plot should be continuous not steps-mid.

#### Reinsurance tab
* Cede input box and button text and layout should be: "Adjust cession [input box initially blank ] [Add reinsurance]\n small text description of what do to". Add more v space below that input box.
* can we have an easy way to insert occurrence net of  or aggregate net of... they are long to type! If that has been applied it stays in the box when the page reloads so you can iterate it. And or the auto complete we have in the top box? KISS though.
* Plot tab: need rubric under buttons that explains cripsly what they are doing. Occurrence means show the occurrence (size of loss) distributions; after occurrence shows gcn after occ re, etc.
* Stats table is not tidy/suitable for GT: should transpose measure and unit: should be rows gross x unit; cols = measure = mean, cv, skew. Currently do not get good formats.
* TODO: Re->Plot  is **missing** (just recognize absence atm)

#### Pricing tab
* Calibrate on: use nicer split buttons like we have for derive further up (divided buttons); active is just grey color like we use for P/assets on the next line.
* the Price form offers an assets anchor, but ReinsPriceRequest (models.py:525) only accepts p, so choosing assets on a reinsured object posts a and gets a 422. The non-reins price path takes both. Solution: agg-side you can figure p from a.
* Main pricing table needs more dp. looking at an example where everything appears as an integer. No good!
* evaluate should offer same options to evaluate gross, net occ or net given input premium
* determine Should also use the distortions to compute the total occurrence and aggregate cessions.
* pricing behavior is not consistent (see images below)
    * ❌ agg but no reins -> just one row pentagon results but no params ==> add table of distortion params
    * ✅ agg with reins -> table of pentagon results and of distortion params
    * ==> add table of distortion params
    * ✅ port w no reins -> table of pentagon results, table of distortion params, tables of allocations
    * ❌ port with reins -> table of pentagon results (calibration target and others), table of calibrated distortions, but no allocations. Add allocations for net/net)
* bottons "calibrate to gross|...| disappear if there is not re. House style - things never disappear. They are greyed out if not relevant. Pls do that.

agg no re
![](C:/Users/steve/.writedown/img/14eniz42mqq.png){width=50%}

agg w re
![](C:/Users/steve/.writedown/img/c2asv87jee.png){width=50%}

port no re
![](C:/Users/steve/.writedown/img/16ayh3x5v43.png){width=50%}

port w re
![](C:/Users/steve/.writedown/img/1ctkufc7y0p.png){width=50%}

#### Bounds tab
* Bounds plot only has one panel, not all three.
* PricingBounds with a Portfolio -> default to computing bounds by each unit. In "against" box enter a unit name for just that unit.

#### More tab
* add tab for tail_behavior_df (vs. tail risk)
* window: not using float format for x_max and W? narrative needs to say what exhibit shows. Window is [x_min, x_max] of width W=x_max-x_min
* narrative: order as info, bs, validation, tail, reins, sharpen
* add option to display the sharpen_df, if it exists. Transpose it so that log2 -> columns and rows are bs (more rows than columns) and show just the score; below that show the whole table as FYI with all the details.
