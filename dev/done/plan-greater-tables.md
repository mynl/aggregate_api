# plan-greater-tables: a second static renderer, alongside the first

Status: **done**, landed as `1.0.0a31`.

## The ask

> i am also interested in using my greater_tables package for the "nicely"
> formatted static tables. i like how it produces tables. it provides a
> self-contained blob of html with needed css that presumably can be injected.

and, after the first plan proposed replacing the built-in tables:

> pls don't throw away the current approach. tack on GT then we can decide which
> route to take. This is like the graphics engine switch, but not switchable.

## Why it is worth having

Not that it is prettier. `serializers.py` flattens MultiIndex columns to dotted
strings and resets the row index into ordinary data columns. Right for a grid,
lossy for a printed exhibit: `port.summary_df` and `port.tail_df` both carry a
**two level row index**, so a unit name is currently reprinted on all ten of its
return-period rows. `sparsify=True` prints it once per block.

That can only happen where the real DataFrame still exists, so this renders
server side and the route reads the frame, never the payload. The test asserts
exactly that: `html.count(">A<") == 1`.

## Constraints, read from the source

All three are load bearing and none are in the README:

- **`tikz` defaults to `True`**, computing LaTeX output that a web request throws
  away. Always `tikz=False`.
- **`GT` raises above 50 rows** (`core.py:142`) unless `large_ok=True`. Not a
  warning. A six unit portfolio's `tail_df` is 70 rows.
- **The CSS is scoped to `#{df_id}`**, a content hash of the frame, with only
  `.greater-table` global. That is what makes the blob injectable, and a test
  asserts no bare `table {` / `td {` / `th {` / `tr {` selector escapes.

A density frame is 65,536 rows and is refused with a 422. It stays CsvGrid's job
permanently, and `MAX_ROWS` says so out loud rather than letting someone discover
it with a minutes-long render.

## The dependency

Plain `greater-tables>=5.3` from PyPI, **no `[tool.uv.sources]` override**. The
local checkout carries a stale `7.2.0` dist-info but its `__version__` is 5.3.0,
and `core.py`, `config.py`, `utilities.py` and `__init__.py` are byte identical to
the published wheel. So there is nothing to co-develop against, and the repo stays
installable anywhere. If that changes, add an editable source the way `aggregate`
has one.

It brings in beautifulsoup4, cachetools, latexcodec, markdown-it-py, mdurl,
pybtex, rich and soupsieve. Acceptable for a private project, worth knowing.

## Row emphasis

The first plan claimed this would be lost. The author corrected it, and the
correction was right: `greater_tables` passes markup in a cell straight through.
`core.py:1082` and `1092` emit `<td class="...">{c}</td>` with no escaping, and
`clean_html_tex` only rewrites `$...$` into MathJax delimiters.

The implementation still does **not** use cell markup, for a reason worth
recording. `cast_to_floats` is what earns the number formatting and the right
alignment, so a numeric column carrying `<b>1,234</b>` fails the float cast and
the whole column drops to unformatted left-aligned strings. So the emphasis is a
class on the `<tr>`, added by a short bs4 pass. bs4 is already a `greater_tables`
dependency, so this needed no upstream change.

The mapping is positional and verified rather than assumed: a 30 row `tail_df`
emits 30 `<tbody>` rows. When the counts disagree the pass returns the html
unmarked, because a table with no emphasis beats a table with misplaced emphasis.

## Alongside, and not switchable

`renderExhibit` stays and stays the default. GT is reached by `?tables=gt`
(`?tables=native` to go back), sticky per browser, with no user-facing control.
The highlight color is deliberately the same `#fff7e6` as the built-in table, so
the comparison is about structure rather than about a different shade of yellow.

The fetch runs alongside the JSON frames rather than instead of them, so the
Static / Interactive toggle still swaps without another round trip, and a failure
falls back to the built-in table rather than to nothing.

## Verification

`uv run pytest` 97 passed, five of them new. `ruff check src` clean.
`npm run build` clean.

Not verified: how it looks. That is the comparison this stage exists to enable and
it has not been made by anyone yet.

## Deferred

The Price tab. `PriceResponse`, `ReinsPriceResponse` and `PricingResponse` carry
*computed* frames from POST endpoints, so the generic `frame/{which}.html` route
cannot reach them. They would need html returned alongside the json so the toggle
stays instant without a re-POST.
