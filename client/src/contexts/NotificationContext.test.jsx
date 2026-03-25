import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../api/client.js';
import { NotificationProvider, useNotifications } from './NotificationContext.jsx';

vi.mock('../api/client.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('react-hot-toast', () => ({
    default: vi.fn(),
    error: vi.fn(),
}));

function NotificationConsumer() {
    const { notifications, unreadCount, ensureExpandedNotifications } = useNotifications();
    return (
        <div>
            <div data-testid="notification-count">{unreadCount}</div>
            <div data-testid="notification-items">{notifications.length}</div>
            <button type="button" onClick={() => ensureExpandedNotifications()}>
                expand
            </button>
        </div>
    );
}

describe('NotificationContext', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        api.get.mockReset();
        api.post.mockReset();
    });

    it('renders the cached notification snapshot before the live preview request finishes', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:notification_center_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                notifications: [{ id: 'n1', title: 'Cached notice' }],
                unreadCount: 3,
                loadedLimit: 1,
            },
        }));
        api.get.mockImplementation(() => new Promise(() => {}));

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        expect(await screen.findByTestId('notification-count')).toHaveTextContent('3');
        expect(screen.getByTestId('notification-items')).toHaveTextContent('1');
    });

    it('loads a lightweight preview first and expands only when requested', async () => {
        api.get
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        items: [{ id: 'n1', title: 'Preview only' }],
                        unreadCount: 4,
                    },
                },
            })
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        items: [
                            { id: 'n1', title: 'Preview only' },
                            { id: 'n2', title: 'Second' },
                            { id: 'n3', title: 'Third' },
                        ],
                        unreadCount: 4,
                    },
                },
            });

        const user = userEvent.setup();

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=1');
        });
        expect(screen.getByTestId('notification-count')).toHaveTextContent('4');
        expect(screen.getByTestId('notification-items')).toHaveTextContent('1');

        await user.click(screen.getByRole('button', { name: 'expand' }));

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=30');
        });
        expect(screen.getByTestId('notification-items')).toHaveTextContent('3');
    });

    it('still performs the first live preview request when a previous session cached an expanded limit', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:notification_center_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                notifications: Array.from({ length: 30 }, (_, index) => ({
                    id: `cached-${index + 1}`,
                    title: `Cached ${index + 1}`,
                })),
                unreadCount: 30,
                loadedLimit: 30,
            },
        }));
        api.get.mockResolvedValueOnce({
            data: {
                obj: {
                    items: [{ id: 'live-preview', title: 'Live preview' }],
                    unreadCount: 1,
                },
            },
        });

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=1');
        });
        expect(screen.getByTestId('notification-items')).toHaveTextContent('1');
        expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    });

    it('deduplicates concurrent expanded notification fetches', async () => {
        let resolveExpanded;
        api.get
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        items: [{ id: 'n1', title: 'Preview only' }],
                        unreadCount: 1,
                    },
                },
            })
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveExpanded = resolve;
            }));

        const user = userEvent.setup();

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=1');
        });

        await Promise.all([
            user.click(screen.getByRole('button', { name: 'expand' })),
            user.click(screen.getByRole('button', { name: 'expand' })),
        ]);

        expect(api.get.mock.calls.filter(([url]) => url === '/system/notifications?limit=30')).toHaveLength(1);

        resolveExpanded({
            data: {
                obj: {
                    items: [
                        { id: 'n1', title: 'Preview only' },
                        { id: 'n2', title: 'Expanded' },
                    ],
                    unreadCount: 1,
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('notification-items')).toHaveTextContent('2');
        });
    });
});
