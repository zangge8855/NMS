/**
 * NotificationBell — 通知铃铛组件
 *
 * 显示在顶部 Header 中，点击展开未读通知列表。
 */

import React, { useState, useRef, useEffect } from 'react';
import { HiOutlineBell, HiOutlineCheckCircle } from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    return new Date(isoString).toLocaleDateString('zh-CN');
}

function severityTone(severity) {
    if (severity === 'critical') return 'critical';
    if (severity === 'warning') return 'warning';
    return 'info';
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} className="notification-bell">
            <button
                className="btn btn-secondary btn-icon notification-trigger"
                onClick={() => setOpen(v => !v)}
                title="通知"
                aria-label="通知"
                aria-expanded={open}
            >
                <HiOutlineBell style={{ fontSize: '18px' }} />
                {unreadCount > 0 && (
                    <span className="notification-count-badge">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="notification-dropdown">
                    <div className="notification-dropdown-head">
                        <span className="notification-dropdown-title">
                            通知
                            {unreadCount > 0 && (
                                <span className="notification-dropdown-counter">
                                    {unreadCount}
                                </span>
                            )}
                        </span>
                        {unreadCount > 0 && (
                            <button
                                className="btn btn-ghost btn-sm notification-mark-all"
                                onClick={markAllRead}
                            >
                                <HiOutlineCheckCircle style={{ fontSize: '14px' }} />
                                全部已读
                            </button>
                        )}
                    </div>

                    <div className="notification-list">
                        {notifications.length === 0 ? (
                            <div className="notification-empty">
                                暂无通知
                            </div>
                        ) : (
                            notifications.slice(0, 30).map(n => (
                                <div
                                    key={n.id}
                                    onClick={() => !n.readAt && markRead(n.id)}
                                    className={`notification-item${n.readAt ? '' : ' is-unread'}`}
                                    data-severity={severityTone(n.severity)}
                                >
                                    <div className="notification-item-head">
                                        <span className={`notification-item-title${n.readAt ? '' : ' is-unread'}`}>
                                            {n.title}
                                        </span>
                                        <span className="notification-item-time">
                                            {formatRelativeTime(n.createdAt)}
                                        </span>
                                    </div>
                                    {n.body && (
                                        <div className="notification-item-body">
                                            {n.body}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
