import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../../test/render';
import Servers from './Servers';
import ServerDetail from './ServerDetail';
import SubscriptionHostsPanel from './panelFeatures/SubscriptionHostsPanel';
import UsersHub from '../Users/UsersHub';
import UserDetail from '../Users/UserDetail';
import AuditCenter from '../Audit/AuditCenter';
import ClientGeoDistributionCard from '../Audit/ClientGeoDistributionCard';
import SystemSettings, { SettingsToggleCard } from '../System/SystemSettings';
import TwoFactorPanel from '../Account/TwoFactorPanel';
import Logs from '../Logs/Logs';
import Tasks from '../Tasks/Tasks';
import Tools from '../Tools/Tools';
import Capabilities from '../Capabilities/Capabilities';

const {
    confirmMock,
    copyToClipboardMock,
    invalidateServerPanelDataCacheMock,
    writeSessionSnapshotSpy,
    resolveAccessGeoDisplaySpy,
    normalizeCarrierLabelSpy,
    fetchServersMock,
    deleteServerMock,
    testConnectionMock,
    authState,
    serverState,
} = vi.hoisted(() => ({
    confirmMock: vi.fn(),
    copyToClipboardMock: vi.fn(),
    invalidateServerPanelDataCacheMock: vi.fn(),
    writeSessionSnapshotSpy: vi.fn(),
    resolveAccessGeoDisplaySpy: vi.fn(),
    normalizeCarrierLabelSpy: vi.fn(),
    fetchServersMock: vi.fn(),
    deleteServerMock: vi.fn(),
    testConnectionMock: vi.fn(),
    authState: {
        isAuthenticated: true,
        loading: false,
        user: {
            id: 'admin-1',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin',
            enabled: true,
        },
        token: 'test-token',
        login: vi.fn(),
        loginTwoFactor: vi.fn(),
        logout: vi.fn(),
        register: vi.fn(),
        verifyEmail: vi.fn(),
        resendCode: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
        refreshAuth: vi.fn(),
        patchUser: vi.fn(),
    },
    serverState: {
        servers: [] as any[],
        activeServerId: 'server-1',
        activeServer: null as any,
        loading: false,
        fetchServers: vi.fn(),
        selectServer: vi.fn(),
        checkServerHealth: vi.fn(),
        testConnection: vi.fn(),
        addServer: vi.fn(),
        updateServer: vi.fn(),
        deleteServer: vi.fn(),
        setActiveServerId: vi.fn(),
    },
}));

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('react-hot-toast', () => ({
    default: {
        success: vi.fn(),
        error: vi.fn(),
        loading: vi.fn(),
        dismiss: vi.fn(),
        custom: vi.fn(),
    },
}));

vi.mock('../../contexts/ConfirmContext', () => ({
    useConfirm: () => confirmMock,
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => authState,
    useOptionalAuth: () => authState,
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: () => serverState,
    useOptionalServer: () => serverState,
}));

vi.mock('../../contexts/NotificationContext', () => ({
    NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useNotifications: () => ({
        notifications: [],
        unreadCount: 0,
        loading: false,
        canMarkRead: true,
        markRead: vi.fn(),
        markAllRead: vi.fn(),
        ensureExpandedNotifications: vi.fn(),
        refresh: vi.fn(),
    }),
}));

vi.mock('../../utils/format', async () => {
    const actual = await vi.importActual<typeof import('../../utils/format')>('../../utils/format');
    return {
        ...actual,
        copyToClipboard: (text: string) => copyToClipboardMock(text),
    };
});

vi.mock('../../utils/serverPanelDataCache', async () => {
    const actual = await vi.importActual<typeof import('../../utils/serverPanelDataCache')>('../../utils/serverPanelDataCache');
    return {
        ...actual,
        invalidateServerPanelDataCache: () => invalidateServerPanelDataCacheMock(),
    };
});

vi.mock('../../utils/sessionSnapshot', async () => {
    const actual = await vi.importActual<typeof import('../../utils/sessionSnapshot')>('../../utils/sessionSnapshot');
    return {
        ...actual,
        writeSessionSnapshot: (key: string, value: unknown) => {
            writeSessionSnapshotSpy(key, value);
            return actual.writeSessionSnapshot(key, value);
        },
    };
});

vi.mock('../../utils/accessGeo', async () => {
    const actual = await vi.importActual<typeof import('../../utils/accessGeo')>('../../utils/accessGeo');
    return {
        ...actual,
        resolveAccessGeoDisplay: (item: any, locale?: string) => {
            resolveAccessGeoDisplaySpy(item, locale);
            return actual.resolveAccessGeoDisplay(item);
        },
        normalizeCarrierLabel: (value?: string | null, locale?: string) => {
            normalizeCarrierLabelSpy(value, locale);
            return actual.normalizeCarrierLabel(value);
        },
    };
});

function createDeferred<T = any>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function dispatchCancelablePageRefresh(): CustomEvent {
    let event!: CustomEvent;
    act(() => {
        event = new CustomEvent('nms:page-refresh', { cancelable: true });
        window.dispatchEvent(event);
    });
    return event;
}

describe('Wave 2 client pages audit fixes', () => {
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        confirmMock.mockResolvedValue(true);
        copyToClipboardMock.mockResolvedValue(true);
        fetchServersMock.mockResolvedValue([]);
        deleteServerMock.mockResolvedValue({ success: true });
        testConnectionMock.mockResolvedValue({ success: true });

        serverState.servers = [
            { id: 's1', name: 'Alpha Node', url: 'https://alpha.example.com', group: 'prod', panelType: '3xui' },
            { id: 's2', name: 'Beta Node', url: 'https://beta.example.com', group: 'staging', panelType: '3xui' },
        ];
        serverState.activeServerId = 's1';
        serverState.activeServer = serverState.servers[0];
        serverState.loading = false;
        serverState.fetchServers = fetchServersMock;
        serverState.deleteServer = deleteServerMock;
        serverState.testConnection = testConnectionMock;
        serverState.checkServerHealth = vi.fn().mockResolvedValue({ success: true });

        vi.mocked(api.get).mockResolvedValue({ data: { success: true, obj: {} } });
        vi.mocked(api.post).mockResolvedValue({ data: { success: true, obj: {} } });
        vi.mocked(api.put).mockResolvedValue({ data: { success: true, obj: {} } });
        vi.mocked(api.delete).mockResolvedValue({ data: { success: true, obj: {} } });
    });

    afterEach(() => {
        if (originalClipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
        } else {
            delete (navigator as any).clipboard;
        }
    });

    it('Servers prunes hidden selections when filtering, invalidates panel cache, force-refreshes on bulk delete, and localizes ping-all error', async () => {
        const user = userEvent.setup();
        vi.mocked(api.get).mockImplementation((url) => {
            if (url === '/servers/telemetry') {
                return Promise.resolve({ data: { obj: { byServerId: {} } } });
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });
        vi.mocked(api.post).mockImplementation((url) => {
            if (url === '/servers/ping-all') {
                return Promise.reject(new Error(''));
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });

        renderWithRouter(<Servers />);
        await screen.findByText('Alpha Node');

        const checkboxes = screen.getAllByRole('checkbox');
        const alphaCheckbox = checkboxes.find((cb) => cb.getAttribute('aria-label')?.includes('Alpha Node')) || checkboxes[1];
        const betaCheckbox = checkboxes.find((cb) => cb.getAttribute('aria-label')?.includes('Beta Node')) || checkboxes[2];
        await user.click(alphaCheckbox);
        await user.click(betaCheckbox);

        const searchInput = screen.getByRole('textbox', { name: /搜索名称/i });
        await user.type(searchInput, 'Alpha');

        await waitFor(() => {
            expect(screen.queryByText('Beta Node')).not.toBeInTheDocument();
        });

        // Bulk delete should only target the visible Alpha Node ('s1'), never hidden Beta Node ('s2')
        const deleteBtn = screen.getByRole('button', { name: /批量删除|Delete Selected/i });
        await user.click(deleteBtn);

        await waitFor(() => {
            expect(vi.mocked(api.delete)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/servers/s1');
            expect(vi.mocked(api.delete)).not.toHaveBeenCalledWith('/servers/s2');
            expect(invalidateServerPanelDataCacheMock).toHaveBeenCalled();
            expect(fetchServersMock).toHaveBeenCalledWith({ force: true });
        });

        // Ping-all fallback uses localized text in zh-CN
        await user.clear(searchInput);
        const pingAllBtn = screen.getByRole('button', { name: /一键测速|Ping All/i });
        await user.click(pingAllBtn);
        await waitFor(() => {
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith('一键测速失败');
        });
    });

    it('ServerDetail uses extractInboundClients for s-ui/tuic/socks counts, exposes tablist ARIA roles, and calls preventDefault on page-refresh', async () => {
        const user = userEvent.setup();
        serverState.servers = [
            { id: 'server-1', name: 'SUI Edge', url: 'https://sui.example.com', panelType: 'sui' },
        ];
        serverState.activeServerId = 'server-1';
        serverState.activeServer = serverState.servers[0];

        vi.mocked(api.get).mockImplementation((url) => {
            if (url === '/servers/server-1/snapshot') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            server: { id: 'server-1', name: 'SUI Edge', url: 'https://sui.example.com', panelType: 'sui' },
                            status: { cpu: 12, mem: { current: 100, total: 1000 }, uptime: 3600 },
                            inbounds: [
                                {
                                    id: 10,
                                    remark: 'TUIC-Main',
                                    protocol: 'tuic',
                                    port: 8443,
                                    enable: true,
                                    up: 100,
                                    down: 200,
                                    settings: JSON.stringify({ users: [{ name: 'u1' }, { name: 'u2' }] }),
                                },
                                {
                                    id: 11,
                                    remark: 'SOCKS-Main',
                                    protocol: 'socks',
                                    port: 1080,
                                    enable: true,
                                    up: 50,
                                    down: 50,
                                    settings: JSON.stringify({ accounts: [{ user: 's1' }] }),
                                },
                            ],
                            onlines: [],
                            lastOnline: {},
                        },
                    },
                });
            }
            if (url === '/audit/events') {
                return Promise.resolve({ data: { obj: { items: [] } } });
            }
            return Promise.resolve({ data: { obj: {} } });
        });

        renderWithRouter(
            <Routes>
                <Route path="/servers/:serverId" element={<ServerDetail />} />
            </Routes>,
            { route: '/servers/server-1' },
        );

        await screen.findByRole('heading', { name: /SUI Edge/ });

        const tablist = screen.getByRole('tablist');
        expect(tablist).toBeInTheDocument();
        const overviewTab = within(tablist).getByRole('tab', { name: '概览' });
        const inboundsTab = within(tablist).getByRole('tab', { name: '入站列表' });
        expect(overviewTab).toHaveAttribute('aria-selected', 'true');
        expect(inboundsTab).toHaveAttribute('aria-selected', 'false');

        // Total client count across TUIC (2) + SOCKS (1) settles to 3, not 0
        expect(await screen.findByText('3')).toBeInTheDocument();

        await user.click(inboundsTab);
        expect(inboundsTab).toHaveAttribute('aria-selected', 'true');
        const tuicRow = (await screen.findByText('TUIC-Main')).closest('tr');
        const socksRow = screen.getByText('SOCKS-Main').closest('tr');
        expect(tuicRow?.querySelector('.server-detail-clients-cell')).toHaveTextContent('2');
        expect(socksRow?.querySelector('.server-detail-clients-cell')).toHaveTextContent('1');

        const refreshEvent = dispatchCancelablePageRefresh();
        expect(refreshEvent.defaultPrevented).toBe(true);
    });

    it('SubscriptionHostsPanel initializes disclosure state per row (including alpn) and keeps details open while clearing input', async () => {
        const user = userEvent.setup();
        vi.mocked(api.get).mockImplementation((url) => {
            if (String(url).includes('/hosts/list')) {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                groupId: 'g-alpn',
                                inboundIds: [1],
                                hosts: ['alpn.example.com'],
                                remark: 'Host With ALPN',
                                security: 'same',
                                alpn: ['h2'],
                            },
                            {
                                groupId: 'g-plain',
                                inboundIds: [1],
                                hosts: ['plain.example.com'],
                                remark: 'Host Plain',
                                security: 'same',
                            },
                        ],
                    },
                });
            }
            return Promise.resolve({ data: { obj: [] } });
        });

        renderWithRouter(
            <SubscriptionHostsPanel
                serverId="server-1"
                canManage={true}
                inbounds={[{ id: 1, remark: 'VLESS-443', protocol: 'vless', port: 443 }]}
            />,
        );

        await screen.findByText('Host With ALPN');

        // Open row with ALPN override: disclosure starts open
        const editButtons = screen.getAllByRole('button', { name: /编辑|Edit/i });
        await user.click(editButtons[0]);

        const detailsEl = document.querySelector('details.pf-disclosure') as HTMLDetailsElement;
        expect(detailsEl).toBeTruthy();
        expect(detailsEl.open).toBe(true);

        // Clearing ALPN input mid-typing must NOT collapse <details>
        const alpnInput = document.querySelector('#pf-host-alpn') as HTMLInputElement;
        await user.clear(alpnInput);
        expect(detailsEl.open).toBe(true);

        // Close modal and open Host Plain: disclosure starts closed
        await user.click(screen.getByRole('button', { name: /取消|Cancel/i }));
        const nextEditButtons = screen.getAllByRole('button', { name: /编辑|Edit/i });
        await user.click(nextEditButtons[1]);

        const detailsPlain = document.querySelector('details.pf-disclosure') as HTMLDetailsElement;
        expect(detailsPlain.open).toBe(false);
    });

    it('UsersHub renders unique DOM ids for each Provision modal inbound checkbox', async () => {
        const user = userEvent.setup();
        serverState.servers = [
            { id: 's1', name: 'Node One', url: 'https://s1.example.com', panelType: '3xui' },
        ];
        vi.mocked(api.get).mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'u1',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                            enabled: true,
                            emailVerified: true,
                            createdAt: '2026-03-11T10:00:00.000Z',
                        }],
                    },
                });
            }
            if (String(url).includes('/system/panel/snapshot')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [{
                                serverId: 's1',
                                name: 'Node One',
                                server: { id: 's1', name: 'Node One' },
                                inbounds: [
                                    { id: 101, remark: 'Inbound One', protocol: 'vless', port: 443, expiryTime: 0, settings: JSON.stringify({ clients: [] }) },
                                    { id: 102, remark: 'Inbound Two', protocol: 'vmess', port: 8443, expiryTime: 0, settings: JSON.stringify({ clients: [] }) },
                                ],
                                onlines: [],
                            }],
                        },
                    },
                });
            }
            if (url === '/panel/s1/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { id: 101, remark: 'Inbound One', protocol: 'vless', port: 443, expiryTime: 0, settings: JSON.stringify({ clients: [] }) },
                            { id: 102, remark: 'Inbound Two', protocol: 'vmess', port: 8443, expiryTime: 0, settings: JSON.stringify({ clients: [] }) },
                        ],
                    },
                });
            }
            return Promise.resolve({ data: { obj: { items: [] } } });
        });

        renderWithRouter(<UsersHub />);

        const provisionBtn = await screen.findByRole('button', { name: '开通订阅' });
        await user.click(provisionBtn);

        await screen.findByText('Inbound One');
        const checkboxes = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[id^="users-hub-users-provision-inbound-"]'),
        );
        expect(checkboxes.length).toBe(2);
        const ids = checkboxes.map((cb) => cb.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain('users-hub-users-provision-inbound-label');
    });

    it('UserDetail exposes tablist ARIA roles, prevents default on page-refresh, and passes locale to resolveAccessGeoDisplay', async () => {
        const user = userEvent.setup();
        localStorage.setItem('nms_locale', 'en-US');

        vi.mocked(api.get).mockImplementation((url) => {
            if (url === '/users/user-1/detail') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            user: {
                                id: 'user-1',
                                username: 'alice',
                                email: 'alice@example.com',
                                subscriptionEmail: 'alice@example.com',
                                emailVerified: true,
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-11T10:00:00.000Z',
                                lastLoginAt: '2026-03-11T11:00:00.000Z',
                            },
                            policy: null,
                            recentAudit: { items: [], total: 0 },
                            subscriptionAccess: {
                                items: [
                                    {
                                        id: 'acc-1',
                                        ts: '2026-03-11T12:00:00.000Z',
                                        ip: '203.0.113.8',
                                        ipLocation: '中国 浙江 杭州',
                                        ipCarrier: '中国电信',
                                        outcome: 'success',
                                        mode: 'sub',
                                        format: 'v2rayn',
                                        tokenId: 'tok-1',
                                    },
                                ],
                                total: 1,
                            },
                            tokens: [],
                        },
                    },
                });
            }
            if (String(url).includes('/system/panel/snapshot')) {
                return Promise.resolve({ data: { obj: { servers: [] } } });
            }
            return Promise.resolve({ data: { obj: {} } });
        });

        renderWithRouter(
            <Routes>
                <Route path="/clients/:userId" element={<UserDetail />} />
            </Routes>,
            { route: '/clients/user-1' },
        );

        await screen.findByRole('heading', { name: /alice/ });
        const tablist = screen.getByRole('tablist');
        const activityTab = within(tablist).getByRole('tab', { name: /Activity/i });
        expect(activityTab).toHaveAttribute('aria-selected', 'false');

        await user.click(activityTab);
        expect(activityTab).toHaveAttribute('aria-selected', 'true');

        await waitFor(() => {
            expect(resolveAccessGeoDisplaySpy).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'access-acc-1' }),
                'en-US',
            );
        });

        const refreshEvent = dispatchCancelablePageRefresh();
        expect(refreshEvent.defaultPrevented).toBe(true);
    });

    it('AuditCenter drops stale traffic overview responses, forwards locale to resolveAccessGeoDisplay, and prevents default on page-refresh', async () => {
        const user = userEvent.setup();
        localStorage.setItem('nms_locale', 'en-US');
        const firstOverview = createDeferred<any>();
        const secondOverview = createDeferred<any>();
        let overviewCall = 0;

        vi.mocked(api.get).mockImplementation((url) => {
            const path = String(url);
            if (path.startsWith('/traffic/overview')) {
                overviewCall += 1;
                return overviewCall === 1 ? firstOverview.promise : secondOverview.promise;
            }
            if (path.startsWith('/traffic/')) {
                return Promise.resolve({ data: { obj: { points: [], granularity: 'hour' } } });
            }
            if (path.includes('access')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [{
                                id: 'sub-1',
                                ts: '2026-03-11T12:00:00.000Z',
                                username: 'alice',
                                email: 'alice@example.com',
                                status: 'ok',
                                ip: '203.0.113.8',
                                ipLocation: '中国 广东 深圳',
                                ipCarrier: '中国联通',
                            }],
                            total: 1,
                            page: 1,
                            totalPages: 1,
                            statusBreakdown: {},
                            summary: { total: 1, ok: 1, denied: 0 },
                        },
                    },
                });
            }
            return Promise.resolve({ data: { obj: { items: [], total: 0, page: 1, totalPages: 1 } } });
        });

        renderWithRouter(<AuditCenter />, { route: '/audit?tab=traffic&window=24h' });

        await waitFor(() => {
            expect(overviewCall).toBe(1);
        });

        const refreshEvent = dispatchCancelablePageRefresh();
        expect(refreshEvent.defaultPrevented).toBe(true);

        await waitFor(() => {
            expect(overviewCall).toBe(2);
        });

        // Resolve newer request #2 first with two users so we can test selection retention across refresh
        await act(async () => {
            secondOverview.resolve({
                data: {
                    obj: {
                        totals: { totalBytes: 5000, upBytes: 2000, downBytes: 3000 },
                        topUsers: [
                            { email: 'fresh-user@example.com', username: 'FreshUser', totalBytes: 5000, upBytes: 2000, downBytes: 3000 },
                            { email: 'second-user@example.com', username: 'SecondUser', totalBytes: 2500, upBytes: 1000, downBytes: 1500 },
                        ],
                        topServers: [{ serverId: 's1', name: 'Alpha Node', totalBytes: 5000, upBytes: 2000, downBytes: 3000 }],
                    },
                },
            });
        });

        expect((await screen.findAllByText(/fresh-user@example.com|FreshUser/)).length).toBeGreaterThan(0);

        // Stale request #1 resolves afterwards and must NOT overwrite newer data
        await act(async () => {
            firstOverview.resolve({
                data: {
                    obj: {
                        totals: { totalBytes: 100, upBytes: 50, downBytes: 50 },
                        topUsers: [{ email: 'stale-user@example.com', username: 'StaleUser', totalBytes: 100, upBytes: 50, downBytes: 50 }],
                        topServers: [{ serverId: 's2', name: 'Stale Node', totalBytes: 100, upBytes: 50, downBytes: 50 }],
                    },
                },
            });
        });

        expect(screen.queryByText(/stale-user@example.com/)).not.toBeInTheDocument();
        expect(screen.getAllByText(/fresh-user@example.com|FreshUser/).length).toBeGreaterThan(0);

        // Selecting SecondUser before a subsequent refresh resolves must keep SecondUser selected
        const userSelect = screen.getByRole('combobox', { name: 'Select a user' }) as HTMLSelectElement;
        await user.selectOptions(userSelect, 'second-user@example.com');
        expect(userSelect.value).toBe('second-user@example.com');

        const thirdOverview = createDeferred<any>();
        const prevImpl = vi.mocked(api.get).getMockImplementation();
        vi.mocked(api.get).mockImplementation((url, config) => {
            if (String(url).startsWith('/traffic/overview')) {
                return thirdOverview.promise;
            }
            return prevImpl ? prevImpl(url, config) : Promise.resolve({ data: { obj: { items: [], total: 0, page: 1, totalPages: 1 } } });
        });
        dispatchCancelablePageRefresh();
        await act(async () => {
            thirdOverview.resolve({
                data: {
                    obj: {
                        totals: { totalBytes: 6000, upBytes: 2500, downBytes: 3500 },
                        topUsers: [
                            { email: 'fresh-user@example.com', username: 'FreshUser', totalBytes: 6000, upBytes: 2500, downBytes: 3500 },
                            { email: 'second-user@example.com', username: 'SecondUser', totalBytes: 2500, upBytes: 1000, downBytes: 1500 },
                        ],
                        topServers: [{ serverId: 's1', name: 'Alpha Node', totalBytes: 6000, upBytes: 2500, downBytes: 3500 }],
                    },
                },
            });
        });
        expect(userSelect.value).toBe('second-user@example.com');

        // Subscriptions tab passes locale to resolveAccessGeoDisplay
        const subTab = screen.getByRole('tab', { name: /Subscription Access/i });
        await user.click(subTab);

        await waitFor(() => {
            expect(resolveAccessGeoDisplaySpy).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'sub-1' }),
                'en-US',
            );
        });
    });

    it('ClientGeoDistributionCard passes locale to normalizeCarrierLabel', () => {
        renderWithRouter(
            <ClientGeoDistributionCard
                items={[{ id: '1', ip: '203.0.113.8', cfCountry: 'CN', ipCarrier: '中国电信' }]}
                locale="en-US"
            />,
        );

        expect(normalizeCarrierLabelSpy).toHaveBeenCalledWith('中国电信', 'en-US');
    });

    it('SystemSettings renders non-empty fallback toggle badges and checks copyToClipboard return before showing success toast', async () => {
        const user = userEvent.setup();
        renderWithRouter(
            <>
                <SettingsToggleCard checked={true} onChange={vi.fn()} label="Active Toggle" />
                <SettingsToggleCard checked={false} onChange={vi.fn()} label="Inactive Toggle" />
            </>,
        );

        const renderedBadges = Array.from(document.querySelectorAll('.settings-toggle-badge'));
        expect(renderedBadges).toHaveLength(2);
        expect(renderedBadges[0]).toHaveTextContent('已启用');
        expect(renderedBadges[1]).toHaveTextContent('已关闭');

        vi.mocked(api.get).mockImplementation((url) => {
            if (url === '/system/settings') {
                return Promise.resolve({
                    data: {
                        obj: {
                            site: {},
                            registration: { enabled: true, inviteOnlyEnabled: false },
                            subscription: {},
                            security: {},
                            audit: {},
                            auditIpGeo: {},
                            telegram: {},
                            webhook: {},
                        },
                    },
                });
            }
            if (url === '/system/invite-codes') {
                return Promise.resolve({ data: { obj: [] } });
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });
        vi.mocked(api.post).mockImplementation((url) => {
            if (url === '/system/invite-codes') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: { codes: ['INVITE-111', 'INVITE-222'], count: 2 },
                    },
                });
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });

        renderWithRouter(<SystemSettings />, { route: '/settings?tab=access' });

        const generateBtn = await screen.findByRole('button', { name: '生成邀请码' });
        await user.click(generateBtn);

        const latestCard = await waitFor(() => {
            const el = document.querySelector('.settings-invite-workbench-latest');
            expect(el).toBeTruthy();
            return el as HTMLElement;
        });

        vi.mocked(toast.success).mockClear();
        vi.mocked(toast.error).mockClear();
        copyToClipboardMock.mockResolvedValueOnce(false);

        const copyBtn = within(latestCard).getByRole('button');
        await user.click(copyBtn);

        await waitFor(() => {
            expect(vi.mocked(toast.error)).toHaveBeenCalled();
            expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
        });
    });

    it('TwoFactorPanel uses shared copyToClipboard helper without requiring navigator.clipboard', async () => {
        const user = userEvent.setup();
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined,
            configurable: true,
            writable: true,
        });

        vi.mocked(api.post).mockImplementation((url) => {
            if (String(url).includes('/auth/2fa/setup')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            secret: 'SECRET-BASE32',
                            otpauthUrl: 'otpauth://totp/NMS:admin?secret=SECRET-BASE32',
                        },
                    },
                });
            }
            return Promise.resolve({ data: { success: true, obj: {} } });
        });

        renderWithRouter(
            <TwoFactorPanel
                twoFactorEnabled={false}
                statusLoading={false}
                onUpdated={vi.fn()}
            />,
        );

        const enableBtn = screen.getByRole('button', { name: /开启|启用|Enable/i });
        await user.click(enableBtn);

        const copyBtns = await screen.findAllByRole('button', { name: /复制|Copy/i });
        await user.click(copyBtns[0]);

        await waitFor(() => {
            expect(copyToClipboardMock).toHaveBeenCalledWith('SECRET-BASE32');
            expect(vi.mocked(toast.success)).toHaveBeenCalled();
        });
    });

    it('Logs, Tasks, Tools, and Capabilities skip empty initial snapshot writes before hydration and call preventDefault on page-refresh', async () => {
        serverState.servers = [{ id: 's1', name: 'Alpha Node', url: 'https://alpha.example.com', panelType: '3xui' }];
        serverState.activeServerId = 's1';
        serverState.activeServer = serverState.servers[0];

        // Keep initial API calls pending to simulate initial unhydrated mount
        vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));

        renderWithRouter(<Logs />);
        expect(writeSessionSnapshotSpy).not.toHaveBeenCalled();
        expect(dispatchCancelablePageRefresh().defaultPrevented).toBe(true);

        writeSessionSnapshotSpy.mockClear();
        renderWithRouter(<Tasks />);
        expect(writeSessionSnapshotSpy).not.toHaveBeenCalled();
        expect(dispatchCancelablePageRefresh().defaultPrevented).toBe(true);

        writeSessionSnapshotSpy.mockClear();
        renderWithRouter(<Tools />);
        expect(writeSessionSnapshotSpy).not.toHaveBeenCalled();
        expect(dispatchCancelablePageRefresh().defaultPrevented).toBe(true);

        writeSessionSnapshotSpy.mockClear();
        renderWithRouter(<Capabilities />);
        expect(writeSessionSnapshotSpy).not.toHaveBeenCalled();
        expect(dispatchCancelablePageRefresh().defaultPrevented).toBe(true);

        // Once live fetch hydrates, snapshot writes resume with hydrated data
        writeSessionSnapshotSpy.mockClear();
        vi.mocked(api.get).mockImplementation((url) => {
            if (String(url).startsWith('/jobs')) {
                return Promise.resolve({ data: { obj: { items: [{ id: 'job-1', type: 'sync', status: 'completed' }] } } });
            }
            if (url === '/servers/s1/logs') {
                return Promise.resolve({ data: { obj: { lines: ['hydrated line'] } } });
            }
            if (url === '/capabilities/s1') {
                return Promise.resolve({ data: { obj: { panel: { name: '3x-ui' }, tools: {} } } });
            }
            return Promise.resolve({ data: { obj: {} } });
        });

        renderWithRouter(<Tasks />);
        await waitFor(() => {
            expect(writeSessionSnapshotSpy).toHaveBeenCalledWith(
                expect.stringContaining('tasks'),
                expect.objectContaining({ tasks: [expect.objectContaining({ id: 'job-1' })] }),
            );
        });

        writeSessionSnapshotSpy.mockClear();
        renderWithRouter(<Logs />);
        await waitFor(() => {
            expect(writeSessionSnapshotSpy).toHaveBeenCalledWith(
                expect.stringContaining('logs'),
                expect.objectContaining({ logs: [expect.objectContaining({ line: 'hydrated line' })] }),
            );
        });

        writeSessionSnapshotSpy.mockClear();
        renderWithRouter(<Capabilities />);
        await waitFor(() => {
            expect(writeSessionSnapshotSpy).toHaveBeenCalledWith(
                expect.stringContaining('capabilities'),
                expect.objectContaining({ data: expect.objectContaining({ panel: { name: '3x-ui' } }) }),
            );
        });
    });
});
