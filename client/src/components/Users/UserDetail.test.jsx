import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { renderWithRouter } from '../../test/render.jsx';
import UserDetail from './UserDetail.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
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

describe('UserDetail', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.put.mockReset();
        api.post.mockReset();
        api.delete.mockReset();

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
        expect(within(timelineRow).getByText(/IP: 203.0.113.8/)).toBeInTheDocument();
        expect(within(timelineRow).getByText(/地区 中国 浙江 杭州/)).toBeInTheDocument();
        expect(within(timelineRow).getByText(/运营商 中国电信/)).toBeInTheDocument();
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
            if (url === '/servers') {
                return Promise.resolve({
                    data: {
                        obj: [],
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

        expect(await screen.findByText('订阅地址')).toBeInTheDocument();
        expect(screen.getByDisplayValue('https://sub.example.com/v2rayn')).toBeInTheDocument();
        expect(screen.getByText('subscription-client-links')).toBeInTheDocument();
        expect(screen.getByText('qr-code')).toBeInTheDocument();
    });

    it('uses node wording for the node tab and empty state', async () => {
        const user = userEvent.setup();

        renderWithRouter(<UserDetail />);

        await screen.findByText('用户详情 · alice');
        await user.click(screen.getByRole('button', { name: '节点' }));

        expect(await screen.findByText('暂无节点记录')).toBeInTheDocument();
        expect(screen.queryByText('暂无客户端')).not.toBeInTheDocument();
    });
});
