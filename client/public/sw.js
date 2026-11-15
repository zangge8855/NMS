const CACHE_PREFIX = 'nms-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v4`;
// Hashed build assets accumulate across deployments; keep only the newest ones.
const MAX_RUNTIME_ENTRIES = 80;
// The app can be served below a custom access path, so every cached URL is
// resolved against this worker's registration scope instead of the origin root.
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const SHELL_URL = SCOPE_PATH;
const STATIC_ASSETS = [
    SHELL_URL,
    `${SCOPE_PATH}manifest.json`,
    `${SCOPE_PATH}nms-logo.png`,
    `${SCOPE_PATH}theme-init.js`,
];
const PROTECTED_URLS = new Set(STATIC_ASSETS.map((item) => new URL(item, self.location.origin).href));
const STATIC_FILE_PATTERN = /\.(?:js|css|woff2?|png|svg|ico|webp|json)$/i;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(() => {});
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME && key.startsWith(CACHE_PREFIX))
                    .map((key) => caches.delete(key))
            ))
            .then(() => caches.open(CACHE_NAME))
            .then((cache) => trimCache(cache))
            .then(() => self.clients.claim())
    );
});

// Cache keys come back in insertion order, so the first removable entries are the oldest.
async function trimCache(cache) {
    const keys = await cache.keys();
    const removable = keys.filter((request) => !PROTECTED_URLS.has(request.url));
    const excess = removable.length - MAX_RUNTIME_ENTRIES;
    for (let index = 0; index < excess; index += 1) {
        await cache.delete(removable[index]);
    }
}

function storeResponse(request, response) {
    if (!response || response.status !== 200 || response.type !== 'basic') return;
    const clone = response.clone();
    caches.open(CACHE_NAME)
        .then((cache) => cache.put(request, clone).then(() => trimCache(cache)))
        .catch(() => {});
}

function isBypassedPath(pathname) {
    return pathname.startsWith('/api')
        || pathname.startsWith('/ws')
        || pathname.startsWith(`${SCOPE_PATH}api/`)
        || pathname.startsWith(`${SCOPE_PATH}ws/`);
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Leave non-GET, cross-origin, API and WebSocket traffic to the browser.
    if (request.method !== 'GET' || url.origin !== self.location.origin || isBypassedPath(url.pathname)) {
        return;
    }

    // Network first with cache fallback for HTML navigations.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => {
                return caches.match(SHELL_URL).then((cached) => cached || caches.match(request));
            })
        );
        return;
    }

    // Content-hashed build output never changes: cache first.
    if (url.pathname.startsWith(`${SCOPE_PATH}assets/`)) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) return cached;
                return fetch(request).then((response) => {
                    storeResponse(request, response);
                    return response;
                });
            })
        );
        return;
    }

    // Un-hashed static files (theme-init.js, logo, manifest) can change between
    // releases: network first, cached copy only when offline.
    if (STATIC_FILE_PATTERN.test(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    storeResponse(request, response);
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || Response.error()))
        );
    }
});
