"""Check that a table document can stand in for a FrameResponse.

a35 made the SPA fetch one ``?format=ir`` document per table and derive the
interactive grid's input from it with ``irToGridInput``, instead of fetching a
``FrameResponse`` alongside. This is the check that the substitution is
lossless: if any cell disagrees, the interactive view silently changed.

Two halves, because neither language can do it alone. This half builds real
frames through the api and dumps ``(document, FrameResponse)`` pairs; the node
half runs the **shipped** walker over them (the same asset the browser loads)
and compares after applying csv-grid's own cell coercion.

**Two passes since a160.** The pair comparison answers "do the two renderings
agree", and it structurally cannot reach an exhibit: an exhibit envelope has no
``FrameResponse`` counterpart to disagree with. So a second pass dumps every
exhibit block, in both perspectives, for the node half to check the one thing
that does not need a counterpart: whether csv-grid can parse the format specs
the adapter derives. That is what was missing when a ``.5g`` on Overview /
Validation stopped the interactive view dead and every harness here stayed
green.

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


# `_price_pairs` came out at a85 with the routes it drove. It dumped the
# POST-computed pricing frames beside their documents, and the substitution it
# checked no longer exists: those frames were built here, from the reader's own
# input, so the same POST could answer with both a `FrameResponse` and a
# document made from it. The library holds them on a result object now and
# serves exhibit envelopes, which carry no second rendering to disagree with.
#
# One property it covered is worth naming, because it is the reason the pass was
# added: three of those documents carried a **string** data column, which caught
# the `include_raw` gap (the `'data'` shorthand covers numeric columns only, so
# they built fine and then threw in the adapter). `validation_df` and `stats_df`
# below carry one too, so the case is still exercised.


def main() -> int:
    # `raise_server_exceptions=False` so a route that raises is a reported skip
    # rather than the end of the run. Earned immediately: `bs_window` is listed
    # by `available_exhibits` for an object that cannot produce one, and
    # `build_exhibit` then dies inside the library on a None frame instead of
    # declining, which the route would have turned into a 400. Reported upstream;
    # see `dev/TODO.md`. A harness that walks everything meets things like this,
    # and it should say so and carry on.
    client = TestClient(create_app(), raise_server_exceptions=False)
    oid = client.post(
        "/v1/objects", json={"decl": DECL, "log2": 12, "bs": 1}
    ).json()["id"]

    with tempfile.TemporaryDirectory() as tmp:
        written = 0
        for which, route in PAIRS.items():
            ir = client.get(f"/v1/objects/{oid}/frame/{which}?format=ir")
            frame = client.get(f"/v1/objects/{oid}/{route}")
            if ir.status_code != 200 or frame.status_code != 200:
                # Flushed, or python's buffer holds every skip line until after
                # the node half has printed its whole report.
                print(f"  skip {which}: ir={ir.status_code} json={frame.status_code}",
                      flush=True)
                continue
            (Path(tmp) / f"{which}.pair.json").write_text(
                json.dumps({"ir": ir.json(), "frame": frame.json()}),
                encoding="utf-8",
            )
            written += 1
        if not written:
            print("nothing to compare")
            return 1

        # Pass two: every exhibit the object serves, in both perspectives, for
        # the spec check alone. Both perspectives because the library resolves
        # formats per perspective, and ``raw`` is the one that comes back
        # "general" almost throughout, so checking ``insurer`` alone would see
        # two `gen` columns where there are twenty.
        listing = client.get(f"/v1/objects/{oid}/exhibits")
        for item in listing.json().get("exhibits", []) if listing.status_code == 200 else []:
            for perspective in ("raw", "insurer"):
                got = client.get(
                    f"/v1/objects/{oid}/exhibit/{item['name']}"
                    f"?perspective={perspective}"
                )
                if got.status_code != 200:
                    print(f"  skip exhibit {item['name']} ({perspective}): "
                          f"{got.status_code}", flush=True)
                    continue
                for n, block in enumerate(got.json().get("blocks", [])):
                    (Path(tmp) / f"{item['name']}.{perspective}.{n}.spec.json").write_text(
                        json.dumps(block), encoding="utf-8",
                    )

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
