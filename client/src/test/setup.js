import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

function installMatchMediaMock() {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query) => ({
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
}

afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
});

beforeEach(() => {
    installMatchMediaMock();
});

beforeAll(() => {
    installMatchMediaMock();

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
            writeText: vi.fn().mockResolvedValue(),
        },
    });
});
