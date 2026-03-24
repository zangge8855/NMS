const SNAPSHOT_PREFIX = 'nms_session_snapshot:';
export const SESSION_SNAPSHOT_EVENT = 'nms:session-snapshot';

function canUseSessionStorage() {
    try {
        return typeof window !== 'undefined' && Boolean(window.sessionStorage);
    } catch {
        return false;
    }
}

function buildSnapshotKey(key) {
    return `${SNAPSHOT_PREFIX}${String(key || '').trim()}`;
}

export function readSessionSnapshot(key, options = {}) {
    if (!canUseSessionStorage()) return options.fallback ?? null;

    const fallback = options.fallback ?? null;
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
        return parsed?.value ?? fallback;
    } catch {
        try {
            window.sessionStorage.removeItem(buildSnapshotKey(key));
        } catch {
            // ignore storage cleanup failures
        }
        return fallback;
    }
}

export function writeSessionSnapshot(key, value, options = {}) {
    if (!canUseSessionStorage()) return;

    try {
        const snapshotKey = buildSnapshotKey(key);
        const payload = {
            savedAt: Date.now(),
            value,
        };
        window.sessionStorage.setItem(buildSnapshotKey(key), JSON.stringify({
            savedAt: payload.savedAt,
            value: payload.value,
        }));
        window.dispatchEvent(new CustomEvent(SESSION_SNAPSHOT_EVENT, {
            detail: {
                key: String(key || '').trim(),
                action: 'write',
                source: String(options?.source || '').trim(),
                storageKey: snapshotKey,
                value,
            },
        }));
    } catch {
        // ignore storage quota errors
    }
}

export function clearSessionSnapshot(key) {
    if (!canUseSessionStorage()) return;
    try {
        window.sessionStorage.removeItem(buildSnapshotKey(key));
        window.dispatchEvent(new CustomEvent(SESSION_SNAPSHOT_EVENT, {
            detail: {
                key: String(key || '').trim(),
                action: 'clear',
                source: '',
                storageKey: buildSnapshotKey(key),
            },
        }));
    } catch {
        // ignore storage cleanup failures
    }
}
