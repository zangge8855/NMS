/**
 * NodeHealthGrid — 节点健康状态网格
 *
 * 以色彩编码的磁贴展示每个节点的实时状态，
 * 支持 hover 显示详细信息，点击可导航到节点管理。
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '../../utils/format.js';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import {
    HiOutlineServerStack,
    HiOutlineSignal,
    HiOutlineXMark,
} from 'react-icons/hi2';

const NODE_HEALTH_INITIAL_LIMIT = 6;
const NODE_HEALTH_DENSE_LIMIT = 4;
const NODE_HEALTH_DENSE_THRESHOLD = 8;

function getNodeHealthCopy(locale) {
    return locale === 'en-US'
        ? {
            searchPlaceholder: 'Search nodes',
            healthy: 'Healthy',
            warning: 'Watch',
            offline: 'Offline',
            critical: 'Critical',
            shown: 'Showing {shown}/{total}',
            showAll: 'Show all',
            collapse: 'Collapse',
            denseMode: 'Priority view',
            noMatch: 'No matching nodes',
            addNode: 'Add Node',
            clearFilter: 'Clear filter',
            authFailed: 'Credentials rejected',
            connectionRefused: 'Connection refused',
            connectTimeout: 'Connection timed out',
            networkError: 'Network error',
            panelRequestFailed: 'Panel request failed',
            inspectHint: 'Open node details to inspect and retry.',
        }
        : {
            searchPlaceholder: '搜索节点',
            healthy: '正常',
            warning: '关注',
            offline: '离线',
            critical: '异常',
            shown: '显示 {shown}/{total}',
            showAll: '展开全部',
            collapse: '收起',
            denseMode: '重点视图',
            noMatch: '没有匹配节点',
            addNode: '前往添加节点',
            clearFilter: '清空筛选',
            authFailed: '凭据无效',
            connectionRefused: '节点拒绝连接',
            connectTimeout: '连接超时',
            networkError: '网络异常',
            panelRequestFailed: '面板请求失败',
            inspectHint: '打开节点详情检查配置并重试。',
        };
}

function getNodeColor(serverData, t) {
    if (!serverData?.online) {
        if (serverData?.reasonCode === 'auth_failed') {
            return { tone: 'warning', dot: 'var(--accent-warning)', label: t('pages.nodeHealth.statusAuthFailed') };
        }
        return { tone: 'danger', dot: 'var(--accent-danger)', label: t('pages.nodeHealth.statusOffline') };
    }
    const cpu = serverData.status?.cpu ?? 0;
    if (cpu > 85) return { tone: 'danger', dot: 'var(--accent-danger)', label: t('pages.nodeHealth.statusHighLoad') };
    if (cpu > 70) return { tone: 'warning', dot: 'var(--accent-warning)', label: t('pages.nodeHealth.statusElevated') };
    return { tone: 'success', dot: 'var(--accent-success)', label: t('pages.nodeHealth.statusHealthy') };
}

function getNodeFailureCopy(serverData, copy) {
    const labels = {
        auth_failed: copy.authFailed,
        connection_refused: copy.connectionRefused,
        connect_timeout: copy.connectTimeout,
        network_error: copy.networkError,
        dns_error: copy.networkError,
        panel_request_failed: copy.panelRequestFailed,
    };
    return labels[String(serverData?.reasonCode || '').trim()] || copy.offline;
}

function buildSparkline(points, width = 132, height = 34, padding = 3) {
    const values = (Array.isArray(points) ? points : [])
        .map((item) => Math.max(0, Math.min(100, Number(item?.cpu || 0))));
    if (values.length === 0) return null;

    const drawableWidth = Math.max(1, width - (padding * 2));
    const drawableHeight = Math.max(1, height - (padding * 2));
    const step = values.length === 1 ? 0 : drawableWidth / (values.length - 1);
    const coords = values.map((value, index) => ({
        x: padding + (step * index),
        y: padding + (((100 - value) / 100) * drawableHeight),
    }));

    const path = coords
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(' ');
    const first = coords[0];
    const last = coords[coords.length - 1];
    const fill = `${path} L ${last.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${first.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;

    return {
        path,
        fill,
        last,
        lastValue: values[values.length - 1],
    };
}

function getNodePriority(entry) {
    if (!entry?.serverData?.online) return 0;
    if (entry.tone === 'danger') return 1;
    if (entry.tone === 'warning') return 2;
    return 3;
}

function NodeTile({ server, serverData, trend = [], showSparkline = false }) {
    const navigate = useNavigate();
    const { t, locale } = useI18n();
    const copy = getNodeHealthCopy(locale);
    const color = getNodeColor(serverData, t);
    const isOnline = serverData?.online;
    const cpu = serverData?.status?.cpu ?? 0;
    const mem = serverData?.status?.mem;
    const memPercent = mem && mem.total > 0 ? ((mem.current / mem.total) * 100) : 0;
    const trafficReady = serverData?.managedTrafficReady === true;
    const traffic = trafficReady ? Number(serverData?.managedTrafficTotal || 0) : null;
    const remarkPreview = Array.isArray(serverData?.nodeRemarkPreview)
        ? serverData.nodeRemarkPreview
        : Array.isArray(serverData?.nodeRemarks)
            ? serverData.nodeRemarks.slice(0, 2)
            : [];
    const extraRemarkCount = Math.max(0, Number(serverData?.nodeRemarkCount || 0) - remarkPreview.length);
    const remarksTitle = Array.isArray(serverData?.nodeRemarks) ? serverData.nodeRemarks.join(' / ') : '';
    const statusLabel = `${server.name} — ${color.label}`;
    const sparkline = buildSparkline(trend);
    const handleOpen = () => navigate(`/servers/${server.id}`);
    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpen();
        }
    };

    return (
        <div
            className="node-health-tile"
            onClick={handleOpen}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
            aria-label={statusLabel}
            style={{
                '--node-color': color.dot,
            }}
            data-tone={color.tone}
        >
            <div className="node-health-tile-head">
                <div className="node-health-tile-title">
                    {isOnline
                        ? <HiOutlineSignal style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                        : <HiOutlineXMark style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                    }
                    <div className="node-health-tile-heading">
                        <span className="node-health-tile-name">{server.name}</span>
                        {remarkPreview.length > 0 && (
                            <div className="node-health-tile-remarks" title={remarksTitle}>
                                {remarkPreview.map((remark) => (
                                    <span key={`${server.id}-${remark}`} className="node-health-tile-remark">
                                        {remark}
                                    </span>
                                ))}
                                {extraRemarkCount > 0 && (
                                    <span className="node-health-tile-remark node-health-tile-remark-muted">
                                        +{extraRemarkCount}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <span className="node-health-tone-pill">{color.label}</span>
            </div>

            {isOnline ? (
                <div className="node-health-tile-meta">
                    <div>
                        <div>{t('pages.nodeHealth.cpu')}</div>
                        <div className="node-health-tile-value" style={{ color: cpu > 70 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {cpu.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div>{t('pages.nodeHealth.memory')}</div>
                        <div className="node-health-tile-value" style={{ color: memPercent > 80 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {memPercent.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div>{t('pages.nodeHealth.onlineUsers')}</div>
                        <div className="node-health-tile-value">
                            {serverData?.managedOnlineCount ?? serverData?.onlineCount ?? serverData?.onlineSessionCount ?? 0}
                        </div>
                    </div>
                    <div>
                        <div>{t('pages.nodeHealth.traffic')}</div>
                        <div className="node-health-tile-value">
                            {trafficReady ? formatBytes(traffic) : '--'}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="node-health-tile-message">
                    <strong>{getNodeFailureCopy(serverData, copy)}</strong>
                    {serverData?.error ? (
                        <span>{copy.inspectHint}</span>
                    ) : null}
                </div>
            )}

            {showSparkline && sparkline && (
                <div className="node-health-sparkline-shell" aria-hidden="true">
                    <div className="node-health-sparkline-copy">
                        <span>{t('pages.nodeHealth.cpuSamples')}</span>
                        <strong>{sparkline.lastValue.toFixed(1)}%</strong>
                    </div>
                    <svg
                        className="node-health-sparkline"
                        viewBox="0 0 132 34"
                        preserveAspectRatio="none"
                    >
                        <path className="node-health-sparkline-fill" d={sparkline.fill} />
                        <path className="node-health-sparkline-path" d={sparkline.path} />
                        <circle
                            className="node-health-sparkline-dot"
                            cx={sparkline.last.x}
                            cy={sparkline.last.y}
                            r="2.6"
                        />
                    </svg>
                </div>
            )}
        </div>
    );
}

function SkeletonTile() {
    return (
        <div className="node-health-skeleton">
            <div className="node-health-skeleton-head">
                <div className="node-health-skeleton-title">
                    <div className="skeleton node-health-skeleton-bar" style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
                    <div className="skeleton node-health-skeleton-bar" style={{ width: '80px' }} />
                </div>
                <div className="skeleton node-health-skeleton-pill" />
            </div>
            <div className="node-health-skeleton-meta">
                {[1, 2, 3, 4].map(i => (
                    <div className="node-health-skeleton-metric" key={i}>
                        <div className="skeleton node-health-skeleton-metric-label" />
                        <div className="skeleton node-health-skeleton-metric-value" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function NodeHealthGrid({ servers, serverStatuses, trendHistory = {} }) {
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const copy = getNodeHealthCopy(locale);
    const [expanded, setExpanded] = useState(false);
    const [query, setQuery] = useState('');
    const safeServers = Array.isArray(servers) ? servers : [];
    const hasStatuses = serverStatuses && Object.keys(serverStatuses).length > 0;
    const entries = useMemo(() => (
        safeServers.map((server) => {
            const serverData = serverStatuses?.[server.id];
            const color = getNodeColor(serverData, t);
            const remarks = Array.isArray(serverData?.nodeRemarks)
                ? serverData.nodeRemarks
                : [];
            return {
                server,
                serverData,
                tone: color.tone,
                label: color.label,
                searchable: [
                    server.name,
                    server.id,
                    serverData?.name,
                    serverData?.error,
                    ...remarks,
                ].filter(Boolean).join(' ').toLowerCase(),
            };
        }).sort((a, b) => {
            const priorityDelta = getNodePriority(a) - getNodePriority(b);
            if (priorityDelta !== 0) return priorityDelta;
            return String(a.server?.name || '').localeCompare(String(b.server?.name || ''), locale);
        })
    ), [locale, serverStatuses, safeServers, t]);
    const normalizedQuery = query.trim().toLowerCase();
    const denseMode = entries.length > NODE_HEALTH_DENSE_THRESHOLD && !normalizedQuery && !expanded;
    const initialLimit = denseMode ? NODE_HEALTH_DENSE_LIMIT : NODE_HEALTH_INITIAL_LIMIT;
    const filteredEntries = normalizedQuery
        ? entries.filter((entry) => entry.searchable.includes(normalizedQuery))
        : entries;
    const visibleEntries = expanded || normalizedQuery
        ? filteredEntries
        : filteredEntries.slice(0, initialLimit);
    const summary = entries.reduce((acc, entry) => {
        if (!entry.serverData?.online && entry.tone === 'warning') {
            acc.warning += 1;
        } else if (!entry.serverData?.online) {
            acc.offline += 1;
        } else if (entry.tone === 'danger') {
            acc.critical += 1;
        } else if (entry.tone === 'warning') {
            acc.warning += 1;
        } else {
            acc.healthy += 1;
        }
        return acc;
    }, { healthy: 0, warning: 0, critical: 0, offline: 0 });
    const canToggle = !normalizedQuery && filteredEntries.length > NODE_HEALTH_INITIAL_LIMIT;
    const shownLabel = copy.shown
        .replace('{shown}', String(visibleEntries.length))
        .replace('{total}', String(filteredEntries.length));

    if (safeServers.length === 0) {
        return (
            <div className="card node-health-empty-shell">
                <EmptyState
                    title={t('pages.nodeHealth.empty')}
                    size="compact"
                    icon={<HiOutlineServerStack className="node-health-empty-icon" />}
                    action={(
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/servers')}>
                            {copy.addNode}
                        </button>
                    )}
                />
            </div>
        );
    }

    return (
        <div className="node-health-panel">
            <div className="node-health-workbench">
                <div className="node-health-summary-strip" aria-label={t('pages.dashboardGlobal.nodeHealthTitle')}>
                    <div className="node-health-summary-item" data-tone="success">
                        <span>{copy.healthy}</span>
                        <strong>{hasStatuses ? summary.healthy : '--'}</strong>
                    </div>
                    <div className="node-health-summary-item" data-tone="warning">
                        <span>{copy.warning}</span>
                        <strong>{hasStatuses ? summary.warning : '--'}</strong>
                    </div>
                    <div className="node-health-summary-item" data-tone="danger">
                        <span>{copy.critical}</span>
                        <strong>{hasStatuses ? summary.critical : '--'}</strong>
                    </div>
                    <div className="node-health-summary-item" data-tone="neutral">
                        <span>{copy.offline}</span>
                        <strong>{hasStatuses ? summary.offline : '--'}</strong>
                    </div>
                </div>

                <div className="node-health-toolbar">
                    <input
                        className="form-input node-health-search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={copy.searchPlaceholder}
                        aria-label={copy.searchPlaceholder}
                    />
                    {denseMode && <span className="node-health-density-pill">{copy.denseMode}</span>}
                    <span className="node-health-visible-count">{shownLabel}</span>
                    {canToggle && (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setExpanded((value) => !value)}
                        >
                            {expanded ? copy.collapse : copy.showAll}
                        </button>
                    )}
                </div>
            </div>

            <div className={`node-health-grid ${expanded || normalizedQuery ? 'is-expanded' : 'is-compact'} ${denseMode ? 'is-dense' : ''}`}>
                {hasStatuses ? (
                    visibleEntries.length > 0 ? (
                        visibleEntries.map(({ server, serverData }) => (
                            <NodeTile
                                key={server.id}
                                server={server}
                                serverData={serverData}
                                trend={trendHistory?.[server.id] || []}
                                showSparkline={expanded}
                            />
                        ))
                    ) : (
                        <div className="card node-health-empty-shell">
                            <EmptyState
                                title={copy.noMatch}
                                size="compact"
                                hideIcon
                                action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuery('')}>{copy.clearFilter}</button>}
                            />
                        </div>
                    )
                ) : (
                    safeServers.slice(0, initialLimit).map(server => (
                        <SkeletonTile key={server.id} />
                    ))
                )}
            </div>
        </div>
    );
}
