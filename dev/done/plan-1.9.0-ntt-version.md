# Plan 1.9.0: report aggregate-ntt in the About versions

## Goal

When the optional compiled engine `aggregate-ntt` is installed, the About
panel lists it with its version. When it is not, nothing changes.

## Current behavior

About lists aggregate, aggregate_api, csv-grid, greater-tables, the chart
libraries and plugins. Nothing says whether the exact-compound engine is
present, so a slow or fast `nttagg` build cannot be explained from the UI.

## Change

- [backend] `/v1/meta` gains `ntt_version: str | None`, read from
  `aggregate_ntt.__version__` (the compiled module's own version, so a stale
  binary shows). `None` on `ImportError`. The library discovers the engine
  with the same plain import in the same process, so this sees exactly what
  the library sees.
- [front-end] An `aggregate-ntt` row under `aggregate` in About, hidden
  unless `ntt_version` is non-null.

## Not in scope

Whether the library actually *uses* the engine. It ignores one whose seam
protocol it does not speak, and that check is private. The library side is
`dev/plan-1.3.0-ntt-engine-status.md` in the LIB checkout; once it ships, the
row can append `ignored (protocol N, library M)`.

## Files

`routes/meta.py`, `models.py`, `web/index.html`, `web/src/main.js`,
`tests/test_meta.py`.

## Acceptance

`test_meta_reports_the_ntt_engine_only_when_it_imports` covers null and
present. With the engine installed editable, About shows its version; without
it, no row.
