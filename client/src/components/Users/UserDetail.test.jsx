import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import { invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache.js';
import UserDetail from './UserDetail.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
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

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../Subscriptions/SubscriptionClientLinks.jsx', () => ({
    default: () => <div>subscription-client-links</div>,
}));

vi.mock('../../hooks/useAnimatedCounter.js', () => ({
    default: (value) => value,
}));

vi.mock('qrcode.react', () => ({
    QRCodeSVG: () => <div>qr-code</div>,
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
        useParams: () => ({ userId: 'user-1' }),
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

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function buildUserDetailResponse(enabled = true, overrides = {}) {
    return {
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
                    enabled,
                    createdAt: '2026-03-11T10:00:00.000Z',
                    lastLoginAt: '2026-03-11T11:00:00.000Z',
                },
                policy: null,
                recentAudit: { items: [], total: 0 },
                subscriptionAccess: { items: [], total: 0 },
                tokens: [],
                ...overrides,
            },
        },
    };
}

describe('UserDetail', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.put.mockReset();
        api.post.mockReset();
        api.delete.mockReset();
        sessionStorage.clear();
        useServer.mockReset();
        invalidateServerPanelDataCache();
        useServer.mockReturnValue({
            servers: [],
            loading: false,
        });
        mockMatchMedia(false);
        api.post.mockImplementation((url) => {
            if (String(url || '').includes('/panel/api/inbounds/onlines')) {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        api.get.mockImplementation((url) => {
            if (url === '/users/user-1/detail') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            user: {
                                id: 'user-1',
                                username: 'alice',
                                email: '',
                                subscriptionEmail: '',
                                emailVerified: true,
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-11T10:00:00.000Z',
                                lastLoginAt: '2026-03-11T11:00:00.000Z',
                            },
                            policy: null,
                            recentAudit: {
                                items: [],
                                total: 0,
                            },
                            subscriptionAccess: {
                                items: [
                                    {
                                        id: 'access-1',
                                        ts: '2026-03-11T12:00:00.000Z',
                                        status: 'success',
                                        reason: '',
                                        clientIp: '203.0.113.8',
                                        tokenId: 'token-1',
                                        userAgent: 'Mihomo',
                                        ipLocation: '中国 浙江 杭州 电信',
                                        ipCarrier: '电信',
                                        mode: 'auto',
                                        format: 'clash',
                                    },
                                ],
                                total: 1,
                            },
                            tokens: [],
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });
    });

    it('renders successful subscription access as success in the activity timeline', async () => {
        const user = userEvent.setup();

        renderWithRouter(<UserDetail />);

        await screen.findByText('用户详情 · alice');
        expect(screen.getByRole('button', { name: '节点' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '活动日志' }));

        const timelineItem = await screen.findByText('Token token-1');
        const timelineRow = timelineItem.closest('.timeline-item');
        if (!timelineRow) throw new Error('Missing timeline row');

        expect(within(timelineRow).getByText('成功')).toBeInTheDocument();
        expect(within(timelineRow).queryByText('失败')).not.toBeInTheDocument();
        expect(within(timelineRow).getByText('IP')).toBeInTheDocument();
        expect(within(timelineRow).getByText('203.0.113.8')).toBeInTheDocument();
        expect(within(timelineRow).getByText('地区')).toBeInTheDocument();
        expect(within(timelineRow).getByText('中国 浙江 杭州')).toBeInTheDocument();
        expect(within(timelineRow).getByText('运营商')).toBeInTheDocument();
        expect(within(timelineRow).getByText('中国电信')).toBeInTheDocument();
        expect(within(timelineRow).getAllByText(/token-1/i)).toHaveLength(1);
    });

    it('matches node clients by either login email or subscription email in the clients tab', async () => {
        const user = userEvent.setup();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
            loading: false,
        });

        api.get.mockImplementation((url) => {
            if (url === '/users/user-1/detail') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            user: {
                                id: 'user-1',
                                username: 'alice',
                                email: 'legacy@example.com',
                                subscriptionEmail: 'bind@example.com',
                                emailVerified: true,
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-11T10:00:00.000Z',
                                lastLoginAt: '2026-03-11T11:00:00.000Z',
                            },
                            policy: null,
                            recentAudit: { items: [], total: 0 },
                            subscriptionAccess: { items: [], total: 0 },
                            tokens: [],
                        },
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 101,
                            protocol: 'vless',
                            enable: true,
                            remark: 'Inbound A',
                            port: 443,
                            settings: JSON.stringify({
                                clients: [{
                                    email: 'legacy@example.com',
                                    id: '11111111-1111-1111-1111-111111111111',
                                    enable: true,
                                    expiryTime: 0,
                                    up: 0,
                                    down: 0,
                                }],
                            }),
                            clientStats: [],
                        }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UserDetail />);

        await screen.findByText('用户详情 · alice');
        await user.click(screen.getByRole('button', { name: '节点' }));

        expect(await screen.findByText('Node A')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /节点 IP/i })).toBeInTheDocument();
    });

    it('shows a live online indicator for node records with matched sessions', async () => {
        const user = userEvent.setup();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
            loading: false,
        });

        api.get.mockImplementation((url) => {
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
                            subscriptionAccess: { items: [], total: 0 },
                            tokens: [],
                        },
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 101,
                            protocol: 'vless',
                            enable: true,
                            remark: 'Inbound A',
                            port: 443,
                            settings: JSON.stringify({
                                clients: [{
                                    email: 'alice@example.com',
                                    id: '11111111-1111-1111-1111-111111111111',
                                    enable: true,
                                    expiryTime: 0,
                                    up: 0,
                                    down: 0,
                                }],
                            }),
                            clientStats: [],
                        }],
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
                            {
                                email: 'alice@example.com',
                                id: '11111111-1111-1111-1111-111111111111',
                            },
                        ],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<UserDetail />, {
            route: '/clients/user-1?tab=clients',
            initialEntries: ['/clients/user-1?tab=clients'],
        });

        await screen.findByText('用户详情 · alice');
        await user.click(screen.getByRole('button', { name: '节点' }));

        expect(await screen.findByText('Node A')).toBeInTheDocument();
        expect(screen.getByText('在线')).toBeInTheDocument();
        expect(screen.getByText('1 会话')).toBeInTheDocument();
        expect(document.querySelector('.user-detail-presence.is-online')).toBeTruthy();
    });

    it('renders audit events with structured facts and hides masked audit values', async () => {
        const user = userEvent.setup();

        api.get.mockImplementation((url) => {
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
                            recentAudit: {
                                items: [
                                    {
                                        id: 'audit-1',
                                        ts: '2026-03-11T12:10:00.000Z',
                                        eventType: 'login_success',
                                        actor: 'alice',
                                        outcome: 'success',
                                        method: 'POST',
                                        path: '/api/auth/login',
                                        ip: '',
                                        ipMasked: true,
                                        userAgent: '',
                                        userAgentMasked: true,
                                        resourceType: 'session',
                                        resourceId: 'session-1',
                                        details: {
                                            userAgent: 'ua_1234567890abcdef',
                                        },
                                    },
                                ],
                                total: 1,
                            },
                            subscriptionAccess: {
                                items: [],
                                total: 0,
                            },
                            tokens: [],
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UserDetail />);

        await screen.findByText('用户详情 · alice');
        await user.click(screen.getByRole('button', { name: '活动日志' }));

        const timelineItem = await screen.findByText('登录成功');
        const timelineRow = timelineItem.closest('.timeline-item');
        if (!timelineRow) throw new Error('Missing audit timeline row');

        expect(within(timelineRow).getByText('方法')).toBeInTheDocument();
        expect(within(timelineRow).getByText('POST')).toBeInTheDocument();
        expect(within(timelineRow).getByText('路径')).toBeInTheDocument();
        expect(within(timelineRow).getAllByText('/api/auth/login').length).toBeGreaterThanOrEqual(1);
        expect(within(timelineRow).getByText('资源')).toBeInTheDocument();
        expect(within(timelineRow).getByText('session / session-1')).toBeInTheDocument();
        expect(within(timelineRow).getAllByText('已脱敏').length).toBeGreaterThanOrEqual(2);
        expect(within(timelineRow).queryByText(/ip_1b2b75909e944f4e/i)).not.toBeInTheDocument();
        expect(within(timelineRow).queryByText(/ua_1234567890abcdef/i)).not.toBeInTheDocument();
    });

    it('renders the subscription tab without crashing when opened directly from user management', async () => {
        const user = userEvent.setup();

        api.get.mockImplementation((url) => {
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
                            recentAudit: {
                                items: [],
                                total: 0,
                            },
                            subscriptionAccess: {
                                items: [],
                                total: 0,
                            },
                            tokens: [],
                        },
                    },
                });
            }
            if (url === '/subscriptions/alice%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'alice@example.com',
                            subscriptionActive: true,
                            total: 1,
                            matchedClientsRaw: 1,
                            matchedClientsActive: 1,
                            sourceMode: 'builtin',
                            subscriptionUrl: 'https://sub.example.com/merged',
                            subscriptionUrlV2rayn: 'https://sub.example.com/v2rayn',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UserDetail />, {
            route: '/clients/user-1?tab=subscription',
            initialEntries: ['/clients/user-1?tab=subscription'],
        });

        await screen.findByText('用户详情 · alice');
        await user.click(screen.getByRole('button', { name: '订阅' }));

        expect((await screen.findAllByText('订阅资料')).length).toBeGreaterThan(0);
        expect(screen.getByText('已用流量')).toBeInTheDocument();
        expect(screen.getByText('可用流量')).toBeInTheDocument();
        expect(screen.getByText('到期时间')).toBeInTheDocument();
        const profileNotes = document.querySelector('.subscription-profile-notes');
        expect(profileNotes).toBeTruthy();
        expect(profileNotes).toHaveTextContent('个配置文件');
        expect(profileNotes).toHaveTextContent('按这个配置文件直接导入');
        expect(screen.getByDisplayValue('https://sub.example.com/v2rayn')).toBeInTheDocument();
        expect(screen.getByText('subscription-client-links')).toBeInTheDocument();
        expect(screen.getByText('qr-code')).toBeInTheDocument();
    });

    it('renders the last session detail snapshot before the live detail request finishes', async () => {
        const never = new Promise(() => {});
        window.sessionStorage.setItem('nms_session_snapshot:user_detail_v1:user-1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                detail: {
                    user: {
                        id: 'user-1',
                        username: 'snapshot-user',
                        email: 'snapshot@example.com',
                        subscriptionEmail: 'snapshot@example.com',
                        emailVerified: true,
                        role: 'user',
                        enabled: true,
                        createdAt: '2026-03-11T10:00:00.000Z',
                        lastLoginAt: '2026-03-11T11:00:00.000Z',
                    },
                    policy: null,
                    recentAudit: { items: [], total: 0 },
                    subscriptionAccess: { items: [], total: 0 },
                    tokens: [],
                },
                clientData: [],
                clientsFetched: false,
                subscriptionResult: null,
                subscriptionFetched: false,
                subscriptionProfileKey: 'v2rayn',
            },
        }));

        api.get.mockImplementation((url) => {
            if (url === '/users/user-1/detail') {
                return never;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UserDetail />);

        expect(await screen.findByText('用户详情 · snapshot-user')).toBeInTheDocument();
        expect(screen.getByText('snapshot@example.com')).toBeInTheDocument();
    });

    it('uses node wording for the node tab and empty state', async () => {
        const user = userEvent.setup();

        renderWithRouter(<UserDetail />);

        await screen.findByText('用户详情 · alice');
        await user.click(screen.getByRole('button', { name: '节点' }));

        expect(await screen.findByText('暂无节点记录')).toBeInTheDocument();
        expect(screen.queryByText('暂无客户端')).not.toBeInTheDocument();
    });

    it('switches the node list to compact cards on mobile', async () => {
        mockMatchMedia(true);
        useServer.mockReturnValue({
            servers: [{ id: 'server-1', name: 'Tokyo Node' }],
            loading: false,
        });

        api.get.mockImplementation((url) => {
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
                            subscriptionAccess: { items: [], total: 0 },
                            tokens: [],
                        },
                    },
                });
            }
            if (url === '/panel/server-1/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'inbound-1',
                                remark: 'JP Relay',
                                protocol: 'vless',
                                port: 443,
                                settings: JSON.stringify({
                                    clients: [{ email: 'alice@example.com', id: 'uuid-a' }],
                                }),
                                clientStats: [
                                    {
                                        email: 'alice@example.com',
                                        id: 'uuid-a',
                                        up: 1024,
                                        down: 2048,
                                        expiryTime: 0,
                                        enable: true,
                                    },
                                ],
                            },
                        ],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UserDetail />, {
            route: '/clients/user-1?tab=clients',
            initialEntries: ['/clients/user-1?tab=clients'],
        });

        await screen.findByText('用户详情 · alice');
        expect(await screen.findByText('Tokyo Node')).toBeInTheDocument();
        expect(document.querySelector('.user-detail-client-card')).toBeTruthy();
        expect(document.querySelector('.table-container table')).toBeFalsy();
        expect(screen.getByText('JP Relay')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /节点 IP/ })).toBeInTheDocument();
    });

    it('keeps the enabled badge in sync when a stale detail refresh resolves after re-enabling the user', async () => {
        const user = userEvent.setup();
        const refreshDeferred = createDeferred();
        const toggleDeferred = createDeferred();
        let detailCallCount = 0;

        api.get.mockImplementation((url) => {
            if (url === '/users/user-1/detail') {
                detailCallCount += 1;
                if (detailCallCount === 1) {
                    return Promise.resolve(buildUserDetailResponse(false));
                }
                if (detailCallCount === 2) {
                    return refreshDeferred.promise;
                }
                if (detailCallCount === 3) {
                    return toggleDeferred.promise;
                }
            }
            throw new Error(`Unexpected GET ${url}`);
        });
        api.put.mockResolvedValue({
            data: {
                success: true,
                msg: '用户已启用',
                obj: {
                    enabled: true,
                },
            },
        });

        renderWithRouter(<UserDetail />);

        await screen.findByText('用户详情 · alice');
        const badgeGroup = document.querySelector('.user-profile-badges');
        const actionGroup = document.querySelector('.user-profile-actions');
        if (!badgeGroup || !actionGroup) {
            throw new Error('Missing profile card controls');
        }

        expect(within(badgeGroup).getByText('已停用')).toBeInTheDocument();

        await user.click(within(actionGroup).getByRole('button', { name: '刷新' }));
        await user.click(within(actionGroup).getByRole('button', { name: '已启用' }));

        await waitFor(() => {
            expect(within(badgeGroup).getByText('已启用')).toBeInTheDocument();
        });

        toggleDeferred.resolve(buildUserDetailResponse(true));
        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/auth/users/user-1/set-enabled', { enabled: true });
        });

        refreshDeferred.resolve(buildUserDetailResponse(false));
        await waitFor(() => {
            expect(within(badgeGroup).getByText('已启用')).toBeInTheDocument();
            expect(within(badgeGroup).queryByText('已停用')).not.toBeInTheDocument();
            expect(within(actionGroup).getByRole('button', { name: '已停用' })).toBeInTheDocument();
        });
    });
});
