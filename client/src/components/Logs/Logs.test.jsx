import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Logs from './Logs.jsx';
import toast from 'react-hot-toast';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('Logs', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        api.get.mockReset();
        useServer.mockReset();
        toast.error.mockReset();
        toast.success.mockReset();
    });

    it('renders the cached single-server logs before the live request finishes', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:logs_viewer_v1:server-a:panel', JSON.stringify({
            savedAt: Date.now(),
            value: {
                logs: [
                    {
                        line: '2026-03-24T00:00:00Z [info] cached log line',
                        serverName: 'Node A',
                    },
                ],
                fetchSummary: null,
            },
        }));

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        api.get.mockImplementation(() => new Promise(() => {}));

        renderWithRouter(<Logs embedded />);

        expect(await screen.findByText(/cached log line/)).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('/servers/server-a/logs', expect.objectContaining({
            params: expect.objectContaining({
                source: 'panel',
                count: 100,
            }),
        }));
    });

    it('always uses panel logs in global mode', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        });
        api.get.mockResolvedValue({
            data: {
                obj: {
                    items: [
                        {
                            serverId: 'server-a',
                            serverName: 'Node A',
                            lines: ['2026-03-09T00:00:00Z first line'],
                            supported: true,
                        },
                        {
                            serverId: 'server-b',
                            serverName: 'Node B',
                            lines: ['2026-03-09T00:00:01Z second line'],
                            supported: true,
                        },
                    ],
                },
            },
        });

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(1);
        });

        expect(api.get).toHaveBeenCalledWith('/servers/logs/snapshot', expect.objectContaining({
            params: expect.objectContaining({
                serverIds: 'server-a,server-b',
                source: 'panel',
            }),
        }));
    });

    it('shows a selection hint when no global server is available', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            activeServer: null,
            servers: [],
        });

        renderWithRouter(<Logs embedded />);

        expect(await screen.findByText('请至少选择一个节点后再查看聚合日志')).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });

    it('allows clearing all servers and then selecting a single server in global mode', async () => {
        const user = userEvent.setup();

        useServer.mockReturnValue({
            activeServerId: 'global',
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        });

        api.get.mockImplementation((url, options) => {
            const requested = String(options?.params?.serverIds || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            return Promise.resolve({
                data: {
                    obj: {
                        items: requested.map((serverId) => ({
                            serverId,
                            serverName: serverId === 'server-a' ? 'Node A' : 'Node B',
                            lines: [`2026-03-09T00:00:00Z ${serverId}`],
                            supported: true,
                        })),
                    },
                },
            });
        });

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(1);
        });

        await user.click(screen.getByRole('button', { name: '清空' }));

        expect(await screen.findByText('请至少选择一个节点后再查看聚合日志')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledTimes(1);

        await user.click(screen.getByLabelText('Node A'));

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(2);
        });
        expect(api.get).toHaveBeenLastCalledWith('/servers/logs/snapshot', expect.objectContaining({
            params: expect.objectContaining({
                serverIds: 'server-a',
                source: 'panel',
            }),
        }));
    });

    it('filters log lines by level in single-server mode', async () => {
        const user = userEvent.setup();

        useServer.mockReturnValue({
            activeServerId: 'server-a',
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        api.get.mockResolvedValue({
            data: {
                obj: {
                    lines: [
                        '2026-03-09T00:00:00Z [info] service started',
                        '2026-03-09T00:00:01Z [error] upstream failed',
                    ],
                    supported: true,
                },
            },
        });

        renderWithRouter(<Logs embedded />);

        expect(await screen.findByText(/service started/)).toBeInTheDocument();
        expect(screen.getByText(/upstream failed/)).toBeInTheDocument();

        await user.selectOptions(screen.getByDisplayValue('全部级别'), 'error');

        await waitFor(() => {
            expect(screen.queryByText(/service started/)).not.toBeInTheDocument();
            expect(screen.getByText(/upstream failed/)).toBeInTheDocument();
        });
    });

    it('keeps the page usable when the single-node logs endpoint returns an error snapshot', async () => {
        useServer.mockReturnValue({
            activeServerId: 'server-a',
            activeServer: { id: 'server-a', name: 'Node A' },
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        api.get.mockResolvedValue({
            data: {
                obj: {
                    serverId: 'server-a',
                    serverName: 'Node A',
                    source: 'panel',
                    count: 100,
                    supported: false,
                    warning: '',
                    sourcePath: '',
                    lines: [],
                    error: {
                        status: 502,
                        code: 'PANEL_LOGIN_FAILED',
                        message: '节点面板暂时不可达',
                    },
                },
            },
        });

        renderWithRouter(<Logs embedded />);

        expect(await screen.findByText('Panel 日志 加载失败：节点面板暂时不可达')).toBeInTheDocument();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('ignores stale global log results after the selection changes', async () => {
        const user = userEvent.setup();
        let globalRequestCount = 0;
        let resolveInitialLogs;

        useServer.mockReturnValue({
            activeServerId: 'global',
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        });
        api.get.mockImplementation((url, options) => {
            if (url !== '/servers/logs/snapshot') {
                throw new Error(`Unexpected GET ${url}`);
            }

            globalRequestCount += 1;
            const serverIds = String(options?.params?.serverIds || '');
            if (globalRequestCount === 1) {
                return new Promise((resolve) => {
                    resolveInitialLogs = resolve;
                });
            }
            if (serverIds === 'server-a') {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    serverId: 'server-a',
                                    serverName: 'Node A',
                                    lines: ['2026-03-09T00:00:00Z [info] fresh node-a line'],
                                    supported: true,
                                },
                            ],
                        },
                    },
                });
            }

            throw new Error(`Unexpected serverIds ${serverIds}`);
        });

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(1);
        });

        await user.click(screen.getByRole('button', { name: '清空' }));
        await user.click(screen.getByLabelText('Node A'));

        expect(await screen.findByText(/fresh node-a line/)).toBeInTheDocument();

        resolveInitialLogs({
            data: {
                obj: {
                    items: [
                        {
                            serverId: 'server-a',
                            serverName: 'Node A',
                            lines: ['2026-03-09T00:00:00Z [info] stale node-a line'],
                            supported: true,
                        },
                        {
                            serverId: 'server-b',
                            serverName: 'Node B',
                            lines: ['2026-03-09T00:00:01Z [warning] stale node-b line'],
                            supported: true,
                        },
                    ],
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByText(/fresh node-a line/)).toBeInTheDocument();
            expect(screen.queryByText(/stale node-a line/)).not.toBeInTheDocument();
            expect(screen.queryByText(/stale node-b line/)).not.toBeInTheDocument();
        });
    });

    it('shows the backend error message instead of a raw axios 502 in global mode', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
            ],
        });
        api.get.mockRejectedValue({
            response: {
                status: 502,
                data: {
                    msg: '节点日志聚合失败',
                },
            },
            message: 'Request failed with status code 502',
        });

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('获取全局日志失败: 节点日志聚合失败');
        });
    });
});
