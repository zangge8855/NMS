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

    const output = await backfillStoresToDatabase({
        dryRun,
        redact,
        keys,
    });

    appendSecurityAudit('db_backfill', req, {
        dryRun,
        redact,
        keys: keys.length > 0 ? keys : listStoreKeys(),
        success: output.success,
        failed: output.failed,
    });

    return res.json({
        success: output.failed === 0,
        obj: output,
    });
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
