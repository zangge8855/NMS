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

export function applyPrivacyRedaction(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): any {
    if (!shouldApplySnapshotPrivacyRedaction(storeKey, options)) return payload;
    if (storeKey === 'traffic') return redactTrafficSnapshot(payload);
    return payload;
}

function schemaTable(): string {
    const schema = getDbSchemaName();
    return `${qIdent(schema)}.store_snapshots`;
}

const activeWriteLocks = new Map<string, Promise<void>>();
const writeGenerations = new Map<string, number>();

function nextWriteGeneration(storeKey: string): number {
    const next = (writeGenerations.get(storeKey) || 0) + 1;
    writeGenerations.set(storeKey, next);
    return next;
}

async function runWithKeyWriteLock<T>(storeKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = activeWriteLocks.get(storeKey) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
        release = resolve;
    });
    const chained = prev.then(() => next, () => next);
    activeWriteLocks.set(storeKey, chained);
    await prev.catch(() => {});
    try {
        return await fn();
    } finally {
        release();
        if (activeWriteLocks.get(storeKey) === chained) {
            activeWriteLocks.delete(storeKey);
        }
    }
}

async function upsertSnapshot(storeKey: string, payload: any, generation?: number): Promise<void> {
    const key = String(storeKey || '').trim();
    if (generation !== undefined && writeGenerations.get(key) !== generation) {
        throw new Error(`Superseded snapshot write for ${key}`);
    }
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
        [key, payloadText, size]
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
    const generation = nextWriteGeneration(key);
    return runWithKeyWriteLock(key, async () => {
        try {
            await upsertSnapshot(key, body, generation);
            alertEngine.recordSuccess();
            state.writesSucceeded += 1;
            state.lastWriteAt = new Date().toISOString();
            return { success: true };
        } catch (error: any) {
            alertEngine.recordFailure(key, String(error?.message || error));
            throw error;
        }
    });
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

const pendingWritesMap = new Map<string, any>();
let isProcessingQueue = false;
let queuePauseDepth = 0;
let flushResolvers: Array<() => void> = [];

export function pauseSnapshotQueue(): void {
    queuePauseDepth += 1;
}

export function resumeSnapshotQueue(): void {
    if (queuePauseDepth > 0) {
        queuePauseDepth -= 1;
    }
    if (queuePauseDepth === 0 && pendingWritesMap.size > 0) {
        void processQueue();
    }
}

export function isSnapshotQueuePaused(): boolean {
    return queuePauseDepth > 0;
}

export function clearPendingSnapshotWrites(keys?: string[]): void {
    if (!keys || keys.length === 0) {
        pendingWritesMap.clear();
    } else {
        for (const key of keys) {
            pendingWritesMap.delete(String(key || '').trim());
        }
    }
    state.pendingWrites = pendingWritesMap.size;
}

async function processQueue(): Promise<void> {
    if (isProcessingQueue || queuePauseDepth > 0) return;
    isProcessingQueue = true;
    try {
        while (pendingWritesMap.size > 0 && queuePauseDepth === 0) {
            const entries = Array.from(pendingWritesMap.entries());
            pendingWritesMap.clear();
            for (const [key, body] of entries) {
                let success = false;
                let lastErr: any = null;
                // Try up to 2 attempts for transient hiccups (connection retry, momentary lock)
                for (let attempt = 0; attempt < 2; attempt++) {
                    const generation = nextWriteGeneration(key);
                    const attemptPromise = runWithKeyWriteLock(key, () => upsertSnapshot(key, body, generation));
                    try {
                        await withTimeout(
                            attemptPromise,
                            10500,
                            `Write timeout for ${key} after 10500ms`
                        );
                        success = true;
                        break;
                    } catch (err: any) {
                        lastErr = err;
                        // Invalidate timed-out generation before retry so late completion throws/skips safely
                        nextWriteGeneration(key);
                        // Avoid unhandled rejection if timed-out attempt settles later
                        void attemptPromise.catch(() => {});
                        if (attempt === 0) {
                            await new Promise(r => setTimeout(r, 200));
                        }
                    }
                }

                if (success) {
                    alertEngine.recordSuccess();
                    state.writesSucceeded += 1;
                    state.lastWriteAt = new Date().toISOString();
                } else {
                    const errMsg = String(lastErr?.message || lastErr);
                    alertEngine.recordFailure(key, errMsg);
                    state.writesFailed += 1;
                    state.lastError = errMsg;
                }
            }
        }
    } finally {
        isProcessingQueue = false;
        state.pendingWrites = pendingWritesMap.size;
        if (flushResolvers.length > 0) {
            const resolvers = flushResolvers;
            flushResolvers = [];
            resolvers.forEach(resolve => resolve());
        }
    }
}

export function queueSnapshotWrite(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): void {
    if (!isDbEnabled() || !isDbReady()) return;
    if (queuePauseDepth > 0) return;
    const key = String(storeKey || '').trim();
    if (!key) return;

    const body = applyPrivacyRedaction(key, payload, options);

    state.writesQueued += 1;
    pendingWritesMap.set(key, body);
    state.pendingWrites = pendingWritesMap.size;

    void processQueue();
}

export async function flushSnapshotQueue(): Promise<void> {
    if (!isProcessingQueue && pendingWritesMap.size === 0) return;
    await new Promise<void>((resolve) => {
        flushResolvers.push(resolve);
        void processQueue();
    });
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
