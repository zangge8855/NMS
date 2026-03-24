import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { renderWithRouter } from '../../test/render.jsx';
import AuditCenter from './AuditCenter.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('../Tasks/Tasks.jsx', () => ({
    default: () => <div>tasks</div>,
}));

vi.mock('recharts', async () => {
    const actual = await vi.importActual('recharts');
    return {
        ...actual,
        ResponsiveContainer: ({ children }) => (
            <div data-testid="responsive-container" style={{ width: 640, height: 260 }}>
                {children}
            </div>
        ),
    };
});

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
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

describe('AuditCenter localization', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.delete.mockReset();
        window.localStorage.clear();
        window.sessionStorage.clear();
        mockMatchMedia(false);
    });

    it('renders localized outcome labels in the events tab', async () => {
        api.get.mockImplementation((url) => {
            if (url.startsWith('/audit/events?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    id: 'event-1',
                                    ts: '2026-03-13T10:00:00.000Z',
                                    eventType: 'login_success',
                                    outcome: 'success',
                                    actor: 'review-admin',
                                    serverId: 'server-a',
                                    ip: '203.0.113.9',
                                    ipLocation: '中国 浙江 杭州',
                                    ipCarrier: '中国电信',
                                    details: {
                                        email: 'alice@example.com',
                                    },
                                },
                                {
                                    id: 'event-2',
                                    ts: '2026-03-13T10:10:00.000Z',
                                    eventType: 'user_subscription_provisioned',
                                    outcome: 'success',
                                    actor: 'review-admin',
                                    serverId: 'server-a',
                                    details: {
                                        email: 'alice@example.com',
                                    },
                                },
                                {
                                    id: 'event-3',
                                    ts: '2026-03-13T10:20:00.000Z',
                                    eventType: 'user_enabled',
                                    outcome: 'success',
                                    actor: 'review-admin',
                                    serverId: 'server-a',
                                    details: {
                                        email: 'alice@example.com',
                                    },
                                },
                                {
                                    id: 'event-4',
                                    ts: '2026-03-13T10:30:00.000Z',
                                    eventType: 'system_backup_deleted_local',
                                    outcome: 'success',
                                    actor: 'review-admin',
                                    serverId: 'server-a',
                                    details: {},
                                },
                            ],
                            total: 4,
                            page: 1,
                            totalPages: 1,
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit' });

        expect(await screen.findByText('登录成功')).toBeInTheDocument();
        expect(screen.getByText('开通订阅')).toBeInTheDocument();
        expect(screen.getByText('启用用户')).toBeInTheDocument();
        expect(screen.getByText('删除本机备份')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '成功' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '失败' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '信息' })).toBeInTheDocument();

        const successBadge = screen.getAllByText('成功').find((node) => node.className.includes('badge'));
        expect(successBadge).toBeTruthy();
        expect(screen.getByText('203.0.113.9 · 中国 浙江 杭州 · 中国电信')).toBeInTheDocument();
        expect(screen.queryByText('success')).not.toBeInTheDocument();
        expect(screen.queryByText('user_subscription_provisioned')).not.toBeInTheDocument();
        expect(screen.queryByText('user_enabled')).not.toBeInTheDocument();
        expect(screen.queryByText('system_backup_deleted_local')).not.toBeInTheDocument();
    });

    it('keeps advanced event filters collapsed until requested', async () => {
        const user = userEvent.setup();

        api.get.mockImplementation((url) => {
            if (url.startsWith('/audit/events?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [],
                            total: 0,
                            page: 1,
                            totalPages: 1,
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit' });

        expect(await screen.findByText('暂无审计记录')).toBeInTheDocument();
        expect(screen.getByText('按事件、结果、目标用户和节点回看系统操作历史，优先定位敏感变更。')).toBeInTheDocument();
        expect(screen.getByText('筛选操作记录')).toBeInTheDocument();
        expect(screen.getByText('按关键词、事件类型、结果、目标用户和节点缩小范围。')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('节点 ID')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '更多筛选' }));

        expect(screen.getByPlaceholderText('事件类型')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('节点 ID')).toBeInTheDocument();
    });

    it('renders the cached events snapshot while the live query is still pending', async () => {
        const never = new Promise(() => {});
        window.sessionStorage.setItem('nms_session_snapshot:audit_events_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                eventsData: {
                    items: [
                        {
                            id: 'event-1',
                            ts: '2026-03-13T10:00:00.000Z',
                            eventType: 'login_success',
                            outcome: 'success',
                            actor: 'review-admin',
                            serverId: 'server-a',
                            details: {
                                email: 'alice@example.com',
                            },
                        },
                    ],
                    total: 1,
                    page: 1,
                    totalPages: 1,
                },
            },
        }));

        api.get.mockImplementation((url) => {
            if (url.startsWith('/audit/events?')) {
                return never;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit' });

        expect(await screen.findByText('登录成功')).toBeInTheDocument();
        expect(screen.queryByText('暂无审计记录')).not.toBeInTheDocument();
    });

    it('renders localized subscription access statuses in the subscriptions tab', async () => {
        api.get.mockImplementation((url) => {
            if (url.startsWith('/subscriptions/access?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    id: 'access-1',
                                    ts: '2026-03-13T10:00:00.000Z',
                                    userLabel: 'Alice',
                                    email: 'alice@example.com',
                                    status: 'revoked',
                                    clientIp: '203.0.113.1',
                                    ipSource: 'real',
                                    userAgent: 'Clash',
                                },
                            ],
                            total: 1,
                            page: 1,
                            totalPages: 1,
                            statusBreakdown: {
                                revoked: 1,
                            },
                        },
                    },
                });
            }
            if (url.startsWith('/subscriptions/access/summary?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            total: 1,
                            uniqueIpCount: 1,
                            uniqueUsers: 1,
                            statusBreakdown: {
                                revoked: 1,
                            },
                            topIps: [],
                            from: '',
                            to: '',
                            windows: {
                                '7': {
                                    total: 1,
                                    uniqueIpCount: 1,
                                    uniqueUsers: 1,
                                    statusBreakdown: { revoked: 1 },
                                    topIps: [],
                                    from: '',
                                    to: '',
                                },
                                '30': {
                                    total: 1,
                                    uniqueIpCount: 1,
                                    uniqueUsers: 1,
                                    statusBreakdown: { revoked: 1 },
                                    topIps: [],
                                    from: '',
                                    to: '',
                                },
                            },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit?tab=subscriptions' });

        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('筛选订阅访问')).toBeInTheDocument();
        expect(screen.queryByText('暂无访问记录')).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: '已撤销' })).toBeInTheDocument();
        expect(screen.getByText('周访问用户')).toBeInTheDocument();
        expect(screen.getByText('月访问用户')).toBeInTheDocument();
        expect(document.querySelector('.audit-access-ua-text')).toBeTruthy();

        const subscriptionsTable = document.querySelector('.audit-subscriptions-table');
        if (!subscriptionsTable) throw new Error('Missing subscriptions table');
        const tableUtils = within(subscriptionsTable);
        expect(tableUtils.getByText('已撤销')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getAllByText('已撤销').length).toBeGreaterThan(0);
        });
        expect(screen.queryByText('revoked')).not.toBeInTheDocument();
    });

    it('hides masked subscription identifiers behind a localized user label', async () => {
        api.get.mockImplementation((url) => {
            if (url.startsWith('/subscriptions/access?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    id: 'access-masked',
                                    ts: '2026-03-13T10:00:00.000Z',
                                    userLabel: 'dd43f8a31ad7ff43@masked.local',
                                    email: 'dd43f8a31ad7ff43@masked.local',
                                    status: 'success',
                                    clientIp: '203.0.113.8',
                                    ipSource: 'real',
                                    userAgent: 'ua_1234567890abcdef',
                                },
                            ],
                            total: 1,
                            page: 1,
                            totalPages: 1,
                            statusBreakdown: {
                                success: 1,
                            },
                        },
                    },
                });
            }
            if (url.startsWith('/subscriptions/access/summary?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            total: 1,
                            uniqueIpCount: 1,
                            uniqueUsers: 1,
                            statusBreakdown: {
                                success: 1,
                            },
                            topIps: [],
                            from: '',
                            to: '',
                            windows: {
                                '7': {
                                    total: 1,
                                    uniqueIpCount: 1,
                                    uniqueUsers: 1,
                                    statusBreakdown: { success: 1 },
                                    topIps: [],
                                    from: '',
                                    to: '',
                                },
                                '30': {
                                    total: 1,
                                    uniqueIpCount: 1,
                                    uniqueUsers: 1,
                                    statusBreakdown: { success: 1 },
                                    topIps: [],
                                    from: '',
                                    to: '',
                                },
                            },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit?tab=subscriptions' });

        expect(await screen.findByText('已脱敏用户')).toBeInTheDocument();
        expect(screen.getByText('已脱敏 UA')).toBeInTheDocument();
        expect(screen.queryByText('dd43f8a31ad7ff43@masked.local')).not.toBeInTheDocument();
        expect(screen.queryByText('ua_1234567890abcdef')).not.toBeInTheDocument();
    });

    it('renders the cached subscription snapshot while the live query is still pending', async () => {
        const never = new Promise(() => {});
        window.sessionStorage.setItem('nms_session_snapshot:audit_access_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                accessData: {
                    items: [
                        {
                            id: 'access-1',
                            ts: '2026-03-13T10:00:00.000Z',
                            userLabel: 'Alice',
                            email: 'alice@example.com',
                            status: 'success',
                            clientIp: '203.0.113.8',
                            ipSource: 'real',
                            userAgent: 'Mihomo',
                        },
                    ],
                    total: 1,
                    page: 1,
                    totalPages: 1,
                    statusBreakdown: {
                        success: 1,
                    },
                },
                accessSummary: {
                    total: 5,
                    uniqueIpCount: 3,
                    uniqueUsers: 2,
                    statusBreakdown: {
                        success: 5,
                    },
                    topIps: [],
                    from: '',
                    to: '',
                },
                accessUserWindows: {
                    week: {
                        total: 2,
                        uniqueIpCount: 2,
                        uniqueUsers: 1,
                        statusBreakdown: {
                            success: 2,
                        },
                        topIps: [],
                        from: '',
                        to: '',
                    },
                    month: {
                        total: 5,
                        uniqueIpCount: 3,
                        uniqueUsers: 2,
                        statusBreakdown: {
                            success: 5,
                        },
                        topIps: [],
                        from: '',
                        to: '',
                    },
                },
            },
        }));

        api.get.mockImplementation((url) => {
            if (url.startsWith('/subscriptions/access?') || url.startsWith('/subscriptions/access/summary?')) {
                return never;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit?tab=subscriptions' });

        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('暂无访问记录')).not.toBeInTheDocument();
        expect(screen.getByText('周访问用户')).toBeInTheDocument();
        expect(screen.getByText('月访问用户')).toBeInTheDocument();
        expect(document.querySelector('.audit-subscriptions-table')).toBeTruthy();
    });

    it('shows registered user labels in traffic rankings instead of masked identifiers', async () => {
        const requestedUrls = [];
        api.get.mockImplementation((url) => {
            requestedUrls.push(url);
            if (url.startsWith('/traffic/overview?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            lastCollectionAt: '2026-03-13T10:00:00.000Z',
                            sampleCount: 12,
                            activeUsers: 1,
                            userLevelSupported: true,
                            totals: {
                                upBytes: 512,
                                downBytes: 1536,
                                totalBytes: 2048,
                            },
                            topUsers: [
                                {
                                    email: 'alice@example.com',
                                    username: 'alice',
                                    displayLabel: 'alice · alice@example.com',
                                    totalBytes: 2048,
                                },
                            ],
                            topServers: [
                                {
                                    serverId: 'server-a',
                                    serverName: 'Node A',
                                    totalBytes: 4096,
                                },
                            ],
                            windows: {
                                '7': {
                                    activeUsers: 1,
                                    totals: {
                                        upBytes: 256,
                                        downBytes: 768,
                                        totalBytes: 1024,
                                    },
                                },
                                '30': {
                                    activeUsers: 1,
                                    totals: {
                                        upBytes: 512,
                                        downBytes: 1536,
                                        totalBytes: 2048,
                                    },
                                },
                            },
                            collection: {
                                warnings: [],
                            },
                        },
                    },
                });
            }
            if (url.startsWith('/traffic/users/alice%40example.com/trend?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'alice@example.com',
                            username: 'alice',
                            displayLabel: 'alice · alice@example.com',
                            granularity: 'hour',
                            points: [],
                            totals: {
                                upBytes: 512,
                                downBytes: 1536,
                                totalBytes: 2048,
                            },
                        },
                    },
                });
            }
            if (url.startsWith('/traffic/servers/server-a/trend?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            serverId: 'server-a',
                            granularity: 'day',
                            points: [],
                            totals: {
                                upBytes: 1024,
                                downBytes: 3072,
                                totalBytes: 4096,
                            },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit?tab=traffic' });

        expect(await screen.findByText('周活跃账号')).toBeInTheDocument();
        await waitFor(() => {
            expect(requestedUrls.some((url) => url.startsWith('/traffic/overview?') && url.includes('days=30'))).toBe(true);
            expect(requestedUrls.some((url) => url.startsWith('/traffic/overview?') && url.includes('windows=7%2C30'))).toBe(true);
            expect(requestedUrls.some((url) => url.startsWith('/traffic/users/alice%40example.com/trend?') && url.includes('days=30'))).toBe(true);
            expect(requestedUrls.some((url) => url.startsWith('/traffic/servers/server-a/trend?') && url.includes('days=30'))).toBe(true);
        });
        expect(screen.getAllByText('流量统计').length).toBeGreaterThan(1);
        expect(screen.getAllByText('先看近 30 天流量和周/月活跃账号，再下钻到用户趋势、节点趋势和排行榜。').length).toBeGreaterThan(1);
        expect(screen.getByText('周活跃账号')).toBeInTheDocument();
        expect(screen.getByText('月活跃账号')).toBeInTheDocument();
        expect(screen.getByText('当前所选用户 · 最近 30 天趋势')).toBeInTheDocument();
        expect(screen.getByText('当前所选节点 · 最近 30 天趋势')).toBeInTheDocument();
        expect(screen.getAllByText('alice · alice@example.com').length).toBeGreaterThan(0);
        expect(screen.queryByText(/masked\.local/)).not.toBeInTheDocument();
    });

    it('switches audit event and actor labels with the selected locale', async () => {
        window.localStorage.setItem('nms_locale', 'en-US');

        api.get.mockImplementation((url) => {
            if (url.startsWith('/audit/events?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    id: 'event-en-1',
                                    ts: '2026-03-13T10:00:00.000Z',
                                    eventType: 'user_subscription_provisioned',
                                    outcome: 'success',
                                    actor: 'anonymous',
                                    actorRole: 'anonymous',
                                    details: {
                                        email: 'alice@example.com',
                                    },
                                },
                            ],
                            total: 1,
                            page: 1,
                            totalPages: 1,
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit' });

        expect(await screen.findByText('Subscription Provisioned')).toBeInTheDocument();
        expect(screen.getByText('Anonymous Request')).toBeInTheDocument();
        expect(screen.queryByText('user_subscription_provisioned')).not.toBeInTheDocument();
        expect(screen.queryByText(/^anonymous$/)).not.toBeInTheDocument();
    });

    it('renders audit events as stacked cards on mobile', async () => {
        mockMatchMedia(true);

        api.get.mockImplementation((url) => {
            if (url.startsWith('/audit/events?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    id: 'event-mobile-1',
                                    ts: '2026-03-13T10:00:00.000Z',
                                    eventType: 'login_success',
                                    outcome: 'success',
                                    actor: 'review-admin',
                                    serverId: 'server-a',
                                    details: {
                                        email: 'alice@example.com',
                                    },
                                },
                            ],
                            total: 1,
                            page: 1,
                            totalPages: 1,
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit' });

        expect(await screen.findByText('登录成功')).toBeInTheDocument();
        expect(document.querySelector('.audit-mobile-card')).toBeTruthy();
        expect(document.querySelector('.audit-events-table')).toBeFalsy();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument();
    });
});
