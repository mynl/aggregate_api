# Plan [Plot-2D-Window-Leak]: the surface's sticky window poisons every 2-D chart fetch

> **Status: EXECUTED at a92, 2026-08-12.** All three parts landed as written:
> F1 the per chart `windows` map and the v3 to v4 migration, F2 the retry and
> the honest failure pane, F3 the `request-params.js` leaf and its eight node
> tests. App repo only: no LIB work, no wire change, no round note. The server
> route behaved exactly as designed and stays untouched; the client was the
> offender.
>
> Two notes from execution, neither changing the design. The line references
> below had drifted (`VIEW_KEY` is at 52, `VIEW_DEFAULTS` 54, `windowBox` 329,
> `chartParams` 658, the two call sites 638 and 1177, the `spec` gate 1117);
> and the pinned 422 contract is `tests/test_objects.py:1121`, `detail` refused
> on `agg` with the bare URL serving 200, rather than `:1071`, which pins the
> parameter bounds. F2 needed one decision the plan left open: `mountChart`
> tells its callers which failure it was by throwing on an exhausted fetch,
> leaving a null to mean the served document carries nothing drawable.

## The symptom

Every 2-D chart (agg, port, severity, distortion, reins) comes up as "This
chart is not published by the library yet." on every object, while the joint
surface still draws. So it presents as the 2-D charts breaking while the 3-D
one works, which is what made it look like a pathway problem rather than what
it is: one held request parameter.

## The diagnosis (verified on the wire, 2026-08-12)

The chain, four links:

1. **The window box writes global state.** `windowBox` (`mount.js:337`) is
   offered only while a surface realization is on screen (the a79 to a82
   work), but it writes `view.window` into the one flat sticky view state,
   `aggapi.chartView.v3` in localStorage, which every chart on every object
   shares and which survives reload by design.
2. **Every fetch sends it.** `chartParams()` (`mount.js:549`) attaches
   `{window}` whenever `view.window` is finite, and both call sites use it:
   the first fetch in `mountChart` (`mount.js:529`) and `refetch`
   (`mount.js:942`). Nothing gates it on the chart being a grid chart, even
   though `api.js:108` already documents the params as "the grid charts'
   knob".
3. **The route refuses it, on purpose.** A chart whose emitter takes none of
   the grid options answers 422 naming what was sent
   (`routes/objects.py:2254`, the TypeError catch at `:2272`), and
   `tests/test_objects.py:1071` pins that contract. The contract is right and
   it did its job: it named the offender precisely.
4. **The app reports the refusal as a library gap.** `mountChart`'s bare
   catch returns null (`mount.js:533`), and `loadOverviewPlot` renders
   `notDrawable()` (`main.js:1612`), whose default text claims the library
   publishes nothing. A held view state therefore reads as an upstream hole.

Verification: with no parameters, every chart route serves healthy `xy`
documents (agg, port, severity, distortion, reins all 200) and the same
documents realize in the pure adapter under node. Setting
`{"window": 8}` into `aggapi.chartView.v3` reproduces the exact symptom in
the browser (observed `GET /v1/objects/{id}/chart/port?window=8` answering
422, pane showing the "not published" text); removing the key restores every
chart. The deployed site (api a71) predates the window box and is unaffected.

## Immediate unblock, no code

On the affected origin, open a surface chart and blank the window box (empty
means auto), or in devtools remove the `window` key from the
`aggapi.chartView.v3` localStorage entry.

## The fix, three parts

**F1: scope the window to the chart that offered it.** The window is a grid
chart's request parameter, not a document reading, so it does not belong in
the flat reading state at all. Move it to a per-chart map:

- `VIEW_DEFAULTS` (`mount.js:78`) loses `window`; add `windows: {}`, keyed by
  chart registry name.
- `windowBox` reads and writes `view.windows[spec.chart]` (its initial read
  is `mount.js:347`; `spec` is in reach through `draw`'s closure, and the box
  is only built when `spec` exists, `mount.js:890`).
- `chartParams(spec)` returns `{window}` only when `view.windows[spec.chart]`
  is finite; both call sites pass `spec`.
- Bump `VIEW_KEY` to `aggapi.chartView.v4` (`mount.js:48`), migrating a
  stored v3 by copying it minus `window` and deleting the old key. Same
  reasoning the v2 to v3 bump recorded in place: a stored window is a view
  nobody chose for the charts it was never offered on. Poisoned browsers heal
  on first load with no user action.

The per-name map needs no knowledge of which charts take the parameter: the
box only ever renders on a chart whose document realizes as a surface, so the
stored key set maintains itself, and a future grid chart gains its own slot
the day it offers the box.

**F2: stop reporting a fetch failure as a library gap.** In `mountChart`,
when the first fetch carried parameters and failed, retry once with none, so
any future stale request state degrades to the library's default rather than
to a blank pane (defense in depth; with F1 in place it should never fire).
When the fetch still fails, say so plainly ("the chart could not be fetched")
instead of borrowing `notDrawable`'s "not published" wording, which stays for
the case capability really does offer nothing (`main.js:1606`).

**F3: tests.** The parameter decision is currently untestable because it
lives against DOM state. Extract it into a pure leaf
(`web/src/charts/request-params.js`, the `surface-grid.js` precedent):
`chartParamsFor(view, chartName)` and the v3 to v4 view migration as a pure
function of the parsed stored object. Node tests: an empty map sends nothing;
a `joint_surface` entry rides only on `joint_surface`; migration drops a v3
`window`. No Python changes: the 422 contract is already pinned and stays
exactly as is.

## Considered and rejected

- **Softening the route to ignore unknown parameters.** Hides client bugs
  behind silently identical responses under different URLs, and the strict
  422 is the documented contract (`routes/objects.py:2254`). Keep it.
- **Asking LIB to publish which charts take emission options.** Unnecessary
  once the window is stored per chart name (above); no round 7 ask.

## Housekeeping

Version bump with a CHANGELOG section per the house cadence; move this plan
to `dev/done/` when it lands.
