import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Dashboard from './Dashboard.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';

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

function createSingleDashboardSnapshot(overrides = {}) {
    return {
        status: {
            cpu: 0,
            mem: { current: 0, total: 1 },
            uptime: 0,
        },
        cpuHistory: [],
        inbounds: [],
        onlineUsers: [],
        onlineCount: 0,
        onlineSessionCount: 0,
        singleServerTrafficTotals: {
            totalUp: 0,
            totalDown: 0,
        },
        ...overrides,
    };
}

function createGlobalDashboardSnapshot(overrides = {}) {
    return {
        serverStatuses: {},
        globalStats: {
            totalUp: 0,
            totalDown: 0,
            totalOnline: 0,
            totalInbounds: 0,
            activeInbounds: 0,
            serverCount: 0,
            onlineServers: 0,
        },
        globalOnlineUsers: [],
        globalOnlineSessionCount: 0,
        globalAccountSummary: {
            totalUsers: 0,
            pendingUsers: 0,
        },
        trafficWindowTotals: {
            day: { totalUp: 0, totalDown: 0, ready: true },
            week: { totalUp: 0, totalDown: 0, ready: true },
            month: { totalUp: 0, totalDown: 0, ready: true },
        },
        globalPresenceReady: true,
        ...overrides,
    };
}

describe('Dashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
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
        const panelApi = vi.fn();

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-a/dashboard/snapshot') {
                return Promise.resolve({
                    data: {
                        obj: createSingleDashboardSnapshot({
                            status: {
                                cpu: 12.5,
                                mem: { current: 256, total: 1024 },
                                uptime: 3600,
                            },
                            cpuHistory: [
                                { time: 0, cpu: 10 },
                                { time: 1, cpu: 12 },
                                { time: 2, cpu: 9 },
                            ],
                            inbounds: [
                                {
                                    id: 'inbound-a',
                                    protocol: 'vless',
                                    enable: true,
                                    remark: 'Node A Link',
                                    up: 1000,
                                    down: 2000,
                                },
                            ],
                            onlineUsers: [
                                {
                                    userId: 'user-a',
                                    username: 'Alice',
                                    email: 'alice@example.com',
                                    displayName: 'Alice',
                                    label: 'alice@example.com',
                                    sessions: 1,
                                    clientCount: 1,
                                    enabled: true,
                                    servers: ['Node A'],
                                    nodeLabels: ['Node A Link'],
                                },
                            ],
                            onlineCount: 1,
                            onlineSessionCount: 1,
                            singleServerTrafficTotals: {
                                totalUp: 100,
                                totalDown: 200,
                            },
                        }),
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/servers/server-a/dashboard/snapshot', { params: undefined });
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

        const panelApi = vi.fn();

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-a/dashboard/snapshot') {
                return Promise.resolve({
                    data: {
                        obj: createSingleDashboardSnapshot({
                            status: {
                                cpu: 12.5,
                                mem: { current: 256, total: 1024 },
                                uptime: 3600,
                            },
                            cpuHistory: [
                                { time: 0, cpu: 10 },
                                { time: 1, cpu: 12 },
                                { time: 2, cpu: 9 },
                            ],
                        }),
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

        api.get.mockImplementation((url) => {
            if (url === '/servers/dashboard/snapshot') {
                serverAStatusCalls += 1;
                return Promise.resolve({
                    data: {
                        obj: createGlobalDashboardSnapshot({
                            serverStatuses: {
                                'server-a': {
                                    serverId: 'server-a',
                                    name: 'Node A',
                                    online: true,
                                    inboundCount: 1,
                                    activeInbounds: 1,
                                    managedOnlineCount: 1,
                                    managedTrafficTotal: 300,
                                    managedTrafficReady: true,
                                    nodeRemarks: ['港口专线'],
                                    nodeRemarkPreview: ['港口专线'],
                                    nodeRemarkCount: 1,
                                    status: {
                                        cpu: 12.5,
                                        mem: { current: 256, total: 1024 },
                                        uptime: 3600,
                                        netTraffic: serverAStatusCalls > 1
                                            ? { sent: 3000, recv: 6000 }
                                            : { sent: 0, recv: 0 },
                                    },
                                },
                                'server-b': {
                                    serverId: 'server-b',
                                    name: 'Node B',
                                    online: true,
                                    inboundCount: 1,
                                    activeInbounds: 1,
                                    managedOnlineCount: 1,
                                    managedTrafficTotal: 360,
                                    managedTrafficReady: true,
                                    nodeRemarks: ['实验楼节点'],
                                    nodeRemarkPreview: ['实验楼节点'],
                                    nodeRemarkCount: 1,
                                    status: {
                                        cpu: 18.2,
                                        mem: { current: 512, total: 2048 },
                                        uptime: 7200,
                                        netTraffic: serverAStatusCalls > 1
                                            ? { sent: 6000, recv: 3000 }
                                            : { sent: 0, recv: 0 },
                                    },
                                },
                            },
                            globalStats: {
                                totalUp: 220,
                                totalDown: 440,
                                totalOnline: 1,
                                totalInbounds: 2,
                                activeInbounds: 2,
                                serverCount: 2,
                                onlineServers: 2,
                            },
                            globalOnlineUsers: [
                                {
                                    userId: 'user-a',
                                    username: 'Alice',
                                    email: 'alice@example.com',
                                    displayName: 'Alice',
                                    label: 'alice@example.com',
                                    sessions: 3,
                                    clientCount: 2,
                                    enabled: true,
                                    servers: ['Node A', 'Node B'],
                                    nodeLabels: ['港口专线', '实验楼节点'],
                                },
                            ],
                            globalOnlineSessionCount: 3,
                            globalAccountSummary: {
                                totalUsers: 2,
                                pendingUsers: 1,
                            },
                            trafficWindowTotals: {
                                day: { totalUp: 180, totalDown: 360, ready: true },
                                week: { totalUp: 210, totalDown: 420, ready: true },
                                month: { totalUp: 220, totalDown: 440, ready: true },
                            },
                        }),
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
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
                    accountSummary: {
                        totalUsers: 1,
                        pendingUsers: 0,
                    },
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

        api.get.mockImplementation((url) => {
            if (url === '/servers/dashboard/snapshot') {
                return delayedInbounds;
            }
            throw new Error(`Unexpected GET ${url}`);
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
                obj: createGlobalDashboardSnapshot({
                    serverStatuses: {
                        'server-a': {
                            serverId: 'server-a',
                            name: 'Node A',
                            online: true,
                            inboundCount: 1,
                            activeInbounds: 1,
                            managedOnlineCount: 1,
                            managedTrafficTotal: 300,
                            managedTrafficReady: true,
                            nodeRemarks: ['Node A Link'],
                            nodeRemarkPreview: ['Node A Link'],
                            nodeRemarkCount: 1,
                            status: {
                                cpu: 8,
                                mem: { current: 128, total: 1024 },
                                uptime: 3600,
                                netTraffic: {},
                            },
                        },
                    },
                    globalStats: {
                        totalUp: 100,
                        totalDown: 200,
                        totalOnline: 1,
                        totalInbounds: 1,
                        activeInbounds: 1,
                        serverCount: 1,
                        onlineServers: 1,
                    },
                    globalOnlineUsers: [
                        {
                            userId: 'user-a',
                            username: 'Alice',
                            email: 'alice@example.com',
                            displayName: 'Alice',
                            label: 'alice@example.com',
                            sessions: 1,
                            clientCount: 1,
                            enabled: true,
                            servers: ['Node A'],
                            nodeLabels: ['Node A Link'],
                        },
                    ],
                    globalOnlineSessionCount: 1,
                    globalAccountSummary: {
                        totalUsers: 1,
                        pendingUsers: 0,
                    },
                    trafficWindowTotals: {
                        day: { totalUp: 50, totalDown: 100, ready: true },
                        week: { totalUp: 70, totalDown: 140, ready: true },
                        month: { totalUp: 90, totalDown: 180, ready: true },
                    },
                }),
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

    it('renders websocket bootstrap traffic and account summaries before background hydration finishes', async () => {
        const never = new Promise(() => {});
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
                    accountSummary: {
                        totalUsers: 6,
                        pendingUsers: 2,
                    },
                    trafficWindows: {
                        day: {
                            totals: { upBytes: 900, downBytes: 900, totalBytes: 1800 },
                            managedTotals: { upBytes: 80, downBytes: 160, totalBytes: 240 },
                        },
                        week: {
                            totals: { upBytes: 9000, downBytes: 9000, totalBytes: 18000 },
                            managedTotals: { upBytes: 120, downBytes: 240, totalBytes: 360 },
                        },
                        month: {
                            totals: { upBytes: 90000, downBytes: 90000, totalBytes: 180000 },
                            managedTotals: { upBytes: 160, downBytes: 320, totalBytes: 480 },
                        },
                    },
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

        api.get.mockImplementation((url) => {
            if (url === '/servers/dashboard/snapshot') {
                return never;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        const onlineCard = screen.getByText('总在线用户').closest('[role="button"]');
        const weekTrafficCard = screen.getByText('周使用流量').closest('[role="button"]');
        const monthTrafficCard = screen.getByText('月使用流量').closest('[role="button"]');
        if (!onlineCard || !weekTrafficCard || !monthTrafficCard) {
            throw new Error('Missing global cards');
        }

        await waitFor(() => {
            expect(onlineCard).toHaveTextContent('已注册 6 · 正在统计在线');
            expect(weekTrafficCard).toHaveTextContent('360 B');
            expect(weekTrafficCard).toHaveTextContent(/↑\s*120 B/);
            expect(weekTrafficCard).toHaveTextContent(/↓\s*240 B/);
            expect(monthTrafficCard).toHaveTextContent('480 B');
            expect(monthTrafficCard).toHaveTextContent(/↑\s*160 B/);
            expect(monthTrafficCard).toHaveTextContent(/↓\s*320 B/);
        });
    });

    it('renders the last session snapshot before live dashboard hydration finishes', async () => {
        const never = new Promise(() => {});
        window.sessionStorage.setItem('nms_session_snapshot:dashboard_global_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                globalStats: {
                    totalUp: 120,
                    totalDown: 240,
                    totalOnline: 3,
                    totalInbounds: 4,
                    activeInbounds: 3,
                    serverCount: 1,
                    onlineServers: 1,
                },
                serverStatuses: {
                    'server-a': {
                        serverId: 'server-a',
                        name: 'Node A',
                        online: true,
                        inboundCount: 4,
                        activeInbounds: 3,
                        managedOnlineCount: 3,
                        managedTrafficTotal: 360,
                        managedTrafficReady: true,
                        status: {
                            cpu: 12,
                            mem: { current: 256, total: 1024 },
                            uptime: 3600,
                        },
                    },
                },
                globalAccountSummary: {
                    totalUsers: 8,
                    pendingUsers: 2,
                },
                globalPresenceReady: false,
                trafficWindowTotals: {
                    day: { totalUp: 30, totalDown: 60, ready: true },
                    week: { totalUp: 120, totalDown: 240, ready: true },
                    month: { totalUp: 300, totalDown: 600, ready: true },
                },
            },
        }));

        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/servers/dashboard/snapshot') {
                return never;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Dashboard />, { route: '/' });

        const onlineCard = screen.getByText('总在线用户').closest('[role="button"]');
        const weekTrafficCard = screen.getByText('周使用流量').closest('[role="button"]');
        const monthTrafficCard = screen.getByText('月使用流量').closest('[role="button"]');
        if (!onlineCard || !weekTrafficCard || !monthTrafficCard) {
            throw new Error('Missing dashboard cards');
        }

        await waitFor(() => {
            expect(onlineCard).toHaveTextContent('已注册 8 · 正在统计在线');
            expect(weekTrafficCard).toHaveTextContent('360 B');
            expect(monthTrafficCard).toHaveTextContent('900 B');
            expect(screen.getByText('待审核 2 个')).toBeInTheDocument();
            expect(screen.getByText('Node A')).toBeInTheDocument();
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

        api.get.mockImplementation((url) => {
            if (url === '/servers/dashboard/snapshot') {
                return Promise.resolve({
                    data: {
                        obj: createGlobalDashboardSnapshot({
                            serverStatuses: {
                                'server-a': {
                                    serverId: 'server-a',
                                    name: 'Node A',
                                    online: true,
                                    inboundCount: 1,
                                    activeInbounds: 1,
                                    managedOnlineCount: 1,
                                    managedTrafficTotal: 300,
                                    managedTrafficReady: true,
                                    nodeRemarks: ['Node A Link'],
                                    nodeRemarkPreview: ['Node A Link'],
                                    nodeRemarkCount: 1,
                                    status: {
                                        cpu: 10,
                                        mem: { current: 256, total: 1024 },
                                        uptime: 3600,
                                        netTraffic: { sent: 1000, recv: 2000 },
                                    },
                                },
                            },
                            globalStats: {
                                totalUp: 100,
                                totalDown: 200,
                                totalOnline: 1,
                                totalInbounds: 1,
                                activeInbounds: 1,
                                serverCount: 1,
                                onlineServers: 1,
                            },
                            globalOnlineUsers: [
                                {
                                    userId: 'user-a',
                                    username: 'Alice',
                                    email: 'alice@example.com',
                                    displayName: 'Alice',
                                    label: 'alice@example.com',
                                    sessions: 1,
                                    clientCount: 1,
                                    enabled: true,
                                    servers: ['Node A'],
                                    nodeLabels: ['Node A Link'],
                                },
                            ],
                            globalOnlineSessionCount: 1,
                            globalAccountSummary: {
                                totalUsers: 1,
                                pendingUsers: 0,
                            },
                            trafficWindowTotals: {
                                day: { totalUp: 100, totalDown: 200, ready: true },
                                week: { totalUp: 140, totalDown: 280, ready: true },
                                month: { totalUp: 180, totalDown: 360, ready: true },
                            },
                        }),
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
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

        api.get.mockImplementation((url) => {
            if (url === '/servers/dashboard/snapshot') {
                return Promise.resolve({
                    data: {
                        obj: createGlobalDashboardSnapshot({
                            serverStatuses: {
                                'server-a': {
                                    serverId: 'server-a',
                                    name: 'Node A',
                                    online: true,
                                    inboundCount: 1,
                                    activeInbounds: 1,
                                    managedOnlineCount: 1,
                                    managedTrafficTotal: 300,
                                    managedTrafficReady: true,
                                    nodeRemarks: ['Node A Link'],
                                    nodeRemarkPreview: ['Node A Link'],
                                    nodeRemarkCount: 1,
                                    status: {
                                        cpu: 8,
                                        mem: { current: 128, total: 1024 },
                                        uptime: 3600,
                                        netTraffic: {},
                                    },
                                },
                            },
                            globalStats: {
                                totalUp: 100,
                                totalDown: 200,
                                totalOnline: 1,
                                totalInbounds: 1,
                                activeInbounds: 1,
                                serverCount: 1,
                                onlineServers: 1,
                            },
                            globalOnlineUsers: [
                                {
                                    userId: 'user-a',
                                    username: 'Alice',
                                    email: 'alice@example.com',
                                    displayName: 'Alice',
                                    label: 'alice@example.com',
                                    sessions: 2,
                                    clientCount: 1,
                                    enabled: true,
                                    servers: ['Node A'],
                                    nodeLabels: ['Node A Link'],
                                },
                            ],
                            globalOnlineSessionCount: 2,
                            globalAccountSummary: {
                                totalUsers: 1,
                                pendingUsers: 0,
                            },
                            trafficWindowTotals: {
                                day: { totalUp: 80, totalDown: 160, ready: true },
                                week: { totalUp: 120, totalDown: 240, ready: true },
                                month: { totalUp: 160, totalDown: 320, ready: true },
                            },
                        }),
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
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
        const panelApi = vi.fn();

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-a/dashboard/snapshot') {
                return Promise.resolve({
                    data: {
                        obj: createSingleDashboardSnapshot({
                            status: { cpu: 10, mem: { current: 256, total: 1024 }, uptime: 3600 },
                            cpuHistory: [
                                { time: 0, cpu: 10 },
                                { time: 1, cpu: 11 },
                                { time: 2, cpu: 12 },
                            ],
                        }),
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        const firstRender = renderWithRouter(<Dashboard />, { route: '/' });
        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(1);
        });
        firstRender.unmount();

        renderWithRouter(<Dashboard />, { route: '/' });
        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(2);
        });

        expect(panelApi).not.toHaveBeenCalled();
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

            let snapshotFetches = 0;
            let statusFetches = 0;
            api.get.mockImplementation((url) => {
                if (url === '/servers/dashboard/snapshot') {
                    snapshotFetches += 1;
                    return Promise.resolve({
                        data: {
                            obj: createGlobalDashboardSnapshot({
                                serverStatuses: {
                                    'server-a': {
                                        serverId: 'server-a',
                                        name: 'Node A',
                                        online: true,
                                        inboundCount: 0,
                                        activeInbounds: 0,
                                        managedOnlineCount: 0,
                                        managedTrafficTotal: 0,
                                        managedTrafficReady: true,
                                        nodeRemarks: [],
                                        nodeRemarkPreview: [],
                                        nodeRemarkCount: 0,
                                        status: {
                                            cpu: 8,
                                            mem: { current: 128, total: 1024 },
                                            uptime: 3600,
                                            netTraffic: { sent: 0, recv: 0 },
                                        },
                                    },
                                },
                                globalStats: {
                                    totalUp: 0,
                                    totalDown: 0,
                                    totalOnline: 0,
                                    totalInbounds: 0,
                                    activeInbounds: 0,
                                    serverCount: 1,
                                    onlineServers: 1,
                                },
                                globalAccountSummary: {
                                    totalUsers: 1,
                                    pendingUsers: 0,
                                },
                            }),
                        },
                    });
                }
                if (url === '/panel/server-a/panel/api/server/status') {
                    statusFetches += 1;
                    return Promise.resolve({ data: { obj: {} } });
                }
                throw new Error(`Unexpected GET ${url}`);
            });

            renderWithRouter(<Dashboard />, { route: '/' });
            await waitFor(() => {
                expect(snapshotFetches).toBe(1);
                expect(statusFetches).toBe(0);
            });

            expect(snapshotFetches).toBe(1);
            expect(statusFetches).toBe(0);
            expect(intervalCallbacks.length).toBeGreaterThan(0);

            await act(async () => {
                intervalCallbacks[0]();
            });

            expect(snapshotFetches).toBe(2);
            expect(statusFetches).toBe(0);
        } finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });
});
