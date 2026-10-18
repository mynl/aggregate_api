/* Service worker for the aggregate Loss Lab PWA.
 *
 * Deliberately minimal. A build *requires* the backend (you cannot compute an
 * Aggregate offline), so this is NOT an offline-first app. The worker exists to
 * (a) make the SPA installable, since Chrome only offers "Install" when a
 * service worker with a fetch handler is registered, and (b) speed repeat loads
 * by caching the static shell. It must never cache /v1/* (the dynamic API plus
 * the CSV / density frames) or it would serve stale builds and stale data.
 *
 * Strategy:
 *   - non-GET / cross-origin          -> pass through, never cached
 *   - outside the playground's shell  -> pass through, never cached: /v1/*,
 *     (see isShellPath)                  /excel/, /docs, and every other front
 *                                        end on this origin
 *   - navigations (HTML)              -> network-first, fall back to the cached
 *                                        shell when offline so an installed app
 *                                        still opens
 *   - other same-origin GETs          -> cache-first (Vite content-hashes the
 *     (js / css / icons / fonts)         js/css asset filenames, so a new build
 *                                        produces new URLs, safe to keep)
 *   - activate                        -> delete caches from older CACHE_VERSIONs
 *
 * Bump CACHE_VERSION on any change to the caching behavior to evict old caches,
 * and also when a file served at a stable URL is replaced in place. The icons
 * are the case that arises: they are not content hashed, so a returning visitor
 * keeps serving the previous artwork out of the cache until the version moves.
 */

// v3 when the worker stopped handling paths outside the shell, so a returning
// browser drops whatever v2 cached from /excel/ or another front end.
const CACHE_VERSION = 'agg-pwa-v3';

/**
 * Whether a same-origin path is the playground's own, and so this worker's.
 *
 * The shell is `/` itself, a top-level file (index.html, lite.html, the icons,
 * site.webmanifest), and Vite's content-hashed `/assets/*`. Everything else is
 * left to the network: the API under `/v1/`, the Excel add-in at `/excel/`,
 * and each front end in AGGAPI_APPS at `/<name>/`. Those files are not content
 * hashed (an app's `js/main.js` has that name in every version), so a
 * cache-first worker would pin the first copy it ever saw, and the server's
 * `no-cache` cannot help, because the worker answers before the HTTP cache is
 * consulted. The worker's scope is the whole origin, so the rule has to be
 * written here.
 *
 * A top-level file is a name with an extension, which no app name can have.
 * `/openapi.json` is one too, and is excluded: FastAPI writes it per process,
 * and Swagger at /docs reads it.
 *
 * @param {string} pathname a URL's pathname, leading slash included.
 * @returns {boolean} true when the worker should handle the request.
 */
function isShellPath(pathname) {
    if (pathname === '/' || pathname.startsWith('/assets/')) return true;
    return /^\/[^/]+\.[A-Za-z0-9]+$/.test(pathname) && pathname !== '/openapi.json';
}

self.addEventListener('install', () => {
    // Take over as soon as installed; we don't precache, so nothing to wait on.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        );
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;             // never touch POST builds

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;  // leave cross-origin alone
    if (!isShellPath(url.pathname)) return;           // API, add-in, other apps

    // HTML navigations: network-first so a redeploy is picked up immediately;
    // fall back to the cached page (or app root) when offline.
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                const cache = await caches.open(CACHE_VERSION);
                cache.put(request, fresh.clone());
                return fresh;
            } catch {
                return (await caches.match(request)) || (await caches.match('/'));
            }
        })());
        return;
    }

    // Static assets: cache-first (content-hashed, so safe to keep).
    event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, fresh.clone());
        }
        return fresh;
    })());
});
