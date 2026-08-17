/**
 * Shared normalization utilities.
 */

export function normalizeBoolean(value: unknown, fallback: boolean = false): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

export function parseJsonObjectLike<T = Record<string, any>>(value: unknown, fallback: any = {}): T {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as T;
    }
    const text = String(value || '').trim();
    if (!text) return (fallback ?? {}) as T;
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return (fallback ?? {}) as T;
        }
        return parsed as T;
    } catch {
        return (fallback ?? {}) as T;
    }
}

export function normalizeEmail(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}
