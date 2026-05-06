import userStore from './userStore.js';
import serverStore from './serverStore.js';
import jobStore from './jobStore.js';
import auditStore from './auditStore.js';
import subscriptionTokenStore from './subscriptionTokenStore.js';
import systemSettingsStore from './systemSettingsStore.js';
import trafficStatsStore from './trafficStatsStore.js';
import userPolicyStore from './userPolicyStore.js';
import clientEntitlementOverrideStore from './clientEntitlementOverrideStore.js';
import inviteCodeStore from './inviteCodeStore.js';
import { loadStoreSnapshot, writeStoreSnapshotNow } from './dbMirror.js';
import { readSnapshot, shouldApplySnapshotPrivacyRedaction } from '../db/snapshots.js';

function safeClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function hashSnapshot(value) {
    try {
        const serialized = JSON.stringify(value);
        let hash = 0;
        for (let index = 0; index < serialized.length; index += 1) {
            hash = ((hash << 5) - hash) + serialized.charCodeAt(index);
            hash |= 0;
        }
        return `${serialized.length}:${Math.abs(hash).toString(16)}`;
    } catch {
        return 'unhashable';
    }
}

export function buildStoreSnapshotComparison(key, filePayload, dbPayload, options = {}) {
    if (dbPayload === null || dbPayload === undefined) {
        return {
            key,
            ok: false,
            status: 'missing-db-snapshot',
            fileHash: hashSnapshot(filePayload),
            dbHash: '',
        };
    }

    if (shouldApplySnapshotPrivacyRedaction(key, { redact: options.redact })) {
        return {
            key,
            ok: true,
            status: 'comparison-skipped-redacted',
            fileHash: hashSnapshot(filePayload),
            dbHash: hashSnapshot(dbPayload),
        };
    }

    const fileText = JSON.stringify(filePayload);
    const dbText = JSON.stringify(dbPayload);
    const ok = fileText === dbText;
    return {
        key,
        ok,
        status: ok ? 'match' : 'mismatch',
        fileHash: hashSnapshot(filePayload),
        dbHash: hashSnapshot(dbPayload),
    };
}

const STORE_REGISTRY = [
    { key: 'users', store: userStore },
    { key: 'servers', store: serverStore },
    { key: 'jobs', store: jobStore },
    { key: 'audit', store: auditStore },
    { key: 'subscription_tokens', store: subscriptionTokenStore },
    { key: 'system_settings', store: systemSettingsStore },
    { key: 'invite_codes', store: inviteCodeStore },
    { key: 'traffic', store: trafficStatsStore },
    { key: 'user_policies', store: userPolicyStore },
    { key: 'client_entitlement_overrides', store: clientEntitlementOverrideStore },
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
            const effectiveRedact = shouldApplySnapshotPrivacyRedaction(key, { redact });
            await writeStoreSnapshotNow(key, payload, {
                redact: effectiveRedact,
            });
            const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
            details.push({ key, success: true, dryRun: false, bytes, effectiveRedact });
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

export async function verifyStoresAgainstDatabase(options = {}) {
    const redact = options.redact === true;
    const items = resolveKeys(options.keys);
    const details = [];

    for (const { key, store } of items) {
        if (typeof store?.exportState !== 'function') {
            details.push({ key, ok: false, status: 'exportState-not-implemented' });
            continue;
        }
        const filePayload = safeClone(store.exportState());
        if (filePayload === null) {
            details.push({ key, ok: false, status: 'file-snapshot-unserializable' });
            continue;
        }

        try {
            const dbPayload = await readSnapshot(key);
            details.push(buildStoreSnapshotComparison(key, filePayload, dbPayload, { redact }));
        } catch (error) {
            details.push({
                key,
                ok: false,
                status: 'db-read-failed',
                msg: String(error?.message || error),
            });
        }
    }

    return {
        total: details.length,
        ok: details.filter((item) => item.ok).length,
        failed: details.filter((item) => !item.ok).length,
        details,
    };
}

export async function restoreStoreSnapshots(snapshots = {}, options = {}) {
    const items = resolveKeys(options.keys);
    const source = snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots) ? snapshots : {};
    const details = [];

    for (const { key, store } of items) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            details.push({ key, restored: false, reason: 'snapshot-missing' });
            continue;
        }

        if (typeof store?.importState !== 'function') {
            details.push({ key, restored: false, reason: 'importState-not-implemented' });
            continue;
        }

        try {
            store.importState(source[key]);

            if (typeof store?._save === 'function') {
                store._save();
            } else if (typeof store?.exportState === 'function') {
                await writeStoreSnapshotNow(key, store.exportState(), { redact: false });
            }

            details.push({ key, restored: true, reason: 'ok' });
        } catch (error) {
            details.push({
                key,
                restored: false,
                reason: String(error?.message || error),
            });
        }
    }

    return {
        total: details.length,
        restored: details.filter((item) => item.restored).length,
        failed: details.filter((item) => !item.restored).length,
        details,
    };
}
