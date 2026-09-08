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
// The semantics no longer live here. The display grid arrives already reduced
// (mass-preservingly block-summed) inside the library emitter
// (`aggregate.charts.chart_joint_surface`), served as a chart document and
// adapted by `chartdoc-to-echarts.js`; the old `surfaceGrid` reduction and
// `surfaceOption` builder are gone. What this module keeps is the lazy
// renderer chunk and `surfaceOverrides`, the per-chart chrome dict: colors,
// tooltip dressing, lighting, and the camera.

import { echarts, houseStyle, fade } from './theme.js';
import { stretchedRamp } from './color-stretch.js';
import { makeCellReader } from './cell-reading.js';
import { fmt } from '../utils/format.js';

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
            // Three chart types, not one. `Line3DChart` for the mesh over the
            // skin and the curves on the walls, which are real line geometry
            // rather than the surface's built-in wireframe (that one cannot be
            // thinned and cannot carry its own opacity). `Scatter3DChart` for
            // the marks: the mean standing on the curve it is the mean of, and
            // kappa against the even split.
            const [{ Line3DChart, Scatter3DChart, SurfaceChart },
                   { Grid3DComponent }] = await Promise.all([
                import('echarts-gl/charts'),
                import('echarts-gl/components'),
            ]);
            echarts.use([Line3DChart, Scatter3DChart, SurfaceChart, Grid3DComponent]);
            return true;
        })().catch(() => false);
    }
    return pending;
}

/**
 * The surface chart's renderer-specific chrome, merged over the adapter's
 * semantic skeleton by `chartdocToEcharts`.
 *
 * Parameters
 * ----------
 * ctx : object
 *     The adapter context `{xName, yName, zName, logZ, zMin, zMax}` plus
 *     `side`, the square plot side in CSS pixels (drives the colorbar
 *     height), and `stretch`, the color stretch the adapter resolved
 *     (see `color-stretch.js`), which warps the ramp and nothing else.
 *
 * Returns
 * -------
 * object
 *     Chrome only: colors, text sizes, tooltip dressing, the visualMap ramp
 *     and placement, lighting, and the camera. Axis names, ranges, the mesh
 *     and its shape all come from the document.
 */
/**
 * The camera as it stands, so a redraw can put it back.
 *
 * `viewControl` in the option is what the camera is *set* from, and echarts-gl
 * writes the live angles back into that same object as the reader drags. So a
 * rebuild that re-sends the option's original alpha, beta and distance snaps
 * the box back to the default angle, and one that re-sends them sixty times a
 * second, which is what an animation does, fights the reader for the camera and
 * wins. Read it here, send it back in the next option, and adjusting a control
 * changes the picture without moving the point of view.
 *
 * Wrapped, because it reaches through `getModel` into a component's option:
 * a version that stops writing back leaves the camera where it was, which is
 * the same failure as before this existed and not a worse one.
 *
 * Parameters
 * ----------
 * chart : object
 *     A live ECharts instance, or null.
 *
 * Returns
 * -------
 * object or null
 *     `{alpha, beta, distance, center, projection}`, or null when there is
 *     nothing to read.
 *
 * Notes
 * -----
 * `center` and `projection` joined at a88, for the puck. The camera can now be
 * panned off the middle of the box and swapped to an orthographic reading, and
 * a redraw that carried only the two angles and the distance would put a
 * panned camera back in the center at the first toggle: the same failure the
 * angles had before this function existed.
 */
export function readCamera(chart) {
    try {
        const vc = chart.getModel().getComponent('grid3D').option.viewControl;
        if (!vc || !Number.isFinite(vc.alpha)) return null;
        // Only the keys that are actually there. The result is spread over the
        // preset's `viewControl`, and a key present with an undefined value is
        // not the same as an absent one: it overwrites the default rather than
        // letting it stand.
        const camera = { alpha: vc.alpha, beta: vc.beta };
        if (Number.isFinite(vc.distance)) camera.distance = vc.distance;
        if (Array.isArray(vc.center)) camera.center = vc.center.slice(0, 3);
        if (vc.projection) camera.projection = vc.projection;
        return camera;
    } catch {
        return null;
    }
}

/**
 * Axis tick text.
 *
 * The default prints an axis endpoint at full float precision, which on a
 * density puts "0.00000033263996616838" beside the box, and rounding it to one
 * figure prints "2e-6" three times down the axis. Four significant figures,
 * exponential only where a decimal would be unreadable. The prototype's `tick`.
 */
function tick(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
    return String(+v.toPrecision(4));
}

export function surfaceOverrides({ xName, yName, logZ, zMin, digits = 7,
                                   quantized = false, side = 420,
                                   hostHeight = 480, camera = null,
                                   lights = true, stretch = null } = {}) {
    const s = houseStyle();
    // `digits` and `quantized` are passed straight through to the cell reader,
    // which is where the precision argument now lives: read the height to the
    // precision the wire carried and no further. Both come off the document's
    // declared dtype rather than from a constant, which is what keeps the
    // reading in step with the encoding.
    return {
        // No `...baseOption()`: that carries a 2-D grid, legend and axisPointer,
        // none of which a grid3D understands.
        color: s.colors,
        textStyle: { fontSize: Math.max(10, s.font_size + 2), color: s.text_color },
        animation: false,
        // One clicked cell, as rows the fixed strip draws. A function on the
        // option rather than a string, so the strip can draw chips the way it
        // draws its other two lines; `meshSource` and `readings` ride the same
        // way. The reading itself is a leaf module, so it can be tested outside
        // a browser: see `cell-reading.js` for what it decides and why.
        cellReader: makeCellReader({ xName, yName, logZ, zMin, digits, quantized }),
        // No tooltip. Retired at a131 with the `tips` control that offered it:
        // on a 3-D scene a tooltip follows the cursor over the thing it is
        // describing and hides it, and with the reading in a fixed place above
        // the chart there is no second question for a button to ask.
        tooltip: { show: false },
        // Two maps: the surface's, which draws the colorbar, and the floor
        // image's, which reads the same scale through the fourth column and
        // shows no bar of its own. Merged element-wise onto the pair the
        // adapter builds, so the order here is the order there. Both take the
        // stretched ramp, so the drape and the floor stay two drawings of one
        // grid; the value range and the bar's labels never move, only where
        // the colors sit along it.
        visualMap: [
            {
                calculable: true,
                // Half the box, not nearly all of it. A colorbar as tall as the
                // picture reads as the second half of a two-panel chart.
                right: 4, top: 20, itemHeight: Math.max(80, Math.round(hostHeight * 0.5)),
                textStyle: { fontSize: 10, color: '#6c757d' },
                inRange: { color: stretchedRamp(stretch) },
                formatter: (v) => (logZ ? `1e${Math.round(v)}` : tick(v)),
            },
            {
                show: false,
                inRange: { color: stretchedRamp(stretch) },
            },
        ],
        xAxis3D: {
            nameTextStyle: { fontSize: 11, color: '#6c757d' },
            axisLabel: { fontSize: 9, color: '#6c757d', formatter: (v) => fmt(v) },
        },
        yAxis3D: {
            nameTextStyle: { fontSize: 11, color: '#6c757d' },
            axisLabel: { fontSize: 9, color: '#6c757d', formatter: (v) => fmt(v) },
        },
        zAxis3D: {
            nameTextStyle: { fontSize: 11, color: '#6c757d' },
            axisLabel: {
                fontSize: 9, color: '#6c757d',
                // `tick`, not one significant figure: a density axis stepping
                // 1.5e-6, 2.0e-6, 2.5e-6 printed at one figure reads "2e-6"
                // three times, which says the axis is not moving.
                formatter: (v) => (logZ ? `1e${Math.round(v)}` : tick(v)),
            },
        },
        grid3D: {
            boxWidth: 100, boxDepth: 100, boxHeight: 62,
            // No axis pointer. On a grid3D it draws three planes through the
            // picked point, and since a click is how a cut is placed, every
            // placement flashed a set of cutting planes that are not the cut.
            axisPointer: { show: false },
            light: {
                // **No cast shadow.** It is a dark shape thrown across the floor
                // picture by the thing you are trying to read, and on a density,
                // which covers its whole domain, it lands on the tail every
                // time. The key light and the ambient fill carry the shading
                // without it.
                //
                // `lights` on lifts the fill and drops the key, so no face of
                // the surface is dark. That is not only taste: the color *is*
                // the height here, and a key light strong enough to shade one
                // side into darkness is a second, silent encoding fighting the
                // first. Some shading is still wanted, or the relief flattens
                // into its own floor image, so the key stays at 0.45 rather
                // than going out.
                main: {
                    intensity: lights ? 0.45 : 1.15,
                    shadow: false, alpha: 40, beta: 40,
                },
                ambient: { intensity: lights ? 0.85 : 0.35 },
            },
            viewControl: {
                // Looking down the diagonal: dependence between the two
                // components is a ridge along it, so this is the angle that
                // shows whether there is one. Overridden by the camera the
                // reader is holding, when there is one.
                alpha: 24, beta: 40, distance: 190,
                // Damping is what makes a drag feel like it has weight rather
                // than snapping to the cursor and stopping dead.
                damping: 0.85,
                autoRotate: false, zoomSensitivity: 1,
                ...(camera || {}),
            },
            environment: '#ffffff',
        },
        // Index 0 only, the skin. Everything else the adapter draws over the
        // surface (the mesh, the floor image, the wall curves, the contours) is
        // optional, so the list length depends on which controls are on and a
        // positional merge onto it would style the wrong series the moment a
        // reader turned one off. Those carry their own style, from the same
        // preset, next to where they are built.
        //
        // The skin's own `wireframe` stays off: the mesh is real `line3D`
        // geometry, which can be thinned and can carry an opacity of its own.
        series: [{ wireframe: { show: false }, shading: 'lambert' }],
    };
}
