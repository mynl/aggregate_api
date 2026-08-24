# Plan: the Examples dropdown reads the library in file order

Status: revised 2026-08-24 (second pass) after author review. Sections are out;
the flat file-order list with tag pills is in, `kind` is a pill, three colors,
no shading, filters persist.
Owner: API repo. The LIB half is two fields, planned in
`aggregate_REFACTOR/dev/plan-recipe-seq-and-as-read.md`.
Labels: `[Examples-File-Order]`, `[Examples-Tag-Pills]`, `[Examples-Fuzzy]`.

## 1. The problem

`library.agg` is written as a reading order, and inside each part the entries
build on one another. None of that reaches the app, because two independent
re-orderings sit between the file and the reader.

**The library sorts.** `Underwriter._recipes_frame` ends in `.sort_index()`, so
`build.recipes` arrives alphabetical by `(kind, name)`.

**The app re-sorts, then re-groups.** `aggregate_api/examples.py` groups on a tag
namespace, orders the groups by a hand kept `_TOPIC_ORDER` tuple, orders entries
inside each group by another `sorted()`, and title cases the group key in
`_title()`. The result is neither the file's order nor a teaching order, the
inner sort is Python's codepoint sort (so the curve block reads `CurveFrechet,
CurveGEV, CurveGPD, CurveGamma, CurveGenGamma`), `picks` and `tweedie` fall into
an alphabetical tail because nobody added them to `_TOPIC_ORDER`, and `bounds`
and `ruin` hold slots in it that no entry claims.

**And the app does not serve the file's text.** `_decl_of` runs every entry
through `spec_to_decl` then `format_program`, so the editor receives a canonical
re-render: `ph 2/3` arrives as `ph 0.6666666666666666`, `ceded to tower [0 25 50
75 100 125]` as five and-chained layers, `dsev [1:6]` as `dsev [1 2 3 4 5 6]`,
`sev (100 / exp(1.5**2/2)) * lognorm 1.5` as `sev 32.465246735834974 * lognorm
1.5`. Those spellings are what several of the entries exist to teach.

Under the purist ruling (author, 2026-08-10) the library owns meaning and the app
draws what it is served. Reading order is meaning; so is the source spelling of a
teaching example. Both are currently invented by the app or thrown away in
transit.

**Sections are not part of the fix.** The `# ---` banners in `library.agg` are
comments and stay comments. Making the parser read them would be exactly the
magic-comment coupling this repo is trying to get away from, so the new dropdown
has no headings at all and reads as one continuous list.

## 2. The target

One list, in file order, with richer rows and a fuzzy find. No headings, no
grouping, no ordering table anywhere in the app.

### The row

```
┌────────────────────────────────────────────────────────────┐
│ ExposureLimitProfile                                       │
│ A premium by limit by loss ratio profile, with the implied │
│ claim count computed for each band.                        │
│ ⟨agg⟩ ⟨aggregate⟩ ⟨advanced⟩ ⟨hero⟩                        │
└────────────────────────────────────────────────────────────┘
```

Three lines: the **name** in bold, the **note** wrapping in muted text, and a
row of **pills**. Nothing is right aligned, so the row has one clean left edge
and a long name never collides with anything.

`kind` is the first pill rather than a column of its own. Kind names are unique
against the tag vocabulary (`agg`, `port`, `sev`, `pnl`, `bvagg`, `distortion`
collide with nothing under `topic:` or `role:`), so the pill row reads as one
sequence with no prefix needed anywhere in it.

**Three colors, one per namespace, no shading within a namespace:**

| pill source | shown as | color |
|---|---|---|
| `kind` (from the recipe index) | `agg`, `port`, `sev`, `pnl`, `bvagg`, `distortion` | first hue |
| `topic:` | `aggregate`, `reinsurance`, `severity`, ... | second hue |
| `role:` | `intro`, `intermediate`, `advanced`, `reference`, `hero`, `published` | third hue |

`role:` levels and `role:` markers share one color: a reader who wants to know
which is which reads the word, and six values in one hue is not a legend anyone
has to learn.

That is now the whole vocabulary. The `check:` namespace was deleted from
`library.agg` on 2026-08-24, so every tag in the library is `topic:` or `role:`
and there is no third namespace to find a color for.

Colors must satisfy the palette rules in both light and dark, and a pill must
never carry meaning by color alone: the text inside it is the value, so a reader
who cannot separate the hues still reads `advanced`.

**Every pill is a filter and every filter is a pill.** Clicking `advanced` and
then `reinsurance` shows their intersection, in file order. A filter bar above
the list shows what is active with a control to clear it. There is no separate
facet UI to design, learn, or keep in sync with the pills.

Active filters **persist**, per viewer, in `localStorage`. Every read and write
is wrapped in try/catch and the list renders correctly with nothing stored, so a
private window, cleared site data, or a browser that blocks storage costs a
filter, not a menu.

### The order

The file, always. Filtering hides rows and never reorders what remains, so a
reader who has learned where something lives keeps that knowledge with a filter
on. Searching is the one exception, because a ranked result that keeps file
order is not ranked.

### Why a flat list works now

The role vocabulary landed in `library.agg` on 2026-08-24 and covers the library
with no leftovers. Every entry carries exactly one level (`intro` 32,
`intermediate` 38, `advanced` 47, `reference` 34) plus optionally `hero` (7) and
`published` (20). Before that, `role` was sparse enough to need an "other"
bucket, which is why the menu grouped on `topic` instead. A pill row is only
worth building because every row now has one.

151 entries at three lines each is a long menu, and it is meant to be: the
dropdown is for browsing in reading order, and Ctrl+K plus the search box is for
finding. That is the split the menu already has; this only fixes the browse half
so it shows the library's own order.

## 3. Upstream: two fields, planned separately

`aggregate_REFACTOR/dev/plan-recipe-seq-and-as-read.md` covers both. In short:

* **`Recipe.seq`**, the zero-based as-read order, plus a `seq` column on
  `recipes`. The data exists; only `_recipes_frame`'s terminal `.sort_index()`
  discards it. The frame keeps its alphabetical default and the API says
  `recipes.sort_values('seq')`.
* **`Recipe.as_read`**, the entry's DecL exactly as written, multi-line, comments
  stripped. `''` for a session build.

`as_read` is what removes the re-render table in section 1, and it removes it
completely, because it never round trips through the spec. It is therefore also
why this plan does **not** wait on clause provenance: with `as_read` the dropdown
is correct whether or not `format_program` ever learns to invert `1_000`, `2/3`,
`tower [...]` or `[1:6]`. That work is worth doing for `Recipe.decl`, the `.agg`
export in `routes/objects.py` and the cookbook pages, and it is tracked upstream
under `[Unparser-Reference-Gaps]`.

## 4. API phases

### A1: response shape

`GET /v1/examples` returns one flat, file-ordered list plus a facet index. The
`group` query parameter is retired: the API is pre-release and private, so this
is a clean break rather than a deprecation.

```jsonc
{
  "items": [
    {
      "name": "ExposureLimitProfile",
      "kind": "agg",
      "note": "A premium by limit by loss ratio profile, with the implied claim count computed for each band.",
      "decl": "agg ExposureLimitProfile\n  [10_000 20_000 5_000 5_000] premium at ...",
      "tags": ["topic:aggregate", "role:advanced", "role:hero"],
      "pills": [
        {"ns": "kind",  "value": "agg"},
        {"ns": "topic", "value": "aggregate"},
        {"ns": "role",  "value": "advanced"},
        {"ns": "role",  "value": "hero"}
      ]
    }
  ],
  "facets": {
    "kind":  [{"value": "agg", "count": 94}, ...],
    "topic": [{"value": "aggregate", "count": 27}, ...],
    "role":  [{"value": "intro", "count": 32}, ...]
  }
}
```

`pills` is the render-ready form, already ordered kind, then topics, then roles,
so the SPA renders it as given and the namespace-to-color mapping has exactly one
authority. `tags` stays as full slugs for the search haystack and for anyone
consuming the API directly; `kind` stays as its own field because it is the
recipe's type, not a tag, and a client that wants it without parsing pills should
have it.

No `level` flag is needed on a pill, because nothing shades by level.

The three facet keys are exactly the three pill namespaces, and each facet value
list is ordered by first appearance in the item list, so the filter bar reads in
file order too rather than alphabetically or by count.

Each entry appears **exactly once**. The current payload emits an entry once per
topic tag, 182 rows for 151 entries, purely to feed the grouped view.

Optional repeatable `kind=`, `topic=`, `role=` filter server side, OR within a
facet and AND across facets. The SPA does not use them, because the whole payload
is 151 entries fetched once and filtering in the browser is instant; they exist
so a notebook user can say `GET /v1/examples?role=intro`.

`ExamplesResponse` keeps its name; `ExampleCategory` is replaced by `Pill` and
`FacetValue`.

### A2: deletions

With order served and grouping gone, the app's ordering machinery goes with it:

* `_TOPIC_ORDER`, `_ROLE_ORDER`, `_UNGROUPED`, `_GROUP_TITLES`, `_KIND_TITLES`
* `_title()`, `_sort_key()`
* both `sorted(...)` calls in `load_examples` and `load_heroes`
* the `Grouping` literal and its `lru_cache(maxsize=len(Grouping.__args__))`

Around 70 lines, and with them every place the app decides what the library
means. `load_examples` becomes: walk `recipes.sort_values('seq')`, build items,
count facets, return. `_namespace_values()` survives, repurposed to build `pills`.

`load_heroes` keeps `discover(tags='role:hero')` and drops its name sort; heroes
come back in file order too.

### A3: `_decl_of` serves `as_read`

`_decl_of` returns `recipe.as_read` when non-empty. The `spec_to_decl` then
`format_program` pair stays as the fallback for a session-built entry, which
never had a file, and that path keeps the existing docstring about
`trailer=True`.

Accept deliberately: a library entry now arrives in the editor with the file's
own layout, including the hand-written entries the unparser cannot invert. That
is the point.

### A4: SPA rendering

`web/src/examples.js`:

* `renderList` renders `payload.items` in order, with no headers and no dividers.
* `row()` emits three lines: `.example-name` (bold), `.example-note`, and a
  `.example-pills` row of `<button class="pill pill-kind|pill-topic|pill-role">`
  elements built straight from `item.pills`.
* A pill click toggles that `(ns, value)` in the active filter set. A filter bar
  above the list renders the active pills, in the same colors, each with an x,
  plus a clear-all control.
* Filtering is a `filter()` over the item list, order preserved. Within a
  namespace the active values are OR'd, across namespaces AND'd, which is what
  makes "advanced reinsurance" and "intro or intermediate" both expressible.
* The filter set is written to `localStorage` on change and read on mount, both
  in try/catch, and an unreadable or absent value means no filters.
* `buildIndex` stops deduplicating by name, because the payload no longer repeats
  entries.
* The hardcoded `186` goes, in the line 4 comment and the line 142 placeholder.
  It has been wrong since the library was 160 and it is 151 now. Use the payload
  length.
* Ctrl+K inherits all of it: it renders through the same `renderList`. It shares
  the persisted filter set, so a filter set in the dropdown is still on in the
  palette, which is one surface's worth of state rather than two.

`web/src/styles/site.css`: `.pill` plus `.pill-kind`, `.pill-topic`,
`.pill-role`, defined as tokens on `:root` with dark-mode overrides, and the
three-line row layout.

### A5: search, fzf style

The requirement is fuzzy matching over name, tags and note with the terms in
**any order**, so `"reins tower"`, `"tower reins"` and `"advanced tower"` all
reach `ReinsuranceOccurrenceTower`.

uFuzzy 1.0.19 is already a dependency and already supports this. Its signature is
`search(haystack, needle, outOfOrder = 0, infoThresh = 1e3, preFiltered)`, and
the third argument is documented as "limit how many terms will be permuted,
default = 0; 5 will result in up to 5! (120) search iterations. be careful with
this!". The current call in `examples.js` passes only the first two, which is why
terms must appear in order today. **Try this first**: it is one argument,
`uf.search(haystack, q, 4)`, and 4! = 24 passes over 151 rows is nothing.

If the ranking disappoints, swap to the `fzf` npm package, a real port of fzf's
matcher and scorer with the same tiebreaks (consecutive-character bonus,
word-boundary bonus, shorter-match preference). It is the honest answer to "fzf
style if possible" and costs one small dependency. Decide by trying uFuzzy's
`outOfOrder` on the real payload rather than in the abstract.

The haystack keeps its shape, `name + kind + tags + note`, with tags in full slug
form so both `reinsurance` and `topic:reinsurance` match. Search results are
ranked, not file-ordered, and the header says how many matched, as now.

Search composes with pills: pills narrow the set, search ranks within what is
left. A search that returns nothing while filters are on says so and offers to
clear them, because an empty list with an invisible cause is the one bad state
this design can reach.

## 5. Order of work

LIB first, then API, the same sequencing the 3D plan settled on and for the same
reason: the app has nothing to read until the fields exist.

1. LIB `[Recipe-Seq-As-Read]`, both fields.
2. API A1, A2, A3 together; one edit to `examples.py` and `models.py`.
3. API A4, the row, the pills, the filter bar, persistence.
4. API A5, search. Independent of 1 to 3 and can land first if it is wanted
   sooner.
5. API `CLAUDE.md`, "Relationship to aggregate": record `Recipe.seq` and
   `Recipe.as_read` on the sanctioned import surface.

## 6. Settled, and what is left open

Settled by the author on 2026-08-24:

* `kind` is the first pill, in its own color, not a right-aligned column.
* Three colors, one per namespace, no shading inside a namespace.
* `check:` tags are deleted from the library, so there is no fourth namespace.
* Active filters persist.

Open, and small enough to settle in review of the first build:

1. **Does the pill row wrap or truncate?** An entry with four pills fits a narrow
   dropdown; the widest today is four. Wrapping is the safe default and costs a
   fourth line on a few rows. Truncation would need a "+2" affordance, which is
   more machinery than the case deserves.
2. **Does the note truncate?** The longest note in the library is the
   `CommAutoMixedExponentialSev` citation at roughly 300 characters, which is
   five or six lines in a dropdown. Clamping to three lines with the full text in
   the `title` attribute keeps the list scannable; the Ctrl+K palette is wide
   enough to show it whole.
3. **Should the filter bar show counts?** `advanced 47` tells a reader what a
   click will do before they click it. The counts are already in `facets`, so
   this is presentation only, and it is worth trying both ways once there is
   something to look at.

## 7. Execution log

Executing 2026-08-24 against `aggregate 1.0.0a320`, which shipped the LIB half
(`[Recipe-Seq-As-Read]`, its own execution log in
`aggregate_REFACTOR/dev/done/plan-recipe-seq-and-as-read.md` carrying nine
divergences, none of which change what this consumes). Verified before starting:
151 entries, roles `intro` 32, `intermediate` 38, `advanced` 47, `reference` 34,
plus `hero` 7 and `published` 20; namespaces exactly `topic:` and `role:`, no
`check:`; `as_read` non-empty for every library entry, keeping the trailer where
the file put it (`BasicPortfolio` after the name, before the first unit), keeping
`ph 2/3` and `ceded to tower [...]`, and keeping all sixteen `hints{}`.

### Author rulings taken in review, 2026-08-24

1. **The kind pill collides with two topics, and both pills ship.** Section 2
   claims kind names "collide with nothing under `topic:` or `role:`". They do:
   `topic:pnl` sits on all eight `pnl` entries and `topic:distortion` on all six
   `distortion` ones, so fourteen rows spell the same word twice in two colors,
   which is what the plan's own no-color-alone rule was written against. Ruled:
   ship what is there, the redundant tags come out of `library.agg` later.
2. **Three low-saturation chip tints**, new `:root` tokens: neutral slate for
   kind, muted indigo for topic, muted bronze for role, all clear of `--house`,
   `--ok`, `--warn` and `--bad` so no chip reads as a state signal.
3. **Light-only tokens.** `site.css` has no dark mode at all, no
   `prefers-color-scheme` block and no `data-bs-theme`, so section 2's
   "dark-mode overrides" has no target and the pills are not the place to
   introduce the page's first one.
4. **The Ctrl+Shift arrow ring walks the filtered list**, matching its own
   stated contract, the dropdown read top to bottom.

### A1 to A3, `1.0.0a122`

Divergences:

1. **The minimal SPA read change ships with the payload change**, rather than
   waiting for A4. Section 5 sequences A1 to A3 as one step and A4 as the next,
   which would leave one commit whose Examples menu reads `payload.categories`
   against a payload that no longer has any, so the menu would be empty for a
   commit. Pulled forward: `examples.js` renders `payload.items` with no headers,
   `buildIndex` stops deduplicating, the `186` placeholder reads the payload
   length, `api.js` loses its `group` argument and the ring in `main.js` walks
   `data.items`. The pill row, the filter bar, persistence and the search are
   still A4 and A5.
2. **The ring in `main.js` is not in the plan and had to change.** A4 lists
   `examples.js` only. `main.js` built the Ctrl+Shift arrow ring by walking
   `data.categories`, so it would have gone empty.
3. **Heroes are ordered by `Recipe.seq` read per entry, not by sorting the
   frame.** The LIB plan says "`discover` gains nothing; it filters the frame and
   inherits both columns", which is false for the path this uses:
   `discover(tags=...)`'s lightweight directory route returns a name-indexed
   frame carrying `program` and nothing else, so there is no `seq` column on it.
4. **`facets` counts the entries returned, not the whole library.** Section 4
   does not say which, and counting the return keeps a filtered payload self
   describing: the counts always add up to what the caller can see.
5. **`filter_examples` is a separate function from `load_examples`.** The plan
   describes the filters as a property of the route. Keeping the loader cached
   and unfiltered, with filtering applied to the cached payload per request, is
   what lets `lru_cache(maxsize=1)` stand; the payload and its items are shared,
   so the filter copies the list and never mutates.
6. **`load_examples` raises rather than falling back when `seq` is absent.** An
   `aggregate` older than 1.0.0a320 has no reading order to serve, and a
   `KeyError` out of `sort_values` says nothing useful.
7. **Two other test files read `categories`** and are updated with the payload:
   `test_library.py::test_the_menu_reads_the_same_library` and
   `test_sessions.py::test_the_menu_survives_a_session_overwriting_a_library_name`.

Measured while writing the tests, for the open questions in section 6: the
widest pill row is **five**, not four (`BodoffFour` and `DiscretePortfolio`, both
`port`, each carrying three topics), and the longest note is
`CommAutoMixedExponentialSev` at 320 characters. Every entry carries a note.

Also noted, no action: the `test_examples_group_by_role` failure was already
there before this work, because `role:` now covers the library and the "other"
bucket it asserted on is empty. It is deleted with the grouped view.

### A4, `1.0.0a123`

Open questions 1 to 3 of section 6, settled by building them the way the plan
names and leaving them visible for review:

1. **The pill row wraps.** The widest row carries five, not the four the plan
   estimated (`BodoffFour` and `DiscretePortfolio`, both `port` with three
   topics), which only strengthens the case: a "+2" affordance for two rows is
   more machinery than the case deserves.
2. **The note is clamped to three lines with the whole text on `title`**, and
   the clamp comes off in the palette, which has the width for it.
3. **The filter bar shows counts**, one per active pill, off the payload's
   facets.

Divergences:

1. **The bar also carries a running "47 of 151".** The plan's question 3 argues
   counts by "`advanced 47` tells a reader what a click will do before they
   click it", which is the argument for a facet browser; the bar shows what is
   already on, where the useful number is what the combination left. Both are
   presentation off numbers the payload already carries, so both are there.
2. **The pills sit outside the row's anchor**, as siblings inside the `<li>`,
   which is now the row. A `<button>` nested in an `<a>` is neither valid nor
   clickable, since the link swallows the press. The `<li>` highlights as one,
   so the row still reads as a row.
3. **`applyFilters` is a separate pure export** from `filteredExamples`. The
   plan describes the filter as a `filter()` in the render path. Splitting the
   composition rule out is what makes it testable with no DOM, and OR within a
   namespace against AND across them is exactly the rule worth pinning: both
   failure modes read as a wrong list rather than as an error.
4. **`web/test/example-filters.test.js` is new**, ten cases. The plan names no
   app-side test for A4.
5. **The menu is 20px wider**, `min-width` 340 to 360 and `max-width` 460 to
   480, for the pill row.
6. **`main.js` keeps only the ring's cursor**, dropping `exampleRing.items`
   entirely, and subscribes to the filter set to reset it. Holding a copy of the
   list would make the walk and the menu two lists that agree until someone
   clicks a pill.

### A5, `1.0.0a124`

**uFuzzy's `outOfOrder` is enough, so the `fzf` port is not needed.** The plan
says to decide by trying it on the real payload rather than in the abstract, so
that is what happened, over the shipped 151 rows with the live haystack:

| needle | ordered | permuted |
|---|---|---|
| `reins tower` | 5 | 6 |
| `tower reins` | 3 | 6 |
| `advanced tower` | 5 | 6 |
| `cat xol` | 1 | 2 |
| `lognorm poisson` | 0 | 1 |
| `poisson lognorm` | 1 | 1 |
| `mixed severity` | 3 | 4 |
| `severity mixed` | 4 | 4 |
| `porfolio` | 21 | 21 |

No query lost a result, the pairs that should agree now agree, and
`ReinsuranceOccurrenceTower` ranks in the top two of every tower query either
way. Timing: every query inside 3ms, most of them faster permuted than ordered,
because uFuzzy's out-of-order path prefilters. Nothing about the ranking
disappoints enough to earn a dependency.

Divergences: none. The change is the one argument the plan predicted, held in a
named constant with the measurement recorded beside it.

Also in this bump, plan section 5 item 5: `CLAUDE.md`'s "Relationship to
aggregate" records `Recipe.seq` and `Recipe.as_read`, and now says outright that
its list is not the whole surface, pointing at the audited one in
`T:/worktrees/CLAUDE.md`. The oversight charter has flagged that understatement
since 2026-08-11; correcting the list in full is an oversight task, not this
plan's, so this adds the pointer rather than the audit.

## 8. Closed

All five phases landed, `1.0.0a122` to `1.0.0a124`, against `aggregate
1.0.0a320`.

**Owed upstream, and the one thing that outlives this plan.** `topic:pnl` sits
on all eight `pnl` entries and `topic:distortion` on all six `distortion` ones,
so fourteen rows draw the same word twice in two colors. The author is removing
the two tags from `library.agg` (ruling 2026-08-24). Nothing app side changes
when they go: the pills are built from what is served, the facets recount
themselves, and the two topic values simply stop appearing.
