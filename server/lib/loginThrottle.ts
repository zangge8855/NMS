/**
 * Fixed-window failure counter with a temporary block, used for sign-in
 * throttling. Each instance tracks one dimension (IP + account, account, IP).
 *
 * The map is bounded. When it is full, expired entries go first, then the
 * oldest entry that is not blocked, so an attacker who floods it with fresh
 * keys cannot push out an active block or switch tracking off.
 */

interface ThrottleEntry {
    count: number;
    firstAttempt: number;
    blockedUntil: number;
}

export interface ThrottleState {
    blocked: boolean;
    retryAfterMs: number;
    count: number;
}

export interface LoginThrottleOptions {
    windowMs: number;
    maxFailures: number;
    maxEntries?: number;
}

export class LoginThrottle {
    readonly windowMs: number;
    readonly maxFailures: number;
    readonly maxEntries: number;
    private readonly entries = new Map<string, ThrottleEntry>();

    constructor({ windowMs, maxFailures, maxEntries = 10_000 }: LoginThrottleOptions) {
        this.windowMs = Math.max(1, Number(windowMs) || 1);
        this.maxFailures = Math.max(1, Number(maxFailures) || 1);
        this.maxEntries = Math.max(1, Number(maxEntries) || 1);
    }

    get size(): number {
        return this.entries.size;
    }

    private isExpired(entry: ThrottleEntry, now: number): boolean {
        if (entry.blockedUntil) return entry.blockedUntil <= now;
        return now - entry.firstAttempt > this.windowMs;
    }

    state(key: string, now: number = Date.now()): ThrottleState {
        const entry = this.entries.get(key);
        if (!entry) return { blocked: false, retryAfterMs: 0, count: 0 };
        if (this.isExpired(entry, now)) {
            this.entries.delete(key);
            return { blocked: false, retryAfterMs: 0, count: 0 };
        }
        if (entry.blockedUntil > now) {
            return { blocked: true, retryAfterMs: entry.blockedUntil - now, count: entry.count };
        }
        return { blocked: false, retryAfterMs: 0, count: entry.count };
    }

    /** Count one failure; returns true when this failure triggered a new block. */
    recordFailure(key: string, now: number = Date.now()): boolean {
        const existing = this.entries.get(key);
        if (!existing || this.isExpired(existing, now)) {
            if (existing) this.entries.delete(key);
            this.makeRoom(now);
            const entry: ThrottleEntry = { count: 1, firstAttempt: now, blockedUntil: 0 };
            if (entry.count >= this.maxFailures) entry.blockedUntil = now + this.windowMs;
            this.entries.set(key, entry);
            return entry.blockedUntil > 0;
        }
        if (existing.blockedUntil > now) return false;
        existing.count += 1;
        if (existing.count >= this.maxFailures) {
            existing.blockedUntil = now + this.windowMs;
            return true;
        }
        return false;
    }

    clear(key: string): void {
        this.entries.delete(key);
    }

    sweep(now: number = Date.now()): void {
        for (const [key, entry] of this.entries) {
            if (this.isExpired(entry, now)) this.entries.delete(key);
        }
    }

    private makeRoom(now: number): void {
        if (this.entries.size < this.maxEntries) return;
        this.sweep(now);
        if (this.entries.size < this.maxEntries) return;
        for (const [key, entry] of this.entries) {
            if (!(entry.blockedUntil > now)) {
                this.entries.delete(key);
                return;
            }
        }
        // Every tracked key is blocked: drop the oldest block rather than stop tracking.
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
    }
}
