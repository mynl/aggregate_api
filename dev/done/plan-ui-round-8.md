# Plan, UI round 8: where the dividing lines lie

Status: DONE. Ruled 2026-09-26 and executed the same day, `1.0.0a157` (phase 1)
and `1.0.0a158` (phase 2), from `1.0.0a156`.
Four rulings and every divergence are in the "Execution notes" section at the
foot of this file; where the two disagree, the notes are what shipped.
Mockup: `hacks/mockup-11-demarcation.html`, self contained, open it directly.

## The complaint

From the author, reading the running app: the design is good but a new user
will find it confusing, because a lot "floats about". On the Re and Pricing
groups there is a sub-tab row, then a form, then the output, and it is not
clear where the dividing lines lie. Separately, the status strip "gets a bit
busy" and gets glazed over.

The answer is not more rules. The author holds the Tufte line that all ink
earns its keep, and that is the right line here: the fix is mostly spacing,
plus exactly one enclosure that earns itself on function.

## What is actually wrong

Going down a group's content you meet three bands doing three different jobs:

| band | job | how it is drawn today |
|---|---|---|
| `.sub-tabs` | navigate | small caps, muted, no ground |
| `.tab-tools` form row | ask | small buttons, no ground |
| `.pane` | answer | tables and charts, no ground |

`site.css` indents all three (and `.reins-desc`) by `--tabpad`, so they share a
left edge. Alignment is therefore already spent as a grouping cue, and the
spacing does not take it up:

- **Pricing** and **Bounds** are flat. `.sub-tabs` has `margin-bottom: .7rem`
  above the form and `.price-preview` has `margin-bottom: .8rem` below it. A
  ratio of 1.14 to 1 across three bands, which groups nothing.
- **Re** reads better, and by accident: `.reins-preview` carries
  `margin-bottom: 1.4rem`, so its ask and its answer sit about 2 to 1 apart.
  That is the right idea, arrived at on one hint paragraph in one group, and it
  is the thing to promote to a token rather than leave as a local margin nobody
  remembers is load bearing.

The status strip is a separate problem with four causes, listed in phase 2.

---

# Phase 1 [rhythm and the control band], 1.0.0a157

Two moves. Land them together: the second is hard to judge without the first.

## 1a. Rhythm

Three tokens in `web/src/styles/site.css`, beside `--gutter` / `--measure` /
`--tabpad`:

```css
--gap-tight: .3rem;    /* leaf row to the control band it steers   */
--gap-unit:  1.75rem;  /* control band to the output it produced   */
--gap-major: 2rem;     /* the input region to the output region    */
```

Applied:

- `.sub-tabs { margin-bottom: var(--gap-unit); }` replacing `.7rem`.
- `.sub-tabs:has(+ .control-band) { margin-bottom: var(--gap-tight); }`. A leaf
  row followed by a control band is one unit and closes up; a leaf row followed
  straight by output (Overview, More) keeps the full gap so the rhythm does not
  leave a hole where a form would have been. `:has()` is fine on every browser
  this app targets, and degrades to the loose gap, which is today's behavior.
- `.control-band { margin-bottom: var(--gap-unit); }`, and the local
  `margin-bottom` on `.reins-preview` (1.4rem) and `.price-preview` (.8rem)
  comes off, since the band now owns the gap below it.
- `.status-strip { margin-bottom: var(--gap-major); }` replacing
  `calc(var(--gutter) * 1.3)`, which is 1.5rem. This is the gap between the
  input region (editor, action row, strip) and the output region (tabs and
  panes), and it is the only one of the three that is not inside a group.

No markup, no JavaScript, no new ink. This is the whole of move 1 and it is
what to land first and live with, because it touches all six groups at once.

## 1b. The control band

One enclosure, on the form row only. It earns the box on function rather than
decoration: the band holds a button that changes what appears below it, so it
is a self contained ask whose answer is underneath. The page already uses a box
to mean "you provide something here", which is `.editor-box`, so this is the
established idiom rather than a new one.

```css
.control-band {
    background: var(--soft);
    border: 1px solid var(--line-2);
    border-radius: .5rem;
    margin: 0 0 var(--gap-unit) var(--tabpad);
    padding: .55rem .75rem;
}
.control-band .tab-tools { padding-left: 0; margin-bottom: 0; }
.control-band .price-preview,
.control-band .reins-preview { padding-left: 0; margin: .4rem 0 0; }
```

Note the indent is a **margin**, not the `padding-left: var(--tabpad)` the bare
rows carry, so the box's left EDGE lands where the pane's text starts.

**The preview line moves inside the box.** Today `#qr-preview` and
`#bounds-hint` sit outside the row, so the sentence that explains the control
is a free floating grey line in the no man's land between the control and the
output. Inside, it is part of the ask.

Six users, one component:

| group | host | who builds it |
|---|---|---|
| Re | `#reins-entry` | `web/index.html`, static |
| Pricing, Calibrate | `#price-form` | `web/src/pricing-form.js` |
| Pricing, Allocate | `#allocate-form` | `pricing-form.js` |
| Pricing, Evaluate | `#evaluate-form` | `pricing-form.js` |
| Pricing, Pr Ruin | `#ruin-form` | `pricing-form.js` |
| Bounds | `#bounds-form` | `pricing-form.js` |

`pricing-form.js` already builds its row into a host div, so in five of the six
cases this is a class on that host rather than new structure. Re is a class on
the existing `#reins-entry`.

## 1c. The band name

`derive` on the action row and `Quick Re` on the Re row already do this: a
letterspaced small caps word saying what a cluster is. Pricing and Bounds have
an anonymous row of small buttons where the reader expects a label, at exactly
the point they are being asked to decide something.

```css
.band-label {
    font-size: .68rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: .1em; color: var(--mut); margin-right: .35rem;
    flex: 0 0 auto;
}
```

**The label must not repeat the leaf name.** Drawing the Pricing band with
`Calibrate` on it put that word on screen three times inside 40 pixels: the
selected leaf in accent red, the band label, and the button at the end of the
row. That is the "Summary said twice" failure `site.css` already records
against the retired Overview header block.

Once the band has a box, the box says "these are controls", so the label's job
is to name the **question**, which the leaf name does not:

| leaf | band label |
|---|---|
| Calibrate, Allocate | `anchor and target` |
| Evaluate | `premium and anchor` |
| Pr Ruin | `premium and capital` |
| Bounds | `premium` |
| Re | `Quick Re`, unchanged |

`anchor and target` is `pricing-form.js`'s own vocabulary (`anchorInput`,
`targetInput`) and names the two halves the `◦` spacer already divides the row
into. Re keeps `Quick Re`: it is a feature name, not a leaf name, so it does
not collide, and it stays at its own `.reins-lede` size rather than adopting
`.band-label`.

## 1d. Slot order

Hold one order in every group: **leaf row, lede, controls, output**. Today Re
runs leaf row, description (`.reins-desc`), controls; Bounds runs leaf row,
controls, hint (`#bounds-hint`). An order the reader learns once in Overview
and that still holds in Bounds is the cheapest thing a new user can be given.

`.reins-desc` stays where it is, above the band: it describes the whole
structure, not the Quick Re row, so it is a lede and ledes come before
controls. `#bounds-hint` moves into the band, which is what it is a hint about.

## Files, phase 1

- `web/src/styles/site.css`: three tokens, the `.sub-tabs` and `.status-strip`
  margins, `.control-band`, `.band-label`, and the margin removals on
  `.reins-preview` / `.price-preview` / `.reins-entry-hint`.
- `web/index.html`: wrap `#reins-entry` (or add the class to it); move
  `#bounds-hint` inside `#bounds-form`'s wrapper.
- `web/src/pricing-form.js`: `control-band` on the host, a `.band-label` span
  as the row's first child, and the preview node appended inside the band
  rather than as a sibling.

## Acceptance, phase 1

- Every group: the leaf row sits visibly tighter to the form than the form does
  to the output. Overview and More, which have no form, show no gap where one
  would be.
- The control band's left edge lines up with the first leaf's label and with
  the pane's text, all on `--tabpad`.
- The preview line is inside the band on Re, on all four Pricing forms, and on
  Bounds, and the band does not change height as the preview fills (both
  preview rules already reserve `min-height: 1.2em`; keep that). Evaluate had
  none through a156 and gains one, per the ruling; see the execution notes for
  the guard that keeps it from printing a refusal at a deliberately blank box.
- No band label repeats the name of the selected leaf.
- Phone width (max-width 575.98px): the band does not force a horizontal
  scrollbar. The form rows already wrap; confirm the box does not defeat that.

---

# Phase 2 [the status strip], 1.0.0a158

The strip is `#status-strip` in `web/index.html` and is built by
`renderSummary`, `renderNote`, `renderTiming` and `syncSummaryMore` in
`web/src/main.js`.

## Why it gets glazed over

1. **It states the verdict three times and puts it last.** The left bar color,
   the ground tint, and the word. The word is at the far right of a line that
   wraps, so its position moves with the window.
2. **Label and value carry equal weight.** `bs = 4 · log2 = 18 · mean 106,477 ·
   CV 0.2114` is one mono run at one size, so eight facts read as sixteen
   tokens.
3. **Seven `·` separators do the work of space.**
4. **The timing line is a whole line and a whole sentence** for a number nobody
   reads: `Calculated in 0.412 seconds`.
5. **The note slot is always open.** A build with tags, a `note{}`, a
   derivation sentence and two warnings is four lines of prose, every time.

## The change

**Line one becomes three clusters, split by space, with no dots.**

```
BasicBook   Portfolio    bs 4  log2 18  loss    mean 106,477  CV 0.2114    0.41s
```

- Labels in the UI face at `--fs-meta` in `--mut`; values in `--mono` in
  `--ink-2`. Same information, roughly half the apparent density.
- Three gaps, not two. A label binds to its own value (`.35rem`) more tightly
  than to the pair beside it (`.85rem`), and the clusters stand `1.5rem` apart.
  In the mockup the pair gap is done with `.val + .lbl { margin-left: .5rem; }`
  so the markup stays flat, no wrapper span per pair. Without it
  `bs 4 log2 18 loss` comes out evenly spaced and reads as five items.
- The clock sits at the right end of line one, `0.41s`, or `cached`.
  `.summary-timing` and its line go.

**The verdict is said only when it is not clean.** On `ok`, the green left bar
is the whole statement and the word is dropped. On `warn` and `bad` the word
appears **second, right after the name**, where its position does not wander
with the wrap. Saying nothing when nothing is wrong is what buys amber and
scarlet their force, and it is the single largest de-busying move available.

`validationState` (main.js) already grades the library's prose into
`ok` / `warn` / `bad` and handles the `reinsurance; subject ...` prefix. That
function does not change; only what `renderSummary` does with `ok`.

**The note slot folds, consistently.** Author's ruling: tags and note go at the
end, in the dropdown, consistently, warnings first and the declaration last.

Order inside the fold, top to bottom:

1. library warnings (`_note.warnings`), in `.note-warn`
2. the derivation sentence (`_note.derivation`)
3. the declaration: tag chips then `note{}` (`.note-declared`)

What the library says went wrong outranks what the program says about itself.
This reverses today's `renderNote`, which leads with the declaration.

**The chevron carries the state and the count**, so a closed strip still
announces a warning without spending a line on its text: `2 warnings ▾` in
`--warn` when there are warnings, `note ▾` otherwise, nothing at all when the
fold is empty. This is what makes "consistently folded" safe. Without it, a
warning becomes something the reader must click for, and a warning you click
for is a warning you do not read.

## Two traps

**The examples caption.** `_note.caption` (main.js around line 3666) is set
when an entry is picked from the Examples menu, and it puts that entry's
`note{}` and `tags{}` in the note slot **before anything is built**. A fold
that is closed unconditionally would hide what a picked example is, which is a
real regression in the examples flow.

Rule: **the fold applies only when there is a built object.** With no object
the facts line is a prompt, the caption has nothing to compete with, and there
is no blob to avoid, so the caption shows open. Implement by keying the fold on
the same condition `renderSummary` runs under, not on `_note.caption` being
null, since a built library entry carries both.

**The chevron looks dormant today.** `syncSummaryMore` shows `#summary-more`
only when `inner.scrollWidth > inner.clientWidth + 1`, and `.summary-inner`
neither clamps nor sets `nowrap` while `.status-strip` sets
`overflow-wrap: anywhere`. Text that wraps freely cannot overflow horizontally,
so the test should never pass and the control should never appear. **Confirm in
the browser before relying on this**; if it is dormant the repurposing is free,
and `syncSummaryMore` changes meaning outright: today it asks whether line one
overflows, and it would ask whether anything is folded. The `resize` listener
on it can then go, since the answer no longer depends on width.

## Files, phase 2

- `web/src/main.js`: `renderSummary` (clusters instead of `sep()` pushes, the
  `ok` verdict drop, the clock), `renderNote` (order, and the chip and sentence
  stay one `.note-declared` block), `renderTiming` (folds into line one, or
  goes), `syncSummaryMore` (new meaning), and the `#summary-more` click handler.
- `web/index.html`: `#summary-timing` comes out; `#summary-more` gains a text
  span beside its icon.
- `web/src/styles/site.css`: the `.summary-inner` cluster rules, `.lbl` /
  `.val`, `.summary-clock`, the fold rules on `.summary-note`, and the retired
  `.summary-timing` block.

## Acceptance, phase 2

Exercise all five states. The mockup draws four of them; the fifth is the
examples caption.

1. **Clean build, nothing declared.** One line, no verdict word, green bar,
   clock at the right, no chevron.
2. **Clean build with tags and a note.** One line plus `note ▾`. Pressing it
   opens the declaration. Pressing again closes it.
3. **Warned build.** Ground tinted, `fails agg cv` in amber immediately after
   the name, chevron reads `1 warning ▾` in amber.
4. **Failed build with everything.** Ground tinted scarlet, `fails agg mean`
   after the name, chevron reads `2 warnings ▾`, and opening it lists warnings,
   then the derivation sentence, then the declaration.
5. **Example picked but not built.** The caption's tags and note are visible
   with no interaction.

Also: a bivariate still reports `(a, b)` pairs in the bs / log2 / mean / CV
slots and `validation n/a`; the strip still flashes once per adopted build
(`flashStrip`); and `Ctrl+Enter` on an unchanged program still shows `cached`.

---

## Decisions taken, and what was rejected

- **Not boxing the pane, the whole tab body, or the leaf row.** Those add
  enclosure to things that already have structure, being the folder tab's own
  2px rule and the tables' booktabs rules, and a box around a wide frame fights
  the one scrollbar rule on an iPad.
- **Variant B, a single hairline above the pane instead of the box**, is drawn
  in the mockup and was not chosen. It is cheaper in ink and marks the right
  boundary, but it cannot gather the preview line in, so that sentence stays
  loose between the ask and the answer.
- **The fold is consistent rather than auto-opening on warn or fail.** Author's
  ruling. The chevron carrying the state word and the count is what makes it
  safe; if that proves too quiet in the running app, auto-expanding on
  `is-warn` / `is-fail` is a one line change and the mockup shows it.
- **Warnings above the declaration** reverses `renderNote`'s current order and
  contradicts the reasoning in its docstring, which argues the declaration
  leads because it is a caption on the facts line above it. That argument was
  sound while the note slot was always open and sat directly under those facts.
  It does not survive the fold, where nothing is adjacent to anything and the
  first line read is simply the most important one. **Rewrite that docstring**;
  do not leave it contradicting the code.

## Out of scope

- The action row, the editor, the header, the offcanvas panels.
- `--gap-major` is applied only at the status strip. The gaps inside the input
  region (lede to editor, editor to action row) are not touched in this round.
- Anything about what the groups contain or which leaves are live. `nav.js` and
  the capability rules are untouched, so `dev/scripts/check-nav.mjs` should be
  unaffected; run it anyway.

## Housekeeping, each phase

Per `CLAUDE.md`:

1. Bump `version` in `pyproject.toml` (a157, then a158).
2. Add the `## <version>` section to `CHANGELOG.md`, three to eight bullets.
3. `uv sync --extra dev`, or `/v1/meta` keeps reporting the old version.
4. `.\scripts\build-web.ps1`, since `web/` moved in both phases. Build the
   artifact, never stage it; `src/aggregate_api/static/` is gitignored.
5. `uv run pytest`.
6. One commit per bump, `[a157] <terse summary>`, carrying source, tests,
   `CHANGELOG.md`, this plan doc, `dev/TODO.md` and `uv.lock`.

When both phases have landed, move this file to `dev/done/` and tick the
matching `dev/TODO.md` entry.

---

# Execution notes

Written as the work ran. Every divergence from the plan above is recorded here at
the moment it was made.

## Review, 2026-09-26

Read against `1.0.0a156` (`4b8a2e7`). Tree clean apart from this plan, untracked.
LIB is `1.0.0a353` and no phase consumes a new upstream surface, so no sync
dependency and no re-sync was needed before starting. No LIB symlink points at
this plan, so it is retired from here alone.

**The control list the API `execute-plan` skill names, `T:/worktrees/dev-files.md`,
does not exist on this machine.** `T:` is mounted and holds `$RECYCLE.BIN`, `BUP`
and `DOOB` only, and there is no `dev-files.md` anywhere under `V:\dev`,
`V:\worktrees` or `D:\projects`. So sections 1 and 7 of that skill cannot be
followed for the row, and `dev/TODO.md` is the only tracked item this plan
touches. Flagged rather than worked around.

Four plan claims were checked against the code and hold. `#qr-preview` is
already inside `#reins-entry` rather than outside it, and `createPricingForm`
already appends its `previewNode` to the host, so five of the six preview lines
land inside the band with no code at all; only `#bounds-hint` really had to move.
Both `min-height: 1.2em` rules are intact and untouched.

**The dormant chevron is confirmed, from the code rather than the browser.**
`.summary.expanded` has exactly one rule in `site.css` and it rotates the icon;
nothing clamps `.summary-inner` or sets `nowrap` on it, while `.status-strip`
sets `overflow-wrap: anywhere`. A freely wrapping block cannot overflow
horizontally, so `syncSummaryMore`'s `inner.scrollWidth > inner.clientWidth + 1`
can never be true and `#summary-more` never appears. Phase 2's repurposing is
therefore free and its `resize` listener can go, as the plan predicted.

## Four author rulings, 2026-09-26

Asked in one batch before any edit, because two of them were plan claims the code
contradicted rather than details.

1. **[Rhythm-Selector] `.sub-tabs:has(+ .control-band)` reaches only Bounds.**
   Re runs leaf row, `.reins-desc`, band; Pricing runs leaf row, `#leaf-price`,
   band, and `#leaf-price` is the adjacent sibling whatever leaf is showing,
   since the others are hidden with `d-none` rather than removed. Ruling: three
   selectors, no JavaScript.
2. **[Evaluate-Preview] Evaluate passes no `preview`**, so the plan's acceptance
   item "the preview line is inside the band on all four Pricing forms" could not
   hold. Ruling: give Evaluate `preview: true`.
3. **[Bounds-Hint-Unstyled] `.sub-hint` is styled nowhere in the repo**, so
   `#bounds-hint` drew at body weight, flush left, with no indent. Ruling: give
   it the preview line's reading, in the UI face rather than mono since it is
   ordinary prose.
4. **[Bounds-Band-Label] the plan's label table gives Bounds `premium`** for a
   row that is Calibrate's anchor and target row, all three targets, plus the
   `against` extras field. Ruling: `anchor and target`, the same as Calibrate.

## Phase 1 divergences, a157

1. **[Rhythm-Selector] three selectors, not one**, per ruling 1:

   ```css
   .sub-tabs:has(+ .control-band),
   .sub-tabs:has(+ .reins-desc),
   .sub-tabs:has(+ * .control-band) { margin-bottom: var(--gap-tight); }
   ```

   The third reaches through Pricing's `#leaf-*` wrapper; the second is the Re
   case, where the program lede sits between the row and the band and is part of
   the ask. **Known cost:** Pricing's Plot leaf carries no form and still takes
   the tight gap, because no sibling rule can tell which leaf is active. That is
   .3rem against 1.75rem in one leaf of one group, and the alternative is a class
   toggled from the leaf switch, which is JavaScript for a gap. The reasoning is
   in the rule's own comment.

2. **[Band-As-Wrapper] `.control-band` is a wrapper in `index.html`, not a class
   on the form host.** The plan offered either for Re and specified the class on
   the host for the other five. The wrapper wins on two counts. `createPricingForm`
   calls `empty(host)`, so Bounds' static `#bounds-hint` span cannot live inside
   the host it has to be drawn under; and Re's host is `.tab-tools.reins-entry`,
   which already carries `padding-left: var(--tabpad)`, so the class on that
   element would indent the row twice. One idiom for all six, and
   `pricing-form.js` needs no change for the band at all. The 40 lines inside
   Re's wrapper are **not** reindented, with a comment saying so: a whitespace
   change that size would bury the real diff.

3. **[Evaluate-Preview-Guard] Evaluate's `preview: true` needs a guard to be
   safe**, which the ruling could not have known about. `run_pricing_preview`
   calls `_one_anchor(p, a)` and refuses unless exactly one is given, and
   `read()` under `allowBlank` omits an empty box. So clearing the anchor, which
   is Evaluate's documented way of asking for the library's unlimited reading,
   would have printed `pass exactly one of p (VaR probability) or a (assets)` in
   the band as though the reader had erred. `renderPreview` now blanks under
   `allowBlank` when either the anchor or the target is unstated. Three lines,
   and it is what makes the ruling correct rather than a regression. Not blocked
   back to the author, because the fix is small and clearly in the spirit of
   both the ruling and the leaf's own design. Verified safe for a P&L too:
   `canPreview` is `can_price`, which is `hasattr(obj, 'price_pentagon')` and
   false for a `PnL`, so the new line never fires there.

4. **[Sub-Tabs-Comment] one comment rewritten, not just its code.** The
   `.sub-tabs` rule carried "The two numbers are equal on purpose", which the new
   `margin-bottom` makes false. Rewritten rather than left contradicting the
   rule, the same treatment the plan prescribes for `renderNote`'s docstring in
   phase 2.

**Out of scope and deliberately left alone:** `.massive-toggle`, the Allocate
leaf's disabled placeholder, is a control and it sits outside the band, between
the band and the pane. The plan does not name it and it is a greyed placeholder
for a post 1.0 item, so it stays where it is.

**Gates, a157.** `uv run --no-sync pytest -q`: 399 passed, 4 warnings, 77.73s.
`cd web; npm test`: 157 tests, 157 pass, 0 fail. `node dev/scripts/check-nav.mjs`:
clean, every leaf and group greys where it should, which the plan asked for
because `nav.js` and the capability rules are untouched.

## Phase 2 divergences, a158

Both of the plan's traps resolved in its favor. The **examples caption** is keyed
on a `.foldable` class that `renderSummary` sets and the two no-object renderers
remove, which is "the same condition `renderSummary` runs under" as the plan asked
rather than a test on `_note.caption`. The **dormant chevron** needed no browser
check: the review established it from the code, so the repurposing was free and
the `resize` listener went with the old meaning.

1. **[Cluster-Layout-Gated] the cluster layout is on a class, not on
   `.summary-inner` outright.** `renderBuildFailure` and the landing prompt write
   into the same node, and they are runs of prose joined by a `·`, so the
   cluster's 1.5rem column gap would have put 1.5rem either side of that dot.
   `renderSummary` adds `clustered`; `renderStripLine` and `renderBuildFailure`
   remove it. The plan's CSS list did not anticipate the shared node.

2. **[Chevron-Synced-In-RenderNote] `syncSummaryMore` is called from the end of
   `renderNote`, not from each of the three strip renderers.** One invariant: the
   chevron describes the note slot, so it is refreshed wherever the slot is drawn.
   It also closes a path the plan did not name. `onEdit` clears a picked example's
   caption and redraws the slot without going through any of the three renderers,
   so a chevron synced only in those three would have gone on offering a note the
   slot no longer held. `.foldable` is therefore set **before** `clearNote()` in
   `renderSummary` rather than after, so the first sync already knows.

3. **[Fold-State-Sticky] `expanded` is dropped only when nothing folds**, not on
   every build. The plan is silent on this. A reader who asked to see notes keeps
   seeing them across builds that have one; the class is cleared the moment the
   chevron hides, so a control and a state cannot disagree.

4. **[ARIA-Expanded] the button gained `aria-expanded`**, which the plan does not
   mention. It went from a dormant decoration to a real disclosure control at this
   bump, and a disclosure control without that attribute is one a screen reader
   cannot read.

5. **[Clock-Two-Places] `0.41s`, two decimal places**, matching the plan's own
   example line and down from the timing line's three: the millisecond was noise
   at `.68rem`. `cached` replaces the sentence "Loaded from cache".

6. **[Verdict-Local-Name] the verdict's local is `verdict`, not `state`.** The old
   `const state = validationState(res.validation)` shadowed the module-level
   `state` object inside its block. Renamed while the surrounding lines were being
   rewritten anyway.

7. **[Retired-Rule-Documented] `.summary-timing` is removed and says so.** The
   block is replaced by a comment recording what it was and why the clock replaced
   it, the same treatment the file gives its other retired rules. `renderNote`'s
   docstring is rewritten rather than left contradicting the new order, which the
   plan explicitly required.

**Gates, a158.** `uv run --no-sync pytest -q`: 399 passed, 4 warnings, 76.64s.
`cd web; npm test`: 157 tests, 157 pass, 0 fail. `node --check` on both edited
modules. `node dev/scripts/check-nav.mjs`: clean.

**Not verified here: the five states in the phase 2 acceptance list.** They need a
running app and real builds, and no suite or harness in this repo exercises
`renderSummary`, `renderNote` or `syncSummaryMore`. That is the author's tire
kicking, and the five states to walk are the plan's list above: clean; clean with
tags and a note; warned; failed with everything; and an example picked but not
built. Worth walking the bivariate and the `cached` path with them.
