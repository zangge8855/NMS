import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    ReloadOutlined,
    ConsoleSqlOutlined,
    EyeOutlined,
    BarChartOutlined,
    TeamOutlined,
    FileTextOutlined,
    FilterOutlined,
    DeleteOutlined,
    DownloadOutlined,
    CloseOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined,
} from '@ant-design/icons';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import {
    Card,
    Button,
    Table,
    Tabs,
    Form,
    Input,
    Select,
    Descriptions,
    Typography,
    Row,
    Col,
    Empty,
    Modal,
    Pagination,
    Badge,
    Space,
    Skeleton,
    Tag,
    Statistic,
    Divider,
    Layout,
} from 'antd';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import { formatBytes, formatDateOnly, formatDateTime as formatDateTimeValue } from '../../utils/format.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import toast from 'react-hot-toast';
import Tasks from '../Tasks/Tasks.jsx';
const Logs = lazy(() => import('../Logs/Logs.jsx'));
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { resolveAccessGeoDisplay } from '../../utils/accessGeo.js';
import MiniSparkline from '../UI/MiniSparkline.jsx';
import useTrafficLeaderboardTrends from '../../hooks/useTrafficLeaderboardTrends.js';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

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

function getStatusTagColor(status) {
    const normalized = normalizeAuditStatus(status);
    if (normalized === 'success') return 'success';
    if (normalized === 'info') return 'processing';
    if (normalized === 'failed' || normalized === 'denied' || normalized === 'revoked' || normalized === 'expired') return 'error';
    return 'default';
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

export default function AuditCenter() {
    const { locale, t } = useI18n();
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
            key: 'events',
            label: (
                <span>
                    <FileTextOutlined style={{ marginRight: 8 }} />
                    {copy.tabs.events}
                </span>
            ),
            icon: FileTextOutlined,
            eyebrow: copy.workspace.eventsEyebrow,
            summary: copy.workspace.eventsSummary,
        },
        {
            key: 'tasks',
            label: (
                <span>
                    <ReloadOutlined style={{ marginRight: 8 }} />
                    {copy.tabs.tasks}
                </span>
            ),
            icon: ReloadOutlined,
            eyebrow: copy.workspace.tasksEyebrow,
            summary: copy.workspace.tasksSummary,
        },
        {
            key: 'traffic',
            label: (
                <span>
                    <BarChartOutlined style={{ marginRight: 8 }} />
                    {copy.tabs.traffic}
                </span>
            ),
            icon: BarChartOutlined,
            eyebrow: copy.workspace.trafficEyebrow,
            summary: copy.workspace.trafficSummary,
        },
        {
            key: 'subscriptions',
            label: (
                <span>
                    <TeamOutlined style={{ marginRight: 8 }} />
                    {copy.tabs.subscriptions}
                </span>
            ),
            icon: TeamOutlined,
            eyebrow: copy.workspace.subscriptionsEyebrow,
            summary: copy.workspace.subscriptionsSummary,
        },
        {
            key: 'logs',
            label: (
                <span>
                    <ConsoleSqlOutlined style={{ marginRight: 8 }} />
                    {copy.tabs.logs}
                </span>
            ),
            icon: ConsoleSqlOutlined,
            eyebrow: copy.workspace.logsEyebrow,
            summary: copy.workspace.logsSummary,
        },
    ]), [copy]);

    const activeAuditTab = useMemo(
        () => auditTabs.find((item) => item.key === tab) || auditTabs[0] || null,
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

    const eventTableColumns = [
        {
            title: copy.tables.time,
            dataIndex: 'ts',
            key: 'ts',
            width: 170,
            render: (ts) => <Text code>{formatDateTime(ts, locale)}</Text>,
        },
        {
            title: copy.tables.event,
            key: 'event',
            render: (_, record) => formatAuditEventLabel(record, locale),
        },
        {
            title: copy.tables.result,
            dataIndex: 'outcome',
            key: 'outcome',
            align: 'center',
            width: 100,
            render: (outcome) => (
                <Tag color={getStatusTagColor(outcome)}>
                    {formatAuditStatusLabel(outcome, locale)}
                </Tag>
            ),
        },
        {
            title: copy.tables.actor,
            key: 'actor',
            render: (_, record) => formatAuditActorLabel(record, locale),
        },
        {
            title: copy.tables.node,
            dataIndex: 'serverId',
            key: 'serverId',
            align: 'center',
            width: 100,
            render: (val) => val || '-',
        },
        {
            title: copy.tables.user,
            key: 'user',
            render: (_, record) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{resolveAuditTarget(record)}</Text>
                    {buildAuditSourceSummary(record) && (
                        <Text type="secondary" size="small">{buildAuditSourceSummary(record)}</Text>
                    )}
                </Space>
            ),
        },
        {
            title: copy.tables.action,
            key: 'action',
            align: 'right',
            width: 100,
            render: (_, record) => (
                <Button
                    icon={<EyeOutlined />}
                    onClick={() => setSelectedEvent(record)}
                >
                    {copy.actions.detail}
                </Button>
            ),
        },
    ];

    const accessTableColumns = [
        {
            title: copy.tables.time,
            dataIndex: 'ts',
            key: 'ts',
            width: 170,
            render: (ts) => <Text code>{formatDateTime(ts, locale)}</Text>,
        },
        {
            title: copy.tables.user,
            key: 'user',
            render: (_, record) => {
                const userLabel = formatAccessUserLabel(record, copy);
                const userMeta = formatAccessUserMeta(record, copy);
                return (
                    <Space direction="vertical" size={0}>
                        <Text strong>{userLabel}</Text>
                        {userMeta && <Text type="secondary" size="small">{userMeta}</Text>}
                    </Space>
                );
            },
        },
        {
            title: copy.tables.result,
            dataIndex: 'status',
            key: 'status',
            align: 'center',
            width: 100,
            render: (status) => (
                <Tag color={getStatusTagColor(status)}>
                    {formatAuditStatusLabel(status, locale)}
                </Tag>
            ),
        },
        {
            title: copy.tables.realIp,
            key: 'realIp',
            render: (_, record) => (
                <Space direction="vertical" size={0}>
                    <Text code>{record.clientIp || record.ip || '-'}</Text>
                    {record.ipSource && <Tag size="small">{record.ipSource}</Tag>}
                </Space>
            ),
        },
        {
            title: copy.tables.locationCarrier,
            key: 'location',
            render: (_, record) => {
                const geoDisplay = resolveAccessGeoDisplay(record);
                return (
                    <Space direction="vertical" size={0}>
                        <Text>{geoDisplay.location}</Text>
                        {geoDisplay.carrier && <Text type="secondary" size="small">{geoDisplay.carrier}</Text>}
                    </Space>
                );
            },
        },
        {
            title: copy.tables.ua,
            dataIndex: 'userAgent',
            key: 'ua',
            ellipsis: true,
            render: (ua, record) => (
                <Text type="secondary" title={formatAuditUserAgent(ua, locale, record.userAgentMasked === true)}>
                    {formatAuditUserAgent(ua, locale, record.userAgentMasked === true)}
                </Text>
            ),
        },
    ];

    const topUserColumns = [
        {
            title: copy.tables.user,
            key: 'user',
            render: (_, record) => formatTrafficUserLabel(record),
        },
        {
            title: leaderboardTrendLabel,
            key: 'trend',
            render: (_, record) => (
                <MiniSparkline
                    points={trafficUserRowTrends[record.email] || []}
                    tone="primary"
                    width={120}
                    height={30}
                />
            ),
        },
        {
            title: copy.tables.traffic,
            dataIndex: 'totalBytes',
            key: 'traffic',
            align: 'right',
            render: (val) => <Text code>{formatBytes(val)}</Text>,
        },
    ];

    const topServerColumns = [
        {
            title: copy.tables.node,
            dataIndex: 'serverName',
            key: 'serverName',
        },
        {
            title: leaderboardTrendLabel,
            key: 'trend',
            render: (_, record) => (
                <MiniSparkline
                    points={trafficServerRowTrends[record.serverId] || []}
                    tone="success"
                    width={120}
                    height={30}
                />
            ),
        },
        {
            title: copy.tables.traffic,
            dataIndex: 'totalBytes',
            key: 'traffic',
            align: 'right',
            render: (val) => <Text code>{formatBytes(val)}</Text>,
        },
    ];

    return (
        <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
            <Header
                title={t('pages.audit.title')}
                eyebrow={t('pages.audit.eyebrow')}
            />
            <Layout.Content style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
                <Card bordered={false} style={{ marginBottom: 24 }}>
                    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                        <Col>
                            <Space align="center">
                                <Title level={4} style={{ margin: 0 }}>{copy.workspace.navLabel}</Title>
                                <Badge
                                    status={currentTabBusy ? 'processing' : 'success'}
                                    text={currentTabBusy ? copy.workspace.loading : copy.workspace.ready}
                                />
                            </Space>
                        </Col>
                    </Row>
                    {activeAuditTab?.summary && (
                        <Paragraph type="secondary">{activeAuditTab.summary}</Paragraph>
                    )}
                    <Tabs
                        activeKey={tab}
                        onChange={setTab}
                        items={auditTabs}
                    />
                </Card>

                <div className="audit-main">
                    {tab === 'events' && (
                        <Space direction="vertical" size={24} style={{ width: '100%' }}>
                            <Card>
                                <Row justify="space-between" align="top" gutter={[16, 16]}>
                                    <Col xs={24} md={12}>
                                        <Title level={5}>{copy.workspace.eventsFiltersTitle}</Title>
                                        <Text type="secondary">{copy.workspace.eventsFiltersSubtitle}</Text>
                                    </Col>
                                    <Col xs={24} md={12} style={{ textAlign: 'right' }}>
                                        <Space wrap>
                                            <Button
                                                type="primary"
                                                icon={<ReloadOutlined spin={eventsLoading} />}
                                                onClick={() => fetchEvents(1)}
                                                loading={eventsLoading}
                                            >
                                                {copy.actions.query}
                                            </Button>
                                            <Button
                                                icon={showAdvancedEventFilters ? <CloseOutlined /> : <FilterOutlined />}
                                                onClick={() => setShowAdvancedEventFilters(!showAdvancedEventFilters)}
                                            >
                                                {showAdvancedEventFilters ? copy.actions.lessFilters : copy.actions.moreFilters}
                                            </Button>
                                            {activeEventFilterCount > 0 && (
                                                <Button type="link" onClick={handleResetEventFilters}>
                                                    {copy.actions.resetFilters}
                                                </Button>
                                            )}
                                            <Button icon={<DownloadOutlined />} onClick={handleExportAuditCSV}>
                                                {copy.actions.export}
                                            </Button>
                                            <Button danger icon={<DeleteOutlined />} onClick={handleClearEvents}>
                                                {copy.actions.clear}
                                            </Button>
                                        </Space>
                                    </Col>
                                </Row>

                                <Divider />

                                <Row gutter={[16, 16]} align="middle">
                                    <Col>
                                        <Badge count={eventsData.total || 0} overflowCount={999999} color="blue" showZero>
                                            <Tag color="blue" style={{ margin: 0 }}>{copy.workspace.recordCount}</Tag>
                                        </Badge>
                                    </Col>
                                    {activeEventFilterCount > 0 && (
                                        <Col>
                                            <Tag color="orange" closable onClose={handleResetEventFilters}>
                                                {copy.workspace.filtersActive.replace('{count}', String(activeEventFilterCount))}
                                            </Tag>
                                        </Col>
                                    )}
                                </Row>

                                <Form layout="inline" style={{ marginTop: 24, gap: '16px 0' }}>
                                    <Form.Item style={{ marginBottom: 0 }}>
                                        <Input
                                            placeholder={copy.filters.keyword}
                                            value={eventFilters.q}
                                            onChange={(e) => setEventFilters(prev => ({ ...prev, q: e.target.value }))}
                                            style={{ width: 200 }}
                                        />
                                    </Form.Item>
                                    <Form.Item style={{ marginBottom: 0 }}>
                                        <Select
                                            value={eventFilters.outcome}
                                            onChange={(val) => setEventFilters(prev => ({ ...prev, outcome: val }))}
                                            style={{ width: 150 }}
                                        >
                                            <Option value="">{copy.filters.allResults}</Option>
                                            <Option value="success">{copy.filters.success}</Option>
                                            <Option value="failed">{copy.filters.failed}</Option>
                                            <Option value="info">{copy.filters.info}</Option>
                                        </Select>
                                    </Form.Item>
                                    <Form.Item style={{ marginBottom: 0 }}>
                                        <Input
                                            placeholder={copy.filters.userOrEmail}
                                            value={eventFilters.targetEmail}
                                            onChange={(e) => setEventFilters(prev => ({ ...prev, targetEmail: e.target.value }))}
                                            style={{ width: 200 }}
                                        />
                                    </Form.Item>

                                    {showAdvancedEventFilters && (
                                        <>
                                            <Form.Item style={{ marginBottom: 0 }}>
                                                <Input
                                                    placeholder={copy.filters.eventType}
                                                    value={eventFilters.eventType}
                                                    onChange={(e) => setEventFilters(prev => ({ ...prev, eventType: e.target.value }))}
                                                    style={{ width: 200 }}
                                                />
                                            </Form.Item>
                                            <Form.Item style={{ marginBottom: 0 }}>
                                                <Input
                                                    placeholder={copy.filters.serverId}
                                                    value={eventFilters.serverId}
                                                    onChange={(e) => setEventFilters(prev => ({ ...prev, serverId: e.target.value }))}
                                                    style={{ width: 150 }}
                                                />
                                            </Form.Item>
                                        </>
                                    )}
                                </Form>
                            </Card>

                            <Table
                                columns={eventTableColumns}
                                dataSource={eventsData.items}
                                rowKey="id"
                                loading={eventsLoading}
                                pagination={{
                                    current: eventsPage,
                                    pageSize: 20,
                                    total: eventsData.total,
                                    onChange: (page) => fetchEvents(page),
                                    showSizeChanger: false,
                                    showTotal: (total) => copy.states.total.replace('{count}', String(total)),
                                }}
                                scroll={{ x: 'max-content' }}
                                locale={{
                                    emptyText: <Empty description={copy.states.noAudit} />
                                }}
                            />
                        </Space>
                    )}

                    {tab === 'tasks' && (
                        <Card>
                            <Tasks embedded />
                        </Card>
                    )}

                    {tab === 'traffic' && (
                        <Space direction="vertical" size={24} style={{ width: '100%' }}>
                            <Card>
                                <Row justify="space-between" align="middle" gutter={[16, 16]}>
                                    <Col>
                                        <Text type="secondary">{copy.workspace.trafficEyebrow}</Text>
                                        <Title level={4} style={{ margin: 0 }}>{copy.tabs.traffic}</Title>
                                        <Text type="secondary">{copy.workspace.trafficSummary}</Text>
                                    </Col>
                                    <Col>
                                        <Space wrap>
                                            <Tag icon={<ReloadOutlined />} color="processing">
                                                {copy.traffic.recentSample}: {formatDateTime(trafficOverview?.lastCollectionAt, locale)}
                                            </Tag>
                                            <Select
                                                value={trafficGranularity}
                                                onChange={setTrafficGranularity}
                                                style={{ width: 150 }}
                                            >
                                                <Option value="auto">{copy.filters.autoGranularity}</Option>
                                                <Option value="hour">{copy.filters.byHour}</Option>
                                                <Option value="day">{copy.filters.byDay}</Option>
                                            </Select>
                                            <Button
                                                type="primary"
                                                icon={<ReloadOutlined spin={trafficLoading} />}
                                                onClick={() => fetchTrafficOverview(true)}
                                                loading={trafficLoading}
                                            >
                                                {copy.actions.refreshSample}
                                            </Button>
                                        </Space>
                                    </Col>
                                </Row>

                                <Divider />

                                <Row gutter={[24, 24]}>
                                    <Col xs={24} lg={12}>
                                        <Card type="inner">
                                            <Statistic
                                                title={copy.traffic.totalTrafficScope}
                                                value={formatBytes(trafficTotals.totalBytes || 0)}
                                                suffix={<Text type="secondary" style={{ fontSize: '14px' }}>{trafficTotalsNote}</Text>}
                                            />
                                            <Row gutter={16} style={{ marginTop: 16 }}>
                                                <Col span={12}>
                                                    <Statistic
                                                        title={copy.traffic.uploadTraffic}
                                                        value={formatBytes(trafficTotals.upBytes || 0)}
                                                        valueStyle={{ fontSize: '18px', color: '#3f8600' }}
                                                    />
                                                </Col>
                                                <Col span={12}>
                                                    <Statistic
                                                        title={copy.traffic.downloadTraffic}
                                                        value={formatBytes(trafficTotals.downBytes || 0)}
                                                        valueStyle={{ fontSize: '18px', color: '#cf1322' }}
                                                    />
                                                </Col>
                                            </Row>
                                        </Card>
                                    </Col>
                                    <Col xs={24} lg={12}>
                                        <Row gutter={[16, 16]}>
                                            <Col span={12}>
                                                <Card type="inner" bodyStyle={{ padding: '16px' }}>
                                                    <Statistic title={copy.traffic.activeAccounts} value={trafficOverview?.activeUsers || 0} />
                                                    <Text type="secondary" size="small">{copy.traffic.activeAccountsScope}</Text>
                                                </Card>
                                            </Col>
                                            <Col span={12}>
                                                <Card type="inner" bodyStyle={{ padding: '16px' }}>
                                                    <Statistic title={copy.traffic.samplePoints} value={trafficOverview?.sampleCount || 0} />
                                                    <Text type="secondary" size="small">{copy.traffic.samplePointsScope}</Text>
                                                </Card>
                                            </Col>
                                            <Col span={24}>
                                                <Card type="inner" bodyStyle={{ padding: '16px' }}>
                                                    <Statistic
                                                        title={copy.workspace.userTrafficSupport}
                                                        value={trafficOverview?.userLevelSupported === false ? copy.workspace.supportLimited : copy.workspace.supportReady}
                                                        valueStyle={{ fontSize: '16px' }}
                                                    />
                                                    <Text type="secondary" size="small">
                                                        {trafficWarningCount > 0
                                                            ? `${copy.workspace.warningNodes} ${trafficWarningCount}`
                                                            : copy.workspace.dataWindowTraffic}
                                                    </Text>
                                                </Card>
                                            </Col>
                                        </Row>
                                    </Col>
                                </Row>
                            </Card>

                            <Row gutter={[24, 24]}>
                                <Col xs={24} xl={12}>
                                    <Card
                                        title={
                                            <Space direction="vertical" size={0}>
                                                <Title level={5} style={{ margin: 0 }}>{copy.traffic.userTrend}</Title>
                                                <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'normal' }}>{copy.traffic.userTrendScope}</Text>
                                            </Space>
                                        }
                                        extra={
                                            <Select
                                                showSearch
                                                placeholder={copy.traffic.selectUser}
                                                value={selectedUser}
                                                onChange={setSelectedUser}
                                                style={{ width: 250 }}
                                                optionFilterProp="children"
                                            >
                                                {topUsers.map((item) => (
                                                    <Option key={item.email} value={item.email}>
                                                        {formatTrafficUserLabel(item)} ({formatBytes(item.totalBytes)})
                                                    </Option>
                                                ))}
                                            </Select>
                                        }
                                    >
                                        {trafficOverview?.userLevelSupported === false && (
                                            <Badge status="warning" text={copy.traffic.userLevelUnsupported} style={{ marginBottom: 16 }} />
                                        )}
                                        <div style={{ marginBottom: 16 }}>
                                            <Text type="secondary">{copy.workspace.currentSelection}: </Text>
                                            <Text strong>{selectedTrafficUser ? formatTrafficUserLabel(selectedTrafficUser) : copy.workspace.noUserSelected}</Text>
                                        </div>
                                        <div style={{ height: 300 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={userTrend.points || []}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                                    <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, userTrend.granularity, locale)} />
                                                    <YAxis />
                                                    <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(value) => formatDateTime(value, locale)} />
                                                    <Line type="monotone" dataKey="totalBytes" stroke="#1890ff" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </Card>
                                </Col>
                                <Col xs={24} xl={12}>
                                    <Card
                                        title={
                                            <Space direction="vertical" size={0}>
                                                <Title level={5} style={{ margin: 0 }}>{copy.traffic.serverTrend}</Title>
                                                <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'normal' }}>{copy.traffic.serverTrendScope}</Text>
                                            </Space>
                                        }
                                        extra={
                                            <Select
                                                showSearch
                                                placeholder={copy.traffic.selectServer}
                                                value={selectedServerId}
                                                onChange={setSelectedServerId}
                                                style={{ width: 250 }}
                                                optionFilterProp="children"
                                            >
                                                {topServers.map((item) => (
                                                    <Option key={item.serverId} value={item.serverId}>
                                                        {item.serverName} ({formatBytes(item.totalBytes)})
                                                    </Option>
                                                ))}
                                            </Select>
                                        }
                                    >
                                        <div style={{ marginBottom: 16 }}>
                                            <Text type="secondary">{copy.workspace.currentSelection}: </Text>
                                            <Text strong>{selectedTrafficServer?.serverName || copy.workspace.noServerSelected}</Text>
                                        </div>
                                        <div style={{ height: 300 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={serverTrend.points || []}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                                    <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, serverTrend.granularity, locale)} />
                                                    <YAxis />
                                                    <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(value) => formatDateTime(value, locale)} />
                                                    <Line type="monotone" dataKey="totalBytes" stroke="#52c41a" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </Card>
                                </Col>
                            </Row>

                            <Row gutter={[24, 24]}>
                                <Col xs={24} xl={12}>
                                    <Card
                                        title={
                                            <Space direction="vertical" size={0}>
                                                <Title level={5} style={{ margin: 0 }}>{copy.traffic.topUsers}</Title>
                                                <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'normal' }}>{copy.traffic.topUsersScope}</Text>
                                            </Space>
                                        }
                                    >
                                        {trafficOverview?.userLevelSupported === false && (
                                            <Badge status="warning" text={copy.traffic.userLevelNoCounts} style={{ marginBottom: 16 }} />
                                        )}
                                        <Table
                                            columns={topUserColumns}
                                            dataSource={topUsers}
                                            rowKey="email"
                                            pagination={{ pageSize: 10, size: 'small' }}
                                            onRow={(record) => ({
                                                onClick: () => setSelectedUser(record.email),
                                                style: { cursor: 'pointer' }
                                            })}
                                            size="small"
                                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.states.noData} /> }}
                                        />
                                    </Card>
                                </Col>
                                <Col xs={24} xl={12}>
                                    <Card
                                        title={
                                            <Space direction="vertical" size={0}>
                                                <Title level={5} style={{ margin: 0 }}>{copy.traffic.topServers}</Title>
                                                <Text type="secondary" style={{ fontSize: '12px', fontWeight: 'normal' }}>{copy.traffic.topServersScope}</Text>
                                            </Space>
                                        }
                                    >
                                        <Table
                                            columns={topServerColumns}
                                            dataSource={topServers}
                                            rowKey="serverId"
                                            pagination={{ pageSize: 10, size: 'small' }}
                                            onRow={(record) => ({
                                                onClick: () => setSelectedServerId(record.serverId),
                                                style: { cursor: 'pointer' }
                                            })}
                                            size="small"
                                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.states.noData} /> }}
                                        />
                                    </Card>
                                </Col>
                            </Row>
                        </Space>
                    )}

                    {tab === 'subscriptions' && (
                        <Space direction="vertical" size={24} style={{ width: '100%' }}>
                            <Card>
                                <Row justify="space-between" align="top" gutter={[16, 16]}>
                                    <Col xs={24} md={12}>
                                        <Title level={5}>{copy.workspace.subscriptionsFiltersTitle}</Title>
                                        <Text type="secondary">{copy.workspace.subscriptionsFiltersSubtitle}</Text>
                                    </Col>
                                    <Col xs={24} md={12} style={{ textAlign: 'right' }}>
                                        <Space wrap>
                                            <Button
                                                type="primary"
                                                icon={<ReloadOutlined spin={accessLoading} />}
                                                onClick={() => fetchAccess(1)}
                                                loading={accessLoading}
                                            >
                                                {copy.actions.query}
                                            </Button>
                                            {activeAccessFilterCount > 0 && (
                                                <Button type="link" onClick={handleResetAccessFilters}>
                                                    {copy.actions.resetFilters}
                                                </Button>
                                            )}
                                            <Button danger icon={<DeleteOutlined />} onClick={handleClearAccessLogs}>
                                                {copy.actions.clear}
                                            </Button>
                                        </Space>
                                    </Col>
                                </Row>

                                <Divider />

                                <Row gutter={[16, 16]} align="middle">
                                    <Col>
                                        <Badge count={accessData.total || 0} overflowCount={999999} color="blue" showZero>
                                            <Tag color="blue" style={{ margin: 0 }}>{copy.workspace.recordCount}</Tag>
                                        </Badge>
                                    </Col>
                                    {activeAccessFilterCount > 0 && (
                                        <Col>
                                            <Tag color="orange" closable onClose={handleResetAccessFilters}>
                                                {copy.workspace.filtersActive.replace('{count}', String(activeAccessFilterCount))}
                                            </Tag>
                                        </Col>
                                    )}
                                </Row>

                                <Form layout="inline" style={{ marginTop: 24 }}>
                                    <Form.Item>
                                        <Input
                                            placeholder={copy.filters.userEmailFilter}
                                            value={accessFilters.email}
                                            onChange={(e) => setAccessFilters(prev => ({ ...prev, email: e.target.value }))}
                                            style={{ width: 250 }}
                                        />
                                    </Form.Item>
                                    <Form.Item>
                                        <Select
                                            value={accessFilters.status}
                                            onChange={(val) => setAccessFilters(prev => ({ ...prev, status: val }))}
                                            style={{ width: 180 }}
                                        >
                                            <Option value="">{copy.filters.allStatus}</Option>
                                            <Option value="success">{copy.filters.success}</Option>
                                            <Option value="denied">{copy.filters.denied}</Option>
                                            <Option value="expired">{copy.filters.expired}</Option>
                                            <Option value="revoked">{copy.filters.revoked}</Option>
                                        </Select>
                                    </Form.Item>
                                </Form>
                            </Card>

                            <Row gutter={[16, 16]}>
                                <Col xs={12} sm={8} lg={4}>
                                    <Card size="small">
                                        <Statistic title={copy.traffic.pv} value={accessSummary.total || 0} valueStyle={{ fontSize: '20px' }} />
                                    </Card>
                                </Col>
                                <Col xs={12} sm={8} lg={4}>
                                    <Card size="small">
                                        <Statistic title={copy.traffic.uv} value={accessSummary.uniqueIpCount || 0} valueStyle={{ fontSize: '20px' }} />
                                    </Card>
                                </Col>
                                <Col xs={12} sm={8} lg={4}>
                                    <Card size="small">
                                        <Statistic title={copy.traffic.uniqueUsers} value={accessSummary.uniqueUsers || 0} valueStyle={{ fontSize: '20px' }} />
                                    </Card>
                                </Col>
                                {Object.entries(accessData.statusBreakdown || {}).map(([key, value]) => (
                                    <Col xs={12} sm={8} lg={4} key={key}>
                                        <Card size="small">
                                            <Statistic title={formatAuditStatusLabel(key, locale)} value={value} valueStyle={{ fontSize: '20px' }} />
                                        </Card>
                                    </Col>
                                ))}
                            </Row>

                            <Table
                                columns={accessTableColumns}
                                dataSource={accessData.items}
                                rowKey="id"
                                loading={accessLoading}
                                pagination={{
                                    current: accessPage,
                                    pageSize: 30,
                                    total: accessData.total,
                                    onChange: (page) => fetchAccess(page),
                                    showSizeChanger: false,
                                    showTotal: (total) => copy.states.total.replace('{count}', String(total)),
                                }}
                                scroll={{ x: 'max-content' }}
                                locale={{
                                    emptyText: <Empty description={copy.states.noAccess} />
                                }}
                            />
                        </Space>
                    )}

                    {tab === 'logs' && (
                        <Suspense fallback={
                            <Card style={{ textAlign: 'center', padding: '50px' }}>
                                <ReloadOutlined spin style={{ fontSize: 24 }} />
                            </Card>
                        }>
                            <Card>
                                <Logs embedded sourceMode="panel" displayLabel={copy.tabs.logs} />
                            </Card>
                        </Suspense>
                    )}
                </div>
            </Layout.Content>

            <Modal
                title={copy.detail.title}
                open={!!selectedEvent}
                onCancel={() => setSelectedEvent(null)}
                footer={[
                    <Button key="close" onClick={() => setSelectedEvent(null)}>
                        {t('common.close') || 'Close'}
                    </Button>
                ]}
                width={800}
            >
                {selectedEvent && (
                    <Space direction="vertical" size={24} style={{ width: '100%' }}>
                        <Descriptions bordered column={{ xxl: 2, xl: 2, lg: 2, md: 1, sm: 1, xs: 1 }}>
                            <Descriptions.Item label={copy.detail.eventType}>
                                <Text strong>{formatAuditEventLabel(selectedEvent, locale)}</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label={copy.detail.time}>
                                {formatDateTime(selectedEvent.ts, locale)}
                            </Descriptions.Item>
                            <Descriptions.Item label={copy.detail.actor}>
                                <Space>
                                    <Text strong>{formatAuditActorLabel(selectedEvent, locale)}</Text>
                                    {selectedEvent.actorRole && (
                                        <Tag>{formatAuditActorRole(selectedEvent.actorRole, locale)}</Tag>
                                    )}
                                </Space>
                            </Descriptions.Item>
                            <Descriptions.Item label={copy.detail.result}>
                                <Tag color={getStatusTagColor(selectedEvent.outcome)}>
                                    {formatAuditStatusLabel(selectedEvent.outcome, locale)}
                                </Tag>
                            </Descriptions.Item>
                            {selectedEvent.ip && (
                                <Descriptions.Item label={copy.detail.ip}>
                                    <Text code>{selectedEvent.ip}</Text>
                                </Descriptions.Item>
                            )}
                            {formatAuditLocationCarrier(selectedEvent) && (
                                <Descriptions.Item label={copy.detail.locationCarrier}>
                                    {formatAuditLocationCarrier(selectedEvent)}
                                </Descriptions.Item>
                            )}
                            {selectedEvent.path && (
                                <Descriptions.Item label={copy.detail.path}>
                                    <Text code>{selectedEvent.method} {selectedEvent.path}</Text>
                                </Descriptions.Item>
                            )}
                            {selectedEvent.serverId && (
                                <Descriptions.Item label={copy.detail.node}>
                                    {selectedEvent.serverId}
                                </Descriptions.Item>
                            )}
                            {resolveAuditTarget(selectedEvent) !== '-' && (
                                <Descriptions.Item label={copy.detail.targetUser}>
                                    {resolveAuditTarget(selectedEvent)}
                                </Descriptions.Item>
                            )}
                        </Descriptions>

                        {(selectedEvent.beforeSnapshot || selectedEvent.afterSnapshot) && (
                            <div>
                                <Title level={5} type="primary">{copy.detail.diff}</Title>
                                <Row gutter={16}>
                                    {selectedEvent.beforeSnapshot && (
                                        <Col span={selectedEvent.afterSnapshot ? 12 : 24}>
                                            <Text type="danger" strong>{copy.detail.before}</Text>
                                            <div style={{
                                                background: '#fff1f0',
                                                border: '1px solid #ffa39e',
                                                padding: '12px',
                                                borderRadius: '4px',
                                                maxHeight: '300px',
                                                overflow: 'auto',
                                                marginTop: '8px'
                                            }}>
                                                <pre style={{ margin: 0, fontSize: '12px' }}>
                                                    {JSON.stringify(selectedEvent.beforeSnapshot, null, 2)}
                                                </pre>
                                            </div>
                                        </Col>
                                    )}
                                    {selectedEvent.afterSnapshot && (
                                        <Col span={selectedEvent.beforeSnapshot ? 12 : 24}>
                                            <Text type="success" strong>{copy.detail.after}</Text>
                                            <div style={{
                                                background: '#f6ffed',
                                                border: '1px solid #b7eb8f',
                                                padding: '12px',
                                                borderRadius: '4px',
                                                maxHeight: '300px',
                                                overflow: 'auto',
                                                marginTop: '8px'
                                            }}>
                                                <pre style={{ margin: 0, fontSize: '12px' }}>
                                                    {JSON.stringify(selectedEvent.afterSnapshot, null, 2)}
                                                </pre>
                                            </div>
                                        </Col>
                                    )}
                                </Row>
                            </div>
                        )}

                        <div>
                            <Title level={5} type="primary">{copy.detail.payload}</Title>
                            <div style={{
                                background: '#f5f5f5',
                                padding: '12px',
                                borderRadius: '4px',
                                maxHeight: '400px',
                                overflow: 'auto'
                            }}>
                                <pre style={{ margin: 0, fontSize: '12px' }}>
                                    {JSON.stringify(sanitizeAuditDetailPayload(selectedEvent.details || {}, locale), null, 2)}
                                </pre>
                            </div>
                        </div>
                    </Space>
                )}
            </Modal>
        </Layout>
    );
}
