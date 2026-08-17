/**
 * In-memory store for actions awaiting Telegram inline-keyboard confirmation.
 *
 * The store maps a short id (8 hex chars, fits comfortably inside the 64-byte
 * callback_data limit when combined with a 2-char prefix) to the action
 * payload. Entries auto-expire after `ttlMs` (default 60s). Sweeping is
 * lazy + driven by a background interval so the store is safe to use across
 * the bot's lifetime.
 *
 * The bot does NOT persist pending actions — restarting the server clears
 * them, which is the desired behaviour for confirmation tokens.
 */

const DEFAULT_TTL_MS = 60_000;
const SWEEP_INTERVAL_MS = 30_000;

function generateShortId(): string {
    return Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');
}

export interface PendingActionRecord {
    id: string;
    payload: any;
    createdAt: number;
    expiresAt: number;
}

export interface PendingActionStore {
    create: (payload?: any, options?: { ttlMs?: number }) => PendingActionRecord;
    peek: (id: string) => PendingActionRecord | null;
    take: (id: string) => PendingActionRecord | null;
    clear: (id: string) => boolean;
    size: () => number;
    sweepNow: () => void;
    reset: () => void;
}

export function createPendingActionStore(options: {
    ttlMs?: number;
    sweepIntervalMs?: number;
    now?: () => number;
    generateId?: () => string;
    startInterval?: (fn: () => void, delay: number) => any;
} = {}): PendingActionStore {
    const ttlMs = Math.max(5_000, Number(options.ttlMs || DEFAULT_TTL_MS));
    const sweepIntervalMs = Math.max(5_000, Number(options.sweepIntervalMs || SWEEP_INTERVAL_MS));
    const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
    const generateId = typeof options.generateId === 'function' ? options.generateId : generateShortId;
    const startInterval = typeof options.startInterval === 'function'
        ? options.startInterval
        : (fn: () => void, delay: number) => {
            const handle = setInterval(fn, delay);
            handle.unref?.();
            return handle;
        };

    const entries = new Map<string, PendingActionRecord>();
    let sweepHandle: any = null;

    function sweepNow(): void {
        const cutoff = nowFn();
        for (const [id, record] of entries.entries()) {
            if (record.expiresAt <= cutoff) {
                entries.delete(id);
            }
        }
    }

    function ensureSweepRunning(): void {
        if (sweepHandle || entries.size === 0) return;
        sweepHandle = startInterval(() => {
            sweepNow();
            if (entries.size === 0 && sweepHandle) {
                clearInterval(sweepHandle);
                sweepHandle = null;
            }
        }, sweepIntervalMs);
    }

    function create(payload: any = {}, { ttlMs: overrideTtlMs }: { ttlMs?: number } = {}): PendingActionRecord {
        if (!payload || typeof payload !== 'object') {
            throw new Error('pendingActions.create requires a payload object');
        }
        let id: string | undefined;
        // Defensive against the rare collision; effectively never hits.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const candidate = generateId();
            if (!entries.has(candidate)) {
                id = candidate;
                break;
            }
        }
        if (!id) {
            throw new Error('pendingActions: failed to generate a unique id');
        }
        const now = nowFn();
        const effectiveTtl = Math.max(5_000, Number(overrideTtlMs || ttlMs));
        const record: PendingActionRecord = {
            id,
            payload,
            createdAt: now,
            expiresAt: now + effectiveTtl,
        };
        entries.set(id, record);
        ensureSweepRunning();
        return record;
    }

    function peek(id: string): PendingActionRecord | null {
        const record = entries.get(id);
        if (!record) return null;
        if (record.expiresAt <= nowFn()) {
            entries.delete(id);
            return null;
        }
        return record;
    }

    function take(id: string): PendingActionRecord | null {
        const record = peek(id);
        if (!record) return null;
        entries.delete(id);
        return record;
    }

    function clear(id: string): boolean {
        return entries.delete(id);
    }

    function size(): number {
        return entries.size;
    }

    function reset(): void {
        entries.clear();
        if (sweepHandle) {
            clearInterval(sweepHandle);
            sweepHandle = null;
        }
    }

    return {
        create,
        peek,
        take,
        clear,
        size,
        sweepNow,
        reset,
    };
}
