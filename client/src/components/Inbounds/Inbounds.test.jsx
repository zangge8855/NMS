import React from 'react';
import { fireEvent } from '@testing-library/react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Inbounds from './Inbounds.jsx';

const confirmMock = vi.fn();

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => confirmMock,
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('./InboundModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../Clients/ClientModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../Batch/BatchResultModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../UI/EmptyState.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('Inbounds', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.put.mockReset();
        confirmMock.mockReset();
        confirmMock.mockResolvedValue(true);
        useServer.mockReset();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/system/inbounds/order') {
                return Promise.resolve({ data: { obj: {} } });
            }
            if (url === '/clients/entitlement-overrides') {
                return Promise.resolve({ data: { obj: [] } });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 1,
                            remark: 'Main Inbound',
                            protocol: 'vless',
                            listen: '0.0.0.0',
                            port: 443,
                            enable: true,
                            up: 1024,
                            down: 2048,
                            settings: JSON.stringify({
                                clients: [
                                    { email: 'alice@example.com', id: 'alice-uuid', enable: true },
                                    { email: 'bob@example.com', id: 'bob-uuid', enable: false },
                                ],
                            }),
                        }, {
                            id: 2,
                            remark: 'Backup Inbound',
                            protocol: 'vmess',
                            listen: '0.0.0.0',
                            port: 8443,
                            enable: true,
                            up: 0,
                            down: 0,
                            settings: JSON.stringify({
                                clients: [],
                            }),
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
                        obj: ['alice@example.com'],
                    },
                });
            }
            if (url === '/system/batch-risk-token') {
                return Promise.resolve({
                    data: {
                        obj: { required: false },
                    },
                });
            }
            if (url === '/batch/clients') {
                return Promise.resolve({
                    data: {
                        obj: {
                            summary: { success: 1, total: 1, failed: 0 },
                            results: [],
                        },
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        api.put.mockResolvedValue({
            data: {
                obj: {
                    serverId: 'server-a',
                    inboundIds: ['2', '1'],
                },
            },
        });
    });

    it('shows only the client count in the summary and exposes per-user online status', async () => {
        const user = userEvent.setup();
        const { container } = renderWithRouter(<Inbounds />);

        const inboundName = await screen.findByText('Main Inbound');
        const summaryRow = inboundName.closest('tr');
        if (!summaryRow) throw new Error('Missing inbound summary row');

        expect(within(summaryRow).getByText('2')).toBeInTheDocument();
        expect(container.querySelector('.inbounds-usage-users')).toBeNull();

        await user.click(summaryRow);

        const aliceRow = (await screen.findByText('alice@example.com')).closest('tr');
        const bobRow = (await screen.findByText('bob@example.com')).closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');
        if (!bobRow) throw new Error('Missing Bob row');

        expect(within(aliceRow).getByText('在线')).toBeInTheDocument();
        expect(within(aliceRow).getByRole('button', { name: /禁用/ })).toBeInTheDocument();

        expect(within(bobRow).getByText('离线')).toBeInTheDocument();
        expect(within(bobRow).getByRole('button', { name: /启用/ })).toBeInTheDocument();
    });

    it('keeps only the drag handle for sorting and removes step move buttons', async () => {
        renderWithRouter(<Inbounds />);

        const inboundName = await screen.findByText('Main Inbound');
        const summaryRow = inboundName.closest('tr');
        if (!summaryRow) throw new Error('Missing inbound summary row');

        expect(within(summaryRow).getByRole('button', { name: '拖拽排序' })).toBeInTheDocument();
        expect(within(summaryRow).queryByRole('button', { name: '上移' })).not.toBeInTheDocument();
        expect(within(summaryRow).queryByRole('button', { name: '下移' })).not.toBeInTheDocument();
    });

    it('reorders inbounds by dragging the handle and persists the new order', async () => {
        renderWithRouter(<Inbounds />);

        const mainInbound = await screen.findByText('Main Inbound');
        const backupInbound = await screen.findByText('Backup Inbound');
        const sourceRow = mainInbound.closest('tr');
        const targetRow = backupInbound.closest('tr');
        if (!sourceRow || !targetRow) throw new Error('Missing inbound rows');

        const dataTransfer = {
            effectAllowed: 'move',
            dropEffect: 'move',
            setData: vi.fn(),
            getData: vi.fn(() => 'server-a-1'),
        };

        const handle = within(sourceRow).getByLabelText('拖拽排序');
        await act(async () => {
            fireEvent.dragStart(handle, { dataTransfer });
            fireEvent.dragEnter(targetRow, { dataTransfer });
            fireEvent.dragOver(targetRow, { dataTransfer });
            fireEvent.drop(targetRow, { dataTransfer });
            fireEvent.dragEnd(handle, { dataTransfer });
        });

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/order', {
                serverId: 'server-a',
                inboundIds: ['2', '1'],
            });
        });
    });

    it('supports bulk deleting clients inside an expanded inbound panel', async () => {
        const user = userEvent.setup();
        renderWithRouter(<Inbounds />);

        const inboundName = await screen.findByText('Main Inbound');
        const summaryRow = inboundName.closest('tr');
        if (!summaryRow) throw new Error('Missing inbound summary row');
        await user.click(summaryRow);

        const aliceRow = (await screen.findByText('alice@example.com')).closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');
        const panel = screen.getByText('用户列表 (2)').closest('.inbounds-clients-panel');
        if (!panel) throw new Error('Missing clients panel');

        const aliceCheckbox = within(aliceRow).getByRole('checkbox');
        await user.click(aliceCheckbox);
        await user.click(within(panel).getByRole('button', { name: /批量删除/ }));

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/batch/clients', {
                action: 'delete',
                targets: [{
                    serverId: 'server-a',
                    serverName: 'Node A',
                    inboundId: 1,
                    email: 'alice@example.com',
                    clientIdentifier: 'alice-uuid',
                    id: 'alice-uuid',
                    password: '',
                }],
            });
        });
    });
});
