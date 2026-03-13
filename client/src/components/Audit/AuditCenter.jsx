import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    HiOutlineArrowPath,
    HiOutlineEye,
    HiOutlineChartBarSquare,
    HiOutlineUsers,
    HiOutlineSignal,
    HiOutlineDocumentText,
    HiOutlineTrash,
    HiOutlineArrowDownTray,
    HiOutlineXMark,
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
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import { resolveAccessGeoDisplay } from '../../utils/accessGeo.js';

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', { hour12: false });
}

function statusBadgeClass(status) {
    const normalized = normalizeAuditStatus(status);
    if (normalized === 'success') return 'badge-success';
    if (normalized === 'info') return 'badge-info';
    if (normalized === 'failed' || normalized === 'denied' || normalized === 'revoked' || normalized === 'expired') return 'badge-danger';
    return 'badge-neutral';
}

function normalizeAuditStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'ok') return 'success';
    return normalized;
}

function formatAuditStatusLabel(value) {
    const normalized = normalizeAuditStatus(value);
    if (!normalized) return '-';
    if (normalized === 'success') return '成功';
    if (normalized === 'failed') return '失败';
    if (normalized === 'denied') return '已拒绝';
    if (normalized === 'revoked') return '已撤销';
    if (normalized === 'expired') return '已过期';
    if (normalized === 'info') return '信息';
    return String(value || '-');
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

function formatTrafficUserLabel(item) {
    const displayLabel = String(item?.displayLabel || '').trim();
    if (displayLabel) return displayLabel;
    const username = String(item?.username || '').trim();
    const email = String(item?.email || '').trim();
    if (username && email) return `${username} · ${email}`;
    return username || email || '-';
}

const AUDIT_EVENT_LABELS = {
    'zh-CN': {
        login_success: '登录成功',
        login_failed: '登录失败',
        login_denied_email_unverified: '登录拒绝 · 邮箱未验证',
        login_denied_user_disabled: '登录拒绝 · 账号已停用',
        login_rate_limited: '登录频率限制',
        register_rate_limited: '注册频率限制',
        user_registered: '用户注册',
        user_created: '创建用户',
        user_updated: '更新用户资料',
        user_enabled: '启用用户',
        user_disabled: '停用用户',
        user_deleted: '删除用户',
        user_expiry_updated: '更新到期时间',
        user_subscription_binding_updated: '更新订阅绑定',
        user_subscription_provisioned: '开通订阅',
        user_password_reset_by_admin: '管理员重置密码',
        user_policy_updated: '更新用户策略',
        verification_email_sent: '发送验证邮件',
        verification_email_failed: '验证邮件发送失败',
        email_verified: '邮箱验证成功',
        password_reset_request_rate_limited: '重置请求频率限制',
        password_reset_email_sent: '发送密码重置邮件',
        password_reset_code_sent: '发送密码重置验证码',
        password_reset_email_failed: '密码重置邮件发送失败',
        password_reset_completed: '完成密码重置',
        password_changed: '修改密码',
        invite_code_created: '创建邀请码',
        invite_code_revoked: '撤销邀请码',
        smtp_connection_verified: '验证 SMTP 连接',
        system_backup_exported: '导出系统备份',
        system_backup_restored: '恢复系统备份',
        system_settings_updated: '更新系统设置',
        server_health_monitor_run: '执行节点健康检查',
        server_order_updated: '更新节点顺序',
        inbound_order_updated: '更新入站顺序',
        user_order_updated: '更新用户顺序',
        batch_risk_token_issued: '签发高风险确认令牌',
        credentials_rotation: '轮换系统凭据',
        db_backfill: '数据库回填',
        db_mode_switched: '切换数据库模式',
        server_added: '添加节点',
        server_batch_added: '批量添加节点',
        server_updated: '更新节点',
        server_deleted: '删除节点',
        server_credentials_updated_via_test: '更新节点凭据',
        server_test_success: '节点连接测试成功',
        server_test_failed: '节点连接测试失败',
        servers_batch_update: '批量更新节点',
        subscription_token_issued: '签发订阅链接',
        subscription_token_auto_issued: '自动签发订阅链接',
        subscription_token_revoked: '撤销订阅链接',
        subscription_token_revoke_all: '撤销全部订阅链接',
        subscription_link_reset: '重置订阅链接',
        subscription_public_denied: '订阅访问被拒绝',
        subscription_public_denied_legacy: '旧版订阅访问被拒绝',
        client_entitlement_overridden: '覆盖客户端权限',
        client_entitlement_follow_policy: '客户端跟随策略',
        batch_history_cleared: '清空批量任务历史',
        batch_history_canceled: '取消批量任务',
        batch_clients_sensitive_action: '执行批量客户端敏感操作',
        batch_clients_high_risk_action: '执行批量客户端高风险操作',
        batch_inbounds_sensitive_action: '执行批量入站敏感操作',
        batch_inbounds_high_risk_action: '执行批量入站高风险操作',
        batch_sensitive_retry: '重试批量敏感任务',
        batch_high_risk_retry: '重试批量高风险任务',
    },
    'en-US': {
        login_success: 'Login Succeeded',
        login_failed: 'Login Failed',
        login_denied_email_unverified: 'Login Denied · Email Unverified',
        login_denied_user_disabled: 'Login Denied · User Disabled',
        login_rate_limited: 'Login Rate Limited',
        register_rate_limited: 'Registration Rate Limited',
        user_registered: 'User Registered',
        user_created: 'User Created',
        user_updated: 'User Updated',
        user_enabled: 'User Enabled',
        user_disabled: 'User Disabled',
        user_deleted: 'User Deleted',
        user_expiry_updated: 'Expiry Updated',
        user_subscription_binding_updated: 'Subscription Binding Updated',
        user_subscription_provisioned: 'Subscription Provisioned',
        user_password_reset_by_admin: 'Password Reset by Admin',
        user_policy_updated: 'User Policy Updated',
        verification_email_sent: 'Verification Email Sent',
        verification_email_failed: 'Verification Email Failed',
        email_verified: 'Email Verified',
        password_reset_request_rate_limited: 'Password Reset Rate Limited',
        password_reset_email_sent: 'Password Reset Email Sent',
        password_reset_code_sent: 'Password Reset Code Sent',
        password_reset_email_failed: 'Password Reset Email Failed',
        password_reset_completed: 'Password Reset Completed',
        password_changed: 'Password Changed',
        invite_code_created: 'Invite Code Created',
        invite_code_revoked: 'Invite Code Revoked',
        smtp_connection_verified: 'SMTP Connection Verified',
        system_backup_exported: 'System Backup Exported',
        system_backup_restored: 'System Backup Restored',
        system_settings_updated: 'System Settings Updated',
        server_health_monitor_run: 'Server Health Check Ran',
        server_order_updated: 'Server Order Updated',
        inbound_order_updated: 'Inbound Order Updated',
        user_order_updated: 'User Order Updated',
        batch_risk_token_issued: 'Risk Token Issued',
        credentials_rotation: 'Credentials Rotated',
        db_backfill: 'Database Backfill',
        db_mode_switched: 'Database Mode Switched',
        server_added: 'Server Added',
        server_batch_added: 'Servers Added in Batch',
        server_updated: 'Server Updated',
        server_deleted: 'Server Deleted',
        server_credentials_updated_via_test: 'Server Credentials Updated',
        server_test_success: 'Server Test Succeeded',
        server_test_failed: 'Server Test Failed',
        servers_batch_update: 'Servers Updated in Batch',
        subscription_token_issued: 'Subscription Link Issued',
        subscription_token_auto_issued: 'Subscription Link Auto-Issued',
        subscription_token_revoked: 'Subscription Link Revoked',
        subscription_token_revoke_all: 'All Subscription Links Revoked',
        subscription_link_reset: 'Subscription Link Reset',
        subscription_public_denied: 'Subscription Access Denied',
        subscription_public_denied_legacy: 'Legacy Subscription Access Denied',
        client_entitlement_overridden: 'Client Entitlement Overridden',
        client_entitlement_follow_policy: 'Client Follows Policy',
        batch_history_cleared: 'Batch History Cleared',
        batch_history_canceled: 'Batch Task Canceled',
        batch_clients_sensitive_action: 'Sensitive Client Batch Action',
        batch_clients_high_risk_action: 'High-Risk Client Batch Action',
        batch_inbounds_sensitive_action: 'Sensitive Inbound Batch Action',
        batch_inbounds_high_risk_action: 'High-Risk Inbound Batch Action',
        batch_sensitive_retry: 'Sensitive Batch Retry',
        batch_high_risk_retry: 'High-Risk Batch Retry',
    },
};

function formatAuditEventLabel(item, locale = 'zh-CN') {
    const normalizedLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';
    const eventType = String(item?.eventType || '').trim();
    return AUDIT_EVENT_LABELS[normalizedLocale][eventType] || eventType || '-';
}

function formatAuditActorLabel(item, locale = 'zh-CN') {
    const normalizedLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';
    const actor = String(item?.actor || '').trim();
    if (!actor) return '-';
    if (actor !== 'anonymous') return actor;

    const eventType = String(item?.eventType || '').trim();
    if (eventType.startsWith('subscription_public_')) {
        return normalizedLocale === 'en-US' ? 'Public Subscription Request' : '公开订阅请求';
    }
    if (eventType.startsWith('login_')
        || eventType.startsWith('register_')
        || eventType.startsWith('verification_')
        || eventType.startsWith('password_reset_')) {
        return normalizedLocale === 'en-US' ? 'Unauthenticated Request' : '未登录请求';
    }
    return normalizedLocale === 'en-US' ? 'Anonymous Request' : '匿名请求';
}

function formatAuditActorRole(role, locale = 'zh-CN') {
    const normalizedLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';
    const value = String(role || '').trim();
    if (!value) return '';
    if (value === 'admin') return normalizedLocale === 'en-US' ? 'Admin' : '管理员';
    if (value === 'user') return normalizedLocale === 'en-US' ? 'User' : '用户';
    if (value === 'anonymous') return normalizedLocale === 'en-US' ? 'Unauthenticated' : '未登录';
    return value;
}

function resolveAuditTarget(item) {
    return item?.targetEmail
        || item?.details?.email
        || item?.details?.subscriptionEmail
        || item?.details?.username
        || '-';
}

export default function AuditCenter() {
    const { locale, t } = useI18n();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirm = useConfirm();
    const validTabs = new Set(['events', 'tasks', 'traffic', 'subscriptions', 'logs']);
    const requestedTab = searchParams.get('tab');
    const tab = validTabs.has(requestedTab) ? requestedTab : 'events';

    const setTab = (nextTab) => {
        const normalized = validTabs.has(nextTab) ? nextTab : 'events';
        const next = new URLSearchParams(searchParams);
        if (normalized === 'events') {
            next.delete('tab');
        } else {
            next.set('tab', normalized);
        }
        setSearchParams(next, { replace: true });
    };

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

    const handleExportAuditCSV = async () => {
        try {
            const params = {};
            if (eventFilters.q) params.q = eventFilters.q;
            if (eventFilters.eventType) params.eventType = eventFilters.eventType;
            if (eventFilters.outcome) params.outcome = eventFilters.outcome;
            if (eventFilters.targetEmail) params.targetEmail = eventFilters.targetEmail;
            if (eventFilters.serverId) params.serverId = eventFilters.serverId;
            const res = await api.get('/audit/events/export', { params, responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('审计日志已导出');
        } catch {
            toast.error('导出失败');
        }
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
            <Header
                title={t('pages.audit.title')}
                subtitle={t('pages.audit.subtitle')}
                eyebrow={t('pages.audit.eyebrow')}
            />
            <div className="page-content page-enter page-content--wide">
                <div className="tabs mb-8 audit-tabs">
                    <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>
                        {t('comp.audit.tabEvents') || '操作记录'}
                    </button>
                    <button className={`tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
                        {t('comp.audit.tabTasks') || '批量任务'}
                    </button>
                    <button className={`tab ${tab === 'traffic' ? 'active' : ''}`} onClick={() => setTab('traffic')}>
                        流量统计
                    </button>
                    <button className={`tab ${tab === 'subscriptions' ? 'active' : ''}`} onClick={() => setTab('subscriptions')}>
                        订阅访问
                    </button>
                    <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
                        3x-ui 日志
                    </button>
                </div>

                {tab === 'events' && (
                    <div className="audit-events-layout">
                        <div className="audit-events-main">
                            <div className="card mb-6 p-3 audit-filter-card audit-filter-card-events">
                                <div className="audit-filter-bar flex gap-2 flex-wrap items-center">
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
                                        <option value="success">成功</option>
                                        <option value="failed">失败</option>
                                        <option value="info">信息</option>
                                    </select>
                                    <input
                                        className="form-input w-180"
                                        placeholder="用户 / 邮箱"
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
                                    <button className="btn btn-secondary btn-sm" onClick={handleExportAuditCSV} title="导出CSV">
                                        <HiOutlineArrowDownTray /> 导出
                                    </button>
                                </div>
                            </div>

                            <div className="table-container glass-panel mb-4 audit-table-shell audit-events-table-shell">
                                <table className="table audit-events-table">
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
                                            <tr><td colSpan={7}><SkeletonTable rows={5} cols={7} /></td></tr>
                                        ) : eventsData.items.length === 0 ? (
                                            <tr><td colSpan={7}><EmptyState title="暂无审计记录" subtitle="系统操作审计事件将在此显示" /></td></tr>
                                        ) : (
                                            eventsData.items.map((item) => (
                                                <tr key={item.id}>
                                                    <td data-label="时间">{formatDateTime(item.ts)}</td>
                                                    <td data-label="事件">{formatAuditEventLabel(item, locale)}</td>
                                                    <td data-label="结果"><span className={`badge ${statusBadgeClass(item.outcome)}`}>{formatAuditStatusLabel(item.outcome)}</span></td>
                                                    <td data-label="操作者">{formatAuditActorLabel(item, locale)}</td>
                                                    <td data-label="节点">{item.serverId || '-'}</td>
                                                    <td data-label="用户">{resolveAuditTarget(item)}</td>
                                                    <td data-label="操作" className="table-cell-actions">
                                                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setSelectedEvent(item)} title="查看详情" aria-label="查看详情">
                                                            <HiOutlineEye />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="audit-pagination page-pagination">
                                <div className="page-pagination-meta">共 {eventsData.total || 0} 条</div>
                                <div className="audit-pagination-actions page-pagination-actions">
                                    <button className="btn btn-secondary btn-sm" disabled={eventsPage <= 1 || eventsLoading} onClick={() => fetchEvents(eventsPage - 1)}>上一页</button>
                                    <span className="text-sm text-muted self-center">
                                        {eventsPage} / {eventsData.totalPages || 1}
                                    </span>
                                    <button className="btn btn-secondary btn-sm" disabled={eventsPage >= (eventsData.totalPages || 1) || eventsLoading} onClick={() => fetchEvents(eventsPage + 1)}>下一页</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {tab === 'tasks' && (
                    <div className="audit-operations-history">
                        <Tasks embedded />
                    </div>
                )}

                {tab === 'traffic' && (
                    <>
                        <PageToolbar
                            className="audit-traffic-toolbar mb-6"
                            main={(
                                <div className="audit-traffic-toolbar-copy">
                                    <div className="audit-traffic-sample-pill" title={formatDateTime(trafficOverview?.lastCollectionAt)}>
                                        <span className="audit-traffic-sample-label">最近采样</span>
                                        <span className="audit-traffic-sample-value">{formatDateTime(trafficOverview?.lastCollectionAt)}</span>
                                    </div>
                                </div>
                            )}
                            actions={(
                                <>
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
                                </>
                            )}
                        />

                        <div className="stats-grid mb-8 audit-stats-grid">
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">总流量</span><HiOutlineChartBarSquare /></div>
                                <div className="card-value">{formatBytes(trafficOverview?.totals?.totalBytes || 0)}</div>
                                <div className="text-sm text-muted">↑ {formatBytes(trafficOverview?.totals?.upBytes || 0)} / ↓ {formatBytes(trafficOverview?.totals?.downBytes || 0)}</div>
                            </div>
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">活跃账号</span><HiOutlineUsers /></div>
                                <div className="card-value">{trafficOverview?.activeUsers || 0}</div>
                            </div>
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">采样点</span><HiOutlineSignal /></div>
                                <div className="card-value">{trafficOverview?.sampleCount || 0}</div>
                            </div>
                        </div>

                        <div className="grid-auto-280-tight mb-8 audit-chart-grid">
                            <div className="card audit-chart-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title="用户流量趋势"
                                    actions={(
                                        <select
                                            className="form-select w-220"
                                            value={selectedUser}
                                            onChange={(e) => setSelectedUser(e.target.value)}
                                        >
                                            <option value="">请选择用户</option>
                                            {topUsers.map((item) => (
                                                <option key={item.email} value={item.email}>
                                                    {formatTrafficUserLabel(item)} ({formatBytes(item.totalBytes)})
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                />
                                {trafficOverview?.userLevelSupported === false && (
                                    <div className="text-xs text-muted mb-2">当前 3x-ui 数据仅支持节点级流量统计，未返回用户级流量明细。</div>
                                )}
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

                            <div className="card audit-chart-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title="节点流量趋势"
                                    actions={(
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
                                    )}
                                />
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

                        <div className="grid-auto-280-tight audit-leaderboard-grid">
                            <div className="card audit-leaderboard-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title="流量 Top 用户"
                                />
                                {trafficOverview?.userLevelSupported === false && (
                                    <div className="text-xs text-muted mb-2">当前节点列表未提供用户级流量计数。</div>
                                )}
                                <div className="table-container audit-nested-table-shell">
                                    <table className="table">
                                        <thead><tr><th>用户</th><th className="table-cell-right">流量</th></tr></thead>
                                        <tbody>
                                            {topUsers.length === 0 ? (
                                                <tr><td colSpan={2} className="text-center">暂无数据</td></tr>
                                            ) : topUsers.map((item) => (
                                                <tr key={item.email} className="cursor-pointer" onClick={() => setSelectedUser(item.email)}>
                                                    <td data-label="用户">{formatTrafficUserLabel(item)}</td>
                                                    <td data-label="流量" className="table-cell-right">{formatBytes(item.totalBytes)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="card audit-leaderboard-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title="流量 Top 节点"
                                />
                                <div className="table-container audit-nested-table-shell">
                                    <table className="table">
                                        <thead><tr><th>节点</th><th className="table-cell-right">流量</th></tr></thead>
                                        <tbody>
                                            {topServers.length === 0 ? (
                                                <tr><td colSpan={2} className="text-center">暂无数据</td></tr>
                                            ) : topServers.map((item) => (
                                                <tr key={item.serverId} className="cursor-pointer" onClick={() => setSelectedServerId(item.serverId)}>
                                                    <td data-label="节点">{item.serverName}</td>
                                                    <td data-label="流量" className="table-cell-right">{formatBytes(item.totalBytes)}</td>
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
                        <div className="card mb-8 p-3 audit-filter-card audit-filter-card-subscriptions">
                            <div className="flex gap-2 items-center flex-wrap audit-filter-bar">
                                <input
                                    className="form-input w-220"
                                    placeholder="用户 / 邮箱过滤"
                                    value={accessFilters.email}
                                    onChange={(e) => setAccessFilters((prev) => ({ ...prev, email: e.target.value }))}
                                />
                                <select
                                    className="form-select w-160"
                                        value={accessFilters.status}
                                        onChange={(e) => setAccessFilters((prev) => ({ ...prev, status: e.target.value }))}
                                    >
                                        <option value="">全部状态</option>
                                        <option value="success">成功</option>
                                        <option value="denied">已拒绝</option>
                                        <option value="expired">已过期</option>
                                        <option value="revoked">已撤销</option>
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

                        <div className="stats-grid mb-8 audit-stats-grid">
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">访问次数 (PV)</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.total || 0}</div>
                            </div>
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">独立 IP (UV)</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.uniqueIpCount || 0}</div>
                            </div>
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">访问用户数</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.uniqueUsers || 0}</div>
                            </div>
                            {Object.entries(accessData.statusBreakdown || {}).map(([key, value]) => (
                                <div className="card audit-stat-card" key={key}>
                                    <div className="card-header"><span className="card-title">{formatAuditStatusLabel(key)}</span><HiOutlineDocumentText /></div>
                                    <div className="card-value">{value}</div>
                                </div>
                            ))}
                        </div>

                        <div className="table-container glass-panel mb-8 audit-table-shell audit-subscriptions-table-shell">
                            <table className="table audit-subscriptions-table">
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th>用户</th>
                                        <th>状态</th>
                                        <th>真实 IP</th>
                                        <th>归属地 / 运营商</th>
                                        <th>UA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accessLoading ? (
                                        <tr><td colSpan={6}><SkeletonTable rows={5} cols={6} /></td></tr>
                                    ) : accessData.items.length === 0 ? (
                                        <tr><td colSpan={6}><EmptyState title="暂无访问记录" subtitle="订阅链接访问记录将在此显示" /></td></tr>
                                    ) : accessData.items.map((item) => {
                                        const geoDisplay = resolveAccessGeoDisplay(item);
                                        return (
                                        <tr key={item.id}>
                                            <td data-label="时间" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.ts)}</td>
                                            <td data-label="用户">
                                                <div className="audit-access-user">
                                                    <span className="audit-access-user-label">{item.userLabel || item.username || item.email || '-'}</span>
                                                    {item.email && item.email !== (item.userLabel || '') && (
                                                        <span className="audit-access-user-meta">{item.email}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td data-label="状态"><span className={`badge ${statusBadgeClass(item.status)}`}>{formatAuditStatusLabel(item.status)}</span></td>
                                            <td data-label="真实 IP" style={{ wordBreak: 'break-all' }}>
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-mono">{item.clientIp || item.ip || '-'}</span>
                                                    {item.ipSource && <span className="badge badge-neutral text-xs w-fit">{item.ipSource}</span>}
                                                </div>
                                            </td>
                                            <td data-label="归属地 / 运营商" className="text-xs">
                                                <div className="audit-access-location">
                                                    <span>{geoDisplay.location}</span>
                                                    {geoDisplay.carrier && <span className="audit-access-carrier">{geoDisplay.carrier}</span>}
                                                </div>
                                            </td>
                                            <td data-label="UA" className="text-xs" style={{ wordBreak: 'break-all', lineHeight: '1.4' }}>{item.userAgent || '-'}</td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="audit-pagination page-pagination">
                            <div className="page-pagination-meta">共 {accessData.total || 0} 条</div>
                            <div className="page-pagination-actions">
                                <button className="btn btn-secondary btn-sm" disabled={accessPage <= 1 || accessLoading} onClick={() => fetchAccess(accessPage - 1)}>上一页</button>
                                <span className="text-sm text-muted self-center">
                                    {accessPage} / {accessData.totalPages || 1}
                                </span>
                                <button className="btn btn-secondary btn-sm" disabled={accessPage >= (accessData.totalPages || 1) || accessLoading} onClick={() => fetchAccess(accessPage + 1)}>下一页</button>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'logs' && (
                    <Suspense fallback={<div className="flex items-center justify-center" style={{ padding: '64px 0' }}><span className="spinner" /></div>}>
                        <Logs embedded sourceMode="panel" displayLabel="3x-ui 日志" />
                    </Suspense>
                )}
            </div>

            {selectedEvent && (
                <ModalShell isOpen={!!selectedEvent} onClose={() => setSelectedEvent(null)}>
                    <div className="modal modal-lg audit-event-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">审计事件详情</h3>
                            <button className="modal-close" onClick={() => setSelectedEvent(null)}><HiOutlineXMark /></button>
                        </div>
                        <div className="modal-body">
                            {/* 事件摘要 */}
                            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                                <div>
                                    <span className="text-muted">事件类型: </span>
                                    <span className="font-semibold">{formatAuditEventLabel(selectedEvent, locale)}</span>
                                </div>
                                <div>
                                    <span className="text-muted">时间: </span>
                                    <span>{formatDateTime(selectedEvent.ts)}</span>
                                </div>
                                <div>
                                    <span className="text-muted">操作者: </span>
                                    <span className="font-semibold">{formatAuditActorLabel(selectedEvent, locale)}</span>
                                    {selectedEvent.actorRole && (
                                        <span className="badge badge-neutral ml-2 text-xs">{formatAuditActorRole(selectedEvent.actorRole, locale)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-muted">结果: </span>
                                    <span className={`badge ${statusBadgeClass(selectedEvent.outcome)}`}>{formatAuditStatusLabel(selectedEvent.outcome)}</span>
                                </div>
                                {selectedEvent.ip && (
                                    <div>
                                        <span className="text-muted">IP: </span>
                                        <span className="font-mono">{selectedEvent.ip}</span>
                                    </div>
                                )}
                                {selectedEvent.path && (
                                    <div>
                                        <span className="text-muted">路径: </span>
                                        <span className="font-mono">{selectedEvent.method} {selectedEvent.path}</span>
                                    </div>
                                )}
                                {selectedEvent.serverId && (
                                    <div>
                                        <span className="text-muted">节点: </span>
                                        <span>{selectedEvent.serverId}</span>
                                    </div>
                                )}
                                {resolveAuditTarget(selectedEvent) !== '-' && (
                                    <div>
                                        <span className="text-muted">目标用户: </span>
                                        <span>{resolveAuditTarget(selectedEvent)}</span>
                                    </div>
                                )}
                            </div>

                            {/* 变更前后对比（如有） */}
                            {(selectedEvent.beforeSnapshot || selectedEvent.afterSnapshot) && (
                                <div className="mb-4">
                                    <div className="font-semibold text-sm mb-2 text-primary">变更对比</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {selectedEvent.beforeSnapshot && (
                                            <div>
                                                <div className="text-xs text-danger mb-1 font-semibold">变更前</div>
                                                <pre className="log-viewer log-viewer-compact max-h-[200px] bg-danger/5 border border-danger/15">
                                                    {JSON.stringify(selectedEvent.beforeSnapshot, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                        {selectedEvent.afterSnapshot && (
                                            <div>
                                                <div className="text-xs text-success mb-1 font-semibold">变更后</div>
                                                <pre className="log-viewer log-viewer-compact max-h-[200px] bg-success/5 border border-success/15">
                                                    {JSON.stringify(selectedEvent.afterSnapshot, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 详细数据 */}
                            <div>
                                <div className="font-semibold text-sm mb-2 text-primary">事件详情</div>
                                <pre className="log-viewer log-viewer-compact">
                                    {JSON.stringify(selectedEvent.details || {}, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                </ModalShell>
            )}
        </>
    );
}
