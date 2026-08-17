/**
 * Notification System — 通知分发系统
 *
 * 支持：
 * - in-app: 通过 WebSocket 推送到前端
 * - email: 使用现有邮件工具发送（如已配置 SMTP）
 * - 去重冷却窗口（避免同类告警刷屏）
 * - 持久化 in-memory 未读通知列表
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import telegramAlertService from './telegramAlertService.js';
import { saveObjectAtomic } from '../store/fileUtils.js';

export const SEVERITY = {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical',
} as const;

export type SeverityType = (typeof SEVERITY)[keyof typeof SEVERITY];

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5分钟内同类告警去重
const MAX_NOTIFICATIONS = 200; // 内存中最多保留条数
const NOTIFICATIONS_FILE = path.join(config.dataDir, 'notifications.json');

function startBackgroundInterval(fn: () => void, delayMs: number): NodeJS.Timeout {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function startBackgroundTimeout(fn: () => void, delayMs: number): NodeJS.Timeout {
    const timer = setTimeout(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

export interface NotificationItem {
    id: string;
    type: string;
    severity: SeverityType;
    title: string;
    body: string;
    meta: any;
    createdAt: string;
    readAt: string | null;
}

export interface NotifyOptions {
    type: string;
    severity?: SeverityType;
    title: string;
    body: string;
    meta?: any;
    dedupKey?: string;
}

class NotificationService extends EventEmitter {
    notifications: NotificationItem[];
    dedupCache: Map<string, number>;
    _savePending: boolean;

    constructor() {
        super();
        this.notifications = this._load();
        this.dedupCache = new Map();
        this._savePending = false;
    }

    _load(): NotificationItem[] {
        if (!fs.existsSync(NOTIFICATIONS_FILE)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'));
            if (!Array.isArray(parsed)) {
                throw new Error('Data in notifications.json is not a JSON array');
            }
            return parsed;
        } catch (e: any) {
            console.error('CRITICAL: Failed to load notifications.json:', e.message);
            throw e;
        }
    }

    _scheduleSave(): void {
        if (this._savePending) return;
        this._savePending = true;
        startBackgroundTimeout(() => {
            this._savePending = false;
            try {
                saveObjectAtomic(NOTIFICATIONS_FILE, this.notifications);
            } catch (e: any) {
                console.error('Failed to save notifications.json:', e.message);
            }
        }, 2000);
    }

    /**
     * 发送通知
     */
    notify({ type, severity = SEVERITY.INFO, title, body, meta = {}, dedupKey }: NotifyOptions): NotificationItem | null {
        const key = dedupKey || `${type}:${title}`;
        const lastNotified = this.dedupCache.get(key);
        const createdAt = new Date().toISOString();
        const occurrence = {
            type,
            severity,
            title,
            body,
            meta,
            dedupKey: key,
            dedupWindowMs: DEDUP_WINDOW_MS,
            createdAt,
        };
        if (lastNotified && Date.now() - lastNotified < DEDUP_WINDOW_MS) {
            void (telegramAlertService as any).noteNotificationOccurrence?.({
                ...occurrence,
                suppressed: true,
            });
            return null; // 冷却期内，跳过
        }

        this.dedupCache.set(key, Date.now());

        const notification: NotificationItem = {
            id: crypto.randomUUID(),
            type: String(type || 'system'),
            severity: (Object.values(SEVERITY) as string[]).includes(severity) ? severity : SEVERITY.INFO,
            title: String(title || ''),
            body: String(body || ''),
            meta,
            createdAt,
            readAt: null,
        };

        this.notifications.unshift(notification);
        if (this.notifications.length > MAX_NOTIFICATIONS) {
            this.notifications.length = MAX_NOTIFICATIONS;
        }

        // 触发事件，让 WebSocket 层监听并广播
        this.emit('notification', notification);
        void (telegramAlertService as any).noteNotificationOccurrence?.({
            ...notification,
            dedupKey: key,
            dedupWindowMs: DEDUP_WINDOW_MS,
            suppressed: false,
        });
        void (telegramAlertService as any).notifyNotification?.(notification);

        this._scheduleSave();
        return notification;
    }

    /**
     * 获取未读通知列表
     */
    getUnread(limit: number = 50): NotificationItem[] {
        return this.notifications
            .filter(n => !n.readAt)
            .slice(0, limit);
    }

    /**
     * 获取所有通知
     */
    getAll({ limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}): { total: number; items: NotificationItem[] } {
        return {
            total: this.notifications.length,
            items: this.notifications.slice(offset, offset + limit),
        };
    }

    /**
     * 标记单条已读
     */
    markRead(id: string): boolean {
        const n = this.notifications.find(item => item.id === id);
        if (!n) return false;
        n.readAt = new Date().toISOString();
        this._scheduleSave();
        return true;
    }

    /**
     * 标记全部已读
     */
    markAllRead(): number {
        const now = new Date().toISOString();
        for (const n of this.notifications) {
            if (!n.readAt) n.readAt = now;
        }
        this._scheduleSave();
        return this.notifications.length;
    }

    /**
     * 未读数量
     */
    unreadCount(): number {
        return this.notifications.filter(n => !n.readAt).length;
    }

    /**
     * 清空去重缓存（用于测试/重置）
     */
    clearDedupCache(): void {
        this.dedupCache.clear();
    }
}

const notificationService = new NotificationService();

// 定期清理过期去重缓存条目（避免内存泄漏）
startBackgroundInterval(() => {
    const cutoff = Date.now() - DEDUP_WINDOW_MS * 2;
    for (const [key, ts] of notificationService.dedupCache.entries()) {
        if (ts < cutoff) notificationService.dedupCache.delete(key);
    }
}, 10 * 60 * 1000);

export default notificationService;
