import crypto from 'crypto';
import { dbQuery, getDbConnectionStatus, isDbEnabled, isDbReady, type DbConnectionStatus } from './client.js';
import { getDbSchemaName } from './schema.js';
import { getStoreModes, type StoreModes } from './runtimeModes.js';
import alertEngine from '../lib/alertEngine.js';

interface SnapshotState {
    writesQueued: number;
    writesSucceeded: number;
    writesFailed: number;
    lastWriteAt: string | null;
    lastError: string;
    pendingWrites: number;
}

const state: SnapshotState = {
    writesQueued: 0,
    writesSucceeded: 0,
    writesFailed: 0,
    lastWriteAt: null,
    lastError: '',
    pendingWrites: 0,
};

let writeChain: Promise<void> = Promise.resolve();
const SNAPSHOT_PRIVACY_REDACTION_STORE_KEYS = new Set<string>(['traffic']);

function qIdent(identifier: string): string {
    return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

function cloneJson<T = any>(value: T): T | null {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function hashText(text: string): string {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function maskEmail(email?: string | null): string {
    const value = String(email || '').trim().toLowerCase();
    if (!value) return '';
    return `${hashText(value)}@masked.local`;
}

function maskIp(ip?: string | null): string {
    const value = String(ip || '').trim();
    if (!value) return '';
    return `ip_${hashText(value)}`;
}

function maskUserAgent(ua?: string | null): string {
    const value = String(ua || '').trim();
    if (!value) return '';
    return `ua_${hashText(value)}`;
}

function redactTrafficSnapshot(snapshot: any): any {
    const payload = cloneJson(snapshot) || {};
    if (Array.isArray(payload.samples)) {
        payload.samples = payload.samples.map((item: any) => {
            if (!item || typeof item !== 'object') return item;
            const out = { ...item };
            if (out.email) out.email = maskEmail(out.email);
            return out;
        });
    }

    if (payload.counters && typeof payload.counters === 'object') {
        const next: Record<string, any> = {};
        for (const [key, item] of Object.entries(payload.counters)) {
            const out = item && typeof item === 'object' ? { ...(item as any) } : item;
            if (out && typeof out === 'object' && (out as any).email) {
                (out as any).email = maskEmail((out as any).email);
            }
            next[key] = out;
        }
        payload.counters = next;
    }

    return payload;
}

export function listSnapshotPrivacyRedactionStoreKeys(): string[] {
    return Array.from(SNAPSHOT_PRIVACY_REDACTION_STORE_KEYS.values());
}

export interface SnapshotRedactionOptions {
    redact?: boolean;
    [key: string]: any;
}

export function shouldApplySnapshotPrivacyRedaction(storeKey: string, options: SnapshotRedactionOptions = {}): boolean {
    if (options.redact !== true) return false;
    return SNAPSHOT_PRIVACY_REDACTION_STORE_KEYS.has(String(storeKey || '').trim());
}

function applyPrivacyRedaction(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): any {
    if (!shouldApplySnapshotPrivacyRedaction(storeKey, options)) return payload;
    if (storeKey === 'traffic') return redactTrafficSnapshot(payload);
    return payload;
}

function schemaTable(): string {
    const schema = getDbSchemaName();
    return `${qIdent(schema)}.store_snapshots`;
}

async function upsertSnapshot(storeKey: string, payload: any): Promise<void> {
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

export async function readSnapshot<T = any>(storeKey: string): Promise<T | null> {
    if (!isDbEnabled() || !isDbReady()) return null;
    const key = String(storeKey || '').trim();
    if (!key) return null;

    const res = await dbQuery(
        `SELECT payload FROM ${schemaTable()} WHERE store_key = $1 LIMIT 1;`,
        [key]
    );

    const row = res.rows?.[0];
    if (!row) return null;
    return cloneJson(row.payload) as T;
}

export interface WriteSnapshotResult {
    success: boolean;
    skipped?: boolean;
}

export async function writeSnapshotNow(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): Promise<WriteSnapshotResult> {
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
    } catch (error: any) {
        alertEngine.recordFailure(key, String(error?.message || error));
        throw error;
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errMsg = 'Timeout'): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errMsg)), timeoutMs);
    });
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        timeoutPromise,
    ]);
}

export function queueSnapshotWrite(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): void {
    if (!isDbEnabled() || !isDbReady()) return;
    const key = String(storeKey || '').trim();
    if (!key) return;

    const body = applyPrivacyRedaction(key, payload, options);

    state.writesQueued += 1;
    state.pendingWrites += 1;

    writeChain = writeChain
        .then(async () => {
            await withTimeout(
                upsertSnapshot(key, body),
                10000,
                `Write timeout for ${key} after 10000ms`
            );
            alertEngine.recordSuccess();
            state.writesSucceeded += 1;
            state.lastWriteAt = new Date().toISOString();
        })
        .catch((error: any) => {
            const errMsg = String(error?.message || error);
            alertEngine.recordFailure(key, errMsg);
            state.writesFailed += 1;
            state.lastError = errMsg;
        })
        .finally(() => {
            state.pendingWrites = Math.max(0, state.pendingWrites - 1);
        });
}

export async function flushSnapshotQueue(): Promise<void> {
    await writeChain;
}

export interface SnapshotMeta {
    store_key: string;
    payload_size: number;
    updated_at: string;
}

export async function listSnapshotsMeta(): Promise<SnapshotMeta[]> {
    if (!isDbEnabled() || !isDbReady()) return [];
    const res = await dbQuery<SnapshotMeta>(
        `
        SELECT store_key, payload_size, updated_at
        FROM ${schemaTable()}
        ORDER BY store_key ASC;
        `
    );
    return Array.isArray(res.rows) ? res.rows : [];
}

export interface SnapshotStatus {
    connection: DbConnectionStatus;
    modes: StoreModes;
    writesQueued: number;
    writesSucceeded: number;
    writesFailed: number;
    pendingWrites: number;
    lastWriteAt: string | null;
    lastError: string;
}

export function getSnapshotStatus(): SnapshotStatus {
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
