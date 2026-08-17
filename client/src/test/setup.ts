import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

function createMemoryStorage(): Storage {
    const items = new Map<string, string>();

    return {
        get length() {
            return items.size;
        },
        key(index: number) {
            return Array.from(items.keys())[index] ?? null;
        },
        getItem(key: string) {
            const normalizedKey = String(key);
            return items.has(normalizedKey) ? items.get(normalizedKey)! : null;
        },
        setItem(key: string, value: string) {
            items.set(String(key), String(value));
        },
        removeItem(key: string) {
            items.delete(String(key));
        },
        clear() {
            items.clear();
        },
    };
}

function readStorage(target: any, name: string): any {
    try {
        return target?.[name];
    } catch {
        return undefined;
    }
}

function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
    const existing = readStorage(globalThis, name) || readStorage(window, name);
    if (existing && typeof existing.clear === 'function') return;

    const storage = createMemoryStorage();
    Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value: storage,
    });
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: storage,
    });
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
});

beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });

    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });

    Object.defineProperty(window, 'IntersectionObserver', {
        writable: true,
        value: class IntersectionObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });

    Object.defineProperty(window, 'scrollTo', {
        writable: true,
        value: vi.fn(),
    });

    Object.defineProperty(window.URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(() => 'blob:mock'),
    });

    Object.defineProperty(window.URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(),
    });

    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        writable: true,
        value: {
            writeText: vi.fn().mockResolvedValue(undefined),
        },
    });
});
