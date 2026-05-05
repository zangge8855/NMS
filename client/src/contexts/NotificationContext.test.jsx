import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        let resolvePreview;
        window.sessionStorage.setItem('nms_session_snapshot:notification_center_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                notifications: [{ id: 'n1', title: 'Cached notice' }],
                unreadCount: 3,
                loadedLimit: 1,
            },
        }));
        let previewPromise;
        api.get.mockImplementation(() => {
            previewPromise = new Promise((resolve) => {
                resolvePreview = resolve;
            });
            return previewPromise;
        });

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        expect(await screen.findByTestId('notification-count')).toHaveTextContent('3');
        expect(screen.getByTestId('notification-items')).toHaveTextContent('1');
        await act(async () => {
            resolvePreview({
                data: {
                    obj: {
                        items: [{ id: 'n1', title: 'Cached notice' }],
                        unreadCount: 3,
                    },
                },
            });
            await previewPromise;
        });
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
            expect(screen.getByTestId('notification-count')).toHaveTextContent('4');
            expect(screen.getByTestId('notification-items')).toHaveTextContent('1');
        });

        await user.click(screen.getByRole('button', { name: 'expand' }));

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=30');
            expect(screen.getByTestId('notification-items')).toHaveTextContent('3');
        });
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
            expect(screen.getByTestId('notification-items')).toHaveTextContent('1');
            expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
        });
    });

    it('deduplicates concurrent expanded notification fetches', async () => {
        api.get
            .mockResolvedValueOnce({
                data: {
                    obj: {
                        items: [{ id: 'n1', title: 'Preview only' }],
                        unreadCount: 1,
                    },
                },
            })
            .mockResolvedValueOnce({
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

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=1');
            expect(screen.getByTestId('notification-items')).toHaveTextContent('1');
        });

        const expandButton = screen.getByRole('button', { name: 'expand' });
        fireEvent.click(expandButton);
        fireEvent.click(expandButton);

        await waitFor(() => {
            expect(api.get.mock.calls.filter(([url]) => url === '/system/notifications?limit=30')).toHaveLength(1);
        });
        await waitFor(() => {
            expect(screen.getByTestId('notification-items')).toHaveTextContent('2');
        });
    });

    it('does not fetch admin notifications when disabled', async () => {
        window.sessionStorage.setItem('nms_session_snapshot:notification_center_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                notifications: [{ id: 'n1', title: 'Cached notice' }],
                unreadCount: 3,
                loadedLimit: 1,
            },
        }));

        render(
            <NotificationProvider enabled={false} wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
            expect(screen.getByTestId('notification-items')).toHaveTextContent('0');
        });
        expect(api.get).not.toHaveBeenCalled();
    });
});
