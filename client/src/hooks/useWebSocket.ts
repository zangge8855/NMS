import { useState, useEffect, useRef, useCallback } from 'react';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface UseWebSocketOptions {
    reconnectDelay?: number;
    maxReconnectDelay?: number;
    onMessage?: (data: any) => void;
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
    } = options;

    const [status, setStatus] = useState<WebSocketStatus>('disconnected');
    const [lastMessage, setLastMessage] = useState<any>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<any>(null);
    const delayRef = useRef<number>(reconnectDelay);
    const mountedRef = useRef<boolean>(true);
    const onMessageRef = useRef<((data: any) => void) | undefined>(onMessage);
    onMessageRef.current = onMessage;

    const cleanup = useCallback(() => {
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
            if (!mountedRef.current) return;
            setStatus('connected');
            delayRef.current = reconnectDelay; // reset backoff
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current) return;
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

        ws.onclose = () => {
            if (!mountedRef.current) return;
            wsRef.current = null;
            setStatus('reconnecting');

            // Exponential backoff reconnect
            const delay = Math.min(delayRef.current, maxReconnectDelay);
            reconnectTimerRef.current = setTimeout(() => {
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
