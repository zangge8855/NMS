/**
 * Shared normalization utilities.
 */

export function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

export function parseJsonObjectLike(value, fallback = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    const text = String(value || '').trim();
    if (!text) return fallback;
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return fallback;
        }
        return parsed;
    } catch {
        return fallback;
    }
}

export function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}
