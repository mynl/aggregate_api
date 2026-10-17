"""Capture the exhibit payloads the Excel add-in's unit tests read.

Run from the repository root::

    uv run --no-sync python dev/capture_excel_fixtures.py

Writes ``excel/test/fixtures/*.json``, which are committed: small, public, and
built from ``library.agg`` entries only, so they carry no data of anyone's. The
audit log goes to a temporary file, never ``~/.aggregate/api/audit.db``.

Re-run after a change to the exhibit IR or to the entries below, and read the
diff: the add-in flattens exactly these shapes.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "excel" / "test" / "fixtures"

#: (file stem, library entry, route under /v1/objects/{id}). ``BasicBook``'s
#: stats exhibit has a two-level stub, so its rows carry ``rowspan``;
#: ``AggregateStopLoss``'s reins exhibit has two blocks.
CAPTURES = [
    ("exhibits-basicbook", "BasicBook", "exhibits"),
    ("summary-basicbook", "BasicBook", "exhibit/summary"),
    ("stats-basicbook", "BasicBook", "exhibit/stats"),
    ("reins-aggregatestoploss", "AggregateStopLoss", "exhibit/reins"),
    ("quantiles-basicbook", "BasicBook", "quantiles?snap=false&p=0.5,0.99"),
    ("frames-aggregatestoploss", "AggregateStopLoss", "frames"),
]


def main() -> None:
    """Build each entry through the app and write each route's body."""
    os.environ["AGGAPI_AUDIT_DB"] = str(Path(tempfile.mkdtemp()) / "audit.db")
    os.environ["AGGAPI_CORS_ORIGINS"] = ""
    os.environ.pop("AGGAPI_LIBRARY", None)

    from fastapi.testclient import TestClient

    from aggregate_api.app import create_app

    OUT.mkdir(parents=True, exist_ok=True)
    with TestClient(create_app()) as client:
        ids: dict[str, str] = {}
        for stem, entry, route in CAPTURES:
            if entry not in ids:
                built = client.post("/v1/objects", json={"decl": entry})
                built.raise_for_status()
                ids[entry] = built.json()["id"]
            reply = client.get(f"/v1/objects/{ids[entry]}/{route}")
            reply.raise_for_status()
            path = OUT / f"{stem}.json"
            path.write_text(json.dumps(reply.json(), indent=1, sort_keys=True) + "\n",
                            encoding="utf-8")
            print(f"{path.name}: {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
