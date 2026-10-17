"""Where the time goes serving a big density frame, and what each wire format costs.

Run from the repository root::

    uv run --no-sync python dev/bench_frame_encodings.py

Builds a synthetic three-unit portfolio directly through ``aggregate.build``,
never through the api, so no audit row is written. Reports three tables:

* the stages of the JSON path as it stood before ``[orjson-frames]`` against
  :func:`aggregate_api.serializers.frame_response`;
* the gzip levels, since Starlette's ``GZipMiddleware`` defaults to 9;
* the frame in each wire format: JSON, CSV, Parquet (when pyarrow imports) and
  Arrow IPC, with size on the wire and encode and decode times.

The numbers behind ``dev/done/plan-fast-frames.md`` came from this script on
2026-10-17. Parquet with zstd and byte stream split was the one format both
smaller and faster than gzipped JSON; plain Parquet is no smaller, because
full-precision floats are close to incompressible until their bytes are
regrouped by position.
"""

from __future__ import annotations

import gzip
import io
import json
import time

import numpy as np
import pandas as pd
from pydantic import TypeAdapter

from aggregate import build
from aggregate_api import models
from aggregate_api.serializers import frame_response, frame_to_payload, reset_index_safe

DECL = (
    "port BenchP agg A 10 claims sev lognorm 10 cv 1 poisson "
    "agg B 5 claims sev gamma 20 cv 0.5 poisson "
    "agg C 3 claims sev lognorm 50 cv 2 poisson"
)


def timed(fn):
    """Run ``fn`` once and return ``(result, milliseconds)``."""
    t = time.perf_counter()
    out = fn()
    return out, (time.perf_counter() - t) * 1000


def row(label: str, ms: float, extra: str = "") -> None:
    print(f"  {label:<48}{ms:>8.0f} ms  {extra}")


def main() -> None:
    port = build(DECL, log2=16, bs=1 / 4)
    df = reset_index_safe(port.density_df)
    print(f"density_df: {df.shape[0]:,} rows x {df.shape[1]} cols = {df.size:,} cells\n")

    print("JSON path, stage by stage (as served before [orjson-frames])")
    payload, ms = timed(lambda: frame_to_payload(df))
    row("frame_to_payload, per-cell coercion", ms)
    adapter = TypeAdapter(models.FrameResponse)
    validated, ms = timed(lambda: adapter.validate_python(payload))
    row("response_model validate", ms)
    dumped, ms = timed(lambda: adapter.dump_python(validated, mode="json"))
    row("response_model serialize", ms)
    body, ms = timed(lambda: json.dumps(
        dumped, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode())
    row("json.dumps", ms, f"{len(body) / 1e6:.1f} MB")
    print("JSON path now")
    resp, ms = timed(lambda: frame_response(df))
    same = json.loads(resp.body) == json.loads(body)
    row("frame_response (orjson over the array)", ms,
        f"{len(resp.body) / 1e6:.1f} MB, same document: {same}")

    print("\ngzip of the JSON body")
    for level in (9, 6, 1):
        gz, ms = timed(lambda: gzip.compress(body, level))
        row(f"level {level}", ms, f"{len(gz) / 1e6:.2f} MB")

    print("\nwire formats")
    print(f"  {'format':<30}{'wire MB':>9}{'encode ms':>11}{'decode ms':>11}")
    results = []

    gz, ms = timed(lambda: gzip.compress(resp.body, 6))
    _, dms = timed(lambda: json.loads(gzip.decompress(gz)))
    results.append(("JSON (orjson) + gzip 6", len(gz), ms, dms))

    csv_text, ms = timed(lambda: df.to_csv(index=False).encode())
    gz, gms = timed(lambda: gzip.compress(csv_text, 6))
    _, dms = timed(lambda: pd.read_csv(io.BytesIO(gzip.decompress(gz))))
    results.append(("CSV + gzip 6", len(gz), ms + gms, dms))

    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        pa = pq = None
        print("  (pyarrow not installed: Parquet and Arrow rows skipped)")
    if pa is not None:
        table = pa.Table.from_pandas(df, preserve_index=False)
        for codec, split in (("snappy", False), ("zstd", False), ("zstd", True)):
            def write(codec=codec, split=split):
                buf = io.BytesIO()
                pq.write_table(table, buf, compression=codec,
                               use_dictionary=not split, use_byte_stream_split=split)
                return buf.getvalue()
            body_pq, ms = timed(write)
            back, dms = timed(lambda: pq.read_table(io.BytesIO(body_pq)).to_pandas())
            a, b = df.to_numpy(float), back.to_numpy(float)
            exact = bool(((a == b) | (np.isnan(a) & np.isnan(b))).all())
            label = f"Parquet {codec}{' + byte stream split' if split else ''}"
            results.append((label + ("" if exact else " (NOT EXACT)"), len(body_pq), ms, dms))

        def ipc():
            sink = pa.BufferOutputStream()
            with pa.ipc.new_stream(sink, table.schema) as writer:
                writer.write_table(table)
            return sink.getvalue().to_pybytes()
        body_ipc, ms = timed(ipc)
        gz, gms = timed(lambda: gzip.compress(body_ipc, 6))
        _, dms = timed(lambda: pa.ipc.open_stream(gzip.decompress(gz)).read_all().to_pandas())
        results.append(("Arrow IPC + gzip 6", len(gz), ms + gms, dms))

    for label, size, enc, dec in results:
        print(f"  {label:<30}{size / 1e6:>9.2f}{enc:>11.0f}{dec:>11.0f}")


if __name__ == "__main__":
    main()
