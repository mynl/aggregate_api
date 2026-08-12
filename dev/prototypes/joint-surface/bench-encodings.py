"""What each candidate wire format actually costs, on the real joint surfaces.

Run
---
    uv run --no-sync --with blosc2 --with zstandard python \n        dev/prototypes/joint-surface/bench-encodings.py

The float64 here comes straight out of ``chart_joint_surface`` rather than out
of ``surface-data.json``, which is trimmed to six significant figures. That
distinction is the whole point of the exercise: trimmed doubles carry 30-odd
dead mantissa bits that compress away, real ones carry 52 bits of FFT noise
that do not, so benchmarking the trimmed file would flatter float64 by a wide
margin and recommend it on false numbers.
"""

from __future__ import annotations

import gzip
import json
from base64 import b64encode

import numpy as np
from aggregate import build
from aggregate.charts import chart_joint_surface

import blosc2
import zstandard

import importlib.util
import pathlib
spec = importlib.util.spec_from_file_location(
    "mk", str(pathlib.Path(__file__).with_name("make-surface-data.py")))
mk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mk)


def encodings(z: np.ndarray) -> dict[str, bytes]:
    """One dict of candidate payloads for the same grid."""
    peak = z.max()
    floor = peak * 1e-12
    lg = np.log10(np.maximum(z, floor) / peak)
    return {
        "json 6sf": json.dumps(
            [float(f"{v:.6g}") for v in z.ravel()], separators=(",", ":")
        ).encode(),
        "float64": z.astype("<f8").tobytes(),
        "float32": z.astype("<f4").tobytes(),
        "u16 log": np.clip(((lg + 12) / 12 * 65535).round(), 0, 65535).astype("<u2").tobytes(),
    }


def compressors(itemsize: int) -> dict:
    """Named compressors, each taking bytes and returning bytes.

    Notes
    -----
    ``filters`` is plural and takes a list. The singular ``filter=`` is
    accepted, ignored, and leaves the default byte shuffle in place, so a
    comparison written that way silently compares the default with itself.
    """
    zc = zstandard.ZstdCompressor(level=9)
    b2 = lambda f: (lambda b: blosc2.compress2(
        b, typesize=itemsize, codec=blosc2.Codec.ZSTD, filters=[f], clevel=9))
    return {
        "gzip": lambda b: gzip.compress(b, 6),
        "zstd": lambda b: zc.compress(b),
        "b2 plain": b2(blosc2.Filter.NOFILTER),
        "b2 byteshuf": b2(blosc2.Filter.SHUFFLE),
        "b2 bitshuf": b2(blosc2.Filter.BITSHUFFLE),
    }


def report(name: str, z: np.ndarray) -> None:
    n = z.size
    zeros = float((z == 0).mean())
    print(f"\n=== {name}  {z.shape[1]} x {z.shape[0]} = {n:,} cells, {100 * zeros:.1f}% exact zeros")
    head = f"{'':10s} {'raw':>9s}" + "".join(f"{k:>12s}" for k in compressors(4)) + f"{'bits/cell':>10s}"
    print(head)
    for enc, buf in encodings(z).items():
        size = {"json 6sf": 1, "float64": 8, "float32": 4, "u16 log": 2}[enc]
        got = {k: len(f(buf)) for k, f in compressors(size).items()}
        best = min(got.values())
        print(
            f"{enc:10s} {len(buf) / 1024:8.1f}K"
            + "".join(f"{v / 1024:11.1f}K" for v in got.values())
            + f" {8 * best / n:9.2f}"
        )


def crop(z: np.ndarray, p: float) -> np.ndarray:
    """The quantile window the lab applies, so the payload is the real one."""
    def bounds(m):
        c = np.cumsum(m) / m.sum()
        return int(np.searchsorted(c, p)), int(np.searchsorted(c, 1 - p))
    r0, r1 = bounds(z.sum(1))
    c0, c1 = bounds(z.sum(0))
    return z[r0:r1 + 1, c0:c1 + 1]


def main() -> None:
    for name, (label, decl) in mk.SPECS.items():
        obj = build(decl)
        sd = mk.surface_of(chart_joint_surface(obj))
        report(name, np.asarray(sd.z, dtype=float))

    # The fine lattice under one of them, standing in for the payload a window
    # chosen upstream would be cut from, and for any future 512-wide grid.
    obj = build(mk.SPECS["IndepSigned"][1])
    fine = np.asarray(obj.density, dtype=float)
    report("IndepSigned, fine lattice", fine)

    # What would actually be sent: the fine lattice cropped to the window and
    # block reduced to a 128-ish display grid, and the same window taken at
    # full fine resolution, which is what a big surface would cost.
    z = np.asarray(mk.surface_of(chart_joint_surface(obj)).z, dtype=float)
    report("IndepSigned, display grid cropped to q(1e-4)", crop(z, 1e-4))
    report("IndepSigned, fine lattice cropped to q(1e-4)", crop(fine, 1e-4))

    # What base64 costs, on the one that will actually be sent.
    z = np.asarray(mk.surface_of(chart_joint_surface(obj)).z, dtype=float)
    f32 = z.astype("<f4").tobytes()
    zc = zstandard.ZstdCompressor(level=9)
    packed = blosc2.compress2(f32, typesize=4, codec=blosc2.Codec.ZSTD,
                              filter=blosc2.Filter.BITSHUFFLE, clevel=9)
    print(
        f"\nbase64, on IndepSigned float32: raw {len(f32) / 1024:.1f}K -> "
        f"b64 {len(b64encode(f32)) / 1024:.1f}K, "
        f"blosc2 {len(packed) / 1024:.1f}K -> b64 {len(b64encode(packed)) / 1024:.1f}K -> "
        f"b64 then gzipped by the transport {len(gzip.compress(b64encode(packed), 6)) / 1024:.1f}K"
    )


if __name__ == "__main__":
    main()
