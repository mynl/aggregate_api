---
name: version-bump
description: Bump the aggregate_api 1.0.0a version and commit it as one batch:
  both test suites run (pytest and the web JS suite), pyproject.toml, uv.lock,
  the CHANGELOG section, dev/TODO.md, the plan doc moved to dev/done/, a
  one-line commit, the SPA rebuild that stops the page being older than the
  version it reports, and the re-sync that stops /v1/meta reporting a stale
  version. Use when a plan-based change is finished, when asked to bump, ship,
  cut a version or commit a version, and to decide whether a change bumps at
  all.
argument-hint: [terse summary]
---

# Version bump, aggregate_api (API)

The cadence mirrors the main `aggregate` project. Standing rules, followed
without being re-asked.

## 1. Does this bump at all?

- **Plan-based change bumps.** Anything executed from a `dev/plan-*.md`.
- **Pure tidying does not.** File moves, comment or doc-only edits, anything
  with no behavior change.

If it does not bump, **leave it uncommitted for the author**. The author handles
all non-bump commits, so do not commit doc-only or in-progress work unless
asked.

## 2. Read git state, never assert it from memory

```
git -C V:/dev/aggregate-api status
git -C V:/dev/aggregate-api log --oneline -5
```

The author commits frequently without announcing it. Read the log rather than
recalling it. If an expected commit is missing, mention it. Note anything
modified that is **not** part of this bump; that stays behind.

## 3. Run both gates

The API has **two** test suites and both are the gate. The JS one is easy to
forget because the Commands section of `CLAUDE.md` does not name it as a gate.

```
uv run pytest
```

FastAPI `TestClient`, no live server needed, 17 files under `tests/`.

```
cd web; npm test
```

`node --test` over `web/test/*.test.js`. This is where the 3D surface and
SpaceMouse work is covered: `surface-geometry`, `surface-grid`, `surface-nav`,
`mesh-export`, `spacemouse`, `history-walk`, `reading-map`, `request-params`.

Run **both**, even when the change looks confined to one side. Report both
results. **Green on both or no bump.** If either fails, report the failure with
its output and stop.

Two environment traps while doing this:

- `uv sync` fails with `os error 32` on `Scripts/aggregate-api.exe` while a
  server is running, since uv rebuilds the editable package and cannot replace a
  locked executable. Stop the server, or use `uv run --no-sync` when only source
  has changed, which is always enough for an editable install.
- Unlike the LIB checkout, this repo syncs with `uv sync --extra dev`, and no
  `UV_LINK_MODE` setting is needed here. Do not carry the LIB `--all-extras`
  habit across.

## 4. Assemble the batch

One commit carrying the whole batch:

- Source and tests.
- `pyproject.toml`, the `version = "1.0.0a*"` line. Read the current value, do
  not assume it. Recent history: `1.0.0a112`.
- `uv.lock`.
- `CHANGELOG.md`, a new `## <version>` section at the top, newest first.
- `dev/TODO.md`, tick the matching entry.
- The plan doc, moved from `dev/` to `dev/done/`.

**Never in the commit:** the built SPA under `src/aggregate_api/static/`. It is
gitignored, and `.\scripts\build-web.ps1` is not a commit step: nothing it
writes is ever staged. It **is** a bump step, at section 7, because a bump that
moves the version without moving the page is worse than one that does neither.
The two rules are not in tension: build the artifact, never stage it.

Watch for symlinked plans. `dev/done/plan-3d-plot.md` and
`dev/done/plan-pricing-natural-allocation.md` are canonical **here**, with
symlinks pointing at them from the LIB `dev/done/` directory; both were retired
on 2026-08-21. Moving one into `dev/done/` dangles the LIB symlink, so retire
the LIB side in the same breath, which for the joint surface meant repointing
the link and updating the LIB `.gitignore` entry that keeps it uncommitted.

## 5. Write the CHANGELOG section

The `CHANGELOG.md` section is the commit's detailed description, so write it for
a reader who was not in the session: what landed, why, and any breaking change
stated plainly. Write it at the close of the iteration, do not defer it.

House style applies. **No dashes as punctuation. Ever.** Rewrite with a comma, a
colon, parentheses, or a new sentence. Descriptive bracketed labels, never terse
codes. US spelling. Keep rendered output tight, with no gratuitous blank lines in
blocks.

`README.md` is the stable front page and points at `CHANGELOG.md`. Touch it only
when that material changes.

## 6. Commit, one line

```
[a113] terse summary of what landed
```

The subject should not restate the CHANGELOG section. Real examples from this
history:

```
[a112] private status page at /v1/status, and a real client address
[a110] per-session recipe forks and a session-qualified cache key
[a105] the library caught up, so the scaffolding comes down
```

Note the format differs from LIB, which uses `[Descriptive-Label] aNNN: summary`.
Here the bracket holds the version alone.

Stage deliberately, by path. Do not `git add -A` over a tree holding the
author's uncommitted work.

## 7. Rebuild the SPA, or the page is older than the version it reports

If the bump touched anything under `web/`, run:

```
.\scripts\build-web.ps1
```

Vite writes the bundle into `src/aggregate_api/static/`, which the FastAPI
`StaticFiles` mount serves at `/`. Nothing else writes it. The suites and the
harnesses all read `web/src/` directly, so an SPA-only bump can be committed,
green on `npm test`, `check-nav.mjs` and `smoke-charts.mjs`, and be completely
invisible in the running app. Not one of those checks can catch this.

**It is worse than an ordinary stale page**, which is why the step is here
rather than left to deploy. Section 8's re-sync makes `/v1/meta` report the new
version at once, so the number and the interface end up describing different
builds: the About panel says `a141` while the page it is sitting on predates
`a139`. Reported at a141 as "where is the Re change, I am only seeing 141 with
Reinsurance"; the bundle on disk was six weeks old. The version is exactly what
the author reads to know which build they are running, so a bump that moves the
number without moving the page is actively misleading.

Three seconds, and no side effects outside a gitignored directory. Run it
whenever `web/` moved, and do not run it otherwise.

**The output still never enters the commit.** `src/aggregate_api/static/` is
gitignored and section 4 is unchanged: this builds the artifact, it does not
stage it. Building before or after the commit makes no difference to what is
staged, so it sits here, beside the re-sync, where the two "make the running
thing match what was just committed" steps belong together.

Then tell the author to hard refresh. Vite hashes the bundle filename, so a
cached `index.html` is the one thing that can still hide a correct build.

## 8. Re-sync, or `/v1/meta` lies

```
uv sync --extra dev
```

`version` is read with `importlib.metadata.version`, which returns what was
recorded when the editable install was built, not what `pyproject.toml` says
now. Bump the version and the running server keeps reporting the old one in
`/v1/health`, `/v1/meta` and the About panel. The same trap applies to
`aggregate_version` when the sibling LIB checkout moves, so re-sync after a LIB
bump too, not only after one here.

This step is easy to skip because nothing fails. It just reports a stale number
until someone notices.

## 9. Never

- **Never push.** That is the author's, on explicit request only.
- **Never commit the author's unrelated or in-progress work** with the bump.
- **Never batch two bumps** into one commit.

## 10. Report

State the new version, both suite results, what went into the commit, whether
the SPA was rebuilt (and say plainly that it was not, when `web/` did not move,
rather than leaving it unmentioned), whether the re-sync ran, and anything left
uncommitted for the author.
