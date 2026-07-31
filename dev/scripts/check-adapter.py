"""Check that a table document can stand in for a FrameResponse.

a35 made the SPA fetch one ``?format=ir`` document per table and derive the
interactive grid's input from it with ``irToGridInput``, instead of fetching a
``FrameResponse`` alongside. This is the check that the substitution is
lossless: if any cell disagrees, the interactive view silently changed.

Two halves, because neither language can do it alone. This half builds real
frames through the api and dumps ``(document, FrameResponse)`` pairs; the node
half runs the **shipped** walker over them (the same asset the browser loads)
and compares after applying csv-grid's own cell coercion.

Run it after touching ``tables.py``, the frame routes, or the SPA's table
plumbing, and whenever ``greater-tables`` moves::

    uv run python dev/scripts/check-adapter.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from importlib.resources import files
from pathlib import Path

from fastapi.testclient import TestClient

from aggregate_api.app import create_app

# A portfolio, because the two level row index is what the document keeps and
# the wire format throws away, and an Aggregate would not exercise it.
DECL = (
    "port ADPT agg A 10 claims sev lognorm 100 cv 1.5 poisson "
    "agg B 5 claims sev gamma 50 cv 0.8 poisson"
)

# Frame name to the JSON route that answers the same frame. Densities are
# excluded: they are paginated previews and stay on the bulk path permanently,
# so they never become a document and there is nothing to compare.
PAIRS = {
    "summary": "summary",
    "tail_df": "tail_df",
    "validation_df": "validation_df",
    "stats_df": "stats_df",
    "bs_window_df": "bs_window_df",
}


# An object carrying reinsurance, for the reins_price frames.
REINS_DECL = (
    "agg ADPTR 5 claims 100 xs 0 sev lognorm 10 cv .75 "
    "occurrence ceded to 15 xs 5 poisson"
)


def _price_pairs(client, tmp: Path) -> int:
    """Dump the POST-computed pricing frames beside their documents.

    These are worth their own pass. They are the frames that carry declared
    formats (a loss ratio is a float, so only ``tables.FORMATS`` knows it reads
    as a percent), and three of them carry a **string** data column, which is
    what caught the ``include_raw`` gap: the ``'data'`` shorthand covers numeric
    columns only, so those documents built fine and then threw in the adapter.
    """
    written = 0
    oid = client.post("/v1/objects", json={"decl": DECL}).json()["id"]
    price = client.post(
        f"/v1/objects/{oid}/price?ir=true", json={"p": 0.99, "coc": 0.1}
    ).json()
    frames = {"pentagon": price.get("pentagon"),
              "distortion_df": price.get("distortion_df"),
              **(price.get("distortions") or {})}
    for key, doc in (price.get("ir") or {}).items():
        if frames.get(key) is None:
            continue
        (tmp / f"price-{key}.pair.json").write_text(
            json.dumps({"ir": doc, "frame": frames[key]}), encoding="utf-8")
        written += 1

    rid = client.post("/v1/objects", json={"decl": REINS_DECL}).json()["id"]
    rp = client.post(
        f"/v1/objects/{rid}/reins_price?ir=true",
        json={"p": 0.99, "coc": 0.1, "basis": "gross"},
    ).json()
    rframes = {"table": rp.get("table"), "distortion_df": rp.get("distortion_df")}
    for key, doc in (rp.get("ir") or {}).items():
        if rframes.get(key) is None:
            continue
        (tmp / f"reinsprice-{key}.pair.json").write_text(
            json.dumps({"ir": doc, "frame": rframes[key]}), encoding="utf-8")
        written += 1
    return written


def main() -> int:
    client = TestClient(create_app())
    oid = client.post(
        "/v1/objects", json={"decl": DECL, "log2": 12, "bs": 1}
    ).json()["id"]

    with tempfile.TemporaryDirectory() as tmp:
        written = 0
        for which, route in PAIRS.items():
            ir = client.get(f"/v1/objects/{oid}/frame/{which}?format=ir")
            frame = client.get(f"/v1/objects/{oid}/{route}")
            if ir.status_code != 200 or frame.status_code != 200:
                print(f"  skip {which}: ir={ir.status_code} json={frame.status_code}")
                continue
            (Path(tmp) / f"{which}.pair.json").write_text(
                json.dumps({"ir": ir.json(), "frame": frame.json()}),
                encoding="utf-8",
            )
            written += 1
        written += _price_pairs(client, Path(tmp))
        if not written:
            print("nothing to compare")
            return 1

        # The walker out of the installed package, which is the same file the
        # SPA loads from /v1/assets. Checking a bundled copy would prove nothing
        # about what the browser runs.
        walker = files("greater_tables") / "assets" / "gt-render.esm.js"
        return subprocess.call(
            ["node", str(Path(__file__).parent / "check-adapter.mjs"),
             tmp, str(walker)]
        )


if __name__ == "__main__":
    sys.exit(main())
