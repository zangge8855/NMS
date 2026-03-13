import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Subscriptions from './Subscriptions.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../../contexts/ConfirmContext.jsx', () => ({
    useConfirm: vi.fn(),
}));

vi.mock('../../contexts/ServerContext.jsx', () => ({
    useServer: vi.fn(),
}));

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('Subscriptions', () => {
    const confirmMock = vi.fn();

    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.put.mockReset();
        useAuth.mockReset();
        useConfirm.mockReset();
        useServer.mockReset();
        confirmMock.mockReset();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
        useConfirm.mockReturnValue(confirmMock);
        confirmMock.mockResolvedValue(true);
    });

    it('auto-loads the current user subscription without exposing admin controls', async () => {
        useAuth.mockReturnValue({
            user: {
                role: 'user',
                subscriptionEmail: 'user@example.com',
            },
        });
        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/user%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'user@example.com',
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Subscriptions />);

        expect(await screen.findByDisplayValue('https://sub.example.com/base')).toBeInTheDocument();
        expect(screen.getByText('当前类型')).toBeInTheDocument();
        expect(screen.getByText('现在这样用')).toBeInTheDocument();
        expect(screen.getByText('选好类型后，直接复制或扫码导入')).toBeInTheDocument();
        expect(screen.getByText('按你的设备打开')).toBeInTheDocument();
        expect(screen.queryByText('用户邮箱')).not.toBeInTheDocument();
        expect(screen.queryByText('节点合并订阅（自动生成并持久保留）')).not.toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('/subscriptions/user%40example.com');
    });

    it('shows a manual-input hint when the admin cannot access the global user list', async () => {
        useAuth.mockReturnValue({
            user: {
                role: 'admin',
                subscriptionEmail: '',
            },
        });
        api.get.mockRejectedValueOnce({
            response: {
                status: 403,
            },
        });

        renderWithRouter(<Subscriptions />);

        expect(await screen.findByText('当前角色无全量用户列表权限，请手动输入邮箱')).toBeInTheDocument();
    });

    it('switches between client-specific subscription profiles', async () => {
        const user = userEvent.setup();

        useAuth.mockReturnValue({
            user: {
                role: 'admin',
                subscriptionEmail: '',
            },
        });
        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/users') {
                return Promise.resolve({
                    data: {
                        obj: {
                            users: ['admin@example.com'],
                            warnings: [],
                        },
                    },
                });
            }
            if (url === '/subscriptions/admin%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'admin@example.com',
                            total: 2,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                            subscriptionUrlClash: 'https://converter.example.com/clash?config=https%3A%2F%2Fsub.example.com%2Fbase%3Fformat%3Draw',
                            subscriptionUrlSingbox: 'https://converter.example.com/singbox?config=https%3A%2F%2Fsub.example.com%2Fbase%3Fformat%3Draw',
                            subscriptionUrlSurge: 'https://converter.example.com/surge?config=https%3A%2F%2Fsub.example.com%2Fbase%3Fformat%3Draw',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Subscriptions />);

        expect(await screen.findByDisplayValue('https://sub.example.com/base')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Shadowrocket' })).toBeInTheDocument();
        expect((await screen.findAllByRole('link', { name: 'Shadowrocket' })).length).toBeGreaterThan(1);
        expect((await screen.findAllByRole('link', { name: 'Surge' })).length).toBeGreaterThan(1);
        expect(screen.getAllByText('FlClash').length).toBeGreaterThan(0);
        expect(screen.getAllByText('v2rayN').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Sparkle').length).toBeGreaterThan(0);
        expect(screen.getAllByText('CMFA').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Exclave').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Shadowrocket').length).toBeGreaterThan(0);
        expect(screen.queryByText('Verge Rev')).not.toBeInTheDocument();
        expect(screen.queryByText('v2rayNG')).not.toBeInTheDocument();
        expect(screen.queryByText('Stash')).not.toBeInTheDocument();
        expect(screen.queryByText('Mihomo Party')).not.toBeInTheDocument();
        expect(screen.getAllByText('FlClash / Sparkle').length).toBeGreaterThan(0);
        expect(screen.getAllByText('FlClash / CMFA').length).toBeGreaterThan(0);
        expect(await screen.findByText('converter.example.com')).toBeInTheDocument();
        expect(screen.queryByText('更多客户端下载')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Clash / Mihomo' }));
        expect(await screen.findByDisplayValue('https://converter.example.com/clash?config=https%3A%2F%2Fsub.example.com%2Fbase%3Fformat%3Draw')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Clash / Mihomo' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Stash' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Surge' }));
        expect(await screen.findByDisplayValue('https://converter.example.com/surge?config=https%3A%2F%2Fsub.example.com%2Fbase%3Fformat%3Draw')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Surge' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'sing-box' }));
        expect(await screen.findByDisplayValue('https://converter.example.com/singbox?config=https%3A%2F%2Fsub.example.com%2Fbase%3Fformat%3Draw')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 sing-box' })).toBeInTheDocument();

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/subscriptions/users');
            expect(api.get).toHaveBeenCalledWith('/subscriptions/admin%40example.com');
        });
    }, 10000);

    it('hides token lifecycle controls in the admin subscription center', async () => {
        useAuth.mockReturnValue({
            user: {
                role: 'admin',
                subscriptionEmail: '',
            },
        });

        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/users') {
                return Promise.resolve({
                    data: {
                        obj: {
                            users: ['admin@example.com'],
                            warnings: [],
                        },
                    },
                });
            }
            if (url === '/subscriptions/admin%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'admin@example.com',
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');

        expect(screen.queryByText('Token 生命周期管理')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '签发 token' })).not.toBeInTheDocument();
    }, 10000);

    it('allows users to reset their own persistent subscription link', async () => {
        const user = userEvent.setup();

        useAuth.mockReturnValue({
            user: {
                role: 'user',
                subscriptionEmail: 'user@example.com',
            },
        });

        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/user%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'user@example.com',
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockResolvedValue({
            data: {
                obj: {
                    subscriptionUrl: 'https://sub.example.com/new',
                },
            },
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        await user.click(screen.getByRole('button', { name: '重置订阅链接' }));

        await waitFor(() => {
            expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
                title: '重置订阅链接',
                message: '重置后旧地址会立即失效，你需要在自己的客户端里更新为新地址。',
                confirmText: '确认重置',
                tone: 'danger',
            }));
            expect(api.post).toHaveBeenCalledWith('/subscriptions/user%40example.com/reset-link', {});
        });
    });

    it('does not reset the link when confirmation is canceled', async () => {
        const user = userEvent.setup();
        confirmMock.mockResolvedValueOnce(false);

        useAuth.mockReturnValue({
            user: {
                role: 'user',
                subscriptionEmail: 'user@example.com',
            },
        });

        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/user%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'user@example.com',
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        await user.click(screen.getByRole('button', { name: '重置订阅链接' }));

        await waitFor(() => {
            expect(confirmMock).toHaveBeenCalledTimes(1);
        });
        expect(api.post).not.toHaveBeenCalled();
    });

    it('allows users to change their own login password from the subscription center', async () => {
        const user = userEvent.setup();

        useAuth.mockReturnValue({
            user: {
                role: 'user',
                username: 'review-user',
                subscriptionEmail: 'user@example.com',
            },
        });

        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/user%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'user@example.com',
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.put.mockResolvedValue({
            data: {
                success: true,
            },
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        await user.type(screen.getByLabelText('当前密码'), 'OldPass123!');
        await user.type(screen.getByLabelText('新密码'), 'NewPass123!');
        await user.type(screen.getByLabelText('确认新密码'), 'NewPass123!');
        await user.click(screen.getByRole('button', { name: '修改登录密码' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/auth/change-password', {
                oldPassword: 'OldPass123!',
                newPassword: 'NewPass123!',
            });
        });
    });

    it('allows admins to change their own login password independently of the selected subscription user', async () => {
        const user = userEvent.setup();

        useAuth.mockReturnValue({
            user: {
                role: 'admin',
                username: 'review-admin',
                subscriptionEmail: '',
            },
        });

        api.get.mockImplementation((url) => {
            if (url === '/subscriptions/users') {
                return Promise.resolve({
                    data: {
                        obj: {
                            users: ['managed@example.com'],
                            warnings: [],
                        },
                    },
                });
            }
            if (url === '/subscriptions/managed%40example.com') {
                return Promise.resolve({
                    data: {
                        obj: {
                            email: 'managed@example.com',
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.put.mockResolvedValue({
            data: {
                success: true,
            },
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        expect(screen.getByText('review-admin · 管理员')).toBeInTheDocument();

        await user.type(screen.getByLabelText('当前密码'), 'AdminOld123!');
        await user.type(screen.getByLabelText('新密码'), 'AdminNew123!');
        await user.type(screen.getByLabelText('确认新密码'), 'AdminNew123!');
        await user.click(screen.getByRole('button', { name: '修改登录密码' }));

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/auth/change-password', {
                oldPassword: 'AdminOld123!',
                newPassword: 'AdminNew123!',
            });
        });
    });
});
