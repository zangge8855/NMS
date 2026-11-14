import { useState, useEffect, useRef, useCallback } from 'react';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WebSocketCloseDetails {
    code: number;
    reason: string;
    wasClean: boolean;
    didOpen: boolean;
}

export interface UseWebSocketOptions {
    reconnectDelay?: number;
    maxReconnectDelay?: number;
    onMessage?: (data: any) => void;
    onClose?: (details: WebSocketCloseDetails) => void;
    shouldReconnect?: (details: WebSocketCloseDetails) => boolean;
}

export interface UseWebSocketReturn {
    status: WebSocketStatus;
    lastMessage: any;
    sendMessage: (data: any) => void;
}

/**
 * useWebSocket — 自动重连 WebSocket Hook
 *
 * @param url  WebSocket URL (null = 不连接)
 * @param options
 * @returns {{ status, lastMessage, sendMessage }}
 */
export default function useWebSocket(
    url?: string | null,
    options: UseWebSocketOptions = {}
): UseWebSocketReturn {
    const {
        reconnectDelay = 2000,
        maxReconnectDelay = 30000,
        onMessage,
        onClose,
        shouldReconnect,
    } = options;

    const [status, setStatus] = useState<WebSocketStatus>('disconnected');
    const [lastMessage, setLastMessage] = useState<any>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<any>(null);
    const delayRef = useRef<number>(reconnectDelay);
    const mountedRef = useRef<boolean>(true);
    const openedRef = useRef<boolean>(false);
    const onMessageRef = useRef<((data: any) => void) | undefined>(onMessage);
    const onCloseRef = useRef<((details: WebSocketCloseDetails) => void) | undefined>(onClose);
    const shouldReconnectRef = useRef<((details: WebSocketCloseDetails) => boolean) | undefined>(shouldReconnect);
    onMessageRef.current = onMessage;
    onCloseRef.current = onClose;
    shouldReconnectRef.current = shouldReconnect;

    const cleanup = useCallback(() => {
        openedRef.current = false;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.onopen = null;
            wsRef.current.onclose = null;
            wsRef.current.onmessage = null;
            wsRef.current.onerror = null;
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    const connect = useCallback(() => {
        if (!url || !mountedRef.current) return;

        cleanup();
        setStatus('connecting');

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mountedRef.current || wsRef.current !== ws) return;
            openedRef.current = true;
            setStatus('connected');
            delayRef.current = reconnectDelay; // reset backoff
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current || wsRef.current !== ws) return;
            try {
                const data = JSON.parse(event.data);
                setLastMessage(data);
                onMessageRef.current?.(data);
            } catch {
                // ignore non-JSON messages
            }
        };

        ws.onerror = () => {
            // onclose will fire after this
        };

        ws.onclose = (event) => {
            if (!mountedRef.current || wsRef.current !== ws) return;
            const details: WebSocketCloseDetails = {
                code: typeof event?.code === 'number' ? event.code : 1006,
                reason: typeof event?.reason === 'string' ? event.reason : '',
                wasClean: Boolean(event?.wasClean),
                didOpen: openedRef.current,
            };
            openedRef.current = false;
            wsRef.current = null;

            const allowReconnect = shouldReconnectRef.current
                ? shouldReconnectRef.current(details) !== false
                : true;
            onCloseRef.current?.(details);

            if (!mountedRef.current) return;
            if (!allowReconnect) {
                setStatus('disconnected');
                return;
            }

            setStatus('reconnecting');

            // Exponential backoff reconnect
            const delay = Math.min(delayRef.current, maxReconnectDelay);
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                if (mountedRef.current) {
                    delayRef.current = Math.min(delayRef.current * 1.5, maxReconnectDelay);
                    connect();
                }
            }, delay);
        };
    }, [url, reconnectDelay, maxReconnectDelay, cleanup]);

    useEffect(() => {
        mountedRef.current = true;
        connect();
        return () => {
            mountedRef.current = false;
            cleanup();
            setStatus('disconnected');
        };
    }, [connect, cleanup]);

    const sendMessage = useCallback((data: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
    }, []);

    return { status, lastMessage, sendMessage };
}
