---
name: execute-plan
description: Review a dev plan and, if it is sound, execute it end to end with
  house hygiene: phase by phase, both gates green (pytest and the web JS suite),
  one version bump commit per phase, execution notes recording every divergence,
  the re-sync that stops /v1/meta reporting a stale version, dev/TODO.md,
  dev-files.md, and the finished plan retired to dev/done/. If the plan is not
  sound, stop and ask in one batch rather than guess. Use when asked to review a
  plan and execute it if it is ok, to run, work, do or implement a
  dev/plan-*.md, or to pick up a plan whose phases are specified but not yet
  executed.
argument-hint: dev/plan-<name>.md [review]
---

# Review and execute a plan, aggregate_api (API)

The standing request this answers: *review `plan/xxx`, if it is ok execute with
the usual hygiene, else ask questions.* Everything below is the usual hygiene,
written out so it never has to be re-asked. The cadence mirrors the LIB skill of
the same name; the gates, the commit format and the review criteria are this
repo's.

The `version-bump` skill owns both gates, the CHANGELOG, the commit and the
re-sync. It is **called**, not restated. Read it when its moment arrives rather
than working from a recollection of what it says.

**Review only mode.** If `$ARGUMENTS` ends with `review`, stop after section 4
and report the review. No source file is touched in that mode.

## 1. Resolve the plan, and everything attached to it

The argument may arrive as `plan/xxx`, `dev/plan-xxx.md`, a bare stem, or a
bracketed label. Find it in this order:

```
ls dev/plan-*.md
ls dev/done/ | grep -i <stem>
```

**Already in `dev/done/`.** The plan is retired. Do not re-execute it. Report
what it says and ask what is actually wanted.

Then read everything the plan is attached to, because a plan is rarely alone:

- **Does LIB link to it?** Several plans are canonical **here** with symlinks
  pointing at them from LIB `dev/`, which is the `plan-3d-plot` arrangement.
  Check `ls -l T:/worktrees/aggregate_REFACTOR/dev/<file>`. If a link exists,
  retiring this plan dangles it, so section 7 applies.
- **Is there a paired half?** Two arrangements are in use. The symlink, one file
  seen from both repos. And the reflection, a copy in each repo stating its own
  side (`plan-2d-punchups.md` here against `plan-2d-punchup-requirements.md`
  there). Read the other side either way.
- **Is there a LIB execution notes file?** `plan-<stem>-LIB.md` in the LIB `dev/`
  or `dev/done/` directory. When LIB has already executed its half, that file
  holds the divergences between what this plan asked for and what actually
  shipped upstream. **Read it before writing a line of app code.** The pricing
  plan's LIB notes carried nine.
- **The control list.** `T:/worktrees/dev-files.md` carries a row per plan with
  its real status, and its "Getting to 1.0" section is the author's master list.
  The row is more current than the plan's own header.
- **The tracked items.** `dev/TODO.md`, and `dev/api-punchlist.md`, which is the
  author's rolling punch list and often annotates items to a plan.

## 2. Read the ground truth, never assert it from memory

```
git -C T:/worktrees/aggregate_api status
git -C T:/worktrees/aggregate_api log --oneline -8
grep -n '^version' pyproject.toml
grep -n '^version' T:/worktrees/aggregate_REFACTOR/pyproject.toml
```

The last line matters more here than anywhere else. This repo depends on LIB as
an editable path source and reads versions through `importlib.metadata`, which
returns what was recorded at install time. If LIB has moved since the last sync,
this checkout is stale against it and any plan phase that consumes a new
upstream surface will fail in a way that looks like a bug in the plan. Run
`uv sync --extra dev` first when that is the case.

Note what is already modified in the tree that is **not** part of this plan.
That is the author's and it stays behind, uncommitted, at every bump.

## 3. The review, and what "ok" means

Work down this list. Each item is a real gate, not a formality.

**Status.** Plans carry a status line: FINAL, or OPEN with phases pending, or
blocked on the author for a named section. Anything short of ruled and ready to
execute is a stop.

**Open questions dispositioned.** A plan that asks the author something and
records no ruling is not executable. Ruled looks like a dated sentence saying
the choices below are rulings rather than proposals.

**Order of work, and the upstream half.** Cross-repo plans state it, and it is
usually LIB first and in full, then this side. Verify the upstream phases
actually landed: read the LIB CHANGELOG sections that claim them, not the plan's
prediction that they would. Then confirm the sync in section 2 has happened.

**The purist ruling holds, and it is the main review criterion here.** The
library owns meaning; the app draws what it is served. A plan phase that has the
app build a table document from a fetched frame, or hold formats, captions or
row emphasis of its own, is wrong even when the served exhibit reads worse than
what the app used to synthesize. In that case the app ships the worse reading
and the gap becomes an upstream ask. Settled scope, not a deviation:
`density_df` and `reins_density_df` stay on the raw frame route into the
interactive grid permanently.

**Depend, never vendor.** A plan phase that reimplements something from LIB
locally is a finding. So is a **new** private-name import from `aggregate`. The
sanctioned surface, and the three tolerated private reaches, are listed in
`T:/worktrees/CLAUDE.md`. The sanctioned path for a gap is an upstream ask
through a round note, not a local workaround and not a deeper private reach.

**The plan's facts against today's code.** A plan names files, line numbers,
symbols and the versions it was written against, on both sides. Verify every
named path exists and every symbol still spells that way, in this repo and in
LIB. **A plan claim the code contradicts is a blocker, not a detail.**

**Wire contracts round-trip.** If the phase touches a served payload, the
contract is that it reconstructs: `gt.TableDoc.model_validate` for exhibits,
`doc_hash(load_chart_doc(canonical_dict(doc))) == doc.hash` for charts. A plan
that changes a payload without saying how the round trip is verified needs that
question answered before it runs.

**Acceptance criteria.** The plan should name what to measure. If it has no
verification section, ask for one rather than inventing a standard for it.

## 4. The fork

**Stop and ask** on any of these:

- an undispositioned open question, or a status that is not ruled and ready
- an upstream phase the plan assumes has landed and which has not, or a LIB
  surface that shipped differently from what the plan expected
- a phase that would have the app build meaning, hold its own formats, vendor
  from LIB, or reach for a new private name
- a plan claim the current code contradicts, on either side
- a missing or unmeasurable acceptance criterion
- work the change cannot land without and the plan does not cover

Ask **all** the questions in one batch, and then **wait**. The author
multiprocesses and will answer. Do not proceed on a provisional pick after a
silence.

**Everything smaller is executed and recorded as a divergence**, never silently
absorbed. A recorded divergence is a good outcome. An unrecorded one is the
failure.

## 5. Execute

- **Phase by phase, in the plan's order. One phase, one bump, one commit.**
  Never batch two phases into one commit, and never defer a bump to the end.
- **Run the suite that covers what you touched** while iterating, `uv run pytest`
  for the backend or `cd web; npm test` for the SPA. Both run at the bump.
- **Docstrings on everything new or modified**, NumPy style.
- **House style in everything authored.** No dashes as punctuation, ever. US
  spelling. Descriptive `[Bracket-Label]` names, never terse codes. Rendered
  output stays tight, with no gratuitous blank lines in blocks.
- **Grammar mirror.** If the phase reacts to a LIB grammar or keyword change,
  `web/src/decl-keywords.json` is a hand-curated mirror of
  `parser_errors._TERMINAL_LABELS` and has to be checked against it explicitly.
- **Keep the execution notes open as you go**, either a section appended to the
  plan or a companion file when the plan is shared and LIB keeps its own. Record
  each divergence at the moment you make it.

## 6. Hygiene at each bump

Call the `version-bump` skill and follow it. It owns both gates, the
`pyproject.toml` line, `uv.lock`, the CHANGELOG section, `dev/TODO.md`, the
`[aNNN] terse summary` commit, the post-bump `uv sync --extra dev`, and the
never-push rule.

Two things worth repeating because they are the ones that get missed:

- **Both suites are the gate**, even when the change looks confined to one side.
  Green on both or no bump.
- **The built SPA under `src/aggregate_api/static/` is never in the commit.** It
  is gitignored and rebuilt at deploy.

And two this skill adds:

- **The execution notes** ship in the same commit as the phase they describe.
- **The `dev-files.md` row** at `T:/worktrees/dev-files.md` gets the plan's new
  status and version range.

## 7. Retire the plan

In the final phase's commit, and not before:

- Move the plan from `dev/` to `dev/done/`.
- **Symlink care.** Plans canonical here often have a LIB symlink pointing at
  them. Moving one into `dev/done/` dangles that link, so retire the LIB side in
  the same breath: repoint the link and fix the LIB `.gitignore` entry that
  keeps it uncommitted. A reflected plan is retired on each side independently,
  when that side's half lands.
- Tick the `dev/TODO.md` entry, and any `dev/api-punchlist.md` item annotated to
  this plan.
- Update the `dev-files.md` row to DONE with the version range.

## 8. Report

- The version range, and what landed in each bump.
- **Both** suite results, with the actual commands. A failure is reported with
  its output, never summarized as mostly green.
- Whether the re-sync ran.
- **Every divergence**, with a pointer to where it is recorded.
- Anything owed upstream: a gap that should become a round note ask rather than
  an app-side workaround.
- What in the tree was deliberately left uncommitted.
