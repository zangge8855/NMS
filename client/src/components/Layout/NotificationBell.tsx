/**
 * NotificationBell — 通知铃铛组件
 *
 * 显示在顶部 Header 中，点击展开未读通知列表。
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HiOutlineBell, HiOutlineCheckCircle } from 'react-icons/hi2';
import { useNotifications, type NotificationItem } from '../../contexts/NotificationContext';
import { useOptionalServer } from '../../contexts/ServerContext';
import { useI18n } from '../../contexts/LanguageContext';
import useFloatingPanel, { type ComputePositionParams } from '../../hooks/useFloatingPanel';
import { formatRelativeTime } from '../../utils/format';

function severityTone(severity?: string): string {
    if (severity === 'critical') return 'critical';
    if (severity === 'warning') return 'warning';
    return 'info';
}

function clamp(value: number, min: number, max: number): number {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

function buildNotificationMetaRows(
    notification: NotificationItem = { id: '', title: '' },
    copy: Record<string, any> = {},
    serverNames: Map<string, string> = new Map(),
) {
    const labels = copy.labels || {};
    const reasons = copy.reasons || {};
    const meta = notification.meta || {};
    const rows: Array<{ label: string; value: string }> = [];
    const mentioned = `${notification.title || ''} ${notification.body || ''}`;

    if (meta.serverId) {
        const serverId = String(meta.serverId);
        const serverName = serverNames.get(serverId) || serverId;
        // Skip the node row when the title/body already names the node.
        if (!mentioned.includes(serverName)) {
            rows.push({ label: labels.node, value: serverName });
        }
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
    // Recovery events carry reasonCode "none"; there is nothing to explain, so skip the row.
    if (meta.reasonCode && String(meta.reasonCode) !== 'none') {
        const reasonCode = String(meta.reasonCode);
        rows.push({ label: labels.reason, value: reasons[reasonCode] || reasonCode });
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

/**
 * Collapse repeats of the same alert (same title, body and meta) into one entry,
 * keeping the newest occurrence and remembering every id so all can be marked read.
 */
function groupNotifications(items: NotificationItem[] = []) {
    const groups: Array<{ item: NotificationItem; ids: string[]; unreadIds: string[] }> = [];
    const index = new Map<string, number>();
    for (const item of items) {
        const meta = item.meta || {};
        const key = [item.title, item.body, meta.serverId, meta.reasonCode, meta.event].map((v) => String(v || '')).join('|');
        const existing = index.get(key);
        if (existing === undefined) {
            index.set(key, groups.length);
            groups.push({ item, ids: [item.id], unreadIds: item.readAt ? [] : [item.id] });
        } else {
            groups[existing].ids.push(item.id);
            if (!item.readAt) groups[existing].unreadIds.push(item.id);
        }
    }
    return groups;
}

function truncateLine(value: any, limit = 180): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const { notifications, unreadCount, markRead, markAllRead, ensureExpandedNotifications } = useNotifications();
    const { locale, tm } = useI18n();
    const copy = tm('comp.notifications');
    const dropdownId = useId();
    const serverContext = useOptionalServer();
    const serverNames = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const server of serverContext?.servers || []) {
            if (server?.id) map.set(String(server.id), String(server.name || server.id));
        }
        return map;
    }, [serverContext?.servers]);
    const notificationGroups = React.useMemo(() => groupNotifications(notifications.slice(0, 60)).slice(0, 30), [notifications]);

    useEffect(() => {
        if (!open) return;
        void ensureExpandedNotifications();
        const handler = (e: MouseEvent) => {
            const clickedInsideTrigger = ref.current?.contains(e.target as Node);
            const clickedInsideDropdown = dropdownRef.current?.contains(e.target as Node);
            if (!clickedInsideTrigger && !clickedInsideDropdown) setOpen(false);
        };
        const keyHandler = (e: KeyboardEvent) => {
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

    const computeDropdownPosition = useCallback(({ anchorRect, panelRect, viewport }: ComputePositionParams) => {
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

    const activateNotification = (unreadIds: string[] = []) => {
        unreadIds.forEach((id) => markRead(id));
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
                        notificationGroups.map(({ item: n, ids, unreadIds }) => {
                            const metaRows = buildNotificationMetaRows(n, copy, serverNames);
                            const isUnread = unreadIds.length > 0;
                            return (
                            <div
                                key={n.id}
                                onClick={() => activateNotification(unreadIds)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        activateNotification(unreadIds);
                                    }
                                }}
                                className={`notification-item${isUnread ? ' is-unread' : ''}`}
                                data-severity={severityTone(n.severity)}
                                role="button"
                                tabIndex={0}
                                aria-label={`${copy.openItem || copy.title}: ${n.title}`}
                            >
                                <div className="notification-item-head">
                                    <span className={`notification-item-title${isUnread ? ' is-unread' : ''}`}>
                                        {n.title}
                                        {ids.length > 1 && (
                                            <span className="notification-item-repeat">
                                                {String(copy.repeatCount || '×{count}').replace('{count}', String(ids.length))}
                                            </span>
                                        )}
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
                onClick={() => setOpen((v) => !v)}
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
