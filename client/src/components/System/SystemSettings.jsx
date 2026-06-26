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
    HiOutlineCloud,
    HiOutlineCog6Tooth,
    HiOutlineExclamationTriangle,
    HiOutlineServerStack,
    HiOutlineShieldCheck,
    HiOutlineXMark,
    HiOutlineEnvelope,
    HiOutlineCheckCircle,
    HiOutlineBell,
    HiOutlinePaperAirplane,
    HiOutlineCircleStack,
    HiOutlineArrowPath,
} from 'react-icons/hi2';
import TaskProgressModal from '../Tasks/TaskProgressModal.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import CopyFeedbackButton from '../UI/CopyFeedbackButton.jsx';
import SiteAccessDangerModal from './SiteAccessDangerModal.jsx';
import { readSessionSnapshot, SESSION_SNAPSHOT_EVENT, writeSessionSnapshot } from '../../utils/sessionSnapshot.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    { value: 'corporate', labelKey: 'pages.settings.cityWeekly' },
    { value: 'nginx', labelKey: 'pages.settings.weekendGuide' },
    { value: 'blog', labelKey: 'pages.settings.videoNotes' },
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
            camouflageTitle: toText(settings.site?.camouflageTitle, 'City Field Notes'),
        },
        registration: {
            inviteOnlyEnabled: settings.registration?.inviteOnlyEnabled === true,
        },
        security: {
            requireHighRiskConfirmation: Boolean(settings.security?.requireHighRiskConfirmation),
            mediumRiskMinTargets: toBoundedInt(settings.security?.mediumRiskMinTargets, 20, 1, Infinity),
            highRiskMinTargets: toBoundedInt(settings.security?.highRiskMinTargets, 100, 1, Infinity),
            riskTokenTtlSeconds: toBoundedInt(settings.security?.riskTokenTtlSeconds, 180, 30, Infinity),
        },
        jobs: {
            retentionDays: toBoundedInt(settings.jobs?.retentionDays, 90, 1, Infinity),
            maxPageSize: toBoundedInt(settings.jobs?.maxPageSize, 200, 10, Infinity),
            maxRecords: toBoundedInt(settings.jobs?.maxRecords, 2000, 10, Infinity),
            maxConcurrency: toBoundedInt(settings.jobs?.maxConcurrency, 10, 1, Infinity),
            defaultConcurrency: toBoundedInt(settings.jobs?.defaultConcurrency, 5, 1, Infinity),
        },
        audit: {
            retentionDays: toBoundedInt(settings.audit?.retentionDays, 365, 1, Infinity),
            maxPageSize: toBoundedInt(settings.audit?.maxPageSize, 200, 20, Infinity),
        },
        subscription: {
            publicBaseUrl: toText(settings.subscription?.publicBaseUrl, ''),
            converterBaseUrl: toText(settings.subscription?.converterBaseUrl, ''),
            converterClashConfigUrl: toText(settings.subscription?.converterClashConfigUrl, ''),
            converterSingboxConfigUrl: toText(settings.subscription?.converterSingboxConfigUrl, ''),
            converterSurgeConfigUrl: toText(settings.subscription?.converterSurgeConfigUrl, ''),
        },
        auditIpGeo: {
            enabled: settings.auditIpGeo?.enabled === true,
            provider: toText(settings.auditIpGeo?.provider, defaultAuditIpGeoProvider),
            endpoint: toText(settings.auditIpGeo?.endpoint, defaultAuditIpGeoEndpoint),
            timeoutMs: toBoundedInt(settings.auditIpGeo?.timeoutMs, 1500, 100, Infinity),
            cacheTtlSeconds: toBoundedInt(settings.auditIpGeo?.cacheTtlSeconds, 21600, 60, Infinity),
        },
        telegram: {
            enabled: settings.telegram?.enabled === true,
            botToken: toText(settings.telegram?.botToken, ''),
            clearBotToken: settings.telegram?.clearBotToken === true,
            chatId: toText(settings.telegram?.chatId, ''),
            commandMenuEnabled: settings.telegram?.commandMenuEnabled === true,
            opsDigestIntervalMinutes: toBoundedInt(settings.telegram?.opsDigestIntervalMinutes, 30, 0, 1440),
            dailyDigestIntervalHours: toBoundedInt(settings.telegram?.dailyDigestIntervalHours, 24, 0, 168),
            dailyBackupTime: toText(settings.telegram?.dailyBackupTime, '09:00'),
            sendDailyBackup: settings.telegram?.sendDailyBackup === true,
            sendSystemStatus: settings.telegram?.sendSystemStatus !== false,
            sendSecurityAudit: settings.telegram?.sendSecurityAudit !== false,
            sendEmergencyAlerts: settings.telegram?.sendEmergencyAlerts !== false,
        },
    };
}

function buildNoticeDraft(source = null, fallbackUrl = '', t) {
    const publicBaseUrl = toText(source?.subscription?.publicBaseUrl, '');
    const actionUrl = publicBaseUrl || toText(fallbackUrl, '');
    return {
        subject: t('pages.settings.noticeOfChangeOfServiceEntranceAddr'),
        message: t('pages.settings.theServiceEntranceAddressHasBeenUpd'),
        actionUrl,
        actionLabel: t('pages.settings.viewTheLatestAddress'),
        scope: 'all',
        includeDisabled: true,
    };
}

const SYSTEM_SETTINGS_SNAPSHOT_KEY = 'system_settings_bootstrap_v1';
const SYSTEM_SETTINGS_SNAPSHOT_TTL_MS = 2 * 60_000;

function readSystemSettingsSnapshot() {
    const snapshot = readSessionSnapshot(SYSTEM_SETTINGS_SNAPSHOT_KEY, {
        maxAgeMs: SYSTEM_SETTINGS_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
        settings: snapshot?.settings || null,
        dbStatus: snapshot?.dbStatus || null,
        emailStatus: snapshot?.emailStatus || null,
        backupStatus: snapshot?.backupStatus || null,
        monitorStatus: snapshot?.monitorStatus || null,
        registrationRuntime: snapshot?.registrationRuntime || null,
        inviteCodes: Array.isArray(snapshot?.inviteCodes) ? snapshot.inviteCodes : [],
    };
}

const DEFAULT_SETTINGS_TAB = 'status';

function buildSettingsWorkspaceConfig(t) {
    return [
        {
            id: 'status',
            label: t('pages.settings.tabStatus'),
            icon: HiOutlineChartBarSquare,
            routeTab: 'status',
        },
        {
            id: 'access',
            label: t('pages.settings.tabAccess'),
            icon: HiOutlineCog6Tooth,
            routeTab: 'access',
        },
        {
            id: 'policy',
            label: t('pages.settings.tabPolicy'),
            icon: HiOutlineShieldCheck,
            routeTab: 'policy',
        },
        {
            id: 'operations',
            label: t('pages.settings.tabNotify'),
            icon: HiOutlineServerStack,
            routeTab: 'monitor',
        },
        {
            id: 'backup',
            label: t('pages.settings.tabDb'),
            icon: HiOutlineArrowDownTray,
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
    heroMode = 'full',
    children,
}) {
    const showHeroCopy = heroMode === 'full';
    const showHeroStrip = heroMode === 'cards' && Boolean(badges || actions);
    const hasHero = heroMode !== 'hidden'
        && (showHeroCopy
            ? Boolean(eyebrow || title || subtitle || summary || badges || actions || highlights.length > 0)
            : Boolean(showHeroStrip || highlights.length > 0));

    return (
        <section className="settings-workspace-section" data-workspace={workspaceId}>
            {hasHero ? (
                <div className={`settings-tab-hero settings-workspace-hero settings-workspace-hero--${heroMode}`}>
                    {showHeroCopy ? (
                        <div className="settings-tab-hero-copy">
                            {eyebrow ? <div className="settings-tab-hero-eyebrow">{eyebrow}</div> : null}
                            {title ? <div className="settings-tab-hero-title">{title}</div> : null}
                            {subtitle ? <div className="settings-workspace-hero-subtitle">{subtitle}</div> : null}
                            {summary ? <div className="settings-tab-hero-summary">{summary}</div> : null}
                            {badges ? <div className="settings-workspace-hero-badges">{badges}</div> : null}
                            {actions ? <div className="settings-workspace-hero-actions">{actions}</div> : null}
                        </div>
                    ) : null}
                    {showHeroStrip ? (
                        <div className="settings-workspace-hero-strip">
                            {badges ? <div className="settings-workspace-hero-badges">{badges}</div> : null}
                            {actions ? <div className="settings-workspace-hero-actions">{actions}</div> : null}
                        </div>
                    ) : null}
                    {highlights.length > 0 ? (
                        <div className="settings-tab-hero-grid settings-workspace-highlight-grid">
                            {highlights.map((item) => (
                                <div key={item.label} className="settings-tab-highlight-card settings-workspace-highlight-card">
                                    <div className="settings-tab-highlight-label">{item.label}</div>
                                    <div className="settings-tab-highlight-value" title={String(item.value ?? '')}>{item.value}</div>
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

function getMonitorReasonLabel(reasonCode, t) {
    if (reasonCode === 'dns_error') return 'DNS';
    if (reasonCode === 'connect_timeout') return t('pages.settings.statusTimeout');
    if (reasonCode === 'connection_refused') return t('pages.settings.statusRefused');
    if (reasonCode === 'network_error') return t('pages.settings.statusNetworkError');
    if (reasonCode === 'auth_failed') return t('pages.settings.statusAuthFailed');
    if (reasonCode === 'credentials_missing') return t('pages.settings.statusCredMissing');
    if (reasonCode === 'credentials_unreadable') return t('pages.settings.statusCredUnreadable');
    if (reasonCode === 'status_unsupported') return t('pages.settings.statusApiIncompatible');
    if (reasonCode === 'xray_not_running') return t('pages.settings.statusXrayNotRunning');
    if (reasonCode === 'panel_request_failed') return t('pages.settings.statusRequestFailed');
    return '';
}

function SettingsToggleCard({
    checked,
    onChange,
    disabled = false,
    label,
    description,
    activeLabel,
    inactiveLabel,
    compact = false,
}) {
    const { t } = useI18n();
    const effectiveActiveLabel = activeLabel || t("pages.settings.enabled");
    const effectiveInactiveLabel = inactiveLabel || t("pages.settings.disabled");
    const detailText = compact
        ? [checked ? effectiveActiveLabel : effectiveInactiveLabel, description].filter(Boolean).join(' · ')
        : description;

    return (
        <label className={`settings-toggle-card${compact ? ' settings-toggle-card--compact' : ''}${checked ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}>
            <div className="settings-toggle-copy">
                <div className="settings-toggle-label">{label}</div>
                {detailText ? <div className={`settings-toggle-description${compact ? ' is-visible' : ''}`}>{detailText}</div> : null}
            </div>
            <div className="settings-toggle-side">
                {!compact ? (
                    <span className={`badge settings-toggle-badge ${checked ? 'badge-success' : 'badge-neutral'}`}>
                        {checked ? activeLabel : inactiveLabel}
                    </span>
                ) : null}
                <input
                    type="checkbox"
                    aria-label={label}
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

function formatInviteDuration(days, t, locale = 'zh-CN') {
    const normalized = Math.max(0, Number(days) || 0);
    return normalized > 0
        ? (locale === 'en-US' ? `${normalized} day(s)` : `${normalized} 天`)
        : (t ? t('pages.settings.unlimitedTime') : (locale === 'en-US' ? 'Unlimited' : '无限制'));
}

function getInviteStatusMeta(item = {}, t) {
    if (item.status === 'active') {
        return {
            className: 'badge-success',
            label: Number(item.remainingUses || 0) > 0 ? t('pages.settings.usable') : t('pages.settings.pendingCheck'),
        };
    }
    if (item.status === 'revoked') {
        return {
            className: 'badge-danger',
            label: t('pages.settings.revoked'),
        };
    }
    return {
        className: 'badge-neutral',
        label: t('pages.settings.depleted'),
    };
}

function areComparableSettingsEqual(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export default function SystemSettings() {
    const { locale, t } = useI18n();
    const formatDateTime = (value, loc = locale) => {
        if (!value) return loc === 'en-US' ? 'N/A' : t('pages.settings.na');
        return formatDateTimeValue(value, loc);
    };
    const { user } = useAuth();
    const confirmAction = useConfirm();
    const isAdmin = user?.role === 'admin';
    const settingsBootstrapRef = useRef(readSystemSettingsSnapshot());
    const settingsLiveLoadedRef = useRef(false);
    const dbStatusLiveLoadedRef = useRef(false);
    const emailStatusLiveLoadedRef = useRef(false);
    const backupStatusLiveLoadedRef = useRef(false);
    const monitorStatusLiveLoadedRef = useRef(false);
    const registrationRuntimeLiveLoadedRef = useRef(false);
    const inviteCodesLiveLoadedRef = useRef(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedView = resolveSettingsTab(searchParams.get('tab'));
    const activeWorkspaceSectionId = resolveWorkspaceSection(requestedView);

    const [loading, setLoading] = useState(() => (isAdmin ? !settingsBootstrapRef.current?.settings : true));
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(() => settingsBootstrapRef.current?.settings || null);
    const [draft, setDraft] = useState(() => buildDraft(settingsBootstrapRef.current?.settings || null));
    const [dbLoading, setDbLoading] = useState(false);
    const [dbStatus, setDbStatus] = useState(() => settingsBootstrapRef.current?.dbStatus || null);
    const [dbModeDraft, setDbModeDraft] = useState({
        readMode: 'file',
        writeMode: 'file',
        hydrateOnReadDb: true,
    });
    const [dbBackfillDraft, setDbBackfillDraft] = useState({
        dryRun: true,
        redact: false,
        keysText: '',
    });
    const [dbSwitchLoading, setDbSwitchLoading] = useState(false);
    const [dbBackfillLoading, setDbBackfillLoading] = useState(false);
    const [dbBackfillResult, setDbBackfillResult] = useState(null);
    const [backfillTaskId, setBackfillTaskId] = useState(null);
    const [emailStatusLoading, setEmailStatusLoading] = useState(false);
    const [emailTestLoading, setEmailTestLoading] = useState(false);
    const [emailStatus, setEmailStatus] = useState(() => settingsBootstrapRef.current?.emailStatus || null);
    const [dangerConfirmOpen, setDangerConfirmOpen] = useState(false);
    const [noticeModalOpen, setNoticeModalOpen] = useState(false);
    const [noticeSending, setNoticeSending] = useState(false);
    const [noticeTaskId, setNoticeTaskId] = useState(null);
    const [noticeDraft, setNoticeDraft] = useState(() => buildNoticeDraft(null, '', t));
    const [noticePreviewLoading, setNoticePreviewLoading] = useState(false);
    const [noticePreviewError, setNoticePreviewError] = useState('');
    const [noticePreview, setNoticePreview] = useState(null);
    const [backupLoading, setBackupLoading] = useState(false);
    const [backupStatusLoading, setBackupStatusLoading] = useState(false);
    const [backupStatus, setBackupStatus] = useState(() => settingsBootstrapRef.current?.backupStatus || null);
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
    const [monitorStatus, setMonitorStatus] = useState(() => settingsBootstrapRef.current?.monitorStatus || null);
    const [telegramTestLoading, setTelegramTestLoading] = useState(false);
    const [editingTelegramChatId, setEditingTelegramChatId] = useState(false);
    const [registrationRuntime, setRegistrationRuntime] = useState(() => settingsBootstrapRef.current?.registrationRuntime || null);
    const [inviteCodesLoading, setInviteCodesLoading] = useState(false);
    const [inviteCodeActionKey, setInviteCodeActionKey] = useState('');
    const [_inviteCodes, setInviteCodes] = useState(() => settingsBootstrapRef.current?.inviteCodes || []);
    const [inviteGenerationDraft, setInviteGenerationDraft] = useState({
        count: '1',
        usageLimit: '1',
        subscriptionDays: '30',
    });
    const [inviteEmailDraft, setInviteEmailDraft] = useState({
        email: '',
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
    const requestInflightRef = useRef(new Map());

    const runDedupedRequest = async (key, runner) => {
        if (requestInflightRef.current.has(key)) {
            return requestInflightRef.current.get(key);
        }
        const request = Promise.resolve()
            .then(runner)
            .finally(() => {
                if (requestInflightRef.current.get(key) === request) {
                    requestInflightRef.current.delete(key);
                }
            });
        requestInflightRef.current.set(key, request);
        return request;
    };
    const emailConfiguredLabel = emailStatus?.configured ? t('pages.settings.configured') : t('pages.settings.notConfigured');
    const emailDeliveryLabel = emailStatus?.lastDelivery?.success === true
        ? t('pages.settings.recentSendSuccess')
        : emailStatus?.lastDelivery?.success === false
            ? t('pages.settings.recentSendFailed')
            : t('pages.settings.noSendRecords');
    const emailVerificationLabel = emailStatus?.lastVerification?.success === true
        ? t('pages.settings.connectTestSuccess')
        : emailStatus?.lastVerification?.success === false
            ? t('pages.settings.connectTestFailed')
            : t('pages.settings.notTested');
    const converterBaseUrl = toText(draft.subscription.converterBaseUrl, '');
    const converterClashConfigUrl = toText(draft.subscription.converterClashConfigUrl, '');
    const converterSingboxConfigUrl = toText(draft.subscription.converterSingboxConfigUrl, '');
    const converterSurgeConfigUrl = toText(draft.subscription.converterSurgeConfigUrl, '');
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

    useEffect(() => {
        if (!isAdmin) return undefined;

        const handleSnapshotUpdate = (event) => {
            if (event?.detail?.source !== 'app-bootstrap' || event?.detail?.action !== 'write' || event?.detail?.key !== SYSTEM_SETTINGS_SNAPSHOT_KEY) {
                return;
            }
            const snapshot = readSystemSettingsSnapshot();
            if (!snapshot) return;
            settingsBootstrapRef.current = snapshot;

            if (snapshot.settings && !settingsLiveLoadedRef.current) {
                setSettings((current) => (hasPendingChanges ? (current || snapshot.settings) : snapshot.settings));
                if (!hasPendingChanges) {
                    setDraft(buildDraft(snapshot.settings));
                    setEditingTelegramChatId(false);
                }
                setLoading(false);
            }

            if (!dbStatusLiveLoadedRef.current) {
                setDbStatus(snapshot.dbStatus || null);
            }
            if (!emailStatusLiveLoadedRef.current) {
                setEmailStatus(snapshot.emailStatus || null);
            }
            if (!backupStatusLiveLoadedRef.current) {
                setBackupStatus(snapshot.backupStatus || null);
            }
            if (!monitorStatusLiveLoadedRef.current) {
                setMonitorStatus(snapshot.monitorStatus || null);
            }
            if (!registrationRuntimeLiveLoadedRef.current) {
                setRegistrationRuntime(snapshot.registrationRuntime || null);
            }
            if (!inviteCodesLiveLoadedRef.current) {
                setInviteCodes(Array.isArray(snapshot.inviteCodes) ? snapshot.inviteCodes : []);
            }
        };

        window.addEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotUpdate);
        return () => window.removeEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotUpdate);
    }, [hasPendingChanges, isAdmin]);

    const fetchSettings = async (options = {}) => {
        const preserveCurrent = options.preserveCurrent === true || (options.preserveCurrent !== false && settings !== null);
        if (!preserveCurrent) {
            setLoading(true);
        }
        return runDedupedRequest('settings', async () => {
            try {
                const res = await api.get('/system/settings');
                const payload = res.data?.obj || null;
                settingsLiveLoadedRef.current = true;
                setSettings(payload);
                setDraft(buildDraft(payload));
                setEditingTelegramChatId(false);
            } catch (error) {
                toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadSystemSettings'));
            }
            setLoading(false);
        });
    };

    const fetchDbStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setDbLoading(true);
        return runDedupedRequest('dbStatus', async () => {
            try {
                const res = await api.get('/system/db/status');
                const payload = res.data?.obj || null;
                dbStatusLiveLoadedRef.current = true;
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
                    toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadDatabaseStatus'));
                }
            }
            setDbLoading(false);
        });
    };

    const fetchEmailStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setEmailStatusLoading(true);
        return runDedupedRequest('emailStatus', async () => {
            try {
                const res = await api.get('/system/email/status');
                emailStatusLiveLoadedRef.current = true;
                setEmailStatus(res.data?.obj || null);
            } catch (error) {
                if (!quiet) {
                    toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadSmtpStatus'));
                }
            }
            setEmailStatusLoading(false);
        });
    };

    const testEmailConnection = async () => {
        if (!isAdmin) return;
        setEmailTestLoading(true);
        try {
            const res = await api.post('/system/email/test');
            setEmailStatus(res.data?.obj || null);
            toast.success(res.data?.msg || t('pages.settings.smtpConnectionVerificationSuccessfu'));
        } catch (error) {
            const payload = error.response?.data?.obj || null;
            if (payload) setEmailStatus(payload);
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.smtpConnectionVerificationFailed'));
        }
        setEmailTestLoading(false);
    };

    const openNoticeModal = () => {
        setNoticeDraft(buildNoticeDraft(settings, siteEntryPreview, t));
        setNoticePreview(null);
        setNoticePreviewError('');
        setNoticeModalOpen(true);
    };

    const sendRegisteredUserNotice = async () => {
        if (!isAdmin) return;
        if (!noticeDraft.subject.trim()) {
            toast.error(t('pages.settings.notificationSubjectCannotBeEmpty'));
            return;
        }
        if (!noticeDraft.message.trim()) {
            toast.error(t('pages.settings.notificationContentCannotBeEmpty'));
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
            toast.success(res.data?.msg || t('pages.settings.notificationSendingTaskHasBeenCreat'));
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToCreateNotificationSendingTa'));
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
            setNoticePreviewError(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadEmailPreview'));
        }
        setNoticePreviewLoading(false);
    };

    const fetchBackupStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setBackupStatusLoading(true);
        return runDedupedRequest('backupStatus', async () => {
            try {
                const res = await api.get('/system/backup/status');
                backupStatusLiveLoadedRef.current = true;
                setBackupStatus(res.data?.obj || null);
            } catch (error) {
                if (!quiet) {
                    toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadBackupStatus'));
                }
            }
            setBackupStatusLoading(false);
        });
    };

    const fetchMonitorStatus = async (options = {}) => {
        const quiet = options.quiet === true;
        setMonitorStatusLoading(true);
        return runDedupedRequest('monitorStatus', async () => {
            try {
                const res = await api.get('/system/monitor/status');
                monitorStatusLiveLoadedRef.current = true;
                setMonitorStatus(res.data?.obj || null);
            } catch (error) {
                if (!quiet) {
                    toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadMonitoringStatus'));
                }
            }
            setMonitorStatusLoading(false);
        });
    };

    const fetchRegistrationRuntime = async () => {
        return runDedupedRequest('registrationRuntime', async () => {
            try {
                const res = await api.get('/auth/registration-status');
                registrationRuntimeLiveLoadedRef.current = true;
                setRegistrationRuntime(res.data?.obj || null);
            } catch {
                setRegistrationRuntime(null);
            }
        });
    };

    const fetchInviteCodes = async (options = {}) => {
        const quiet = options.quiet === true;
        setInviteCodesLoading(true);
        return runDedupedRequest('inviteCodes', async () => {
            try {
                const res = await api.get('/system/invite-codes');
                inviteCodesLiveLoadedRef.current = true;
                setInviteCodes(Array.isArray(res.data?.obj) ? res.data.obj : []);
            } catch (error) {
                if (!quiet) {
                    toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadInvitationCode'));
                }
            }
            setInviteCodesLoading(false);
        });
    };

    useEffect(() => {
        if (!isAdmin) {
            setLoading(false);
            return;
        }
        if (lazyLoadRef.current.settings) return;
        lazyLoadRef.current.settings = true;
        fetchSettings({ preserveCurrent: settingsBootstrapRef.current?.settings != null });
    }, [isAdmin]);

    useEffect(() => {
        if (!isAdmin || !settings) return;
        writeSessionSnapshot(SYSTEM_SETTINGS_SNAPSHOT_KEY, {
            settings,
            dbStatus,
            emailStatus,
            backupStatus,
            monitorStatus,
            registrationRuntime,
            inviteCodes: _inviteCodes,
        });
    }, [isAdmin, settings, dbStatus, emailStatus, backupStatus, monitorStatus, registrationRuntime, _inviteCodes]);

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
        if (!isAdmin) return undefined;
        const handlePageRefresh = (event) => {
            event.preventDefault();
            fetchSettings({ preserveCurrent: true });

            if (activeWorkspaceSectionId === 'status') {
                fetchRegistrationRuntime();
                fetchDbStatus();
                fetchEmailStatus();
                fetchBackupStatus();
                fetchMonitorStatus();
                return;
            }

            if (activeWorkspaceSectionId === 'access') {
                fetchRegistrationRuntime();
                fetchInviteCodes();
                return;
            }

            if (activeWorkspaceSectionId === 'backup') {
                fetchDbStatus();
                fetchBackupStatus();
                return;
            }

            if (activeWorkspaceSectionId === 'operations') {
                fetchEmailStatus();
                fetchMonitorStatus();
            }
        };
        window.addEventListener('nms:page-refresh', handlePageRefresh);
        return () => window.removeEventListener('nms:page-refresh', handlePageRefresh);
    }, [activeWorkspaceSectionId, isAdmin, settings]);

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
                setNoticePreviewError(error.response?.data?.msg || error.message || t('pages.settings.failedToLoadEmailPreview'));
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
        toast.success(t('pages.settings.restoredToSavedConfiguration'));
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
            toast.success(t('pages.settings.theRealEntrancePathHasBeenAutomatic'));
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
            settingsLiveLoadedRef.current = true;
            setSettings(next);
            setDraft(buildDraft(next));
            setEditingTelegramChatId(false);
            setDangerConfirmOpen(false);
            await fetchMonitorStatus({ quiet: true });
            await fetchRegistrationRuntime();
            toast.success(t('pages.settings.systemSettingsUpdated'));
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
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.saveFailed'));
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
            title: t('pages.settings.saveSystemSettings'),
            message: t('pages.settings.areYouSureYouWantToApplyTheCurrentS'),
            details: t('pages.settings.thisOperationWillImmediatelyAffectB'),
            confirmText: t('pages.settings.confirmToSave'),
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
            toast.success(res.data?.msg || (codes.length > 1 ? t('pages.settings.inviteCodesGenerated', { count: codes.length }) : t('pages.settings.invitationCodeHasBeenCreated')));
            await fetchInviteCodes({ quiet: true });
            if (codes.length > 0) {
                await copyToClipboard(codes.join('\n'));
                toast.success(codes.length > 1 ? t('pages.settings.inviteCodesCopied', { count: codes.length }) : t('pages.settings.theInvitationCodeHasBeenCopiedToThe'));
            }
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToCreateInvitationCode'));
        }
        setInviteCodeActionKey('');
    };

    const sendInviteEmail = async () => {
        if (!isAdmin) return;
        const email = toText(inviteEmailDraft.email, '').toLowerCase();
        const subscriptionDays = toBoundedInt(inviteEmailDraft.subscriptionDays, 30, 0, 3650);

        if (!EMAIL_PATTERN.test(email)) {
            toast.error(t('pages.settings.pleaseEnterAValidEmailAddress'));
            return;
        }

        setInviteCodeActionKey('send-email');
        try {
            const res = await api.post('/system/invite-codes/send', {
                email,
                subscriptionDays,
            });
            setInviteEmailDraft((prev) => ({
                ...prev,
                email: '',
                subscriptionDays: String(subscriptionDays),
            }));
            toast.success(res.data?.msg || t('pages.settings.inviteCodeSent', { email }));
            await fetchInviteCodes({ quiet: true });
            await fetchEmailStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToSendInvitationCode'));
        }
        setInviteCodeActionKey('');
    };

    const revokeInviteCode = async (invite) => {
        if (!isAdmin || !invite?.id) return;
        const inviteLabel = invite.preview || invite.id;
        const ok = await confirmAction({
            title: t('pages.settings.revokeInvitationCode'),
            message: t('pages.settings.confirmRevokeInviteCode', { label: inviteLabel }),
            details: t('pages.settings.afterBeingRevokedTheInvitationCodeW'),
            confirmText: t('pages.settings.confirmRevocation'),
            tone: 'danger',
        });
        if (!ok) return;

        setInviteCodeActionKey(`revoke:${invite.id}`);
        try {
            const res = await api.delete(`/system/invite-codes/${encodeURIComponent(invite.id)}`);
            toast.success(res.data?.msg || t('pages.settings.invitationCodeHasBeenRevoked'));
            await fetchInviteCodes({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToRevokeInvitationCode'));
        }
        setInviteCodeActionKey('');
    };

    const switchDbMode = async () => {
        if (!isAdmin) return;
        const ok = await confirmAction({
            title: t('pages.settings.switchStorageMode'),
            message: t('pages.settings.confirmSwitchDbMode', { read: dbModeDraft.readMode, write: dbModeDraft.writeMode }),
            details: dbModeDraft.readMode === 'db'
                ? t('pages.settings.readingFromTheDatabaseIsCurrentlyEn')
                : t('pages.settings.fileReadingModeIsCurrentlyReserved'),
            confirmText: t('pages.settings.confirmSwitch'),
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
            toast.success(res.data?.msg || t('pages.settings.storageModeHasBeenSwitched'));
            if (output?.current) {
                setDbModeDraft((prev) => ({
                    ...prev,
                    readMode: output.current.readMode || prev.readMode,
                    writeMode: output.current.writeMode || prev.writeMode,
                }));
            }
            await fetchDbStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToSwitchStorageMode'));
        }
        setDbSwitchLoading(false);
    };

    const runDbBackfill = async () => {
        if (!isAdmin) return;
        const selectedKeys = parseStoreKeys(dbBackfillDraft.keysText);
        const dryRun = !!dbBackfillDraft.dryRun;
        const redact = !!dbBackfillDraft.redact;
        const ok = await confirmAction({
            title: dryRun ? t('pages.settings.performBackfillRehearsal') : t('pages.settings.performDatabaseBackfill'),
            message: dryRun
                ? t('pages.settings.thisIsOnlyAPreviewAndWillNotBeWritt')
                : t('pages.settings.aDatabaseSnapshotWillBeWrittenDoYou'),
            details: t('pages.settings.backfillDetails', { redact: redact ? t('pages.settings.enabledState') : t('pages.settings.disabledState'), scope: selectedKeys.length > 0 ? selectedKeys.join(', ') : t('pages.settings.allStore') }),
            confirmText: dryRun ? t('pages.settings.startRehearsal') : t('pages.settings.confirmBackfill'),
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
                toast(t('pages.settings.theBackfillTaskHasBeenStartedPlease'));
            } else {
                // 同步模式回退
                const output = obj;
                setDbBackfillResult(output);
                const failed = Number(output?.failed || 0);
                const total = Number(output?.total || 0);
                if (failed > 0) {
                    toast.error(locale === 'en-US' ? `Backfill completed: ${total - failed}/${total} succeeded` : `回填完成: ${total - failed}/${total} 成功`);
                } else {
                    toast.success(locale === 'en-US' ? `Backfill completed: ${total}/${total} succeeded` : `回填完成: ${total}/${total} 成功`);
                }
                await fetchDbStatus({ quiet: true });
            }
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.databaseBackfillFailed'));
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
            toast.success(t('pages.settings.encryptedBackupExported'));
            fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToExportEncryptedBackup'));
        }
        setBackupLoading(false);
    };

    const saveBackupLocally = async () => {
        if (!isAdmin) return;
        setBackupLocalSaving(true);
        try {
            const res = await api.post('/system/backup/local');
            toast.success(res.data?.msg || t('pages.settings.theEncryptedBackupHasBeenSavedLocal'));
            await fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToSaveLocalBackup'));
        }
        setBackupLocalSaving(false);
    };

    const sendBackupToTelegram = async () => {
        if (!isAdmin) return;
        setBackupTelegramSending(true);
        try {
            const res = await api.post('/system/backup/telegram');
            toast.success(res.data?.msg || t('pages.settings.encryptedBackupSentToTelegram'));
            await Promise.all([
                fetchBackupStatus({ quiet: true }),
                fetchMonitorStatus({ quiet: true }),
            ]);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.sendingTelegramBackupFailed'));
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
            toast.success(t('pages.settings.localEncryptedBackupDownloaded'));
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToDownloadLocalBackup'));
        }
        setBackupLocalActionKey('');
    };

    const restoreLocalBackup = async (filename) => {
        if (!isAdmin || !filename) return;
        const ok = await confirmAction({
            title: t('pages.settings.restoreNativeEncryptedBackup'),
            message: t('pages.settings.confirmRestoreBackup', { filename }),
            details: t('pages.settings.theBackupWillFirstDecryptAndVerifyA'),
            confirmText: t('pages.settings.confirmRecovery'),
            tone: 'danger',
        });
        if (!ok) return;

        const actionKey = `restore:${filename}`;
        setBackupLocalActionKey(actionKey);
        try {
            const res = await api.post(`/system/backup/local/${encodeURIComponent(filename)}/restore`);
            const payload = res.data?.obj || null;
            setBackupInspection(payload?.inspection || null);
            toast.success(res.data?.msg || t('pages.settings.nativeEncryptedBackupRestored'));
            await Promise.all([
                fetchSettings(),
                fetchBackupStatus({ quiet: true }),
                fetchDbStatus({ quiet: true }),
                fetchEmailStatus({ quiet: true }),
                fetchMonitorStatus({ quiet: true }),
            ]);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToRestoreLocalBackup'));
        }
        setBackupLocalActionKey('');
    };

    const deleteLocalBackup = async (filename) => {
        if (!isAdmin || !filename) return;
        const ok = await confirmAction({
            title: t('pages.settings.deleteLocalBackup'),
            message: t('pages.settings.confirmDeleteBackup', { filename }),
            details: t('pages.settings.afterDeletionThisBackupWillNoLonger'),
            confirmText: t('pages.settings.confirmDeletion'),
            tone: 'danger',
        });
        if (!ok) return;

        const actionKey = `delete:${filename}`;
        setBackupLocalActionKey(actionKey);
        try {
            const res = await api.delete(`/system/backup/local/${encodeURIComponent(filename)}`);
            toast.success(res.data?.msg || t('pages.settings.localBackupDeleted'));
            await fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.failedToDeleteLocalBackup'));
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
            toast.error(t('pages.settings.pleaseSelectTheBackupFileFirst'));
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
                toast.success(t('pages.settings.backupFileVerificationPassed'));
            }
            return inspection;
        } catch (error) {
            setBackupInspection(null);
            setBackupUploadProgress(0);
            if (options.silentError !== true) {
                toast.error(error.response?.data?.msg || error.message || t('pages.settings.backupFileVerificationFailed'));
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
            toast.error(t('pages.settings.pleaseSelectTheBackupFileFirst'));
            return;
        }
        if (!backupRestoreConfirmed) {
            toast.error(t('pages.settings.pleaseMakeSureYouKnowThatRecoveryWi'));
            return;
        }

        let inspection = backupInspection || null;
        if (!inspection) {
            setBackupInspectLoading(true);
            inspection = await inspectBackupFile({ silentSuccess: true, silentError: true });
            setBackupInspectLoading(false);
            if (!inspection) {
                toast.error(t('pages.settings.backupFileVerificationFailedAndCann'));
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
            toast.success(res.data?.msg || t('pages.settings.backupRestored'));
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
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.restoringBackupFailed'));
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
            toast.success(t('pages.settings.nodeHealthInspectionHasBeenComplete'));
            fetchMonitorStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.nodeHealthCheckFailed'));
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
            toast.success(res.data?.msg || t('pages.settings.telegramTestNotificationSent'));
        } catch (error) {
            const payload = error.response?.data?.obj || null;
            if (payload) {
                setMonitorStatus((prev) => ({
                    ...(prev || {}),
                    telegram: payload,
                }));
            }
            toast.error(error.response?.data?.msg || error.message || t('pages.settings.telegramTestNotificationFailedToSen'));
        }
        setTelegramTestLoading(false);
    };

    const localBackups = Array.isArray(backupStatus?.localBackups) ? backupStatus.localBackups : [];
    const latestLocalBackup = localBackups[0] || null;
    const lastTelegramBackup = backupStatus?.lastTelegramBackup || null;
    const runtimeStorage = backupStatus?.runtimeStorage || null;
    const runtimeStorageIssues = Array.isArray(runtimeStorage?.invalidStores) ? runtimeStorage.invalidStores : [];
    const runtimeStorageHealthy = runtimeStorage
        && runtimeStorage.dataDirExists
        && runtimeStorage.dataDirReadable
        && runtimeStorage.dataDirWritable
        && runtimeStorage.invalidStoreCount === 0
        && !runtimeStorage.dataDirVolatile;
    const runtimeStorageBadgeClass = !runtimeStorage
        ? 'badge-neutral'
        : runtimeStorageHealthy
            ? 'badge-success'
            : runtimeStorage.dataDirVolatile || runtimeStorage.invalidStoreCount > 0
                ? 'badge-danger'
                : 'badge-warning';
    const runtimeStorageBadgeText = !runtimeStorage
        ? t('pages.settings.waitingState')
        : runtimeStorageHealthy
            ? t('pages.settings.persistenceIsNormal')
            : runtimeStorage.dataDirVolatile
                ? t('pages.settings.volatileDirectory')
                : runtimeStorage.invalidStoreCount > 0
                    ? t('pages.settings.dataAnomaly')
                    : t('pages.settings.needToCheck');
    const hasExportBackup = Boolean(backupStatus?.lastExport?.createdAt);
    const hasLocalBackup = Boolean(latestLocalBackup?.createdAt);
    const backupSummaryValue = hasExportBackup && hasLocalBackup
        ? t('pages.settings.exportNative')
        : hasExportBackup
            ? t('pages.settings.alreadyExportedBackup')
            : hasLocalBackup
                ? t('pages.settings.alreadyHaveLocalBackup')
                : t('pages.settings.noBackupYet');
    const savedTelegramChatId = toText(settings?.telegram?.chatId, '');
    const draftTelegramChatId = toText(draft.telegram.chatId, '');
    const hasSavedTelegramChatId = Boolean(savedTelegramChatId || toText(monitorStatus?.telegram?.chatIdPreview, ''));
    const telegramChatIdChanged = draftTelegramChatId !== savedTelegramChatId;
    const telegramTargetPreview = resolveChatIdPreviewValue(monitorStatus?.telegram?.chatIdPreview, draft.telegram.chatId);
    const telegramMaskedDisplayValue = !draftTelegramChatId && hasSavedTelegramChatId && telegramChatIdChanged
        ? t('pages.settings.clearedWaitingToBeSaved')
        : (draftTelegramChatId
            ? (telegramChatIdChanged ? maskChatIdValue(draftTelegramChatId) : telegramTargetPreview)
            : telegramTargetPreview);
    const shouldMaskTelegramChatId = hasSavedTelegramChatId && !editingTelegramChatId;
    const telegramChatIdHint = hasSavedTelegramChatId
        ? (editingTelegramChatId
            ? t('pages.settings.chatIdIsBeingEditedAndWillContinueT')
            : telegramMaskedDisplayValue === t('pages.settings.clearedWaitingToBeSaved')
                ? t('pages.settings.theCurrentChatIdHasBeenClearedAndEx')
                : t('pages.settings.maskedValueDisplayed', { value: telegramMaskedDisplayValue }))
        : t('pages.settings.itIsRecommendedToFillInTheChatIdOfT');
    const telegramNextBackupLabel = monitorStatus?.telegram?.nextDailyBackupAt
        ? formatDateTime(monitorStatus.telegram.nextDailyBackupAt, locale)
        : t('pages.settings.notScheduled');
    const readyAlertChainCount = [
        Boolean(emailStatus?.configured),
        Boolean(monitorStatus?.healthMonitor?.running),
        Boolean(monitorStatus?.telegram?.enabled),
    ].filter(Boolean).length;
    const monitorReasonSummary = useMemo(() => {
        const entries = Object.entries(monitorStatus?.healthMonitor?.summary?.byReason || {})
            .filter(([reasonCode, count]) => !['none', 'maintenance'].includes(reasonCode) && Number(count || 0) > 0)
            .map(([reasonCode, count]) => {
                const label = getMonitorReasonLabel(reasonCode, t);
                return label ? `${label} ${count}` : '';
            })
            .filter(Boolean);
        return entries.length > 0 ? entries.slice(0, 3).join(' · ') : t('pages.settings.theCauseOfNodeExceptionHasNotBeenRe');
    }, [monitorStatus, t]);
    const monitorHealthyCount = Number(monitorStatus?.healthMonitor?.summary?.healthy || 0);
    const monitorIncidentCount = Number(monitorStatus?.healthMonitor?.summary?.degraded || 0)
        + Number(monitorStatus?.healthMonitor?.summary?.unreachable || 0);
    const monitorUnreadCount = Number(monitorStatus?.notifications?.unreadCount || 0);
    const renderAccessContent = () => (
        <div className="settings-section-stack">
            <div className="settings-grid settings-grid--basic settings-grid--access-workspace">
                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench settings-access-panel">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title={t("pages.settings.entryAndSubscription")}
                        actions={(
                            <div className="settings-panel-actions settings-panel-actions--entry">
                                <CopyFeedbackButton
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    text={siteEntryPreview}
                                    successText={t("pages.settings.theEntranceAddressHasBeenCopiedToTh")}
                                >
                                    {locale === 'en-US' ? 'Copy Entry' : '复制入口'}
                                </CopyFeedbackButton>
                                <a href={siteEntryPreview} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                                    {locale === 'en-US' ? 'Open Preview' : '打开预览'}
                                </a>
                            </div>
                        )}
                    />
                    <div className="settings-access-grid">
                        <div className="settings-access-stack">
                            <div className="settings-form-cluster settings-form-cluster--entry">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">{t("pages.settings.entryPath")}</div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.accessPath")}</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">{t("pages.settings.homePageAccessPath")}</label>
                                    <div className="settings-inline-action-row">
                                        <input
                                            className="form-input font-mono"
                                            aria-label={t("pages.settings.homePageAccessPath")}
                                            placeholder="/"
                                            value={draft.site.accessPath}
                                            onChange={(e) => patchField('site', 'accessPath', e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={applyRandomSiteAccessPath}
                                        >
                                            {locale === 'en-US' ? 'Random Path' : '随机路径'}
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label">{t("pages.settings.generatedAccessUrl")}</label>
                                    <input className="form-input font-mono" aria-label={t("pages.settings.generatedAccessUrl")} value={siteEntryPreview} readOnly />
                                </div>
                            </div>
                            <div className="settings-form-cluster settings-form-cluster--camouflage">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">{t("pages.settings.camouflagePageLabel")}</div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.templateAndTitleLabel")}</div>
                                </div>
                                <div className="settings-field-grid settings-field-grid--compact">
                                    <div className="form-group mb-0">
                                        <label className="form-label">{t("pages.settings.camouflageTemplateLabel")}</label>
                                        <select
                                            className="form-select"
                                            aria-label={t("pages.settings.camouflageTemplateLabel")}
                                            value={draft.site.camouflageTemplate}
                                            onChange={(e) => patchField('site', 'camouflageTemplate', e.target.value)}
                                        >
                                            {CAMOUFLAGE_TEMPLATE_OPTIONS.map((item) => (
                                                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group mb-0">
                                        <label className="form-label">{t("pages.settings.camouflageTitleLabel")}</label>
                                        <input
                                            className="form-input"
                                            aria-label={t("pages.settings.camouflageTitleLabel")}
                                            value={draft.site.camouflageTitle}
                                            onChange={(e) => patchField('site', 'camouflageTitle', e.target.value)}
                                            placeholder="City Field Notes"
                                        />
                                    </div>
                                </div>
                                <div className="settings-toggle-strip">
                                    <SettingsToggleCard
                                        compact
                                        checked={draft.site.camouflageEnabled}
                                        onChange={(e) => handleCamouflageToggle(e.target.checked)}
                                        label={t("pages.settings.camouflageHomepageToggle")}
                                        description={t("pages.settings.afterTurningItOnThePublicHomepageWi")}
                                        activeLabel={t("pages.settings.enabled")}
                                        inactiveLabel={t("pages.settings.disabled")}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="settings-access-stack">
                            <div className="settings-form-cluster settings-form-cluster--address">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">{t("pages.settings.subscriptionPublicLabel")}</div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.subscriptionExternalLabel")}</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label" htmlFor="subscription-public-base-url">{t("pages.settings.subscriptionPublicUrl")}</label>
                                    <input
                                        id="subscription-public-base-url"
                                        className="form-input"
                                        aria-label={t("pages.settings.subscriptionPublicUrl")}
                                        placeholder="https://nms.example.com"
                                        value={draft.subscription.publicBaseUrl}
                                        onChange={(e) => patchField('subscription', 'publicBaseUrl', e.target.value)}
                                    />
                                    <div className="text-xs text-muted mt-1">{t("pages.settings.ifLeftBlankSubscriptionsWillBeDistr")}</div>
                                </div>
                            </div>
                            <div className="settings-form-cluster settings-form-cluster--address">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">{t("pages.settings.externalConverterLabel")}</div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.externalConverterTitle")}</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label" htmlFor="subscription-converter-base-url">{t("pages.settings.externalConverterUrl")}</label>
                                    <input
                                        id="subscription-converter-base-url"
                                        className="form-input"
                                        aria-label={t("pages.settings.externalConverterUrl")}
                                        placeholder="https://converter.example.com"
                                        value={converterBaseUrl}
                                        onChange={(e) => patchField('subscription', 'converterBaseUrl', e.target.value)}
                                    />
                                    <div className="text-xs text-muted mt-1">{t("pages.settings.onlyFillInTheBaseAddressOfTheConver")}</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label" htmlFor="subscription-converter-clash-config-url">Clash / Mihomo Config URL</label>
                                    <input
                                        id="subscription-converter-clash-config-url"
                                        className="form-input font-mono"
                                        aria-label="Clash / Mihomo Config URL"
                                        placeholder="https://worker.example.com/subconverter?selectedRules=balanced"
                                        value={converterClashConfigUrl}
                                        onChange={(e) => patchField('subscription', 'converterClashConfigUrl', e.target.value)}
                                    />
                                    <div className="text-xs text-muted mt-1">{t("pages.settings.fillInTheCompleteRuleConfigurationA")}</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label" htmlFor="subscription-converter-singbox-config-url">sing-box Config URL</label>
                                    <input
                                        id="subscription-converter-singbox-config-url"
                                        className="form-input font-mono"
                                        aria-label="sing-box Config URL"
                                        placeholder="https://worker.example.com/subconverter?selectedRules=balanced"
                                        value={converterSingboxConfigUrl}
                                        onChange={(e) => patchField('subscription', 'converterSingboxConfigUrl', e.target.value)}
                                    />
                                    <div className="text-xs text-muted mt-1">{t("pages.settings.leaveBlankToFallBackToNmsBuiltInSin")}</div>
                                </div>
                                <div className="form-group mb-0">
                                    <label className="form-label" htmlFor="subscription-converter-surge-config-url">Surge Config URL</label>
                                    <input
                                        id="subscription-converter-surge-config-url"
                                        className="form-input font-mono"
                                        aria-label="Surge Config URL"
                                        placeholder="https://worker.example.com/subconverter?selectedRules=balanced"
                                        value={converterSurgeConfigUrl}
                                        onChange={(e) => patchField('subscription', 'converterSurgeConfigUrl', e.target.value)}
                                    />
                                    <div className="text-xs text-muted mt-1">{t("pages.settings.leaveBlankToFallBackToTheNmsBuiltIn")}</div>
                                </div>
                                <div className="settings-access-action-row">
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                            patchField('subscription', 'converterBaseUrl', '');
                                            patchField('subscription', 'converterClashConfigUrl', '');
                                            patchField('subscription', 'converterSingboxConfigUrl', '');
                                            patchField('subscription', 'converterSurgeConfigUrl', '');
                                        }}
                                        disabled={!converterBaseUrl && !converterClashConfigUrl && !converterSingboxConfigUrl && !converterSurgeConfigUrl}
                                    >
                                        {locale === 'en-US' ? 'Clear All' : '清空全部'}
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
                                        {locale === 'en-US' ? 'Open Link' : '打开链接'}
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench settings-registration-panel">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title={t("pages.settings.registerAndInviteLabel")}
                        actions={(
                            <div className="settings-panel-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => fetchInviteCodes()} disabled={inviteCodesLoading || inviteCodeActionLoading}>
                                    {inviteCodesLoading ? <span className="spinner" /> : t('pages.settings.refreshInviteBtn')}
                                </button>
                            </div>
                        )}
                    />
                    <div className="settings-invite-layout">
                        <div className="settings-access-stack">
                            <div className="settings-form-cluster">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">{t("pages.settings.registerModeLabel")}</div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.registerModeLabel")}</div>
                                </div>
                                <div className="settings-toggle-strip">
                                    <SettingsToggleCard
                                        compact
                                        checked={draft.registration.inviteOnlyEnabled}
                                        onChange={(e) => patchField('registration', 'inviteOnlyEnabled', e.target.checked)}
                                        disabled={!registrationEnabled}
                                        label={t("pages.settings.enableInviteRegister")}
                                        description={registrationEnabled
                                            ? t('pages.settings.afterOpeningYouNeedToFillInTheInvit')
                                            : t('pages.settings.selfServiceRegistrationIsClosedInTh')}
                                        activeLabel={t("pages.settings.inviteMode")}
                                        inactiveLabel={t("pages.settings.normalMode")}
                                    />
                                </div>
                            </div>
                            <div className="settings-form-cluster settings-invite-workbench">
                                <div className="settings-form-cluster-head">
                                    <div className="settings-form-cluster-eyebrow">{t("pages.settings.issueInviteLabel")}</div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.generateAndSendWorkbench")}</div>
                                    <div className="settings-form-cluster-note">{t("pages.settings.putDirectGenerationDesignatedEmailS")}</div>
                                </div>
                                <div className="settings-invite-workbench-grid">
                                    <section className="settings-invite-workbench-section">
                                        <div className="settings-invite-workbench-section-head">
                                            <div className="settings-invite-workbench-section-title">{t("pages.settings.generateInviteDirectly")}</div>
                                            <div className="settings-invite-workbench-section-note">{t("pages.settings.suitableForBatchDistributionOrTempo")}</div>
                                        </div>
                                        <div className="settings-field-grid settings-field-grid--compact settings-field-grid--invite-generate">
                                            <div className="form-group mb-0">
                                                <label className="form-label">{t("pages.settings.theQuantityGeneratedThisTime")}</label>
                                                <input
                                                    className="form-input"
                                                    aria-label={t("pages.settings.theQuantityGeneratedThisTime")}
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
                                                <label className="form-label">{t("pages.settings.theNumberOfTimesEachInvitationCodeC")}</label>
                                                <input
                                                    className="form-input"
                                                    aria-label={t("pages.settings.theNumberOfTimesEachInvitationCodeC")}
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
                                                <label className="form-label">{t("pages.settings.openingTimeDays")}</label>
                                                <input
                                                    className="form-input"
                                                    aria-label={t("pages.settings.openingTimeDays")}
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
                                                    {inviteCodeActionKey === 'create' ? <span className="spinner" /> : t('pages.settings.generateInviteBtn')}
                                                </button>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="settings-invite-workbench-section">
                                        <div className="settings-invite-workbench-section-head">
                                            <div className="settings-invite-workbench-section-title">{t("pages.settings.sendToEmailBtn")}</div>
                                            <div className="settings-invite-workbench-section-note">{t("pages.settings.aSingleInvitationCodeIsAutomaticall")}</div>
                                        </div>
                                        <div className="settings-field-grid settings-field-grid--compact settings-field-grid--invite-email">
                                            <div className="form-group mb-0">
                                                <label className="form-label">{t("pages.settings.targetEmailLabel")}</label>
                                                <input
                                                    className="form-input"
                                                    type="email"
                                                    placeholder="invitee@example.com"
                                                    value={inviteEmailDraft.email}
                                                    onChange={(e) => setInviteEmailDraft((prev) => ({
                                                        ...prev,
                                                        email: e.target.value,
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group mb-0">
                                                <label className="form-label">{t("pages.settings.openingTimeDays")}</label>
                                                <input
                                                    className="form-input"
                                                    aria-label={t("pages.settings.openingTimeDays")}
                                                    type="number"
                                                    min={0}
                                                    max={3650}
                                                    value={inviteEmailDraft.subscriptionDays}
                                                    onChange={(e) => setInviteEmailDraft((prev) => ({
                                                        ...prev,
                                                        subscriptionDays: e.target.value,
                                                    }))}
                                                />
                                            </div>
                                            <div className="form-group mb-0 settings-form-actions">
                                                <button
                                                    className="btn btn-primary w-full"
                                                    type="button"
                                                    onClick={sendInviteEmail}
                                                    disabled={inviteCodeActionLoading || !inviteEmailDraft.email.trim()}
                                                >
                                                    {inviteCodeActionKey === 'send-email' ? <span className="spinner" /> : t('pages.settings.sendInviteMailBtn')}
                                                </button>
                                            </div>
                                        </div>
                                    </section>
                                </div>

                                {latestInviteCodes.length > 0 ? (
                                    <div className="settings-invite-workbench-latest">
                                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                            <div className="text-sm font-medium">{t("pages.settings.generatedInviteCodes")}</div>
                                            <span className="text-xs text-muted">
                                                {locale === 'en-US'
                                                    ? `${latestInviteBatch.count || latestInviteCodes.length} code(s), ${latestInviteBatch.usageLimit || 1} use(s) each, opens ${formatInviteDuration(latestInviteBatch.subscriptionDays, t, locale)}`
                                                    : `${latestInviteBatch.count || latestInviteCodes.length} 个邀请码，每个可用 ${latestInviteBatch.usageLimit || 1} 次，开通 ${formatInviteDuration(latestInviteBatch.subscriptionDays, t, locale)}`}
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
                                                    toast.success(latestInviteCodes.length > 1 ? t('pages.settings.inviteCodesCopied', { count: latestInviteCodes.length }) : t('pages.settings.theInvitationCodeHasBeenCopiedToThe'));
                                                }}
                                            >
                                                {latestInviteCodes.length > 1 ? t('pages.settings.copyAllBtn') : t('pages.settings.copyBtn')}
                                            </button>
                                        </div>
                                        <div className="text-xs text-muted mt-2">{t("pages.settings.theClearTextOfTheInvitationCodeIsOn")}</div>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">{t("pages.settings.inviteCodesLedger")}</div>
                                <div className="settings-form-cluster-title">{t("pages.settings.ledgerAndRecords")}</div>
                                <div className="settings-form-cluster-note">
                                    {locale === 'en-US'
                                        ? `Active: ${inviteAvailableRecords.length} · Remaining: ${inviteRemainingUses} use(s) · Depleted: ${inviteUsedCount} · Revoked: ${inviteRevokedCount}`
                                        : `活动 ${inviteAvailableRecords.length} 个 · 剩余 ${inviteRemainingUses} 次 · 已用尽 ${inviteUsedCount} 个 · 已撤销 {inviteRevokedCount} 个。`}
                                </div>
                            </div>
                            {inviteCodesLoading ? (
                                <div className="text-sm text-muted">{t("pages.settings.loadingInvites")}</div>
                            ) : inviteRecords.length === 0 ? (
                                <EmptyState
                                    title={locale === 'en-US' ? 'No invitation codes available' : t('pages.settings.noInvitesRecord')}
                                    subtitle={locale === 'en-US' ? 'You can generate a batch of invitation codes first.' : t('pages.settings.youCanGenerateABatchOfInvitationCod')}
                                    size="compact"
                                    hideIcon
                                />
                            ) : (
                                <>
                                    <div className="settings-inline-action-strip">
                                        <div className="settings-inline-action-copy">
                                            <div className="settings-inline-action-title">{t('pages.settings.inviteRecordsCount', { count: inviteRecords.length })}</div>
                                            <div className="settings-inline-action-note">
                                                {inviteLedgerExpanded
                                                    ? (locale === 'en-US'
                                                        ? `Ledger expanded. Total used: ${inviteConsumedUses} time(s)${inviteRecentUsedAt?.usedAt ? ` · Recent used: ${formatDateTime(inviteRecentUsedAt.usedAt, locale)}${inviteRecentUsedAt.usedByUsername ? ` · ${inviteRecentUsedAt.usedByUsername}` : ''}` : ''}`
                                                        : `已展开完整台账，可直接查看使用记录。累计使用 ${inviteConsumedUses} 次${inviteRecentUsedAt?.usedAt ? ` · 最近使用 ${formatDateTime(inviteRecentUsedAt.usedAt, locale)}${inviteRecentUsedAt.usedByUsername ? ` · ${inviteRecentUsedAt.usedByUsername}` : ''}` : ''}`)
                                                    : (locale === 'en-US'
                                                        ? `Expand ledger to inspect records. Total used: ${inviteConsumedUses} time(s)${inviteRecentUsedAt?.usedAt ? ` · Recent used: ${formatDateTime(inviteRecentUsedAt.usedAt, locale)}` : ''}`
                                                        : `需要排查或复核时再展开完整台账。累计使用 ${inviteConsumedUses} 次${inviteRecentUsedAt?.usedAt ? ` · 最近使用 ${formatDateTime(inviteRecentUsedAt.usedAt, locale)}` : ''}`)}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setInviteLedgerExpanded((prev) => !prev)}
                                            aria-expanded={inviteLedgerExpanded}
                                        >
                                            {inviteLedgerExpanded ? t('pages.settings.collapseLedger') : t('pages.settings.expandLedger')}
                                        </button>
                                    </div>
                                    {inviteLedgerExpanded ? (
                                        <div className="settings-invite-ledger">
                                            {inviteRecords.map((item) => {
                                                const statusMeta = getInviteStatusMeta(item, t);
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
                                                                    {locale === 'en-US' ? 'Created at ' : '创建于 '}{formatDateTime(item.createdAt, locale)}
                                                                    {item.createdBy ? t('pages.settings.createdByLabel', { creator: item.createdBy }) : ''}
                                                                </div>
                                                            </div>
                                                            <span className={`badge ${statusMeta.className}`}>{statusMeta.label}</span>
                                                        </div>
                                                        <div className="settings-invite-ledger-usage">
                                                            <div className="settings-invite-ledger-usage-head">
                                                                <span>{t('pages.settings.usedAndLimit', { used: usedCount, limit: usageLimit })}</span>
                                                                <span>{t('pages.settings.remainingUsesCount', { count: remainingUses })}</span>
                                                            </div>
                                                            <div className="settings-invite-ledger-progress" aria-hidden="true">
                                                                <span className="settings-invite-ledger-progress-bar" style={{ width: progressWidth }} />
                                                            </div>
                                                        </div>
                                                        <div className="settings-invite-ledger-meta">
                                                            <div className="settings-invite-ledger-meta-item">
                                                                <span className="settings-invite-ledger-meta-label">{t("pages.settings.boundEmailLabel")}</span>
                                                                <span className="settings-invite-ledger-meta-value">{item.targetEmail || t('pages.settings.notBoundLabel')}</span>
                                                            </div>
                                                            <div className="settings-invite-ledger-meta-item">
                                                                <span className="settings-invite-ledger-meta-label">{t("pages.settings.durationLabel")}</span>
                                                                <span className="settings-invite-ledger-meta-value">{formatInviteDuration(item.subscriptionDays, t)}</span>
                                                            </div>
                                                            <div className="settings-invite-ledger-meta-item">
                                                                <span className="settings-invite-ledger-meta-label">{t("pages.settings.recentlyUsed")}</span>
                                                                <span className="settings-invite-ledger-meta-value">
                                                                    {item.usedAt
                                                                        ? `${formatDateTime(item.usedAt, locale)}${item.usedByUsername ? ` · ${item.usedByUsername}` : ''}`
                                                                        : t('pages.settings.unusedLabel')}
                                                                </span>
                                                            </div>
                                                            <div className="settings-invite-ledger-meta-item">
                                                                <span className="settings-invite-ledger-meta-label">{t("pages.settings.statusExplanation")}</span>
                                                                <span className="settings-invite-ledger-meta-value">
                                                                    {item.status === 'revoked'
                                                                        ? (locale === 'en-US' ? `Revoked${item.revokedBy ? ` · ${item.revokedBy}` : ''}` : `已撤销${item.revokedBy ? ` · ${item.revokedBy}` : ''}`)
                                                                        : item.status === 'used'
                                                                            ? t('pages.settings.reachedLimit')
                                                                            : t('pages.settings.stillIssuable')}
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
                                                                    {actionBusy ? <span className="spinner" /> : t('pages.settings.revokeInvitationCode')}
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </>
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
                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench">
                    <SettingsPanelHeader title={t("pages.settings.riskControlAuditingAndOwnership")} />
                    <div className="settings-inline-grid settings-inline-grid--policy">
                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">{t("pages.settings.riskControlPolicy")}</div>
                                <div className="settings-form-cluster-title">{t("pages.settings.highRiskAuditWindow")}</div>
                            </div>
                            <div className="settings-toggle-strip">
                                <SettingsToggleCard
                                    compact
                                    checked={draft.security.requireHighRiskConfirmation}
                                    onChange={(e) => patchField('security', 'requireHighRiskConfirmation', e.target.checked)}
                                    label={t("pages.settings.highRiskDoubleConfirm")}
                                    description={t("pages.settings.onceTheHighRiskThresholdIsReachedIt")}
                                />
                            </div>
                            <div className="settings-field-grid settings-field-grid--compact">
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.mediumRiskThreshold")}</label>
                                    <input className="form-input" aria-label={t("pages.settings.mediumRiskThreshold")} type="number" min={1} value={draft.security.mediumRiskMinTargets} onChange={(e) => patchField('security', 'mediumRiskMinTargets', e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.highRiskThreshold")}</label>
                                    <input className="form-input" aria-label={t("pages.settings.highRiskThreshold")} type="number" min={1} value={draft.security.highRiskMinTargets} onChange={(e) => patchField('security', 'highRiskMinTargets', e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.confirmTokenTtl")}</label>
                                    <input className="form-input" aria-label={t("pages.settings.confirmTokenTtl")} type="number" min={30} value={draft.security.riskTokenTtlSeconds} onChange={(e) => patchField('security', 'riskTokenTtlSeconds', e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.auditRetentionDays")}</label>
                                    <input className="form-input" aria-label={t("pages.settings.auditRetentionDays")} type="number" min={1} value={draft.audit.retentionDays} onChange={(e) => patchField('audit', 'retentionDays', e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.auditMaxPageSize")}</label>
                                    <input className="form-input" aria-label={t("pages.settings.auditMaxPageSize")} type="number" min={20} value={draft.audit.maxPageSize} onChange={(e) => patchField('audit', 'maxPageSize', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        <div className="settings-form-cluster">
                            <div className="settings-form-cluster-head">
                                <div className="settings-form-cluster-eyebrow">{t("pages.settings.geoEnhancement")}</div>
                                <div className="settings-form-cluster-title">{t("pages.settings.geoSupplement")}</div>
                            </div>
                            <div className="settings-toggle-strip">
                                <SettingsToggleCard
                                    compact
                                    checked={draft.auditIpGeo.enabled}
                                    onChange={(e) => patchField('auditIpGeo', 'enabled', e.target.checked)}
                                    label={t("pages.settings.geoQueryToggle")}
                                    description={t("pages.settings.supplementRegionsAndCarriersForSubs")}
                                />
                            </div>
                            <div className="settings-field-grid settings-field-grid--compact">
                                <div className="form-group">
                                    <label className="form-label">Provider</label>
                                    <input
                                        className="form-input"
                                        aria-label="Provider"
                                        value={draft.auditIpGeo.provider}
                                        onChange={(e) => patchField('auditIpGeo', 'provider', e.target.value)}
                                        placeholder="ip_api"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.timeoutMsLabel")}</label>
                                    <input
                                        className="form-input"
                                        aria-label={t("pages.settings.timeoutMsLabel")}
                                        type="number"
                                        min={100}
                                        value={draft.auditIpGeo.timeoutMs}
                                        onChange={(e) => patchField('auditIpGeo', 'timeoutMs', e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.cacheTtlSeconds")}</label>
                                    <input
                                        className="form-input"
                                        aria-label={t("pages.settings.cacheTtlSeconds")}
                                        type="number"
                                        min={60}
                                        value={draft.auditIpGeo.cacheTtlSeconds}
                                        onChange={(e) => patchField('auditIpGeo', 'cacheTtlSeconds', e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.queryEndpointLabel")}</label>
                                    <input
                                        className="form-input font-mono"
                                        aria-label={t("pages.settings.queryEndpointLabel")}
                                        value={draft.auditIpGeo.endpoint}
                                        onChange={(e) => patchField('auditIpGeo', 'endpoint', e.target.value)}
                                        placeholder="http://ip-api.com/json/{ip}?fields=status,country,regionName,city"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderMonitorContent = () => (
        <div className="settings-section-stack">
            <div className="settings-grid settings-grid--operations-workspace">
                <div className="card p-4 settings-panel settings-panel--wide settings-basic-workbench settings-ops-panel">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title={t("pages.settings.opsActions")}
                    />
                    <div className="settings-ops-grid">
                        <div className="settings-form-cluster settings-ops-card settings-ops-card--smtp">
                            <div className="settings-ops-card-main">
                                <div className="settings-form-cluster-head settings-ops-card-head">
                                    <div className="settings-ops-card-kicker">
                                        <div className="settings-form-cluster-eyebrow">{t("pages.settings.emailLink")}</div>
                                        <span className={`badge ${emailStatus?.configured ? 'badge-success' : 'badge-warning'}`}>{emailConfiguredLabel}</span>
                                    </div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.testSmtp")}</div>
                                    <div className="settings-form-cluster-note">{t("pages.settings.verifyTheSmtpConfigurationAndEmailL")}</div>
                                </div>
                                <div className="settings-ops-meta-grid">
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.connectVerifyBtn")}</div>
                                        <div className="settings-ops-meta-value">{emailVerificationLabel}</div>
                                    </div>
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.recentSendBtn")}</div>
                                        <div className="settings-ops-meta-value">{emailDeliveryLabel}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="settings-panel-actions settings-ops-actions settings-ops-actions--single">
                                <button className="btn btn-secondary btn-sm" onClick={testEmailConnection} disabled={emailStatusLoading || emailTestLoading}>
                                    {emailTestLoading ? <span className="spinner" /> : t('pages.settings.testSmtp')}
                                </button>
                            </div>
                        </div>

                        <div className="settings-form-cluster settings-ops-card settings-ops-card--notice">
                            <div className="settings-ops-card-main">
                                <div className="settings-form-cluster-head settings-ops-card-head">
                                    <div className="settings-ops-card-kicker">
                                        <div className="settings-form-cluster-eyebrow">{t("pages.settings.changeNoticeBtn")}</div>
                                        <span className={`badge ${emailStatus?.configured ? 'badge-info' : 'badge-warning'}`}>
                                            {emailStatus?.configured ? t('pages.settings.canBeSent') : t('pages.settings.smtpToBeConfigured')}
                                        </span>
                                    </div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.sendLatestAddressNotice")}</div>
                                    <div className="settings-form-cluster-note">{t("pages.settings.sendTheLatestAddressOrSubscriptionC")}</div>
                                </div>
                                <div className="settings-ops-meta-grid">
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.sendScopeLabel")}</div>
                                        <div className="settings-ops-meta-value">{t("pages.settings.registeredUserScope")}</div>
                                    </div>
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.currentEntranceLabel")}</div>
                                        <div className="settings-ops-meta-value">{siteAccessPath}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="settings-panel-actions settings-ops-actions settings-ops-actions--single">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={openNoticeModal}
                                    disabled={!emailStatus?.configured || noticeSending}
                                >
                                    {noticeSending ? <span className="spinner" /> : t('pages.settings.sendChangeNoticeBtn')}
                                </button>
                            </div>
                        </div>

                        <div className="settings-form-cluster settings-ops-card settings-ops-card--health">
                            <div className="settings-ops-card-main">
                                <div className="settings-form-cluster-head settings-ops-card-head">
                                    <div className="settings-ops-card-kicker">
                                        <div className="settings-form-cluster-eyebrow">{t("pages.settings.nodeInspectionLabel")}</div>
                                        <span className={`badge ${monitorIncidentCount > 0 ? 'badge-warning' : 'badge-success'}`}>
                                            {monitorIncidentCount > 0 ? t('pages.settings.thereIsAnAbnormality') : t('pages.settings.stableCondition')}
                                        </span>
                                    </div>
                                    <div className="settings-form-cluster-title">{t("pages.settings.runInspectionManual")}</div>
                                    <div className="settings-form-cluster-note">{t("pages.settings.inspectionStatisticsAndAnomalyDistr")}</div>
                                </div>
                                <div className="settings-ops-meta-grid settings-ops-meta-grid--triple">
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.healthyLabel")}</div>
                                        <div className="settings-ops-meta-value">{monitorHealthyCount}</div>
                                    </div>
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.unhealthyState")}</div>
                                        <div className="settings-ops-meta-value">{monitorIncidentCount}</div>
                                    </div>
                                    <div className="settings-ops-meta-item">
                                        <div className="settings-ops-meta-label">{t("pages.settings.unreadCountLabel")}</div>
                                        <div className="settings-ops-meta-value">{monitorUnreadCount}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="settings-panel-actions settings-ops-actions settings-ops-actions--single">
                                <button className="btn btn-primary btn-sm" onClick={runMonitorCheck} disabled={monitorLoading}>
                                    {monitorLoading ? <span className="spinner" /> : t('pages.settings.inspectNowBtn')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card p-4 settings-panel settings-panel--wide settings-telegram-panel">
                    <SectionHeader
                        className="mb-3"
                        compact
                        title={t("pages.settings.telegramBot")}
                        actions={(
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={testTelegramAlert}
                                disabled={telegramTestLoading || !draft.telegram.enabled}
                            >
                                {telegramTestLoading ? <span className="spinner" /> : t('pages.settings.sendTestNotifyBtn')}
                            </button>
                        )}
                    />
                    <div className="grid-auto-220 items-start">
                        <div className="form-group">
                            <label className="form-label" htmlFor="telegram-chat-id">{t("pages.settings.chatIdGroupId")}</label>
                            <div className="settings-sensitive-field">
                                <input
                                    id="telegram-chat-id"
                                    className={`form-input${shouldMaskTelegramChatId ? ' settings-sensitive-display' : ''}`}
                                    aria-label={t("pages.settings.chatIdGroupId")}
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
                                        {editingTelegramChatId ? t('pages.settings.doneLabel') : t('pages.settings.editLabel')}
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
                                aria-label="Bot Token"
                                type="password"
                                value={draft.telegram.botToken}
                                onChange={(event) => patchTelegramToken(event.target.value)}
                                placeholder={settings?.telegram?.botTokenConfigured ? (locale === 'en-US' ? `Saved: ${settings.telegram.botTokenPreview}` : `当前已保存 ${settings.telegram.botTokenPreview}`) : '123456:ABCDEF...'}
                                autoComplete="new-password"
                            />
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                                <div className="text-xs text-muted">
                                    {draft.telegram.clearBotToken
                                        ? t('pages.settings.thisSaveWillClearTheTokensSavedOnTh')
                                        : settings?.telegram?.botTokenConfigured
                                        ? (locale === 'en-US' ? `Saved Token: ${settings.telegram.botTokenPreview || t('pages.settings.configured')}. Leave empty to keep using current Token.` : `当前已保存 Token：${settings.telegram.botTokenPreview || t('pages.settings.configured')}。留空保存会继续使用当前 Token。`)
                                        : t('pages.settings.pleaseEnterTheTelegramBotTokenWhenE')}
                                </div>
                                {settings?.telegram?.botTokenConfigured ? (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-xs"
                                        onClick={clearSavedTelegramToken}
                                    >
                                        {locale === 'en-US' ? 'Clear Saved Token' : '清空已保存 Token'}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="telegram-ops-digest-interval">{t("pages.settings.opsSummaryInterval")}</label>
                            <input
                                id="telegram-ops-digest-interval"
                                className="form-input"
                                type="number"
                                min="0"
                                max="1440"
                                inputMode="numeric"
                                value={draft.telegram.opsDigestIntervalMinutes}
                                onChange={(event) => patchField('telegram', 'opsDigestIntervalMinutes', event.target.value)}
                            />
                            <div className="text-xs text-muted mt-1">{t("pages.settings.unitMinutesFillIn0ToTurnOffSchedule")}</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="telegram-daily-digest-interval">{t("pages.settings.dailyReportInterval")}</label>
                            <input
                                id="telegram-daily-digest-interval"
                                className="form-input"
                                type="number"
                                min="0"
                                max="168"
                                inputMode="numeric"
                                value={draft.telegram.dailyDigestIntervalHours}
                                onChange={(event) => patchField('telegram', 'dailyDigestIntervalHours', event.target.value)}
                            />
                            <div className="text-xs text-muted mt-1">{t("pages.settings.unitHourFillIn0ToTurnOffTheTimer")}</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="telegram-daily-backup-time">{t("pages.settings.dailyBackupTimeLabel")}</label>
                            <input
                                id="telegram-daily-backup-time"
                                className="form-input"
                                type="time"
                                step="60"
                                value={draft.telegram.dailyBackupTime}
                                onChange={(event) => patchField('telegram', 'dailyBackupTime', event.target.value || '09:00')}
                            />
                            <div className="text-xs text-muted mt-1">{t("pages.settings.executedAccordingToServerLocalTimeD")}</div>
                        </div>
                    </div>
                    <div className="settings-toggle-collection settings-toggle-collection--telegram mt-3">
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.enabled}
                            onChange={(event) => patchField('telegram', 'enabled', event.target.checked)}
                            label={t("pages.settings.enableTelegramAlerts")}
                            description={t("pages.settings.whenEnabledSystemStatusAndSecurityA")}
                            activeLabel={t("pages.settings.enabled")}
                            inactiveLabel={t("pages.settings.notEnabled")}
                        />
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.commandMenuEnabled}
                            onChange={(event) => patchField('telegram', 'commandMenuEnabled', event.target.checked)}
                            label={t("pages.settings.telegramCommandMenu")}
                            description={t("pages.settings.afterOpeningSynchronizeTelegramOffi")}
                            activeLabel={t("pages.settings.showLabel")}
                            inactiveLabel={t("pages.settings.hideLabel")}
                        />
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendDailyBackup}
                            onChange={(event) => patchField('telegram', 'sendDailyBackup', event.target.checked)}
                            label={t("pages.settings.dailyBackupToTelegram")}
                            description={t("pages.settings.afterEnablingTheNmsEncryptedBackupP")}
                            activeLabel={t("pages.settings.enabled")}
                            inactiveLabel={t("pages.settings.notEnabled")}
                        />
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendSystemStatus}
                            onChange={(event) => patchField('telegram', 'sendSystemStatus', event.target.checked)}
                            label={t("pages.settings.systemStatusLabel")}
                            description={t("pages.settings.nodeDatabaseExpirationReminderAndOt")}
                            activeLabel={t("pages.settings.push")}
                            inactiveLabel={t("pages.settings.doNotPush")}
                        />
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendSecurityAudit}
                            onChange={(event) => patchField('telegram', 'sendSecurityAudit', event.target.checked)}
                            label={t("pages.settings.auditAlertLabel")}
                            description={t("pages.settings.loginFailureCurrentLimitingAbnormal")}
                            activeLabel={t("pages.settings.push")}
                            inactiveLabel={t("pages.settings.doNotPush")}
                        />
                        <SettingsToggleCard
                            compact
                            checked={draft.telegram.sendEmergencyAlerts}
                            onChange={(event) => patchField('telegram', 'sendEmergencyAlerts', event.target.checked)}
                            label={t("pages.settings.emergencyAlertLabel")}
                            description={t("pages.settings.criticalLevelEventsAreEscalatedDire")}
                            activeLabel={t("pages.settings.push")}
                            inactiveLabel={t("pages.settings.doNotPush")}
                        />
                    </div>
                </div>
            </div>
        </div>
    );

    const renderBackupContent = ({ className = '', wrap = true } = {}) => {
        const panel = (
            <div className={['card', 'p-4', 'settings-panel', 'settings-backup-panel', className].filter(Boolean).join(' ')}>
                <SectionHeader
                    className="mb-3"
                    compact
                    title={t("pages.settings.backupAndRestore")}
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchBackupStatus()} disabled={backupStatusLoading}>
                            {backupStatusLoading ? <span className="spinner" /> : t('pages.settings.refreshStatusBtn')}
                        </button>
                    )}
                />
                <div className="settings-backup-actions settings-backup-actions--triple">
                    <div className="card p-3 settings-mini-card settings-backup-action-card settings-backup-action-card--danger">
                        <div className="text-sm font-medium">{t("pages.settings.exportToBrowser")}</div>
                        <div className="text-xs text-muted mt-1">{t("pages.settings.downloadAnEncryptedBackupPackage")}</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-primary btn-sm" onClick={exportBackup} disabled={backupLoading || backupRestoreLoading || backupLocalSaving}>
                                {backupLoading ? <span className="spinner" /> : <><HiOutlineArrowDownTray />{t("pages.settings.exportBackupBtn")}</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">{t("pages.settings.saveToLocalServer")}</div>
                        <div className="text-xs text-muted mt-1">{t("pages.settings.keepAnEncryptedBackupLocallyOnTheSe")}</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-secondary btn-sm" onClick={saveBackupLocally} disabled={backupLocalSaving || backupLoading || backupRestoreLoading}>
                                {backupLocalSaving ? <span className="spinner" /> : <><HiOutlineShieldCheck />{t("pages.settings.saveLocalBackupBtn")}</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">{t("pages.settings.sendToTelegram")}</div>
                        <div className="text-xs text-muted mt-1">{t("pages.settings.sendTheCurrentNmsEncryptedBackupPac")}</div>
                        <div className="settings-backup-action-footer">
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={sendBackupToTelegram}
                                disabled={backupTelegramSending || backupLoading || backupRestoreLoading || backupLocalSaving || !draft.telegram.enabled}
                            >
                                {backupTelegramSending ? <span className="spinner" /> : <><HiOutlineCloud />{t("pages.settings.sendTelegramBackup")}</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">{t("pages.settings.restoreFromFile")}</div>
                        <div className="text-xs text-muted mt-1">{t("pages.settings.restoreAfterUploadingTheBackupPacka")}</div>
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
                                <HiOutlineArrowUpTray /> {locale === 'en-US' ? 'Import / Restore Backup' : '导入 / 恢复备份'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="card p-3 mt-3 settings-mini-card settings-detail-card settings-runtime-storage-panel">
                    <div className="settings-backup-local-head">
                        <div>
                            <div className="text-sm font-medium">{t('comp.system.sysRuntimeTitle')}</div>
                            <div className="text-xs text-muted mt-1">{t('comp.system.sysRuntimeDesc')}</div>
                        </div>
                        <span className={`badge ${runtimeStorageBadgeClass}`}>{runtimeStorageBadgeText}</span>
                    </div>
                    <div className="settings-backup-inspection-grid settings-runtime-storage-grid">
                        <div className="settings-backup-inspection-item">
                            <div className="text-xs text-muted">{t('comp.system.sysDataDir')}</div>
                            <div className="text-sm settings-runtime-storage-path">{runtimeStorage?.dataDir || '-'}</div>
                        </div>
                        <div className="settings-backup-inspection-item">
                            <div className="text-xs text-muted">{t('comp.system.sysLocalBackupDir')}</div>
                            <div className="text-sm settings-runtime-storage-path">{runtimeStorage?.localBackupDir || backupStatus?.localBackupDir || '-'}</div>
                        </div>
                        <div className="settings-backup-inspection-item">
                            <div className="text-xs text-muted">{t('comp.system.sysDirStatus')}</div>
                            <div className="text-sm">
                                {runtimeStorage
                                    ? `${runtimeStorage.dataDirExists ? t('pages.settings.dirCreated') : t('pages.settings.dirNotCreated')} · ${runtimeStorage.dataDirReadable ? t('pages.settings.dirReadable') : t('pages.settings.dirNotReadable')} · ${runtimeStorage.dataDirWritable ? t('pages.settings.dirWritable') : t('pages.settings.dirNotWritable')}`
                                    : t('comp.system.sysWaitRefresh')}
                            </div>
                        </div>
                        <div className="settings-backup-inspection-item">
                            <div className="text-xs text-muted">{t('comp.system.sysDataCheck')}</div>
                            <div className="text-sm">
                                {runtimeStorage
                                    ? runtimeStorage.invalidStoreCount > 0
                                        ? (locale === 'en-US' ? `${runtimeStorage.invalidStoreCount} JSON anomaly/anomalies` : `${runtimeStorage.invalidStoreCount} 个 JSON 异常`)
                                        : t('pages.settings.jsonVerificationIsNormal')
                                    : t('comp.system.sysWaitRefresh')}
                            </div>
                        </div>
                    </div>
                    {runtimeStorage?.dataDirVolatile ? (
                        <div className="text-xs text-danger mt-2">{t("pages.settings.theCurrentDataDirIsLocatedInTheTemp")}</div>
                    ) : null}
                    {runtimeStorageIssues.length > 0 ? (
                        <div className="settings-runtime-storage-issues">
                            {runtimeStorageIssues.slice(0, 3).map((issue) => (
                                <div key={issue.code} className="settings-runtime-storage-issue">
                                    <span>{issue.code}</span>
                                    <span>{issue.message}</span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="card p-3 mt-3 settings-mini-card settings-detail-card settings-backup-local-panel">
                    <div className="settings-backup-local-head">
                        <div>
                            <div className="text-sm font-medium">{t("pages.settings.telegramBackupStatus")}</div>
                            <div className="text-xs text-muted mt-1">
                                {draft.telegram.sendDailyBackup
                                    ? t('pages.settings.dailyBackupTimeHint', { time: draft.telegram.dailyBackupTime || '09:00' })
                                    : t('pages.settings.currentlyOnlyManualSendingIsSupport')}
                            </div>
                        </div>
                        <span className={`badge ${lastTelegramBackup?.status === 'failed' ? 'badge-danger' : 'badge-info'}`}>
                            {lastTelegramBackup?.status === 'failed' ? t('pages.settings.recentSendFailed') : lastTelegramBackup?.ts ? t('pages.settings.recentlySent') : t('pages.settings.noRecordYet')}
                        </span>
                    </div>
                    <div className="text-sm text-muted">
                        {lastTelegramBackup?.ts
                            ? t('pages.settings.lastBackupLabel', { time: formatDateTime(lastTelegramBackup.ts, locale), filename: lastTelegramBackup.filename || t('pages.settings.unrecordedFilename') })
                            : t('pages.settings.thereIsNoRecordOfTelegramBackupYet')}
                    </div>
                    <div className="text-xs text-muted mt-1">{t("pages.settings.nextAutomaticBackupTelegramnextback")}</div>
                    {lastTelegramBackup?.error ? (
                        <div className="text-xs text-danger">{lastTelegramBackup.error}</div>
                    ) : null}
                </div>

                <div className="card p-3 mt-3 settings-mini-card settings-detail-card settings-backup-local-panel">
                    <div className="settings-backup-local-head">
                        <div>
                            <div className="text-sm font-medium">{t('comp.system.sysLocalBackupsTitle')}</div>
                            <div className="text-xs text-muted mt-1">{t('comp.system.sysBackupDir')} {backupStatus?.localBackupDir || '-'}</div>
                        </div>
                        <span className="badge badge-neutral">{localBackups.length} {t('comp.system.sysBackupCount')}</span>
                    </div>
                    {localBackups.length === 0 ? (
                        <EmptyState
                            title={t('comp.system.sysNoLocalBackups')}
                            size="compact"
                        />
                    ) : (
                        <div className="settings-backup-local-grid">
                            {localBackups.map((item) => (
                                <div key={item.filename} className="settings-backup-local-item">
                                    <div className="settings-backup-local-item-head">
                                        <div className="settings-backup-local-name">{item.filename}</div>
                                        <span className="badge badge-success">{t('comp.system.sysEncrypted')}</span>
                                    </div>
                                    <div className="settings-backup-local-meta">
                                        <span>{formatDateTime(item.createdAt, locale)}</span>
                                        <span>{formatBytes(item.bytes || 0)}</span>
                                        <span>{(item.storeKeys || []).length} {t('comp.system.sysDataModules')}</span>
                                    </div>
                                    <div className="text-xs text-muted">
                                        {t('comp.system.sysDecryptionKey')} {item.keyHint || 'CREDENTIALS_SECRET'} · {t('comp.system.sysAlgorithm')} {item.cipher || 'AES-256-GCM'}
                                    </div>
                                    <div className="settings-backup-local-actions">
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => downloadLocalBackup(item.filename)}
                                            disabled={backupLocalActionKey === `download:${item.filename}`}
                                        >
                                            {backupLocalActionKey === `download:${item.filename}` ? <span className="spinner" /> : t('comp.system.sysActionDownload')}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => restoreLocalBackup(item.filename)}
                                            disabled={backupLocalActionKey === `restore:${item.filename}`}
                                        >
                                            {backupLocalActionKey === `restore:${item.filename}` ? <span className="spinner" /> : t('comp.system.sysActionRestore')}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-danger btn-sm"
                                            onClick={() => deleteLocalBackup(item.filename)}
                                            disabled={backupLocalActionKey === `delete:${item.filename}`}
                                        >
                                            {backupLocalActionKey === `delete:${item.filename}` ? <span className="spinner" /> : t('comp.system.sysActionDelete')}
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
                            <div className="text-sm font-medium">{t('comp.system.sysBackupPreview')}</div>
                            <span className={`badge ${backupInspection.encrypted === false ? 'badge-warning' : 'badge-success'}`}>
                                {backupInspection.encrypted === false ? t('comp.system.sysLegacyCompat') : t('comp.system.sysDecryptionVerified')}
                            </span>
                        </div>
                        <div className="settings-backup-inspection-grid">
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">{t('comp.system.sysBackupTime')}</div>
                                <div className="text-sm">{backupInspection.createdAt ? formatDateTime(backupInspection.createdAt, locale) : t('comp.system.sysUnknown')}</div>
                            </div>
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">{t('comp.system.sysFormatVersion')}</div>
                                <div className="text-sm">{backupInspection.format} v{backupInspection.version}</div>
                            </div>
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">{t('comp.system.sysEncryptionState')}</div>
                                <div className="text-sm">{backupInspection.encrypted === false ? t('comp.system.sysLegacyUnencrypted') : (backupInspection.cipher || 'AES-256-GCM')}</div>
                            </div>
                            <div className="settings-backup-inspection-item">
                                <div className="text-xs text-muted">{t('comp.system.sysRestorableModules')}</div>
                                <div className="text-sm">{(backupInspection.restorableKeys || []).join(', ') || t('comp.system.sysNone')}</div>
                            </div>
                        </div>
                        {(backupInspection.unsupportedKeys || []).length > 0 && (
                            <div className="text-sm text-muted mt-1">{t('comp.system.sysUnsupportedModules')}{backupInspection.unsupportedKeys.join(', ')}</div>
                        )}
                        {(backupInspection.missingKeys || []).length > 0 && (
                            <div className="text-sm text-muted mt-1">{t('comp.system.sysMissingSnapshots')}{backupInspection.missingKeys.join(', ')}</div>
                        )}
                        <div className="text-sm text-muted mt-1">
                            {backupInspection.encrypted === false
                                ? t('comp.system.sysLegacyWarning')
                                : (locale === 'en-US' ? `Decrypted with ${backupInspection.keyHint || 'CREDENTIALS_SECRET'}` : t('pages.settings.restoreDecryptionHint', { key: backupInspection.keyHint || 'CREDENTIALS_SECRET' }))}
                        </div>
                        <div className="settings-backup-inspection-actions">
                            <button className="btn btn-secondary btn-sm" onClick={inspectBackup} disabled={!backupFile || backupInspectLoading || backupRestoreLoading}>
                                {backupInspectLoading ? <span className="spinner" /> : t('comp.system.sysReVerify')}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={restoreBackup} disabled={backupRestoreLoading || (backupInspection.restorableKeys || []).length === 0}>
                                {backupRestoreLoading ? <span className="spinner" /> : t('comp.system.sysConfirmRestore')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
        return wrap ? <div className="settings-section-stack">{panel}</div> : panel;
    };

    const renderDatabaseContent = ({ className = '', compactLayout = false, wrap = true } = {}) => {
        const panel = (
            <div className={['card', 'p-4', 'settings-panel', 'settings-db-panel', compactLayout ? 'settings-db-panel--compact' : '', className].filter(Boolean).join(' ')}>
                <SectionHeader
                    className="mb-3"
                    compact
                    title={t("pages.settings.databaseReadAndWriteMode")}
                    subtitle={t("pages.settings.switchTheDatabaseReadAndWriteStrate")}
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchDbStatus()} disabled={dbLoading}>
                            {dbLoading ? <span className="spinner" /> : t('pages.settings.refreshStatusBtn')}
                        </button>
                    )}
                />

                {!dbStatus ? (
                    <div className="text-sm text-muted">{t("pages.settings.databaseStatusHasNotBeenLoaded")}</div>
                ) : (
                    <>
                        <div className={compactLayout ? 'settings-section-stack' : 'settings-grid settings-db-grid'}>
                            <div className="card p-3 settings-mini-card settings-db-control-card">
                                <div className="settings-db-card-head">
                                    <h4 className="text-base font-semibold">{t("pages.settings.switchReadAndWriteMode")}</h4>
                                    <div className="settings-panel-subtitle">{t("pages.settings.firstConfirmTheCurrentConnectionSta")}</div>
                                </div>
                                <div className="settings-db-card-body">
                                    <div className="form-group">
                                        <label className="form-label">{t("pages.settings.readMode")}</label>
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
                                        <label className="form-label">{t("pages.settings.writeMode")}</label>
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
                                    <div className="settings-db-inline-options">
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                            <input
                                                type="checkbox"
                                                aria-label={t("pages.settings.synchronouslyLoadIntoTheMemoryCache")}
                                                checked={dbModeDraft.hydrateOnReadDb}
                                                onChange={(event) => setDbModeDraft((prev) => ({ ...prev, hydrateOnReadDb: event.target.checked }))}
                                                disabled={!isAdmin}
                                            />{t("pages.settings.synchronouslyLoadIntoTheMemoryCache")}</label>
                                    </div>
                                </div>
                                <div className="settings-db-card-foot">
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={switchDbMode}
                                        disabled={dbSwitchLoading || !dbStatus.connection?.enabled || !isAdmin}
                                    >
                                        {dbSwitchLoading ? <span className="spinner" /> : t('pages.settings.applicationMode')}
                                    </button>
                                </div>
                            </div>

                            <div className="card p-3 settings-mini-card settings-db-control-card">
                                <div className="settings-db-card-head">
                                    <h4 className="text-base font-semibold">{t("pages.settings.storeBackfillToDatabase")}</h4>
                                    <div className="settings-panel-subtitle">{t("pages.settings.pressTheDataKeyToSelectTheBackfillR")}</div>
                                </div>
                                <div className="settings-db-card-body">
                                    <div className="form-group">
                                        <label className="form-label">{t("pages.settings.dataKeysCommaSeparatedLeaveBlankFor")}</label>
                                        <input
                                            className="form-input"
                                            aria-label={t("pages.settings.dataKeysCommaSeparatedLeaveBlankFor")}
                                            value={dbBackfillDraft.keysText}
                                            onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, keysText: event.target.value }))}
                                            placeholder={(dbStatus.storeKeys || []).join(', ')}
                                            disabled={!isAdmin}
                                        />
                                        <div className="text-xs text-muted mt-1">{t("pages.settings.optionalDbstatusStorekeysJoinNone")}</div>
                                    </div>
                                    <div className="settings-db-inline-options">
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                            <input
                                                type="checkbox"
                                                aria-label={t("pages.settings.previewOnly")}
                                                checked={dbBackfillDraft.dryRun}
                                                onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, dryRun: event.target.checked }))}
                                                disabled={!isAdmin}
                                            />{t("pages.settings.previewOnly")}</label>
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                            <input
                                                type="checkbox"
                                                aria-label={t("pages.settings.desensitizedWriting")}
                                                checked={dbBackfillDraft.redact}
                                                onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, redact: event.target.checked }))}
                                                disabled={!isAdmin}
                                            />{t("pages.settings.desensitizedWriting")}</label>
                                    </div>
                                    <div className="text-xs text-muted mt-1">{t("pages.settings.offByDefaultItOnlyTakesEffectForSna")}</div>
                                </div>
                                <div className="settings-db-card-foot">
                                    <button
                                        className={`btn btn-sm ${dbBackfillDraft.dryRun ? 'btn-secondary' : 'btn-danger'}`}
                                        onClick={runDbBackfill}
                                        disabled={dbBackfillLoading || !dbStatus.connection?.enabled || !isAdmin}
                                    >
                                        {dbBackfillLoading ? <span className="spinner" /> : (dbBackfillDraft.dryRun ? t('pages.settings.executionRehearsal') : t('pages.settings.performBackfill'))}
                                    </button>
                                    {dbBackfillResult && (
                                        <div className="text-sm text-muted settings-db-card-result">
                                            {locale === 'en-US' ? 'Total' : '总计'} {dbBackfillResult.total || 0} · {locale === 'en-US' ? 'Success' : '成功'} {dbBackfillResult.success || 0} · {locale === 'en-US' ? 'Failed' : '失败'} {dbBackfillResult.failed || 0}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </>
                )}
            </div>
        );
        return wrap ? <div className="settings-section-stack">{panel}</div> : panel;
    };

    const renderStatusContent = () => (
        <div className="settings-section-stack">
            <div className="settings-grid settings-grid--basic">
                {/* Notification and Inspection Card */}
                <div className="card p-4 settings-panel settings-panel--span-6 settings-status-panel">
                    <SectionHeader
                        className="mb-4"
                        compact
                        title={t("pages.settings.notificationAndInspectionStatus")}
                        subtitle={t("pages.settings.centrallyViewSmtpNodeInspectionAbno")}
                        actions={(
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={refreshStatusWorkspace}
                                disabled={dbLoading || emailStatusLoading || backupStatusLoading || monitorStatusLoading}
                            >
                                {(dbLoading || emailStatusLoading || backupStatusLoading || monitorStatusLoading) ? <span className="spinner" /> : t('pages.settings.refreshOverview')}
                            </button>
                        )}
                    />
                    <div className="settings-status-grid">
                        {/* SMTP Service */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineEnvelope /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.smtpService")}</span>
                                <span className={`settings-kpi-card-indicator ${emailStatus?.configured ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{emailConfiguredLabel}</div>
                                <div className="settings-kpi-card-meta" title={emailDeliveryLabel}>{emailDeliveryLabel}</div>
                            </div>
                        </div>

                        {/* Connection Test */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--success"><HiOutlineCheckCircle /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.connectionTest")}</span>
                                <span className={`settings-kpi-card-indicator ${emailStatus?.lastVerification?.success ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{emailVerificationLabel}</div>
                                <div className="settings-kpi-card-meta" title={formatDateTime(emailStatus?.lastVerification?.ts, locale)}>{formatDateTime(emailStatus?.lastVerification?.ts, locale)}</div>
                            </div>
                        </div>

                        {/* Node Inspection */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineServerStack /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.nodeInspectionLabel")}</span>
                                <span className={`settings-kpi-card-indicator ${monitorStatus?.healthMonitor?.running ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{monitorStatus?.healthMonitor?.running ? t('pages.settings.statusRunning') : t('pages.settings.statusNotRunning')}</div>
                                <div className="settings-kpi-card-meta" title={t('pages.settings.monitorStatusSummary', { healthy: monitorHealthyCount, incident: monitorIncidentCount })}>{t('pages.settings.monitorStatusSummary', { healthy: monitorHealthyCount, incident: monitorIncidentCount })}</div>
                            </div>
                        </div>

                        {/* Exception Distribution */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--warning"><HiOutlineExclamationTriangle /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.abnormalCause")}</span>
                                <span className={`settings-kpi-card-indicator ${monitorIncidentCount > 0 ? 'is-warning' : 'is-active'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{monitorReasonSummary || t('pages.settings.noIncidents')}</div>
                                <div className="settings-kpi-card-meta" title={t("pages.settings.distributionOfRecentInspectionAnoma")}>{t("pages.settings.abnormalDistributionStatistics")}</div>
                            </div>
                        </div>

                        {/* Notification Center */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineBell /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.notificationCenter")}</span>
                                <span className={`settings-kpi-card-indicator ${monitorUnreadCount > 0 ? 'is-warning' : 'is-active'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{t("pages.settings.unreadMonitorunreadcount")}</div>
                                <div className="settings-kpi-card-meta" title={t('pages.settings.dbConsecutiveFailures', { count: monitorStatus?.dbAlerts?.consecutiveFailures || 0 })}>{t('pages.settings.dbConsecutiveFailures', { count: monitorStatus?.dbAlerts?.consecutiveFailures || 0 })}</div>
                            </div>
                        </div>

                        {/* Telegram Bot */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--telegram"><HiOutlinePaperAirplane /></span>
                                <span className="settings-kpi-card-title">Telegram</span>
                                <span className={`settings-kpi-card-indicator ${monitorStatus?.telegram?.enabled ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{monitorStatus?.telegram?.enabled ? t('pages.settings.enabled') : monitorStatus?.telegram?.configured ? t('pages.settings.configured') : t('pages.settings.notConfigured')}</div>
                                <div className="settings-kpi-card-meta" title={telegramTargetPreview !== '-' ? telegramTargetPreview : t('pages.settings.telegramNotBound')}>
                                    {telegramTargetPreview !== '-' ? telegramTargetPreview : t('pages.settings.telegramNotBound')}
                                    {monitorStatus?.telegram?.sendDailyBackup ? t('pages.settings.nextBackupTimeLabel', { time: telegramNextBackupLabel }) : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Database and Backup Card */}
                <div className="card p-4 settings-panel settings-panel--span-6 settings-status-db-panel">
                    <SectionHeader
                        className="mb-4"
                        compact
                        title={t("pages.settings.databaseAndBackupStatus")}
                        subtitle={t("pages.settings.checkTheConnectionStatusCurrentRead")}
                    />
                    <div className="settings-status-grid">
                        {/* DB Connection */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineCircleStack /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.dbConnection")}</span>
                                <span className={`settings-kpi-card-indicator ${dbStatus?.connection?.ready ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{dbStatus?.connection?.enabled ? (dbStatus?.connection?.ready ? t('pages.settings.dbReady') : t('pages.settings.dbNotReady')) : t('pages.settings.notEnabled')}</div>
                                <div className="settings-kpi-card-meta" title={t("pages.settings.sqliteJsonDataSource")}>{t("pages.settings.sqliteJsonDataSource")}</div>
                            </div>
                        </div>

                        {/* Read/Write Mode */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineCog6Tooth /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.currentMode")}</span>
                                <span className="settings-kpi-card-indicator is-active" />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{dbStatus ? `R:${dbStatus.currentModes?.readMode || 'file'} / W:${dbStatus.currentModes?.writeMode || 'file'}` : t('pages.settings.dbWaitingDetect')}</div>
                                <div className="settings-kpi-card-meta" title={t("pages.settings.readAndWriteChannelAllocation")}>{t("pages.settings.readAndWriteChannelAllocation")}</div>
                            </div>
                        </div>

                        {/* Write Queue */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineArrowUpTray /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.writeQueue")}</span>
                                <span className={`settings-kpi-card-indicator ${dbStatus?.pendingWrites > 0 ? 'is-warning' : (dbStatus?.writesFailed > 0 ? 'is-danger' : 'is-active')}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{t('pages.settings.dbWritesQueued', { succeeded: dbStatus?.writesSucceeded || 0, failed: dbStatus?.writesFailed || 0, pending: dbStatus?.pendingWrites || 0 })}</div>
                                <div className="settings-kpi-card-meta" title={t("pages.settings.cacheWriteSyncNumber")}>{t("pages.settings.cacheWriteSyncNumber")}</div>
                            </div>
                        </div>

                        {/* Backup Status */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--success"><HiOutlineShieldCheck /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.backupStatusLabel")}</span>
                                <span className={`settings-kpi-card-indicator ${(backupSummaryValue && !backupSummaryValue.includes(t('pages.settings.unhealthyState'))) ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{backupSummaryValue}</div>
                                <div className="settings-kpi-card-meta" title={t("pages.settings.backupBaselineAndPeriod")}>{t("pages.settings.backupBaselineStatus")}</div>
                            </div>
                        </div>

                        {/* Local Backups */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--info"><HiOutlineArrowDownTray /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.localBackupLabel")}</span>
                                <span className={`settings-kpi-card-indicator ${localBackups.length > 0 ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value">{t('pages.settings.localbackupsLengthBackups')}</div>
                                <div className="settings-kpi-card-meta" title={latestLocalBackup?.filename || t('pages.settings.na')}>{latestLocalBackup?.filename || t('pages.settings.na')}</div>
                            </div>
                        </div>

                        {/* Last Restore */}
                        <div className="settings-kpi-card">
                            <div className="settings-kpi-card-header">
                                <span className="settings-kpi-card-icon settings-kpi-card-icon--success"><HiOutlineArrowPath /></span>
                                <span className="settings-kpi-card-title">{t("pages.settings.recentRestoreLabel")}</span>
                                <span className={`settings-kpi-card-indicator ${backupStatus?.lastImport?.restoredAt ? 'is-active' : 'is-inactive'}`} />
                            </div>
                            <div className="settings-kpi-card-body">
                                <div className="settings-kpi-card-value" title={backupStatus?.lastImport?.sourceFilename || t('pages.settings.na')}>{backupStatus?.lastImport?.sourceFilename || t('pages.settings.na')}</div>
                                <div className="settings-kpi-card-meta" title={formatDateTime(backupStatus?.lastImport?.restoredAt, locale)}>{formatDateTime(backupStatus?.lastImport?.restoredAt, locale)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderBackupWorkspace = () => (
        <div className="settings-section-stack">
            <div className="settings-grid settings-grid--basic settings-grid--backup-workspace">
                {renderDatabaseContent({
                    className: 'settings-panel--span-4',
                    compactLayout: true,
                    wrap: false,
                })}
                {renderBackupContent({
                    className: 'settings-panel--span-8',
                    wrap: false,
                })}
            </div>
        </div>
    );

    const renderOperationsWorkspace = () => (
        <div className="settings-section-stack">
            {renderMonitorContent()}
        </div>
    );

    const workspaceSections = [
        {
            id: 'status',
            title: t('pages.settings.systemStatusLabel'),
            eyebrow: 'Status',
            subtitle: t('pages.settings.putTheAlarmLinkDatabaseSchemaAndBac'),
            summary: t('pages.settings.lookAtTheCoreStatusCardAtTheTopFirs'),
            highlights: [],
            navFlag: readyAlertChainCount === 3 && (hasExportBackup || hasLocalBackup)
                ? { label: t('pages.settings.runningStable'), tone: 'success' }
                : { label: t('pages.settings.needsAttention'), tone: 'warning' },
            content: renderStatusContent(),
            heroMode: 'hidden',
        },
        {
            id: 'access',
            title: t('pages.settings.externalAccessTab'),
            eyebrow: 'Access',
            subtitle: t('pages.settings.unifiedAdjustmentOfSiteEntrancePubl'),
            summary: t('pages.settings.keepTheExternalAccessPathClearAndTh'),
            content: renderAccessContent(),
            heroMode: 'hidden',
        },
        {
            id: 'policy',
            title: t('pages.settings.securityAuditTab'),
            eyebrow: 'Security',
            subtitle: t('pages.settings.riskControlThresholdsAuditRetention'),
            summary: t('pages.settings.confirmHighRiskConfirmationRulesAnd'),
            highlights: [],
            content: renderPolicyContent(),
            heroMode: 'hidden',
        },
        {
            id: 'operations',
            title: t('pages.settings.opsNotifyTab'),
            eyebrow: 'Operations',
            subtitle: t('pages.settings.putEmailTelegramAndNodeInspectionAc'),
            summary: t('pages.settings.theLinkStatusAndInspectionOverviewA'),
            content: renderOperationsWorkspace(),
            heroMode: 'hidden',
        },
        {
            id: 'backup',
            title: t('pages.settings.dataBackupTab'),
            eyebrow: 'Backup',
            subtitle: t('pages.settings.databaseSchemaBackupExportAndRecove'),
            summary: t('pages.settings.theDatabaseModeAndBackupBaselineAre'),
            content: renderBackupWorkspace(),
            heroMode: 'hidden',
        },
    ];
    const activeWorkspaceSection = workspaceSections.find((item) => item.id === activeWorkspaceSectionId) || workspaceSections[0];
    const workspaceNavItems = buildSettingsWorkspaceConfig(t).map((item) => ({
        ...item,
        ...(workspaceSections.find((section) => section.id === item.id) || {}),
    }));
    const dirtyWorkspaceLabels = workspaceNavItems
        .filter((item) => dirtyWorkspaceIds.includes(item.id))
        .map((item) => item.label);
    const saveDockSummary = hasPendingChanges
        ? t('pages.settings.dirtyWorkspacesCount', { count: dirtyWorkspaceCount })
        : activeWorkspaceSectionId === 'backup'
            ? t('pages.settings.databaseSwitchingAndBackupOperation')
            : t('pages.settings.thereAreNoUnsavedChangesInTheCurren');

    if (!isAdmin) {
        return (
            <>
                <Header
                    title={t('pages.settings.title')}
                    subtitle={t('pages.settings.limitedSubtitle')}
                />
                <div className="page-content page-enter settings-page">
                    <EmptyState
                        title={t("pages.settings.adminAccessOnlyTitle")}
                        subtitle={t("pages.settings.adminAccessOnlyDesc")}
                        icon={<HiOutlineCog6Tooth style={{ fontSize: '48px' }} />}
                        surface
                        action={(
                            <button type="button" className="btn btn-secondary" onClick={() => { window.location.href = '/account'; }}>
                                {locale === 'en-US' ? 'Go to Account Center' : '前往账户中心'}
                            </button>
                        )}
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <Header
                title={t('pages.settings.title')}
            />
            <div className="page-content page-content--wide page-enter settings-page">
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
                                                    {isDirty ? <span className="badge badge-warning">{t('pages.settings.saveDock.unsaved')}</span> : null}
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
                            heroMode={activeWorkspaceSection.heroMode}
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
                                                ? t('pages.settings.saveDock.saving')
                                                : loading
                                                    ? t('pages.settings.saveDock.loading')
                                                    : hasPendingChanges
                                                        ? t('pages.settings.saveDock.dirty')
                                                        : t('pages.settings.saveDock.ready')}
                                        </span>
                                    </div>
                                    <span className="settings-save-dock-summary">{saveDockSummary}</span>
                                    {hasPendingChanges ? <span className="badge badge-warning">{dirtyWorkspaceLabels.join(' / ')}</span> : null}
                                </div>
                                <div className="settings-save-dock-actions">
                                    {hasPendingChanges ? (
                                        <button className="btn btn-ghost btn-sm" onClick={resetPendingChanges} disabled={loading || saving}>
                                            {t('pages.settings.saveDock.revertChanges')}
                                        </button>
                                    ) : null}
                                    <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={loading || saving || !hasPendingChanges}>
                                        {saving ? <span className="spinner" /> : t('pages.settings.saveDock.saveSettings')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
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
            <ModalShell isOpen={noticeModalOpen} onClose={() => setNoticeModalOpen(false)}>
                <div className="modal modal-wide settings-notice-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">{t("pages.settings.sendUserNoticeModalTitle")}</h3>
                        <button type="button" className="modal-close" onClick={() => setNoticeModalOpen(false)} aria-label={t("pages.settings.closeBtn")} title={t("pages.settings.closeBtn")}>
                            <HiOutlineXMark />
                        </button>
                    </div>
                    <div className="modal-body">
                        <div className="settings-notice-shell">
                            <div className="settings-notice-editor">
                                <div className="text-sm text-muted mb-4">
                                    {locale === 'en-US' ? 'This feature sends emails individually to each recipient; other users\' email addresses are not listed. By default, it targets all users who have an email address and allows attaching a button to access the latest subscription URL.' : '该功能会按单个收件人逐封发送邮件，不会把其他用户邮箱放在同一封邮件里。默认覆盖所有有邮箱地址的用户，并可附带最新地址按钮。'}
                                </div>
                                <div className="grid-auto-220">
                                    <div className="form-group">
                                        <label className="form-label">{t("pages.settings.noticeSubjectLabel")}</label>
                                        <input
                                            className="form-input"
                                            value={noticeDraft.subject}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, subject: event.target.value }))}
                                            placeholder={t("pages.settings.forExampleServiceEntranceAddressCha")}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t("pages.settings.sendScopeLabel")}</label>
                                        <select
                                            className="form-select"
                                            value={noticeDraft.scope}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, scope: event.target.value }))}
                                        >
                                            <option value="all">{t("pages.settings.allEmailUsersOption")}</option>
                                            <option value="verified">{t("pages.settings.verifiedEmailUsersOption")}</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t("pages.settings.noticeContentLabel")}</label>
                                    <textarea
                                        rows={8}
                                        className="form-textarea"
                                        value={noticeDraft.message}
                                        onChange={(event) => setNoticeDraft((prev) => ({ ...prev, message: event.target.value }))}
                                        placeholder={t("pages.settings.describeTheNewUrlNewDomainNameEffec")}
                                    />
                                </div>
                                <div className="grid-auto-220">
                                    <div className="form-group">
                                        <label className="form-label">{t("pages.settings.buttonUrlLabel")}</label>
                                        <input
                                            className="form-input"
                                            value={noticeDraft.actionUrl}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, actionUrl: event.target.value }))}
                                            placeholder="https://example.com/subscription"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t("pages.settings.buttonTextLabel")}</label>
                                        <input
                                            className="form-input"
                                            value={noticeDraft.actionLabel}
                                            onChange={(event) => setNoticeDraft((prev) => ({ ...prev, actionLabel: event.target.value }))}
                                            placeholder={t("pages.settings.viewTheLatestAddress")}
                                        />
                                    </div>
                                </div>
                                <label className="form-check-label w-fit mt-2">
                                    <input
                                        type="checkbox"
                                        aria-label={t("pages.settings.includeDisabledOption")}
                                        checked={noticeDraft.includeDisabled}
                                        onChange={(event) => setNoticeDraft((prev) => ({ ...prev, includeDisabled: event.target.checked }))}
                                    />
                                    <span>{t("pages.settings.includeDisabledOption")}</span>
                                </label>
                            </div>
                            <div className="settings-notice-preview-panel">
                                <div className="settings-notice-preview-head">
                                    <div>
                                        <div className="text-sm font-medium">{t("pages.settings.emailBodyPreviewLabel")}</div>
                                        <div className="text-xs text-muted mt-1">{t("pages.settings.renderedAccordingToTheExampleUserWh")}</div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => fetchNoticePreview(noticeDraft)}
                                        disabled={noticePreviewLoading}
                                    >
                                        {noticePreviewLoading ? <span className="spinner" /> : t('pages.settings.refreshPreviewBtn')}
                                    </button>
                                </div>
                                <div className="settings-notice-preview-meta">
                                    <span className="badge badge-neutral">{t('pages.settings.expectedSendCount', { count: noticePreview?.recipientCount ?? 0 })}</span>
                                    <span className="badge badge-neutral">{t('pages.settings.skippedSendCount', { count: noticePreview?.skippedCount ?? 0 })}</span>
                                    <span className="badge badge-success">{t("pages.settings.sendOneByOneLabel")}</span>
                                </div>
                                {noticePreview?.sampleRecipient?.username || noticePreview?.sampleRecipient?.email ? (
                                    <div className="text-xs text-muted">
                                        {locale === 'en-US' ? 'Sample Recipient: ' : '示例收件人: '}{noticePreview.sampleRecipient.username || noticePreview.sampleRecipient.email}
                                    </div>
                                ) : null}
                                {noticePreviewError ? (
                                    <div className="settings-notice-preview-empty">
                                        <div className="text-sm font-medium">{t("pages.settings.previewLoadFailed")}</div>
                                        <div className="text-sm text-muted">{noticePreviewError}</div>
                                    </div>
                                ) : null}
                                {!noticePreviewError && noticePreviewLoading && !noticePreview ? (
                                    <div className="settings-notice-preview-empty">
                                        <div className="text-sm font-medium">{t("pages.settings.generatingPreview")}</div>
                                        <div className="text-sm text-muted">{t("pages.settings.theBodyIsBeingRenderedAccordingToTh")}</div>
                                    </div>
                                ) : null}
                                {!noticePreviewError && noticePreview?.html ? (
                                    <div className="settings-notice-preview-frame-shell">
                                        <iframe
                                            title={t("pages.settings.userNoticePreviewTitle")}
                                            className="settings-notice-preview-frame"
                                            sandbox=""
                                            srcDoc={noticePreview.html}
                                        />
                                    </div>
                                ) : null}
                                {!noticePreviewError && !noticePreviewLoading && !noticePreview?.html ? (
                                    <div className="settings-notice-preview-empty">
                                        <div className="text-sm font-medium">{t("pages.settings.noPreviewAvailable")}</div>
                                        <div className="text-sm text-muted">{t("pages.settings.afterFillingInTheSubjectBodyOrButto")}</div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => setNoticeModalOpen(false)} disabled={noticeSending}>
                            {locale === 'en-US' ? 'Cancel' : '取消'}
                        </button>
                        <button type="button" className="btn btn-primary" onClick={sendRegisteredUserNotice} disabled={noticeSending || !emailStatus?.configured}>
                            {noticeSending ? <span className="spinner" /> : t('pages.settings.startSendingBtn')}
                        </button>
                    </div>
                </div>
            </ModalShell>
            <TaskProgressModal
                taskId={noticeTaskId}
                title={t("pages.settings.sendUserNoticeModalTitle")}
                onClose={() => setNoticeTaskId(null)}
            />
            <ModalShell isOpen={backupRestoreModalOpen} onClose={() => setBackupRestoreModalOpen(false)}>
                <div className="modal settings-restore-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">{t("pages.settings.restoreSystemBackupTitle")}</h3>
                        <button type="button" className="modal-close" onClick={() => setBackupRestoreModalOpen(false)} aria-label={t("pages.settings.closeBtn")} title={t("pages.settings.closeBtn")}>
                            <HiOutlineXMark />
                        </button>
                    </div>
                    <div className="modal-body">
                        <div className="settings-restore-warning">
                            <HiOutlineExclamationTriangle className="settings-restore-warning-icon" />
                            <div className="settings-restore-warning-copy">
                                <div className="settings-restore-warning-title">{t("pages.settings.restoreWarningTitle")}</div>
                                <div className="text-sm text-muted">{t("pages.settings.itIsRecommendedToExportASnapshotOfT")}</div>
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
                            <div className="settings-restore-dropzone-title">{t("pages.settings.dropzoneTitle")}</div>
                            <div className="settings-restore-dropzone-sub">{t("pages.settings.supportsEncryptedNmsbakExportedByNm")}</div>
                            <div className="settings-restore-file">{backupFile?.name || t('pages.settings.noFileSelected')}</div>
                        </label>

                        {(backupInspectLoading || backupRestoreLoading || backupUploadProgress > 0) && (
                            <div className="settings-restore-progress">
                                <div className="settings-restore-progress-head">
                                    <span>{backupRestoreLoading ? t('pages.settings.restoringUpload') : t('pages.settings.verifyingUpload')}</span>
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
                                    <div className="text-sm font-medium">{t("pages.settings.backupPreviewLabel")}</div>
                                    <span className="badge badge-success">{t("pages.settings.verifiedLabel")}</span>
                                </div>
                                <div className="settings-backup-inspection-grid">
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">{t("pages.settings.backupTimeLabel")}</div>
                                        <div className="text-sm">{backupInspection.createdAt ? new Date(backupInspection.createdAt).toLocaleString('zh-CN') : t('pages.settings.unknownLabel')}</div>
                                    </div>
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">{t("pages.settings.formatVersionLabel")}</div>
                                        <div className="text-sm">{backupInspection.format} v{backupInspection.version}</div>
                                    </div>
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">{t("pages.settings.encryptionStatusLabel")}</div>
                                        <div className="text-sm">{backupInspection.encrypted === false ? t('pages.settings.legacyUnencrypted') : (backupInspection.cipher || 'AES-256-GCM')}</div>
                                    </div>
                                    <div className="settings-backup-inspection-item">
                                        <div className="text-xs text-muted">{t("pages.settings.restorableStoreLabel")}</div>
                                        <div className="text-sm">{(backupInspection.restorableKeys || []).join(', ') || t('pages.settings.noneLabel')}</div>
                                    </div>
                                </div>
                                {(backupInspection.unsupportedKeys || []).length > 0 && (
                                    <div className="text-sm text-muted">{t('pages.settings.unsupportedStoreKeys', { keys: backupInspection.unsupportedKeys.join(', ') })}</div>
                                )}
                                {(backupInspection.missingKeys || []).length > 0 && (
                                    <div className="text-sm text-muted">{t('pages.settings.missingSnapshotKeys', { keys: backupInspection.missingKeys.join(', ') })}</div>
                                )}
                                <div className="text-sm text-muted">
                                    {backupInspection.encrypted === false
                                        ? t('pages.settings.thisIsALegacyUnencryptedBackupForCo')
                                        : t('pages.settings.restoreDecryptionHint', { key: backupInspection.keyHint || 'CREDENTIALS_SECRET' })}
                                </div>
                            </div>
                        )}

                        <label className="settings-restore-checkbox">
                            <input
                                type="checkbox"
                                aria-label={t("pages.settings.confirmRestoreWarningCheckbox")}
                                checked={backupRestoreConfirmed}
                                onChange={(event) => setBackupRestoreConfirmed(event.target.checked)}
                            />
                            {locale === 'en-US' ? 'I confirm that this restore will overwrite current data, and the backup file is from a trusted source.' : '我已确认本次恢复会覆盖当前同名数据，且备份文件来源可信。'}
                        </label>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => setBackupRestoreModalOpen(false)}>
                            {locale === 'en-US' ? 'Cancel' : '取消'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={inspectBackup}
                            disabled={!backupFile || backupInspectLoading || backupRestoreLoading}
                        >
                            {backupInspectLoading ? <span className="spinner" /> : t('pages.settings.previewBackupBtn')}
                        </button>
                        <button
                            type="button"
                            className="btn btn-danger"
                            onClick={restoreBackup}
                            disabled={!backupFile || !backupRestoreConfirmed || backupInspectLoading || backupRestoreLoading}
                        >
                            {backupRestoreLoading ? <span className="spinner" /> : t('pages.settings.performRestoreBtn')}
                        </button>
                    </div>
                </div>
            </ModalShell>
            {backfillTaskId && (
                <TaskProgressModal
                    taskId={backfillTaskId}
                    title={t("pages.settings.dbBackfillProgressTitle")}
                    onClose={() => {
                        setBackfillTaskId(null);
                        fetchDbStatus({ quiet: true });
                    }}
                />
            )}
        </>
    );
}
