import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { formatBytes, formatUptime } from '../../utils/format.js';
import { normalizeInboundOrderMap, sortInboundsByOrder } from '../../utils/inboundOrder.js';
import toast from 'react-hot-toast';
import {
    HiOutlineArrowLeft,
    HiOutlineArrowPath,
    HiOutlineCpuChip,
    HiOutlineCircleStack,
    HiOutlineClock,
    HiOutlineServerStack,
} from 'react-icons/hi2';

function StatMini({ label, value, suffix }) {
    const animated = useAnimatedCounter(value || 0);
    return (
        <div className="stat-mini-card">
            <div className="stat-mini-value">{animated}{suffix || ''}</div>
            <div className="stat-mini-label">{label}</div>
        </div>
    );
}

function formatTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ServerDetail() {
    const { serverId } = useParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [server, setServer] = useState(null);
    const [status, setStatus] = useState(null);
    const [inbounds, setInbounds] = useState([]);
    const [onlines, setOnlines] = useState([]);
    const [auditEvents, setAuditEvents] = useState([]);
    const [activeTab, setActiveTab] = useState('overview');

    const fetchServer = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/servers/${encodeURIComponent(serverId)}`);
            if (res.data?.success) {
                setServer(res.data.obj);
            } else {
                toast.error('服务器不存在');
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || '加载服务器信息失败');
        }
        setLoading(false);
    };

    const fetchStatus = async () => {
        try {
            const res = await api.get(`/panel/${encodeURIComponent(serverId)}/panel/api/server/status`);
            if (res.data?.success) {
                setStatus(res.data.obj);
            }
        } catch { /* server may be offline */ }
    };

    const fetchInbounds = async () => {
        try {
            const [res, orderRes] = await Promise.all([
                api.get(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/list`),
                api.get('/system/inbounds/order').catch(() => ({ data: { obj: {} } })),
            ]);
            const rows = Array.isArray(res.data?.obj) ? res.data.obj.map((item) => ({
                ...item,
                serverId,
                serverName: server?.name || '',
            })) : [];
            const orderMap = normalizeInboundOrderMap(orderRes.data?.obj || {});
            const sorted = sortInboundsByOrder(rows, orderMap).map(({ serverId: _sid, serverName: _sname, ...item }) => item);
            setInbounds(sorted);
        } catch { /* ignore */ }
    };

    const fetchOnlines = async () => {
        try {
            const res = await api.post(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/onlines`);
            const data = res.data?.obj || [];
            // Flatten online users from all inbounds
            const users = [];
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (typeof item === 'string') users.push(item);
                    else if (item?.email) users.push(item.email);
                });
            }
            setOnlines(users);
        } catch { /* ignore */ }
    };

    const fetchAudit = async () => {
        try {
            const res = await api.get('/audit/events', { params: { serverId, pageSize: 20 } });
            setAuditEvents(res.data?.obj?.items || []);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        fetchServer();
        fetchStatus();
        fetchInbounds();
    }, [serverId]);

    useEffect(() => {
        if (activeTab === 'onlines') fetchOnlines();
        if (activeTab === 'audit') fetchAudit();
    }, [activeTab, serverId]);

    const totalTraffic = useMemo(() => {
        return inbounds.reduce((sum, ib) => sum + (ib.up || 0) + (ib.down || 0), 0);
    }, [inbounds]);

    const activeInbounds = useMemo(() => inbounds.filter(ib => ib.enable !== false).length, [inbounds]);

    const clientCount = useMemo(() => {
        let count = 0;
        for (const ib of inbounds) {
            try {
                const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : (ib.settings || {});
                count += (settings.clients || []).length;
            } catch { /* ignore */ }
        }
        return count;
    }, [inbounds]);

    const refreshAll = () => {
        fetchServer();
        fetchStatus();
        fetchInbounds();
    };

    if (loading) {
        return (
            <>
                <Header title="服务器详情" />
                <div className="page-content page-enter">
                    <div className="glass-panel p-6">
                        <SkeletonTable rows={3} cols={4} />
                    </div>
                </div>
            </>
        );
    }

    if (!server) {
        return (
            <>
                <Header title="服务器详情" />
                <div className="page-content page-enter">
                    <EmptyState title="服务器不存在" subtitle="该服务器可能已被删除" action={
                        <button className="btn btn-secondary" onClick={() => navigate('/servers')}>
                            <HiOutlineArrowLeft /> 返回服务器列表
                        </button>
                    } />
                </div>
            </>
        );
    }

    const envLabel = { production: '生产', staging: '预发布', development: '开发', testing: '测试', dr: '灾备', sandbox: '沙盒' };
    const healthLabel = { healthy: '健康', degraded: '降级', unreachable: '不可达', maintenance: '维护中' };
    const healthBadge = { healthy: 'badge-success', degraded: 'badge-warning', unreachable: 'badge-danger', maintenance: 'badge-info' };

    const tabs = [
        { key: 'overview', label: '概览' },
        { key: 'inbounds', label: '入站列表' },
        { key: 'onlines', label: '在线用户' },
        { key: 'audit', label: '审计日志' },
    ];

    return (
        <>
            <Header title={`服务器 — ${server.name}`} />
            <div className="page-content page-enter">
                <button className="btn btn-secondary btn-sm mb-4" onClick={() => navigate('/servers')}>
                    <HiOutlineArrowLeft /> 返回服务器列表
                </button>

                {/* Server Profile Card */}
                <div className="glass-panel mb-6">
                    <div className="user-profile-card">
                        <div className="user-avatar user-avatar-lg" style={{ background: 'var(--gradient-success)' }}>
                            <HiOutlineServerStack />
                        </div>
                        <div className="user-profile-info">
                            <div className="user-profile-name">{server.name}</div>
                            <div className="user-profile-email font-mono">{server.url}</div>
                            <div className="flex gap-2 mb-3">
                                <span className={`badge ${healthBadge[server.health] || 'badge-neutral'}`}>
                                    {healthLabel[server.health] || '未知'}
                                </span>
                                <span className="badge badge-neutral">{envLabel[server.environment] || server.environment || '未分类'}</span>
                                {server.group && <span className="badge badge-info">{server.group}</span>}
                            </div>
                            <div className="user-profile-meta">
                                {status && (
                                    <>
                                        <div className="user-profile-meta-item"><HiOutlineCpuChip /> CPU: {status.cpu?.toFixed(1)}%</div>
                                        <div className="user-profile-meta-item"><HiOutlineCircleStack /> 内存: {status.mem ? `${((status.mem.current / status.mem.total) * 100).toFixed(1)}%` : '-'}</div>
                                        <div className="user-profile-meta-item"><HiOutlineClock /> 运行: {status.uptime ? formatUptime(status.uptime) : '-'}</div>
                                    </>
                                )}
                                {!status && <div className="user-profile-meta-item text-muted">服务器状态获取中...</div>}
                            </div>
                        </div>
                        <div className="user-profile-actions">
                            <button className="btn btn-secondary btn-sm" onClick={refreshAll}>
                                <HiOutlineArrowPath /> 刷新
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="stat-mini-grid mb-6">
                    <StatMini label="入站规则" value={activeInbounds} suffix={` / ${inbounds.length}`} />
                    <StatMini label="客户端数" value={clientCount} />
                    <StatMini label="在线用户" value={onlines.length} />
                    <StatMini label="总流量 (MB)" value={Math.round(totalTraffic / (1024 * 1024))} />
                </div>

                {/* Tabs */}
                <div className="user-detail-tabs">
                    <div className="tabs">
                        {tabs.map(t => (
                            <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="user-detail-tab-content tab-content-enter" key={activeTab}>
                        {/* Overview Tab */}
                        {activeTab === 'overview' && (
                            <div>
                                <div className="card mb-4">
                                    <h4 className="card-title mb-3">服务器信息</h4>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div><span className="text-muted">名称:</span> {server.name}</div>
                                        <div><span className="text-muted">URL:</span> <span className="font-mono">{server.url}</span></div>
                                        <div><span className="text-muted">用户名:</span> {server.username}</div>
                                        <div><span className="text-muted">环境:</span> {envLabel[server.environment] || '未知'}</div>
                                        <div><span className="text-muted">分组:</span> {server.group || '未分组'}</div>
                                        <div><span className="text-muted">健康状态:</span> {healthLabel[server.health] || '未知'}</div>
                                        {server.basePath && <div><span className="text-muted">基础路径:</span> <span className="font-mono">{server.basePath}</span></div>}
                                    </div>
                                    {Array.isArray(server.tags) && server.tags.length > 0 && (
                                        <div className="flex gap-2 mt-3">
                                            {server.tags.map(tag => <span key={tag} className="badge badge-info">{tag}</span>)}
                                        </div>
                                    )}
                                </div>
                                {status && (
                                    <div className="card">
                                        <h4 className="card-title mb-3">Xray 状态</h4>
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div><span className="text-muted">Xray 版本:</span> {status.xray?.version || '-'}</div>
                                            <div><span className="text-muted">运行时间:</span> {formatUptime(status.uptime)}</div>
                                            <div><span className="text-muted">CPU:</span> {status.cpu?.toFixed(1)}%</div>
                                            <div><span className="text-muted">内存:</span> {status.mem ? `${formatBytes(status.mem.current)} / ${formatBytes(status.mem.total)}` : '-'}</div>
                                            <div><span className="text-muted">磁盘:</span> {status.disk ? `${formatBytes(status.disk.current)} / ${formatBytes(status.disk.total)}` : '-'}</div>
                                            <div><span className="text-muted">TCP 连接:</span> {status.tcpCount || '-'}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Inbounds Tab */}
                        {activeTab === 'inbounds' && (
                            <div>
                                {inbounds.length === 0 ? (
                                    <EmptyState title="暂无入站规则" subtitle="该服务器未配置入站" />
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>备注</th>
                                                    <th>协议</th>
                                                    <th>端口</th>
                                                    <th>客户端数</th>
                                                    <th>流量</th>
                                                    <th>状态</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {inbounds.map(ib => {
                                                    let clients = 0;
                                                    try {
                                                        const s = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : (ib.settings || {});
                                                        clients = (s.clients || []).length;
                                                    } catch {}
                                                    return (
                                                        <tr key={ib.id}>
                                                            <td className="font-medium">{ib.remark || '-'}</td>
                                                            <td><span className="badge badge-neutral">{ib.protocol}</span></td>
                                                            <td>{ib.port}</td>
                                                            <td>{clients}</td>
                                                            <td>{formatBytes((ib.up || 0) + (ib.down || 0))}</td>
                                                            <td><span className={`badge ${ib.enable !== false ? 'badge-success' : 'badge-danger'}`}>{ib.enable !== false ? '启用' : '禁用'}</span></td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Online Users Tab */}
                        {activeTab === 'onlines' && (
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm text-muted">当前在线: {onlines.length}</span>
                                    <button className="btn btn-secondary btn-sm" onClick={fetchOnlines}><HiOutlineArrowPath /> 刷新</button>
                                </div>
                                {onlines.length === 0 ? (
                                    <EmptyState title="当前无在线用户" subtitle="该服务器暂无活跃连接" />
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead><tr><th>#</th><th>用户标识</th></tr></thead>
                                            <tbody>
                                                {onlines.map((user, i) => (
                                                    <tr key={i}><td>{i + 1}</td><td className="font-mono">{user}</td></tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Audit Tab */}
                        {activeTab === 'audit' && (
                            <div>
                                {auditEvents.length === 0 ? (
                                    <EmptyState title="暂无审计记录" subtitle="该服务器相关的审计事件将在此显示" />
                                ) : (
                                    <div className="timeline-list">
                                        {auditEvents.map((e, i) => (
                                            <div key={i} className="timeline-item">
                                                <div className={`timeline-dot ${e.outcome === 'success' ? 'success' : e.outcome === 'failed' ? 'danger' : 'info'}`} />
                                                <div className="timeline-content">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium">{e.eventType}</span>
                                                        <span className="timeline-time">{formatTime(e.ts)}</span>
                                                    </div>
                                                    {e.actor && <div className="text-sm text-muted">操作者: {e.actor}</div>}
                                                    {e.path && <div className="text-xs text-muted truncate">{e.path}</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
