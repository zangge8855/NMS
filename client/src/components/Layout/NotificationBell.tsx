/**
 * NotificationBell — 通知铃铛组件
 *
 * 显示在顶部 Header 中，点击展开通知列表，支持严重级别筛选、仅看未读与上下文跳转。
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInRouterContext, useNavigate, type NavigateFunction } from 'react-router-dom';
import {
    HiOutlineArrowTopRightOnSquare,
    HiOutlineBell,
    HiOutlineCheckCircle,
} from 'react-icons/hi2';
import {
    useNotifications,
    type NotificationItem,
} from '../../contexts/NotificationContext';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { resolveLocalizedNotificationText } from '../../utils/locale';
import { useOptionalServer } from '../../contexts/ServerContext';
import { useI18n } from '../../contexts/LanguageContext';
import { getOpsUiCopy, type OpsUiCopy } from '../../i18n/opsUiCopy';
import useFloatingPanel, { type ComputePositionParams } from '../../hooks/useFloatingPanel';
import { formatRelativeTime } from '../../utils/format';
import EmptyState from '../UI/EmptyState';

type SeverityTone = 'critical' | 'warning' | 'info';
type SeverityFilter = 'all' | SeverityTone;

function severityTone(severity?: string): SeverityTone {
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
    locale?: string,
) {
    const labels = copy.labels || {};
    const reasons = copy.reasons || {};
    const meta = notification.meta || {};
    const rows: Array<{ label: string; value: string }> = [];
    const localized = resolveLocalizedNotificationText(notification, locale);
    const mentioned = `${localized.title} ${localized.body}`;

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
            value: `${meta.method || '—'} ${meta.path || '—'}`.trim(),
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

function buildNotificationJumpActions(
    notification: NotificationItem,
    opsCopy: OpsUiCopy,
): Array<{ key: string; label: string; path: string }> {
    const meta = notification?.meta && typeof notification.meta === 'object' ? notification.meta : {};
    const actions: Array<{ key: string; label: string; path: string }> = [];
    const serverId = String(meta.serverId || '').trim();
    if (serverId) {
        actions.push({
            key: `server-${serverId}`,
            label: opsCopy.notifications.jumpToServer,
            path: `/servers/${encodeURIComponent(serverId)}`,
        });
    }

    const typeText = String(notification?.type || '').trim().toLowerCase();
    const eventText = String(meta.event || '').trim();
    const isAuditOrSecurity = Boolean(eventText)
        || typeText.startsWith('security_')
        || typeText.startsWith('audit_')
        || typeText.includes('security')
        || typeText.includes('audit')
        || typeText.includes('concurrency');

    if (isAuditOrSecurity) {
        actions.push({
            key: 'audit',
            label: opsCopy.notifications.jumpToAudit,
            path: '/audit',
        });
    }

    return actions;
}

/**
 * Collapse repeats of the same alert (same title, body and meta) into one entry,
 * keeping the newest occurrence and remembering every id so all can be marked read.
 */
function groupNotifications(items: NotificationItem[] = [], locale?: string) {
    const groups: Array<{ item: NotificationItem; ids: string[]; unreadIds: string[] }> = [];
    const index = new Map<string, number>();
    for (const item of items) {
        const meta = item.meta || {};
        const localized = resolveLocalizedNotificationText(item, locale);
        const key = [localized.title, localized.body, meta.serverId, meta.reasonCode, meta.event].map((v) => String(v || '')).join('|');
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

function NotificationBellContent({ navigate }: { navigate: NavigateFunction | null }) {
    const [open, setOpen] = useState(false);
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
    const [unreadOnly, setUnreadOnly] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const allFilterBtnRef = useRef<HTMLButtonElement | null>(null);
    const filterBarRef = useRef<HTMLDivElement | null>(null);
    const { notifications, unreadCount, markRead, markAllRead, ensureExpandedNotifications, canMarkRead } = useNotifications();
    const auth = useOptionalAuth();
    const isAuditor = auth?.user?.role === 'auditor' || canMarkRead === false;
    const { locale, tm } = useI18n();
    const copy = tm('comp.notifications');
    const opsCopy = React.useMemo(() => getOpsUiCopy(locale), [locale]);
    const dropdownId = useId();
    const serverContext = useOptionalServer();
    const serverNames = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const server of serverContext?.servers || []) {
            if (server?.id) map.set(String(server.id), String(server.name || server.id));
        }
        return map;
    }, [serverContext?.servers]);

    const notificationGroups = React.useMemo(
        () => groupNotifications(notifications.slice(0, 60), locale).slice(0, 30),
        [notifications, locale],
    );

    const baseGroups = React.useMemo(
        () => (unreadOnly ? notificationGroups.filter((group) => group.unreadIds.length > 0) : notificationGroups),
        [notificationGroups, unreadOnly],
    );

    const severityCounts = React.useMemo(() => {
        const counts: Record<SeverityFilter, number> = {
            all: baseGroups.length,
            critical: 0,
            warning: 0,
            info: 0,
        };
        for (const group of baseGroups) {
            counts[severityTone(group.item.severity)] += 1;
        }
        return counts;
    }, [baseGroups]);

    const filteredGroups = React.useMemo(() => {
        if (severityFilter === 'all') return baseGroups;
        return baseGroups.filter((group) => severityTone(group.item.severity) === severityFilter);
    }, [baseGroups, severityFilter]);

    const hasActiveFilters = severityFilter !== 'all' || unreadOnly;

    useEffect(() => {
        const closePopoverHandler = (event: Event) => {
            const source = (event as CustomEvent<{ source?: string }>).detail?.source;
            if (source === 'notification-bell') return;
            setOpen(false);
        };
        window.addEventListener('nms:close-popovers', closePopoverHandler);
        return () => window.removeEventListener('nms:close-popovers', closePopoverHandler);
    }, []);

    useEffect(() => {
        if (!open) return;
        void ensureExpandedNotifications();
        const handler = (e: Event) => {
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
        document.addEventListener('pointerdown', handler);
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', keyHandler);
        requestAnimationFrame(() => dropdownRef.current?.focus({ preventScroll: true }));
        return () => {
            document.removeEventListener('pointerdown', handler);
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', keyHandler);
        };
    }, [open, ensureExpandedNotifications]);

    const computeDropdownPosition = useCallback(({ anchorRect, panelRect, viewport }: ComputePositionParams) => {
        const viewportPadding = 12;
        const bottomReserve = viewport.width <= 768 ? 84 : viewportPadding;
        const gap = 10;
        const width = Math.min(396, viewport.width - (viewportPadding * 2));
        const left = clamp(anchorRect.right - width, viewportPadding, viewport.width - width - viewportPadding);
        const spaceBelow = viewport.height - anchorRect.bottom - bottomReserve - gap;
        const spaceAbove = anchorRect.top - viewportPadding - gap;
        const measuredHeight = panelRect.height || 340;
        const openUpward = spaceBelow < Math.min(220, measuredHeight) && spaceAbove > spaceBelow;
        const maxHeight = Math.max(160, openUpward ? spaceAbove : spaceBelow);
        const renderedHeight = Math.min(measuredHeight, maxHeight);
        const top = openUpward
            ? clamp(anchorRect.top - renderedHeight - gap, viewportPadding, viewport.height - renderedHeight - bottomReserve)
            : clamp(anchorRect.bottom + gap, viewportPadding, viewport.height - renderedHeight - bottomReserve);
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
        repositionKey: `${notifications.length}:${unreadCount}:${severityFilter}:${unreadOnly}:${filteredGroups.length}`,
    });

    const activateNotification = (unreadIds: string[] = []) => {
        if (isAuditor) return;
        unreadIds.forEach((id) => markRead(id));
    };

    const handleJump = (path: string, unreadIds: string[] = []) => {
        if (!isAuditor && unreadIds.length > 0) {
            activateNotification(unreadIds);
        }
        setOpen(false);
        if (navigate) {
            navigate(path);
        } else if (typeof window !== 'undefined' && window.history?.pushState) {
            window.history.pushState(null, '', path);
        }
    };

    const handleResetFilters = () => {
        setSeverityFilter('all');
        setUnreadOnly(false);
        requestAnimationFrame(() => allFilterBtnRef.current?.focus());
    };

    const handleFilterBarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const buttons = Array.from(filterBarRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (currentIndex === -1 || buttons.length === 0) return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
    };

    const filterOptions: Array<{ key: SeverityFilter; label: string; count: number }> = [
        { key: 'all', label: opsCopy.notifications.severityAll, count: severityCounts.all },
        { key: 'critical', label: opsCopy.notifications.severityCritical, count: severityCounts.critical },
        { key: 'warning', label: opsCopy.notifications.severityWarning, count: severityCounts.warning },
        { key: 'info', label: opsCopy.notifications.severityInfo, count: severityCounts.info },
    ];

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
                    {!isAuditor && unreadCount > 0 && (
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

                <div
                    ref={filterBarRef}
                    className="notification-filter-bar"
                    onKeyDown={handleFilterBarKeyDown}
                >
                    <div
                        className="notification-filter-pills"
                        role="group"
                        aria-label={opsCopy.notifications.filterGroupLabel}
                    >
                        {filterOptions.map((option) => (
                            <button
                                key={option.key}
                                ref={option.key === 'all' ? allFilterBtnRef : undefined}
                                type="button"
                                className={`notification-filter-pill${severityFilter === option.key ? ' is-active' : ''}`}
                                data-severity-filter={option.key}
                                aria-pressed={severityFilter === option.key}
                                onClick={() => setSeverityFilter(option.key)}
                            >
                                <span>{option.label}</span>
                                <span className="notification-filter-pill-count">{option.count}</span>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        className={`notification-filter-unread${unreadOnly ? ' is-active' : ''}`}
                        aria-pressed={unreadOnly}
                        onClick={() => setUnreadOnly((current) => !current)}
                    >
                        {opsCopy.notifications.unreadOnly}
                    </button>
                </div>

                <div className="notification-list">
                    {filteredGroups.length === 0 ? (
                        <div className="notification-empty-wrap">
                            <EmptyState
                                size="compact"
                                hideIcon
                                title={hasActiveFilters
                                    ? opsCopy.notifications.filteredEmptyTitle
                                    : (copy.empty || opsCopy.notifications.emptyTitle)}
                                subtitle={hasActiveFilters
                                    ? opsCopy.notifications.filteredEmptySubtitle
                                    : opsCopy.notifications.emptySubtitle}
                                action={hasActiveFilters ? (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={handleResetFilters}
                                    >
                                        {opsCopy.notifications.resetFilters}
                                    </button>
                                ) : undefined}
                            />
                        </div>
                    ) : (
                        filteredGroups.map(({ item: n, ids, unreadIds }) => {
                            const localized = resolveLocalizedNotificationText(n, locale);
                            const metaRows = buildNotificationMetaRows(n, copy, serverNames, locale);
                            const jumpActions = buildNotificationJumpActions(n, opsCopy);
                            const isUnread = unreadIds.length > 0;
                            return (
                                <div
                                    key={n.id}
                                    className={`notification-item${isUnread ? ' is-unread' : ''}`}
                                    data-severity={severityTone(n.severity)}
                                >
                                    <div
                                        className="notification-item-main"
                                        onClick={() => activateNotification(unreadIds)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                activateNotification(unreadIds);
                                            } else if (event.key === ' ') {
                                                event.preventDefault();
                                            }
                                        }}
                                        onKeyUp={(event) => {
                                            if (event.key === ' ') {
                                                event.preventDefault();
                                                activateNotification(unreadIds);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`${copy.openItem || copy.title}: ${localized.title}`}
                                    >
                                        <div className="notification-item-head">
                                            <span className={`notification-item-title${isUnread ? ' is-unread' : ''}`}>
                                                {localized.title}
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
                                        {localized.body && (
                                            <div className="notification-item-body">
                                                {localized.body}
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
                                    {jumpActions.length > 0 && (
                                        <div className="notification-item-actions">
                                            {jumpActions.map((action) => (
                                                <button
                                                    key={`${n.id}-${action.key}`}
                                                    type="button"
                                                    className="notification-jump-btn"
                                                    onClick={() => handleJump(action.path, unreadIds)}
                                                >
                                                    <span>{action.label}</span>
                                                    <HiOutlineArrowTopRightOnSquare className="notification-jump-icon" aria-hidden="true" />
                                                </button>
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
                    type="button"
                    className="btn btn-secondary btn-icon notification-trigger"
                    onClick={() => {
                        const next = !open;
                        if (next) {
                            window.dispatchEvent(new CustomEvent('nms:close-popovers', {
                                detail: { source: 'notification-bell' },
                            }));
                        }
                        setOpen(next);
                    }}
                    title={copy.triggerTitle}
                    aria-label={copy.triggerTitle}
                    aria-expanded={open}
                    aria-controls={open ? dropdownId : undefined}
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

export default function NotificationBell() {
    const inRouter = useInRouterContext();
    if (inRouter) {
        return <NotificationBellWithRouter />;
    }
    return <NotificationBellContent navigate={null} />;
}

function NotificationBellWithRouter() {
    const navigate = useNavigate();
    return <NotificationBellContent navigate={navigate} />;
}
