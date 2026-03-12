import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ClientIpModal from '../UI/ClientIpModal.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { formatBytes, copyToClipboard } from '../../utils/format.js';
import { mergeInboundClientStats } from '../../utils/inboundClients.js';
import { isUnsupportedPanelClientIpsError, normalizePanelClientIps } from '../../utils/panelClientIps.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
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
    HiOutlineGlobeAlt,
} from 'react-icons/hi2';

function UserAvatar({ username }) {
    const initial = String(username || '?').charAt(0).toUpperCase();
    return <div className="user-avatar user-avatar-lg">{initial}</div>;
}

function StatCard({ label, value }) {
    const animated = useAnimatedCounter(typeof value === 'number' ? value : 0);
    return (
        <div className="stat-mini-card">
            <div className="stat-mini-value">{typeof value === 'number' ? animated : '...'}</div>
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

function normalizeAccessOutcome(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'success' || value === 'ok') return 'success';
    if (value === 'expired') return 'expired';
    if (value === 'revoked') return 'revoked';
    return 'failed';
}

const AUDIT_EVENT_LABELS = {
    login_success: '登录成功',
    login_failed: '登录失败',
    login_denied_email_unverified: '登录被拒绝',
    login_denied_user_disabled: '登录被拒绝',
    password_changed: '修改密码',
    user_updated: '更新用户资料',
    user_enabled: '启用用户',
    user_disabled: '停用用户',
    user_deleted: '删除用户',
    user_subscription_binding_updated: '更新订阅绑定',
    user_subscription_provisioned: '开通订阅',
    user_expiry_updated: '更新到期时间',
    user_password_reset_by_admin: '管理员重置密码',
    user_policy_updated: '更新用户策略',
    subscription_token_issued: '签发订阅令牌',
    subscription_token_revoked: '撤销订阅令牌',
};

function formatTimelineTitle(item) {
    if (item.type === 'access') return '订阅访问';
    return AUDIT_EVENT_LABELS[item.eventKey] || item.eventKey || '审计事件';
}

function formatOutcomeLabel(item) {
    if (item.type === 'access') {
        if (item.accessStatus === 'success' || item.accessStatus === 'ok') return '成功';
        if (item.accessStatus === 'expired') return '已过期';
        if (item.accessStatus === 'revoked') return '已撤销';
        return '失败';
    }
    if (item.outcome === 'success' || item.outcome === 'ok') return '成功';
    if (item.outcome === 'failed' || item.outcome === 'denied') return '失败';
    if (item.outcome === 'info') return '信息';
    return '未知';
}

function formatSummaryText(item) {
    const parts = [];

    if (item.type === 'access') {
        if (item.reason) parts.push(item.reason);
        if (item.mode) parts.push(`模式 ${item.mode}`);
        if (item.format) parts.push(`格式 ${item.format}`);
        if (item.cfCountry) parts.push(`地区 ${item.cfCountry}`);
        return parts.join(' · ');
    }

    if (item.summary) parts.push(item.summary);
    if (item.path) parts.push(item.path);
    return parts.join(' · ');
}

export default function UserDetail() {
    const { t } = useI18n();
    const { userId } = useParams();
    const navigate = useNavigate();
    const confirmAction = useConfirm();

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
    const [clientIpSupportByServer, setClientIpSupportByServer] = useState({});
    const [clientIpModal, setClientIpModal] = useState({
        open: false,
        serverId: '',
        serverName: '',
        email: '',
        title: '',
        subtitle: '',
        items: [],
        loading: false,
        clearing: false,
        error: '',
    });

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
        if (!detail?.user?.subscriptionEmail && !detail?.user?.email) {
            setClientData([]);
            return;
        }
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
                        const ibClients = mergeInboundClientStats(ib);
                        if (ibClients.length === 0) continue;
                        const protocol = String(ib.protocol || '').toLowerCase();
                        for (const cl of ibClients) {
                            if ((cl.email || '').toLowerCase() === email) {
                                clients.push({
                                    serverId: server.id,
                                    serverName: server.name,
                                    inboundId: ib.id,
                                    inboundRemark: ib.remark || '',
                                    email: cl.email || email,
                                    protocol,
                                    port: ib.port,
                                    up: Number(cl.up) || 0,
                                    down: Number(cl.down) || 0,
                                    expiryTime: Number(cl.expiryTime) || 0,
                                    enable: cl.enable !== false,
                                });
                            }
                        }
                    }
                } catch {}
            }));

            setClientData(clients);
        } catch {
            setClientData([]);
        }
        setClientsLoading(false);
    };

    useEffect(() => {
        fetchDetail();
    }, [userId]);

    useEffect(() => {
        if (detail) {
            fetchClients();
        }
    }, [detail]);

    const user = detail?.user;
    const tokens = detail?.tokens || [];
    const recentAudit = detail?.recentAudit?.items || [];
    const subscriptionAccess = detail?.subscriptionAccess?.items || [];
    const clientSummaryLoading = !!detail && clientsLoading && clientData.length === 0;

    // Merge audit + subscription access into timeline
    const timeline = useMemo(() => {
        if (!detail) return [];
        const items = [];
        recentAudit.forEach(e => {
            const details = e.details || {};
            const summaryParts = [];
            if (details.targetUsername) summaryParts.push(`目标 ${details.targetUsername}`);
            if (details.subscriptionEmail && details.subscriptionEmail !== details.email) summaryParts.push(`订阅邮箱 ${details.subscriptionEmail}`);
            if (typeof details.enabled === 'boolean') summaryParts.push(details.enabled ? '状态 已启用' : '状态 已停用');
            if (details.expiryTime > 0) summaryParts.push(`到期 ${new Date(details.expiryTime).toLocaleDateString('zh-CN')}`);
            if (typeof details.allowedServerCount === 'number') summaryParts.push(`服务器 ${details.allowedServerCount}`);
            if (typeof details.allowedProtocolCount === 'number') summaryParts.push(`协议 ${details.allowedProtocolCount}`);
            if (typeof details.limitIp === 'number' && details.limitIp > 0) summaryParts.push(`限 IP ${details.limitIp}`);
            if (typeof details.trafficLimitBytes === 'number' && details.trafficLimitBytes > 0) summaryParts.push(`限流量 ${formatBytes(details.trafficLimitBytes)}`);
            if (typeof details.updated === 'number' || typeof details.failed === 'number') {
                summaryParts.push(`部署 ${Number(details.updated || 0)} 成功 / ${Number(details.failed || 0)} 失败`);
            }
            if (details.cleanupError) summaryParts.push(`清理异常 ${details.cleanupError}`);

            items.push({
                id: `audit-${e.id || `${e.ts}-${e.eventType}`}`,
                ts: e.ts,
                type: 'audit',
                eventKey: e.eventType,
                outcome: e.outcome,
                path: e.path || '',
                ip: e.ip,
                actor: e.actor || '',
                serverId: e.serverId || '',
                tokenId: details.publicTokenId || details.tokenId || '',
                userAgent: details.userAgent || '',
                summary: summaryParts.join(' · '),
            });
        });
        subscriptionAccess.forEach(e => {
            items.push({
                id: `access-${e.id || `${e.ts}-${e.tokenId || e.ip}`}`,
                ts: e.ts,
                type: 'access',
                eventKey: 'subscription_access',
                accessStatus: e.status,
                outcome: normalizeAccessOutcome(e.status),
                reason: e.reason || '',
                ip: e.clientIp || e.ip,
                tokenId: e.tokenId || '',
                serverId: e.serverId || '',
                userAgent: e.userAgent || '',
                cfCountry: e.cfCountry || '',
                mode: e.mode || '',
                format: e.format || '',
            });
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
                const message = res.data?.msg || `用户已${newEnabled ? '启用' : '停用'}`;
                if (res.data?.obj?.partialFailure) {
                    toast.error(message);
                } else {
                    toast.success(message);
                }
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

    const closeClientIpModal = () => {
        setClientIpModal({
            open: false,
            serverId: '',
            serverName: '',
            email: '',
            title: '',
            subtitle: '',
            items: [],
            loading: false,
            clearing: false,
            error: '',
        });
    };

    const loadClientIps = async (target, options = {}) => {
        if (!target?.serverId || !target?.email) return;
        const supportState = clientIpSupportByServer[target.serverId];
        if (supportState?.supported === false) return;

        if (options.preserveOpen !== true) {
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                serverId: target.serverId,
                serverName: target.serverName || '',
                email: target.email,
                title: `节点访问 IP — ${target.serverName || target.serverId}`,
                subtitle: `${target.email} · 节点级记录${target.inboundRemark ? ` · 入站 ${target.inboundRemark}` : ''}`,
                items: [],
                loading: true,
                clearing: false,
                error: '',
            }));
        } else {
            setClientIpModal((prev) => ({
                ...prev,
                loading: true,
                error: '',
            }));
        }

        try {
            const res = await api.post(`/panel/${encodeURIComponent(target.serverId)}/panel/api/inbounds/clientIps/${encodeURIComponent(target.email)}`);
            const items = normalizePanelClientIps(res.data?.obj);
            setClientIpSupportByServer((prev) => ({
                ...prev,
                [target.serverId]: { supported: true, reason: '' },
            }));
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                serverId: target.serverId,
                serverName: target.serverName || '',
                email: target.email,
                title: `节点访问 IP — ${target.serverName || target.serverId}`,
                subtitle: `${target.email} · 节点级记录${target.inboundRemark ? ` · 入站 ${target.inboundRemark}` : ''}`,
                items,
                loading: false,
                error: '',
            }));
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '加载节点访问 IP 失败';
            if (isUnsupportedPanelClientIpsError(err)) {
                setClientIpSupportByServer((prev) => ({
                    ...prev,
                    [target.serverId]: {
                        supported: false,
                        reason: msg || '当前节点的 3x-ui 版本不支持节点 IP 接口',
                    },
                }));
            }
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: msg,
                items: [],
            }));
            toast.error(msg);
        }
    };

    const clearClientIps = async () => {
        if (!clientIpModal.serverId || !clientIpModal.email) return;
        const ok = await confirmAction({
            title: '清空节点访问 IP',
            message: `确定清空 ${clientIpModal.email} 在 ${clientIpModal.serverName || clientIpModal.serverId} 的节点访问 IP 记录吗？`,
            confirmText: '确认清空',
            tone: 'danger',
        });
        if (!ok) return;

        setClientIpModal((prev) => ({
            ...prev,
            clearing: true,
            error: '',
        }));

        try {
            await api.post(`/panel/${encodeURIComponent(clientIpModal.serverId)}/panel/api/inbounds/clearClientIps/${encodeURIComponent(clientIpModal.email)}`);
            toast.success('节点访问 IP 记录已清空');
            await loadClientIps({
                serverId: clientIpModal.serverId,
                serverName: clientIpModal.serverName,
                email: clientIpModal.email,
                inboundRemark: '',
                inboundId: '',
            }, { preserveOpen: true });
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '清空节点访问 IP 失败';
            setClientIpModal((prev) => ({
                ...prev,
                clearing: false,
                error: msg,
            }));
            toast.error(msg);
            return;
        }

        setClientIpModal((prev) => ({
            ...prev,
            clearing: false,
        }));
    };

    if (loading) {
        return (
            <>
                <Header
                    title={t('pages.userDetail.title')}
                    subtitle={t('pages.userDetail.subtitle')}
                    eyebrow={t('pages.userDetail.eyebrow')}
                />
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
                <Header
                    title={t('pages.userDetail.title')}
                    subtitle={t('pages.userDetail.subtitle')}
                    eyebrow={t('pages.userDetail.eyebrow')}
                />
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
            <Header
                title={t('pages.userDetail.titleWithName', { name: user.username })}
                subtitle={t('pages.userDetail.subtitle')}
                eyebrow={t('pages.userDetail.eyebrow')}
            />
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
                            <div className="user-profile-badges">
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
                                    <StatCard label="总流量" value={clientSummaryLoading ? null : (totalTraffic > 0 ? Math.round(totalTraffic / (1024 * 1024)) : 0)} />
                                    <StatCard label="客户端数" value={clientSummaryLoading ? null : clientData.length} />
                                    <StatCard label="Token 数" value={tokens.length} />
                                    <StatCard label="审计记录" value={detail?.recentAudit?.total || 0} />
                                </div>
                                {clientSummaryLoading && (
                                    <p className="text-muted text-sm mb-4">客户端汇总加载中...</p>
                                )}
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
                                {Object.values(clientIpSupportByServer).some((item) => item?.supported === false) && (
                                    <div className="text-xs text-muted mb-3">旧版 3x-ui 节点不支持 `clientIps` 接口时，节点 IP 按钮会自动禁用。</div>
                                )}
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
                                                    <th>操作</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {clientData.map((c, i) => {
                                                    const supportState = clientIpSupportByServer[c.serverId];
                                                    const clientIpUnsupported = supportState?.supported === false;
                                                    const clientIpDisabled = !c.email || clientIpUnsupported;
                                                    const clientIpTitle = !c.email
                                                        ? '该客户端缺少邮箱标识'
                                                        : (clientIpUnsupported ? supportState.reason : '查看该用户在当前节点上的代理访问 IP');
                                                    return (
                                                    <tr key={i}>
                                                        <td data-label="服务器">{c.serverName}</td>
                                                        <td data-label="入站">{c.inboundRemark || c.inboundId}</td>
                                                        <td data-label="协议"><span className="badge badge-neutral">{c.protocol}</span></td>
                                                        <td data-label="流量">{formatBytes((c.up || 0) + (c.down || 0))}</td>
                                                        <td data-label="到期时间">{c.expiryTime > 0 ? new Date(c.expiryTime).toLocaleDateString('zh-CN') : '永久'}</td>
                                                        <td data-label="状态"><span className={`badge ${c.enable ? 'badge-success' : 'badge-danger'}`}>{c.enable ? '启用' : '禁用'}</span></td>
                                                        <td data-label="操作" className="table-cell-actions">
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => loadClientIps(c)}
                                                                disabled={clientIpDisabled}
                                                                title={clientIpTitle}
                                                            >
                                                                <HiOutlineGlobeAlt /> 节点 IP
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tokens Tab */}
                        {activeTab === 'tokens' && (
                            <div>
                                <SectionHeader
                                    className="mb-4"
                                    compact
                                    title="订阅令牌"
                                    meta={<span className="text-sm text-muted">共 {tokens.length} 个令牌</span>}
                                    actions={(
                                        <button className="btn btn-primary btn-sm" onClick={() => setTokenModalOpen(true)}>
                                            <HiOutlinePlusCircle /> 签发令牌
                                        </button>
                                    )}
                                />
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
                                                        <td data-label="名称" className="font-medium">{t.name || t.publicTokenId?.slice(0, 8) || '-'}</td>
                                                        <td data-label="状态">
                                                            <span className={`badge ${t.status === 'active' ? 'badge-success' : t.status === 'revoked' ? 'badge-danger' : 'badge-warning'}`}>
                                                                {t.status === 'active' ? '有效' : t.status === 'revoked' ? '已撤销' : '已过期'}
                                                            </span>
                                                        </td>
                                                        <td data-label="创建时间" className="text-sm text-muted">{formatTime(t.createdAt)}</td>
                                                        <td data-label="过期时间" className="text-sm text-muted">{t.expiresAt ? formatTime(t.expiresAt) : '永久'}</td>
                                                        <td data-label="最后使用" className="text-sm text-muted">{formatTime(t.lastUsedAt)}</td>
                                                        <td data-label="操作" className="table-cell-actions">
                                                            <div className="table-row-actions">
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
                                                <div key={item.id || i} className="timeline-item">
                                                    <div className={`timeline-dot ${timelineOutcomeClass(item.outcome)}`} />
                                                    <div className="timeline-content">
                                                    <div className="timeline-head">
                                                        <span className="font-medium">{formatTimelineTitle(item)}</span>
                                                        <span className="timeline-time">{formatTime(item.ts)}</span>
                                                    </div>
                                                    <div className="flex gap-2 flex-wrap mt-2">
                                                        <span className={`badge ${item.type === 'access' ? 'badge-info' : 'badge-neutral'}`}>
                                                            {item.type === 'access' ? '订阅访问' : '审计事件'}
                                                        </span>
                                                        <span className={`badge ${item.outcome === 'success' || item.outcome === 'ok' ? 'badge-success' : item.outcome === 'failed' || item.outcome === 'denied' ? 'badge-danger' : 'badge-neutral'}`}>
                                                            {formatOutcomeLabel(item)}
                                                        </span>
                                                        {item.actor && <span className="badge badge-neutral">操作者 {item.actor}</span>}
                                                        {item.serverId && <span className="badge badge-info">节点 {item.serverId}</span>}
                                                        {item.tokenId && <span className="badge badge-neutral">Token {item.tokenId}</span>}
                                                    </div>
                                                    {formatSummaryText(item) && <div className="text-sm text-muted mt-2">{formatSummaryText(item)}</div>}
                                                    <div className="text-xs text-muted mt-1">
                                                        {item.ip ? `IP: ${item.ip}` : 'IP: -'}
                                                        {item.userAgent ? ` · UA: ${item.userAgent}` : ''}
                                                    </div>
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
                <ModalShell isOpen={tokenModalOpen} onClose={() => setTokenModalOpen(false)}>
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
                </ModalShell>
            )}

            <ClientIpModal
                isOpen={clientIpModal.open}
                title={clientIpModal.title}
                subtitle={clientIpModal.subtitle}
                loading={clientIpModal.loading}
                clearing={clientIpModal.clearing}
                items={clientIpModal.items}
                error={clientIpModal.error}
                onClose={closeClientIpModal}
                onRefresh={() => loadClientIps({
                    serverId: clientIpModal.serverId,
                    serverName: clientIpModal.serverName,
                    email: clientIpModal.email,
                    inboundRemark: '',
                    inboundId: '',
                }, { preserveOpen: true })}
                onClear={clientIpSupportByServer[clientIpModal.serverId]?.supported === false ? undefined : clearClientIps}
            />
        </>
    );
}
