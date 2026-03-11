import React, { useEffect, useState } from 'react';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import {
    HiOutlineArrowDownTray,
    HiOutlineArrowUpTray,
    HiOutlineCog6Tooth,
    HiOutlineExclamationTriangle,
    HiOutlineXMark,
} from 'react-icons/hi2';
import TaskProgressModal from '../Tasks/TaskProgressModal.jsx';
import ModalShell from '../UI/ModalShell.jsx';

function toInt(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) ? parsed : fallback;
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

function buildDraft(source = null) {
    const settings = source || {};
    return {
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
        },
        auditIpGeo: {
            enabled: settings.auditIpGeo?.enabled === true,
            provider: toText(settings.auditIpGeo?.provider, 'ipip_myip'),
            endpoint: toText(settings.auditIpGeo?.endpoint, 'http://myip.ipip.net/?ip={ip}'),
            timeoutMs: toInt(settings.auditIpGeo?.timeoutMs, 1500),
            cacheTtlSeconds: toInt(settings.auditIpGeo?.cacheTtlSeconds, 21600),
        },
    };
}

export default function SystemSettings() {
    const { t } = useI18n();
    const { user } = useAuth();
    const confirmAction = useConfirm();
    const isAdmin = user?.role === 'admin';

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
    }, [isAdmin]);

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
            toast.success('系统设置已更新');
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '保存失败');
        }
        setSaving(false);
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

    if (!isAdmin) {
        return (
            <>
                <Header
                    title={t('pages.settings.title')}
                    subtitle={t('pages.settings.limitedSubtitle')}
                    eyebrow={t('pages.settings.eyebrow')}
                />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineCog6Tooth /></div>
                        <div className="empty-state-text">仅管理员可访问系统设置</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header
                title={t('pages.settings.title')}
                subtitle={t('pages.settings.subtitle')}
                eyebrow={t('pages.settings.eyebrow')}
            />
            <div className="page-content page-enter">
                <div className="flex items-center justify-between mb-6 settings-toolbar">
                    <div className="text-sm text-muted settings-toolbar-copy">
                        {settings?.updatedAt ? `最近更新: ${new Date(settings.updatedAt).toLocaleString('zh-CN')}` : '系统参数'}
                    </div>
                    <div className="flex gap-2 settings-toolbar-actions">
                        <button className="btn btn-secondary btn-sm" onClick={fetchSettings} disabled={loading}>刷新</button>
                        <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={loading || saving}>
                            {saving ? <span className="spinner" /> : '保存设置'}
                        </button>
                    </div>
                </div>

                <fieldset className="settings-fieldset" disabled={!isAdmin} style={{ border: 'none', margin: 0, padding: 0 }}>
                    <div className="grid-auto-280 settings-grid">
                        <div className="card p-4 settings-section-banner" style={{ gridColumn: '1 / -1' }}>
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">系统参数</div>
                            <div className="text-sm text-muted">影响任务保留、审计分页和订阅地址等全局行为。</div>
                        </div>
                        <div className="card p-4 settings-panel">
                            <h3 className="text-lg font-semibold mb-3">任务中心参数</h3>
                            <div className="text-xs text-muted mb-3">批量任务（用户操作、流量重置等）的运行与存储参数</div>
                            <div className="form-group">
                                <label className="form-label">任务保留天数</label>
                                <input className="form-input" type="number" min={1} value={draft.jobs.retentionDays} onChange={(e) => patchField('jobs', 'retentionDays', toInt(e.target.value, 90))} />
                                <div className="text-xs text-muted mt-1">历史任务记录的保留期限，超期自动清理</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">任务分页最大条数</label>
                                <input className="form-input" type="number" min={20} value={draft.jobs.maxPageSize} onChange={(e) => patchField('jobs', 'maxPageSize', toInt(e.target.value, 200))} />
                                <div className="text-xs text-muted mt-1">任务列表单页最大记录数</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">任务最大保留记录</label>
                                <input className="form-input" type="number" min={100} value={draft.jobs.maxRecords} onChange={(e) => patchField('jobs', 'maxRecords', toInt(e.target.value, 2000))} />
                                <div className="text-xs text-muted mt-1">系统保留的历史任务上限</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">批量并发上限</label>
                                <input className="form-input" type="number" min={1} value={draft.jobs.maxConcurrency} onChange={(e) => patchField('jobs', 'maxConcurrency', toInt(e.target.value, 10))} />
                                <div className="text-xs text-muted mt-1">允许的最大并行操作数</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">默认并发</label>
                                <input className="form-input" type="number" min={1} value={draft.jobs.defaultConcurrency} onChange={(e) => patchField('jobs', 'defaultConcurrency', toInt(e.target.value, 5))} />
                                <div className="text-xs text-muted mt-1">新建任务时的默认并行数</div>
                            </div>
                        </div>

                        <div className="card p-4 settings-panel">
                            <h3 className="text-lg font-semibold mb-3">审计参数</h3>
                            <div className="text-xs text-muted mb-3">操作日志（登录、增删改查等）的存储策略</div>
                            <div className="form-group">
                                <label className="form-label">审计保留天数</label>
                                <input className="form-input" type="number" min={1} value={draft.audit.retentionDays} onChange={(e) => patchField('audit', 'retentionDays', toInt(e.target.value, 365))} />
                                <div className="text-xs text-muted mt-1">日志保留期限，超期自动清理</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">审计分页最大条数</label>
                                <input className="form-input" type="number" min={20} value={draft.audit.maxPageSize} onChange={(e) => patchField('audit', 'maxPageSize', toInt(e.target.value, 200))} />
                                <div className="text-xs text-muted mt-1">日志列表单页最大记录数</div>
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
                                <div className="text-xs text-muted mt-1">
                                    配置后订阅链接将固定使用该地址，避免出现 localhost 或内网地址。
                                </div>
                            </div>
                            <div className="text-xs text-muted">
                                Clash、Mihomo、sing-box 等常见客户端的专用订阅地址已直接内置到订阅页面，不再依赖外部订阅转换器。
                            </div>
                        </div>

                        <div className="card p-4 settings-section-banner" style={{ gridColumn: '1 / -1' }}>
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">运行诊断</div>
                            <div className="text-sm text-muted">只读查看当前邮件、备份和健康巡检状态，高风险操作仍需单独确认。</div>
                        </div>
                        <div className="card p-4 settings-panel settings-diagnostics-panel">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-lg font-semibold">SMTP 诊断</h3>
                                    {emailStatus && (
                                        <>
                                            <span className={`badge ${emailConfiguredBadge}`}>{emailConfiguredLabel}</span>
                                            <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                                            <span className={`badge ${emailVerificationBadge}`}>{emailVerificationLabel}</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex gap-2 settings-panel-actions">
                                    <button className="btn btn-secondary btn-sm" onClick={testEmailConnection} disabled={emailStatusLoading || emailTestLoading}>
                                        {emailTestLoading ? <span className="spinner" /> : '测试'}
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => fetchEmailStatus()} disabled={emailStatusLoading || emailTestLoading}>
                                        {emailStatusLoading ? <span className="spinner" /> : '刷新'}
                                    </button>
                                </div>
                            </div>
                            {!emailStatus ? (
                                <div className="text-sm text-muted">尚未加载 SMTP 状态</div>
                            ) : (
                                <>
                                    <div className="text-xs text-muted mb-3">SMTP 配置来自服务端 `.env`，修改后需要重启后端服务。此处仅展示诊断信息，不返回明文密码。</div>
                                    <div className="grid gap-3 settings-mini-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
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
                                        <div className="text-sm">最近测试: {emailStatus.lastVerification?.ts ? new Date(emailStatus.lastVerification.ts).toLocaleString('zh-CN') : '暂无'}</div>
                                        <div className="text-sm text-muted mt-1">错误摘要: {emailStatus.lastVerification?.error || '-'}</div>
                                        <div className="text-sm text-muted mt-1">诊断建议: {emailStatus.lastVerification?.hint || '-'}</div>
                                    </div>
                                    <div className="card p-3 mt-3 settings-mini-card settings-detail-card">
                                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                                            <div className="text-sm font-medium">最近发送结果</div>
                                            <span className={`badge ${emailDeliveryBadge}`}>{emailDeliveryLabel}</span>
                                        </div>
                                        <div className="text-sm">最近发送: {emailStatus.lastDelivery?.ts ? new Date(emailStatus.lastDelivery.ts).toLocaleString('zh-CN') : '暂无'}</div>
                                        <div className="text-sm text-muted mt-1">发送类型: {emailStatus.lastDelivery?.type || '-'}</div>
                                        <div className="text-sm text-muted mt-1">错误摘要: {emailStatus.lastDelivery?.error || '-'}</div>
                                        <div className="text-sm text-muted mt-1">诊断建议: {emailStatus.lastDelivery?.hint || '-'}</div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="card p-4 settings-panel settings-backup-panel">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-lg font-semibold">系统备份</h3>
                                <button className="btn btn-secondary btn-sm" onClick={() => fetchBackupStatus()} disabled={backupStatusLoading}>
                                    {backupStatusLoading ? <span className="spinner" /> : '刷新状态'}
                                </button>
                            </div>
                            <div className="text-xs text-muted mb-3">导出当前 NMS store 快照为 gzip 备份包；恢复前可先上传备份文件进行预览校验。</div>
                            <div className="grid gap-3 settings-mini-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">可备份 Store</div>
                                    <div className="text-lg font-semibold">{backupStatus?.storeKeys?.length || 0}</div>
                                    <div className="text-xs text-muted mt-1">{(backupStatus?.storeKeys || []).join(', ') || '暂无'}</div>
                                </div>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">最近导出</div>
                                    <div className="text-lg font-semibold">{backupStatus?.lastExport?.createdAt ? new Date(backupStatus.lastExport.createdAt).toLocaleString('zh-CN') : '暂无'}</div>
                                    <div className="text-xs text-muted mt-1">{backupStatus?.lastExport?.filename || '-'}</div>
                                </div>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">最近恢复</div>
                                    <div className="text-lg font-semibold">{backupStatus?.lastImport?.restoredAt ? new Date(backupStatus.lastImport.restoredAt).toLocaleString('zh-CN') : '暂无'}</div>
                                    <div className="text-xs text-muted mt-1">{backupStatus?.lastImport?.sourceFilename || '-'}</div>
                                </div>
                            </div>
                            <div className="settings-backup-actions mt-3">
                                <div className="card p-3 settings-mini-card settings-backup-action-card">
                                    <div className="text-sm font-medium">导出当前快照</div>
                                    <div className="text-xs text-muted mt-1">下载当前系统 store 的 gzip 快照，适合在变更前先留存一份回滚点。</div>
                                    <div className="settings-backup-action-footer">
                                        <button className="btn btn-primary btn-sm" onClick={exportBackup} disabled={backupLoading || backupRestoreLoading}>
                                            {backupLoading ? <span className="spinner" /> : <><HiOutlineArrowDownTray /> 导出 gzip 备份</>}
                                        </button>
                                    </div>
                                </div>
                                <div className="card p-3 settings-mini-card settings-backup-action-card">
                                    <div className="text-sm font-medium">恢复已有备份</div>
                                    <div className="text-xs text-muted mt-1">通过恢复向导上传并预览 `.gzip` 备份包，再执行覆盖恢复，避免在面板里直接误触高风险动作。</div>
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

                        <div className="card p-4 settings-panel settings-monitor-panel">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-lg font-semibold">节点健康监控</h3>
                                <div className="flex gap-2">
                                    <button className="btn btn-secondary btn-sm" onClick={() => fetchMonitorStatus()} disabled={monitorStatusLoading}>
                                        {monitorStatusLoading ? <span className="spinner" /> : '刷新状态'}
                                    </button>
                                    <button className="btn btn-primary btn-sm" onClick={runMonitorCheck} disabled={monitorLoading}>
                                        {monitorLoading ? <span className="spinner" /> : '立即巡检'}
                                    </button>
                                </div>
                            </div>
                            <div className="text-xs text-muted mb-3">后台会定期巡检已配置节点，并通过右上角通知中心推送异常/恢复告警。</div>
                            <div className="grid gap-3 settings-mini-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">监控状态</div>
                                    <div className="text-lg font-semibold">{monitorStatus?.healthMonitor?.running ? '运行中' : '未运行'}</div>
                                    <div className="text-xs text-muted mt-1">周期 {Math.round(Number(monitorStatus?.healthMonitor?.intervalMs || 0) / 60000) || 0} 分钟</div>
                                </div>
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">最近巡检</div>
                                    <div className="text-lg font-semibold">{monitorStatus?.healthMonitor?.lastRunAt ? new Date(monitorStatus.healthMonitor.lastRunAt).toLocaleString('zh-CN') : '暂无'}</div>
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
                </fieldset>

                <div className="card p-4 mt-6 settings-panel settings-danger-panel">
                    <h3 className="text-lg font-semibold mb-3">凭据轮换</h3>
                    <div className="text-xs text-muted mb-3">更换 CREDENTIALS_SECRET 后，将已保存的节点凭据用新密钥重新加密。Dry Run 仅预演不修改数据。</div>
                    {isAdmin ? (
                        <div className="flex gap-2 mb-3">
                            <button className="btn btn-secondary btn-sm" onClick={() => rotateCredentials(true)} disabled={rotateLoading}>
                                {rotateLoading ? <span className="spinner" /> : 'Dry Run'}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => rotateCredentials(false)} disabled={rotateLoading}>
                                {rotateLoading ? <span className="spinner" /> : '执行轮换'}
                            </button>
                        </div>
                    ) : (
                        <div className="text-sm text-muted mb-3">当前角色仅可查看，凭据轮换仅管理员可执行。</div>
                    )}
                    {rotateResult && (
                        <div className="text-sm text-muted">
                            扫描字段: {rotateResult.scannedFields}，轮换字段: {rotateResult.rotatedFields}，失败: {rotateResult.failedFields}
                        </div>
                    )}
                </div>

                <div className="card p-4 mt-6 settings-panel settings-db-panel">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold">数据库接入状态</h3>
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchDbStatus()} disabled={dbLoading}>
                            {dbLoading ? <span className="spinner" /> : '刷新状态'}
                        </button>
                    </div>

                    {!dbStatus ? (
                        <div className="text-sm text-muted">尚未加载数据库状态</div>
                    ) : (
                        <>
                            <div
                                className="grid gap-3 mb-4 settings-mini-grid"
                                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}
                            >
                                <div className="card p-3 settings-mini-card">
                                    <div className="text-sm text-muted">DB 连接</div>
                                    <div className="text-lg font-semibold">
                                        {dbStatus.connection?.enabled ? (dbStatus.connection?.ready ? '已就绪' : '未就绪') : '未启用'}
                                    </div>
                                    <div className="text-xs text-muted">{dbStatus.connection?.error || '无错误'}</div>
                                    <div className="text-xs text-muted mt-1">需在 .env 中配置 DB_ENABLED=true 和 DB_URL</div>
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
                                    <div className="text-xs text-muted">最后写入: {dbStatus.lastWriteAt ? new Date(dbStatus.lastWriteAt).toLocaleString('zh-CN') : '暂无'}</div>
                                </div>
                            </div>

                            <div className="grid-auto-280 settings-db-grid">
                                <div className="card p-3 settings-mini-card settings-db-control-card">
                                    <h4 className="text-base font-semibold mb-2">切换读写模式</h4>
                                    <div className="text-xs text-muted mb-2">运行时切换数据源，无需重启。file=本地JSON，db=PostgreSQL，dual=同时写两者</div>
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
                                        <label className="form-label">Store Keys (逗号分隔，留空=全部)</label>
                                        <input
                                            className="form-input"
                                            value={dbBackfillDraft.keysText}
                                            onChange={(event) => setDbBackfillDraft((prev) => ({ ...prev, keysText: event.target.value }))}
                                            placeholder={(dbStatus.storeKeys || []).join(', ')}
                                            disabled={!isAdmin}
                                        />
                                        <div className="text-xs text-muted mt-1">
                                            可选: {(dbStatus.storeKeys || []).join(', ') || '暂无'}
                                        </div>
                                    </div>
                                    <div className="flex gap-3 mb-3">
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
                                                        <td>{item.store_key}</td>
                                                        <td>{item.payload_size || 0}</td>
                                                        <td>{item.updated_at ? new Date(item.updated_at).toLocaleString('zh-CN') : '-'}</td>
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
