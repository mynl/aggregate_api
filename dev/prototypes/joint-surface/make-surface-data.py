"""Bake three real bivariate joint densities into JSON for the surface lab.

Why this exists. Every surface in ``surface-lab.html`` up to now has been a
closed-form bump: a mixture of two normals, a damped cosine, peaks. Those are
fine for arguing about lighting and useless for arguing about anything else,
because they are smooth, symmetric, supported on a square, and have no tail. A
real joint aggregate is none of those things, and every design decision that
matters here is a decision about what happens in the tail.

So this runs the DecL through ``aggregate`` and writes out exactly what the
library's own chart emitter produces, ``chart_joint_surface``, which is the
display grid the app will be handed. Nothing is recomputed or smoothed on the
way. The lab then block-sums it further to whatever resolution the ``n`` slider
asks for, which is mass preserving, so the picture stays a probability
distribution at every resolution.

The single most useful thing this exposed: the two axes do **not** share a
bucket size, and they do not always share a length either. One of the three
comes out 64 wide and 128 deep, with dx = 2 against dy = 512. Any code that
treats the mesh as square, or that reads a line of constant ``x + y`` off the
index anti-diagonal, is wrong on real data and right only on the synthetic
bumps that were here before.

Run
---
    uv run --no-sync python dev/prototypes/joint-surface/make-surface-data.py

Writes ``surface-data.json`` beside this file. The lab fetches it at
startup and carries on without those three surfaces if it is missing.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from aggregate import build
from aggregate.charts import chart_joint_surface

# The name the lab shows, against the program. Names are the author's; the DecL
# blocks all declared themselves `BivariateClaytonMixed`, which they are not.
#
# One thing the names get wrong and it matters, because these are the surfaces
# every claim on the page is checked against. Only ``Indep`` has independent
# marginals. It is the one with ``dfreq[1]`` at the top: one claim, certain, so
# the two units share nothing and the joint is the product of its marginals to
# 2.5e-5, which is the six-figure trim and not a real gap. The three that open
# ``10 claims ... poisson`` share the claim count. That makes their units
# conditionally independent given N and dependent without it, however
# independent the copula is: the worst relative gap from the product of the
# marginals is 7.7x on ``IndepSigned`` and 124x on ``IndepFreq``, both worst at
# the origin, where the shared event N = 0 puts an atom neither marginal
# expects. So a conditional that moves as the cut sweeps is correct on those
# three and would be a bug on ``Indep``.
SPECS = {
    "Clayton": (
        "two lognormals, Clayton copula",
        """
bivariate Clayton
  dfreq[1]
  agg Wind
    dfreq [1] sev lognorm 40 cv .4
  agg Flood
    dfreq [1] sev lognorm 60 cv 0.5
  copula clayton 0.5
""",
    ),
    "Indep": (
        "gamma against a Lomax tail, independent",
        """
bivariate Indep
  dfreq[1]
  agg Tame
    dfreq [1] sev gamma 100 cv .1
  agg Severe
    dfreq [1] sev 50 * lomax 3.1
""",
    ),
    "IndepFreq": (
        # Not "the same pair over Poisson 10", which is what this said and is
        # not true of it: the severities differ from `Indep` as well, cv .5
        # against .1 and a much heavier scaled Lomax. Two things change at
        # once, so it is a second example rather than a controlled comparison.
        "a wider gamma against a heavy Lomax, over Poisson 10",
        """
bivariate IndepFreq
  10 claims
  agg Tame
    dfreq [1] sev gamma 100 cv .5
  agg Severe
    dfreq [1] sev 510 * lomax 6.1
  poisson
""",
    ),
    # The one with mass on both sides of zero, and the reason it is here: every
    # other surface starts at the origin, so nothing before it could tell a
    # window that begins at zero from one that begins where the mass does, and
    # a display convention that quietly assumes non-negative support has
    # nothing to fail against.
    "IndepSigned": (
        "two signed normals, support either side of zero",
        """
bivariate IndepSigned
  10 claims
  agg Tame
    dfreq [1] ssev 100 * norm
  agg Severe
    dfreq [1] ssev 150 * norm - 50
  poisson
""",
    ),
}


def surface_of(doc):
    """The ``SurfaceData`` out of a chart document, whichever way it hangs."""
    if getattr(doc, "surface", None) is not None:
        return doc.surface
    return doc.series[0].surface


def fine_moments(obj) -> tuple[list[float], list[float]]:
    """The bucket sizes and the two means, off the object's own joint lattice.

    Returns
    -------
    (bs, mean) : tuple of two lists
        ``bs`` is the fine bucket size on each axis, ``mean`` the mean of each
        marginal computed on the fine lattice.

    Notes
    -----
    These exist to be compared with the same two numbers read off the display
    grid, which is a block reduction of this lattice and should therefore agree
    with it. It does not: see the note in ``main``.
    """
    df = obj.density_df
    xs = np.asarray(df.index, dtype=float)
    ys = np.asarray(df.columns, dtype=float)
    px, py = obj.marginals
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    if px.size != xs.size or py.size != ys.size:
        raise ValueError(f"marginals are {px.size}, {py.size} against lattice {xs.size}, {ys.size}")
    bs = [float(xs[1] - xs[0]), float(ys[1] - ys[0])]
    mean = [float((xs * px).sum()), float((ys * py).sum())]
    return bs, mean


def pack(name: str, label: str, decl: str) -> dict:
    """Build one program and reduce its joint surface to a JSON-ready dict.

    Returns
    -------
    dict
        ``x`` and ``y`` are the two loss grids, ``z`` is the joint mass flat in
        row-major order over ``(y, x)``, and ``shape`` is ``[len(y), len(x)]``
        so the lab can reshape without guessing which way round it is. ``bs``
        and ``mean`` come off the fine lattice underneath the display grid, and
        ``grid_mean`` is the same pair read off the display grid itself.

    Notes
    -----
    ``z`` is a **mass** per cell, summing to one, not a density: dividing by
    ``dx * dy`` would be a density and would also make the two axes' different
    bucket sizes silently disappear into the values. Keeping mass means the
    lab's own block summing is exact, and the lab divides by the cell area once
    at the end, which is where the density belongs.
    """
    obj = build(decl)
    sd = surface_of(chart_joint_surface(obj))
    x = np.asarray(sd.x, dtype=float)
    y = np.asarray(sd.y, dtype=float)
    z = np.asarray(sd.z, dtype=float)
    if z.shape != (y.size, x.size):
        raise ValueError(f"{name}: z is {z.shape}, expected {(y.size, x.size)}")

    bs, mean = fine_moments(obj)

    # Six significant figures. The smallest cells here are around 1e-30 and
    # nothing downstream can tell them apart from zero, so full float repr would
    # be a megabyte of noise.
    def trim(a):
        return [float(f"{v:.6g}") for v in a]

    return {
        "label": label,
        "units": list(getattr(obj, "unit_names", None) or ["x", "y"]),
        "decl": decl.strip(),
        "x": trim(x),
        "y": trim(y),
        "shape": [int(y.size), int(x.size)],
        "z": trim(z.ravel()),
        "mass": float(z.sum()),
        "bs": bs,
        "mean": mean,
        "grid_mean": [float((z.sum(0) * x).sum()), float((z.sum(1) * y).sum())],
    }


def main() -> None:
    """Bake every spec, and print the mean the display grid reports beside the
    mean the lattice under it actually has.

    Notes
    -----
    Those two do not agree, and the gap is a full block wide. The display grid
    labels each aggregated block with the coordinate of its **last** fine cell,
    so a block covering ``[a, a + k * bs)`` is filed under ``a + (k - 1) * bs``.
    Two things follow and both show in the run below. A distribution supported
    on ``[0, inf)`` is reported as starting at ``(k - 1) * bs``, and every mean
    taken against these coordinates is biased up by close to one whole display
    bucket. On ``Indep`` that is +485 against a true mean of 23.8, because the
    y axis reduces 128 to 1 and its bucket is 512 wide.

    Nothing is corrected here. The numbers are printed so the bias is on the
    record each time this runs, and the fix belongs upstream in
    ``aggregate.charts``, where the block reduction should carry the block's
    first fine coordinate (its left edge, the convention the fine lattice is
    already in) rather than its last.
    """
    out = {}
    for name, (label, decl) in SPECS.items():
        packed = pack(name, label, decl)
        out[name] = packed
        ny, nx = packed["shape"]
        dx = packed["x"][1] - packed["x"][0]
        dy = packed["y"][1] - packed["y"][0]
        print(
            f"{name:12s} {nx:4d} x {ny:4d}  dx {dx:<12g} dy {dy:<12g}"
            f"  mass {packed['mass']:.6f}  units {packed['units']}"
        )
        for i, axis in enumerate("xy"):
            fine, grid = packed["mean"][i], packed["grid_mean"][i]
            step = (dx, dy)[i]
            print(
                f"{'':12s}   {axis} mean: lattice {fine:<14.6g} display grid "
                f"{grid:<14.6g} bias {grid - fine:<14.6g} = {(grid - fine) / step:.3f} buckets"
            )

    path = Path(__file__).with_name("surface-data.json")
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
