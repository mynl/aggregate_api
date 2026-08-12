aLL-AGG design
================


Punchups Round 7: 2026-08-12
------------------------------

The author's list, and what landed at a93. Nine of the ten are app side and are
done; item 12 is the library's and is recorded as an upstream ask rather than
patched here.

1. Right align text in boxes when it is a number, even if %.
2. Quick Re text boxes narrower (keyed for percents); and for all numbers in
   boxes, incl percents, reads `[100%] part of, from [50%] attach to [90%]
   detach` (vs. `part of ... attach, ... detach` ATM).
3. Ctrl+Shift+V if available: toggle raw and insurer perspectives.
4. Add `Raw | Insurer ·` before version info in top right next to hamburger, to
   show the active perspective.
5. Chart legends that report numbers: use fixed width format for numbers so the
   legend labels do not flicker about.
7. Charts 2d: need a way to adjust y axis? and when we go to log, get rid of any
   capping (eg for severity or masses); whole point of log is you have room to
   see everything.
10. Axis labels: make sure they have at least 1dp else you get 1e-2 1e-2 etc.
11. Reins is still using `so` rather than `po`. `so` has been taken out. Occurs
    in Quick Re when you try to add.
12. Reins tab: occ plot does not seem connected to the option buttons.
13. Initial page load is not smooth. Rather than the hero idea, let's just show
    the dice of dice example.

### Disposition, a93

| # | where | what landed |
|---|---|---|
| 1 | `site.css` | `text-align: right` on `.qr-field`, `.price-field input` and the two Bounds amounts. `#bounds-against` stays left: it holds a unit name or a DecL fragment. |
| 2 | `index.html`, `site.css` | The two operator words become `part of, from` and `attach to`. Boxes 5.4rem to 3.9rem, cut for the four characters of `100%`; phone 4.8 to 4.2rem, where the face is 16px. |
| 3 | `main.js` | `Ctrl+Shift+V`, capture phase, next to the `Ctrl+Shift+U` table switch. **Yields inside an editable**: V is the browser's paste-as-plain-text and means something in the program box and the form fields, so the shortcut works everywhere else, which is where the reader is when they want it. |
| 4 | `index.html`, `site.css` | `Raw \| Insurer ·` left of the versions, active word lit. Carries `data-perspective`, so the existing click wiring and tick sync drive it and it is a control as well as a readout. |
| 5 | `site.css` | Tabular figures on the readout head, mono on each value, `min-width` on both. Measured across two hover positions: every chip holds its width and x to the pixel. |
| 7 | `chartdoc-to-echarts.js` | Two changes. `axisWindow` falls back to the drawn data's extent where the document declares no `full_range`, so one button releases **full x and full y**. And an axis drawn on **log** releases its window on the way there: the agg ordinate stops at the aggregate peak (`_emit_aggregate.ordinate_top`), which cuts the head off a severity block standing three times higher. The stylistic call, made per the author's "do you manage": one button, both axes, and log implies it. |
| 10 | `chartdoc-to-echarts.js` | `expLabel` keeps its decimal place, `1.0e-4` not `1e-4`. The heatmap colorbar had the real duplicate: it printed `1e${Math.round(v)}` over a log height, so 10^-8.2 and 10^-8.0 both read `1e-8`; it now raises the height and prints the value. |
| 11 | `main.js` | `composeCession` emits `po` in both readings, and the **percentage literal** for a share: `50% po 5000 xs 2500`. `0.5 po` would parse as an amount and give a 0.01% placement. Verified end to end. |
| 12 | **upstream** | Not an app bug. `charts/_emit_reins.py` gives the occurrence panel a `claim` axis with no log reading and a `sev_density` axis that is log with no alternative, so `log` can never act on it; `return period` and `invert` are the aggregate panel's axes alone. And on an **unlimited** program `_claim_window` returns `None`, whereupon `full_range` is written `None if claim is None`, so `full range` has nothing to act on either, though the full extent `(min(0, x[0]), x[-1])` is knowable whether or not a limit bounds the window. Ask: give `claim` `scales=('linear', 'log')`, and give it a `full_range` independent of whether the suggested window exists. |
| 13 | `main.js` | The landing is a fixed `LANDING_DECL`, dice of dice, in the editor from the first paint; the random hero fetch, its retry and `pickRandom` are gone. The `/v1/examples/heroes` route and `api.heroes` stay for the showcase that is to return inside the Examples dropdown. |

Items 6, 8 and 9 were not in the author's list.


Punchups Round 6:2026-08-11
------------------------------

1.


Menus
--------

| Item \ FFC      | Dist | Sev |     Agg      | Port | Biv |    PnL     |
| :-------------- | :--: | :-- | :----------: | :--: | :-: | :--------: |
| **Overview**    |  y   | y   |      y       |  y   |  y  |     y      |
| O.Plot          |  y   | y   |      y       |  y   |  y  |     y      |
| O.Summary       |  y   | n/a |      y       |  y   |  y  |     y      |
| O.Tail          | n/a  | n/a |      y       |  y   | n/a |    n/a     |
| O.Validation    |  y   | n/a |      y       |  y   |  y  |     y      |
|                 |      |     |              |      |     |            |
| **Reinsurance** | n/a  | n/a |      y       | n/a  | n/a |    n/a     |
| R.Plot          | n/a  | n/a | cession only | n/a  | n/a |    n/a     |
| R.Summary       | n/a  | n/a | cession only | n/a  | n/a |    n/a     |
| R.Stats         | n/a  | n/a | cession only | n/a  | n/a |    n/a     |
| R.Density       | n/a  | n/a | cession only | n/a  | n/a |    n/a     |
|                 |      |     |              |      |     |            |
| **Pricing**     | n/a  | n/a |      y       |  y   | n/a |     y      |
| P.Determine     | n/a  | n/a |      y       |  y   | n/a |    n/a     |
| ...Gross/NetOcc/Net |      |     |              |      |     |            |
| P.Evaluate      | n/a  | n/a |      y       |  y   | n/a |     y      |

(Pricing rows above describe the shipped two-leaf pane. The pane becomes
three leaves, Calibrate, Allocate, Evaluate, with the same kind coverage
except Evaluate keeps PnL; see `dev/plan-pricing-exhibits.md`, 2026-08-12.)
|                 |      |     |              |      |     |            |
| **Economics**   | n/a  | n/a |     n/a      | n/a  | n/a |     y      |
| E.Ledger        | n/a  | n/a |     n/a      | n/a  | n/a |     y      |
| E.Ratios        | n/a  | n/a |     n/a      | n/a  | n/a |     y      |
| E.Waterfall     | n/a  | n/a |     n/a      | n/a  | n/a | tower only |
|                 |      |     |              |      |     |            |
| **Bounds**      | n/a  | n/a |      y       |  y   | n/a |    n/a     |
| B.Bounds        | n/a  | n/a |      y       |  y   | n/a |    n/a     |
| B.Pricing       | n/a  | n/a |      y       |  y   | n/a |    n/a     |
| B.Allocation    | n/a  | n/a |     n/a      |  y   | n/a |    n/a     |
|                 |      |     |              |      |     |            |
| **More**        |  y   | y   |      y       |  y   |  y  |     y      |
| M.Stats         |  y   | n/a |      y       |  y   |  y  |     y      |
| M.Tail Behavior |      |     |              |      |     |            |
| M.Window        | n/a  | n/a |      y       |  y   |  y  |    n/a     |
| M.Dependency    | n/a  | n/a |     n/a      | n/a  |  y  |    n/a     |
| M.Sharpen       |      |     |              |      |     |            |
| M.Narrative     |  y   | y   |      y       |  y   |  y  |     y      |
| M.Density       |  y   | y   |      y       |  y   |  y  |     y      |


Punchups Round 5: 2026-08-09
------------------------------

Starting with items (1-18 that should have been fixed in Round 4, but which are not fixed).

19. On PnL round premium to a sensible number (eg i'm getting 17.500000000000018 premium is obvs silly).

20. Is it possible to set the csv-grid default to be copy, **unformatted** values? if so, do that. Otherwise, I'll work with that agent to change the default.
21. What is going on with More->tail-behavior? Where is the glitch? Ditto window?

23. We should have hamburger -> perspective and a choice of Raw or Insurer perspectives, matching the output from exhibit manager. For most exhibits that will be the same, but we'll have agg implement a few that are not the same. **CAN YOU REMEMBER WHICH ONES ARE DIFFERENT?**

OLD ITEMS

7. In place of reset button add a split dropdown called GCN, default GrossCeded that has the GrossCeded, GrossNet, and NetCeded options: applies only if there is re, it pre-pends grossceded etc to the program (and re-indents ... is that a new route back to server to format-program?). Otherwise inactive. Label button GCN. **ISSUE**: Once you drop down GCN button it won't close up again.

10. Reins adjust cession box: can we have a ctrl space or something be auto complete - atm you naturally tab which moves you out of the box.

11. Add reinsurance text box should clear out when you load a new decl; possibly it should load what you have? Option for "easy add" 49% percentile xs 50% percentile occ/agg (eg for agg: limit = ob.q(.99) - ob.q(.5) and attach ob.q(0.5) -> as soon as i write this, obvs those numbers should be inputs. Try to make it be uncluttered. Could we have all these re options in a drop down? [ Quick edit... revealable area] **ISSUE:**: this is a mess. Let's get rid of the quick Re line as current. Replace with

Quick Re [Occ | Agg] [100%] po [50% or 100] attach [99% or 1000] detach [Add re](?)

as one line. Make sure it is all center aligned and all controls are the same height. [Occ | Agg] is like [LR|COC] switch on Pricing. You can add one occ line and one agg line. Keep existing small text, but combine both paras into one line, and add "Edit more complex structures directly in the program edit box." and make the whole thing appear as a tool tip when you click/over over the (?) at the end. No quick edit drop down. Writes directly into the main text box. Control boxes have the little arrows (like LR boxes etc) stepping up down by 0.01. Share default 100%, attach 50% limit 95%.

14. Ctrl up/down arrow very handy. issue: same program entered twice looks like nothing has happened. Visual feedback: below input box have [DecL: m/n] label where n is the number of programs entered this session and m is which one you are looking at. Go back say to 3/4 and enter the new one becomes 5/5. OK? COMMENT on that idea! To the right of the new GCN button. **ISSUE:** The text is way too big; let's make it a much more discrete "[n/m]"  in the same font as the Ctrl+Enter for build etc. but located above and to the right of the text input box, or if possible, ideally it would be just below the x for clearing the input box. Is that possible / easy?

15. Can we see more digits in tables / see exact values? That should be easy in non-interactive mode, right? Hamburger -> static full prec extra option. **ISSUE:** this does not work at all. Menu should show two statics and then Interactve (change order) **THIS IS NOT WORKING**

17. Status bar should report if using loss/payoff sign convention, add between log2 and mean. **ISSUE**: not seeing this.




In addition: graphical items that seem to have gotten lost.

1. Either a vertical mouseover line or horizontal (distirbution functions). That part seems to work - but then get rid  of the other line.
2. The mouse over legend should appear in the legend uPlot-style - rather than floating around with the pointer. You'd told me that was possible.
3. We've lost the Annotations option (mean, 1/100, 1/200 or 250) mostly. Remember the labels are vertical (like the mean one) mean and 1/100 to left of its line, 200 yr to right (so they don't overlap) and they are all aligned up to the top of the plot. ATM, when it appears the 200 year tends to be above the plot. (That could be that when it is to the right there is a rotation going on that changes up / down?)





Punchups Round 4: 2026-08-08
------------------------------

1. Using on iPad i see it would be better to have a tad more v space between the tabs and PLOT|SUMMARY|TAIL sub-tabs. Just a smidge more. Make it symmetrical above and below.
2. More -> Narrative triggers a copy button at the right of the sub-tab menu - remove it.
3. Bivariate, status line (under Build...) needs to say **Name** Bivariate bs=(,) . log2=(,) .  mean (, ) . cv (, ) . validation info ("not unreasonable")\nCalculated in...
4. there is still an inconsistency Between the tabs and the sub tabs in how it is reported when you mouse over an option that is grayed out, the tabs seem to do nothing. The sub tabs pulsed a fairly ugly hover over box with a message. I'd like to have a toned down hover over explanation that applies to both the tabs and the sub tabs. there is no need to change the mouse cursor to the panic sign.
5. We should have hamburger -> perspective and a choice of Raw or Insurer perspectives, matching the output from exhibit manager. For most exhibits that will be the same, but we'll have agg implement a few that are not the same.
6. I think the Reset button is irrelevant - we just use the up/down arrows to go back. Delete it.
7. In place of reset button add a split dropdown called GCN, default GrossCeded that has the GrossCeded, GrossNet, and NetCeded options: applies only if there is re, it pre-pends grossceded etc to the program (and re-indents ... is that a new route back to server to format-program?). Otherwise inactive. Label button GCN.
8. Before the sharpen button, add a reformat button that reformats the input decl to format_program standard.
9. Status line for subjects with reinsurance where the underlying subject comes out as not unreasonable should still be colored green.
10. Reins adjust cession box: can we have a ctrl space or something be auto complete - atm you naturally tab which moves you out of the box.
11. Add reinsurance text box should clear out when you load a new decl; possibly it should load what you have? Option for "easy add" 49% percentile xs 50% percentile occ/agg (eg for agg: limit = ob.q(.99) - ob.q(.5) and attach ob.q(0.5) -> as soon as i write this, obvs those numbers should be inputs. Try to make it be uncluttered. Could we have all these re options in a drop down? [ Quick edit... revealable area]
12. Move Validation after Tail in Overview. It is too important to be hidden in More.
13. Reins sub tab order: Plot | Summary | Stats | Density (parallel Overview)
14. Ctrl up/down arrow very handy. issue: same program entered twice looks like nothing has happened. Visual feedback: below input box have [DecL: m/n] label where n is the number of programs entered this session and m is which one you are looking at. Go back say to 3/4 and enter the new one becomes 5/5. OK? COMMENT on that idea! To the right of the new GCN button.
15. Can we see more digits in tables / see exact values? That should be easy in non-interactive mode, right? Hamburger -> static full prec extra option.
16. status bar should pick up warnings (like   agg A dfreq[1] sev 10 - lognorm 1.5 splice[0 11] emits a warning, or defective dist warnings).
17. Status bar should report if using loss/payoff sign convention, add between log2 and mean.
18. Drop "cached" from first row; irrel and comes up in the second row on timing.

### Round 4 triage, 2026-08-09

One row per item above, same numbering. Effort is L (an hour or so, usually one
or two files), M (half a day, or it touches the response schema, or it needs a
decision first), H (a real piece of work with consequences past its own
control). Line references are as of a53.

Corrected 2026-08-09 after the author pushed back on 7, 5 and 3, and was right
on all three. What is left that is genuinely bigger than it looks is 11 (real
scope, and worth it) and 16 (needs a mechanism decision). The rest are as
harmless as they seem, and eight of them are one line or close to it.

| # | key | effort | analysis: problem, then solution |
|---|---|:--:|---|
| 1 | tab / sub-tab gap | L | `site.css:372` gives the sub-tab row `padding-top: .5rem; margin-bottom: .55rem`, so it is already near symmetric and simply tight; `.out-tabs` adds none of its own. Take both to `.7rem`. One declaration, no markup. |
| 2 | Narrative copy button | L | Not a Narrative special case. `renderSubTabs` (`main.js:703`) appends a `copy` button whenever the active leaf declares `copy: true`, and two leaves do: `more:narrative` and `more:validation` (`nav.js:170, 231`). Drop the flag from narrative. Decide about validation's at the same time, since the same button appears there, and item 12 moves that leaf to Overview, so keeping it makes it an Overview affordance. |
| 3 | bivariate status line | M | The values are all there, as the author says. Why the line is empty today: `_headline` (`routes/objects.py:326-374`) coerces with `float(...)` / `int(...)`, and a `BivariateAggregate` carries `bs` as a **two element list** (`bivariate.py:1117, 1748`), so every coercion raises and `_num` swallows it. `log2` is not an attribute but is one expression per axis, `int(round(np.log2(len(self.axis_xs[i]))))`, exactly as `bs_description` already computes it (`bivariate.py:2521`); mean and cv come off `self.units`, which is a list of ordinary `Aggregate` objects. Cheapest shape: an optional `components: list[{name, bs, log2, mean, cv}]` block on `BuildResponse`, leaving the scalar fields alone, so no existing type widens and no test moves; `renderSummary` prints the pair when it is present. **Validation prints `n/a`**, per the author. Worth knowing while doing it: there *is* a minimal validation, the tail **deficit** against a 1e-5 gate (`bivariate.py:2528`), already computed and already in `bs_description`. It is a mass-conservation check rather than a moment check, so it is not a drop-in for the verdict. Raised in `TODO.md` for the library to give the bv a `validation_description` equivalent. |
| 4 | grey hover, both levels | L | The two levels already share one rule (`site.css:414`, `.nav-off[data-why]`), so the styling ask is two edits: tone the tooltip down (currently `--ink` ground, white text, `0 3px 12px rgba(0,0,0,.22)`; drop the shadow, lighten the ground) and delete `cursor: not-allowed` at `site.css:405`, which is the panic sign. Why the **tabs** do nothing is a separate diagnosis, worth confirming before touching CSS: most likely it is not a bug, because a group that is *live* with every leaf dark carries no `data-why` at all (`main.js:789` removes it), and Reinsurance is exactly that group, live through `alsoLive: 'canReins'`. Second candidate, iPad specific: touch has no hover, and the tab's click is `preventDefault`ed in capture (`main.js:805`) so `:hover` never sticks, while the sub-tab buttons do take a sticky hover after a tap. |
| 5 | Perspective in hamburger | L | The author is right that it is essentially one line of plumbing. `GET /exhibit/{name}?perspective=` exists (`routes/objects.py:2236`, default `raw`), `api.exhibit` already sends one (default `insurer`, `api.js:87`), and the capability payload carries `perspectives` per exhibit so the control can grey itself when an object's exhibits offer only one. The rest is the Tables switch copied: a `menu-check-item` pair, a module `_perspective` with localStorage, re-render through the existing `tableViewListeners`. So that expectations match on the day, the leaves that **do** respond are exactly the five on the exhibit route: Economics Ledger, Ratios and Waterfall, plus More Tail behavior and Dependency (`main.js:589-647`). Everything else, including Overview Summary and Tail, all four Reinsurance leaves and More Validation / Stats / Density / Window, goes through `frameIr` / `frameOf` and will not move. That is the known `[Exhibits-App-Cleanup]` item in `TODO.md` and it is not a blocker here. |
| 6 | delete Reset | L | Do it with 7, which takes its place. Removes the button (`index.html:144`), the handler (`main.js:302-318`), one `off()` call in `renderActionRow`, and with them `state.base` and `state.derived`, which have no other consumer. |
| 7 | GCN split dropdown | L | They **are** prefixes, exactly as the author says, and the grammar is explicit: `GROSSCEDED agg_out -> bv_out_grossceded` and its two siblings (`decl.lark:249-251`), where `agg_out` is a full inline agg declaration, not just an `agg.NAME` reference (`decl.lark:72-73`). So this is pure client-side text: prepend the keyword to the editor text and rebuild. No new route, and the re-indent is `api.formatDecl`, which item 8 is already adding, so do 8 first and reuse the call. Grey the button on `!has_reins`, per "otherwise inactive". Two rulings from the author, 2026-08-09, both settled. **Grey, not fail**, which is the house rule the rest of the page keeps: the grammar comment (`decl.lark:244-249`) says these take an agg carrying **occurrence** reinsurance and build the joint per-occurrence aggregate, so aggregate-only reinsurance greys the button with a reason rather than being allowed to fail on submit. Gate on the occurrence cession specifically, not on `has_reins`, which is the weaker test. **Land on Overview.** The result is a `BivariateAggregate`, so `_classify_object` returns `bvagg` (`routes/objects.py:868`) and the nav re-gates, which would otherwise leave the reader on a Reinsurance tab that just went dark. `runDerivation` already carries the mechanism, its `land` parameter, which `pnl` uses for Economics (`main.js:289`). **Deferred, recorded so it is not lost:** the reader should be able to adjust the reinsurance from the GCN view rather than going back to rebuild it. Overview for now. |
| 8 | reformat button | L | Already built on both sides: `POST /v1/decl/format` (`routes/decl.py:66`) and `api.formatDecl` (`api.js:139`), and it is `format_program(decl, fmt="text")` underneath, which is the standard asked for. The item is a button before Sharpen calling `editor.setText((await api.formatDecl(text)).decl)`. One caveat: `_format_decl` catches everything and echoes the input (`routes/decl.py:41`), so a malformed program reformats to itself and the button looks broken. Flash "unchanged" there; `flash()` (`main.js:2045`) already exists. |
| 9 | green under reinsurance | L | Confirmed, one line. Under a cession the library returns `'reinsurance; subject not unreasonable'` (`_validation.py:117`), not the bare phrase. `validationState` (`main.js:423`) tests `s === 'not unreasonable'`, misses, tests for `mean`, misses, falls to `'warn'`, so a clean object turns the strip amber. Strip a leading `reinsurance; subject ` and grade the remainder: principled rather than a second literal, and it also makes `'reinsurance; subject fails agg mean'` grade bad for the right reason instead of by accident. |
| 10 | cession box autocomplete | M | `reins-input` is a plain `<input>` (`main.js:1509`) with no completion machinery; the main box gets it from CM6 plus `api.complete`. A second small CM6 instance is the consistent answer and `editor.js` has the wiring. The real work is **context**: `complete(decl, cursor)` wants a program and an offset, and a bare `250 xs 250` is not a valid prefix of one, so the call must send the enclosing program with the draft spliced in at the cession position and the cursor shifted to match. Budget on that, not on the widget. The Tab complaint is separately one `keydown` handler away. |
| 11 | cession box lifecycle and easy add | M, now the largest item | Two items in one, and the author wants both; the quick-edit panel is the one with real scope and it should demo well. **Lifecycle** is L and partly reverses a51, whose reasoning sits at `main.js:1511-1523` (ceding is iterative, a surviving draft is the point of a draft). Reconcilable on the author's own wording, "when you load a **new** decl": keep the draft across rebuilds of the same program, clear it when the editor's program changes identity, which is `loadExample` and `navigateHistory`. "Load what you have" is a third state and `reins_description` already serves it. **The quick-edit panel** is the M. Separate occurrence and aggregate boxes is the right simplification: each becomes its own clause, so nothing has to parse a combined string, and the two compose into `occurrence net of … aggregate net of …` in the order the grammar wants. Attach and detach as probabilities need `ob.q(p)`, and **there is no quantile endpoint**: `tail_df` carries VaR by return period so `q(.99)` is reachable, but `q(.5)` is not. So this wants a small `GET /objects/{id}/quantiles?p=…` first, which is also the natural home for the round-number snapping the layer will want (a raw `q(.99) - q(.5)` limit prints as `1,234,567.8901`, which is not a layer anyone writes). Order: quantile route, then the panel, with type-in and pick-a-probability as two ways into the same two boxes. |
| 12 | Validation into Overview | L | Move the `validation` leaf from `more` to `overview` in `NAV_GROUPS`, after `tail`, since key order is row order. Add `'overview:validation'` to `LOADERS`, drop `'more:validation'`; the loader body changes only its pane id, `pane-more` to `pane-overview`. No markup change, since `index.html` lists groups and not leaves, so `check-nav.mjs` stays green. Carries `copy: true` with it, which is item 2's other half. |
| 13 | reins sub-tab order | L | Reorder the `leaves` keys in `nav.js` to plot, summary, stats, density. Nothing reads them positionally. One consequence to accept: `activeLeaf` lands on the first *live* leaf, so a reinsured aggregate opens on Plot rather than Summary, which is what "parallel Overview" means. On a reinsured **portfolio** Plot is dark anyway (`chart_reins` is registered for `Aggregate` alone, the `replot` item), so it falls through to Summary there. |
| 14 | DecL m/n label | M | Good idea, and it does not solve the problem you open with, which is worth knowing first. `record` (`history.js:36`) dedups against the most recent entry only, so your scenario works (back to 3 of 4, build, get 5 of 5), but building the *same* program twice in a row leaves both m and n unmoved and still looks like nothing happened. Two wrinkles: history is localStorage and outlives the session, so "this session" needs a session mark or a redefinition to "in your history"; and item 18 removes `cached`, currently the only on-screen sign that a repeat build was a no-op. Recommend all three together: the label, a brief flash on the strip on every adopted build, then 18. |
| 15 | full precision static tables | L | Easier than it looks, and for a specific reason: `TableSpec(include_raw=list(df.columns))` (`tables.py:313`) means the **exact values are already on the wire** in both views. Nothing is lost server side; only the `formatters` dict hides them, and the interactive grid already sorts on the raw numbers (`tables.js:105`). So a hamburger "full precision" item is a query param that skips the `FORMATS` lookup (`tables.py:289`) and lets the engine infer, or passes a wide float format, plus the same `menu-check-item` and re-render pattern the Tables switch uses. Worth checking whether greater-tables 6.0's `table_float_format` house default does it in one knob, which `TODO.md` already flags as unexplored. |
| 16 | warnings in the status bar | M **BIG** | `BuildResponse.warnings` exists and is **always empty**: every construction site passes `[]` (`routes/objects.py:659, 817, 1868`). Nothing is being dropped by accident, the capture was never written. The mechanism needs a decision because the library uses two channels and the larger one is logging, not warnings: `logger.warning` across `_aggregate.py` (9), `underwriter.py` (13), `parser.py` (6) and more, against a handful of `warnings.warn`. Your splice example almost certainly arrives through logging. So capture both: a `logging.Handler` on the `aggregate` logger at WARNING and up, plus `warnings.catch_warnings(record=True)`, for the duration of the build. Both mutate global state and both are safe here for one reason worth putting in the comment: builds are already serialized by `_build_semaphore` (`routes/objects.py:156, 674`), so install inside that lock. Render into the existing `summary-note` slot, already cleared per build, and do **not** move the strip state, since validation owns the color. Note the **defective** half is already there: `Validation.DEFECTIVE` reaches the strip as `pmf deficit` through `validation_description` (`_validation.py:96`), so that one is not missing, it is just quiet. |
| 17 | sign convention in the strip | L | The accessor is public: `value_type` on `Aggregate` (`_aggregate.py:3263-3271`), returning the configured label off the internal `_is_loss_value` role. Read it `getattr`-gated in `_headline` so a kind without it reports `None`, add `value_type` to `BuildResponse`, print it between `log2` and `mean`. **One judgment call:** "report if using loss/payoff" reads either as "say which" or as "say so only when set". Recommend printing only for `payoff`, since loss is the default and stamping it on every build adds noise to the line you have been trimming since a49. |
| 18 | drop `cached` from row one | L | One line, `main.js:404`, `if (res.cached) add('cached')`. `renderTiming` already says "Loaded from cache" on the second line (`main.js:454`), so nothing is lost. Sequence after 14, which wants a replacement signal for the repeat-build case first. |






Punchups Round III
--------------------

### Througout

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

*(2026-08-12: the open items in this list are absorbed by
`dev/plan-pricing-exhibits.md`, the three-subtab redesign, finalized the same
day: item "evaluate should offer same options" is settled as the Evaluate
form's premium-basis group (its decision 10), "determine should also
use the distortions to compute the cessions" is the Allocate exhibit, and
"port with reins, add allocations" falls out of the Portfolio Allocate
blocks. Individual annotations below.)*

* Calibrate on: use nicer split buttons like we have for derive further up (divided buttons); active is just grey color like we use for P/assets on the next line.
* the Price form offers an assets anchor, but ReinsPriceRequest (models.py:525) only accepts p, so choosing assets on a reinsured object posts a and gets a 422. The non-reins price path takes both. Solution: agg-side you can figure p from a.
* Main pricing table needs more dp. looking at an example where everything appears as an integer. No good!
* evaluate should offer same options to evaluate gross, net occ or net given input premium *(settled 2026-08-12, plan-pricing-exhibits decision 10: the Evaluate form gains a `Gross | Net occ | Net` group naming which premium is being input, `reins_view=` underneath; kept narrow, the fuller gross versus net evaluation story overlaps Economics)*
* determine Should also use the distortions to compute the total occurrence and aggregate cessions. *(becomes the `pricing.allocate` exhibit, reinsured Aggregate case: RAW serves every `reins_views` member including the occurrence intermediates)*
* pricing behavior is not consistent (see images below)
    * ❌ agg but no reins -> just one row pentagon results but no params ==> add table of distortion params
    * ✅ agg with reins -> table of pentagon results and of distortion params
    * ==> add table of distortion params
    * ✅ port w no reins -> table of pentagon results, table of distortion params, tables of allocations
    * ❌ port with reins -> table of pentagon results (calibration target and others), table of calibrated distortions, but no allocations. Add allocations for net/net) *(falls out of plan-pricing-exhibits: a Portfolio always calibrates and allocates on its output basis, so the Allocate blocks appear with or without reinsurance)*
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



***
***
***

ORIGINAL INPUT
===============

Design
--------

At top of app (current hamburger with Tables options, picks up a Perspective option = Insurer (default) or Raw

main menu bar (currently Overview | Plot ... | More) becomes as follows, showing the sub-level tabs too (cf. current More which has validation | ...)

* Overview
    * applies to: all objects
    * Plot
    * Summary
    * Tail
* Economics
    * applies to: PNL only
* Reinsurance
    * applies to: an Agg with or without re.
    * reins_summary
    * reins_stats_df
    * reins_density_df
    * plot (placeholder)
    * Includes text box **where you can enter new re on the fly** below the tab buttons. has a separate build button -> take the input agg and append the re. you can do this with a new program agg XX.w.Re agg.OLDNAME <<>>. Has a copy button which moves the resulting program into the main box for further analysis
* Pricing
    * applies to: agg or port
    * top level tabs: Determine | Evaluate
    * Eval only for things with premium
    * Spreadout current calibrate on buttons a little (x margin 1 or so)
* Bounds
    * applies to: agg or port
    * tabs for Bounds, PricingBounds, AllocationBounds
    * Bounds -> plot the envelope plot with 50 samples
    * PBounds -> text box: enter unit from a portfolio or decl for new line Y, show plot of ranges
    * ABounds -> for portfolio only
* More
    * applies to: all objects
    * Validation
    * Stats
    * Density
    * Window (=bs_window_df)
    * Narrative (=all text fields, info and then all available explanations with a nice header)

To be clear: this means that under Overview there are three smaller tab buttons (like currently under more) for Plot, Summary, and Tail. Plot shows the generic object plot via the IR. summary shows summary_df via the exhibit IR envelope, tail the tail_df. Etc.

Notes:

* I don't like the Overview plot and table - it's just klutzy. Separate into two tabs
* Existing plot tab goes - no longer used.
* let's remove the log2 and bs buttons. i have never used them.
* the menu bar must collapse in a phone-friendly manner on a narrow screen. In all cases any options that are not valid just grey out.
* add a Sharpen button that applies ob = ob.sharpen()
* add a PnL button (for aggs only) that converts into a pnl by wrapping appropriately. if there is premium it inherits otherwise it sets up for premium everywhere relevant and adds default at 70% LR and 25% of premium expense ratio. QU: where should this be done? seems it is an api call? let something with access to the grammar handle it!

***

Questions

1. why? i thought we'd set the GT IR up so that you could render to CG (csv-grid) or via JS to a nice static table. Pls check this.
2. yes, i wondered about the x-user interaction - esp playing with the top demos. agree with your process. Server does the refactoring, right?
3. Agree
4. Agree  - and it should somehow report it's results, or  maybe add to More Sharpen is better
5. i hate uI, you seem pretty good at it. just do something that looks OK on a phone. Won't be using it much on a phone myself but others might. must look competent.
6. Sevs are not guaranteed constructible - they must be wrapped in an agg. we should state that somewhere (with rationale) and move on - no support for sevs (that may be a change, but, heck, I'm the boss here!). Dists and bvs are all ok and just flow through. WHat's the issue?
7. i think we have some done, the rest can pend until the library catches up.
8. OK - is it ok with resamples = 5? or just none if it really worries you. just sugar. can you tell how fast a connection you are on and adjust dynamically?
9. OK good qu. It is Pricing because it could either be price (determine) or evaluate. Reins I use internally, but I think spelling it out is better.
