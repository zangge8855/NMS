const CACHE_NAME = 'nms-shell-v3';
// The app can be served below a custom access path, so every cached URL is
// resolved against this worker's registration scope instead of the origin root.
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const SHELL_URL = SCOPE_PATH;
const STATIC_ASSETS = [
    SHELL_URL,
    `${SCOPE_PATH}manifest.json`,
    `${SCOPE_PATH}nms-logo.png`,
];

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
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME && key.startsWith('nms-shell-')) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests, API requests, and WebSockets
    if (event.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
        return;
    }

    // Network first with cache fallback for HTML navigations
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(SHELL_URL).then((cached) => cached || caches.match(event.request));
            })
        );
        return;
    }

    // Cache first, fallback to network for static assets (fonts, images, js, css)
    if (
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.woff2') ||
        url.pathname.endsWith('.png') ||
        url.pathname.endsWith('.svg')
    ) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    if (response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Default network fetch
    event.respondWith(fetch(event.request));
});
