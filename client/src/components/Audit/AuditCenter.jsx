import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    HiOutlineArrowPath,
    HiOutlineCommandLine,
    HiOutlineEye,
    HiOutlineChartBarSquare,
    HiOutlineUsers,
    HiOutlineDocumentText,
    HiOutlineFunnel,
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
import { formatBytes, formatDateOnly, formatDateTime as formatDateTimeValue } from '../../utils/format.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import toast from 'react-hot-toast';
import Tasks from '../Tasks/Tasks.jsx';
const Logs = lazy(() => import('../Logs/Logs.jsx'));
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import { resolveAccessGeoDisplay } from '../../utils/accessGeo.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import MiniSparkline from '../UI/MiniSparkline.jsx';
import useTrafficLeaderboardTrends from '../../hooks/useTrafficLeaderboardTrends.js';

const AUDIT_TRAFFIC_WINDOW_DAYS = 30;

const AUDIT_COPY = {
    'zh-CN': {
        tabs: {
            events: '操作记录',
            tasks: '批量任务',
            traffic: '流量统计',
            subscriptions: '订阅访问',
            logs: '3x-ui 日志',
        },
        actions: {
            query: '查询',
            clear: '清空',
            export: '导出',
            moreFilters: '更多筛选',
            lessFilters: '收起筛选',
            resetFilters: '重置筛选',
            previous: '上一页',
            next: '下一页',
            detail: '详情',
            viewDetail: '查看详情',
            refreshSample: '立即采样',
        },
        filters: {
            keyword: '关键词',
            eventType: '事件类型',
            allResults: '全部结果',
            allStatus: '全部状态',
            success: '成功',
            failed: '失败',
            info: '信息',
            denied: '已拒绝',
            expired: '已过期',
            revoked: '已撤销',
            userOrEmail: '用户 / 邮箱',
            serverId: '节点 ID',
            userEmailFilter: '用户 / 邮箱过滤',
            defaultPeriod: '默认统计周期：近一年',
            autoGranularity: '自动粒度',
            byHour: '按小时',
            byDay: '按天',
        },
        workspace: {
            navLabel: '审计分区',
            ready: '已同步',
            loading: '加载中',
            eventsEyebrow: 'Operations',
            eventsSummary: '按事件、结果、目标用户和节点回看系统操作历史，优先定位敏感变更。',
            tasksEyebrow: 'Batch',
            tasksSummary: '批量任务、重试和取消记录集中在这里，方便追踪执行链路。',
            trafficEyebrow: 'Traffic',
            trafficSummary: '先看累计流量和采样状态，再下钻到用户趋势、节点趋势和排行榜。',
            subscriptionsEyebrow: 'Access',
            subscriptionsSummary: '筛选订阅访问、真实 IP、归属地和状态分布，快速定位异常访问。',
            logsEyebrow: 'Panel Logs',
            logsSummary: '在当前工作台里直接查看 3x-ui 节点日志，不用来回切页。',
            eventsFiltersTitle: '筛选操作记录',
            eventsFiltersSubtitle: '按关键词、事件类型、结果、目标用户和节点缩小范围。',
            subscriptionsFiltersTitle: '筛选订阅访问',
            subscriptionsFiltersSubtitle: '先看整体访问规模，再按用户和状态定位异常请求。',
            recordCount: '记录总数',
            filterState: '筛选状态',
            currentPage: '当前页',
            range: '统计范围',
            sampleStatus: '采样状态',
            warningNodes: '异常节点',
            currentSelection: '当前选中',
            noFilters: '未设置筛选',
            filtersActive: '已启用 {count} 项',
            dataWindowYear: '近一年',
            dataWindowTraffic: '近 30 天',
            noUserSelected: '未选择用户',
            noServerSelected: '未选择节点',
            userTrafficSupport: '用户流量明细',
            supportReady: '支持用户级明细',
            supportLimited: '仅支持节点级流量',
        },
        tables: {
            time: '时间',
            event: '事件',
            result: '结果',
            actor: '操作者',
            node: '节点',
            user: '用户',
            action: '操作',
            realIp: '真实 IP',
            locationCarrier: '归属地 / 运营商',
            ua: 'UA',
            traffic: '流量',
        },
        states: {
            noAudit: '暂无审计记录',
            noAuditSubtitle: '系统操作审计事件将在此显示',
            noAccess: '暂无访问记录',
            noAccessSubtitle: '订阅链接访问记录将在此显示',
            noData: '暂无数据',
            maskedUser: '已脱敏用户',
            redactedUa: '已脱敏 UA',
            total: '共 {count} 条',
        },
        traffic: {
            recentSample: '最近采样',
            totalTraffic: '总流量',
            uploadTraffic: '上行流量',
            downloadTraffic: '下行流量',
            activeAccounts: '活跃账号',
            samplePoints: '采样点',
            userTrend: '用户流量趋势',
            serverTrend: '节点流量趋势',
            totalTrafficScope: '当前累计 · 已注册用户总流量',
            totalTrafficCurrentNote: '按已注册用户当前计数汇总',
            totalTrafficSampledNote: '最近 30 天采样汇总',
            activeAccountsScope: '最近 30 天 · 有流量的已注册用户',
            samplePointsScope: '最近 30 天采样记录数',
            userTrendScope: '当前所选用户 · 最近 30 天趋势',
            serverTrendScope: '当前所选节点 · 最近 30 天趋势',
            topUsersScope: '最近 30 天 · 已注册用户排行',
            topServersScope: '当前累计 · 全部节点排行',
            selectUser: '请选择用户',
            selectServer: '请选择节点',
            userLevelUnsupported: '当前 3x-ui 数据仅支持节点级流量统计，未返回用户级流量明细。',
            userLevelNoCounts: '当前节点列表未提供用户级流量计数。',
            topUsers: '流量 Top 用户',
            topServers: '流量 Top 节点',
            pv: '访问次数 (PV)',
            uv: '独立 IP (UV)',
            uniqueUsers: '访问用户数',
        },
        confirm: {
            clearEventsTitle: '清空操作审计日志',
            clearEventsMessage: '确认要清空全部操作审计记录吗？此操作不可恢复。',
            clearAccessTitle: '清空订阅访问日志',
            clearAccessMessage: '确认要清空全部订阅访问记录吗？此操作不可恢复。',
            confirmText: '清空',
        },
        toast: {
            auditLoadFailed: '审计日志加载失败',
            trafficLoadFailed: '流量总览加载失败',
            trafficSampleFailed: '有 {count} 个节点流量采样失败',
            userTrendLoadFailed: '用户趋势加载失败',
            serverTrendLoadFailed: '节点趋势加载失败',
            accessLoadFailed: '订阅访问日志加载失败',
            exportDone: '审计日志已导出',
            exportFailed: '导出失败',
            clearDone: '操作审计日志已清空',
            clearAccessDone: '订阅访问日志已清空',
            clearFailed: '清空失败',
        },
        detail: {
            title: '审计事件详情',
            eventType: '事件类型',
            time: '时间',
            actor: '操作者',
            result: '结果',
            ip: 'IP',
            locationCarrier: '归属地 / 运营商',
            path: '路径',
            node: '节点',
            targetUser: '目标用户',
            diff: '变更对比',
            before: '变更前',
            after: '变更后',
            payload: '事件详情',
        },
        roles: {
            admin: '管理员',
            user: '用户',
            anonymous: '未登录',
        },
        actorSource: {
            publicSubscription: '公开订阅请求',
            unauthenticated: '未登录请求',
            system: '系统任务',
            anonymous: '匿名请求',
        },
    },
    'en-US': {
        tabs: {
            events: 'Events',
            tasks: 'Tasks',
            traffic: 'Traffic',
            subscriptions: 'Subscription Access',
            logs: '3x-ui Logs',
        },
        actions: {
            query: 'Query',
            clear: 'Clear',
            export: 'Export',
            moreFilters: 'More Filters',
            lessFilters: 'Hide Filters',
            resetFilters: 'Reset Filters',
            previous: 'Previous',
            next: 'Next',
            detail: 'Details',
            viewDetail: 'View Detail',
            refreshSample: 'Collect Now',
        },
        filters: {
            keyword: 'Keyword',
            eventType: 'Event Type',
            allResults: 'All Outcomes',
            allStatus: 'All Statuses',
            success: 'Success',
            failed: 'Failed',
            info: 'Info',
            denied: 'Denied',
            expired: 'Expired',
            revoked: 'Revoked',
            userOrEmail: 'User / Email',
            serverId: 'Node ID',
            userEmailFilter: 'Filter by user / email',
            defaultPeriod: 'Default range: last 1 year',
            autoGranularity: 'Auto',
            byHour: 'Hourly',
            byDay: 'Daily',
        },
        workspace: {
            navLabel: 'Audit Sections',
            ready: 'Synced',
            loading: 'Loading',
            eventsEyebrow: 'Operations',
            eventsSummary: 'Review system operations by event, outcome, target user, and node to spot sensitive changes first.',
            tasksEyebrow: 'Batch',
            tasksSummary: 'Batch history, retries, and cancellations stay in one place for easier traceability.',
            trafficEyebrow: 'Traffic',
            trafficSummary: 'Start from cumulative traffic and sample health, then drill into user trends, node trends, and rankings.',
            subscriptionsEyebrow: 'Access',
            subscriptionsSummary: 'Filter subscription access, real IP, geo, and status distribution to find abnormal requests quickly.',
            logsEyebrow: 'Panel Logs',
            logsSummary: 'Inspect 3x-ui logs directly inside the audit workspace without switching pages.',
            eventsFiltersTitle: 'Filter Events',
            eventsFiltersSubtitle: 'Narrow the result by keyword, event type, outcome, target user, and node.',
            subscriptionsFiltersTitle: 'Filter Subscription Access',
            subscriptionsFiltersSubtitle: 'Review the overall access volume first, then narrow down by user and status.',
            recordCount: 'Records',
            filterState: 'Filters',
            currentPage: 'Page',
            range: 'Range',
            sampleStatus: 'Sample State',
            warningNodes: 'Warning Nodes',
            currentSelection: 'Current Selection',
            noFilters: 'No filters',
            filtersActive: '{count} active',
            dataWindowYear: 'Last 1 year',
            dataWindowTraffic: 'Last 30 days',
            noUserSelected: 'No user selected',
            noServerSelected: 'No node selected',
            userTrafficSupport: 'User Traffic Detail',
            supportReady: 'User-level detail available',
            supportLimited: 'Node-level traffic only',
        },
        tables: {
            time: 'Time',
            event: 'Event',
            result: 'Outcome',
            actor: 'Actor',
            node: 'Node',
            user: 'User',
            action: 'Actions',
            realIp: 'Real IP',
            locationCarrier: 'Location / Carrier',
            ua: 'UA',
            traffic: 'Traffic',
        },
        states: {
            noAudit: 'No audit records',
            noAuditSubtitle: 'System audit events will appear here',
            noAccess: 'No access records',
            noAccessSubtitle: 'Subscription access records will appear here',
            noData: 'No data',
            maskedUser: 'Masked user',
            redactedUa: 'Redacted UA',
            total: '{count} total',
        },
        traffic: {
            recentSample: 'Last Sample',
            totalTraffic: 'Total Traffic',
            uploadTraffic: 'Upload',
            downloadTraffic: 'Download',
            activeAccounts: 'Active Accounts',
            samplePoints: 'Samples',
            userTrend: 'User Traffic Trend',
            serverTrend: 'Node Traffic Trend',
            totalTrafficScope: 'Current cumulative · registered user traffic',
            totalTrafficCurrentNote: 'Summed from current registered-user counters',
            totalTrafficSampledNote: 'Summed from last 30 days samples',
            activeAccountsScope: 'Last 30 days · registered users with traffic',
            samplePointsScope: 'Traffic samples collected in the last 30 days',
            userTrendScope: 'Selected user · last 30 days',
            serverTrendScope: 'Selected node · last 30 days',
            topUsersScope: 'Last 30 days · registered user ranking',
            topServersScope: 'Current cumulative · all nodes ranking',
            selectUser: 'Select a user',
            selectServer: 'Select a node',
            userLevelUnsupported: 'Current 3x-ui data only supports node-level traffic and does not provide per-user traffic details.',
            userLevelNoCounts: 'Current nodes do not provide per-user traffic counters.',
            topUsers: 'Top Users by Traffic',
            topServers: 'Top Nodes by Traffic',
            pv: 'Page Views (PV)',
            uv: 'Unique IPs (UV)',
            uniqueUsers: 'Visited Users',
        },
        confirm: {
            clearEventsTitle: 'Clear Audit Log',
            clearEventsMessage: 'Clear all audit records? This action cannot be undone.',
            clearAccessTitle: 'Clear Subscription Access Log',
            clearAccessMessage: 'Clear all subscription access records? This action cannot be undone.',
            confirmText: 'Clear',
        },
        toast: {
            auditLoadFailed: 'Failed to load audit events',
            trafficLoadFailed: 'Failed to load traffic overview',
            trafficSampleFailed: '{count} nodes failed during traffic sampling',
            userTrendLoadFailed: 'Failed to load user trend',
            serverTrendLoadFailed: 'Failed to load node trend',
            accessLoadFailed: 'Failed to load subscription access logs',
            exportDone: 'Audit log exported',
            exportFailed: 'Export failed',
            clearDone: 'Audit log cleared',
            clearAccessDone: 'Subscription access log cleared',
            clearFailed: 'Clear failed',
        },
        detail: {
            title: 'Audit Event Detail',
            eventType: 'Event Type',
            time: 'Time',
            actor: 'Actor',
            result: 'Outcome',
            ip: 'IP',
            locationCarrier: 'Geo / Carrier',
            path: 'Path',
            node: 'Node',
            targetUser: 'Target User',
            diff: 'Diff',
            before: 'Before',
            after: 'After',
            payload: 'Payload',
        },
        roles: {
            admin: 'Admin',
            user: 'User',
            anonymous: 'Unauthenticated',
        },
        actorSource: {
            publicSubscription: 'Public Subscription Request',
            unauthenticated: 'Unauthenticated Request',
            system: 'System Task',
            anonymous: 'Anonymous Request',
        },
    },
};

const EMPTY_EVENT_FILTERS = Object.freeze({
    q: '',
    eventType: '',
    outcome: '',
    targetEmail: '',
    serverId: '',
});

const EMPTY_ACCESS_FILTERS = Object.freeze({
    email: '',
    status: '',
});

const MASKED_AUDIT_UA_PATTERN = /^ua_[0-9a-f]{16}$/i;

function getAuditCopy(locale = 'zh-CN') {
    return AUDIT_COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
}

function formatDateTime(value, locale = 'zh-CN') {
    return formatDateTimeValue(value, locale, { hour12: false });
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

function formatAuditStatusLabel(value, locale = 'zh-CN') {
    const copy = getAuditCopy(locale);
    const normalized = normalizeAuditStatus(value);
    if (!normalized) return '-';
    if (normalized === 'success') return copy.filters.success;
    if (normalized === 'failed') return copy.filters.failed;
    if (normalized === 'denied') return copy.filters.denied;
    if (normalized === 'revoked') return copy.filters.revoked;
    if (normalized === 'expired') return copy.filters.expired;
    if (normalized === 'info') return copy.filters.info;
    return String(value || '-');
}

function trendLabel(value, granularity, locale = 'zh-CN') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    if (granularity === 'day') {
        return formatDateOnly(date, locale, { month: '2-digit', day: '2-digit' });
    }
    return formatDateTimeValue(date, locale, {
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

function isMaskedAccessEmail(value) {
    return String(value || '').trim().toLowerCase().endsWith('@masked.local');
}

function formatAccessUserLabel(item, copy) {
    const userLabel = String(item?.userLabel || '').trim();
    if (userLabel && !isMaskedAccessEmail(userLabel)) return userLabel;

    const username = String(item?.username || '').trim();
    if (username) return username;

    const userEmail = String(item?.userEmail || '').trim();
    if (userEmail && !isMaskedAccessEmail(userEmail)) return userEmail;

    const email = String(item?.email || '').trim();
    if (email && !isMaskedAccessEmail(email)) return email;

    return copy.states.maskedUser;
}

function formatAccessUserMeta(item, copy) {
    const primaryLabel = formatAccessUserLabel(item, copy);
    const candidates = [
        String(item?.userEmail || '').trim(),
        String(item?.email || '').trim(),
    ];

    return candidates.find((candidate) => candidate && !isMaskedAccessEmail(candidate) && candidate !== primaryLabel) || '';
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
        account_email_updated: '更新账号信息',
        invite_code_created: '创建邀请码',
        invite_code_revoked: '撤销邀请码',
        invite_registration_email_sent: '发送注册邀请邮件',
        smtp_connection_verified: '验证 SMTP 连接',
        registered_user_notice: '发送注册用户变更通知',
        system_backup_exported: '导出系统备份',
        system_backup_saved_local: '保存本机备份',
        system_backup_downloaded_local: '下载本机备份',
        system_backup_restored_local: '恢复本机备份',
        system_backup_deleted_local: '删除本机备份',
        system_backup_restored: '恢复系统备份',
        system_settings_updated: '更新系统设置',
        security_bootstrap_completed: '完成安全启动向导',
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
        account_email_updated: 'Account Updated',
        invite_code_created: 'Invite Code Created',
        invite_code_revoked: 'Invite Code Revoked',
        invite_registration_email_sent: 'Registration Invite Email Sent',
        smtp_connection_verified: 'SMTP Connection Verified',
        registered_user_notice: 'Registered User Notice Sent',
        system_backup_exported: 'System Backup Exported',
        system_backup_saved_local: 'Local Backup Saved',
        system_backup_downloaded_local: 'Local Backup Downloaded',
        system_backup_restored_local: 'Local Backup Restored',
        system_backup_deleted_local: 'Local Backup Deleted',
        system_backup_restored: 'System Backup Restored',
        system_settings_updated: 'System Settings Updated',
        security_bootstrap_completed: 'Security Bootstrap Completed',
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
    const copy = getAuditCopy(locale);
    const actor = String(item?.actor || '').trim();
    if (!actor) return '-';
    if (actor !== 'anonymous') return actor;

    const actorSource = String(item?.actorSource || '').trim();
    if (actorSource === 'public_subscription') return copy.actorSource.publicSubscription;
    if (actorSource === 'unauthenticated') return copy.actorSource.unauthenticated;
    if (actorSource === 'system') return copy.actorSource.system;

    const eventType = String(item?.eventType || '').trim();
    if (eventType.startsWith('subscription_public_')) return copy.actorSource.publicSubscription;
    if (eventType.startsWith('login_')
        || eventType.startsWith('register_')
        || eventType.startsWith('verification_')
        || eventType.startsWith('password_reset_')) {
        return copy.actorSource.unauthenticated;
    }
    return copy.actorSource.anonymous;
}

function formatAuditActorRole(role, locale = 'zh-CN') {
    const copy = getAuditCopy(locale);
    const value = String(role || '').trim();
    if (!value) return '';
    if (value === 'admin') return copy.roles.admin;
    if (value === 'user') return copy.roles.user;
    if (value === 'anonymous') return copy.roles.anonymous;
    return value;
}

function resolveAuditTarget(item) {
    return item?.targetEmail
        || item?.details?.email
        || item?.details?.subscriptionEmail
        || item?.details?.username
        || '-';
}

function formatAuditLocationCarrier(item) {
    return [item?.ipLocation, item?.ipCarrier]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' · ');
}

function formatAuditUserAgent(value, locale = 'zh-CN', isMasked = false) {
    const copy = getAuditCopy(locale);
    const text = String(value || '').trim();
    if (text) {
        return MASKED_AUDIT_UA_PATTERN.test(text) ? copy.states.redactedUa : text;
    }
    if (isMasked) return copy.states.redactedUa;
    return '-';
}

function sanitizeAuditDetailPayload(payload, locale = 'zh-CN') {
    if (Array.isArray(payload)) {
        return payload.map((item) => sanitizeAuditDetailPayload(item, locale));
    }
    if (!payload || typeof payload !== 'object') {
        return typeof payload === 'string' && MASKED_AUDIT_UA_PATTERN.test(payload)
            ? getAuditCopy(locale).states.redactedUa
            : payload;
    }

    const next = { ...payload };
    Object.keys(next).forEach((key) => {
        next[key] = sanitizeAuditDetailPayload(next[key], locale);
    });
    return next;
}

function buildAuditSourceSummary(item) {
    const parts = [];
    const ip = String(item?.ip || '').trim();
    const locationCarrier = formatAuditLocationCarrier(item);

    if (ip) parts.push(ip);
    if (locationCarrier) parts.push(locationCarrier);

    return parts.join(' · ');
}

function countActiveFilters(filters = {}) {
    return Object.values(filters).reduce((count, value) => {
        if (value === undefined || value === null) return count;
        if (typeof value === 'string') {
            return String(value).trim() ? count + 1 : count;
        }
        return count + 1;
    }, 0);
}

function AuditEventsMobileList({ items = [], copy, locale, onSelect }) {
    return (
        <div className="audit-mobile-list">
            {items.map((item) => (
                <div key={item.id} className="audit-mobile-card">
                    <div className="audit-mobile-card-head">
                        <div className="audit-mobile-card-copy">
                            <div className="audit-mobile-card-title">{formatAuditEventLabel(item, locale)}</div>
                            <div className="audit-mobile-card-subtitle">{formatDateTime(item.ts, locale)}</div>
                        </div>
                        <span className={`badge ${statusBadgeClass(item.outcome)}`}>
                            {formatAuditStatusLabel(item.outcome, locale)}
                        </span>
                    </div>
                        <div className="audit-mobile-card-grid">
                            <div className="audit-mobile-card-item">
                                <span className="audit-mobile-card-label">{copy.tables.actor}</span>
                                <span className="audit-mobile-card-value">{formatAuditActorLabel(item, locale)}</span>
                            </div>
                        <div className="audit-mobile-card-item">
                            <span className="audit-mobile-card-label">{copy.tables.node}</span>
                            <span className="audit-mobile-card-value">{item.serverId || '-'}</span>
                        </div>
                            <div className="audit-mobile-card-item audit-mobile-card-item--full">
                                <span className="audit-mobile-card-label">{copy.tables.user}</span>
                                <span className="audit-mobile-card-value">{resolveAuditTarget(item)}</span>
                            </div>
                            {buildAuditSourceSummary(item) ? (
                                <div className="audit-mobile-card-item audit-mobile-card-item--full">
                                    <span className="audit-mobile-card-label">{copy.tables.locationCarrier}</span>
                                    <span className="audit-mobile-card-value audit-mobile-card-value--mono">
                                        {buildAuditSourceSummary(item)}
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    <div className="audit-mobile-card-actions">
                        <button
                            className="btn btn-secondary btn-sm rounded-lg audit-action-btn"
                            onClick={() => onSelect(item)}
                            title={copy.actions.viewDetail}
                            aria-label={copy.actions.viewDetail}
                        >
                            <HiOutlineEye className="audit-action-btn-icon" />
                            <span>{copy.actions.detail}</span>
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

function AuditAccessMobileList({ items = [], copy, locale }) {
    return (
        <div className="audit-mobile-list">
            {items.map((item) => {
                const geoDisplay = resolveAccessGeoDisplay(item);
                const userLabel = formatAccessUserLabel(item, copy);
                const userMeta = formatAccessUserMeta(item, copy);
                return (
                    <div key={item.id} className="audit-mobile-card">
                        <div className="audit-mobile-card-head">
                            <div className="audit-mobile-card-copy">
                                <div className="audit-mobile-card-title">{userLabel}</div>
                                <div className="audit-mobile-card-subtitle">{formatDateTime(item.ts, locale)}</div>
                            </div>
                            <span className={`badge ${statusBadgeClass(item.status)}`}>
                                {formatAuditStatusLabel(item.status, locale)}
                            </span>
                        </div>
                        {userMeta ? (
                            <div className="audit-mobile-inline-note">{userMeta}</div>
                        ) : null}
                        <div className="audit-mobile-card-grid">
                            <div className="audit-mobile-card-item">
                                <span className="audit-mobile-card-label">{copy.tables.realIp}</span>
                                <span className="audit-mobile-card-value audit-mobile-card-value--mono">{item.clientIp || item.ip || '-'}</span>
                            </div>
                            <div className="audit-mobile-card-item">
                                <span className="audit-mobile-card-label">{copy.tables.locationCarrier}</span>
                                <span className="audit-mobile-card-value">
                                    {geoDisplay.location}
                                    {geoDisplay.carrier ? ` · ${geoDisplay.carrier}` : ''}
                                </span>
                            </div>
                            <div className="audit-mobile-card-item audit-mobile-card-item--full">
                                <span className="audit-mobile-card-label">{copy.tables.ua}</span>
                                <span className="audit-mobile-card-value">{formatAuditUserAgent(item.userAgent, locale, item.userAgentMasked === true)}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default function AuditCenter() {
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const copy = getAuditCopy(locale);
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
    const [eventFilters, setEventFilters] = useState(() => ({ ...EMPTY_EVENT_FILTERS }));
    const [showAdvancedEventFilters, setShowAdvancedEventFilters] = useState(false);
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

    const fetchEvents = async (targetPage = eventsPage, filters = eventFilters) => {
        setEventsLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', String(targetPage));
            params.append('pageSize', '20');
            if (filters.q) params.append('q', filters.q);
            if (filters.eventType) params.append('eventType', filters.eventType);
            if (filters.outcome) params.append('outcome', filters.outcome);
            if (filters.targetEmail) params.append('targetEmail', filters.targetEmail);
            if (filters.serverId) params.append('serverId', filters.serverId);
            const res = await api.get(`/audit/events?${params.toString()}`);
            setEventsData(res.data?.obj || { items: [], total: 0, page: targetPage, totalPages: 1 });
            setEventsPage(targetPage);
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || copy.toast.auditLoadFailed);
        }
        setEventsLoading(false);
    };

    const fetchTrafficOverview = async (force = false) => {
        setTrafficLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('days', String(AUDIT_TRAFFIC_WINDOW_DAYS));
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
                toast.error(copy.toast.trafficSampleFailed.replace('{count}', String(warningCount)));
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || copy.toast.trafficLoadFailed);
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
            params.append('days', String(AUDIT_TRAFFIC_WINDOW_DAYS));
            params.append('granularity', trafficGranularity);
            const res = await api.get(`/traffic/users/${encodeURIComponent(email)}/trend?${params.toString()}`);
            setUserTrend(res.data?.obj || { points: [], granularity: 'hour' });
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || copy.toast.userTrendLoadFailed);
        }
    };

    const fetchServerTrend = async (serverId) => {
        if (!serverId) {
            setServerTrend({ points: [], granularity: 'hour' });
            return;
        }
        try {
            const params = new URLSearchParams();
            params.append('days', String(AUDIT_TRAFFIC_WINDOW_DAYS));
            params.append('granularity', trafficGranularity);
            const res = await api.get(`/traffic/servers/${encodeURIComponent(serverId)}/trend?${params.toString()}`);
            setServerTrend(res.data?.obj || { points: [], granularity: 'hour' });
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || copy.toast.serverTrendLoadFailed);
        }
    };

    const fetchAccess = async (targetPage = accessPage, filtersOverride = null) => {
        setAccessLoading(true);
        try {
            const sourceFilters = filtersOverride || accessFilters;
            const params = new URLSearchParams();
            params.append('page', String(targetPage));
            params.append('pageSize', '30');
            if (sourceFilters.email) params.append('email', sourceFilters.email);
            if (sourceFilters.status) params.append('status', sourceFilters.status);
            const [res, summaryRes] = await Promise.all([
                api.get(`/subscriptions/access?${params.toString()}`),
                api.get(`/subscriptions/access/summary?${params.toString()}`),
            ]);
            setAccessData(res.data?.obj || { items: [], total: 0, page: targetPage, totalPages: 1, statusBreakdown: {} });
            setAccessSummary(summaryRes.data?.obj || { total: 0, uniqueIpCount: 0, uniqueUsers: 0, statusBreakdown: {}, topIps: [], from: '', to: '' });
            setAccessPage(targetPage);
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || copy.toast.accessLoadFailed);
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
            toast.success(copy.toast.exportDone);
        } catch {
            toast.error(copy.toast.exportFailed);
        }
    };

    const handleClearEvents = async () => {
        const ok = await confirm({
            title: copy.confirm.clearEventsTitle,
            message: copy.confirm.clearEventsMessage,
            confirmText: copy.confirm.confirmText,
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete('/audit/events');
            toast.success(copy.toast.clearDone);
            fetchEvents(1);
        } catch (err) {
            toast.error(err.response?.data?.msg || copy.toast.clearFailed);
        }
    };

    const handleClearAccessLogs = async () => {
        const ok = await confirm({
            title: copy.confirm.clearAccessTitle,
            message: copy.confirm.clearAccessMessage,
            confirmText: copy.confirm.confirmText,
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete('/audit/subscription-access');
            toast.success(copy.toast.clearAccessDone);
            fetchAccess(1);
        } catch (err) {
            toast.error(err.response?.data?.msg || copy.toast.clearFailed);
        }
    };

    const handleResetEventFilters = () => {
        const nextFilters = { ...EMPTY_EVENT_FILTERS };
        setEventFilters(nextFilters);
        setShowAdvancedEventFilters(false);
        fetchEvents(1, nextFilters);
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
        if (eventFilters.eventType || eventFilters.serverId) {
            setShowAdvancedEventFilters(true);
        }
    }, [eventFilters.eventType, eventFilters.serverId]);

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
    const usesRegisteredTrafficTotals = Boolean(
        trafficOverview?.registeredTotals
        && typeof trafficOverview.registeredTotals === 'object'
        && !Array.isArray(trafficOverview.registeredTotals)
    );
    const trafficTotals = trafficOverview?.registeredTotals || trafficOverview?.totals || {
        upBytes: 0,
        downBytes: 0,
        totalBytes: 0,
    };
    const trafficTotalsNote = usesRegisteredTrafficTotals
        ? copy.traffic.totalTrafficCurrentNote
        : copy.traffic.totalTrafficSampledNote;
    const trafficWarningCount = Array.isArray(trafficOverview?.collection?.warnings)
        ? trafficOverview.collection.warnings.length
        : 0;
    const activeEventFilterCount = useMemo(() => countActiveFilters(eventFilters), [eventFilters]);
    const activeAccessFilterCount = useMemo(() => countActiveFilters(accessFilters), [accessFilters]);
    const selectedTrafficUser = useMemo(
        () => topUsers.find((item) => item.email === selectedUser) || null,
        [selectedUser, topUsers]
    );
    const selectedTrafficServer = useMemo(
        () => topServers.find((item) => item.serverId === selectedServerId) || null,
        [selectedServerId, topServers]
    );
    const leaderboardTrendLabel = locale === 'en-US' ? '24h Trend' : '24h 趋势';
    const {
        userTrends: trafficUserRowTrends,
        serverTrends: trafficServerRowTrends,
    } = useTrafficLeaderboardTrends({
        enabled: tab === 'traffic',
        topUsers,
        topServers,
    });
    const auditTabs = useMemo(() => ([
        {
            id: 'events',
            label: copy.tabs.events,
            eyebrow: copy.workspace.eventsEyebrow,
            summary: copy.workspace.eventsSummary,
            icon: HiOutlineDocumentText,
        },
        {
            id: 'tasks',
            label: copy.tabs.tasks,
            eyebrow: copy.workspace.tasksEyebrow,
            summary: copy.workspace.tasksSummary,
            icon: HiOutlineArrowPath,
        },
        {
            id: 'traffic',
            label: copy.tabs.traffic,
            eyebrow: copy.workspace.trafficEyebrow,
            summary: copy.workspace.trafficSummary,
            icon: HiOutlineChartBarSquare,
        },
        {
            id: 'subscriptions',
            label: copy.tabs.subscriptions,
            eyebrow: copy.workspace.subscriptionsEyebrow,
            summary: copy.workspace.subscriptionsSummary,
            icon: HiOutlineUsers,
        },
        {
            id: 'logs',
            label: copy.tabs.logs,
            eyebrow: copy.workspace.logsEyebrow,
            summary: copy.workspace.logsSummary,
            icon: HiOutlineCommandLine,
        },
    ]), [copy]);
    const activeAuditTab = useMemo(
        () => auditTabs.find((item) => item.id === tab) || auditTabs[0] || null,
        [auditTabs, tab]
    );
    const currentTabBusy = (
        (tab === 'events' && eventsLoading)
        || (tab === 'traffic' && trafficLoading)
        || (tab === 'subscriptions' && accessLoading)
    );

    const handleResetAccessFilters = () => {
        const nextFilters = { ...EMPTY_ACCESS_FILTERS };
        setAccessFilters(nextFilters);
        fetchAccess(1, nextFilters);
    };

    return (
        <>
            <Header
                title={t('pages.audit.title')}
                eyebrow={t('pages.audit.eyebrow')}
            />
            <div className="page-content page-enter page-content--wide audit-page">
                <div className="audit-shell">
                    <div className="card audit-nav">
                        <div className="audit-nav-head audit-nav-topbar">
                            <div className="audit-nav-label">{copy.workspace.navLabel}</div>
                            <div className={`audit-nav-status-chip${currentTabBusy ? ' is-loading' : ' is-ready'}`}>
                                {currentTabBusy ? <span className="spinner spinner-16" /> : null}
                                <span>{currentTabBusy ? copy.workspace.loading : copy.workspace.ready}</span>
                            </div>
                        </div>
                        {activeAuditTab?.summary ? (
                            <div className="audit-nav-summary">{activeAuditTab.summary}</div>
                        ) : null}
                        <div className="tabs audit-tabs" role="tablist" aria-label={copy.workspace.navLabel}>
                            {auditTabs.map((item) => {
                                const Icon = item.icon;
                                const isActive = tab === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        className={`tab ${isActive ? 'active' : ''}`}
                                        onClick={() => setTab(item.id)}
                                        role="tab"
                                        aria-selected={isActive}
                                    >
                                        <span className="audit-tab-icon" aria-hidden="true"><Icon /></span>
                                        <span className="audit-tab-label">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="audit-main">
                        <div className="audit-tab-panel">
                {tab === 'events' && (
                    <div className="audit-events-layout">
                        <div className="audit-events-main">
                            <div className="card p-4 audit-control-card audit-control-card-events">
                                <div className="audit-control-head">
                                    <div className="audit-control-copy">
                                        <div className="audit-control-title">{copy.workspace.eventsFiltersTitle}</div>
                                        <div className="audit-control-text">{copy.workspace.eventsFiltersSubtitle}</div>
                                    </div>
                                    <div className="audit-control-actions">
                                        <div className="audit-control-action-group">
                                            <button className="btn btn-primary btn-sm" onClick={() => fetchEvents(1)} disabled={eventsLoading}>
                                                <HiOutlineArrowPath className={eventsLoading ? 'spinning' : ''} /> {copy.actions.query}
                                            </button>
                                            <button
                                                className={`btn btn-sm ${showAdvancedEventFilters ? 'btn-secondary' : 'btn-ghost'}`}
                                                onClick={() => setShowAdvancedEventFilters((value) => !value)}
                                            >
                                                {showAdvancedEventFilters ? <HiOutlineXMark /> : <HiOutlineFunnel />}
                                                {showAdvancedEventFilters ? copy.actions.lessFilters : copy.actions.moreFilters}
                                            </button>
                                            {activeEventFilterCount > 0 && (
                                                <button className="btn btn-ghost btn-sm" onClick={handleResetEventFilters}>
                                                    {copy.actions.resetFilters}
                                                </button>
                                            )}
                                        </div>
                                        <div className="audit-control-action-group audit-control-action-group--secondary">
                                            <button className="btn btn-secondary btn-sm" onClick={handleExportAuditCSV} title="CSV">
                                                <HiOutlineArrowDownTray /> {copy.actions.export}
                                            </button>
                                            <button className="btn btn-danger btn-sm" onClick={handleClearEvents} title={copy.confirm.clearEventsTitle}>
                                                <HiOutlineTrash /> {copy.actions.clear}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="audit-control-meta audit-control-meta--compact">
                                    <span className="audit-control-pill">
                                        {copy.states.total.replace('{count}', String(eventsData.total || 0))}
                                    </span>
                                    <span className={`audit-control-pill ${activeEventFilterCount > 0 ? 'is-active' : ''}`}>
                                        {activeEventFilterCount > 0
                                            ? copy.workspace.filtersActive.replace('{count}', String(activeEventFilterCount))
                                            : copy.workspace.noFilters}
                                    </span>
                                </div>
                                <div className="audit-filter-stack">
                                    <div className="audit-filter-grid audit-filter-grid--events audit-filter-grid--events-primary">
                                        <input
                                            className="form-input w-180"
                                            placeholder={copy.filters.keyword}
                                            value={eventFilters.q}
                                            onChange={(e) => setEventFilters((prev) => ({ ...prev, q: e.target.value }))}
                                        />
                                        <select
                                            className="form-select w-140"
                                            value={eventFilters.outcome}
                                            onChange={(e) => setEventFilters((prev) => ({ ...prev, outcome: e.target.value }))}
                                        >
                                            <option value="">{copy.filters.allResults}</option>
                                            <option value="success">{copy.filters.success}</option>
                                            <option value="failed">{copy.filters.failed}</option>
                                            <option value="info">{copy.filters.info}</option>
                                        </select>
                                        <input
                                            className="form-input w-180"
                                            placeholder={copy.filters.userOrEmail}
                                            value={eventFilters.targetEmail}
                                            onChange={(e) => setEventFilters((prev) => ({ ...prev, targetEmail: e.target.value }))}
                                        />
                                    </div>
                                    {showAdvancedEventFilters && (
                                        <div className="audit-filter-grid audit-filter-grid--events audit-filter-grid--events-secondary">
                                            <input
                                                className="form-input w-180"
                                                placeholder={copy.filters.eventType}
                                                value={eventFilters.eventType}
                                                onChange={(e) => setEventFilters((prev) => ({ ...prev, eventType: e.target.value }))}
                                            />
                                            <input
                                                className="form-input w-180"
                                                placeholder={copy.filters.serverId}
                                                value={eventFilters.serverId}
                                                onChange={(e) => setEventFilters((prev) => ({ ...prev, serverId: e.target.value }))}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {eventsLoading ? (
                                <div className="glass-panel audit-table-shell audit-events-table-shell p-4">
                                    <SkeletonTable rows={5} cols={7} />
                                </div>
                            ) : eventsData.items.length === 0 ? (
                                <div className="glass-panel audit-table-shell audit-events-table-shell p-4">
                                    <EmptyState title={copy.states.noAudit} subtitle={copy.states.noAuditSubtitle} />
                                </div>
                            ) : isCompactLayout ? (
                                <AuditEventsMobileList
                                    items={eventsData.items}
                                    copy={copy}
                                    locale={locale}
                                    onSelect={setSelectedEvent}
                                />
                            ) : (
                                <div className="table-container glass-panel audit-table-shell audit-events-table-shell">
                                    <table className="table audit-events-table">
                                        <thead>
                                            <tr>
                                                <th className="audit-event-time-column">{copy.tables.time}</th>
                                                <th>{copy.tables.event}</th>
                                                <th className="table-cell-center audit-event-result-column">{copy.tables.result}</th>
                                                <th>{copy.tables.actor}</th>
                                                <th className="table-cell-center audit-event-node-column">{copy.tables.node}</th>
                                                <th>{copy.tables.user}</th>
                                                <th className="table-cell-actions audit-event-action-column">{copy.tables.action}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {eventsData.items.map((item) => (
                                                <tr key={item.id}>
                                                    <td data-label={copy.tables.time} className="cell-mono audit-event-time-cell">{formatDateTime(item.ts, locale)}</td>
                                                    <td data-label={copy.tables.event}>{formatAuditEventLabel(item, locale)}</td>
                                                    <td data-label={copy.tables.result} className="table-cell-center audit-event-result-cell"><span className={`badge ${statusBadgeClass(item.outcome)}`}>{formatAuditStatusLabel(item.outcome, locale)}</span></td>
                                                    <td data-label={copy.tables.actor}>{formatAuditActorLabel(item, locale)}</td>
                                                    <td data-label={copy.tables.node} className="table-cell-center audit-event-node-cell">{item.serverId || '-'}</td>
                                                    <td data-label={copy.tables.user}>
                                                        <div className="audit-event-target">
                                                            <span className="audit-event-target-label">{resolveAuditTarget(item)}</span>
                                                            {buildAuditSourceSummary(item) ? (
                                                                <span className="audit-event-target-meta">{buildAuditSourceSummary(item)}</span>
                                                            ) : null}
                                                        </div>
                                                    </td>
                                                    <td data-label={copy.tables.action} className="table-cell-actions">
                                                        <div className="table-row-actions audit-table-row-actions">
                                                            <button
                                                                className="btn btn-secondary btn-sm rounded-lg audit-action-btn"
                                                                onClick={() => setSelectedEvent(item)}
                                                                title={copy.actions.viewDetail}
                                                                aria-label={copy.actions.viewDetail}
                                                            >
                                                                <HiOutlineEye className="audit-action-btn-icon" />
                                                                <span>{copy.actions.detail}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className="audit-pagination page-pagination">
                                <div className="page-pagination-meta">{copy.states.total.replace('{count}', String(eventsData.total || 0))}</div>
                                <div className="audit-pagination-actions page-pagination-actions">
                                    <button className="btn btn-secondary btn-sm" disabled={eventsPage <= 1 || eventsLoading} onClick={() => fetchEvents(eventsPage - 1)}>{copy.actions.previous}</button>
                                    <span className="text-sm text-muted self-center">
                                        {eventsPage} / {eventsData.totalPages || 1}
                                    </span>
                                    <button className="btn btn-secondary btn-sm" disabled={eventsPage >= (eventsData.totalPages || 1) || eventsLoading} onClick={() => fetchEvents(eventsPage + 1)}>{copy.actions.next}</button>
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
                        <div className="card audit-traffic-overview">
                            <div className="audit-traffic-overview-head">
                                <div className="audit-traffic-overview-copy">
                                    <div className="audit-traffic-overview-eyebrow">{copy.workspace.trafficEyebrow}</div>
                                    <div className="audit-traffic-overview-title">{copy.tabs.traffic}</div>
                                    <div className="audit-traffic-overview-text">{copy.workspace.trafficSummary}</div>
                                </div>
                                <div className="audit-traffic-overview-actions">
                                    <div className="audit-traffic-sample-pill" title={formatDateTime(trafficOverview?.lastCollectionAt, locale)}>
                                        <span className="audit-traffic-sample-label">{copy.traffic.recentSample}</span>
                                        <span className="audit-traffic-sample-value">{formatDateTime(trafficOverview?.lastCollectionAt, locale)}</span>
                                    </div>
                                    <select
                                        className="form-select w-130"
                                        value={trafficGranularity}
                                        onChange={(e) => setTrafficGranularity(e.target.value)}
                                    >
                                        <option value="auto">{copy.filters.autoGranularity}</option>
                                        <option value="hour">{copy.filters.byHour}</option>
                                        <option value="day">{copy.filters.byDay}</option>
                                    </select>
                                    <button className="btn btn-primary btn-sm" onClick={() => fetchTrafficOverview(true)} disabled={trafficLoading}>
                                        <HiOutlineArrowPath className={trafficLoading ? 'spinning' : ''} /> {copy.actions.refreshSample}
                                    </button>
                                </div>
                            </div>
                            <div className="audit-traffic-overview-body">
                                <div className="audit-traffic-total-card">
                                    <div className="audit-traffic-total-label">{copy.traffic.totalTrafficScope}</div>
                                    <div className="audit-traffic-total-value">{formatBytes(trafficTotals.totalBytes || 0)}</div>
                                    <div className="audit-traffic-total-note">{trafficTotalsNote}</div>
                                    <div className="audit-traffic-split-grid">
                                        <div className="audit-traffic-split-card audit-traffic-split-card--up">
                                            <div className="audit-traffic-split-label">{copy.traffic.uploadTraffic}</div>
                                            <div className="audit-traffic-split-value">{formatBytes(trafficTotals.upBytes || 0)}</div>
                                        </div>
                                        <div className="audit-traffic-split-card audit-traffic-split-card--down">
                                            <div className="audit-traffic-split-label">{copy.traffic.downloadTraffic}</div>
                                            <div className="audit-traffic-split-value">{formatBytes(trafficTotals.downBytes || 0)}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="audit-traffic-mini-grid">
                                    <div className="audit-traffic-mini-card">
                                        <div className="audit-traffic-mini-label">{copy.traffic.activeAccounts}</div>
                                        <div className="audit-traffic-mini-value">{trafficOverview?.activeUsers || 0}</div>
                                        <div className="audit-traffic-mini-note">{copy.traffic.activeAccountsScope}</div>
                                    </div>
                                    <div className="audit-traffic-mini-card">
                                        <div className="audit-traffic-mini-label">{copy.traffic.samplePoints}</div>
                                        <div className="audit-traffic-mini-value">{trafficOverview?.sampleCount || 0}</div>
                                        <div className="audit-traffic-mini-note">{copy.traffic.samplePointsScope}</div>
                                    </div>
                                    <div className="audit-traffic-mini-card">
                                        <div className="audit-traffic-mini-label">{copy.workspace.userTrafficSupport}</div>
                                        <div className="audit-traffic-mini-value">
                                            {trafficOverview?.userLevelSupported === false ? copy.workspace.supportLimited : copy.workspace.supportReady}
                                        </div>
                                        <div className="audit-traffic-mini-note">
                                            {trafficWarningCount > 0
                                                ? `${copy.workspace.warningNodes} ${trafficWarningCount}`
                                                : copy.workspace.dataWindowTraffic}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid-auto-280-tight audit-chart-grid">
                            <div className="card audit-chart-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title={copy.traffic.userTrend}
                                    subtitle={copy.traffic.userTrendScope}
                                    actions={(
                                        <select
                                            className="form-select w-220"
                                            value={selectedUser}
                                            onChange={(e) => setSelectedUser(e.target.value)}
                                        >
                                            <option value="">{copy.traffic.selectUser}</option>
                                            {topUsers.map((item) => (
                                                <option key={item.email} value={item.email}>
                                                    {formatTrafficUserLabel(item)} ({formatBytes(item.totalBytes)})
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                />
                                {trafficOverview?.userLevelSupported === false && (
                                    <div className="text-xs text-muted mb-2">{copy.traffic.userLevelUnsupported}</div>
                                )}
                                <div className="audit-chart-selection">
                                    <span className="audit-chart-selection-label">{copy.workspace.currentSelection}</span>
                                    <span className="audit-chart-selection-value">
                                        {selectedTrafficUser ? formatTrafficUserLabel(selectedTrafficUser) : copy.workspace.noUserSelected}
                                    </span>
                                </div>
                                <div className="dashboard-chart audit-chart-body">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={userTrend.points || []}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                            <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, userTrend.granularity, locale)} />
                                            <YAxis />
                                            <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(value) => formatDateTime(value, locale)} />
                                            <Line type="monotone" dataKey="totalBytes" stroke="#6366f1" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="card audit-chart-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title={copy.traffic.serverTrend}
                                    subtitle={copy.traffic.serverTrendScope}
                                    actions={(
                                        <select
                                            className="form-select w-220"
                                            value={selectedServerId}
                                            onChange={(e) => setSelectedServerId(e.target.value)}
                                        >
                                            <option value="">{copy.traffic.selectServer}</option>
                                            {topServers.map((item) => (
                                                <option key={item.serverId} value={item.serverId}>
                                                    {item.serverName} ({formatBytes(item.totalBytes)})
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                />
                                <div className="audit-chart-selection">
                                    <span className="audit-chart-selection-label">{copy.workspace.currentSelection}</span>
                                    <span className="audit-chart-selection-value">
                                        {selectedTrafficServer?.serverName || copy.workspace.noServerSelected}
                                    </span>
                                </div>
                                <div className="dashboard-chart audit-chart-body">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={serverTrend.points || []}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                            <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, serverTrend.granularity, locale)} />
                                            <YAxis />
                                            <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(value) => formatDateTime(value, locale)} />
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
                                    title={copy.traffic.topUsers}
                                    subtitle={copy.traffic.topUsersScope}
                                />
                                {trafficOverview?.userLevelSupported === false && (
                                    <div className="text-xs text-muted mb-2">{copy.traffic.userLevelNoCounts}</div>
                                )}
                                {topUsers.length === 0 ? (
                                    <div className="p-4">
                                        <EmptyState title={copy.states.noData} size="compact" hideIcon />
                                    </div>
                                ) : (
                                    <div className="table-container audit-nested-table-shell">
                                        <table className="table audit-leaderboard-table audit-top-users-table">
                                            <thead>
                                                <tr>
                                                    <th>{copy.tables.user}</th>
                                                    <th>{leaderboardTrendLabel}</th>
                                                    <th className="table-cell-right audit-leaderboard-traffic-column">{copy.tables.traffic}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {topUsers.map((item) => (
                                                    <tr key={item.email} className="cursor-pointer" onClick={() => setSelectedUser(item.email)}>
                                                        <td data-label={copy.tables.user} className="audit-leaderboard-label-cell">{formatTrafficUserLabel(item)}</td>
                                                        <td data-label={leaderboardTrendLabel} className="audit-leaderboard-trend-cell">
                                                            <MiniSparkline
                                                                points={trafficUserRowTrends[item.email] || []}
                                                                tone="primary"
                                                                width={132}
                                                                height={32}
                                                            />
                                                        </td>
                                                        <td data-label={copy.tables.traffic} className="table-cell-right cell-mono-right audit-leaderboard-traffic-cell">{formatBytes(item.totalBytes)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                            <div className="card audit-leaderboard-card">
                                <SectionHeader
                                    className="card-header section-header section-header--compact"
                                    title={copy.traffic.topServers}
                                    subtitle={copy.traffic.topServersScope}
                                />
                                {topServers.length === 0 ? (
                                    <div className="p-4">
                                        <EmptyState title={copy.states.noData} size="compact" hideIcon />
                                    </div>
                                ) : (
                                    <div className="table-container audit-nested-table-shell">
                                        <table className="table audit-leaderboard-table audit-top-servers-table">
                                            <thead>
                                                <tr>
                                                    <th>{copy.tables.node}</th>
                                                    <th>{leaderboardTrendLabel}</th>
                                                    <th className="table-cell-right audit-leaderboard-traffic-column">{copy.tables.traffic}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {topServers.map((item) => (
                                                    <tr key={item.serverId} className="cursor-pointer" onClick={() => setSelectedServerId(item.serverId)}>
                                                        <td data-label={copy.tables.node} className="audit-leaderboard-label-cell">{item.serverName}</td>
                                                        <td data-label={leaderboardTrendLabel} className="audit-leaderboard-trend-cell">
                                                            <MiniSparkline
                                                                points={trafficServerRowTrends[item.serverId] || []}
                                                                tone="success"
                                                                width={132}
                                                                height={32}
                                                            />
                                                        </td>
                                                        <td data-label={copy.tables.traffic} className="table-cell-right cell-mono-right audit-leaderboard-traffic-cell">{formatBytes(item.totalBytes)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {tab === 'subscriptions' && (
                    <>
                        <div className="card p-4 audit-control-card audit-control-card-subscriptions">
                            <div className="audit-control-head">
                                <div className="audit-control-copy">
                                    <div className="audit-control-title">{copy.workspace.subscriptionsFiltersTitle}</div>
                                    <div className="audit-control-text">{copy.workspace.subscriptionsFiltersSubtitle}</div>
                                </div>
                                <div className="audit-control-actions">
                                    <div className="audit-control-action-group">
                                        <button className="btn btn-primary btn-sm" onClick={() => fetchAccess(1)} disabled={accessLoading}>
                                            <HiOutlineArrowPath className={accessLoading ? 'spinning' : ''} /> {copy.actions.query}
                                        </button>
                                        {activeAccessFilterCount > 0 && (
                                            <button className="btn btn-ghost btn-sm" onClick={handleResetAccessFilters}>
                                                {copy.actions.resetFilters}
                                            </button>
                                        )}
                                    </div>
                                    <div className="audit-control-action-group audit-control-action-group--secondary">
                                        <button className="btn btn-danger btn-sm" onClick={handleClearAccessLogs} title={copy.confirm.clearAccessTitle}>
                                            <HiOutlineTrash /> {copy.actions.clear}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="audit-control-meta audit-control-meta--compact">
                                <span className="audit-control-pill">
                                    {copy.states.total.replace('{count}', String(accessData.total || 0))}
                                </span>
                                <span className={`audit-control-pill ${activeAccessFilterCount > 0 ? 'is-active' : ''}`}>
                                    {activeAccessFilterCount > 0
                                        ? copy.workspace.filtersActive.replace('{count}', String(activeAccessFilterCount))
                                        : copy.workspace.noFilters}
                                </span>
                            </div>
                            <div className="audit-filter-grid audit-filter-grid--subscriptions">
                                <input
                                    className="form-input w-220"
                                    placeholder={copy.filters.userEmailFilter}
                                    value={accessFilters.email}
                                    onChange={(e) => setAccessFilters((prev) => ({ ...prev, email: e.target.value }))}
                                />
                                <select
                                    className="form-select w-160"
                                        value={accessFilters.status}
                                        onChange={(e) => setAccessFilters((prev) => ({ ...prev, status: e.target.value }))}
                                    >
                                        <option value="">{copy.filters.allStatus}</option>
                                        <option value="success">{copy.filters.success}</option>
                                        <option value="denied">{copy.filters.denied}</option>
                                        <option value="expired">{copy.filters.expired}</option>
                                        <option value="revoked">{copy.filters.revoked}</option>
                                    </select>
                            </div>
                        </div>

                        <div className="stats-grid audit-stats-grid">
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">{copy.traffic.pv}</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.total || 0}</div>
                            </div>
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">{copy.traffic.uv}</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.uniqueIpCount || 0}</div>
                            </div>
                            <div className="card audit-stat-card">
                                <div className="card-header"><span className="card-title">{copy.traffic.uniqueUsers}</span><HiOutlineDocumentText /></div>
                                <div className="card-value">{accessSummary.uniqueUsers || 0}</div>
                            </div>
                            {Object.entries(accessData.statusBreakdown || {}).map(([key, value]) => (
                                <div className="card audit-stat-card" key={key}>
                                    <div className="card-header"><span className="card-title">{formatAuditStatusLabel(key, locale)}</span><HiOutlineDocumentText /></div>
                                    <div className="card-value">{value}</div>
                                </div>
                            ))}
                        </div>

                        {accessLoading ? (
                            <div className="glass-panel audit-table-shell audit-subscriptions-table-shell p-4">
                                <SkeletonTable rows={5} cols={6} />
                            </div>
                        ) : accessData.items.length === 0 ? (
                            <div className="glass-panel audit-table-shell audit-subscriptions-table-shell p-4">
                                <EmptyState title={copy.states.noAccess} subtitle={copy.states.noAccessSubtitle} />
                            </div>
                        ) : isCompactLayout ? (
                            <AuditAccessMobileList items={accessData.items} copy={copy} locale={locale} />
                        ) : (
                            <div className="table-container glass-panel audit-table-shell audit-subscriptions-table-shell">
                                <table className="table audit-subscriptions-table">
                                    <thead>
                                        <tr>
                                            <th className="audit-access-time-column">{copy.tables.time}</th>
                                            <th>{copy.tables.user}</th>
                                            <th className="table-cell-center audit-access-result-column">{copy.tables.result}</th>
                                            <th>{copy.tables.realIp}</th>
                                            <th className="audit-access-location-column">{copy.tables.locationCarrier}</th>
                                            <th className="audit-access-ua-column">UA</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accessData.items.map((item) => {
                                            const geoDisplay = resolveAccessGeoDisplay(item);
                                            const userLabel = formatAccessUserLabel(item, copy);
                                            const userMeta = formatAccessUserMeta(item, copy);
                                            const userAgentLabel = formatAuditUserAgent(item.userAgent, locale, item.userAgentMasked === true);
                                            return (
                                            <tr key={item.id}>
                                                <td data-label={copy.tables.time} className="cell-mono audit-access-time-cell" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.ts, locale)}</td>
                                                <td data-label={copy.tables.user}>
                                                    <div className="audit-access-user">
                                                        <span className="audit-access-user-label">{userLabel}</span>
                                                        {userMeta && (
                                                            <span className="audit-access-user-meta">{userMeta}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td data-label={copy.tables.result} className="table-cell-center audit-access-result-cell"><span className={`badge ${statusBadgeClass(item.status)}`}>{formatAuditStatusLabel(item.status, locale)}</span></td>
                                                <td data-label={copy.tables.realIp} className="audit-access-ip-cell" style={{ wordBreak: 'break-all' }}>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-mono">{item.clientIp || item.ip || '-'}</span>
                                                        {item.ipSource && <span className="badge badge-neutral text-xs w-fit">{item.ipSource}</span>}
                                                    </div>
                                                </td>
                                                <td data-label={copy.tables.locationCarrier} className="text-xs audit-access-location-cell">
                                                    <div className="audit-access-location">
                                                        <span>{geoDisplay.location}</span>
                                                        {geoDisplay.carrier && <span className="audit-access-carrier">{geoDisplay.carrier}</span>}
                                                    </div>
                                                </td>
                                                <td data-label={copy.tables.ua} className="text-xs audit-access-ua-cell">
                                                    <div className="audit-access-ua-text" title={userAgentLabel}>
                                                        {userAgentLabel}
                                                    </div>
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="audit-pagination page-pagination">
                            <div className="page-pagination-meta">{copy.states.total.replace('{count}', String(accessData.total || 0))}</div>
                            <div className="page-pagination-actions">
                                <button className="btn btn-secondary btn-sm" disabled={accessPage <= 1 || accessLoading} onClick={() => fetchAccess(accessPage - 1)}>{copy.actions.previous}</button>
                                <span className="text-sm text-muted self-center">
                                    {accessPage} / {accessData.totalPages || 1}
                                </span>
                                <button className="btn btn-secondary btn-sm" disabled={accessPage >= (accessData.totalPages || 1) || accessLoading} onClick={() => fetchAccess(accessPage + 1)}>{copy.actions.next}</button>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'logs' && (
                    <Suspense fallback={(
                        <div className="glass-panel audit-table-shell audit-tab-loading-shell">
                            <span className="spinner spinner-20" />
                        </div>
                    )}>
                        <Logs embedded sourceMode="panel" displayLabel={copy.tabs.logs} />
                    </Suspense>
                )}
                        </div>
                    </div>
                </div>
            </div>

            {selectedEvent && (
                <ModalShell isOpen={!!selectedEvent} onClose={() => setSelectedEvent(null)}>
                    <div className="modal modal-lg audit-event-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{copy.detail.title}</h3>
                            <button className="modal-close" onClick={() => setSelectedEvent(null)}><HiOutlineXMark /></button>
                        </div>
                        <div className="modal-body">
                            {/* 事件摘要 */}
                            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                                <div>
                                    <span className="text-muted">{copy.detail.eventType}: </span>
                                    <span className="font-semibold">{formatAuditEventLabel(selectedEvent, locale)}</span>
                                </div>
                                <div>
                                    <span className="text-muted">{copy.detail.time}: </span>
                                    <span>{formatDateTime(selectedEvent.ts, locale)}</span>
                                </div>
                                <div>
                                    <span className="text-muted">{copy.detail.actor}: </span>
                                    <span className="font-semibold">{formatAuditActorLabel(selectedEvent, locale)}</span>
                                    {selectedEvent.actorRole && (
                                        <span className="badge badge-neutral ml-2 text-xs">{formatAuditActorRole(selectedEvent.actorRole, locale)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-muted">{copy.detail.result}: </span>
                                    <span className={`badge ${statusBadgeClass(selectedEvent.outcome)}`}>{formatAuditStatusLabel(selectedEvent.outcome, locale)}</span>
                                </div>
                                {selectedEvent.ip && (
                                    <div>
                                        <span className="text-muted">{copy.detail.ip}: </span>
                                        <span className="font-mono">{selectedEvent.ip}</span>
                                    </div>
                                )}
                                {formatAuditLocationCarrier(selectedEvent) && (
                                    <div>
                                        <span className="text-muted">{copy.detail.locationCarrier}: </span>
                                        <span>{formatAuditLocationCarrier(selectedEvent)}</span>
                                    </div>
                                )}
                                {selectedEvent.path && (
                                    <div>
                                        <span className="text-muted">{copy.detail.path}: </span>
                                        <span className="font-mono">{selectedEvent.method} {selectedEvent.path}</span>
                                    </div>
                                )}
                                {selectedEvent.serverId && (
                                    <div>
                                        <span className="text-muted">{copy.detail.node}: </span>
                                        <span>{selectedEvent.serverId}</span>
                                    </div>
                                )}
                                {resolveAuditTarget(selectedEvent) !== '-' && (
                                    <div>
                                        <span className="text-muted">{copy.detail.targetUser}: </span>
                                        <span>{resolveAuditTarget(selectedEvent)}</span>
                                    </div>
                                )}
                            </div>

                            {/* 变更前后对比（如有） */}
                            {(selectedEvent.beforeSnapshot || selectedEvent.afterSnapshot) && (
                                <div className="mb-4">
                                    <div className="font-semibold text-sm mb-2 text-primary">{copy.detail.diff}</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {selectedEvent.beforeSnapshot && (
                                            <div>
                                                <div className="text-xs text-danger mb-1 font-semibold">{copy.detail.before}</div>
                                                <pre className="log-viewer log-viewer-compact max-h-[200px] bg-danger/5 border border-danger/15">
                                                    {JSON.stringify(selectedEvent.beforeSnapshot, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                        {selectedEvent.afterSnapshot && (
                                            <div>
                                                <div className="text-xs text-success mb-1 font-semibold">{copy.detail.after}</div>
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
                                <div className="font-semibold text-sm mb-2 text-primary">{copy.detail.payload}</div>
                                <pre className="log-viewer log-viewer-compact">
                                    {JSON.stringify(sanitizeAuditDetailPayload(selectedEvent.details || {}, locale), null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                </ModalShell>
            )}
        </>
    );
}
