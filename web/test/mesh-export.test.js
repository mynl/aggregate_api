// The mesh writers, under `node --test`.
//
// What a viewer will not forgive, checked here rather than in a viewer: the
// triangle count a grid implies, face indices that are one based and in range,
// the STL's fixed record size, and normals that point up. The last one is the
// difference between a surface and the same surface rendered inside out, and
// it is invisible in every viewer that lights both faces.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    fileStem, meshToGlb, meshToObj, meshToStl, rampColor, surfaceMesh,
} from '../src/charts/mesh-export.js';

/** A grid of drawn heights, `fill(i, j)` per point. */
function field(nx, ny, fill) {
    const z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) z[j * nx + i] = fill(i, j);
    }
    // Two very different steps, as everywhere else in these suites: the two
    // components routinely land on different bucket sizes.
    return { nx, ny, x0: 0, dx: 2, y0: 1000, dy: 500, z };
}

/** The triangles of a binary STL, as `[normal, a, b, c]` per face. */
function readStl(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint32(80, true);
    const out = [];
    for (let t = 0; t < n; t += 1) {
        let at = 84 + t * 50;
        const read = () => {
            const v = [view.getFloat32(at, true), view.getFloat32(at + 4, true),
                       view.getFloat32(at + 8, true)];
            at += 12;
            return v;
        };
        out.push([read(), read(), read(), read()]);
    }
    return out;
}

test('a 3 by 3 grid is nine vertices and eight triangles', () => {
    const mesh = surfaceMesh(field(3, 3, (i, j) => i + j));
    assert.equal(mesh.counts.vertices, 9);
    assert.equal(mesh.counts.triangles, 8);
    assert.equal(mesh.dropped, 0);
    assert.equal(mesh.vertices.length, 27);
    assert.equal(mesh.triangles.length, 24);
});

test('the mesh fills the box the reader sees', () => {
    const box = { width: 100, depth: 100, height: 62 };
    const mesh = surfaceMesh(field(3, 3, (i, j) => i + j), { box });
    const xs = [];
    const ys = [];
    const zs = [];
    for (let i = 0; i < mesh.vertices.length; i += 3) {
        xs.push(mesh.vertices[i]);
        ys.push(mesh.vertices[i + 1]);
        zs.push(mesh.vertices[i + 2]);
    }
    // Centered in x and y, standing on the ground plane in z, whatever the
    // data units were: the export is the picture, not the numbers.
    assert.equal(Math.min(...xs), -50);
    assert.equal(Math.max(...xs), 50);
    assert.equal(Math.min(...ys), -50);
    assert.equal(Math.max(...ys), 50);
    assert.equal(Math.min(...zs), 0);
    assert.equal(Math.max(...zs), 62);
    // A stated range is honored, which is how the base drop and the snapped
    // z axis survive into the file: the surface then fills part of the box.
    const held = surfaceMesh(field(3, 3, (i, j) => i + j), { box, zRange: [0, 8] });
    assert.equal(held.vertices[2], 0);
    assert.equal(Math.round(Math.max(...Array.from(held.vertices).filter((_, k) => k % 3 === 2))),
                 31);
});

test('the STL is 84 plus 50 bytes a triangle, and its normals point up', () => {
    const mesh = surfaceMesh(field(4, 3, () => 1));
    const stl = meshToStl(mesh, 'flat');
    assert.equal(stl.byteLength, 84 + 50 * mesh.counts.triangles);
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    assert.equal(view.getUint32(80, true), mesh.counts.triangles);
    // The header says what the file is and does not start with 'solid', which
    // is what an ASCII STL starts with and what a reader looks for.
    const header = new TextDecoder().decode(stl.slice(0, 80)).replace(/\0+$/, '');
    assert.ok(header.startsWith('aggregate Loss Lab surface: flat'));
    for (const [normal] of readStl(stl)) {
        assert.ok(Math.abs(normal[2] - 1) < 1e-6,
                  `normal ${normal} on a flat grid should be straight up`);
    }
});

test('a negative step keeps the normals up', () => {
    // One axis walking backward flips the cross product, and a surface with
    // its normals down renders inside out in every viewer that lights one face.
    const back = field(4, 3, () => 1);
    back.dy = -500;
    for (const [normal] of readStl(meshToStl(surfaceMesh(back)))) {
        assert.ok(Math.abs(normal[2] - 1) < 1e-6, `normal ${normal} should be up`);
    }
});

test('the OBJ faces are one based and in range', () => {
    const mesh = surfaceMesh(field(5, 4, (i, j) => i * j));
    const obj = meshToObj(mesh, 'ramp');
    const lines = obj.split('\n');
    assert.ok(lines.some((l) => l === 'o ramp'));
    const vs = lines.filter((l) => l.startsWith('v '));
    const fs = lines.filter((l) => l.startsWith('f '));
    assert.equal(vs.length, mesh.counts.vertices);
    assert.equal(fs.length, mesh.counts.triangles);
    let lowest = Infinity;
    let highest = 0;
    for (const face of fs) {
        for (const token of face.slice(2).split(' ')) {
            const idx = Number(token);
            assert.ok(Number.isInteger(idx), `face index ${token} is not an integer`);
            lowest = Math.min(lowest, idx);
            highest = Math.max(highest, idx);
        }
    }
    assert.equal(lowest, 1);
    assert.equal(highest, mesh.counts.vertices);
    assert.ok(!obj.includes('NaN'));
});

test('a masked corner drops exactly two triangles and its vertex', () => {
    const holed = field(3, 3, (i, j) => i + j);
    // The corner of the grid touches one cell, so it takes two triangles with
    // it. A hole in the middle would take eight, which is a different check.
    holed.z[0] = NaN;
    const mesh = surfaceMesh(holed);
    assert.equal(mesh.counts.triangles, 6);
    assert.equal(mesh.dropped, 1);
    // The masked point is never referenced, so it is never written, which is
    // what keeps a NaN out of the file rather than out of the faces only.
    assert.equal(mesh.counts.vertices, 8);
    assert.ok(!Array.from(mesh.vertices).some(Number.isNaN));
});

test('a lattice too small to triangulate is refused, loudly', () => {
    assert.throws(() => surfaceMesh(field(1, 4, () => 1)), /at least two points/);
    const short = field(3, 3, () => 1);
    short.z = new Float64Array(4);
    assert.throws(() => surfaceMesh(short), /4 heights for a 3 by 3 grid/);
});

test('the ramp is read at both ends and interpolated between', () => {
    const ramp = ['#000000', '#808080', '#ffffff'];
    // Linear, not sRGB: glTF says vertex colors are linear, so black and white
    // are still 0 and 1 but the mid stop is well under a half.
    assert.deepEqual(rampColor(ramp, 0), [0, 0, 0]);
    assert.deepEqual(rampColor(ramp, 1), [1, 1, 1]);
    const mid = rampColor(ramp, 0.5);
    assert.ok(mid[0] > 0.2 && mid[0] < 0.25, `mid grey linearized to ${mid[0]}`);
    // Outside the range takes the nearest stop rather than wrapping.
    assert.deepEqual(rampColor(ramp, -3), [0, 0, 0]);
    assert.deepEqual(rampColor(ramp, 9), [1, 1, 1]);
});

test('the GLB is a valid container, and its colors read the height', () => {
    const mesh = surfaceMesh(field(3, 3, (i, j) => i + j));
    const ramp = ['#000000', '#ffffff'];
    const glb = meshToGlb(mesh, 'ramp', { ramp, colorRange: [0, 4] });
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    assert.equal(view.getUint32(0, true), 0x46546c67);      // 'glTF'
    assert.equal(view.getUint32(4, true), 2);
    assert.equal(view.getUint32(8, true), glb.byteLength);
    assert.equal(glb.byteLength % 4, 0);
    const jsonLength = view.getUint32(12, true);
    assert.equal(view.getUint32(16, true), 0x4e4f534a);     // 'JSON'
    assert.equal(jsonLength % 4, 0);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)));
    assert.equal(json.asset.version, '2.0');
    assert.equal(json.accessors[0].count, mesh.counts.vertices);
    assert.equal(json.accessors[1].count, mesh.counts.vertices);
    assert.equal(json.accessors[2].count, mesh.counts.triangles * 3);
    // POSITION must carry its bounds; an accessor without them is a file some
    // viewers refuse outright.
    assert.deepEqual(json.accessors[0].min, [-50, -50, 0]);
    assert.deepEqual(json.accessors[0].max, [50, 50, 62]);
    // An open shell is looked at from underneath, so both faces are drawn.
    assert.equal(json.materials[0].doubleSided, true);

    const binOffset = 20 + jsonLength;
    assert.equal(view.getUint32(binOffset + 4, true), 0x004e4942);   // 'BIN\0'
    const binLength = view.getUint32(binOffset, true);
    assert.equal(binLength, json.buffers[0].byteLength);
    const bin = glb.slice(binOffset + 8, binOffset + 8 + binLength);
    const bytes = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const colorsAt = json.bufferViews[1].byteOffset;
    // The lowest cell is 0 and the highest is 4, which is the stated color
    // range, so the ramp is spanned end to end by the corners of the grid.
    const colorOf = (v) => [0, 1, 2].map((k) => bytes.getFloat32(colorsAt + v * 12 + k * 4, true));
    const first = colorOf(0);
    const last = colorOf(mesh.counts.vertices - 1);
    assert.deepEqual(first, [0, 0, 0]);
    assert.deepEqual(last, [1, 1, 1]);
});

test('a file stem survives a title with punctuation in it', () => {
    assert.equal(fileStem('Joint density: Wind vs Flood'), 'joint-density-wind-vs-flood');
    assert.equal(fileStem('   '), 'surface');
    assert.equal(fileStem(null), 'surface');
});
