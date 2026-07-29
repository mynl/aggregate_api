# plan-relink-library: catch the api up with aggregate a148 to a174

Status: **done** (1.0.0a19).

Stage 1 of the "aggregate Loss Library" work. Backend only, plus the minimum
frontend edits needed to keep the app working across the payload change. It
unblocks every later stage: nothing else can be built while `/v1/examples` 500s.

## Why

`aggregate` moved a long way between 1.0.0a148 and 1.0.0a174: the recipe layer
(`tags{}`, `doc{{{}}}`, `Recipe` as the library entry, `build.recipes`,
`discover(tags=)`), one merged `library.agg` with namespaced tags, and a declared
first-class-citizen contract in `aggregate.constants` whose stated membership
test is "DecL creatable **and** flows through to the aggregate_api SPA". The
library is now designed around this app. The app was still reading a file that
no longer exists.

Three things were measurably broken, verified against the live environment:

1. `examples.py` read `agg/examples.agg`, deleted at a159. `/v1/examples` 500ed,
   which killed the dropdown and the hero gallery.
2. `agg_m` / `agg_cv` (a149), `validation_explanation` (a172) and
   `Underwriter.knowledge` (a164) had all been renamed underneath us. The first
   blanked the summary line's mean and CV, the second would have printed a
   paragraph where a two-word verdict belongs, the third raised
   `AttributeError` on every `form=agg` session download.
3. The editable install reported `1.0.0a148` while the code was at a174, so the
   About panel lied. `uv sync` fixed it.

## What landed

### `examples.py`, rewritten

Deleted: `_CONTENTS_LINE`, `_ITEM_LINE`, `_NOTE`, `_load_contents`,
`_load_items`, `_read_suite_text` and the `UnderwritingLexer.preprocess` call.
The module is now a walk over `build.recipes` resolving each entry through
`build.recipe(name, kind)`.

- `GET /v1/examples?group=topic|kind|role`, default `topic`. Multi-tagged
  entries appear under each of their groups. Group order is teaching order for
  topics and prominence for roles, with an `other` bucket that always sorts last.
- `GET /v1/examples/heroes` = `build.discover(tags='role:hero')`. Plural `tags`:
  the singular used to bind into `**kwargs` and silently return all 186 rows,
  which a173 turned into a `TypeError`.
- `_library_only` drops `source == 'session'` rows from both. The api shares the
  `build` singleton, so without it a user's own programs joined the menu.
- `_decl_of` prefers `Recipe.decl` and falls back to the stored program with the
  `doc` / `note` / `tags` clauses trimmed, keeping `hints`. Needed for
  `MinimumDistortion`, whose spec holds constructed `Distortion` objects that
  `spec_to_decl` cannot render, so its `decl` is `''`.
- `AGGAPI_EXAMPLES_FILE` still works, now by pointing a private `Underwriter` at
  the file through `databases=` so a curated library goes through the same
  recipe machinery as the shipped one.

### `bivariate` becomes `bvagg`

The standing rule is that where the api and the library disagree on a name, the
library wins. `_classify_object` is a table keyed on class name, seeded from
`FIRST_CLASS_CLASSES` + `NEAR_FIRST_CLASS`, with an import-time warning when
upstream adds a first-class class the api has no kind for. `Distortion` and
`Severity` arrive as subclasses, so those two flatten via `isinstance`.

### `sev` is buildable

The merged library ships 13 `sev` entries the menu now offers. A `Severity`
carries `info`, `plot` and the metadata surface and none of the frames, so every
frame route answers 400 and `NA_TABS_BY_KIND` greys out the frame tabs.

### `GET /v1/objects/{id}/meta`

`note` / `tags` / `hints` / `program` / `pprogram`, one route for all six kinds,
every member read through `getattr`. Never serves `doc`.

## Verified

`uv run pytest`: 77 passed. Live server on :8011:

- `/v1/examples` returns 10 topic groups over 206 item slots (186 entries, the
  multi-topic ones counted twice); `?group=kind` returns all six kinds.
- All 8 heroes build end to end, with the right kinds (3 agg, 3 port, 1 bvagg,
  and `BodoffWindQuake` as a port).
- Each of the six kinds builds, reports its kind, and answers `/meta`.
- `/v1/health` reports `aggregate_version 1.0.0a174`.

## Found on the way, for upstream

Reported rather than worked around:

1. **Two hero portfolios carry their `note{}` in the wrong place.**
   `TwoLineBook` and `BodoffWindQuake` both write the note *after* the last unit,
   where the positional rule binds it to that unit rather than to the portfolio.
   (The a172 notes spell this out: a port's trailer goes right after the name.)
   Both are `role:hero`, so the effect is visible: a blank tooltip on the landing
   gallery and a blank Overview lead for two of the eight showcase entries.
2. **`DefectivePareto` carries no `topic:` tag**, only `role:paper`. It is the
   sole occupant of the `other` bucket in the topic view.
3. **`Recipe.decl` is empty for `MinimumDistortion`.** `spec_to_decl` has no case
   for a composite distortion whose spec holds constructed `Distortion` objects.
   Worked around here with the stored-program fallback.

## Follows on

For the ECharts exhibit stage: a `Portfolio.density_df` carries `p_total` and the
per-unit *allocation* columns (`exa_*`, `lev_*`, ...) but **no** per-unit
densities. Those live on the unit `Aggregate`s, reachable as `port[unit]`, and
they are on the same grid (verified: 65,536 buckets, identical `loss` arrays,
same `bs`). A per-unit density route will have to assemble them.
