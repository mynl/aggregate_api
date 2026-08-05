"""Capture one build response per kind, for the app-side navigation check.

Writes ``dev/fixtures/capability.json``: the whole build response for one
object of every kind the api builds, which is what ``check-nav.mjs`` runs the
real navigation rules against. The payload is the api's own answer rather than
a fixture anyone wrote by hand, so the check cannot drift from what the server
actually sends.

Drives the app in-process through ``TestClient``, binding no port, per the
standing server policy in ``dev/TODO.md``.

    uv run --no-sync python dev/scripts/capture-capability.py
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from aggregate_api.app import create_app

# The same fixtures as tests/test_capability.py, and for the same reason: one
# object of each kind, plus the two that light exhibits their plain forms do
# not (a cession, and a P&L walk).
DECLS = {
    "agg": "agg CAP.Agg 10 claims sev lognorm 100 cv 1.5 poisson",
    "agg_reins": ("agg CAP.Reins 10 claims sev lognorm 100 cv 1.5 "
                  "occurrence net of 100 xs 100 poisson"),
    "port": ("port CAP.Port agg A 10 claims sev lognorm 100 cv 1.5 poisson "
             "agg B 5 claims sev gamma 50 cv 0.8 poisson"),
    "sev": "sev CAP.Sev lognorm 50 cv 1.5",
    "distortion": "distortion CAP.Dist dual 2",
    "bvagg": ("bivariate CAP.Bv 25 claims "
              "agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 "
              "agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 "
              "copula gumbel 0.4 poisson"),
    "pnl": ("pnl CAP.Pnl 1000 prem less "
            "agg CAP.PnlL 1000 prem at 70% lr sev lognorm 100 cv 2 poisson"),
    "xpnl": ("xpnl CAP.Xpnl 1000 prem less "
             "agg CAP.XpnlL 1000 prem at 70% lr sev lognorm 100 cv 2 "
             "occurrence ceded to 500 xs 500 deposit 100 poisson"),
}

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "capability.json"


def main() -> None:
    client = TestClient(create_app())
    payloads = {}
    for label, decl in DECLS.items():
        response = client.post("/v1/objects", json={"decl": decl, "log2": 12})
        response.raise_for_status()
        body = response.json()
        # The id and the timing change every run and would make the fixture
        # churn in git for no reason; nothing downstream reads them.
        body.pop("id", None)
        body.pop("elapsed_ms", None)
        body.pop("cached", None)
        payloads[label] = body
        exhibits = [e["name"] for e in body["capability"]["exhibits"]]
        print(f"{label:11s} {body['kind']:6s} "
              f"exhibits={len(exhibits):2d} charts={body['capability']['charts']}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payloads, indent=2, sort_keys=True) + "\n",
                   encoding="utf-8")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
