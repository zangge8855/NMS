import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_KEY_PREFIX = 'nms_chunk_reload_';
const CACHE_CLEANUP_TIMEOUT_MS = 1500;
const IN_PLACE_RETRY_DELAY_MS = 350;

export function isChunkLoadError(error: unknown): boolean {
    const err = error as { message?: unknown; name?: unknown } | null | undefined;
    const message = String(err?.message || '');
    return (
        message.includes('Failed to fetch dynamically imported module')
        || message.includes('Importing a module script failed')
        || message.includes('Loading chunk')
        || message.includes('Loading CSS chunk')
        || message.includes('dynamically imported module')
        || message.includes('Unable to preload CSS')
        || err?.name === 'ChunkLoadError'
    );
}

/**
 * Purges NMS Service Worker shell caches and unregisters NMS Service Workers
 * so a stale or poisoned cache entry can never survive a recovery reload.
 */
export async function clearAppCachesAndUnregisterSw(): Promise<void> {
    if (typeof window === 'undefined') return;
    const tasks: Array<Promise<unknown>> = [];

    if ('caches' in window && typeof window.caches?.keys === 'function') {
        tasks.push(
            window.caches.keys()
                .then((keys) => Promise.all(
                    keys
                        .filter((key) => key.startsWith('nms-shell-'))
                        .map((key) => window.caches.delete(key))
                ))
                .catch(() => {})
        );
    }

    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (sw) {
        try {
            sw.controller?.postMessage?.({ type: 'NMS_CLEAR_CACHE' });
        } catch {
            // ignore postMessage errors
        }
        if (typeof sw.getRegistrations === 'function') {
            tasks.push(
                sw.getRegistrations()
                    .then((registrations) => Promise.all(
                        registrations.map((reg) => {
                            const scriptUrl = String(
                                reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || ''
                            );
                            if (!scriptUrl || scriptUrl.endsWith('/sw.js')) {
                                return reg.unregister().catch(() => false);
                            }
                            return false;
                        })
                    ))
                    .catch(() => {})
            );
        }
    }

    if (tasks.length === 0) return;

    await Promise.race([
        Promise.allSettled(tasks),
        new Promise((resolve) => setTimeout(resolve, CACHE_CLEANUP_TIMEOUT_MS)),
    ]);
}

function resetChunkReloadGuards(): void {
    try {
        const keysToRemove: string[] = [];
        for (let index = 0; index < sessionStorage.length; index += 1) {
            const key = sessionStorage.key(index);
            if (
                key
                && (
                    key.startsWith(CHUNK_RELOAD_KEY_PREFIX)
                    || key === 'nms_auto_reload_chunk_error'
                    || key === 'nms_vite_preload_reload_attempt'
                )
            ) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    } catch {
        // ignore storage errors
    }
}

export async function reloadAfterChunkError(options: { resetRetryGuards?: boolean } = {}): Promise<void> {
    if (options.resetRetryGuards) {
        resetChunkReloadGuards();
    }
    await clearAppCachesAndUnregisterSw();
    window.location.reload();
}

/**
 * lazyWithRetry — React.lazy wrapper with automatic chunk load failure retry.
 *
 * When a new frontend build is deployed or a reverse proxy briefly drops a
 * burst request, dynamic imports may throw "Failed to fetch dynamically
 * imported module". This wrapper first retries once in place after a short
 * delay, and if that still fails, clears stale Service Worker caches and
 * performs a one-time guarded page reload.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
    chunkName?: string,
    options: { retryDelayMs?: number } = {}
): LazyExoticComponent<T> {
    return lazy(async () => {
        const reloadKey = `${CHUNK_RELOAD_KEY_PREFIX}${chunkName || 'module'}`;
        const hasReloaded = sessionStorage.getItem(reloadKey);
        const retryDelayMs = options.retryDelayMs ?? IN_PLACE_RETRY_DELAY_MS;

        try {
            const module = await factory();
            sessionStorage.removeItem(reloadKey);
            return module;
        } catch (firstError: any) {
            if (!isChunkLoadError(firstError)) {
                throw firstError;
            }

            // Brief transient failures (container restart, reverse-proxy burst limit)
            // often resolve cleanly on a single delayed retry without a full reload.
            if (retryDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
            try {
                const retryModule = await factory();
                sessionStorage.removeItem(reloadKey);
                return retryModule;
            } catch (error: any) {
                if (isChunkLoadError(error) && !hasReloaded) {
                    sessionStorage.setItem(reloadKey, 'true');
                    void reloadAfterChunkError();
                    // Return a non-resolving promise to hold rendering until the page reloads
                    return new Promise(() => {});
                }

                throw error;
            }
        }
    });
}
