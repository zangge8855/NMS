import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import { invalidateManagedUsersCache } from '../../utils/managedUsersCache.js';
import { invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache.js';
import UsersHub from './UsersHub.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
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
    default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../UI/SkeletonTable.jsx', () => ({
    default: () => <div>loading</div>,
}));

vi.mock('../UI/EmptyState.jsx', () => ({
    default: ({ title, subtitle }) => (
        <div>
            <div>{title}</div>
            {subtitle ? <div>{subtitle}</div> : null}
        </div>
    ),
}));

vi.mock('../Subscriptions/SubscriptionClientLinks.jsx', () => ({
    default: () => null,
}));

vi.mock('qrcode.react', () => ({
    QRCodeSVG: () => null,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

function mockMatchMedia(matches = false) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

describe('UsersHub ordering', () => {
    let consoleErrorSpy;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        invalidateManagedUsersCache();
        invalidateServerPanelDataCache();
        sessionStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
        api.put.mockReset();
        api.delete.mockReset();
        mockMatchMedia(false);
        useServer.mockReset();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
        });

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'user-a',
                                username: 'alice',
                                email: 'alice@example.com',
                                subscriptionEmail: 'alice@example.com',
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-10T00:00:00.000Z',
                            },
                            {
                                id: 'user-b',
                                username: 'bob',
                                email: 'bob@example.com',
                                subscriptionEmail: 'bob@example.com',
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-09T00:00:00.000Z',
                            },
                        ],
                    },
                });
            }
            if (url.startsWith('/user-policy/')) {
                return Promise.resolve({
                    data: {
                        obj: {},
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        api.put.mockResolvedValue({ data: { success: true } });
    });

    afterEach(() => {
        consoleErrorSpy?.mockRestore();
    });

    it('shows auto-increment sequence numbers instead of an editable order input', async () => {
        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        expect(within(aliceRow).queryByRole('spinbutton')).not.toBeInTheDocument();
        expect(within(aliceRow).getByText('1')).toBeInTheDocument();

        const bobCell = await screen.findByText('bob');
        const bobRow = bobCell.closest('tr');
        if (!bobRow) throw new Error('Missing Bob row');

        expect(within(bobRow).getByText('2')).toBeInTheDocument();
        expect(api.put).not.toHaveBeenCalledWith('/system/users/order', expect.anything());
    });

    it('toggles the displayed sequence direction without persisting user order', async () => {
        const user = userEvent.setup();
        const { container } = renderWithRouter(<UsersHub />);

        await screen.findByText('alice');

        const beforeRows = container.querySelectorAll('tbody tr');
        expect(within(beforeRows[0]).getByText('alice')).toBeInTheDocument();
        expect(within(beforeRows[0]).getByText('1')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '按序号降序显示' }));

        const afterRows = container.querySelectorAll('tbody tr');
        expect(within(afterRows[0]).getByText('bob')).toBeInTheDocument();
        expect(within(afterRows[0]).getByText('2')).toBeInTheDocument();
        expect(api.put).not.toHaveBeenCalledWith('/system/users/order', expect.anything());
    });

    it('aggregates used traffic from inbound clientStats instead of raw settings only', async () => {
        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'user-a',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                            enabled: true,
                            createdAt: '2026-03-10T00:00:00.000Z',
                        }],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 101,
                            protocol: 'vless',
                            enable: true,
                            settings: JSON.stringify({
                                clients: [{
                                    id: 'uuid-1',
                                    email: 'alice@example.com',
                                }],
                            }),
                            clientStats: [{
                                id: 'uuid-1',
                                email: 'alice@example.com',
                                up: 10,
                                down: 20,
                            }],
                        }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: ['uuid-1'],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<UsersHub />);

        expect(await screen.findByRole('columnheader', { name: '账号' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: '用户名' })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: '邮箱' })).not.toBeInTheDocument();

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        await waitFor(() => {
            expect(within(aliceRow).getByText('alice@example.com')).toBeInTheDocument();
            expect(within(aliceRow).getByText('↑10 B')).toBeInTheDocument();
            expect(within(aliceRow).getByText('↓20 B')).toBeInTheDocument();
        });
        expect(within(aliceRow).queryByText(/ID user-a/i)).not.toBeInTheDocument();
        expect(within(aliceRow).getByText('在线')).toBeInTheDocument();
        expect(within(aliceRow).getByText('1 会话')).toBeInTheDocument();
        expect(within(aliceRow).getByRole('button', { name: '详情' })).toBeInTheDocument();
        expect(within(aliceRow).queryByRole('button', { name: '查看订阅' })).not.toBeInTheDocument();
        expect(within(aliceRow).queryByText('订阅链接')).not.toBeInTheDocument();
    });

    it('moves the enable toggle into the edit dialog instead of showing it in the row actions', async () => {
        const user = userEvent.setup();

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'user-a',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                            enabled: true,
                            createdAt: '2026-03-10T00:00:00.000Z',
                        }],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            if (url === '/user-policy/alice%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {},
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        expect(within(aliceRow).queryByRole('button', { name: '停用' })).not.toBeInTheDocument();

        await user.click(within(aliceRow).getByRole('button', { name: '编辑 / 状态' }));

        expect(await screen.findByRole('button', { name: '启用' })).toBeInTheDocument();
        const disableButton = screen.getByRole('button', { name: '停用' });
        await user.click(disableButton);
        await user.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/auth/users/user-a/set-enabled', { enabled: false });
        });
    });

    it('renders the base user list before node stats finish loading', async () => {
        let releaseInbounds;
        const inboundsDeferred = new Promise((resolve) => {
            releaseInbounds = resolve;
        });

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'user-a',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                            enabled: true,
                            createdAt: '2026-03-10T00:00:00.000Z',
                        }],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return inboundsDeferred;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        await waitFor(() => {
            expect(aliceRow.textContent).toContain('同步中');
            expect(screen.getByText(/节点统计同步中/i)).toBeInTheDocument();
        });

        releaseInbounds({
            data: {
                obj: [],
            },
        });
        api.post.mockResolvedValueOnce({ data: { obj: [] } });

        await waitFor(() => {
            expect(screen.queryByText(/节点统计同步中/i)).not.toBeInTheDocument();
        });
    });

    it('switches to stacked mobile cards on narrow screens', async () => {
        mockMatchMedia(true);

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [
                            {
                                id: 'user-a',
                                username: 'alice',
                                email: 'alice@example.com',
                                subscriptionEmail: 'alice@example.com',
                                role: 'user',
                                enabled: true,
                                createdAt: '2026-03-10T00:00:00.000Z',
                            },
                        ],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 101,
                            protocol: 'vless',
                            enable: true,
                            settings: JSON.stringify({
                                clients: [{ id: 'uuid-1', email: 'alice@example.com', expiryTime: 0, enable: true }],
                            }),
                            clientStats: [{
                                id: 'uuid-1',
                                email: 'alice@example.com',
                                up: 10,
                                down: 20,
                            }],
                        }],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.resolve({
                    data: {
                        obj: ['uuid-1'],
                    },
                });
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<UsersHub />);

        expect(await screen.findByText('alice')).toBeInTheDocument();
        expect(document.querySelector('.users-mobile-card')).toBeTruthy();
        expect(document.querySelector('.users-table')).toBeFalsy();
        await waitFor(() => {
            expect(screen.getByText('alice@example.com')).toBeInTheDocument();
            expect(screen.getByText('↑10 B / ↓20 B')).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '查看订阅' })).not.toBeInTheDocument();
    });

    it('shows a primary load error when the user list request fails', async () => {
        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.reject(new Error('user list unavailable'));
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UsersHub />);

        expect(await screen.findByText('用户列表加载失败')).toBeInTheDocument();
        expect(screen.getByText('user list unavailable')).toBeInTheDocument();
    });

    it('renders the last session user snapshot before the live user list finishes loading', async () => {
        const never = new Promise(() => {});
        window.sessionStorage.setItem('nms_session_snapshot:managed_users_v1', JSON.stringify({
            savedAt: Date.now(),
            value: [
                {
                    id: 'user-snapshot',
                    username: 'snapshot-user',
                    email: 'snapshot@example.com',
                    subscriptionEmail: 'snapshot@example.com',
                    role: 'user',
                    enabled: true,
                    createdAt: '2026-03-10T00:00:00.000Z',
                },
            ],
        }));

        api.get.mockImplementation((url) => {
            if (url === '/auth/users' || url === '/panel/server-a/panel/api/inbounds/list') {
                return never;
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return never;
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<UsersHub />);

        expect(await screen.findByText('snapshot-user')).toBeInTheDocument();
        expect(screen.getByText('snapshot@example.com')).toBeInTheDocument();
        expect(screen.getByText(/节点统计同步中/)).toBeInTheDocument();
    });

    it('localizes the empty-state copy when no users exist in English', async () => {
        window.localStorage.setItem('nms_locale', 'en-US');

        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UsersHub />);

        expect(await screen.findByText('No registered users')).toBeInTheDocument();
        expect(screen.getByText('Add a user from the action bar above.')).toBeInTheDocument();
    });

    it('keeps rendering users when node data only partially fails', async () => {
        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'user-a',
                            username: 'alice',
                            email: 'alice@example.com',
                            subscriptionEmail: 'alice@example.com',
                            role: 'user',
                            enabled: true,
                            createdAt: '2026-03-10T00:00:00.000Z',
                        }],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.reject(new Error('inbounds denied'));
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockImplementation((url) => {
            if (url === '/panel/server-a/panel/api/inbounds/onlines') {
                return Promise.reject(new Error('presence denied'));
            }
            throw new Error(`Unexpected POST ${url}`);
        });

        renderWithRouter(<UsersHub />);

        expect(await screen.findByText('alice')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('节点数据已降级显示')).toBeInTheDocument();
            expect(screen.getByText(/入站配置失败: Node A/)).toBeInTheDocument();
            expect(screen.getByText(/在线状态失败: Node A/)).toBeInTheDocument();
        });
    });

    it('lets the edit form auto-follow the login email until the subscription binding is manually overridden', async () => {
        const user = userEvent.setup();
        renderWithRouter(<UsersHub />);

        const aliceCell = await screen.findByText('alice');
        const aliceRow = aliceCell.closest('tr');
        if (!aliceRow) throw new Error('Missing Alice row');

        await user.click(within(aliceRow).getByRole('button', { name: '编辑 / 状态' }));
        await screen.findByText('编辑用户 - alice');

        const emailInputs = document.querySelectorAll('.modal input[type="email"]');
        expect(emailInputs).toHaveLength(2);
        const loginEmailInput = emailInputs[0];
        const subscriptionEmailInput = emailInputs[1];

        await user.clear(loginEmailInput);
        await user.type(loginEmailInput, 'alice.new@example.com');
        expect(subscriptionEmailInput).toHaveValue('alice.new@example.com');

        await user.clear(subscriptionEmailInput);
        await user.type(subscriptionEmailInput, 'bind@example.com');

        await user.clear(loginEmailInput);
        await user.type(loginEmailInput, 'alice.final@example.com');
        expect(subscriptionEmailInput).toHaveValue('bind@example.com');

        await user.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/auth/users/user-a', expect.objectContaining({
                username: 'alice',
                email: 'alice.final@example.com',
                subscriptionEmail: 'bind@example.com',
            }));
        });
    });

    it('shows disabled users as disabled even when they have no deployed clients', async () => {
        api.get.mockImplementation((url) => {
            if (url === '/auth/users') {
                return Promise.resolve({
                    data: {
                        obj: [{
                            id: 'user-disabled',
                            username: 'dora',
                            email: 'dora@example.com',
                            subscriptionEmail: 'dora@example.com',
                            role: 'user',
                            enabled: false,
                            emailVerified: true,
                            createdAt: '2026-03-10T00:00:00.000Z',
                        }],
                    },
                });
            }
            if (url === '/panel/server-a/panel/api/inbounds/list') {
                return Promise.resolve({
                    data: {
                        obj: [],
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<UsersHub />);

        const doraCell = await screen.findByText('dora');
        const doraRow = doraCell.closest('tr');
        if (!doraRow) throw new Error('Missing Dora row');

        expect(within(doraRow).getByText('已停用')).toBeInTheDocument();
        expect(within(doraRow).queryByText('待审核')).not.toBeInTheDocument();
    });
});
