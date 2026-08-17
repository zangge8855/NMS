import crypto from 'crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function createSessionId(): string {
    return crypto.randomBytes(4).toString('hex');
}

export interface ListSessionRecord {
    id: string;
    payload: any;
    expiresAt: number;
}

export interface ListSessionStore {
    create: (payload?: any) => ListSessionRecord;
    get: (id?: string) => ListSessionRecord | null;
    clear: (id?: string) => boolean;
    reset: () => void;
    size: () => number;
    sweepExpired: () => void;
}

export function createListSessionStore(options: { ttlMs?: number; now?: () => number } = {}): ListSessionStore {
    const ttlMs = Math.max(1_000, Number(options.ttlMs || DEFAULT_TTL_MS));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const sessions = new Map<string, ListSessionRecord>();

    function sweepExpired(): void {
        const ts = now();
        for (const [id, record] of sessions.entries()) {
            if (record.expiresAt <= ts) {
                sessions.delete(id);
            }
        }
    }

    function create(payload: any = {}): ListSessionRecord {
        sweepExpired();
        let id = createSessionId();
        while (sessions.has(id)) {
            id = createSessionId();
        }
        const record: ListSessionRecord = {
            id,
            payload,
            expiresAt: now() + ttlMs,
        };
        sessions.set(id, record);
        return record;
    }

    function get(id: string = ''): ListSessionRecord | null {
        sweepExpired();
        const record = sessions.get(String(id || '').trim()) || null;
        if (!record) return null;
        record.expiresAt = now() + ttlMs;
        return record;
    }

    function clear(id: string = ''): boolean {
        return sessions.delete(String(id || '').trim());
    }

    function reset(): void {
        sessions.clear();
    }

    function size(): number {
        sweepExpired();
        return sessions.size;
    }

    return {
        create,
        get,
        clear,
        reset,
        size,
        sweepExpired,
    };
}

export const __testing = {
    DEFAULT_TTL_MS,
};
