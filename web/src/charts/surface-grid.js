// The surface grid: one decode, one lattice, one unit.
//
// A chart document's grid panel carries its z values in whichever form the
// library was asked for, over a lattice it states as an origin, a step and a
// count. Two call sites draw that grid, `surfaceOption` in relief and
// `heatmapPanel` flat, and through a71 both destructured `series.surface`
// themselves. Two readers of one wire format drift, and the format is about to
// grow four encodings and a windowed lattice, so the decode lives here and
// they both call it.
//
// **A leaf module: it imports nothing.** That is deliberate rather than
// incidental. Everything in here is arithmetic over plain objects, so
// `node --test` can exercise it directly, while the two callers pull in
// echarts and cannot be imported outside a browser. See `dev/plan-3d-plot.md`
// section 8.3.
//
// Three decisions the format made, restated here because this is where they
// are enforced:
//
//   * the values on the wire are **mass per display cell**, not density. Mass
//     is what a block reduction preserves and is exact; density is one
//     division away and depends on a cell area the consumer has anyway. So the
//     division happens once, here, and everything downstream is density. The
//     prototype's worst bug was a marginal integrating as if `z` were a density
//     against a conditional normalizing into one, which disagreed by a factor
//     of 1024 on one surface and drew the conditional flat on the floor.
//   * both lattices are `(origin, step, count)`, never coordinate arrays. The
//     grid is an arithmetic sequence by construction (an aggregate lives on a
//     lattice, and the block reduction uses a power of two per axis), so an
//     array would be a derived quantity inviting the reader to wonder whether
//     it is uniform this time. Every interpolation downstream divides by a
//     constant step.
//   * `edge` says what a coordinate names, the left edge of its cell or its
//     midpoint. Stating it is what would have caught the display grid labeling
//     each block with its *last* fine coordinate, which biased every mean read
//     off the grid by close to a whole bucket.

/** The encodings the wire may declare, `dev/plan-3d-plot.md` section 2.3. */
export const SURFACE_DTYPES = ['f32b64', 'f64b64', 'u16log12b64', 'json'];

/**
 * Significant figures the encoding actually carries.
 *
 * The reading strip prints to this, so it never shows five digits of a number
 * known to four: `u16log12` spreads 65,536 codes over twelve decades, which is
 * about 2.1e-4 relative, and float32 is exact to seven figures. Printing more
 * digits than the wire carried invents precision.
 */
const DTYPE_DIGITS = { f32b64: 7, f64b64: 15, u16log12b64: 4, json: 6 };

// Typed-array views read in platform byte order; the wire is little endian.
// Every platform this ships to is little endian, so the view path is the fast
// one and the DataView loop below is the correctness fallback rather than dead
// code someone has to trust.
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Base64 to bytes.
 *
 * `atob` is in every browser and in node from 16, so this needs no polyfill
 * and no dependency. The result starts at byte offset 0 of its own buffer,
 * which is what lets the typed-array views below be taken without a copy.
 */
function bytesOf(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
}

/** IEEE floats of `width` bytes, little endian, as a Float64Array. */
function decodeFloats(bytes, width) {
    const n = Math.floor(bytes.byteLength / width);
    const out = new Float64Array(n);
    if (LITTLE_ENDIAN) {
        const view = width === 4
            ? new Float32Array(bytes.buffer, bytes.byteOffset, n)
            : new Float64Array(bytes.buffer, bytes.byteOffset, n);
        out.set(view);
        return out;
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * width);
    for (let i = 0; i < n; i += 1) {
        out[i] = width === 4 ? dv.getFloat32(i * width, true) : dv.getFloat64(i * width, true);
    }
    return out;
}

/**
 * The log-quantized form: code 0 for an exact zero, then 65,535 live codes
 * spread over `decades` decades under `peak`.
 *
 *     value = 0                                            if code == 0
 *     value = peak * 10 ** ((code - 1) / 65534 * decades - decades)
 *
 * The reserved zero is the library's, and it matters: an FFT-built joint is
 * between 14% and 59% exact zeros, and an encoding that could only say "twelve
 * decades down" would turn every one of them into a floor the log view then
 * draws as a real, flat surface. Anything more than `decades` under the peak
 * also encodes as zero, which is the wire saying it cannot carry that depth
 * rather than claiming the mass is absent; a consumer that needs it asks for a
 * float dtype.
 */
function decodeQuantized(bytes, peak, decades) {
    const n = bytes.byteLength >> 1;
    const out = new Float64Array(n);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    for (let i = 0; i < n; i += 1) {
        const code = dv.getUint16(i * 2, true);
        out[i] = code === 0
            ? 0
            : peak * 10 ** (((code - 1) / 65534) * decades - decades);
    }
    return out;
}

/** A nested or flat JSON array of values, flattened row major. */
function flatten(rows) {
    if (!Array.isArray(rows)) throw new Error('surface z is not an array');
    if (!Array.isArray(rows[0])) return Float64Array.from(rows);
    const ny = rows.length;
    const nx = rows[0].length;
    const out = new Float64Array(nx * ny);
    for (let r = 0; r < ny; r += 1) {
        const row = rows[r];
        for (let c = 0; c < nx; c += 1) out[r * nx + c] = row[c];
    }
    return out;
}

/**
 * The encoded block, whichever key it arrived under.
 *
 * `z_block` is the contract (`dev/plan-3d-plot.md` 2.4.1): the encoded form
 * takes its own key so that phase one can add it without breaking a reader
 * that still walks `z` as nested arrays. An encoded object found under `z`
 * itself is accepted too, as the transition courtesy that section names, and
 * that acceptance goes when phase two drops the array form.
 */
function encodedBlock(surface) {
    const block = surface.z_block;
    if (block && typeof block === 'object' && !Array.isArray(block)) return block;
    const z = surface.z;
    if (z && typeof z === 'object' && !Array.isArray(z) && z.dtype) return z;
    return null;
}

/** Values out of an encoded block, as a Float64Array in the block's own order. */
function decodeBlock(block) {
    const dtype = block.dtype || 'f32b64';
    if (dtype === 'json') return flatten(block.data);
    if (typeof block.data !== 'string') {
        throw new Error(`surface dtype ${dtype} wants base64 data`);
    }
    const bytes = bytesOf(block.data);
    if (dtype === 'f32b64') return decodeFloats(bytes, 4);
    if (dtype === 'f64b64') return decodeFloats(bytes, 8);
    if (dtype === 'u16log12b64') {
        const { peak, decades } = block;
        if (!(peak > 0) || !(decades > 0)) {
            throw new Error('u16log12b64 needs peak and decades');
        }
        return decodeQuantized(bytes, peak, decades);
    }
    throw new Error(`unknown surface dtype ${dtype}`);
}

/**
 * One axis as origin, step and count.
 *
 * Prefers the declared lattice. The array fallback is for the phase one
 * documents that still carry `x` and `y`, and it *assumes* what the lattice
 * form states: uniform spacing. The legacy emitter can break that assumption
 * in its last cell, since it clamps the final block label to the end of the
 * fine axis, so a document that declares its lattice is not merely tidier, it
 * is the one that is right at the edge.
 */
function latticeOf(surface, axis) {
    const origin = surface[`${axis}0`];
    const step = surface[`d${axis}`];
    const count = surface[`n${axis}`];
    if (Number.isFinite(origin) && Number.isFinite(step) && count > 0) {
        return { origin, step, count: Math.round(count) };
    }
    const coords = surface[axis];
    if (!Array.isArray(coords) || !coords.length) {
        throw new Error(`surface has no ${axis} lattice and no ${axis} array`);
    }
    return {
        origin: Number(coords[0]),
        step: coords.length > 1 ? Number(coords[1]) - Number(coords[0]) : 1,
        count: coords.length,
    };
}

/**
 * Decode one `series.surface` into a grid in density units.
 *
 * Parameters
 * ----------
 * surface : object
 *     The document's surface block: a lattice, an encoded `z_block` or the
 *     legacy `x`, `y`, `z` arrays, and whatever of `edge`, `bs`, `k`,
 *     `window`, `marginals`, `moments` and `deficit` the emitter declared.
 *
 * Returns
 * -------
 * object
 *     `{x0, dx, nx, y0, dy, ny, edge, z, ...}` with `z` a `Float64Array` of
 *     **density**, row major over `(y, x)`, so `z[j * nx + i]` is the density
 *     at x index `i` and y index `j`. Also `cellArea`, `totalMass` (the mass
 *     the grid holds, which is a free check on the decode), `dtype`, `digits`,
 *     `quantized`, and the declared `bs`, `k`, `quantileWindow`, `marginals`,
 *     `moments`, `deficit`.
 *
 * Raises
 * ------
 * Error
 *     For a missing lattice, an unknown dtype, or a value count that does not
 *     match `nx * ny`. Loudly, rather than drawing a grid that is wrong by a
 *     row: a silent mismatch here is a picture that reads plausibly and says
 *     something false.
 *
 * Notes
 * -----
 * The wire's `window` block is returned as `quantileWindow`. `window` is a
 * browser global and this code runs in a browser, so a destructured `window`
 * is one keystroke from a bug that only shows up when a caller forgets to
 * destructure it.
 */
export function decodeSurfaceGrid(surface) {
    if (!surface || typeof surface !== 'object') {
        throw new Error('surface block missing');
    }
    const xl = latticeOf(surface, 'x');
    const yl = latticeOf(surface, 'y');
    const nx = xl.count;
    const ny = yl.count;
    const block = encodedBlock(surface);
    const dtype = block ? (block.dtype || 'f32b64') : 'json';
    let values = block ? decodeBlock(block) : flatten(surface.z);
    if (values.length !== nx * ny) {
        throw new Error(
            `surface z has ${values.length} values for a ${nx} by ${ny} grid`);
    }
    // 'yx' is the contract and the default: row major over (y, x), the same
    // orientation `SurfaceData` documents and matplotlib's pcolormesh uses.
    // 'xy' is transposed here rather than carried as a flag, so exactly one
    // orientation exists below this line.
    if (block && block.order === 'xy') {
        const swapped = new Float64Array(nx * ny);
        for (let i = 0; i < nx; i += 1) {
            for (let j = 0; j < ny; j += 1) swapped[j * nx + i] = values[i * ny + j];
        }
        values = swapped;
    }
    const cellArea = xl.step * yl.step;
    if (!(cellArea > 0)) {
        throw new Error(`surface cell area ${cellArea} is not positive`);
    }
    let totalMass = 0;
    const z = new Float64Array(nx * ny);
    for (let i = 0; i < values.length; i += 1) {
        totalMass += values[i];
        z[i] = values[i] / cellArea;
    }
    return {
        x0: xl.origin, dx: xl.step, nx,
        y0: yl.origin, dy: yl.step, ny,
        // 'left' is the convention the fine lattice is in and the one a
        // corrected emitter declares. **Absent means 'mid'**, which is the
        // library's own rule and not this reader's guess: a document that
        // declares no edge is one from before the field existed, and those
        // documented their coordinates as cell centers. Reading them as left
        // edges would shift every legacy grid half a bucket, which is the same
        // class of error the field was added to end.
        edge: surface.edge === 'left' ? 'left' : 'mid',
        z,
        cellArea,
        totalMass,
        dtype,
        digits: DTYPE_DIGITS[dtype] || 6,
        quantized: dtype === 'u16log12b64',
        bs: surface.bs || null,
        k: surface.k || null,
        quantileWindow: surface.window || null,
        marginals: surface.marginals || null,
        moments: surface.moments || null,
        deficit: Number.isFinite(surface.deficit) ? surface.deficit : null,
    };
}

/**
 * The series carrying a surface, for a panel or for the document.
 *
 * Parameters
 * ----------
 * doc : object
 *     A chart document.
 * panelId : string, optional
 *     Restrict to this panel. Omitted, the first series with a surface wins,
 *     which is the single-panel surface document's case.
 */
export function findSurfaceSeries(doc, panelId) {
    const series = (doc && doc.series) || [];
    return series.find((s) => s && s.surface
        && (panelId === undefined || s.panel_id === panelId)) || null;
}

/** The coordinate the document names for x index `i`, in data units. */
export function coordX(g, i) { return g.x0 + i * g.dx; }

/** The coordinate the document names for y index `j`, in data units. */
export function coordY(g, j) { return g.y0 + j * g.dy; }

/**
 * The center of cell `i` on x.
 *
 * Which is the coordinate itself when the grid names midpoints, and half a
 * step up when it names left edges. Every mean, every conditional mean and
 * every kappa is taken against centers, which is the arithmetic the display
 * grid's labeling bug got wrong by close to a whole bucket.
 */
export function centerX(g, i) { return g.x0 + (g.edge === 'mid' ? i : i + 0.5) * g.dx; }

/** The center of cell `j` on y. See :func:`centerX`. */
export function centerY(g, j) { return g.y0 + (g.edge === 'mid' ? j : j + 0.5) * g.dy; }

/** The x coordinates as a plain array, for a renderer that wants a category axis. */
export function xCoords(g) {
    return Array.from({ length: g.nx }, (_, i) => coordX(g, i));
}

/** The y coordinates as a plain array. See :func:`xCoords`. */
export function yCoords(g) {
    return Array.from({ length: g.ny }, (_, j) => coordY(g, j));
}

/** The density in cell `(i, j)`, x index first. */
export function densityAt(g, i, j) { return g.z[j * g.nx + i]; }

/**
 * The drawn extent of the height.
 *
 * `max` is the plain maximum; `min` is the smallest value strictly above
 * `floor`, which is what a log reading wants: a log axis anchored on the
 * smallest value *present* rather than on arithmetic noise, with an exact zero
 * resting on the floor instead of punching a hole. An FFT-built joint is full
 * of exact zeros, and as holes the mesh arrives moth-eaten.
 */
export function zExtent(g, floor = 0) {
    let max = 0;
    let min = Infinity;
    for (let i = 0; i < g.z.length; i += 1) {
        const v = g.z[i];
        if (v > max) max = v;
        if (v > floor && v < min) min = v;
    }
    return { max, min: Number.isFinite(min) ? min : floor };
}
