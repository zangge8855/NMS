import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Servers from './Servers.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

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
    default: ({ title, subtitle }) => (
        <div>
            <div>{title}</div>
            {subtitle ? <div>{subtitle}</div> : null}
        </div>
    ),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
        custom: vi.fn(),
        dismiss: vi.fn(),
    },
}));

describe('Servers', () => {
    async function waitForServerOrderLoad() {
        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/servers/order');
        });
    }

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
        api.get.mockReset();
        api.put.mockReset();
        api.get.mockResolvedValue({ data: { obj: [] } });
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
        await waitForServerOrderLoad();

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
        await waitForServerOrderLoad();

        expect(container.querySelector('.servers-table')).toBeNull();
        const mobileCard = container.querySelector('.servers-mobile-card');
        expect(mobileCard).not.toBeNull();
        expect(within(mobileCard).getByText('新加坡边缘节点')).toBeInTheDocument();
        expect(within(mobileCard).getByText('账号')).toBeInTheDocument();
        expect(within(mobileCard).getByRole('button', { name: '详情' })).toBeInTheDocument();
        expect(within(mobileCard).queryByText('https://panel.example.com/xui')).not.toBeInTheDocument();
        expect(within(mobileCard).queryByText('/xui')).not.toBeInTheDocument();
        expect(within(mobileCard).queryByText('环境')).not.toBeInTheDocument();
    });

    it('hides the placeholder environment label when environment is unknown', async () => {
        useServer.mockReturnValue({
            servers: [{
                id: 'server-1',
                name: '未分组节点',
                url: 'https://panel.example.com',
                basePath: '/xui',
                username: 'nmsadmin',
                group: 'default',
                environment: 'unknown',
                health: 'healthy',
                tags: [],
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
        await waitForServerOrderLoad();

        await screen.findAllByText('未分组节点');
        expect(screen.queryByText('未设置环境')).not.toBeInTheDocument();
        expect(screen.queryByText('环境：')).not.toBeInTheDocument();
    });

    it('keeps the no-match empty state aligned with the visible search and group filters', async () => {
        const user = userEvent.setup();
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
        await waitForServerOrderLoad();

        await user.type(screen.getByPlaceholderText('搜索名称 / URL / 标签'), 'tokyo');

        expect(await screen.findByText('没有匹配的服务器')).toBeInTheDocument();
        expect(screen.getByText('请调整搜索关键词或分组筛选条件')).toBeInTheDocument();
    });

    it('supports live status filters backed by telemetry summaries', async () => {
        const user = userEvent.setup();
        useServer.mockReturnValue({
            servers: [
                {
                    id: 'server-1',
                    name: '新加坡边缘节点',
                    url: 'https://sg.example.com',
                    basePath: '/xui',
                    username: 'nmsadmin',
                    group: 'production',
                    environment: 'prod',
                    health: 'healthy',
                    tags: ['edge'],
                    credentialStatus: 'configured',
                },
                {
                    id: 'server-2',
                    name: '东京边缘节点',
                    url: 'https://jp.example.com',
                    basePath: '/xui',
                    username: 'ops',
                    group: 'production',
                    environment: 'prod',
                    health: 'healthy',
                    tags: ['backup'],
                    credentialStatus: 'configured',
                },
            ],
            activeServerId: 'server-1',
            selectServer: vi.fn(),
            addServer: vi.fn(),
            addServersBatch: vi.fn(),
            updateServer: vi.fn(),
            removeServer: vi.fn(),
            testConnection: vi.fn(),
            fetchServers: vi.fn(),
        });

        api.get.mockImplementation((url) => {
            if (url === '/system/servers/order') {
                return Promise.resolve({ data: { obj: [] } });
            }
            if (url === '/servers/telemetry/overview') {
                return Promise.resolve({
                    data: {
                        obj: {
                            items: [
                                {
                                    serverId: 'server-1',
                                    serverName: '新加坡边缘节点',
                                    checkedAt: '2026-03-22T00:00:00.000Z',
                                    uptimePercent: 100,
                                    current: { online: true, latencyMs: 98, health: 'healthy' },
                                    latencyTrend: [84, 96, 98],
                                    availabilityTrend: [1, 1, 1],
                                },
                                {
                                    serverId: 'server-2',
                                    serverName: '东京边缘节点',
                                    checkedAt: '2026-03-22T00:00:00.000Z',
                                    uptimePercent: 75,
                                    current: { online: false, latencyMs: null, health: 'unreachable' },
                                    latencyTrend: [220, null, 260],
                                    availabilityTrend: [1, 0, 0],
                                },
                            ],
                            byServerId: {
                                'server-1': {
                                    serverId: 'server-1',
                                    serverName: '新加坡边缘节点',
                                    checkedAt: '2026-03-22T00:00:00.000Z',
                                    uptimePercent: 100,
                                    current: { online: true, latencyMs: 98, health: 'healthy' },
                                    latencyTrend: [84, 96, 98],
                                    availabilityTrend: [1, 1, 1],
                                },
                                'server-2': {
                                    serverId: 'server-2',
                                    serverName: '东京边缘节点',
                                    checkedAt: '2026-03-22T00:00:00.000Z',
                                    uptimePercent: 75,
                                    current: { online: false, latencyMs: null, health: 'unreachable' },
                                    latencyTrend: [220, null, 260],
                                    availabilityTrend: [1, 0, 0],
                                },
                            },
                        },
                    },
                });
            }
            return Promise.resolve({ data: { obj: [] } });
        });

        renderWithRouter(<Servers />);
        await waitForServerOrderLoad();

        const selects = screen.getAllByRole('combobox');
        await user.selectOptions(selects[1], 'offline');

        expect(await screen.findByText('东京边缘节点')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '新加坡边缘节点' })).not.toBeInTheDocument();
    });
});
