import crypto from 'crypto';
import { dbQuery, getDbConnectionStatus, isDbEnabled, isDbReady } from './client.js';
import { getDbSchemaName } from './schema.js';
import { getStoreModes } from './runtimeModes.js';
import alertEngine from '../lib/alertEngine.js';

const state = {
    writesQueued: 0,
    writesSucceeded: 0,
    writesFailed: 0,
    lastWriteAt: null,
    lastError: '',
    pendingWrites: 0,
};

let writeChain = Promise.resolve();
const SNAPSHOT_PRIVACY_REDACTION_STORE_KEYS = new Set(['traffic']);

function qIdent(identifier) {
    return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

function cloneJson(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function hashText(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function maskEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    if (!value) return '';
    return `${hashText(value)}@masked.local`;
}

function maskIp(ip) {
    const value = String(ip || '').trim();
    if (!value) return '';
    return `ip_${hashText(value)}`;
}

function maskUserAgent(ua) {
    const value = String(ua || '').trim();
    if (!value) return '';
    return `ua_${hashText(value)}`;
}

function redactTrafficSnapshot(snapshot) {
    const payload = cloneJson(snapshot) || {};
    if (Array.isArray(payload.samples)) {
        payload.samples = payload.samples.map((item) => {
            if (!item || typeof item !== 'object') return item;
            const out = { ...item };
            if (out.email) out.email = maskEmail(out.email);
            return out;
        });
    }

    if (payload.counters && typeof payload.counters === 'object') {
        const next = {};
        for (const [key, item] of Object.entries(payload.counters)) {
            const out = item && typeof item === 'object' ? { ...item } : item;
            if (out && typeof out === 'object' && out.email) {
                out.email = maskEmail(out.email);
            }
            next[key] = out;
        }
        payload.counters = next;
    }

    return payload;
}

export function listSnapshotPrivacyRedactionStoreKeys() {
    return Array.from(SNAPSHOT_PRIVACY_REDACTION_STORE_KEYS.values());
}

export function shouldApplySnapshotPrivacyRedaction(storeKey, options = {}) {
    if (options.redact !== true) return false;
    return SNAPSHOT_PRIVACY_REDACTION_STORE_KEYS.has(String(storeKey || '').trim());
}

function applyPrivacyRedaction(storeKey, payload, options = {}) {
    if (!shouldApplySnapshotPrivacyRedaction(storeKey, options)) return payload;
    if (storeKey === 'traffic') return redactTrafficSnapshot(payload);
    return payload;
}

function schemaTable() {
    const schema = getDbSchemaName();
    return `${qIdent(schema)}.store_snapshots`;
}

async function upsertSnapshot(storeKey, payload) {
    const body = cloneJson(payload);
    const payloadText = JSON.stringify(body ?? null);
    const size = Buffer.byteLength(payloadText, 'utf8');
    await dbQuery(
        `
        INSERT INTO ${schemaTable()} (store_key, payload, payload_size, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW())
        ON CONFLICT (store_key)
        DO UPDATE SET
            payload = EXCLUDED.payload,
            payload_size = EXCLUDED.payload_size,
            updated_at = NOW();
        `,
        [String(storeKey || '').trim(), payloadText, size]
    );
}

export async function readSnapshot(storeKey) {
    if (!isDbEnabled() || !isDbReady()) return null;
    const key = String(storeKey || '').trim();
    if (!key) return null;

    const res = await dbQuery(
        `SELECT payload FROM ${schemaTable()} WHERE store_key = $1 LIMIT 1;`,
        [key]
    );

    const row = res.rows?.[0];
    if (!row) return null;
    return cloneJson(row.payload);
}

export async function writeSnapshotNow(storeKey, payload, options = {}) {
    if (!isDbEnabled() || !isDbReady()) return { success: false, skipped: true };
    const key = String(storeKey || '').trim();
    if (!key) return { success: false, skipped: true };

    const body = applyPrivacyRedaction(key, payload, options);
    try {
        await upsertSnapshot(key, body);
        alertEngine.recordSuccess();
        state.writesSucceeded += 1;
        state.lastWriteAt = new Date().toISOString();
        return { success: true };
    } catch (error) {
        alertEngine.recordFailure(key, String(error?.message || error));
        throw error;
    }
}

export function queueSnapshotWrite(storeKey, payload, options = {}) {
    if (!isDbEnabled() || !isDbReady()) return;
    const key = String(storeKey || '').trim();
    if (!key) return;

    const body = applyPrivacyRedaction(key, payload, options);

    state.writesQueued += 1;
    state.pendingWrites += 1;

    writeChain = writeChain
        .then(async () => {
            await upsertSnapshot(key, body);
            alertEngine.recordSuccess();
            state.writesSucceeded += 1;
            state.lastWriteAt = new Date().toISOString();
        })
        .catch((error) => {
            const errMsg = String(error?.message || error);
            alertEngine.recordFailure(key, errMsg);
            state.writesFailed += 1;
            state.lastError = errMsg;
        })
        .finally(() => {
            state.pendingWrites = Math.max(0, state.pendingWrites - 1);
        });
}

export async function flushSnapshotQueue() {
    await writeChain;
}

export async function listSnapshotsMeta() {
    if (!isDbEnabled() || !isDbReady()) return [];
    const res = await dbQuery(
        `
        SELECT store_key, payload_size, updated_at
        FROM ${schemaTable()}
        ORDER BY store_key ASC;
        `
    );
    return Array.isArray(res.rows) ? res.rows : [];
}

export function getSnapshotStatus() {
    return {
        connection: getDbConnectionStatus(),
        modes: getStoreModes(),
        writesQueued: state.writesQueued,
        writesSucceeded: state.writesSucceeded,
        writesFailed: state.writesFailed,
        pendingWrites: state.pendingWrites,
        lastWriteAt: state.lastWriteAt,
        lastError: state.lastError,
    };
}
