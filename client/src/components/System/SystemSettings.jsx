import React, { useEffect, useMemo, useState } from 'react';
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

function buildDraft(source = null) {
    const settings = source || {};
    const defaultAuditIpGeoProvider = 'ip_api';
    const defaultAuditIpGeoEndpoint = 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN';
    return {
        site: {
            accessPath: normalizeSiteAccessPathInput(settings.site?.accessPath, '/'),
            camouflageEnabled: settings.site?.camouflageEnabled === true,
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

const DEFAULT_SETTINGS_TAB = 'basic';
const SETTINGS_TAB_CONFIG = [
    {
        id: 'status',
        label: '系统状态',
        icon: HiOutlineChartBarSquare,
        eyebrow: 'Overview',
        summary: '先看入口、注册、数据库、备份和监控这些关键状态，再进入具体分区处理。',
    },
    {
        id: 'basic',
        label: '系统参数',
        icon: HiOutlineCog6Tooth,
        eyebrow: 'Core Setup',
        summary: '集中调整入口路径、公开订阅地址、审计参数、风险阈值和注册邀请码规则。',
    },
    {
        id: 'db',
        label: '数据库与存储',
        icon: HiOutlineCircleStack,
        eyebrow: 'Storage',
        summary: '查看数据库连接状态，切换读写模式，并决定是否把本地 store 回填到数据库。',
    },
    {
        id: 'backup',
        label: '安全与备份',
        icon: HiOutlineShieldCheck,
        eyebrow: 'Backup',
        summary: '管理加密备份、服务器本机留档和恢复流程，同时处理凭据轮换等高风险操作。',
    },
    {
        id: 'monitor',
        label: '监控诊断',
        icon: HiOutlineServerStack,
        eyebrow: 'Diagnostics',
        summary: '集中查看 SMTP 投递状态、连接测试结果和节点健康巡检信息。',
    },
    {
        id: 'console',
        label: '节点控制台',
        icon: HiOutlineCommandLine,
        eyebrow: 'Console',
        summary: '在系统设置内嵌视图里直接处理节点控制台相关操作，减少来回切换。',
    },
];

function resolveSettingsTab(value) {
    return SETTINGS_TAB_CONFIG.some((item) => item.id === value) ? value : DEFAULT_SETTINGS_TAB;
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

function getSummaryToneBadgeMeta(tone) {
    if (tone === 'success') return { className: 'badge-success', label: '正常' };
    if (tone === 'warning') return { className: 'badge-warning', label: '关注' };
    if (tone === 'danger') return { className: 'badge-danger', label: '关闭' };
    return { className: 'badge-neutral', label: '待检查' };
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

function resolveInviteState(invite) {
    const status = String(invite?.status || '').trim();
    if (status === 'revoked') return 'revoked';
    if (status === 'used') return 'used';
    const remaining = Number(invite?.remainingUses ?? invite?.usageLimit ?? 0) - Number(invite?.usedCount || 0);
    return remaining > 0 ? 'active' : 'used';
}

function formatInviteDuration(days) {
    const normalized = Math.max(0, Number(days) || 0);
    return normalized > 0 ? `${normalized} 天` : '不限时';
}

export default function SystemSettings() {
    const { locale, t } = useI18n();
    const { user } = useAuth();
    const confirmAction = useConfirm();
    const isAdmin = user?.role === 'admin';
    const [searchParams, setSearchParams] = useSearchParams();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [rotateLoading, setRotateLoading] = useState(false);
    const [settings, setSettings] = useState(null);
    const [draft, setDraft] = useState(buildDraft(null));
    const [rotateResult, setRotateResult] = useState(null);
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
    const [registrationRuntime, setRegistrationRuntime] = useState(null);
    const [inviteCodesLoading, setInviteCodesLoading] = useState(false);
    const [inviteCodeActionLoading, setInviteCodeActionLoading] = useState(false);
    const [inviteCodes, setInviteCodes] = useState([]);
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
    const activeTab = resolveSettingsTab(searchParams.get('tab'));
    const activeTabMeta = SETTINGS_TAB_CONFIG.find((item) => item.id === activeTab) || SETTINGS_TAB_CONFIG[0];
    const siteEntryPreview = useMemo(() => {
        if (typeof window === 'undefined') return siteAccessPath;
        return `${window.location.origin}${buildAppEntryPath(siteAccessPath, '/')}`;
    }, [siteAccessPath]);
    const siteCamouflageEnabled = draft.site.camouflageEnabled === true;
    const camouflagePreview = useMemo(() => {
        if (typeof window === 'undefined') return '/';
        return `${window.location.origin}/`;
    }, []);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const res = await api.get('/system/settings');
            const payload = res.data?.obj || null;
            setSettings(payload);
            setDraft(buildDraft(payload));
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
        fetchSettings();
        fetchDbStatus({ quiet: true });
        fetchEmailStatus({ quiet: true });
        fetchBackupStatus({ quiet: true });
        fetchMonitorStatus({ quiet: true });
        fetchRegistrationRuntime();
        fetchInviteCodes({ quiet: true });
    }, [isAdmin]);

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

    const setActiveTab = (nextTab) => {
        const resolvedTab = resolveSettingsTab(nextTab);
        const nextParams = new URLSearchParams(searchParams);
        if (resolvedTab === DEFAULT_SETTINGS_TAB) {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', resolvedTab);
        }
        setSearchParams(nextParams, { replace: true });
    };

    const refreshAllSections = async () => {
        await Promise.all([
            fetchSettings(),
            fetchDbStatus({ quiet: true }),
            fetchEmailStatus({ quiet: true }),
            fetchBackupStatus({ quiet: true }),
            fetchMonitorStatus({ quiet: true }),
            fetchRegistrationRuntime(),
            fetchInviteCodes({ quiet: true }),
        ]);
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

    const applyRandomSiteAccessPath = () => {
        patchField('site', 'accessPath', generateRandomSiteAccessPath());
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
            await fetchRegistrationRuntime();
            toast.success('系统设置已更新');
            const nextSiteAccessPath = normalizeSiteAccessPathInput(next.site?.accessPath, '/');
            const currentSiteAccessPath = normalizeSiteAccessPathInput(
                typeof window !== 'undefined' ? window.__NMS_SITE_BASE_PATH__ : '/',
                '/'
            );
            if (nextSiteAccessPath !== currentSiteAccessPath && typeof window !== 'undefined') {
                const nextRoute = activeTab === DEFAULT_SETTINGS_TAB ? '/settings' : `/settings?tab=${activeTab}`;
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
        setInviteCodeActionLoading(true);
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
        setInviteCodeActionLoading(false);
    };

    const revokeInviteCode = async (invite) => {
        if (!invite?.id || !isAdmin) return;
        const ok = await confirmAction({
            title: '撤销邀请码',
            message: `确定撤销邀请码 ${invite.preview} 吗？`,
            details: `撤销后剩余 ${Math.max(0, Number(invite.remainingUses || 0))} 次将立即失效。`,
            confirmText: '确认撤销',
            tone: 'danger',
        });
        if (!ok) return;

        setInviteCodeActionLoading(true);
        try {
            await api.delete(`/system/invite-codes/${encodeURIComponent(invite.id)}`);
            toast.success('邀请码已撤销');
            await fetchInviteCodes({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '撤销邀请码失败');
        }
        setInviteCodeActionLoading(false);
    };

    const rotateCredentials = async (dryRun) => {
        if (!isAdmin) return;
        const ok = await confirmAction({
            title: dryRun ? '凭据轮换预演' : '执行凭据轮换',
            message: dryRun
                ? '执行 dry-run 仅检查可轮换条目，不写入数据。'
                : '执行后会重加密所有节点凭据，是否继续？',
            confirmText: dryRun ? '开始预演' : '确认轮换',
            tone: dryRun ? 'secondary' : 'danger',
        });
        if (!ok) return;

        setRotateLoading(true);
        try {
            const res = await api.post('/system/credentials/rotate', { dryRun });
            setRotateResult(res.data?.obj || null);
            toast.success(res.data?.msg || '凭据轮换已完成');
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '凭据轮换失败');
        }
        setRotateLoading(false);
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

    const inviteStatusSummary = useMemo(() => (
        inviteCodes.reduce((acc, invite) => {
            const state = resolveInviteState(invite);
            acc[state] += 1;
            return acc;
        }, { active: 0, used: 0, revoked: 0 })
    ), [inviteCodes]);

    const overviewCards = useMemo(() => ([
        {
            title: '站点入口',
            value: siteAccessPath,
            detail: siteAccessPath === '/'
                ? '当前仍使用根路径提供登录页和管理页。'
                : (siteCamouflageEnabled ? '真实入口已隐藏到自定义路径，其他路径将展示公开首页。' : '登录页、管理后台和用户页都改为这个入口路径。'),
            tone: siteAccessPath === '/' ? 'neutral' : 'warning',
        },
        {
            title: '注册模式',
            value: registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭注册',
            detail: registrationEnabled ? '注册页将按当前模式展示表单。' : '环境变量已关闭自助注册。',
            tone: registrationEnabled ? 'success' : 'danger',
        },
        {
            title: '数据库模式',
            value: dbStatus
                ? `read=${dbStatus.currentModes?.readMode || 'file'} / write=${dbStatus.currentModes?.writeMode || 'file'}`
                : '等待探测',
            detail: dbStatus?.connection?.enabled
                ? (dbStatus.connection?.ready ? '数据库连接已就绪。' : (dbStatus.connection?.error || '数据库连接未就绪。'))
                : '当前仍以本地文件模式为主。',
            tone: dbStatus?.connection?.ready ? 'success' : dbStatus?.connection?.enabled ? 'warning' : 'neutral',
        },
        {
            title: '邮件诊断',
            value: emailStatus?.configured ? 'SMTP 已配置' : 'SMTP 未配置',
            detail: emailStatus?.lastVerification?.ts
                ? `最近测试 ${formatDateTime(emailStatus.lastVerification.ts, locale)}`
                : '尚未执行连接测试。',
            tone: emailStatus?.configured ? (emailStatus?.lastVerification?.success === false ? 'warning' : 'success') : 'neutral',
        },
        {
            title: '备份状态',
            value: backupStatus?.lastExport?.createdAt ? '已有备份快照' : '暂无备份快照',
            detail: backupStatus?.lastExport?.createdAt
                ? `最近生成 ${formatDateTime(backupStatus.lastExport.createdAt, locale)}`
                : '建议在改动前先导出一份系统快照。',
            tone: backupStatus?.lastExport?.createdAt ? 'success' : 'warning',
        },
        {
            title: '节点监控',
            value: monitorStatus?.healthMonitor?.running ? '巡检运行中' : '巡检未运行',
            detail: monitorStatus?.healthMonitor?.lastRunAt
                ? `最近巡检 ${formatDateTime(monitorStatus.healthMonitor.lastRunAt, locale)}`
                : '尚未执行节点健康巡检。',
            tone: monitorStatus?.healthMonitor?.running ? 'success' : 'neutral',
        },
    ]), [
        backupStatus?.lastExport?.createdAt,
        dbStatus,
        draft.registration.inviteOnlyEnabled,
        emailStatus,
        monitorStatus,
        registrationEnabled,
        siteCamouflageEnabled,
        siteAccessPath,
    ]);

    const localBackups = Array.isArray(backupStatus?.localBackups) ? backupStatus.localBackups : [];
    const latestLocalBackup = localBackups[0] || null;
    const activeTabHighlights = useMemo(() => {
        if (activeTab === 'status') {
            return [
                { label: '入口', value: siteAccessPath, detail: siteCamouflageEnabled ? '已启用伪装' : '直接访问' },
                { label: '注册', value: registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭', detail: registrationEnabled ? '可在参数页调整' : '由环境变量控制' },
                { label: '备份', value: backupStatus?.lastExport?.filename || '暂无', detail: backupStatus?.lastExport?.createdAt ? formatDateTime(backupStatus.lastExport.createdAt, locale) : '建议先留快照' },
                { label: '监控', value: monitorStatus?.healthMonitor?.running ? '巡检运行中' : '未运行', detail: monitorStatus?.healthMonitor?.lastRunAt ? formatDateTime(monitorStatus.healthMonitor.lastRunAt, locale) : '尚未巡检' },
            ];
        }
        if (activeTab === 'basic') {
            return [
                { label: '真实入口', value: siteAccessPath, detail: siteCamouflageEnabled ? '根路径显示公开首页' : '根路径直接进入系统' },
                { label: '订阅公网地址', value: draft.subscription.publicBaseUrl || '未配置', detail: draft.subscription.publicBaseUrl ? '订阅链接固定使用此地址' : '可能回落到当前访问地址' },
                { label: '邀请码', value: `${inviteStatusSummary.active} 可用`, detail: `${inviteStatusSummary.used} 用完 · ${inviteStatusSummary.revoked} 撤销` },
                { label: '审计地理查询', value: draft.auditIpGeo.enabled ? '已开启' : '已关闭', detail: draft.auditIpGeo.provider || '未设置服务商' },
            ];
        }
        if (activeTab === 'monitor') {
            return [
                { label: 'SMTP', value: emailConfiguredLabel, detail: emailStatus?.from || '尚未配置发件人' },
                { label: '连接测试', value: emailVerificationLabel, detail: emailStatus?.lastVerification?.ts ? formatDateTime(emailStatus.lastVerification.ts, locale) : '尚未测试' },
                { label: '节点巡检', value: monitorStatus?.healthMonitor?.running ? '运行中' : '未运行', detail: `周期 ${Math.round(Number(monitorStatus?.healthMonitor?.intervalMs || 0) / 60000) || 0} 分钟` },
                { label: '告警', value: `未读 ${monitorStatus?.notifications?.unreadCount || 0}`, detail: `DB 连续失败 ${monitorStatus?.dbAlerts?.consecutiveFailures || 0}` },
            ];
        }
        if (activeTab === 'backup') {
            return [
                { label: '加密算法', value: 'AES-256-GCM', detail: '解密密钥来自 CREDENTIALS_SECRET' },
                { label: '本机备份', value: `${localBackups.length} 份`, detail: latestLocalBackup?.filename || '尚未保存到服务器本机' },
                { label: '最近生成', value: backupStatus?.lastExport?.filename || '暂无', detail: backupStatus?.lastExport?.createdAt ? formatDateTime(backupStatus.lastExport.createdAt, locale) : '尚无生成记录' },
                { label: '最近恢复', value: backupStatus?.lastImport?.sourceFilename || '暂无', detail: backupStatus?.lastImport?.restoredAt ? formatDateTime(backupStatus.lastImport.restoredAt, locale) : '尚无恢复记录' },
            ];
        }
        if (activeTab === 'db') {
            return [
                { label: '数据库连接', value: dbStatus?.connection?.enabled ? (dbStatus?.connection?.ready ? '已就绪' : '未就绪') : '未启用', detail: dbStatus?.connection?.error || '无错误' },
                { label: '当前模式', value: dbStatus ? `r=${dbStatus.currentModes?.readMode || 'file'} / w=${dbStatus.currentModes?.writeMode || 'file'}` : '等待探测', detail: '支持 file / dual / db' },
                { label: '待写入', value: `${dbStatus?.pendingWrites || 0}`, detail: `queued ${dbStatus?.writesQueued || 0}` },
                { label: '快照数', value: `${(dbStatus?.snapshots || []).length}`, detail: dbStatus?.lastWriteAt ? `最后写入 ${formatDateTime(dbStatus.lastWriteAt, locale)}` : '尚无写入记录' },
            ];
        }
        return [
            { label: '模式', value: '内嵌控制台', detail: '保持当前系统设置上下文不跳转' },
            { label: '适用场景', value: '节点运维', detail: '适合修改节点、诊断连接和查看状态' },
            { label: '布局', value: 'PC 双栏 / 手机单列', detail: '跟随系统设置的整体响应式版式' },
        ];
    }, [
        activeTab,
        backupStatus,
        dbStatus,
        draft.auditIpGeo.enabled,
        draft.auditIpGeo.provider,
        draft.registration.inviteOnlyEnabled,
        draft.subscription.publicBaseUrl,
        emailConfiguredLabel,
        emailStatus,
        emailVerificationLabel,
        inviteStatusSummary.active,
        inviteStatusSummary.revoked,
        inviteStatusSummary.used,
        latestLocalBackup?.filename,
        localBackups.length,
        locale,
        monitorStatus,
        registrationEnabled,
        siteAccessPath,
        siteCamouflageEnabled,
    ]);

    const renderBasicContent = () => (
        <div className="settings-section-stack">
            <div className="settings-mini-grid settings-basic-summary-grid">
                <div className="card p-3 settings-mini-card settings-basic-summary-card">
                    <div className="text-sm text-muted">当前入口</div>
                    <div className="text-lg font-semibold font-mono">{siteEntryPreview}</div>
                    <div className="text-xs text-muted">{siteCamouflageEnabled ? '伪装首页已开启，根路径不会直接暴露后台。' : '根路径按默认路由处理，后台入口由上方路径决定。'}</div>
                </div>
                <div className="card p-3 settings-mini-card settings-basic-summary-card">
                    <div className="text-sm text-muted">注册模式</div>
                    <div className="text-lg font-semibold">{registrationEnabled ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册') : '已关闭注册'}</div>
                    <div className="text-xs text-muted">邀请码 {inviteCodes.length} 个，可用 {inviteStatusSummary.active} 个。</div>
                </div>
                <div className="card p-3 settings-mini-card settings-basic-summary-card">
                    <div className="text-sm text-muted">任务策略</div>
                    <div className="text-lg font-semibold">保留 {draft.jobs.retentionDays} 天</div>
                    <div className="text-xs text-muted">默认并发 {draft.jobs.defaultConcurrency}，上限 {draft.jobs.maxConcurrency}。</div>
                </div>
                <div className="card p-3 settings-mini-card settings-basic-summary-card">
                    <div className="text-sm text-muted">审计归属地</div>
                    <div className="text-lg font-semibold">{draft.auditIpGeo.enabled ? '已启用' : '未启用'}</div>
                    <div className="text-xs text-muted">{draft.auditIpGeo.provider || '未设置服务提供方'} · 缓存 {draft.auditIpGeo.cacheTtlSeconds}s</div>
                </div>
            </div>

            <div className="settings-grid settings-grid--basic">
                <div className="card p-4 settings-panel settings-panel--wide settings-panel--entry">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title="站点入口"
                        subtitle="控制登录页、管理后台和用户自助页从哪个路径进入，并决定未命中真实入口时是否展示公开首页。"
                    />
                    <div className="settings-inline-grid settings-basic-entry-grid">
                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">入口路径</div>
                                <div className="settings-form-cluster-title">对外访问的真实入口</div>
                                <div className="settings-form-cluster-note">保存后旧路径将不再提供页面，不要使用 `/api`、`/assets`、`/ws` 这类系统保留路径。</div>
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
                                <div className="text-xs text-muted mt-1">例如 `/portal` 或 `/office/nms`。</div>
                            </div>
                        </div>
                        <div className="card p-3 settings-mini-card settings-detail-card settings-basic-note-card mb-0">
                            <div className="text-sm text-muted">当前入口预览</div>
                            <div className="text-base font-semibold font-mono mt-2 break-all">{siteEntryPreview}</div>
                            <div className="settings-basic-note-list mt-2">
                                <span className="badge badge-neutral">登录页 / 后台 / 自助页共用入口</span>
                                <span className="badge badge-neutral">支持多级路径</span>
                            </div>
                        </div>
                    </div>
                    <div className="settings-field-grid settings-field-grid--compact mt-4">
                        <div className="form-group mb-0">
                            <SettingsToggleCard
                                checked={draft.site.camouflageEnabled}
                                onChange={(e) => handleCamouflageToggle(e.target.checked)}
                                label="站点伪装首页"
                                description="开启后，首页和错误路径将展示公开首页；只有输入真实入口路径才能进入 NMS。"
                                activeLabel="已开启"
                                inactiveLabel="已关闭"
                            />
                        </div>
                        <div className="card p-3 settings-mini-card settings-detail-card settings-basic-note-card mb-0">
                            <div className="text-sm text-muted">公开首页预览</div>
                            <div className="text-base font-semibold font-mono mt-2 break-all">{camouflagePreview}</div>
                            <div className="text-xs text-muted mt-2">
                                {siteCamouflageEnabled
                                    ? '访问根路径或错误路径时，将展示高科技设备公司的公开首页。'
                                    : '关闭时，错误路径将按默认 404 / 前端路由处理。'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--span-7 settings-basic-workbench">
                    <SettingsPanelHeader
                        title="任务中心参数"
                        subtitle="批量任务的保留、分页和并发策略。"
                    />
                    <div className="settings-form-cluster">
                        <div className="settings-form-cluster-head">
                            <div className="settings-form-cluster-eyebrow">保留策略</div>
                            <div className="settings-form-cluster-title">先定义历史记录和分页上限</div>
                            <div className="settings-form-cluster-note">面向任务列表本身的容量控制，避免页面和存储一起膨胀。</div>
                        </div>
                        <div className="settings-field-grid settings-field-grid--compact">
                            <div className="form-group">
                                <label className="form-label">任务保留天数</label>
                                <input className="form-input" type="number" min={1} value={draft.jobs.retentionDays} onChange={(e) => patchField('jobs', 'retentionDays', toInt(e.target.value, 90))} />
                                <div className="text-xs text-muted mt-1">历史任务记录的保留期限。</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">任务分页最大条数</label>
                                <input className="form-input" type="number" min={20} value={draft.jobs.maxPageSize} onChange={(e) => patchField('jobs', 'maxPageSize', toInt(e.target.value, 200))} />
                                <div className="text-xs text-muted mt-1">任务列表单页最大记录数。</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">任务最大保留记录</label>
                                <input className="form-input" type="number" min={100} value={draft.jobs.maxRecords} onChange={(e) => patchField('jobs', 'maxRecords', toInt(e.target.value, 2000))} />
                                <div className="text-xs text-muted mt-1">系统保留的历史任务上限。</div>
                            </div>
                        </div>
                    </div>
                    <div className="settings-form-cluster">
                        <div className="settings-form-cluster-head">
                            <div className="settings-form-cluster-eyebrow">执行策略</div>
                            <div className="settings-form-cluster-title">控制新任务默认并发和最高并发</div>
                            <div className="settings-form-cluster-note">上限过高会放大批量操作的资源消耗，建议和节点规模一起调整。</div>
                        </div>
                        <div className="settings-field-grid settings-field-grid--compact">
                            <div className="form-group">
                                <label className="form-label">批量并发上限</label>
                                <input className="form-input" type="number" min={1} value={draft.jobs.maxConcurrency} onChange={(e) => patchField('jobs', 'maxConcurrency', toInt(e.target.value, 10))} />
                                <div className="text-xs text-muted mt-1">允许的最大并行操作数。</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">默认并发</label>
                                <input className="form-input" type="number" min={1} value={draft.jobs.defaultConcurrency} onChange={(e) => patchField('jobs', 'defaultConcurrency', toInt(e.target.value, 5))} />
                                <div className="text-xs text-muted mt-1">新建任务时的默认并行数。</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--span-5 settings-basic-workbench">
                    <SettingsPanelHeader
                        title="风控确认"
                        subtitle="控制高风险批量动作的确认阈值和令牌时效。"
                    />
                    <div className="form-group settings-checkbox-row">
                        <SettingsToggleCard
                            checked={draft.security.requireHighRiskConfirmation}
                            onChange={(e) => patchField('security', 'requireHighRiskConfirmation', e.target.checked)}
                            label="高风险操作二次确认"
                            description="批量动作达到高风险阈值后，执行前必须再次确认。"
                        />
                    </div>
                    <div className="settings-basic-note-strip">
                        <div className="card p-3 settings-mini-card settings-detail-card settings-basic-note-card">
                            <div className="text-sm text-muted">当前高风险线</div>
                            <div className="text-lg font-semibold">{draft.security.highRiskMinTargets} 个目标</div>
                            <div className="text-xs text-muted">达到后必须二次确认。</div>
                        </div>
                        <div className="card p-3 settings-mini-card settings-detail-card settings-basic-note-card">
                            <div className="text-sm text-muted">确认有效期</div>
                            <div className="text-lg font-semibold">{draft.security.riskTokenTtlSeconds} 秒</div>
                            <div className="text-xs text-muted">超时后需重新确认。</div>
                        </div>
                    </div>
                    <div className="settings-field-grid settings-field-grid--compact">
                        <div className="form-group">
                            <label className="form-label">中风险阈值</label>
                            <input className="form-input" type="number" min={1} value={draft.security.mediumRiskMinTargets} onChange={(e) => patchField('security', 'mediumRiskMinTargets', toInt(e.target.value, 20))} />
                            <div className="text-xs text-muted mt-1">达到后按中风险提示。</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">高风险阈值</label>
                            <input className="form-input" type="number" min={1} value={draft.security.highRiskMinTargets} onChange={(e) => patchField('security', 'highRiskMinTargets', toInt(e.target.value, 100))} />
                            <div className="text-xs text-muted mt-1">达到后要求二次确认。</div>
                        </div>
                        <div className="form-group mb-0">
                            <label className="form-label">确认令牌有效期（秒）</label>
                            <input className="form-input" type="number" min={30} value={draft.security.riskTokenTtlSeconds} onChange={(e) => patchField('security', 'riskTokenTtlSeconds', toInt(e.target.value, 180))} />
                            <div className="text-xs text-muted mt-1">批量执行授权的有效时长。</div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--span-4 settings-basic-workbench">
                    <SettingsPanelHeader
                        title="审计参数"
                        subtitle="控制操作日志的保留周期和分页上限。"
                    />
                    <div className="settings-form-cluster">
                        <div className="settings-form-cluster-head">
                            <div className="settings-form-cluster-eyebrow">保留窗口</div>
                            <div className="settings-form-cluster-title">审计日志多久清理一次</div>
                        </div>
                        <div className="settings-field-grid settings-field-grid--compact">
                            <div className="form-group">
                                <label className="form-label">审计保留天数</label>
                                <input className="form-input" type="number" min={1} value={draft.audit.retentionDays} onChange={(e) => patchField('audit', 'retentionDays', toInt(e.target.value, 365))} />
                                <div className="text-xs text-muted mt-1">日志保留期限，超期自动清理。</div>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">审计分页最大条数</label>
                                <input className="form-input" type="number" min={20} value={draft.audit.maxPageSize} onChange={(e) => patchField('audit', 'maxPageSize', toInt(e.target.value, 200))} />
                                <div className="text-xs text-muted mt-1">日志列表单页最大记录数。</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--span-8 settings-basic-workbench">
                    <SettingsPanelHeader
                        title="审计归属地查询"
                        subtitle="控制订阅访问日志里的地区与运营商查询服务。"
                    />
                    <div className="form-group settings-checkbox-row">
                        <SettingsToggleCard
                            checked={draft.auditIpGeo.enabled}
                            onChange={(e) => patchField('auditIpGeo', 'enabled', e.target.checked)}
                            label="归属地查询"
                            description="为订阅访问日志补充地区和运营商信息。"
                        />
                    </div>
                    <div className="settings-basic-geo-grid">
                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">查询地址</div>
                                <div className="settings-form-cluster-title">IP 查询模板</div>
                                <div className="settings-form-cluster-note">使用 `{`ip`}` 作为 IP 占位符，避免写成固定 IP。</div>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">查询地址模板</label>
                                <input className="form-input" value={draft.auditIpGeo.endpoint} onChange={(e) => patchField('auditIpGeo', 'endpoint', e.target.value)} />
                            </div>
                        </div>
                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">服务参数</div>
                                <div className="settings-form-cluster-title">提供方、超时和缓存</div>
                            </div>
                            <div className="settings-field-grid settings-field-grid--compact">
                                <div className="form-group">
                                    <label className="form-label">服务提供方</label>
                                    <input className="form-input" value={draft.auditIpGeo.provider} onChange={(e) => patchField('auditIpGeo', 'provider', e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">超时（毫秒）</label>
                                    <input className="form-input" type="number" min={200} value={draft.auditIpGeo.timeoutMs} onChange={(e) => patchField('auditIpGeo', 'timeoutMs', toInt(e.target.value, 1500))} />
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">缓存时长（秒）</label>
                                    <input className="form-input" type="number" min={60} value={draft.auditIpGeo.cacheTtlSeconds} onChange={(e) => patchField('auditIpGeo', 'cacheTtlSeconds', toInt(e.target.value, 21600))} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench">
                    <SettingsPanelHeader
                        title="订阅地址"
                        subtitle="控制公开订阅域名和外部转换器地址。"
                    />
                    <div className="settings-basic-address-grid">
                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">公网输出</div>
                                <div className="settings-form-cluster-title">固定订阅链接的公开域名</div>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">订阅公网地址（可选，建议配置）</label>
                                <input
                                    className="form-input"
                                    placeholder="https://nms.example.com"
                                    value={draft.subscription.publicBaseUrl}
                                    onChange={(e) => patchField('subscription', 'publicBaseUrl', e.target.value)}
                                />
                                <div className="text-xs text-muted mt-1">配置后订阅链接将固定使用该地址，避免出现 localhost 或内网地址。</div>
                            </div>
                        </div>
                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">外部转换</div>
                                <div className="settings-form-cluster-title">Clash / Mihomo / Surge 使用的转换器</div>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">外部订阅转换器地址（可选）</label>
                                <input
                                    className="form-input"
                                    placeholder="https://converter.example.com"
                                    value={converterBaseUrl}
                                    onChange={(e) => patchField('subscription', 'converterBaseUrl', e.target.value)}
                                />
                                <div className="text-xs text-muted mt-1">配置后快捷方式会自动切换到外部转换器。</div>
                                <div className="flex gap-2 flex-wrap mt-2">
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
                        </div>
                        <div className="card p-3 settings-mini-card settings-detail-card settings-basic-note-card">
                            <div className="text-sm text-muted">当前输出策略</div>
                            <div className="text-base font-semibold break-all">{draft.subscription.publicBaseUrl || '未固定公网域名'}</div>
                            <div className="text-xs text-muted mt-1">{converterBaseUrl ? `转换器 ${converterBaseUrl}` : '未配置外部转换器时，仍使用 NMS 内置专用配置生成逻辑。'}</div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title="注册与邀请码"
                        subtitle="支持邀请注册、批量生成邀请码，并兼容已存在的单次邀请码数据。"
                        actions={(
                            <div className="settings-panel-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => fetchInviteCodes()} disabled={inviteCodesLoading || inviteCodeActionLoading}>
                                    {inviteCodesLoading ? <span className="spinner" /> : '刷新邀请码'}
                                </button>
                            </div>
                        )}
                    />
                    <div className="settings-mini-grid settings-mini-grid--metrics mb-4">
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">当前注册状态</div>
                            <div className="text-lg font-semibold">{registrationEnabled ? '允许注册' : '已关闭注册'}</div>
                            <div className="text-xs text-muted mt-1">全局开关来自环境变量 `REGISTRATION_ENABLED`。</div>
                        </div>
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">注册模式</div>
                            <div className="text-lg font-semibold">{draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册'}</div>
                            <div className="text-xs text-muted mt-1">邀请模式下注册页必须填写有效邀请码。</div>
                        </div>
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">邀请码情况</div>
                            <div className="text-lg font-semibold">{inviteCodes.length}</div>
                            <div className="text-xs text-muted mt-1">可用 {inviteStatusSummary.active} · 用完 {inviteStatusSummary.used} · 撤销 {inviteStatusSummary.revoked}</div>
                        </div>
                    </div>
                    <div className="form-group">
                        <SettingsToggleCard
                            checked={draft.registration.inviteOnlyEnabled}
                            onChange={(e) => patchField('registration', 'inviteOnlyEnabled', e.target.checked)}
                            disabled={!registrationEnabled}
                            label="开启邀请注册"
                            description={registrationEnabled
                                ? '开启后，注册页必须填写有效邀请码；注册成功后可直接登录，后台自动按邀请码开通全部节点订阅。'
                                : '当前环境已关闭自助注册，这里的邀请模式配置会保留，但不会开放注册入口。'}
                            activeLabel="邀请模式"
                            inactiveLabel="普通模式"
                        />
                    </div>
                    <div className="card p-3 settings-mini-card settings-detail-card mb-3">
                        <div className="text-sm font-medium mb-2">生成参数</div>
                        <div className="text-xs text-muted mb-3">邀请码注册会默认开通全部节点和全部协议；这里主要控制可用次数和开通时长。</div>
                        <div className="settings-inline-grid settings-inline-grid--triple">
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
                                <div className="text-xs text-muted mt-1">一次最多生成 50 个。</div>
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
                                <div className="text-xs text-muted mt-1">老邀请码会自动按单次使用兼容。</div>
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
                                <div className="text-xs text-muted mt-1">填 0 表示不限时，例如 30 / 90 / 365 天。</div>
                            </div>
                            <div className="form-group mb-0 settings-form-actions">
                                <button
                                    className="btn btn-primary w-full"
                                    type="button"
                                    onClick={createInviteCode}
                                    disabled={inviteCodeActionLoading}
                                >
                                    {inviteCodeActionLoading ? <span className="spinner" /> : '生成邀请码'}
                                </button>
                                <div className="text-xs text-muted mt-1">例如生成 5 个邀请码，每个可注册 2 次，并自动开通 30 天。</div>
                            </div>
                        </div>
                    </div>
                    {latestInviteCodes.length > 0 && (
                        <div className="card p-3 settings-mini-card settings-detail-card mb-3">
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
                    )}
                    <div className="settings-table-shell settings-invite-table-shell" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                        <table className="table settings-invite-table">
                            <thead>
                                <tr>
                                    <th>预览</th>
                                    <th>状态</th>
                                    <th>次数</th>
                                    <th>开通时长</th>
                                    <th>创建时间</th>
                                    <th>使用情况</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {inviteCodes.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="text-center text-muted">暂无邀请码</td>
                                    </tr>
                                ) : (
                                    inviteCodes.map((invite) => (
                                        <tr key={invite.id}>
                                            <td data-label="预览" className="cell-mono settings-invite-preview-cell">
                                                <div className="settings-invite-preview">
                                                    <span className="settings-invite-preview-code">{invite.preview}</span>
                                                    <span className="settings-invite-preview-note">
                                                        {invite.createdBy ? `创建者 ${invite.createdBy}` : '创建后明文仅展示一次'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td data-label="状态" className="table-cell-stack settings-invite-cell">
                                                <span className={`badge ${resolveInviteState(invite) === 'active' ? 'badge-success' : resolveInviteState(invite) === 'used' ? 'badge-warning' : 'badge-danger'}`}>
                                                    {resolveInviteState(invite) === 'active' ? '可用中' : resolveInviteState(invite) === 'used' ? '已用完' : '已撤销'}
                                                </span>
                                                <span className="settings-invite-status-note">
                                                    {resolveInviteState(invite) === 'active'
                                                        ? `剩余 ${Number(invite.remainingUses || 0)} 次`
                                                        : resolveInviteState(invite) === 'used'
                                                            ? '已达到使用上限'
                                                            : '已停止使用'}
                                                </span>
                                            </td>
                                            <td data-label="次数" className="table-cell-stack settings-invite-cell">
                                                <span className="settings-invite-usage-main">
                                                    {Number(invite.usedCount || 0)} / {Number(invite.usageLimit || 1)}
                                                </span>
                                                <span className="settings-invite-usage-note">
                                                    已用 {Number(invite.usedCount || 0)} 次
                                                </span>
                                            </td>
                                            <td data-label="开通时长" className="table-cell-stack settings-invite-cell">
                                                <span className="settings-invite-usage-main">
                                                    {formatInviteDuration(invite.subscriptionDays)}
                                                </span>
                                                <span className="settings-invite-usage-note">
                                                    {Number(invite.subscriptionDays || 0) > 0 ? '注册即自动生效' : '注册后不限到期时间'}
                                                </span>
                                            </td>
                                            <td data-label="创建时间" className="settings-invite-created-cell">
                                                <div className="settings-invite-created">{formatDateTime(invite.createdAt, locale)}</div>
                                            </td>
                                            <td data-label="使用情况" className="table-cell-stack settings-invite-cell">
                                                <span className="settings-invite-history-main">
                                                    {invite.revokedAt
                                                        ? '手动撤销'
                                                        : invite.usedAt
                                                            ? `最近由 ${invite.usedByUsername || invite.usedByUserId || '-'} 使用`
                                                            : '暂无使用记录'}
                                                </span>
                                                <span className="settings-invite-history-note">
                                                    {invite.revokedAt
                                                        ? formatDateTime(invite.revokedAt, locale)
                                                        : invite.usedAt
                                                            ? formatDateTime(invite.usedAt, locale)
                                                            : '等待首次使用'}
                                                </span>
                                            </td>
                                            <td data-label="操作" className="table-cell-actions settings-invite-action-cell">
                                                {resolveInviteState(invite) === 'active' ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger btn-sm settings-invite-revoke-btn"
                                                        onClick={() => revokeInviteCode(invite)}
                                                        disabled={inviteCodeActionLoading}
                                                    >
                                                        撤销
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-muted">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
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
                    subtitle="SMTP 配置来自服务端 `.env`，这里只展示诊断结果，不回显明文密码。"
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
                        <button className="btn btn-primary btn-sm" onClick={openNoticeModal} disabled={!emailStatus?.configured || emailStatusLoading || emailTestLoading}>
                            发送变更通知
                        </button>
                    </div>
                </div>
                {!emailStatus ? (
                    <div className="text-sm text-muted">尚未加载 SMTP 状态。</div>
                ) : (
                    <>
                        <div className="settings-monitor-hero">
                            <div className="card p-3 settings-mini-card settings-monitor-hero-main">
                                <div className="settings-monitor-hero-eyebrow">当前邮件链路</div>
                                <div className="settings-monitor-hero-title">{emailStatus.from || '未设置发件人'}</div>
                                <div className="settings-monitor-hero-detail">
                                    {(emailStatus.host || '未配置服务器')} · port {emailStatus.port || '-'} · {emailStatus.service || '自定义 SMTP'}
                                </div>
                                <div className="settings-basic-note-list">
                                    <span className={`badge ${emailConfiguredBadge}`}>{emailConfiguredLabel}</span>
                                    <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                                    <span className={`badge ${emailVerificationBadge}`}>{emailVerificationLabel}</span>
                                </div>
                            </div>
                            <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-hero-side">
                                <div className="text-sm font-medium">运维通知建议</div>
                                <div className="text-sm text-muted">更换站点入口、订阅域名或备用网址时，可以直接从这里给已注册用户发送变更通知。邮件会逐个单发，不会暴露其他用户地址。</div>
                                <div className="text-xs text-muted">建议在改域名前先做一次连接测试，再发通知。</div>
                            </div>
                        </div>
                        <div className="settings-mini-grid settings-monitor-summary-grid mb-3">
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">配置状态</div>
                                <div className="mt-2">
                                    <span className={`badge ${emailConfiguredBadge}`}>{emailConfiguredLabel}</span>
                                </div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">SMTP 服务</div>
                                <div className="text-lg font-semibold">{emailStatus.service || '-'}</div>
                                <div className="text-xs text-muted">auth {emailStatus.authMethod || 'AUTO'}</div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">服务器</div>
                                <div className="text-lg font-semibold">{emailStatus.host || '-'}</div>
                                <div className="text-xs text-muted">port {emailStatus.port || '-'}</div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">加密模式</div>
                                <div className="text-lg font-semibold">{emailStatus.secure ? 'SSL/TLS' : 'STARTTLS/Plain'}</div>
                                <div className="text-xs text-muted">
                                    {emailStatus.requireTLS ? 'requireTLS' : (emailStatus.ignoreTLS ? 'ignoreTLS' : 'auto TLS')}
                                </div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">发件账号</div>
                                <div className="text-lg font-semibold">{emailStatus.userMasked || '-'}</div>
                                <div className="text-xs text-muted">{emailStatus.authMethod || 'AUTO'} 认证</div>
                            </div>
                        </div>
                        <div className="settings-monitor-detail-grid">
                            <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-detail-card">
                                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                    <div className="text-sm font-medium">最近连接测试</div>
                                    <span className={`badge ${emailVerificationBadge}`}>{emailVerificationLabel}</span>
                                </div>
                                <div className="settings-monitor-log-meta">
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">最近测试</span>
                                        <span className="settings-monitor-log-value">{formatDateTime(emailStatus.lastVerification?.ts, locale)}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">错误摘要</span>
                                        <span className="settings-monitor-log-value">{emailStatus.lastVerification?.error || '-'}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">诊断建议</span>
                                        <span className="settings-monitor-log-value">{emailStatus.lastVerification?.hint || '-'}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-detail-card">
                                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                    <div className="text-sm font-medium">最近发送结果</div>
                                    <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                                </div>
                                <div className="settings-monitor-log-meta">
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">最近发送</span>
                                        <span className="settings-monitor-log-value">{formatDateTime(emailStatus.lastDelivery?.ts, locale)}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">发送类型</span>
                                        <span className="settings-monitor-log-value">{emailStatus.lastDelivery?.type || '-'}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">错误摘要</span>
                                        <span className="settings-monitor-log-value">{emailStatus.lastDelivery?.error || '-'}</span>
                                    </div>
                                    <div className="settings-monitor-log-item">
                                        <span className="settings-monitor-log-label">诊断建议</span>
                                        <span className="settings-monitor-log-value">{emailStatus.lastDelivery?.hint || '-'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className="card p-4 settings-panel settings-monitor-panel settings-panel--span-5">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="节点健康监控"
                    subtitle="后台会定期巡检已配置节点，并通过右上角通知中心推送异常或恢复告警。"
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
                <div className="settings-mini-grid settings-monitor-health-grid mb-3">
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">监控状态</div>
                        <div className="text-lg font-semibold">{monitorStatus?.healthMonitor?.running ? '运行中' : '未运行'}</div>
                        <div className="text-xs text-muted mt-1">周期 {Math.round(Number(monitorStatus?.healthMonitor?.intervalMs || 0) / 60000) || 0} 分钟</div>
                    </div>
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">最近巡检</div>
                        <div className="text-lg font-semibold">{formatDateTime(monitorStatus?.healthMonitor?.lastRunAt, locale)}</div>
                        <div className="text-xs text-muted mt-1">节点 {monitorStatus?.healthMonitor?.summary?.total || 0}</div>
                    </div>
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">健康统计</div>
                        <div className="text-lg font-semibold">
                            正常 {monitorStatus?.healthMonitor?.summary?.healthy || 0} / 异常 {(monitorStatus?.healthMonitor?.summary?.degraded || 0) + (monitorStatus?.healthMonitor?.summary?.unreachable || 0)}
                        </div>
                        <div className="text-xs text-muted mt-1">维护 {monitorStatus?.healthMonitor?.summary?.maintenance || 0}</div>
                    </div>
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">告警状态</div>
                        <div className="text-lg font-semibold">未读 {monitorStatus?.notifications?.unreadCount || 0}</div>
                        <div className="text-xs text-muted mt-1">DB 连续失败 {monitorStatus?.dbAlerts?.consecutiveFailures || 0}</div>
                    </div>
                </div>
                <div className="settings-monitor-detail-grid settings-monitor-detail-grid--single">
                    <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-detail-card">
                        <div className="text-sm font-medium">通知中心</div>
                        <div className="settings-monitor-log-meta">
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">未读告警</span>
                                <span className="settings-monitor-log-value">{monitorStatus?.notifications?.unreadCount || 0}</span>
                            </div>
                            <div className="settings-monitor-log-item">
                                <span className="settings-monitor-log-label">维护节点</span>
                                <span className="settings-monitor-log-value">{monitorStatus?.healthMonitor?.summary?.maintenance || 0}</span>
                            </div>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-detail-card settings-monitor-detail-card">
                        <div className="text-sm font-medium">巡检说明</div>
                        <div className="text-sm text-muted">系统会按设定周期巡检节点，异常和恢复状态会同步投递到右上角通知中心。手动点击“立即巡检”时，会按当前配置立刻重跑一次健康检查。</div>
                    </div>
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
                    title="加密备份工作台"
                    subtitle="新备份会统一使用当前 `CREDENTIALS_SECRET` 加密；导出、保存到服务器本机、预览和恢复都走同一套解密校验链路。"
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchBackupStatus()} disabled={backupStatusLoading}>
                            {backupStatusLoading ? <span className="spinner" /> : '刷新状态'}
                        </button>
                    )}
                />
                <div className="settings-backup-hero">
                    <div className="card p-3 settings-mini-card settings-backup-hero-card">
                        <div className="settings-backup-hero-eyebrow">备份策略</div>
                        <div className="settings-backup-hero-title">默认输出加密备份包，恢复前先解密再校验</div>
                        <div className="text-sm text-muted">
                            新备份文件统一为 `.nmsbak`。只要 `CREDENTIALS_SECRET` 不变，你可以选择导出下载，或直接在服务器本机留存并从列表里恢复。
                        </div>
                        <div className="settings-backup-badge-row">
                            <span className="badge badge-success">AES-256-GCM</span>
                            <span className="badge badge-neutral">密钥来源 CREDENTIALS_SECRET</span>
                            <span className="badge badge-neutral">旧版 `.json.gz` 兼容恢复</span>
                        </div>
                    </div>
                    <div className="settings-mini-grid settings-backup-summary-grid">
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">可备份 Store</div>
                            <div className="text-lg font-semibold">{backupStatus?.storeKeys?.length || 0}</div>
                            <div className="text-xs text-muted mt-1">{(backupStatus?.storeKeys || []).join(', ') || '暂无'}</div>
                        </div>
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">最近生成</div>
                            <div className="text-lg font-semibold">{formatDateTime(backupStatus?.lastExport?.createdAt, locale)}</div>
                            <div className="text-xs text-muted mt-1">{backupStatus?.lastExport?.filename || '-'}</div>
                        </div>
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">本机备份</div>
                            <div className="text-lg font-semibold">{localBackups.length}</div>
                            <div className="text-xs text-muted mt-1">{latestLocalBackup?.filename || '服务器本机尚无备份'}</div>
                        </div>
                        <div className="card p-3 settings-mini-card">
                            <div className="text-sm text-muted">最近恢复</div>
                            <div className="text-lg font-semibold">{formatDateTime(backupStatus?.lastImport?.restoredAt, locale)}</div>
                            <div className="text-xs text-muted mt-1">{backupStatus?.lastImport?.sourceFilename || '-'}</div>
                        </div>
                    </div>
                </div>

                <div className="settings-backup-actions settings-backup-actions--triple mt-3">
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">导出到浏览器</div>
                        <div className="text-xs text-muted mt-1">下载一份加密备份包到当前浏览器所在设备，适合异地留存或手工归档。</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-primary btn-sm" onClick={exportBackup} disabled={backupLoading || backupRestoreLoading || backupLocalSaving}>
                                {backupLoading ? <span className="spinner" /> : <><HiOutlineArrowDownTray /> 导出加密备份</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">保存到服务器本机</div>
                        <div className="text-xs text-muted mt-1">在 `NMS` 所在机器保存一份加密备份，后续可以直接从下面列表里下载、恢复或删除。</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-secondary btn-sm" onClick={saveBackupLocally} disabled={backupLocalSaving || backupLoading || backupRestoreLoading}>
                                {backupLocalSaving ? <span className="spinner" /> : <><HiOutlineShieldCheck /> 保存本机备份</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">从文件恢复</div>
                        <div className="text-xs text-muted mt-1">上传加密备份包或旧版 `.json.gz`，系统会先解密或解压校验，再执行覆盖恢复。</div>
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

            <div className="card p-4 settings-panel settings-danger-panel">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="凭据轮换"
                    subtitle="更换 `CREDENTIALS_SECRET` 后，可用新密钥重新加密已保存的节点凭据。Dry Run 仅预演不修改数据。"
                />
                <div className="flex gap-2 flex-wrap mb-3">
                    <button className="btn btn-secondary btn-sm" onClick={() => rotateCredentials(true)} disabled={rotateLoading}>
                        {rotateLoading ? <span className="spinner" /> : 'Dry Run'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => rotateCredentials(false)} disabled={rotateLoading}>
                        {rotateLoading ? <span className="spinner" /> : '执行轮换'}
                    </button>
                </div>
                {rotateResult && (
                    <div className="text-sm text-muted">
                        扫描字段: {rotateResult.scannedFields}，轮换字段: {rotateResult.rotatedFields}，失败: {rotateResult.failedFields}
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
                    subtitle="运行时查看数据库就绪情况，并在 file / db / dual 之间切换读写模式。"
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
                                <div className="text-xs text-muted mt-1">需在 `.env` 中配置 `DB_ENABLED=true` 和 `DB_URL`。</div>
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
                                    <div className="text-xs text-muted">运行时切换数据源，无需重启。file=本地 JSON，db=PostgreSQL，dual=同时写两者。</div>
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
                                    <div className="text-xs text-muted">将本地 JSON 文件数据导入 PostgreSQL。脱敏写入会隐藏密码等敏感字段。</div>
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

                        <div className="mt-4 settings-snapshot-section">
                            <h4 className="text-base font-semibold mb-2">数据库快照</h4>
                            <div className="settings-table-shell" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>store</th>
                                            <th>size(bytes)</th>
                                            <th>updated_at</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(dbStatus.snapshots || []).length === 0 ? (
                                            <tr><td colSpan={3} className="text-center text-muted">暂无快照</td></tr>
                                        ) : (
                                            (dbStatus.snapshots || []).map((item) => (
                                                <tr key={item.store_key}>
                                                    <td data-label="Store">{item.store_key}</td>
                                                    <td data-label="大小">{item.payload_size || 0}</td>
                                                    <td data-label="更新时间">{formatDateTime(item.updated_at, locale)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
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
                        <div className="settings-summary-detail">{item.detail}</div>
                    </div>
                );})}
            </div>
        </div>
    );

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
                        <div className="settings-nav-bar">
                            <div className="settings-nav-list" role="tablist" aria-label="系统设置分区">
                                {SETTINGS_TAB_CONFIG.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = activeTab === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`settings-nav-item${isActive ? ' is-active' : ''}`}
                                            onClick={() => setActiveTab(item.id)}
                                            role="tab"
                                            aria-selected={isActive}
                                        >
                                            <span className="settings-nav-item-icon"><Icon /></span>
                                            <span className="settings-nav-item-copy">
                                                <span className="settings-nav-item-label">{item.label}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="settings-nav-side">
                                <div className="settings-nav-status-panel" aria-live="polite">
                                    <div className="settings-nav-status-main">
                                        <div className={`settings-nav-status-chip${saving ? ' is-saving' : settings ? ' is-ready' : ' is-loading'}`}>
                                            {saving ? <span className="spinner spinner-16" /> : null}
                                            <span>{saving ? '正在保存设置' : settings ? '配置已加载' : '正在加载配置'}</span>
                                        </div>
                                    </div>
                                    <div className="settings-nav-actions settings-panel-actions">
                                        <button className="btn btn-secondary btn-sm" onClick={refreshAllSections} disabled={loading}>
                                            重新加载
                                        </button>
                                        <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={loading || saving}>
                                            {saving ? <span className="spinner" /> : '保存配置'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="settings-main">
                        <div className="card settings-tab-hero">
                            <div className="settings-tab-hero-copy">
                                <div className="settings-tab-hero-eyebrow">{activeTabMeta.eyebrow}</div>
                                <div className="settings-tab-hero-title">{activeTabMeta.label}</div>
                                <div className="settings-tab-hero-summary">{activeTabMeta.summary}</div>
                            </div>
                            <div className="settings-tab-hero-grid">
                                {activeTabHighlights.map((item) => (
                                    <div key={`${activeTabMeta.id}-${item.label}`} className="settings-tab-highlight-card">
                                        <div className="settings-tab-highlight-label">{item.label}</div>
                                        <div className="settings-tab-highlight-value">{item.value}</div>
                                        <div className="settings-tab-highlight-detail">{item.detail}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="settings-tab-panel">
                            {activeTab === 'console' ? (
                                <div className="settings-console-host">
                                    <ServerManagement embedded />
                                </div>
                            ) : (
                                <fieldset className="settings-fieldset">
                                    {activeTab === 'status' ? renderStatusContent() : null}
                                    {activeTab === 'basic' ? renderBasicContent() : null}
                                    {activeTab === 'monitor' ? renderMonitorContent() : null}
                                    {activeTab === 'backup' ? renderBackupContent() : null}
                                    {activeTab === 'db' ? renderDatabaseContent() : null}
                                </fieldset>
                            )}
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
