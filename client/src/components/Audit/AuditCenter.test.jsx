import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
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

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('AuditCenter localization', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.delete.mockReset();
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
        expect(screen.getByRole('option', { name: '成功' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '失败' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '信息' })).toBeInTheDocument();

        const successBadge = screen.getAllByText('成功').find((node) => node.className.includes('badge'));
        expect(successBadge).toBeTruthy();
        expect(screen.queryByText('success')).not.toBeInTheDocument();
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
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<AuditCenter />, { route: '/audit?tab=subscriptions' });

        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('暂无访问记录')).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: '已撤销' })).toBeInTheDocument();

        const subscriptionsTable = document.querySelector('.audit-subscriptions-table');
        if (!subscriptionsTable) throw new Error('Missing subscriptions table');
        const tableUtils = within(subscriptionsTable);
        expect(tableUtils.getByText('已撤销')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getAllByText('已撤销').length).toBeGreaterThan(0);
        });
        expect(screen.queryByText('revoked')).not.toBeInTheDocument();
    });
});
