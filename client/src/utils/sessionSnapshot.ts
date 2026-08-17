const SNAPSHOT_PREFIX = 'nms_session_snapshot:';
export const SESSION_SNAPSHOT_EVENT = 'nms:session-snapshot';

interface ScheduledTask {
    type: 'idle' | 'timeout';
    id: number;
}

const pendingWrites = new Map<string, ScheduledTask>();

function canUseSessionStorage(): boolean {
    try {
        return typeof window !== 'undefined' && Boolean(window.sessionStorage);
    } catch {
        return false;
    }
}

function buildSnapshotKey(key: string): string {
    return `${SNAPSHOT_PREFIX}${String(key || '').trim()}`;
}

function scheduleSnapshotWrite(callback: () => void): ScheduledTask {
    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
        return {
            type: 'idle',
            id: (window as any).requestIdleCallback(callback, { timeout: 800 }),
        };
    }

    return {
        type: 'timeout',
        id: window.setTimeout(callback, 0),
    };
}

function cancelScheduledSnapshotWrite(task?: ScheduledTask): void {
    if (!task || typeof window === 'undefined') return;
    if (task.type === 'idle' && typeof (window as any).cancelIdleCallback === 'function') {
        (window as any).cancelIdleCallback(task.id);
        return;
    }
    window.clearTimeout(task.id);
}

export interface ReadSessionSnapshotOptions<T> {
    fallback?: T;
    maxAgeMs?: number;
}

export function readSessionSnapshot<T = any>(key: string, options: ReadSessionSnapshotOptions<T> = {}): T | null {
    if (!canUseSessionStorage()) return (options.fallback ?? null) as (T | null);

    const fallback = (options.fallback ?? null) as (T | null);
    const maxAgeMs = Number(options.maxAgeMs || 0);

    try {
        const raw = window.sessionStorage.getItem(buildSnapshotKey(key));
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        const savedAt = Number(parsed?.savedAt || 0);
        if (maxAgeMs > 0 && savedAt > 0 && (Date.now() - savedAt) > maxAgeMs) {
            window.sessionStorage.removeItem(buildSnapshotKey(key));
            return fallback;
        }
        return (parsed?.value ?? fallback) as T;
    } catch {
        try {
            window.sessionStorage.removeItem(buildSnapshotKey(key));
        } catch {
            // ignore storage cleanup failures
        }
        return fallback;
    }
}

export interface WriteSessionSnapshotOptions {
    source?: string;
    defer?: boolean;
    includeEventValue?: boolean;
}

function commitSessionSnapshotWrite(key: string, value: any, options: WriteSessionSnapshotOptions = {}): void {
    if (!canUseSessionStorage()) return;

    try {
        const snapshotKey = buildSnapshotKey(key);
        const savedAt = Date.now();
        window.sessionStorage.setItem(buildSnapshotKey(key), JSON.stringify({
            savedAt,
            value,
        }));
        const detail: Record<string, any> = {
            key: String(key || '').trim(),
            action: 'write',
            source: String(options?.source || '').trim(),
            storageKey: snapshotKey,
        };
        if (options?.includeEventValue !== false) {
            detail.value = value;
        }
        window.dispatchEvent(new CustomEvent(SESSION_SNAPSHOT_EVENT, {
            detail,
        }));
    } catch {
        // ignore storage quota errors
    }
}

export function writeSessionSnapshot(key: string, value: any, options: WriteSessionSnapshotOptions = {}): void {
    if (!canUseSessionStorage()) return;

    const snapshotKey = buildSnapshotKey(key);
    if (options?.defer === true) {
        cancelScheduledSnapshotWrite(pendingWrites.get(snapshotKey));
        pendingWrites.set(snapshotKey, scheduleSnapshotWrite(() => {
            pendingWrites.delete(snapshotKey);
            commitSessionSnapshotWrite(key, value, options);
        }));
        return;
    }

    cancelScheduledSnapshotWrite(pendingWrites.get(snapshotKey));
    pendingWrites.delete(snapshotKey);
    commitSessionSnapshotWrite(key, value, options);
}

export function clearSessionSnapshot(key: string): void {
    if (!canUseSessionStorage()) return;
    try {
        const snapshotKey = buildSnapshotKey(key);
        cancelScheduledSnapshotWrite(pendingWrites.get(snapshotKey));
        pendingWrites.delete(snapshotKey);
        window.sessionStorage.removeItem(buildSnapshotKey(key));
        window.dispatchEvent(new CustomEvent(SESSION_SNAPSHOT_EVENT, {
            detail: {
                key: String(key || '').trim(),
                action: 'clear',
                source: '',
                storageKey: snapshotKey,
            },
        }));
    } catch {
        // ignore storage cleanup failures
    }
}

// Remove every session snapshot, including dynamically-keyed ones (per-server
// user stats, per-window telemetry) that a static key list can't enumerate.
// Everything under SNAPSHOT_PREFIX is transient, account-scoped data cache —
// theme/locale live in localStorage — so a logout must wipe all of it.
export function clearAllSessionSnapshots(): void {
    if (!canUseSessionStorage()) return;
    try {
        pendingWrites.forEach((handle) => cancelScheduledSnapshotWrite(handle));
        pendingWrites.clear();
        const doomed: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i += 1) {
            const storageKey = window.sessionStorage.key(i);
            if (storageKey && storageKey.startsWith(SNAPSHOT_PREFIX)) doomed.push(storageKey);
        }
        doomed.forEach((storageKey) => window.sessionStorage.removeItem(storageKey));
        window.dispatchEvent(new CustomEvent(SESSION_SNAPSHOT_EVENT, {
            detail: { key: '', action: 'clear-all', source: '', storageKey: '' },
        }));
    } catch {
        // ignore storage cleanup failures
    }
}
