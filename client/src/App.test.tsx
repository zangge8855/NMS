import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const testState = vi.hoisted(() => ({
    toasterProps: [] as any[],
    isMobile: false,
    throwSidebarError: false,
    auth: {
        user: { role: 'admin', username: 'admin' },
        token: 'jwt-token',
        isAuthenticated: true,
        loading: false,
    },
}));

vi.mock('react-hot-toast', () => ({
    Toaster: (props: any) => {
        testState.toasterProps.push(props);
        return <div data-testid="mock-toaster" data-position={props.position} />;
    },
    default: Object.assign(vi.fn(), {
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('./hooks/useMediaQuery', () => ({
    default: () => testState.isMobile,
}));

vi.mock('./contexts/AuthContext', () => ({
    useAuth: () => testState.auth,
}));

vi.mock('./contexts/ServerContext', () => ({
    ServerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useServer: () => ({ servers: [], activeServerId: null }),
}));

vi.mock('./contexts/NotificationContext', () => ({
    NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./contexts/ThemeContext', () => ({
    ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/Layout/Sidebar', () => ({
    default: () => {
        if (testState.throwSidebarError) {
            throw new Error('Synthetic shell crash');
        }
        return <div data-testid="mock-sidebar" />;
    },
}));

vi.mock('./components/Layout/MobileBottomNav', () => ({
    default: () => <div data-testid="mock-mobile-nav" />,
}));

vi.mock('./components/System/SecurityBootstrapWizard', () => ({
    default: () => null,
}));

vi.mock('./components/UI/CommandPalette', () => ({
    default: () => null,
}));

vi.mock('./components/Dashboard/Dashboard', () => ({
    default: () => <div data-testid="mock-dashboard">Dashboard</div>,
}));

vi.mock('./api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
    clearStoredToken: vi.fn(),
}));

import api from './api/client';
import App from './App';

describe('App', () => {
    const originalWebSocket = globalThis.WebSocket;
    const originalLocation = window.location;

    beforeEach(() => {
        testState.toasterProps = [];
        testState.isMobile = false;
        testState.throwSidebarError = false;
        testState.auth = {
            user: { role: 'admin', username: 'admin' },
            token: 'jwt-token',
            isAuthenticated: true,
            loading: false,
        };
        delete window.__NMS_SITE_BASE_PATH__;
        (api.get as any).mockReset().mockResolvedValue({ data: { obj: {} } });
        (api.post as any).mockReset().mockResolvedValue({
            data: {
                obj: {
                    ticket: 'fresh-ticket-1',
                    expiresAt: new Date(Date.now() + 600_000).toISOString(),
                    expiresInSeconds: 600,
                },
            },
        });
    });

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket;
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation,
        });
        delete window.__NMS_SITE_BASE_PATH__;
        vi.useRealTimers();
    });

    it('renders desktop Toaster at bottom-right instead of masking top-right header/modals', async () => {
        class IdleWebSocket {
            static OPEN = 1;
            onopen: any = null;
            onclose: any = null;
            onmessage: any = null;
            onerror: any = null;
            close() {}
            send() {}
        }
        globalThis.WebSocket = IdleWebSocket as any;

        render(
            <MemoryRouter initialEntries={['/']}>
                <App />
            </MemoryRouter>
        );

        const toaster = await screen.findByTestId('mock-toaster');
        expect(toaster).toHaveAttribute('data-position', 'bottom-right');
        const lastToaster = testState.toasterProps[testState.toasterProps.length - 1];
        expect(lastToaster.containerStyle).toEqual({
            bottom: '20px',
            right: '20px',
        });
    });

    it('resolves ErrorBoundary Go to Home and Re-login URLs relative to __NMS_SITE_BASE_PATH__', async () => {
        window.__NMS_SITE_BASE_PATH__ = '/panel';
        testState.throwSidebarError = true;
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const locationMock: Record<string, any> = {
            protocol: 'http:',
            host: 'localhost:5173',
            href: 'http://localhost:5173/panel/broken',
            reload: vi.fn(),
        };
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: locationMock,
        });

        render(
            <MemoryRouter initialEntries={['/']}>
                <App />
            </MemoryRouter>
        );

        const goHomeBtn = await screen.findByRole('button', { name: /返回首页|Go to Home/ });
        fireEvent.click(goHomeBtn);
        expect(locationMock.href).toBe('/panel/');

        const reloginBtn = screen.getByRole('button', { name: /重新登录|Re-login/ });
        fireEvent.click(reloginBtn);
        expect(locationMock.href).toBe('/panel/login');

        consoleSpy.mockRestore();
    });

    it('clears expired/rejected rootWsTicket on handshake close and backs off instead of retry-storming', async () => {
        vi.useFakeTimers();
        const sockets: any[] = [];
        class MockWebSocket {
            static OPEN = 1;
            url: string;
            onopen: any = null;
            onclose: any = null;
            onmessage: any = null;
            onerror: any = null;
            constructor(url: string) {
                this.url = url;
                sockets.push(this);
            }
            close() {}
            send() {}
        }
        globalThis.WebSocket = MockWebSocket as any;

        (api.post as any)
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        ticket: 'expired-ticket',
                        expiresAt: new Date(Date.now() - 10_000).toISOString(),
                        expiresInSeconds: 600,
                    },
                },
            })
            .mockRejectedValueOnce({ response: { status: 401 }, message: 'Unauthorized' });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <MemoryRouter initialEntries={['/']}>
                <App />
            </MemoryRouter>
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(api.post).toHaveBeenCalledTimes(1);
        expect(sockets).toHaveLength(1);
        expect(sockets[0].url).toContain('ticket=expired-ticket');

        // Simulate handshake failure (didOpen === false) -> must clear ticket and NOT reconnect-loop.
        await act(async () => {
            sockets[0].onclose?.({ code: 1006, reason: '', wasClean: false });
            await Promise.resolve();
            await Promise.resolve();
        });

        // One refresh attempt triggered (or cooled down cleanly), stopped permanently on 401.
        await act(async () => {
            vi.advanceTimersByTime(60_000);
            await Promise.resolve();
        });

        expect(sockets).toHaveLength(1);
        expect(api.post).toHaveBeenCalledTimes(2);
        consoleSpy.mockRestore();
    });
});
