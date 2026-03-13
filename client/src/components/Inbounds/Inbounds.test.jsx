import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('../UI/SkeletonTable.jsx', () => ({
    default: () => <div data-testid="skeleton-table" />,
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
            activeServerId: undefined,
        });

        api.get.mockImplementation((url) => {
            if (url === '/system/inbounds/order') {
                return Promise.resolve({ data: { obj: {} } });
            }
            if (url === '/system/servers/order') {
                return Promise.resolve({ data: { obj: [] } });
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

    it('shows visual sequence numbers in global view, hides inbound reorder controls, and exposes node order controls only once per server group', async () => {
        renderWithRouter(<Inbounds />);

        const mainInbound = await screen.findByText('Main Inbound');
        const backupInbound = await screen.findByText('Backup Inbound');
        const mainRow = mainInbound.closest('tr');
        const backupRow = backupInbound.closest('tr');
        if (!mainRow || !backupRow) throw new Error('Missing inbound summary row');

        expect(mainRow.querySelector('.inbounds-sequence-number')).toHaveTextContent('1');
        expect(backupRow.querySelector('.inbounds-sequence-number')).toHaveTextContent('2');
        expect(within(mainRow).queryByLabelText('设置 Main Inbound:443 的排序序号')).not.toBeInTheDocument();
        expect(within(backupRow).queryByLabelText('设置 Backup Inbound:8443 的排序序号')).not.toBeInTheDocument();
        expect(within(mainRow).getByRole('spinbutton', { name: '设置节点 Node A 的排序序号' })).toHaveValue(1);
        expect(within(backupRow).queryByRole('spinbutton', { name: '设置节点 Node A 的排序序号' })).not.toBeInTheDocument();
    });

    it('treats the global server context as all nodes and keeps the node column visible', async () => {
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
            activeServerId: 'global',
        });

        renderWithRouter(<Inbounds />);

        const serverFilter = screen.getByRole('combobox');
        expect(await screen.findByText('Main Inbound')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: '节点' })).toBeInTheDocument();
        expect(serverFilter).not.toBeDisabled();
        expect(serverFilter).toHaveValue('all');
    });

    it('allows row expansion even when batch selection is active', async () => {
        const user = userEvent.setup();
        renderWithRouter(<Inbounds />);

        const mainInbound = await screen.findByText('Main Inbound');
        const mainRow = mainInbound.closest('tr');
        if (!mainRow) throw new Error('Missing inbound row');

        await user.click(within(mainRow).getByRole('checkbox'));
        await user.click(mainRow);

        expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    });

    it('shows manual order controls for a selected node and persists numeric ordering changes', async () => {
        const user = userEvent.setup();
        renderWithRouter(<Inbounds />);

        await user.selectOptions(screen.getByRole('combobox'), 'server-a');

        await screen.findByLabelText('下移 Main Inbound:443 的序号');
        const moveUpButton = screen.getByLabelText('上移 Backup Inbound:8443 的序号');
        const mainOrderInput = screen.getByRole('spinbutton', { name: '设置 Main Inbound:443 的排序序号' });
        const backupOrderInput = screen.getByRole('spinbutton', { name: '设置 Backup Inbound:8443 的排序序号' });

        expect(moveUpButton).toBeEnabled();
        expect(mainOrderInput).toHaveValue(1);
        expect(backupOrderInput).toHaveValue(2);

        fireEvent.change(mainOrderInput, { target: { value: '2' } });
        fireEvent.blur(mainOrderInput);

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/order', {
                serverId: 'server-a',
                inboundIds: ['2', '1'],
            });
        });

        await waitFor(() => {
            expect(screen.getByRole('spinbutton', { name: '设置 Main Inbound:443 的排序序号' })).toHaveValue(2);
            expect(screen.getByRole('spinbutton', { name: '设置 Backup Inbound:8443 的排序序号' })).toHaveValue(1);
        });
    });

    it('persists manual node ordering in global view', async () => {
        const user = userEvent.setup();
        useServer.mockReturnValue({
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
            activeServerId: undefined,
        });

        api.get.mockImplementation((url) => {
            if (url === '/system/inbounds/order') {
                return Promise.resolve({ data: { obj: {} } });
            }
            if (url === '/system/servers/order') {
                return Promise.resolve({ data: { obj: [] } });
            }
            if (url === '/clients/entitlement-overrides') {
                return Promise.resolve({ data: { obj: [] } });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 1,
                                remark: 'Alpha Inbound',
                                protocol: 'vless',
                                listen: '0.0.0.0',
                                port: 443,
                                enable: true,
                                up: 0,
                                down: 0,
                                settings: JSON.stringify({ clients: [] }),
                            },
                            {
                                id: 2,
                                remark: 'Alpha Backup',
                                protocol: 'vmess',
                                listen: '0.0.0.0',
                                port: 8443,
                                enable: true,
                                up: 0,
                                down: 0,
                                settings: JSON.stringify({ clients: [] }),
                            },
                        ],
                    },
                });
            }
            if (url === '/panel/server-b/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 9,
                            remark: 'Beta Inbound',
                            protocol: 'vmess',
                            listen: '0.0.0.0',
                            port: 8443,
                            enable: true,
                            up: 0,
                            down: 0,
                            settings: JSON.stringify({ clients: [] }),
                        }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines' || url === '/panel/server-b/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [],
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

        const { container } = renderWithRouter(<Inbounds />);

        await screen.findByText('Alpha Inbound');
        await screen.findByText('Beta Inbound');
        await screen.findByText('Alpha Backup');

        const beforeRows = container.querySelectorAll('tbody > tr.inbounds-row');
        expect(within(beforeRows[0]).getByText(/Node A/)).toBeInTheDocument();
        expect(within(beforeRows[1]).getByText(/Node A/)).toBeInTheDocument();
        expect(within(beforeRows[2]).getByText(/Node B/)).toBeInTheDocument();
        expect(within(beforeRows[0]).getByRole('spinbutton', { name: '设置节点 Node A 的排序序号' })).toHaveValue(1);
        expect(within(beforeRows[1]).queryByRole('spinbutton', { name: '设置节点 Node A 的排序序号' })).not.toBeInTheDocument();
        expect(within(beforeRows[2]).getByRole('spinbutton', { name: '设置节点 Node B 的排序序号' })).toHaveValue(2);

        await user.click(screen.getByRole('button', { name: '上移节点 Node B' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/servers/order', {
                serverIds: ['server-b', 'server-a'],
            });
        });

        await waitFor(() => {
            const afterRows = container.querySelectorAll('tbody > tr.inbounds-row');
            expect(within(afterRows[0]).getByText(/Node B/)).toBeInTheDocument();
            expect(within(afterRows[1]).getByText(/Node A/)).toBeInTheDocument();
            expect(within(afterRows[2]).getByText(/Node A/)).toBeInTheDocument();
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
