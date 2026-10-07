# Plan 1.0.0: the first public release of `aggregate_api`

Status: **implemented 2026-10-07 as `1.0.0`.** Both distribution questions were
settled by the author in favor of the recommendations below: publish to PyPI and
attach the artifacts to the GitHub release, and pin `aggregate>=1.0.1,<2`. The
code, tests, scripts and documentation have landed and the rehearsal is green.
Publishing, tagging and the GitHub release remain the author's, and are listed
under "What the author must do" with nothing struck off.

## Goal

Ship `aggregate_api` 1.0.0, the first release anybody other than the author can
install, timed with the `aggregate` library's 1.0.1 release. Leaving the version
at `1.0.0a202` is not the problem to solve. The problem is that **no
installation route currently delivers a working application**, and three
separate packaging defects stand in the way.

## Why now

`aggregate` 1.0.1 is on PyPI as of 2026-10-07, tagged `v1.0.1` in the library
repo, with docs published and a GitHub release. That was the one blocker: the
api depends on library internals (`aggregate.parser_errors`,
`aggregate.parser._PARSER`, `aggregate.charts`, `aggregate.exhibits`,
`aggregate.plugins`, `aggregate.bounds`, `aggregate.decl_writer`,
`aggregate.constants`, `aggregate.underwriter.RecipeNotFound`) that existed only
in the in-development `1.0.0a` line, which was never published. `greater-tables`
6.0.0 reached PyPI at api a53. So for the first time every dependency the api
needs is a registry dependency, and the repo can stop requiring a sibling
checkout.

Note that PyPI carries `aggregate` 1.0.1 and **not** 1.0.0. The library's 1.0.1
was itself a packaging fix, "the wheel ships aggregate.charts, .plots and
.exhibits", and the api imports two of those three. So 1.0.1 is the floor, and
1.0.0 would fail at import.

## Current behavior, measured

Verified on 2026-10-07 against the live GitHub repo and a locally built wheel,
each into its own clean Python 3.13 virtual environment. GitHub `HEAD` was
`f75a39d`, which is api `1.0.0a192`; the local tree is `1.0.0a202`, so ten
version bumps are unpushed.

**1. `uv pip install git+https://github.com/mynl/aggregate_api` fails outright.**

```
x Failed to download and build `aggregate @
  git+https://github.com/mynl/aggregate_api#subdirectory=..\..\worktrees\aggregate_REFACTOR`
  The source distribution has no subdirectory `..\..\worktrees\aggregate_REFACTOR`
```

uv honors `[tool.uv.sources]` even when the project is installed as a git
dependency rather than checked out as the workspace root, and it resolves the
relative path *inside the git repository*. The path source is not merely
unhelpful to an outside installer, it is fatal to one.

**2. `pip install git+https://github.com/mynl/aggregate_api` installs, and
serves no application.** pip does not read `[tool.uv]`, so it resolves
`aggregate` 1.0.1 and `greater-tables` 6.0.0 from PyPI and the install succeeds.
But the installed package's `static/` directory holds only the committed icons,
the webmanifest and `sw.js`. There is no `index.html` and no `assets/`, because
the Vite bundle is built output and gitignored. `_resolve_static_dir` finds the
directory, `StaticFiles(html=True)` mounts it, and `/` returns 404. `/v1` and
`/docs` work.

**3. A locally built wheel serves an `index.html` whose every asset 404s.**

```
GET / -> 200
  200 ./favicon.ico
  404 ./assets/main-CmoEiPit.js
  404 ./assets/echarts-B7o9sc00.js
  404 ./assets/main-Bxhxa55v.css
  ... every JS and CSS file
```

`[tool.setuptools.package-data]` reads `aggregate_api = ["static/*",
"status_page.html"]`. A `package_data` glob matches files in one directory and
does not recurse, so `static/index.html` ships and `static/assets/*` does not.
This is the worst of the three failures to diagnose, because the page loads,
renders the shell, and then does nothing.

**4. One test fails in a clean environment and passes in the author's.** The
full suite in a PyPI-only environment: 486 passed, 1 failed.
`tests/test_entry_lock.py::test_health_needs_no_thread_token` asserts
`/v1/health` is mounted by walking `client.app.routes` and matching on `.path`.
FastAPI 0.142.2 with Starlette 1.7.0 wraps an included router in an
`_IncludedRouter` object whose `path` is `None`, so `app.routes` no longer
flattens and the walk finds nothing. The locked dev environment has FastAPI
0.136.3 and Starlette 1.2.1, where it passes. The route itself is fine and
answers 200 with the right body under both. This is a test introspection
problem, and it is the first thing an outside user sees if they run `pytest`.

**5. `aggregate` carries no version floor.** The wheel's metadata says
`Requires-Dist: aggregate`, bare. Today a resolver takes 1.0.1 because it is the
highest release, but nothing stops a resolver working around some other
constraint from taking 0.30.1, which has none of the modules the api imports.
The same reasoning that made the `greater-tables>=6.0.0` floor load bearing
applies here.

## The distribution decision

The SPA bundle is 2.5 MB across 13 hash-named files, of which 1.2 MB is vendored
ECharts and 351 kB is CodeMirror. Vite renames every file on every build. So
there are only three ways an installer can get a working application, and they
are worth stating plainly because the choice governs everything else in this
plan:

- **Publish to PyPI.** The author builds locally, with the bundle present, so
  the wheel carries it. `pip install aggregate_api` then installs a working
  application in one command. The `aggregate_api` name is unclaimed on PyPI.
- **Commit the built bundle.** Makes `pip install git+...` work, at the cost of
  2.5 MB of new binary blobs in the repository on every build, since the
  filenames are content hashes and old ones are never overwritten. Rejected.
- **Attach the wheel to the GitHub release.** `pip install <url to the wheel>`
  works with no PyPI account and no built artifact in git. Weaker discovery, and
  `pip install aggregate_api` still does not work.

**Recommendation: publish to PyPI, and attach the built wheel and sdist to the
GitHub release as well.** The two are not in tension and the second costs one
command. A pure GitHub release remains a legitimate fallback if the author would
rather not take the PyPI name yet, in which case the README must say that
`pip install git+...` gives the api and not the app.

## The change

### [packaging] `pyproject.toml`

- `version` to `1.0.0`.
- `aggregate` to `aggregate>=1.0.1,<2`. The floor is the library release that
  ships `aggregate.charts` and `aggregate.exhibits` in the wheel. The ceiling is
  a deliberate caution, not boilerplate: the api imports private names
  (`parser._PARSER`, `parser_errors._TERMINAL_LABELS`), and a library major is
  exactly where those move. Re-check the private names at each library minor.
- Delete `[tool.uv.sources]` entirely, and the comment block above it. This is
  the change that makes `uv pip install git+...` work at all. The author's
  co-development against the sibling worktree becomes the same recipe already
  documented and already used for `greater-tables`:

  ```
  uv sync --extra dev                                   # PyPI, the default
  uv pip install -e V:/worktrees/aggregate_REFACTOR     # swap in the local
  ```

  with the same caveat that already applies there: the next `uv sync` silently
  reinstalls the released build, and `uv run --no-sync` is the way to work in
  between. One recipe for both co-developed dependencies is simpler than two
  mechanisms, and it is the price of a repository whose dependency graph is
  honest about what it needs.
- `package-data` to `["static/*", "static/assets/*", "status_page.html"]`. Two
  explicit globs rather than `static/**/*`, so
  `static/dev/spacemouse-probe.html` stays out of the distribution: it is a
  development instrument and has no business in a release.
- `Development Status :: 4 - Beta`, up from `3 - Alpha`. Not `5 -
  Production/Stable`, which the library can now claim and the api cannot: the
  README says the `/v1` surface follows what the bundled web app needs and
  should be treated as a moving target. 1.0.0 here means "installable and
  supported", not "frozen interface".
- `[project.urls]`: add `Homepage`, `Documentation`, `Changelog` and `Issues`
  beside the existing `Source Code`. These are the PyPI sidebar.
- `keywords`, for PyPI search: actuarial, insurance, reinsurance, risk,
  aggregate loss, FFT, pricing, DecL.

### [tests] `tests/test_entry_lock.py`

Rewrite `test_health_needs_no_thread_token` so it does not depend on FastAPI's
internal route tree shape. Assert against `meta_routes.router.routes`, which is
the router's own list and has been stable across both FastAPI generations, and
add a live `client.get("/v1/health")` assertion for the behavior the structural
check is standing in for. The point of the test, that neither route is sync and
neither has grown a dependency, is preserved.

### [tests] new `tests/test_packaging.py`

One test, guarding the defect that is hardest to notice: if `static/index.html`
exists, every local asset it references must exist on disk beside it. That
catches a half-built bundle in development. It cannot catch the `package-data`
glob itself, which is why the next item exists.

### [release] new `scripts/release-check.ps1`

The rehearsal, and the real gate on the packaging defects. Build the sdist and
the wheel, assert the wheel contains `aggregate_api/static/index.html` and at
least one `aggregate_api/static/assets/*.js`, install the wheel into a throwaway
virtual environment with no path sources in sight, and run the full test suite
against it. Everything in "Current behavior" above was found by doing this by
hand; a script means it is done the same way next time.

### [docs]

- `README.md`: rewrite the install section. `pip install aggregate_api` becomes
  the headline. The current text says "Two dependencies are local checkouts",
  which is now wrong on both counts, and the `greater-tables` 5.3 warning
  shrinks to a footnote, since the `>=6.0.0` floor handles it for anyone
  installing this package. Keep the development instructions (`uv sync --extra
  dev`, `npm run build`) as a clearly separate section.
- `CHANGELOG.md`: a `## 1.0.0` section. It is a release, so it says what the
  release means as well as what changed: every dependency is now on PyPI, the
  three packaging defects, the floor pin, and the `/v1` stability caveat
  restated.
- `CLAUDE.md`: the "Relationship to `aggregate`" section currently says
  `aggregate` "**must** be an editable path source" and that a clone needs
  `aggregate_REFACTOR` checked out beside it before `uv sync` can succeed. Both
  stop being true. The co-development recipe replaces them, next to the
  `greater-tables` one it now matches.
- `dev/TODO.md`: a `[Release-1.0.0]` entry under Landed.
- `V:\dev\RELEASE-PROCESS.md`: the author asked for process notes outside the
  repository, covering both this repo and the library, so the next release is a
  checklist rather than a rediscovery.

## What the author must do

Nothing in this plan pushes, publishes or tags. These steps are the author's:

1. **Push the ten unpushed bumps**, `a193` through `a202`, before anything else.
   `git push`.
2. **A PyPI token or Trusted Publishing**, if the PyPI route is taken.
   Recommended: configure Trusted Publishing for `mynl/aggregate_api` at
   pypi.org, which needs no token on disk. Otherwise `uv publish --token`.
3. **`uv publish`**, after `release-check.ps1` is green.
4. **Tag and push the tag.** This repository has **no tags at all** today, where
   the library has `v1.0.0` and `v1.0.1`. `git tag -a v1.0.0`, then
   `git push --tags`.
5. **The GitHub release**, with the wheel and sdist attached.

## Acceptance check, as measured

Items 1 and 2 ran green on 2026-10-07. Item 3 cannot be checked until the
commits are pushed, since it reads the remote; item 4 waits on publication.

`release-check.ps1 -SkipWebBuild` on the built 1.0.0 wheel: the wheel is 3.08 MB
and carries `index.html`, `status_page.html` and all 13 assets (8 js, 3 css),
with every one of the 7 that `index.html` names present. The clean environment
resolved `aggregate` 1.0.1, `greater-tables` 6.0.0, FastAPI 0.142.2 and
Starlette 1.7.0 from PyPI, where **490 tests passed**, `GET /` and all 14 files
it references answered 200, and `/v1/meta` reported version 1.0.0. The web suite
is 277 tests, green. The dev-environment suite is also 490, green.

The original checks, in order, each in a clean environment:

1. `uv run pytest` green, and `cd web; npm test` green.
2. `.\scripts\release-check.ps1` green, which means: the wheel carries
   `static/assets/*.js`, and the full suite passes against the installed wheel
   with `aggregate` and `greater-tables` resolved from PyPI.
3. `uv pip install git+https://github.com/mynl/aggregate_api` succeeds, where it
   fails today.
4. After publication, in an empty virtual environment:
   `pip install aggregate_api`, then `aggregate-api --port 8010`, then `GET /`
   serves the app with no 404 in the network panel, and `GET /v1/meta` reports
   `version` `1.0.0` and `aggregate_version` `1.0.1`.
