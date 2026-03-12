import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/render.jsx';
import Tools from './Tools.jsx';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
    },
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('Tools', () => {
    beforeEach(() => {
        api.get.mockReset();
        useServer.mockReset();
    });

    it('treats global view as no selected node and skips loading node tools', () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
        });

        renderWithRouter(<Tools />);

        expect(screen.getByRole('heading', { name: '节点工具' })).toBeInTheDocument();
        expect(screen.getByText('请先选择一台服务器')).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });

    it('loads supported tools for a node and can invoke a tool action', async () => {
        const panelApi = vi.fn().mockResolvedValue({
            data: {
                obj: { message: 'ok' },
            },
        });
        useServer.mockReturnValue({
            activeServerId: 'server-a',
            panelApi,
        });
        api.get.mockResolvedValue({
            data: {
                obj: {
                    tools: {
                        diag: {
                            key: 'diag',
                            label: '诊断工具',
                            description: '执行节点诊断',
                            uiAction: 'node_tools',
                            supportedByNms: true,
                            available: true,
                            path: '/panel/api/tools/diag',
                            method: 'get',
                        },
                    },
                },
            },
        });

        const user = userEvent.setup();
        renderWithRouter(<Tools />);

        expect(await screen.findByText('节点工具集')).toBeInTheDocument();
        expect(screen.getByText('诊断工具')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /生成/ }));

        expect(panelApi).toHaveBeenCalledWith('get', '/panel/api/tools/diag');
        expect(await screen.findByText(/message/)).toBeInTheDocument();
    });
});
