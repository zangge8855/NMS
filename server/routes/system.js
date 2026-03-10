import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import serverStore from '../store/serverStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
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
import { createBackupArchive, getBackupStatus } from '../lib/systemBackup.js';

const router = Router();

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

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
    });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
});

router.get('/monitor/status', adminOnly, (req, res) => {
    return res.json({
        success: true,
        obj: {
            healthMonitor: serverHealthMonitor.getStatus(),
            dbAlerts: alertEngine.getStats(),
            notifications: {
                unreadCount: notificationService.unreadCount(),
            },
        },
    });
});

router.post('/monitor/run', adminOnly, async (req, res) => {
    try {
        const result = await serverHealthMonitor.runOnce();
        appendSecurityAudit('server_health_monitor_run', req, {
            total: result.summary.total,
            healthy: result.summary.healthy,
            degraded: result.summary.degraded,
            unreachable: result.summary.unreachable,
            maintenance: result.summary.maintenance,
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
