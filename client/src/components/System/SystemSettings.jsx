import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Layout,
    Tabs,
    Card,
    Button,
    Input,
    Select,
    Switch,
    Form,
    Row,
    Col,
    Typography,
    Modal,
    Empty,
    Space,
    Descriptions,
    Tag,
    Badge,
    Alert,
    Progress,
    Table,
    Tooltip,
    Divider,
    Checkbox,
} from 'antd';
import {
    CloudOutlined,
    CloudUploadOutlined,
    CloudDownloadOutlined,
    DashboardOutlined,
    SettingOutlined,
    SafetyCertificateOutlined,
    HddOutlined,
    SyncOutlined,
    CopyOutlined,
    ExportOutlined,
    DeleteOutlined,
    EyeOutlined,
    MailOutlined,
    NotificationOutlined,
    ExclamationCircleOutlined,
    CheckCircleOutlined,
    RollbackOutlined,
    SaveOutlined,
} from '@ant-design/icons';
import {
    HiOutlineArrowDownTray,
    HiOutlineArrowUpTray,
    HiOutlineChartBarSquare,
    HiOutlineCloud,
    HiOutlineCog6Tooth,
    HiOutlineExclamationTriangle,
    HiOutlineServerStack,
    HiOutlineShieldCheck,
    HiOutlineXMark,
} from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { copyToClipboard, formatBytes, formatDateTime as formatDateTimeValue } from '../../utils/format.js';
import TaskProgressModal from '../Tasks/TaskProgressModal.jsx';
import SiteAccessDangerModal from './SiteAccessDangerModal.jsx';

const { Title, Text, Paragraph } = Typography;
const { Content, Sider } = Layout;

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
            sendDailyBackup: settings.telegram?.sendDailyBackup === true,
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

const DEFAULT_SETTINGS_TAB = 'status';

function buildSettingsWorkspaceConfig(t) {
    return [
        {
            key: 'status',
            label: t('pages.settings.tabStatus'),
            icon: <HiOutlineChartBarSquare />,
            routeTab: 'status',
        },
        {
            key: 'access',
            label: t('pages.settings.tabAccess'),
            icon: <HiOutlineCog6Tooth />,
            routeTab: 'access',
        },
        {
            key: 'policy',
            label: t('pages.settings.tabPolicy'),
            icon: <HiOutlineShieldCheck />,
            routeTab: 'policy',
        },
        {
            key: 'operations',
            label: t('pages.settings.tabNotify'),
            icon: <HiOutlineServerStack />,
            routeTab: 'monitor',
        },
        {
            key: 'backup',
            label: t('pages.settings.tabDb'),
            icon: <HiOutlineArrowDownTray />,
            routeTab: 'backup',
        },
    ];
}

const VALID_SETTINGS_TAB_IDS = new Set(['status', 'access', 'policy', 'db', 'backup', 'monitor']);

function resolveSettingsTab(value) {
    if (value === 'basic') return 'access';
    if (value === 'console') return 'monitor';
    return VALID_SETTINGS_TAB_IDS.has(value) ? value : DEFAULT_SETTINGS_TAB;
}

function resolveWorkspaceSection(value) {
    const normalized = resolveSettingsTab(value);
    if (normalized === 'status') return 'status';
    if (normalized === 'policy') return 'policy';
    if (normalized === 'db' || normalized === 'backup') return 'backup';
    if (normalized === 'monitor') return 'operations';
    return 'access';
}

function formatDateTime(value, locale = 'zh-CN') {
    if (!value) return locale === 'en-US' ? 'N/A' : '暂无';
    return formatDateTimeValue(value, locale);
}

function SettingsToggleCard({
    checked,
    onChange,
    disabled = false,
    label,
    description,
    activeLabel = '已开启',
    inactiveLabel = '已关闭',
    compact = false,
}) {
    return (
        <Card size="small" style={{ marginBottom: 12 }}>
            <Row align="middle" gutter={16}>
                <Col flex="auto">
                    <Text strong>{label}</Text>
                    {description && (
                        <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: '12px' }}>
                            {description}
                        </Paragraph>
                    )}
                </Col>
                <Col>
                    <Space>
                        {!compact && <Tag color={checked ? 'success' : 'default'}>{checked ? activeLabel : inactiveLabel}</Tag>}
                        <Switch checked={checked} onChange={(val) => onChange({ target: { checked: val } })} disabled={disabled} />
                    </Space>
                </Col>
            </Row>
        </Card>
    );
}

function formatInviteDuration(days) {
    const normalized = Math.max(0, Number(days) || 0);
    return normalized > 0 ? `${normalized} 天` : '不限时';
}

function getInviteStatusMeta(item = {}) {
    if (item.status === 'active') {
        return {
            color: 'success',
            label: Number(item.remainingUses || 0) > 0 ? '可使用' : '待检查',
        };
    }
    if (item.status === 'revoked') {
        return {
            color: 'error',
            label: '已撤销',
        };
    }
    return {
        color: 'default',
        label: '已用完',
    };
}

function areComparableSettingsEqual(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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
    const [dangerConfirmOpen, setDangerConfirmOpen] = useState(false);
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
    const [backupTelegramSending, setBackupTelegramSending] = useState(false);
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
    const [inviteLedgerExpanded, setInviteLedgerExpanded] = useState(false);
    const lazyLoadRef = useRef({
        settings: false,
        dbStatus: false,
        emailStatus: false,
        backupStatus: false,
        monitorStatus: false,
        registrationRuntime: false,
        inviteCodes: false,
    });

    const emailConfiguredLabel = emailStatus?.configured ? '已配置' : '未配置';
    const emailDeliveryLabel = emailStatus?.lastDelivery?.success === true
        ? '最近发送成功'
        : emailStatus?.lastDelivery?.success === false
            ? '最近发送失败'
            : '暂无发送记录';
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
    const savedSiteAccessPath = normalizeSiteAccessPathInput(settings?.site?.accessPath, '/');
    const savedCamouflageEnabled = settings?.site?.camouflageEnabled === true;
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
    const accessDangerState = useMemo(() => ({
        pathChanged: savedSiteAccessPath !== siteAccessPath,
        camouflageChanged: savedCamouflageEnabled !== (draft.site.camouflageEnabled === true),
        requiresConfirmation: savedSiteAccessPath !== siteAccessPath
            || savedCamouflageEnabled !== (draft.site.camouflageEnabled === true),
    }), [draft.site.camouflageEnabled, savedCamouflageEnabled, savedSiteAccessPath, siteAccessPath]);
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
        if (searchParams.get('tab') !== 'console') return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', 'monitor');
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

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

    const refreshStatusWorkspace = async () => {
        await Promise.all([
            fetchRegistrationRuntime(),
            fetchDbStatus({ quiet: true }),
            fetchEmailStatus({ quiet: true }),
            fetchBackupStatus({ quiet: true }),
            fetchMonitorStatus({ quiet: true }),
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

    const performSettingsSave = async () => {
        setSaving(true);
        try {
            const payload = buildDraft(draft);
            const res = await api.put('/system/settings', payload);
            const next = res.data?.obj || payload;
            setSettings(next);
            setDraft(buildDraft(next));
            setEditingTelegramChatId(false);
            setDangerConfirmOpen(false);
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

    const saveSettings = async () => {
        if (!isAdmin) return;
        if (accessDangerState.requiresConfirmation) {
            setDangerConfirmOpen(true);
            return;
        }

        const ok = await confirmAction({
            title: '保存系统设置',
            message: '确定应用当前系统参数吗？',
            details: '该操作会立即影响批量风控、任务分页和日志保留策略。',
            confirmText: '确认保存',
            tone: 'primary',
        });
        if (!ok) return;

        await performSettingsSave();
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
                setBackfillTaskId(obj.taskId);
                toast('回填任务已启动，请关注进度弹窗');
            } else {
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

    const sendBackupToTelegram = async () => {
        if (!isAdmin) return;
        setBackupTelegramSending(true);
        try {
            const res = await api.post('/system/backup/telegram');
            toast.success(res.data?.msg || '加密备份已发送到 Telegram');
            await Promise.all([
                fetchBackupStatus({ quiet: true }),
                fetchMonitorStatus({ quiet: true }),
            ]);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '发送 Telegram 备份失败');
        }
        setBackupTelegramSending(false);
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
    const lastTelegramBackup = backupStatus?.lastTelegramBackup || null;
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
    const registrationModeLabel = registrationEnabled
        ? (draft.registration.inviteOnlyEnabled ? '邀请注册' : '普通注册')
        : '已关闭注册';
    const camouflageStatusLabel = draft.site.camouflageEnabled ? '伪装首页已开启' : '伪装首页已关闭';
    const dbModeLabel = dbStatus
        ? `read=${dbStatus.currentModes?.readMode || 'file'} / write=${dbStatus.currentModes?.writeMode || 'file'}`
        : '等待探测';
    const dbConnectionLabel = dbStatus?.connection?.enabled
        ? (dbStatus?.connection?.ready ? '连接已就绪' : '连接未就绪')
        : '未启用';
    const dbQueueLabel = `queued ${dbStatus?.writesQueued || 0} · pending ${dbStatus?.pendingWrites || 0}`;
    const geoStatusLabel = draft.auditIpGeo.enabled ? '已启用' : '未启用';
    const overviewCards = useMemo(() => ([
        {
            title: '站点入口',
            value: siteAccessPath,
            detail: siteEntryPreview,
            tone: siteAccessPath === '/' ? 'warning' : 'success',
        },
        {
            title: '注册模式',
            value: registrationModeLabel,
            detail: camouflageStatusLabel,
            tone: registrationEnabled ? 'success' : 'neutral',
        },
        {
            title: '数据库模式',
            value: dbModeLabel,
            detail: `${dbConnectionLabel} · ${dbQueueLabel}`,
            tone: dbStatus?.connection?.ready ? 'success' : dbStatus?.connection?.enabled ? 'warning' : 'neutral',
        },
        {
            title: '告警与备份',
            value: `${readyAlertChainCount}/3 告警链路就绪`,
            detail: `${alertChainStates.join(' · ')} · ${backupSummaryValue}`,
            tone: readyAlertChainCount === 3 ? 'success' : readyAlertChainCount > 0 ? 'warning' : 'neutral',
        },
    ]), [
        backupSummaryValue,
        camouflageStatusLabel,
        dbConnectionLabel,
        dbModeLabel,
        dbQueueLabel,
        dbStatus,
        draft.registration.inviteOnlyEnabled,
        hasExportBackup,
        hasLocalBackup,
        registrationModeLabel,
        registrationEnabled,
        siteAccessPath,
        siteEntryPreview,
        readyAlertChainCount,
        alertChainStates,
    ]);
    const policyHighlights = useMemo(() => ([
        {
            label: '高风险确认',
            value: draft.security.requireHighRiskConfirmation ? '已开启' : '未开启',
            detail: `令牌有效期 ${draft.security.riskTokenTtlSeconds} 秒`,
        },
        {
            label: '风险阈值',
            value: `中 ${draft.security.mediumRiskMinTargets} / 高 ${draft.security.highRiskMinTargets}`,
            detail: '超过阈值时会进入更严格的确认流程。',
        },
        {
            label: '审计留存',
            value: `${draft.audit.retentionDays} 天`,
            detail: `单页最多 ${draft.audit.maxPageSize} 条`,
        },
        {
            label: '归属地增强',
            value: geoStatusLabel,
            detail: `${draft.auditIpGeo.provider || 'ip_api'} · TTL ${draft.auditIpGeo.cacheTtlSeconds} 秒`,
        },
    ]), [
        draft.audit.maxPageSize,
        draft.audit.retentionDays,
        draft.auditIpGeo.cacheTtlSeconds,
        draft.auditIpGeo.provider,
        draft.security.highRiskMinTargets,
        draft.security.mediumRiskMinTargets,
        draft.security.requireHighRiskConfirmation,
        draft.security.riskTokenTtlSeconds,
        geoStatusLabel,
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

    const renderAccessContent = () => (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card
                title={<Title level={4} style={{ margin: 0 }}>入口与订阅</Title>}
                extra={
                    <Space>
                        <Button
                            icon={<CopyOutlined />}
                            onClick={() => {
                                copyToClipboard(siteEntryPreview);
                                toast.success('入口地址已复制到剪贴板');
                            }}
                        >
                            复制入口
                        </Button>
                        <Button icon={<EyeOutlined />} href={siteEntryPreview} target="_blank">
                            打开预览
                        </Button>
                    </Space>
                }
            >
                <Row gutter={[32, 32]}>
                    <Col xs={24} md={12}>
                        <Title level={5}>访问路径</Title>
                        <Form layout="vertical">
                            <Form.Item label="首页访问路径">
                                <Space.Compact style={{ width: '100%' }}>
                                    <Input
                                        className="font-mono"
                                        placeholder="/"
                                        value={draft.site.accessPath}
                                        onChange={(e) => patchField('site', 'accessPath', e.target.value)}
                                    />
                                    <Button onClick={applyRandomSiteAccessPath}>随机路径</Button>
                                </Space.Compact>
                            </Form.Item>
                            <Form.Item label="生成后的访问地址">
                                <Input className="font-mono" value={siteEntryPreview} readOnly />
                            </Form.Item>
                        </Form>
                        <Divider style={{ margin: '16px 0' }} />
                        <Title level={5}>伪装页面</Title>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item label="伪装模板">
                                    <Select
                                        value={draft.site.camouflageTemplate}
                                        onChange={(val) => patchField('site', 'camouflageTemplate', val)}
                                        options={CAMOUFLAGE_TEMPLATE_OPTIONS}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="伪装站点标题">
                                    <Input
                                        value={draft.site.camouflageTitle}
                                        onChange={(e) => patchField('site', 'camouflageTitle', e.target.value)}
                                        placeholder="Edge Precision Systems"
                                    />
                                </Form.Item>
                            </Col>
                        </Row>
                        <SettingsToggleCard
                            compact
                            checked={draft.site.camouflageEnabled}
                            onChange={(e) => handleCamouflageToggle(e.target.checked)}
                            label="站点伪装首页"
                            description="开启后首页和错误路径展示公开首页。"
                        />
                    </Col>
                    <Col xs={24} md={12}>
                        <Title level={5}>订阅公网地址</Title>
                        <Form.Item label="订阅公网地址" extra="留空时默认按当前站点地址分发订阅。">
                            <Input
                                placeholder="https://nms.example.com"
                                value={draft.subscription.publicBaseUrl}
                                onChange={(e) => patchField('subscription', 'publicBaseUrl', e.target.value)}
                            />
                        </Form.Item>
                        <Divider style={{ margin: '16px 0' }} />
                        <Title level={5}>外部转换器</Title>
                        <Form.Item label="外部订阅转换器地址" extra="留空则不启用外部转换器。">
                            <Input
                                placeholder="https://converter.example.com"
                                value={converterBaseUrl}
                                onChange={(e) => patchField('subscription', 'converterBaseUrl', e.target.value)}
                            />
                        </Form.Item>
                        <Space>
                            <Button
                                disabled={!converterBaseUrl}
                                onClick={() => patchField('subscription', 'converterBaseUrl', '')}
                            >
                                清空
                            </Button>
                            <Button
                                icon={<ExportOutlined />}
                                href={converterBaseUrl || undefined}
                                target="_blank"
                                disabled={!converterBaseUrl}
                            >
                                打开链接
                            </Button>
                        </Space>
                    </Col>
                </Row>
            </Card>

            <Card
                title={<Title level={4} style={{ margin: 0 }}>注册与邀请码</Title>}
                extra={
                    <Button
                        icon={<SyncOutlined spin={inviteCodesLoading} />}
                        onClick={() => fetchInviteCodes()}
                        disabled={inviteCodesLoading || inviteCodeActionLoading}
                    >
                        刷新邀请码
                    </Button>
                }
            >
                <Row gutter={[32, 32]}>
                    <Col xs={24} md={12}>
                        <Title level={5}>注册模式</Title>
                        <SettingsToggleCard
                            compact
                            checked={draft.registration.inviteOnlyEnabled}
                            onChange={(e) => patchField('registration', 'inviteOnlyEnabled', e.target.checked)}
                            disabled={!registrationEnabled}
                            label="开启邀请注册"
                            description={registrationEnabled ? '开启后注册需填写邀请码。' : '当前环境已关闭自助注册。'}
                            activeLabel="邀请模式"
                            inactiveLabel="普通模式"
                        />
                        <Card size="small" title="生成邀请码" style={{ marginTop: 24 }}>
                            <Row gutter={16}>
                                <Col span={8}>
                                    <Form.Item label="本次数量">
                                        <Input
                                            type="number"
                                            value={inviteGenerationDraft.count}
                                            onChange={(e) => setInviteGenerationDraft(p => ({ ...p, count: e.target.value }))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item label="可用次数">
                                        <Input
                                            type="number"
                                            value={inviteGenerationDraft.usageLimit}
                                            onChange={(e) => setInviteGenerationDraft(p => ({ ...p, usageLimit: e.target.value }))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item label="时长 (天)">
                                        <Input
                                            type="number"
                                            value={inviteGenerationDraft.subscriptionDays}
                                            onChange={(e) => setInviteGenerationDraft(p => ({ ...p, subscriptionDays: e.target.value }))}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                            <Button
                                type="primary"
                                block
                                onClick={createInviteCode}
                                loading={inviteCodeActionKey === 'create'}
                            >
                                生成邀请码
                            </Button>
                        </Card>

                        {latestInviteCodes.length > 0 && (
                            <Card size="small" title="本次生成的邀请码" style={{ marginTop: 16 }}>
                                <Paragraph type="secondary" style={{ fontSize: '12px' }}>
                                    {latestInviteBatch.count || latestInviteCodes.length} 个邀请码，每个可用 {latestInviteBatch.usageLimit || 1} 次，开通 {formatInviteDuration(latestInviteBatch.subscriptionDays)}
                                </Paragraph>
                                <div style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                                    {latestInviteCodes.map(code => <Tag key={code} className="font-mono">{code}</Tag>)}
                                </div>
                                <Button
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => {
                                        copyToClipboard(latestInviteCodes.join('\n'));
                                        toast.success('邀请码已复制');
                                    }}
                                >
                                    复制全部
                                </Button>
                            </Card>
                        )}
                    </Col>
                    <Col xs={24} md={12}>
                        <Title level={5}>台账与使用记录</Title>
                        <Paragraph type="secondary">
                            活动 {inviteAvailableRecords.length} 个 · 剩余 {inviteRemainingUses} 次 · 已用尽 {inviteUsedCount} 个 · 已撤销 {inviteRevokedCount} 个。
                        </Paragraph>
                        <Button
                            onClick={() => setInviteLedgerExpanded(!inviteLedgerExpanded)}
                            style={{ marginBottom: 16 }}
                        >
                            {inviteLedgerExpanded ? '收起台账' : '展开台账'}
                        </Button>
                        {inviteLedgerExpanded && (
                            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                {inviteRecords.map(item => {
                                    const meta = getInviteStatusMeta(item);
                                    const usageLimit = Math.max(1, Number(item.usageLimit || 1));
                                    const usedCount = Math.max(0, Number(item.usedCount || 0));
                                    const percent = Math.min(100, Math.round((usedCount / usageLimit) * 100));
                                    return (
                                        <Card size="small" key={item.id} style={{ marginBottom: 8 }}>
                                            <Row justify="space-between" align="middle">
                                                <Col>
                                                    <Text strong className="font-mono">{item.preview || item.id}</Text>
                                                    <br />
                                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                                        {formatDateTime(item.createdAt, locale)}
                                                    </Text>
                                                </Col>
                                                <Col><Tag color={meta.color}>{meta.label}</Tag></Col>
                                            </Row>
                                            <div style={{ marginTop: 8 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                                    <span>已用 {usedCount} / {usageLimit}</span>
                                                    <span>剩余 {item.remainingUses || 0}</span>
                                                </div>
                                                <Progress percent={percent} size="small" showInfo={false} />
                                            </div>
                                            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                                                <Descriptions.Item label="开通时长">{formatInviteDuration(item.subscriptionDays)}</Descriptions.Item>
                                                <Descriptions.Item label="最近使用">{item.usedAt ? formatDateTime(item.usedAt, locale) : '未使用'}</Descriptions.Item>
                                            </Descriptions>
                                            {item.status === 'active' && (
                                                <Button
                                                    size="small"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    loading={inviteCodeActionKey === `revoke:${item.id}`}
                                                    onClick={() => revokeInviteCode(item)}
                                                    style={{ marginTop: 8 }}
                                                >
                                                    撤销
                                                </Button>
                                            )}
                                        </Card>
                                    );
                                })}
                                {inviteRecords.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                            </div>
                        )}
                    </Col>
                </Row>
            </Card>
        </Space>
    );

    const renderPolicyContent = () => (
        <Card title={<Title level={4} style={{ margin: 0 }}>风控、审计与归属地</Title>}>
            <Row gutter={[32, 32]}>
                <Col xs={24} md={12}>
                    <Title level={5}>风控策略</Title>
                    <SettingsToggleCard
                        compact
                        checked={draft.security.requireHighRiskConfirmation}
                        onChange={(e) => patchField('security', 'requireHighRiskConfirmation', e.target.checked)}
                        label="高风险操作二次确认"
                        description="达到高风险阈值后执行前必须再次确认。"
                    />
                    <Form layout="vertical">
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item label="中风险阈值">
                                    <Input type="number" value={draft.security.mediumRiskMinTargets} onChange={e => patchField('security', 'mediumRiskMinTargets', toInt(e.target.value, 20))} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="高风险阈值">
                                    <Input type="number" value={draft.security.highRiskMinTargets} onChange={e => patchField('security', 'highRiskMinTargets', toInt(e.target.value, 100))} />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Form.Item label="确认令牌有效期 (秒)">
                            <Input type="number" value={draft.security.riskTokenTtlSeconds} onChange={e => patchField('security', 'riskTokenTtlSeconds', toInt(e.target.value, 180))} />
                        </Form.Item>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item label="审计保留天数">
                                    <Input type="number" value={draft.audit.retentionDays} onChange={e => patchField('audit', 'retentionDays', toInt(e.target.value, 365))} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="审计分页最大条数">
                                    <Input type="number" value={draft.audit.maxPageSize} onChange={e => patchField('audit', 'maxPageSize', toInt(e.target.value, 200))} />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Col>
                <Col xs={24} md={12}>
                    <Title level={5}>归属地增强</Title>
                    <SettingsToggleCard
                        compact
                        checked={draft.auditIpGeo.enabled}
                        onChange={(e) => patchField('auditIpGeo', 'enabled', e.target.checked)}
                        label="归属地查询"
                        description="为订阅访问和安全事件补充地区与运营商。"
                    />
                    <Form layout="vertical">
                        <Form.Item label="Provider">
                            <Input value={draft.auditIpGeo.provider} onChange={e => patchField('auditIpGeo', 'provider', e.target.value)} placeholder="ip_api" />
                        </Form.Item>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item label="超时 (毫秒)">
                                    <Input type="number" value={draft.auditIpGeo.timeoutMs} onChange={e => patchField('auditIpGeo', 'timeoutMs', toInt(e.target.value, 1500))} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item label="缓存 TTL (秒)">
                                    <Input type="number" value={draft.auditIpGeo.cacheTtlSeconds} onChange={e => patchField('auditIpGeo', 'cacheTtlSeconds', toInt(e.target.value, 21600))} />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Form.Item label="查询端点">
                            <Input className="font-mono" value={draft.auditIpGeo.endpoint} onChange={e => patchField('auditIpGeo', 'endpoint', e.target.value)} />
                        </Form.Item>
                    </Form>
                </Col>
            </Row>
        </Card>
    );

    const renderMonitorContent = () => (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card title={<Title level={4} style={{ margin: 0 }}>运维动作</Title>}>
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={8}>
                        <Card size="small" title="邮件链路" extra={<Tag color={emailStatus?.configured ? 'success' : 'warning'}>{emailConfiguredLabel}</Tag>}>
                            <Paragraph type="secondary" style={{ fontSize: '12px' }}>先验证 SMTP 配置和邮件链路，再执行通知发送。</Paragraph>
                            <Descriptions size="small" column={1}>
                                <Descriptions.Item label="连接验证">{emailVerificationLabel}</Descriptions.Item>
                                <Descriptions.Item label="最近发送">{emailDeliveryLabel}</Descriptions.Item>
                            </Descriptions>
                            <Button
                                block
                                icon={<NotificationOutlined />}
                                onClick={testEmailConnection}
                                loading={emailTestLoading}
                                disabled={emailStatusLoading}
                                style={{ marginTop: 16 }}
                            >
                                测试 SMTP
                            </Button>
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card size="small" title="变更通知" extra={<Tag color={emailStatus?.configured ? 'processing' : 'warning'}>{emailStatus?.configured ? '可发送' : '待配置 SMTP'}</Tag>}>
                            <Paragraph type="secondary" style={{ fontSize: '12px' }}>向用户发送最新地址或订阅变更提醒。</Paragraph>
                            <Descriptions size="small" column={1}>
                                <Descriptions.Item label="发送范围">注册用户</Descriptions.Item>
                                <Descriptions.Item label="当前入口">{siteAccessPath}</Descriptions.Item>
                            </Descriptions>
                            <Button
                                block
                                icon={<MailOutlined />}
                                onClick={openNoticeModal}
                                disabled={!emailStatus?.configured || noticeSending}
                                style={{ marginTop: 16 }}
                            >
                                发变更通知
                            </Button>
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card size="small" title="节点巡检" extra={<Tag color={monitorIncidentCount > 0 ? 'warning' : 'success'}>{monitorIncidentCount > 0 ? '有异常' : '状态平稳'}</Tag>}>
                            <Paragraph type="secondary" style={{ fontSize: '12px' }}>手动执行节点健康巡检。</Paragraph>
                            <Row gutter={8} style={{ textAlign: 'center', marginBottom: 16 }}>
                                <Col span={8}><Text type="secondary" style={{ fontSize: '10px' }}>健康</Text><br /><Text strong>{monitorHealthyCount}</Text></Col>
                                <Col span={8}><Text type="secondary" style={{ fontSize: '10px' }}>异常</Text><br /><Text strong>{monitorIncidentCount}</Text></Col>
                                <Col span={8}><Text type="secondary" style={{ fontSize: '10px' }}>未读</Text><br /><Text strong>{monitorUnreadCount}</Text></Col>
                            </Row>
                            <Button
                                type="primary"
                                block
                                icon={<DashboardOutlined />}
                                onClick={runMonitorCheck}
                                loading={monitorLoading}
                            >
                                立即巡检
                            </Button>
                        </Card>
                    </Col>
                </Row>
            </Card>

            <Card
                title={<Title level={4} style={{ margin: 0 }}>Telegram 机器人</Title>}
                extra={
                    <Button
                        icon={<NotificationOutlined />}
                        onClick={testTelegramAlert}
                        loading={telegramTestLoading}
                        disabled={!draft.telegram.enabled}
                    >
                        发送测试通知
                    </Button>
                }
            >
                <Form layout="vertical">
                    <Row gutter={24}>
                        <Col xs={24} md={12} lg={6}>
                            <Form.Item label="Chat ID / 群组 ID">
                                <Space.Compact style={{ width: '100%' }}>
                                    <Input
                                        className={shouldMaskTelegramChatId ? 'font-mono' : 'font-mono'}
                                        value={shouldMaskTelegramChatId ? telegramMaskedDisplayValue : draft.telegram.chatId}
                                        onChange={shouldMaskTelegramChatId ? undefined : e => patchField('telegram', 'chatId', e.target.value)}
                                        readOnly={shouldMaskTelegramChatId}
                                    />
                                    {hasSavedTelegramChatId && (
                                        <Button onClick={() => setEditingTelegramChatId(!editingTelegramChatId)}>
                                            {editingTelegramChatId ? '完成' : '修改'}
                                        </Button>
                                    )}
                                </Space.Compact>
                                <Text type="secondary" style={{ fontSize: '11px' }}>{telegramChatIdHint}</Text>
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12} lg={6}>
                            <Form.Item label="Bot Token">
                                <Input.Password
                                    value={draft.telegram.botToken}
                                    onChange={e => patchTelegramToken(e.target.value)}
                                    placeholder={settings?.telegram?.botTokenConfigured ? `已保存 ${settings.telegram.botTokenPreview}` : '123456:ABC...'}
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                                    <Text type="secondary" style={{ fontSize: '11px' }}>
                                        {draft.telegram.clearBotToken ? '保存会清空 Token' : '留空继续使用当前 Token'}
                                    </Text>
                                    {settings?.telegram?.botTokenConfigured && (
                                        <Button type="link" size="small" onClick={clearSavedTelegramToken} style={{ padding: 0 }}>清空已保存</Button>
                                    )}
                                </div>
                            </Form.Item>
                        </Col>
                        <Col xs={12} lg={6}>
                            <Form.Item label="运维汇总间隔 (分)">
                                <Input type="number" value={draft.telegram.opsDigestIntervalMinutes} onChange={e => patchField('telegram', 'opsDigestIntervalMinutes', toBoundedInt(e.target.value, 30, 0, 1440))} />
                            </Form.Item>
                        </Col>
                        <Col xs={12} lg={6}>
                            <Form.Item label="日报间隔 (时)">
                                <Input type="number" value={draft.telegram.dailyDigestIntervalHours} onChange={e => patchField('telegram', 'dailyDigestIntervalHours', toBoundedInt(e.target.value, 24, 0, 168))} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
                <Divider />
                <Row gutter={16}>
                    <Col xs={24} sm={12} lg={8}>
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.enabled}
                            onChange={e => patchField('telegram', 'enabled', e.target.checked)}
                            label="启用 Telegram 告警"
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={8}>
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.commandMenuEnabled}
                            onChange={e => patchField('telegram', 'commandMenuEnabled', e.target.checked)}
                            label="Telegram 命令菜单"
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={8}>
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendDailyBackup}
                            onChange={e => patchField('telegram', 'sendDailyBackup', e.target.checked)}
                            label="每日备份到 Telegram"
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={8}>
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendSystemStatus}
                            onChange={e => patchField('telegram', 'sendSystemStatus', e.target.checked)}
                            label="系统状态推送"
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={8}>
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendSecurityAudit}
                            onChange={e => patchField('telegram', 'sendSecurityAudit', e.target.checked)}
                            label="审计告警推送"
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={8}>
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendEmergencyAlerts}
                            onChange={e => patchField('telegram', 'sendEmergencyAlerts', e.target.checked)}
                            label="紧急告警推送"
                        />
                    </Col>
                </Row>
            </Card>
        </Space>
    );

    const renderBackupContent = ({ compact = false } = {}) => (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card
                title={<Title level={4} style={{ margin: 0 }}>备份与恢复</Title>}
                extra={<Button icon={<SyncOutlined spin={backupStatusLoading} />} onClick={() => fetchBackupStatus()}>刷新状态</Button>}
            >
                <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" hoverable onClick={exportBackup} style={{ textAlign: 'center', cursor: 'pointer' }}>
                            <CloudDownloadOutlined style={{ fontSize: 24, color: '#1677ff' }} />
                            <Title level={5} style={{ marginTop: 8 }}>导出到浏览器</Title>
                            <Text type="secondary" style={{ fontSize: '12px' }}>下载加密备份包</Text>
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" hoverable onClick={saveBackupLocally} style={{ textAlign: 'center', cursor: 'pointer' }}>
                            <SafetyCertificateOutlined style={{ fontSize: 24, color: '#52c41a' }} />
                            <Title level={5} style={{ marginTop: 8 }}>保存到服务器</Title>
                            <Text type="secondary" style={{ fontSize: '12px' }}>本机留存加密备份</Text>
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" hoverable onClick={sendBackupToTelegram} style={{ textAlign: 'center', cursor: 'pointer', opacity: draft.telegram.enabled ? 1 : 0.5 }}>
                            <CloudOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                            <Title level={5} style={{ marginTop: 8 }}>发送到 Telegram</Title>
                            <Text type="secondary" style={{ fontSize: '12px' }}>发送到已配机器人</Text>
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" hoverable onClick={() => { setBackupRestoreModalOpen(true); setBackupRestoreConfirmed(false); }} style={{ textAlign: 'center', cursor: 'pointer' }}>
                            <CloudUploadOutlined style={{ fontSize: 24, color: '#ff4d4f' }} />
                            <Title level={5} style={{ marginTop: 8 }}>从文件恢复</Title>
                            <Text type="secondary" style={{ fontSize: '12px' }}>上传备份包恢复</Text>
                        </Card>
                    </Col>
                </Row>

                <Row gutter={16} style={{ marginTop: 24 }}>
                    <Col xs={24} lg={12}>
                        <Card size="small" title="Telegram 备份状态" extra={<Tag color={lastTelegramBackup?.status === 'failed' ? 'error' : 'processing'}>{lastTelegramBackup?.status === 'failed' ? '最近发送失败' : lastTelegramBackup?.ts ? '最近已发送' : '暂无记录'}</Tag>}>
                            <Paragraph style={{ marginBottom: 0 }}>
                                {lastTelegramBackup?.ts ? `${formatDateTime(lastTelegramBackup.ts, locale)} · ${lastTelegramBackup.filename || '未记录文件名'}` : '还没有 Telegram 备份记录。'}
                            </Paragraph>
                            {lastTelegramBackup?.error && <Text type="danger" style={{ fontSize: '12px' }}>{lastTelegramBackup.error}</Text>}
                        </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Card size="small" title="服务器本机加密备份" extra={<Badge count={localBackups.length} showZero color="#999" />}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>保存目录: {backupStatus?.localBackupDir || '-'}</Text>
                        </Card>
                    </Col>
                </Row>

                <div style={{ marginTop: 16 }}>
                    {localBackups.length === 0 ? (
                        <Empty description="暂无本机备份记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                        <Table
                            size="small"
                            dataSource={localBackups}
                            pagination={false}
                            rowKey="filename"
                            columns={[
                                { title: '文件名', dataIndex: 'filename', className: 'font-mono' },
                                { title: '备份时间', dataIndex: 'createdAt', render: v => formatDateTime(v, locale) },
                                { title: '大小', dataIndex: 'bytes', render: v => formatBytes(v) },
                                {
                                    title: '操作',
                                    key: 'actions',
                                    render: (_, item) => (
                                        <Space>
                                            <Tooltip title="下载"><Button size="small" icon={<CloudDownloadOutlined />} onClick={() => downloadLocalBackup(item.filename)} loading={backupLocalActionKey === `download:${item.filename}`} /></Tooltip>
                                            <Tooltip title="恢复"><Button size="small" icon={<SyncOutlined />} onClick={() => restoreLocalBackup(item.filename)} loading={backupLocalActionKey === `restore:${item.filename}`} /></Tooltip>
                                            <Tooltip title="删除"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteLocalBackup(item.filename)} loading={backupLocalActionKey === `delete:${item.filename}`} /></Tooltip>
                                        </Space>
                                    )
                                }
                            ]}
                        />
                    )}
                </div>
            </Card>
        </Space>
    );

    const renderDatabaseContent = ({ compact = false } = {}) => (
        <Card
            title={<Title level={4} style={{ margin: 0 }}>数据库读写模式</Title>}
            extra={<Button icon={<SyncOutlined spin={dbLoading} />} onClick={() => fetchDbStatus()}>刷新状态</Button>}
        >
            <Paragraph type="secondary">切换数据库读写策略，或把现有 Store 数据回填到数据库。</Paragraph>
            {!dbStatus ? <Empty description="未加载数据库状态" /> : (
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={12}>
                        <Card size="small" title="切换读写模式" style={{ height: '100%' }}>
                            <Form layout="vertical">
                                <Form.Item label="读取模式">
                                    <Select
                                        value={dbModeDraft.readMode}
                                        onChange={v => setDbModeDraft(p => ({ ...p, readMode: v }))}
                                        options={(dbStatus.supportedModes?.readModes || ['file', 'db']).map(m => ({ label: m, value: m }))}
                                    />
                                </Form.Item>
                                <Form.Item label="写入模式">
                                    <Select
                                        value={dbModeDraft.writeMode}
                                        onChange={v => setDbModeDraft(p => ({ ...p, writeMode: v }))}
                                        options={(dbStatus.supportedModes?.writeModes || ['file', 'dual', 'db']).map(m => ({ label: m, value: m }))}
                                    />
                                </Form.Item>
                                <Form.Item>
                                    <Checkbox checked={dbModeDraft.hydrateOnReadDb} onChange={e => setDbModeDraft(p => ({ ...p, hydrateOnReadDb: e.target.checked }))}>
                                        read=db 时同步加载到内存缓存
                                    </Checkbox>
                                </Form.Item>
                                <Button type="primary" onClick={switchDbMode} loading={dbSwitchLoading} disabled={!dbStatus.connection?.enabled}>
                                    应用模式
                                </Button>
                            </Form>
                        </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Card size="small" title="Store 回填到数据库" style={{ height: '100%' }}>
                            <Form layout="vertical">
                                <Form.Item label="数据键 (逗号分隔，留空为全部)">
                                    <Input value={dbBackfillDraft.keysText} onChange={e => setDbBackfillDraft(p => ({ ...p, keysText: e.target.value }))} placeholder={(dbStatus.storeKeys || []).join(', ')} />
                                </Form.Item>
                                <Form.Item>
                                    <Space>
                                        <Checkbox checked={dbBackfillDraft.dryRun} onChange={e => setDbBackfillDraft(p => ({ ...p, dryRun: e.target.checked }))}>仅预演</Checkbox>
                                        <Checkbox checked={dbBackfillDraft.redact} onChange={e => setDbBackfillDraft(p => ({ ...p, redact: e.target.checked }))}>脱敏写入</Checkbox>
                                    </Space>
                                </Form.Item>
                                <Button danger={!dbBackfillDraft.dryRun} onClick={runDbBackfill} loading={dbBackfillLoading} disabled={!dbStatus.connection?.enabled}>
                                    {dbBackfillDraft.dryRun ? '执行预演' : '执行回填'}
                                </Button>
                                {dbBackfillResult && (
                                    <div style={{ marginTop: 12 }}>
                                        <Text type="secondary">总计 {dbBackfillResult.total || 0} · 成功 {dbBackfillResult.success || 0} · 失败 {dbBackfillResult.failed || 0}</Text>
                                    </div>
                                )}
                            </Form>
                        </Card>
                    </Col>
                </Row>
            )}
        </Card>
    );

    const renderStatusContent = () => (
        <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
                <Card
                    title="通知与巡检状态"
                    extra={<Button size="small" onClick={refreshStatusWorkspace} loading={dbLoading || emailStatusLoading || backupStatusLoading || monitorStatusLoading}>刷新概览</Button>}
                >
                    <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="SMTP">{emailConfiguredLabel} · {emailDeliveryLabel}</Descriptions.Item>
                        <Descriptions.Item label="最近测试">{emailVerificationLabel} · {formatDateTime(emailStatus?.lastVerification?.ts, locale)}</Descriptions.Item>
                        <Descriptions.Item label="节点巡检">{monitorStatus?.healthMonitor?.running ? '运行中' : '未运行'} (正常 {monitorHealthyCount} / 异常 {monitorIncidentCount})</Descriptions.Item>
                        <Descriptions.Item label="异常分布">{monitorReasonSummary}</Descriptions.Item>
                        <Descriptions.Item label="通知中心">未读 {monitorUnreadCount} · DB 连续失败 {monitorStatus?.dbAlerts?.consecutiveFailures || 0}</Descriptions.Item>
                        <Descriptions.Item label="Telegram">{monitorStatus?.telegram?.enabled ? `已启用${telegramTargetPreview !== '-' ? ` · ${telegramTargetPreview}` : ''}` : '未启用'}</Descriptions.Item>
                    </Descriptions>
                </Card>
            </Col>
            <Col xs={24} lg={12}>
                <Card title="数据库与备份状态">
                    <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="DB 连接">{dbStatus?.connection?.enabled ? (dbStatus?.connection?.ready ? '已就绪' : '未就绪') : '未启用'}</Descriptions.Item>
                        <Descriptions.Item label="当前模式">{dbStatus ? `read=${dbStatus.currentModes?.readMode} / write=${dbStatus.currentModes?.writeMode}` : '等待探测'}</Descriptions.Item>
                        <Descriptions.Item label="写入排队">queued {dbStatus?.writesQueued || 0} · pending {dbStatus?.pendingWrites || 0}</Descriptions.Item>
                        <Descriptions.Item label="备份状态">{backupSummaryValue}</Descriptions.Item>
                        <Descriptions.Item label="本机备份">{localBackups.length} 份 · {latestLocalBackup?.filename || '暂无'}</Descriptions.Item>
                        <Descriptions.Item label="最近恢复">{backupStatus?.lastImport?.sourceFilename || '暂无'} ({formatDateTime(backupStatus?.lastImport?.restoredAt, locale)})</Descriptions.Item>
                    </Descriptions>
                </Card>
            </Col>
        </Row>
    );

    const tabItems = [
        {
            key: 'status',
            label: <span><DashboardOutlined /> {t('pages.settings.tabStatus')}</span>,
            children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <Row gutter={16}>
                        {overviewCards.map(c => (
                            <Col xs={24} sm={12} lg={6} key={c.title}>
                                <Card size="small">
                                    <Text type="secondary" style={{ fontSize: '12px' }}>{c.title}</Text>
                                    <Title level={4} style={{ margin: '4px 0' }} type={c.tone === 'success' ? 'success' : c.tone === 'warning' ? 'warning' : undefined}>{c.value}</Title>
                                    <Text type="secondary" style={{ fontSize: '11px' }} ellipsis title={c.detail}>{c.detail}</Text>
                                </Card>
                            </Col>
                        ))}
                    </Row>
                    {renderStatusContent()}
                </Space>
            ),
        },
        {
            key: 'access',
            label: <span><SettingOutlined /> {t('pages.settings.tabAccess')}</span>,
            children: renderAccessContent(),
        },
        {
            key: 'policy',
            label: <span><SafetyCertificateOutlined /> {t('pages.settings.tabPolicy')}</span>,
            children: renderPolicyContent(),
        },
        {
            key: 'monitor',
            label: <span><NotificationOutlined /> {t('pages.settings.tabNotify')}</span>,
            children: renderMonitorContent(),
        },
        {
            key: 'backup',
            label: <span><HddOutlined /> {t('pages.settings.tabDb')}</span>,
            children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    {renderDatabaseContent()}
                    {renderBackupContent()}
                </Space>
            ),
        },
    ];

    if (!isAdmin) {
        return (
            <>
                <Header title={t('pages.settings.title')} eyebrow={t('pages.settings.eyebrow')} />
                <Content style={{ padding: '24px' }}>
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<Title level={4}>仅管理员可访问系统设置</Title>}
                    >
                        <Paragraph type="secondary">请使用管理员账号登录后再修改系统参数、备份或监控配置。</Paragraph>
                    </Empty>
                </Content>
            </>
        );
    }

    return (
        <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
            <Header title={t('pages.settings.title')} eyebrow={t('pages.settings.eyebrow')} />
            <Content style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
                <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                    <Tabs
                        activeKey={activeWorkspaceSectionId === 'operations' ? 'monitor' : activeWorkspaceSectionId}
                        onChange={setRequestedView}
                        items={tabItems}
                        size="large"
                    />
                </div>

                <div style={{ position: 'sticky', bottom: 24, marginTop: 32, zIndex: 100 }}>
                    <Card size="small" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
                        <Row align="middle" justify="space-between">
                            <Col>
                                <Space>
                                    <Badge status={saving ? 'processing' : loading ? 'default' : hasPendingChanges ? 'warning' : 'success'} />
                                    <Text strong>
                                        {saving ? '正在保存设置...' : loading ? '正在加载配置...' : hasPendingChanges ? '有未保存更改' : '配置已同步'}
                                    </Text>
                                    {hasPendingChanges && <Tag color="warning">{dirtyWorkspaceCount} 个工作区待保存</Tag>}
                                </Space>
                            </Col>
                            <Col>
                                <Space>
                                    {hasPendingChanges && (
                                        <Button icon={<RollbackOutlined />} onClick={resetPendingChanges} disabled={saving}>恢复更改</Button>
                                    )}
                                    <Button type="primary" icon={<SaveOutlined />} onClick={saveSettings} loading={saving} disabled={!hasPendingChanges}>
                                        保存设置
                                    </Button>
                                </Space>
                            </Col>
                        </Row>
                    </Card>
                </div>
            </Content>

            <SiteAccessDangerModal
                open={dangerConfirmOpen}
                previousPath={savedSiteAccessPath}
                nextPath={siteAccessPath}
                previousCamouflageEnabled={savedCamouflageEnabled}
                nextCamouflageEnabled={draft.site.camouflageEnabled === true}
                onClose={() => setDangerConfirmOpen(false)}
                onConfirm={performSettingsSave}
                saving={saving}
            />

            <Modal
                title="发送注册用户变更通知"
                open={noticeModalOpen}
                onCancel={() => setNoticeModalOpen(false)}
                width={1000}
                footer={[
                    <Button key="cancel" onClick={() => setNoticeModalOpen(false)}>取消</Button>,
                    <Button key="send" type="primary" onClick={sendRegisteredUserNotice} loading={noticeSending} disabled={!emailStatus?.configured}>开始发送</Button>
                ]}
            >
                <Paragraph type="secondary" style={{ fontSize: '12px' }}>
                    该功能会按单个收件人逐封发送邮件。默认覆盖所有有邮箱地址的用户。
                </Paragraph>
                <Row gutter={24}>
                    <Col span={12}>
                        <Form layout="vertical">
                            <Form.Item label="通知主题">
                                <Input value={noticeDraft.subject} onChange={e => setNoticeDraft(p => ({ ...p, subject: e.target.value }))} />
                            </Form.Item>
                            <Form.Item label="发送范围">
                                <Select value={noticeDraft.scope} onChange={v => setNoticeDraft(p => ({ ...p, scope: v }))}>
                                    <Select.Option value="all">全部有邮箱的注册用户</Select.Option>
                                    <Select.Option value="verified">仅已验证邮箱用户</Select.Option>
                                </Select>
                            </Form.Item>
                            <Form.Item label="通知内容">
                                <Input.TextArea rows={6} value={noticeDraft.message} onChange={e => setNoticeDraft(p => ({ ...p, message: e.target.value }))} />
                            </Form.Item>
                            <Row gutter={16}>
                                <Col span={12}>
                                    <Form.Item label="按钮地址">
                                        <Input value={noticeDraft.actionUrl} onChange={e => setNoticeDraft(p => ({ ...p, actionUrl: e.target.value }))} />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item label="按钮文案">
                                        <Input value={noticeDraft.actionLabel} onChange={e => setNoticeDraft(p => ({ ...p, actionLabel: e.target.value }))} />
                                    </Form.Item>
                                </Col>
                            </Row>
                            <Checkbox checked={noticeDraft.includeDisabled} onChange={e => setNoticeDraft(p => ({ ...p, includeDisabled: e.target.checked }))}>包含已停用账号</Checkbox>
                        </Form>
                    </Col>
                    <Col span={12} style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <Text strong>邮件正文预览</Text>
                            <Button size="small" onClick={() => fetchNoticePreview(noticeDraft)} loading={noticePreviewLoading}>刷新预览</Button>
                        </div>
                        <Space style={{ marginBottom: 12 }}>
                            <Tag>预计发送 {noticePreview?.recipientCount || 0} 人</Tag>
                            <Tag>跳过 {noticePreview?.skippedCount || 0} 人</Tag>
                        </Space>
                        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '4px', height: '400px', overflow: 'hidden' }}>
                            {noticePreview?.html ? (
                                <iframe title="preview" srcDoc={noticePreview.html} style={{ width: '100%', height: '100%', border: 'none' }} />
                            ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Text type="secondary">{noticePreviewError || '暂无预览'}</Text>
                                </div>
                            )}
                        </div>
                    </Col>
                </Row>
            </Modal>

            <Modal
                title={<Space><HiOutlineExclamationTriangle style={{ color: '#faad14' }} /> 恢复系统备份</Space>}
                open={backupRestoreModalOpen}
                onCancel={() => setBackupRestoreModalOpen(false)}
                footer={[
                    <Button key="cancel" onClick={() => setBackupRestoreModalOpen(false)}>取消</Button>,
                    <Button key="inspect" onClick={inspectBackup} loading={backupInspectLoading}>预览备份</Button>,
                    <Button key="restore" danger type="primary" onClick={restoreBackup} loading={backupRestoreLoading} disabled={!backupRestoreConfirmed}>执行恢复</Button>
                ]}
            >
                <Alert
                    type="warning"
                    showIcon
                    message="恢复会覆盖当前同名 Store"
                    description="建议先导出一份当前快照。备份会先按当前 CREDENTIALS_SECRET 解密再恢复。"
                    style={{ marginBottom: 16 }}
                />
                <div
                    style={{
                        border: '2px dashed #d9d9d9',
                        borderRadius: '8px',
                        padding: '32px',
                        textAlign: 'center',
                        background: backupDragActive ? '#f0f7ff' : '#fafafa',
                        marginBottom: 16,
                    }}
                    onDragOver={e => { e.preventDefault(); setBackupDragActive(true); }}
                    onDragLeave={() => setBackupDragActive(false)}
                    onDrop={e => { e.preventDefault(); setBackupDragActive(false); setSelectedBackupFile(e.dataTransfer.files[0]); }}
                >
                    <Input type="file" style={{ display: 'none' }} id="backup-upload" onChange={e => setSelectedBackupFile(e.target.files[0])} />
                    <label htmlFor="backup-upload" style={{ cursor: 'pointer' }}>
                        <CloudUploadOutlined style={{ fontSize: '32px', color: '#8c8c8c' }} />
                        <div style={{ marginTop: 8 }}>点击或拖拽文件到此处</div>
                        <Text type="secondary" style={{ fontSize: '12px' }}>支持 .nmsbak, .gz, .json.gz</Text>
                    </label>
                    {backupFile && <div style={{ marginTop: 12 }}><Tag closable onClose={() => setSelectedBackupFile(null)}>{backupFile.name}</Tag></div>}
                </div>

                {backupUploadProgress > 0 && <Progress percent={backupUploadProgress} size="small" status="active" style={{ marginBottom: 16 }} />}

                {backupInspection && (
                    <Card size="small" title="备份预览" style={{ marginBottom: 16 }}>
                        <Descriptions size="small" column={1}>
                            <Descriptions.Item label="备份时间">{backupInspection.createdAt ? formatDateTime(backupInspection.createdAt, locale) : '未知'}</Descriptions.Item>
                            <Descriptions.Item label="格式版本">{backupInspection.format} v{backupInspection.version}</Descriptions.Item>
                            <Descriptions.Item label="加密状态">{backupInspection.encrypted === false ? '未加密' : (backupInspection.cipher || 'AES-256-GCM')}</Descriptions.Item>
                            <Descriptions.Item label="可恢复 Store">{backupInspection.restorableKeys?.join(', ') || '无'}</Descriptions.Item>
                        </Descriptions>
                    </Card>
                )}

                <Checkbox checked={backupRestoreConfirmed} onChange={e => setBackupRestoreConfirmed(e.target.checked)}>
                    我已确认本次恢复会覆盖数据，且文件来源可信。
                </Checkbox>
            </Modal>

            <TaskProgressModal
                taskId={noticeTaskId || backfillTaskId}
                title={noticeTaskId ? "发送变更通知" : "数据库回填进度"}
                onClose={() => { setNoticeTaskId(null); setBackfillTaskId(null); fetchDbStatus({ quiet: true }); }}
            />
        </Layout>
    );
}
