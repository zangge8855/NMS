const CACHE_NAME = 'nms-shell-v2';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/nms-logo.png',
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
                    if (key !== CACHE_NAME) {
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
                return caches.match('/') || caches.match(event.request);
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
