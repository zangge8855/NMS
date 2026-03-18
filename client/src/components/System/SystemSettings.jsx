import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { copyToClipboard, formatBytes, formatDateTime as formatDateTimeValue } from '../../utils/format.js';
import {
    HiOutlineArrowDownTray,
    HiOutlineArrowUpTray,
    HiOutlineChartBarSquare,
    HiOutlineCircleStack,
    HiOutlineCog6Tooth,
    HiOutlineCommandLine,
    HiOutlineExclamationTriangle,
    HiOutlineServerStack,
    HiOutlineShieldCheck,
    HiOutlineXMark,
} from 'react-icons/hi2';
import TaskProgressModal from '../Tasks/TaskProgressModal.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import ServerManagement from '../Server/Server.jsx';

function toInt(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function toBoundedInt(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseStoreKeys(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function toText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function maskChatIdValue(value) {
    const text = toText(value, '');
    if (!text) return '';
    if (text.length <= 4) return '*'.repeat(text.length);
    return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function resolveChatIdPreviewValue(preview, value) {
    const previewText = toText(preview, '');
    if (previewText) return previewText;
    return maskChatIdValue(value) || '-';
}

function normalizeSiteAccessPathInput(value, fallback = '/') {
    const fallbackValue = String(fallback || '/').trim() || '/';
    const text = String(value || '').trim();
    if (!text) return fallbackValue;
    if (/[\s?#]/.test(text)) return fallbackValue;

    const segments = text
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean);

    if (segments.some((item) => item === '.' || item === '..')) {
        return fallbackValue;
    }

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function buildAppEntryPath(basePath = '/', route = '/') {
    const normalizedBasePath = normalizeSiteAccessPathInput(basePath, '/');
    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
    if (normalizedBasePath === '/') return normalizedRoute;
    return normalizedRoute === '/' ? normalizedBasePath : `${normalizedBasePath}${normalizedRoute}`;
}

function generateRandomSiteAccessPath() {
    const wordPool = ['nova', 'relay', 'vault', 'matrix', 'core', 'flux', 'vector', 'edge', 'signal', 'lattice'];
    const randomWord = () => wordPool[Math.floor(Math.random() * wordPool.length)];
    const bytes = typeof window !== 'undefined' && window.crypto?.getRandomValues
        ? window.crypto.getRandomValues(new Uint8Array(5))
        : Array.from({ length: 5 }, () => Math.floor(Math.random() * 256));
    const randomToken = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `/${randomWord()}-${randomWord()}/${randomToken}`;
}

const CAMOUFLAGE_TEMPLATE_OPTIONS = [
    { value: 'corporate', label: 'Corporate' },
    { value: 'nginx', label: 'Nginx' },
    { value: 'blog', label: 'Blog' },
];

function buildDraft(source = null) {
    const settings = source || {};
    const defaultAuditIpGeoProvider = 'ip_api';
    const defaultAuditIpGeoEndpoint = 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN';
    return {
        site: {
            accessPath: normalizeSiteAccessPathInput(settings.site?.accessPath, '/'),
            camouflageEnabled: settings.site?.camouflageEnabled === true,
            camouflageTemplate: toText(settings.site?.camouflageTemplate, 'corporate'),
            camouflageTitle: toText(settings.site?.camouflageTitle, 'Edge Precision Systems'),
        },
        registration: {
            inviteOnlyEnabled: settings.registration?.inviteOnlyEnabled === true,
        },
        security: {
            requireHighRiskConfirmation: Boolean(settings.security?.requireHighRiskConfirmation),
            mediumRiskMinTargets: toInt(settings.security?.mediumRiskMinTargets, 20),
            highRiskMinTargets: toInt(settings.security?.highRiskMinTargets, 100),
            riskTokenTtlSeconds: toInt(settings.security?.riskTokenTtlSeconds, 180),
        },
        jobs: {
            retentionDays: toInt(settings.jobs?.retentionDays, 90),
            maxPageSize: toInt(settings.jobs?.maxPageSize, 200),
            maxRecords: toInt(settings.jobs?.maxRecords, 2000),
            maxConcurrency: toInt(settings.jobs?.maxConcurrency, 10),
            defaultConcurrency: toInt(settings.jobs?.defaultConcurrency, 5),
        },
        audit: {
            retentionDays: toInt(settings.audit?.retentionDays, 365),
            maxPageSize: toInt(settings.audit?.maxPageSize, 200),
        },
        subscription: {
            publicBaseUrl: toText(settings.subscription?.publicBaseUrl, ''),
            converterBaseUrl: toText(settings.subscription?.converterBaseUrl, ''),
        },
        auditIpGeo: {
            enabled: settings.auditIpGeo?.enabled === true,
            provider: toText(settings.auditIpGeo?.provider, defaultAuditIpGeoProvider),
            endpoint: toText(settings.auditIpGeo?.endpoint, defaultAuditIpGeoEndpoint),
            timeoutMs: toInt(settings.auditIpGeo?.timeoutMs, 1500),
            cacheTtlSeconds: toInt(settings.auditIpGeo?.cacheTtlSeconds, 21600),
        },
        telegram: {
            enabled: settings.telegram?.enabled === true,
            botToken: toText(settings.telegram?.botToken, ''),
            clearBotToken: settings.telegram?.clearBotToken === true,
            chatId: toText(settings.telegram?.chatId, ''),
            commandMenuEnabled: settings.telegram?.commandMenuEnabled === true,
            opsDigestIntervalMinutes: toInt(settings.telegram?.opsDigestIntervalMinutes, 30),
            dailyDigestIntervalHours: toInt(settings.telegram?.dailyDigestIntervalHours, 24),
            sendSystemStatus: settings.telegram?.sendSystemStatus !== false,
            sendSecurityAudit: settings.telegram?.sendSecurityAudit !== false,
            sendEmergencyAlerts: settings.telegram?.sendEmergencyAlerts !== false,
        },
    };
}

function buildNoticeDraft(source = null, fallbackUrl = '') {
    const publicBaseUrl = toText(source?.subscription?.publicBaseUrl, '');
    const actionUrl = publicBaseUrl || toText(fallbackUrl, '');
    return {
        subject: '服务入口地址变更通知',
        message: '服务入口地址已更新，请通过下方链接获取最新地址和订阅入口。\n\n如果旧域名已经失效，请尽快更新浏览器收藏、订阅管理器或客户端中的旧地址。',
        actionUrl,
        actionLabel: '查看最新地址',
        scope: 'all',
        includeDisabled: true,
    };
}

const DEFAULT_SETTINGS_TAB = 'access';
const SETTINGS_TAB_CONFIG = [
    {
        id: 'status',
        label: '系统状态',
        icon: HiOutlineChartBarSquare,
        eyebrow: 'Overview',
        summary: '关键状态一览',
    },
    {
        id: 'access',
        label: '入口与订阅',
        icon: HiOutlineCog6Tooth,
        eyebrow: 'Access',
        summary: '入口、订阅、注册配置',
    },
    {
        id: 'policy',
        label: '策略与审计',
        icon: HiOutlineShieldCheck,
        eyebrow: 'Policy',
        summary: '任务容量、风控、审计',
    },
    {
        id: 'db',
        label: '数据与备份',
        icon: HiOutlineCircleStack,
        eyebrow: 'Storage',
        summary: '数据库、备份、恢复',
    },
    {
        id: 'backup',
        label: '安全与备份',
        icon: HiOutlineArrowDownTray,
        eyebrow: 'Backup',
        summary: '加密备份与凭据轮换',
    },
    {
        id: 'monitor',
        label: '运维监控',
        icon: HiOutlineServerStack,
        eyebrow: 'Ops',
        summary: '诊断、控制台、巡检',
    },
    {
        id: 'console',
        label: '节点控制台',
        icon: HiOutlineCommandLine,
        eyebrow: 'Console',
        summary: '远程节点操作',
    },
];

const SETTINGS_WORKSPACE_CONFIG = [
    {
        id: 'status',
        label: '系统状态',
        icon: HiOutlineChartBarSquare,
        routeTab: 'status',
    },
    {
        id: 'access',
        label: '对外访问',
        icon: HiOutlineCog6Tooth,
        routeTab: 'access',
    },
    {
        id: 'policy',
        label: '安全审计',
        icon: HiOutlineShieldCheck,
        routeTab: 'policy',
    },
    {
        id: 'operations',
        label: '运维通知',
        icon: HiOutlineServerStack,
        routeTab: 'monitor',
    },
    {
        id: 'backup',
        label: '数据备份',
        icon: HiOutlineArrowDownTray,
        routeTab: 'backup',
    },
];

function resolveSettingsTab(value) {
    if (value === 'basic') return 'access';
    return SETTINGS_TAB_CONFIG.some((item) => item.id === value) ? value : DEFAULT_SETTINGS_TAB;
}

function resolveWorkspaceSection(value) {
    const normalized = resolveSettingsTab(value);
    if (normalized === 'status') return 'status';
    if (normalized === 'policy') return 'policy';
    if (normalized === 'db' || normalized === 'backup') return 'backup';
    if (normalized === 'monitor' || normalized === 'console') return 'operations';
    return 'access';
}

function formatDateTime(value, locale = 'zh-CN') {
    if (!value) return locale === 'en-US' ? 'N/A' : '暂无';
    return formatDateTimeValue(value, locale);
}

function SettingsPanelHeader({ title, subtitle }) {
    return (
        <div className="settings-panel-head">
            <div className="settings-panel-title">{title}</div>
            {subtitle ? <div className="settings-panel-subtitle">{subtitle}</div> : null}
        </div>
    );
}

function SettingsWorkspaceSection({
    workspaceId = 'default',
    eyebrow,
    title,
    subtitle,
    summary,
    badges = null,
    highlights = [],
    actions = null,
    children,
}) {
    const hasHero = Boolean(eyebrow || title || subtitle || summary || badges || actions || highlights.length > 0);

    return (
        <section className="card settings-workspace-section" data-workspace={workspaceId}>
            {hasHero ? (
                <div className="settings-tab-hero settings-workspace-hero">
                    <div className="settings-tab-hero-copy">
                        {eyebrow ? <div className="settings-tab-hero-eyebrow">{eyebrow}</div> : null}
                        {title ? <div className="settings-tab-hero-title">{title}</div> : null}
                        {subtitle ? <div className="settings-workspace-hero-subtitle">{subtitle}</div> : null}
                        {summary ? <div className="settings-tab-hero-summary">{summary}</div> : null}
                        {badges ? <div className="settings-workspace-hero-badges">{badges}</div> : null}
                        {actions ? <div className="settings-workspace-hero-actions">{actions}</div> : null}
                    </div>
                    {highlights.length > 0 ? (
                        <div className="settings-tab-hero-grid settings-workspace-highlight-grid">
                            {highlights.map((item) => (
                                <div key={item.label} className="settings-tab-highlight-card settings-workspace-highlight-card">
                                    <div className="settings-tab-highlight-label">{item.label}</div>
                                    <div className="settings-tab-highlight-value">{item.value}</div>
                                    {item.detail ? <div className="settings-tab-highlight-detail">{item.detail}</div> : null}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="settings-workspace-section-body">
                {children}
            </div>
        </section>
    );
}

function getSummaryToneBadgeMeta(tone) {
    if (tone === 'success') return { className: 'badge-success', label: '正常' };
    if (tone === 'warning') return { className: 'badge-warning', label: '关注' };
    if (tone === 'danger') return { className: 'badge-danger', label: '关闭' };
    return { className: 'badge-neutral', label: '待检查' };
}

function getMonitorReasonLabel(reasonCode) {
    if (reasonCode === 'dns_error') return 'DNS';
    if (reasonCode === 'connect_timeout') return '超时';
    if (reasonCode === 'connection_refused') return '拒绝连接';
    if (reasonCode === 'network_error') return '网络异常';
    if (reasonCode === 'auth_failed') return '认证失败';
    if (reasonCode === 'credentials_missing') return '凭据缺失';
    if (reasonCode === 'credentials_unreadable') return '凭据不可解密';
    if (reasonCode === 'status_unsupported') return '接口不兼容';
    if (reasonCode === 'xray_not_running') return 'Xray 未运行';
    if (reasonCode === 'panel_request_failed') return '请求失败';
    return '';
}

function SettingsToggleCard({
    checked,
    onChange,
    disabled = false,
    label,
    description,
    activeLabel = '已开启',
    inactiveLabel = '已关闭',
}) {
    return (
        <label className={`settings-toggle-card${checked ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}>
            <div className="settings-toggle-copy">
                <div className="settings-toggle-label">{label}</div>
                {description ? <div className="settings-toggle-description">{description}</div> : null}
            </div>
            <div className="settings-toggle-side">
                <span className={`badge settings-toggle-badge ${checked ? 'badge-success' : 'badge-neutral'}`}>
                    {checked ? activeLabel : inactiveLabel}
                </span>
                <input
                    type="checkbox"
                    className="settings-toggle-input"
                    checked={checked}
                    onChange={onChange}
                    disabled={disabled}
                />
                <span className="settings-toggle-switch" aria-hidden="true">
                    <span className="settings-toggle-thumb" />
                </span>
            </div>
        </label>
    );
}

function formatInviteDuration(days) {
    const normalized = Math.max(0, Number(days) || 0);
    return normalized > 0 ? `${normalized} 天` : '不限时';
}

function getInviteStatusMeta(item = {}) {
    if (item.status === 'active') {
        return {
            className: 'badge-success',
            label: Number(item.remainingUses || 0) > 0 ? '可使用' : '待检查',
        };
    }
    if (item.status === 'revoked') {
        return {
            className: 'badge-danger',
            label: '已撤销',
        };
    }
    return {
        className: 'badge-neutral',
        label: '已用完',
    };
}

function areComparableSettingsEqual(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export default function SystemSettings() {
    const { locale, t } = useI18n();
    const { user } = useAuth();
    const confirmAction = useConfirm();
    const isAdmin = user?.role === 'admin';
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedView = resolveSettingsTab(searchParams.get('tab'));
    const activeWorkspaceSectionId = resolveWorkspaceSection(requestedView);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(null);
    const [draft, setDraft] = useState(buildDraft(null));
    const [dbLoading, setDbLoading] = useState(false);
    const [dbStatus, setDbStatus] = useState(null);
    const [dbModeDraft, setDbModeDraft] = useState({
        readMode: 'file',
        writeMode: 'file',
        hydrateOnReadDb: true,
    });
    const [dbBackfillDraft, setDbBackfillDraft] = useState({
        dryRun: true,
        redact: true,
        keysText: '',
    });
    const [dbSwitchLoading, setDbSwitchLoading] = useState(false);
    const [dbBackfillLoading, setDbBackfillLoading] = useState(false);
    const [dbBackfillResult, setDbBackfillResult] = useState(null);
    const [backfillTaskId, setBackfillTaskId] = useState(null);
    const [emailStatusLoading, setEmailStatusLoading] = useState(false);
    const [emailTestLoading, setEmailTestLoading] = useState(false);
    const [emailStatus, setEmailStatus] = useState(null);
    const [noticeModalOpen, setNoticeModalOpen] = useState(false);
    const [noticeSending, setNoticeSending] = useState(false);
    const [noticeTaskId, setNoticeTaskId] = useState(null);
    const [noticeDraft, setNoticeDraft] = useState(buildNoticeDraft(null));
    const [noticePreviewLoading, setNoticePreviewLoading] = useState(false);
    const [noticePreviewError, setNoticePreviewError] = useState('');
    const [noticePreview, setNoticePreview] = useState(null);
    const [backupLoading, setBackupLoading] = useState(false);
    const [backupStatusLoading, setBackupStatusLoading] = useState(false);
    const [backupStatus, setBackupStatus] = useState(null);
    const [backupInspectLoading, setBackupInspectLoading] = useState(false);
    const [backupRestoreLoading, setBackupRestoreLoading] = useState(false);
    const [backupLocalSaving, setBackupLocalSaving] = useState(false);
    const [backupLocalActionKey, setBackupLocalActionKey] = useState('');
    const [backupFile, setBackupFile] = useState(null);
    const [backupInspection, setBackupInspection] = useState(null);
    const [backupRestoreModalOpen, setBackupRestoreModalOpen] = useState(false);
    const [backupRestoreConfirmed, setBackupRestoreConfirmed] = useState(false);
    const [backupUploadProgress, setBackupUploadProgress] = useState(0);
    const [backupDragActive, setBackupDragActive] = useState(false);
    const [monitorLoading, setMonitorLoading] = useState(false);
    const [monitorStatusLoading, setMonitorStatusLoading] = useState(false);
    const [monitorStatus, setMonitorStatus] = useState(null);
    const [telegramTestLoading, setTelegramTestLoading] = useState(false);
    const [editingTelegramChatId, setEditingTelegramChatId] = useState(false);
    const [registrationRuntime, setRegistrationRuntime] = useState(null);
    const [inviteCodesLoading, setInviteCodesLoading] = useState(false);
    const [inviteCodeActionKey, setInviteCodeActionKey] = useState('');
    const [_inviteCodes, setInviteCodes] = useState([]);
    const [inviteGenerationDraft, setInviteGenerationDraft] = useState({
        count: '1',
        usageLimit: '1',
        subscriptionDays: '30',
    });
    const [latestInviteCodes, setLatestInviteCodes] = useState([]);
    const [latestInviteBatch, setLatestInviteBatch] = useState({
        count: 0,
        usageLimit: 1,
        subscriptionDays: 30,
    });
    const [consoleExpanded, setConsoleExpanded] = useState(() => requestedView === 'console');
    const lazyLoadRef = useRef({
        settings: false,
        dbStatus: false,
        emailStatus: false,
        backupStatus: false,
        monitorStatus: false,
        registrationRuntime: false,
        inviteCodes: false,
    });
    const emailConfiguredBadge = emailStatus?.configured ? 'badge-success' : 'badge-warning';
    const emailConfiguredLabel = emailStatus?.configured ? '已配置' : '未配置';
    const emailDeliveryBadge = emailStatus?.lastDelivery?.success === true
        ? 'badge-success'
        : emailStatus?.lastDelivery?.success === false
            ? 'badge-danger'
            : 'badge-neutral';
    const emailDeliveryLabel = emailStatus?.lastDelivery?.success === true
        ? '最近发送成功'
        : emailStatus?.lastDelivery?.success === false
            ? '最近发送失败'
            : '暂无发送记录';
    const emailVerificationBadge = emailStatus?.lastVerification?.success === true
        ? 'badge-success'
        : emailStatus?.lastVerification?.success === false
            ? 'badge-danger'
            : 'badge-neutral';
    const emailVerificationLabel = emailStatus?.lastVerification?.success === true
        ? '连接测试成功'
        : emailStatus?.lastVerification?.success === false
            ? '连接测试失败'
            : '未测试';
    const converterBaseUrl = toText(draft.subscription.converterBaseUrl, '');
    const siteAccessPath = normalizeSiteAccessPathInput(draft.site.accessPath, '/');
    const registrationEnabled = registrationRuntime?.enabled !== false;
    const siteEntryPreview = useMemo(() => {
        if (typeof window === 'undefined') return siteAccessPath;
        return `${window.location.origin}${buildAppEntryPath(siteAccessPath, '/')}`;
    }, [siteAccessPath]);
    const baselineDraft = useMemo(() => buildDraft(settings), [settings]);
    const hasPendingChanges = useMemo(() => {
        if (!settings) return false;
        return !areComparableSettingsEqual(draft, baselineDraft);
    }, [baselineDraft, draft, settings]);
    const dirtySectionMap = useMemo(() => {
        if (!settings) {
            return {
                site: false,
                registration: false,
                security: false,
                audit: false,
                auditIpGeo: false,
                subscription: false,
                telegram: false,
            };
        }
        return {
            site: !areComparableSettingsEqual(draft.site, baselineDraft.site),
            registration: !areComparableSettingsEqual(draft.registration, baselineDraft.registration),
            security: !areComparableSettingsEqual(draft.security, baselineDraft.security),
            audit: !areComparableSettingsEqual(draft.audit, baselineDraft.audit),
            auditIpGeo: !areComparableSettingsEqual(draft.auditIpGeo, baselineDraft.auditIpGeo),
            subscription: !areComparableSettingsEqual(draft.subscription, baselineDraft.subscription),
            telegram: !areComparableSettingsEqual(draft.telegram, baselineDraft.telegram),
        };
    }, [baselineDraft, draft, settings]);
    const workspaceDirtyMap = useMemo(() => ({
        status: false,
        access: dirtySectionMap.site || dirtySectionMap.registration || dirtySectionMap.subscription,
        policy: dirtySectionMap.security || dirtySectionMap.audit || dirtySectionMap.auditIpGeo,
        operations: dirtySectionMap.telegram,
        backup: false,
    }), [dirtySectionMap]);
    const dirtyWorkspaceIds = useMemo(() => (
        Object.entries(workspaceDirtyMap)
            .filter(([, isDirty]) => isDirty)
            .map(([workspaceId]) => workspaceId)
    ), [workspaceDirtyMap]);
    const dirtyWorkspaceCount = dirtyWorkspaceIds.length;
    const inviteRecords = useMemo(() => (Array.isArray(_inviteCodes) ? _inviteCodes : []), [_inviteCodes]);
    const inviteActiveCount = useMemo(
        () => inviteRecords.filter((item) => item.status === 'active' && Number(item.remainingUses || 0) > 0).length,
        [inviteRecords]
    );
    const inviteRemainingUses = useMemo(
        () => inviteRecords.reduce((sum, item) => sum + Math.max(0, Number(item.remainingUses || 0)), 0),
        [inviteRecords]
    );
    const inviteUsedCount = useMemo(
        () => inviteRecords.filter((item) => item.status === 'used' || Number(item.remainingUses || 0) <= 0).length,
        [inviteRecords]
    );
    const inviteRevokedCount = useMemo(
        () => inviteRecords.filter((item) => item.status === 'revoked').length,
        [inviteRecords]
    );
    const inviteConsumedUses = useMemo(
        () => inviteRecords.reduce((sum, item) => sum + Math.max(0, Number(item.usedCount || 0)), 0),
        [inviteRecords]
    );
    const inviteAvailableRecords = useMemo(
        () => inviteRecords.filter((item) => item.status === 'active' && Number(item.remainingUses || 0) > 0),
        [inviteRecords]
    );
    const inviteRecentUsedAt = useMemo(() => (
        inviteRecords
            .filter((item) => item.usedAt)
            .sort((left, right) => new Date(right.usedAt).getTime() - new Date(left.usedAt).getTime())[0] || null
    ), [inviteRecords]);
    const inviteCodeActionLoading = inviteCodeActionKey !== '';

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const res = await api.get('/system/settings');
            const payload = res.data?.obj || null;
            setSettings(payload);
            setDraft(buildDraft(payload));
            setEditingTelegramChatId(false);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '加载系统设置失败');
        }
        setLoading(false);
    };

    const fetchDbStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setDbLoading(true);
        try {
            const res = await api.get('/system/db/status');
            const payload = res.data?.obj || null;
            setDbStatus(payload);
            setDbModeDraft({
                readMode: payload?.currentModes?.readMode || 'file',
                writeMode: payload?.currentModes?.writeMode || 'file',
                hydrateOnReadDb: true,
            });
            setDbBackfillDraft((prev) => ({
                dryRun: typeof payload?.defaults?.dryRun === 'boolean' ? payload.defaults.dryRun : prev.dryRun,
                redact: typeof payload?.defaults?.redact === 'boolean' ? payload.defaults.redact : prev.redact,
                keysText: prev.keysText,
            }));
        } catch (error) {
            if (!quiet) {
                toast.error(error.response?.data?.msg || error.message || '加载数据库状态失败');
            }
        }
        setDbLoading(false);
    };

    const fetchEmailStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setEmailStatusLoading(true);
        try {
            const res = await api.get('/system/email/status');
            setEmailStatus(res.data?.obj || null);
        } catch (error) {
            if (!quiet) {
                toast.error(error.response?.data?.msg || error.message || '加载 SMTP 状态失败');
            }
        }
        setEmailStatusLoading(false);
    };

    const testEmailConnection = async () => {
        if (!isAdmin) return;
        setEmailTestLoading(true);
        try {
            const res = await api.post('/system/email/test');
            setEmailStatus(res.data?.obj || null);
            toast.success(res.data?.msg || 'SMTP 连接验证成功');
        } catch (error) {
            const payload = error.response?.data?.obj || null;
            if (payload) setEmailStatus(payload);
            toast.error(error.response?.data?.msg || error.message || 'SMTP 连接验证失败');
        }
        setEmailTestLoading(false);
    };

    const openNoticeModal = () => {
        setNoticeDraft(buildNoticeDraft(settings, siteEntryPreview));
        setNoticePreview(null);
        setNoticePreviewError('');
        setNoticeModalOpen(true);
    };

    const sendRegisteredUserNotice = async () => {
        if (!isAdmin) return;
        if (!noticeDraft.subject.trim()) {
            toast.error('通知主题不能为空');
            return;
        }
        if (!noticeDraft.message.trim()) {
            toast.error('通知内容不能为空');
            return;
        }

        setNoticeSending(true);
        try {
            const res = await api.post('/system/email/notice-users', {
                subject: noticeDraft.subject,
                message: noticeDraft.message,
                actionUrl: noticeDraft.actionUrl,
                actionLabel: noticeDraft.actionLabel,
                scope: noticeDraft.scope,
                includeDisabled: noticeDraft.includeDisabled,
            });
            const payload = res.data?.obj || null;
            if (payload?.taskId) {
                setNoticeTaskId(payload.taskId);
            }
            setNoticeModalOpen(false);
            toast.success(res.data?.msg || '通知发送任务已创建');
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '创建通知发送任务失败');
        }
        setNoticeSending(false);
    };

    const fetchNoticePreview = async (draftInput) => {
        const payload = draftInput || noticeDraft;
        setNoticePreviewLoading(true);
        try {
            const res = await api.post('/system/email/notice-users/preview', {
                subject: payload.subject,
                message: payload.message,
                actionUrl: payload.actionUrl,
                actionLabel: payload.actionLabel,
                scope: payload.scope,
                includeDisabled: payload.includeDisabled,
            });
            setNoticePreview(res.data?.obj || null);
            setNoticePreviewError('');
        } catch (error) {
            setNoticePreview(null);
            setNoticePreviewError(error.response?.data?.msg || error.message || '加载邮件预览失败');
        }
        setNoticePreviewLoading(false);
    };

    const fetchBackupStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setBackupStatusLoading(true);
        try {
            const res = await api.get('/system/backup/status');
            setBackupStatus(res.data?.obj || null);
        } catch (error) {
            if (!quiet) {
                toast.error(error.response?.data?.msg || error.message || '加载备份状态失败');
            }
        }
        setBackupStatusLoading(false);
    };

    const fetchMonitorStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setMonitorStatusLoading(true);
        try {
            const res = await api.get('/system/monitor/status');
            setMonitorStatus(res.data?.obj || null);
        } catch (error) {
            if (!quiet) {
                toast.error(error.response?.data?.msg || error.message || '加载监控状态失败');
            }
        }
        setMonitorStatusLoading(false);
    };

    const fetchRegistrationRuntime = async () => {
        try {
            const res = await api.get('/auth/registration-status');
            setRegistrationRuntime(res.data?.obj || null);
        } catch {
            setRegistrationRuntime(null);
        }
    };

    const fetchInviteCodes = async (options = {}) => {
        const quiet = options.quiet === true;
        setInviteCodesLoading(true);
        try {
            const res = await api.get('/system/invite-codes');
            setInviteCodes(Array.isArray(res.data?.obj) ? res.data.obj : []);
        } catch (error) {
            if (!quiet) {
                toast.error(error.response?.data?.msg || error.message || '加载邀请码失败');
            }
        }
        setInviteCodesLoading(false);
    };

    useEffect(() => {
        if (!isAdmin) {
            setLoading(false);
            return;
        }
        if (lazyLoadRef.current.settings) return;
        lazyLoadRef.current.settings = true;
        fetchSettings();
    }, [isAdmin]);

    useEffect(() => {
        if (!isAdmin) return;

        const ensureDbStatus = () => {
            if (lazyLoadRef.current.dbStatus) return;
            lazyLoadRef.current.dbStatus = true;
            fetchDbStatus({ quiet: true });
        };
        const ensureEmailStatus = () => {
            if (lazyLoadRef.current.emailStatus) return;
            lazyLoadRef.current.emailStatus = true;
            fetchEmailStatus({ quiet: true });
        };
        const ensureBackupStatus = () => {
            if (lazyLoadRef.current.backupStatus) return;
            lazyLoadRef.current.backupStatus = true;
            fetchBackupStatus({ quiet: true });
        };
        const ensureMonitorStatus = () => {
            if (lazyLoadRef.current.monitorStatus) return;
            lazyLoadRef.current.monitorStatus = true;
            fetchMonitorStatus({ quiet: true });
        };
        const ensureRegistrationRuntime = () => {
            if (lazyLoadRef.current.registrationRuntime) return;
            lazyLoadRef.current.registrationRuntime = true;
            fetchRegistrationRuntime();
        };
        const ensureInviteCodes = () => {
            if (lazyLoadRef.current.inviteCodes) return;
            lazyLoadRef.current.inviteCodes = true;
            fetchInviteCodes({ quiet: true });
        };

        if (activeWorkspaceSectionId === 'status') {
            ensureRegistrationRuntime();
            ensureDbStatus();
            ensureEmailStatus();
            ensureBackupStatus();
            ensureMonitorStatus();
            return;
        }

        if (activeWorkspaceSectionId === 'access') {
            ensureRegistrationRuntime();
            ensureInviteCodes();
            return;
        }

        if (activeWorkspaceSectionId === 'backup') {
            ensureDbStatus();
            ensureBackupStatus();
            return;
        }

        if (activeWorkspaceSectionId === 'operations') {
            ensureEmailStatus();
            ensureMonitorStatus();
        }
    }, [activeWorkspaceSectionId, isAdmin]);

    useEffect(() => {
        if (requestedView === 'console') {
            setConsoleExpanded(true);
        }
    }, [requestedView]);

    useEffect(() => {
        if (!noticeModalOpen) return undefined;

        let active = true;
        const timer = window.setTimeout(async () => {
            try {
                setNoticePreviewLoading(true);
                const res = await api.post('/system/email/notice-users/preview', {
                    subject: noticeDraft.subject,
                    message: noticeDraft.message,
                    actionUrl: noticeDraft.actionUrl,
                    actionLabel: noticeDraft.actionLabel,
                    scope: noticeDraft.scope,
                    includeDisabled: noticeDraft.includeDisabled,
                });
                if (!active) return;
                setNoticePreview(res.data?.obj || null);
                setNoticePreviewError('');
            } catch (error) {
                if (!active) return;
                setNoticePreview(null);
                setNoticePreviewError(error.response?.data?.msg || error.message || '加载邮件预览失败');
            }
            if (active) setNoticePreviewLoading(false);
        }, 240);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [
        noticeModalOpen,
        noticeDraft.subject,
        noticeDraft.message,
        noticeDraft.actionUrl,
        noticeDraft.actionLabel,
        noticeDraft.scope,
        noticeDraft.includeDisabled,
    ]);

    const setRequestedView = (nextTab) => {
        const resolvedTab = resolveSettingsTab(nextTab);
        const nextParams = new URLSearchParams(searchParams);
        if (resolvedTab === DEFAULT_SETTINGS_TAB) {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', resolvedTab);
        }
        setSearchParams(nextParams, { replace: true });
    };

    const patchField = (section, key, value) => {
        setDraft((prev) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value,
            },
        }));
    };

    const patchTelegramToken = (value) => {
        setDraft((prev) => ({
            ...prev,
            telegram: {
                ...prev.telegram,
                botToken: value,
                clearBotToken: false,
            },
        }));
    };

    const clearSavedTelegramToken = () => {
        setDraft((prev) => ({
            ...prev,
            telegram: {
                ...prev.telegram,
                botToken: '',
                clearBotToken: true,
            },
        }));
    };

    const applyRandomSiteAccessPath = () => {
        patchField('site', 'accessPath', generateRandomSiteAccessPath());
    };

    const resetPendingChanges = () => {
        if (!settings) return;
        setDraft(buildDraft(settings));
        setEditingTelegramChatId(false);
        toast.success('已恢复到已保存配置');
    };

    const copySiteEntry = async () => {
        await copyToClipboard(siteEntryPreview);
        toast.success('入口地址已复制到剪贴板');
    };

    const refreshStatusWorkspace = async () => {
        await Promise.all([
            fetchRegistrationRuntime(),
            fetchDbStatus({ quiet: true }),
            fetchEmailStatus({ quiet: true }),
            fetchBackupStatus({ quiet: true }),
            fetchMonitorStatus({ quiet: true }),
        ]);
    };

    const refreshOperationsWorkspace = async () => {
        await Promise.all([
            fetchEmailStatus({ quiet: true }),
            fetchMonitorStatus({ quiet: true }),
        ]);
    };

    const refreshBackupWorkspace = async () => {
        await Promise.all([
            fetchDbStatus({ quiet: true }),
            fetchBackupStatus({ quiet: true }),
        ]);
    };

    const handleCamouflageToggle = (checked) => {
        if (!checked) {
            patchField('site', 'camouflageEnabled', false);
            return;
        }
        if (siteAccessPath === '/') {
            const nextPath = generateRandomSiteAccessPath();
            setDraft((prev) => ({
                ...prev,
                site: {
                    ...prev.site,
                    accessPath: nextPath,
                    camouflageEnabled: true,
                },
            }));
            toast.success('已自动生成真实入口路径，保存后首页将显示伪装站点');
            return;
        }
        patchField('site', 'camouflageEnabled', true);
    };

    const saveSettings = async () => {
        if (!isAdmin) return;
        const ok = await confirmAction({
            title: '保存系统设置',
            message: '确定应用当前系统参数吗？',
            details: '该操作会立即影响批量风控、任务分页和日志保留策略。',
            confirmText: '确认保存',
            tone: 'primary',
        });
        if (!ok) return;

        setSaving(true);
        try {
            const payload = buildDraft(draft);
            const res = await api.put('/system/settings', payload);
            const next = res.data?.obj || payload;
            setSettings(next);
            setDraft(buildDraft(next));
            setEditingTelegramChatId(false);
            await fetchMonitorStatus({ quiet: true });
            await fetchRegistrationRuntime();
            toast.success('系统设置已更新');
            const nextSiteAccessPath = normalizeSiteAccessPathInput(next.site?.accessPath, '/');
            const currentSiteAccessPath = normalizeSiteAccessPathInput(
                typeof window !== 'undefined' ? window.__NMS_SITE_BASE_PATH__ : '/',
                '/'
            );
            if (nextSiteAccessPath !== currentSiteAccessPath && typeof window !== 'undefined') {
                const nextRoute = requestedView === DEFAULT_SETTINGS_TAB ? '/settings' : `/settings?tab=${requestedView}`;
                window.setTimeout(() => {
                    window.location.assign(buildAppEntryPath(nextSiteAccessPath, nextRoute));
                }, 250);
            }
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '保存失败');
        }
        setSaving(false);
    };

    const createInviteCode = async () => {
        if (!isAdmin) return;
        const count = toBoundedInt(inviteGenerationDraft.count, 1, 1, 50);
        const usageLimit = toBoundedInt(inviteGenerationDraft.usageLimit, 1, 1, 1000);
        const subscriptionDays = toBoundedInt(inviteGenerationDraft.subscriptionDays, 30, 0, 3650);
        setInviteCodeActionKey('create');
        try {
            const res = await api.post('/system/invite-codes', {
                count,
                usageLimit,
                subscriptionDays,
            });
            const payload = res.data?.obj || {};
            const codes = Array.isArray(payload.codes)
                ? payload.codes.map((item) => String(item || '').trim()).filter(Boolean)
                : [String(payload.code || '').trim()].filter(Boolean);
            setLatestInviteCodes(codes);
            setLatestInviteBatch({
                count: Number(payload.count || codes.length || 0),
                usageLimit: Number(payload.usageLimit || usageLimit || 1),
                subscriptionDays: Number(payload.subscriptionDays ?? subscriptionDays),
            });
            toast.success(res.data?.msg || (codes.length > 1 ? `已生成 ${codes.length} 个邀请码` : '邀请码已创建'));
            await fetchInviteCodes({ quiet: true });
            if (codes.length > 0) {
                await copyToClipboard(codes.join('\n'));
                toast.success(codes.length > 1 ? `${codes.length} 个邀请码已复制到剪贴板` : '邀请码已复制到剪贴板');
            }
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '创建邀请码失败');
        }
        setInviteCodeActionKey('');
    };

    const revokeInviteCode = async (invite) => {
        if (!isAdmin || !invite?.id) return;
        const inviteLabel = invite.preview || invite.id;
        const ok = await confirmAction({
            title: '撤销邀请码',
            message: `确定撤销 ${inviteLabel} 吗？`,
            details: '撤销后该邀请码将立即失效，未使用完的剩余额度也会一并作废。',
            confirmText: '确认撤销',
            tone: 'danger',
        });
        if (!ok) return;

        setInviteCodeActionKey(`revoke:${invite.id}`);
        try {
            const res = await api.delete(`/system/invite-codes/${encodeURIComponent(invite.id)}`);
            toast.success(res.data?.msg || '邀请码已撤销');
            await fetchInviteCodes({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '撤销邀请码失败');
        }
        setInviteCodeActionKey('');
    };

    const switchDbMode = async () => {
        if (!isAdmin) return;
        const ok = await confirmAction({
            title: '切换存储模式',
            message: `确认切换为 read=${dbModeDraft.readMode}, write=${dbModeDraft.writeMode} 吗？`,
            details: dbModeDraft.readMode === 'db'
                ? '当前启用了从数据库读取，系统会执行一次内存回填。'
                : '当前保留文件读取模式。',
            confirmText: '确认切换',
            tone: dbModeDraft.readMode === 'db' || dbModeDraft.writeMode === 'db' ? 'danger' : 'primary',
        });
        if (!ok) return;

        setDbSwitchLoading(true);
        try {
            const res = await api.post('/system/db/switch', {
                readMode: dbModeDraft.readMode,
                writeMode: dbModeDraft.writeMode,
                hydrateOnReadDb: dbModeDraft.hydrateOnReadDb,
            });
            const output = res.data?.obj || null;
            toast.success(res.data?.msg || '存储模式已切换');
            if (output?.current) {
                setDbModeDraft((prev) => ({
                    ...prev,
                    readMode: output.current.readMode || prev.readMode,
                    writeMode: output.current.writeMode || prev.writeMode,
                }));
            }
            await fetchDbStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '切换存储模式失败');
        }
        setDbSwitchLoading(false);
    };

    const runDbBackfill = async () => {
        if (!isAdmin) return;
        const selectedKeys = parseStoreKeys(dbBackfillDraft.keysText);
        const dryRun = !!dbBackfillDraft.dryRun;
        const redact = !!dbBackfillDraft.redact;
        const ok = await confirmAction({
            title: dryRun ? '执行回填预演' : '执行数据库回填',
            message: dryRun
                ? '本次仅预演，不写入数据库。'
                : '将写入数据库快照，是否继续？',
            details: `脱敏: ${redact ? '开启' : '关闭'}\n范围: ${selectedKeys.length > 0 ? selectedKeys.join(', ') : '全部 store'}`,
            confirmText: dryRun ? '开始预演' : '确认回填',
            tone: dryRun ? 'secondary' : 'danger',
        });
        if (!ok) return;

        setDbBackfillLoading(true);
        try {
            const res = await api.post('/system/db/backfill', {
                dryRun,
                redact,
                keys: selectedKeys,
                async: true,
            });
            const obj = res.data?.obj || null;
            if (obj?.taskId) {
                // 异步模式：显示进度弹窗
                setBackfillTaskId(obj.taskId);
                toast('回填任务已启动，请关注进度弹窗');
            } else {
                // 同步模式回退
                const output = obj;
                setDbBackfillResult(output);
                const failed = Number(output?.failed || 0);
                const total = Number(output?.total || 0);
                if (failed > 0) {
                    toast.error(`回填完成: ${total - failed}/${total} 成功`);
                } else {
                    toast.success(`回填完成: ${total}/${total} 成功`);
                }
                await fetchDbStatus({ quiet: true });
            }
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '数据库回填失败');
        }
        setDbBackfillLoading(false);
    };

    const downloadBackupBlob = (response, fallbackName) => {
        const blob = new Blob([response.data], { type: response.headers?.['content-type'] || 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        const contentDisposition = String(response.headers?.['content-disposition'] || '');
        const match = contentDisposition.match(/filename="?([^"]+)"?/i);
        const filename = match?.[1] || fallbackName;
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.URL.revokeObjectURL(url);
    };

    const exportBackup = async () => {
        if (!isAdmin) return;
        setBackupLoading(true);
        try {
            const res = await api.get('/system/backup/export', {
                responseType: 'blob',
            });
            downloadBackupBlob(res, 'nms_backup.nmsbak');
            toast.success('加密备份已导出');
            fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '导出加密备份失败');
        }
        setBackupLoading(false);
    };

    const saveBackupLocally = async () => {
        if (!isAdmin) return;
        setBackupLocalSaving(true);
        try {
            const res = await api.post('/system/backup/local');
            toast.success(res.data?.msg || '加密备份已保存到服务器本机');
            await fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '保存本机备份失败');
        }
        setBackupLocalSaving(false);
    };

    const downloadLocalBackup = async (filename) => {
        if (!isAdmin || !filename) return;
        const actionKey = `download:${filename}`;
        setBackupLocalActionKey(actionKey);
        try {
            const res = await api.get(`/system/backup/local/${encodeURIComponent(filename)}/download`, {
                responseType: 'blob',
            });
            downloadBackupBlob(res, filename);
            toast.success('本机加密备份已下载');
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '下载本机备份失败');
        }
        setBackupLocalActionKey('');
    };

    const restoreLocalBackup = async (filename) => {
        if (!isAdmin || !filename) return;
        const ok = await confirmAction({
            title: '恢复本机加密备份',
            message: `确定恢复本机备份 ${filename} 吗？`,
            details: '备份会先解密校验，再覆盖当前同名 Store。请确认当前环境仍使用创建备份时的 CREDENTIALS_SECRET。',
            confirmText: '确认恢复',
            tone: 'danger',
        });
        if (!ok) return;

        const actionKey = `restore:${filename}`;
        setBackupLocalActionKey(actionKey);
        try {
            const res = await api.post(`/system/backup/local/${encodeURIComponent(filename)}/restore`);
            const payload = res.data?.obj || null;
            setBackupInspection(payload?.inspection || null);
            toast.success(res.data?.msg || '本机加密备份已恢复');
            await Promise.all([
                fetchSettings(),
                fetchBackupStatus({ quiet: true }),
                fetchDbStatus({ quiet: true }),
                fetchEmailStatus({ quiet: true }),
                fetchMonitorStatus({ quiet: true }),
            ]);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '恢复本机备份失败');
        }
        setBackupLocalActionKey('');
    };

    const deleteLocalBackup = async (filename) => {
        if (!isAdmin || !filename) return;
        const ok = await confirmAction({
            title: '删除本机备份',
            message: `确定删除本机备份 ${filename} 吗？`,
            details: '删除后将无法再通过系统设置直接下载或恢复这份备份。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        const actionKey = `delete:${filename}`;
        setBackupLocalActionKey(actionKey);
        try {
            const res = await api.delete(`/system/backup/local/${encodeURIComponent(filename)}`);
            toast.success(res.data?.msg || '本机备份已删除');
            await fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '删除本机备份失败');
        }
        setBackupLocalActionKey('');
    };

    const setSelectedBackupFile = (file) => {
        setBackupFile(file || null);
        setBackupInspection(null);
        setBackupUploadProgress(0);
    };

    const inspectBackupFile = async (options = {}) => {
        if (!isAdmin || !backupFile) {
            toast.error('请先选择备份文件');
            return null;
        }
        try {
            const formData = new FormData();
            formData.append('file', backupFile);
            const res = await api.post('/system/backup/inspect', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (event) => {
                    const total = Number(event.total || 0);
                    const loaded = Number(event.loaded || 0);
                    if (loaded <= 0) return;
                    setBackupUploadProgress(total > 0 ? Math.round((loaded / total) * 100) : 100);
                },
            });
            const inspection = res.data?.obj || null;
            setBackupInspection(inspection);
            setBackupUploadProgress(100);
            if (options.silentSuccess !== true) {
                toast.success('备份文件校验通过');
            }
            return inspection;
        } catch (error) {
            setBackupInspection(null);
            setBackupUploadProgress(0);
            if (options.silentError !== true) {
                toast.error(error.response?.data?.msg || error.message || '备份文件校验失败');
            }
            return null;
        }
    };

    const inspectBackup = async () => {
        setBackupInspectLoading(true);
        await inspectBackupFile();
        setBackupInspectLoading(false);
    };

    const restoreBackup = async () => {
        if (!isAdmin || !backupFile) {
            toast.error('请先选择备份文件');
            return;
        }
        if (!backupRestoreConfirmed) {
            toast.error('请先确认已知晓恢复会覆盖当前数据');
            return;
        }

        let inspection = backupInspection || null;
        if (!inspection) {
            setBackupInspectLoading(true);
            inspection = await inspectBackupFile({ silentSuccess: true, silentError: true });
            setBackupInspectLoading(false);
            if (!inspection) {
                toast.error('备份文件校验失败，无法恢复');
                return;
            }
        }
        const restoreKeys = inspection?.restorableKeys || [];

        setBackupRestoreLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', backupFile);
            if (restoreKeys.length > 0) {
                formData.append('keys', JSON.stringify(restoreKeys));
            }
            const res = await api.post('/system/backup/restore', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (event) => {
                    const total = Number(event.total || 0);
                    const loaded = Number(event.loaded || 0);
                    if (loaded <= 0) return;
                    setBackupUploadProgress(total > 0 ? Math.round((loaded / total) * 100) : 100);
                },
            });
            const payload = res.data?.obj || null;
            setBackupInspection(payload?.inspection || inspection);
            setBackupUploadProgress(100);
            toast.success(res.data?.msg || '备份已恢复');
            await Promise.all([
                fetchSettings(),
                fetchBackupStatus({ quiet: true }),
                fetchDbStatus({ quiet: true }),
                fetchEmailStatus({ quiet: true }),
                fetchMonitorStatus({ quiet: true }),
            ]);
            setBackupRestoreModalOpen(false);
            setBackupRestoreConfirmed(false);
            setSelectedBackupFile(null);
        } catch (error) {
            setBackupUploadProgress(0);
            toast.error(error.response?.data?.msg || error.message || '恢复备份失败');
        }
        setBackupRestoreLoading(false);
    };

    const runMonitorCheck = async () => {
        if (!isAdmin) return;
        setMonitorLoading(true);
        try {
            const res = await api.post('/system/monitor/run');
            const payload = res.data?.obj || null;
            setMonitorStatus((prev) => ({
                ...(prev || {}),
                healthMonitor: {
                    ...((prev && prev.healthMonitor) || {}),
                    summary: payload?.summary || null,
                    items: payload?.items || [],
                    lastRunAt: payload?.summary?.checkedAt || new Date().toISOString(),
                },
            }));
            toast.success('节点健康巡检已完成');
            fetchMonitorStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '节点健康巡检失败');
        }
        setMonitorLoading(false);
    };

    const testTelegramAlert = async () => {
        if (!isAdmin) return;
        setTelegramTestLoading(true);
        try {
            const res = await api.post('/system/telegram/test');
            setMonitorStatus((prev) => ({
                ...(prev || {}),
                telegram: res.data?.obj || prev?.telegram || null,
            }));
            toast.success(res.data?.msg || 'Telegram 测试通知已发送');
        } catch (error) {
            const payload = error.response?.data?.obj || null;
            if (payload) {
                setMonitorStatus((prev) => ({
                    ...(prev || {}),
                    telegram: payload,
                }));
            }
            toast.error(error.response?.data?.msg || error.message || 'Telegram 测试通知发送失败');
        }
        setTelegramTestLoading(false);
    };

    const localBackups = Array.isArray(backupStatus?.localBackups) ? backupStatus.localBackups : [];
    const latestLocalBackup = localBackups[0] || null;
    const hasExportBackup = Boolean(backupStatus?.lastExport?.createdAt);
    const hasLocalBackup = Boolean(latestLocalBackup?.createdAt);
    const backupSummaryValue = hasExportBackup && hasLocalBackup
        ? '导出 + 本机'
        : hasExportBackup
            ? '已有导出备份'
            : hasLocalBackup
                ? '已有本机备份'
                : '暂无备份';
    const savedTelegramChatId = toText(settings?.telegram?.chatId, '');
    const draftTelegramChatId = toText(draft.telegram.chatId, '');
    const hasSavedTelegramChatId = Boolean(savedTelegramChatId || toText(monitorStatus?.telegram?.chatIdPreview, ''));
    const telegramChatIdChanged = draftTelegramChatId !== savedTelegramChatId;
    const telegramTargetPreview = resolveChatIdPreviewValue(monitorStatus?.telegram?.chatIdPreview, draft.telegram.chatId);
    const telegramMaskedDisplayValue = !draftTelegramChatId && hasSavedTelegramChatId && telegramChatIdChanged
        ? '已清空，待保存'
        : (draftTelegramChatId
            ? (telegramChatIdChanged ? maskChatIdValue(draftTelegramChatId) : telegramTargetPreview)
            : telegramTargetPreview);
    const shouldMaskTelegramChatId = hasSavedTelegramChatId && !editingTelegramChatId;
    const telegramChatIdHint = hasSavedTelegramChatId
        ? (editingTelegramChatId
            ? '正在编辑 Chat ID，保存后会继续按脱敏形式显示。'
            : telegramMaskedDisplayValue === '已清空，待保存'
                ? '当前 Chat ID 已清空，保存后会移除现有目标。'
                : `当前仅显示脱敏值：${telegramMaskedDisplayValue}`)
        : '推荐填写私聊、群组或频道的 chat id。只有数值型 chat id 才支持 Telegram 命令轮询。';
    const alertChainStates = [
        emailStatus?.configured ? '邮件已配置' : '邮件未配置',
        monitorStatus?.healthMonitor?.running ? '巡检运行中' : '巡检未运行',
        monitorStatus?.telegram?.enabled
            ? 'Telegram 已启用'
            : monitorStatus?.telegram?.configured
                ? 'Telegram 待启用'
                : 'Telegram 未配置',
    ];
    const readyAlertChainCount = [
        Boolean(emailStatus?.configured),
        Boolean(monitorStatus?.healthMonitor?.running),
        Boolean(monitorStatus?.telegram?.enabled),
    ].filter(Boolean).length;

    const overviewCards = useMemo(() => ([
        {
            title: '站点入口',
            value: siteAccessPath,
            tone: siteAccessPath === '/' ? 'warning' : 'success',
        },
        {
            title: '注册模式',
            value: registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭注册',
            tone: registrationEnabled ? 'success' : 'neutral',
        },
        {
            title: '数据库模式',
            value: dbStatus
                ? `read=${dbStatus.currentModes?.readMode || 'file'} / write=${dbStatus.currentModes?.writeMode || 'file'}`
                : '等待探测',
            tone: dbStatus?.connection?.ready ? 'success' : dbStatus?.connection?.enabled ? 'warning' : 'neutral',
        },
        {
            title: '告警链路',
            value: alertChainStates.join(' · '),
            tone: readyAlertChainCount === 3 ? 'success' : readyAlertChainCount > 0 ? 'warning' : 'neutral',
        },
        {
            title: '备份状态',
            value: backupSummaryValue,
            tone: hasExportBackup || hasLocalBackup ? 'success' : 'warning',
        },
    ]), [
        backupSummaryValue,
        dbStatus,
        draft.registration.inviteOnlyEnabled,
        emailStatus,
        hasExportBackup,
        hasLocalBackup,
        monitorStatus,
        registrationEnabled,
        siteAccessPath,
    ]);
    const monitorReasonSummary = useMemo(() => {
        const entries = Object.entries(monitorStatus?.healthMonitor?.summary?.byReason || {})
            .filter(([reasonCode, count]) => !['none', 'maintenance'].includes(reasonCode) && Number(count || 0) > 0)
            .map(([reasonCode, count]) => {
                const label = getMonitorReasonLabel(reasonCode);
                return label ? `${label} ${count}` : '';
            })
            .filter(Boolean);
        return entries.length > 0 ? entries.slice(0, 3).join(' · ') : '最近未记录节点异常原因';
    }, [monitorStatus]);
    const monitorHealthyCount = Number(monitorStatus?.healthMonitor?.summary?.healthy || 0);
    const monitorIncidentCount = Number(monitorStatus?.healthMonitor?.summary?.degraded || 0)
        + Number(monitorStatus?.healthMonitor?.summary?.unreachable || 0);
    const monitorUnreadCount = Number(monitorStatus?.notifications?.unreadCount || 0);
    const accessOverviewCards = useMemo(() => ([
        {
            label: '真实入口',
            value: siteAccessPath,
            detail: draft.site.camouflageEnabled ? '首页伪装已开启' : '首页直接显示 NMS',
        },
        {
            label: '注册模式',
            value: registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭注册',
            detail: registrationEnabled ? '当前运行时允许注册' : '运行时已关闭自助注册',
        },
        {
            label: '活动邀请码',
            value: `${inviteActiveCount} 个`,
            detail: `剩余 ${inviteRemainingUses} 次使用额度`,
        },
        {
            label: '订阅公网',
            value: draft.subscription.publicBaseUrl || '未配置',
            detail: converterBaseUrl ? '已配置外部转换器' : '未配置外部转换器',
        },
    ]), [
        converterBaseUrl,
        draft.registration.inviteOnlyEnabled,
        draft.site.camouflageEnabled,
        draft.subscription.publicBaseUrl,
        inviteActiveCount,
        inviteRemainingUses,
        registrationEnabled,
        siteAccessPath,
    ]);
    const policyOverviewCards = useMemo(() => ([
        {
            label: '风控确认',
            value: draft.security.requireHighRiskConfirmation ? '已开启' : '已关闭',
            detail: `高风险阈值 ${draft.security.highRiskMinTargets}`,
        },
        {
            label: '审计保留',
            value: `${draft.audit.retentionDays} 天`,
            detail: `单页最多 ${draft.audit.maxPageSize} 条`,
        },
        {
            label: '地理信息',
            value: draft.auditIpGeo.enabled ? '已启用' : '未启用',
            detail: draft.auditIpGeo.enabled ? `服务商 ${draft.auditIpGeo.provider || '-'}` : '不会补充地区与运营商',
        },
        {
            label: '确认令牌',
            value: `${draft.security.riskTokenTtlSeconds} 秒`,
            detail: `中风险阈值 ${draft.security.mediumRiskMinTargets}`,
        },
    ]), [draft.audit, draft.auditIpGeo, draft.security]);
    const operationsOverviewCards = useMemo(() => ([
        {
            label: 'SMTP',
            value: emailConfiguredLabel,
            detail: emailDeliveryLabel,
        },
        {
            label: '节点巡检',
            value: monitorStatus?.healthMonitor?.running ? '运行中' : '未运行',
            detail: `正常 ${monitorHealthyCount} · 异常 ${monitorIncidentCount}`,
        },
        {
            label: '通知中心',
            value: `${monitorUnreadCount} 条未读`,
            detail: `DB 连续失败 ${monitorStatus?.dbAlerts?.consecutiveFailures || 0}`,
        },
        {
            label: 'Telegram',
            value: monitorStatus?.telegram?.enabled
                ? '已启用'
                : monitorStatus?.telegram?.configured
                    ? '待启用'
                    : '未配置',
            detail: telegramTargetPreview !== '-' ? `目标 ${telegramTargetPreview}` : '尚未设置消息目标',
        },
    ]), [
        emailConfiguredLabel,
        emailDeliveryLabel,
        monitorHealthyCount,
        monitorIncidentCount,
        monitorStatus,
        monitorUnreadCount,
        telegramTargetPreview,
    ]);
    const backupOverviewCards = useMemo(() => ([
        {
            label: '数据库模式',
            value: dbStatus
                ? `read=${dbStatus.currentModes?.readMode || 'file'} / write=${dbStatus.currentModes?.writeMode || 'file'}`
                : '等待探测',
            detail: dbStatus?.connection?.ready ? '数据库连接已就绪' : dbStatus?.connection?.enabled ? '数据库连接待检查' : '当前未启用数据库',
        },
        {
            label: '备份状态',
            value: backupSummaryValue,
            detail: hasExportBackup || hasLocalBackup ? '建议定期验证恢复流程' : '建议先生成一份基线备份',
        },
        {
            label: '本机备份',
            value: `${localBackups.length} 份`,
            detail: latestLocalBackup?.filename || '暂无服务器本机备份',
        },
        {
            label: '最近恢复',
            value: backupStatus?.lastImport?.sourceFilename || '暂无',
            detail: formatDateTime(backupStatus?.lastImport?.restoredAt, locale),
        },
    ]), [
        backupStatus,
        backupSummaryValue,
        dbStatus,
        hasExportBackup,
        hasLocalBackup,
        latestLocalBackup,
        localBackups.length,
        locale,
    ]);

    const renderAccessContent = () => (
        <div className="settings-section-stack">
            <div className="settings-grid settings-grid--basic">
                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench settings-access-panel">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title="站点入口与订阅"
                        actions={(
                            <div className="settings-panel-actions">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={copySiteEntry}>
                                    复制入口
                                </button>
                                <a href={siteEntryPreview} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                                    打开预览
                                </a>
                            </div>
                        )}
                    />
                    <div className="settings-basic-note-list">
                        <span className={`badge ${siteAccessPath === '/' ? 'badge-warning' : 'badge-success'}`}>
                            {siteAccessPath === '/' ? '真实入口位于根路径' : '真实入口已隐藏'}
                        </span>
                        <span className={`badge ${draft.site.camouflageEnabled ? 'badge-success' : 'badge-neutral'}`}>
                            {draft.site.camouflageEnabled ? '伪装首页已开启' : '伪装首页未开启'}
                        </span>
                        <span className={`badge ${draft.subscription.publicBaseUrl ? 'badge-success' : 'badge-warning'}`}>
                            {draft.subscription.publicBaseUrl ? '订阅公网地址已配置' : '订阅公网地址待配置'}
                        </span>
                        <span className={`badge ${converterBaseUrl ? 'badge-success' : 'badge-neutral'}`}>
                            {converterBaseUrl ? '外部转换器已配置' : '未配置外部转换器'}
                        </span>
                    </div>
                    <div className="settings-access-grid">
                        <div className="settings-access-stack">
                            <div className="settings-form-cluster settings-form-cluster--entry">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">入口路径</div>
                                    <div className="settings-form-cluster-title">真实入口与首页</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">首页访问路径</label>
                                    <div className="settings-inline-action-row">
                                        <input
                                            className="form-input font-mono"
                                            placeholder="/"
                                            value={draft.site.accessPath}
                                            onChange={(e) => patchField('site', 'accessPath', e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={applyRandomSiteAccessPath}
                                        >
                                            随机路径
                                        </button>
                                    </div>
                                </div>
                                <div className="settings-monitor-log-meta settings-monitor-log-meta--address">
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">访问地址</span>
                                        <span className="settings-monitor-log-value">{siteEntryPreview}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">首页表现</span>
                                        <span className="settings-monitor-log-value">
                                            {draft.site.camouflageEnabled
                                                ? `${draft.site.camouflageTemplate || 'corporate'} · ${draft.site.camouflageTitle || '未命名'}`
                                                : '直接显示 NMS 登录页'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="settings-form-cluster settings-form-cluster--camouflage">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">伪装页面</div>
                                    <div className="settings-form-cluster-title">伪装模板与标题</div>
                                </div>
                                <div className="settings-field-grid settings-field-grid--compact">
                                    <div className="form-group mb-0">
                                        <label className="form-label">伪装模板</label>
                                        <select
                                            className="form-select"
                                            value={draft.site.camouflageTemplate}
                                            onChange={(e) => patchField('site', 'camouflageTemplate', e.target.value)}
                                        >
                                            {CAMOUFLAGE_TEMPLATE_OPTIONS.map((item) => (
                                                <option key={item.value} value={item.value}>{item.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group mb-0">
                                        <label className="form-label">伪装站点标题</label>
                                        <input
                                            className="form-input"
                                            value={draft.site.camouflageTitle}
                                            onChange={(e) => patchField('site', 'camouflageTitle', e.target.value)}
                                            placeholder="Edge Precision Systems"
                                        />
                                    </div>
                                </div>
                                <SettingsToggleCard
                                    checked={draft.site.camouflageEnabled}
                                    onChange={(e) => handleCamouflageToggle(e.target.checked)}
                                    label="站点伪装首页"
                                    description="开启后，首页和错误路径展示公开首页；只有真实入口路径会进入 NMS。"
                                    activeLabel="已开启"
                                    inactiveLabel="已关闭"
                                />
                            </div>
                        </div>
                        <div className="settings-access-stack">
                            <div className="settings-form-cluster settings-form-cluster--address">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">订阅公网</div>
                                    <div className="settings-form-cluster-title">订阅公网地址</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">订阅公网地址</label>
                                    <input
                                        className="form-input"
                                        placeholder="https://nms.example.com"
                                        value={draft.subscription.publicBaseUrl}
                                        onChange={(e) => patchField('subscription', 'publicBaseUrl', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="settings-form-cluster settings-form-cluster--address">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">外部转换</div>
                                    <div className="settings-form-cluster-title">外部订阅转换</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">外部订阅转换器地址</label>
                                    <input
                                        className="form-input"
                                        placeholder="https://converter.example.com"
                                        value={converterBaseUrl}
                                        onChange={(e) => patchField('subscription', 'converterBaseUrl', e.target.value)}
                                    />
                                </div>
                                <div className="settings-access-action-row">
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => patchField('subscription', 'converterBaseUrl', '')}
                                        disabled={!converterBaseUrl}
                                    >
                                        清空
                                    </button>
                                    <a
                                        href={converterBaseUrl || undefined}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={`btn btn-ghost btn-sm${converterBaseUrl ? '' : ' disabled'}`}
                                        aria-disabled={!converterBaseUrl}
                                        onClick={(event) => {
                                            if (!converterBaseUrl) event.preventDefault();
                                        }}
                                    >
                                        打开链接
                                    </a>
                                </div>
                            </div>
                            <div className="settings-form-cluster settings-form-cluster--address-summary">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">分发摘要</div>
                                    <div className="settings-form-cluster-title">当前对外地址</div>
                                </div>
                                <div className="settings-monitor-log-meta settings-monitor-log-meta--address">
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">真实入口</span>
                                        <span className="settings-monitor-log-value">{siteAccessPath}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">订阅公网</span>
                                        <span className="settings-monitor-log-value">{draft.subscription.publicBaseUrl || '未配置'}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">转换器</span>
                                        <span className="settings-monitor-log-value">{converterBaseUrl || '未配置'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title="注册与邀请码"
                        actions={(
                            <div className="settings-panel-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => fetchInviteCodes()} disabled={inviteCodesLoading || inviteCodeActionLoading}>
                                    {inviteCodesLoading ? <span className="spinner" /> : '刷新邀请码'}
                                </button>
                            </div>
                        )}
                    />
                    <div className="settings-invite-layout">
                        <div className="settings-access-stack">
                            <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">注册模式</div>
                                <div className="settings-form-cluster-title">注册方式与邀请码</div>
                            </div>
                            <SettingsToggleCard
                                checked={draft.registration.inviteOnlyEnabled}
                                onChange={(e) => patchField('registration', 'inviteOnlyEnabled', e.target.checked)}
                                disabled={!registrationEnabled}
                                label="开启邀请注册"
                                description={registrationEnabled
                                    ? '开启后注册需填写邀请码。'
                                    : '当前环境已关闭自助注册。'}
                                activeLabel="邀请模式"
                                inactiveLabel="普通模式"
                            />
                            <div className="settings-mini-grid settings-mini-grid--metrics settings-mini-grid--invite">
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">活动邀请码</div>
                                    <div className="text-lg font-semibold">{inviteActiveCount} 个</div>
                                    <div className="text-xs text-muted">当前仍可继续使用的库存</div>
                                </div>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">剩余额度</div>
                                    <div className="text-lg font-semibold">{inviteRemainingUses} 次</div>
                                    <div className="text-xs text-muted">活动邀请码剩余总次数</div>
                                </div>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">已使用次数</div>
                                    <div className="text-lg font-semibold">{inviteConsumedUses} 次</div>
                                    <div className="text-xs text-muted">邀请码累计已消耗次数</div>
                                </div>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">最近使用</div>
                                    <div className="text-lg font-semibold">{inviteRecentUsedAt ? formatDateTime(inviteRecentUsedAt.usedAt, locale) : '暂无'}</div>
                                    <div className="text-xs text-muted">
                                        {inviteRecentUsedAt?.usedByUsername ? `最近由 ${inviteRecentUsedAt.usedByUsername} 使用` : `已用完 ${inviteUsedCount} · 已撤销 ${inviteRevokedCount}`}
                                    </div>
                                </div>
                            </div>
                            </div>
                            <div className="card p-3 settings-mini-card settings-detail-card">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="text-sm font-medium">生成邀请码</div>
                                    <span className="text-xs text-muted">
                                        当前可用 {inviteAvailableRecords.length} 个，剩余 {inviteRemainingUses} 次
                                    </span>
                                </div>
                                <div className="settings-field-grid settings-field-grid--compact settings-field-grid--invite-generate">
                                    <div className="form-group mb-0">
                                        <label className="form-label">本次生成数量</label>
                                        <input
                                            className="form-input"
                                            type="number"
                                            min={1}
                                            max={50}
                                            value={inviteGenerationDraft.count}
                                            onChange={(e) => setInviteGenerationDraft((prev) => ({
                                                ...prev,
                                                count: e.target.value,
                                            }))}
                                        />
                                    </div>
                                    <div className="form-group mb-0">
                                        <label className="form-label">每个邀请码可用次数</label>
                                        <input
                                            className="form-input"
                                            type="number"
                                            min={1}
                                            max={1000}
                                            value={inviteGenerationDraft.usageLimit}
                                            onChange={(e) => setInviteGenerationDraft((prev) => ({
                                                ...prev,
                                                usageLimit: e.target.value,
                                            }))}
                                        />
                                    </div>
                                    <div className="form-group mb-0">
                                        <label className="form-label">开通时长（天）</label>
                                        <input
                                            className="form-input"
                                            type="number"
                                            min={0}
                                            max={3650}
                                            value={inviteGenerationDraft.subscriptionDays}
                                            onChange={(e) => setInviteGenerationDraft((prev) => ({
                                                ...prev,
                                                subscriptionDays: e.target.value,
                                            }))}
                                        />
                                    </div>
                                    <div className="form-group mb-0 settings-form-actions">
                                        <button
                                            className="btn btn-primary w-full"
                                            type="button"
                                            onClick={createInviteCode}
                                            disabled={inviteCodeActionLoading}
                                        >
                                            {inviteCodeActionKey === 'create' ? <span className="spinner" /> : '生成邀请码'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {latestInviteCodes.length > 0 ? (
                                <div className="card p-3 settings-mini-card settings-detail-card">
                                    <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                        <div className="text-sm font-medium">本次生成的邀请码</div>
                                        <span className="text-xs text-muted">
                                            {latestInviteBatch.count || latestInviteCodes.length} 个邀请码，每个可用 {latestInviteBatch.usageLimit || 1} 次，开通 {formatInviteDuration(latestInviteBatch.subscriptionDays)}
                                        </span>
                                    </div>
                                    <div className="settings-code-list">
                                        {latestInviteCodes.map((code) => (
                                            <code key={code} className="font-mono">{code}</code>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap mt-3">
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={async () => {
                                                await copyToClipboard(latestInviteCodes.join('\n'));
                                                toast.success(latestInviteCodes.length > 1 ? `${latestInviteCodes.length} 个邀请码已复制到剪贴板` : '邀请码已复制到剪贴板');
                                            }}
                                        >
                                            {latestInviteCodes.length > 1 ? '复制全部' : '复制'}
                                        </button>
                                    </div>
                                    <div className="text-xs text-muted mt-2">邀请码明文只在创建时展示一次，请及时保存。</div>
                                </div>
                            ) : null}
                        </div>

                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">邀请码台账</div>
                                <div className="settings-form-cluster-title">库存、进度与最近使用</div>
                            </div>
                            {inviteCodesLoading ? (
                                <div className="text-sm text-muted">正在加载邀请码列表...</div>
                            ) : inviteRecords.length === 0 ? (
                                <div className="text-sm text-muted">暂无邀请码记录，可先生成一批。</div>
                            ) : (
                                <div className="settings-invite-ledger">
                                    {inviteRecords.map((item) => {
                                        const statusMeta = getInviteStatusMeta(item);
                                        const usageLimit = Math.max(1, Number(item.usageLimit || 1));
                                        const usedCount = Math.max(0, Number(item.usedCount || 0));
                                        const remainingUses = Math.max(0, Number(item.remainingUses || 0));
                                        const progressWidth = `${Math.min(100, Math.round((usedCount / usageLimit) * 100))}%`;
                                        const actionBusy = inviteCodeActionKey === `revoke:${item.id}`;

                                        return (
                                            <div key={item.id} className="settings-invite-ledger-item">
                                                <div className="settings-invite-ledger-top">
                                                    <div className="settings-invite-ledger-title-block">
                                                        <div className="settings-invite-ledger-title">{item.preview || item.id}</div>
                                                        <div className="settings-invite-ledger-subtitle">
                                                            创建于 {formatDateTime(item.createdAt, locale)}
                                                            {item.createdBy ? ` · 创建者 ${item.createdBy}` : ''}
                                                        </div>
                                                    </div>
                                                    <span className={`badge ${statusMeta.className}`}>{statusMeta.label}</span>
                                                </div>
                                                <div className="settings-invite-ledger-usage">
                                                    <div className="settings-invite-ledger-usage-head">
                                                        <span>已用 {usedCount} / {usageLimit}</span>
                                                        <span>剩余 {remainingUses} 次</span>
                                                    </div>
                                                    <div className="settings-invite-ledger-progress" aria-hidden="true">
                                                        <span className="settings-invite-ledger-progress-bar" style={{ width: progressWidth }} />
                                                    </div>
                                                </div>
                                                <div className="settings-invite-ledger-meta">
                                                    <div className="settings-invite-ledger-meta-item">
                                                        <span className="settings-invite-ledger-meta-label">开通时长</span>
                                                        <span className="settings-invite-ledger-meta-value">{formatInviteDuration(item.subscriptionDays)}</span>
                                                    </div>
                                                    <div className="settings-invite-ledger-meta-item">
                                                        <span className="settings-invite-ledger-meta-label">最近使用</span>
                                                        <span className="settings-invite-ledger-meta-value">
                                                            {item.usedAt
                                                                ? `${formatDateTime(item.usedAt, locale)}${item.usedByUsername ? ` · ${item.usedByUsername}` : ''}`
                                                                : '未使用'}
                                                        </span>
                                                    </div>
                                                    <div className="settings-invite-ledger-meta-item">
                                                        <span className="settings-invite-ledger-meta-label">状态说明</span>
                                                        <span className="settings-invite-ledger-meta-value">
                                                            {item.status === 'revoked'
                                                                ? `已撤销${item.revokedBy ? ` · ${item.revokedBy}` : ''}`
                                                                : item.status === 'used'
                                                                    ? '已达到使用上限'
                                                                    : '仍可继续发放'}
                                                        </span>
                                                    </div>
                                                </div>
                                                {item.status === 'active' ? (
                                                    <div className="settings-invite-ledger-actions">
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => revokeInviteCode(item)}
                                                            disabled={inviteCodeActionLoading}
                                                        >
                                                            {actionBusy ? <span className="spinner" /> : '撤销邀请码'}
                                                        </button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderPolicyContent = () => (
        <div className="settings-section-stack">
            <div className="settings-grid settings-grid--basic">
                <div className="card p-4 settings-panel settings-panel--span-9 settings-basic-workbench">
                    <SettingsPanelHeader
                        title="风控与审计"
                    />
                    <div className="form-group settings-checkbox-row">
                        <SettingsToggleCard
                            checked={draft.security.requireHighRiskConfirmation}
                            onChange={(e) => patchField('security', 'requireHighRiskConfirmation', e.target.checked)}
                            label="高风险操作二次确认"
                            description="达到高风险阈值后执行前必须再次确认。"
                        />
                    </div>
                    <div className="settings-field-grid settings-field-grid--compact">
                        <div className="form-group">
                            <label className="form-label">中风险阈值</label>
                            <input className="form-input" type="number" min={1} value={draft.security.mediumRiskMinTargets} onChange={(e) => patchField('security', 'mediumRiskMinTargets', toInt(e.target.value, 20))} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">高风险阈值</label>
                            <input className="form-input" type="number" min={1} value={draft.security.highRiskMinTargets} onChange={(e) => patchField('security', 'highRiskMinTargets', toInt(e.target.value, 100))} />
                        </div>
                        <div className="form-group mb-0">
                            <label className="form-label">确认令牌有效期（秒）</label>
                            <input className="form-input" type="number" min={30} value={draft.security.riskTokenTtlSeconds} onChange={(e) => patchField('security', 'riskTokenTtlSeconds', toInt(e.target.value, 180))} />
                        </div>
                    </div>
                    <div className="settings-form-cluster">
                        <div className="settings-form-cluster-head">
                            <div className="settings-form-cluster-eyebrow">审计窗口</div>
                            <div className="settings-form-cluster-title">日志保留和分页密度</div>
                        </div>
                        <div className="settings-field-grid settings-field-grid--compact">
                            <div className="form-group">
                                <label className="form-label">审计保留天数</label>
                                <input className="form-input" type="number" min={1} value={draft.audit.retentionDays} onChange={(e) => patchField('audit', 'retentionDays', toInt(e.target.value, 365))} />
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">审计分页最大条数</label>
                                <input className="form-input" type="number" min={20} value={draft.audit.maxPageSize} onChange={(e) => patchField('audit', 'maxPageSize', toInt(e.target.value, 200))} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--span-3 settings-basic-workbench">
                    <SettingsPanelHeader
                        title="IP 归属地 / 运营商"
                    />
                    <div className="form-group settings-checkbox-row">
                        <SettingsToggleCard
                            checked={draft.auditIpGeo.enabled}
                            onChange={(e) => patchField('auditIpGeo', 'enabled', e.target.checked)}
                            label="归属地查询"
                            description="为订阅访问和安全事件补充地区与运营商。"
                        />
                    </div>
                    <div className="settings-basic-note-list">
                        <span className={`badge ${draft.auditIpGeo.enabled ? 'badge-success' : 'badge-neutral'}`}>
                            {draft.auditIpGeo.enabled ? '已启用' : '未启用'}
                        </span>
                        <span className="badge badge-neutral">服务商 {draft.auditIpGeo.provider || '-'}</span>
                        <span className="badge badge-neutral">缓存 {draft.auditIpGeo.cacheTtlSeconds}s</span>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderMonitorContent = () => (
        <div className="settings-grid settings-grid--monitor">
            <div className="card p-4 settings-panel settings-diagnostics-panel settings-panel--span-7">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="SMTP 诊断"
                />
                <div className="settings-monitor-toolbar">
                    <div className="settings-monitor-toolbar-status">
                        <span className={`badge ${emailConfiguredBadge}`}>{emailConfiguredLabel}</span>
                        <span className={`badge ${emailVerificationBadge}`}>{emailVerificationLabel}</span>
                        <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                    </div>
                    <div className="settings-monitor-toolbar-actions">
                        <button className="btn btn-secondary btn-sm" onClick={testEmailConnection} disabled={emailStatusLoading || emailTestLoading}>
                            {emailTestLoading ? <span className="spinner" /> : '测试'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchEmailStatus()} disabled={emailStatusLoading || emailTestLoading}>
                            {emailStatusLoading ? <span className="spinner" /> : '刷新'}
                        </button>
                    </div>
                </div>
                {!emailStatus ? (
                    <div className="text-sm text-muted">尚未加载 SMTP 状态。</div>
                ) : (
                    <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-detail-card">
                        <div className="settings-monitor-log-meta">
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">发件人</span>
                                <span className="settings-monitor-log-value">{emailStatus.from || '未设置发件人'}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">SMTP</span>
                                <span className="settings-monitor-log-value">{(emailStatus.host || '未配置服务器')} · port {emailStatus.port || '-'} · {emailStatus.service || 'SMTP'}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">最近测试</span>
                                <span className="settings-monitor-log-value">{formatDateTime(emailStatus.lastVerification?.ts, locale)}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">最近发送</span>
                                <span className="settings-monitor-log-value">{formatDateTime(emailStatus.lastDelivery?.ts, locale)}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">错误</span>
                                <span className="settings-monitor-log-value">{emailStatus.lastDelivery?.error || emailStatus.lastVerification?.error || '-'}</span>
                            </div>
                        </div>
                        <div className="settings-inline-action-strip">
                            <div className="settings-inline-action-copy">
                                <div className="settings-inline-action-title">网址变更通知</div>
                                <div className="settings-inline-action-note">给已注册用户发送最新地址邮件</div>
                            </div>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={openNoticeModal}
                                disabled={!emailStatus?.configured || noticeSending}
                            >
                                {noticeSending ? <span className="spinner" /> : '发变更通知'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="card p-4 settings-panel settings-monitor-panel settings-panel--span-5">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="节点健康监控"
                    actions={(
                        <div className="settings-panel-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => fetchMonitorStatus()} disabled={monitorStatusLoading}>
                                {monitorStatusLoading ? <span className="spinner" /> : '刷新状态'}
                            </button>
                            <button className="btn btn-primary btn-sm" onClick={runMonitorCheck} disabled={monitorLoading}>
                                {monitorLoading ? <span className="spinner" /> : '立即巡检'}
                            </button>
                        </div>
                    )}
                />
                <div className="settings-monitor-detail-grid settings-monitor-detail-grid--single">
                    <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-detail-card">
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                            <div className="text-sm font-medium">巡检摘要</div>
                            <span className={`badge ${monitorStatus?.healthMonitor?.running ? 'badge-success' : 'badge-neutral'}`}>
                                {monitorStatus?.healthMonitor?.running ? '运行中' : '未运行'}
                            </span>
                        </div>
                        <div className="settings-monitor-log-meta">
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">最近巡检</span>
                                <span className="settings-monitor-log-value">{formatDateTime(monitorStatus?.healthMonitor?.lastRunAt, locale)}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">巡检周期</span>
                                <span className="settings-monitor-log-value">
                                    {Math.round(Number(monitorStatus?.healthMonitor?.intervalMs || 0) / 60000) || 0} 分钟
                                </span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">健康统计</span>
                                <span className="settings-monitor-log-value">
                                    正常 {monitorStatus?.healthMonitor?.summary?.healthy || 0} / 异常 {(monitorStatus?.healthMonitor?.summary?.degraded || 0) + (monitorStatus?.healthMonitor?.summary?.unreachable || 0)}
                                </span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">异常分布</span>
                                <span className="settings-monitor-log-value">{monitorReasonSummary}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">通知中心</span>
                                <span className="settings-monitor-log-value">
                                    未读 {monitorStatus?.notifications?.unreadCount || 0} · 维护 {monitorStatus?.healthMonitor?.summary?.maintenance || 0} · DB 连续失败 {monitorStatus?.dbAlerts?.consecutiveFailures || 0}
                                </span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">Telegram 告警</span>
                                <span className="settings-monitor-log-value">
                                    {monitorStatus?.telegram?.enabled
                                        ? `已启用${telegramTargetPreview !== '-' ? ` · ${telegramTargetPreview}` : ''}`
                                        : monitorStatus?.telegram?.configured
                                        ? '已配置但未启用'
                                        : '未配置'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card p-4 settings-panel settings-panel--wide">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="Telegram 机器人"
                    actions={(
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={testTelegramAlert}
                            disabled={telegramTestLoading || !draft.telegram.enabled}
                        >
                            {telegramTestLoading ? <span className="spinner" /> : '发送测试通知'}
                        </button>
                    )}
                />
                <div className="settings-basic-note-list mb-3">
                    <span className={`badge ${monitorStatus?.telegram?.enabled ? 'badge-success' : 'badge-neutral'}`}>
                        {monitorStatus?.telegram?.enabled ? '已启用' : monitorStatus?.telegram?.configured ? '已配置未启用' : '未配置'}
                    </span>
                    <span className="badge badge-neutral">
                        {(monitorStatus?.telegram?.commandsEnabled ? '命令轮询开启' : '命令轮询关闭')
                            + ` · ${((monitorStatus?.telegram?.commandMenuEnabled ?? draft.telegram.commandMenuEnabled) ? '菜单显示' : '菜单已关闭')}`}
                    </span>
                    <span className="badge badge-neutral">
                        {`摘要 ${Number(draft.telegram.opsDigestIntervalMinutes || 0) > 0 ? `${draft.telegram.opsDigestIntervalMinutes} 分钟` : '关闭'} / ${Number(draft.telegram.dailyDigestIntervalHours || 0) > 0 ? `${draft.telegram.dailyDigestIntervalHours} 小时` : '关闭'}`}
                    </span>
                </div>
                <div className="grid-auto-220 items-start">
                    <div className="form-group">
                        <label className="form-label" htmlFor="telegram-chat-id">Chat ID / 群组 ID</label>
                        <div className="settings-sensitive-field">
                            <input
                                id="telegram-chat-id"
                                className={`form-input${shouldMaskTelegramChatId ? ' settings-sensitive-display' : ''}`}
                                type="text"
                                inputMode={shouldMaskTelegramChatId ? undefined : 'numeric'}
                                value={shouldMaskTelegramChatId ? telegramMaskedDisplayValue : draft.telegram.chatId}
                                onChange={shouldMaskTelegramChatId ? undefined : (event) => patchField('telegram', 'chatId', event.target.value)}
                                placeholder={shouldMaskTelegramChatId ? '' : '-1001234567890'}
                                readOnly={shouldMaskTelegramChatId}
                                autoComplete="new-password"
                            />
                            {hasSavedTelegramChatId ? (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setEditingTelegramChatId((prev) => !prev)}
                                >
                                    {editingTelegramChatId ? '完成' : '修改'}
                                </button>
                            ) : null}
                        </div>
                        <div className="text-xs text-muted mt-1">{telegramChatIdHint}</div>
                    </div>
                    <div className="form-group">
                        <label className="form-label" htmlFor="telegram-bot-token">Bot Token</label>
                        <input
                            id="telegram-bot-token"
                            className="form-input"
                            type="password"
                            value={draft.telegram.botToken}
                            onChange={(event) => patchTelegramToken(event.target.value)}
                            placeholder={settings?.telegram?.botTokenConfigured ? `当前已保存 ${settings.telegram.botTokenPreview}` : '123456:ABCDEF...'}
                            autoComplete="new-password"
                        />
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                            <div className="text-xs text-muted">
                                {draft.telegram.clearBotToken
                                    ? '本次保存会清空服务器端已保存 Token。'
                                    : settings?.telegram?.botTokenConfigured
                                    ? `当前已保存 Token：${settings.telegram.botTokenPreview || '已配置'}。留空保存会继续使用当前 Token。`
                                    : '首次启用时请输入 Telegram Bot Token。'}
                            </div>
                            {settings?.telegram?.botTokenConfigured ? (
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={clearSavedTelegramToken}
                                >
                                    清空已保存 Token
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label" htmlFor="telegram-ops-digest-interval">运维汇总间隔</label>
                        <input
                            id="telegram-ops-digest-interval"
                            className="form-input"
                            type="number"
                            min="0"
                            max="1440"
                            inputMode="numeric"
                            value={draft.telegram.opsDigestIntervalMinutes}
                            onChange={(event) => patchField('telegram', 'opsDigestIntervalMinutes', toBoundedInt(event.target.value, 30, 0, 1440))}
                        />
                        <div className="text-xs text-muted mt-1">单位：分钟，填 0 关闭定时运维汇总。</div>
                    </div>
                    <div className="form-group">
                        <label className="form-label" htmlFor="telegram-daily-digest-interval">日报间隔</label>
                        <input
                            id="telegram-daily-digest-interval"
                            className="form-input"
                            type="number"
                            min="0"
                            max="168"
                            inputMode="numeric"
                            value={draft.telegram.dailyDigestIntervalHours}
                            onChange={(event) => patchField('telegram', 'dailyDigestIntervalHours', toBoundedInt(event.target.value, 24, 0, 168))}
                        />
                        <div className="text-xs text-muted mt-1">单位：小时，填 0 关闭定时报。</div>
                    </div>
                </div>
                <div className="settings-field-grid settings-field-grid--compact mt-3">
                    <SettingsToggleCard
                        checked={draft.telegram.enabled}
                        onChange={(event) => patchField('telegram', 'enabled', event.target.checked)}
                        label="启用 Telegram 告警"
                        description="启用后将推送系统状态和安全告警。"
                        activeLabel="已启用"
                        inactiveLabel="未启用"
                    />
                    <SettingsToggleCard
                        checked={draft.telegram.commandMenuEnabled}
                        onChange={(event) => patchField('telegram', 'commandMenuEnabled', event.target.checked)}
                        label="Telegram 命令菜单"
                        description="开启后会显示 Telegram 官方命令菜单；关闭后只保留手动输入命令。"
                        activeLabel="显示"
                        inactiveLabel="隐藏"
                    />
                    <SettingsToggleCard
                        checked={draft.telegram.sendSystemStatus}
                        onChange={(event) => patchField('telegram', 'sendSystemStatus', event.target.checked)}
                        label="系统状态"
                        description="节点、数据库、到期提醒等状态消息。"
                        activeLabel="推送"
                        inactiveLabel="不推送"
                    />
                    <SettingsToggleCard
                        checked={draft.telegram.sendSecurityAudit}
                        onChange={(event) => patchField('telegram', 'sendSecurityAudit', event.target.checked)}
                        label="审计告警"
                        description="登录失败、限流、订阅异常访问等。"
                        activeLabel="推送"
                        inactiveLabel="不推送"
                    />
                    <SettingsToggleCard
                        checked={draft.telegram.sendEmergencyAlerts}
                        onChange={(event) => patchField('telegram', 'sendEmergencyAlerts', event.target.checked)}
                        label="紧急告警"
                        description="critical 级别事件直接升级。"
                        activeLabel="推送"
                        inactiveLabel="不推送"
                    />
                </div>
                <div className="settings-basic-note-list mt-3">
                    <span className="badge badge-neutral">目标 {telegramTargetPreview}</span>
                    <span className="badge badge-neutral">
                        {monitorStatus?.telegram?.lastSentAt ? `最近发送 ${formatDateTime(monitorStatus.telegram.lastSentAt, locale)}` : '尚无发送记录'}
                    </span>
                    <span className="badge badge-neutral">
                        {monitorStatus?.telegram?.lastCommand
                            ? `最近命令 ${monitorStatus.telegram.lastCommand}`
                            : '尚无命令记录'}
                    </span>
                </div>
            </div>
        </div>
    );

    const renderBackupContent = () => (
        <div className="settings-section-stack">
            <div className="card p-4 settings-panel settings-backup-panel">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="备份与恢复"
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchBackupStatus()} disabled={backupStatusLoading}>
                            {backupStatusLoading ? <span className="spinner" /> : '刷新状态'}
                        </button>
                    )}
                />
                <div className="card p-3 settings-mini-card settings-detail-card">
                    <div className="text-sm font-medium">备份摘要</div>
                    <div className="settings-monitor-log-meta">
                        <div className="settings-monitor-log-item">
                            <span className="settings-monitor-log-label">可备份 Store</span>
                            <span className="settings-monitor-log-value">{backupStatus?.storeKeys?.length || 0} · {(backupStatus?.storeKeys || []).join(', ') || '暂无'}</span>
                        </div>
                        <div className="settings-monitor-log-item">
                            <span className="settings-monitor-log-label">最近生成</span>
                            <span className="settings-monitor-log-value">{backupStatus?.lastExport?.filename || '-'} · {formatDateTime(backupStatus?.lastExport?.createdAt, locale)}</span>
                        </div>
                        <div className="settings-monitor-log-item">
                            <span className="settings-monitor-log-label">本机备份</span>
                            <span className="settings-monitor-log-value">{localBackups.length} 份 · {latestLocalBackup?.filename || '暂无'}</span>
                        </div>
                        <div className="settings-monitor-log-item">
                            <span className="settings-monitor-log-label">最近恢复</span>
                            <span className="settings-monitor-log-value">{backupStatus?.lastImport?.sourceFilename || '-'} · {formatDateTime(backupStatus?.lastImport?.restoredAt, locale)}</span>
                        </div>
                    </div>
                </div>

                <div className="settings-backup-actions settings-backup-actions--triple mt-3">
                    <div className="card p-3 settings-mini-card settings-backup-action-card settings-backup-action-card--danger">
                        <div className="text-sm font-medium">导出到浏览器</div>
                        <div className="text-xs text-muted mt-1">下载一份加密备份包。</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-primary btn-sm" onClick={exportBackup} disabled={backupLoading || backupRestoreLoading || backupLocalSaving}>
                                {backupLoading ? <span className="spinner" /> : <><HiOutlineArrowDownTray /> 导出加密备份</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">保存到服务器本机</div>
                        <div className="text-xs text-muted mt-1">在服务器本机留存一份加密备份。</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-secondary btn-sm" onClick={saveBackupLocally} disabled={backupLocalSaving || backupLoading || backupRestoreLoading}>
                                {backupLocalSaving ? <span className="spinner" /> : <><HiOutlineShieldCheck /> 保存本机备份</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">从文件恢复</div>
                        <div className="text-xs text-muted mt-1">上传备份包后恢复。</div>
                        <div className="settings-backup-action-footer">
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setBackupRestoreModalOpen(true);
                                    setBackupRestoreConfirmed(false);
                                    setBackupUploadProgress(0);
                                }}
                                disabled={backupLoading || backupRestoreLoading || backupLocalSaving}
                            >
                                <HiOutlineArrowUpTray /> 导入 / 恢复备份
                            </button>
                        </div>
                    </div>
                </div>

                <div className="card p-3 mt-3 settings-mini-card settings-detail-card settings-backup-local-panel">
                    <div className="settings-backup-local-head">
                        <div>
                            <div className="text-sm font-medium">服务器本机加密备份</div>
                            <div className="text-xs text-muted mt-1">保存目录: {backupStatus?.localBackupDir || '-'}</div>
                        </div>
                        <span className="badge badge-neutral">{localBackups.length} 份备份</span>
                    </div>
                    {localBackups.length === 0 ? (
                        <div className="text-sm text-muted">还没有保存到服务器本机的备份。需要时可以先点上方“保存本机备份”。</div>
                    ) : (
                        <div className="settings-backup-local-grid">
                            {localBackups.map((item) => (
                                <div key={item.filename} className="settings-backup-local-item">
                                    <div className="settings-backup-local-item-head">
                                        <div className="settings-backup-local-name">{item.filename}</div>
                                        <span className="badge badge-success">已加密</span>
                                    </div>
                                    <div className="settings-backup-local-meta">
                                        <span>{formatDateTime(item.createdAt, locale)}</span>
                                        <span>{formatBytes(item.bytes || 0)}</span>
                                        <span>{(item.storeKeys || []).length} 个 Store</span>
                                    </div>
                                    <div className="text-xs text-muted">
                                        解密密钥: {item.keyHint || 'CREDENTIALS_SECRET'} · 算法: {item.cipher || 'AES-256-GCM'}
                                    </div>
                                    <div className="settings-backup-local-actions">
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => downloadLocalBackup(item.filename)}
                                            disabled={backupLocalActionKey === `download:${item.filename}`}
                                        >
                                            {backupLocalActionKey === `download:${item.filename}` ? <span className="spinner" /> : '下载'}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => restoreLocalBackup(item.filename)}
                                            disabled={backupLocalActionKey === `restore:${item.filename}`}
                                        >
                                            {backupLocalActionKey === `restore:${item.filename}` ? <span className="spinner" /> : '恢复'}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-danger btn-sm"
                                            onClick={() => deleteLocalBackup(item.filename)}
                                            disabled={backupLocalActionKey === `delete:${item.filename}`}
                                        >
                                            {backupLocalActionKey === `delete:${item.filename}` ? <span className="spinner" /> : '删除'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {backupInspection && (
                    <div className="card p-3 mt-3 settings-mini-card settings-detail-card settings-backup-inspection">
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                            <div className="text-sm font-medium">备份预览</div>
                            <span className={`badge ${backupInspection.encrypted === false ? 'badge-warning' : 'badge-success'}`}>
                                {backupInspection.encrypted === false ? '旧版明文兼容' : '已通过解密校验'}
                            </span>
                        </div>
                        <div className="settings-backup-inspection-grid">
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">备份时间</div>
                                <div className="text-sm">{backupInspection.createdAt ? formatDateTime(backupInspection.createdAt, locale) : '未知'}</div>
                            </div>
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">格式版本</div>
                                <div className="text-sm">{backupInspection.format} v{backupInspection.version}</div>
                            </div>
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">加密状态</div>
                                <div className="text-sm">{backupInspection.encrypted === false ? '旧版未加密' : (backupInspection.cipher || 'AES-256-GCM')}</div>
                            </div>
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">可恢复 Store</div>
                                <div className="text-sm">{(backupInspection.restorableKeys || []).join(', ') || '无'}</div>
                            </div>
                        </div>
                        {(backupInspection.unsupportedKeys || []).length > 0 && (
                            <div className="text-sm text-muted mt-1">不支持 Store: {backupInspection.unsupportedKeys.join(', ')}</div>
                        )}
                        {(backupInspection.missingKeys || []).length > 0 && (
                            <div className="text-sm text-muted mt-1">缺失快照: {backupInspection.missingKeys.join(', ')}</div>
                        )}
                        <div className="text-sm text-muted mt-1">
                            {backupInspection.encrypted === false
                                ? '这是旧版未加密备份，仅保留恢复兼容。后续请重新导出新的加密备份。'
                                : `恢复时将使用 ${backupInspection.keyHint || 'CREDENTIALS_SECRET'} 解密。`}
                        </div>
                        <div className="settings-backup-inspection-actions">
                            <button className="btn btn-secondary btn-sm" onClick={inspectBackup} disabled={!backupFile || backupInspectLoading || backupRestoreLoading}>
                                {backupInspectLoading ? <span className="spinner" /> : '重新校验'}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={restoreBackup} disabled={backupRestoreLoading || (backupInspection.restorableKeys || []).length === 0}>
                                {backupRestoreLoading ? <span className="spinner" /> : '确认恢复备份'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const renderDatabaseContent = () => (
        <div className="settings-section-stack">
            <div className="card p-4 settings-panel settings-db-panel">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="数据库接入状态"
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchDbStatus()} disabled={dbLoading}>
                            {dbLoading ? <span className="spinner" /> : '刷新状态'}
                        </button>
                    )}
                />

                {!dbStatus ? (
                    <div className="text-sm text-muted">尚未加载数据库状态。</div>
                ) : (
                    <>
                        <div className="settings-mini-grid settings-mini-grid--metrics mb-4">
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">DB 连接</div>
                                <div className="text-lg font-semibold">
                                    {dbStatus.connection?.enabled ? (dbStatus.connection?.ready ? '已就绪' : '未就绪') : '未启用'}
                                </div>
                                <div className="text-xs text-muted">{dbStatus.connection?.error || '无错误'}</div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">当前模式</div>
                                <div className="text-lg font-semibold">
                                    read={dbStatus.currentModes?.readMode || 'file'} / write={dbStatus.currentModes?.writeMode || 'file'}
                                </div>
                                <div className="text-xs text-muted">queued {dbStatus.writesQueued || 0} · pending {dbStatus.pendingWrites || 0}</div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">写入统计</div>
                                <div className="text-lg font-semibold">
                                    成功 {dbStatus.writesSucceeded || 0} / 失败 {dbStatus.writesFailed || 0}
                                </div>
                                <div className="text-xs text-muted">最后写入: {formatDateTime(dbStatus.lastWriteAt, locale)}</div>
                            </div>
                        </div>

                        <div className="settings-grid settings-db-grid">
                            <div className="card p-3 settings-mini-card settings-db-control-card">
                                <div className="settings-db-card-head">
                                    <h4 className="text-base font-semibold">切换读写模式</h4>
                                </div>
                                <div className="settings-db-card-body">
                                    <div className="form-group">
                                        <label className="form-label">Read Mode</label>
                                        <select
                                            className="form-select"
                                            value={dbModeDraft.readMode}
                                            onChange={(event) => setDbModeDraft((prev) => ({ ...prev, readMode: event.target.value }))}
                                            disabled={!isAdmin}
                                        >
                                            {(dbStatus.supportedModes?.readModes || ['file', 'db']).map((mode) => (
                                                <option key={mode} value={mode}>{mode}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Write Mode</label>
                                        <select
                                            className="form-select"
                                            value={dbModeDraft.writeMode}
                                            onChange={(event) => setDbModeDraft((prev) => ({ ...prev, writeMode: event.target.value }))}
                                            disabled={!isAdmin}
                                        >
                                            {(dbStatus.supportedModes?.writeModes || ['file', 'dual', 'db']).map((mode) => (
                                                <option key={mode} value={mode}>{mode}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                        <input
                                            type="checkbox"
                                            checked={dbModeDraft.hydrateOnReadDb}
                                            onChange={(event) => setDbModeDraft((prev) => ({ ...prev, hydrateOnReadDb: event.target.checked }))}
                                            disabled={!isAdmin}
                                        />
                                        read=db 时同步加载到内存缓存
                                    </label>
                                </div>
                                <div className="settings-db-card-foot">
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={switchDbMode}
                                        disabled={dbSwitchLoading || !dbStatus.connection?.enabled || !isAdmin}
                                    >
                                        {dbSwitchLoading ? <span className="spinner" /> : '应用模式'}
                                    </button>
                                </div>
                            </div>

                            <div className="card p-3 settings-mini-card settings-db-control-card">
                                <div className="settings-db-card-head">
                                    <h4 className="text-base font-semibold">Store 回填到数据库</h4>
                                </div>
                                <div className="settings-db-card-body">
                                    <div className="form-group">
                                        <label className="form-label">Store Keys（逗号分隔，留空=全部）</label>
                                        <input
                                            className="form-input"
                                            value={dbBackfillDraft.keysText}
                                            onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, keysText: event.target.value }))}
                                            placeholder={(dbStatus.storeKeys || []).join(', ')}
                                            disabled={!isAdmin}
                                        />
                                        <div className="text-xs text-muted mt-1">可选: {(dbStatus.storeKeys || []).join(', ') || '暂无'}</div>
                                    </div>
                                    <div className="flex gap-3 flex-wrap">
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                            <input
                                                type="checkbox"
                                                checked={dbBackfillDraft.dryRun}
                                                onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, dryRun: event.target.checked }))}
                                                disabled={!isAdmin}
                                            />
                                            Dry Run
                                        </label>
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                            <input
                                                type="checkbox"
                                                checked={dbBackfillDraft.redact}
                                                onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, redact: event.target.checked }))}
                                                disabled={!isAdmin}
                                            />
                                            脱敏写入
                                        </label>
                                    </div>
                                </div>
                                <div className="settings-db-card-foot">
                                    <button
                                        className={`btn btn-sm ${dbBackfillDraft.dryRun ? 'btn-secondary' : 'btn-danger'}`}
                                        onClick={runDbBackfill}
                                        disabled={dbBackfillLoading || !dbStatus.connection?.enabled || !isAdmin}
                                    >
                                        {dbBackfillLoading ? <span className="spinner" /> : (dbBackfillDraft.dryRun ? '执行预演' : '执行回填')}
                                    </button>
                                    {dbBackfillResult && (
                                        <div className="text-sm text-muted settings-db-card-result">
                                            total: {dbBackfillResult.total || 0}，success: {dbBackfillResult.success || 0}，failed: {dbBackfillResult.failed || 0}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </>
                )}
            </div>
        </div>
    );

    const renderStatusContent = () => (
        <div className="settings-section-stack">
            <div className="settings-summary-grid settings-summary-grid--status">
                {overviewCards.map((item) => {
                    const badgeMeta = getSummaryToneBadgeMeta(item.tone);
                    return (
                    <div key={item.title} className="card settings-summary-card" data-tone={item.tone || 'neutral'}>
                        <div className="settings-summary-head">
                            <div className="settings-summary-label">{item.title}</div>
                            <span className={`badge settings-summary-badge ${badgeMeta.className}`}>{badgeMeta.label}</span>
                        </div>
                        <div className="settings-summary-value">{item.value}</div>
                        {item.detail ? <div className="settings-summary-detail">{item.detail}</div> : null}
                    </div>
                );})}
            </div>
        </div>
    );

    const renderOperationsWorkspace = () => (
        <div className="settings-section-stack">
            {renderMonitorContent()}
            <div className="card p-4 settings-panel settings-panel--wide">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="节点控制台"
                    actions={(
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                                const next = !consoleExpanded;
                                setConsoleExpanded(next);
                                setRequestedView(next ? 'console' : DEFAULT_SETTINGS_TAB);
                            }}
                        >
                            {consoleExpanded ? '收起控制台' : '打开节点控制台'}
                        </button>
                    )}
                />
                <div className="settings-basic-note-list mb-3">
                    <span className="badge badge-neutral">旧链接兼容</span>
                    <span className="badge badge-neutral">减少在设置页和节点页之间来回切换</span>
                </div>
                {consoleExpanded ? (
                    <div className="settings-console-host settings-console-host--inline">
                        <ServerManagement embedded />
                    </div>
                ) : (
                    <div className="card p-3 settings-mini-card settings-detail-card settings-console-placeholder">
                        <div className="text-sm font-medium">嵌入式节点控制台</div>
                        <div className="text-xs text-muted mt-1">
                            需要查看面板状态、执行备份或处理 geofile 时，可在这里直接展开节点控制台。
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const workspaceSections = [
        {
            id: 'status',
            title: '系统状态',
            eyebrow: 'Overview',
            badges: (
                <>
                    <span className={`badge ${readyAlertChainCount === 3 ? 'badge-success' : readyAlertChainCount > 0 ? 'badge-warning' : 'badge-neutral'}`}>
                        {readyAlertChainCount}/3 告警链路就绪
                    </span>
                    <span className={`badge ${hasExportBackup || hasLocalBackup ? 'badge-success' : 'badge-warning'}`}>
                        {hasExportBackup || hasLocalBackup ? '已有可用备份' : '建议立即生成基线备份'}
                    </span>
                </>
            ),
            highlights: [
                { label: '站点入口', value: siteAccessPath, detail: siteEntryPreview },
                { label: '注册模式', value: registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭注册' },
                {
                    label: '数据库模式',
                    value: dbStatus
                        ? `read=${dbStatus.currentModes?.readMode || 'file'} / write=${dbStatus.currentModes?.writeMode || 'file'}`
                        : '等待探测',
                },
                { label: '备份状态', value: backupSummaryValue, detail: latestLocalBackup?.filename || '暂无服务器本机备份' },
            ],
            actions: (
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={refreshStatusWorkspace}
                    disabled={dbLoading || emailStatusLoading || backupStatusLoading || monitorStatusLoading}
                >
                    {(dbLoading || emailStatusLoading || backupStatusLoading || monitorStatusLoading) ? <span className="spinner" /> : '刷新概览'}
                </button>
            ),
            navSummary: '5 项核心概览',
            navFlag: readyAlertChainCount === 3 && (hasExportBackup || hasLocalBackup)
                ? { label: '运行稳定', tone: 'success' }
                : { label: '需关注', tone: 'warning' },
            content: renderStatusContent(),
        },
        {
            id: 'access',
            title: '对外访问',
            eyebrow: 'Public Access',
            badges: (
                <>
                    <span className={`badge ${draft.site.camouflageEnabled ? 'badge-success' : 'badge-neutral'}`}>
                        {draft.site.camouflageEnabled ? '首页伪装已开启' : '首页直接展示 NMS'}
                    </span>
                    <span className={`badge ${registrationEnabled ? 'badge-success' : 'badge-warning'}`}>
                        {registrationEnabled ? '运行时允许注册' : '运行时已关闭注册'}
                    </span>
                </>
            ),
            highlights: accessOverviewCards,
            navSummary: `${registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭注册'} · ${siteAccessPath}`,
            navFlag: draft.subscription.publicBaseUrl
                ? { label: '公网地址已配置', tone: 'success' }
                : { label: '公网地址待配置', tone: 'warning' },
            content: renderAccessContent(),
        },
        {
            id: 'policy',
            title: '安全审计',
            eyebrow: 'Policy & Audit',
            badges: (
                <>
                    <span className={`badge ${draft.security.requireHighRiskConfirmation ? 'badge-success' : 'badge-neutral'}`}>
                        {draft.security.requireHighRiskConfirmation ? '高风险二次确认已开启' : '高风险二次确认已关闭'}
                    </span>
                    <span className={`badge ${draft.auditIpGeo.enabled ? 'badge-success' : 'badge-neutral'}`}>
                        {draft.auditIpGeo.enabled ? 'IP 地理信息已补充' : '不补充地理信息'}
                    </span>
                </>
            ),
            highlights: policyOverviewCards,
            navSummary: `审计保留 ${draft.audit.retentionDays} 天`,
            navFlag: draft.auditIpGeo.enabled
                ? { label: '含归属地', tone: 'success' }
                : { label: '基础审计', tone: 'neutral' },
            content: renderPolicyContent(),
        },
        {
            id: 'operations',
            title: '运维通知',
            eyebrow: 'Ops & Alerts',
            badges: (
                <>
                    <span className={`badge ${emailStatus?.configured ? 'badge-success' : 'badge-warning'}`}>
                        {emailStatus?.configured ? 'SMTP 已配置' : 'SMTP 未配置'}
                    </span>
                    <span className={`badge ${monitorIncidentCount > 0 ? 'badge-warning' : 'badge-success'}`}>
                        {monitorIncidentCount > 0 ? `${monitorIncidentCount} 个节点异常` : '节点巡检正常'}
                    </span>
                </>
            ),
            highlights: operationsOverviewCards,
            actions: (
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={refreshOperationsWorkspace}
                    disabled={emailStatusLoading || monitorStatusLoading}
                >
                    {(emailStatusLoading || monitorStatusLoading) ? <span className="spinner" /> : '刷新状态'}
                </button>
            ),
            navSummary: `链路 ${readyAlertChainCount}/3 就绪`,
            navFlag: monitorIncidentCount > 0
                ? { label: `${monitorIncidentCount} 个异常`, tone: 'warning' }
                : { label: '运行稳定', tone: 'success' },
            content: renderOperationsWorkspace(),
        },
        {
            id: 'backup',
            title: '数据备份',
            eyebrow: 'Data Safety',
            badges: (
                <>
                    <span className={`badge ${dbStatus?.connection?.ready ? 'badge-success' : dbStatus?.connection?.enabled ? 'badge-warning' : 'badge-neutral'}`}>
                        {dbStatus?.connection?.ready ? '数据库连接已就绪' : dbStatus?.connection?.enabled ? '数据库连接待检查' : '数据库未启用'}
                    </span>
                    <span className={`badge ${hasExportBackup || hasLocalBackup ? 'badge-success' : 'badge-warning'}`}>
                        {hasExportBackup || hasLocalBackup ? '已有备份基线' : '暂无备份基线'}
                    </span>
                </>
            ),
            highlights: backupOverviewCards,
            actions: (
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={refreshBackupWorkspace}
                    disabled={dbLoading || backupStatusLoading}
                >
                    {(dbLoading || backupStatusLoading) ? <span className="spinner" /> : '刷新状态'}
                </button>
            ),
            navSummary: `DB ${dbStatus?.currentModes?.writeMode || '待探测'} · ${backupSummaryValue}`,
            navFlag: hasExportBackup || hasLocalBackup
                ? { label: '已有备份', tone: 'success' }
                : { label: '建议备份', tone: 'warning' },
            content: (
                <>
                    {renderDatabaseContent()}
                    {renderBackupContent()}
                </>
            ),
        },
    ];
    const activeWorkspaceSection = workspaceSections.find((item) => item.id === activeWorkspaceSectionId) || workspaceSections[0];
    const workspaceNavItems = SETTINGS_WORKSPACE_CONFIG.map((item) => ({
        ...item,
        ...(workspaceSections.find((section) => section.id === item.id) || {}),
    }));
    const dirtyWorkspaceLabels = workspaceNavItems
        .filter((item) => dirtyWorkspaceIds.includes(item.id))
        .map((item) => item.label);
    const saveDockSummary = hasPendingChanges
        ? `${dirtyWorkspaceCount} 个工作区待保存`
        : activeWorkspaceSectionId === 'backup'
            ? '数据库和备份操作即时生效'
            : '当前没有未保存更改';

    if (!isAdmin) {
        return (
            <>
                <Header
                    title={t('pages.settings.title')}
                    subtitle={t('pages.settings.limitedSubtitle')}
                    eyebrow={t('pages.settings.eyebrow')}
                />
                <div className="page-content page-enter">
                    <EmptyState
                        title="仅管理员可访问系统设置"
                        subtitle="请使用管理员账号登录后再修改系统参数、备份或监控配置。"
                        icon={<HiOutlineCog6Tooth style={{ fontSize: '48px' }} />}
                        surface
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <Header
                title={t('pages.settings.title')}
                eyebrow={t('pages.settings.eyebrow')}
            />
            <div className="page-content page-content--wide page-enter">
                <div className="settings-shell">
                    <div className="card settings-nav">
                        <div className="settings-nav-list settings-nav-list--workspace">
                            {workspaceNavItems.map((item) => {
                                const Icon = item.icon;
                                const isActive = item.id === activeWorkspaceSectionId;
                                const isDirty = Boolean(workspaceDirtyMap[item.id]);
                                const navFlagToneClass = item.navFlag?.tone === 'success'
                                    ? 'badge-success'
                                    : item.navFlag?.tone === 'warning'
                                        ? 'badge-warning'
                                        : item.navFlag?.tone === 'danger'
                                            ? 'badge-danger'
                                            : 'badge-neutral';
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`settings-nav-item${isActive ? ' is-active' : ''}${isDirty ? ' is-dirty' : ''}`}
                                        aria-pressed={isActive}
                                        aria-label={item.label}
                                        onClick={() => setRequestedView(item.routeTab)}
                                    >
                                        <span className="settings-nav-item-icon">
                                            <Icon />
                                        </span>
                                        <span className="settings-nav-item-copy">
                                            <span className="settings-nav-item-top">
                                                <span className="settings-nav-item-label">{item.label}</span>
                                                {isDirty ? <span className="settings-nav-item-dirty-dot" aria-hidden="true" /> : null}
                                            </span>
                                            {item.navSummary ? <span className="settings-nav-item-summary">{item.navSummary}</span> : null}
                                            {(isDirty || item.navFlag) ? (
                                                <span className="settings-nav-item-flags">
                                                    {isDirty ? <span className="badge badge-warning">未保存</span> : null}
                                                    {item.navFlag ? <span className={`badge ${navFlagToneClass}`}>{item.navFlag.label}</span> : null}
                                                </span>
                                            ) : null}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="settings-main">
                        <SettingsWorkspaceSection
                            workspaceId={activeWorkspaceSection.id}
                            eyebrow={activeWorkspaceSection.eyebrow}
                            title={activeWorkspaceSection.title}
                            subtitle={activeWorkspaceSection.subtitle}
                            summary={activeWorkspaceSection.summary}
                            badges={activeWorkspaceSection.badges}
                            highlights={activeWorkspaceSection.highlights}
                            actions={activeWorkspaceSection.actions}
                        >
                            {activeWorkspaceSection.content}
                        </SettingsWorkspaceSection>
                        <div className="card settings-save-dock">
                            <div className="settings-save-dock-inner" aria-live="polite">
                                <div className="settings-save-dock-main">
                                    <div className={`settings-nav-status-chip${saving ? ' is-saving' : loading ? ' is-loading' : hasPendingChanges ? ' is-dirty' : settings ? ' is-ready' : ' is-loading'}`}>
                                        {saving ? <span className="spinner spinner-16" /> : null}
                                        <span>
                                            {saving
                                                ? '正在保存设置'
                                                : loading
                                                    ? '正在加载配置'
                                                    : hasPendingChanges
                                                        ? '有未保存更改'
                                                        : '配置已加载'}
                                        </span>
                                    </div>
                                    <span className="settings-save-dock-current">{activeWorkspaceSection.title}</span>
                                    <span className="settings-save-dock-summary">{saveDockSummary}</span>
                                    {hasPendingChanges ? <span className="badge badge-warning">{dirtyWorkspaceLabels.join(' / ')}</span> : null}
                                    {requestedView === 'console' ? <span className="badge badge-success">兼容旧控制台入口</span> : null}
                                </div>
                                <div className="settings-save-dock-actions">
                                    {hasPendingChanges ? (
                                        <button className="btn btn-ghost btn-sm" onClick={resetPendingChanges} disabled={loading || saving}>
                                            恢复更改
                                        </button>
                                    ) : null}
                                    <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={loading || saving || !hasPendingChanges}>
                                        {saving ? <span className="spinner" /> : '保存设置'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <ModalShell isOpen={noticeModalOpen} onClose={() => setNoticeModalOpen(false)}>
                <div className="modal modal-wide settings-notice-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">发送注册用户变更通知</h3>
                        <button type="button" className="modal-close" onClick={() => setNoticeModalOpen(false)}>
                            <HiOutlineXMark />
                        </button>
                    </div>
                    <div className="modal-body">
                        <div className="settings-notice-shell">
                            <div className="settings-notice-editor">
                                <div className="text-sm text-muted mb-4">
                                    该功能会按单个收件人逐封发送邮件，不会把其他用户邮箱放在同一封邮件里。默认覆盖所有有邮箱地址的用户，并可附带最新地址按钮。
                                </div>
                                <div className="grid-auto-220">
                                    <div className="form-group">
                                        <label className="form-label">通知主题</label>
                                        <input
                                            className="form-input"
                                            value={noticeDraft.subject}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, subject: event.target.value }))}
                                            placeholder="例如：服务入口地址变更通知"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">发送范围</label>
                                        <select
                                            className="form-select"
                                            value={noticeDraft.scope}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, scope: event.target.value }))}
                                        >
                                            <option value="all">全部有邮箱的注册用户</option>
                                            <option value="verified">仅已验证邮箱用户</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">通知内容</label>
                                    <textarea
                                        rows={8}
                                        className="form-textarea"
                                        value={noticeDraft.message}
                                        onChange={(event) => setNoticeDraft((prev) => ({ ...prev, message: event.target.value }))}
                                        placeholder="说明新网址、新域名、生效时间，以及用户需要执行的替换动作。"
                                    />
                                </div>
                                <div className="grid-auto-220">
                                    <div className="form-group">
                                        <label className="form-label">按钮地址</label>
                                        <input
                                            className="form-input"
                                            value={noticeDraft.actionUrl}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, actionUrl: event.target.value }))}
                                            placeholder="https://example.com/subscription"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">按钮文案</label>
                                        <input
                                            className="form-input"
                                            value={noticeDraft.actionLabel}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, actionLabel: event.target.value }))}
                                            placeholder="查看最新地址"
                                        />
                                    </div>
                                </div>
                                <label className="form-check-label w-fit mt-2">
                                    <input
                                        type="checkbox"
                                        checked={noticeDraft.includeDisabled}
                                        onChange={(event) => setNoticeDraft((prev) => ({ ...prev, includeDisabled: event.target.checked }))}
                                    />
                                    <span>包含已停用账号</span>
                                </label>
                            </div>
                            <div className="settings-notice-preview-panel">
                                <div className="settings-notice-preview-head">
                                    <div>
                                        <div className="text-sm font-medium">邮件正文预览</div>
                                        <div className="text-xs text-muted mt-1">按示例用户渲染，实际发送时仍会逐个单发，不会泄露其他用户邮箱地址。</div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => fetchNoticePreview(noticeDraft)}
                                        disabled={noticePreviewLoading}
                                    >
                                        {noticePreviewLoading ? <span className="spinner" /> : '刷新预览'}
                                    </button>
                                </div>
                                <div className="settings-notice-preview-meta">
                                    <span className="badge badge-neutral">预计发送 {noticePreview?.recipientCount ?? 0} 人</span>
                                    <span className="badge badge-neutral">跳过 {noticePreview?.skippedCount ?? 0} 人</span>
                                    <span className="badge badge-success">逐个单发</span>
                                </div>
                                {noticePreview?.sampleRecipient?.username || noticePreview?.sampleRecipient?.email ? (
                                    <div className="text-xs text-muted">
                                        示例收件人: {noticePreview.sampleRecipient.username || noticePreview.sampleRecipient.email}
                                    </div>
                                ) : null}
                                {noticePreviewError ? (
                                    <div className="settings-notice-preview-empty">
                                        <div className="text-sm font-medium">预览加载失败</div>
                                        <div className="text-sm text-muted">{noticePreviewError}</div>
                                    </div>
                                ) : null}
                                {!noticePreviewError && noticePreviewLoading && !noticePreview ? (
                                    <div className="settings-notice-preview-empty">
                                        <div className="text-sm font-medium">正在生成邮件预览</div>
                                        <div className="text-sm text-muted">正在按实际邮件模板渲染正文。</div>
                                    </div>
                                ) : null}
                                {!noticePreviewError && noticePreview?.html ? (
                                    <div className="settings-notice-preview-frame-shell">
                                        <iframe
                                            title="注册用户通知邮件预览"
                                            className="settings-notice-preview-frame"
                                            sandbox=""
                                            srcDoc={noticePreview.html}
                                        />
                                    </div>
                                ) : null}
                                {!noticePreviewError && !noticePreviewLoading && !noticePreview?.html ? (
                                    <div className="settings-notice-preview-empty">
                                        <div className="text-sm font-medium">还没有可用预览</div>
                                        <div className="text-sm text-muted">填写主题、正文或按钮地址后，这里会显示最终邮件样式。</div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => setNoticeModalOpen(false)} disabled={noticeSending}>
                            取消
                        </button>
                        <button type="button" className="btn btn-primary" onClick={sendRegisteredUserNotice} disabled={noticeSending || !emailStatus?.configured}>
                            {noticeSending ? <span className="spinner" /> : '开始发送'}
                        </button>
                    </div>
                </div>
            </ModalShell>
            <TaskProgressModal
                taskId={noticeTaskId}
                title="发送注册用户变更通知"
                onClose={() => setNoticeTaskId(null)}
            />
            <ModalShell isOpen={backupRestoreModalOpen} onClose={() => setBackupRestoreModalOpen(false)}>
                <div className="modal modal-wide settings-restore-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">恢复系统备份</h3>
                        <button type="button" className="modal-close" onClick={() => setBackupRestoreModalOpen(false)}>
                            <HiOutlineXMark />
                        </button>
                    </div>
                    <div className="modal-body">
                        <div className="settings-restore-warning">
                            <HiOutlineExclamationTriangle className="settings-restore-warning-icon" />
                            <div className="settings-restore-warning-copy">
                                <div className="settings-restore-warning-title">恢复会覆盖当前同名 Store</div>
                                <div className="text-sm text-muted">建议先导出一份当前系统快照，再选择备份文件进行预览校验。新备份会先按当前 `CREDENTIALS_SECRET` 解密，再执行恢复覆盖。</div>
                            </div>
                        </div>

                        <label
                            className={`settings-restore-dropzone${backupDragActive ? ' is-dragover' : ''}`}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setBackupDragActive(true);
                            }}
                            onDragLeave={(event) => {
                                event.preventDefault();
                                setBackupDragActive(false);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                setBackupDragActive(false);
                                setSelectedBackupFile(event.dataTransfer?.files?.[0] || null);
                            }}
                        >
                            <input
                                type="file"
                                accept=".nmsbak,.gz,.json.gz,application/octet-stream,application/gzip"
                                onChange={(event) => setSelectedBackupFile(event.target.files?.[0] || null)}
                            />
                            <div className="settings-restore-dropzone-title">拖拽备份文件到这里，或点击选择文件</div>
                            <div className="settings-restore-dropzone-sub">支持 `NMS` 导出的加密 `.nmsbak`，也兼容旧版 `.gz / .json.gz` 备份包</div>
                            <div className="settings-restore-file">{backupFile?.name || '尚未选择文件'}</div>
                        </label>

                        {(backupInspectLoading || backupRestoreLoading || backupUploadProgress > 0) && (
                            <div className="settings-restore-progress">
                                <div className="settings-restore-progress-head">
                                    <span>{backupRestoreLoading ? '恢复上传中' : '文件校验上传中'}</span>
                                    <span>{backupUploadProgress}%</span>
                                </div>
                                <div className="settings-restore-progress-bar">
                                    <span style={{ width: `${backupUploadProgress}%` }} />
                                </div>
                            </div>
                        )}

                        {backupInspection && (
                            <div className="card mini-card settings-backup-inspection">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="text-sm font-medium">备份预览</div>
                                    <span className="badge badge-success">已校验</span>
                                </div>
                                <div className="settings-backup-inspection-grid">
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">备份时间</div>
                                        <div className="text-sm">{backupInspection.createdAt ? new Date(backupInspection.createdAt).toLocaleString('zh-CN') : '未知'}</div>
                                    </div>
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">格式版本</div>
                                        <div className="text-sm">{backupInspection.format} v{backupInspection.version}</div>
                                    </div>
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">加密状态</div>
                                        <div className="text-sm">{backupInspection.encrypted === false ? '旧版未加密' : (backupInspection.cipher || 'AES-256-GCM')}</div>
                                    </div>
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">可恢复 Store</div>
                                        <div className="text-sm">{(backupInspection.restorableKeys || []).join(', ') || '无'}</div>
                                    </div>
                                </div>
                                {(backupInspection.unsupportedKeys || []).length > 0 && (
                                    <div className="text-sm text-muted">不支持 Store: {backupInspection.unsupportedKeys.join(', ')}</div>
                                )}
                                {(backupInspection.missingKeys || []).length > 0 && (
                                    <div className="text-sm text-muted">缺失快照: {backupInspection.missingKeys.join(', ')}</div>
                                )}
                                <div className="text-sm text-muted">
                                    {backupInspection.encrypted === false
                                        ? '这是旧版未加密备份，仅用于兼容恢复。建议恢复完成后立即重新导出新的加密备份。'
                                        : `恢复时会使用 ${backupInspection.keyHint || 'CREDENTIALS_SECRET'} 解密。`}
                                </div>
                            </div>
                        )}

                        <label className="settings-restore-checkbox">
                            <input
                                type="checkbox"
                                checked={backupRestoreConfirmed}
                                onChange={(event) => setBackupRestoreConfirmed(event.target.checked)}
                            />
                            我已确认本次恢复会覆盖当前同名数据，且备份文件来源可信。
                        </label>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => setBackupRestoreModalOpen(false)}>
                            取消
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={inspectBackup}
                            disabled={!backupFile || backupInspectLoading || backupRestoreLoading}
                        >
                            {backupInspectLoading ? <span className="spinner" /> : '预览备份'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-danger"
                            onClick={restoreBackup}
                            disabled={!backupFile || !backupRestoreConfirmed || backupInspectLoading || backupRestoreLoading}
                        >
                            {backupRestoreLoading ? <span className="spinner" /> : '执行恢复'}
                        </button>
                    </div>
                </div>
            </ModalShell>
            {backfillTaskId && (
                <TaskProgressModal
                    taskId={backfillTaskId}
                    title="数据库回填进度"
                    onClose={() => {
                        setBackfillTaskId(null);
                        fetchDbStatus({ quiet: true });
                    }}
                />
            )}
        </>
    );
}
