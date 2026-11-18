import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import { getOpsUiCopy } from '../../i18n/opsUiCopy';

vi.mock('react-dom', async () => {
    const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
    return {
        ...actual,
        createPortal: (node: React.ReactNode) => node,
    };
});

const useNotificationsMock = vi.fn();
vi.mock('../../contexts/NotificationContext', () => ({
    useNotifications: () => useNotificationsMock(),
}));

const mockAuthState = vi.hoisted(() => ({
    role: null as string | null,
}));

vi.mock('../../contexts/AuthContext', () => ({
    useOptionalAuth: () => (mockAuthState.role ? { user: { role: mockAuthState.role } } : null),
}));

const mockI18nState = vi.hoisted(() => ({ locale: 'zh-CN' }));

vi.mock('../../contexts/LanguageContext', () => ({
    useI18n: () => ({
        locale: mockI18nState.locale,
        tm: () => ({
            title: '通知',
            markAllRead: '全部已读',
            empty: '暂无通知',
            triggerTitle: '通知',
            panelLabel: '通知列表',
            openItem: '查看通知',
            labels: {
                node: '节点',
                sourceIp: '来源 IP',
                locationCarrier: '归属地 / 运营商',
                request: '请求',
                reason: '原因',
                event: '事件',
            },
        }),
    }),
}));

vi.mock('../../hooks/useFloatingPanel', () => ({
    default: () => ({
        panelStyle: {},
        isReady: true,
    }),
}));

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}

describe('NotificationBell', () => {
    beforeEach(() => {
        mockI18nState.locale = 'zh-CN';
        mockAuthState.role = null;
        useNotificationsMock.mockReset();
    });

    it('loads expanded notifications when opened and supports marking all items as read', async () => {
        const user = userEvent.setup();
        const ensureExpandedNotifications = vi.fn().mockResolvedValue(undefined);
        const markAllRead = vi.fn();

        useNotificationsMock.mockReturnValue({
            notifications: [
                {
                    id: 'notice-1',
                    title: '节点告警',
                    body: '节点 health-check 失败',
                    createdAt: '2026-03-18T00:00:00.000Z',
                    severity: 'warning',
                },
            ],
            unreadCount: 1,
            markRead: vi.fn(),
            markAllRead,
            ensureExpandedNotifications,
        });

        render(<NotificationBell />);

        await user.click(screen.getByRole('button', { name: '通知' }));

        expect(ensureExpandedNotifications).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', { name: '全部已读' }));
        expect(markAllRead).toHaveBeenCalledTimes(1);
    });

    it('marks an unread notification as read when the item is clicked', async () => {
        const user = userEvent.setup();
        const markRead = vi.fn();

        useNotificationsMock.mockReturnValue({
            notifications: [
                {
                    id: 'notice-1',
                    title: '节点告警',
                    body: '节点 health-check 失败',
                    createdAt: '2026-03-18T00:00:00.000Z',
                    severity: 'warning',
                },
            ],
            unreadCount: 1,
            markRead,
            markAllRead: vi.fn(),
            ensureExpandedNotifications: vi.fn().mockResolvedValue(undefined),
        });

        render(<NotificationBell />);

        await user.click(screen.getByRole('button', { name: '通知' }));
        await user.click(screen.getByText('节点告警'));

        expect(markRead).toHaveBeenCalledWith('notice-1');
    });

    it('enforces read-only behavior for auditor role (hides mark-all and blocks markRead)', async () => {
        const user = userEvent.setup();
        const markRead = vi.fn();
        const markAllRead = vi.fn();
        mockAuthState.role = 'auditor';

        useNotificationsMock.mockReturnValue({
            notifications: [
                {
                    id: 'notice-auditor-1',
                    title: '节点告警',
                    body: '只读审计通知',
                    createdAt: '2026-03-18T00:00:00.000Z',
                    severity: 'warning',
                    readAt: null,
                    meta: { serverId: 'srv-1' },
                },
            ],
            unreadCount: 1,
            canMarkRead: false,
            markRead,
            markAllRead,
            ensureExpandedNotifications: vi.fn().mockResolvedValue(undefined),
        });

        render(
            <MemoryRouter initialEntries={['/']}>
                <NotificationBell />
                <LocationProbe />
            </MemoryRouter>
        );

        await user.click(screen.getByRole('button', { name: '通知' }));

        expect(screen.queryByRole('button', { name: '全部已读' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '查看通知: 节点告警' }));
        expect(markRead).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: '查看节点' }));
        expect(markRead).not.toHaveBeenCalled();
        expect(screen.getByTestId('location-probe')).toHaveTextContent('/servers/srv-1');
    });
});

describe('NotificationBell severity filters, empty states, and context jumps', () => {
    beforeEach(() => {
        mockI18nState.locale = 'zh-CN';
        mockAuthState.role = null;
        useNotificationsMock.mockReset();
    });

    it('filters notifications by severity pills and unread-only toggle with aria-pressed and resets empty filters', async () => {
        const user = userEvent.setup();

        useNotificationsMock.mockReturnValue({
            notifications: [
                {
                    id: 'n-crit',
                    title: '节点失联',
                    severity: 'critical',
                    readAt: null,
                    createdAt: '2026-03-18T00:00:00.000Z',
                },
                {
                    id: 'n-warn',
                    title: '磁盘预警',
                    severity: 'warning',
                    readAt: '2026-03-18T00:05:00.000Z',
                    createdAt: '2026-03-18T00:01:00.000Z',
                },
                {
                    id: 'n-info',
                    title: '节点已恢复',
                    severity: 'info',
                    readAt: null,
                    createdAt: '2026-03-18T00:02:00.000Z',
                },
            ],
            unreadCount: 2,
            markRead: vi.fn(),
            markAllRead: vi.fn(),
            ensureExpandedNotifications: vi.fn().mockResolvedValue(undefined),
        });

        render(<NotificationBell />);
        await user.click(screen.getByRole('button', { name: '通知' }));

        const allBtn = screen.getByRole('button', { name: /全部\s*3/ });
        const criticalBtn = screen.getByRole('button', { name: /严重\s*1/ });
        const warningBtn = screen.getByRole('button', { name: /警告\s*1/ });
        const infoBtn = screen.getByRole('button', { name: /信息\s*1/ });
        const unreadBtn = screen.getByRole('button', { name: '仅未读' });

        expect(allBtn).toHaveAttribute('aria-pressed', 'true');
        expect(unreadBtn).toHaveAttribute('aria-pressed', 'false');

        // Keyboard arrow navigation between filter buttons
        allBtn.focus();
        fireEvent.keyDown(allBtn, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(criticalBtn);

        await user.click(criticalBtn);
        expect(criticalBtn).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('节点失联')).toBeInTheDocument();
        expect(screen.queryByText('磁盘预警')).not.toBeInTheDocument();
        expect(screen.queryByText('节点已恢复')).not.toBeInTheDocument();

        await user.click(warningBtn);
        expect(screen.getByText('磁盘预警')).toBeInTheDocument();
        expect(screen.queryByText('节点失联')).not.toBeInTheDocument();

        // Combine warning + unreadOnly -> empty filtered result with reset button
        await user.click(unreadBtn);
        expect(unreadBtn).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('没有符合筛选条件的通知')).toBeInTheDocument();

        const resetBtn = screen.getByRole('button', { name: '重置筛选' });
        await user.click(resetBtn);

        expect(allBtn).toHaveAttribute('aria-pressed', 'true');
        expect(unreadBtn).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText('节点失联')).toBeInTheDocument();
        expect(screen.getByText('磁盘预警')).toBeInTheDocument();
        expect(screen.getByText('节点已恢复')).toBeInTheDocument();
        expect(infoBtn).toHaveAttribute('aria-pressed', 'false');
    });

    it('navigates to node detail or audit center from context jump buttons and closes dropdown', async () => {
        const user = userEvent.setup();
        const markRead = vi.fn();

        useNotificationsMock.mockReturnValue({
            notifications: [
                {
                    id: 'n-server',
                    type: 'server_health_unreachable',
                    title: '节点连接失败',
                    severity: 'critical',
                    readAt: null,
                    meta: { serverId: 'srv alpha/1' },
                },
                {
                    id: 'n-audit',
                    type: 'security_login_failed',
                    title: '异常登录尝试',
                    severity: 'warning',
                    readAt: null,
                    meta: { event: 'login_failed', ip: '198.51.100.2' },
                },
            ],
            unreadCount: 2,
            markRead,
            markAllRead: vi.fn(),
            ensureExpandedNotifications: vi.fn().mockResolvedValue(undefined),
        });

        render(
            <MemoryRouter initialEntries={['/']}>
                <NotificationBell />
                <LocationProbe />
            </MemoryRouter>
        );

        await user.click(screen.getByRole('button', { name: '通知' }));
        await user.click(screen.getByRole('button', { name: '查看节点' }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('/servers/srv%20alpha%2F1');
        expect(screen.queryByRole('dialog', { name: '通知列表' })).not.toBeInTheDocument();
        expect(markRead).toHaveBeenCalledWith('n-server');

        await user.click(screen.getByRole('button', { name: '通知' }));
        await user.click(screen.getByRole('button', { name: '查看审计' }));

        expect(screen.getByTestId('location-probe')).toHaveTextContent('/audit');
        expect(screen.queryByRole('dialog', { name: '通知列表' })).not.toBeInTheDocument();
        expect(markRead).toHaveBeenCalledWith('n-audit');
    });
});

describe('NotificationBell localization and popover coordination', () => {
    beforeEach(() => {
        mockI18nState.locale = 'zh-CN';
        mockAuthState.role = null;
        useNotificationsMock.mockReset();
    });

    it('renders localized notification title, body, and aria-label from meta.localized', async () => {
        mockI18nState.locale = 'en-US';
        const user = userEvent.setup();
        useNotificationsMock.mockReturnValue({
            notifications: [
                {
                    id: 'notice-i18n',
                    title: '原始标题',
                    body: '原始内容',
                    createdAt: '2026-03-18T00:00:00.000Z',
                    readAt: null,
                    severity: 'warning',
                    meta: {
                        localized: {
                            'zh-CN': { title: '节点告警', body: '中文详情' },
                            'en-US': { title: 'Node Alert', body: 'Node check failed' },
                        },
                    },
                },
            ],
            unreadCount: 1,
            ensureExpandedNotifications: vi.fn().mockResolvedValue(undefined),
            markRead: vi.fn(),
            markAllRead: vi.fn(),
        });

        render(<NotificationBell />);
        await user.click(screen.getByRole('button', { name: '通知' }));

        expect(screen.getByText('Node Alert')).toBeInTheDocument();
        expect(screen.getByText('Node check failed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '查看通知: Node Alert' })).toBeInTheDocument();
        expect(screen.queryByText('原始标题')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unread only' })).toBeInTheDocument();
    });

    it('contains zero Chinese characters in en-US opsUiCopy', () => {
        const enCopy = JSON.stringify(getOpsUiCopy('en-US'));
        expect(enCopy).not.toMatch(/[\u4e00-\u9fff]/);
    });

    it('dispatches nms:close-popovers when opened and closes on peer popover events', async () => {
        const user = userEvent.setup();
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        useNotificationsMock.mockReturnValue({
            notifications: [],
            unreadCount: 0,
            ensureExpandedNotifications: vi.fn().mockResolvedValue(undefined),
            markRead: vi.fn(),
            markAllRead: vi.fn(),
        });

        render(<NotificationBell />);
        await user.click(screen.getByRole('button', { name: '通知' }));

        expect(screen.getByRole('dialog', { name: '通知列表' })).toBeInTheDocument();
        const dispatchedClose = dispatchSpy.mock.calls.some(([ev]) => (
            ev instanceof CustomEvent
            && ev.type === 'nms:close-popovers'
            && ev.detail?.source === 'notification-bell'
        ));
        expect(dispatchedClose).toBe(true);

        act(() => {
            window.dispatchEvent(new CustomEvent('nms:close-popovers', {
                detail: { source: 'notification-bell' },
            }));
        });
        expect(screen.getByRole('dialog', { name: '通知列表' })).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(new CustomEvent('nms:close-popovers', {
                detail: { source: 'header-search' },
            }));
        });
        expect(screen.queryByRole('dialog', { name: '通知列表' })).not.toBeInTheDocument();
        dispatchSpy.mockRestore();
    });
});
