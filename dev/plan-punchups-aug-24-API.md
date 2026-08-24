# Plan: punchups, August 24, API

Status: drafted 2026-08-24 from the author's eleven item list, item 2 withdrawn
the same day. A running punch list: each numbered item is self contained,
executes on its own, and bumps the version on its own. Items 6 and 7 are one
edit and land together. Keep each section tight.

The author's numbering is kept, gap included, because that is how items get
named in conversation. The LIB list of the same date is
`aggregate_REFACTOR/dev/plan-punchups-aug-24-LIB.md` and shares nothing with
this one.

Owner: API repo, all of it. Item 1 mirrors three grammar terminals, which is the
only place this list touches the LIB boundary at all, and it stays here.
Everything else is the app.

## Standing context, read before executing

**The tree is mid flight and moving under you.** `dev/plan-examples-dropdown.md`
phases A1 to A3 are in the working tree with a `1.0.0a122` CHANGELOG section
written and `pyproject.toml` still at `a121`; A4 (pills, filter bar,
persistence) and A5 (out of order fuzzy search) landed in `examples.js` and
`main.js` during the drafting of this file. Items 1 and 5 sit on that work, and
**item 5 is now mostly done by A4**, which is written up in its own section.
Read `examples.py` and `examples.js` fresh before touching either, and do not
start until a122 and whatever A4 and A5 bump to are committed.

**Versions at drafting**: API `1.0.0a121` (CHANGELOG through a122), LIB
`1.0.0a320` on `REFACTOR`. The `seq` and `as_read` fields item 1 stands on
arrived at LIB a320, so an environment that has not run `uv sync --extra dev`
since will fail `load_examples` outright, not subtly.

---

## 1 [Example-Load-Strips-Trailer] the picked entry loses its note and tags, and the strip prints the note

### What the author asked for

A program loaded from the Examples dropdown arrives in the editor with `note{}`
and `tags{}` **stripped**, and the note appears in the status strip anyway.
`hints{}` stays, and that is not negotiable: sixteen library entries pin a grid
and a reference to one of them means one fixed thing only while the clause
travels. The author's reason is the demo: a reader watching the app should see
the program, not the program plus its filing metadata, and the prose belongs on
the strip where prose goes. The behavior deliberately differs from what happens
when a reader types a `note{}` themselves, and that asymmetry is accepted.

Scope is the **Examples dropdown load path** specifically, per the author. The
same item objects reach the editor through Ctrl+K and through the Ctrl+Shift
arrow ring, and all three go through `pickExample` / `loadExample`, so all three
inherit it. Nothing else changes.

### Why it regressed, which is worth knowing before undoing it

Through a118 the app served `Recipe.decl`, which is `spec_to_decl` then
`format_program` at the default `trailer=False`, so every entry arrived stripped
of note and tags. a119 and a120 reversed that deliberately, and the reasoning is
recorded in `examples.py` above `_SESSION_SOURCE` and in `_decl_of`'s docstring:
an object carries the note and tags **its own program** declares, so a stripped
entry built an object with neither and the strip had nothing to print. The
fields on the menu item feed the row before anything is built; the clauses were
what survived the build.

So the fix is not "revert a119". It is to keep the strip fed while the clauses
go, which means the note reaches the strip on a different channel: the picked
item, which already carries `note` and `tags` as fields.

### The edit, server side

`examples.py`, `_decl_of`: return `as_read` with the `note{}` and `tags{}`
clauses removed and everything else, `hints{}` included, untouched.

This is exact rather than approximate, and that is worth one comment in the
source. `decl.lark:830` to 832 define the three terminals as
`/note\{[^}]*\}/`, `/hints\{[^}]*\}/` and `/tags\{[^}]*\}/`: the body cannot
contain a closing brace, so a regex here is the grammar's own terminal and not a
guess at it. Write the pattern as a module constant beside the deleted trailer
tuple the a120 comment describes, and document it as mirroring those three
terminals, the way `web/src/decl-keywords.json` is documented as mirroring
`parser_errors._TERMINAL_LABELS`. That puts it under agreement 6 in the
oversight charter, so a grammar change to the trailer is checked against it.

Tidy the whitespace the removal leaves: a clause on its own line takes the line
with it, and a trailing clause on a line with `hints{}` leaves a double space.
Strip trailing blanks and re-collapse runs of spaces on the affected lines only,
then `.strip()`, which is what `_decl_of` already ends with.

`ExampleItem` does not move. `note` and `tags` are already fields on it, so
nothing is lost from the payload and no consumer of the api loses anything
either; only `decl` changes. Update the `_entry` docstring, whose current
paragraph says the two copies are not redundant because the clauses are what
survive the build. That stops being true and the new sentence says why: the
clauses would be filing metadata in front of a reader, and the strip is fed from
the fields instead.

### The edit, app side

The strip's note slot (`main.js`, `_note`) gains a fourth tenant, the **library
caption**, holding the picked item's `note` and `tags`.

* `pickExample(item)` records `{note: item.note, tags: item.tags}` and calls
  `renderNote()`, so the caption is on screen the moment the program is, before
  anything is built.
* `renderNote` prefers the object's own declaration and falls back to the
  caption: `_note.declared || caption.note`, and the same for tags. A reader who
  types their own `note{}` still sees theirs, which keeps the hand typed path
  exactly as it is.
* `renderSummary`'s `clearNote()` must stop clearing the caption. Its docstring
  says a note belongs to one object, which is still right for the three build
  derived tenants; the caption belongs to the **program in the box** and has a
  different lifetime. Clear it in `onEdit(fromApp === false)`, beside
  `history.resetCursor()`, which is already the page's "the reader typed" hook.
  Loading another example replaces it, and typing over one drops it.

### Tests and hygiene

`tests/test_examples.py`: an entry known to carry all three clauses serves a
`decl` with no `note{` and no `tags{` and with its `hints{` intact; the `note`
and `tags` fields are unchanged; an entry with no trailer is byte identical to
its `as_read`. Add one case for a `port`, where the trailer sits after the name
rather than at the end, so the removal is not accidentally anchored to the end
of the program. Version bump, one CHANGELOG paragraph under this label.

---

## 2 Withdrawn

`agg M agg.<name>` against a name that is only a unit of a `port` or a
`bivariate` declaration. Withdrawn by the author on 2026-08-24: those are units,
not entries, and requiring the library to expose inline declarations by name is
not wanted. Nothing is owed here and nothing was raised upstream.

Recorded rather than deleted so the number still lines up with the author's
list, and so the question does not come back as a fresh finding: the 26 indented
declarations in `library.agg` are absent from `Underwriter.recipes` by design.
The one loose thread, if it is ever worth pulling, is that the app reads the
resulting 422 as an expired session and offers a rebuild, which is the wrong
sentence for a name that was never an entry.

---

## 3 [Editor-Margin-Controls] the walk buttons align right and lose their boxes

### Symptom

The clear icon is a bare glyph at `right: 1rem`. The two walk buttons below it
are 2.1rem boxed buttons with a border and a fill, centered in a column
(`site.css:284` to 313, `align-items: center`), so none of the three right edges
line up and the two arrows read as a widget bolted under an icon.

### The edit, all in `site.css` and two `<i>` classes in `index.html`

* `.editor-hist` takes `align-items: flex-end` instead of `center`, so the two
  buttons and the `[m/n]` readout share the clear icon's right edge.
* `.hist-step` loses `border` and `background` and keeps its 2.1rem box as an
  invisible hit area, with `justify-content: flex-end` and no right padding so
  the glyph itself lands on the column's right edge. Colors follow
  `.editor-clear`: `var(--mut)`, and `var(--ink)` on hover. The hit area is
  deliberately kept: the a115 comment records why 2.1rem was chosen against
  Apple's 44px guidance, and none of that reasoning changes because the border
  went.
* `.hist-step:disabled` drops the border and background rules and greys by
  `color: var(--line)` alone, which is what the existing comment already says
  the greying should be.
* The glyphs: `bi-arrow-up` and `bi-arrow-down` become **`bi-arrow-up-circle`
  and `bi-arrow-down-circle`**. That is the same family, weight and optical size
  as the `bi-x-circle` above them, so the three stack as one set of marks rather
  than as an icon and two arrows. `bi-chevron-up` / `bi-chevron-down` is the
  lighter alternative if the circles read as too heavy once stacked; decide by
  looking at it.

Nothing in `main.js` moves. The `title` strings, the `aria-label`s and the
disabled logic are all unchanged.

### Watch

The a115 CSS comment computes the stack's height from the button size and the
editor's six line floor. Removing the border changes the box by two pixels, not
enough to matter, but the comment quotes exact numbers and should be re-read
rather than left claiming an arithmetic that no longer holds.

---

## 4 [Clear-Twice-Clears-History] a second press of the clear icon empties the store

### What the author asked for

Press the clear icon with a program in the box and it clears the box, as now.
Press it again, with the box already empty, and it clears the stored history:
the `[m/n]` readout goes blank, both arrows grey, and the walk has nothing to
walk.

Reading "the cache of programs" as the localStorage history under
`aggregate-web:history`. It is the store the icon's neighbors navigate and the
only one a reader would describe that way. The server side object cache is
shared and not the app's to drop.

### The edit

`history.js` gains `clear()`: empty `entries`, `cursor` to `-1`, `draft` to
`null`, one `save`. Small, and it belongs there because the module owns the
shape and the two caps.

`main.js`, the `editor-clear` handler:

```
if (editor.getText().trim()) { editor.setText(''); editor.focus(); return; }
history.clear();
renderHistoryNav();
flashLabel(...);
editor.focus();
```

`flashLabel` already exists for the Reformat button's no-op case, which is the
same problem: without a word the second press looks like a dead control, since
the box was already empty and the readout going blank is easy to miss. It should
say something short and past tense, "history cleared".

Deliberately **no confirmation dialog**. The author asked for a second click,
and a modal in front of it would defeat the point; the loss is a local
convenience store, not work.

### Tests and hygiene

`web/test` covers `history.js` directly, so `clear()` gets a case: record three,
clear, `position()` is `{m: 0, n: 0}` and `canPrev` is false. Update the Help
panel's `✕` line, which currently reads "clear the editor" and now has a second
job.

---

## 5 [Example-Ring-Follows-Search] the ring follows the search box as well as the pills

### Half of this landed while the plan was being written

`plan-examples-dropdown.md` A4 went into the tree on 2026-08-24 and it did the
pill half properly: `examples.js` exports `filteredExamples()` and
`onExamplesFilterChange()`, both documented as being for the arrow ring;
`exampleRing` holds a cursor and no list; `exampleStep` reads
`filteredExamples()` on every press; and a pill click resets the cursor to `-1`
(`main.js:3026`, 3051, 3077, 3132). Filter to `role:hero` and Ctrl+Shift walks
those seven. Verify that on the current tree before doing anything, because it
is done.

### What is left: the search box

The author's own example is typing `hero`, and typing is the half that is still
missing. `filteredExamples()` returns the **pill filtered** set; the visible list
is `search(q)` over that set (`examples.js:203`, `renderList:322`). So a needle
narrows what is on screen and the ring keeps walking everything the pills left.
The gap is one term, and it is the term the author named.

### The edit

The needle becomes module state in `examples.js`, exactly as the filter set
already is, so that the same one subscriber channel carries both.

* A module `needle`, written by `renderList` from the `q` it has already
  computed. Last render wins, which is right and needs saying: the dropdown and
  the palette both render through `renderList`, so the ring walks what the
  reader last saw, whichever surface they were looking at.
* Export `visibleExamples()`: `search(needle)` when the needle is non-empty,
  `filteredExamples()` otherwise. This is the ring's list from now on.
* `renderList` calls `notify()` when the needle changes value, so the existing
  `onExamplesFilterChange` subscriber drops the cursor for the same reason it
  drops it on a pill click: the cursor indexes a list that just changed shape.
  Rename the export to `onExamplesViewChange` while touching it, since it stops
  being about filters alone, and update the two docstrings that say "filter set".
* `main.js`: `filteredExamples()` becomes `visibleExamples()` at all three sites
  (`pickExample`, `exampleStep`, and the reset subscription).

Guard against the obvious loop: `renderList` runs inside a `notify()` fanout, so
notify only when the needle's value actually changed, and never on a redraw that
was itself caused by a notify.

### Watch

Search results are **ranked**, not in file order, which `renderList` and the
plan both state deliberately. So with a needle live the ring walks in relevance
order. That is correct, since the ring's contract is the list read top to bottom,
but it is a behavior change worth one sentence in the CHANGELOG.

---

## 6 [Stats-Joins-Overview] and 7 [Overview-Leaf-Order] one edit

The Stats leaf moves from More to Overview, and the Overview row is reordered to
**Plot, Summary, Validation, Stats, Tail**.

### The edit

`nav.js`: move the `stats` leaf definition out of `NAV_GROUPS.more.leaves` into
`NAV_GROUPS.overview.leaves`, and write the five Overview keys in the target
order. Key order is row order, which the file already says in bold at the top of
`NAV_GROUPS`.

`main.js`, `LOADERS`: `'more:stats'` becomes `'overview:stats'`, and the loader's
arguments change with it, from
`loadExhibitLeaf('pane-more', 'stats', ['more', 'stats'])` to
`loadExhibitLeaf('pane-overview', 'stats', ['overview', 'stats'])`. Both the
pane id and the reading map key move; missing the pane id would draw the Stats
table into the More pane behind an Overview pill.

`dev/scripts/check-nav.mjs`: rename the `more:stats` row to `overview:stats`.

### The gating does not change, and the check proves it

`more:stats` is live for `agg`, `agg_reins`, `port`, `distortion`, `bvagg`,
`pnl`, `xpnl`, which is exactly the set `overview:summary` and
`overview:validation` carry. So the move lights nothing new and darkens nothing,
and `check-nav.mjs` asserts that rather than leaving it to be believed. This is
the same move `validation` made at a55, and the expectations table there records
the same reasoning; follow its comment style.

### Watch

`state.leaf` is remembered per group and persisted, so a reader whose More group
is sitting on `stats` has a remembered key that no longer exists.
`navActiveLeaf` falls back to the first live leaf when the remembered one is not
available, so this self heals on the next render; confirm that path rather than
assuming it, because the fallback reads `leafAvailable`, which returns false for
an unknown key only because `leafOf` returns undefined.

Also check the reading map (`charts/reading-map.js`) and any stored per leaf
view state keyed `more:stats`, for the same reason.

---

## 8 [Reformat-Keeps-Trailer] Reformat stops deleting the note and the hints

### Symptom

Press Sharpen, which writes a `hints{}` clause, then press Reformat: the clause
is gone. A `note{}` goes the same way.

### Diagnosis

`routes/decl.py:39` calls `format_program(decl, fmt="text")` and
`format_program`'s signature is
`(spec_or_text, *, fmt='text', layout='spread', trailer=False)`. At
`trailer=False` the writer drops all three trailer clauses. Verified 2026-08-24:
a program carrying `hints{log2=16, bs=1}`, `note{...}` and `tags{...}` comes
back with none of them, and comes back with all three at `trailer=True`.

### The edit

One keyword: `format_program(decl, fmt="text", trailer=True)`. Update
`_format_decl`'s docstring and the route's, which says the helper standardizes a
program loaded from the Examples library. That is no longer its main job, since
a library entry arrives as the file's own text and needs no round trip; its job
is the Reformat button and the `grossceded` prefix path at `main.js:580`.

### Decide before executing: tags

`trailer=True` restores note, tags and hints together, because the writer emits
the trailer as a unit. Item 1 strips note and tags from a **loaded library
entry**, so after item 1 there is nothing for Reformat to restore on that path
and the two do not fight. A reader who types their own `tags{}` keeps it through
a Reformat, which seems right and is the same rule as the note. Flagging it
because the author's wording named notes and hints and not tags.

### Watch

`format_program` round trips through the spec, so Reformat still rewrites
`ph 2/3` as a float and `dsev [1:6]` as six values. That is Reformat working as
designed and is out of scope here; it is tracked upstream as
`[Unparser-Reference-Gaps]`.

---

## 9 [Tooltips-Stay-On-Screen] the `data-why` footnote clamps to the viewport

### Symptom

Hover the Reinsurance group's Plot leaf while it is dark and the explanation
runs off the left edge of the screen.

### Diagnosis

`site.css:611` to 634. The footnote is a `::after` at `left: 50%;
transform: translateX(-50%)` with `max-width: 230px`, centered on its button.
Plot is the first leaf in its row and the row starts at the content's left edge,
so a 230px box centered on a button roughly 45px wide overhangs by about 90px.
The mirror case exists at the right edge, and it gets worse as the viewport
narrows, which is why the phone breakpoint at `site.css:636` gives up and
records the clipping as a trade.

This is the page's only hand rolled tooltip system. It is used by the dark group
tabs, the dark sub-tab leaves, and the Allocate leaf's `.massive-toggle`
placeholder, so one fix covers every case the author's "in general" asks about.
The Bootstrap tooltips elsewhere are Popper positioned and already flip.

### The edit

Keep the CSS `::after`, and give it a shift the page measures.

* The rule becomes
  `transform: translateX(calc(-50% + var(--tip-shift, 0px)))`. With no variable
  set it is byte identical to today, so nothing regresses if the script does not
  run.
* A small `web/src/utils/tip.js` exports `clampTip(node)`: on `pointerenter` and
  `focus`, read the anchor's `getBoundingClientRect()`, compute where a 230px box
  centered on it would land, and set `--tip-shift` on the anchor to the least
  shift that keeps it inside the viewport with an 8px margin. Clear it on
  `pointerleave` and `blur`.
* Wire it once, delegated on `document` for `[data-why]`, rather than per
  element, so nothing has to be re-wired when `renderSubTabs` rebuilds a row.

The arrow (`::before`) stays centered on the button and is not shifted, which is
correct: the arrow points at the control, the box moves to stay readable. That is
what every tooltip library does when it shifts rather than flips.

The phone breakpoint's "the tooltip is clipped here; that is the trade" comment
comes out, because it stops being true.

### Alternative considered and rejected

`:first-child` / `:last-child` anchoring, pure CSS, no script. It fixes the two
ends of one row and nothing else: a wide footnote on the second of six leaves
still clips on a narrow window, and the author asked for the general case. CSS
anchor positioning with `position-try-fallbacks` is the real answer and is not
available on the iPad, which is a supported target.

---

## 10 [Surface-Strip-Punchups] four fixes to the 3-D control strip

Overview, Plot, 3-D. All four are in `web/src/charts/`. They are independent and
can land in one bump or four; one is simplest.

### 10.1 [Surface-Single-Panel-Group] the log button joins the strip

**Symptom.** "log y" floats away from everything else with a rule between them.

**Diagnosis.** `renderControls` (`mount.js:559`) draws one
`.exhibit-group.exhibit-group-panel` per panel and then one plain
`.exhibit-group` for the document. `.exhibit-group-panel` is
`flex: 1 1 0; justify-content: center` (`site.css:1178`), which exists so that
with two panels each group sits over its own half of the canvas, and
`.exhibit-group + .exhibit-group` draws a left border. A surface document has
**one** panel, so its group takes all the spare width, centers a single button
in it, and is separated from everything else by a rule. The layout is doing
exactly what it was built to do, on a case it was not built for.

**Fix.** When `offered.panels` yields exactly one group, append its buttons into
the document `box` instead of into a group of their own, at the front, which
keeps the house order of axis readings before realizations. Not a surface
special case: with one panel there is nothing for the half and half layout to
align to, and a labeled column of one is the disconnected look on any chart. The
`setPanelView(panel.id, ...)` handlers are unchanged; only the parent node moves.

### 10.2 [Surface-Download-Menu] one Download button, three formats

**Symptom.** A `mesh` label followed by three buttons, `.glb`, `.obj`, `.stl`,
sitting mid strip.

**Fix.** Replace the label and the three buttons (`mount.js:660` to 684) with one
`Download` dropdown carrying the three as items, and move it to the end of the
strip. Bootstrap's dropdown is already loaded and the Examples menu is the
pattern to copy. The three per format `title` strings become the items' own
hover text, so nothing written is lost; the button's own title carries the shared
sentence about the file being the box on screen. Disabled when `canExport()` is
false, with the "nothing is drawn yet" reason on the button rather than repeated
three times.

**Decide before executing, two small things.**

* *Where "the end" is.* `reset` is currently last, and its comment records a
  deliberate move to that position at a117 on the grounds that it acts on the
  whole drawing. Recommend `Download` then `reset`, so `reset` keeps the end and
  `Download` is the last thing before it. If the author meant literally last,
  swap them and rewrite that comment.
* *Whether PNG joins it.* The header's More menu has "Download plot", which saves
  the canvas as a PNG. A `Download` menu next to the chart that offers three mesh
  formats and not the picture is an odd set. Folding PNG in is a few lines and
  makes the menu the one place a drawing leaves the app. Not doing it without a
  ruling, because it moves a control out of the header menu.

### 10.3 [Surface-Puck-Button-Width] the puck button stops growing

**Symptom.** On connect the label becomes `spacemouse: SpaceMouse Wireless` and
the strip rewraps.

**Diagnosis.** `spaceMouseButton`'s `paint` (`mount.js:516`) writes the device
name into the label and also sets `.active`, so the state is signaled twice and
one of the two costs a re-layout of the row.

**Fix.** The label is always `spacemouse`. `.active` carries connected, which is
the fill the rest of the strip already uses for on. The device name moves into
the `title`, whose connected branch already opens with "Connected." and becomes
"Connected to SpaceMouse Wireless." A reader who wants to know which puck asks
the button; a reader who wants to know whether it is on sees the color.

### 10.4 [Surface-Reading-In-The-Strip] the cell reading moves to the fixed legend

**What the author asked for.** No floating tooltip on the surface. The reading
goes in the fixed strip above the chart, beside the cut's own numbers, mirroring
what the 2-D charts do. It may update on click rather than live.

**What is already in place**, which makes this small:

* The strip exists. `writeCutReadout` (`mount.js:934`) draws two lines from
  `{where, leaves}`: where the cut is, then what it leaves, which is the
  "total, density" the author is looking at.
* The click handler exists. `chart.on('click')` (`mount.js:1232`) already
  receives `params.value` as `[x, y, h]`, which is exactly what the tooltip
  formatter reads.
* The tooltip's own text is three lines and is worth copying verbatim, including
  its two careful cases: a cell resting on the log floor prints `< 1e-12` rather
  than reporting the floor as data, and a quantized encoding says so.
  `surface.js:173` to 184.

**The edit.**

* `draw()` holds a `pointer` value, `null` until the first click, set from
  `params.value` in the click handler.
* `writeCutReadout(rows, pointer)` draws a third group, `at`, before the other
  two: the x name and value, the y name and value, and the density. Placeholders
  from the first paint, with the names present and the values blank, so the
  strip holds its height and nothing below the chart moves on the first click.
  That is the same reason the readout node is created before the first render.
* `surfaceOverrides` drops `tooltip` entirely, and the `tips` control is retired
  from `SURFACE_CONTROLS`, from `SURFACE_KEYS` and from the view defaults
  (`mount.js:95`, 112, 290). Retire rather than repurpose: with the reading in a
  fixed place there is no second question for the button to ask, and a stored
  `tips` key in a reader's persisted view is harmless once nothing reads it.
* The idle string changes. It currently says "click the surface to cut it",
  which stays right and now also gets the reader their reading.

**Watch.** A click with `cut === 'none'` currently forces `cut: 'all'`, because
a click that did nothing visible read as a dead gesture. With the pointer
reading in the strip a click now always does something visible, so that forcing
could go. Leave it: changing it is a separate behavior decision and this item is
about where numbers are printed.

---

## 11 [Counter-Follows-The-Example-Walk] the readout numbers the example walk

### Symptom

Ctrl+Shift+Up and Down step through the library and the `[m/n]` beside the
editor does not move. It cannot: it reads `history.position()`, and the example
ring is a different stack that nothing reports on.

### The edit

One readout, two stacks, and the rule for which is showing is the rule the
reader already has in their head: the counter describes whatever the last press
walked.

* `main.js` holds `walkMode`, `'history'` or `'examples'`.
* `exampleStep` sets it to `'examples'`; `navigateHistory` sets it to
  `'history'`; a build and an edit by the reader set it back to `'history'`,
  since both mean the box is no longer showing a library row.
* `renderHistoryNav` reads `history.position()` or
  `{m: cursor + 1, n: items.length}` off the ring, and prints the same
  `[m/n]`. Blank when the ring's cursor is `-1`, which is the same rule the
  history readout already uses for "not in the stack".
* Call `renderHistoryNav()` from `exampleStep` and from `pickExample`, which
  neither does today.

`n` is the count of what is being walked, which A4 already made the filtered
count and item 5 makes the searched count, so `hero` walks `[1/7]` to `[7/7]`.
That is the readout doing its job: it says where you are in what you are
walking. Read the ring's length off the same call `exampleStep` uses rather than
off a copy, or the two drift the first time a filter changes mid walk.

### Decide before executing

The two step **buttons** stay bound to history and keep their own greying, which
is right: they are the walk's only route on a touch device and the example ring
has no buttons. So while `walkMode` is `'examples'` the counter and the arrows
describe different stacks. The alternative, greying the arrows against whichever
stack is live, makes the touch route disappear mid walk and is worse. If the
author wants the two to agree, the answer is a second pair of buttons for the
library, which is a bigger change than this item.

Update the readout's docstring block in `renderHistoryNav` and the Help panel
line for Ctrl+Shift, which currently says the walk "loads, does not build" and
now can also say where you are.

---

## Order of work

Independent except where noted. A sensible run:

1. **Items 6 and 7**, one edit, no dependencies, immediately visible.
2. **Item 8**, one keyword.
3. **Item 3**, then **item 4**, then **item 11**: all three touch the editor's
   right margin and the readout, and doing them in that order means the CSS
   settles before the counter learns a second job.
4. **Item 9**, self contained.
5. **Item 10**, one bump or four, in any order.
6. **Items 1 and 5**, after the examples work in the tree is committed. Confirm
   item 5's pill half against the current `examples.js` first; only the search
   needle is left.

Item 2 is withdrawn and has no place in the run.

Each remaining item bumps the version and carries its own one paragraph
CHANGELOG section under its label. Move this file to `dev/done/` when the last
item that is going to land has landed, and note in `dev/TODO.md` whichever items
the author defers.
