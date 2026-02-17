import userStore from './userStore.js';
import serverStore from './serverStore.js';
import jobStore from './jobStore.js';
import auditStore from './auditStore.js';
import subscriptionTokenStore from './subscriptionTokenStore.js';
import systemSettingsStore from './systemSettingsStore.js';
import trafficStatsStore from './trafficStatsStore.js';
import userPolicyStore from './userPolicyStore.js';
import { loadStoreSnapshot, writeStoreSnapshotNow } from './dbMirror.js';

function safeClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

const STORE_REGISTRY = [
    { key: 'users', store: userStore },
    { key: 'servers', store: serverStore },
    { key: 'jobs', store: jobStore },
    { key: 'audit', store: auditStore },
    { key: 'subscription_tokens', store: subscriptionTokenStore },
    { key: 'system_settings', store: systemSettingsStore },
    { key: 'traffic', store: trafficStatsStore },
    { key: 'user_policies', store: userPolicyStore },
];

function resolveKeys(inputKeys = []) {
    const requested = Array.isArray(inputKeys)
        ? inputKeys.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    if (requested.length === 0) {
        return STORE_REGISTRY;
    }
    const set = new Set(requested);
    return STORE_REGISTRY.filter((item) => set.has(item.key));
}

export function listStoreKeys() {
    return STORE_REGISTRY.map((item) => item.key);
}

export function collectStoreSnapshots(inputKeys = []) {
    const items = resolveKeys(inputKeys);
    const output = {};

    items.forEach(({ key, store }) => {
        if (typeof store?.exportState !== 'function') return;
        const state = safeClone(store.exportState());
        if (state !== null) output[key] = state;
    });

    return output;
}

export async function hydrateStoresFromDatabase(inputKeys = []) {
    const items = resolveKeys(inputKeys);
    const details = [];

    for (const { key, store } of items) {
        if (typeof store?.importState !== 'function') {
            details.push({ key, loaded: false, reason: 'importState-not-implemented' });
            continue;
        }

        try {
            const snapshot = await loadStoreSnapshot(key);
            if (!snapshot) {
                details.push({ key, loaded: false, reason: 'snapshot-missing' });
                continue;
            }
            store.importState(snapshot);
            details.push({ key, loaded: true, reason: 'ok' });
        } catch (error) {
            details.push({
                key,
                loaded: false,
                reason: String(error?.message || error),
            });
        }
    }

    return {
        total: details.length,
        loaded: details.filter((item) => item.loaded).length,
        failed: details.filter((item) => !item.loaded).length,
        details,
    };
}

export async function backfillStoresToDatabase(options = {}) {
    const dryRun = options.dryRun !== false;
    const redact = options.redact !== false;
    const items = resolveKeys(options.keys);

    const details = [];

    for (const { key, store } of items) {
        if (typeof store?.exportState !== 'function') {
            details.push({ key, success: false, skipped: true, msg: 'exportState-not-implemented' });
            continue;
        }

        const payload = safeClone(store.exportState());
        if (payload === null) {
            details.push({ key, success: false, skipped: true, msg: 'snapshot-unserializable' });
            continue;
        }

        if (dryRun) {
            const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
            details.push({ key, success: true, dryRun: true, bytes });
            continue;
        }

        try {
            await writeStoreSnapshotNow(key, payload, {
                redact,
            });
            const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
            details.push({ key, success: true, dryRun: false, bytes });
        } catch (error) {
            details.push({
                key,
                success: false,
                dryRun: false,
                msg: String(error?.message || error),
            });
        }
    }

    return {
        dryRun,
        redact,
        total: details.length,
        success: details.filter((item) => item.success).length,
        failed: details.filter((item) => !item.success).length,
        details,
    };
}
