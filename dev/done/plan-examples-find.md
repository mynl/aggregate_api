# plan-examples-find: make 186 examples findable

Status: **done** (1.0.0a24). Stage 4 of the aLL work.

## Why

a19 replaced the letter categories with topic groups, which was the right
structural move and did nothing for retrieval. The author, on first use: *"no
filtering on examples yet, right? if there is i don't understand it."* Correct,
and the answer to a 186-entry menu is search, not more grouping.

The hero cards were also still showing hash-seeded gradient rectangles, agreed
at planning time to become real thumbnails.

## What landed

### One list, two surfaces

`web/src/examples.js` builds a flat index once (each entry appearing exactly
once, keyed by name, since a two-topic entry appears in two groups) and renders
it into either:

- the **dropdown**, grouped by topic, with a pinned search box focused on open;
- the **`Ctrl+K` palette**, the same rows full width with the note unclipped.

Both share `renderList`, so they cannot drift.

### Matching

`@leeoniya/ufuzzy`, ~5 kB gzipped, over `name + kind + tags + note`. Chosen for
size and for out-of-order terms; `csv-grid` has zero runtime dependencies and
exports no matcher, so there was nothing to reuse.

`intraMode: 1` tolerates a single-character typo inside a term, which is what
makes "porfolio" and "distorton" still land. Tags keep their namespace so
`topic:reinsurance` and `reinsurance` both match, and the note is in the
haystack so a search can be about the subject rather than the name.

Two decisions worth recording:

- **Typing switches to a flat ranked list.** A search result is already ordered
  by relevance; re-grouping it would scatter the best matches down the page.
- **Search keystrokes are stopped from propagating.** Bootstrap's dropdown
  handler otherwise steals the arrow keys and closes the menu on Escape, which
  makes the box unusable mid-word.

### Hero sparklines

`GET /v1/examples/heroes/sparklines` returns `{name: [48 floats in 0..1]}`, the
density binned and peak-normalized. Rendered as an inline SVG polygon plus
polyline, not an ECharts instance: eight charts for eight thumbnails would cost
more than the exhibit itself.

Two things that are load bearing:

- **Separate endpoint, called after first paint.** It builds every hero and
  `CatXOLTower` carries `hints{log2=16}`, so a cold call costs seconds. Cards
  mount on their placeholder gradient and upgrade in place. A hero that fails to
  build keeps its gradient rather than blocking or erroring. Nothing on the
  landing path may wait on this.
- **Sums into buckets, does not sample.** On a spiky discrete support, sampling
  every n-th point lands between the atoms and returns zeros, so a dice book's
  thumbnail would be a flat line.

## Verified

`uv run pytest` 86 passed, including four new cases: the sparklines are
peak-normalized, the right length, not flat, keyed to real heroes, and cached.
`ruff` clean. Bundle builds; app chunk 28.8 to 34.1 kB gzip.

Not verified: appearance, as with every stage so far. In particular the palette
and the dropdown search box have never been opened by a human.

## Follows on

The hamburger still carries a greyed-out "Example source…" placeholder from a17.
There is no longer a set of sources to switch between (a159 merged them), so it
should either be retired or repointed at the `?group=topic|kind|role` axis.
