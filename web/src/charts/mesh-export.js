// The drawn surface as a mesh file: binary STL for a slicer, OBJ for a viewer.
//
// The first phase of `dev/plan-spacemouse.md`, and the one that is independent
// of every other: a `.obj` in 3Dconnexion's own viewer is fully tuned 6DOF
// navigation of the loss surface with no integration code at all, which is both
// the fastest route to the thing and the audition for the in-app version.
//
// **A leaf module: it imports nothing.** Everything here is arithmetic over a
// plain object and two byte writers, so `node --test` holds it down directly,
// the same argument `surface-grid.js` and `surface-geometry.js` make.
//
// The decision that matters is the input. This takes the **drawn** heights over
// the display lattice, the array the renderer hands echarts-gl, rather than the
// densities the document carries. So the export bakes in the log reading and
// the box proportions the reader is looking at, and the file opens as the shape
// on screen. Exported in raw units it would be a pancake: losses run to the
// thousands and a density to a millionth of one, and no viewer rescales axes.
//
// What is written is a height field and nothing more. Masked cells leave holes
// rather than inventing geometry to close them, so the mesh is an open shell
// and not a solid: a slicer will offer to close it, and closing it is a
// modeling decision this has no business making.
//
// Z is up in both writers, which is the STL convention and what a slicer
// assumes. Viewers that hold OBJ to be Y up will lay the box on its side, and
// the fix there is the import dialog rather than a second convention here.

/**
 * A filesystem-safe stem from a document title.
 *
 * Parameters
 * ----------
 * title : str
 *     The document's own title, which is what it says it is a picture of.
 *
 * Returns
 * -------
 * str
 *     Lowercase words joined by hyphens, or 'surface' when nothing survives.
 *
 * Notes
 * -----
 * Hyphens here are filename structure rather than punctuation in prose, which
 * is the distinction the house rule draws.
 */
export function fileStem(title) {
    const stem = String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return stem || 'surface';
}

/**
 * Triangulate a drawn height field into a mesh in display space.
 *
 * Parameters
 * ----------
 * field : object
 *     `{nx, ny, x0, dx, y0, dy, z}`. The lattice is the document's, stated as
 *     an origin, a step and a count on each axis; `z` holds the **drawn**
 *     height at `z[j * nx + i]`, which is the log of the density when the log
 *     reading is on. A non-finite height masks every cell that corner touches.
 * options : object
 *     `box`, the `{width, depth, height}` the grid3D draws the field in, and
 *     `zRange`, the `[min, max]` of the drawn z axis. `zRange` defaults to the
 *     extent of the finite heights, which fills the box; passing the axis
 *     range instead is what reproduces the proportions on screen, base drop
 *     and all.
 *
 * Returns
 * -------
 * object
 *     `{vertices, triangles, counts, box, zRange, dropped}`. `vertices` is a
 *     `Float64Array` of `x, y, z` triples in display units, `triangles` a
 *     `Uint32Array` of vertex index triples, `counts` the two totals, and
 *     `dropped` how many cells the mask took out.
 *
 * Raises
 * ------
 * Error
 *     For a lattice under two points on an axis, or a value count that does
 *     not match `nx * ny`. Loudly, because a mesh that is wrong by a row reads
 *     as a plausible shape and is a different surface.
 *
 * Notes
 * -----
 * Only referenced vertices are emitted, so a masked corner takes its vertex
 * with it and no file carries a NaN. That is what keeps every face index in
 * range, which is the one thing a viewer will not forgive.
 *
 * The x and y extents are the data's rather than the drawn axis bounds.
 * echarts extends a value axis outward to round numbers, so the box on screen
 * is a few percent wider than the data; matching that would mean reading the
 * live axis model, and the difference is not visible in a mesh.
 */
export function surfaceMesh(field, options = {}) {
    const { nx, ny, x0, dx, y0, dy, z } = field || {};
    if (!(nx > 1) || !(ny > 1)) {
        throw new Error('a surface mesh needs at least two points on each axis');
    }
    if (!z || z.length !== nx * ny) {
        throw new Error(`surface mesh got ${z ? z.length : 0} heights for a ${nx} by ${ny} grid`);
    }
    const box = { width: 100, depth: 100, height: 62, ...(options.box || {}) };
    const range = options.zRange || heightExtent(z);
    const [zLo, zHi] = range;
    const zSpan = (zHi - zLo) || 1;

    // Both horizontal axes are centered on the origin and the height stands on
    // it, which is where a viewer expects to find a model: centered in x and y,
    // sitting on the ground plane rather than straddling it.
    const xLo = Math.min(x0, x0 + (nx - 1) * dx);
    const xSpan = Math.abs((nx - 1) * dx) || 1;
    const yLo = Math.min(y0, y0 + (ny - 1) * dy);
    const ySpan = Math.abs((ny - 1) * dy) || 1;
    const atX = (i) => (((x0 + i * dx) - xLo) / xSpan - 0.5) * box.width;
    const atY = (j) => (((y0 + j * dy) - yLo) / ySpan - 0.5) * box.depth;
    const atZ = (v) => ((v - zLo) / zSpan) * box.height;

    const index = new Int32Array(nx * ny).fill(-1);
    const vertices = [];
    const triangles = [];
    const vertexAt = (i, j) => {
        const k = j * nx + i;
        if (index[k] < 0) {
            index[k] = vertices.length / 3;
            vertices.push(atX(i), atY(j), atZ(z[k]));
        }
        return index[k];
    };
    // Winding, so the normals come out up. The two mappings above are
    // increasing in the coordinate, so the walk along i runs against the axis
    // when the step is negative; with one negative step the cross product
    // flips and the surface renders inside out.
    const flip = dx * dy < 0;
    let dropped = 0;
    for (let j = 0; j < ny - 1; j += 1) {
        for (let i = 0; i < nx - 1; i += 1) {
            const k = j * nx + i;
            if (!Number.isFinite(z[k]) || !Number.isFinite(z[k + 1])
                || !Number.isFinite(z[k + nx]) || !Number.isFinite(z[k + nx + 1])) {
                dropped += 1;
                continue;
            }
            const a = vertexAt(i, j);
            const b = vertexAt(i + 1, j);
            const c = vertexAt(i + 1, j + 1);
            const d = vertexAt(i, j + 1);
            if (flip) triangles.push(a, c, b, a, d, c);
            else triangles.push(a, b, c, a, c, d);
        }
    }
    return {
        vertices: Float64Array.from(vertices),
        triangles: Uint32Array.from(triangles),
        counts: { vertices: vertices.length / 3, triangles: triangles.length / 3 },
        box,
        zRange: [zLo, zHi],
        dropped,
    };
}

/** The extent of the finite heights, for a caller that states no z range. */
function heightExtent(z) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < z.length; i += 1) {
        const v = z[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

/** The unit normal of one triangle, or `[0, 0, 0]` where it is degenerate. */
function normalOf(v, a, b, c) {
    const ux = v[b] - v[a];
    const uy = v[b + 1] - v[a + 1];
    const uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a];
    const wy = v[c + 1] - v[a + 1];
    const wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
}

/**
 * The mesh as binary STL.
 *
 * Parameters
 * ----------
 * mesh : object
 *     A `surfaceMesh` result.
 * name : str
 *     Written into the 80-byte header, which is the only place an STL can say
 *     what it is.
 *
 * Returns
 * -------
 * Uint8Array
 *     `84 + 50 * triangles` bytes: the header, a uint32 count, then a normal,
 *     three vertices and a two-byte attribute per triangle, all little endian.
 *
 * Notes
 * -----
 * Binary rather than ASCII, and the header deliberately does not begin with
 * "solid": a reader that finds that word at byte zero takes the whole file for
 * the ASCII form and then fails on the first line of binary.
 */
export function meshToStl(mesh, name = 'surface') {
    const n = mesh.counts.triangles;
    const buffer = new ArrayBuffer(84 + 50 * n);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const header = `aggregate Loss Lab surface: ${name}`;
    for (let i = 0; i < Math.min(80, header.length); i += 1) {
        const code = header.charCodeAt(i);
        bytes[i] = code < 128 ? code : 63;      // '?', so the header stays ASCII
    }
    view.setUint32(80, n, true);
    const v = mesh.vertices;
    for (let t = 0; t < n; t += 1) {
        const a = mesh.triangles[t * 3] * 3;
        const b = mesh.triangles[t * 3 + 1] * 3;
        const c = mesh.triangles[t * 3 + 2] * 3;
        const normal = normalOf(v, a, b, c);
        let at = 84 + t * 50;
        for (let k = 0; k < 3; k += 1) { view.setFloat32(at, normal[k], true); at += 4; }
        for (const corner of [a, b, c]) {
            for (let k = 0; k < 3; k += 1) {
                view.setFloat32(at, v[corner + k], true);
                at += 4;
            }
        }
        view.setUint16(at, 0, true);
    }
    return bytes;
}

/** Four decimal places, trailing zeros dropped: the box is 100 units wide. */
function num(v) {
    return String(Math.round(v * 1e4) / 1e4);
}

/**
 * The mesh as an OBJ.
 *
 * Geometry only: vertices and faces, no normals and no material. A viewer
 * computes the shading it wants from the winding, and the color question (a
 * viridis strip as a texture, or vertex colors in a GLB) is the author-gated
 * stretch in `dev/plan-spacemouse.md` phase 1.
 */
export function meshToObj(mesh, name = 'surface') {
    const v = mesh.vertices;
    const lines = [
        '# aggregate Loss Lab, surface export. Z is up, as in the STL',
        `# display box ${num(mesh.box.width)} by ${num(mesh.box.depth)}`
            + ` by ${num(mesh.box.height)}, height axis`
            + ` ${mesh.zRange[0].toPrecision(6)} to ${mesh.zRange[1].toPrecision(6)}`,
        `o ${name}`,
    ];
    for (let i = 0; i < v.length; i += 3) {
        lines.push(`v ${num(v[i])} ${num(v[i + 1])} ${num(v[i + 2])}`);
    }
    const t = mesh.triangles;
    for (let i = 0; i < t.length; i += 3) {
        // One based, which is the format's own convention and the single most
        // common way to write an OBJ nothing will open.
        lines.push(`f ${t[i] + 1} ${t[i + 1] + 1} ${t[i + 2] + 1}`);
    }
    lines.push('');
    return lines.join('\n');
}
