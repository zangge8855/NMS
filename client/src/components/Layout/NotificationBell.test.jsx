import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from './NotificationBell.jsx';

vi.mock('react-dom', async () => {
    const actual = await vi.importActual('react-dom');
    return {
        ...actual,
        createPortal: (node) => node,
    };
});

const useNotificationsMock = vi.fn();
vi.mock('../../contexts/NotificationContext.jsx', () => ({
    useNotifications: () => useNotificationsMock(),
}));

vi.mock('../../contexts/LanguageContext.jsx', () => ({
    useI18n: () => ({
        locale: 'zh-CN',
    }),
}));

vi.mock('../../hooks/useFloatingPanel.js', () => ({
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
