import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ClientIpModal from '../UI/ClientIpModal.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import { formatBytes, copyToClipboard, formatDateOnly, formatDateTime } from '../../utils/format.js';
import { resolveAccessGeoDisplay } from '../../utils/accessGeo.js';
import { mergeInboundClientStats } from '../../utils/inboundClients.js';
import { isUnsupportedPanelClientIpsError, normalizePanelClientIps } from '../../utils/panelClientIps.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import SubscriptionClientLinks from '../Subscriptions/SubscriptionClientLinks.jsx';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import { QRCodeSVG } from 'qrcode.react';
import {
    HiOutlineArrowLeft,
    HiOutlineClipboard,
    HiOutlineNoSymbol,
    HiOutlinePlayCircle,
    HiOutlineCalendarDays,
    HiOutlineClock,
    HiOutlineEnvelope,
    HiOutlineShieldCheck,
    HiOutlineKey,
    HiOutlineArrowPath,
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

function formatTime(ts, locale = 'zh-CN') {
    return formatDateTime(ts, locale);
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
        const geoDisplay = resolveAccessGeoDisplay(item);
        if (item.reason) parts.push(item.reason);
        if (item.mode) parts.push(`模式 ${item.mode}`);
        if (item.format) parts.push(`格式 ${item.format}`);
        if (geoDisplay.location && geoDisplay.location !== '-') parts.push(`地区 ${geoDisplay.location}`);
        if (geoDisplay.carrier) parts.push(`运营商 ${geoDisplay.carrier}`);
        return parts.join(' · ');
    }

    if (item.summary) parts.push(item.summary);
    if (item.path) parts.push(item.path);
    return parts.join(' · ');
}

function normalizeDetailTab(value) {
    const text = String(value || '').trim().toLowerCase();
    if (['overview', 'subscription', 'clients', 'activity'].includes(text)) {
        return text;
    }
    return 'overview';
}

export default function UserDetail() {
    const { locale, t } = useI18n();
    const { userId } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirmAction = useConfirm();

    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const [activeTab, setActiveTab] = useState(() => normalizeDetailTab(searchParams.get('tab')));

    const [subscriptionLoading, setSubscriptionLoading] = useState(false);
    const [subscriptionResult, setSubscriptionResult] = useState(null);
    const [subscriptionProfileKey, setSubscriptionProfileKey] = useState('v2rayn');
    const [subscriptionResetLoading, setSubscriptionResetLoading] = useState(false);

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

    const applyTab = (tabKey) => {
        const normalized = normalizeDetailTab(tabKey);
        setActiveTab(normalized);
        const nextParams = new URLSearchParams(searchParams);
        if (normalized === 'overview') {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', normalized);
        }
        setSearchParams(nextParams, { replace: true });
    };

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

    const loadSubscription = async (options = {}) => {
        const quiet = options.quiet === true;
        const email = String(
            detail?.user?.subscriptionEmail
            || detail?.user?.email
            || ''
        ).trim().toLowerCase();

        if (!email) {
            setSubscriptionResult(null);
            return;
        }

        setSubscriptionLoading(true);
        try {
            const res = await api.get(`/subscriptions/${encodeURIComponent(email)}`);
            const payload = res.data?.obj || {};
            const bundle = buildSubscriptionProfileBundle(payload);
            setSubscriptionResult({
                email: payload.email || email,
                total: Number(payload.total || 0),
                sourceMode: payload.sourceMode || 'unknown',
                bundle,
                mergedUrl: bundle.mergedUrl,
                subscriptionActive: payload.subscriptionActive !== false,
                inactiveReason: payload.inactiveReason || '',
                filteredExpired: Number(payload.filteredExpired || 0),
                filteredDisabled: Number(payload.filteredDisabled || 0),
                filteredByPolicy: Number(payload.filteredByPolicy || 0),
                matchedClientsRaw: Number(payload.matchedClientsRaw || 0),
                matchedClientsActive: Number(payload.matchedClientsActive || 0),
                token: payload.token || null,
            });
            if (bundle.defaultProfileKey) {
                setSubscriptionProfileKey(bundle.defaultProfileKey);
            }
        } catch (err) {
            setSubscriptionResult(null);
            if (!quiet) {
                toast.error(err.response?.data?.msg || '加载订阅详情失败');
            }
        }
        setSubscriptionLoading(false);
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
        const nextTab = normalizeDetailTab(searchParams.get('tab'));
        setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
    }, [searchParams]);

    useEffect(() => {
        if (detail) {
            fetchClients();
        }
    }, [detail]);

    useEffect(() => {
        if (detail) {
            loadSubscription({ quiet: true });
        }
    }, [detail]);

    const user = detail?.user;
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
            if (details.expiryTime > 0) summaryParts.push(`到期 ${formatDateOnly(details.expiryTime, locale)}`);
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
                ipLocation: e.ipLocation || '',
                ipCarrier: e.ipCarrier || '',
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
    const activeSubscriptionProfile = useMemo(
        () => findSubscriptionProfile(subscriptionResult?.bundle, subscriptionProfileKey),
        [subscriptionResult, subscriptionProfileKey]
    );

    const handleCopySubscription = async () => {
        if (!activeSubscriptionProfile?.url) {
            toast.error('暂无可复制订阅地址');
            return;
        }
        await copyToClipboard(activeSubscriptionProfile.url);
        toast.success(`${activeSubscriptionProfile.label} 订阅地址已复制`);
    };

    const handleResetSubscription = async () => {
        const targetEmail = String(subscriptionResult?.email || user?.subscriptionEmail || user?.email || '').trim().toLowerCase();
        if (!targetEmail) return;

        const ok = await confirmAction({
            title: '重置订阅链接',
            message: '重置后旧订阅地址会立即失效，客户端需要重新导入新地址。',
            details: `目标邮箱: ${targetEmail}`,
            confirmText: '确认重置',
            tone: 'danger',
        });
        if (!ok) return;

        setSubscriptionResetLoading(true);
        try {
            await api.post(`/subscriptions/${encodeURIComponent(targetEmail)}/reset-link`, {});
            toast.success('订阅链接已重置');
            await Promise.all([
                loadSubscription({ quiet: true }),
                fetchDetail(),
            ]);
        } catch (err) {
            toast.error(err.response?.data?.msg || '重置订阅链接失败');
        }
        setSubscriptionResetLoading(false);
    };

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
        { key: 'subscription', label: '订阅' },
        { key: 'clients', label: '节点' },
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
                                    <HiOutlineKey /> 用户 ID: {user.id}
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-xs btn-icon"
                                        title="复制完整用户 ID"
                                        onClick={async () => {
                                            await copyToClipboard(user.id);
                                            toast.success('用户 ID 已复制');
                                        }}
                                    >
                                        <HiOutlineClipboard />
                                    </button>
                                </div>
                                <div className="user-profile-meta-item">
                                    <HiOutlineCalendarDays /> 注册: {formatTime(user.createdAt, locale)}
                                </div>
                                <div className="user-profile-meta-item">
                                    <HiOutlineClock /> 最后登录: {formatTime(user.lastLoginAt, locale)}
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
                                onClick={() => applyTab(t.key)}
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
                                    <StatCard label="节点数" value={clientSummaryLoading ? null : clientData.length} />
                                    <StatCard label="订阅访问" value={detail?.subscriptionAccess?.total || 0} />
                                    <StatCard label="审计记录" value={detail?.recentAudit?.total || 0} />
                                </div>
                                {clientSummaryLoading && (
                                    <p className="text-muted text-sm mb-4">节点汇总加载中...</p>
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

                        {activeTab === 'subscription' && (
                            <div>
                                <SectionHeader
                                    className="mb-4"
                                    compact
                                    title="订阅地址"
                                    meta={subscriptionResult && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`badge ${subscriptionResult.subscriptionActive ? 'badge-success' : 'badge-danger'}`}>
                                                {subscriptionResult.subscriptionActive ? '可用' : '失效'}
                                            </span>
                                            {subscriptionResult.inactiveReason ? (
                                                <span className="text-xs text-muted">{subscriptionResult.inactiveReason}</span>
                                            ) : null}
                                        </div>
                                    )}
                                    actions={(
                                        <div className="flex gap-2 flex-wrap">
                                            <button className="btn btn-secondary btn-sm" onClick={() => loadSubscription()} disabled={subscriptionLoading}>
                                                {subscriptionLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新</>}
                                            </button>
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={handleResetSubscription}
                                                disabled={subscriptionResetLoading || !subscriptionResult?.email}
                                            >
                                                {subscriptionResetLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 重置链接</>}
                                            </button>
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={handleCopySubscription}
                                                disabled={!activeSubscriptionProfile?.url || subscriptionResult?.subscriptionActive === false}
                                            >
                                                <HiOutlineClipboard /> 复制地址
                                            </button>
                                        </div>
                                    )}
                                />

                                {subscriptionLoading && !subscriptionResult ? (
                                    <SkeletonTable rows={3} cols={3} />
                                ) : !subscriptionResult ? (
                                    <EmptyState title="暂无订阅信息" subtitle="该用户尚未生成可用订阅地址" />
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        <div className="subscription-link-grid">
                                            <div className="card p-4 user-detail-subscription-card">
                                                <div className="text-sm font-medium mb-3">订阅资料</div>
                                                <div className="subscription-inline-tip user-detail-subscription-tip">
                                                    直接告诉用户：选类型 -&gt; 复制地址 -&gt; 导入客户端。
                                                </div>
                                                <div className="flex gap-2 flex-wrap mb-3">
                                                    {(subscriptionResult.bundle?.availableProfiles || []).map((item) => (
                                                        <button
                                                            key={item.key}
                                                            type="button"
                                                            className={`btn btn-sm ${subscriptionProfileKey === item.key ? 'btn-primary' : 'btn-secondary'}`}
                                                            onClick={() => setSubscriptionProfileKey(item.key)}
                                                        >
                                                            {item.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">当前地址</label>
                                                    <input
                                                        className="form-input font-mono"
                                                        value={activeSubscriptionProfile?.url || ''}
                                                        readOnly
                                                        placeholder="当前格式暂无可用订阅地址"
                                                    />
                                                </div>
                                                <div className="text-xs text-muted">
                                                    订阅邮箱: {subscriptionResult.email}
                                                    {subscriptionResult.bundle?.externalConverterConfigured ? ' · 已启用外部订阅转换器' : ' · 使用 NMS 内置订阅生成'}
                                                </div>
                                                <div className="text-xs text-muted mt-1">
                                                    活跃节点 {subscriptionResult.matchedClientsActive || 0} / 匹配节点 {subscriptionResult.matchedClientsRaw || 0}
                                                </div>
                                                {(subscriptionResult.filteredExpired > 0 || subscriptionResult.filteredDisabled > 0 || subscriptionResult.filteredByPolicy > 0) && (
                                                    <div className="text-xs text-muted mt-1">
                                                        已过滤: 过期 {subscriptionResult.filteredExpired || 0} / 禁用 {subscriptionResult.filteredDisabled || 0} / 策略限制 {subscriptionResult.filteredByPolicy || 0}
                                                    </div>
                                                )}
                                                <div className="user-detail-subscription-guides">
                                                    <div className="text-sm font-medium">就这三步</div>
                                                    <div className="text-xs text-muted">选类型，复制地址，导入客户端。</div>
                                                    <SubscriptionClientLinks
                                                        bundle={subscriptionResult.bundle}
                                                        compact
                                                        showHeading={false}
                                                    />
                                                </div>
                                            </div>

                                            <div className="card p-4">
                                                <div className="text-sm font-medium mb-3">二维码</div>
                                                {activeSubscriptionProfile?.url ? (
                                                    <div className="flex flex-col items-center gap-3">
                                                        <div className="rounded-xl p-3 bg-white">
                                                            <QRCodeSVG value={activeSubscriptionProfile.url} size={180} />
                                                        </div>
                                                        <div className="text-xs text-muted text-center">
                                                            使用 {activeSubscriptionProfile.label} 扫码导入
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-muted">当前格式暂无二维码</div>
                                                )}
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
                                    <EmptyState title="暂无节点记录" subtitle="该用户在各节点上还没有关联配置" />
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
                                                        ? '该节点记录缺少邮箱标识'
                                                        : (clientIpUnsupported ? supportState.reason : '查看该用户在当前节点上的代理访问 IP');
                                                    return (
                                                    <tr key={i}>
                                                        <td data-label="服务器">{c.serverName}</td>
                                                        <td data-label="入站">{c.inboundRemark || c.inboundId}</td>
                                                        <td data-label="协议"><span className="badge badge-neutral">{c.protocol}</span></td>
                                                        <td data-label="流量">{formatBytes((c.up || 0) + (c.down || 0))}</td>
                                                        <td data-label="到期时间">{c.expiryTime > 0 ? formatDateOnly(c.expiryTime, locale) : '永久'}</td>
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
                                                        <span className="timeline-time">{formatTime(item.ts, locale)}</span>
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
