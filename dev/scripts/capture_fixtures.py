"""Capture every chart document a first-class kind publishes, for the offline test.

    uv run python dev/scripts/capture_fixtures.py

Writes ``dev/fixtures/charts.json``: for each case, the build response plus one
chart document per name in its capability's ``charts`` list, exactly as the app
fetches them. ``smoke-charts.mjs`` alongside replays that file through the real
ECharts adapter, so every realization is exercised with no DOM, no WebGL and no
server.

The file was ``exhibits.json`` through a61, which collided with the name the
library's own exhibit envelopes want (``dev/TODO.md`` flagged it). It holds
chart documents and nothing else now, so it is called that.

Uses FastAPI's ``TestClient``, which drives the ASGI app in-process. No port is
bound and no server is started, deliberately: the author runs the server, this
script must not.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

from fastapi.testclient import TestClient

# One program per case. Between them they exercise every panel kind, every
# declared reading and both ends of the drawing ladder.
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
    # stem rung of the ladder exists for. Three dice sum to 3..18, so 16 atoms.
    "discrete": "agg FIX.Dice dfreq [3] dsev [1:6]",
    # A reinsured book, which publishes 'reins' alongside its own chart.
    "reins": ("agg FIX.Re 100 claims 1000 xs 0 sev lognorm 90 cv 1.5 "
              "occurrence net of 500 xs 500 poisson"),
}

# One more document for a chart that takes a content option, filed under a
# label of its own so the smoke test replays both readings. `lee` is the only
# one today, and it is the only way a **mixed** document, tower panels beside
# xy ones, reaches that harness at all: every other capture is one panel kind
# throughout. Each entry is (case, chart, label, params).
VARIANTS = [("reins", "structure", "structure+lee", {"lee": "true"})]

# The bounds envelope is not on an object's chart list: it is a document about a
# `Bounds`, reached through the bounds route with a premium. Captured under this
# case so the band, the equal-aspect square and the value-carrying cloud are all
# in the fixture set. The premium is a load on the object's own mean, which is
# what makes the pricing question real; a flat number would be inside the book
# on one case and outside it on the next.
ENVELOPE = {"case": "port", "load": 1.25, "n_resamples": 5}


def main() -> None:
    warnings.filterwarnings("ignore")
    from aggregate_api.app import create_app

    out: dict[str, dict] = {}
    oids: dict[str, str] = {}
    with TestClient(create_app()) as client:
        for case, decl in CASES.items():
            built = client.post("/v1/objects", json={"decl": decl})
            built.raise_for_status()
            body = built.json()
            oid = body["id"]
            oids[case] = oid
            names = (body.get("capability") or {}).get("charts") or []
            entry = {"build": body, "charts": {}}
            for name in names:
                r = client.get(f"/v1/objects/{oid}/chart/{name}")
                entry["charts"][name] = r.json() if r.status_code == 200 else None
            out[case] = entry
            print(f"{case:11s} kind={body['kind']:<11s} charts={names}")

        for case, name, label, params in VARIANTS:
            if case not in oids or name not in out[case]["charts"]:
                print(f"{label:11s} skipped: {case} publishes no {name!r}")
                continue
            r = client.get(f"/v1/objects/{oids[case]}/chart/{name}", params=params)
            out[case]["charts"][label] = r.json() if r.status_code == 200 else None
            print(f"{label:11s} {case}/{name} {params} status={r.status_code}")

        built = out[ENVELOPE["case"]]["build"]
        premium = round(ENVELOPE["load"] * float(built["mean"]))
        r = client.get(f"/v1/objects/{built['id']}/bounds/envelope",
                       params={"premium": premium,
                               "n_resamples": ENVELOPE["n_resamples"]})
        out["envelope"] = {"build": built,
                           "charts": {"envelope": r.json() if r.status_code == 200
                                      else None}}
        print(f"{'envelope':11s} premium={premium} status={r.status_code}")

    # dev/fixtures, one level up: the scripts live in dev/scripts, the data they
    # read and write does not.
    target = Path(__file__).resolve().parent.parent / "fixtures" / "charts.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(out), encoding="utf-8")
    size = target.stat().st_size / 1024
    print(f"\nwrote {target} ({size:,.0f} kB)")


if __name__ == "__main__":
    main()
