import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { formatBytes } from '../../utils/format.js';
import useWebSocket from '../../hooks/useWebSocket.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
    HiOutlineCpuChip,
    HiOutlineCircleStack,
    HiOutlineArrowsUpDown,
    HiOutlineClock,
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
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

const AUTO_REFRESH_INTERVAL = 30_000;
const MAX_SINGLE_ONLINE_ROWS = 120;
const MAX_GLOBAL_ONLINE_ROWS = 200;
const MAX_NODE_TREND_POINTS = 12;
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
            <div className="dashboard-stat-card-head">
                <div className="dashboard-stat-card-copy">
                    <span className="dashboard-stat-card-label">{card.label}</span>
                    {card.kicker && <span className="dashboard-stat-card-kicker">{card.kicker}</span>}
                </div>
            </div>
            <div className="dashboard-stat-card-body">
                <div className="card-value dashboard-stat-card-value">
                    {loading ? (
                        <div
                            className="skeleton dashboard-stat-card-skeleton mt-1"
                            style={{ width: card.skeletonWidth || 'clamp(7.5rem, 44%, 11rem)', height: '2.35rem' }}
                        />
                    ) : card.animateValue !== undefined ? (
                        card.renderAnimatedValue
                            ? card.renderAnimatedValue(animatedValue)
                            : `${animatedValue}${card.animateSuffix || ''}`
                    ) : (
                        card.value
                    )}
                </div>
                {Array.isArray(card.sparkline) && card.sparkline.length > 1 && (
                    <StatSparkline points={card.sparkline} domain={card.sparklineDomain} />
                )}
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

function normalizeOnlineEntry(item, serverName = '') {
    if (item === undefined || item === null) return null;
    if (typeof item === 'string') {
        const email = item.trim();
        if (!email) return null;
        return { email, serverName };
    }
    if (typeof item === 'object') {
        const email = String(
            item.email || item.user || item.username || item.clientEmail || item.client || item.remark || ''
        ).trim();
        if (!email) return null;
        return { email, serverName };
    }
    return null;
}

function normalizeOnlineList(raw, serverName = '') {
    const list = Array.isArray(raw) ? raw : [];
    const normalized = [];
    for (const item of list) {
        const entry = normalizeOnlineEntry(item, serverName);
        if (entry) normalized.push(entry);
    }
    return normalized;
}

function summarizeOnlineUsers(users) {
    const summary = new Map();
    for (const user of Array.isArray(users) ? users : []) {
        const rawEmail = String(user?.email || '').trim();
        if (!rawEmail) continue;
        const key = rawEmail.toLowerCase();
        if (!summary.has(key)) {
            summary.set(key, { email: rawEmail, sessions: 0, servers: new Set() });
        }
        const row = summary.get(key);
        row.sessions += 1;
        if (user?.serverName) row.servers.add(user.serverName);
    }
    return Array.from(summary.values())
        .map((row) => ({ email: row.email, sessions: row.sessions, servers: Array.from(row.servers.values()) }))
        .sort((a, b) => (b.sessions !== a.sessions ? b.sessions - a.sessions : a.email.localeCompare(b.email)));
}

function pushServerTrendSamples(previous, serverMap) {
    const next = {};
    for (const [serverId, serverData] of Object.entries(serverMap || {})) {
        const current = Array.isArray(previous?.[serverId]) ? previous[serverId] : [];
        const mem = serverData?.status?.mem;
        const memPercent = mem?.total ? Math.max(0, Math.min(100, (Number(mem.current || 0) / Number(mem.total || 1)) * 100)) : 0;
        const sample = {
            ts: Date.now(),
            cpu: Math.max(0, Math.min(100, Number(serverData?.status?.cpu || 0))),
            mem: memPercent,
            online: serverData?.online !== false,
        };
        const last = current[current.length - 1];
        const merged = last
            && last.cpu === sample.cpu
            && last.mem === sample.mem
            && last.online === sample.online
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

function formatLocalizedUptime(seconds, locale) {
    const totalSeconds = Number(seconds || 0);
    if (!totalSeconds) return locale === 'en-US' ? '0s' : '0秒';

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];

    if (locale === 'en-US') {
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (parts.length === 0) parts.push(`${totalSeconds}s`);
        return parts.join(' ');
    }

    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}时`);
    if (minutes > 0) parts.push(`${minutes}分`);
    if (parts.length === 0) parts.push(`${totalSeconds}秒`);
    return parts.join(' ');
}

// ── WebSocket URL builder ────────────────────────────────
function getWsUrl(ticket) {
    if (!ticket) return null;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = String(import.meta.env.VITE_WS_HOST || '').trim() || window.location.host;
    return `${proto}://${host}/ws?ticket=${encodeURIComponent(ticket)}`;
}

// ── Connection Status Indicator ──────────────────────────
function WsStatusDot({ status }) {
    const { t } = useI18n();
    const labels = {
        connected: t('pages.dashboardCommon.wsConnected'),
        connecting: t('pages.dashboardCommon.wsConnecting'),
        reconnecting: t('pages.dashboardCommon.wsReconnecting'),
        disconnected: t('pages.dashboardCommon.wsDisconnected'),
    };
    const currentStatus = status || 'disconnected';
    const label = labels[currentStatus] || '未知';

    return (
        <div
            className="ws-status-chip"
            data-status={currentStatus}
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            <HiOutlineBolt className="ws-status-icon" />
            <span className="ws-status-label">
                {label}
            </span>
        </div>
    );
}

export default function Dashboard() {
    const { activeServerId, panelApi, activeServer, servers } = useServer();
    const { token } = useAuth();
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const [wsTicket, setWsTicket] = useState('');
    const lastWsTicketFetchAtRef = useRef(0);

    // Single Server State
    const [status, setStatus] = useState(null);
    const [cpuHistory, setCpuHistory] = useState([]);
    const [inbounds, setInbounds] = useState([]);
    const [onlineCount, setOnlineCount] = useState(0);
    const [onlineUsers, setOnlineUsers] = useState([]);

    // Global State
    const [globalStats, setGlobalStats] = useState({
        totalUp: 0, totalDown: 0, totalOnline: 0,
        totalInbounds: 0, activeInbounds: 0,
        serverCount: 0, onlineServers: 0,
    });
    const [serverStatuses, setServerStatuses] = useState({});
    const [serverTrendHistory, setServerTrendHistory] = useState({});
    const [globalOnlineUsers, setGlobalOnlineUsers] = useState([]);

    // Shared State
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [showOnlineDetail, setShowOnlineDetail] = useState(false);
    const singleServerCpuSparkline = useMemo(
        () => cpuHistory.map((item) => Number(item?.cpu)).filter((value) => Number.isFinite(value)),
        [cpuHistory]
    );
    const clusterCpuSparkline = useMemo(
        () => buildClusterTrend(serverTrendHistory, (item) => Number(item?.cpu)),
        [serverTrendHistory]
    );
    const clusterOnlineSparkline = useMemo(
        () => buildClusterTrend(serverTrendHistory, (item) => (item?.online === false ? 0 : 1)),
        [serverTrendHistory]
    );

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
        const clusterOnlines = [];
        const statusMap = {};
        let derivedTotalInbounds = 0;
        let derivedActiveInbounds = 0;
        let derivedTotalUp = 0;
        let derivedTotalDown = 0;

        for (const [serverId, sData] of Object.entries(data.servers || {})) {
            statusMap[serverId] = sData;
            if (sData?.online) {
                derivedTotalInbounds += Number(sData?.inboundCount || 0);
                derivedActiveInbounds += Number(sData?.activeInbounds || 0);
                derivedTotalUp += Number(sData?.up || sData?.status?.netTraffic?.sent || 0);
                derivedTotalDown += Number(sData?.down || sData?.status?.netTraffic?.recv || 0);
            }
            if (sData.online && sData.onlineUsers) {
                const serverName = sData.name || serverId;
                for (const u of sData.onlineUsers) {
                    clusterOnlines.push({ email: u.email, serverName });
                }
            }
        }

        const totalInbounds = Number.isFinite(Number(data.totalInbounds))
            ? Number(data.totalInbounds)
            : derivedTotalInbounds;
        const activeInbounds = Number.isFinite(Number(data.activeInbounds))
            ? Number(data.activeInbounds)
            : derivedActiveInbounds;
        const totalUp = Number.isFinite(Number(data.totalUp))
            ? Number(data.totalUp)
            : derivedTotalUp;
        const totalDown = Number.isFinite(Number(data.totalDown))
            ? Number(data.totalDown)
            : derivedTotalDown;

        setServerStatuses(statusMap);
        setServerTrendHistory((previous) => pushServerTrendSamples(previous, statusMap));
        setGlobalOnlineUsers(clusterOnlines);
        setGlobalStats({
            totalUp,
            totalDown,
            totalOnline: data.totalOnline || 0,
            totalInbounds,
            activeInbounds,
            serverCount: data.serverCount || 0,
            onlineServers: data.onlineServers || 0,
        });
        setLoading(false);
    }, [lastMessage, activeServerId]);

    // ── REST Fetchers (fallback / single server) ─────────
    const fetchSingleData = useCallback(async () => {
        if (!activeServerId || activeServerId === 'global') return;
        try {
            const [statusRes, cpuRes, inboundsRes] = await Promise.all([
                panelApi('get', '/panel/api/server/status'),
                panelApi('get', '/panel/api/server/cpuHistory/30'),
                panelApi('get', '/panel/api/inbounds/list'),
            ]);
            if (statusRes.data?.obj) setStatus(statusRes.data.obj);
            if (cpuRes.data?.obj) {
                setCpuHistory(cpuRes.data.obj.map((p, i) => ({
                    time: i,
                    cpu: typeof p === 'number' ? p : p?.cpu || 0,
                })));
            }
            if (inboundsRes.data?.obj) setInbounds(inboundsRes.data.obj);

            try {
                const onlineRes = await panelApi('post', '/panel/api/inbounds/onlines');
                const normalizedOnline = normalizeOnlineList(onlineRes.data?.obj || [], activeServer?.name || '');
                setOnlineUsers(normalizedOnline);
                setOnlineCount(normalizedOnline.length);
            } catch {
                setOnlineUsers([]);
                setOnlineCount(0);
            }
        } catch (err) {
            console.error('Dashboard fetch error:', err);
        }
        setLoading(false);
    }, [activeServer?.name, activeServerId, panelApi]);

    const fetchGlobalData = useCallback(async () => {
        if (servers.length === 0) {
            setGlobalOnlineUsers([]);
            setLoading(false);
            return;
        }
        try {
            const results = {};
            const clusterOnlines = [];
            let stats = {
                totalUp: 0, totalDown: 0, totalOnline: 0,
                totalInbounds: 0, activeInbounds: 0,
                serverCount: servers.length, onlineServers: 0,
            };

            await Promise.all(servers.map(async (server) => {
                try {
                    const [statusRes, inboundsRes, onlineRes] = await Promise.all([
                        api.get(`/panel/${server.id}/panel/api/server/status`),
                        api.get(`/panel/${server.id}/panel/api/inbounds/list`),
                        api.post(`/panel/${server.id}/panel/api/inbounds/onlines`),
                    ]);
                    const sStatus = statusRes.data.obj;
                    const sInbounds = inboundsRes.data.obj || [];
                    const sOnlines = normalizeOnlineList(onlineRes.data?.obj || [], server.name);

                    results[server.id] = {
                        online: true, status: sStatus, name: server.name,
                        inboundCount: sInbounds.length, onlineCount: sOnlines.length,
                        onlineUsers: sOnlines,
                        activeInbounds: sInbounds.filter(i => i.enable).length,
                        up: sInbounds.reduce((a, b) => a + (b.up || 0), 0),
                        down: sInbounds.reduce((a, b) => a + (b.down || 0), 0),
                    };
                    clusterOnlines.push(...sOnlines);
                    stats.onlineServers++;
                    stats.totalUp += results[server.id].up;
                    stats.totalDown += results[server.id].down;
                    stats.totalOnline += results[server.id].onlineCount;
                    stats.totalInbounds += results[server.id].inboundCount;
                    stats.activeInbounds += results[server.id].activeInbounds;
                } catch (err) {
                    results[server.id] = { online: false, error: err.message };
                }
            }));

            setServerStatuses(results);
            setServerTrendHistory((previous) => pushServerTrendSamples(previous, results));
            setGlobalStats(stats);
            setGlobalOnlineUsers(clusterOnlines);
        } catch (err) {
            console.error('Global fetch error:', err);
            setGlobalOnlineUsers([]);
        }
        setLoading(false);
    }, [servers]);

    useEffect(() => {
        setLoading(true);
        if (activeServerId === 'global') {
            // Initial load via REST, then WebSocket takes over
            fetchGlobalData();
        } else if (activeServerId) {
            fetchSingleData();
        } else {
            setLoading(false);
        }

        if (!autoRefresh) return;
        const interval = setInterval(() => {
            // For single server, keep polling; for global, WS handles it (but poll as fallback)
            if (activeServerId === 'global') {
                if (wsStatus !== 'connected') fetchGlobalData();
            } else if (activeServerId) {
                fetchSingleData();
            }
        }, AUTO_REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [activeServerId, fetchSingleData, fetchGlobalData, autoRefresh, wsStatus]);

    const refresh = () => activeServerId === 'global' ? fetchGlobalData() : fetchSingleData();
    const toggleAutoRefresh = () => {
        setAutoRefresh((previous) => {
            const next = !previous;
            if (next) {
                refresh();
            }
            return next;
        });
    };
    const onlineUserRows = useMemo(() => summarizeOnlineUsers(onlineUsers), [onlineUsers]);
    const globalOnlineUserRows = useMemo(() => summarizeOnlineUsers(globalOnlineUsers), [globalOnlineUsers]);
    const cpuChartEndTick = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1].time : 0;

    // Empty State
    if (!activeServerId && servers.length === 0 && activeServerId !== 'global') {
        return (
            <>
                <Header
                    title={t('pages.dashboardEmpty.title')}
                    subtitle={t('pages.dashboardEmpty.subtitle')}
                />
                
                <div className="page-content page-enter">
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
        const globalCards = [
            {
                icon: HiOutlineServerStack, label: t('pages.dashboardGlobal.cards.nodeStatus'),
                value: `${globalStats.onlineServers} / ${globalStats.serverCount}`,
                sub: t('pages.dashboardCommon.onlineTotal'), ...DASHBOARD_ACCENT.primary,
                onClick: () => navigate('/servers'),
                skeletonWidth: '9rem',
                sparkline: clusterOnlineSparkline,
                sparklineDomain: [0, 1],
            },
            {
                icon: HiOutlineUsers, label: t('pages.dashboardGlobal.cards.totalOnlineUsers'),
                animateValue: globalStats.totalOnline,
                renderAnimatedValue: (value) => String(value),
                sub: showOnlineDetail ? t('pages.dashboardCommon.hideDetail') : t('pages.dashboardCommon.showDetail'),
                onClick: () => setShowOnlineDetail((v) => !v),
                ...DASHBOARD_ACCENT.info,
                skeletonWidth: '6rem',
                sparkline: clusterOnlineSparkline,
                sparklineDomain: [0, 1],
            },
            {
                icon: HiOutlineSignal, label: t('pages.dashboardGlobal.cards.totalInbounds'),
                value: `${globalStats.activeInbounds} / ${globalStats.totalInbounds}`,
                sub: t('pages.dashboardCommon.enabledTotal'), ...DASHBOARD_ACCENT.warning,
                onClick: () => navigate('/inbounds'),
                skeletonWidth: '8rem',
            },
            {
                icon: HiOutlineArrowsUpDown, label: t('pages.dashboardGlobal.cards.clusterTraffic'),
                animateValue: globalStats.totalUp + globalStats.totalDown,
                renderAnimatedValue: (value) => formatBytes(value),
                sub: t('pages.dashboardCommon.trafficSplit', {
                    up: formatBytes(globalStats.totalUp),
                    down: formatBytes(globalStats.totalDown),
                }),
                ...DASHBOARD_ACCENT.primary,
                onClick: () => navigate('/audit'),
                skeletonWidth: '8.5rem',
                sparkline: clusterCpuSparkline,
                sparklineDomain: [0, 100],
            },
        ];

        return (
            <>
                <Header
                    title={t('pages.dashboardGlobal.title')}
                    subtitle={t('pages.dashboardGlobal.subtitle')}
                    eyebrow={t('pages.dashboardGlobal.eyebrow')}
                    icon={<HiOutlineCloud />}
                />
                <div className="page-content page-enter">
                    <PageToolbar
                        className="card mb-6 dashboard-toolbar"
                        main={<WsStatusDot status={wsStatus} />}
                        actions={(
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
                        )}
                        meta={<span>{t('pages.dashboardGlobal.nodeCount', { count: servers.length })}</span>}
                    />
                    <div className="stats-grid mb-8">
                        {globalCards.map((card, idx) => (
                            <StatCard key={idx} card={card} loading={loading} />
                        ))}
                    </div>

                    {showOnlineDetail && (
                        <div className="card mb-6">
                            <SectionHeader
                                className="dashboard-section-head"
                                title={t('pages.dashboardGlobal.onlineDetailTitle')}
                                subtitle={t('pages.dashboardGlobal.onlineDetailSubtitle')}
                                meta={(
                                    <span className="text-sm text-muted">
                                        {t('pages.dashboardCommon.userSessionSummary', {
                                            users: globalOnlineUserRows.length,
                                            sessions: globalOnlineUsers.length,
                                        })}
                                    </span>
                                )}
                            />
                            {globalOnlineUserRows.length === 0 ? (
                                <EmptyState
                                    title={t('pages.dashboardCommon.onlineEmpty')}
                                    size="compact"
                                    hideIcon
                                />
                            ) : (
                                <div className="table-container table-scroll table-scroll-lg overflow-x-auto">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>{t('pages.dashboardCommon.userIdentifier')}</th>
                                                <th>{t('pages.dashboardGlobal.onlineNodes')}</th>
                                                <th className="text-right">{t('pages.dashboardCommon.sessions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {globalOnlineUserRows.slice(0, MAX_GLOBAL_ONLINE_ROWS).map((row) => (
                                                <tr key={`global-online-${row.email}`}>
                                                    <td data-label={t('pages.dashboardCommon.userIdentifier')} className="text-white font-medium truncate max-w-[200px]">{row.email}</td>
                                                    <td data-label={t('pages.dashboardGlobal.onlineNodes')}>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {row.servers.length === 0 ? (
                                                                <span className="badge badge-neutral">{t('pages.dashboardCommon.unknownNode')}</span>
                                                            ) : (
                                                                row.servers.slice(0, 4).map((sn) => (
                                                                    <span key={`${row.email}-${sn}`} className="badge badge-info">{sn}</span>
                                                                ))
                                                            )}
                                                            {row.servers.length > 4 && <span className="badge badge-neutral">+{row.servers.length - 4}</span>}
                                                        </div>
                                                    </td>
                                                    <td data-label={t('pages.dashboardCommon.sessions')} className="text-right font-mono"><span className="badge badge-success">{row.sessions}</span></td>
                                                </tr>
                                            ))}
                                            {globalOnlineUserRows.length > MAX_GLOBAL_ONLINE_ROWS && (
                                                <tr><td colSpan={3} className="table-note">{t('pages.dashboardCommon.limitNote', { count: MAX_GLOBAL_ONLINE_ROWS })}</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 节点健康网格 */}
                    <div className="mb-6">
                        <SectionHeader
                            className="dashboard-section-head"
                            title={t('pages.dashboardGlobal.nodeHealthTitle')}
                            subtitle={t('pages.dashboardGlobal.nodeHealthSubtitle')}
                            meta={<span className="text-sm text-muted">{t('pages.dashboardGlobal.nodeCount', { count: servers.length })}</span>}
                        />
                        <NodeHealthGrid servers={servers} serverStatuses={serverStatuses} trendHistory={serverTrendHistory} />
                    </div>
                </div>
            </>
        );
    }

    // ── Single Server Dashboard ──────────────────────────
    const totalUp = inbounds.reduce((a, b) => a + (b.up || 0), 0);
    const totalDown = inbounds.reduce((a, b) => a + (b.down || 0), 0);
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
        { icon: HiOutlineClock, label: t('pages.dashboardNode.cards.runtime'), value: status ? formatLocalizedUptime(status.uptime, locale) : '--', ...DASHBOARD_ACCENT.success, skeletonWidth: '8rem' },
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

    return (
        <>
            <Header
                title={t('pages.dashboardNode.title')}
                subtitle={activeServer
                    ? t('pages.dashboardNode.subtitleWithName', { name: activeServer.name })
                    : t('pages.dashboardNode.subtitle')}
                eyebrow={t('pages.dashboardNode.eyebrow')}
            />
            <div className="page-content page-enter">
                <PageToolbar
                    className="card mb-6 dashboard-toolbar"
                    main={(
                        <div className="page-toolbar-copy">
                            <div className="page-toolbar-title">{activeServer?.name || t('pages.dashboardNode.title')}</div>
                            <div className="page-toolbar-subtitle">{t('pages.dashboardNode.inboundsCount', { count: inbounds.length })}</div>
                        </div>
                    )}
                    actions={(
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
                    )}
                    meta={(
                        <span>
                            {status
                                ? `${t('pages.dashboardNode.cards.runtime')}: ${formatLocalizedUptime(status.uptime, locale)}`
                                : t('pages.dashboardNode.cards.runtime')}
                        </span>
                    )}
                />
                <div className="stats-grid">
                    {statCards.map((card, idx) => (
                        <StatCard key={idx} card={card} loading={loading} />
                    ))}
                </div>

                {showOnlineDetail && (
                    <div className="card mb-6">
                        <SectionHeader
                            className="dashboard-section-head"
                            title={t('pages.dashboardNode.onlineDetailTitle')}
                            subtitle={t('pages.dashboardNode.onlineDetailSubtitle')}
                            meta={<span className="text-sm text-muted">{t('pages.dashboardCommon.userSessionSummary', { users: onlineUserRows.length, sessions: onlineUsers.length })}</span>}
                        />
                        {onlineUserRows.length === 0 ? (
                            <EmptyState
                                title={t('pages.dashboardCommon.onlineEmpty')}
                                size="compact"
                                hideIcon
                            />
                        ) : (
                            <div className="table-container table-scroll table-scroll-md overflow-x-auto">
                                <table className="table">
                                    <thead><tr><th>{t('pages.dashboardCommon.userIdentifier')}</th><th className="text-right">{t('pages.dashboardCommon.sessions')}</th></tr></thead>
                                    <tbody>
                                        {onlineUserRows.slice(0, MAX_SINGLE_ONLINE_ROWS).map((row) => (
                                            <tr key={`single-online-${row.email}`}>
                                                <td data-label={t('pages.dashboardCommon.userIdentifier')} className="text-white font-medium truncate max-w-[200px]">{row.email}</td>
                                                <td data-label={t('pages.dashboardCommon.sessions')} className="text-right font-mono"><span className="badge badge-success">{row.sessions}</span></td>
                                            </tr>
                                        ))}
                                        {onlineUserRows.length > MAX_SINGLE_ONLINE_ROWS && (
                                            <tr><td colSpan={2} className="table-note">{t('pages.dashboardCommon.limitNote', { count: MAX_SINGLE_ONLINE_ROWS })}</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Inbound Summary */}
                <div className="card mb-6">
                    <SectionHeader
                        className="dashboard-section-head"
                        title={t('pages.dashboardNode.inboundsTitle')}
                        subtitle={t('pages.dashboardNode.inboundsSubtitle')}
                        meta={<span className="text-sm text-muted">{t('pages.dashboardNode.inboundsCount', { count: inbounds.length })}</span>}
                    />
                    <div className="table-container border-none overflow-x-auto">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{t('pages.dashboardNode.tableRemark')}</th>
                                    <th>{t('pages.dashboardNode.tableProtocol')}</th>
                                    <th className="text-right">{t('pages.dashboardNode.tablePort')}</th>
                                    <th className="text-center">{t('pages.dashboardNode.tableStatus')}</th>
                                    <th className="text-right">{t('pages.dashboardNode.tableUp')}</th>
                                    <th className="text-right">{t('pages.dashboardNode.tableDown')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {inbounds.length === 0 ? (
                                    <tr><td colSpan={6} className="table-empty">{t('pages.dashboardNode.inboundsEmpty')}</td></tr>
                                ) : (
                                    inbounds.slice(0, 10).map((ib) => (
                                        <tr key={ib.id}>
                                            <td data-label={t('pages.dashboardNode.tableRemark')} className="font-medium text-white truncate max-w-[200px]">{ib.remark || '-'}</td>
                                            <td data-label={t('pages.dashboardNode.tableProtocol')}><span className="badge badge-info">{ib.protocol}</span></td>
                                            <td data-label={t('pages.dashboardNode.tablePort')} className="text-right font-mono">{ib.port}</td>
                                            <td data-label={t('pages.dashboardNode.tableStatus')} className="text-center">
                                                <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>{ib.enable ? t('pages.dashboardNode.statusEnabled') : t('pages.dashboardNode.statusDisabled')}</span>
                                            </td>
                                            <td data-label={t('pages.dashboardNode.tableUp')} className="text-right font-mono">
                                                {loading ? <div className="skeleton" style={{ width: '4.5rem', height: '1rem', marginLeft: 'auto' }} /> : formatBytes(ib.up)}
                                            </td>
                                            <td data-label={t('pages.dashboardNode.tableDown')} className="text-right font-mono">
                                                {loading ? <div className="skeleton" style={{ width: '4.5rem', height: '1rem', marginLeft: 'auto' }} /> : formatBytes(ib.down)}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* CPU History Chart */}
                <div className="card mb-6">
                    <SectionHeader
                        className="dashboard-section-head"
                        title={t('pages.dashboardNode.cpuChartTitle')}
                        subtitle={t('pages.dashboardNode.cpuChartSubtitle')}
                    />
                    <div className="w-full dashboard-chart py-5">
                        {loading && cpuHistory.length === 0 ? (
                            <div className="w-full h-full flex flex-col gap-4 px-6">
                                <div className="skeleton w-full h-full opacity-10" />
                            </div>
                        ) : (
                            <ResponsiveContainer>
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
