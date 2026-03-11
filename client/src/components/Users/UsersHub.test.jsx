import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import UsersHub from './UsersHub.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
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

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../UI/SkeletonTable.jsx', () => ({
    default: () => <div>loading</div>,
}));

vi.mock('../UI/EmptyState.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('../Subscriptions/SubscriptionClientLinks.jsx', () => ({
    default: () => null,
}));

vi.mock('qrcode.react', () => ({
    QRCodeSVG: () => null,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('UsersHub ordering', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.put.mockReset();
        api.delete.mockReset();
        useServer.mockReset();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'user-a',
                                username: 'alice',
                                email: 'alice@example.com',
                                subscriptionEmail: 'alice@example.com',
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-10T00:00:00.000Z',
                            },
                            {
                                id: 'user-b',
                                username: 'bob',
                                email: 'bob@example.com',
                                subscriptionEmail: 'bob@example.com',
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-09T00:00:00.000Z',
                            },
                        ],
                    },
                });
            }
            if (url === '/system/users/order') {
                return Promise.resolve({
                    data: {
                        obj: ['user-a', 'user-b'],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        api.put.mockResolvedValue({
            data: {
                obj: {
                    userIds: ['user-b', 'user-a'],
                },
            },
        });
    });

    it('persists a new user order from the numeric sequence input', async () => {
        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        const orderInput = within(aliceRow).getByRole('spinbutton', { name: /设置 alice 的排序序号/ });
        await act(async () => {
            fireEvent.change(orderInput, { target: { value: '2' } });
            fireEvent.blur(orderInput);
        });

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/users/order', {
                userIds: ['user-b', 'user-a'],
            });
        });
    });
});
