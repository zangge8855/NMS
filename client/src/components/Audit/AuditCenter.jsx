import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import {
    HiOutlineArrowPath,
    HiOutlineEye,
    HiOutlineChartBarSquare,
    HiOutlineUsers,
    HiOutlineSignal,
    HiOutlineDocumentText,
    HiOutlineTrash,
} from 'react-icons/hi2';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import { formatBytes } from '../../utils/format.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import toast from 'react-hot-toast';
import Tasks from '../Tasks/Tasks.jsx';
const Logs = lazy(() => import('../Logs/Logs.jsx'));

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', { hour12: false });
}

function statusBadgeClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success') return 'badge-success';
    if (normalized === 'failed' || normalized === 'denied' || normalized === 'revoked' || normalized === 'expired') return 'badge-danger';
    return 'badge-neutral';
}

function trendLabel(value, granularity) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    if (granularity === 'day') {
        return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    });
}

export default function AuditCenter() {
    const [tab, setTab] = useState('events');
    const confirm = useConfirm();

    const [eventsLoading, setEventsLoading] = useState(false);
    const [eventsData, setEventsData] = useState({ items: [], total: 0, page: 1, totalPages: 1 });
    const [eventsPage, setEventsPage] = useState(1);
    const [eventFilters, setEventFilters] = useState({
        q: '',
        eventType: '',
        outcome: '',
        targetEmail: '',
        serverId: '',
    });
    const [selectedEvent, setSelectedEvent] = useState(null);

    const [trafficLoading, setTrafficLoading] = useState(false);
    const [trafficOverview, setTrafficOverview] = useState(null);
    const [trafficGranularity, setTrafficGranularity] = useState('auto');
    const [selectedUser, setSelectedUser] = useState('');
    const [selectedServerId, setSelectedServerId] = useState('');
    const [userTrend, setUserTrend] = useState({ points: [], granularity: 'hour' });
    const [serverTrend, setServerTrend] = useState({ points: [], granularity: 'hour' });

    const [accessLoading, setAccessLoading] = useState(false);
    const [accessData, setAccessData] = useState({ items: [], total: 0, page: 1, totalPages: 1, statusBreakdown: {} });
    const [accessSummary, setAccessSummary] = useState({ total: 0, uniqueIpCount: 0, uniqueUsers: 0, statusBreakdown: {}, topIps: [], from: '', to: '' });
    const [accessPage, setAccessPage] = useState(1);
    const [accessFilters, setAccessFilters] = useState({
        email: '',
        status: '',
    });

    const fetchEvents = async (targetPage = eventsPage) => {
        setEventsLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', String(targetPage));
            params.append('pageSize', '20');
            if (eventFilters.q) params.append('q', eventFilters.q);
            if (eventFilters.eventType) params.append('eventType', eventFilters.eventType);
            if (eventFilters.outcome) params.append('outcome', eventFilters.outcome);
            if (eventFilters.targetEmail) params.append('targetEmail', eventFilters.targetEmail);
            if (eventFilters.serverId) params.append('serverId', eventFilters.serverId);
            const res = await api.get(`/audit/events?${params.toString()}`);
            setEventsData(res.data?.obj || { items: [], total: 0, page: targetPage, totalPages: 1 });
            setEventsPage(targetPage);
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '审计日志加载失败');
        }
        setEventsLoading(false);
    };

    const fetchTrafficOverview = async (force = false) => {
        setTrafficLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('days', '30');
            if (force) params.append('refresh', 'true');
            const res = await api.get(`/traffic/overview?${params.toString()}`);
            const payload = res.data?.obj || null;
            setTrafficOverview(payload);
            if (!selectedUser && payload?.topUsers?.length > 0) {
                setSelectedUser(payload.topUsers[0].email);
            }
            if (!selectedServerId && payload?.topServers?.length > 0) {
                setSelectedServerId(payload.topServers[0].serverId);
            }
            const warningCount = Array.isArray(payload?.collection?.warnings)
                ? payload.collection.warnings.length
                : 0;
            if (warningCount > 0) {
                toast.error(`有 ${warningCount} 个节点流量采样失败`);
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '流量总览加载失败');
        }
        setTrafficLoading(false);
    };

    const fetchUserTrend = async (email) => {
        if (!email) {
            setUserTrend({ points: [], granularity: 'hour' });
            return;
        }
        try {
            const params = new URLSearchParams();
            params.append('days', '14');
            params.append('granularity', trafficGranularity);
            const res = await api.get(`/traffic/users/${encodeURIComponent(email)}/trend?${params.toString()}`);
            setUserTrend(res.data?.obj || { points: [], granularity: 'hour' });
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '用户趋势加载失败');
        }
    };

    const fetchServerTrend = async (serverId) => {
        if (!serverId) {
            setServerTrend({ points: [], granularity: 'hour' });
            return;
        }
        try {
            const params = new URLSearchParams();
            params.append('days', '14');
            params.append('granularity', trafficGranularity);
            const res = await api.get(`/traffic/servers/${encodeURIComponent(serverId)}/trend?${params.toString()}`);
            setServerTrend(res.data?.obj || { points: [], granularity: 'hour' });
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '节点趋势加载失败');
        }
    };

    const fetchAccess = async (targetPage = accessPage) => {
        setAccessLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', String(targetPage));
            params.append('pageSize', '30');
            if (accessFilters.email) params.append('email', accessFilters.email);
            if (accessFilters.status) params.append('status', accessFilters.status);
            const [res, summaryRes] = await Promise.all([
                api.get(`/subscriptions/access?${params.toString()}`),
                api.get(`/subscriptions/access/summary?${params.toString()}`),
            ]);
            setAccessData(res.data?.obj || { items: [], total: 0, page: targetPage, totalPages: 1, statusBreakdown: {} });
            setAccessSummary(summaryRes.data?.obj || { total: 0, uniqueIpCount: 0, uniqueUsers: 0, statusBreakdown: {}, topIps: [], from: '', to: '' });
            setAccessPage(targetPage);
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '订阅访问日志加载失败');
        }
        setAccessLoading(false);
    };

    const handleClearEvents = async () => {
        const ok = await confirm({
            title: '清空操作审计日志',
            message: '确认要清空全部操作审计记录吗？此操作不可恢复。',
            confirmText: '清空',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete('/audit/events');
            toast.success('操作审计日志已清空');
            fetchEvents(1);
        } catch (err) {
            toast.error(err.response?.data?.msg || '清空失败');
        }
    };

    const handleClearAccessLogs = async () => {
        const ok = await confirm({
            title: '清空订阅访问日志',
            message: '确认要清空全部订阅访问记录吗？此操作不可恢复。',
            confirmText: '清空',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete('/audit/subscription-access');
            toast.success('订阅访问日志已清空');
            fetchAccess(1);
        } catch (err) {
            toast.error(err.response?.data?.msg || '清空失败');
        }
    };

    useEffect(() => {
        if (tab === 'events') {
            fetchEvents(1);
        } else if (tab === 'traffic') {
            fetchTrafficOverview(false);
        } else if (tab === 'subscriptions') {
            fetchAccess(1);
        }
    }, [tab]);

    useEffect(() => {
        if (tab !== 'traffic') return;
        fetchUserTrend(selectedUser);
    }, [tab, selectedUser, trafficGranularity]);

    useEffect(() => {
        if (tab !== 'traffic') return;
        fetchServerTrend(selectedServerId);
    }, [tab, selectedServerId, trafficGranularity]);

    const topUsers = useMemo(() => Array.isArray(trafficOverview?.topUsers) ? trafficOverview.topUsers : [], [trafficOverview]);
    const topServers = useMemo(() => Array.isArray(trafficOverview?.topServers) ? trafficOverview.topServers : [], [trafficOverview]);

    return (
        <>
            <Header title="审计中心" />
            <div className="page-content page-enter">
                <div className="tabs mb-8">
                    <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>
                        操作审计
                    </button>
                    <button className={`tab ${tab === 'traffic' ? 'active' : ''}`} onClick={() => setTab('traffic')}>
                        流量统计
                    </button>
                    <button className={`tab ${tab === 'subscriptions' ? 'active' : ''}`} onClick={() => setTab('subscriptions')}>
                        订阅访问
                    </button>
                    <button className={`tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
                        任务日志
                    </button>
                    <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
                        系统日志
                    </button>
                </div>

                {tab === 'events' && (
                    <>
                        <div className="card mb-8 p-3">
                            <div className="flex gap-2 items-center flex-wrap">
                                <input
                                    className="form-input w-180"
                                    placeholder="关键词"
                                    value={eventFilters.q}
                                    onChange={(e) => setEventFilters((prev) => ({ ...prev, q: e.target.value }))}
                                />
                                <input
                                    className="form-input w-180"
                                    placeholder="事件类型"
                                    value={eventFilters.eventType}
                                    onChange={(e) => setEventFilters((prev) => ({ ...prev, eventType: e.target.value }))}
                                />
                                <select
                                    className="form-select w-140"
                                    value={eventFilters.outcome}
                                    onChange={(e) => setEventFilters((prev) => ({ ...prev, outcome: e.target.value }))}
                                >
                                    <option value="">全部结果</option>
                                    <option value="success">success</option>
                                    <option value="failed">failed</option>
                                    <option value="info">info</option>
                                </select>
                                <input
                                    className="form-input w-180"
                                    placeholder="用户邮箱"
                                    value={eventFilters.targetEmail}
                                    onChange={(e) => setEventFilters((prev) => ({ ...prev, targetEmail: e.target.value }))}
                                />
                                <input
                                    className="form-input w-180"
                                    placeholder="节点 ID"
                                    value={eventFilters.serverId}
                                    onChange={(e) => setEventFilters((prev) => ({ ...prev, serverId: e.target.value }))}
                                />
                                <button className="btn btn-primary btn-sm" onClick={() => fetchEvents(1)} disabled={eventsLoading}>
                                    <HiOutlineArrowPath className={eventsLoading ? 'spinning' : ''} /> 查询
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={handleClearEvents} title="清空全部审计日志">
                                    <HiOutlineTrash /> 清空
                                </button>
                            </div>
                        </div>

                        <div className="table-container glass-panel mb-8">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th>事件</th>
                                        <th>结果</th>
                                        <th>操作者</th>
                                        <th>节点</th>
                                        <th>用户</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {eventsLoading ? (
                                        <tr><td colSpan={7} className="text-center table-pad-28"><div className="spinner mx-auto" /></td></tr>
                                    ) : eventsData.items.length === 0 ? (
                                        <tr><td colSpan={7} className="text-center table-pad-28">暂无审计记录</td></tr>
                                    ) : (
                                        eventsData.items.map((item) => (
                                            <tr key={item.id}>
                                                <td>{formatDateTime(item.ts)}</td>
                                                <td>{item.eventType}</td>
                                                <td><span className={`badge ${statusBadgeClass(item.outcome)}`}>{item.outcome || '-'}</span></td>
                                                <td>{item.actor || '-'}</td>
                                                <td>{item.serverId || '-'}</td>
                                                <td>{item.targetEmail || '-'}</td>
                                                <td>
                                                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setSelectedEvent(item)} title="查看详情">
                                                        <HiOutlineEye />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="text-sm text-muted">共 {eventsData.total || 0} 条</div>
                            <div className="flex gap-2">
                                <button className="btn btn-secondary btn-sm" disabled={eventsPage <= 1 || eventsLoading} onClick={() => fetchEvents(eventsPage - 1)}>上一页</button>
                                <span className="text-sm text-muted self-center">
                                    {eventsPage} / {eventsData.totalPages || 1}
                                </span>
                                <button className="btn btn-secondary btn-sm" disabled={eventsPage >= (eventsData.totalPages || 1) || eventsLoading} onClick={() => fetchEvents(eventsPage + 1)}>下一页</button>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'traffic' && (
                    <>
                        <div className="flex items-center justify-between mb-6">
                            <div className="text-sm text-muted">
                                最近采样: {formatDateTime(trafficOverview?.lastCollectionAt)}
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    className="form-select w-130"
                                    value={trafficGranularity}
                                    onChange={(e) => setTrafficGranularity(e.target.value)}
                                >
                                    <option value="auto">自动粒度</option>
                                    <option value="hour">按小时</option>
                                    <option value="day">按天</option>
                                </select>
                                <button className="btn btn-primary btn-sm" onClick={() => fetchTrafficOverview(true)} disabled={trafficLoading}>
                                    <HiOutlineArrowPath className={trafficLoading ? 'spinning' : ''} /> 立即采样
                                </button>
                            </div>
                        </div>

                        <div className="stats-grid mb-8">
                            <div className="card">
                                <div className="card-header"><span className="card-title">总流量</span><HiOutlineChartBarSquare /></div>
                                <div className="card-value">{formatBytes(trafficOverview?.totals?.totalBytes || 0)}</div>
                                <div className="text-sm text-muted">↑ {formatBytes(trafficOverview?.totals?.upBytes || 0)} / ↓ {formatBytes(trafficOverview?.totals?.downBytes || 0)}</div>
                            </div>
                            <div className="card">
                                <div className="card-header"><span className="card-title">活跃用户</span><HiOutlineUsers /></div>
                                <div className="card-value">{trafficOverview?.activeUsers || 0}</div>
                            </div>
                            <div className="card">
                                <div className="card-header"><span className="card-title">采样点</span><HiOutlineSignal /></div>
                                <div className="card-value">{trafficOverview?.sampleCount || 0}</div>
                            </div>
                        </div>

                        <div className="grid-auto-280-tight mb-8">
                            <div className="card">
                                <div className="card-header">
                                    <span className="card-title">用户流量趋势</span>
                                    <select
                                        className="form-select w-220"
                                        value={selectedUser}
                                        onChange={(e) => setSelectedUser(e.target.value)}
                                    >
                                        <option value="">请选择用户</option>
                                        {topUsers.map((item) => (
                                            <option key={item.email} value={item.email}>
                                                {item.email} ({formatBytes(item.totalBytes)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="dashboard-chart">
                                    <ResponsiveContainer>
                                        <LineChart data={userTrend.points || []}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                            <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, userTrend.granularity)} />
                                            <YAxis />
                                            <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(value) => formatDateTime(value)} />
                                            <Line type="monotone" dataKey="totalBytes" stroke="#6366f1" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="card">
                                <div className="card-header">
                                    <span className="card-title">节点流量趋势</span>
                                    <select
                                        className="form-select w-220"
                                        value={selectedServerId}
                                        onChange={(e) => setSelectedServerId(e.target.value)}
                                    >
                                        <option value="">请选择节点</option>
                                        {topServers.map((item) => (
                                            <option key={item.serverId} value={item.serverId}>
                                                {item.serverName} ({formatBytes(item.totalBytes)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="dashboard-chart">
                                    <ResponsiveContainer>
                                        <LineChart data={serverTrend.points || []}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                            <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, serverTrend.granularity)} />
                                            <YAxis />
                                            <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(value) => formatDateTime(value)} />
                                            <Line type="monotone" dataKey="totalBytes" stroke="#10b981" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        <div className="grid-auto-280-tight">
                            <div className="card">
                                <div className="card-header"><span className="card-title">流量 Top 用户</span></div>
                                <div className="table-container">
                                    <table className="table">
                                        <thead><tr><th>用户</th><th>流量</th></tr></thead>
                                        <tbody>
                                            {topUsers.length === 0 ? (
                                                <tr><td colSpan={2} className="text-center">暂无数据</td></tr>
                                            ) : topUsers.map((item) => (
                                                <tr key={item.email} className="cursor-pointer" onClick={() => setSelectedUser(item.email)}>
                                                    <td>{item.email}</td>
                                                    <td>{formatBytes(item.totalBytes)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="card">
                                <div className="card-header"><span className="card-title">流量 Top 节点</span></div>
                                <div className="table-container">
                                    <table className="table">
                                        <thead><tr><th>节点</th><th>流量</th></tr></thead>
                                        <tbody>
                                            {topServers.length === 0 ? (
                                                <tr><td colSpan={2} className="text-center">暂无数据</td></tr>
                                            ) : topServers.map((item) => (
                                                <tr key={item.serverId} className="cursor-pointer" onClick={() => setSelectedServerId(item.serverId)}>
                                                    <td>{item.serverName}</td>
                                                    <td>{formatBytes(item.totalBytes)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'subscriptions' && (
                    <>
                        <div className="card mb-8 p-3">
                            <div className="flex gap-2 items-center flex-wrap">
                                <input
                                    className="form-input w-220"
                                    placeholder="邮箱过滤"
                                    value={accessFilters.email}
                                    onChange={(e) => setAccessFilters((prev) => ({ ...prev, email: e.target.value }))}
                                />
                                <select
                                    className="form-select w-160"
                                    value={accessFilters.status}
                                    onChange={(e) => setAccessFilters((prev) => ({ ...prev, status: e.target.value }))}
                                >
                                    <option value="">全部状态</option>
                                    <option value="success">success</option>
                                    <option value="denied">denied</option>
                                    <option value="expired">expired</option>
                                    <option value="revoked">revoked</option>
                                </select>
                                <button className="btn btn-primary btn-sm" onClick={() => fetchAccess(1)} disabled={accessLoading}>
                                    <HiOutlineArrowPath className={accessLoading ? 'spinning' : ''} /> 查询
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={handleClearAccessLogs} title="清空全部访问日志">
                                    <HiOutlineTrash /> 清空
                                </button>
                                <span className="text-sm text-muted">默认统计周期：近一年</span>
                            </div>
                        </div>

                        <div className="stats-grid mb-8">
                            <div className="card">
                                <div className="card-header"><span className="card-title">访问次数 (PV)</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.total || 0}</div>
                            </div>
                            <div className="card">
                                <div className="card-header"><span className="card-title">独立 IP (UV)</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.uniqueIpCount || 0}</div>
                            </div>
                            <div className="card">
                                <div className="card-header"><span className="card-title">访问用户数</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.uniqueUsers || 0}</div>
                            </div>
                            {Object.entries(accessData.statusBreakdown || {}).map(([key, value]) => (
                                <div className="card" key={key}>
                                    <div className="card-header"><span className="card-title">{key}</span><HiOutlineDocumentText /></div>
                                    <div className="card-value">{value}</div>
                                </div>
                            ))}
                        </div>

                        <div className="table-container glass-panel mb-8">
                            <table className="table" style={{ minWidth: '900px', tableLayout: 'fixed' }}>
                                <colgroup>
                                    <col style={{ width: '160px' }} />
                                    <col style={{ width: '180px' }} />
                                    <col style={{ width: '80px' }} />
                                    <col style={{ width: '140px' }} />
                                    <col style={{ width: '120px' }} />
                                    <col />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th>邮箱</th>
                                        <th>状态</th>
                                        <th>IP</th>
                                        <th>所属地</th>
                                        <th>UA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accessLoading ? (
                                        <tr><td colSpan={6} className="text-center table-pad-28"><div className="spinner mx-auto" /></td></tr>
                                    ) : accessData.items.length === 0 ? (
                                        <tr><td colSpan={6} className="text-center table-pad-28">暂无访问记录</td></tr>
                                    ) : accessData.items.map((item) => (
                                        <tr key={item.id}>
                                            <td data-label="时间" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.ts)}</td>
                                            <td data-label="邮箱" style={{ wordBreak: 'break-all' }}>{item.email || '-'}</td>
                                            <td data-label="状态"><span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                                            <td data-label="IP" className="font-mono" style={{ wordBreak: 'break-all' }}>{item.ip || '-'}</td>
                                            <td data-label="所属地">{item.ipLocation || '-'}</td>
                                            <td data-label="UA" className="text-xs" style={{ wordBreak: 'break-all', lineHeight: '1.4' }}>{item.userAgent || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="text-sm text-muted">共 {accessData.total || 0} 条</div>
                            <div className="flex gap-2">
                                <button className="btn btn-secondary btn-sm" disabled={accessPage <= 1 || accessLoading} onClick={() => fetchAccess(accessPage - 1)}>上一页</button>
                                <span className="text-sm text-muted self-center">
                                    {accessPage} / {accessData.totalPages || 1}
                                </span>
                                <button className="btn btn-secondary btn-sm" disabled={accessPage >= (accessData.totalPages || 1) || accessLoading} onClick={() => fetchAccess(accessPage + 1)}>下一页</button>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'tasks' && (
                    <Tasks embedded />
                )}

                {tab === 'logs' && (
                    <Suspense fallback={<div className="flex items-center justify-center" style={{ padding: '64px 0' }}><span className="spinner" /></div>}>
                        <Logs embedded />
                    </Suspense>
                )}
            </div>

            {selectedEvent && (
                <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">审计事件详情</h3>
                            <button className="modal-close" onClick={() => setSelectedEvent(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <pre className="log-viewer log-viewer-compact">
                                {JSON.stringify(selectedEvent, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
