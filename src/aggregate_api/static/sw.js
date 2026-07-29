/* Service worker for the aggregate Loss Library PWA.
 *
 * Deliberately minimal. A build *requires* the backend (you cannot compute an
 * Aggregate offline), so this is NOT an offline-first app. The worker exists to
 * (a) make the SPA installable, since Chrome only offers "Install" when a
 * service worker with a fetch handler is registered, and (b) speed repeat loads
 * by caching the static shell. It must never cache /v1/* (the dynamic API plus
 * the CSV / density frames) or it would serve stale builds and stale data.
 *
 * Strategy:
 *   - non-GET / cross-origin / /v1/*  -> pass through, never cached
 *   - navigations (HTML)              -> network-first, fall back to the cached
 *                                        shell when offline so an installed app
 *                                        still opens
 *   - other same-origin GETs          -> cache-first (Vite content-hashes the
 *     (js / css / icons / fonts)         js/css asset filenames, so a new build
 *                                        produces new URLs, safe to keep)
 *   - activate                        -> delete caches from older CACHE_VERSIONs
 *
 * Bump CACHE_VERSION on any change to the caching behavior to evict old caches.
 */

const CACHE_VERSION = 'agg-pwa-v1';

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
    if (url.pathname.startsWith('/v1/')) return;      // dynamic API: network-only

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
