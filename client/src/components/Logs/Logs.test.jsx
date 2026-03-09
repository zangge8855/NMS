import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Logs from './Logs.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        post: vi.fn(),
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
        api.post.mockReset();
        useServer.mockReset();
    });

    it('always uses panel logs in global mode', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
        });
        api.post.mockResolvedValue({
            data: {
                obj: '2026-03-09T00:00:00Z first line\n',
            },
        });

        renderWithRouter(<Logs embedded />);

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledTimes(2);
        });

        const urls = api.post.mock.calls.map(([url]) => url);
        expect(urls).toContain('/panel/server-a/panel/api/server/log');
        expect(urls).toContain('/panel/server-b/panel/api/server/log');
        expect(urls.some((url) => url.includes('/server/api/server/log'))).toBe(false);
    });

    it('shows a selection hint when no global server is available', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            activeServer: null,
            servers: [],
        });

        renderWithRouter(<Logs embedded />);

        expect(await screen.findByText('请至少选择一个节点后再查看聚合日志')).toBeInTheDocument();
        expect(api.post).not.toHaveBeenCalled();
    });
});
