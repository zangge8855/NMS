import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import Capabilities from './Capabilities.jsx';
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
    },
}));

describe('Capabilities', () => {
    beforeEach(() => {
        api.get.mockReset();
        useServer.mockReset();
    });

    it('treats global view as no selected node and skips capability requests', () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
        });

        renderWithRouter(<Capabilities />);

        expect(screen.getByRole('heading', { name: '3x-ui 能力' })).toBeInTheDocument();
        expect(screen.getByText('请先选择一台服务器')).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });

    it('loads capability data for a concrete node and shows the compact toolbar summary', async () => {
        useServer.mockReturnValue({
            activeServerId: 'server-a',
        });
        api.get.mockResolvedValue({
            data: {
                obj: {
                    protocolDetails: [
                        { key: 'vless', label: 'VLESS', legacyKeys: [] },
                    ],
                    tools: {
                        cert: {
                            key: 'cert',
                            label: '证书检查',
                            description: '检查证书状态',
                            available: true,
                            status: 'integrated',
                            source: 'probed',
                            uiActionLabel: '节点工具',
                        },
                    },
                    systemModules: [
                        {
                            key: 'clients',
                            label: '用户管理',
                            supportedBy3xui: true,
                            status: 'integrated',
                            uiActionLabel: '控制台',
                            note: '可直接使用',
                            docs: 'https://example.com/docs',
                        },
                    ],
                    batchActions: {
                        clients: ['enable'],
                        inbounds: ['resetTraffic'],
                    },
                    subscriptionModes: ['native'],
                },
            },
        });

        renderWithRouter(<Capabilities />);

        expect(await screen.findByText('协议 1 · 工具 1')).toBeInTheDocument();
        expect(screen.getByText('证书检查')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('/capabilities/server-a');
    });
});
