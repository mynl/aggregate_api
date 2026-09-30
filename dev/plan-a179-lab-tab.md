# plan-a179: the Lab tab, where plugin documents land

**Status:** transcribed and ruled. This is the api half of the library's `[Plugin-Loader]` work and it is **not** an open design.
**Canonical plan:** `V:\worktrees\aggregate_REFACTOR\dev\plan-a376-plugins-and-extension-surface.md`, section 6 `[Lab-Tab]`, whose thirteen decisions are settled and are not re-argued here. Read it for the reasoning; this file is the api-side specification and its execution log.
**Version:** `1.0.0a179`.

---

## 1. Goal

A third-party package named `aggregate-<something>` registers charts and exhibits into `aggregate` and its documents appear in this app under one new **Lab** tab. Installing such a package adds leaves; uninstalling removes them. No list of plugins is maintained anywhere in this repo.

## 2. What already exists, and it is most of this

The transport is already generic and needs no change at all. `GET /v1/objects/{oid}/exhibit/{name}` and `.../chart/{name}` resolve names through `available_exhibits` / `available_charts`, so a plugin's document is already fetchable the moment its registration has run. `capability.py` is already a pure passthrough of both.

The library side landed first and in full: `aggregate.plugins` at `1.0.0a376` (discovery, provenance, recorded failures, the name refusal) and `aggregate.exhibits.register_exhibit` at `a378`. The editable path source in `[tool.uv.sources]` points at `aggregate_REFACTOR`, so this repo's environment already sees both.

## 3. What is missing

Three things, and only three.

1. **Nothing runs the third party's `register()` inside this process.** The library deliberately does not auto-load: `import aggregate` stays deterministic and the host decides. So `create_app()` must call `aggregate.plugins.load()`.
2. **Nothing tells the SPA what plugins exist.** The tab strip has to know whether Lab exists before it can draw, and the leaf list is process-wide rather than per-object.
3. **A place in the UI.** `NAV_GROUPS` has six groups with **authored** leaves, deliberately: the skeleton is editorial. A plugin's leaf cannot be authored, so the Lab group's leaves are the one dynamic set in the app.

## 4. Implementation

### Backend

* **`config.py`**: `plugins_enabled: bool = True` (`AGGAPI_PLUGINS_ENABLED`), and `plugins_allow_raw` behind `validation_alias="AGGAPI_PLUGINS_ALLOW"` with a `plugins_allow` property parsing the comma-separated list, matching how `cors_origins` and `private_cidrs` are already done. Default on, because a local deployment trusting the author's own packages is the case that exists; the allowlist is for a hosted one, which the library's non-goal 5 anticipates and which has no sandbox.
* **`app.py`**: `create_app()` calls `aggregate.plugins.load(allow=...)` behind the flag. Placed with `resources.seed()`, the other process-lifetime side effect, and after it, so a plugin that reaches for a seeded resource finds one.
* **`routes/meta.py`**: `GET /v1/meta` reports `plugins`, a list of `{name, version, source, leaves: [{name, kind, label, hint, why}], error}`. Per the canonical plan's decision 13 the manifest rides on meta rather than on a new route, because `api.meta()` is already an unconditional boot fetch on the very path that must resolve before the strip can know whether Lab exists. **The error is one line**, not a traceback: the traceback goes to the server log, and the payload stays small enough that meta does not become a dumping ground.
* **`models.py`**: `PluginLeafInfo`, `PluginInfo`, and `MetaResponse.plugins`.

### Frontend

* **`web/src/nav.js`**: a seventh group `lab`, label **Lab**, drawn last, with `leaves: {}`. Two new pure functions: `authoredLeafNames()`, the exhibit and chart names the other six groups claim; and `labLeavesFromManifest(plugins)`, which turns the meta manifest into leaf definitions in the canonical plan's decision 8 order, dropping any name an authored leaf already claims. `installLabLeaves(plugins)` writes them into `NAV_GROUPS.lab.leaves` at boot.
* **`web/src/main.js`**: reveal the strip's hidden `lab` slot when the manifest is non-empty, and **one** generic loader row for the `lab:*` key space, dispatching on the leaf's `kind` and reusing the existing exhibit-envelope pane and ChartDoc mount. No new rendering code.
* **`web/index.html`**: a **hidden `lab` slot** in the static strip, revealed by JS, rather than a tab appended after the meta fetch resolves. Appending would shift the layout on every page load, and it would break `check-nav.mjs`'s premise that the strip lists every group the app knows about.
* **`dev/scripts/check-nav.mjs`**: the group-order check passes unchanged once `lab` is last in both files. Add the new invariant: no Lab leaf name may duplicate an authored leaf.

## 5. The one deliberate departure from the canonical plan

**`capability.py` is not touched.** Section 6 of the canonical plan says `exhibits_for` and `charts_for` "each gain a `provenance` field per entry". That is not done, for three reasons, and the goal it serves is met anyway.

Provenance is **process-wide**: which plugin owns `relativity` does not vary by object. Per-object capability is the wrong place for it, and putting it there would contradict this module's own stated invariant, that capability is derived and never declared twice. Decision 13 already puts the full manifest, plugin by plugin with its leaf names, on `GET /v1/meta`, which the SPA fetches at boot before any object exists; the join of "which names are available for this object" with "which plugin owns which name" is one line in `nav.js`, where the Lab leaf list is being built from that manifest regardless. And `charts_for` returns a list of **strings**, so a per-entry field would change its shape and with it `models.Capability` and every SPA reader, for a fact already carried elsewhere. Note also that a name can exist in both registries at once (`reins` is a chart *and* an exhibit), so a single flat provenance map would be ambiguous while the manifest's `kind` is not.

## 6. Acceptance

* `uv run pytest` green, with new cases for the meta manifest, the settings, and the allowlist.
* `npm test` green in `web/`, with new cases for `labLeavesFromManifest` ordering and exclusion.
* `node dev/scripts/check-nav.mjs` clean, including the new invariant.
* With `aggregate-relativity` installed: Lab appears, its Relativity leaf is live on a built `xpnl`, dark with the plugin's own `why` on an `Aggregate`, and `GET /v1/meta` names the plugin and its version.
* With it uninstalled: no Lab tab, and every pre-existing `check-nav.mjs` assertion still passes.

---

## 7. Execution log

Landed `1.0.0a179` on 2026-09-30.

Files: new `tests/test_plugins_meta.py`, `web/test/lab-nav.test.js`; edited
`src/aggregate_api/config.py`, `app.py`, `models.py`, `routes/meta.py`,
`web/src/nav.js`, `web/src/main.js`, `web/index.html`,
`dev/scripts/check-nav.mjs`.

### Divergences

1. **`capability.py` untouched.** Section 5 above, which is itself the recorded
   divergence from the canonical plan's section 6.
2. **`installLabLeaves` mutates `NAV_GROUPS`.** The one mutation of the
   skeleton in the app. The alternative was carrying the Lab leaves beside it
   and branching in `leafOf`, `leafAvailable`, `groupAvailable`, `activeLeaf`,
   `whyLeaf` and `whyGroup`, six functions whose whole virtue is that they have
   no per-group cases. Installing into the skeleton buys zero branches.
3. **Leaf keys are `<kind>-<name>`, not the bare registry name.** `reins` is
   both a chart and an exhibit in the library, so a bare name would let one
   plugin's chart silently replace its own exhibit. The exclusion set is keyed
   `<kind>:<name>` for the same reason.
4. **`check-nav.mjs` checks the Lab rule against a synthetic manifest.** The
   live manifest is empty in that process, so an exclusion assertion against it
   would pass by having nothing to check. It also asserts
   `authoredLeafNames()` still reports `exhibit:summary`, so the synthetic case
   cannot quietly stop testing anything.
5. **A test of mine was environment-dependent and was fixed before the bump.**
   `test_meta_reports_no_plugins_on_a_stock_install` asserted `plugins == []`,
   which fails the moment a plugin is installed for a demo. Split into one case
   that the field is always a list and one that fakes an empty manifest.
6. **Stale counts swept.** "six groups" and `Alt+1…6` in `main.js`,
   `index.html` and `check-nav.mjs` now read seven and `Alt+1…7`. Left alone:
   three references that are historical narrative about a past state.

### Verification

* `uv run --no-sync pytest` — **416 passed** with no plugin installed, and
  **417 passed** with `aggregate-relativity` installed, deliberately run both
  ways so no case depends on the environment. (417 rather than 416 because of
  divergence 5's split.)
* `npm test` in `web/` — **195 passed**, 12 of them new.
* `node dev/scripts/check-nav.mjs` — clean, group order agrees with `lab` last,
  and the new Lab invariants pass.
* End to end with `aggregate-relativity` 0.1.0 installed: the entry point is
  discovered with no configuration, `/v1/meta` reports
  `{"name": "relativity", "version": "0.1.0", "source": "entry_point", ...}`,
  `POST /v1/objects` on the Capstone `xpnl` carries `relativity` in its
  capability, `GET /v1/objects/{id}/exhibit/relativity` returns 200 with eight
  rows beginning `gross book, 0.20924, ...` through the **pre-existing** route,
  and the leaf is absent from an `Aggregate`'s capability.

### Left for the author

The web bundle is **not** built or staged, per the repo rule that a bump builds
the artifact and never commits it. Run `.\scripts\build-web.ps1` and
`uv sync --extra dev` (which re-records the version so `/v1/meta` stops
reporting a178, and which will prune the ad-hoc `aggregate-relativity` install:
re-add it with `uv pip install -e ../aggregate-relativity --no-deps` to see the
Lab tab in the running app).
