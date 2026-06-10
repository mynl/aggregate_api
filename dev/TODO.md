# TODO / Roadmap

Pending work for `aggregate_api`, newest thinking at the bottom of each list.
What has landed is in `CHANGELOG.md` and the git log; completed plans move to
`dev/done/`.

## SM

- [ ] Bandwidth limited by caddy page with obscured url; special caddy install  
- [ ] Set up service to run on vps
- [ ] Limit log2 <= 18
- [ ] 

## Near term (get it healthy)

- [x] **plan-0001 — bootstrap standalone** (→ 1.0.0a2). Make the extracted code
      import, run, and pass tests as `aggregate_api`. Wire the `aggregate`
      editable source. *(done; moved to `dev/done/`)*
- [ ] **plan-0002 — dev workflow & smoke test** (→ 1.0.0a3). Document/verify the
      end-to-end loop: `uv run aggregate-api --reload` + `npm run dev`, build the
      SPA, hit `/docs`, build an object in the playground. Add a `ruff` pass.

## Backlog / ideas (unordered)

- [ ] CI: GitHub Actions running `uv run pytest` on the private repo.
- [ ] Decide the canonical `aggregate` dependency story: editable local path for
      dev vs. a pinned version once the `1.0.0a` line publishes.
- [ ] Packaging (was "Plan E"): rebuild the SPA before `uv build` so the wheel
      ships the bundle; confirm `static/*` package-data works.
- [ ] Auth / rate limiting if this is ever exposed beyond localhost.
- [ ] Expand the example library and DecL completion coverage.
- [ ] Persist object cache across restarts (currently in-memory only).
- [x] Revisit `meta` version reporting: report both the `aggregate_api` version
      and the underlying `aggregate` version. *(done in 1.0.0a2 —
      `health`/`meta` carry `version` + `aggregate_version`.)*
- [ ] Frontend polish: keyboard-shortcut help, sharable URLs for a DecL program.
