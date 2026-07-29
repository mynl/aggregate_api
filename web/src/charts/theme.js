// The house ECharts theme, and the tree-shaken ECharts build the app uses.
//
// Two jobs:
//
// 1. Register exactly the ECharts pieces the exhibits need. `echarts/core` plus
//    explicit `use()` calls keeps the full ~1 MB library out of the bundle; the
//    3-D surface for bivariates arrives in its own dynamic import later, so
//    nothing here pulls in WebGL.
// 2. Serve one look, taken from the backend rather than hardcoded. The colors
//    are `aggregate.style`'s own matplotlib cycle, fetched once from
//    /v1/meta/style, so an interactive exhibit and the server-rendered plot on
//    the Plot tab cannot drift apart. A fetch failure falls back to the same
//    values the style ships today, so the page still draws.

import * as echarts from 'echarts/core';
import { LineChart, HeatmapChart } from 'echarts/charts';
import {
    GridComponent, TooltipComponent, LegendComponent, DataZoomInsideComponent,
    MarkLineComponent, MarkPointComponent, TitleComponent, VisualMapContinuousComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { api } from '../api.js';

// Exactly what the exhibits use, and no more. Two of these are the *narrow*
// variants on purpose: `DataZoomInsideComponent` without the slider (the
// exhibits zoom by wheel and drag, never by a rail) and
// `VisualMapContinuousComponent` without the piecewise legend. Importing the
// umbrella `DataZoomComponent` / `VisualMapComponent` pulls both halves of each.
echarts.use([
    LineChart, HeatmapChart,
    GridComponent, TooltipComponent, LegendComponent, DataZoomInsideComponent,
    MarkLineComponent, MarkPointComponent, TitleComponent,
    VisualMapContinuousComponent,
    CanvasRenderer,
]);

export { echarts };

// Mirrors routes/meta.py's _STYLE_FALLBACK. Used until the fetch resolves and
// forever if it fails, so the first paint is never unstyled.
const FALLBACK = {
    colors: ['#0d6efd', '#dc3545', '#198754', '#eaab00',
             '#6f42c1', '#0aa2c0', '#d63384', '#6c757d'],
    grid_color: '#dee2e6',
    text_color: '#212529',
    line_width: 1.4,
    font_size: 8.5,
};

let style = FALLBACK;
let pending = null;

/**
 * Resolve the house style, fetching it once per page load.
 *
 * Returns
 * -------
 * Promise<object>
 *     `{colors, grid_color, text_color, line_width, font_size}`. Resolves to
 *     the fallback rather than rejecting, because a chart with the wrong grey
 *     is better than no chart.
 */
export function loadStyle() {
    if (!pending) {
        pending = api.style()
            .then((s) => { style = { ...FALLBACK, ...s }; return style; })
            .catch(() => FALLBACK);
    }
    return pending;
}

/** The style as currently known. Synchronous, for use inside an option builder. */
export function houseStyle() { return style; }

/** The nth series color, cycling. */
export function seriesColor(i) {
    const c = style.colors;
    return c[((i % c.length) + c.length) % c.length];
}

/** `color` at `alpha`, for a density fill under its own line. */
export function fade(color, alpha) {
    const hex = String(color).replace('#', '');
    if (hex.length !== 6) return color;
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Option fragments shared by every exhibit: axis styling, the tooltip, and the
 * font. Spread into a chart option rather than registered as an ECharts theme,
 * because the style is not known until a fetch resolves and a registered theme
 * is baked in at `init` time.
 */
export function baseOption() {
    const s = style;
    return {
        color: s.colors,
        textStyle: { fontSize: Math.max(10, s.font_size + 2), color: s.text_color },
        animation: false,          // a rebuild redraws; a 1 s ease reads as lag
        tooltip: {
            trigger: 'axis',
            confine: true,
            axisPointer: { type: 'line', lineStyle: { color: s.grid_color, width: 1 } },
            backgroundColor: 'rgba(255,255,255,.96)',
            borderColor: s.grid_color,
            textStyle: { fontSize: 11, color: s.text_color },
        },
        legend: {
            type: 'scroll', bottom: 0, itemWidth: 18, itemHeight: 2,
            textStyle: { fontSize: 11, color: s.text_color },
        },
    };
}

/** Axis defaults: light grid, muted labels, no heavy axis line. */
export function axisStyle(extra = {}) {
    const s = style;
    return {
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { fontSize: 11, color: '#6c757d' },
        axisLine: { lineStyle: { color: s.grid_color } },
        axisTick: { show: false },
        axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true },
        splitLine: { lineStyle: { color: s.grid_color, type: 'dashed' } },
        ...extra,
    };
}

/** The standard series line width, from the style. */
export function lineWidth() { return style.line_width; }
