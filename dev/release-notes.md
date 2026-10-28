# aggregate_api 1.31.1

First GitHub release of `aggregate_api`: a FastAPI service and the **aggregate
Loss Lab** web app over the [`aggregate`](https://github.com/mynl/aggregate)
actuarial library. One process serves the JSON api under `/v1` and the DecL
workbench at `/`.

Install from PyPI, or from the attached wheel. The wheel carries the built web
page; `pip install git+...` of this repo does not.

```
pip install aggregate_api
aggregate-api --port 8001
```

## Since 1.0.0

- Excel add-in (`/excel`) and a Google Sheets template script, with the same
  `AGG_*` functions on both hosts and a copy link on the new `/use` page.
- `/use`: a walkthrough for running `aggregate` from Jupyter, R, Excel and
  Sheets, ending on one worked example in each.
- DecL coloring and completion read the word list from the library
  (`GET /v1/decl/words`), so new grammar shows up without a frontend edit.
- Quantiles report the limited expected loss at each level.
- Other front ends mount at `/<name>/` via `AGGAPI_APPS` and appear in an
  Apps menu.

Full detail per version is in [CHANGELOG.md](CHANGELOG.md). Requires
`aggregate>=1.6.0,<2`.
