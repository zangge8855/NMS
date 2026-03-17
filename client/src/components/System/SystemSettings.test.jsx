import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function mockAdminBootstrap(overrides = {}) {
    const defaultResponses = {
        '/system/settings': {
            data: {
                obj: {
                    site: {
                        accessPath: '/portal',
                        camouflageEnabled: true,
                        camouflageTemplate: 'nginx',
                        camouflageTitle: 'Northline Relay',
                    },
                    registration: {
                        inviteOnlyEnabled: true,
                    },
                    security: {
                        requireHighRiskConfirmation: true,
                        mediumRiskMinTargets: 20,
                        highRiskMinTargets: 100,
                        riskTokenTtlSeconds: 180,
                    },
                    jobs: {
                        retentionDays: 90,
                        maxPageSize: 200,
                        maxRecords: 2000,
                        maxConcurrency: 10,
                        defaultConcurrency: 5,
                    },
                    audit: {
                        retentionDays: 365,
                        maxPageSize: 200,
                    },
                    subscription: {
                        publicBaseUrl: 'https://nms.example.com',
                        converterBaseUrl: 'https://converter.example.com',
                    },
                    auditIpGeo: {
                        enabled: true,
                        provider: 'ip_api',
                        endpoint: 'http://ip-api.com/json/{ip}',
                        timeoutMs: 1500,
                        cacheTtlSeconds: 21600,
                    },
                    telegram: {
                        enabled: true,
                        botTokenConfigured: true,
                        botTokenPreview: '1234...ABCD',
                        chatId: '-1001234567890',
                        commandMenuEnabled: false,
                        opsDigestIntervalMinutes: 45,
                        dailyDigestIntervalHours: 12,
                        sendSystemStatus: true,
                        sendSecurityAudit: true,
                        sendEmergencyAlerts: true,
                    },
                },
            },
        },
        '/system/db/status': {
            data: {
                obj: {
                    connection: {
                        enabled: true,
                        ready: true,
                        error: '',
                    },
                    currentModes: {
                        readMode: 'file',
                        writeMode: 'dual',
                    },
                    pendingWrites: 2,
                    writesQueued: 1,
                    snapshots: [{ id: 'snap-1' }],
                    lastWriteAt: '2026-03-15T01:00:00.000Z',
                    defaults: {
                        dryRun: true,
                    },
                },
            },
        },
        '/system/email/status': {
            data: {
                obj: {
                    configured: true,
                    from: 'ops@nms.example.com',
                    host: 'smtp.example.com',
                    port: 587,
                    service: 'SMTP',
                    lastVerification: {
                        success: true,
                        ts: '2026-03-15T02:00:00.000Z',
                        error: '',
                        hint: '使用 TLS 验证通过',
                    },
                    lastDelivery: {
                        success: true,
                        ts: '2026-03-15T03:00:00.000Z',
                        type: 'notice',
                        error: '',
                        hint: '最近一次通知发送成功',
                    },
                },
            },
        },
        '/system/backup/status': {
            data: {
                obj: {
                    storeKeys: ['users', 'servers', 'notifications'],
                    lastExport: {
                        filename: 'nms-20260315.nmsbak',
                        createdAt: '2026-03-15T04:00:00.000Z',
                    },
                    lastImport: {
                        sourceFilename: 'nms-restore.nmsbak',
                        restoredAt: '2026-03-15T05:00:00.000Z',
                    },
                    localBackups: [
                        {
                            filename: 'local-20260315.nmsbak',
                            createdAt: '2026-03-15T04:30:00.000Z',
                        },
                    ],
                },
            },
        },
        '/system/monitor/status': {
            data: {
                obj: {
                    healthMonitor: {
                        running: true,
                        intervalMs: 300000,
                        lastRunAt: '2026-03-15T06:00:00.000Z',
                        summary: {
                            healthy: 2,
                            degraded: 1,
                            unreachable: 1,
                            maintenance: 0,
                            byReason: {
                                dns_error: 1,
                                auth_failed: 1,
                                none: 2,
                            },
                        },
                    },
                    notifications: {
                        unreadCount: 3,
                    },
                    dbAlerts: {
                        consecutiveFailures: 2,
                    },
                    telegram: {
                        enabled: true,
                        configured: true,
                        commandsEnabled: true,
                        commandMenuEnabled: false,
                        chatIdPreview: '********7890',
                        botTokenPreview: '1234...ABCD',
                        opsDigestIntervalMinutes: 45,
                        dailyDigestIntervalHours: 12,
                        lastSentAt: '2026-03-15T06:30:00.000Z',
                        lastError: '',
                        lastCommandAt: '2026-03-15T06:35:00.000Z',
                        lastCommand: '/status',
                    },
                },
            },
        },
        '/auth/registration-status': {
            data: {
                obj: {
                    enabled: true,
                },
            },
        },
        '/system/invite-codes': {
            data: {
                obj: [
                    {
                        id: 'invite-1',
                        status: 'active',
                        remainingUses: 3,
                        usedCount: 0,
                    },
                ],
            },
        },
    };

    api.get.mockImplementation((url) => Promise.resolve(overrides[url] || defaultResponses[url] || { data: { obj: {} } }));
}

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
        mockAdminBootstrap();

        renderWithRouter(<SystemSettings />);

        expect(await screen.findByDisplayValue('/portal')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '随机路径' })).toBeInTheDocument();
        expect(screen.getByText('站点伪装首页')).toBeInTheDocument();
        expect(await screen.findByDisplayValue('Northline Relay')).toBeInTheDocument();
        expect(await screen.findByDisplayValue('https://converter.example.com')).toBeInTheDocument();
        expect(screen.queryByText('系统设置工作台')).not.toBeInTheDocument();
        expect(screen.queryByText('按主题管理系统能力')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '清空' })).toBeInTheDocument();
    });

    it('lazy-loads only the access workspace dependencies on the default tab', async () => {
        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        mockAdminBootstrap();

        renderWithRouter(<SystemSettings />);

        expect(await screen.findByDisplayValue('/portal')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('/system/settings');
        expect(api.get).toHaveBeenCalledWith('/auth/registration-status');
        expect(api.get).toHaveBeenCalledWith('/system/invite-codes');
        expect(api.get).not.toHaveBeenCalledWith('/system/db/status');
        expect(api.get).not.toHaveBeenCalledWith('/system/email/status');
        expect(api.get).not.toHaveBeenCalledWith('/system/backup/status');
        expect(api.get).not.toHaveBeenCalledWith('/system/monitor/status');
    });

    it('shows a dedicated status tab while keeping the default access workspace focused', async () => {
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
                                camouflageTemplate: 'nginx',
                                camouflageTitle: 'Northline Relay',
                            },
                            registration: {
                                inviteOnlyEnabled: true,
                            },
                            security: {},
                            jobs: {},
                            audit: {},
                            subscription: {
                                publicBaseUrl: 'https://nms.example.com',
                            },
                            auditIpGeo: {},
                        },
                    },
                });
            }
            return Promise.resolve({ data: { obj: {} } });
        });

        renderWithRouter(<SystemSettings />);

        await screen.findByDisplayValue('/portal');
        expect(screen.getByRole('button', { name: '系统状态' })).toBeInTheDocument();
        expect(screen.getAllByText('运维通知').length).toBeGreaterThan(0);
        expect(document.querySelectorAll('.settings-summary-card').length).toBe(0);
    });

    it('keeps registration status in the shared summary cards and leaves the access panel focused on actions', async () => {
        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        mockAdminBootstrap();

        renderWithRouter(<SystemSettings />);

        expect(await screen.findByText('注册与邀请码')).toBeInTheDocument();
        expect(screen.getByText('开启邀请注册')).toBeInTheDocument();
        expect(screen.queryByText('当前注册状态')).not.toBeInTheDocument();
        expect(screen.queryByText('邀请码情况')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '生成邀请码' })).toBeInTheDocument();
    });

    it('shows consolidated monitor summaries inside the monitor tab', async () => {
        const user = userEvent.setup();

        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        mockAdminBootstrap();

        renderWithRouter(<SystemSettings />, { route: '/settings?tab=monitor' });

        expect(await screen.findByText('SMTP 诊断')).toBeInTheDocument();
        expect(await screen.findByText('巡检摘要')).toBeInTheDocument();
        expect(await screen.findByText('DNS 1 · 认证失败 1')).toBeInTheDocument();
        expect(screen.getByText('Telegram 机器人')).toBeInTheDocument();
        expect(screen.getByText('菜单已关闭')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '发变更通知' })).toBeInTheDocument();
        const chatIdInput = screen.getByLabelText('Chat ID / 群组 ID');
        expect(chatIdInput).toHaveValue('********7890');
        expect(chatIdInput).toHaveAttribute('readonly');
        await user.click(screen.getByRole('button', { name: '修改' }));
        expect(chatIdInput).toHaveValue('-1001234567890');
        expect(chatIdInput).not.toHaveAttribute('readonly');
        expect(screen.getByLabelText('Bot Token')).toBeInTheDocument();
        expect(screen.getByLabelText('运维汇总间隔')).toHaveValue(45);
        expect(screen.getByLabelText('日报间隔')).toHaveValue(12);
        expect(screen.getByText(/当前已保存 Token/)).toBeInTheDocument();
        expect(screen.getByText('运维汇总 45 分钟')).toBeInTheDocument();
        expect(screen.getByText('日报 12 小时')).toBeInTheDocument();
        expect(screen.getAllByText(/目标 \*{8}7890/).length).toBeGreaterThan(0);
    });

    it('shows a compact backup summary card in the backup tab', async () => {
        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        mockAdminBootstrap();

        renderWithRouter(<SystemSettings />, { route: '/settings?tab=backup' });

        expect(await screen.findByText('备份与恢复')).toBeInTheDocument();
        expect(screen.getByText('备份摘要')).toBeInTheDocument();
        expect(screen.getByText('导出到浏览器')).toBeInTheDocument();
    });

    it('opens the embedded node console when the console tab is selected via query string', async () => {
        useAuthMock.mockReturnValue({
            user: { role: 'admin' },
        });
        mockAdminBootstrap();

        renderWithRouter(<SystemSettings />, { route: '/settings?tab=console' });

        expect(await screen.findByText('远程节点控制台')).toBeInTheDocument();
        expect(screen.getAllByText('节点控制台').length).toBeGreaterThan(0);
    });
});
