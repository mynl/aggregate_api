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

// The SPA freezes one specific csv-grid build at `npm run build`. The
// version isn't a runtime/api concern (the backend has no idea what the
// frontend bundled) and the shipped bundle exports no version constant,
// so capture it here at build time and inline it as a global define.
const csvGridVersion = JSON.parse(
    readFileSync(new URL('./node_modules/csv-grid/package.json', import.meta.url)),
).version;

export default defineConfig({
    base: './',
    define: { __CSV_GRID_VERSION__: JSON.stringify(csvGridVersion) },
    build: {
        outDir: '../src/aggregate_api/static',
        emptyOutDir: true,
        target: 'es2020',
        // Keep the assets/ subdir name stable for the FastAPI mount.
        assetsDir: 'assets',
        sourcemap: false,
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
