/**
 * NotificationBell — 通知铃铛组件
 *
 * 显示在顶部 Header 中，点击展开未读通知列表。
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HiOutlineBell, HiOutlineCheckCircle } from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';
import { formatRelativeTime } from '../../utils/format.js';

function severityTone(severity) {
    if (severity === 'critical') return 'critical';
    if (severity === 'warning') return 'warning';
    return 'info';
}

function clamp(value, min, max) {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

function buildNotificationMetaRows(notification = {}, copy = {}) {
    const labels = copy.labels || {};
    const meta = notification.meta || {};
    const rows = [];

    if (meta.serverId) {
        rows.push({ label: labels.node, value: String(meta.serverId) });
    }
    if (meta.ip) {
        rows.push({ label: labels.sourceIp, value: String(meta.ip) });
    }
    if (meta.ipLocation || meta.ipCarrier) {
        rows.push({
            label: labels.locationCarrier,
            value: [meta.ipLocation, meta.ipCarrier].filter(Boolean).join(' · '),
        });
    }
    if (meta.method || meta.path) {
        rows.push({
            label: labels.request,
            value: `${meta.method || '-'} ${meta.path || '-'}`.trim(),
        });
    }
    if (meta.reasonCode) {
        rows.push({ label: labels.reason, value: String(meta.reasonCode) });
    }
    if (meta.event) {
        rows.push({ label: labels.event, value: String(meta.event) });
    }

    return rows
        .map((item) => ({
            ...item,
            value: truncateLine(item.value, 180),
        }))
        .filter((item) => item.value);
}

function truncateLine(value, limit = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const triggerRef = useRef(null);
    const dropdownRef = useRef(null);
    const { notifications, unreadCount, markRead, markAllRead, ensureExpandedNotifications } = useNotifications();
    const { locale, tm } = useI18n();
    const copy = tm('comp.notifications');
    const dropdownId = useId();

    useEffect(() => {
        if (!open) return;
        void ensureExpandedNotifications();
        const handler = (e) => {
            const clickedInsideTrigger = ref.current?.contains(e.target);
            const clickedInsideDropdown = dropdownRef.current?.contains(e.target);
            if (!clickedInsideTrigger && !clickedInsideDropdown) setOpen(false);
        };
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', keyHandler);
        requestAnimationFrame(() => dropdownRef.current?.focus({ preventScroll: true }));
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', keyHandler);
        };
    }, [open, ensureExpandedNotifications]);

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

    const activateNotification = (notification) => {
        if (!notification?.readAt) {
            markRead(notification.id);
        }
    };

    const dropdown = open && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={dropdownRef}
                id={dropdownId}
                className={`notification-dropdown${isReady ? ' is-ready' : ''}`}
                style={panelStyle}
                role="dialog"
                aria-label={copy.panelLabel || copy.title}
                tabIndex={-1}
            >
                <div className="notification-dropdown-head">
                        <span className="notification-dropdown-title">
                        {copy.title}
                        {unreadCount > 0 && (
                            <span className="notification-dropdown-counter">
                                {unreadCount}
                            </span>
                        )}
                    </span>
                    {unreadCount > 0 && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm notification-mark-all"
                            onClick={markAllRead}
                            aria-label={copy.markAllRead}
                        >
                            <HiOutlineCheckCircle className="notification-action-icon" aria-hidden="true" />
                            {copy.markAllRead}
                        </button>
                    )}
                </div>

                <div className="notification-list">
                    {notifications.length === 0 ? (
                        <div className="notification-empty">
                            {copy.empty}
                        </div>
                    ) : (
                        notifications.slice(0, 30).map((n) => {
                            const metaRows = buildNotificationMetaRows(n, copy);
                            return (
                            <div
                                key={n.id}
                                onClick={() => activateNotification(n)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        activateNotification(n);
                                    }
                                }}
                                className={`notification-item${n.readAt ? '' : ' is-unread'}`}
                                data-severity={severityTone(n.severity)}
                                role="button"
                                tabIndex={0}
                                aria-label={`${copy.openItem || copy.title}: ${n.title}`}
                            >
                                <div className="notification-item-head">
                                    <span className={`notification-item-title${n.readAt ? '' : ' is-unread'}`}>
                                        {n.title}
                                    </span>
                                    <span className="notification-item-time">
                                        {formatRelativeTime(n.createdAt, locale)}
                                    </span>
                                </div>
                                {n.body && (
                                    <div className="notification-item-body">
                                        {n.body}
                                    </div>
                                )}
                                {metaRows.length > 0 && (
                                    <div className="notification-item-meta">
                                        {metaRows.map((row) => (
                                            <div key={`${n.id}-${row.label}`} className="notification-item-meta-row">
                                                <span className="notification-item-meta-label">{row.label}</span>
                                                <span className="notification-item-meta-value">{row.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            );
                        })
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
                title={copy.triggerTitle}
                aria-label={copy.triggerTitle}
                aria-expanded={open}
                aria-controls={dropdownId}
            >
                <HiOutlineBell className="notification-trigger-icon" aria-hidden="true" />
                {unreadCount > 0 && (
                    <span className="notification-count-badge" aria-hidden="true">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>
        </div>
        {dropdown}
        </>
    );
}
