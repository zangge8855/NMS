/**
 * NotificationContext — 实时通知上下文
 *
 * 通过 WebSocket 监听 NMS_NOTIFICATION 和 NMS_NOTIFICATION_COUNT 事件，
 * 维护未读通知列表，提供 markRead / markAllRead 接口。
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '../api/client.js';
import toast from 'react-hot-toast';
import { readSessionSnapshot, writeSessionSnapshot } from '../utils/sessionSnapshot.js';

const NotificationContext = createContext(null);
const INITIAL_NOTIFICATION_LIMIT = 1;
const EXPANDED_NOTIFICATION_LIMIT = 30;
const NOTIFICATION_SNAPSHOT_KEY = 'notification_center_bootstrap_v1';
const NOTIFICATION_SNAPSHOT_TTL_MS = 2 * 60_000;

function readNotificationSnapshot() {
    const snapshot = readSessionSnapshot(NOTIFICATION_SNAPSHOT_KEY, {
        maxAgeMs: NOTIFICATION_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
        notifications: Array.isArray(snapshot?.notifications) ? snapshot.notifications : [],
        unreadCount: typeof snapshot?.unreadCount === 'number' ? snapshot.unreadCount : 0,
        loadedLimit: Number(snapshot?.loadedLimit || 0),
    };
}

export function NotificationProvider({ children, wsLastMessage }) {
    const bootstrapRef = useRef(readNotificationSnapshot());
    const [notifications, setNotifications] = useState(() => bootstrapRef.current?.notifications || []);
    const [unreadCount, setUnreadCount] = useState(() => bootstrapRef.current?.unreadCount || 0);
    const [loading, setLoading] = useState(() => bootstrapRef.current == null);
    const initialFetchDone = useRef(false);
    const loadedLimitRef = useRef(Number(bootstrapRef.current?.loadedLimit || 0));
    const requestIdRef = useRef(0);

    useEffect(() => {
        writeSessionSnapshot(NOTIFICATION_SNAPSHOT_KEY, {
            notifications,
            unreadCount,
            loadedLimit: loadedLimitRef.current,
        });
    }, [notifications, unreadCount]);

    const fetchNotifications = useCallback(async (options = {}) => {
        const requestedLimit = Number(options.limit) > 0 ? Number(options.limit) : EXPANDED_NOTIFICATION_LIMIT;
        const force = options.force === true;
        const preserveCurrent = options.preserveCurrent === true || (options.preserveCurrent == null && notifications.length > 0);
        if (!force && loadedLimitRef.current >= requestedLimit) {
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!preserveCurrent) {
            setLoading(true);
        }
        try {
            const res = await api.get(`/system/notifications?limit=${requestedLimit}`);
            if (requestId !== requestIdRef.current) return;
            const obj = res.data?.obj || {};
            const items = Array.isArray(obj.items) ? obj.items : [];
            setNotifications(items);
            setUnreadCount(typeof obj.unreadCount === 'number' ? obj.unreadCount : 0);
            loadedLimitRef.current = Math.max(loadedLimitRef.current, items.length, requestedLimit);
        } catch {
            if (!preserveCurrent && requestId === requestIdRef.current) {
                setNotifications([]);
                setUnreadCount(0);
            }
        }
        if (requestId === requestIdRef.current) {
            setLoading(false);
        }
    }, [notifications.length]);

    // 首次加载
    useEffect(() => {
        if (initialFetchDone.current) return;
        initialFetchDone.current = true;
        fetchNotifications({
            limit: INITIAL_NOTIFICATION_LIMIT,
            preserveCurrent: bootstrapRef.current != null,
        });
    }, [fetchNotifications]);

    // 监听 WebSocket 通知消息
    useEffect(() => {
        if (!wsLastMessage) return;

        if (wsLastMessage.type === 'NMS_NOTIFICATION') {
            const { notification, unreadCount: newCount } = wsLastMessage.data || {};
            if (notification) {
                setNotifications((prev) => {
                    const next = [notification, ...prev.filter((item) => item.id !== notification.id)];
                    return next.slice(0, Math.max(loadedLimitRef.current || INITIAL_NOTIFICATION_LIMIT, INITIAL_NOTIFICATION_LIMIT));
                });
                // 弹出 toast 提示
                const toastFn = notification.severity === 'critical'
                    ? toast.error
                    : notification.severity === 'warning'
                    ? (msg, opts) => toast(msg, { ...opts, icon: '⚠️' })
                    : toast;
                toastFn(notification.title, { duration: 5000 });
            }
            if (typeof newCount === 'number') {
                setUnreadCount(newCount);
            }
        } else if (wsLastMessage.type === 'NMS_NOTIFICATION_COUNT') {
            const { unreadCount: newCount } = wsLastMessage.data || {};
            if (typeof newCount === 'number') {
                setUnreadCount(newCount);
            }
        }
    }, [wsLastMessage]);

    const ensureExpandedNotifications = useCallback(async () => {
        await fetchNotifications({ limit: EXPANDED_NOTIFICATION_LIMIT });
    }, [fetchNotifications]);

    const markRead = useCallback(async (id) => {
        try {
            await api.post('/system/notifications/read', { id });
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch {
            // 静默失败
        }
    }, []);

    const markAllRead = useCallback(async () => {
        try {
            await api.post('/system/notifications/read', { all: true });
            const now = new Date().toISOString();
            setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt || now })));
            setUnreadCount(0);
        } catch {
            // 静默失败
        }
    }, []);

    return (
        <NotificationContext.Provider value={{
            notifications,
            unreadCount,
            loading,
            markRead,
            markAllRead,
            ensureExpandedNotifications,
            refresh: (options = {}) => fetchNotifications({
                limit: EXPANDED_NOTIFICATION_LIMIT,
                force: true,
                ...options,
            }),
        }}>
            {children}
        </NotificationContext.Provider>
    );
}

export function useNotifications() {
    const ctx = useContext(NotificationContext);
    if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
    return ctx;
}
