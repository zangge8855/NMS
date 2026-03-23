import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Dashboard from './Dashboard.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import { invalidateManagedUsersCache } from '../../utils/managedUsersCache.js';

let webSocketState = {
    status: 'disconnected',
    lastMessage: null,
};

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => ({
        token: '',
    }),
}));

vi.mock('../../hooks/useWebSocket.js', () => ({
    default: () => webSocketState,
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title, subtitle, children }) => (
        <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
            {children}
        </div>
    ),
}));

vi.mock('recharts', async () => {
    const actual = await vi.importActual('recharts');
    return {
        ...actual,
        ResponsiveContainer: ({ children }) => (
            <div data-testid="responsive-container" style={{ width: 640, height: 280 }}>
                {children}
            </div>
        ),
    };
});

function mockMatchMedia(matches = false) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

function matchTrafficOverviewRequest(url, config, windows = {}) {
    if (url !== '/traffic/overview') return null;
    const dayTotals = windows.day || { upBytes: 0, downBytes: 0 };
    const weekTotals = windows.week || dayTotals;
    const monthTotals = windows.month || dayTotals;
    const windowKeys = String(config?.params?.windows || '')
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    const days = Number(config?.params?.days || 0);
    const totals = days === 7
        ? weekTotals
        : days === 30
            ? monthTotals
            : dayTotals;
    return Promise.resolve({
        data: {
            obj: {
                totals,
                windows: {
                    ...(windowKeys.includes('today') ? { today: { totals: dayTotals } } : {}),
                    ...(windowKeys.includes('7') ? { '7': { totals: weekTotals } } : {}),
                    ...(windowKeys.includes('30') ? { '30': { totals: monthTotals } } : {}),
                },
            },
        },
    });
}

describe('Dashboard', () => {
    beforeEach(() => {
        invalidateManagedUsersCache();
        localStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
        mockMatchMedia(false);
        webSocketState = {
            status: 'disconnected',
            lastMessage: null,
        };
        useServer.mockReturnValue({
            activeServerId: null,
            panelApi: vi.fn(),
            activeServer: null,
            servers: [],
        });
    });

    it('shows the empty-state call to action in Chinese by default', () => {
        renderWithRouter(<Dashboard />);

        expect(screen.getByRole('heading', { name: '仪表盘' })).toBeInTheDocument();
        expect(screen.getByText('请先添加并选择一台服务器')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '前往添加服务器' })).toBeInTheDocument();
    });

    it('renders the empty-state copy in English when locale is switched', () => {
        localStorage.setItem('nms_locale', 'en-US');

        renderWithRouter(<Dashboard />);

        expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
        expect(screen.getByText('Add and select a server first')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go to Servers' })).toBeInTheDocument();
    });

    it('uses managed-user traffic totals in the single-server traffic card', async () => {
        const panelApi = vi.fn((method, path) => {
            if (method === 'get' && path === '/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 12.5,
                            mem: { current: 256, total: 1024 },
                            uptime: 3600,
                        },
                    },
                });
            }
            if (method === 'get' && path === '/panel/api/server/cpuHistory/30') {
                return Promise.resolve({
                    data: {
                        obj: [10, 12, 9],
                    },
                });
            }
            if (method === 'get' && path === '/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'inbound-a',
                                protocol: 'vless',
                                enable: true,
                                remark: 'Node A Link',
                                settings: JSON.stringify({
                                    clients: [
                                        { id: 'uuid-a', email: 'alice@example.com' },
                                        { id: 'uuid-x', email: 'outsider@example.com' },
                                    ],
                                }),
                                clientStats: [
                                    { id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 },
                                    { id: 'uuid-x', email: 'outsider@example.com', up: 900, down: 1800 },
                                ],
                                up: 1000,
                                down: 2000,
                            },
                        ],
                    },
                });
            }
            if (method === 'post' && path === '/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [{ email: 'alice@example.com', id: 'uuid-a' }],
                    },
                });
            }
            throw new Error(`Unexpected panelApi call: ${method} ${path}`);
        });

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'user-a',
                                role: 'user',
                                username: 'Alice',
                                email: 'alice@example.com',
                                subscriptionEmail: 'alice@example.com',
                                enabled: true,
                            },
                        ],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        await waitFor(() => {
            expect(panelApi).toHaveBeenCalled();
        });

        const trafficCard = screen.getByText('总流量').closest('.dashboard-stat-card');
        if (!trafficCard) throw new Error('Missing single-server traffic card');
        expect(trafficCard.closest('.dashboard-stats-grid')).toBeTruthy();

        await waitFor(() => {
            expect(trafficCard).toHaveTextContent('300 B');
            expect(trafficCard).toHaveTextContent(/↑\s*100 B/);
            expect(trafficCard).toHaveTextContent(/↓\s*200 B/);
        });

        expect(trafficCard.querySelector('.dashboard-stat-card-value-text')).toBeTruthy();
    });

    it('shows a dedicated empty state when the selected node has no inbound rules', async () => {
        localStorage.setItem('nms_locale', 'en-US');

        const panelApi = vi.fn((method, path) => {
            if (method === 'get' && path === '/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 12.5,
                            mem: { current: 256, total: 1024 },
                            uptime: 3600,
                        },
                    },
                });
            }
            if (method === 'get' && path === '/panel/api/server/cpuHistory/30') {
                return Promise.resolve({
                    data: {
                        obj: [10, 12, 9],
                    },
                });
            }
            if (method === 'get' && path === '/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            if (method === 'post' && path === '/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected panelApi call: ${method} ${path}`);
        });

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        expect(await screen.findByText('No inbound rules yet')).toBeInTheDocument();
        expect(screen.getByText('This node does not have any inbound configuration to show yet')).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Remark' })).not.toBeInTheDocument();
    });

    it('counts online users by matched managed accounts instead of raw online sessions', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        });
        let serverAStatusCalls = 0;
        let serverBStatusCalls = 0;

        api.get.mockImplementation((url, config) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { id: 'user-a', role: 'user', username: 'Alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true },
                            { id: 'user-b', role: 'user', username: 'Bob', email: 'bob@example.com', subscriptionEmail: 'bob@example.com', enabled: false },
                        ],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/server/status') {
                serverAStatusCalls += 1;
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 12.5,
                            mem: { current: 256, total: 1024 },
                            uptime: 3600,
                            netTraffic: serverAStatusCalls > 1
                                ? { sent: 3000, recv: 6000 }
                                : { sent: 0, recv: 0 },
                        },
                    },
                });
            }
            if (url === '/panel/server-b/panel/api/server/status') {
                serverBStatusCalls += 1;
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 18.2,
                            mem: { current: 512, total: 2048 },
                            uptime: 7200,
                            netTraffic: serverBStatusCalls > 1
                                ? { sent: 6000, recv: 3000 }
                                : { sent: 0, recv: 0 },
                        },
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'inbound-a',
                                protocol: 'vless',
                                enable: true,
                                remark: '港口专线',
                                settings: JSON.stringify({
                                    clients: [
                                        { id: 'uuid-a', email: 'alice@example.com' },
                                        { id: 'uuid-x', email: 'outsider@example.com' },
                                    ],
                                }),
                                clientStats: [
                                    { id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 },
                                    { id: 'uuid-x', email: 'outsider@example.com', up: 900, down: 1800 },
                                ],
                                up: 1000,
                                down: 2000,
                            },
                        ],
                    },
                });
            }
            if (url === '/panel/server-b/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'inbound-b',
                                protocol: 'vless',
                                enable: true,
                                remark: '实验楼节点',
                                settings: JSON.stringify({
                                    clients: [
                                        { id: 'uuid-a', email: 'alice@example.com' },
                                        { id: 'uuid-y', email: 'outsider@example.com' },
                                    ],
                                }),
                                clientStats: [
                                    { id: 'uuid-a', email: 'alice@example.com', up: 120, down: 240 },
                                    { id: 'uuid-y', email: 'outsider@example.com', up: 990, down: 1980 },
                                ],
                                up: 1110,
                                down: 2220,
                            },
                        ],
                    },
                });
            }
            const trafficResponse = matchTrafficOverviewRequest(url, config, {
                day: { upBytes: 180, downBytes: 360 },
                week: { upBytes: 210, downBytes: 420 },
                month: { upBytes: 220, downBytes: 440 },
            });
            if (trafficResponse) return trafficResponse;
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { email: 'alice@example.com', id: 'uuid-a' },
                            { email: 'alice@example.com', id: 'uuid-a' },
                        ],
                    },
                });
            }
            if (url === '/panel/server-b/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { email: 'alice@example.com', id: 'uuid-a' },
                            { email: 'unknown@example.com', id: 'uuid-x' },
                        ],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        expect(await screen.findByText('已注册 2 · 在线会话 3')).toBeInTheDocument();
        expect(await screen.findByText('港口专线')).toBeInTheDocument();
        expect(screen.queryByText('集群概览')).not.toBeInTheDocument();

        const overviewCard = screen.getByText('入站 2 / 2 已启用').closest('[role="button"]');
        if (!overviewCard) throw new Error('Missing cluster overview card');
        await waitFor(() => {
            expect(overviewCard).toHaveTextContent('节点总计');
            expect(overviewCard).toHaveTextContent('2 / 2');
            expect(overviewCard).toHaveTextContent('入站 2 / 2 已启用');
        });

        const onlineCard = screen.getByText('总在线用户').closest('[role="button"]');
        if (!onlineCard) throw new Error('Missing online users card');
        await waitFor(() => {
            expect(onlineCard).toHaveTextContent('1');
        });

        fireEvent.click(screen.getByRole('button', { name: /自动 ON/ }));
        fireEvent.click(screen.getByRole('button', { name: /自动 OFF/ }));

        const throughputCard = screen.getByText('当前总吞吐').closest('[role="button"]');
        if (!throughputCard) throw new Error('Missing throughput card');
        await waitFor(() => {
            expect(throughputCard).not.toHaveTextContent('等待下一次采样');
            expect(throughputCard).toHaveTextContent(/\/s/);
        });

        const weekTrafficCard = screen.getByText('周使用流量').closest('[role="button"]');
        if (!weekTrafficCard) throw new Error('Missing weekly traffic card');
        await waitFor(() => {
            expect(weekTrafficCard).toHaveTextContent('630 B');
            expect(weekTrafficCard).toHaveTextContent(/↑\s*210 B/);
            expect(weekTrafficCard).toHaveTextContent(/↓\s*420 B/);
        });

        const trafficCard = screen.getByText('月使用流量').closest('[role="button"]');
        if (!trafficCard) throw new Error('Missing monthly traffic card');
        await waitFor(() => {
            expect(trafficCard).toHaveTextContent('660 B');
            expect(trafficCard).toHaveTextContent(/↑\s*220 B/);
            expect(trafficCard).toHaveTextContent(/↓\s*440 B/);
        });

        const todayTrafficCard = screen.getByText('今日流量').closest('[role="button"]');
        if (!todayTrafficCard) throw new Error('Missing today traffic card');
        await waitFor(() => {
            expect(todayTrafficCard).toHaveTextContent('540 B');
            expect(todayTrafficCard).toHaveTextContent(/↑\s*180 B/);
            expect(todayTrafficCard).toHaveTextContent(/↓\s*360 B/);
        });

        const nodeATile = screen.getByText('Node A').closest('.node-health-tile');
        if (!nodeATile) throw new Error('Missing Node A health tile');
        expect(nodeATile).toHaveTextContent('300 B');

        fireEvent.click(onlineCard);

        expect(await screen.findByText('在线用户明细')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByText('unknown@example.com')).not.toBeInTheDocument();
    });

    it('keeps weekly and monthly traffic on loading placeholders until managed-user totals are ready', async () => {
        let resolveInbounds;
        const delayedInbounds = new Promise((resolve) => {
            resolveInbounds = resolve;
        });

        webSocketState = {
            status: 'connected',
            lastMessage: {
                type: 'cluster_status',
                data: {
                    serverCount: 1,
                    onlineServers: 1,
                    totalOnline: 9,
                    totalUp: 987654,
                    totalDown: 123456,
                    totalInbounds: 1,
                    activeInbounds: 1,
                    servers: {
                        'server-a': {
                            name: 'Node A',
                            online: true,
                            health: 'healthy',
                            reasonCode: 'none',
                            reasonMessage: '',
                            status: {
                                cpu: 8,
                                mem: { current: 128, total: 1024 },
                                uptime: 3600,
                                xray: {},
                                netTraffic: {},
                            },
                            inboundCount: 1,
                            activeInbounds: 1,
                            up: 987654,
                            down: 123456,
                            onlineCount: 9,
                            onlineUsers: [],
                        },
                    },
                },
            },
        };

        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url, config) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'user-a',
                                role: 'user',
                                username: 'Alice',
                                email: 'alice@example.com',
                                subscriptionEmail: 'alice@example.com',
                                enabled: true,
                            },
                        ],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return delayedInbounds;
            }
            const trafficResponse = matchTrafficOverviewRequest(url, config, {
                day: { upBytes: 50, downBytes: 100 },
                week: { upBytes: 70, downBytes: 140 },
                month: { upBytes: 90, downBytes: 180 },
            });
            if (trafficResponse) return trafficResponse;
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [{ email: 'alice@example.com', id: 'uuid-a' }],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        const onlineCard = screen.getByText('总在线用户').closest('[role="button"]');
        if (!onlineCard) throw new Error('Missing online users card');
        const weekTrafficCard = screen.getByText('周使用流量').closest('[role="button"]');
        if (!weekTrafficCard) throw new Error('Missing weekly traffic card');
        const trafficCard = screen.getByText('月使用流量').closest('[role="button"]');
        if (!trafficCard) throw new Error('Missing monthly traffic card');

        await waitFor(() => {
            expect(weekTrafficCard).toHaveTextContent('--');
            expect(weekTrafficCard).toHaveTextContent('统计当前用户流量中');
            expect(trafficCard).toHaveTextContent('--');
            expect(trafficCard).toHaveTextContent('统计当前用户流量中');
            expect(onlineCard).toHaveTextContent('--');
            expect(onlineCard).toHaveTextContent('已注册 1 · 正在统计在线');
        });

        resolveInbounds({
            data: {
                obj: [
                    {
                        id: 'inbound-a',
                        protocol: 'vless',
                        enable: true,
                        remark: 'Node A Link',
                        settings: JSON.stringify({
                            clients: [{ id: 'uuid-a', email: 'alice@example.com' }],
                        }),
                        clientStats: [{ id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 }],
                        up: 999000,
                        down: 888000,
                    },
                ],
            },
        });

        await waitFor(() => {
            expect(onlineCard).toHaveTextContent('1');
            expect(onlineCard).toHaveTextContent('已注册 1 · 在线会话 1');
            expect(weekTrafficCard).toHaveTextContent('210 B');
            expect(weekTrafficCard).toHaveTextContent(/↑\s*70 B/);
            expect(weekTrafficCard).toHaveTextContent(/↓\s*140 B/);
            expect(trafficCard).toHaveTextContent('270 B');
            expect(trafficCard).toHaveTextContent(/↑\s*90 B/);
            expect(trafficCard).toHaveTextContent(/↓\s*180 B/);
        });
    });

    it('renders stacked online-user cards on mobile instead of the global table', async () => {
        mockMatchMedia(true);
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
            ],
        });

        api.get.mockImplementation((url, config) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { id: 'user-a', role: 'user', username: 'Alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true },
                        ],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 10,
                            mem: { current: 256, total: 1024 },
                            uptime: 3600,
                            netTraffic: { sent: 1000, recv: 2000 },
                        },
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'inbound-a',
                                protocol: 'vless',
                                enable: true,
                                remark: 'Node A Link',
                                settings: JSON.stringify({
                                    clients: [{ id: 'uuid-a', email: 'alice@example.com' }],
                                }),
                                clientStats: [{ id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 }],
                                up: 1000,
                                down: 2000,
                            },
                        ],
                    },
                });
            }
            const trafficResponse = matchTrafficOverviewRequest(url, config, {
                day: { upBytes: 100, downBytes: 200 },
                week: { upBytes: 140, downBytes: 280 },
                month: { upBytes: 180, downBytes: 360 },
            });
            if (trafficResponse) return trafficResponse;
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [{ email: 'alice@example.com', id: 'uuid-a' }],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        const onlineCard = await screen.findByText('总在线用户');
        fireEvent.click(onlineCard.closest('[role="button"]'));

        await screen.findByText('在线用户明细');
        await waitFor(() => {
            expect(document.querySelector('.dashboard-online-mobile-card')).toBeTruthy();
        });
        expect(document.querySelector('.dashboard-online-table')).toBeFalsy();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    it('keeps the global online card aligned with registered users when websocket totals report raw sessions', async () => {
        webSocketState = {
            status: 'connected',
            lastMessage: {
                type: 'cluster_status',
                data: {
                    serverCount: 1,
                    onlineServers: 1,
                    totalOnline: 9,
                    totalUp: 0,
                    totalDown: 0,
                    totalInbounds: 1,
                    activeInbounds: 1,
                    servers: {
                        'server-a': {
                            name: 'Node A',
                            online: true,
                            health: 'healthy',
                            reasonCode: 'none',
                            reasonMessage: '',
                            status: {
                                cpu: 8,
                                mem: { current: 128, total: 1024 },
                                uptime: 3600,
                                xray: {},
                                netTraffic: {},
                            },
                            inboundCount: 1,
                            activeInbounds: 1,
                            up: 0,
                            down: 0,
                            onlineCount: 9,
                            onlineUsers: [],
                        },
                    },
                },
            },
        };

        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url, config) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { id: 'user-a', role: 'user', username: 'Alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true },
                        ],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'inbound-a',
                                protocol: 'vless',
                                enable: true,
                                remark: 'Node A Link',
                                settings: JSON.stringify({
                                    clients: [{ id: 'uuid-a', email: 'alice@example.com' }],
                                }),
                                clientStats: [{ id: 'uuid-a', email: 'alice@example.com', up: 100, down: 200 }],
                                up: 1000,
                                down: 2000,
                            },
                        ],
                    },
                });
            }
            const trafficResponse = matchTrafficOverviewRequest(url, config, {
                day: { upBytes: 80, downBytes: 160 },
                week: { upBytes: 120, downBytes: 240 },
                month: { upBytes: 160, downBytes: 320 },
            });
            if (trafficResponse) return trafficResponse;
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [
                            { email: 'alice@example.com', id: 'uuid-a' },
                            { email: 'alice@example.com', id: 'uuid-a' },
                            { email: 'unknown@example.com', id: 'uuid-x' },
                        ],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        const onlineCard = await screen.findByText('总在线用户');
        const cardSurface = onlineCard.closest('[role="button"]');
        if (!cardSurface) throw new Error('Missing online users card');

        await waitFor(() => {
            expect(cardSurface).toHaveTextContent('1');
            expect(cardSurface).toHaveTextContent('已注册 1 · 在线会话 2');
        });
    });

    it('reuses the managed-user cache across dashboard mounts', async () => {
        const panelApi = vi.fn((method, path) => {
            if (method === 'get' && path === '/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        obj: { cpu: 10, mem: { current: 256, total: 1024 }, uptime: 3600 },
                    },
                });
            }
            if (method === 'get' && path === '/panel/api/server/cpuHistory/30') {
                return Promise.resolve({ data: { obj: [10, 11, 12] } });
            }
            if (method === 'get' && path === '/panel/api/inbounds/list') {
                return Promise.resolve({ data: { obj: [] } });
            }
            if (method === 'post' && path === '/panel/api/inbounds/onlines') {
                return Promise.resolve({ data: { obj: [] } });
            }
            throw new Error(`Unexpected panelApi call: ${method} ${path}`);
        });

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{ id: 'user-a', role: 'user', username: 'Alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        const firstRender = renderWithRouter(<Dashboard />, { route: '/' });
        await waitFor(() => {
            expect(panelApi).toHaveBeenCalledTimes(4);
        });
        firstRender.unmount();

        renderWithRouter(<Dashboard />, { route: '/' });
        await waitFor(() => {
            expect(panelApi).toHaveBeenCalledTimes(8);
        });

        expect(api.get).toHaveBeenCalledTimes(1);
    });

    it('skips global auto-polling when the websocket cluster stream is connected', async () => {
        const intervalCallbacks = [];
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay) => {
            if (delay === 30_000) {
                intervalCallbacks.push(callback);
            }
            return 1;
        });
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
        try {
            webSocketState = {
                status: 'connected',
                lastMessage: {
                    type: 'cluster_status',
                    data: {
                        serverCount: 1,
                        onlineServers: 1,
                        totalOnline: 0,
                        totalUp: 0,
                        totalDown: 0,
                        totalInbounds: 0,
                        activeInbounds: 0,
                        servers: {
                            'server-a': {
                                name: 'Node A',
                                online: true,
                                health: 'healthy',
                                reasonCode: 'none',
                                reasonMessage: '',
                                status: {
                                    cpu: 8,
                                    mem: { current: 128, total: 1024 },
                                    uptime: 3600,
                                    xray: {},
                                    netTraffic: {},
                                },
                                inboundCount: 0,
                                activeInbounds: 0,
                                up: 0,
                                down: 0,
                                onlineCount: 0,
                                onlineUsers: [],
                            },
                        },
                    },
                },
            };

            useServer.mockReturnValue({
                activeServerId: 'global',
                panelApi: vi.fn(),
                activeServer: null,
                servers: [{ id: 'server-a', name: 'Node A' }],
            });

            let userFetches = 0;
            let statusFetches = 0;
            api.get.mockImplementation((url, config) => {
                if (url === '/auth/users') {
                    userFetches += 1;
                    return Promise.resolve({
                        data: {
                            obj: [{ id: 'user-a', role: 'user', username: 'Alice', email: 'alice@example.com', subscriptionEmail: 'alice@example.com', enabled: true }],
                        },
                    });
                }
                if (url === '/panel/server-a/panel/api/server/status') {
                    statusFetches += 1;
                    return Promise.resolve({
                        data: {
                            obj: {
                                cpu: 8,
                                mem: { current: 128, total: 1024 },
                                uptime: 3600,
                                netTraffic: { sent: 0, recv: 0 },
                            },
                        },
                    });
                }
                if (url === '/panel/server-a/panel/api/inbounds/list') {
                    return Promise.resolve({ data: { obj: [] } });
                }
                const trafficResponse = matchTrafficOverviewRequest(url, config, {
                    day: { upBytes: 0, downBytes: 0 },
                    week: { upBytes: 0, downBytes: 0 },
                    month: { upBytes: 0, downBytes: 0 },
                });
                if (trafficResponse) return trafficResponse;
                throw new Error(`Unexpected GET ${url}`);
            });
            api.post.mockImplementation((url) => {
                if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                    return Promise.resolve({ data: { obj: [] } });
                }
                throw new Error(`Unexpected POST ${url}`);
            });

            renderWithRouter(<Dashboard />, { route: '/' });
            await waitFor(() => {
                expect(userFetches).toBe(1);
                expect(statusFetches).toBe(0);
            });

            expect(userFetches).toBe(1);
            expect(statusFetches).toBe(0);
            expect(intervalCallbacks.length).toBeGreaterThan(0);

            await act(async () => {
                intervalCallbacks[0]();
            });

            expect(userFetches).toBe(1);
            expect(statusFetches).toBe(0);
        } finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });
});
