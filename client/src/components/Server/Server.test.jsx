import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import ServerManagement from './Server.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';

const { apiMock } = vi.hoisted(() => {
    const fn = vi.fn();
    fn.get = vi.fn();
    fn.post = vi.fn();
    return { apiMock: fn };
});

vi.mock('../../api/client.js', () => ({
    default: apiMock,
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('../UI/ModalShell.jsx', () => ({
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('ServerManagement', () => {
    beforeEach(() => {
        apiMock.mockReset();
        apiMock.get.mockReset();
        apiMock.post.mockReset();
        useServer.mockReset();
    });

    it('shows an empty state when no server is selected', () => {
        useServer.mockReturnValue({
            activeServerId: null,
            panelApi: vi.fn(),
            servers: [],
        });

        renderWithRouter(<ServerManagement />);

        expect(screen.getByRole('heading', { name: '节点控制台' })).toBeInTheDocument();
        expect(screen.getByText('请先选择一台服务器')).toBeInTheDocument();
    });

    it('shows the compact toolbar context in global view and probes versions from the first target', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        apiMock.mockImplementation(({ url, method }) => {
            if (method === 'get' && url === '/panel/server-a/panel/api/server/getXrayVersion') {
                return Promise.resolve({ data: { obj: ['1.8.0'] } });
            }
            throw new Error(`Unexpected ${method || 'request'} ${url}`);
        });

        renderWithRouter(<ServerManagement />);

        expect(await screen.findByText('批量控制模式')).toBeInTheDocument();
        expect(screen.getByText('节点控制工作台')).toBeInTheDocument();
        expect(screen.getByText('集中查看当前作用域，并执行 Xray、Geo、备份与节点工具相关操作。')).toBeInTheDocument();
        expect(screen.getByText('当前作用域')).toBeInTheDocument();
        expect(screen.getByText('1 台节点')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '1.8.0' })).toBeInTheDocument();
    });

    it('renders without the standalone header when embedded inside settings', async () => {
        useServer.mockReturnValue({
            activeServerId: 'global',
            panelApi: vi.fn(),
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        apiMock.mockImplementation(({ url, method }) => {
            if (method === 'get' && url === '/panel/server-a/panel/api/server/getXrayVersion') {
                return Promise.resolve({ data: { obj: ['1.8.0'] } });
            }
            throw new Error(`Unexpected ${method || 'request'} ${url}`);
        });

        renderWithRouter(<ServerManagement embedded />);

        expect(await screen.findByText('批量控制模式')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: '节点控制台' })).not.toBeInTheDocument();
    });
});
