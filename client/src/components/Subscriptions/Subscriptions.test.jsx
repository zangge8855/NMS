import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
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

function buildExternalUrl(baseUrl, format, configUrl) {
    const params = new URLSearchParams({
        config: configUrl,
        selectedRules: 'balanced',
    });
    return `${baseUrl}/${format}?${params.toString()}`;
}

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
                            usedTrafficBytes: 1024,
                            trafficLimitBytes: 4096,
                            remainingTrafficBytes: 3072,
                            expiryTime: new Date('2030-01-02T00:00:00Z').getTime(),
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        const { container } = renderWithRouter(<Subscriptions />);

        expect(await screen.findByDisplayValue('https://sub.example.com/base')).toBeInTheDocument();
        const mainColumn = container.querySelector('.subscriptions-main-column');
        const sideColumn = container.querySelector('.subscriptions-side-column');
        expect(mainColumn).not.toBeNull();
        expect(sideColumn).toBeNull();
        if (!mainColumn) throw new Error('Subscription main column not rendered');
        expect(container.querySelector('.subscription-user-address-kicker')).toBeNull();
        expect(container.querySelector('.subscription-current-profile-card')).toBeNull();
        expect(container.querySelector('.subscription-link-card-meta')).not.toBeNull();
        expect(within(mainColumn).queryByText('软件下载')).not.toBeInTheDocument();
        expect(screen.queryByText('软件下载')).not.toBeInTheDocument();
        expect(screen.getByText('选配置文件 -> 复制或导入')).toBeInTheDocument();
        expect(screen.queryByLabelText('订阅导入步骤')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'v2rayN / Shadowrocket' })).toBeInTheDocument();
        expect(screen.queryByText('通用链接')).not.toBeInTheDocument();
        expect(screen.getByText('适用软件')).toBeInTheDocument();
        expect(screen.getAllByText('v2rayN').length).toBeGreaterThan(0);
        expect(screen.queryByText('给 v2rayN / v2rayNG / Shadowrocket')).not.toBeInTheDocument();
        expect(screen.getByText('已用流量')).toBeInTheDocument();
        expect(screen.getByText('可用流量')).toBeInTheDocument();
        expect(screen.getByText('到期时间')).toBeInTheDocument();
        expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '修改登录密码' })).not.toBeInTheDocument();
        expect(screen.queryByText('你的订阅地址')).not.toBeInTheDocument();
        expect(screen.queryByText('用户邮箱')).not.toBeInTheDocument();
        expect(screen.queryByText('节点合并订阅（自动生成并持久保留）')).not.toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('/subscriptions/user%40example.com');
    });

    it('shows the shared empty state when a user has no assigned subscription identity yet', async () => {
        useAuth.mockReturnValue({
            user: {
                role: 'user',
                subscriptionEmail: '',
            },
        });

        renderWithRouter(<Subscriptions />);

        expect(await screen.findByText('管理员尚未为当前账号分配订阅链接')).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });

    it('hides redundant compatibility hint copy in the user current-profile card for every profile', async () => {
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
                            total: 2,
                            subscriptionActive: true,
                            subscriptionUrl: 'https://sub.example.com/base',
                            subscriptionUrlClash: buildExternalUrl('https://converter.example.com', 'clash', 'https://sub.example.com/base?format=raw'),
                            subscriptionUrlSingbox: buildExternalUrl('https://converter.example.com', 'singbox', 'https://sub.example.com/base?format=raw'),
                            subscriptionUrlSurge: buildExternalUrl('https://converter.example.com', 'surge', 'https://sub.example.com/base?format=raw'),
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        expect(screen.queryByText('给 v2rayN / v2rayNG / Shadowrocket')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '复制地址' })).toHaveClass('btn-primary');
        expect(screen.getByRole('link', { name: '导入到 Shadowrocket' })).toHaveClass('btn-secondary');

        await user.click(screen.getByRole('button', { name: 'Clash / Mihomo' }));
        expect(await screen.findByDisplayValue(buildExternalUrl('https://converter.example.com', 'clash', 'https://sub.example.com/base?format=raw'))).toBeInTheDocument();
        expect(screen.queryByText('给 Clash / Mihomo / Stash')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '复制地址' })).toHaveClass('btn-primary');
        expect(screen.getByRole('link', { name: '导入到 Clash / Mihomo' })).toHaveClass('btn-secondary');

        await user.click(screen.getByRole('button', { name: 'sing-box' }));
        expect(await screen.findByDisplayValue(buildExternalUrl('https://converter.example.com', 'singbox', 'https://sub.example.com/base?format=raw'))).toBeInTheDocument();
        expect(screen.queryByText('给 sing-box')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Surge' }));
        expect(await screen.findByDisplayValue(buildExternalUrl('https://converter.example.com', 'surge', 'https://sub.example.com/base?format=raw'))).toBeInTheDocument();
        expect(screen.queryByText('给 Surge')).not.toBeInTheDocument();
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

        expect(await screen.findByText('仅支持手动输入')).toBeInTheDocument();
        expect(screen.getByText('手动输入邮箱')).toBeInTheDocument();
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
                            subscriptionUrlClash: buildExternalUrl('https://converter.example.com', 'clash', 'https://sub.example.com/base?format=raw'),
                            subscriptionUrlSingbox: buildExternalUrl('https://converter.example.com', 'singbox', 'https://sub.example.com/base?format=raw'),
                            subscriptionUrlSurge: buildExternalUrl('https://converter.example.com', 'surge', 'https://sub.example.com/base?format=raw'),
                        },
                    },
                });
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        const { container } = renderWithRouter(<Subscriptions />);

        expect(await screen.findByDisplayValue('https://sub.example.com/base')).toBeInTheDocument();
        const mainColumn = container.querySelector('.subscriptions-main-column');
        const sideColumn = container.querySelector('.subscriptions-side-column');
        expect(mainColumn).not.toBeNull();
        expect(sideColumn).not.toBeNull();
        if (!mainColumn || !sideColumn) throw new Error('Subscription columns not rendered');
        expect(container.querySelector('.subscription-user-address-kicker')).toBeNull();
        expect(container.querySelector('.subscription-current-profile-card')).toBeNull();
        expect(container.querySelector('.subscription-link-card-meta')).not.toBeNull();
        expect(within(mainColumn).queryByText('软件下载')).not.toBeInTheDocument();
        expect(within(sideColumn).queryByText('软件下载')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Shadowrocket' })).toBeInTheDocument();
        expect(screen.getAllByText('当前用户').length).toBeGreaterThan(0);
        expect(screen.getAllByRole('link', { name: 'admin@example.com' }).length).toBeGreaterThan(0);
        expect(screen.getByText('查看范围: 全部节点 · 已匹配 0/0')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '复制地址' })).toHaveClass('btn-primary');
        expect(screen.getByRole('link', { name: '导入到 Shadowrocket' })).toHaveClass('btn-secondary');
        expect(screen.getByRole('button', { name: '通用链接' })).toBeInTheDocument();
        expect(screen.queryByText('v2rayN / Shadowrocket')).not.toBeInTheDocument();
        expect(screen.queryByText('Verge Rev')).not.toBeInTheDocument();
        expect(screen.queryByText('v2rayNG')).not.toBeInTheDocument();
        expect(screen.queryByText('Mihomo Party')).not.toBeInTheDocument();
        expect(await screen.findByText('converter.example.com')).toBeInTheDocument();
        expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '修改登录密码' })).not.toBeInTheDocument();
        expect(screen.queryByText('更多客户端下载')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Clash / Mihomo' }));
        expect(await screen.findByDisplayValue(buildExternalUrl('https://converter.example.com', 'clash', 'https://sub.example.com/base?format=raw'))).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Clash / Mihomo' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Stash' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '复制地址' })).toHaveClass('btn-primary');
        expect(screen.getByText('适用软件')).toBeInTheDocument();
        expect(screen.getAllByText('FlClash').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Sparkle').length).toBeGreaterThan(0);
        expect(screen.getAllByText('CMFA').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Stash').length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Surge' }));
        expect(await screen.findByDisplayValue(buildExternalUrl('https://converter.example.com', 'surge', 'https://sub.example.com/base?format=raw'))).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '导入到 Surge' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'sing-box' }));
        expect(await screen.findByDisplayValue(buildExternalUrl('https://converter.example.com', 'singbox', 'https://sub.example.com/base?format=raw'))).toBeInTheDocument();
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

    it('keeps account password controls out of the user subscription center', async () => {
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

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('确认新密码')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '修改登录密码' })).not.toBeInTheDocument();
        expect(api.put).not.toHaveBeenCalled();
    });

    it('keeps account password controls out of the admin subscription center', async () => {
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

        renderWithRouter(<Subscriptions />);

        await screen.findByDisplayValue('https://sub.example.com/base');
        expect(screen.queryByText('review-admin · 管理员')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('确认新密码')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '修改登录密码' })).not.toBeInTheDocument();
        expect(api.put).not.toHaveBeenCalled();
    });
});
