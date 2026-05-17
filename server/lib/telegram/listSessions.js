import crypto from 'crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function createSessionId() {
    return crypto.randomBytes(4).toString('hex');
}

export function createListSessionStore(options = {}) {
    const ttlMs = Math.max(1_000, Number(options.ttlMs || DEFAULT_TTL_MS));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const sessions = new Map();

    function sweepExpired() {
        const ts = now();
        for (const [id, record] of sessions.entries()) {
            if (record.expiresAt <= ts) {
                sessions.delete(id);
            }
        }
    }

    function create(payload = {}) {
        sweepExpired();
        let id = createSessionId();
        while (sessions.has(id)) {
            id = createSessionId();
        }
        const record = {
            id,
            payload,
            expiresAt: now() + ttlMs,
        };
        sessions.set(id, record);
        return record;
    }

    function get(id = '') {
        sweepExpired();
        const record = sessions.get(String(id || '').trim()) || null;
        if (!record) return null;
        record.expiresAt = now() + ttlMs;
        return record;
    }

    function clear(id = '') {
        return sessions.delete(String(id || '').trim());
    }

    function reset() {
        sessions.clear();
    }

    function size() {
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
