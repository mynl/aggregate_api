# plan-all-branding: the app is the aggregate Loss Library

Status: **done** (1.0.0a20).

Stage 2 of the aLL work. Naming and prose only, no behavior change beyond what
the page says about itself.

## Why

The app had no name. The banner led with the tagline ("Description to
distribution") set as the title, over "AGGREGATE" as a mono kicker, which put
the gloss where the name belongs and the library's name where the app's belongs.

Separately, the `aggregate` repo settled a house prose rule (no dashes as
punctuation) that this repo had never adopted, and the visible dashes on the
Overview page were the prompt.

## What landed

### The name

**aggregate Loss Library**, short form **aLL**. Lower-case `a` throughout, since
`aggregate` is the package and `Aggregate` is the class. The distinction is the
whole reason for the casing, so it is not a typo to be helpfully corrected.

`aggregate_api` stays the package name. The app it serves is the aggregate Loss
Library. Applied to:

| where | what |
|---|---|
| banner | name on line 1, tagline in grey small caps on line 2 |
| `<title>` / `meta description` | full name |
| `site.webmanifest` | `name` full, `short_name` `aLL` for the installed icon |
| `sw.js` header | full name |
| Help and About leads | full name, with `(aLL)` introduced once in About |
| `README.md` | new lead paragraph making package vs app explicit |
| `pyproject.toml` | package description |

`.brand-kicker` restyled: `font-variant: small-caps` at `.6rem` with `.18em`
tracking, replacing mono at `.52rem` with `.3em`. `font-variant` rather than
`text-transform: uppercase` so a face with real small caps uses them.

### The dash rule

Adopted verbatim from `aggregate`'s `CLAUDE.md` into this repo's, including the
three rewrite patterns (comma or parentheses for an aside, colon for an
expansion, second sentence for a second thought) and the list of what is not
punctuation (hyphenated compounds, CLI flags, CSS custom properties, `--` in
code or DecL).

Swept now: every user-visible string in `web/index.html`, `main.js`,
`error-pane.js`, `grid.js`, `site.css`, plus `CLAUDE.md` and `README.md`. The
Python source carries no em dashes at all.

**Explicitly not swept:** roughly 190 legacy ` -- ` glosses in internal
docstrings and comments. Doing them all in one commit is a 25-file mechanical
diff that would bury the real changes in this and the following stages, and each
one is a judgment call about how the sentence should read instead. The rule is
recorded in `CLAUDE.md` as an authoring rule, so they get cleaned as their file
is next edited. The count is written down there too, so this reads as a decision
rather than an oversight. Say the word and it becomes its own tidying commit.

## Verified

`uv run pytest`: 77 passed. SPA rebuilt; the served `index.html` carries the new
title, banner lines, and panel leads. No em dash remains in `web/src`,
`web/index.html` or `src/aggregate_api/*.py`.
