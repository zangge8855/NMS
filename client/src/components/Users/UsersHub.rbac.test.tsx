import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { useServer } from '../../contexts/ServerContext';
import api from '../../api/client';
import { renderWithRouter } from '../../test/render';
import { fetchManagedUsers } from '../../utils/managedUsersCache';
import { invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache';
import UsersHub from './UsersHub';

vi.mock('../../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
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
    default: ({ isOpen, children }: { isOpen?: boolean; children: React.ReactNode }) => (isOpen === false ? null : <div>{children}</div>),
    acquireModalStackSlot: () => ({ isTopmost: () => true, release: () => {} }),
}));

vi.mock('../UI/SkeletonTable', () => ({
    default: () => <div>loading</div>,
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

vi.mock('../Subscriptions/SubscriptionClientLinks', () => ({
    default: () => null,
}));

vi.mock('qrcode.react', () => ({
    QRCodeSVG: () => null,
}));

vi.mock('../../utils/managedUsersCache', () => ({
    applyManagedUsersSnapshot: vi.fn((list: any[]) => list),
    fetchManagedUsers: vi.fn(),
    getManagedUsersSnapshotMeta: vi.fn(() => ({ users: [], source: 'empty' })),
    invalidateManagedUsersCache: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

const MIXED_USERS = [
    {
        id: 'u-regular',
        username: 'alice-user',
        email: 'alice@example.com',
        subscriptionEmail: 'alice@example.com',
        role: 'user',
        enabled: true,
        createdAt: '2026-03-10T00:00:00.000Z',
    },
    {
        id: 'u-operator',
        username: 'bob-operator',
        email: 'bob@example.com',
        subscriptionEmail: 'bob@example.com',
        role: 'operator',
        enabled: true,
        createdAt: '2026-03-09T00:00:00.000Z',
    },
    {
        id: 'u-auditor',
        username: 'carol-auditor',
        email: 'carol@example.com',
        subscriptionEmail: 'carol@example.com',
        role: 'auditor',
        enabled: true,
        createdAt: '2026-03-08T00:00:00.000Z',
    },
    {
        id: 'u-admin',
        username: 'root-admin',
        email: 'root@example.com',
        subscriptionEmail: 'root@example.com',
        role: 'admin',
        enabled: true,
        createdAt: '2026-03-07T00:00:00.000Z',
    },
];

const SAMPLE_GROUPS = [
    {
        id: 'grp-1',
        name: 'VIP Group',
        enabled: true,
        allowedInboundKeys: ['server-a:1'],
        memberCount: 1,
        members: [{ id: 'u-regular', username: 'alice-user' }],
        limitIp: 2,
        trafficLimitBytes: 0,
    },
];

describe('UsersHub RBAC enforcement', () => {
    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        invalidateServerPanelDataCache();
        sessionStorage.clear();

        vi.mocked(fetchManagedUsers).mockReset();
        vi.mocked(fetchManagedUsers).mockResolvedValue({ users: MIXED_USERS, source: 'live' });
        vi.mocked(api.get).mockReset();
        vi.mocked(api.post).mockReset();
        vi.mocked(api.put).mockReset();
        vi.mocked(api.delete).mockReset();
        vi.mocked(useOptionalAuth).mockReset();
        vi.mocked(useServer).mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
        } as any);

        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url === '/auth/users') {
                return Promise.resolve({ data: { obj: MIXED_USERS } });
            }
            if (url === '/user-groups') {
                return Promise.resolve({ data: { obj: SAMPLE_GROUPS } });
            }
            if (url.startsWith('/user-policy/')) {
                return Promise.resolve({ data: { obj: {} } });
            }
            return Promise.resolve({ data: { obj: [] } });
        });
        vi.mocked(api.post).mockResolvedValue({ data: { obj: [] } });
    });

    it('hides write controls for auditor on users and groups tabs while keeping read/export actions', async () => {
        const user = userEvent.setup();
        vi.mocked(useOptionalAuth).mockReturnValue({
            user: { id: 'actor-auditor', username: 'audit1', role: 'auditor' },
        } as any);

        renderWithRouter(<UsersHub />);

        await waitFor(() => {
            expect(screen.getByText('alice-user')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '添加账号' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /访客试用码/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '开通订阅' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: '详情' })).toHaveLength(MIXED_USERS.length);

        await user.click(screen.getAllByRole('tab')[1]);

        await waitFor(() => {
            expect(screen.getByText('VIP Group')).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: '新建入站组' })).not.toBeInTheDocument();
    });

    it('does not auto-open create or edit modals from URL params for auditor', async () => {
        vi.mocked(useOptionalAuth).mockReturnValue({
            user: { id: 'actor-auditor', username: 'audit1', role: 'auditor' },
        } as any);

        renderWithRouter(<UsersHub />, { route: '/clients?action=create&edit=u-regular' });

        await waitFor(() => {
            expect(screen.getByText('alice-user')).toBeInTheDocument();
        });

        expect(screen.queryByLabelText('账号角色')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    });

    it('restricts operator create role dropdown to user and hides write actions on staff rows', async () => {
        const user = userEvent.setup();
        vi.mocked(useOptionalAuth).mockReturnValue({
            user: { id: 'actor-op', username: 'op1', role: 'operator' },
        } as any);

        renderWithRouter(<UsersHub />);

        await waitFor(() => {
            expect(screen.getByText('alice-user')).toBeInTheDocument();
        });

        // Regular user row is manageable (enabled checkbox + provision action)
        const regularRow = screen.getByText('alice-user').closest('tr');
        expect(regularRow).not.toBeNull();
        expect(within(regularRow!).getByRole('checkbox')).not.toBeDisabled();
        expect(within(regularRow!).getByRole('button', { name: '开通订阅' })).toBeInTheDocument();

        // Operator, auditor, and admin rows must NOT expose write actions or enabled selection to operator
        for (const staffName of ['bob-operator', 'carol-auditor', 'root-admin']) {
            const staffRow = screen.getByText(staffName).closest('tr');
            expect(staffRow).not.toBeNull();
            expect(within(staffRow!).getByRole('checkbox')).toBeDisabled();
            expect(within(staffRow!).queryByRole('button', { name: '开通订阅' })).not.toBeInTheDocument();
            expect(within(staffRow!).getByRole('button', { name: '详情' })).toBeInTheDocument();
            expect(within(staffRow!).getAllByRole('button')).toHaveLength(2); // identity link button + Details button
        }

        // Role dropdown in Create User modal only offers 'user'
        await user.click(screen.getByRole('button', { name: '添加账号' }));
        const roleSelect = screen.getByLabelText('账号角色') as HTMLSelectElement;
        const roleValues = Array.from(roleSelect.options).map((option) => option.value);
        expect(roleValues).toEqual(['user']);
    });

    it('exposes all 4 role options and staff row controls to admin', async () => {
        const user = userEvent.setup();
        vi.mocked(useOptionalAuth).mockReturnValue({
            user: { id: 'actor-admin', username: 'admin', role: 'admin' },
        } as any);

        renderWithRouter(<UsersHub />);

        await waitFor(() => {
            expect(screen.getByText('bob-operator')).toBeInTheDocument();
        });

        const operatorRow = screen.getByText('bob-operator').closest('tr');
        expect(operatorRow).not.toBeNull();
        expect(within(operatorRow!).getByRole('checkbox')).not.toBeDisabled();
        expect(within(operatorRow!).getByRole('button', { name: '开通订阅' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '添加账号' }));
        const roleSelect = screen.getByLabelText('账号角色') as HTMLSelectElement;
        const roleValues = Array.from(roleSelect.options).map((option) => option.value);
        expect(roleValues).toEqual(['user', 'operator', 'auditor', 'admin']);
    });
});
