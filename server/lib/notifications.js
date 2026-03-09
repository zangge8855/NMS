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

export const SEVERITY = {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical',
};

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5分钟内同类告警去重
const MAX_NOTIFICATIONS = 200; // 内存中最多保留条数
const NOTIFICATIONS_FILE = path.join(config.dataDir, 'notifications.json');

function startBackgroundInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function startBackgroundTimeout(fn, delayMs) {
    const timer = setTimeout(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

class NotificationService extends EventEmitter {
    constructor() {
        super();
        this.notifications = this._load();
        this.dedupCache = new Map();
        this._savePending = false;
    }

    _load() {
        try {
            if (fs.existsSync(NOTIFICATIONS_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'));
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.error('Failed to load notifications.json:', e.message);
        }
        return [];
    }

    _scheduleSave() {
        if (this._savePending) return;
        this._savePending = true;
        startBackgroundTimeout(() => {
            this._savePending = false;
            try {
                fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(this.notifications, null, 2), 'utf8');
            } catch (e) {
                console.error('Failed to save notifications.json:', e.message);
            }
        }, 2000);
    }

    /**
     * 发送通知
     * @param {object} opts
     * @param {string} opts.type     通知类型（如 'db_write_failure'）
     * @param {string} opts.severity 'info' | 'warning' | 'critical'
     * @param {string} opts.title    标题
     * @param {string} opts.body     详细内容
     * @param {object} [opts.meta]   额外元数据
     * @param {string} [opts.dedupKey] 去重键（同 key 在冷却窗口内不重复发送）
     * @returns {object|null} 通知对象（被去重则返回 null）
     */
    notify({ type, severity = SEVERITY.INFO, title, body, meta = {}, dedupKey }) {
        const key = dedupKey || `${type}:${title}`;
        const lastNotified = this.dedupCache.get(key);
        if (lastNotified && Date.now() - lastNotified < DEDUP_WINDOW_MS) {
            return null; // 冷却期内，跳过
        }

        this.dedupCache.set(key, Date.now());

        const notification = {
            id: crypto.randomUUID(),
            type: String(type || 'system'),
            severity: Object.values(SEVERITY).includes(severity) ? severity : SEVERITY.INFO,
            title: String(title || ''),
            body: String(body || ''),
            meta,
            createdAt: new Date().toISOString(),
            readAt: null,
        };

        this.notifications.unshift(notification);
        if (this.notifications.length > MAX_NOTIFICATIONS) {
            this.notifications.length = MAX_NOTIFICATIONS;
        }

        // 触发事件，让 WebSocket 层监听并广播
        this.emit('notification', notification);

        this._scheduleSave();
        return notification;
    }

    /**
     * 获取未读通知列表
     */
    getUnread(limit = 50) {
        return this.notifications
            .filter(n => !n.readAt)
            .slice(0, limit);
    }

    /**
     * 获取所有通知
     */
    getAll({ limit = 50, offset = 0 } = {}) {
        return {
            total: this.notifications.length,
            items: this.notifications.slice(offset, offset + limit),
        };
    }

    /**
     * 标记单条已读
     */
    markRead(id) {
        const n = this.notifications.find(item => item.id === id);
        if (!n) return false;
        n.readAt = new Date().toISOString();
        this._scheduleSave();
        return true;
    }

    /**
     * 标记全部已读
     */
    markAllRead() {
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
    unreadCount() {
        return this.notifications.filter(n => !n.readAt).length;
    }

    /**
     * 清空去重缓存（用于测试/重置）
     */
    clearDedupCache() {
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
