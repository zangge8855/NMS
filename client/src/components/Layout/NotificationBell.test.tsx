import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from './NotificationBell';

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

describe('NotificationBell', () => {
    beforeEach(() => {
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
});

describe('NotificationBell localization and popover coordination', () => {
    beforeEach(() => {
        mockI18nState.locale = 'zh-CN';
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
