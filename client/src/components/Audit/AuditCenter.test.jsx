import React from 'react';
import { screen, waitFor } from '@testing-library/react';
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
    useConfirm: () => vi.fn(),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('../Tasks/Tasks.jsx', () => ({
    default: () => <div>Tasks</div>,
}));

vi.mock('../Logs/Logs.jsx', () => ({
    default: () => <div>Logs</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('AuditCenter', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.delete.mockReset();
        api.get.mockImplementation((url) => {
            if (String(url).startsWith('/audit/events?')) {
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
            if (String(url).startsWith('/subscriptions/access/summary?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            total: 1,
                            uniqueIpCount: 1,
                            uniqueUsers: 1,
                            statusBreakdown: { success: 1 },
                            topIps: [{ ip: '203.0.113.9', count: 1 }],
                            from: '',
                            to: '',
                        },
                    },
                });
            }
            if (String(url).startsWith('/subscriptions/access?')) {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [{
                                id: 'access-1',
                                ts: '2026-03-11T10:00:00.000Z',
                                email: 'user@example.com',
                                username: 'alice',
                                userLabel: 'alice',
                                status: 'success',
                                clientIp: '203.0.113.9',
                                proxyIp: '172.16.0.10',
                                ipSource: 'x-forwarded-for',
                                cfCountry: 'US',
                                userAgent: 'Clash.Meta',
                            }],
                            total: 1,
                            page: 1,
                            totalPages: 1,
                            statusBreakdown: { success: 1 },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });
    });

    it('shows only the real IP column in subscription access records', async () => {
        const user = userEvent.setup();

        renderWithRouter(<AuditCenter />);

        await user.click(screen.getByRole('button', { name: '订阅访问' }));

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/subscriptions/access?page=1&pageSize=30');
            expect(api.get).toHaveBeenCalledWith('/subscriptions/access/summary?page=1&pageSize=30');
        });

        expect(await screen.findByRole('columnheader', { name: '真实 IP' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: '代理 IP' })).not.toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: '用户' })).toBeInTheDocument();
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
        expect(screen.queryByText('172.16.0.10')).not.toBeInTheDocument();
    });
});
