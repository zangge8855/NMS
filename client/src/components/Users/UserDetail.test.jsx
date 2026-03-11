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
                                        cfCountry: 'CN',
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
        await user.click(screen.getByRole('button', { name: '活动日志' }));

        const timelineItem = await screen.findByText('Token token-1');
        const timelineRow = timelineItem.closest('.timeline-item');
        if (!timelineRow) throw new Error('Missing timeline row');

        expect(within(timelineRow).getByText('成功')).toBeInTheDocument();
        expect(within(timelineRow).queryByText('失败')).not.toBeInTheDocument();
        expect(within(timelineRow).getByText(/IP: 203.0.113.8/)).toBeInTheDocument();
    });
});
