import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Dashboard from './Dashboard.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';

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
    default: () => ({
        status: 'disconnected',
        lastMessage: null,
    }),
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

describe('Dashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
        mockMatchMedia(false);
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

        await waitFor(() => {
            expect(trafficCard).toHaveTextContent('300 B');
            expect(trafficCard).toHaveTextContent(/↑\s*100 B/);
            expect(trafficCard).toHaveTextContent(/↓\s*200 B/);
        });
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

        api.get.mockImplementation((url) => {
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

        expect(await screen.findByText('总用户 2 · 待审核 1')).toBeInTheDocument();
        expect(await screen.findByText('港口专线')).toBeInTheDocument();

        const overviewCard = screen.getByText('集群概览').closest('[role="button"]');
        if (!overviewCard) throw new Error('Missing cluster overview card');
        await waitFor(() => {
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

        const trafficCard = screen.getByText('累计流量').closest('[role="button"]');
        if (!trafficCard) throw new Error('Missing cumulative traffic card');
        await waitFor(() => {
            expect(trafficCard).toHaveTextContent('660 B');
            expect(trafficCard).toHaveTextContent(/↑\s*220 B/);
            expect(trafficCard).toHaveTextContent(/↓\s*440 B/);
        });

        fireEvent.click(onlineCard);

        expect(await screen.findByText('在线用户明细')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByText('unknown@example.com')).not.toBeInTheDocument();
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
        expect(document.querySelector('.dashboard-online-mobile-card')).toBeTruthy();
        expect(document.querySelector('.dashboard-online-table')).toBeFalsy();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
});
