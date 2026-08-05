"""Sweep every exhibit across every object kind ([Exhibits-App-Endpoint]).

What it answers: does the capability route and the envelope route ever blow
up, is every served envelope byte deterministic, and do the exhibit blocks
agree with the frame-document routes where they cover the same frame.

The last check is the one that matters, the sibling of ``check-frames.py``'s
divergence guard. The library's INSURER perspective is the presentation the
app's frame routes already serve (``_drop_raw_moments`` on ``stats_df`` and
``reins_stats_df``, passthrough elsewhere), so where an exhibit block's name
matches a frame route name, the insurer block and the frame document must
carry the same number of body rows. When phase [Exhibits-App-Cleanup]
re-points or retires the frame routes, this script is the regression net.

Run it after touching the exhibit routes, the library registrations, or the
frame resolvers::

    uv run python dev/scripts/check-exhibits.py

Every cell is ``rows(raw)/rows(insurer)`` or ``.`` (the object does not serve
that exhibit). Anything else is a finding.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from aggregate_api.app import create_app

# One of each kind the api can build, small enough to be quick. The reins
# entry exercises the cession-gated exhibit; dice pins the exact discrete
# fixtures used by the library's own snapshot corpus.
DECLS = {
    "agg": "agg SW 10 claims sev lognorm 100 cv 1.5 poisson",
    "port": (
        "port SW agg A 10 claims sev lognorm 100 cv 1.5 poisson "
        "agg B 5 claims sev gamma 50 cv 0.8 poisson"
    ),
    "reins": (
        "agg SWR 10 claims sev lognorm 100 cv 1.5 "
        "occurrence net of 100 xs 100 poisson"
    ),
    "dice": "agg Dice dfreq [3] dsev [1:6]",
    "pnl": (
        "pnl SWP 1000 prem less "
        "agg SWPL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson"
    ),
    "dist": "distortion SWD dual 2",
}

# Exhibit block name -> frame-document route name, where both cover the same
# frame. The frame routes serve the app presentation (raw moments dropped on
# the two stats stores), so the INSURER exhibit block is the comparable one.
FRAME_ROUTE_BLOCKS = {
    "summary_df": "summary",   # the frame route kept the pre-rename name
    "tail_df": "tail_df",
    "stats_df": "stats_df",
    "validation_df": "validation_df",
    "reins_stats_df": "reins_stats_df",
    "reins_summary_df": "reins_summary_df",
}

# The full exhibit vocabulary, in registry order, for the sweep grid.
EXHIBITS = ["summary", "tail", "stats", "validation", "reins",
            "pnl_ledger", "pnl_ratios", "dependency"]


def main() -> int:
    client = TestClient(create_app())
    ids = {}
    for kind, decl in DECLS.items():
        r = client.post("/v1/objects", json={"decl": decl, "log2": 12})
        if r.status_code != 200:
            print(f"{kind:6} BUILD FAILED {r.status_code}")
            continue
        ids[kind] = r.json()["id"]

    findings: list[str] = []
    capability = {
        kind: {e["name"]: e["perspectives"]
               for e in client.get(f"/v1/objects/{oid}/exhibits").json()["exhibits"]}
        for kind, oid in ids.items()
    }

    print(f"{'exhibit':12}" + " ".join(f"{k:>10}" for k in ids))
    for name in EXHIBITS:
        cells = []
        for kind, oid in ids.items():
            if name not in capability[kind]:
                # not served: the envelope route must agree with a 404
                r = client.get(f"/v1/objects/{oid}/exhibit/{name}")
                if r.status_code != 404:
                    findings.append(
                        f"{name}/{kind}: absent from capability but "
                        f"envelope answered {r.status_code}")
                cells.append(f"{'.':>10}")
                continue
            rows = {}
            for perspective in capability[kind][name]:
                url = (f"/v1/objects/{oid}/exhibit/{name}"
                       f"?perspective={perspective}")
                r1 = client.get(url)
                if r1.status_code != 200:
                    findings.append(
                        f"{name}/{kind}/{perspective}: {r1.status_code} "
                        f"{r1.text[:100]}")
                    continue
                if client.get(url).content != r1.content:
                    findings.append(
                        f"{name}/{kind}/{perspective}: not byte deterministic")
                env = r1.json()
                rows[perspective] = {
                    n: len(b["body"])
                    for n, b in zip(env["meta"]["blocks"], env["blocks"])
                }
                # the block agreement guard, insurer vs the frame route
                if perspective != "insurer":
                    continue
                for block_name, count in zip(
                        env["meta"]["blocks"],
                        [len(b["body"]) for b in env["blocks"]]):
                    route = FRAME_ROUTE_BLOCKS.get(block_name)
                    if route is None:
                        continue
                    doc = client.get(
                        f"/v1/objects/{oid}/frame/{route}?format=ir")
                    if doc.status_code == 422 and count == 0:
                        # the frame route refuses empty frames by design;
                        # a 0 row exhibit block is the same answer
                        continue
                    if doc.status_code != 200:
                        findings.append(
                            f"{name}/{kind}: frame route {route} answered "
                            f"{doc.status_code} where the exhibit serves")
                        continue
                    frame_rows = len(doc.json()["body"])
                    if frame_rows != count:
                        findings.append(
                            f"{name}/{kind}: insurer block {block_name} has "
                            f"{count} rows, frame route {frame_rows}")
            raw_n = sum(rows.get("raw", {}).values())
            ins_n = sum(rows.get("insurer", {}).values())
            cells.append(f"{f'{raw_n}/{ins_n}':>10}")
        print(f"{name:12}" + " ".join(cells))

    print()
    if findings:
        print("FINDINGS:")
        for f in findings:
            print("  ", f)
        return 1
    print("clean: every exhibit serves, revalidates, and agrees with the "
          "frame routes where they overlap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
