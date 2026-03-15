import { Router } from 'express';
import multer from 'multer';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import serverStore from '../store/serverStore.js';
import userStore from '../store/userStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import inviteCodeStore from '../store/inviteCodeStore.js';
import { appendSecurityAudit } from '../lib/securityAudit.js';
import config from '../config.js';
import batchRiskTokenStore, {
    assessBatchRisk,
    buildBatchRiskOperationKey,
} from '../lib/batchRiskControl.js';
import { getSnapshotStatus, listSnapshotsMeta } from '../db/snapshots.js';
import { getStoreModes, getSupportedModes } from '../db/runtimeModes.js';
import { saveRuntimeModesToDb } from '../db/modeState.js';
import { isDbEnabled, isDbReady } from '../db/client.js';
import {
    backfillStoresToDatabase,
    hydrateStoresFromDatabase,
    listStoreKeys,
} from '../store/storeRegistry.js';
import taskQueue, { TASK_STATUS } from '../lib/taskQueue.js';
import notificationService from '../lib/notifications.js';
import { getEmailStatus, verifySmtpConnection } from '../lib/mailer.js';
import alertEngine from '../lib/alertEngine.js';
import serverHealthMonitor from '../lib/serverHealthMonitor.js';
import telegramAlertService from '../lib/telegramAlertService.js';
import {
    createBackupArchive,
    deleteLocalBackupArchive,
    getBackupStatus,
    inspectBackupArchive,
    readLocalBackupArchive,
    restoreBackupArchive,
    restoreLocalBackupArchive,
    saveBackupArchiveLocally,
} from '../lib/systemBackup.js';
import { normalizeBoolean } from '../lib/normalize.js';
import {
    buildRegisteredUserNoticePreview,
    normalizeNoticeScope,
    resolveRegisteredUserNoticeRecipients,
    sendRegisteredUserNoticeCampaign,
} from '../services/registeredUserNoticeService.js';

const router = Router();
const backupUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
});

function normalizeMode(value, allowed = [], fallback = '') {
    const text = String(value || '').trim().toLowerCase();
    if (allowed.includes(text)) return text;
    return fallback;
}

function normalizeStoreKeys(input) {
    if (typeof input === 'string') {
        return Array.from(new Set(
            input
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
        ));
    }
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(input.map((item) => String(item || '').trim()).filter(Boolean)));
}

router.use(authMiddleware);

router.get('/settings', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: systemSettingsStore.getAll(),
    });
});

router.get('/invite-codes', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: inviteCodeStore.list(),
    });
});

router.post('/invite-codes', adminOnly, (req, res) => {
    try {
        const created = inviteCodeStore.create({
            createdBy: req.user?.username || req.user?.role || 'admin',
            count: req.body?.count,
            usageLimit: req.body?.usageLimit,
            subscriptionDays: req.body?.subscriptionDays,
        });
        appendSecurityAudit('invite_code_created', req, {
            inviteId: created.invite?.id || '',
            preview: created.invite?.preview || '',
            count: created.count || 1,
            usageLimit: created.usageLimit || 1,
            subscriptionDays: created.subscriptionDays || 0,
        });
        const createdCount = Number(created.count || created.codes?.length || 1);
        return res.json({
            success: true,
            msg: createdCount > 1 ? `已生成 ${createdCount} 个邀请码` : '邀请码已创建',
            obj: created,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || '创建邀请码失败',
        });
    }
});

router.delete('/invite-codes/:id', adminOnly, (req, res) => {
    try {
        const revoked = inviteCodeStore.revoke(req.params.id, {
            revokedBy: req.user?.username || req.user?.role || 'admin',
        });
        appendSecurityAudit('invite_code_revoked', req, {
            inviteId: revoked.id,
            preview: revoked.preview,
        }, { outcome: 'success' });
        return res.json({
            success: true,
            msg: '邀请码已撤销',
            obj: revoked,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || '撤销邀请码失败',
        });
    }
});

router.get('/email/status', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: getEmailStatus(),
    });
});

router.post('/email/test', adminOnly, async (req, res) => {
    try {
        const result = await verifySmtpConnection();
        appendSecurityAudit('smtp_connection_verified', req, {
            host: getEmailStatus().host,
            service: getEmailStatus().service,
            success: true,
        });
        return res.json({
            success: true,
            msg: result.message || 'SMTP 连接验证成功',
            obj: getEmailStatus(),
        });
    } catch (error) {
        appendSecurityAudit('smtp_connection_verified', req, {
            host: getEmailStatus().host,
            service: getEmailStatus().service,
            success: false,
            error: error.message || 'SMTP 连接验证失败',
            code: error.code || '',
            responseCode: Number.isFinite(Number(error.responseCode)) ? Number(error.responseCode) : null,
            command: error.command || '',
        });
        return res.status(400).json({
            success: false,
            msg: error.message || 'SMTP 连接验证失败',
            obj: {
                ...getEmailStatus(),
                lastVerification: getEmailStatus().lastVerification,
            },
        });
    }
});

router.post('/email/notice-users/preview', adminOnly, (req, res) => {
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    const actionUrl = String(req.body?.actionUrl || '').trim();
    const actionLabel = String(req.body?.actionLabel || '').trim() || '查看详情';
    const scope = normalizeNoticeScope(req.body?.scope);
    const includeDisabled = normalizeBoolean(req.body?.includeDisabled, true);

    return res.json({
        success: true,
        obj: buildRegisteredUserNoticePreview({
            subject,
            message,
            actionUrl,
            actionLabel,
            scope,
            includeDisabled,
        }),
    });
});

router.post('/email/notice-users', adminOnly, async (req, res) => {
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    const actionUrl = String(req.body?.actionUrl || '').trim();
    const actionLabel = String(req.body?.actionLabel || '').trim() || '查看详情';
    const scope = normalizeNoticeScope(req.body?.scope);
    const includeDisabled = normalizeBoolean(req.body?.includeDisabled, true);

    if (!subject) {
        return res.status(400).json({
            success: false,
            msg: '通知主题不能为空',
        });
    }
    if (!message) {
        return res.status(400).json({
            success: false,
            msg: '通知内容不能为空',
        });
    }
    if (!getEmailStatus().configured) {
        return res.status(400).json({
            success: false,
            msg: 'SMTP 未配置，无法发送变更通知',
        });
    }

    const actor = req.user?.username || req.user?.userId || 'admin';
    const preview = resolveRegisteredUserNoticeRecipients(userStore.getAll(), { scope, includeDisabled });
    if (preview.recipients.length === 0) {
        return res.status(400).json({
            success: false,
            msg: '没有可发送的已注册用户邮箱',
            obj: {
                recipientCount: 0,
                skippedCount: preview.skipped.length,
            },
        });
    }

    const { taskId, signal } = taskQueue.create({
        type: 'registered_user_notice',
        actor,
        meta: {
            subject,
            scope,
            includeDisabled,
            recipientCount: preview.recipients.length,
            skippedCount: preview.skipped.length,
        },
    });
    taskQueue.start(taskId);

    void (async () => {
        try {
            const result = await sendRegisteredUserNoticeCampaign(
                {
                    subject,
                    message,
                    actionUrl,
                    actionLabel,
                    scope,
                    includeDisabled,
                },
                {
                    signal,
                    onProgress: ({ step, total, label }) => {
                        taskQueue.updateProgress(taskId, { step, total, label });
                    },
                }
            );

            taskQueue.complete(taskId, result);
            notificationService.notify({
                type: 'registered_user_notice',
                severity: result.failed > 0 ? 'warning' : 'info',
                title: result.failed > 0 ? '变更通知部分发送失败' : '变更通知已发送',
                body: `成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}。`,
                meta: {
                    taskId,
                    subject,
                    ...result,
                },
            });
            appendSecurityAudit('registered_user_notice', { user: { username: actor } }, {
                subject,
                scope,
                includeDisabled,
                recipientCount: result.total,
                success: result.success,
                failed: result.failed,
                skipped: result.skipped,
            }, {
                outcome: result.failed > 0 ? 'failed' : 'success',
            });
        } catch (error) {
            if (signal?.aborted || taskQueue.isCancelled(taskId)) {
                notificationService.notify({
                    type: 'registered_user_notice',
                    severity: 'warning',
                    title: '变更通知任务已取消',
                    body: `任务 ${taskId.slice(0, 8)} 已取消。`,
                    meta: { taskId, subject },
                });
                appendSecurityAudit('registered_user_notice', { user: { username: actor } }, {
                    subject,
                    scope,
                    includeDisabled,
                    cancelled: true,
                }, {
                    outcome: 'failed',
                });
                return;
            }

            taskQueue.fail(taskId, error);
            notificationService.notify({
                type: 'registered_user_notice',
                severity: 'critical',
                title: '变更通知发送失败',
                body: error.message || '发送注册用户通知时发生错误',
                meta: { taskId, subject },
            });
            appendSecurityAudit('registered_user_notice', { user: { username: actor } }, {
                subject,
                scope,
                includeDisabled,
                error: error.message || '发送失败',
            }, {
                outcome: 'failed',
            });
        }
    })();

    return res.json({
        success: true,
        msg: `通知发送任务已创建，目标 ${preview.recipients.length} 位用户`,
        obj: {
            taskId,
            recipientCount: preview.recipients.length,
            skippedCount: preview.skipped.length,
            scope,
            includeDisabled,
        },
    });
});

router.get('/backup/status', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: getBackupStatus(),
    });
});

router.get('/backup/export', adminOnly, (req, res) => {
    const keys = normalizeStoreKeys(req.query?.keys);
    const { filename, buffer, meta } = createBackupArchive({ keys });
    appendSecurityAudit('system_backup_exported', req, {
        filename,
        bytes: meta.bytes,
        storeCount: meta.storeKeys.length,
        encrypted: true,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
});

router.post('/backup/local', adminOnly, (req, res) => {
    try {
        const keys = normalizeStoreKeys(req.body?.keys);
        const output = saveBackupArchiveLocally({ keys });
        appendSecurityAudit('system_backup_saved_local', req, {
            filename: output.filename,
            bytes: output.meta.bytes,
            storeCount: output.meta.storeKeys.length,
            encrypted: true,
        });
        return res.json({
            success: true,
            msg: '加密备份已保存到服务器本机',
            obj: {
                ...output.meta,
                filePath: output.meta.filePath,
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || '保存本机备份失败',
        });
    }
});

router.get('/backup/local/:filename/download', adminOnly, (req, res) => {
    try {
        const output = readLocalBackupArchive(req.params.filename);
        appendSecurityAudit('system_backup_downloaded_local', req, {
            filename: output.filename,
        });
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${output.filename}"`);
        return res.send(output.buffer);
    } catch (error) {
        return res.status(404).json({
            success: false,
            msg: error.message || '本机备份不存在',
        });
    }
});

router.post('/backup/local/:filename/restore', adminOnly, async (req, res) => {
    let keys = [];
    try {
        const rawKeys = req.body?.keys;
        if (typeof rawKeys === 'string' && rawKeys.trim().startsWith('[')) {
            keys = normalizeStoreKeys(JSON.parse(rawKeys));
        } else {
            keys = normalizeStoreKeys(rawKeys);
        }
    } catch {
        return res.status(400).json({
            success: false,
            msg: '恢复范围参数无效',
        });
    }

    try {
        const output = await restoreLocalBackupArchive(req.params.filename, { keys });
        appendSecurityAudit('system_backup_restored_local', req, {
            filename: String(req.params.filename || '').trim(),
            sourceCreatedAt: output.meta?.sourceCreatedAt || '',
            storeCount: output.meta?.storeKeys?.length || 0,
            restored: output.result?.restored || 0,
            failed: output.result?.failed || 0,
        });
        return res.json({
            success: true,
            msg: '本机加密备份已恢复',
            obj: output,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || '恢复本机备份失败',
        });
    }
});

router.delete('/backup/local/:filename', adminOnly, (req, res) => {
    try {
        const output = deleteLocalBackupArchive(req.params.filename);
        appendSecurityAudit('system_backup_deleted_local', req, {
            filename: output.filename,
        });
        return res.json({
            success: true,
            msg: '本机备份已删除',
            obj: output,
        });
    } catch (error) {
        return res.status(404).json({
            success: false,
            msg: error.message || '删除本机备份失败',
        });
    }
});

router.post('/backup/inspect', adminOnly, backupUpload.single('file'), (req, res) => {
    if (!req.file?.buffer) {
        return res.status(400).json({
            success: false,
            msg: '请上传备份文件',
        });
    }

    try {
        const inspection = inspectBackupArchive(req.file.buffer);
        return res.json({
            success: true,
            obj: {
                ...inspection,
                filename: String(req.file.originalname || '').trim(),
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || '备份文件校验失败',
        });
    }
});

router.post('/backup/restore', adminOnly, backupUpload.single('file'), async (req, res) => {
    if (!req.file?.buffer) {
        return res.status(400).json({
            success: false,
            msg: '请上传备份文件',
        });
    }

    let keys = [];
    try {
        const rawKeys = req.body?.keys;
        if (typeof rawKeys === 'string' && rawKeys.trim().startsWith('[')) {
            const parsed = JSON.parse(rawKeys);
            keys = normalizeStoreKeys(parsed);
        } else {
            keys = normalizeStoreKeys(rawKeys);
        }
    } catch {
        return res.status(400).json({
            success: false,
            msg: '恢复范围参数无效',
        });
    }

    try {
        const output = await restoreBackupArchive(req.file.buffer, {
            filename: req.file.originalname,
            keys,
        });
        appendSecurityAudit('system_backup_restored', req, {
            filename: String(req.file.originalname || '').trim(),
            sourceCreatedAt: output.meta?.sourceCreatedAt || '',
            storeCount: output.meta?.storeKeys?.length || 0,
            restored: output.result?.restored || 0,
            failed: output.result?.failed || 0,
        });
        return res.json({
            success: true,
            msg: '备份已恢复',
            obj: output,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || '恢复备份失败',
        });
    }
});

router.get('/monitor/status', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: {
            healthMonitor: serverHealthMonitor.getStatus(),
            dbAlerts: alertEngine.getStats(),
            telegram: telegramAlertService.getStatus(),
            notifications: {
                unreadCount: notificationService.unreadCount(),
            },
        },
    });
});

router.post('/monitor/run', adminOnly, async (req, res) => {
    try {
        const result = await serverHealthMonitor.runOnce({ force: true });
        appendSecurityAudit('server_health_monitor_run', req, {
            total: result.summary.total,
            healthy: result.summary.healthy,
            degraded: result.summary.degraded,
            unreachable: result.summary.unreachable,
            maintenance: result.summary.maintenance,
            reasonCounts: result.summary.reasonCounts || {},
        });
        return res.json({
            success: true,
            obj: result,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            msg: error.message || '节点健康巡检失败',
        });
    }
});

router.post('/telegram/test', adminOnly, async (req, res) => {
    try {
        const sent = await telegramAlertService.sendTestMessage(req.user?.username || 'admin');
        if (!sent) {
            throw new Error('Telegram 未启用或配置不完整');
        }
        appendSecurityAudit('telegram_test_message_sent', req, {
            chatIdPreview: telegramAlertService.getStatus().chatIdPreview,
        }, {
            outcome: 'success',
        });
        return res.json({
            success: true,
            msg: 'Telegram 测试通知已发送',
            obj: telegramAlertService.getStatus(),
        });
    } catch (error) {
        appendSecurityAudit('telegram_test_message_sent', req, {
            chatIdPreview: telegramAlertService.getStatus().chatIdPreview,
            error: error.message || 'telegram-test-failed',
        }, {
            outcome: 'failed',
        });
        return res.status(400).json({
            success: false,
            msg: error.message || 'Telegram 测试通知发送失败',
            obj: telegramAlertService.getStatus(),
        });
    }
});

router.put('/settings', adminOnly, (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const updated = systemSettingsStore.update(payload);
        appendSecurityAudit('system_settings_updated', req, {
            updatedSections: Object.keys(payload || {}),
        });
        return res.json({
            success: true,
            msg: 'System settings updated',
            obj: updated,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || 'Invalid settings payload',
        });
    }
});

router.get('/inbounds/order', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: systemSettingsStore.getInboundOrder(),
    });
});

router.get('/servers/order', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: systemSettingsStore.getServerOrder(),
    });
});

router.put('/servers/order', adminOnly, (req, res) => {
    const serverIds = Array.isArray(req.body?.serverIds) ? req.body.serverIds : null;
    if (!serverIds) {
        return res.status(400).json({
            success: false,
            msg: 'serverIds must be an array',
        });
    }

    try {
        const knownServerIds = new Set(serverStore.getAll().map((item) => String(item?.id || '').trim()).filter(Boolean));
        const filteredIds = serverIds.filter((id) => knownServerIds.has(String(id || '').trim()));
        const order = systemSettingsStore.setServerOrder(filteredIds);
        appendSecurityAudit('server_order_updated', req, {
            serverCount: order.length,
        });
        return res.json({
            success: true,
            msg: 'Server order updated',
            obj: {
                serverIds: order,
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || 'Failed to update server order',
        });
    }
});

router.put('/inbounds/order', adminOnly, (req, res) => {
    const serverId = String(req.body?.serverId || '').trim();
    const inboundIds = Array.isArray(req.body?.inboundIds) ? req.body.inboundIds : null;

    if (!serverId) {
        return res.status(400).json({
            success: false,
            msg: 'serverId is required',
        });
    }
    if (!serverStore.getById(serverId)) {
        return res.status(404).json({
            success: false,
            msg: 'Server not found',
        });
    }
    if (!inboundIds) {
        return res.status(400).json({
            success: false,
            msg: 'inboundIds must be an array',
        });
    }

    try {
        const order = systemSettingsStore.setInboundOrder(serverId, inboundIds);
        appendSecurityAudit('inbound_order_updated', req, {
            serverId,
            inboundCount: order.length,
        });
        return res.json({
            success: true,
            msg: 'Inbound order updated',
            obj: {
                serverId,
                inboundIds: order,
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || 'Failed to update inbound order',
        });
    }
});

router.get('/users/order', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: systemSettingsStore.getUserOrder(),
    });
});

router.put('/users/order', adminOnly, (req, res) => {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : null;

    if (!userIds) {
        return res.status(400).json({
            success: false,
            msg: 'userIds must be an array',
        });
    }

    const knownUsers = new Set(userStore.getAll().map((user) => String(user?.id || '').trim()).filter(Boolean));
    const normalizedIds = Array.from(new Set(
        userIds
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
    const invalidIds = normalizedIds.filter((id) => !knownUsers.has(id));

    if (invalidIds.length > 0) {
        return res.status(400).json({
            success: false,
            msg: `Unknown user ids: ${invalidIds.join(', ')}`,
        });
    }

    try {
        const order = systemSettingsStore.setUserOrder(normalizedIds);
        appendSecurityAudit('user_order_updated', req, {
            userCount: order.length,
        });
        return res.json({
            success: true,
            msg: 'User order updated',
            obj: {
                userIds: order,
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            msg: error.message || 'Failed to update user order',
        });
    }
});

router.post('/batch-risk-token', adminOnly, (req, res) => {
    const type = String(req.body?.type || '').trim().toLowerCase();
    const action = String(req.body?.action || '').trim().toLowerCase();
    const isRetry = normalizeBoolean(req.body?.isRetry, false);
    const targetCount = Number(req.body?.targetCount || 0);

    if (!type || !action) {
        return res.status(400).json({
            success: false,
            msg: 'type and action are required',
        });
    }

    const risk = assessBatchRisk({
        type,
        action,
        targetCount,
        isRetry,
        securitySettings: systemSettingsStore.getSecurity(),
    });

    if (!risk.requiresToken) {
        return res.json({
            success: true,
            msg: 'Risk token not required for this operation',
            obj: {
                required: false,
                risk,
                operationKey: buildBatchRiskOperationKey({ type, action, isRetry }),
                token: '',
                expiresAt: null,
                ttlSeconds: 0,
            },
        });
    }

    const operationKey = buildBatchRiskOperationKey({ type, action, isRetry });
    const issued = batchRiskTokenStore.issue({
        actor: {
            userId: req.user?.userId,
            username: req.user?.username,
            role: req.user?.role,
        },
        operationKey,
        ttlSeconds: systemSettingsStore.getSecurity().riskTokenTtlSeconds,
    });
    appendSecurityAudit('batch_risk_token_issued', req, {
        type,
        action,
        isRetry,
        targetCount: Number.isFinite(targetCount) ? Math.max(0, Math.floor(targetCount)) : 0,
        operationKey,
        riskLevel: risk.level,
        tokenTtlSeconds: issued.ttlSeconds,
    });

    return res.json({
        success: true,
        msg: 'Risk token issued',
        obj: {
            required: true,
            risk,
            operationKey,
            ...issued,
        },
    });
});

router.post('/credentials/rotate', adminOnly, (req, res) => {
    const rawDryRun = req.body?.dryRun;
    const dryRun = rawDryRun === true
        || String(rawDryRun || '').trim().toLowerCase() === 'true'
        || String(rawDryRun || '').trim() === '1';
    const output = serverStore.rotateCredentials({ dryRun });
    appendSecurityAudit('credentials_rotation', req, {
        dryRun,
        ...output,
    });
    return res.json({
        success: true,
        msg: dryRun ? 'Credentials rotation dry-run completed' : 'Credentials rotated',
        obj: output,
    });
});

router.get('/db/status', adminOnly, async (req, res) => {
    const supportedModes = getSupportedModes();
    const status = getSnapshotStatus();
    let snapshots = [];

    if (isDbEnabled() && isDbReady()) {
        try {
            snapshots = await listSnapshotsMeta();
        } catch {
            snapshots = [];
        }
    }

    return res.json({
        success: true,
        obj: {
            ...status,
            supportedModes,
            currentModes: getStoreModes(),
            snapshots,
            storeKeys: listStoreKeys(),
            defaults: {
                dryRun: config.db?.backfillDryRunDefault !== false,
                redact: config.db?.backfillRedact !== false,
            },
        },
    });
});

router.post('/db/backfill', adminOnly, async (req, res) => {
    if (!isDbEnabled() || !isDbReady()) {
        return res.status(400).json({
            success: false,
            msg: 'Database is not enabled or not ready',
        });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const dryRun = normalizeBoolean(body.dryRun, config.db?.backfillDryRunDefault !== false);
    const redact = normalizeBoolean(body.redact, config.db?.backfillRedact !== false);
    const keys = normalizeStoreKeys(body.keys);
    const async_ = normalizeBoolean(body.async, true); // 默认异步模式

    const actor = req.user?.username || 'admin';
    const targetKeys = keys.length > 0 ? keys : listStoreKeys();

    if (async_) {
        // 异步模式：立即返回 taskId，后台执行
        const { taskId, signal } = taskQueue.create({
            type: 'db_backfill',
            actor,
            meta: { dryRun, redact, keys: targetKeys },
        });

        // 后台异步执行
        setImmediate(async () => {
            taskQueue.start(taskId);
            try {
                // 逐 store 处理，逐步上报进度
                const { writeStoreSnapshotNow } = await import('../store/dbMirror.js');
                const { collectStoreSnapshots } = await import('../store/storeRegistry.js');
                const storeKeys = targetKeys;
                const total = storeKeys.length;
                const details = [];

                for (let i = 0; i < storeKeys.length; i++) {
                    if (signal.aborted) {
                        break;
                    }
                    const key = storeKeys[i];
                    taskQueue.updateProgress(taskId, {
                        step: i,
                        total,
                        label: `处理 ${key} (${i + 1}/${total})`,
                    });

                    try {
                        const snapshots = collectStoreSnapshots([key]);
                        const payload = snapshots[key];
                        if (!payload) {
                            details.push({ key, success: false, skipped: true, msg: 'snapshot-missing' });
                        } else if (dryRun) {
                            const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
                            details.push({ key, success: true, dryRun: true, bytes });
                        } else {
                            await writeStoreSnapshotNow(key, payload, { redact });
                            const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
                            details.push({ key, success: true, dryRun: false, bytes });
                        }
                    } catch (err) {
                        details.push({ key, success: false, msg: String(err?.message || err) });
                    }
                }

                const result = {
                    dryRun,
                    redact,
                    total: details.length,
                    success: details.filter(d => d.success).length,
                    failed: details.filter(d => !d.success).length,
                    details,
                    cancelled: signal.aborted,
                };
                taskQueue.complete(taskId, result);

                appendSecurityAudit('db_backfill', { user: { username: actor } }, {
                    dryRun, redact, keys: targetKeys,
                    success: result.success, failed: result.failed,
                    taskId, async: true,
                });
            } catch (err) {
                taskQueue.fail(taskId, err);
            }
        });

        return res.json({
            success: true,
            msg: '回填任务已启动',
            obj: { taskId, async: true, status: TASK_STATUS.PENDING },
        });
    }

    // 同步模式（向后兼容）
    const output = await backfillStoresToDatabase({ dryRun, redact, keys });
    appendSecurityAudit('db_backfill', req, {
        dryRun, redact,
        keys: targetKeys,
        success: output.success,
        failed: output.failed,
    });
    return res.json({ success: output.failed === 0, obj: output });
});

// 获取任务状态
router.get('/tasks', adminOnly, (req, res) => {
    const { status, type, limit } = req.query;
    const tasks = taskQueue.list({
        status: status || undefined,
        type: type || undefined,
        limit: Number(limit) || 50,
    });
    return res.json({ success: true, obj: { tasks } });
});

router.get('/tasks/:taskId', adminOnly, (req, res) => {
    const task = taskQueue.get(req.params.taskId);
    if (!task) {
        return res.status(404).json({ success: false, msg: 'Task not found' });
    }
    return res.json({ success: true, obj: task });
});

router.delete('/tasks/:taskId', adminOnly, (req, res) => {
    const task = taskQueue.get(req.params.taskId);
    if (!task) {
        return res.status(404).json({ success: false, msg: 'Task not found' });
    }
    if (task.status === TASK_STATUS.RUNNING || task.status === TASK_STATUS.PENDING) {
        const cancelled = taskQueue.cancel(req.params.taskId);
        if (cancelled) {
            return res.json({ success: true, msg: 'Task cancellation requested' });
        }
        return res.status(500).json({ success: false, msg: 'Failed to cancel task' });
    }
    return res.status(400).json({ success: false, msg: `Cannot cancel task in status: ${task.status}` });
});

// 通知接口
router.get('/notifications', authMiddleware, (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const result = notificationService.getAll({ limit, offset });
    return res.json({
        success: true,
        obj: {
            ...result,
            unreadCount: notificationService.unreadCount(),
        },
    });
});

router.post('/notifications/read', authMiddleware, (req, res) => {
    const { id, all } = req.body || {};
    if (all) {
        const count = notificationService.markAllRead();
        return res.json({ success: true, msg: `${count} notifications marked as read` });
    }
    if (id) {
        const ok = notificationService.markRead(id);
        return res.json({ success: ok, msg: ok ? 'Marked as read' : 'Notification not found' });
    }
    return res.status(400).json({ success: false, msg: 'Provide id or all=true' });
});

router.post('/db/switch', adminOnly, async (req, res) => {
    if (!isDbEnabled() || !isDbReady()) {
        return res.status(400).json({
            success: false,
            msg: 'Database is not enabled or not ready',
        });
    }

    const current = getStoreModes();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const readMode = normalizeMode(body.readMode, ['file', 'db'], current.readMode);
    const writeMode = normalizeMode(body.writeMode, ['file', 'dual', 'db'], current.writeMode);
    const hydrateOnReadDb = normalizeBoolean(body.hydrateOnReadDb, true);

    const nextModes = await saveRuntimeModesToDb({
        readMode,
        writeMode,
    });

    let hydration = null;
    if (nextModes.readMode === 'db' && hydrateOnReadDb) {
        hydration = await hydrateStoresFromDatabase();
    }

    appendSecurityAudit('db_mode_switched', req, {
        from: current,
        to: nextModes,
        hydrateOnReadDb,
    });

    return res.json({
        success: true,
        obj: {
            previous: current,
            current: nextModes,
            hydration,
        },
    });
});

export default router;
