import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@simplewebauthn/browser', () => ({
    startAuthentication: vi.fn(),
}));

import { startAuthentication } from '@simplewebauthn/browser';
import api, { clearStoredToken, getStoredToken, setStoredToken, shouldClearSessionOnUnauthorized } from '../api/client';
import { getErrorMessage } from './format';
import { normalizeCarrierLabel, resolveAccessCountry, resolveAccessGeoDisplay } from './accessGeo';
import { getClientIdentifier } from './protocol';
import { buildSubscriptionProfileBundle } from './subscriptionProfiles';
import { readSessionSnapshot, writeSessionSnapshot } from './sessionSnapshot';
import { applyAppBootstrapSnapshots } from './appBootstrap';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { NotificationProvider, useNotifications } from '../contexts/NotificationContext';
import { ServerProvider, useServer } from '../contexts/ServerContext';
import { ConfirmProvider, useConfirm } from '../contexts/ConfirmContext';
import useServerTelemetry from '../hooks/useServerTelemetry';
import useWebSocket from '../hooks/useWebSocket';
import Login from '../components/Login/Login';
import Header from '../components/Layout/Header';
import CommandPalette from '../components/UI/CommandPalette';
import ModalShell from '../components/UI/ModalShell';
import ExpandableQRCode from '../components/UI/ExpandableQRCode';
import SecurityBootstrapWizard from '../components/System/SecurityBootstrapWizard';
import Dashboard from '../components/Dashboard/Dashboard';
import App from '../App';

function encodeBase64UrlUtf8(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeFakeJwt(payload: Record<string, any>): string {
    const header = encodeBase64UrlUtf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = encodeBase64UrlUtf8(JSON.stringify(payload));
    return `${header}.${body}.sig`;
}

describe('w2-client-core: Fix 1 getErrorMessage', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.lang = 'zh-CN';
    });

    it('defaults locale via resolveActiveClientLocale and returns non-PANEL apiMsg before heuristics', () => {
        localStorage.setItem('nms_locale', 'en-US');

        // Even when the API message mentions "401", "password", "dns", or "resolve",
        // a non-PANEL_ backend message must be preserved verbatim.
        expect(getErrorMessage({
            response: {
                status: 400,
                data: { msg: 'Password cannot contain 401 or dns resolve errors' },
            },
        })).toBe('Password cannot contain 401 or dns resolve errors');

        expect(getErrorMessage({
            response: {
                status: 403,
                data: { msg: '用户名格式有误，包含禁用字符 403' },
            },
        })).toBe('用户名格式有误，包含禁用字符 403');

        // Genuine transport failure uses active locale ('en-US') by default.
        expect(getErrorMessage({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toContain('refused the connection');
    });

    it('matches PANEL_ codes and transport errors while avoiding false positives on generic substrings', () => {
        expect(getErrorMessage({
            response: {
                status: 502,
                data: { code: 'PANEL_LOGIN_FAILED', msg: 'Login failed (401)' },
            },
        }, 'Fallback', 'zh-CN')).toBe('节点认证失败，请重新输入并保存面板用户名/密码');

        expect(getErrorMessage({
            response: {
                status: 502,
                data: { code: 'PANEL_INBOUND_LIST_FAILED', msg: 'Failed' },
            },
        }, 'Fallback', 'en-US')).toBe('Failed to read the node inbound list. Verify node availability and retry.');

        // Generic error messages without PANEL_ codes must not be rewritten into node auth/dns errors.
        expect(getErrorMessage(new Error('Invalid 密码 length 401'), 'Fallback', 'zh-CN')).toBe('Invalid 密码 length 401');
        expect(getErrorMessage(new Error('Cannot resolve dns label 403'), 'Fallback', 'en-US')).toBe('Cannot resolve dns label 403');
        expect(getErrorMessage({
            response: { status: 401 },
            message: 'Request failed with status code 401',
        }, 'Session expired', 'en-US')).toBe('Session expired');
    });
});

describe('w2-client-core: Fix 2 shouldClearSessionOnUnauthorized', () => {
    it('clears NMS session for 401 on /servers and /panel routes unless errorCode starts with PANEL_', () => {
        expect(shouldClearSessionOnUnauthorized({
            response: { status: 401, data: { msg: 'Invalid or expired token' } },
            config: { url: '/servers' },
        })).toBe(true);

        expect(shouldClearSessionOnUnauthorized({
            response: { status: 401, data: { msg: 'Invalid or expired token' } },
            config: { url: '/servers/s1/inbounds' },
        })).toBe(true);

        expect(shouldClearSessionOnUnauthorized({
            response: { status: 401, data: { msg: 'Invalid or expired token' } },
            config: { url: '/panel/s1/panel/api/inbounds/list' },
        })).toBe(true);

        expect(shouldClearSessionOnUnauthorized({
            response: { status: 401, data: { code: 'PANEL_LOGIN_FAILED' } },
            config: { url: '/panel/s1/panel/api/inbounds/list' },
        })).toBe(false);

        expect(shouldClearSessionOnUnauthorized({
            response: { status: 401, data: { msg: 'Wrong password' } },
            config: { url: '/auth/change-password' },
        })).toBe(false);
    });
});

describe('w2-client-core: Fix 3 AuthContext UTF-8 JWT, exp guard, and cross-account snapshot clear', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        clearStoredToken();
    });

    it('decodes non-ASCII UTF-8 JWT payload on offline fallback and rejects missing/expired exp', async () => {
        function AuthProbe() {
            const { isAuthenticated, loading, user } = useAuth();
            if (loading) return <div>loading</div>;
            return (
                <div>
                    <div data-testid="auth-state">{isAuthenticated ? 'yes' : 'no'}</div>
                    <div data-testid="auth-user">{user?.username || 'none'}</div>
                </div>
            );
        }

        // 1. Valid future exp with UTF-8 username
        const validJwt = makeFakeJwt({
            username: '运维管理员',
            role: 'admin',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        setStoredToken(validJwt);
        vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network Error'));

        const first = render(
            <MemoryRouter>
                <AuthProvider>
                    <AuthProbe />
                </AuthProvider>
            </MemoryRouter>
        );
        expect(await screen.findByTestId('auth-state')).toHaveTextContent('yes');
        expect(screen.getByTestId('auth-user')).toHaveTextContent('运维管理员');
        first.unmount();

        // 2. Expired JWT must be rejected on offline fallback
        const expiredJwt = makeFakeJwt({
            username: 'expired-admin',
            role: 'admin',
            exp: Math.floor(Date.now() / 1000) - 60,
        });
        setStoredToken(expiredJwt);
        vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network Error'));

        const second = render(
            <MemoryRouter>
                <AuthProvider>
                    <AuthProbe />
                </AuthProvider>
            </MemoryRouter>
        );
        expect(await screen.findByTestId('auth-state')).toHaveTextContent('no');
        expect(getStoredToken()).toBe('');
        second.unmount();

        // 3. Missing exp must also be rejected on offline fallback
        const noExpJwt = makeFakeJwt({ username: 'no-exp', role: 'admin' });
        setStoredToken(noExpJwt);
        vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Network Error'));

        render(
            <MemoryRouter>
                <AuthProvider>
                    <AuthProbe />
                </AuthProvider>
            </MemoryRouter>
        );
        expect(await screen.findByTestId('auth-state')).toHaveTextContent('no');
        expect(getStoredToken()).toBe('');
    });

    it('clears prior session snapshots inside login(), loginTwoFactor(), and passkey login', async () => {
        function AuthActionsProbe() {
            const { login, loginTwoFactor } = useAuth();
            return (
                <div>
                    <button type="button" onClick={() => void login('admin2', 'pass')}>do-login</button>
                    <button type="button" onClick={() => void loginTwoFactor('ch', '123456', false)}>do-2fa</button>
                </div>
            );
        }

        vi.spyOn(api, 'get').mockResolvedValue({ data: { obj: { enabled: true } } });
        vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
            if (url === '/auth/login') {
                return { data: { success: true, token: 'new-token-1', user: { username: 'admin2', role: 'admin' } } };
            }
            if (url === '/auth/login/2fa') {
                return { data: { success: true, token: 'new-token-2', user: { username: 'admin3', role: 'admin' } } };
            }
            if (url === '/auth/passkey/login-options') {
                return { data: { success: true, obj: { options: {}, challengeSessionId: 'cs-1' } } };
            }
            if (url === '/auth/passkey/login-verify') {
                return { data: { success: true, token: 'passkey-token' } };
            }
            return { data: {} };
        });

        const { unmount } = render(
            <MemoryRouter>
                <AuthProvider>
                    <AuthActionsProbe />
                </AuthProvider>
            </MemoryRouter>
        );

        writeSessionSnapshot('dashboard_global_v1', { stale: 'from-admin-1' });
        expect(readSessionSnapshot('dashboard_global_v1')).toEqual({ stale: 'from-admin-1' });
        fireEvent.click(screen.getByRole('button', { name: 'do-login' }));
        await waitFor(() => {
            expect(getStoredToken()).toBe('new-token-1');
        });
        expect(readSessionSnapshot('dashboard_global_v1')).toBeNull();

        writeSessionSnapshot('dashboard_global_v1', { stale: 'from-admin-2' });
        fireEvent.click(screen.getByRole('button', { name: 'do-2fa' }));
        await waitFor(() => {
            expect(getStoredToken()).toBe('new-token-2');
        });
        expect(readSessionSnapshot('dashboard_global_v1')).toBeNull();
        unmount();

        // Passkey login in Login.tsx
        clearStoredToken();
        writeSessionSnapshot('managed_users_v1', [{ id: 'leaked-user' }]);
        vi.mocked(startAuthentication).mockResolvedValueOnce({ id: 'cred-1' } as any);
        render(
            <MemoryRouter initialEntries={['/login']}>
                <ThemeProvider>
                    <LanguageProvider>
                        <AuthProvider>
                            <Login />
                        </AuthProvider>
                    </LanguageProvider>
                </ThemeProvider>
            </MemoryRouter>
        );

        const passkeyBtn = await screen.findByRole('button', { name: /使用通行密钥登录|Sign in with a passkey/ });
        fireEvent.click(passkeyBtn);
        await waitFor(() => {
            expect(getStoredToken()).toBe('passkey-token');
        });
        expect(readSessionSnapshot('managed_users_v1')).toBeNull();
    });
});

describe('w2-client-core: Fix 4 single shared WS, onOpen callback, and localized skip-link', () => {
    const originalWebSocket = globalThis.WebSocket;

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket;
        vi.restoreAllMocks();
        clearStoredToken();
    });

    it('invokes useWebSocket onOpen when the socket opens', () => {
        const sockets: any[] = [];
        class MockWS {
            static OPEN = 1;
            onopen: any = null;
            onclose: any = null;
            onmessage: any = null;
            onerror: any = null;
            constructor(public url: string) {
                sockets.push(this);
            }
            close() {}
            send() {}
        }
        globalThis.WebSocket = MockWS as any;
        const onOpen = vi.fn();

        function Harness() {
            const { status } = useWebSocket('ws://localhost/ws?ticket=t1', { onOpen });
            return <div data-testid="status">{status}</div>;
        }

        render(<Harness />);
        expect(sockets).toHaveLength(1);
        act(() => {
            sockets[0].onopen?.();
        });
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });

    it('shares a single WebSocket from App to Dashboard and renders localized skip-link', async () => {
        localStorage.setItem('nms_locale', 'en-US');
        const sockets: any[] = [];
        class MockWS {
            static OPEN = 1;
            onopen: any = null;
            onclose: any = null;
            onmessage: any = null;
            onerror: any = null;
            constructor(public url: string) {
                sockets.push(this);
            }
            close() {}
            send() {}
        }
        globalThis.WebSocket = MockWS as any;

        const validJwt = makeFakeJwt({
            username: 'root',
            role: 'admin',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        setStoredToken(validJwt);

        vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
            if (url === '/auth/check') {
                return { data: { user: { id: 'u1', username: 'root', role: 'admin' } } };
            }
            if (url === '/auth/bootstrap') {
                return { data: { obj: {} } };
            }
            if (url === '/servers') {
                return { data: { obj: [{ id: 's1', name: 'Node 1' }] } };
            }
            if (url === '/system/security/bootstrap-status') {
                return { data: { obj: { required: false, issues: [] } } };
            }
            if (url.startsWith('/system/notifications')) {
                return { data: { obj: { items: [], unreadCount: 0 } } };
            }
            if (url === '/servers/dashboard/snapshot') {
                return { data: { obj: { serverStatuses: {}, globalStats: { serverCount: 1, onlineServers: 1 } } } };
            }
            return { data: { obj: {} } };
        });
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
            data: {
                obj: {
                    ticket: 'shared-ws-ticket',
                    expiresAt: new Date(Date.now() + 600_000).toISOString(),
                },
            },
        });

        render(
            <MemoryRouter initialEntries={['/']}>
                <LanguageProvider>
                    <ThemeProvider>
                        <AuthProvider>
                            <ConfirmProvider>
                                <App />
                            </ConfirmProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </LanguageProvider>
            </MemoryRouter>
        );

        const skipLink = await screen.findByText('Skip to main content');
        expect(skipLink).toHaveClass('skip-link');

        await waitFor(() => {
            expect(sockets).toHaveLength(1);
        });
        // Dashboard must not request a second /ws/ticket or open a second WebSocket.
        const ticketCalls = postSpy.mock.calls.filter(([url]) => url === '/ws/ticket');
        expect(ticketCalls).toHaveLength(1);
    });

    it('Dashboard avoids opening a second socket when shared WS props are provided', async () => {
        const sockets: any[] = [];
        class MockWS {
            static OPEN = 1;
            constructor(public url: string) {
                sockets.push(this);
            }
            close() {}
            send() {}
        }
        globalThis.WebSocket = MockWS as any;

        const validJwt = makeFakeJwt({ username: 'root', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
        setStoredToken(validJwt);
        vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
            if (url === '/auth/check') return { data: { user: { id: 'u1', username: 'root', role: 'admin' } } };
            if (url === '/servers') return { data: { obj: [] } };
            return { data: { obj: {} } };
        });
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { obj: { ticket: 'x' } } });

        render(
            <MemoryRouter>
                <LanguageProvider>
                    <ThemeProvider>
                        <AuthProvider>
                            <ConfirmProvider>
                                <NotificationProvider enabled={false} wsLastMessage={null}>
                                    <ServerProvider>
                                        <Dashboard wsStatus="connected" wsLastMessage={null} />
                                    </ServerProvider>
                                </NotificationProvider>
                            </ConfirmProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </LanguageProvider>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/servers');
        });
        expect(postSpy).not.toHaveBeenCalledWith('/ws/ticket');
        expect(sockets).toHaveLength(0);
    });
});

describe('w2-client-core: Fix 5 telemetry snapshot guard, NotificationContext hydration, and ServerContext panelApi', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('useServerTelemetry does not overwrite sessionSnapshot on initial mount or when disabled', async () => {
        function Probe({ enabled }: { enabled: boolean }) {
            const { telemetry } = useServerTelemetry({ enabled, refreshIntervalMs: 60_000 });
            return <div data-testid="count">{telemetry.items.length}</div>;
        }

        const key = 'server_telemetry_overview_v1:24:24';
        let resolveFetch!: (val: any) => void;
        vi.spyOn(api, 'get').mockImplementation(() => new Promise((r) => {
            resolveFetch = r;
        }));

        const { rerender } = render(<Probe enabled={false} />);
        expect(sessionStorage.getItem(`nms_session_snapshot:${key}`)).toBeNull();

        rerender(<Probe enabled />);
        // While live request is still pending, snapshot must not be written with empty data.
        expect(sessionStorage.getItem(`nms_session_snapshot:${key}`)).toBeNull();

        await act(async () => {
            resolveFetch({
                data: {
                    obj: {
                        items: [{ serverId: 's1' }],
                        byServerId: { s1: { serverId: 's1' } },
                        generatedAt: '2026-11-18T00:00:00Z',
                    },
                },
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('count')).toHaveTextContent('1');
            expect(readSessionSnapshot(key)?.items).toHaveLength(1);
        });
    });

    it('NotificationContext preserves multi-item bootstrap hydration and resets refs when disabled', async () => {
        function Probe() {
            const { notifications } = useNotifications();
            return <div data-testid="notif-len">{notifications.length}</div>;
        }

        let resolveInitial!: (val: any) => void;
        const getSpy = vi.spyOn(api, 'get')
            .mockImplementationOnce(() => new Promise((r) => {
                resolveInitial = r;
            }))
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        items: [{ id: 'n-re-enabled', title: 'Fresh after re-enable' }],
                        unreadCount: 1,
                    },
                },
            });

        const { rerender } = render(
            <NotificationProvider enabled wsLastMessage={null}>
                <Probe />
            </NotificationProvider>
        );

        act(() => {
            applyAppBootstrapSnapshots({
                notifications: {
                    notifications: [
                        { id: 'n1', title: 'Notice 1' },
                        { id: 'n2', title: 'Notice 2' },
                        { id: 'n3', title: 'Notice 3' },
                    ],
                    unreadCount: 3,
                    loadedLimit: 3,
                },
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('notif-len')).toHaveTextContent('3');
        });

        // Initial limit=1 resolves with only n1; multi-item bootstrap must NOT be truncated to 1.
        await act(async () => {
            resolveInitial({
                data: {
                    obj: {
                        items: [{ id: 'n1', title: 'Notice 1' }],
                        unreadCount: 3,
                    },
                },
            });
        });
        expect(screen.getByTestId('notif-len')).toHaveTextContent('3');

        // Disable then re-enable must reset initialFetchDone and re-fetch live notifications.
        rerender(
            <NotificationProvider enabled={false} wsLastMessage={null}>
                <Probe />
            </NotificationProvider>
        );
        expect(screen.getByTestId('notif-len')).toHaveTextContent('0');

        rerender(
            <NotificationProvider enabled wsLastMessage={null}>
                <Probe />
            </NotificationProvider>
        );
        await waitFor(() => {
            expect(getSpy).toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('notif-len')).toHaveTextContent('1');
        });
    });

    it('ServerContext panelApi rejects early when activeServerId is null or global', async () => {
        let capturedPanelApi: ((method: string, path: string) => Promise<any>) | null = null;
        function Probe() {
            const { panelApi, activeServerId } = useServer();
            capturedPanelApi = panelApi;
            return <div data-testid="active">{activeServerId || 'none'}</div>;
        }

        vi.spyOn(api, 'get').mockResolvedValueOnce({
            data: { obj: [{ id: 's1', name: 'Node 1' }] },
        });

        render(
            <ServerProvider>
                <Probe />
            </ServerProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('active')).toHaveTextContent('global');
        });

        await expect(capturedPanelApi!('get', '/panel/api/inbounds/list')).rejects.toThrow();
    });
});

describe('w2-client-core: Fix 6 Header & CommandPalette shortcuts, scrollIntoView, and RBAC', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        clearStoredToken();
    });

    it('opens CommandPalette via Ctrl+K and Ctrl+Shift+K without Header swallowing it, and opens Header via /', async () => {
        const validJwt = makeFakeJwt({ username: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
        setStoredToken(validJwt);
        vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
            if (url === '/auth/check') return { data: { user: { id: 'u1', username: 'admin', role: 'admin' } } };
            if (url === '/servers') return { data: { obj: [{ id: 's1', name: 'Node A' }] } };
            return { data: { obj: {} } };
        });

        render(
            <MemoryRouter>
                <LanguageProvider>
                    <ThemeProvider>
                        <AuthProvider>
                            <ConfirmProvider>
                                <NotificationProvider enabled={false} wsLastMessage={null}>
                                    <ServerProvider>
                                        <Header title="Dashboard" />
                                        <CommandPalette />
                                    </ServerProvider>
                                </NotificationProvider>
                            </ConfirmProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </LanguageProvider>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/auth/check');
        });

        // Ctrl+K opens CommandPalette, NOT Header search
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        expect(await screen.findByRole('dialog', { name: /全局命令面板|Command Palette/ })).toBeInTheDocument();

        // Escape closes CommandPalette
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: /全局命令面板|Command Palette/ })).not.toBeInTheDocument();
        });

        // Ctrl+Shift+K also opens CommandPalette cleanly
        fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true });
        expect(await screen.findByRole('dialog', { name: /全局命令面板|Command Palette/ })).toBeInTheDocument();

        // ArrowDown triggers scrollIntoView({ block: 'nearest' }) on active option
        const scrollSpy = vi.fn();
        Element.prototype.scrollIntoView = scrollSpy;
        const paletteInput = screen.getByRole('combobox', { name: /全局命令面板|Command Palette/ });
        fireEvent.keyDown(paletteInput, { key: 'ArrowDown' });
        expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });

        // Close CommandPalette and press '/' for Header quick search
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: /全局命令面板|Command Palette/ })).not.toBeInTheDocument();
        });

        fireEvent.keyDown(document, { key: '/' });
        const headerSearchInput = screen.getByRole('combobox', { name: /全局命令搜索/ });
        await waitFor(() => {
            expect(headerSearchInput).toHaveAttribute('aria-expanded', 'true');
        });
        scrollSpy.mockClear();
        fireEvent.keyDown(headerSearchInput, { key: 'ArrowDown' });
        expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('hides create-user and create-server quick actions from auditor in Header search', async () => {
        const auditorJwt = makeFakeJwt({ username: 'audit1', role: 'auditor', exp: Math.floor(Date.now() / 1000) + 3600 });
        setStoredToken(auditorJwt);
        vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
            if (url === '/auth/check') return { data: { user: { id: 'u2', username: 'audit1', role: 'auditor' } } };
            if (url === '/servers') return { data: { obj: [] } };
            return { data: { obj: {} } };
        });

        render(
            <MemoryRouter>
                <LanguageProvider>
                    <ThemeProvider>
                        <AuthProvider>
                            <ConfirmProvider>
                                <NotificationProvider enabled={false} wsLastMessage={null}>
                                    <ServerProvider>
                                        <Header title="Audit" />
                                    </ServerProvider>
                                </NotificationProvider>
                            </ConfirmProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </LanguageProvider>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/auth/check');
        });

        const input = screen.getByRole('combobox', { name: /全局命令搜索/ });
        fireEvent.focus(input);
        expect(screen.queryByText('添加账号')).not.toBeInTheDocument();
        expect(screen.queryByText('添加服务器')).not.toBeInTheDocument();
        expect(screen.getByText('刷新当前页')).toBeInTheDocument();
    });
});

describe('w2-client-core: Fix 7 Modal/Wizard deadlock, aria-labelledby, inert isolation, and ConfirmContext exit retention', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        clearStoredToken();
        vi.useRealTimers();
    });

    it('ModalShell auto-wires aria-labelledby from heading when ariaLabel/ariaLabelledBy are omitted', async () => {
        render(
            <ModalShell isOpen onClose={() => {}}>
                <div className="modal">
                    <h2 className="modal-title">Auto Wired Heading</h2>
                    <button type="button">OK</button>
                </div>
            </ModalShell>
        );

        const dialog = await screen.findByRole('dialog');
        const heading = screen.getByText('Auto Wired Heading');
        await waitFor(() => {
            expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
        });
        expect(heading.id).toBeTruthy();
        expect(dialog).toHaveAccessibleName('Auto Wired Heading');
    });

    it('SecurityBootstrapWizard portals to body above inert #root when another ModalShell is open', async () => {
        const rootDiv = document.createElement('div');
        rootDiv.id = 'root';
        document.body.appendChild(rootDiv);

        const adminJwt = makeFakeJwt({ username: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
        setStoredToken(adminJwt);
        vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
            if (url === '/auth/check') return { data: { user: { id: 'u1', username: 'admin', role: 'admin' } } };
            if (url === '/system/security/bootstrap-status') {
                return {
                    data: {
                        obj: {
                            required: true,
                            issues: [{ code: 'WEAK_ADMIN', message: 'Default admin password' }],
                            admin: { username: 'admin' },
                            stats: { serverCount: 0, telegramConfigured: false },
                            envFile: '.env',
                        },
                    },
                };
            }
            return { data: { obj: {} } };
        });

        try {
            render(
                <MemoryRouter>
                    <LanguageProvider>
                        <AuthProvider>
                            <ModalShell isOpen onClose={() => {}}>
                                <div className="modal">
                                    <button type="button">Underlying Action</button>
                                </div>
                            </ModalShell>
                            <SecurityBootstrapWizard />
                        </AuthProvider>
                    </LanguageProvider>
                </MemoryRouter>,
                { container: rootDiv }
            );

            const wizardHeading = await screen.findByText(/首次部署安全向导|First-Run Security Wizard/);
            const wizardOverlay = wizardHeading.closest('.security-bootstrap-overlay');
            expect(wizardOverlay).not.toBeNull();
            // Must be portaled directly under document.body, NOT trapped inside inert #root.
            expect(rootDiv.contains(wizardOverlay)).toBe(false);
            expect(document.body.contains(wizardOverlay)).toBe(true);
            expect((rootDiv as any).inert).toBe(true);
            expect(rootDiv).toHaveAttribute('aria-hidden', 'true');
            expect(document.body.style.overflow).toBe('hidden');
        } finally {
            rootDiv.remove();
        }
    });

    it('ExpandableQRCode and CommandPalette isolate #root and lock body scroll cleanly', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ data: { obj: [] } });
        const rootDiv = document.createElement('div');
        rootDiv.id = 'root';
        document.body.appendChild(rootDiv);

        const user = userEvent.setup();
        try {
            const { unmount } = render(
                <MemoryRouter>
                    <LanguageProvider>
                        <ThemeProvider>
                            <AuthProvider>
                                <ServerProvider>
                                    <ExpandableQRCode value="vless://test-qr" label="Test QR" />
                                    <CommandPalette />
                                </ServerProvider>
                            </AuthProvider>
                        </ThemeProvider>
                    </LanguageProvider>
                </MemoryRouter>,
                { container: rootDiv }
            );

            await user.click(screen.getByRole('button', { name: /Test QR/ }));
            expect(await screen.findByRole('dialog', { name: '放大显示的二维码' })).toBeInTheDocument();
            expect((rootDiv as any).inert).toBe(true);
            expect(rootDiv).toHaveAttribute('aria-hidden', 'true');
            expect(document.body.style.overflow).toBe('hidden');

            await user.keyboard('{Escape}');
            await waitFor(() => {
                expect(screen.queryByRole('dialog', { name: '放大显示的二维码' })).not.toBeInTheDocument();
            });
            expect((rootDiv as any).inert).toBe(false);
            expect(rootDiv).not.toHaveAttribute('aria-hidden');
            expect(document.body.style.overflow).toBe('');

            fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
            expect(await screen.findByRole('dialog', { name: /全局命令面板|Command Palette/ })).toBeInTheDocument();
            expect((rootDiv as any).inert).toBe(true);
            expect(rootDiv).toHaveAttribute('aria-hidden', 'true');
            expect(document.body.style.overflow).toBe('hidden');

            fireEvent.keyDown(window, { key: 'Escape' });
            await waitFor(() => {
                expect(screen.queryByRole('dialog', { name: /全局命令面板|Command Palette/ })).not.toBeInTheDocument();
            });
            expect((rootDiv as any).inert).toBe(false);
            expect(rootDiv).not.toHaveAttribute('aria-hidden');
            expect(document.body.style.overflow).toBe('');
            unmount();
        } finally {
            rootDiv.remove();
        }
    });

    it('ConfirmContext retains title, message, and button labels during the 240ms exit animation', async () => {
        vi.useFakeTimers();

        function ConfirmProbe() {
            const confirm = useConfirm();
            return (
                <button
                    type="button"
                    onClick={() => void confirm({
                        title: 'Delete Node',
                        message: 'Are you sure?',
                        confirmText: 'Yes, Delete',
                        cancelText: 'Keep It',
                    })}
                >
                    trigger
                </button>
            );
        }

        render(
            <MemoryRouter>
                <LanguageProvider>
                    <ConfirmProvider>
                        <ConfirmProbe />
                    </ConfirmProvider>
                </LanguageProvider>
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
        expect(screen.getByText('Delete Node')).toBeInTheDocument();
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Yes, Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Keep It' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Keep It' }));
        // Immediately after closing, during the 240ms exit window, content must remain rendered!
        const overlay = document.body.querySelector('.modal-overlay');
        expect(overlay).toHaveAttribute('data-state', 'closed');
        expect(screen.getByText('Delete Node')).toBeInTheDocument();
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Yes, Delete' })).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(document.body.querySelector('.modal-overlay')).toBeNull();
    });
});

describe('w2-client-core: Fix 8 shared utils localization & protocol', () => {
    it('localizes accessGeo countries, local IP labels, and carriers for en-US while keeping zh-CN defaults', () => {
        expect(normalizeCarrierLabel('电信', 'en-US')).toBe('China Telecom');
        expect(normalizeCarrierLabel('联通', 'en-US')).toBe('China Unicom');
        expect(normalizeCarrierLabel('移动', 'en-US')).toBe('China Mobile');
        expect(normalizeCarrierLabel('电信')).toBe('中国电信');

        expect(resolveAccessCountry({ ipLocation: '内网/本地' }, 'en-US')).toEqual({
            name: 'Local / LAN',
            code: '',
            local: true,
        });
        expect(resolveAccessCountry({ ipLocation: '', cfCountry: 'us' }, 'en-US')).toEqual({
            name: 'United States',
            code: 'US',
            local: false,
        });
        expect(resolveAccessGeoDisplay({ ipLocation: '内网/本地' }, 'en-US')).toEqual({
            location: 'Local / LAN',
            carrier: '',
        });
        expect(resolveAccessGeoDisplay({ ipLocation: '', cfCountry: 'US', ipCarrier: '电信' }, 'en-US')).toEqual({
            location: 'United States',
            carrier: 'China Telecom',
        });
    });

    it('resolves auth/auth_str/password for password protocols and uuid/id for UUID protocols', () => {
        expect(getClientIdentifier({ auth: 'hy2-auth', password: 'fallback-pw' }, 'hysteria2')).toBe('hy2-auth');
        expect(getClientIdentifier({ auth_str: 'hy1-auth', password: 'fallback-pw' }, 'hysteria')).toBe('hy1-auth');
        expect(getClientIdentifier({ password: 'tr-pw' }, 'trojan')).toBe('tr-pw');
        expect(getClientIdentifier({ uuid: 'tuic-uuid', id: 'legacy-id' }, 'tuic')).toBe('tuic-uuid');
        expect(getClientIdentifier({ id: 'vless-id' }, 'vless')).toBe('vless-id');
    });

    it('localizes Clash / Mihomo family label based on locale', () => {
        const zh = buildSubscriptionProfileBundle({ subscriptionUrl: 'https://sub.example.com/a' }, 'zh-CN');
        const en = buildSubscriptionProfileBundle({ subscriptionUrl: 'https://sub.example.com/a' }, 'en-US');

        expect(zh.importActions.find((item) => item.key === 'clash-family')?.label).toBe('Clash / Mihomo 系列');
        expect(en.importActions.find((item) => item.key === 'clash-family')?.label).toBe('Clash / Mihomo');
        expect(zh.toolSites.find((item) => item.key === 'clash-family')?.label).toBe('Clash / Mihomo 系列');
        expect(en.toolSites.find((item) => item.key === 'clash-family')?.label).toBe('Clash / Mihomo');
    });
});

describe('w2-client-core: Fix 9 global CSS fixes', () => {
    it('keeps restrained-ui, polish, utilities, and flagship-console CSS fixes intact', () => {
        const stylesDir = path.resolve(__dirname, '../styles');
        const restrained = fs.readFileSync(path.join(stylesDir, 'restrained-ui.css'), 'utf8');
        const polish = fs.readFileSync(path.join(stylesDir, 'polish.css'), 'utf8');
        const utilities = fs.readFileSync(path.join(stylesDir, 'utilities.css'), 'utf8');
        const flagship = fs.readFileSync(path.join(stylesDir, 'flagship-console.css'), 'utf8');

        expect(restrained).toMatch(/@keyframes restrained-page-enter\s*\{[\s\S]*to\s*\{\s*opacity:\s*1;\s*transform:\s*none;\s*\}/);
        expect(restrained).toContain('bottom: calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 10px);');
        expect(restrained).toMatch(/\.settings-save-dock\s*\{[\s\S]*z-index:\s*calc\(var\(--z-sticky,\s*100\)\s*\+\s*10\);/);

        expect(polish).not.toContain('var(--bg-sidebar)');
        expect(polish).toContain('var(--rail-bg, var(--bg-card))');

        expect(utilities).toContain('.bg-danger\\/10');
        expect(utilities).toContain('.border-danger\\/25');
        expect(utilities).toContain('.leading-snug');

        expect(flagship).toMatch(/\.command-palette-item\.is-highlighted \.command-palette-item-icon\s*\{[\s\S]*color:\s*var\(--text-on-accent\);/);
    });
});
