"""Capture one api payload set per first-class kind, for the offline chart test.

    uv run python dev/capture_fixtures.py

Writes ``dev/fixtures/exhibits.json``: for each kind, the build response plus
the frames its Overview exhibit fetches. ``dev/smoke-exhibits.mjs`` replays that
file, so the chart builders can be exercised without a running server.

Uses FastAPI's ``TestClient``, which drives the ASGI app in-process. No port is
bound and no server is started, deliberately: the author runs the server, this
script must not.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

from fastapi.testclient import TestClient

# One program per kind, matching what the exhibit registry has to handle.
CASES = {
    "agg": "agg FIX.A 100 claims 1000 xs 0 sev lognorm 90 cv 1.5 poisson",
    "port": ("port FIX.P agg U1 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson "
             "agg U2 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4"),
    "sev": "sev FIX.S lognorm 50 cv 1.5",
    "distortion": "dist FIX.D ph 0.7",
    "pnl": ("pnl FIX.N 1000 prem less "
            "agg FIX.L 1000 prem at 70% lr sev lognorm 100 cv 2 poisson"),
    "bvagg": ("bivariate FIX.B 25 claims "
              "agg Wind dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
              "agg Flood dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 poisson"),
    # A discrete book: small support on an integer grid, which is the case the
    # step-drawn density exists for. Three dice sum to 3..18, so 16 points.
    "discrete": "agg FIX.Dice dfreq [3] dsev [1:6]",
    # A reinsured book, for the Reins tab's gross / ceded / net exhibit.
    "reins": ("agg FIX.Re 100 claims 1000 xs 0 sev lognorm 90 cv 1.5 "
              "occurrence net of 500 xs 500 poisson"),
}

# What each kind's exhibit asks for, mirroring EXHIBITS[kind].fetch.
FRAMES = {
    "agg": [("density", "density_df?cols=loss,p_total,F,S"), ("tail", "tail_df")],
    "discrete": [("density", "density_df?cols=loss,p_total,F,S"), ("tail", "tail_df")],
    "port": [("units", "unit_density_df"), ("tail", "tail_df")],
    "sev": [("density", "density_df")],
    "distortion": [("curve", "density_df")],
    "pnl": [("density", "density_df?cols=loss,p_total,F,S")],
    "bvagg": [("joint", "density_df"), ("stats", "stats_df")],
    "reins": [("reins", "reins_density_df")],
}


def main() -> None:
    warnings.filterwarnings("ignore")
    from aggregate_api.app import create_app

    out: dict[str, dict] = {}
    with TestClient(create_app()) as client:
        for kind, decl in CASES.items():
            built = client.post("/v1/objects", json={"decl": decl})
            built.raise_for_status()
            body = built.json()
            entry = {"build": body, "frames": {}}
            for key, path in FRAMES[kind]:
                r = client.get(f"/v1/objects/{body['id']}/{path}")
                entry["frames"][key] = r.json() if r.status_code == 200 else None
            out[kind] = entry
            rows = {k: len((v or {}).get("rows", [])) for k, v in entry["frames"].items()}
            print(f"{kind:11s} kind={body['kind']:<11s} {rows}")

    target = Path(__file__).parent / "fixtures" / "exhibits.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(out), encoding="utf-8")
    size = target.stat().st_size / 1024
    print(f"\nwrote {target} ({size:,.0f} kB)")


if __name__ == "__main__":
    main()
