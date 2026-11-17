import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client';
import { renderWithRouter } from '../../test/render';
import PanelApiTokens from './PanelApiTokens';

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../contexts/ConfirmContext', () => ({
    useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../UI/SkeletonTable', () => ({
    default: () => <div>loading</div>,
}));

vi.mock('../UI/EmptyState', () => ({
    default: ({ title, subtitle }) => <div>{title} {subtitle}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

const mockedApi = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
const BASE = '/servers/server-1/panel-api-tokens';

const TOKEN_ROWS = [
    { id: 3, name: 'sync-master', scope: 'node-sync', enabled: true, createdAt: 1_760_000_000, expiresAt: 0, tokenPreview: 'abcdef...7890' },
    { id: 4, name: 'old-reader', scope: 'monitor', enabled: false, createdAt: 1_760_000_000_000, expiresAt: 0 },
];

describe('PanelApiTokens', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedApi.get.mockResolvedValue({ data: { success: true, obj: TOKEN_ROWS } });
    });

    it('lists tokens with scope and status', async () => {
        renderWithRouter(<PanelApiTokens serverId="server-1" isSui={false} />);
        expect(await screen.findByText('sync-master')).toBeInTheDocument();
        expect(screen.getByText('node-sync')).toBeInTheDocument();
        expect(screen.getByText('abcdef...7890')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '启用' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument();
        expect(mockedApi.get).toHaveBeenCalledWith(BASE);
    });

    it('creates a token with scope and expiry and shows the plaintext once', async () => {
        const user = userEvent.setup();
        mockedApi.post.mockResolvedValue({ data: { success: true, obj: { name: 'ci', token: 'plain-secret-token' } } });
        renderWithRouter(<PanelApiTokens serverId="server-1" isSui={false} />);
        await screen.findByText('sync-master');

        await user.type(screen.getByLabelText('名称'), 'ci');
        await user.selectOptions(screen.getByLabelText('权限范围'), 'monitor');
        await user.selectOptions(screen.getByLabelText('到期时间'), '30');
        const before = Date.now();
        await user.click(screen.getByRole('button', { name: /创建 Token/ }));

        await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
        const [url, body] = mockedApi.post.mock.calls[0];
        expect(url).toBe(BASE);
        expect(body.name).toBe('ci');
        expect(body.scope).toBe('monitor');
        expect(body.expiresAt).toBeGreaterThanOrEqual(before + 30 * 86_400_000);
        expect(await screen.findByText('plain-secret-token')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '我已保存' }));
        expect(screen.queryByText('plain-secret-token')).not.toBeInTheDocument();
    });

    it('sends the expected scope when toggling and deleting', async () => {
        const user = userEvent.setup();
        mockedApi.patch.mockResolvedValue({ data: { success: true } });
        mockedApi.delete.mockResolvedValue({ data: { success: true } });
        renderWithRouter(<PanelApiTokens serverId="server-1" isSui={false} />);
        await screen.findByText('sync-master');

        await user.click(screen.getByRole('button', { name: '停用' }));
        await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/3`, { enabled: false, expectedScope: 'node-sync' }));

        await user.click(screen.getAllByRole('button', { name: '删除' })[1]);
        await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/4`, { data: { expectedScope: 'monitor' } }));
    });

    it('reports panel failures that come back as success: false', async () => {
        const toast = (await import('react-hot-toast')).default;
        const user = userEvent.setup();
        mockedApi.delete.mockResolvedValue({ data: { success: false, msg: 'scope mismatch' } });
        renderWithRouter(<PanelApiTokens serverId="server-1" isSui={false} />);
        await screen.findByText('sync-master');

        await user.click(screen.getAllByRole('button', { name: '删除' })[0]);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('scope mismatch'));
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('hides scope and pause controls on s-ui nodes', async () => {
        mockedApi.get.mockResolvedValue({ data: { success: true, obj: [{ id: 1, name: 'sui-token', scope: 'admin', enabled: true, expiresAt: 0 }] } });
        renderWithRouter(<PanelApiTokens serverId="server-1" isSui />);
        await screen.findByText('sui-token');
        expect(screen.queryByLabelText('权限范围')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
    });

    it('shows the panel explanation when token management is unsupported', async () => {
        mockedApi.get.mockRejectedValue({
            response: { status: 501, data: { success: false, msg: 'not supported', detail: 'connect with a username and password' } },
        });
        renderWithRouter(<PanelApiTokens serverId="server-1" isSui />);
        expect(await screen.findByText(/connect with a username and password/)).toBeInTheDocument();
        expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
    });
});
