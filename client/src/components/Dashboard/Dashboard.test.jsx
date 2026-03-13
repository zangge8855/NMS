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
    default: ({ title, subtitle }) => (
        <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
        </div>
    ),
}));

describe('Dashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
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
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 12.5,
                            mem: { current: 256, total: 1024 },
                            uptime: 3600,
                            netTraffic: { sent: 0, recv: 0 },
                        },
                    },
                });
            }
            if (url === '/panel/server-b/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        obj: {
                            cpu: 18.2,
                            mem: { current: 512, total: 2048 },
                            uptime: 7200,
                            netTraffic: { sent: 0, recv: 0 },
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
                                up: 100,
                                down: 200,
                                settings: JSON.stringify({
                                    clients: [
                                        { id: 'uuid-a', email: 'alice@example.com' },
                                    ],
                                }),
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
                                up: 120,
                                down: 240,
                                settings: JSON.stringify({
                                    clients: [
                                        { id: 'uuid-a', email: 'alice@example.com' },
                                    ],
                                }),
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

        const onlineCard = screen.getByText('总在线用户').closest('[role="button"]');
        if (!onlineCard) throw new Error('Missing online users card');
        await waitFor(() => {
            expect(onlineCard).toHaveTextContent('1');
        });
        fireEvent.click(onlineCard);

        expect(await screen.findByText('在线用户明细')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByText('unknown@example.com')).not.toBeInTheDocument();
    });
});
