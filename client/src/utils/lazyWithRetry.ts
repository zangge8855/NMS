import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * lazyWithRetry — React.lazy wrapper with automatic chunk load failure retry.
 *
 * When a new frontend build is deployed, old chunk files (e.g. Subscriptions-BQGAbP6G.js)
 * may no longer exist on the server. When a client with a stale index.html tries to load
 * a route dynamically, the browser throws "Failed to fetch dynamically imported module".
 *
 * This wrapper intercepts such errors, sets a one-time reload guard in sessionStorage,
 * and reloads the page to fetch the latest index.html and chunk hashes.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
    chunkName?: string
): LazyExoticComponent<T> {
    return lazy(async () => {
        const reloadKey = `nms_chunk_reload_${chunkName || 'module'}`;
        const hasReloaded = sessionStorage.getItem(reloadKey);

        try {
            const module = await factory();
            sessionStorage.removeItem(reloadKey);
            return module;
        } catch (error: any) {
            const message = String(error?.message || '');
            const isChunkLoadError = (
                message.includes('Failed to fetch dynamically imported module')
                || message.includes('Loading chunk')
                || message.includes('dynamically imported module')
                || error?.name === 'ChunkLoadError'
            );

            if (isChunkLoadError && !hasReloaded) {
                sessionStorage.setItem(reloadKey, 'true');
                window.location.reload();
                // Return a non-resolving promise to hold rendering until the page reloads
                return new Promise(() => {});
            }

            throw error;
        }
    });
}
