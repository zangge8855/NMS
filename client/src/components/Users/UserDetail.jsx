import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { formatBytes, copyToClipboard } from '../../utils/format.js';
import toast from 'react-hot-toast';
import {
    HiOutlineArrowLeft,
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlineClipboard,
    HiOutlineNoSymbol,
    HiOutlinePlayCircle,
    HiOutlineCalendarDays,
    HiOutlineClock,
    HiOutlineEnvelope,
    HiOutlineShieldCheck,
    HiOutlineKey,
    HiOutlineArrowPath,
    HiOutlineXMark,
    HiOutlinePencilSquare,
} from 'react-icons/hi2';

function UserAvatar({ username }) {
    const initial = String(username || '?').charAt(0).toUpperCase();
    return <div className="user-avatar user-avatar-lg">{initial}</div>;
}

function StatCard({ label, value }) {
    const animated = useAnimatedCounter(value);
    return (
        <div className="stat-mini-card">
            <div className="stat-mini-value">{animated}</div>
            <div className="stat-mini-label">{label}</div>
        </div>
    );
}

function formatTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timelineOutcomeClass(outcome) {
    if (outcome === 'success' || outcome === 'ok') return 'success';
    if (outcome === 'failed' || outcome === 'denied') return 'danger';
    if (outcome === 'info') return 'info';
    return '';
}

export default function UserDetail() {
    const { userId } = useParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    // Token issue modal
    const [tokenModalOpen, setTokenModalOpen] = useState(false);
    const [tokenName, setTokenName] = useState('');
    const [tokenNoExpiry, setTokenNoExpiry] = useState(true);
    const [tokenTtlDays, setTokenTtlDays] = useState(30);
    const [tokenIssuing, setTokenIssuing] = useState(false);

    // Client data from servers
    const [clientData, setClientData] = useState([]);
    const [clientsLoading, setClientsLoading] = useState(false);

    const fetchDetail = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/users/${encodeURIComponent(userId)}/detail`);
            if (res.data?.success) {
                setDetail(res.data.obj);
            } else {
                toast.error(res.data?.msg || '加载用户详情失败');
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || '加载用户详情失败');
        }
        setLoading(false);
    };

    const fetchClients = async () => {
        if (!detail?.user?.subscriptionEmail && !detail?.user?.email) return;
        setClientsLoading(true);
        try {
            // Fetch all server inbounds to find this user's clients
            const serversRes = await api.get('/servers');
            const servers = serversRes.data?.obj || [];
            const email = (detail.user.subscriptionEmail || detail.user.email || '').toLowerCase();
            const clients = [];

            await Promise.all(servers.map(async (server) => {
                try {
                    const ibRes = await api.get(`/panel/${server.id}/panel/api/inbounds/list`);
                    const inbounds = ibRes.data?.obj || [];
                    for (const ib of inbounds) {
                        const protocol = String(ib.protocol || '').toLowerCase();
                        if (!['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) continue;
                        let settings = {};
                        try { settings = JSON.parse(ib.settings); } catch {}
                        const ibClients = settings.clients || [];
                        for (const cl of ibClients) {
                            if ((cl.email || '').toLowerCase() === email) {
                                clients.push({
                                    serverId: server.id,
                                    serverName: server.name,
                                    inboundId: ib.id,
                                    inboundRemark: ib.remark || '',
                                    protocol,
                                    port: ib.port,
                                    up: cl.up || 0,
                                    down: cl.down || 0,
                                    expiryTime: cl.expiryTime || 0,
                                    enable: cl.enable !== false,
                                });
                            }
                        }
                    }
                } catch {}
            }));

            setClientData(clients);
        } catch {}
        setClientsLoading(false);
    };

    useEffect(() => {
        fetchDetail();
    }, [userId]);

    useEffect(() => {
        if (detail && activeTab === 'clients') {
            fetchClients();
        }
    }, [detail, activeTab]);

    const user = detail?.user;
    const tokens = detail?.tokens || [];
    const recentAudit = detail?.recentAudit?.items || [];
    const subscriptionAccess = detail?.subscriptionAccess?.items || [];

    // Merge audit + subscription access into timeline
    const timeline = useMemo(() => {
        if (!detail) return [];
        const items = [];
        recentAudit.forEach(e => {
            items.push({ ts: e.ts, type: 'audit', event: e.eventType, outcome: e.outcome, detail: e.path || '', ip: e.ip });
        });
        subscriptionAccess.forEach(e => {
            items.push({ ts: e.ts, type: 'access', event: `订阅访问 (${e.status})`, outcome: e.status === 'ok' ? 'success' : 'failed', detail: e.reason || '', ip: e.ip });
        });
        return items.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 50);
    }, [detail]);

    // Stats
    const totalTraffic = useMemo(() => {
        return clientData.reduce((sum, c) => sum + (c.up || 0) + (c.down || 0), 0);
    }, [clientData]);

    const handleToggleEnabled = async () => {
        if (!user) return;
        const newEnabled = !user.enabled;
        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(user.id)}/set-enabled`, { enabled: newEnabled });
            if (res.data?.success) {
                toast.success(`用户已${newEnabled ? '启用' : '停用'}`);
                fetchDetail();
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || '操作失败');
        }
    };

    const handleIssueToken = async (e) => {
        e.preventDefault();
        setTokenIssuing(true);
        try {
            const res = await api.post(`/users/${encodeURIComponent(userId)}/tokens`, {
                name: tokenName || 'manual',
                noExpiry: tokenNoExpiry,
                ttlDays: tokenNoExpiry ? 0 : tokenTtlDays,
            });
            if (res.data?.success) {
                toast.success('Token 已签发');
                const token = res.data.obj?.token;
                if (token) {
                    await copyToClipboard(token);
                    toast.success('Token 已复制到剪贴板');
                }
                setTokenModalOpen(false);
                setTokenName('');
                fetchDetail();
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || '签发失败');
        }
        setTokenIssuing(false);
    };

    const handleRevokeToken = async (tokenId) => {
        try {
            const res = await api.delete(`/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(tokenId)}`);
            if (res.data?.success) {
                toast.success('Token 已撤销');
                fetchDetail();
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || '撤销失败');
        }
    };

    if (loading) {
        return (
            <>
                <Header title="用户详情" />
                <div className="page-content page-enter">
                    <div className="glass-panel p-6">
                        <SkeletonTable rows={3} cols={4} />
                    </div>
                </div>
            </>
        );
    }

    if (!user) {
        return (
            <>
                <Header title="用户详情" />
                <div className="page-content page-enter">
                    <EmptyState title="用户不存在" subtitle="该用户可能已被删除" action={
                        <button className="btn btn-secondary" onClick={() => navigate('/clients')}>
                            <HiOutlineArrowLeft /> 返回用户列表
                        </button>
                    } />
                </div>
            </>
        );
    }

    const tabs = [
        { key: 'overview', label: '概览' },
        { key: 'clients', label: '客户端' },
        { key: 'tokens', label: '订阅令牌' },
        { key: 'activity', label: '活动日志' },
    ];

    return (
        <>
            <Header title={`用户详情 — ${user.username}`} />
            <div className="page-content page-enter">
                {/* Back button */}
                <button className="btn btn-secondary btn-sm mb-4" onClick={() => navigate('/clients')}>
                    <HiOutlineArrowLeft /> 返回用户列表
                </button>

                {/* Profile Card */}
                <div className="glass-panel mb-6">
                    <div className="user-profile-card">
                        <UserAvatar username={user.username} />
                        <div className="user-profile-info">
                            <div className="user-profile-name">{user.username}</div>
                            <div className="user-profile-email">{user.email || user.subscriptionEmail || '未设置邮箱'}</div>
                            <div className="flex gap-2 mb-3">
                                <span className={`badge ${user.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}>{user.role}</span>
                                <span className={`badge ${user.enabled ? 'badge-success' : 'badge-danger'}`}>{user.enabled ? '已启用' : '已停用'}</span>
                                {user.emailVerified && <span className="badge badge-success">邮箱已验证</span>}
                            </div>
                            <div className="user-profile-meta">
                                <div className="user-profile-meta-item">
                                    <HiOutlineCalendarDays /> 注册: {formatTime(user.createdAt)}
                                </div>
                                <div className="user-profile-meta-item">
                                    <HiOutlineClock /> 最后登录: {formatTime(user.lastLoginAt)}
                                </div>
                                {user.subscriptionEmail && user.subscriptionEmail !== user.email && (
                                    <div className="user-profile-meta-item">
                                        <HiOutlineEnvelope /> 订阅邮箱: {user.subscriptionEmail}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="user-profile-actions">
                            <button
                                className={`btn btn-sm ${user.enabled ? 'btn-danger' : 'btn-success'}`}
                                onClick={handleToggleEnabled}
                            >
                                {user.enabled ? <><HiOutlineNoSymbol /> 停用</> : <><HiOutlinePlayCircle /> 启用</>}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/clients?edit=${user.id}`)}>
                                <HiOutlinePencilSquare /> 编辑
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={fetchDetail}>
                                <HiOutlineArrowPath /> 刷新
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="user-detail-tabs">
                    <div className="tabs">
                        {tabs.map(t => (
                            <button
                                key={t.key}
                                className={`tab ${activeTab === t.key ? 'active' : ''}`}
                                onClick={() => setActiveTab(t.key)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="user-detail-tab-content tab-content-enter" key={activeTab}>
                        {/* Overview Tab */}
                        {activeTab === 'overview' && (
                            <div>
                                <div className="stat-mini-grid">
                                    <StatCard label="总流量" value={totalTraffic > 0 ? Math.round(totalTraffic / (1024 * 1024)) : 0} />
                                    <StatCard label="客户端数" value={clientData.length} />
                                    <StatCard label="Token 数" value={tokens.length} />
                                    <StatCard label="审计记录" value={detail?.recentAudit?.total || 0} />
                                </div>
                                {totalTraffic > 0 && (
                                    <p className="text-muted text-sm mb-4">总流量: {formatBytes(totalTraffic)}</p>
                                )}
                                {detail?.policy && (
                                    <div className="card mb-4">
                                        <div className="card-header pb-0 mb-0" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 8 }}>
                                            <span className="card-title"><HiOutlineShieldCheck className="inline-flex mr-2" /> 访问策略</span>
                                        </div>
                                        <div className="p-3">
                                            <div className="flex gap-4 text-sm">
                                                <span>服务器: <strong>{detail.policy.serverScopeMode === 'all' ? '不限' : detail.policy.serverScopeMode === 'none' ? '禁止' : `${(detail.policy.allowedServerIds || []).length} 台`}</strong></span>
                                                <span>协议: <strong>{detail.policy.protocolScopeMode === 'all' ? '不限' : detail.policy.protocolScopeMode === 'none' ? '禁止' : (detail.policy.allowedProtocols || []).join(', ')}</strong></span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Clients Tab */}
                        {activeTab === 'clients' && (
                            <div>
                                {clientsLoading ? (
                                    <SkeletonTable rows={4} cols={6} />
                                ) : clientData.length === 0 ? (
                                    <EmptyState title="暂无客户端" subtitle="该用户在各节点上没有客户端配置" />
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>服务器</th>
                                                    <th>入站</th>
                                                    <th>协议</th>
                                                    <th>流量</th>
                                                    <th>到期时间</th>
                                                    <th>状态</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {clientData.map((c, i) => (
                                                    <tr key={i}>
                                                        <td>{c.serverName}</td>
                                                        <td>{c.inboundRemark || c.inboundId}</td>
                                                        <td><span className="badge badge-neutral">{c.protocol}</span></td>
                                                        <td>{formatBytes((c.up || 0) + (c.down || 0))}</td>
                                                        <td>{c.expiryTime > 0 ? new Date(c.expiryTime).toLocaleDateString('zh-CN') : '永久'}</td>
                                                        <td><span className={`badge ${c.enable ? 'badge-success' : 'badge-danger'}`}>{c.enable ? '启用' : '禁用'}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tokens Tab */}
                        {activeTab === 'tokens' && (
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm text-muted">共 {tokens.length} 个令牌</span>
                                    <button className="btn btn-primary btn-sm" onClick={() => setTokenModalOpen(true)}>
                                        <HiOutlinePlusCircle /> 签发令牌
                                    </button>
                                </div>
                                {tokens.length === 0 ? (
                                    <EmptyState title="暂无订阅令牌" subtitle="点击上方按钮签发新令牌" />
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>名称</th>
                                                    <th>状态</th>
                                                    <th>创建时间</th>
                                                    <th>过期时间</th>
                                                    <th>最后使用</th>
                                                    <th>操作</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tokens.map(t => (
                                                    <tr key={t.id}>
                                                        <td className="font-medium">{t.name || t.publicTokenId?.slice(0, 8) || '-'}</td>
                                                        <td>
                                                            <span className={`badge ${t.status === 'active' ? 'badge-success' : t.status === 'revoked' ? 'badge-danger' : 'badge-warning'}`}>
                                                                {t.status === 'active' ? '有效' : t.status === 'revoked' ? '已撤销' : '已过期'}
                                                            </span>
                                                        </td>
                                                        <td className="text-sm text-muted">{formatTime(t.createdAt)}</td>
                                                        <td className="text-sm text-muted">{t.expiresAt ? formatTime(t.expiresAt) : '永久'}</td>
                                                        <td className="text-sm text-muted">{formatTime(t.lastUsedAt)}</td>
                                                        <td>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    className="btn btn-secondary btn-sm btn-icon"
                                                                    title="复制 Token ID"
                                                                    onClick={() => { copyToClipboard(t.publicTokenId || t.id); toast.success('Token ID 已复制'); }}
                                                                >
                                                                    <HiOutlineClipboard />
                                                                </button>
                                                                {t.status === 'active' && (
                                                                    <button
                                                                        className="btn btn-danger btn-sm btn-icon"
                                                                        title="撤销"
                                                                        onClick={() => handleRevokeToken(t.id)}
                                                                    >
                                                                        <HiOutlineTrash />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Activity Tab */}
                        {activeTab === 'activity' && (
                            <div>
                                {timeline.length === 0 ? (
                                    <EmptyState title="暂无活动记录" subtitle="该用户尚无审计或访问记录" />
                                ) : (
                                    <div className="timeline-list">
                                        {timeline.map((item, i) => (
                                            <div key={i} className="timeline-item">
                                                <div className={`timeline-dot ${timelineOutcomeClass(item.outcome)}`} />
                                                <div className="timeline-content">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium">{item.event}</span>
                                                        <span className="timeline-time">{formatTime(item.ts)}</span>
                                                    </div>
                                                    {item.detail && <div className="text-sm text-muted mt-1 truncate">{item.detail}</div>}
                                                    {item.ip && <div className="text-xs text-muted">IP: {item.ip}</div>}
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

            {/* Issue Token Modal */}
            {tokenModalOpen && (
                <div className="modal-overlay" onClick={() => setTokenModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">签发订阅令牌</h3>
                            <button className="modal-close" onClick={() => setTokenModalOpen(false)}><HiOutlineXMark /></button>
                        </div>
                        <form onSubmit={handleIssueToken}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">令牌名称</label>
                                    <input className="form-input" value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="例如: 主设备" />
                                </div>
                                <div className="form-group">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={tokenNoExpiry} onChange={e => setTokenNoExpiry(e.target.checked)} />
                                        <span className="text-sm">永不过期</span>
                                    </label>
                                </div>
                                {!tokenNoExpiry && (
                                    <div className="form-group">
                                        <label className="form-label">有效天数</label>
                                        <input type="number" className="form-input" value={tokenTtlDays} onChange={e => setTokenTtlDays(Number(e.target.value))} min={1} max={3650} />
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setTokenModalOpen(false)}>取消</button>
                                <button type="submit" className="btn btn-primary" disabled={tokenIssuing}>
                                    {tokenIssuing ? <span className="spinner" /> : <><HiOutlineKey /> 签发</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
