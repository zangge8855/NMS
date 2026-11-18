import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { useServer } from '../../contexts/ServerContext';
import api from '../../api/client';
import { renderWithRouter } from '../../test/render';
import Servers from './Servers';

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../contexts/AuthContext', () => ({
    useOptionalAuth: vi.fn(),
}));

vi.mock('../../contexts/ServerContext', () => ({
    useServer: vi.fn(),
}));

vi.mock('../../contexts/ConfirmContext', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../Layout/Header', () => ({
    default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../UI/ModalShell', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
    acquireModalStackSlot: () => ({ isTopmost: () => true, release: () => {} }),
}));

vi.mock('../UI/EmptyState', () => ({
    default: ({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) => (
        <div>
            <div>{title}</div>
            {subtitle ? <div>{subtitle}</div> : null}
            {action}
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

const SAMPLE_SERVER = {
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
};

function setupServerContext(servers = [SAMPLE_SERVER]) {
    vi.mocked(useServer).mockReturnValue({
        servers,
        activeServerId: servers[0]?.id || 'global',
        selectServer: vi.fn(),
        addServer: vi.fn(),
        addServersBatch: vi.fn(),
        updateServer: vi.fn(),
        removeServer: vi.fn(),
        testConnection: vi.fn(),
        fetchServers: vi.fn(),
    } as any);
}

describe('Servers RBAC enforcement', () => {
    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        window.sessionStorage.clear();
        vi.mocked(api.get).mockReset();
        vi.mocked(api.put).mockReset();
        vi.mocked(api.post).mockReset();
        vi.mocked(useOptionalAuth).mockReset();
        vi.mocked(useServer).mockReset();

        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url === '/servers/telemetry/overview') {
                return Promise.resolve({ data: { obj: { items: [], generatedAt: '2026-03-22T00:00:00.000Z' } } });
            }
            return Promise.resolve({ data: { obj: [] } });
        });
        setupServerContext();
    });

    it('hides all server write, reorder, batch, and connectivity-test controls for auditor', async () => {
        vi.mocked(useOptionalAuth).mockReturnValue({
            user: { id: 'u-auditor', username: 'audit1', role: 'auditor' },
        } as any);

        renderWithRouter(<Servers />);

        await waitFor(() => {
            expect(screen.getByText('新加坡边缘节点')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '一键测速' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '批量添加' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '添加服务器' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '全选' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '测试连接' })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /上移|下移/ })).not.toBeInTheDocument();
    });

    it('does not auto-open add server modal via ?action=create for auditor and hides empty-state add button', async () => {
        vi.mocked(useOptionalAuth).mockReturnValue({
            user: { id: 'u-auditor', username: 'audit1', role: 'auditor' },
        } as any);
        setupServerContext([]);

        renderWithRouter(<Servers />, { route: '/servers?action=create' });

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: '添加服务器' })).not.toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    });

    it('keeps operational add, ping-all, reorder, and test controls visible for operator and admin', async () => {
        for (const role of ['operator', 'admin']) {
            vi.mocked(useOptionalAuth).mockReturnValue({
                user: { id: `u-${role}`, username: `${role}1`, role },
            } as any);

            const { unmount } = renderWithRouter(<Servers />);

            await waitFor(() => {
                expect(screen.getByText('新加坡边缘节点')).toBeInTheDocument();
            });

            expect(screen.getByRole('button', { name: '一键测速' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '批量添加' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '添加服务器' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '测试连接' })).toBeInTheDocument();
            expect(screen.getByRole('checkbox')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();

            unmount();
        }
    });
});
