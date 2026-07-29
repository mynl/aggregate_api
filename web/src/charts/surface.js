// The bivariate 3-D surface, behind a dynamic import.
//
// echarts-gl is ~800 kB minified, larger than the whole rest of the app, and it
// serves exactly one of six object kinds. So it is not imported at module scope:
// `loadSurface()` pulls it on first use and Vite emits it as its own chunk, which
// a visitor who never builds a bivariate never downloads.
//
// What it draws: the joint density of a `BivariateAggregate` as a height field
// over the two component loss axes. That is the thing a heatmap can only imply.
// A copula's dependence shows up as a *ridge* running off the diagonal, and on a
// flat map that ridge is a smear of slightly darker cells; in relief it is a
// shape you recognize at a glance.
//
// Two z-scalings, because a joint density has enormous dynamic range: the mode
// can be four or five orders of magnitude above the tail, so on a linear height
// axis everything except the peak is floor. The log view is where the tail
// dependence actually lives, which is the whole reason anyone models a copula.

import { echarts, houseStyle, fade, LOG_FLOOR } from './theme.js';
import { fmt } from '../utils/format.js';

// Surface resolution per side. 128 x 128 is 16,384 vertices, which WebGL draws
// without noticing, and is finer than the eye resolves on a 420 px panel. The
// joint grid is block-**summed** down to it rather than sampled, for the same
// reason the heatmap is: dropping cells silently discards mass and lightens the
// tail, which is the one region the picture exists to show.
const CELLS = 128;

let pending = null;

/**
 * Register echarts-gl's surface pieces, once.
 *
 * Returns
 * -------
 * Promise<boolean>
 *     True when the 3-D renderer is available. Resolves **false** rather than
 *     rejecting if the chunk fails to load, so the caller falls back to the
 *     heatmap instead of losing the tab.
 */
export function loadSurface() {
    if (!pending) {
        pending = (async () => {
            const [{ SurfaceChart }, { Grid3DComponent }] = await Promise.all([
                import('echarts-gl/charts'),
                import('echarts-gl/components'),
            ]);
            echarts.use([SurfaceChart, Grid3DComponent]);
            return true;
        })().catch(() => false);
    }
    return pending;
}

/**
 * Reduce a joint-density frame to a surface grid.
 *
 * Parameters
 * ----------
 * frame : {columns, rows}
 *     The raw joint matrix: first column the axis-0 grid, the remaining column
 *     *names* the axis-1 grid.
 * cells : int, optional
 *
 * Returns
 * -------
 * object or null
 *     `{xs, ys, z, max, min}` where `z[i][j]` is the summed mass in block
 *     `(i, j)`, or null when the frame is not a matrix.
 */
export function surfaceGrid(frame, cells = CELLS) {
    const cols = (frame && frame.columns) || [];
    if (cols.length < 2 || !frame.rows || !frame.rows.length) return null;
    const yValues = cols.slice(1).map(Number);
    const xValues = frame.rows.map((r) => Number(r[0]));
    const nx = xValues.length;
    const ny = yValues.length;
    const bx = Math.max(1, Math.ceil(nx / cells));
    const by = Math.max(1, Math.ceil(ny / cells));
    const ox = Math.ceil(nx / bx);
    const oy = Math.ceil(ny / by);

    const acc = Array.from({ length: ox }, () => new Float64Array(oy));
    for (let i = 0; i < nx; i++) {
        const row = frame.rows[i];
        const ii = Math.floor(i / bx);
        const target = acc[ii];
        for (let j = 0; j < ny; j++) {
            const v = Number(row[j + 1]);
            if (Number.isFinite(v)) target[Math.floor(j / by)] += v;
        }
    }
    // Block right edges, matching the server's density-binning convention.
    const xs = Array.from({ length: ox },
        (_, i) => xValues[Math.min((i + 1) * bx - 1, nx - 1)]);
    const ys = Array.from({ length: oy },
        (_, j) => yValues[Math.min((j + 1) * by - 1, ny - 1)]);

    let max = 0;
    let min = Infinity;
    for (let i = 0; i < ox; i++) {
        for (let j = 0; j < oy; j++) {
            const v = acc[i][j];
            if (v > max) max = v;
            if (v > LOG_FLOOR && v < min) min = v;
        }
    }
    if (!(max > 0)) return null;
    return { xs, ys, z: acc, max, min: Number.isFinite(min) ? min : LOG_FLOOR };
}

/**
 * Build the ECharts option for a bivariate surface.
 *
 * Pure, so the node smoke test can assemble and inspect it without WebGL.
 *
 * Parameters
 * ----------
 * grid : object
 *     From :func:`surfaceGrid`.
 * opts : object
 *     `{xName, yName, logZ, side}`.
 *
 * Returns
 * -------
 * object
 *     An ECharts option using `grid3D` and a `surface` series.
 *
 * Notes
 * -----
 * The surface is supplied through `dataShape` + a flat vertex list rather than
 * the parametric form, because the two axes have their **own** grids: a
 * bivariate's components are built independently and routinely land on different
 * bucket sizes, so there is no single step that describes both.
 *
 * On the log view a zero-mass cell has no logarithm, and the choice is a hole in
 * the mesh or a value on the floor. It gets the floor.
 *
 * Holes were the first instinct, on the grounds that zero mass is not a small
 * height, it is no height. But measured on a real joint density **41% of the mesh
 * came back as holes**: an FFT-built bivariate has large regions of exact zero,
 * so the surface arrived moth-eaten, and a shape full of gaps is unreadable
 * whatever it is being honest about. The floor is `10 ** floor(log10(min))`, one
 * decade under the smallest mass actually present, so a zero cell sits exactly on
 * the bottom of the box: the surface touches down where the model puts nothing
 * and rises where it puts something. That reads as the truth and draws as a
 * surface.
 */
export function surfaceOption(grid, { xName, yName, logZ = false, side = 420 } = {}) {
    const s = houseStyle();
    const { xs, ys, z, max, min } = grid;
    const zMin = logZ ? Math.floor(Math.log10(min)) : 0;
    const zMax = logZ ? Math.ceil(Math.log10(max)) : max;
    const data = [];
    for (let i = 0; i < xs.length; i++) {
        for (let j = 0; j < ys.length; j++) {
            const v = z[i][j];
            const height = logZ
                ? (v > LOG_FLOOR ? Math.max(zMin, Math.log10(v)) : zMin)
                : v;
            data.push([xs[i], ys[j], height]);
        }
    }

    return {
        // No `...baseOption()`: that carries a 2-D grid, legend and axisPointer,
        // none of which a grid3D understands.
        color: s.colors,
        textStyle: { fontSize: Math.max(10, s.font_size + 2), color: s.text_color },
        animation: false,
        tooltip: {
            confine: true,
            backgroundColor: 'rgba(255,255,255,.96)',
            borderColor: s.grid_color,
            textStyle: { fontSize: 11, color: s.text_color },
            formatter: (p) => {
                const [x, y, h] = p.value;
                const mass = logZ ? 10 ** h : h;
                // A cell resting on the log floor is one the model puts nothing
                // in; saying "1e-12" there would be reporting the floor as data.
                const height = (logZ && h <= zMin)
                    ? `&lt; ${(10 ** zMin).toExponential(0)}`
                    : Number(mass).toExponential(3);
                return `${xName} ${fmt(x)}<br>${yName} ${fmt(y)}`
                    + `<br>density <b>${height}</b>`;
            },
        },
        visualMap: {
            min: zMin, max: zMax, calculable: true,
            dimension: 2, seriesIndex: 0,
            right: 4, top: 20, itemHeight: Math.max(90, side - 90),
            textStyle: { fontSize: 10, color: '#6c757d' },
            // Sequential, light to the primary: a density is one-directional, so
            // a diverging ramp would imply a midpoint that does not exist.
            inRange: { color: ['#ffffff', fade(s.colors[0], 0.55), s.colors[0]] },
            formatter: (v) => (logZ ? `1e${Math.round(v)}` : Number(v).toExponential(1)),
        },
        xAxis3D: {
            type: 'value', name: xName,
            nameTextStyle: { fontSize: 11, color: '#6c757d' },
            axisLabel: { fontSize: 9, color: '#6c757d', formatter: (v) => fmt(v) },
        },
        yAxis3D: {
            type: 'value', name: yName,
            nameTextStyle: { fontSize: 11, color: '#6c757d' },
            axisLabel: { fontSize: 9, color: '#6c757d', formatter: (v) => fmt(v) },
        },
        zAxis3D: {
            type: 'value', name: logZ ? 'log density' : 'density',
            min: zMin, max: zMax,
            nameTextStyle: { fontSize: 11, color: '#6c757d' },
            axisLabel: {
                fontSize: 9, color: '#6c757d',
                formatter: (v) => (logZ ? `1e${Math.round(v)}` : Number(v).toExponential(0)),
            },
        },
        grid3D: {
            boxWidth: 100, boxDepth: 100, boxHeight: 62,
            // Wall projections: the two vertical walls carry the marginals as
            // shadows of the surface, which is most of why the 3-D view earns
            // its bundle. Reading a marginal off a heatmap is not possible.
            axisPointer: { show: true, lineStyle: { color: s.grid_color } },
            light: {
                main: { intensity: 1.15, shadow: true, alpha: 40, beta: 40 },
                ambient: { intensity: 0.35 },
            },
            viewControl: {
                // Looking down the diagonal: dependence between the two
                // components is a ridge along it, so this is the angle that
                // shows whether there is one.
                alpha: 24, beta: 40, distance: 190,
                autoRotate: false, zoomSensitivity: 1,
            },
            environment: '#ffffff',
        },
        series: [{
            type: 'surface',
            name: 'joint density',
            wireframe: { show: false },
            shading: 'lambert',
            dataShape: [xs.length, ys.length],
            data,
        }],
    };
}
