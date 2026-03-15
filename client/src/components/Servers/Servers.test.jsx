import React from 'react';
import { screen, within } from '@testing-library/react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Servers from './Servers.jsx';

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
    default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null),
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

describe('Servers', () => {
    beforeEach(() => {
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
        useServer.mockReset();
    });

    it('renders long server names as a wrapping detail trigger without hiding nearby controls', async () => {
        const longName = '生产环境华东入口节点 - 超长服务器名称用于验证卡片标题换行显示且不遮挡旁边操作按钮';
        useServer.mockReturnValue({
            servers: [{
                id: 'server-1',
                name: longName,
                url: 'https://panel.example.com',
                basePath: '/xui',
                username: 'nmsadmin',
                group: 'production',
                environment: 'prod',
                health: 'healthy',
                tags: ['edge'],
                credentialStatus: 'configured',
            }],
            activeServerId: 'server-1',
            selectServer: vi.fn(),
            addServer: vi.fn(),
            addServersBatch: vi.fn(),
            updateServer: vi.fn(),
            removeServer: vi.fn(),
            testConnection: vi.fn(),
            fetchServers: vi.fn(),
        });

        renderWithRouter(<Servers />);

        const nameTrigger = screen.getByRole('button', { name: longName });
        expect(nameTrigger).toHaveAttribute('title', longName);
        expect(screen.getByText('当前节点')).toBeInTheDocument();
        expect(screen.getByText('当前视角')).toBeInTheDocument();
        expect(screen.getByText('环境：生产')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '复制面板地址' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
        expect(screen.queryByText('已注册的服务器')).not.toBeInTheDocument();
        expect(screen.queryByText('管理您的 3x-ui 面板连接')).not.toBeInTheDocument();
    });

    it('switches to stacked mobile cards on narrow screens', async () => {
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

        useServer.mockReturnValue({
            servers: [{
                id: 'server-1',
                name: '新加坡边缘节点',
                url: 'https://panel.example.com',
                basePath: '/xui',
                username: 'nmsadmin',
                group: 'production',
                environment: 'prod',
                health: 'healthy',
                tags: ['edge', 'vip'],
                credentialStatus: 'configured',
            }],
            activeServerId: 'server-1',
            selectServer: vi.fn(),
            addServer: vi.fn(),
            addServersBatch: vi.fn(),
            updateServer: vi.fn(),
            removeServer: vi.fn(),
            testConnection: vi.fn(),
            fetchServers: vi.fn(),
        });

        const { container } = renderWithRouter(<Servers />);

        expect(container.querySelector('.servers-table')).toBeNull();
        const mobileCard = container.querySelector('.servers-mobile-card');
        expect(mobileCard).not.toBeNull();
        expect(within(mobileCard).getByText('新加坡边缘节点')).toBeInTheDocument();
        expect(within(mobileCard).getByText('账号')).toBeInTheDocument();
        expect(within(mobileCard).getByRole('button', { name: '详情' })).toBeInTheDocument();
    });
});
