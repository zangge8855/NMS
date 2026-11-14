import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '../api/client';
import useTaskProgress from './useTaskProgress';
import useServerTelemetry from './useServerTelemetry';
import useWebSocket from './useWebSocket';

vi.mock('../api/client', () => ({
    default: {
        get: vi.fn(),
        delete: vi.fn(),
    },
}));

function TaskProgressHarness({ taskId }: { taskId: string | null }) {
    const { task, error, retrying, retry, dismiss } = useTaskProgress(taskId, null);
    return (
        <div>
            <div data-testid="task-status">{task?.status || 'none'}</div>
            <div data-testid="task-error">{error || ''}</div>
            <div data-testid="task-retrying">{retrying ? 'true' : 'false'}</div>
            <button type="button" onClick={retry}>retry</button>
            <button type="button" onClick={dismiss}>dismiss</button>
        </div>
    );
}

function TelemetryHarness({ enabled }: { enabled: boolean }) {
    const { telemetryLoading } = useServerTelemetry({ enabled, refreshIntervalMs: 60_000 });
    return <div data-testid="telemetry-loading">{telemetryLoading ? 'true' : 'false'}</div>;
}

function WebSocketHarness({
    url,
    shouldReconnect,
    onClose,
}: {
    url: string | null;
    shouldReconnect?: (details: any) => boolean;
    onClose?: (details: any) => void;
}) {
    const { status } = useWebSocket(url, {
        reconnectDelay: 50,
        maxReconnectDelay: 100,
        shouldReconnect,
        onClose,
    });
    return <div data-testid="ws-status">{status}</div>;
}

describe('useTaskProgress', () => {
    beforeEach(() => {
        (api.get as any).mockReset();
        (api.delete as any).mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stops polling immediately and surfaces error on fatal 404, then recovers via retry', async () => {
        (api.get as any)
            .mockRejectedValueOnce({ response: { status: 404, data: { msg: 'Task not found' } } })
            .mockResolvedValueOnce({ data: { obj: { id: 'task-1', status: 'completed' } } });

        render(<TaskProgressHarness taskId="task-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('task-error')).toHaveTextContent('Task not found');
        });
        expect(api.get).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'retry' }));

        await waitFor(() => {
            expect(screen.getByTestId('task-status')).toHaveTextContent('completed');
            expect(screen.getByTestId('task-error')).toHaveTextContent('');
            expect(screen.getByTestId('task-retrying')).toHaveTextContent('false');
        });
    });

    it('stops polling after 3 consecutive transient errors and clears state on dismiss', async () => {
        vi.useFakeTimers();
        (api.get as any).mockRejectedValue(new Error('502 Bad Gateway'));

        render(<TaskProgressHarness taskId="task-2" />);

        await act(async () => {
            await Promise.resolve();
        });
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('task-error')).toHaveTextContent('');

        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
        });
        expect(api.get).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('task-error')).toHaveTextContent('');

        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
        });
        expect(api.get).toHaveBeenCalledTimes(3);
        expect(screen.getByTestId('task-error')).toHaveTextContent('502 Bad Gateway');

        // Polling must stay halted on subsequent intervals.
        await act(async () => {
            vi.advanceTimersByTime(6000);
            await Promise.resolve();
        });
        expect(api.get).toHaveBeenCalledTimes(3);

        fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
        expect(screen.getByTestId('task-error')).toHaveTextContent('');
        expect(screen.getByTestId('task-status')).toHaveTextContent('none');
    });
});

describe('useServerTelemetry', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        (api.get as any).mockReset();
        (api.get as any).mockResolvedValue({ data: { obj: { items: [], byServerId: {} } } });
    });

    it('registers visibilitychange on document instead of window and cleans up on unmount', async () => {
        const docAddSpy = vi.spyOn(document, 'addEventListener');
        const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
        const winAddSpy = vi.spyOn(window, 'addEventListener');

        const { unmount } = render(<TelemetryHarness enabled />);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(1);
        });

        expect(docAddSpy.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true);
        expect(winAddSpy.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(false);

        unmount();
        expect(docRemoveSpy.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true);

        docAddSpy.mockRestore();
        docRemoveSpy.mockRestore();
        winAddSpy.mockRestore();
    });
});

describe('useWebSocket', () => {
    const originalWebSocket = globalThis.WebSocket;

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket;
        vi.useRealTimers();
    });

    it('stops reconnect storm when shouldReconnect returns false after failed handshake', () => {
        vi.useFakeTimers();
        const sockets: any[] = [];
        class MockWebSocket {
            static OPEN = 1;
            readyState = 0;
            onopen: ((ev: any) => void) | null = null;
            onclose: ((ev: any) => void) | null = null;
            onmessage: ((ev: any) => void) | null = null;
            onerror: ((ev: any) => void) | null = null;
            url: string;
            constructor(url: string) {
                this.url = url;
                sockets.push(this);
            }
            close() {
                this.readyState = 3;
            }
            send() {}
        }
        globalThis.WebSocket = MockWebSocket as any;

        const onClose = vi.fn();
        render(
            <WebSocketHarness
                url="ws://localhost/ws?ticket=expired"
                shouldReconnect={(details) => details.didOpen}
                onClose={onClose}
            />
        );

        expect(sockets).toHaveLength(1);
        act(() => {
            sockets[0].onclose?.({ code: 1006, reason: '', wasClean: false });
        });

        expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ didOpen: false, code: 1006 }));
        expect(screen.getByTestId('ws-status')).toHaveTextContent('disconnected');

        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(sockets).toHaveLength(1);
    });
});
