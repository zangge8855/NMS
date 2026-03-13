import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { formatBytes, formatUptime } from '../../utils/format.js';
import useWebSocket from '../../hooks/useWebSocket.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { getClientIdentifier, normalizeEmail } from '../../utils/protocol.js';
import { mergeInboundClientStats, resolveClientUsed, safeNumber } from '../../utils/inboundClients.js';
import {
    HiOutlineCpuChip,
    HiOutlineCircleStack,
    HiOutlineArrowsUpDown,
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
                <div className="dashboard-stat-card-primary">
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

function normalizeOnlineValue(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeOnlineKeys(item) {
    if (typeof item === 'string') {
        const value = normalizeOnlineValue(item);
        return value ? [value] : [];
    }
    if (!item || typeof item !== 'object') {
        return [];
    }
    return Array.from(new Set(
        [
            item.email,
            item.user,
            item.username,
            item.clientEmail,
            item.client,
            item.remark,
            item.id,
            item.password,
        ]
            .map((value) => normalizeOnlineValue(value))
            .filter(Boolean)
    ));
}

function buildClientOnlineKeys(client, protocol) {
    const keys = new Set();
    const email = normalizeOnlineValue(client?.email);
    const identifier = normalizeOnlineValue(getClientIdentifier(client, protocol));
    const id = normalizeOnlineValue(client?.id);
    const password = normalizeOnlineValue(client?.password);

    if (email) keys.add(email);
    if (identifier) keys.add(identifier);
    if (id) keys.add(id);
    if (password) keys.add(password);

    return Array.from(keys);
}

function buildManagedOnlineSummary(users, serverPayloads = []) {
    const clientsMap = new Map();
    const onlineMap = new Map();
    const onlineServerMap = new Map();

    serverPayloads.forEach((payload) => {
        const inbounds = Array.isArray(payload?.inbounds) ? payload.inbounds : [];
        const onlines = Array.isArray(payload?.onlines) ? payload.onlines : [];
        const serverName = String(payload?.serverName || '').trim();
        const onlineCounter = new Map();

        onlines.forEach((entry) => {
            normalizeOnlineKeys(entry).forEach((key) => {
                onlineCounter.set(key, (onlineCounter.get(key) || 0) + 1);
            });
            const email = normalizeEmail(entry?.email || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry?.remark || entry);
            if (email) {
                onlineMap.set(email, (onlineMap.get(email) || 0) + 1);
                if (!onlineServerMap.has(email)) {
                    onlineServerMap.set(email, new Set());
                }
                if (serverName) {
                    onlineServerMap.get(email).add(serverName);
                }
            }
        });

        inbounds.forEach((inbound) => {
            const protocol = String(inbound?.protocol || '').toLowerCase();
            if (!['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) return;
            if (inbound?.enable === false) return;

            const clients = mergeInboundClientStats(inbound);
            clients.forEach((client) => {
                const email = normalizeEmail(client?.email);
                if (!email) return;
                if (!clientsMap.has(email)) {
                    clientsMap.set(email, {
                        count: 0,
                        totalUsed: 0,
                        totalUp: 0,
                        totalDown: 0,
                        onlineSessions: 0,
                        servers: new Set(),
                        nodeLabels: new Set(),
                    });
                }
                const entry = clientsMap.get(email);
                const onlineSessions = buildClientOnlineKeys(client, protocol).reduce((total, key) => (
                    total + (onlineCounter.get(key) || 0)
                ), 0);
                entry.count += 1;
                entry.totalUsed += resolveClientUsed(client);
                entry.totalUp += safeNumber(client?.up);
                entry.totalDown += safeNumber(client?.down);
                entry.onlineSessions += onlineSessions;
                if (onlineSessions > 0 && serverName) {
                    entry.servers.add(serverName);
                }
                if (onlineSessions > 0) {
                    const nodeLabel = String(inbound?.remark || '').trim() || serverName;
                    if (nodeLabel) {
                        entry.nodeLabels.add(nodeLabel);
                    }
                }
            });
        });
    });

    const rows = (Array.isArray(users) ? users : [])
        .filter((user) => user?.role !== 'admin')
        .map((user) => {
            const subscriptionEmail = normalizeEmail(user?.subscriptionEmail);
            const loginEmail = normalizeEmail(user?.email);
            const username = String(user?.username || '').trim();
            const resolvedEmail = subscriptionEmail || loginEmail || '';
            const clientData = clientsMap.get(subscriptionEmail) || clientsMap.get(loginEmail) || { count: 0, onlineSessions: 0, servers: new Set() };
            const sessions = clientData.onlineSessions || onlineMap.get(subscriptionEmail) || onlineMap.get(loginEmail) || 0;
            const matchedServers = clientData.servers?.size
                ? Array.from(clientData.servers)
                : Array.from(onlineServerMap.get(subscriptionEmail) || onlineServerMap.get(loginEmail) || []);
            const matchedNodes = clientData.nodeLabels?.size
                ? Array.from(clientData.nodeLabels)
                : matchedServers;
            const displayName = username || resolvedEmail || user?.id || '-';
            return {
                userId: user?.id,
                username,
                email: resolvedEmail,
                displayName,
                label: resolvedEmail || displayName,
                sessions,
                clientData,
                clientCount: clientData.count || 0,
                enabled: user?.enabled !== false,
                servers: matchedServers,
                nodeLabels: matchedNodes,
            };
        })
        .sort((left, right) => {
            if (right.sessions !== left.sessions) return right.sessions - left.sessions;
            return String(left.displayName || left.label || '').localeCompare(String(right.displayName || right.label || ''));
        });

    const totalUp = rows.reduce((sum, row) => sum + Number(row?.clientData?.totalUp || 0), 0);
    const totalDown = rows.reduce((sum, row) => sum + Number(row?.clientData?.totalDown || 0), 0);

    return {
        rows,
        onlineRows: rows.filter((row) => row.sessions > 0),
        onlineSessionCount: rows.reduce((sum, row) => sum + Number(row.sessions || 0), 0),
        pendingCount: rows.filter((row) => row.enabled === false && row.clientCount === 0).length,
        totalUp,
        totalDown,
        totalUsed: totalUp + totalDown,
    };
}

function collectServerInboundRemarks(inbounds = [], serverName = '') {
    const enabledRemarks = [];
    const fallbackRemarks = [];
    const seen = new Set();
    const normalizedServerName = String(serverName || '').trim().toLowerCase();

    const pushRemark = (list, remark) => {
        const text = String(remark || '').trim();
        if (!text) return;
        const normalized = text.toLowerCase();
        if (normalized === normalizedServerName) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        list.push(text);
    };

    (Array.isArray(inbounds) ? inbounds : []).forEach((inbound) => {
        const remark = String(inbound?.remark || '').trim();
        if (!remark) return;
        if (inbound?.enable === false) {
            pushRemark(fallbackRemarks, remark);
            return;
        }
        pushRemark(enabledRemarks, remark);
    });

    return enabledRemarks.length > 0 ? enabledRemarks : fallbackRemarks;
}

function withServerRemarkMeta(serverData, serverName = '') {
    const nodeRemarks = collectServerInboundRemarks(serverData?.rawInbounds || [], serverName);
    return {
        ...serverData,
        nodeRemarks,
        nodeRemarkPreview: nodeRemarks.slice(0, 2),
        nodeRemarkCount: nodeRemarks.length,
    };
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

// ── WebSocket URL builder ────────────────────────────────
function getWsUrl(ticket) {
    if (!ticket) return null;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = String(import.meta.env.VITE_WS_HOST || '').trim() || window.location.host;
    return `${proto}://${host}/ws?ticket=${encodeURIComponent(ticket)}`;
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
    const [onlineSessionCount, setOnlineSessionCount] = useState(0);

    // Global State
    const [globalStats, setGlobalStats] = useState({
        totalUp: 0, totalDown: 0, totalOnline: 0,
        totalInbounds: 0, activeInbounds: 0,
        serverCount: 0, onlineServers: 0,
    });
    const [serverStatuses, setServerStatuses] = useState({});
    const [serverTrendHistory, setServerTrendHistory] = useState({});
    const [globalOnlineUsers, setGlobalOnlineUsers] = useState([]);
    const [globalOnlineSessionCount, setGlobalOnlineSessionCount] = useState(0);
    const [globalAccountSummary, setGlobalAccountSummary] = useState({ totalUsers: 0, pendingUsers: 0 });

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
        setServerStatuses((previous) => {
            const next = {};
            Object.entries(statusMap).forEach(([serverId, serverData]) => {
                next[serverId] = {
                    ...serverData,
                    managedOnlineCount: previous?.[serverId]?.managedOnlineCount ?? 0,
                    nodeRemarks: previous?.[serverId]?.nodeRemarks || [],
                    nodeRemarkPreview: previous?.[serverId]?.nodeRemarkPreview || [],
                    nodeRemarkCount: previous?.[serverId]?.nodeRemarkCount || 0,
                };
            });
            return next;
        });
        setServerTrendHistory((previous) => pushServerTrendSamples(previous, statusMap));
        setGlobalStats((previous) => ({
            totalUp: previous.totalUp || 0,
            totalDown: previous.totalDown || 0,
            totalOnline: previous.totalOnline || 0,
            totalInbounds,
            activeInbounds,
            serverCount: data.serverCount || 0,
            onlineServers: data.onlineServers || 0,
        }));
        setLoading(false);
    }, [lastMessage, activeServerId]);

    // ── REST Fetchers (fallback / single server) ─────────
    const fetchSingleData = useCallback(async () => {
        if (!activeServerId || activeServerId === 'global') return;
        try {
            const [statusRes, cpuRes, inboundsRes, onlineRes, usersRes] = await Promise.all([
                panelApi('get', '/panel/api/server/status'),
                panelApi('get', '/panel/api/server/cpuHistory/30'),
                panelApi('get', '/panel/api/inbounds/list'),
                panelApi('post', '/panel/api/inbounds/onlines').catch(() => ({ data: { obj: [] } })),
                api.get('/auth/users').catch(() => ({ data: { obj: [] } })),
            ]);
            if (statusRes.data?.obj) setStatus(statusRes.data.obj);
            if (cpuRes.data?.obj) {
                setCpuHistory(cpuRes.data.obj.map((p, i) => ({
                    time: i,
                    cpu: typeof p === 'number' ? p : p?.cpu || 0,
                })));
            }
            const singleInbounds = Array.isArray(inboundsRes.data?.obj) ? inboundsRes.data.obj : [];
            const singleOnlines = Array.isArray(onlineRes.data?.obj) ? onlineRes.data.obj : [];
            const users = Array.isArray(usersRes.data?.obj) ? usersRes.data.obj : [];
            setInbounds(singleInbounds);

            const presence = buildManagedOnlineSummary(users, [{
                inbounds: singleInbounds,
                onlines: singleOnlines,
                serverName: activeServer?.name || '',
            }]);
            setOnlineUsers(presence.onlineRows);
            setOnlineSessionCount(presence.onlineSessionCount);
            setOnlineCount(presence.onlineRows.length);
        } catch (err) {
            console.error('Dashboard fetch error:', err);
        }
        setLoading(false);
    }, [activeServer?.name, activeServerId, panelApi]);

    const fetchGlobalData = useCallback(async () => {
        if (servers.length === 0) {
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
            setLoading(false);
            return;
        }
        try {
            const results = {};
            let stats = {
                totalUp: 0, totalDown: 0, totalOnline: 0,
                totalInbounds: 0, activeInbounds: 0,
                serverCount: servers.length, onlineServers: 0,
            };
            const [usersRes] = await Promise.all([
                api.get('/auth/users').catch(() => ({ data: { obj: [] } })),
                ...servers.map(async (server) => {
                    try {
                        const [statusRes, inboundsRes, onlineRes] = await Promise.all([
                            api.get(`/panel/${server.id}/panel/api/server/status`),
                            api.get(`/panel/${server.id}/panel/api/inbounds/list`),
                            api.post(`/panel/${server.id}/panel/api/inbounds/onlines`),
                        ]);
                        const sStatus = statusRes.data.obj;
                        const sInbounds = inboundsRes.data.obj || [];
                        const sOnlines = normalizeOnlineList(onlineRes.data?.obj || [], server.name);

                        results[server.id] = withServerRemarkMeta({
                            online: true, status: sStatus, name: server.name,
                            inboundCount: sInbounds.length, onlineCount: sOnlines.length,
                            onlineUsers: sOnlines,
                            activeInbounds: sInbounds.filter(i => i.enable).length,
                            rawInbounds: sInbounds,
                            rawOnlines: Array.isArray(onlineRes.data?.obj) ? onlineRes.data.obj : [],
                        }, server.name);
                        stats.onlineServers++;
                        stats.totalInbounds += results[server.id].inboundCount;
                        stats.activeInbounds += results[server.id].activeInbounds;
                    } catch (err) {
                        results[server.id] = { online: false, error: err.message };
                    }
                }),
            ]);
            const users = Array.isArray(usersRes.data?.obj) ? usersRes.data.obj : [];
            const presence = buildManagedOnlineSummary(
                users,
                Object.values(results).map((item) => ({
                    inbounds: item?.rawInbounds || [],
                    onlines: item?.rawOnlines || [],
                    serverName: item?.name || '',
                }))
            );
            stats.totalOnline = presence.onlineRows.length;
            stats.totalUp = presence.totalUp;
            stats.totalDown = presence.totalDown;
            const managedOnlineCountByServer = new Map();
            presence.onlineRows.forEach((row) => {
                row.servers.forEach((serverName) => {
                    managedOnlineCountByServer.set(serverName, (managedOnlineCountByServer.get(serverName) || 0) + 1);
                });
            });
            Object.values(results).forEach((item) => {
                item.managedOnlineCount = managedOnlineCountByServer.get(item?.name || '') || 0;
            });

            setServerStatuses(results);
            setServerTrendHistory((previous) => pushServerTrendSamples(previous, results));
            setGlobalStats(stats);
            setGlobalOnlineUsers(presence.onlineRows);
            setGlobalOnlineSessionCount(presence.onlineSessionCount);
            setGlobalAccountSummary({
                totalUsers: presence.rows.length,
                pendingUsers: presence.pendingCount,
            });
        } catch (err) {
            console.error('Global fetch error:', err);
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
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
            // Keep polling even in global view so user-level online counts stay aligned with UsersHub.
            if (activeServerId === 'global') {
                fetchGlobalData();
            } else if (activeServerId) {
                fetchSingleData();
            }
        }, AUTO_REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [activeServerId, fetchSingleData, fetchGlobalData, autoRefresh]);

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
                sub: globalAccountSummary.totalUsers > 0
                    ? (locale === 'en-US'
                        ? `Users ${globalAccountSummary.totalUsers} · Pending ${globalAccountSummary.pendingUsers}`
                        : `总用户 ${globalAccountSummary.totalUsers} · 待审核 ${globalAccountSummary.pendingUsers}`)
                    : (showOnlineDetail ? t('pages.dashboardCommon.hideDetail') : t('pages.dashboardCommon.showDetail')),
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
                detail: `${globalStats.activeInbounds} / ${globalStats.totalInbounds} 已启用`,
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
                    subtitle={`${t('pages.dashboardGlobal.subtitle')} · ${t('pages.dashboardGlobal.nodeCount', { count: servers.length })}`}
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
                <div className="page-content page-enter">
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
                                            users: globalOnlineUsers.length,
                                            sessions: globalOnlineSessionCount,
                                        })}
                                    </span>
                                )}
                            />
                            {globalOnlineUsers.length === 0 ? (
                                <EmptyState
                                    title={t('pages.dashboardCommon.onlineEmpty')}
                                    size="compact"
                                    hideIcon
                                />
                            ) : (
                                <div className="table-container table-scroll table-scroll-lg overflow-x-auto">
                                    <table className="table dashboard-online-table">
                                        <thead>
                                            <tr>
                                                <th>{t('pages.dashboardCommon.userIdentifier')}</th>
                                                <th>{t('pages.dashboardGlobal.onlineNodes')}</th>
                                                <th className="text-right">{t('pages.dashboardCommon.sessions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {globalOnlineUsers.slice(0, MAX_GLOBAL_ONLINE_ROWS).map((row) => (
                                                <tr key={`global-online-${row.userId || row.label}`}>
                                                    <td data-label={t('pages.dashboardCommon.userIdentifier')} className="dashboard-online-label-cell">
                                                        <div className="dashboard-online-label" title={row.email ? `${row.displayName} · ${row.email}` : row.displayName}>
                                                            <div className="dashboard-online-name text-white font-medium">{row.displayName}</div>
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
                                                    <td data-label={t('pages.dashboardCommon.sessions')} className="text-right font-mono dashboard-online-sessions-cell"><span className="badge badge-success">{row.sessions}</span></td>
                                                </tr>
                                            ))}
                                            {globalOnlineUsers.length > MAX_GLOBAL_ONLINE_ROWS && (
                                                <tr><td colSpan={3} className="table-note">{t('pages.dashboardCommon.limitNote', { count: MAX_GLOBAL_ONLINE_ROWS })}</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="card mb-6">
                        <SectionHeader
                            className="dashboard-section-head"
                            title={locale === 'en-US' ? 'Quick Actions' : '运维捷径'}
                            subtitle={locale === 'en-US' ? 'Keep the most common troubleshooting entries on the dashboard.' : '把最常用的排查入口收在仪表盘里，减少来回切页。'}
                        />
                        <QuickActionGrid actions={globalQuickActions} />
                    </div>

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
            detail: `${activeInbounds} / ${inbounds.length} 已启用`,
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
                subtitle={status
                    ? `${t('pages.dashboardNode.inboundsCount', { count: inbounds.length })} · ${t('pages.dashboardNode.cards.runtime')}: ${formatUptime(status.uptime, locale)}`
                    : t('pages.dashboardNode.inboundsCount', { count: inbounds.length })}
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
            <div className="page-content page-enter">
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
                            meta={<span className="text-sm text-muted">{t('pages.dashboardCommon.userSessionSummary', { users: onlineUsers.length, sessions: onlineSessionCount })}</span>}
                        />
                        {onlineUsers.length === 0 ? (
                            <EmptyState
                                title={t('pages.dashboardCommon.onlineEmpty')}
                                size="compact"
                                hideIcon
                            />
                        ) : (
                            <div className="table-container table-scroll table-scroll-md overflow-x-auto">
                                <table className="table dashboard-online-table">
                                    <thead><tr><th>{t('pages.dashboardCommon.userIdentifier')}</th><th className="text-right">{t('pages.dashboardCommon.sessions')}</th></tr></thead>
                                    <tbody>
                                            {onlineUsers.slice(0, MAX_SINGLE_ONLINE_ROWS).map((row) => (
                                                <tr key={`single-online-${row.userId || row.label}`}>
                                                    <td data-label={t('pages.dashboardCommon.userIdentifier')} className="dashboard-online-label-cell">
                                                        <div className="dashboard-online-label" title={row.email ? `${row.displayName} · ${row.email}` : row.displayName}>
                                                            <div className="dashboard-online-name text-white font-medium">{row.displayName}</div>
                                                            {row.email && row.email !== row.displayName && (
                                                                <div className="dashboard-online-email">{row.email}</div>
                                                            )}
                                                        </div>
                                                    </td>
                                                <td data-label={t('pages.dashboardCommon.sessions')} className="text-right font-mono dashboard-online-sessions-cell"><span className="badge badge-success">{row.sessions}</span></td>
                                            </tr>
                                        ))}
                                        {onlineUsers.length > MAX_SINGLE_ONLINE_ROWS && (
                                            <tr><td colSpan={2} className="table-note">{t('pages.dashboardCommon.limitNote', { count: MAX_SINGLE_ONLINE_ROWS })}</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                <div className="card mb-6">
                    <SectionHeader
                        className="dashboard-section-head"
                        title={locale === 'en-US' ? 'Quick Actions' : '运维捷径'}
                        subtitle={locale === 'en-US' ? 'The most common actions and troubleshooting entries for this node.' : '围绕当前节点最常用的操作和排查入口。'}
                    />
                    <QuickActionGrid actions={singleQuickActions} />
                </div>

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
