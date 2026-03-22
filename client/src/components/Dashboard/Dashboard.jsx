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
import ResourceTopologyCard from './ResourceTopologyCard.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { Card, Row, Col, Badge, Empty, Typography, Button, Space, Table, Statistic, List } from 'antd';
const { Title, Text } = Typography;
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { fetchManagedUsers } from '../../utils/managedUsersCache.js';

const AUTO_REFRESH_INTERVAL = 30_000;
const GLOBAL_WS_GRACE_MS = 500;
const MAX_SINGLE_ONLINE_ROWS = 120;
const MAX_GLOBAL_ONLINE_ROWS = 200;
const MAX_NODE_TREND_POINTS = 12;
const INITIAL_GLOBAL_TRAFFIC_TOTALS = {
    totalUp: 0,
    totalDown: 0,
    ready: false,
};
const INITIAL_DAILY_TRAFFIC_TOTALS = {
    totalUp: 0,
    totalDown: 0,
    ready: false,
};
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
            ? (card.renderAnimatedValue ? card.renderAnimatedValue(animatedValue) : `${animatedValue}${card.animateSuffix || ''}`)
            : card.value;

    const handleKeyDown = (event) => {
        if (!clickable) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            card.onClick();
        }
    };

    return (
        <Card
            hoverable={clickable}
            onClick={clickable ? card.onClick : undefined}
            onKeyDown={handleKeyDown}
            tabIndex={clickable ? 0 : undefined}
            style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}
            bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' }}
        >
            {hasHead && (
                <div style={{ marginBottom: 12 }}>
                    {card.label && <Text type="secondary" style={{ display: 'block', fontSize: 13 }}>{card.label}</Text>}
                    {card.kicker && <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{card.kicker}</Text>}
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                <div>
                    {loading ? (
                        <div className="skeleton" style={{ width: card.skeletonWidth || 80, height: 28 }} />
                    ) : (
                        <Title level={3} style={{ margin: 0, color: 'var(--text-primary)' }}>{renderedValue}</Title>
                    )}
                    {card.sub && <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>{card.sub}</Text>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <card.icon style={{ fontSize: 24, color: 'var(--text-muted)' }} />
                    {Array.isArray(card.sparkline) && card.sparkline.length > 1 && (
                        <div style={{ width: 80, height: 24, marginTop: 8 }}>
                            <StatSparkline points={card.sparkline} domain={card.sparklineDomain} />
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}

function QuickActionGrid({ actions = [] }) {
    return (
        <Row gutter={[16, 16]}>
            {actions.map((action) => (
                <Col xs={24} sm={12} md={12} lg={6} key={action.title}>
                    <Card
                        hoverable
                        onClick={action.onClick}
                        style={{ height: '100%', background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}
                        bodyStyle={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                        <div style={{ padding: 12, borderRadius: 8, background: `var(--accent-${action.tone || 'primary'}-muted, rgba(255,255,255,0.05))` }}>
                            <action.icon style={{ fontSize: 24, color: `var(--accent-${action.tone || 'primary'})` }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <Text strong style={{ display: 'block', fontSize: 15 }}>{action.title}</Text>
                            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{action.detail}</Text>
                        </div>
                        <HiOutlineArrowRight style={{ color: 'var(--text-muted)' }} />
                    </Card>
                </Col>
            ))}
        </Row>
    );
}

function OnlineUsersMobileList({ rows = [], showNodes = false, limit, t, keyPrefix = 'online' }) {
    return (
        <List
            itemLayout="horizontal"
            dataSource={rows.slice(0, limit)}
            renderItem={(row, index) => (
                <List.Item>
                    <List.Item.Meta
                        title={<><Text strong>{row.displayName}</Text>{row.email && row.email !== row.displayName && <Text type="secondary" style={{marginLeft:8}}>{row.email}</Text>}</>}
                        description={
                            showNodes && (
                                <Space wrap size={[0, 8]} style={{marginTop:4}}>
                                    {row.nodeLabels.length === 0 ? <Badge count={t('pages.dashboardCommon.unknownNode')} color="default" /> : row.nodeLabels.slice(0, 4).map(lbl => <Badge key={lbl} count={lbl} color="blue" />)}
                                    {row.nodeLabels.length > 4 && <Badge count={`+${row.nodeLabels.length - 4}`} color="default" />}
                                </Space>
                            )
                        }
                    />
                    <div style={{ textAlign: 'right' }}>
                        <Text type="secondary" style={{fontSize:12, display:'block'}}>{t('pages.dashboardCommon.sessions')}</Text>
                        <Badge count={row.sessions} style={{ backgroundColor: '#52c41a' }} />
                    </div>
                </List.Item>
            )}
            footer={rows.length > limit ? <div style={{textAlign:'center'}}><Text type="secondary">{t('pages.dashboardCommon.limitNote', { count: limit })}</Text></div> : null}
        />
    );
}

function InboundSummaryMobileList({ inbounds = [], loading, t }) {
    return (
        <List
            itemLayout="horizontal"
            dataSource={inbounds.slice(0, 10)}
            renderItem={ib => (
                <List.Item>
                    <List.Item.Meta
                        title={ib.remark || '-'}
                        description={<Space><Badge count={ib.protocol} color="blue" /> <Text code>:{ib.port}</Text></Space>}
                    />
                    <div style={{ textAlign: 'right' }}>
                        <Badge color={ib.enable ? 'green' : 'red'} text={ib.enable ? t('pages.dashboardNode.statusEnabled') : t('pages.dashboardNode.statusDisabled')} style={{display:'block', marginBottom:4}} />
                        <Space>
                            <Text type="secondary" style={{fontSize:12}}>Up: {loading ? '-' : formatBytes(ib.up)}</Text>
                            <Text type="secondary" style={{fontSize:12}}>Dn: {loading ? '-' : formatBytes(ib.down)}</Text>
                        </Space>
                    </div>
                </List.Item>
            )}
        />
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

function buildTodayTrafficRange() {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return {
        from: from.toISOString(),
        to: now.toISOString(),
    };
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
    const managedEmailSet = new Set();
    const serverTrafficByServerId = {};

    (Array.isArray(users) ? users : [])
        .filter((user) => user?.role !== 'admin')
        .forEach((user) => {
            const subscriptionEmail = normalizeEmail(user?.subscriptionEmail);
            const loginEmail = normalizeEmail(user?.email);
            if (subscriptionEmail) managedEmailSet.add(subscriptionEmail);
            if (loginEmail) managedEmailSet.add(loginEmail);
        });

    serverPayloads.forEach((payload) => {
        const inbounds = Array.isArray(payload?.inbounds) ? payload.inbounds : [];
        const onlines = Array.isArray(payload?.onlines) ? payload.onlines : [];
        const serverName = String(payload?.serverName || '').trim();
        const serverId = String(payload?.serverId || '').trim();
        const onlineMatchMap = new Map();

        onlines.forEach((entry, index) => {
            normalizeOnlineKeys(entry).forEach((key) => {
                if (!onlineMatchMap.has(key)) {
                    onlineMatchMap.set(key, new Set());
                }
                onlineMatchMap.get(key).add(index);
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
                const matchedOnlineEntries = new Set();
                buildClientOnlineKeys(client, protocol).forEach((key) => {
                    const matches = onlineMatchMap.get(key);
                    if (!matches) return;
                    matches.forEach((matchIndex) => matchedOnlineEntries.add(matchIndex));
                });
                const onlineSessions = matchedOnlineEntries.size;
                entry.count += 1;
                entry.totalUsed += resolveClientUsed(client);
                entry.totalUp += safeNumber(client?.up);
                entry.totalDown += safeNumber(client?.down);
                if (serverId && managedEmailSet.has(email)) {
                    const bucket = serverTrafficByServerId[serverId] || { up: 0, down: 0, total: 0 };
                    bucket.up += safeNumber(client?.up);
                    bucket.down += safeNumber(client?.down);
                    bucket.total += safeNumber(client?.up) + safeNumber(client?.down);
                    serverTrafficByServerId[serverId] = bucket;
                }
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
        serverTrafficByServerId,
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
    const { activeServerId, panelApi, activeServer, servers } = useServer();
    const { token } = useAuth();
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const [wsTicket, setWsTicket] = useState('');
    const lastWsTicketFetchAtRef = useRef(0);

    // Single Server State
    const [status, setStatus] = useState(null);
    const [cpuHistory, setCpuHistory] = useState([]);
    const [inbounds, setInbounds] = useState([]);
    const [onlineCount, setOnlineCount] = useState(0);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [onlineSessionCount, setOnlineSessionCount] = useState(0);
    const [singleServerTrafficTotals, setSingleServerTrafficTotals] = useState({ totalUp: 0, totalDown: 0 });

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
    const [hasLiveClusterSnapshot, setHasLiveClusterSnapshot] = useState(false);
    const [globalPresenceLoading, setGlobalPresenceLoading] = useState(false);
    const [globalPresenceReady, setGlobalPresenceReady] = useState(false);
    const [globalTrafficTotals, setGlobalTrafficTotals] = useState(INITIAL_GLOBAL_TRAFFIC_TOTALS);
    const [dailyTrafficTotals, setDailyTrafficTotals] = useState(INITIAL_DAILY_TRAFFIC_TOTALS);
    const [dbStatus, setDbStatus] = useState(null);

    // Shared State
    const [loading, setLoading] = useState(true);
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
    const syncGlobalTrafficTotals = useCallback((presence) => {
        setGlobalTrafficTotals({
            totalUp: Number(presence?.totalUp || 0),
            totalDown: Number(presence?.totalDown || 0),
            ready: true,
        });
    }, []);
    const fetchDailyTrafficTotals = useCallback(async () => {
        try {
            const range = buildTodayTrafficRange();
            const res = await api.get('/traffic/overview', {
                params: range,
            });
            const totals = res.data?.obj?.totals || {};
            return {
                totalUp: Number(totals.upBytes || 0),
                totalDown: Number(totals.downBytes || 0),
                ready: true,
            };
        } catch {
            return INITIAL_DAILY_TRAFFIC_TOTALS;
        }
    }, []);

    const fetchGlobalAccountSummary = useCallback(async (options = {}) => {
        try {
            const users = await fetchManagedUsers(api, { force: options.forceUsers === true }).catch(() => []);
            const rows = Array.isArray(users) ? users.filter((item) => item?.role !== 'admin') : [];
            setGlobalAccountSummary({
                totalUsers: rows.length,
                pendingUsers: rows.filter((item) => item?.enabled === false).length,
            });
        } catch {
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
        }
    }, []);

    useEffect(() => {
        if (activeServerId !== 'global') {
            setDbStatus(null);
            return undefined;
        }
        let disposed = false;
        const loadDbStatus = async () => {
            try {
                const res = await api.get('/system/db/status');
                if (!disposed) {
                    setDbStatus(res.data?.obj || null);
                }
            } catch {
                if (!disposed) {
                    setDbStatus(null);
                }
            }
        };
        loadDbStatus();
        return () => {
            disposed = true;
        };
    }, [activeServerId]);

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
            totalOnline: previous.totalOnline,
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
                fetchManagedUsers(api).catch(() => []),
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
            const users = Array.isArray(usersRes) ? usersRes : [];
            setInbounds(singleInbounds);

            const presence = buildManagedOnlineSummary(users, [{
                serverId: activeServerId,
                inbounds: singleInbounds,
                onlines: singleOnlines,
                serverName: activeServer?.name || '',
            }]);
            setOnlineUsers(presence.onlineRows);
            setOnlineSessionCount(presence.onlineSessionCount);
            setOnlineCount(presence.onlineRows.length);
            setSingleServerTrafficTotals({
                totalUp: presence.totalUp,
                totalDown: presence.totalDown,
            });
        } catch (err) {
            console.error('Dashboard fetch error:', err);
            setSingleServerTrafficTotals({ totalUp: 0, totalDown: 0 });
        }
        setLoading(false);
    }, [activeServer?.name, activeServerId, panelApi]);

    const fetchGlobalData = useCallback(async () => {
        if (servers.length === 0) {
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
            setGlobalPresenceReady(true);
            setGlobalTrafficTotals({ ...INITIAL_GLOBAL_TRAFFIC_TOTALS, ready: true });
            setDailyTrafficTotals({ ...INITIAL_DAILY_TRAFFIC_TOTALS, ready: true });
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
            const [usersRes, todayTraffic] = await Promise.all([
                fetchManagedUsers(api).catch(() => []),
                fetchDailyTrafficTotals(),
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
                            serverId: server.id,
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
            const users = Array.isArray(usersRes) ? usersRes : [];
            const presence = buildManagedOnlineSummary(
                users,
                Object.values(results).map((item) => ({
                    serverId: item?.serverId || '',
                    inbounds: item?.rawInbounds || [],
                    onlines: item?.rawOnlines || [],
                    serverName: item?.name || '',
                }))
            );
            stats.totalOnline = presence.onlineRows.length;
            stats.totalUp = presence.totalUp;
            stats.totalDown = presence.totalDown;
            syncGlobalTrafficTotals(presence);
            setDailyTrafficTotals(todayTraffic);
            const managedOnlineCountByServer = new Map();
            presence.onlineRows.forEach((row) => {
                row.servers.forEach((serverName) => {
                    managedOnlineCountByServer.set(serverName, (managedOnlineCountByServer.get(serverName) || 0) + 1);
                });
            });
            Object.values(results).forEach((item) => {
                item.managedOnlineCount = managedOnlineCountByServer.get(item?.name || '') || 0;
                item.managedTrafficTotal = Number(presence.serverTrafficByServerId?.[item?.serverId || '']?.total || 0);
                item.managedTrafficReady = true;
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
            setGlobalPresenceReady(true);
        } catch (err) {
            console.error('Global fetch error:', err);
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
            setGlobalPresenceReady(false);
            setGlobalTrafficTotals(INITIAL_GLOBAL_TRAFFIC_TOTALS);
            setDailyTrafficTotals(INITIAL_DAILY_TRAFFIC_TOTALS);
        }
        setLoading(false);
    }, [fetchDailyTrafficTotals, servers, syncGlobalTrafficTotals]);

    const hydrateGlobalPresence = useCallback(async (options = {}) => {
        if (servers.length === 0) {
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalAccountSummary({ totalUsers: 0, pendingUsers: 0 });
            setGlobalPresenceReady(true);
            setGlobalTrafficTotals({ ...INITIAL_GLOBAL_TRAFFIC_TOTALS, ready: true });
            setDailyTrafficTotals({ ...INITIAL_DAILY_TRAFFIC_TOTALS, ready: true });
            return;
        }

        setGlobalPresenceLoading(true);
        try {
            const [users, todayTraffic, serverPayloads] = await Promise.all([
                fetchManagedUsers(api, { force: options.forceUsers === true }).catch(() => []),
                fetchDailyTrafficTotals(),
                Promise.all(
                    servers.map(async (server) => {
                        try {
                            const [inboundsRes, onlineRes] = await Promise.all([
                                api.get(`/panel/${server.id}/panel/api/inbounds/list`),
                                api.post(`/panel/${server.id}/panel/api/inbounds/onlines`).catch(() => ({ data: { obj: [] } })),
                            ]);
                            return {
                                server,
                                inbounds: Array.isArray(inboundsRes.data?.obj) ? inboundsRes.data.obj : [],
                                onlines: Array.isArray(onlineRes.data?.obj) ? onlineRes.data.obj : [],
                            };
                        } catch {
                            return {
                                server,
                                inbounds: [],
                                onlines: [],
                            };
                        }
                    })
                ),
            ]);

            const presence = buildManagedOnlineSummary(
                Array.isArray(users) ? users : [],
                serverPayloads.map((item) => ({
                    serverId: item.server.id,
                    inbounds: item.inbounds,
                    onlines: item.onlines,
                    serverName: item.server.name,
                }))
            );

            setGlobalOnlineUsers(presence.onlineRows);
            setGlobalOnlineSessionCount(presence.onlineSessionCount);
            setGlobalAccountSummary({
                totalUsers: presence.rows.length,
                pendingUsers: presence.pendingCount,
            });
            setGlobalStats((previous) => ({
                ...previous,
                totalOnline: presence.onlineRows.length,
            }));
            setGlobalPresenceReady(true);
            syncGlobalTrafficTotals(presence);
            setDailyTrafficTotals(todayTraffic);
            setServerStatuses((previous) => {
                const next = { ...previous };
                serverPayloads.forEach((item) => {
                    const current = previous?.[item.server.id] || {};
                    next[item.server.id] = withServerRemarkMeta({
                        ...current,
                        serverId: current.serverId || item.server.id,
                        name: current.name || item.server.name,
                        rawInbounds: item.inbounds,
                        rawOnlines: item.onlines,
                        managedTrafficTotal: Number(presence.serverTrafficByServerId?.[item.server.id]?.total || 0),
                        managedTrafficReady: true,
                    }, item.server.name);
                });
                return next;
            });
        } catch (err) {
            console.error('Global presence hydration error:', err);
            setGlobalOnlineUsers([]);
            setGlobalOnlineSessionCount(0);
            setGlobalPresenceReady(false);
            setGlobalTrafficTotals(INITIAL_GLOBAL_TRAFFIC_TOTALS);
            setDailyTrafficTotals(INITIAL_DAILY_TRAFFIC_TOTALS);
        }
        setGlobalPresenceLoading(false);
    }, [fetchDailyTrafficTotals, servers, syncGlobalTrafficTotals]);

    useEffect(() => {
        if (activeServerId === 'global') return;
        setGlobalTrafficTotals(INITIAL_GLOBAL_TRAFFIC_TOTALS);
        setDailyTrafficTotals(INITIAL_DAILY_TRAFFIC_TOTALS);
    }, [activeServerId]);

    useEffect(() => {
        if (activeServerId === 'global') return;
        setGlobalPresenceReady(false);
        setGlobalPresenceLoading(false);
        setGlobalOnlineUsers([]);
        setGlobalOnlineSessionCount(0);
    }, [activeServerId]);

    useEffect(() => {
        setLoading(true);
        if (activeServerId === 'global') {
            fetchGlobalAccountSummary();
            if (hasLiveClusterSnapshot) {
                setLoading(false);
                return;
            }
            const timer = window.setTimeout(() => {
                if (!hasLiveClusterSnapshot) {
                    fetchGlobalData();
                }
            }, GLOBAL_WS_GRACE_MS);
            return () => window.clearTimeout(timer);
        }
        if (activeServerId) {
            setHasLiveClusterSnapshot(false);
            fetchSingleData();
            return;
        }
        setHasLiveClusterSnapshot(false);
        setLoading(false);
    }, [activeServerId, fetchSingleData, fetchGlobalAccountSummary, fetchGlobalData, hasLiveClusterSnapshot, hydrateGlobalPresence]);

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
            return fetchSingleData();
        }
        if (wsStatus === 'connected') {
            const summaryTask = fetchGlobalAccountSummary({ forceUsers: true });
            return Promise.all([
                summaryTask,
                hydrateGlobalPresence({ forceUsers: true }),
            ]);
        }
        return fetchGlobalData();
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
    if (!activeServerId && servers.length === 0 && activeServerId !== 'global') {
        return (
            <>
                <Header
                    title={t('pages.dashboardEmpty.title')}
                />
                
                <div className="page-content page-enter dashboard-page">
                    <Card style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--surface-overlay)', borderColor: 'var(--border-color)', margin: '24px' }}>
                        <Empty
                            image={<HiOutlineServerStack style={{ fontSize: '64px', color: 'var(--text-muted)' }} />}
                            description={
                                <div>
                                    <Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 8 }}>{t('pages.dashboardEmpty.bodyTitle')}</Title>
                                    <Text type="secondary">{t('pages.dashboardEmpty.bodySubtitle')}</Text>
                                </div>
                            }
                        >
                            <Button type="primary" size="large" style={{ marginTop: 16 }} onClick={() => navigate('/servers')}>
                                {t('pages.dashboardEmpty.action')}
                            </Button>
                        </Empty>
                    </Card>
                </div>
            </>
        );
    }

    // ── Global Dashboard ─────────────────────────────────
    if (activeServerId === 'global') {
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
                value: `${globalStats.onlineServers} / ${globalStats.serverCount}`,
                kicker: t('pages.dashboardCommon.onlineTotal'),
                sub: t('pages.dashboardGlobal.inboundSummary', {
                    active: globalStats.activeInbounds,
                    total: globalStats.totalInbounds,
                }),
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
                ...(dailyTrafficTotals.ready ? {
                    animateValue: dailyTrafficTotals.totalUp + dailyTrafficTotals.totalDown,
                    renderAnimatedValue: (value) => formatBytes(value),
                    sub: t('pages.dashboardCommon.trafficSplit', {
                        up: formatBytes(dailyTrafficTotals.totalUp),
                        down: formatBytes(dailyTrafficTotals.totalDown),
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
                icon: HiOutlineChartBarSquare, label: t('pages.dashboardGlobal.cards.cumulativeTraffic'),
                ...(globalTrafficTotals.ready ? {
                    animateValue: globalTrafficTotals.totalUp + globalTrafficTotals.totalDown,
                    renderAnimatedValue: (value) => formatBytes(value),
                    sub: t('pages.dashboardCommon.trafficSplit', {
                        up: formatBytes(globalTrafficTotals.totalUp),
                        down: formatBytes(globalTrafficTotals.totalDown),
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
                    <Button
                        type={autoRefresh ? 'primary' : 'default'}
                        onClick={toggleAutoRefresh}
                        title={autoRefresh ? t('pages.dashboardCommon.autoRefreshOffTitle') : t('pages.dashboardCommon.autoRefreshOnTitle')}
                        icon={<HiOutlineArrowPath className={autoRefresh ? 'spinning' : ''} />}
                        size="small"
                        style={{ display: 'flex', alignItems: 'center' }}
                    >
                        <span className="hidden sm:inline-block ml-1">
                            {autoRefresh ? t('pages.dashboardCommon.autoRefreshOn') : t('pages.dashboardCommon.autoRefreshOff')}
                        </span>
                    </Button>
                </Header>
                <div className="page-content page-enter dashboard-page">
                    <ResourceTopologyCard
                        dbStatus={dbStatus}
                        servers={servers}
                        serverStatuses={serverStatuses}
                        onOpenServers={() => navigate('/servers')}
                    />

                    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                        {globalCards.map((card, index) => (
                            <Col xs={24} sm={12} md={12} lg={8} xl={4} key={`global-card-${index}`} style={{ display: 'flex' }}>
                                <div style={{ flex: 1 }}>
                                    <StatCard card={card} loading={loading} />
                                </div>
                            </Col>
                        ))}
                    </Row>

                    {showOnlineDetail && (
                        <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                                <Col>
                                    <Title level={5} style={{ margin: 0, color: 'var(--text-primary)' }}>{t('pages.dashboardGlobal.onlineDetailTitle')}</Title>
                                </Col>
                                <Col>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {t('pages.dashboardCommon.userSessionSummary', {
                                            users: globalOnlineUsers.length,
                                            sessions: globalOnlineSessionCount,
                                        })}
                                    </Text>
                                </Col>
                            </Row>
                            {globalPresenceLoading && !globalPresenceReady ? (
                                <Empty description={t('pages.dashboardCommon.onlineUsersPending')} />
                            ) : globalOnlineUsers.length === 0 ? (
                                <Empty description={t('pages.dashboardCommon.onlineEmpty')} />
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
                                    <Table 
                                        dataSource={globalOnlineUsers.slice(0, MAX_GLOBAL_ONLINE_ROWS)}
                                        rowKey={row => `global-online-${row.userId || row.label}`}
                                        pagination={false}
                                        size="small"
                                        footer={() => globalOnlineUsers.length > MAX_GLOBAL_ONLINE_ROWS ? <div style={{textAlign: 'center'}}><Text type="secondary">{t('pages.dashboardCommon.limitNote', { count: MAX_GLOBAL_ONLINE_ROWS })}</Text></div> : null}
                                        columns={[
                                            {
                                                title: t('pages.dashboardCommon.userIdentifier'),
                                                key: 'user',
                                                render: (_, row) => (
                                                    <div title={row.email ? `${row.displayName} · ${row.email}` : row.displayName}>
                                                        <Text strong style={{ color: 'var(--text-primary)' }}>{row.displayName}</Text>
                                                        {row.email && row.email !== row.displayName && (
                                                            <div style={{color: 'var(--text-muted)', fontSize: 12}}>{row.email}</div>
                                                        )}
                                                    </div>
                                                )
                                            },
                                            {
                                                title: t('pages.dashboardGlobal.onlineNodes'),
                                                key: 'nodes',
                                                render: (_, row) => (
                                                    <Space wrap size={[0, 8]}>
                                                        {row.nodeLabels.length === 0 ? (
                                                            <Badge count={t('pages.dashboardCommon.unknownNode')} color="default" />
                                                        ) : (
                                                            row.nodeLabels.slice(0, 4).map((nodeLabel) => (
                                                                <Badge key={`${row.userId || row.label}-${nodeLabel}`} count={nodeLabel} color="blue" />
                                                            ))
                                                        )}
                                                        {row.nodeLabels.length > 4 && <Badge count={`+${row.nodeLabels.length - 4}`} color="default" />}
                                                    </Space>
                                                )
                                            },
                                            {
                                                title: t('pages.dashboardCommon.sessions'),
                                                key: 'sessions',
                                                align: 'right',
                                                render: (_, row) => <Badge count={row.sessions} style={{ backgroundColor: '#52c41a' }} />
                                            }
                                        ]}
                                    />
                                )
                            )}
                        </Card>
                    )}

                    <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                        <Title level={5} style={{ margin: 0, marginBottom: 16, color: 'var(--text-primary)' }}>{t('pages.dashboardCommon.quickActionsTitle')}</Title>
                        <QuickActionGrid actions={globalQuickActions} />
                    </Card>

                    {/* 节点健康网格 */}
                    <div style={{ marginBottom: 24 }}>
                        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                            <Col>
                                <Title level={5} style={{ margin: 0, color: 'var(--text-primary)' }}>{t('pages.dashboardGlobal.nodeHealthTitle')}</Title>
                            </Col>
                            <Col>
                                <Text type="secondary" style={{ fontSize: 12 }}>{t('pages.dashboardGlobal.nodeCount', { count: servers.length })}</Text>
                            </Col>
                        </Row>
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
                <Button
                    type={autoRefresh ? 'primary' : 'default'}
                    onClick={toggleAutoRefresh}
                    title={autoRefresh ? t('pages.dashboardCommon.autoRefreshOffTitle') : t('pages.dashboardCommon.autoRefreshOnTitle')}
                    icon={<HiOutlineArrowPath className={autoRefresh ? 'spinning' : ''} />}
                    size="small"
                    style={{ display: 'flex', alignItems: 'center' }}
                >
                    <span className="hidden sm:inline-block ml-1">
                        {autoRefresh ? t('pages.dashboardCommon.autoRefreshOn') : t('pages.dashboardCommon.autoRefreshOff')}
                    </span>
                </Button>
            </Header>
            <div className="page-content page-enter dashboard-page">
                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                    {statCards.map((card, index) => (
                        <Col xs={24} sm={12} md={12} lg={8} xl={4} key={`node-card-${index}`} style={{ display: 'flex' }}>
                            <div style={{ flex: 1 }}>
                                <StatCard card={card} loading={loading} />
                            </div>
                        </Col>
                    ))}
                </Row>

                {showOnlineDetail && (
                    <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                            <Col>
                                <Title level={5} style={{ margin: 0, color: 'var(--text-primary)' }}>{t('pages.dashboardNode.onlineDetailTitle')}</Title>
                            </Col>
                            <Col>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    {t('pages.dashboardCommon.userSessionSummary', { users: onlineUsers.length, sessions: onlineSessionCount })}
                                </Text>
                            </Col>
                        </Row>
                        {onlineUsers.length === 0 ? (
                            <Empty description={t('pages.dashboardCommon.onlineEmpty')} />
                        ) : (
                            isCompactLayout ? (
                                <OnlineUsersMobileList
                                    rows={onlineUsers}
                                    limit={MAX_SINGLE_ONLINE_ROWS}
                                    t={t}
                                    keyPrefix="single-online"
                                />
                            ) : (
                                <Table 
                                    dataSource={onlineUsers.slice(0, MAX_SINGLE_ONLINE_ROWS)}
                                    rowKey={row => `single-online-${row.userId || row.label}`}
                                    pagination={false}
                                    size="small"
                                    footer={() => onlineUsers.length > MAX_SINGLE_ONLINE_ROWS ? <div style={{textAlign: 'center'}}><Text type="secondary">{t('pages.dashboardCommon.limitNote', { count: MAX_SINGLE_ONLINE_ROWS })}</Text></div> : null}
                                    columns={[
                                        {
                                            title: t('pages.dashboardCommon.userIdentifier'),
                                            key: 'user',
                                            render: (_, row) => (
                                                <div title={row.email ? `${row.displayName} · ${row.email}` : row.displayName}>
                                                    <Text strong style={{ color: 'var(--text-primary)' }}>{row.displayName}</Text>
                                                    {row.email && row.email !== row.displayName && (
                                                        <div style={{color: 'var(--text-muted)', fontSize: 12}}>{row.email}</div>
                                                    )}
                                                </div>
                                            )
                                        },
                                        {
                                            title: t('pages.dashboardCommon.sessions'),
                                            key: 'sessions',
                                            align: 'right',
                                            render: (_, row) => <Badge count={row.sessions} style={{ backgroundColor: '#52c41a' }} />
                                        }
                                    ]}
                                />
                            )
                        )}
                    </Card>
                )}

                <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                    <Title level={5} style={{ margin: 0, marginBottom: 16, color: 'var(--text-primary)' }}>{t('pages.dashboardCommon.quickActionsTitle')}</Title>
                    <QuickActionGrid actions={singleQuickActions} />
                </Card>

                {/* Inbound Summary */}
                <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                        <Col>
                            <Title level={5} style={{ margin: 0, color: 'var(--text-primary)' }}>{t('pages.dashboardNode.inboundsTitle')}</Title>
                        </Col>
                        <Col>
                            <Text type="secondary" style={{ fontSize: 12 }}>{t('pages.dashboardNode.inboundsCount', { count: inbounds.length })}</Text>
                        </Col>
                    </Row>
                    {inbounds.length === 0 ? (
                        <Empty description={t('pages.dashboardNode.inboundsEmptySubtitle')} />
                    ) : isCompactLayout ? (
                        <InboundSummaryMobileList inbounds={inbounds} loading={loading} t={t} />
                    ) : (
                        <Table 
                            dataSource={inbounds.slice(0, 10)}
                            rowKey="id"
                            pagination={false}
                            size="small"
                            columns={[
                                {
                                    title: t('pages.dashboardNode.tableRemark'),
                                    dataIndex: 'remark',
                                    render: (text) => <Text strong style={{ color: 'var(--text-primary)' }}>{text || '-'}</Text>
                                },
                                {
                                    title: t('pages.dashboardNode.tableProtocol'),
                                    dataIndex: 'protocol',
                                    align: 'center',
                                    render: (text) => <Badge count={text} color="blue" />
                                },
                                {
                                    title: t('pages.dashboardNode.tablePort'),
                                    dataIndex: 'port',
                                    align: 'right',
                                    render: (text) => <Text code>{text}</Text>
                                },
                                {
                                    title: t('pages.dashboardNode.tableStatus'),
                                    key: 'status',
                                    align: 'center',
                                    render: (_, row) => <Badge color={row.enable ? 'green' : 'red'} text={row.enable ? t('pages.dashboardNode.statusEnabled') : t('pages.dashboardNode.statusDisabled')} />
                                },
                                {
                                    title: t('pages.dashboardNode.tableUp'),
                                    key: 'up',
                                    align: 'right',
                                    render: (_, row) => loading ? <div className="skeleton" style={{ width: 60, height: 16, marginLeft: 'auto' }} /> : <Text code>{formatBytes(row.up)}</Text>
                                },
                                {
                                    title: t('pages.dashboardNode.tableDown'),
                                    key: 'down',
                                    align: 'right',
                                    render: (_, row) => loading ? <div className="skeleton" style={{ width: 60, height: 16, marginLeft: 'auto' }} /> : <Text code>{formatBytes(row.down)}</Text>
                                }
                            ]}
                        />
                    )}
                </Card>

                {/* CPU History Chart */}
                <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                    <Title level={5} style={{ margin: 0, marginBottom: 16, color: 'var(--text-primary)' }}>{t('pages.dashboardNode.cpuChartTitle')}</Title>
                    <div style={{ width: '100%', height: 300 }}>
                        {loading && cpuHistory.length === 0 ? (
                            <div className="skeleton" style={{ width: '100%', height: '100%', opacity: 0.1 }} />
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
                </Card>
            </div>
        </>
    );
}
