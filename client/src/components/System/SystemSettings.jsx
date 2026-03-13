import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { copyToClipboard, formatDateTime as formatDateTimeValue } from '../../utils/format.js';
import {
    HiOutlineArrowDownTray,
    HiOutlineArrowUpTray,
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

function buildDraft(source = null) {
    const settings = source || {};
    const defaultAuditIpGeoProvider = 'ip_api';
    const defaultAuditIpGeoEndpoint = 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN';
    return {
        site: {
            accessPath: normalizeSiteAccessPathInput(settings.site?.accessPath, '/'),
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

const DEFAULT_SETTINGS_TAB = 'basic';
const SETTINGS_TAB_CONFIG = [
    {
        id: 'basic',
        label: '系统参数',
        icon: HiOutlineCog6Tooth,
    },
    {
        id: 'db',
        label: '数据库与存储',
        icon: HiOutlineCircleStack,
    },
    {
        id: 'backup',
        label: '安全与备份',
        icon: HiOutlineShieldCheck,
    },
    {
        id: 'monitor',
        label: '监控诊断',
        icon: HiOutlineServerStack,
    },
    {
        id: 'console',
        label: '节点控制台',
        icon: HiOutlineCommandLine,
    },
];

function resolveSettingsTab(value) {
    return SETTINGS_TAB_CONFIG.some((item) => item.id === value) ? value : DEFAULT_SETTINGS_TAB;
}

function formatDateTime(value, locale = 'zh-CN') {
    if (!value) return locale === 'en-US' ? 'N/A' : '暂无';
    return formatDateTimeValue(value, locale);
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
    const [backupLoading, setBackupLoading] = useState(false);
    const [backupStatusLoading, setBackupStatusLoading] = useState(false);
    const [backupStatus, setBackupStatus] = useState(null);
    const [backupInspectLoading, setBackupInspectLoading] = useState(false);
    const [backupRestoreLoading, setBackupRestoreLoading] = useState(false);
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
    });
    const [latestInviteCodes, setLatestInviteCodes] = useState([]);
    const [latestInviteBatch, setLatestInviteBatch] = useState({
        count: 0,
        usageLimit: 1,
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
    const siteEntryPreview = useMemo(() => {
        if (typeof window === 'undefined') return siteAccessPath;
        return `${window.location.origin}${buildAppEntryPath(siteAccessPath, '/')}`;
    }, [siteAccessPath]);

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
        setInviteCodeActionLoading(true);
        try {
            const res = await api.post('/system/invite-codes', {
                count,
                usageLimit,
            });
            const payload = res.data?.obj || {};
            const codes = Array.isArray(payload.codes)
                ? payload.codes.map((item) => String(item || '').trim()).filter(Boolean)
                : [String(payload.code || '').trim()].filter(Boolean);
            setLatestInviteCodes(codes);
            setLatestInviteBatch({
                count: Number(payload.count || codes.length || 0),
                usageLimit: Number(payload.usageLimit || usageLimit || 1),
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

    const exportBackup = async () => {
        if (!isAdmin) return;
        setBackupLoading(true);
        try {
            const res = await api.get('/system/backup/export', {
                responseType: 'blob',
            });
            const blob = new Blob([res.data], { type: 'application/gzip' });
            const url = window.URL.createObjectURL(blob);
            const contentDisposition = String(res.headers?.['content-disposition'] || '');
            const match = contentDisposition.match(/filename="?([^"]+)"?/i);
            const filename = match?.[1] || 'nms_backup.json.gz';
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            window.URL.revokeObjectURL(url);
            toast.success('系统备份已导出');
            fetchBackupStatus({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '导出备份失败');
        }
        setBackupLoading(false);
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

    const overviewCards = useMemo(() => ([
        {
            title: '站点入口',
            value: siteAccessPath,
            detail: siteAccessPath === '/' ? '当前仍使用根路径提供登录页和管理页。' : '登录页、管理后台和用户页都改为这个入口路径。',
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
            value: backupStatus?.lastExport?.createdAt ? '已有导出快照' : '暂无备份快照',
            detail: backupStatus?.lastExport?.createdAt
                ? `最近导出 ${formatDateTime(backupStatus.lastExport.createdAt, locale)}`
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
        siteAccessPath,
    ]);

    const renderBasicContent = () => (
        <div className="settings-grid settings-grid--basic">
            <div className="card p-4 settings-panel settings-panel--wide">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="站点入口"
                    subtitle="控制登录页、管理后台和用户自助页从哪个路径进入。默认是根路径 `/`。"
                />
                <div className="settings-inline-grid">
                    <div className="form-group mb-0">
                        <label className="form-label">首页访问路径</label>
                        <input
                            className="form-input font-mono"
                            placeholder="/"
                            value={draft.site.accessPath}
                            onChange={(e) => patchField('site', 'accessPath', e.target.value)}
                        />
                        <div className="text-xs text-muted mt-1">例如 `/portal` 或 `/office/nms`。保存后旧路径将不再提供页面。</div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-detail-card mb-0">
                        <div className="text-sm text-muted">当前入口预览</div>
                        <div className="text-base font-semibold font-mono mt-2 break-all">{siteEntryPreview}</div>
                        <div className="text-xs text-muted mt-2">不要使用 `/api`、`/assets`、`/ws` 这类系统保留路径。</div>
                    </div>
                </div>
            </div>

            <div className="card p-4 settings-panel">
                <h3 className="text-lg font-semibold mb-3">任务中心参数</h3>
                <div className="text-xs text-muted mb-3">批量任务（用户操作、流量重置等）的运行与存储参数。</div>
                <div className="form-group">
                    <label className="form-label">任务保留天数</label>
                    <input className="form-input" type="number" min={1} value={draft.jobs.retentionDays} onChange={(e) => patchField('jobs', 'retentionDays', toInt(e.target.value, 90))} />
                    <div className="text-xs text-muted mt-1">历史任务记录的保留期限，超期自动清理。</div>
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

            <div className="card p-4 settings-panel">
                <h3 className="text-lg font-semibold mb-3">风控确认</h3>
                <div className="text-xs text-muted mb-3">控制批量高风险动作的二次确认阈值和确认令牌有效期。</div>
                <div className="form-group">
                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                        <input
                            type="checkbox"
                            checked={draft.security.requireHighRiskConfirmation}
                            onChange={(e) => patchField('security', 'requireHighRiskConfirmation', e.target.checked)}
                        />
                        开启高风险操作二次确认
                    </label>
                </div>
                <div className="form-group">
                    <label className="form-label">中风险阈值</label>
                    <input className="form-input" type="number" min={1} value={draft.security.mediumRiskMinTargets} onChange={(e) => patchField('security', 'mediumRiskMinTargets', toInt(e.target.value, 20))} />
                    <div className="text-xs text-muted mt-1">影响对象数达到该值时按中风险提示。</div>
                </div>
                <div className="form-group">
                    <label className="form-label">高风险阈值</label>
                    <input className="form-input" type="number" min={1} value={draft.security.highRiskMinTargets} onChange={(e) => patchField('security', 'highRiskMinTargets', toInt(e.target.value, 100))} />
                    <div className="text-xs text-muted mt-1">影响对象数达到该值时要求二次确认。</div>
                </div>
                <div className="form-group mb-0">
                    <label className="form-label">确认令牌有效期（秒）</label>
                    <input className="form-input" type="number" min={30} value={draft.security.riskTokenTtlSeconds} onChange={(e) => patchField('security', 'riskTokenTtlSeconds', toInt(e.target.value, 180))} />
                    <div className="text-xs text-muted mt-1">超过该时间后需重新确认高风险操作。</div>
                </div>
            </div>

            <div className="card p-4 settings-panel">
                <h3 className="text-lg font-semibold mb-3">审计参数</h3>
                <div className="text-xs text-muted mb-3">登录、增删改查等操作日志的存储策略。</div>
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

            <div className="card p-4 settings-panel">
                <h3 className="text-lg font-semibold mb-3">审计归属地查询</h3>
                <div className="text-xs text-muted mb-3">控制订阅访问日志里的地区与运营商查询服务。</div>
                <div className="form-group">
                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                        <input
                            type="checkbox"
                            checked={draft.auditIpGeo.enabled}
                            onChange={(e) => patchField('auditIpGeo', 'enabled', e.target.checked)}
                        />
                        开启归属地查询
                    </label>
                </div>
                <div className="form-group">
                    <label className="form-label">服务提供方</label>
                    <input className="form-input" value={draft.auditIpGeo.provider} onChange={(e) => patchField('auditIpGeo', 'provider', e.target.value)} />
                </div>
                <div className="form-group">
                    <label className="form-label">查询地址模板</label>
                    <input className="form-input" value={draft.auditIpGeo.endpoint} onChange={(e) => patchField('auditIpGeo', 'endpoint', e.target.value)} />
                    <div className="text-xs text-muted mt-1">使用 `{`ip`}` 作为 IP 占位符。</div>
                </div>
                <div className="settings-inline-grid">
                    <div className="form-group mb-0">
                        <label className="form-label">超时（毫秒）</label>
                        <input className="form-input" type="number" min={200} value={draft.auditIpGeo.timeoutMs} onChange={(e) => patchField('auditIpGeo', 'timeoutMs', toInt(e.target.value, 1500))} />
                    </div>
                    <div className="form-group mb-0">
                        <label className="form-label">缓存时长（秒）</label>
                        <input className="form-input" type="number" min={60} value={draft.auditIpGeo.cacheTtlSeconds} onChange={(e) => patchField('auditIpGeo', 'cacheTtlSeconds', toInt(e.target.value, 21600))} />
                    </div>
                </div>
            </div>

            <div className="card p-4 settings-panel">
                <h3 className="text-lg font-semibold mb-3">订阅地址</h3>
                <div className="form-group">
                    <label className="form-label">订阅公网地址（可选，建议配置）</label>
                    <input
                        className="form-input"
                        placeholder="https://nms.example.com"
                        value={draft.subscription.publicBaseUrl}
                        onChange={(e) => patchField('subscription', 'publicBaseUrl', e.target.value)}
                    />
                    <div className="text-xs text-muted mt-1">配置后订阅链接将固定使用该地址，避免出现 localhost 或内网地址。</div>
                </div>
                <div className="form-group">
                    <label className="form-label">外部订阅转换器地址（可选）</label>
                    <input
                        className="form-input"
                        placeholder="https://converter.example.com"
                        value={converterBaseUrl}
                        onChange={(e) => patchField('subscription', 'converterBaseUrl', e.target.value)}
                    />
                    <div className="text-xs text-muted mt-1">配置后 Clash / Mihomo / Sing-box / Surge 快捷方式会自动切换到外部转换器。</div>
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
                <div className="text-xs text-muted">未配置转换器时，仍使用 NMS 内置专用配置生成逻辑。</div>
            </div>

            <div className="card p-4 settings-panel settings-panel--wide">
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
                <div className="settings-mini-grid mb-4">
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
                        <div className="text-sm text-muted">邀请码存量</div>
                        <div className="text-lg font-semibold">{inviteCodes.length}</div>
                        <div className="text-xs text-muted mt-1">支持按次数生成和兼容旧单次邀请码。</div>
                    </div>
                </div>
                <div className="form-group">
                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                        <input
                            type="checkbox"
                            checked={draft.registration.inviteOnlyEnabled}
                            onChange={(e) => patchField('registration', 'inviteOnlyEnabled', e.target.checked)}
                            disabled={!registrationEnabled}
                        />
                        开启邀请注册
                    </label>
                    <div className="text-xs text-muted mt-2">
                        {registrationEnabled
                            ? '开启后，注册页必须填写有效邀请码，并跳过邮箱验证码。'
                            : '当前环境已关闭自助注册，这里的邀请模式配置会被保留，但不会开放注册入口。'}
                    </div>
                </div>
                <div className="card p-3 settings-mini-card settings-detail-card mb-3">
                    <div className="text-sm font-medium mb-2">生成参数</div>
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
                        <div className="form-group mb-0 settings-form-actions">
                            <button
                                className="btn btn-primary w-full"
                                type="button"
                                onClick={createInviteCode}
                                disabled={inviteCodeActionLoading}
                            >
                                {inviteCodeActionLoading ? <span className="spinner" /> : '生成邀请码'}
                            </button>
                            <div className="text-xs text-muted mt-1">例如生成 5 个邀请码，每个可注册 2 次。</div>
                        </div>
                    </div>
                </div>
                {latestInviteCodes.length > 0 && (
                    <div className="card p-3 settings-mini-card settings-detail-card mb-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                            <div className="text-sm font-medium">本次生成的邀请码</div>
                            <span className="text-xs text-muted">
                                {latestInviteBatch.count || latestInviteCodes.length} 个邀请码，每个可用 {latestInviteBatch.usageLimit || 1} 次
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
                <div className="settings-table-shell" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>预览</th>
                                <th>状态</th>
                                <th>次数</th>
                                <th>创建时间</th>
                                <th>使用情况</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inviteCodes.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center text-muted">暂无邀请码</td>
                                </tr>
                            ) : (
                                inviteCodes.map((invite) => (
                                    <tr key={invite.id}>
                                        <td data-label="预览" className="cell-mono">{invite.preview}</td>
                                        <td data-label="状态">
                                            <span className={`badge ${invite.status === 'active' ? 'badge-success' : invite.status === 'used' ? 'badge-neutral' : 'badge-danger'}`}>
                                                {invite.status === 'active' ? '可用' : invite.status === 'used' ? '已使用' : '已撤销'}
                                            </span>
                                        </td>
                                        <td data-label="次数" className="text-sm text-muted">
                                            已用 {Number(invite.usedCount || 0)} / {Number(invite.usageLimit || 1)}
                                            {invite.status === 'active' ? ` · 剩余 ${Number(invite.remainingUses || 0)}` : ''}
                                        </td>
                                        <td data-label="创建时间">{formatDateTime(invite.createdAt, locale)}</td>
                                        <td data-label="使用情况" className="text-sm text-muted">
                                            {invite.usedAt
                                                ? `${invite.usedByUsername || invite.usedByUserId || '-'} · ${formatDateTime(invite.usedAt, locale)}`
                                                : invite.revokedAt
                                                    ? `已于 ${formatDateTime(invite.revokedAt, locale)} 撤销`
                                                    : '未使用'}
                                        </td>
                                        <td data-label="操作" className="table-cell-actions">
                                            {invite.status === 'active' ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-danger btn-sm"
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
    );

    const renderMonitorContent = () => (
        <div className="settings-grid settings-grid--monitor">
            <div className="card p-4 settings-panel settings-diagnostics-panel">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="SMTP 诊断"
                    subtitle="SMTP 配置来自服务端 `.env`，这里只展示诊断结果，不回显明文密码。"
                    meta={emailStatus && (
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                            <span className={`badge ${emailConfiguredBadge}`}>{emailConfiguredLabel}</span>
                            <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                            <span className={`badge ${emailVerificationBadge}`}>{emailVerificationLabel}</span>
                        </div>
                    )}
                    actions={(
                        <div className="settings-panel-actions">
                            <button className="btn btn-secondary btn-sm" onClick={testEmailConnection} disabled={emailStatusLoading || emailTestLoading}>
                                {emailTestLoading ? <span className="spinner" /> : '测试'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => fetchEmailStatus()} disabled={emailStatusLoading || emailTestLoading}>
                                {emailStatusLoading ? <span className="spinner" /> : '刷新'}
                            </button>
                        </div>
                    )}
                />
                {!emailStatus ? (
                    <div className="text-sm text-muted">尚未加载 SMTP 状态。</div>
                ) : (
                    <>
                        <div className="settings-mini-grid mb-3">
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
                                <div className="text-sm text-muted">发件人</div>
                                <div className="text-lg font-semibold">{emailStatus.from || '-'}</div>
                                <div className="text-xs text-muted">账号 {emailStatus.userMasked || '-'}</div>
                            </div>
                            <div className="card p-3 settings-mini-card">
                                <div className="text-sm text-muted">加密模式</div>
                                <div className="text-lg font-semibold">{emailStatus.secure ? 'SSL/TLS' : 'STARTTLS/Plain'}</div>
                                <div className="text-xs text-muted">
                                    {emailStatus.requireTLS ? 'requireTLS' : (emailStatus.ignoreTLS ? 'ignoreTLS' : 'auto TLS')}
                                </div>
                            </div>
                        </div>
                        <div className="card p-3 mt-3 settings-mini-card settings-detail-card">
                            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                <div className="text-sm font-medium">最近连接测试</div>
                                <span className={`badge ${emailVerificationBadge}`}>{emailVerificationLabel}</span>
                            </div>
                            <div className="text-sm">最近测试: {formatDateTime(emailStatus.lastVerification?.ts, locale)}</div>
                            <div className="text-sm text-muted mt-1">错误摘要: {emailStatus.lastVerification?.error || '-'}</div>
                            <div className="text-sm text-muted mt-1">诊断建议: {emailStatus.lastVerification?.hint || '-'}</div>
                        </div>
                        <div className="card p-3 mt-3 settings-mini-card settings-detail-card">
                            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                <div className="text-sm font-medium">最近发送结果</div>
                                <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                            </div>
                            <div className="text-sm">最近发送: {formatDateTime(emailStatus.lastDelivery?.ts, locale)}</div>
                            <div className="text-sm text-muted mt-1">发送类型: {emailStatus.lastDelivery?.type || '-'}</div>
                            <div className="text-sm text-muted mt-1">错误摘要: {emailStatus.lastDelivery?.error || '-'}</div>
                            <div className="text-sm text-muted mt-1">诊断建议: {emailStatus.lastDelivery?.hint || '-'}</div>
                        </div>
                    </>
                )}
            </div>

            <div className="card p-4 settings-panel settings-monitor-panel">
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
                <div className="settings-mini-grid mb-3">
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
            </div>
        </div>
    );

    const renderBackupContent = () => (
        <div className="settings-section-stack">
            <div className="card p-4 settings-panel settings-backup-panel">
                <SectionHeader
                    className="mb-3"
                    compact
                    title="系统备份"
                    subtitle="导出当前 NMS store 快照为 gzip 备份包；恢复前可先上传备份文件进行预览校验。"
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchBackupStatus()} disabled={backupStatusLoading}>
                            {backupStatusLoading ? <span className="spinner" /> : '刷新状态'}
                        </button>
                    )}
                />
                <div className="settings-mini-grid mb-3">
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">可备份 Store</div>
                        <div className="text-lg font-semibold">{backupStatus?.storeKeys?.length || 0}</div>
                        <div className="text-xs text-muted mt-1">{(backupStatus?.storeKeys || []).join(', ') || '暂无'}</div>
                    </div>
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">最近导出</div>
                        <div className="text-lg font-semibold">{formatDateTime(backupStatus?.lastExport?.createdAt, locale)}</div>
                        <div className="text-xs text-muted mt-1">{backupStatus?.lastExport?.filename || '-'}</div>
                    </div>
                    <div className="card p-3 settings-mini-card">
                        <div className="text-sm text-muted">最近恢复</div>
                        <div className="text-lg font-semibold">{formatDateTime(backupStatus?.lastImport?.restoredAt, locale)}</div>
                        <div className="text-xs text-muted mt-1">{backupStatus?.lastImport?.sourceFilename || '-'}</div>
                    </div>
                </div>
                <div className="settings-backup-actions mt-3">
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">导出当前快照</div>
                        <div className="text-xs text-muted mt-1">下载当前系统 store 的 gzip 快照，适合在变更前留存一份回滚点。</div>
                        <div className="settings-backup-action-footer">
                            <button className="btn btn-primary btn-sm" onClick={exportBackup} disabled={backupLoading || backupRestoreLoading}>
                                {backupLoading ? <span className="spinner" /> : <><HiOutlineArrowDownTray /> 导出 gzip 备份</>}
                            </button>
                        </div>
                    </div>
                    <div className="card p-3 settings-mini-card settings-backup-action-card">
                        <div className="text-sm font-medium">恢复已有备份</div>
                        <div className="text-xs text-muted mt-1">通过恢复向导上传并预览 `.gzip` 备份包，再执行覆盖恢复，避免误触高风险动作。</div>
                        <div className="settings-backup-action-footer">
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setBackupRestoreModalOpen(true);
                                    setBackupRestoreConfirmed(false);
                                    setBackupUploadProgress(0);
                                }}
                                disabled={backupLoading || backupRestoreLoading}
                            >
                                <HiOutlineArrowUpTray /> 导入 / 恢复备份
                            </button>
                        </div>
                    </div>
                </div>
                {backupInspection && (
                    <div className="card p-3 mt-3 settings-mini-card settings-detail-card settings-backup-inspection">
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                            <div className="text-sm font-medium">备份预览</div>
                            <span className="badge badge-success">可校验</span>
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
                        <div className="settings-mini-grid mb-4">
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
                                <h4 className="text-base font-semibold mb-2">切换读写模式</h4>
                                <div className="text-xs text-muted mb-2">运行时切换数据源，无需重启。file=本地 JSON，db=PostgreSQL，dual=同时写两者。</div>
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
                                <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit mb-3">
                                    <input
                                        type="checkbox"
                                        checked={dbModeDraft.hydrateOnReadDb}
                                        onChange={(event) => setDbModeDraft((prev) => ({ ...prev, hydrateOnReadDb: event.target.checked }))}
                                        disabled={!isAdmin}
                                    />
                                    read=db 时同步加载到内存缓存
                                </label>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={switchDbMode}
                                    disabled={dbSwitchLoading || !dbStatus.connection?.enabled || !isAdmin}
                                >
                                    {dbSwitchLoading ? <span className="spinner" /> : '应用模式'}
                                </button>
                            </div>

                            <div className="card p-3 settings-mini-card settings-db-control-card">
                                <h4 className="text-base font-semibold mb-2">Store 回填到数据库</h4>
                                <div className="text-xs text-muted mb-2">将本地 JSON 文件数据导入 PostgreSQL。脱敏写入会隐藏密码等敏感字段。</div>
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
                                <div className="flex gap-3 mb-3 flex-wrap">
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
                                <button
                                    className={`btn btn-sm ${dbBackfillDraft.dryRun ? 'btn-secondary' : 'btn-danger'}`}
                                    onClick={runDbBackfill}
                                    disabled={dbBackfillLoading || !dbStatus.connection?.enabled || !isAdmin}
                                >
                                    {dbBackfillLoading ? <span className="spinner" /> : (dbBackfillDraft.dryRun ? '执行预演' : '执行回填')}
                                </button>
                                {dbBackfillResult && (
                                    <div className="text-sm text-muted mt-3">
                                        total: {dbBackfillResult.total || 0}，success: {dbBackfillResult.success || 0}，failed: {dbBackfillResult.failed || 0}
                                    </div>
                                )}
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
                <div className="card mb-6 settings-toolbar settings-overview-card">
                    <div className="settings-overview-bar">
                        <div className="settings-overview-status" aria-live="polite">
                            <span className={`badge ${settings ? 'badge-success' : 'badge-neutral'}`}>
                                {settings ? '配置快照已加载' : '等待加载配置'}
                            </span>
                            {saving ? <span className="badge badge-info">正在保存设置</span> : null}
                        </div>
                        <div className="settings-overview-actions settings-panel-actions">
                            <button className="btn btn-secondary btn-sm" onClick={refreshAllSections} disabled={loading}>
                                刷新
                            </button>
                            <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={loading || saving}>
                                {saving ? <span className="spinner" /> : '保存设置'}
                            </button>
                        </div>
                    </div>
                </div>
                
                <div className="settings-shell">
                    <aside className="card settings-nav">
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
                    </aside>

                    <div className="settings-main">
                        <div className="settings-summary-grid mb-6">
                            {overviewCards.map((item) => (
                                <div key={item.title} className="card settings-summary-card">
                                    <div className="settings-summary-label">{item.title}</div>
                                    <div className="settings-summary-value">{item.value}</div>
                                    <div className="settings-summary-detail">{item.detail}</div>
                                    <span className={`badge settings-summary-badge ${
                                        item.tone === 'success'
                                            ? 'badge-success'
                                            : item.tone === 'warning'
                                                ? 'badge-warning'
                                                : item.tone === 'danger'
                                                    ? 'badge-danger'
                                                    : 'badge-neutral'
                                    }`}
                                    >
                                        {item.tone === 'success' ? '正常' : item.tone === 'warning' ? '关注' : item.tone === 'danger' ? '关闭' : '待检查'}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="card p-4 settings-panel settings-tab-panel">
                            {activeTab === 'console' ? (
                                <div className="settings-console-host">
                                    <ServerManagement embedded />
                                </div>
                            ) : (
                                <fieldset className="settings-fieldset">
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
                                <div className="text-sm text-muted">建议先导出一份当前系统快照，再选择备份文件进行预览校验。恢复后，备份中包含的数据会替换当前运行数据。</div>
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
                                accept=".gz,.json.gz,application/gzip"
                                onChange={(event) => setSelectedBackupFile(event.target.files?.[0] || null)}
                            />
                            <div className="settings-restore-dropzone-title">拖拽备份文件到这里，或点击选择文件</div>
                            <div className="settings-restore-dropzone-sub">支持 `NMS` 导出的 `.gz / .json.gz` 备份包</div>
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
