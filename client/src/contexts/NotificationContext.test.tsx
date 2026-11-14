import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../api/client';
import { NotificationProvider, useNotifications } from './NotificationContext';

vi.mock('../api/client', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('react-hot-toast', () => ({
    default: Object.assign(vi.fn(), {
        error: vi.fn(),
    }),
    error: vi.fn(),
}));

import toast from 'react-hot-toast';

function NotificationConsumer() {
    const { notifications, unreadCount, ensureExpandedNotifications, markRead, markAllRead } = useNotifications();
    return (
        <div>
            <div data-testid="notification-count">{unreadCount}</div>
            <div data-testid="notification-items">{notifications.length}</div>
            <button type="button" onClick={() => ensureExpandedNotifications()}>
                expand
            </button>
            <button type="button" onClick={() => void markRead('n1')}>
                mark-n1
            </button>
            <button type="button" onClick={() => void markAllRead()}>
                mark-all
            </button>
        </div>
    );
}

describe('NotificationContext', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        (api.get as any).mockReset();
        (api.post as any).mockReset();
        (toast as any).mockReset?.();
        (toast.error as any).mockReset?.();
    });

    it('renders the cached notification snapshot before the live preview request finishes', async () => {
        let resolvePreview: any;
        window.sessionStorage.setItem('nms_session_snapshot:notification_center_bootstrap_v1', JSON.stringify({
            savedAt: Date.now(),
            value: {
                notifications: [{ id: 'n1', title: 'Cached notice' }],
                unreadCount: 3,
                loadedLimit: 1,
            },
        }));
        let previewPromise: any;
        (api.get as any).mockImplementation(() => {
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
        (api.get as any)
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
        (api.get as any).mockResolvedValueOnce({
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
        (api.get as any)
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
            expect((api.get as any).mock.calls.filter(([url]: any[]) => url === '/system/notifications?limit=30')).toHaveLength(1);
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

    it('does not persist a fake empty snapshot before the initial fetch settles', async () => {
        (api.get as any).mockReturnValue(new Promise(() => {}));

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith('/system/notifications?limit=1');
        });

        expect(window.sessionStorage.getItem('nms_session_snapshot:notification_center_bootstrap_v1')).toBeNull();
    });

    it('decrements unreadCount only once per unread item and toasts errors on markRead failure', async () => {
        const user = userEvent.setup();
        (api.get as any).mockResolvedValueOnce({
            data: {
                obj: {
                    items: [{ id: 'n1', title: 'Alert 1', readAt: null }],
                    unreadCount: 2,
                },
            },
        });
        (api.post as any)
            .mockResolvedValueOnce({ data: { success: true } })
            .mockResolvedValueOnce({ data: { success: true } })
            .mockRejectedValueOnce(new Error('Network down'));

        render(
            <NotificationProvider wsLastMessage={null}>
                <NotificationConsumer />
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('notification-count')).toHaveTextContent('2');
        });

        await user.click(screen.getByRole('button', { name: 'mark-n1' }));
        expect(screen.getByTestId('notification-count')).toHaveTextContent('1');

        // Re-clicking an already-read notification must not decrement unreadCount again.
        await user.click(screen.getByRole('button', { name: 'mark-n1' }));
        expect(screen.getByTestId('notification-count')).toHaveTextContent('1');

        await user.click(screen.getByRole('button', { name: 'mark-all' }));
        expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
        expect(toast.error).toHaveBeenCalledTimes(1);
    });
});
