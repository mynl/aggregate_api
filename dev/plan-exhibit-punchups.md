# plan-exhibit-punchups: the author's first look at the a21 Overview

Status: **done** (1.0.0a22).

## Why

a21 shipped the exhibit without anyone having seen it render (the browser
extension was not connected). The author's first inspection produced a list.
Chasing one item on it turned up a race that was breaking the landing page.

Confirmed working, no action: the per-unit portfolio series and the shared
legend toggle, the P&L downside panel running off `F`, the stacking breakpoint,
and hero cards building on click.

## What landed

### The race (the item that matters)

Not on the author's list. Found because the exhibit smoke test failed on a cold
server and passed on a warm one, which is the shape of a race rather than a bug.

`unit_density_df` and `tail_df` fetched together for one Portfolio raised
`KeyError: "['F', 'S'] not in index"` roughly half the time on a cold object.
Bisected: sequential fetches always pass, concurrent ones fail cold, across
repeated fresh server starts. The exhibit fetches them in one `Promise.all`, and
a hero portfolio auto-builds on load, so this was reaching the front page.

Cause: an `Aggregate` / `Portfolio` materializes frames lazily and caches them on
the instance, so a first read is a write; FastAPI runs sync handlers in a thread
pool, so two requests for different frames of one object are two threads racing.

Fix: `CacheEntry.lock`, and the eighteen object-reading routes take their entry
from a `_locked_entry` yield-dependency that holds it for the request. Chosen
over wrapping each handler body because it makes the guarantee structural rather
than something every future handler has to remember. Per entry, so unrelated
objects still serve in parallel.

Two things worth writing down:

- The dependency must be a **bare generator**. Wrapping it in `@contextmanager`
  fails with `'_GeneratorContextManager' object is not an iterator`, because
  FastAPI drives a yield-dependency as an iterator itself.
- The mechanical route conversion was scripted, and the first attempt rewrote
  the file's line endings, turning a 50-line change into a 1300-line diff. Redone
  reading and writing bytes. Worth remembering for any future sweep over this
  repo's CRLF files.

### Two 500s that should have been 422s

`xpnl` over a portfolio (`NotImplementedError`) and an unresolved `port.X`
reference (`KeyError`) both fell through to the catch-all. Both are statements
about the program and both already carry a good message from the library. Now
422s. `str()` on a `KeyError` re-quotes its argument, so the detail is read from
`args[0]`.

Flagged by the author as "pnls with ports fail"; `pnl` over a portfolio is in
fact fine and now has the regression test it lacked.

### Control row

Four toggles, all four the author selected, sticky per browser: **log y**,
**survival** (right panel transposed), **full x**, **reference lines** (mean and
the 1-in-200 anchor). Each exhibit declares which it honors.

`dataZoom` `filterMode` `none` to `filter`, so the y-axis rescales on zoom.
Without that the zoom worked and was useless.

### Square aspect

Distortion and bivariate both draw a square plot area. The author's point stands
on its own: a g(s) curve is read for concavity, and a stretched aspect ratio
misrepresents exactly that.

### Trims

The Overview program disclosure and hints line are gone (both repeat the editor
directly above). Exhibit titles are `Summary` and `Tail risk`; captions stay,
since unlike the titles they carry content.

## Verified

- `uv run pytest`: 84 passed, including three new tests for the 422 cases.
- `node dev/smoke-exhibits.mjs` cold: all six kinds build cleanly.
- The race: four fresh cold starts, four passes, against roughly 50% failure
  before.

Still not verified: **how any of it looks.** The browser extension is not
connected in this environment, so no rendered chart has been inspected. The
`dev/TODO.md` eyeball item stands.

## Open

The author reported no examples filtering, which is correct: that is the next
stage, not a defect.
