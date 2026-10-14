---
name: version-bump
description: Bump the aggregate_api version and commit it as one batch:
  both test suites run (pytest and the web JS suite), __version__, uv.lock,
  the CHANGELOG section, dev/TODO.md, the plan doc moved to dev/done/, a
  one-line commit, and the SPA rebuild that stops the page being older than the
  version it reports. No sync: the version is read live. Use when a plan-based change is finished, when asked to bump, ship,
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
uv run --no-sync pytest
```

`--no-sync` matters: a plain `uv run` swaps the worktree `aggregate` for the
released build (see `CLAUDE.md`, Commands).

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
- `src/aggregate_api/__init__.py`, the `__version__ = "x.y.z"` literal, the
  **one** place the version is written since 1.9.1. `pyproject.toml` reads it
  (`dynamic = ["version"]`) and has no version line. Read the current value, do
  not assume it.

  **The scheme changed at 1.0.0**, which shipped on 2026-10-07. Through
  `1.0.0a202` a bump was one more alpha serial. Released, it is SemVer per the
  house rules: a feature or behavior change takes the minor (1.0.0 to 1.1.0 to
  1.2.0), a fix takes the patch. Do not crawl, and do not go back to serials.
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
[1.1.0] terse summary of what landed
```

The subject should not restate the CHANGELOG section. Real examples from this
history, from the alpha line that ran to a202:

```
[a112] private status page at /v1/status, and a real client address
[a110] per-session recipe forks and a session-qualified cache key
[a105] the library caught up, so the scaffolding comes down
```

Note the format differs from LIB, which uses `[Descriptive-Label] aNNN: summary`.
Here the bracket holds the version alone, and since 1.0.0 that is the release
number rather than an alpha serial.

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
rather than left to deploy. `/v1/meta` reads `__version__` live, so it reports
the new version as soon as the server restarts, and the number and the interface end up describing different
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
staged, so it sits here, as the step that makes the running thing match what
was just committed.

Then tell the author to hard refresh. Vite hashes the bundle filename, so a
cached `index.html` is the one thing that can still hide a correct build.

## 8. No sync

**A bump runs no `uv sync`.** Through 1.9.0 one followed every bump, purely to
rewrite the editable install's recorded version, and it wiped the co-development
environment each time: the relativity plugin, the worktree `aggregate`, the
`aggregate-ntt` engine. Since 1.9.1 every version the server reports is a live
`__version__`, so there is nothing to refresh. A sync is for a dependency change
only, followed by the restore in `CLAUDE.md`.

## 8a. If this bump is a release

A release is more than a bump. Run `.\scripts\release-check.ps1`, which is the
only gate that sees what an installer receives: it builds the distributions,
asserts the wheel carries the whole web bundle, installs it into a clean
environment where nothing in this tree can reach the resolution, runs the suite
against the installed package, then serves the app and fetches every asset.
Three defects shipped past both suites before 1.0.0 because the suites read the
working tree in place.

Publishing, tagging and the GitHub release are the **author's**, never yours.
`V:\dev\RELEASE-PROCESS.md` is the checklist for both repositories.

## 9. Never

- **Never push.** That is the author's, on explicit request only.
- **Never commit the author's unrelated or in-progress work** with the bump.
- **Never batch two bumps** into one commit.

## 10. Report

State the new version, both suite results, what went into the commit, whether
the SPA was rebuilt (and say plainly that it was not, when `web/` did not move,
rather than leaving it unmentioned), and anything left uncommitted for the
author.
