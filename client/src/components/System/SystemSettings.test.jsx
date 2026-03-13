import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import SystemSettings from './SystemSettings.jsx';
import api from '../../api/client.js';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
    },
}));

const useAuthMock = vi.fn();
vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: () => useAuthMock(),
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('../Tasks/TaskProgressModal.jsx', () => ({
    default: () => null,
}));

vi.mock('../Server/Server.jsx', () => ({
    default: ({ embedded }) => <div>{embedded ? '嵌入式节点控制台' : '节点控制台页面'}</div>,
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

describe('SystemSettings', () => {
    beforeEach(() => {
        useAuthMock.mockReset();
        api.get.mockReset();
        api.post.mockReset();
        api.put.mockReset();
    });

    it('shows the access restriction empty state for non-admin users', () => {
        useAuthMock.mockReturnValue({
            user: { role: 'user' },
        });
        renderWithRouter(<SystemSettings />);

        expect(screen.getByRole('heading', { name: '系统设置' })).toBeInTheDocument();
        expect(screen.getByText('仅管理员可访问系统设置')).toBeInTheDocument();
    });

    it('shows converter controls for admin users in subscription settings', async () => {
        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        api.get.mockImplementation((url) => {
            if (url === '/system/settings') {
                return Promise.resolve({
                    data: {
                        obj: {
                            site: {
                                accessPath: '/portal',
                                camouflageEnabled: true,
                            },
                            security: {},
                            jobs: {},
                            audit: {},
                            subscription: {
                                publicBaseUrl: 'https://nms.example.com',
                                converterBaseUrl: 'https://converter.example.com',
                            },
                            auditIpGeo: {},
                        },
                    },
                });
            }
            return Promise.resolve({ data: { obj: {} } });
        });

        renderWithRouter(<SystemSettings />);

        expect(await screen.findByDisplayValue('/portal')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '随机路径' })).toBeInTheDocument();
        expect(screen.getByText('站点伪装首页')).toBeInTheDocument();
        expect(screen.getByText('公开首页预览')).toBeInTheDocument();
        expect(await screen.findByDisplayValue('https://converter.example.com')).toBeInTheDocument();
        expect(screen.queryByText('系统设置工作台')).not.toBeInTheDocument();
        expect(screen.queryByText('按主题管理系统能力')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '清空' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '打开链接' })).toBeInTheDocument();
    });

    it('opens the embedded node console when the console tab is selected via query string', async () => {
        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        api.get.mockResolvedValue({ data: { obj: {} } });

        renderWithRouter(<SystemSettings />, { route: '/settings?tab=console' });

        expect(await screen.findByText('嵌入式节点控制台')).toBeInTheDocument();
        expect(screen.getAllByText('节点控制台').length).toBeGreaterThan(0);
    });
});
