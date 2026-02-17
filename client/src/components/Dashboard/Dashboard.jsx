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
    HiOutlineClock,
    HiOutlineUsers,
    HiOutlineSignal,
    HiOutlineArrowPath,
    HiOutlineServerStack,
    HiOutlineCloud,
    HiOutlineBolt,
} from 'react-icons/hi2';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useMouseMove } from '../../hooks/useMouseMove.js';

const AUTO_REFRESH_INTERVAL = 30_000;
const MAX_SINGLE_ONLINE_ROWS = 120;
const MAX_GLOBAL_ONLINE_ROWS = 200;
const DASHBOARD_ACCENT = {
    primary: { color: 'var(--accent-primary)', bg: 'var(--accent-primary-bg)' },
    info: { color: 'var(--accent-info)', bg: 'var(--accent-info-bg)' },
    warning: { color: 'var(--accent-warning)', bg: 'var(--accent-warning-bg)' },
    success: { color: 'var(--accent-success)', bg: 'var(--accent-success-bg)' },
};

function StatCard({ card, loading }) {
    const ref = useMouseMove();
    const clickable = typeof card.onClick === 'function';

    return (
        <div
            ref={ref}
            className={`card spotlight hover-lift relative overflow-hidden${clickable ? ' cursor-pointer' : ''}`}
            style={{
                '--mouse-x': '50%',
                '--mouse-y': '50%'
            }}
            onClick={clickable ? card.onClick : undefined}
        >
            <div className="card-header border-none pb-0">
                <span className="card-title text-muted text-xs uppercase tracking-wider">
                    {card.label}
                </span>
                <div
                    className="card-icon shadow-lg"
                    style={{
                        background: card.bg,
                        color: card.color,
                        boxShadow: `0 0 10px ${card.bg}` // Keep dynamic shadow inline for now or use tailored classes if possible
                    }}
                >
                    <card.icon />
                </div>
            </div>
            <div className="px-6 pb-6 pt-1">
                <div className="card-value text-glow text-2xl font-bold my-1">
                    {loading ? (
                        <div className="skeleton w-24 h-8 mt-1" />
                    ) : (
                        card.value
                    )}
                </div>
                {card.sub && (
                    <div className="card-subtitle text-muted text-xs">
                        {card.sub}
                    </div>
                )}
            </div>
            {/* Ambient Background Glow */}
            <div
                className="absolute -bottom-5 -right-5 w-24 h-24 rounded-full opacity-20 blur-xl pointer-events-none"
                style={{ background: card.bg }}
            />
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

// ── WebSocket URL builder ────────────────────────────────
function getWsUrl(ticket) {
    if (!ticket) return null;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = String(import.meta.env.VITE_WS_HOST || '').trim() || window.location.host;
    return `${proto}://${host}/ws?ticket=${encodeURIComponent(ticket)}`;
}

// ── Connection Status Indicator ──────────────────────────
function WsStatusDot({ status }) {
    const colors = {
        connected: 'var(--accent-success)',
        connecting: 'var(--accent-warning)',
        reconnecting: 'var(--accent-warning)',
        disconnected: 'var(--accent-danger)',
    };
    const labels = {
        connected: '实时连接',
        connecting: '连接中...',
        reconnecting: '重连中...',
        disconnected: '已断开',
    };
    const color = colors[status] || 'var(--text-muted)';
    return (
        <div className="flex items-center gap-4" title={labels[status] || '未知'}>
            <HiOutlineBolt style={{ color, fontSize: '14px' }} />
            <span className="text-sm" style={{ color, fontSize: '11px' }}>
                {labels[status] || ''}
            </span>
        </div>
    );
}

export default function Dashboard() {
    const { activeServerId, panelApi, activeServer, servers } = useServer();
    const { token } = useAuth();
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
    const [globalOnlineUsers, setGlobalOnlineUsers] = useState([]);

    // Shared State
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [showOnlineDetail, setShowOnlineDetail] = useState(false);

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
    const onlineUserRows = useMemo(() => summarizeOnlineUsers(onlineUsers), [onlineUsers]);
    const globalOnlineUserRows = useMemo(() => summarizeOnlineUsers(globalOnlineUsers), [globalOnlineUsers]);

    // Empty State
    if (!activeServerId && servers.length === 0 && activeServerId !== 'global') {
        return (
            <>
                <Header title="仪表盘" />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineServerStack style={{ fontSize: '48px' }} /></div>
                        <div className="empty-state-text">请先添加并选择一台服务器</div>
                        <div className="empty-state-sub">在左侧导航的"服务器管理"中添加您的 3x-ui 面板</div>
                    </div>
                </div>
            </>
        );
    }

    // ── Global Dashboard ─────────────────────────────────
    if (activeServerId === 'global') {
        const globalCards = [
            {
                icon: HiOutlineServerStack, label: '节点状态',
                value: `${globalStats.onlineServers} / ${globalStats.serverCount}`,
                sub: '在线 / 总计', ...DASHBOARD_ACCENT.primary,
            },
            {
                icon: HiOutlineUsers, label: '总在线用户',
                value: String(globalStats.totalOnline),
                sub: showOnlineDetail ? '点击收起明细' : '点击查看明细',
                onClick: () => setShowOnlineDetail((v) => !v),
                ...DASHBOARD_ACCENT.info,
            },
            {
                icon: HiOutlineSignal, label: '总入站规则',
                value: `${globalStats.activeInbounds} / ${globalStats.totalInbounds}`,
                sub: '启用 / 总计', ...DASHBOARD_ACCENT.warning,
            },
            {
                icon: HiOutlineArrowsUpDown, label: '集群总流量',
                value: formatBytes(globalStats.totalUp + globalStats.totalDown),
                sub: `↑ ${formatBytes(globalStats.totalUp)}  ↓ ${formatBytes(globalStats.totalDown)}`,
                ...DASHBOARD_ACCENT.primary,
            },
        ];

        return (
            <>
                <Header title="集群仪表盘" icon={<HiOutlineCloud />} />
                <div className="page-content page-enter">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-12">
                            <div className="text-sm text-muted">集群概览</div>
                            <WsStatusDot status={wsStatus} />
                        </div>
                        <div className="flex items-center gap-8">
                            <button className="btn btn-secondary btn-sm" onClick={refresh} title="手动刷新">
                                <HiOutlineArrowPath style={{ fontSize: '14px' }} /> 刷新
                            </button>
                            <button
                                className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setAutoRefresh(p => !p)}
                                title={autoRefresh ? '关闭自动刷新 (30s)' : '开启自动刷新 (30s)'}
                            >
                                <HiOutlineArrowPath className={autoRefresh ? 'spinning' : ''} style={{ fontSize: '14px' }} />
                                {autoRefresh ? '自动 ON' : '自动 OFF'}
                            </button>
                        </div>
                    </div>

                    <div className="stats-grid mb-8">
                        {globalCards.map((card, idx) => (
                            <StatCard key={idx} card={card} loading={loading} />
                        ))}
                    </div>

                    {showOnlineDetail && (
                        <div className="card mb-6">
                            <div className="card-header">
                                <span className="card-title">在线用户明细</span>
                                <span className="text-sm text-muted">
                                    {globalOnlineUserRows.length} 用户 / {globalOnlineUsers.length} 会话
                                </span>
                            </div>
                            {globalOnlineUserRows.length === 0 ? (
                                <div className="empty-state empty-state-compact">
                                    <div className="empty-state-text">当前没有在线用户</div>
                                </div>
                            ) : (
                                <div className="table-container table-scroll table-scroll-lg">
                                    <table className="table">
                                        <thead>
                                            <tr><th>邮箱 / 标识</th><th>在线节点</th><th>会话数</th></tr>
                                        </thead>
                                        <tbody>
                                            {globalOnlineUserRows.slice(0, MAX_GLOBAL_ONLINE_ROWS).map((row) => (
                                                <tr key={`global-online-${row.email}`}>
                                                    <td data-label="邮箱 / 标识" className="text-white font-medium">{row.email}</td>
                                                    <td data-label="在线节点">
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {row.servers.length === 0 ? (
                                                                <span className="badge badge-neutral">未知节点</span>
                                                            ) : (
                                                                row.servers.slice(0, 4).map((sn) => (
                                                                    <span key={`${row.email}-${sn}`} className="badge badge-info">{sn}</span>
                                                                ))
                                                            )}
                                                            {row.servers.length > 4 && <span className="badge badge-neutral">+{row.servers.length - 4}</span>}
                                                        </div>
                                                    </td>
                                                    <td data-label="会话数"><span className="badge badge-success">{row.sessions}</span></td>
                                                </tr>
                                            ))}
                                            {globalOnlineUserRows.length > MAX_GLOBAL_ONLINE_ROWS && (
                                                <tr><td colSpan={3} className="table-note">仅展示前 {MAX_GLOBAL_ONLINE_ROWS} 条</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">节点监控</span>
                            <span className="text-sm text-muted">{servers.length} 个节点</span>
                        </div>
                        <div className="table-container border-none">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>节点名称</th><th>状态</th><th>地址</th>
                                        <th>CPU</th><th>内存</th><th>在线</th><th>流量</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {servers.map(server => {
                                        const s = serverStatuses[server.id];
                                        return (
                                            <tr key={server.id}>
                                                <td data-label="节点名称" className="font-medium text-white">{server.name}</td>
                                                <td data-label="状态">
                                                    {s?.online ?
                                                        <span className="badge badge-success">运行中</span> :
                                                        <span className="badge badge-danger">离线</span>
                                                    }
                                                </td>
                                                <td data-label="地址" className="text-muted">{server.url}</td>
                                                <td data-label="CPU">
                                                    {loading ? <div className="skeleton w-12 h-4" /> :
                                                        (s?.online ? `${(s.status?.cpu ?? 0).toFixed(1)}%` : '--')
                                                    }
                                                </td>
                                                <td data-label="内存">
                                                    {loading ? <div className="skeleton w-12 h-4" /> :
                                                        (s?.online && s.status?.mem ? `${((s.status.mem.current / s.status.mem.total) * 100).toFixed(1)}%` : '--')
                                                    }
                                                </td>
                                                <td data-label="在线">
                                                    {loading ? <div className="skeleton w-8 h-4" /> :
                                                        (s?.online ? s.onlineCount : '--')
                                                    }
                                                </td>
                                                <td data-label="流量">
                                                    {loading ? <div className="skeleton w-16 h-4" /> :
                                                        (s?.online ? `${formatBytes((s.up || 0) + (s.down || 0))}` : '--')
                                                    }
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
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
        { icon: HiOutlineCpuChip, label: 'CPU 使用率', value: status ? `${status.cpu.toFixed(1)}%` : '--', ...DASHBOARD_ACCENT.primary },
        { icon: HiOutlineCircleStack, label: '内存使用', value: status ? `${((status.mem.current / status.mem.total) * 100).toFixed(1)}%` : '--', sub: status ? `${formatBytes(status.mem.current)} / ${formatBytes(status.mem.total)}` : '', ...DASHBOARD_ACCENT.primary },
        { icon: HiOutlineClock, label: '运行时间', value: status ? formatUptime(status.uptime) : '--', ...DASHBOARD_ACCENT.success },
        { icon: HiOutlineArrowsUpDown, label: '总流量', value: formatBytes(totalUp + totalDown), sub: `↑ ${formatBytes(totalUp)}  ↓ ${formatBytes(totalDown)}`, ...DASHBOARD_ACCENT.primary },
        { icon: HiOutlineSignal, label: '入站', value: `${activeInbounds} / ${inbounds.length}`, sub: '启用 / 总计', ...DASHBOARD_ACCENT.warning },
        { icon: HiOutlineUsers, label: '在线用户', value: String(onlineCount), sub: showOnlineDetail ? '点击收起明细' : '点击查看明细', onClick: () => setShowOnlineDetail((v) => !v), ...DASHBOARD_ACCENT.info },
    ];

    return (
        <>
            <Header title="仪表盘" />
            <div className="page-content page-enter">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-12">
                        <div className="text-sm text-muted">{activeServer?.name || '当前节点'}</div>
                        <WsStatusDot status={wsStatus} />
                    </div>
                    <div className="flex items-center gap-8">
                        <button className="btn btn-secondary btn-sm" onClick={refresh} title="手动刷新">
                            <HiOutlineArrowPath style={{ fontSize: '14px' }} /> 刷新
                        </button>
                        <button
                            className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setAutoRefresh(p => !p)}
                            title={autoRefresh ? '关闭自动刷新 (30s)' : '开启自动刷新 (30s)'}
                        >
                            <HiOutlineArrowPath className={autoRefresh ? 'spinning' : ''} style={{ fontSize: '14px' }} />
                            {autoRefresh ? '自动 ON' : '自动 OFF'}
                        </button>
                    </div>
                </div>

                <div className="stats-grid">
                    {statCards.map((card, idx) => (
                        <StatCard key={idx} card={card} loading={loading} />
                    ))}
                </div>

                {showOnlineDetail && (
                    <div className="card mb-6">
                        <div className="card-header">
                            <span className="card-title">在线用户明细</span>
                            <span className="text-sm text-muted">{onlineUserRows.length} 用户 / {onlineUsers.length} 会话</span>
                        </div>
                        {onlineUserRows.length === 0 ? (
                            <div className="empty-state empty-state-compact">
                                <div className="empty-state-text">当前没有在线用户</div>
                            </div>
                        ) : (
                            <div className="table-container table-scroll table-scroll-md">
                                <table className="table">
                                    <thead><tr><th>邮箱 / 标识</th><th>会话数</th></tr></thead>
                                    <tbody>
                                        {onlineUserRows.slice(0, MAX_SINGLE_ONLINE_ROWS).map((row) => (
                                            <tr key={`single-online-${row.email}`}>
                                                <td data-label="邮箱 / 标识" className="text-white font-medium">{row.email}</td>
                                                <td data-label="会话数"><span className="badge badge-success">{row.sessions}</span></td>
                                            </tr>
                                        ))}
                                        {onlineUserRows.length > MAX_SINGLE_ONLINE_ROWS && (
                                            <tr><td colSpan={2} className="table-note">仅展示前 {MAX_SINGLE_ONLINE_ROWS} 条</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Inbound Summary */}
                <div className="card mb-6">
                    <div className="card-header">
                        <span className="card-title">入站概览</span>
                        <span className="text-sm text-muted">{inbounds.length} 条入站规则</span>
                    </div>
                    <div className="table-container border-none">
                        <table className="table">
                            <thead>
                                <tr><th>备注</th><th>协议</th><th>端口</th><th>状态</th><th>上行</th><th>下行</th></tr>
                            </thead>
                            <tbody>
                                {inbounds.length === 0 ? (
                                    <tr><td colSpan={6} className="table-empty">暂无数据</td></tr>
                                ) : (
                                    inbounds.slice(0, 10).map((ib) => (
                                        <tr key={ib.id}>
                                            <td data-label="备注" className="font-medium text-white">{ib.remark || '-'}</td>
                                            <td data-label="协议"><span className="badge badge-info">{ib.protocol}</span></td>
                                            <td data-label="端口">{ib.port}</td>
                                            <td data-label="状态">
                                                <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>{ib.enable ? '启用' : '禁用'}</span>
                                            </td>
                                            <td data-label="上行">
                                                {loading ? <div className="skeleton w-12 h-4" /> : formatBytes(ib.up)}
                                            </td>
                                            <td data-label="下行">
                                                {loading ? <div className="skeleton w-12 h-4" /> : formatBytes(ib.down)}
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
                    <div className="card-header">
                        <span className="card-title">CPU 使用率趋势</span>
                    </div>
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
                                            <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="time" hide />
                                    <YAxis domain={[0, 100]} hide />
                                    <Tooltip
                                        contentStyle={{
                                            background: 'var(--bg-card)',
                                            backdropFilter: 'blur(8px)',
                                            border: '1px solid var(--border-highlight)',
                                            borderRadius: 'var(--radius-md)',
                                            fontSize: '12px',
                                            color: 'var(--text-primary)',
                                            boxShadow: 'var(--shadow-lg)'
                                        }}
                                        itemStyle={{ color: 'var(--accent-primary-hover)' }}
                                        formatter={(v) => [`${v.toFixed(1)}%`, 'CPU']}
                                        cursor={{ stroke: 'var(--border-color)', strokeWidth: 2 }}
                                    />
                                    <Area type="monotone" dataKey="cpu" stroke="var(--accent-primary)" strokeWidth={3} fill="url(#cpuGradient)" animationDuration={1500} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
