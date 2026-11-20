import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { useServer } from '../../contexts/ServerContext';
import { renderWithRouter } from '../../test/render';
import { invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache';
import Inbounds from './Inbounds';

const confirmMock = vi.fn();

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/ConfirmContext', () => ({
    useConfirm: () => confirmMock,
}));

vi.mock('../Layout/Header', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('./InboundModal', () => ({
    default: () => null,
}));

vi.mock('../Clients/ClientModal', () => ({
    default: () => null,
}));

vi.mock('../Batch/BatchResultModal', () => ({
    default: () => null,
}));

vi.mock('../UI/ModalShell', () => ({
    default: ({ children }) => <div>{children}</div>,
    acquireModalStackSlot: () => ({ isTopmost: () => true, release: () => {} }),
}));

vi.mock('../UI/EmptyState', () => ({
    default: ({ title, subtitle, action }) => (
        <div>
            <div>{title}</div>
            {subtitle ? <div>{subtitle}</div> : null}
            {action}
        </div>
    ),
}));

vi.mock('../UI/SkeletonTable', () => ({
    default: () => <div data-testid="skeleton-table" />,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

function renderInbounds() {
    return render(
        <MemoryRouter
            initialEntries={['/']}
        >
            <LanguageProvider>
                <Inbounds />
            </LanguageProvider>
        </MemoryRouter>
    );
}

describe('Inbounds', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        invalidateServerPanelDataCache();
        window.matchMedia.mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
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

    it('renders the cached inbound snapshot before the live requests finish', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:inbounds_page_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                inbounds: [
                    {
                        id: 1,
                        remark: 'Cached Inbound',
                        protocol: 'vless',
                        listen: '0.0.0.0',
                        port: 443,
                        enable: true,
                        up: 1024,
                        down: 2048,
                        serverId: 'server-a',
                        serverName: 'Node A',
                        uiKey: 'server-a-1',
                        clients: [],
                        onlineSessionCount: 0,
                        onlineUserCount: 0,
                        hasOnlineUsers: false,
                        trafficUp: 1024,
                        trafficDown: 2048,
                        settings: JSON.stringify({ clients: [] }),
                    },
                ],
                inboundOrder: {
                    'server-a': ['1'],
                },
                serverOrder: ['server-a'],
                overrideKeys: [],
            },
        }));

        api.get.mockImplementation(() => new Promise(() => {}));
        api.post.mockImplementation(() => new Promise(() => {}));

        renderWithRouter(<Inbounds />);

        expect(await screen.findByText('Cached Inbound')).toBeInTheDocument();
        expect(screen.queryByTestId('skeleton-table')).not.toBeInTheDocument();
    });

    it('shows only the client count in the summary and exposes per-user online status', async () => {
        const user = userEvent.setup();
        const { container } = renderWithRouter(<Inbounds />);

        const inboundName = await screen.findByText('Main Inbound');
        expect(container.querySelector('.inbounds-table')).toBeTruthy();
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
        expect(within(aliceRow).getByRole('button', { name: '限制' })).toBeInTheDocument();
        expect(within(aliceRow).queryByText('限定策略')).not.toBeInTheDocument();

        await user.click(within(aliceRow).getByRole('button', { name: '操作菜单' }));
        expect(await screen.findByRole('menuitem', { name: /禁用/ })).toBeInTheDocument();

        expect(within(bobRow).getByText('离线')).toBeInTheDocument();
        await user.click(within(bobRow).getByRole('button', { name: '操作菜单' }));
        expect(await screen.findByRole('menuitem', { name: /启用/ })).toBeInTheDocument();
    });

    it('renders a standalone empty state when the current scope has no inbounds', async () => {
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
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Inbounds />);

        expect(await screen.findByText('暂无入站规则')).toBeInTheDocument();
        expect(screen.getByText('当前筛选范围内没有可管理的入站配置')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: '添加入站' })).toHaveLength(2);
        expect(screen.queryByRole('columnheader', { name: '备注' })).not.toBeInTheDocument();
    });

    it('renders compact user cards instead of the wide user table on mobile', async () => {
        window.matchMedia.mockImplementation((query) => ({
            matches: query.includes('max-width: 768px'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        const user = userEvent.setup();
        const { container } = renderWithRouter(<Inbounds />);

        const inboundName = await screen.findByText('Main Inbound');
        const summaryRow = inboundName.closest('tr');
        if (!summaryRow) throw new Error('Missing inbound summary row');
        await user.click(summaryRow);

        const aliceCard = (await screen.findByText('alice@example.com')).closest('.inbounds-client-mobile-card');
        if (!aliceCard) throw new Error('Missing Alice mobile card');

        expect(container.querySelector('.inbounds-clients-table')).toBeNull();
        expect(within(aliceCard).getByText('在线')).toBeInTheDocument();

        await user.click(within(aliceCard).getByRole('button', { name: '操作菜单' }));
        expect(await screen.findByRole('menuitem', { name: /禁用/ })).toBeInTheDocument();
    });

    it('prefers the expanded user-list traffic totals over stale inbound aggregate counters', async () => {
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
                            remark: 'Reset Inbound',
                            protocol: 'vless',
                            listen: '0.0.0.0',
                            port: 443,
                            enable: true,
                            up: 1024,
                            down: 2048,
                            settings: JSON.stringify({
                                clients: [
                                    { email: 'alice@example.com', id: 'alice-uuid', enable: true },
                                    { email: 'bob@example.com', id: 'bob-uuid', enable: true },
                                ],
                            }),
                            clientStats: [
                                { email: 'alice@example.com', id: 'alice-uuid', up: 0, down: 0 },
                                { email: 'bob@example.com', id: 'bob-uuid', up: 0, down: 0 },
                            ],
                        }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Inbounds />);

        const inboundName = await screen.findByText('Reset Inbound');
        const summaryRow = inboundName.closest('tr');
        if (!summaryRow) throw new Error('Missing inbound summary row');

        expect(within(summaryRow).getByText('↑0 B')).toBeInTheDocument();
        expect(within(summaryRow).getByText('↓0 B')).toBeInTheDocument();
    });

    it('shows visual sequence numbers in global view, hides duplicate node order inputs, and exposes node move buttons only once per server group', async () => {
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
        expect(within(mainRow).queryByRole('spinbutton', { name: '设置节点 Node A 的排序序号' })).not.toBeInTheDocument();
        expect(within(mainRow).getByRole('button', { name: '上移节点 Node A' })).toBeDisabled();
        expect(within(mainRow).getByRole('button', { name: '下移节点 Node A' })).toBeDisabled();
        expect(mainRow.querySelector('.inbounds-expand-cell .inbounds-node-order-actions')).toBeTruthy();
        expect(mainRow.querySelector('.inbounds-node-cell .inbounds-node-order-actions')).toBeFalsy();
        expect(within(backupRow).queryByRole('button', { name: '上移节点 Node A' })).not.toBeInTheDocument();
        expect(within(backupRow).queryByRole('button', { name: '下移节点 Node A' })).not.toBeInTheDocument();
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

    it('backfills selected existing inbounds to current users without changing subscription URLs', async () => {
        const user = userEvent.setup();
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
            if (url === '/batch/inbounds') {
                return Promise.resolve({
                    data: {
                        obj: {
                            summary: { success: 2, total: 2, failed: 0 },
                            results: [],
                            subscriptionSync: {
                                totalUsers: 2,
                                syncedUsers: 1,
                                skippedUsers: 1,
                                failedUsers: 0,
                            },
                        },
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<Inbounds />);

        const mainInbound = await screen.findByText('Main Inbound');
        const mainRow = mainInbound.closest('tr');
        if (!mainRow) throw new Error('Missing inbound row');

        await user.click(within(mainRow).getByRole('checkbox'));
        await user.click(screen.getAllByRole('button', { name: '补齐用户' })[0]);

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/batch/inbounds', {
                action: 'syncExistingUsers',
                targets: [{
                    serverId: 'server-a',
                    serverName: 'Node A',
                    id: 1,
                    remark: 'Main Inbound',
                    protocol: 'vless',
                    port: 443,
                }],
            });
        });
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
        expect(within(beforeRows[0]).getByRole('button', { name: '下移节点 Node A' })).toBeEnabled();
        expect(within(beforeRows[1]).queryByRole('button', { name: '下移节点 Node A' })).not.toBeInTheDocument();
        expect(within(beforeRows[2]).getByRole('button', { name: '上移节点 Node B' })).toBeEnabled();

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

    it('ignores stale inbound snapshots after the server inventory changes', async () => {
        const serverState = {
            servers: [{ id: 'server-a', name: 'Node A' }],
            activeServerId: undefined,
        };
        let resolveServerAList;

        useServer.mockImplementation(() => serverState);

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
                return new Promise((resolve) => {
                    resolveServerAList = resolve;
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

        const view = renderInbounds();

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/panel/server-a/panel/api/inbounds/list');
        });

        serverState.servers = [{ id: 'server-b', name: 'Node B' }];
        view.rerender(
            <MemoryRouter
                initialEntries={['/']}
            >
                <LanguageProvider>
                    <Inbounds />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(await screen.findByText('Beta Inbound')).toBeInTheDocument();

        resolveServerAList({
            data: {
                obj: [{
                    id: 1,
                    remark: 'Alpha Inbound',
                    protocol: 'vless',
                    listen: '0.0.0.0',
                    port: 443,
                    enable: true,
                    up: 0,
                    down: 0,
                    settings: JSON.stringify({ clients: [] }),
                }],
            },
        });

        await waitFor(() => {
            expect(screen.getByText('Beta Inbound')).toBeInTheDocument();
            expect(screen.queryByText('Alpha Inbound')).not.toBeInTheDocument();
        });
    });

    it('edits local NMS inbound remark independently per server without syncing to upstream panel and resets cleanly', async () => {
        const user = userEvent.setup();
        useServer.mockReturnValue({
            servers: [
                { id: 'server-v4', name: 'HK-IPv4' },
                { id: 'server-v6', name: 'HK-IPv6' },
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
            if (url === '/panel/server-v4/panel/api/inbounds/list' || url === '/panel/server-v6/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 1,
                            remark: 'Shared Inbound',
                            panelRemark: 'Shared Inbound',
                            hasCustomRemark: false,
                            protocol: 'vless',
                            listen: '0.0.0.0',
                            port: 443,
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
            if (url === '/panel/server-v4/panel/api/inbounds/onlines' || url === '/panel/server-v6/panel/api/inbounds/onlines') {
                return Promise.resolve({ data: { obj: [] } });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        api.put.mockImplementation((url, body: any) => {
            if (url === '/system/inbounds/remarks') {
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            serverId: body.serverId,
                            inboundId: String(body.inboundId),
                            remark: body.remark,
                            hasCustomRemark: Boolean(body.remark),
                        },
                    },
                });
            }
            throw new Error(`Unexpected PUT ${url}`);
        });

        renderInbounds();

        const rows = await screen.findAllByText('Shared Inbound');
        expect(rows).toHaveLength(2);

        const editButtons = screen.getAllByRole('button', { name: '编辑 Shared Inbound:443 的 NMS 本地备注' });
        await user.click(editButtons[0]);

        const input = screen.getByRole('textbox', { name: '编辑 Shared Inbound:443 的 NMS 本地备注' });
        await user.clear(input);
        await user.type(input, '香港-IPv4{enter}');

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/remarks', {
                serverId: 'server-v4',
                inboundId: 1,
                remark: '香港-IPv4',
            });
        });
        expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('/inbounds/update'), expect.anything());
        expect(screen.getByText('香港-IPv4')).toBeInTheDocument();
        expect(screen.getByText('NMS')).toBeInTheDocument();
        expect(screen.getByText('Shared Inbound')).toBeInTheDocument();

        // Reset back to upstream panel remark
        const updatedEditBtn = screen.getByRole('button', { name: '编辑 香港-IPv4:443 的 NMS 本地备注' });
        await user.click(updatedEditBtn);
        await user.click(screen.getByRole('button', { name: '恢复面板备注' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/remarks', {
                serverId: 'server-v4',
                inboundId: 1,
                remark: '',
            });
        });
        await waitFor(() => {
            expect(screen.getAllByText('Shared Inbound')).toHaveLength(2);
        });
        expect(screen.queryByText('NMS')).not.toBeInTheDocument();
    });

    it('toggles single-row and batch user visibility via /system/inbounds/visibility and displays the hidden badge', async () => {
        const user = userEvent.setup();
        api.put.mockImplementation((url, body: any) => {
            if (url === '/system/inbounds/visibility') {
                if (Array.isArray(body?.targets)) {
                    return Promise.resolve({
                        data: {
                            success: true,
                            obj: {
                                hidden: body.hidden,
                                updated: body.targets.map((target: any) => ({
                                    serverId: target.serverId,
                                    inboundId: String(target.inboundId),
                                    hidden: body.hidden,
                                })),
                            },
                        },
                    });
                }
                return Promise.resolve({
                    data: {
                        success: true,
                        obj: {
                            serverId: body.serverId,
                            inboundId: String(body.inboundId),
                            hidden: body.hidden,
                        },
                    },
                });
            }
            throw new Error(`Unexpected PUT ${url}`);
        });

        renderInbounds();

        const mainRow = (await screen.findByText('Main Inbound')).closest('tr');
        expect(mainRow).toBeTruthy();
        expect(within(mainRow!).queryByText('对用户隐藏')).not.toBeInTheDocument();

        // Hide single inbound from users via row actions dropdown
        await user.click(within(mainRow!).getByRole('button', { name: '操作菜单' }));
        await user.click(await screen.findByRole('menuitem', { name: '对用户隐藏' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/visibility', {
                serverId: 'server-a',
                inboundId: 1,
                hidden: true,
            });
        });
        expect(await within(mainRow!).findByText('对用户隐藏')).toBeInTheDocument();

        // Batch hide all rows on the page
        await user.click(screen.getByRole('checkbox', { name: '选择全部网关规则' }));
        await user.click(screen.getByRole('button', { name: '隐藏选中' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/visibility', {
                targets: [
                    { serverId: 'server-a', inboundId: 1 },
                    { serverId: 'server-a', inboundId: 2 },
                ],
                hidden: true,
            });
        });
        expect(await screen.findAllByText('对用户隐藏')).toHaveLength(2);

        // Select all again -> button flips to 显示选中 and restores visibility
        await user.click(screen.getByRole('checkbox', { name: '选择全部网关规则' }));
        await user.click(screen.getByRole('button', { name: '显示选中' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/system/inbounds/visibility', {
                targets: [
                    { serverId: 'server-a', inboundId: 1 },
                    { serverId: 'server-a', inboundId: 2 },
                ],
                hidden: false,
            });
        });
        await waitFor(() => {
            expect(screen.queryByText('对用户隐藏')).not.toBeInTheDocument();
        });
    });
});
