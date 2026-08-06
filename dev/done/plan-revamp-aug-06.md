# plan-revamp-aug-06: the shell revamp

Status: **executed** at `1.0.0a47`. Suite green (205 passed), `check-nav.mjs`
clean: not one gate moved.

What execution found, and the plan had wrong: the editor colors numeric
literals **copper** `#b87333`, not green, and a DecL object name is plain text
rather than red, because `decl-mode.js` emits keyword / atom / number / string
/ comment / bracket and a name is none of them. So the two ties this plan
claimed do not exist as stated. `--green` is instead the editor's own *string*
green, read from `:root` by `cm6.css`, which still gives the app exactly one
green. The house red keeps its real job, inline `code` and the parse-error
caret, and adds selection.

The page around the output is rebuilt: one type scale instead of twenty sizes,
a press color ramp with the house red as the accent, real tab shapes for the
six groups, a small caps sub menu, one action row, one status strip, and a
merged title-and-gloss line over every exhibit. Nothing about *what* the app
computes changes. This is the shell.

Designed in `hacks/mockup-10-concepts.html` over five rounds against the
running api, three concepts down to one. That file is the specification: where
this plan and the mockup disagree, the mockup is right.

## Why

The page reads as bitty and its sections are not legible. Three measurable
causes, all in `web/src/styles/site.css`.

**No type scale.** The sheet declares twenty distinct font sizes between
`.6rem` and `1.05rem`, and nothing on the page except the brand is larger than
`1.05rem`. Hierarchy is being signalled by one pixel steps the eye cannot
resolve, so nothing reads as a heading and everything reads as a sibling of
everything else.

**No sections, only bands.** From the top of `<main>` to the first content
there are up to eight full width strips of near equal weight: lede, editor,
feedback line, button row, summary, timing, group tabs, sub tabs, tool row.
They are separated by margin alone, never by a container or a rule.

**The two menu levels are inverted.** The group strip is the parent and its
active pill is white on light grey at `.82rem`, subtle. The sub menu is the
child, `btn-outline-secondary` at `.74rem`, whose Bootstrap `.active` is a
solid dark fill. The child shouts, the parent whispers, the two rows are the
same width and nearly the same height, and the Overview identity block sits
between them so they never read as parent and child.

## What lands

**A five step type scale**, `--fs-meta .74` / `--fs-ui .82` / `--fs-body .94` /
`--fs-head 1.15` / `--fs-title 1.45`, replacing the twenty.

**The press ramp**: `--ink #000`, `--ink-2 #2b2b2b`, `--mut #5f5f5f` over true
neutral lines, chosen over Bootstrap's greys, which are three colors from three
different hues pretending to be one ramp.

**The house red as the accent.** `--house #a81313` feeds both `--primary` and
`--code`, so the selected tab and the marks the house red already carried,
inline `code` and the parse-error caret, are the same red by construction. Blue leaves the page entirely. Build therefore
carries no color: selection is the only thing the accent means, and Build is
not a selection.

**One green.** `--green` feeds `--ok` and is the editor's own string green,
read back by `cm6.css`, so the stylesheet holds one green rather than two that
differ by a few points and look like a mistake.

**Real tabs** for the six groups: every tab drawn, active filled in the accent
and painting over the strip rule. Sub menu in letterspaced small caps, so the
two levels differ in case as well as size. Sub menu and content both indent by
`--tabpad`, so everything below aligns with the first tab's *label*.

**One action row.** The button row and the feedback line merge. Sharpen, PnL
and Reset collapse into one labelled `derive` group, because each writes DecL
back into the editor rather than acting on the object.

**One status strip.** The summary line and the timing line become one bordered,
tinted container. It wraps, never overflows. A warning or a failure tints the
whole strip rather than only coloring a word, because hue alone is too weak for
a state you must not miss and a scarlet failure must never be confused with the
brick red of a selected tab.

**A merged exhibit lede.** `<b>Return periods</b>: VaR, TVaR and xsVaR by
return period` replaces a heading over a separate hint line. The old pair said
"Summary" twice at two sizes with two alignments. The sub-tab hint line is
deleted; this is where it went.

**Greyed items say why on hover.** A `why:` string per leaf in `nav.js`,
rendered as a drawn tooltip. A Severity lights 3 leaves out of 22, and a wall
of grey that explains itself is a map of what the object is rather than a
broken page.

**Keyboard navigation.** Roving tabindex on both strips, arrows and Home/End
within a strip, and `Alt+1…6` to jump to a group from anywhere. Alt is the one
modifier the editor does not already spend.

## Stages

One version bump covering all four. They are an order, not a version map.

### 1. Tokenize `site.css`

Additive and mechanical, with **no intended visual change**: the page must look
identical when this stage ends. That is what makes it checkable.

- New `:root`: the five sizes, the three ink values, `--line` / `--line-2` /
  `--soft`, `--house` / `--primary` / `--code`, `--green` / `--ok` / `--warn` /
  `--bad`, `--gutter` / `--measure` / `--tabpad`.
- Rename the three tokens whose names describe a use rather than a value:
  `--grid` → `--line`, `--rule` → `--ink`, `--dot` → `--mut`. Two names for one
  color is the confusion being removed, so no aliases.
- Replace the hardcoded literals with tokens: `#212529` → `--ink`, `#374151` →
  `--ink-2`, `#6c757d` → `--mut`, `#dee2e6` → `--line`, `#f8f9fa` → `--soft`,
  `#0d6efd` → `--primary`, `#198754` → `--ok`, `#b54708` → `--warn`.

Files: `web/src/styles/site.css`.

### 2. The shell markup

- Lede copy: "Model a book of insurance, investigate tail risk, allocate
  margin, apply and price reinsurance."
- Fold the feedback line into the button row. The emacs switch rides along on
  the right, keeping `#emacs-switch` so `main.js` needs no change.
- Group Sharpen / PnL / Reset into a `btn-group` behind a `derive` label. Build
  drops `btn-primary` for `btn-outline-secondary btn-build`.
- Wrap `#summary` and `#summary-timing` in one `.status` container.
- Move `#head-overview` out of `#t-overview` to sit **above** the group tab
  strip. This is the fix for "the title comes between the two": nothing may
  stand between a group strip and its sub menu. The id does not move, so
  `main.js` needs no change.

Files: `web/index.html`.

### 3. The shell styling

Tabs, sub menu, action row, status strip, lede measure, exhibit lede, focus
ring, tooltip. The Bootstrap Tab plugin, the `.tab-pane` panes and the
capability gating are **untouched**: `nav nav-pills` markup is drawn as folder
tabs in CSS alone.

Files: `web/src/styles/site.css`.

### 4. The four JavaScript reaches

- `renderSubTabs`: drop the hint span, emit `sub-link` rather than
  `btn btn-outline-secondary`, and carry `data-why` on a dark leaf using
  `aria-disabled` rather than `disabled`, so the tooltip fires and the click is
  refused in the handler.
- `renderOneExhibit`: title and caption become one `exhibit-lede` line.
- `nav.js`: a `why:` string per leaf, and `whyLeaf` / `whyGroup` helpers.
- Keyboard: roving tabindex, arrow and Home/End handling on both strips, and
  the `Alt+1…6` global.

Files: `web/src/main.js`, `web/src/nav.js`.

## Out of scope, deliberately

Three color sources sit outside `site.css` and will not follow it. They become
their own follow-up once the shell has been seen in the real app:

- `gt.css`, the static booktabs table look, fetched at runtime from
  `/v1/assets/gt.css` and served out of the `greater_tables` package.
- `csv-grid.css`, the interactive table view, from the npm package.
- `web/src/charts/theme.js`, the ECharts palette, still Bootstrap's own.

Also out of scope: the Reinsurance group's all-dark leaf row on a plain
aggregate (other work is in flight there), and the Perspective control.

## Checks

- `uv run pytest` stays green. Nothing here touches Python, so a red suite
  means something unrelated moved.
- `node dev/scripts/check-nav.mjs` over `dev/fixtures/capability.json` still
  prints the same leaf-by-kind grid. The `why:` strings are additive and must
  not change a single gate.
- By eye, against the Vite dev server, on: a plain Agg, a reinsured Agg, a
  Portfolio, a Severity (the near total grey wall), a Bivariate, and a P&L.
