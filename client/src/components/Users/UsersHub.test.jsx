import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

        api.put.mockResolvedValue({ data: { success: true } });
    });

    it('shows auto-increment sequence numbers instead of an editable order input', async () => {
        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        expect(within(aliceRow).queryByRole('spinbutton')).not.toBeInTheDocument();
        expect(within(aliceRow).getByText('1')).toBeInTheDocument();

        const bobCell = await screen.findByText('bob');
        const bobRow = bobCell.closest('tr');
        if (!bobRow) throw new Error('Missing Bob row');

        expect(within(bobRow).getByText('2')).toBeInTheDocument();
        expect(api.put).not.toHaveBeenCalledWith('/system/users/order', expect.anything());
    });

    it('toggles the displayed sequence direction without persisting user order', async () => {
        const user = userEvent.setup();
        const { container } = renderWithRouter(<UsersHub />);

        await screen.findByText('alice');

        const beforeRows = container.querySelectorAll('tbody tr');
        expect(within(beforeRows[0]).getByText('alice')).toBeInTheDocument();
        expect(within(beforeRows[0]).getByText('1')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '按序号降序显示' }));

        const afterRows = container.querySelectorAll('tbody tr');
        expect(within(afterRows[0]).getByText('bob')).toBeInTheDocument();
        expect(within(afterRows[0]).getByText('2')).toBeInTheDocument();
        expect(api.put).not.toHaveBeenCalledWith('/system/users/order', expect.anything());
    });

    it('aggregates used traffic from inbound clientStats instead of raw settings only', async () => {
        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'user-a',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                            enabled: true,
                            createdAt: '2026-03-10T00:00:00.000Z',
                        }],
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
                            settings: JSON.stringify({
                                clients: [{
                                    id: 'uuid-1',
                                    email: 'alice@example.com',
                                }],
                            }),
                            clientStats: [{
                                id: 'uuid-1',
                                email: 'alice@example.com',
                                up: 10,
                                down: 20,
                            }],
                        }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        expect(within(aliceRow).getByText('30 B')).toBeInTheDocument();
        expect(within(aliceRow).getByText(/ID user-a/i)).toBeInTheDocument();
        expect(within(aliceRow).getByRole('button', { name: '查看订阅' })).toBeInTheDocument();
        expect(within(aliceRow).queryByText('订阅链接')).not.toBeInTheDocument();
    });
});
