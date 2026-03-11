import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { renderWithRouter } from '../../test/render.jsx';
import Subscriptions from './Subscriptions.jsx';

vi.mock('../../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(),
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
    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        useAuth.mockReset();
        useServer.mockReset();
        useServer.mockReturnValue({
            servers: [{ id: 'server-a', name: 'Node A' }],
        });
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
                            subscriptionUrlClash: 'https://sub.example.com/base?format=clash',
                            subscriptionUrlSingbox: 'sing-box://import-remote-profile?url=https://sub.example.com/base?format=raw',
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Subscriptions />);

        expect(await screen.findByDisplayValue('https://sub.example.com/base')).toBeInTheDocument();
        expect((await screen.findAllByRole('link', { name: '快捷导入' })).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Shadowrocket').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Stash').length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Clash / Mihomo' }));
        expect(await screen.findByDisplayValue('https://sub.example.com/base?format=clash')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'sing-box' }));
        expect(await screen.findByDisplayValue('sing-box://import-remote-profile?url=https://sub.example.com/base?format=raw')).toBeInTheDocument();

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/subscriptions/users');
            expect(api.get).toHaveBeenCalledWith('/subscriptions/admin%40example.com');
        });
    }, 10000);

    it('allows admins to issue a subscription token from the subscription center', async () => {
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
                            total: 1,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                            token: {
                                activeCount: 1,
                                activeLimit: 5,
                                scope: 'all',
                                currentTokenId: 'scope-token',
                                tokenRequired: false,
                                tokens: [],
                            },
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        api.post.mockResolvedValue({
            data: {
                obj: {
                    token: 'token-value',
                    subscriptionUrl: 'https://sub.example.com/issued',
                },
            },
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');

        await user.type(screen.getByPlaceholderText('例如：Clash 客户端 / 用户自助'), 'Verge');
        await user.click(screen.getByRole('button', { name: '签发 token' }));

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/subscriptions/admin%40example.com/issue', {
                name: 'Verge',
                ttlDays: 30,
            });
        });
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
            expect(api.post).toHaveBeenCalledWith('/subscriptions/user%40example.com/reset-link', {});
        });
    });
});
