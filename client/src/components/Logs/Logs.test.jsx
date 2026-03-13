import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Logs from './Logs.jsx';

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
        api.get.mockReset();
        useServer.mockReset();
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
                    lines: ['2026-03-09T00:00:00Z first line'],
                    supported: true,
                },
            },
        });

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(2);
        });

        const urls = api.get.mock.calls.map(([url]) => url);
        expect(urls).toContain('/servers/server-a/logs');
        expect(urls).toContain('/servers/server-b/logs');
        expect(api.get.mock.calls.every(([, options]) => options?.params?.source === 'panel')).toBe(true);
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

        api.get.mockImplementation((url) => Promise.resolve({
            data: {
                obj: {
                    lines: [`2026-03-09T00:00:00Z ${url}`],
                    supported: true,
                },
            },
        }));

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(2);
        });

        await user.click(screen.getByRole('button', { name: '清空' }));

        expect(await screen.findByText('请至少选择一个节点后再查看聚合日志')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledTimes(2);

        await user.click(screen.getByLabelText('Node A'));

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(3);
        });
        expect(api.get).toHaveBeenLastCalledWith('/servers/server-a/logs', expect.objectContaining({
            params: expect.objectContaining({
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
});
