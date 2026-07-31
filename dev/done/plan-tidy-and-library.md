# plan: consolidate on ECharts, an alternate library, and two bits of chrome

A batch of four, from the author:

> a) rip out plotly and chart switching options. just echarts.
> b) to make review easier I want the ability to load a different (shorter)
>    library. library.agg is still the default on start up, `--library <path>`
>    loads an alternate.
> c) get rid of the headline "Describe an insurance book and get its full loss
>    distribution, tail risk, and price."
> d) get rid of the TABLES: (static) (interactive) on the overview page,
>    redundant now.

## a) ECharts only

a30 shipped Plotly to answer one question: is the library what is holding the
exhibits back. The answer was no ("not massive differences between the two"), so
the second renderer is now a 535 kB lazy chunk and a second code path with no
question behind them.

Out: `charts/engine.js`, `charts/plotly-panels.js`, the `engineGroup` control and
its `exhibit-toggle--engine` styles, the `plotly.js-gl2d-dist-min` dependency,
the `__PLOTLY_VERSION__` define and its `manualChunks` entry, the About panel
row, and the Plotly parity block in the smoke test.

**Stays: `twoPanelData`.** It is the split that made the comparison possible, and
it is right regardless: chart decisions belong somewhere other than inside an
ECharts option literal. `mountExhibit` collapses back to one renderer.

The `aggapi.chartEngine` key is left in localStorage rather than migrated. It is
read by nothing after this, and a browser carrying `plotly` in it now gets
ECharts because that is the only thing left.

## b) `--library <path>`

The plumbing exists: `Settings.examples_file` (`AGGAPI_EXAMPLES_FILE`) already
swaps the Examples dropdown to a custom `.agg`, through the same recipe machinery
as the shipped one. Only the CLI flag is missing.

`__main__.py` sets `AGGAPI_EXAMPLES_FILE` in `os.environ` before uvicorn starts,
rather than poking `Settings`. That is what survives `--reload`, where the app is
built in a child process and would otherwise not see it.

**The flag fails fast.** `examples.py` warns and falls back for a missing path,
which is right for a stale env var on a server and wrong for a flag typed
deliberately: a silent fallback to the full library is exactly the thing this
flag exists to avoid. The CLI resolves the path, checks it, and exits with a
message naming it.

Default is unchanged: `library.agg`, the shipped one.

## c, d) Chrome

The subhead comes out of `index.html`, and `.subhead` from `site.css` with it.

The Overview's Static / Interactive pill row goes. a33 put the same preference in
the header menu, and one preference with two controls on one screen is the kind
of thing that reads as two settings. `exhibitToggle`, the `overview-view-toggle`
and `overview-view-label` styles, and the `'overview-pills'` view listener all
come out; `renderOverviewExhibits` and its `'pane-overview'` listener stay, since
the menu still has to re-render the tab.

## Verification

`uv run pytest`, `ruff check src`, `node dev/scripts/smoke-exhibits.mjs`,
`.\scripts\build-web.ps1`. The build should show **no** `plotly` chunk and a
smaller module count.

New test: `--library` on a missing path exits non-zero rather than starting; on a
good path the setting reaches `get_settings()`.

By the author: flip the table view from the header menu and confirm the Overview
still follows it with the pills gone, and start with `--library` pointed at a
short `.agg` and confirm the dropdown and the hero gallery both narrow.
