import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { formatBytes, formatUptime } from '../../utils/format.js';
import useWebSocket from '../../hooks/useWebSocket.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
    HiOutlineCpuChip,
    HiOutlineCircleStack,
    HiOutlineArrowsUpDown,
    HiOutlineChartBarSquare,
    HiOutlineClock,
    HiOutlineCog6Tooth,
    HiOutlineUsers,
    HiOutlineSignal,
    HiOutlineArrowPath,
    HiOutlineServerStack,
    HiOutlineCloud,
    HiOutlineBolt,
    HiOutlineArrowRight,
} from 'react-icons/hi2';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import NodeHealthGrid from './NodeHealthGrid.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { readSessionSnapshot, writeSessionSnapshot } from '../../utils/sessionSnapshot.js';

const AUTO_REFRESH_INTERVAL = 30_000;
const GLOBAL_WS_GRACE_MS = 150;
const MAX_SINGLE_ONLINE_ROWS = 120;
const MAX_GLOBAL_ONLINE_ROWS = 200;
const MAX_NODE_TREND_POINTS = 12;
const DASHBOARD_SNAPSHOT_KEY = 'dashboard_global_v1';
const DASHBOARD_SNAPSHOT_TTL_MS = 90_000;
const INITIAL_GLOBAL_STATS = {
    totalUp: 0,
    totalDown: 0,
    totalOnline: 0,
    totalInbounds: 0,
    activeInbounds: 0,
    serverCount: 0,
    onlineServers: 0,
};
const INITIAL_TRAFFIC_WINDOW_TOTAL = {
    totalUp: 0,
    totalDown: 0,
    ready: false,
};
function buildInitialTrafficWindowTotals({ ready = false } = {}) {
    return {
        day: { ...INITIAL_TRAFFIC_WINDOW_TOTAL, ready },
        week: { ...INITIAL_TRAFFIC_WINDOW_TOTAL, ready },
        month: { ...INITIAL_TRAFFIC_WINDOW_TOTAL, ready },
    };
}

function normalizeGlobalStatsSnapshot(stats = {}) {
    return {
        totalUp: Number(stats?.totalUp || 0),
        totalDown: Number(stats?.totalDown || 0),
        totalOnline: Number(stats?.totalOnline || 0),
        totalInbounds: Number(stats?.totalInbounds || 0),
        activeInbounds: Number(stats?.activeInbounds || 0),
        serverCount: Number(stats?.serverCount || 0),
        onlineServers: Number(stats?.onlineServers || 0),
    };
}

function normalizeStoredTrafficWindowTotals(windows = {}) {
    const normalizeWindow = (key) => ({
        totalUp: Number(windows?.[key]?.totalUp || 0),
        totalDown: Number(windows?.[key]?.totalDown || 0),
        ready: windows?.[key]?.ready === true,
    });
    return {
        day: normalizeWindow('day'),
        week: normalizeWindow('week'),
        month: normalizeWindow('month'),
    };
}

function readDashboardBootstrapSnapshot() {
    const snapshot = readSessionSnapshot(DASHBOARD_SNAPSHOT_KEY, {
        maxAgeMs: DASHBOARD_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    const serverStatuses = snapshot?.serverStatuses && typeof snapshot.serverStatuses === 'object'
        ? snapshot.serverStatuses
        : {};
    const globalStats = normalizeGlobalStatsSnapshot(snapshot?.globalStats || {});
    const globalAccountSummary = {
        totalUsers: Number(snapshot?.globalAccountSummary?.totalUsers || 0),
        pendingUsers: Number(snapshot?.globalAccountSummary?.pendingUsers || 0),
    };
    const globalOnlineUsers = Array.isArray(snapshot?.globalOnlineUsers) ? snapshot.globalOnlineUsers : [];
    const globalOnlineSessionCount = Number(snapshot?.globalOnlineSessionCount || 0);
    const trafficWindowTotals = normalizeStoredTrafficWindowTotals(snapshot?.trafficWindowTotals || {});
    const hasRenderableData = (
        Object.keys(serverStatuses).length > 0
        || globalStats.serverCount > 0
        || globalAccountSummary.totalUsers > 0
        || Object.values(trafficWindowTotals).some((window) => window?.ready === true)
    );

    return {
        serverStatuses,
        globalStats,
        globalAccountSummary,
        globalOnlineUsers,
        globalOnlineSessionCount,
        trafficWindowTotals,
        globalPresenceReady: snapshot?.globalPresenceReady === true && Array.isArray(snapshot?.globalOnlineUsers),
        hasRenderableData,
    };
}

function buildDashboardSnapshotServerStatuses(serverStatuses = {}) {
    return Object.entries(serverStatuses || {}).reduce((acc, [serverId, serverData]) => {
        acc[serverId] = {
            serverId: serverData?.serverId || serverId,
            name: serverData?.name || '',
            online: serverData?.online === true,
            error: serverData?.error || '',
            inboundCount: Number(serverData?.inboundCount || 0),
            activeInbounds: Number(serverData?.activeInbounds || 0),
            managedOnlineCount: Number(serverData?.managedOnlineCount || 0),
            managedTrafficTotal: Number(serverData?.managedTrafficTotal || 0),
            managedTrafficReady: serverData?.managedTrafficReady === true,
            nodeRemarks: Array.isArray(serverData?.nodeRemarks) ? serverData.nodeRemarks : [],
            nodeRemarkPreview: Array.isArray(serverData?.nodeRemarkPreview) ? serverData.nodeRemarkPreview : [],
            nodeRemarkCount: Number(serverData?.nodeRemarkCount || 0),
            status: serverData?.status && typeof serverData.status === 'object'
                ? serverData.status
                : null,
        };
        return acc;
    }, {});
}

function normalizeTrafficWindowPayload(windows = {}) {
    const readWindow = (...keys) => {
        const payload = keys
            .map((key) => windows?.[key])
            .find(Boolean) || {};
        const totals = payload?.managedTotals || payload?.totals || payload;
        return {
            totalUp: Number(totals?.upBytes || 0),
            totalDown: Number(totals?.downBytes || 0),
            ready: true,
        };
    };

    return {
        day: readWindow('day', 'today'),
        week: readWindow('week', '7'),
        month: readWindow('month', '30'),
    };
}

const DASHBOARD_ACCENT = {
    primary: { tone: 'primary' },
    info: { tone: 'info' },
    warning: { tone: 'warning' },
    success: { tone: 'success' },
};

function buildSparklinePath(points = [], width = 180, height = 38, domain = null) {
    const values = points
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    if (values.length < 2) return null;

    const min = Array.isArray(domain) && Number.isFinite(domain[0]) ? domain[0] : Math.min(...values);
    const max = Array.isArray(domain) && Number.isFinite(domain[1]) ? domain[1] : Math.max(...values);
    const range = Math.max(1, max - min);
    const step = width / Math.max(1, values.length - 1);
    const coordinates = values.map((value, index) => {
        const x = index * step;
        const y = height - (((value - min) / range) * height);
        return `${x},${Math.max(0, Math.min(height, y))}`;
    });

    return {
        polyline: coordinates.join(' '),
        last: coordinates[coordinates.length - 1]?.split(',').map(Number) || [0, height],
    };
}

function StatSparkline({ points = [], domain = null }) {
    const path = buildSparklinePath(points, 180, 38, domain);
    if (!path) return null;

    return (
        <div className="dashboard-stat-card-sparkline" aria-hidden="true">
            <svg viewBox="0 0 180 38" preserveAspectRatio="none">
                <polyline className="dashboard-stat-card-sparkline-line" points={path.polyline} />
                <circle className="dashboard-stat-card-sparkline-end" cx={path.last[0]} cy={path.last[1]} r="2.8" />
            </svg>
        </div>
    );
}

function StatCard({ card, loading }) {
    const clickable = typeof card.onClick === 'function';
    const animatedValue = useAnimatedCounter(card.animateValue ?? 0);
    const hasHead = Boolean(card.label || card.kicker);
    const renderedValue = loading
        ? null
        : card.animateValue !== undefined
            ? (
                card.renderAnimatedValue
                    ? card.renderAnimatedValue(animatedValue)
                    : `${animatedValue}${card.animateSuffix || ''}`
            )
            : card.value;
    const renderedValueTitle = typeof renderedValue === 'string' || typeof renderedValue === 'number'
        ? String(renderedValue)
        : undefined;
    const handleKeyDown = (event) => {
        if (!clickable) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            card.onClick();
        }
    };

    return (
        <div
            className={`card dashboard-stat-card${clickable ? ' clickable' : ''}`}
            data-tone={card.tone || 'neutral'}
            onClick={clickable ? card.onClick : undefined}
            onKeyDown={handleKeyDown}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
        >
            {hasHead && (
                <div className="dashboard-stat-card-head">
                    <div className="dashboard-stat-card-copy">
                        {card.label && <span className="dashboard-stat-card-label">{card.label}</span>}
                        {card.kicker && <span className="dashboard-stat-card-kicker">{card.kicker}</span>}
                    </div>
                </div>
            )}
            <div className="dashboard-stat-card-body">
                <div className="dashboard-stat-card-primary">
                    <div className="card-value dashboard-stat-card-value" title={renderedValueTitle}>
                        {loading ? (
                            <div
                                className="skeleton dashboard-stat-card-skeleton mt-1"
                                style={{ width: card.skeletonWidth || 'clamp(7.5rem, 44%, 11rem)', height: '2.35rem' }}
                            />
                        ) : (
                            <span className="dashboard-stat-card-value-text">{renderedValue}</span>
                        )}
                    </div>
                    {Array.isArray(card.sparkline) && card.sparkline.length > 1 && (
                        <StatSparkline points={card.sparkline} domain={card.sparklineDomain} />
                    )}
                </div>
                {card.sub && (
                    <div className="dashboard-stat-card-subtitle">
                        {card.sub}
                    </div>
                )}
                {clickable && (
                    <span className="dashboard-stat-card-hint" aria-hidden="true">
                        <HiOutlineArrowRight />
                    </span>
                )}
            </div>
            <div className="card-icon dashboard-stat-card-icon" aria-hidden="true">
                <card.icon />
            </div>
        </div>
    );
}

function QuickActionGrid({ actions = [] }) {
    return (
        <div className="dashboard-quick-grid">
            {actions.map((action) => (
                <button
                    key={action.title}
                    type="button"
                    className="dashboard-quick-card"
                    data-tone={action.tone || 'primary'}
                    onClick={action.onClick}
                >
                    <span className="dashboard-quick-card-icon" aria-hidden="true">
                        <action.icon />
                    </span>
                    <span className="dashboard-quick-card-copy">
                        <span className="dashboard-quick-card-title">{action.title}</span>
                        <span className="dashboard-quick-card-detail">{action.detail}</span>
                        {action.meta && <span className="dashboard-quick-card-meta">{action.meta}</span>}
                    </span>
                    <span className="dashboard-quick-card-arrow" aria-hidden="true">
                        <HiOutlineArrowRight />
                    </span>
                </button>
            ))}
        </div>
    );
}

function OnlineUsersMobileList({ rows = [], showNodes = false, limit, t, keyPrefix = 'online' }) {
    return (
        <div className="dashboard-online-mobile-list">
            {rows.slice(0, limit).map((row, index) => (
                <div key={`${keyPrefix}-${row.userId || row.label || index}`} className="dashboard-online-mobile-card">
                    <div className="dashboard-online-mobile-head">
                        <div className="dashboard-online-mobile-copy">
                            <div className="dashboard-online-mobile-name">{row.displayName}</div>
                            {row.email && row.email !== row.displayName && (
                                <div className="dashboard-online-mobile-email">{row.email}</div>
                            )}
                        </div>
                        <div className="dashboard-online-mobile-meta">
                            <span className="dashboard-online-mobile-meta-label">{t('pages.dashboardCommon.sessions')}</span>
                            <span className="badge badge-success">{row.sessions}</span>
                        </div>
                    </div>

                    {showNodes ? (
                        <div className="dashboard-online-mobile-nodes">
                            {row.nodeLabels.length === 0 ? (
                                <span className="badge badge-neutral">{t('pages.dashboardCommon.unknownNode')}</span>
                            ) : (
                                row.nodeLabels.slice(0, 4).map((nodeLabel) => (
                                    <span key={`${row.userId || row.label || index}-${nodeLabel}`} className="badge badge-info">
                                        {nodeLabel}
                                    </span>
                                ))
                            )}
                            {row.nodeLabels.length > 4 ? (
                                <span className="badge badge-neutral">+{row.nodeLabels.length - 4}</span>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ))}
            {rows.length > limit ? (
                <div className="dashboard-online-mobile-note">{t('pages.dashboardCommon.limitNote', { count: limit })}</div>
            ) : null}
        </div>
    );
}

function InboundSummaryMobileList({ inbounds = [], loading, t }) {
    return (
        <div className="dashboard-inbound-mobile-list">
            {inbounds.slice(0, 10).map((ib) => (
                <div key={ib.id} className="dashboard-inbound-mobile-card">
                    <div className="dashboard-inbound-mobile-head">
                        <div className="dashboard-inbound-mobile-copy">
                            <div className="dashboard-inbound-mobile-title">{ib.remark || '-'}</div>
                            <div className="dashboard-inbound-mobile-kicker">
                                <span className="badge badge-info">{ib.protocol}</span>
                                <span className="dashboard-inbound-mobile-port">:{ib.port}</span>
                            </div>
                        </div>
                        <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>
                            {ib.enable ? t('pages.dashboardNode.statusEnabled') : t('pages.dashboardNode.statusDisabled')}
                        </span>
                    </div>
                    <div className="dashboard-inbound-mobile-stats">
                        <div className="dashboard-inbound-mobile-stat">
                            <span className="dashboard-inbound-mobile-label">{t('pages.dashboardNode.tableUp')}</span>
                            <span className="dashboard-inbound-mobile-value">
                                {loading
                                    ? <span className="skeleton dashboard-inline-skeleton" />
                                    : formatBytes(ib.up)}
                            </span>
                        </div>
                        <div className="dashboard-inbound-mobile-stat">
                            <span className="dashboard-inbound-mobile-label">{t('pages.dashboardNode.tableDown')}</span>
                            <span className="dashboard-inbound-mobile-value">
                                {loading
                                    ? <span className="skeleton dashboard-inline-skeleton" />
                                    : formatBytes(ib.down)}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function pushServerTrendSamples(previous, serverMap) {
    const next = {};
    for (const [serverId, serverData] of Object.entries(serverMap || {})) {
        const current = Array.isArray(previous?.[serverId]) ? previous[serverId] : [];
        const now = Date.now();
        const mem = serverData?.status?.mem;
        const memPercent = mem?.total ? Math.max(0, Math.min(100, (Number(mem.current || 0) / Number(mem.total || 1)) * 100)) : 0;
        const { sentTotal, recvTotal } = resolveNetTrafficTotals(serverData);
        const last = current[current.length - 1];
        const elapsedSeconds = last ? Math.max(1, (now - Number(last.ts || 0)) / 1000) : 0;
        const upPerSecond = last && sentTotal >= Number(last.sentTotal || 0)
            ? Math.max(0, (sentTotal - Number(last.sentTotal || 0)) / elapsedSeconds)
            : 0;
        const downPerSecond = last && recvTotal >= Number(last.recvTotal || 0)
            ? Math.max(0, (recvTotal - Number(last.recvTotal || 0)) / elapsedSeconds)
            : 0;
        const sample = {
            ts: now,
            cpu: Math.max(0, Math.min(100, Number(serverData?.status?.cpu || 0))),
            mem: memPercent,
            online: serverData?.online !== false,
            sentTotal,
            recvTotal,
            upPerSecond,
            downPerSecond,
            throughputPerSecond: upPerSecond + downPerSecond,
            hasThroughputSample: Boolean(last),
        };
        const merged = last
            && last.cpu === sample.cpu
            && last.mem === sample.mem
            && last.online === sample.online
            && last.sentTotal === sample.sentTotal
            && last.recvTotal === sample.recvTotal
            ? [...current.slice(0, -1), { ...last, ts: sample.ts }]
            : [...current, sample];
        next[serverId] = merged.slice(-MAX_NODE_TREND_POINTS);
    }
    return next;
}

function buildClusterTrend(historyMap, selector) {
    const histories = Object.values(historyMap || {})
        .filter((value) => Array.isArray(value) && value.length > 0);
    if (histories.length === 0) return [];

    const maxLength = Math.max(...histories.map((items) => items.length));
    const points = [];

    for (let index = 0; index < maxLength; index += 1) {
        const values = histories
            .map((items) => items[items.length - maxLength + index] || null)
            .filter(Boolean)
            .map((item) => selector(item))
            .filter((value) => Number.isFinite(value));
        if (values.length === 0) continue;
        points.push(values.reduce((sum, value) => sum + value, 0) / values.length);
    }

    return points;
}

function buildClusterAggregateTrend(historyMap, selector, mode = 'avg') {
    const histories = Object.values(historyMap || {})
        .filter((value) => Array.isArray(value) && value.length > 0);
    if (histories.length === 0) return [];

    const maxLength = Math.max(...histories.map((items) => items.length));
    const points = [];

    for (let index = 0; index < maxLength; index += 1) {
        const values = histories
            .map((items) => items[items.length - maxLength + index] || null)
            .filter(Boolean)
            .map((item) => selector(item))
            .filter((value) => Number.isFinite(value));
        if (values.length === 0) continue;
        const total = values.reduce((sum, value) => sum + value, 0);
        points.push(mode === 'sum' ? total : (total / values.length));
    }

    return points;
}

function resolveNetTrafficTotals(serverData) {
    const netTraffic = serverData?.status?.netTraffic || {};
    const sentTotal = Number(netTraffic.sent ?? netTraffic.up ?? netTraffic.upload ?? 0);
    const recvTotal = Number(netTraffic.recv ?? netTraffic.down ?? netTraffic.download ?? 0);

    return {
        sentTotal: Number.isFinite(sentTotal) ? sentTotal : 0,
        recvTotal: Number.isFinite(recvTotal) ? recvTotal : 0,
    };
}

function summarizeClusterThroughput(historyMap) {
    const histories = Object.values(historyMap || {}).filter((items) => Array.isArray(items) && items.length > 0);
    return histories.reduce((summary, items) => {
        const latest = items[items.length - 1] || null;
        if (!latest) return summary;
        const ready = items.length > 1 || latest.hasThroughputSample === true;
        summary.up += Number(latest.upPerSecond || 0);
        summary.down += Number(latest.downPerSecond || 0);
        summary.total += Number(latest.throughputPerSecond || 0);
        if (ready) {
            summary.ready = true;
        }
        return summary;
    }, { up: 0, down: 0, total: 0, ready: false });
}

// ── WebSocket URL builder ────────────────────────────────
function getWsUrl(ticket) {
    if (!ticket) return null;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = String(import.meta.env.VITE_WS_HOST || '').trim() || window.location.host;
    return `${proto}://${host}/ws?ticket=${encodeURIComponent(ticket)}`;
}



export default function Dashboard() {
    const { activeServerId, activeServer, servers, loading: serverContextLoading } = useServer();
    const { token } = useAuth();
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const [wsTicket, setWsTicket] = useState('');
    const lastWsTicketFetchAtRef = useRef(0);
    const dashboardBootstrapRef = useRef(readDashboardBootstrapSnapshot());

    // Single Server State
    const [status, setStatus] = useState(null);
    const [cpuHistory, setCpuHistory] = useState([]);
    const [inbounds, setInbounds] = useState([]);
    const [onlineCount, setOnlineCount] = useState(0);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [onlineSessionCount, setOnlineSessionCount] = useState(0);
    const [singleServerTrafficTotals, setSingleServerTrafficTotals] = useState({ totalUp: 0, totalDown: 0 });

    // Global State
    const [globalStats, setGlobalStats] = useState(() => (
        dashboardBootstrapRef.current?.globalStats || { ...INITIAL_GLOBAL_STATS }
    ));
    const [serverStatuses, setServerStatuses] = useState(() => (
        dashboardBootstrapRef.current?.serverStatuses || {}
    ));
    const [serverTrendHistory, setServerTrendHistory] = useState({});
    const [globalOnlineUsers, setGlobalOnlineUsers] = useState(() => (
        dashboardBootstrapRef.current?.globalOnlineUsers || []
    ));
    const [globalOnlineSessionCount, setGlobalOnlineSessionCount] = useState(() => (
        dashboardBootstrapRef.current?.globalOnlineSessionCount || 0
    ));
    const [globalAccountSummary, setGlobalAccountSummary] = useState(() => (
        dashboardBootstrapRef.current?.globalAccountSummary || { totalUsers: 0, pendingUsers: 0 }
    ));
    const [hasLiveClusterSnapshot, setHasLiveClusterSnapshot] = useState(false);
    const [globalPresenceLoading, setGlobalPresenceLoading] = useState(false);
    const [globalPresenceReady, setGlobalPresenceReady] = useState(() => (
        dashboardBootstrapRef.current?.globalPresenceReady === true
    ));
    const [trafficWindowTotals, setTrafficWindowTotals] = useState(() => (
        dashboardBootstrapRef.current?.trafficWindowTotals || buildInitialTrafficWindowTotals()
    ));

    // Shared State
    const [loading, setLoading] = useState(() => dashboardBootstrapRef.current?.hasRenderableData !== true);
    const [autoRefresh, setAutoRefresh] = useState(() => {
        try {
            const stored = localStorage.getItem('nms_dashboard_autorefresh');
            return stored === null ? true : stored !== 'false';
        } catch {
            return true;
        }
    });
    const [showOnlineDetail, setShowOnlineDetail] = useState(false);
    const singleServerCpuSparkline = useMemo(
        () => cpuHistory.map((item) => Number(item?.cpu)).filter((value) => Number.isFinite(value)),
        [cpuHistory]
    );
    const clusterOnlineSparkline = useMemo(
        () => buildClusterTrend(serverTrendHistory, (item) => (item?.online === false ? 0 : 1)),
        [serverTrendHistory]
    );
    const clusterThroughputSparkline = useMemo(
        () => buildClusterAggregateTrend(serverTrendHistory, (item) => Number(item?.throughputPerSecond), 'sum'),
        [serverTrendHistory]
    );
    const clusterThroughput = useMemo(
        () => summarizeClusterThroughput(serverTrendHistory),
        [serverTrendHistory]
    );
    const resetTrafficWindows = useCallback(() => {
        setTrafficWindowTotals(buildInitialTrafficWindowTotals());
    }, []);
    const syncTrafficWindowTotals = useCallback((windows) => {
        setTrafficWindowTotals((previous) => ({
            ...previous,
            ...normalizeStoredTrafficWindowTotals(windows),
        }));
    }, []);
    const applyGlobalDashboardSnapshot = useCallback((payload = {}) => {
        const nextServerStatuses = buildDashboardSnapshotServerStatuses(payload?.serverStatuses || {});
        const nextGlobalStats = normalizeGlobalStatsSnapshot(payload?.globalStats || {});
        const nextGlobalOnlineUsers = Array.isArray(payload?.globalOnlineUsers) ? payload.globalOnlineUsers : [];
        const nextGlobalOnlineSessionCount = Number(payload?.globalOnlineSessionCount || 0);
        const nextGlobalAccountSummary = {
            totalUsers: Number(payload?.globalAccountSummary?.totalUsers || 0),
            pendingUsers: Number(payload?.globalAccountSummary?.pendingUsers || 0),
        };
        const nextTrafficWindowTotals = normalizeStoredTrafficWindowTotals(payload?.trafficWindowTotals || {});

        setServerStatuses(nextServerStatuses);
        setServerTrendHistory((previous) => pushServerTrendSamples(previous, nextServerStatuses));
        setGlobalStats(nextGlobalStats);
        setGlobalOnlineUsers(nextGlobalOnlineUsers);
        setGlobalOnlineSessionCount(nextGlobalOnlineSessionCount);
        setGlobalAccountSummary(nextGlobalAccountSummary);
        setTrafficWindowTotals(nextTrafficWindowTotals);
        setGlobalPresenceReady(payload?.globalPresenceReady === true);
    }, []);

    const fetchWsTicket = useCallback(async ({ force = false } = {}) => {
        if (!token) {
            setWsTicket('');
            return;
        }
        const now = Date.now();
        if (!force && now - lastWsTicketFetchAtRef.current < 30_000) {
            return;
        }
        lastWsTicketFetchAtRef.current = now;
        try {
            const res = await api.post('/ws/ticket');
            const issued = res.data?.obj || {};
            setWsTicket(String(issued.ticket || ''));
        } catch (err) {
            console.error('Failed to fetch websocket ticket:', err?.response?.data || err?.message || err);
        }
    }, [token]);

    useEffect(() => {
        if (!token) {
            setWsTicket('');
            return undefined;
        }
        fetchWsTicket({ force: true });
        const interval = setInterval(() => fetchWsTicket({ force: true }), 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchWsTicket, token]);

    // ── WebSocket Connection ─────────────────────────────
    const wsUrl = useMemo(() => getWsUrl(wsTicket), [wsTicket]);
    const { status: wsStatus, lastMessage } = useWebSocket(wsUrl);

    useEffect(() => {
        if (!token) return;
        if (wsStatus === 'reconnecting' || wsStatus === 'disconnected') {
            fetchWsTicket();
        }
    }, [fetchWsTicket, token, wsStatus]);

    // Process WebSocket messages for global view
    useEffect(() => {
        if (!lastMessage || lastMessage.type !== 'cluster_status') return;
        if (activeServerId !== 'global') return;

        const { data } = lastMessage;
        if (!data) return;

        // Update global stats from WS push
        const statusMap = {};
        let derivedTotalInbounds = 0;
        let derivedActiveInbounds = 0;
        for (const [serverId, sData] of Object.entries(data.servers || {})) {
            statusMap[serverId] = sData;
            if (sData?.online) {
                derivedTotalInbounds += Number(sData?.inboundCount || 0);
                derivedActiveInbounds += Number(sData?.activeInbounds || 0);
            }
        }

        const totalInbounds = Number.isFinite(Number(data.totalInbounds))
            ? Number(data.totalInbounds)
            : derivedTotalInbounds;
        const activeInbounds = Number.isFinite(Number(data.activeInbounds))
            ? Number(data.activeInbounds)
            : derivedActiveInbounds;
        setHasLiveClusterSnapshot(true);
        setServerStatuses((previous) => {
            const next = {};
            Object.entries(statusMap).forEach(([serverId, serverData]) => {
                next[serverId] = {
                    ...serverData,
                    managedOnlineCount: previous?.[serverId]?.managedOnlineCount ?? 0,
                    managedTrafficTotal: previous?.[serverId]?.managedTrafficTotal ?? 0,
                    managedTrafficReady: previous?.[serverId]?.managedTrafficReady === true,
                    nodeRemarks: previous?.[serverId]?.nodeRemarks || [],
                    nodeRemarkPreview: previous?.[serverId]?.nodeRemarkPreview || [],
                    nodeRemarkCount: previous?.[serverId]?.nodeRemarkCount || 0,
                };
            });
            return next;
        });
        setServerTrendHistory((previous) => pushServerTrendSamples(previous, statusMap));
        setGlobalStats((previous) => ({
            totalUp: Number(data.totalUp || 0),
            totalDown: Number(data.totalDown || 0),
            totalOnline: Number.isFinite(Number(data.managedOnlineUserCount))
                ? Number(data.managedOnlineUserCount)
                : previous.totalOnline,
            totalInbounds,
            activeInbounds,
            serverCount: data.serverCount || 0,
            onlineServers: data.onlineServers || 0,
        }));
        if (data?.accountSummary && typeof data.accountSummary === 'object') {
            setGlobalAccountSummary({
                totalUsers: Number(data.accountSummary.totalUsers || 0),
                pendingUsers: Number(data.accountSummary.pendingUsers || 0),
            });
        }
        if (data?.trafficWindows && typeof data.trafficWindows === 'object') {
            syncTrafficWindowTotals(normalizeTrafficWindowPayload(data.trafficWindows));
        }
        if (Array.isArray(data?.managedOnlineUsers)) {
            setGlobalOnlineUsers(data.managedOnlineUsers);
            setGlobalOnlineSessionCount(Number(data?.managedOnlineSessionCount || 0));
            setGlobalPresenceReady(data?.managedPresenceReady === true);
        }
        setLoading(false);
    }, [activeServerId, lastMessage, syncTrafficWindowTotals]);

    useEffect(() => {
        if (activeServerId !== 'global') return;
        const hasSnapshotData = (
            Object.keys(serverStatuses || {}).length > 0
            || globalAccountSummary.totalUsers > 0
            || Object.values(trafficWindowTotals || {}).some((window) => window?.ready === true)
        );
        if (!hasSnapshotData) return;
        writeSessionSnapshot(DASHBOARD_SNAPSHOT_KEY, {
            globalStats,
            serverStatuses: buildDashboardSnapshotServerStatuses(serverStatuses),
            globalAccountSummary,
            globalOnlineUsers,
            globalOnlineSessionCount,
            trafficWindowTotals,
            globalPresenceReady,
        });
    }, [
        activeServerId,
        globalAccountSummary,
        globalOnlineSessionCount,
        globalOnlineUsers,
        globalPresenceReady,
        globalStats,
        serverStatuses,
        trafficWindowTotals,
    ]);

    // ── REST Fetchers (fallback / single server) ─────────
    const fetchSingleData = useCallback(async (options = {}) => {
        if (!activeServerId || activeServerId === 'global') return;
        try {
            const res = await api.get(`/servers/${activeServerId}/dashboard/snapshot`, {
                params: options.force === true ? { refresh: true } : undefined,
            });
            const payload = res.data?.obj || {};
            setStatus(payload?.status && typeof payload.status === 'object' ? payload.status : null);
            setCpuHistory(Array.isArray(payload?.cpuHistory) ? payload.cpuHistory : []);
            setInbounds(Array.isArray(payload?.inbounds) ? payload.inbounds : []);
            const nextOnlineUsers = Array.isArray(payload?.onlineUsers) ? payload.onlineUsers : [];
            setOnlineUsers(nextOnlineUsers);
            setOnlineSessionCount(Number(payload?.onlineSessionCount || 0));
            setOnlineCount(Number(payload?.onlineCount || nextOnlineUsers.length || 0));
            setSingleServerTrafficTotals({
                totalUp: Number(payload?.singleServerTrafficTotals?.totalUp || 0),
                totalDown: Number(payload?.singleServerTrafficTotals?.totalDown || 0),
            });
        } catch (err) {
            console.error('Dashboard fetch error:', err);
        }
        setLoading(false);
    }, [activeServerId]);

    const fetchGlobalData = useCallback(async (options = {}) => {
        if (servers.length === 0) {
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
            setGlobalPresenceReady(true);
            setTrafficWindowTotals(buildInitialTrafficWindowTotals({ ready: true }));
            setLoading(false);
            return;
        }
        setGlobalPresenceLoading(true);
        try {
            const res = await api.get('/servers/dashboard/snapshot', {
                params: options.force === true ? { refresh: true } : undefined,
            });
            applyGlobalDashboardSnapshot(res.data?.obj || {});
        } catch (err) {
            console.error('Global fetch error:', err);
            if (!options.preserveCurrent) {
                setGlobalPresenceReady(false);
            }
        }
        setGlobalPresenceLoading(false);
        setLoading(false);
    }, [applyGlobalDashboardSnapshot, servers.length]);

    const hydrateGlobalPresence = useCallback(async (options = {}) => {
        return fetchGlobalData({
            force: options.force === true,
            preserveCurrent: true,
        });
    }, [fetchGlobalData]);

    useEffect(() => {
        if (activeServerId === 'global') return;
        resetTrafficWindows();
    }, [activeServerId, resetTrafficWindows]);

    useEffect(() => {
        if (activeServerId === 'global') return;
        setGlobalPresenceReady(false);
        setGlobalPresenceLoading(false);
        setGlobalOnlineUsers([]);
        setGlobalOnlineSessionCount(0);
    }, [activeServerId]);

    useEffect(() => {
        if (activeServerId !== 'global') return undefined;
        const hasRenderableGlobalData = (
            Object.keys(serverStatuses || {}).length > 0
            || globalAccountSummary.totalUsers > 0
            || globalOnlineUsers.length > 0
            || Object.values(trafficWindowTotals || {}).some((window) => window?.ready === true)
        );
        setLoading(!hasRenderableGlobalData);
        if (hasLiveClusterSnapshot) {
            setLoading(false);
            return undefined;
        }
        const timer = window.setTimeout(() => {
            if (!hasLiveClusterSnapshot) {
                fetchGlobalData();
            }
        }, GLOBAL_WS_GRACE_MS);
        return () => window.clearTimeout(timer);
    }, [
        activeServerId,
        fetchGlobalData,
        globalAccountSummary.totalUsers,
        globalOnlineUsers.length,
        hasLiveClusterSnapshot,
        serverStatuses,
        trafficWindowTotals,
    ]);

    useEffect(() => {
        if (activeServerId === 'global') return;
        if (activeServerId) {
            setHasLiveClusterSnapshot(false);
            setLoading(true);
            fetchSingleData();
            return;
        }
        setHasLiveClusterSnapshot(false);
        setLoading(false);
    }, [activeServerId, fetchSingleData]);

    useEffect(() => {
        if (activeServerId !== 'global') return;
        if (!hasLiveClusterSnapshot) return;
        if (globalPresenceLoading) return;
        if (globalPresenceReady) return;
        hydrateGlobalPresence();
    }, [activeServerId, globalPresenceLoading, globalPresenceReady, hasLiveClusterSnapshot, hydrateGlobalPresence]);

    useEffect(() => {
        if (!autoRefresh) return undefined;
        const interval = setInterval(() => {
            if (activeServerId === 'global') {
                if (wsStatus === 'connected') {
                    hydrateGlobalPresence();
                    return;
                }
                fetchGlobalData();
                return;
            }
            if (activeServerId) {
                fetchSingleData();
            }
        }, AUTO_REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [activeServerId, autoRefresh, fetchGlobalData, fetchSingleData, hydrateGlobalPresence, wsStatus]);

    const refresh = () => {
        if (activeServerId !== 'global') {
            return fetchSingleData({ force: true });
        }
        if (wsStatus === 'connected') {
            return hydrateGlobalPresence({ force: true });
        }
        return fetchGlobalData({ force: true });
    };
    const toggleAutoRefresh = () => {
        setAutoRefresh((previous) => {
            const next = !previous;
            try { localStorage.setItem('nms_dashboard_autorefresh', String(next)); } catch { /* ignore */ }
            if (next) {
                refresh();
            }
            return next;
        });
    };
    const cpuChartEndTick = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1].time : 0;

    // Empty State
    if (!serverContextLoading && !activeServerId && servers.length === 0 && activeServerId !== 'global') {
        return (
            <>
                <Header
                    title={t('pages.dashboardEmpty.title')}
                />
                
                <div className="page-content page-enter dashboard-page">
                    <EmptyState
                        title={t('pages.dashboardEmpty.bodyTitle')}
                        subtitle={t('pages.dashboardEmpty.bodySubtitle')}
                        icon={<HiOutlineServerStack style={{ fontSize: '48px' }} />}
                        action={(
                            <button type="button" className="btn btn-primary" onClick={() => navigate('/servers')}>
                                {t('pages.dashboardEmpty.action')}
                            </button>
                        )}
                    />
                </div>
            </>
        );
    }

    // ── Global Dashboard ─────────────────────────────────
    if (activeServerId === 'global') {
        const clusterSummaryReady = hasLiveClusterSnapshot || Object.keys(serverStatuses || {}).length > 0;
        const clusterServerCount = globalStats.serverCount || servers.length;
        const globalManagedOnlineCount = globalPresenceReady ? globalOnlineUsers.length : null;
        const globalOnlineSummary = globalPresenceReady
            ? t('pages.dashboardCommon.registeredSessionSummary', {
                users: globalAccountSummary.totalUsers,
                sessions: globalOnlineSessionCount,
            })
            : globalAccountSummary.totalUsers > 0
                ? t('pages.dashboardCommon.registeredPendingSummary', {
                    users: globalAccountSummary.totalUsers,
                })
                : t('pages.dashboardCommon.onlineUsersPending');
        const globalCards = [
            {
                icon: HiOutlineServerStack,
                value: clusterSummaryReady ? `${globalStats.onlineServers} / ${clusterServerCount}` : `-- / ${clusterServerCount}`,
                kicker: t('pages.dashboardCommon.onlineTotal'),
                sub: clusterSummaryReady
                    ? t('pages.dashboardGlobal.inboundSummary', {
                        active: globalStats.activeInbounds,
                        total: globalStats.totalInbounds,
                    })
                    : t('pages.dashboardCommon.clusterPending'),
                ...DASHBOARD_ACCENT.primary,
                onClick: () => navigate('/servers'),
                skeletonWidth: '9rem',
                sparkline: clusterOnlineSparkline,
                sparklineDomain: [0, 1],
            },
            {
                icon: HiOutlineUsers, label: t('pages.dashboardGlobal.cards.totalOnlineUsers'),
                ...(globalManagedOnlineCount === null
                    ? {
                        value: '--',
                    }
                    : {
                        animateValue: globalManagedOnlineCount,
                        renderAnimatedValue: (value) => String(value),
                    }),
                sub: globalOnlineSummary,
                onClick: () => setShowOnlineDetail((v) => !v),
                ...DASHBOARD_ACCENT.info,
                skeletonWidth: '6rem',
                sparkline: clusterOnlineSparkline,
                sparklineDomain: [0, 1],
            },
            {
                icon: HiOutlineArrowsUpDown,
                label: t('pages.dashboardGlobal.cards.liveThroughput'),
                value: clusterThroughput.ready ? formatBytes(clusterThroughput.total) : '--',
                sub: clusterThroughput.ready
                    ? t('pages.dashboardCommon.throughputSplit', {
                        up: formatBytes(clusterThroughput.up),
                        down: formatBytes(clusterThroughput.down),
                    })
                    : t('pages.dashboardCommon.throughputPending'),
                ...DASHBOARD_ACCENT.warning,
                onClick: () => navigate('/audit?tab=traffic'),
                skeletonWidth: '9rem',
                sparkline: clusterThroughputSparkline,
            },
            {
                icon: HiOutlineCloud,
                label: t('pages.dashboardGlobal.cards.todayTraffic'),
                ...(trafficWindowTotals.day.ready ? {
                    animateValue: trafficWindowTotals.day.totalUp + trafficWindowTotals.day.totalDown,
                    renderAnimatedValue: (value) => formatBytes(value),
                    sub: t('pages.dashboardCommon.trafficSplit', {
                        up: formatBytes(trafficWindowTotals.day.totalUp),
                        down: formatBytes(trafficWindowTotals.day.totalDown),
                    }),
                } : {
                    value: '--',
                    sub: t('pages.dashboardCommon.trafficPending'),
                }),
                ...DASHBOARD_ACCENT.info,
                onClick: () => navigate('/audit?tab=traffic'),
                skeletonWidth: '8.5rem',
            },
            {
                icon: HiOutlineClock,
                label: t('pages.dashboardGlobal.cards.weekTraffic'),
                ...(trafficWindowTotals.week.ready ? {
                    animateValue: trafficWindowTotals.week.totalUp + trafficWindowTotals.week.totalDown,
                    renderAnimatedValue: (value) => formatBytes(value),
                    sub: t('pages.dashboardCommon.trafficSplit', {
                        up: formatBytes(trafficWindowTotals.week.totalUp),
                        down: formatBytes(trafficWindowTotals.week.totalDown),
                    }),
                } : {
                    value: '--',
                    sub: t('pages.dashboardCommon.trafficPending'),
                }),
                ...DASHBOARD_ACCENT.warning,
                onClick: () => navigate('/audit?tab=traffic'),
                skeletonWidth: '8.5rem',
            },
            {
                icon: HiOutlineChartBarSquare,
                label: t('pages.dashboardGlobal.cards.monthTraffic'),
                ...(trafficWindowTotals.month.ready ? {
                    animateValue: trafficWindowTotals.month.totalUp + trafficWindowTotals.month.totalDown,
                    renderAnimatedValue: (value) => formatBytes(value),
                    sub: t('pages.dashboardCommon.trafficSplit', {
                        up: formatBytes(trafficWindowTotals.month.totalUp),
                        down: formatBytes(trafficWindowTotals.month.totalDown),
                    }),
                } : {
                    value: '--',
                    sub: t('pages.dashboardCommon.trafficPending'),
                }),
                ...DASHBOARD_ACCENT.primary,
                onClick: () => navigate('/audit?tab=traffic'),
                skeletonWidth: '8.5rem',
            },
        ];
        const globalQuickActions = [
            {
                title: locale === 'en-US' ? 'Users' : '用户管理',
                detail: globalAccountSummary.pendingUsers > 0
                    ? (locale === 'en-US' ? `${globalAccountSummary.pendingUsers} pending` : `待审核 ${globalAccountSummary.pendingUsers} 个`)
                    : (locale === 'en-US' ? 'View accounts, traffic, and subscriptions' : '查看账号、流量和订阅'),
                meta: globalAccountSummary.totalUsers > 0
                    ? (locale === 'en-US' ? `${globalAccountSummary.totalUsers} registered users` : `已注册 ${globalAccountSummary.totalUsers} 个用户`)
                    : (locale === 'en-US' ? 'Manage registered users and subscription entry points' : '管理注册用户与订阅入口'),
                icon: HiOutlineUsers,
                tone: 'info',
                onClick: () => navigate('/clients'),
            },
            {
                title: locale === 'en-US' ? 'Inbounds' : '入站管理',
                detail: t('pages.dashboardCommon.enabledCount', { active: globalStats.activeInbounds, total: globalStats.totalInbounds }),
                meta: locale === 'en-US' ? 'Adjust node order, users, and policy limits' : '调整节点顺序、用户和限制策略',
                icon: HiOutlineSignal,
                tone: 'warning',
                onClick: () => navigate('/inbounds'),
            },
            {
                title: locale === 'en-US' ? 'Audit' : '审计中心',
                detail: globalOnlineSessionCount > 0
                    ? (locale === 'en-US' ? `Online sessions ${globalOnlineSessionCount}` : `当前在线会话 ${globalOnlineSessionCount}`)
                    : (locale === 'en-US' ? 'Review subscription access and audit logs' : '查看订阅访问和操作日志'),
                meta: locale === 'en-US' ? 'Investigate abnormal access, geo lookup, and carrier info' : '排查异常访问、地区归属地和运营商',
                icon: HiOutlineBolt,
                tone: 'primary',
                onClick: () => navigate('/audit'),
            },
            {
                title: locale === 'en-US' ? 'Settings' : '系统设置',
                detail: locale === 'en-US'
                    ? 'Open system settings, console, and diagnostics'
                    : '进入系统设置、节点控制台和诊断区',
                meta: locale === 'en-US'
                    ? `${globalStats.onlineServers} / ${globalStats.serverCount} nodes online`
                    : `${globalStats.onlineServers} / ${globalStats.serverCount} 个节点在线`,
                icon: HiOutlineCog6Tooth,
                tone: 'success',
                onClick: () => navigate('/settings'),
            },
        ];

        return (
            <>
                <Header
                    title={t('pages.dashboardGlobal.title')}
                    eyebrow={t('pages.dashboardGlobal.eyebrow')}
                    icon={<HiOutlineCloud />}
                >
                    <button
                        className={`btn btn-sm dashboard-refresh-btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={toggleAutoRefresh}
                        title={autoRefresh ? t('pages.dashboardCommon.autoRefreshOffTitle') : t('pages.dashboardCommon.autoRefreshOnTitle')}
                    >
                        <HiOutlineArrowPath className={autoRefresh ? 'spinning' : ''} style={{ fontSize: '13px' }} />
                        <span className="hidden sm:inline-block ml-1">
                            {autoRefresh ? t('pages.dashboardCommon.autoRefreshOn') : t('pages.dashboardCommon.autoRefreshOff')}
                        </span>
                    </button>
                </Header>
                <div className="page-content page-enter dashboard-page">
                    <div className="stats-grid dashboard-stats-grid mb-8">
                        {globalCards.map((card, index) => (
                            <StatCard
                                key={`${card.label || card.kicker || 'global-card'}-${index}`}
                                card={card}
                                loading={false}
                            />
                        ))}
                    </div>

                    {showOnlineDetail && (
                        <div className="card mb-6">
                            <SectionHeader
                                className="dashboard-section-head"
                                title={t('pages.dashboardGlobal.onlineDetailTitle')}
                                meta={(
                                    <span className="text-sm text-muted">
                                        {t('pages.dashboardCommon.userSessionSummary', {
                                            users: globalOnlineUsers.length,
                                            sessions: globalOnlineSessionCount,
                                        })}
                                    </span>
                                )}
                            />
                            {globalPresenceLoading && !globalPresenceReady ? (
                                <EmptyState
                                    title={t('pages.dashboardCommon.onlineUsersPending')}
                                    size="compact"
                                    hideIcon
                                />
                            ) : globalOnlineUsers.length === 0 ? (
                                <EmptyState
                                    title={t('pages.dashboardCommon.onlineEmpty')}
                                    size="compact"
                                    hideIcon
                                />
                            ) : (
                                isCompactLayout ? (
                                    <OnlineUsersMobileList
                                        rows={globalOnlineUsers}
                                        showNodes
                                        limit={MAX_GLOBAL_ONLINE_ROWS}
                                        t={t}
                                        keyPrefix="global-online"
                                    />
                                ) : (
                                    <div className="table-container table-scroll table-scroll-lg overflow-x-auto">
                                        <table className="table dashboard-online-table">
                                            <thead>
                                                <tr>
                                                    <th>{t('pages.dashboardCommon.userIdentifier')}</th>
                                                    <th>{t('pages.dashboardGlobal.onlineNodes')}</th>
                                                    <th className="table-cell-right">{t('pages.dashboardCommon.sessions')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {globalOnlineUsers.slice(0, MAX_GLOBAL_ONLINE_ROWS).map((row) => (
                                                    <tr key={`global-online-${row.userId || row.label}`}>
                                                        <td data-label={t('pages.dashboardCommon.userIdentifier')} className="dashboard-online-label-cell">
                                                            <div className="dashboard-online-label" title={row.email ? `${row.displayName} · ${row.email}` : row.displayName}>
                                                                <div className="dashboard-online-name font-medium">{row.displayName}</div>
                                                                {row.email && row.email !== row.displayName && (
                                                                    <div className="dashboard-online-email">{row.email}</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td data-label={t('pages.dashboardGlobal.onlineNodes')} className="dashboard-online-nodes-cell">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {row.nodeLabels.length === 0 ? (
                                                                    <span className="badge badge-neutral">{t('pages.dashboardCommon.unknownNode')}</span>
                                                                ) : (
                                                                    row.nodeLabels.slice(0, 4).map((nodeLabel) => (
                                                                        <span key={`${row.userId || row.label}-${nodeLabel}`} className="badge badge-info">{nodeLabel}</span>
                                                                    ))
                                                                )}
                                                                {row.nodeLabels.length > 4 && <span className="badge badge-neutral">+{row.nodeLabels.length - 4}</span>}
                                                            </div>
                                                        </td>
                                                        <td data-label={t('pages.dashboardCommon.sessions')} className="table-cell-right font-mono dashboard-online-sessions-cell"><span className="badge badge-success">{row.sessions}</span></td>
                                                    </tr>
                                                ))}
                                                {globalOnlineUsers.length > MAX_GLOBAL_ONLINE_ROWS && (
                                                    <tr><td colSpan={3} className="table-note">{t('pages.dashboardCommon.limitNote', { count: MAX_GLOBAL_ONLINE_ROWS })}</td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )
                            )}
                        </div>
                    )}

                    <div className="card mb-6">
                        <SectionHeader
                            className="dashboard-section-head"
                            title={t('pages.dashboardCommon.quickActionsTitle')}
                        />
                        <QuickActionGrid actions={globalQuickActions} />
                    </div>

                    {/* 节点健康网格 */}
                    <div className="mb-6">
                        <SectionHeader
                            className="dashboard-section-head"
                            title={t('pages.dashboardGlobal.nodeHealthTitle')}
                            meta={<span className="text-sm text-muted">{t('pages.dashboardGlobal.nodeCount', { count: servers.length })}</span>}
                        />
                        <NodeHealthGrid servers={servers} serverStatuses={serverStatuses} trendHistory={serverTrendHistory} />
                    </div>
                </div>
            </>
        );
    }

    // ── Single Server Dashboard ──────────────────────────
    const totalUp = Number(singleServerTrafficTotals.totalUp || 0);
    const totalDown = Number(singleServerTrafficTotals.totalDown || 0);
    const activeInbounds = inbounds.filter(i => i.enable).length;

    const statCards = [
        {
            icon: HiOutlineCpuChip,
            label: t('pages.dashboardNode.cards.cpuUsage'),
            value: status ? `${status.cpu.toFixed(1)}%` : '--',
            ...DASHBOARD_ACCENT.primary,
            skeletonWidth: '5.5rem',
            sparkline: singleServerCpuSparkline,
            sparklineDomain: [0, 100],
        },
        { icon: HiOutlineCircleStack, label: t('pages.dashboardNode.cards.memoryUsage'), value: status ? `${((status.mem.current / status.mem.total) * 100).toFixed(1)}%` : '--', sub: status ? `${formatBytes(status.mem.current)} / ${formatBytes(status.mem.total)}` : '', ...DASHBOARD_ACCENT.primary, skeletonWidth: '7rem' },
        { icon: HiOutlineClock, label: t('pages.dashboardNode.cards.runtime'), value: status ? formatUptime(status.uptime, locale) : '--', ...DASHBOARD_ACCENT.success, skeletonWidth: '8rem' },
        {
            icon: HiOutlineArrowsUpDown,
            label: t('pages.dashboardNode.cards.totalTraffic'),
            animateValue: totalUp + totalDown,
            renderAnimatedValue: (value) => formatBytes(value),
            sub: t('pages.dashboardCommon.trafficSplit', { up: formatBytes(totalUp), down: formatBytes(totalDown) }),
            ...DASHBOARD_ACCENT.primary,
            skeletonWidth: '8rem',
        },
        { icon: HiOutlineSignal, label: t('pages.dashboardNode.cards.inbounds'), value: `${activeInbounds} / ${inbounds.length}`, sub: t('pages.dashboardCommon.enabledTotal'), ...DASHBOARD_ACCENT.warning, onClick: () => navigate('/inbounds'), skeletonWidth: '6.5rem' },
        {
            icon: HiOutlineUsers,
            label: t('pages.dashboardNode.cards.onlineUsers'),
            animateValue: onlineCount,
            renderAnimatedValue: (value) => String(value),
            sub: showOnlineDetail ? t('pages.dashboardCommon.hideDetail') : t('pages.dashboardCommon.showDetail'),
            onClick: () => setShowOnlineDetail((v) => !v),
            ...DASHBOARD_ACCENT.info,
            skeletonWidth: '5.5rem',
        },
    ];
    const singleQuickActions = [
        {
            title: locale === 'en-US' ? 'Inbounds' : '入站管理',
            detail: t('pages.dashboardCommon.enabledCount', { active: activeInbounds, total: inbounds.length }),
            meta: locale === 'en-US' ? 'Inspect inbounds, users, and limit policies on this node' : '查看当前节点下的入站、用户与限制配置',
            icon: HiOutlineSignal,
            tone: 'warning',
            onClick: () => navigate('/inbounds'),
        },
        {
            title: locale === 'en-US' ? 'Online Users' : '在线用户',
            detail: onlineCount > 0
                ? (locale === 'en-US' ? `${onlineCount} users online` : `${onlineCount} 个用户在线`)
                : (locale === 'en-US' ? 'No users are online right now' : '当前没有在线用户'),
            meta: showOnlineDetail
                ? (locale === 'en-US' ? 'Online detail is expanded' : '已展开在线明细')
                : (locale === 'en-US' ? 'Click to expand online detail' : '点击直接展开在线明细'),
            icon: HiOutlineUsers,
            tone: 'info',
            onClick: () => setShowOnlineDetail((value) => !value),
        },
        {
            title: locale === 'en-US' ? 'Audit' : '审计中心',
            detail: locale === 'en-US' ? 'Inspect access and audit logs for this node' : '查看这个节点相关的访问与操作日志',
            meta: locale === 'en-US' ? 'Useful for tracing timeouts, geo lookup, and subscription access issues' : '适合排查超时、归属地和订阅访问异常',
            icon: HiOutlineBolt,
            tone: 'primary',
            onClick: () => navigate('/audit'),
        },
        {
            title: locale === 'en-US' ? 'Settings' : '系统设置',
            detail: locale === 'en-US'
                ? 'Open settings, diagnostics, and the embedded console'
                : '进入系统设置、诊断区和嵌入式控制台',
            meta: activeServer?.name || (locale === 'en-US' ? 'For the current node' : '当前节点'),
            icon: HiOutlineCog6Tooth,
            tone: 'success',
            onClick: () => navigate('/settings'),
        },
    ];

    return (
        <>
            <Header
                title={activeServer?.name || t('pages.dashboardNode.title')}
                eyebrow={t('pages.dashboardNode.eyebrow')}
            >
                <button
                    className={`btn btn-sm dashboard-refresh-btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={toggleAutoRefresh}
                    title={autoRefresh ? t('pages.dashboardCommon.autoRefreshOffTitle') : t('pages.dashboardCommon.autoRefreshOnTitle')}
                >
                    <HiOutlineArrowPath className={autoRefresh ? 'spinning' : ''} style={{ fontSize: '13px' }} />
                    <span className="hidden sm:inline-block ml-1">
                        {autoRefresh ? t('pages.dashboardCommon.autoRefreshOn') : t('pages.dashboardCommon.autoRefreshOff')}
                    </span>
                </button>
            </Header>
            <div className="page-content page-enter dashboard-page">
                <div className="stats-grid dashboard-stats-grid">
                    {statCards.map((card, index) => (
                        <StatCard
                            key={`${card.label || card.kicker || 'node-card'}-${index}`}
                            card={card}
                            loading={loading}
                        />
                    ))}
                </div>

                {showOnlineDetail && (
                    <div className="card mb-6">
                        <SectionHeader
                            className="dashboard-section-head"
                            title={t('pages.dashboardNode.onlineDetailTitle')}
                            meta={<span className="text-sm text-muted">{t('pages.dashboardCommon.userSessionSummary', { users: onlineUsers.length, sessions: onlineSessionCount })}</span>}
                        />
                        {onlineUsers.length === 0 ? (
                            <EmptyState
                                title={t('pages.dashboardCommon.onlineEmpty')}
                                size="compact"
                                hideIcon
                            />
                        ) : (
                            isCompactLayout ? (
                                <OnlineUsersMobileList
                                    rows={onlineUsers}
                                    limit={MAX_SINGLE_ONLINE_ROWS}
                                    t={t}
                                    keyPrefix="single-online"
                                />
                            ) : (
                                <div className="table-container table-scroll table-scroll-md overflow-x-auto">
                                    <table className="table dashboard-online-table">
                                        <thead><tr><th>{t('pages.dashboardCommon.userIdentifier')}</th><th className="table-cell-right">{t('pages.dashboardCommon.sessions')}</th></tr></thead>
                                        <tbody>
                                                {onlineUsers.slice(0, MAX_SINGLE_ONLINE_ROWS).map((row) => (
                                                    <tr key={`single-online-${row.userId || row.label}`}>
                                                        <td data-label={t('pages.dashboardCommon.userIdentifier')} className="dashboard-online-label-cell">
                                                            <div className="dashboard-online-label" title={row.email ? `${row.displayName} · ${row.email}` : row.displayName}>
                                                                <div className="dashboard-online-name font-medium">{row.displayName}</div>
                                                                {row.email && row.email !== row.displayName && (
                                                                    <div className="dashboard-online-email">{row.email}</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    <td data-label={t('pages.dashboardCommon.sessions')} className="table-cell-right font-mono dashboard-online-sessions-cell"><span className="badge badge-success">{row.sessions}</span></td>
                                                </tr>
                                            ))}
                                            {onlineUsers.length > MAX_SINGLE_ONLINE_ROWS && (
                                                <tr><td colSpan={2} className="table-note">{t('pages.dashboardCommon.limitNote', { count: MAX_SINGLE_ONLINE_ROWS })}</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                    </div>
                )}

                <div className="card mb-6">
                    <SectionHeader
                        className="dashboard-section-head"
                        title={t('pages.dashboardCommon.quickActionsTitle')}
                    />
                    <QuickActionGrid actions={singleQuickActions} />
                </div>

                {/* Inbound Summary */}
                <div className="card mb-6">
                    <SectionHeader
                        className="dashboard-section-head"
                        title={t('pages.dashboardNode.inboundsTitle')}
                        meta={<span className="text-sm text-muted">{t('pages.dashboardNode.inboundsCount', { count: inbounds.length })}</span>}
                    />
                    {inbounds.length === 0 ? (
                        <div className="table-container border-none overflow-x-auto p-4">
                            <EmptyState
                                title={t('pages.dashboardNode.inboundsEmpty')}
                                subtitle={t('pages.dashboardNode.inboundsEmptySubtitle')}
                                size="compact"
                            />
                        </div>
                    ) : isCompactLayout ? (
                        <InboundSummaryMobileList inbounds={inbounds} loading={loading} t={t} />
                    ) : (
                        <div className="table-container border-none overflow-x-auto">
                            <table className="table dashboard-inbound-summary-table">
                                <thead>
                                    <tr>
                                        <th>{t('pages.dashboardNode.tableRemark')}</th>
                                        <th className="table-cell-center dashboard-inbound-protocol-column">{t('pages.dashboardNode.tableProtocol')}</th>
                                        <th className="table-cell-right dashboard-inbound-port-column">{t('pages.dashboardNode.tablePort')}</th>
                                        <th className="table-cell-center dashboard-inbound-status-column">{t('pages.dashboardNode.tableStatus')}</th>
                                        <th className="table-cell-right dashboard-inbound-up-column">{t('pages.dashboardNode.tableUp')}</th>
                                        <th className="table-cell-right dashboard-inbound-down-column">{t('pages.dashboardNode.tableDown')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {inbounds.slice(0, 10).map((ib) => (
                                        <tr key={ib.id}>
                                            <td data-label={t('pages.dashboardNode.tableRemark')} className="font-medium text-white truncate max-w-[200px]">{ib.remark || '-'}</td>
                                            <td data-label={t('pages.dashboardNode.tableProtocol')} className="table-cell-center dashboard-inbound-protocol-cell"><span className="badge badge-info">{ib.protocol}</span></td>
                                            <td data-label={t('pages.dashboardNode.tablePort')} className="table-cell-right font-mono dashboard-inbound-port-cell">{ib.port}</td>
                                            <td data-label={t('pages.dashboardNode.tableStatus')} className="table-cell-center dashboard-inbound-status-cell">
                                                <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>{ib.enable ? t('pages.dashboardNode.statusEnabled') : t('pages.dashboardNode.statusDisabled')}</span>
                                            </td>
                                            <td data-label={t('pages.dashboardNode.tableUp')} className="table-cell-right font-mono dashboard-inbound-up-cell">
                                                {loading ? <div className="skeleton" style={{ width: '4.5rem', height: '1rem', marginLeft: 'auto' }} /> : formatBytes(ib.up)}
                                            </td>
                                            <td data-label={t('pages.dashboardNode.tableDown')} className="table-cell-right font-mono dashboard-inbound-down-cell">
                                                {loading ? <div className="skeleton" style={{ width: '4.5rem', height: '1rem', marginLeft: 'auto' }} /> : formatBytes(ib.down)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* CPU History Chart */}
                <div className="card mb-6">
                    <SectionHeader
                        className="dashboard-section-head"
                        title={t('pages.dashboardNode.cpuChartTitle')}
                    />
                    <div className="w-full dashboard-chart py-5">
                        {loading && cpuHistory.length === 0 ? (
                            <div className="w-full h-full flex flex-col gap-4 px-6">
                                <div className="skeleton w-full h-full opacity-10" />
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={cpuHistory}>
                                    <defs>
                                        <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid-color)" vertical={false} />
                                    <XAxis
                                        dataKey="time"
                                        axisLine={false}
                                        tickLine={false}
                                        minTickGap={24}
                                        tickMargin={10}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                        tickFormatter={(value) => {
                                            if (value === 0) return t('pages.dashboardNode.cpuChartStartTick');
                                            if (value === cpuChartEndTick) return t('pages.dashboardNode.cpuChartEndTick');
                                            return '';
                                        }}
                                    />
                                    <YAxis
                                        domain={[0, 100]}
                                        axisLine={false}
                                        tickLine={false}
                                        tickCount={3}
                                        width={34}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                        tickFormatter={(value) => `${value}%`}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            background: 'var(--surface-overlay)',
                                            backdropFilter: 'blur(8px)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '12px',
                                            fontSize: '12px',
                                            color: 'var(--text-primary)',
                                            boxShadow: 'var(--shadow-lg)'
                                        }}
                                        labelStyle={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}
                                        itemStyle={{ color: 'var(--accent-primary-hover)' }}
                                        labelFormatter={(value) => `${t('pages.dashboardNode.cpuTooltipLabel')} · ${value}`}
                                        formatter={(v) => [`${v.toFixed(1)}%`, t('pages.dashboardNode.cpuTooltipLabel')]}
                                        cursor={{ stroke: 'var(--chart-grid-color)', strokeDasharray: '3 3', strokeWidth: 1.5 }}
                                    />
                                    <Area type="monotone" dataKey="cpu" stroke="var(--accent-primary)" strokeWidth={2} fill="url(#cpuGradient)" animationDuration={1500} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
