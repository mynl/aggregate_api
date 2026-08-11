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
 * The surface chart's renderer-specific chrome, merged over the adapter's
 * semantic skeleton by `chartdocToEcharts`.
 *
 * Parameters
 * ----------
 * ctx : object
 *     The adapter context `{xName, yName, zName, logZ, zMin, zMax}` plus
 *     `side`, the square plot side in CSS pixels (drives the colorbar
 *     height).
 *
 * Returns
 * -------
 * object
 *     Chrome only: colors, text sizes, tooltip dressing, the visualMap ramp
 *     and placement, lighting, and the camera. Axis names, ranges, the mesh
 *     and its shape all come from the document.
 */
export function surfaceOverrides({ xName, yName, logZ, zMin, digits = 7,
                                   quantized = false, side = 420 } = {}) {
    const s = houseStyle();
    // Read the height to the precision the wire carried and no further. The
    // log-quantized encoding recovers a density to about four significant
    // figures, so printing five would be inventing a digit; float32 is exact
    // to seven. `digits` comes off the document's declared dtype rather than
    // from a constant here, which is what keeps the two in step when the
    // default encoding changes.
    const readHeight = (v) => Number(v).toExponential(Math.max(0, digits - 1));
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
                const density = logZ ? 10 ** h : h;
                // A cell resting on the log floor is one the model puts nothing
                // in; saying "1e-12" there would be reporting the floor as data.
                const height = (logZ && h <= zMin)
                    ? `&lt; ${(10 ** zMin).toExponential(0)}`
                    : readHeight(density);
                return `${xName} ${fmt(x)}<br>${yName} ${fmt(y)}`
                    + `<br>density <b>${height}</b>`
                    + (quantized ? '<br><i>height is quantized</i>' : '');
            },
        },
        visualMap: {
            calculable: true,
            right: 4, top: 20, itemHeight: Math.max(90, side - 90),
            textStyle: { fontSize: 10, color: '#6c757d' },
            // Sequential, light to the primary: a density is one-directional, so
            // a diverging ramp would imply a midpoint that does not exist.
            inRange: { color: ['#ffffff', fade(s.colors[0], 0.55), s.colors[0]] },
            formatter: (v) => (logZ ? `1e${Math.round(v)}` : Number(v).toExponential(1)),
        },
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
            wireframe: { show: false },
            shading: 'lambert',
        }],
    };
}
