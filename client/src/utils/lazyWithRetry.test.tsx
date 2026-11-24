import React, { Suspense } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAppCachesAndUnregisterSw,
    isChunkLoadError,
    lazyWithRetry,
    reloadAfterChunkError,
} from './lazyWithRetry';

describe('lazyWithRetry and SW cache recovery', () => {
    const originalLocation = window.location;
    const originalCaches = window.caches;
    const originalServiceWorker = navigator.serviceWorker;

    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation,
        });
        Object.defineProperty(window, 'caches', {
            configurable: true,
            writable: true,
            value: originalCaches,
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            writable: true,
            value: originalServiceWorker,
        });
        vi.restoreAllMocks();
    });

    it('detects dynamic import and chunk load errors across browsers', () => {
        expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://localhost/assets/Login-123.js'))).toBe(true);
        expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
        expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/index.css'))).toBe(true);
        expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'boom' })).toBe(true);
        expect(isChunkLoadError(new Error('Regular application error'))).toBe(false);
    });

    it('retries a transient chunk load failure once in place without reloading', async () => {
        const reloadSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { ...originalLocation, reload: reloadSpy },
        });

        let attempts = 0;
        const LazyDemo = lazyWithRetry(async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new TypeError('Failed to fetch dynamically imported module: https://localhost/assets/Login-D_dhDcAv.js');
            }
            return { default: () => <div>Recovered Login</div> };
        }, 'Login', { retryDelayMs: 0 });

        render(
            <Suspense fallback={<div>loading</div>}>
                <LazyDemo />
            </Suspense>
        );

        expect(await screen.findByText('Recovered Login')).toBeInTheDocument();
        expect(attempts).toBe(2);
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('clears nms-shell-* caches, unregisters sw.js, resets guards, and reloads on reloadAfterChunkError', async () => {
        const deletedCaches: string[] = [];
        const unregisterSw = vi.fn().mockResolvedValue(true);
        const keepOtherSw = vi.fn().mockResolvedValue(true);
        const postMessage = vi.fn();
        const reloadSpy = vi.fn();

        Object.defineProperty(window, 'caches', {
            configurable: true,
            writable: true,
            value: {
                keys: vi.fn().mockResolvedValue(['nms-shell-v4', 'nms-shell-v5', 'other-app-v1']),
                delete: vi.fn().mockImplementation(async (key: string) => {
                    deletedCaches.push(key);
                    return true;
                }),
            },
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            writable: true,
            value: {
                controller: { postMessage },
                getRegistrations: vi.fn().mockResolvedValue([
                    { active: { scriptURL: 'https://localhost/core-vault/25377125b0/sw.js' }, unregister: unregisterSw },
                    { active: { scriptURL: 'https://localhost/other-worker.js' }, unregister: keepOtherSw },
                ]),
            },
        });
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { ...originalLocation, reload: reloadSpy },
        });

        sessionStorage.setItem('nms_chunk_reload_Login', 'true');
        sessionStorage.setItem('nms_auto_reload_chunk_error', '123');
        sessionStorage.setItem('nms_vite_preload_reload_attempt', '456');

        await reloadAfterChunkError({ resetRetryGuards: true });

        expect(deletedCaches).toEqual(['nms-shell-v4', 'nms-shell-v5']);
        expect(postMessage).toHaveBeenCalledWith({ type: 'NMS_CLEAR_CACHE' });
        expect(unregisterSw).toHaveBeenCalledTimes(1);
        expect(keepOtherSw).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('nms_chunk_reload_Login')).toBeNull();
        expect(sessionStorage.getItem('nms_auto_reload_chunk_error')).toBeNull();
        expect(sessionStorage.getItem('nms_vite_preload_reload_attempt')).toBeNull();
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('clearAppCachesAndUnregisterSw is safe when caches and serviceWorker are unavailable', async () => {
        Object.defineProperty(window, 'caches', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            writable: true,
            value: undefined,
        });

        await expect(clearAppCachesAndUnregisterSw()).resolves.toBeUndefined();
    });
});

describe('public/sw.js cache hygiene', () => {
    function createMockResponse(body: string, { status = 200, type = 'basic', contentType = 'text/plain' } = {}) {
        const headers = new Map([['content-type', contentType]]);
        const res: any = {
            status,
            type,
            body,
            headers: {
                get: (name: string) => headers.get(name.toLowerCase()) || null,
            },
            clone() {
                return createMockResponse(body, { status, type, contentType });
            },
        };
        return res;
    }

    function bootSw(fetchImpl: (req: any) => Promise<any>) {
        const swPath = path.resolve(process.cwd(), 'public/sw.js');
        const swCode = fs.readFileSync(swPath, 'utf8');
        const listeners: Record<string, Array<(event: any) => void>> = {};
        const store = new Map<string, Map<string, any>>();

        const getCache = (name: string) => {
            if (!store.has(name)) store.set(name, new Map());
            const map = store.get(name)!;
            return {
                addAll: async () => {},
                keys: async () => Array.from(map.keys()).map((url) => ({ url })),
                match: async (req: any) => map.get(typeof req === 'string' ? req : req.url),
                put: async (req: any, res: any) => {
                    map.set(typeof req === 'string' ? req : req.url, res);
                },
                delete: async (req: any) => map.delete(typeof req === 'string' ? req : req.url),
            };
        };

        const cachesMock = {
            open: async (name: string) => getCache(name),
            keys: async () => Array.from(store.keys()),
            delete: async (name: string) => store.delete(name),
            match: async (req: any) => {
                const url = typeof req === 'string' ? req : req.url;
                for (const map of store.values()) {
                    if (map.has(url)) return map.get(url);
                }
                return undefined;
            },
        };

        const selfMock: any = {
            registration: { scope: 'https://localhost/core-vault/25377125b0/' },
            location: { origin: 'https://localhost' },
            skipWaiting: vi.fn(),
            clients: { claim: vi.fn().mockResolvedValue(undefined) },
            addEventListener: (name: string, fn: (event: any) => void) => {
                listeners[name] = listeners[name] || [];
                listeners[name].push(fn);
            },
        };

        const context = vm.createContext({
            self: selfMock,
            caches: cachesMock,
            fetch: fetchImpl,
            URL,
            Set,
            Promise,
            Response: {
                error: () => ({ status: 0, type: 'error', headers: { get: () => null } }),
            },
        });
        vm.runInContext(swCode, context);
        return { listeners, store };
    }

    it('rejects caching HTML responses for JS assets and evicts poisoned cached entries', async () => {
        const assetUrl = 'https://localhost/core-vault/25377125b0/assets/Login-D_dhDcAv.js';
        let fetchResponse = createMockResponse('<!DOCTYPE html><html>fallback</html>', {
            status: 200,
            contentType: 'text/html; charset=utf-8',
        });

        const { listeners, store } = bootSw(async () => fetchResponse);

        // 1. Activate deletes legacy nms-shell-v4 cache
        store.set('nms-shell-v4', new Map([[assetUrl, fetchResponse]]));
        const activateWaits: Promise<any>[] = [];
        listeners.activate[0]({ waitUntil: (p: Promise<any>) => activateWaits.push(p) });
        await Promise.all(activateWaits);
        expect(store.has('nms-shell-v4')).toBe(false);
        expect(store.has('nms-shell-v5')).toBe(true);

        // 2. Network returns 200 text/html for Login-D_dhDcAv.js -> must NOT be stored in cache
        let responsePromise: Promise<any> | null = null;
        listeners.fetch[0]({
            request: { url: assetUrl, method: 'GET', mode: 'cors' },
            respondWith: (p: Promise<any>) => { responsePromise = p; },
        });
        await responsePromise;
        await new Promise((r) => setTimeout(r, 10));
        expect(store.get('nms-shell-v5')?.has(assetUrl)).toBe(false);

        // 3. Even if cache somehow contains a poisoned text/html entry, SW evicts it and fetches real JS
        store.get('nms-shell-v5')!.set(assetUrl, fetchResponse);
        fetchResponse = createMockResponse('export default function Login() {}', {
            status: 200,
            contentType: 'application/javascript; charset=UTF-8',
        });
        listeners.fetch[0]({
            request: { url: assetUrl, method: 'GET', mode: 'cors' },
            respondWith: (p: Promise<any>) => { responsePromise = p; },
        });
        const resolved = await responsePromise;
        await new Promise((r) => setTimeout(r, 10));
        expect(resolved.headers.get('content-type')).toContain('application/javascript');
        expect(store.get('nms-shell-v5')?.get(assetUrl)?.headers.get('content-type')).toContain('application/javascript');
    });
});
