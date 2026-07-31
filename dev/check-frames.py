"""Sweep every named frame across every object kind.

What it answers: does asking for a frame by name ever blow up, and do the
document route and the JSON route agree about what that frame is.

The second half is the one that matters. Until a35 the two resolved a name
independently and drifted: ``stats_df`` dropped its raw ``ex*`` moment rows on
the JSON route only, so More > Stats showed 26 rows statically and 17
interactively from the same button. ``tests/test_objects.py`` now pins that, but
the pinned version covers three declarations; this sweeps the whole matrix, which
is where a kind-specific gap would show.

Run it after touching ``_CSV_FRAMES``, ``_named_frame``, or any per-frame route::

    uv run python dev/check-frames.py

Every cell should be a row count or ``.`` (the object does not carry that frame,
answered the same way by both routes). Anything else is a finding.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from aggregate_api.app import create_app
from aggregate_api.routes.objects import _CSV_FRAMES

# One of each kind the api can build, small enough to be quick.
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
    "sev": "sev SWS lognorm 100 cv 1.5",
    "dist": "distortion SWD dual 2",
}

# Which JSON route answers each frame name. The densities are paginated previews
# by design, so a row-count match is not the invariant there and they are
# compared for reachability only.
ROUTES = {
    "summary": "summary",
    "tail_df": "tail_df",
    "validation_df": "validation_df",
    "stats_df": "stats_df",
    "bs_window_df": "bs_window_df",
    "reins_summary_df": "reins_summary_df",
    "reins_stats_df": "reins_stats_df",
}


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
    print(f"{'frame':20}" + " ".join(f"{k:>8}" for k in ids))
    for which in _CSV_FRAMES:
        cells = []
        for kind, oid in ids.items():
            doc = client.get(f"/v1/objects/{oid}/frame/{which}?format=ir")
            if doc.status_code == 200:
                n = len(doc.json()["body"])
                cells.append(f"{n:>8}")
            elif doc.status_code in (400, 404):
                cells.append(f"{'.':>8}")     # absent for this kind, fine
            else:
                cells.append(f"{'E' + str(doc.status_code):>8}")
                findings.append(f"{which}/{kind}: {doc.status_code} {doc.text[:100]}")
                continue

            # The divergence guard, where a JSON route exists to compare against.
            route = ROUTES.get(which)
            if route is None:
                continue
            frame = client.get(f"/v1/objects/{oid}/{route}")
            if frame.status_code == 200 and doc.status_code == 200:
                a, b = len(doc.json()["body"]), len(frame.json()["rows"])
                if a != b:
                    findings.append(
                        f"{which}/{kind}: document {a} rows, JSON {b} rows"
                    )
            elif (frame.status_code == 200) != (doc.status_code == 200):
                findings.append(
                    f"{which}/{kind}: JSON {frame.status_code}, "
                    f"document {doc.status_code}"
                )
        print(f"{which:20}" + " ".join(cells))

    print()
    if findings:
        print("FINDINGS:")
        for f in findings:
            print("  ", f)
        return 1
    print("clean: every frame resolves the same way on both routes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
