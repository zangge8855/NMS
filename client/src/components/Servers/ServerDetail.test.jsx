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

function buildServerSnapshot({
    name = 'Test Server',
    inboundBytes = 0,
    onlines = [],
} = {}) {
    return {
        data: {
            success: true,
            obj: {
                server: {
                    id: 'server-1',
                    name,
                    url: 'http://127.0.0.1:20530',
                    username: 'nmsadmin',
                    environment: 'staging',
                    group: 'edge',
                    health: 'healthy',
                    tags: [],
                    basePath: '/',
                },
                status: {
                    cpu: 12.5,
                    mem: { current: 1024, total: 2048 },
                    uptime: 600,
                    xray: { version: '1.8.13' },
                },
                inbounds: inboundBytes > 0 ? [
                    {
                        id: 'ib-1',
                        remark: 'JP Relay',
                        protocol: 'vless',
                        port: 443,
                        enable: true,
                        settings: JSON.stringify({ clients: [{ id: 'uuid-1' }] }),
                        up: inboundBytes / 2,
                        down: inboundBytes / 2,
                    },
                ] : [],
                onlines,
            },
        },
    };
}

describe('ServerDetail', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
        mockMatchMedia(false);
    });

    it('renders the cached server detail snapshot before the live requests finish', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:server_detail_v1:server-1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                server: {
                    id: 'server-1',
                    name: 'Snapshot Server',
                    url: 'https://snapshot.example.com',
                    username: 'nmsadmin',
                    environment: 'staging',
                    group: 'edge',
                    health: 'healthy',
                    tags: [],
                    basePath: '/',
                },
                status: {
                    cpu: 12.5,
                    mem: { current: 1024, total: 2048 },
                    uptime: 600,
                    xray: { version: '1.8.13' },
                },
                inbounds: [
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
                onlines: ['alice@example.com', 'alice@example.com'],
                auditEvents: [],
            },
        }));

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-1/snapshot') {
                return new Promise(() => {});
            }
            if (url === '/audit/events') {
                return new Promise(() => {});
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<ServerDetail />);

        expect(await screen.findByText('服务器 · Snapshot Server')).toBeInTheDocument();
        expect(screen.getAllByText('https://snapshot.example.com')).toHaveLength(2);
        expect(screen.getByText(/CPU: 12.5%/)).toBeInTheDocument();

        const trafficCard = screen.getByText('总流量').closest('.stat-mini-card');
        expect(trafficCard?.querySelector('.stat-mini-value')?.textContent).toBe('3 KB');
    });

    it('keeps the page in loading state until the server snapshot resolves', async () => {
        const snapshotDeferred = deferred();

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-1/snapshot') {
                return snapshotDeferred.promise;
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

        renderWithRouter(<ServerDetail />);

        expect(await screen.findByText('loading')).toBeInTheDocument();

        snapshotDeferred.resolve({
            data: {
                success: true,
                obj: {
                    server: {
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
                    status: {
                        cpu: 12.5,
                        mem: { current: 1024, total: 2048 },
                        uptime: 600,
                        xray: { version: '1.8.13' },
                    },
                    inbounds: [],
                    onlines: [],
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByText('服务器 · Test Server')).toBeInTheDocument();
            const inboundCard = screen.getByText('入站规则').closest('.stat-mini-card');
            const clientsCard = screen.getByText('客户端数').closest('.stat-mini-card');
            const onlineCard = screen.getAllByText('在线用户')[0].closest('.stat-mini-card');
            const trafficCard = screen.getByText('总流量').closest('.stat-mini-card');
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
            if (url === '/servers/server-1/snapshot') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            server: {
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
                            status: {
                                cpu: 12.5,
                                mem: { current: 1024, total: 2048 },
                                uptime: 600,
                                xray: { version: '1.8.13' },
                            },
                            inbounds: [
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
                            onlines: ['alice@example.com', 'alice@example.com'],
                        },
                    },
                });
            }
            if (url === '/audit/events') {
                return Promise.resolve({ data: { obj: { items: [] } } });
            }
            throw new Error(`Unexpected GET ${url}`);
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

    it('ignores a stale online snapshot after a newer online refresh completes', async () => {
        const user = userEvent.setup();
        const staleOnlineDeferred = deferred();
        const latestOnlineDeferred = deferred();
        let snapshotCallCount = 0;

        api.get.mockImplementation((url) => {
            if (url === '/servers/server-1/snapshot') {
                snapshotCallCount += 1;
                if (snapshotCallCount === 1) {
                    return Promise.resolve(buildServerSnapshot({ inboundBytes: 1024, onlines: [] }));
                }
                if (snapshotCallCount === 2) {
                    return staleOnlineDeferred.promise;
                }
                if (snapshotCallCount === 3) {
                    return latestOnlineDeferred.promise;
                }
            }
            if (url === '/audit/events') {
                return Promise.resolve({ data: { obj: { items: [] } } });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<ServerDetail />);

        await screen.findByText('服务器 · Test Server');

        await user.click(screen.getByRole('button', { name: '在线用户' }));
        await user.click(screen.getAllByRole('button', { name: '刷新' })[1]);

        latestOnlineDeferred.resolve(buildServerSnapshot({
            inboundBytes: 4096,
            onlines: ['alice@example.com', 'alice@example.com'],
        }));

        expect(await screen.findByText('alice@example.com')).toBeInTheDocument();

        staleOnlineDeferred.resolve(buildServerSnapshot({
            inboundBytes: 1024,
            onlines: [],
        }));

        await waitFor(() => {
            const onlineCard = screen.getAllByText('在线用户')[0].closest('.stat-mini-card');
            const trafficCard = screen.getByText('总流量').closest('.stat-mini-card');
            expect(onlineCard?.querySelector('.stat-mini-value')?.textContent).toBe('1 / 2 会话');
            expect(trafficCard?.querySelector('.stat-mini-value')?.textContent).toBe('4 KB');
            expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        });
    });
});
