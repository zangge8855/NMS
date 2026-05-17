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

function generateShortId() {
    // 8 hex chars = 32 bits of entropy. Combined with a single
    // alphabetic prefix in callback_data we stay well under the 64-byte
    // Telegram cap and remain unguessable enough for short-lived confirms.
    return Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');
}

export function createPendingActionStore(options = {}) {
    const ttlMs = Math.max(5_000, Number(options.ttlMs || DEFAULT_TTL_MS));
    const sweepIntervalMs = Math.max(5_000, Number(options.sweepIntervalMs || SWEEP_INTERVAL_MS));
    const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
    const generateId = typeof options.generateId === 'function' ? options.generateId : generateShortId;
    const startInterval = typeof options.startInterval === 'function'
        ? options.startInterval
        : (fn, delay) => {
            const handle = setInterval(fn, delay);
            handle.unref?.();
            return handle;
        };

    const entries = new Map();
    let sweepHandle = null;

    function sweepNow() {
        const cutoff = nowFn();
        for (const [id, record] of entries.entries()) {
            if (record.expiresAt <= cutoff) {
                entries.delete(id);
            }
        }
    }

    function ensureSweepRunning() {
        if (sweepHandle || entries.size === 0) return;
        sweepHandle = startInterval(() => {
            sweepNow();
            if (entries.size === 0 && sweepHandle) {
                clearInterval(sweepHandle);
                sweepHandle = null;
            }
        }, sweepIntervalMs);
    }

    function create(payload = {}, { ttlMs: overrideTtlMs } = {}) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('pendingActions.create requires a payload object');
        }
        let id;
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
        const record = {
            id,
            payload,
            createdAt: now,
            expiresAt: now + effectiveTtl,
        };
        entries.set(id, record);
        ensureSweepRunning();
        return record;
    }

    function peek(id) {
        const record = entries.get(id);
        if (!record) return null;
        if (record.expiresAt <= nowFn()) {
            entries.delete(id);
            return null;
        }
        return record;
    }

    function take(id) {
        const record = peek(id);
        if (!record) return null;
        entries.delete(id);
        return record;
    }

    function clear(id) {
        return entries.delete(id);
    }

    function size() {
        return entries.size;
    }

    function reset() {
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
