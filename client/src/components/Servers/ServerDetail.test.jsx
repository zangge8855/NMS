import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { renderWithRouter } from '../../test/render.jsx';
import ServerDetail from './ServerDetail.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('../UI/SkeletonTable.jsx', () => ({
    default: () => <div>loading</div>,
}));

vi.mock('../UI/EmptyState.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('../UI/ClientIpModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../../hooks/useAnimatedCounter.js', () => ({
    default: (value) => value,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ serverId: 'server-1' }),
        useNavigate: () => vi.fn(),
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('ServerDetail', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        mockMatchMedia(false);
    });

    it('keeps summary stats in loading state until inbound and online data resolve', async () => {
        const inboundsDeferred = deferred();
        const onlinesDeferred = deferred();

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-1') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            id: 'server-1',
                            name: 'Test Server',
                            url: 'http://127.0.0.1:20530',
                            username: 'nmsadmin',
                            environment: 'staging',
                            group: 'edge',
                            health: 'healthy',
                            tags: [],
                            basePath: '/',
                        },
                    },
                });
            }
            if (url === '/panel/server-1/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            cpu: 12.5,
                            mem: { current: 1024, total: 2048 },
                            uptime: 600,
                            xray: { version: '1.8.13' },
                        },
                    },
                });
            }
            if (url === '/panel/server-1/panel/api/inbounds/list') {
                return inboundsDeferred.promise;
            }
            if (url === '/system/inbounds/order') {
                return Promise.resolve({
                    data: {
                        obj: {},
                    },
                });
            }
            if (url === '/audit/events') {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [],
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-1/panel/api/inbounds/onlines') {
                return onlinesDeferred.promise;
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<ServerDetail />);

        await screen.findByText('服务器 · Test Server');

        const inboundCard = screen.getByText('入站规则').closest('.stat-mini-card');
        const clientsCard = screen.getByText('客户端数').closest('.stat-mini-card');
        const onlineCard = screen.getAllByText('在线用户')[0].closest('.stat-mini-card');
        const trafficCard = screen.getByText('总流量').closest('.stat-mini-card');

        expect(inboundCard?.querySelector('.stat-mini-value')?.textContent).toBe('...');
        expect(clientsCard?.querySelector('.stat-mini-value')?.textContent).toBe('...');
        expect(onlineCard?.querySelector('.stat-mini-value')?.textContent).toBe('...');
        expect(trafficCard?.querySelector('.stat-mini-value')?.textContent).toBe('...');

        inboundsDeferred.resolve({
            data: {
                obj: [],
            },
        });
        onlinesDeferred.resolve({
            data: {
                obj: [],
            },
        });

        await waitFor(() => {
            expect(inboundCard?.querySelector('.stat-mini-value')?.textContent).toBe('0 / 0');
            expect(clientsCard?.querySelector('.stat-mini-value')?.textContent).toBe('0');
            expect(onlineCard?.querySelector('.stat-mini-value')?.textContent).toBe('0');
            expect(trafficCard?.querySelector('.stat-mini-value')?.textContent).toBe('0 B');
        });
    });

    it('switches inbounds and online users to stacked cards on mobile', async () => {
        const user = userEvent.setup();
        mockMatchMedia(true);

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-1') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            id: 'server-1',
                            name: 'Test Server',
                            url: 'http://127.0.0.1:20530',
                            username: 'nmsadmin',
                            environment: 'staging',
                            group: 'edge',
                            health: 'healthy',
                            tags: [],
                            basePath: '/',
                        },
                    },
                });
            }
            if (url === '/panel/server-1/panel/api/server/status') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            cpu: 12.5,
                            mem: { current: 1024, total: 2048 },
                            uptime: 600,
                            xray: { version: '1.8.13' },
                        },
                    },
                });
            }
            if (url === '/panel/server-1/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'ib-1',
                                remark: 'JP Relay',
                                protocol: 'vless',
                                port: 443,
                                enable: true,
                                settings: JSON.stringify({ clients: [{ id: 'uuid-1' }] }),
                                up: 1024,
                                down: 2048,
                            },
                        ],
                    },
                });
            }
            if (url === '/system/inbounds/order') {
                return Promise.resolve({ data: { obj: {} } });
            }
            if (url === '/audit/events') {
                return Promise.resolve({ data: { obj: { items: [] } } });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-1/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [{ email: 'alice@example.com' }, { email: 'alice@example.com' }],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<ServerDetail />);

        await screen.findByText('服务器 · Test Server');
        await user.click(screen.getByRole('button', { name: '入站列表' }));
        await screen.findByText('JP Relay');

        expect(document.querySelector('.server-detail-mobile-card')).toBeTruthy();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '在线用户' }));
        expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /节点 IP/ })).toBeInTheDocument();
    });
});
