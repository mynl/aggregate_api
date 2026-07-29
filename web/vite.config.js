// Vite build config for the aggregate web SPA.
//
// Build output lands at ../src/aggregate_api/static/ -- the directory
// the FastAPI `StaticFiles` mount in src/aggregate_api/app.py serves
// at '/' when present. That gives the same-origin deploy mode out of
// the box: a single `aggregate-api` process serves both the SPA and
// the /v1 endpoints.
//
// `base: './'` keeps asset URLs relative so the bundle works whether
// it's mounted at '/' (same-origin) or at a sub-path (e.g. a reverse
// proxy installing it under /aggregate/).
//
// The dev server proxies /v1/* to a local backend on :8000 -- the
// SPA itself talks to /v1 via fetch() without any base URL juggling,
// matching the production behavior.

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The SPA freezes specific library builds at `npm run build`. These versions
// aren't a runtime/api concern (the backend has no idea what the frontend
// bundled) and the shipped bundles export no version constant, so capture each
// from its package.json here at build time and inline it as a global define.
// Surfaced in the About panel alongside the api/aggregate versions from /v1/meta.
const pkgVersion = (name) => JSON.parse(
    readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url)),
).version;

export default defineConfig({
    base: './',
    define: {
        __CSV_GRID_VERSION__: JSON.stringify(pkgVersion('csv-grid')),
        __ECHARTS_VERSION__: JSON.stringify(pkgVersion('echarts')),
        __BOOTSTRAP_VERSION__: JSON.stringify(pkgVersion('bootstrap')),
    },
    build: {
        outDir: '../src/aggregate_api/static',
        emptyOutDir: true,
        target: 'es2020',
        // Keep the assets/ subdir name stable for the FastAPI mount.
        assetsDir: 'assets',
        sourcemap: false,
        rollupOptions: {
            output: {
                // Split the three big vendors into their own chunks. They change
                // only when their version does, while the app chunk changes every
                // release, so this keeps a redeploy from invalidating ~300 kB of
                // cached library code in every returning browser. It also lets
                // the browser fetch them in parallel rather than as one blob.
                manualChunks: {
                    echarts: ['echarts/core', 'echarts/charts', 'echarts/components',
                              'echarts/renderers'],
                    codemirror: ['@codemirror/view', '@codemirror/state',
                                 '@codemirror/language', '@codemirror/commands',
                                 '@codemirror/autocomplete', '@codemirror/search',
                                 '@codemirror/lint'],
                    bootstrap: ['bootstrap'],
                },
            },
        },
        // The vendor split leaves every chunk near or under this; the warning
        // exists to catch a regression, so it stays at the default.
        chunkSizeWarningLimit: 600,
    },
    server: {
        port: 5173,
        proxy: {
            '/v1': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: false,
            },
        },
    },
});
