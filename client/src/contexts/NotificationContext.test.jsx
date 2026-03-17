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
        api.get.mockReset();
        api.post.mockReset();
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
});
