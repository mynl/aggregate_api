# NOTICE (2026-07-31): package renamed greatest_tables → greater_tables

Effective GT2 v1.9.0, before any adoption code is written. Read this before
`dev/note-gt2-start-here.md` and `dev/plan-gt2-ir-adoption.md` (both updated,
but if you see a stray `greatest_tables` anywhere, it means `greater_tables`).

**What changed**

- Import name: `from greater_tables import build, TableSpec, canonical_json`
- Distribution name: `greater-tables` — the uv source entry is now:
  `[tool.uv.sources] greater-tables = { path = "c:/s/ai/greatest-tables", editable = true }`
  and the dependency line is `"greater-tables"` (replacing the PyPI 5.3 pin,
  which was the OLD generation of this same package).
- `importlib.resources.files('greater_tables')` for the walker/css assets.

**What did NOT change**

- The repo folder stays `c:/s/ai/greatest-tables` (deliberate — the path in
  uv.sources above is correct as written).
- Everything else: the IR (`ir_version` 1), the walker API, `irToGridInput`,
  the endpoints spec, the acceptance criteria.

**Why**: GT2 will publish to PyPI as `greater-tables` 6.0 (the rewrite is a
major version of the existing package, keeping `from greater_tables import
GT` working across the blog). Renaming now, before adoption code exists,
means you never build against a dying name. Because the import name now
collides with the installed 5.3, remove the `greater-tables>=5.3` PyPI
dependency in the same change that adds the path source — they cannot
coexist in one env. Server deploys will get a `6.0.0rc1` on PyPI once your
adoption has settled; pin that explicitly (pip ignores pre-releases unless
pinned), and plain `pip install greater-tables` keeps resolving to 5.3 until
the real 6.0.0 ships.
