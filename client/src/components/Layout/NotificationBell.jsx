/**
 * NotificationBell — 通知铃铛组件
 *
 * 显示在顶部 Header 中，点击展开未读通知列表。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HiOutlineBell, HiOutlineCheckCircle } from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';

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

function clamp(value, min, max) {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const triggerRef = useRef(null);
    const dropdownRef = useRef(null);
    const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            const clickedInsideTrigger = ref.current?.contains(e.target);
            const clickedInsideDropdown = dropdownRef.current?.contains(e.target);
            if (!clickedInsideTrigger && !clickedInsideDropdown) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const computeDropdownPosition = useCallback(({ anchorRect, panelRect, viewport }) => {
        const viewportPadding = 12;
        const gap = 10;
        const width = Math.min(360, viewport.width - (viewportPadding * 2));
        const left = clamp(anchorRect.right - width, viewportPadding, viewport.width - width - viewportPadding);
        const spaceBelow = viewport.height - anchorRect.bottom - viewportPadding - gap;
        const spaceAbove = anchorRect.top - viewportPadding - gap;
        const measuredHeight = panelRect.height || 320;
        const openUpward = spaceBelow < Math.min(220, measuredHeight) && spaceAbove > spaceBelow;
        const maxHeight = Math.max(180, openUpward ? spaceAbove : spaceBelow);
        const renderedHeight = Math.min(measuredHeight, maxHeight);
        const top = openUpward
            ? clamp(anchorRect.top - renderedHeight - gap, viewportPadding, viewport.height - renderedHeight - viewportPadding)
            : clamp(anchorRect.bottom + gap, viewportPadding, viewport.height - renderedHeight - viewportPadding);
        const originX = clamp(anchorRect.right - left - (anchorRect.width / 2), 24, width - 24);

        return {
            top: `${top}px`,
            left: `${left}px`,
            width: `${width}px`,
            maxHeight: `${maxHeight}px`,
            transformOrigin: `${originX}px ${openUpward ? '100%' : '0%'}`,
        };
    }, []);

    const { panelStyle, isReady } = useFloatingPanel({
        open,
        anchorRef: triggerRef,
        panelRef: dropdownRef,
        computePosition: computeDropdownPosition,
        deps: [notifications.length, unreadCount],
    });

    const dropdown = open && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={dropdownRef}
                className={`notification-dropdown${isReady ? ' is-ready' : ''}`}
                style={panelStyle}
            >
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
                        notifications.slice(0, 30).map((n) => (
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
            </div>,
            document.body
        )
        : null;

    return (
        <>
        <div ref={ref} className="notification-bell">
            <button
                ref={triggerRef}
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
        </div>
        {dropdown}
        </>
    );
}
