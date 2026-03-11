const RESERVED_EXACT_PATHS = new Set([
    '/',
    '/login',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/manifest.webmanifest',
    '/vite.svg',
]);

const RESERVED_PREFIXES = [
    '/api',
    '/assets',
    '/src',
    '/node_modules',
    '/@vite',
];

const RESERVED_APP_ROUTES = [
    '/subscriptions',
    '/clients',
    '/servers',
    '/inbounds',
    '/settings',
    '/audit',
    '/tasks',
    '/server',
    '/tools',
    '/capabilities',
    '/logs',
];

export function normalizeSubscriptionAliasPath(value) {
    let text = String(value || '').trim();
    if (!text) return '';

    if (/^https?:\/\//i.test(text)) {
        try {
            const parsed = new URL(text);
            text = parsed.pathname || '';
        } catch {
            text = '';
        }
    }

    text = text.split('#')[0].split('?')[0].trim().toLowerCase();
    if (!text) return '';
    if (!text.startsWith('/')) text = `/${text}`;
    text = text.replace(/\/{2,}/g, '/');
    if (text.length > 1 && text.endsWith('/')) {
        text = text.slice(0, -1);
    }
    return text;
}

export function isReservedSubscriptionAliasPath(value) {
    const normalized = normalizeSubscriptionAliasPath(value);
    if (!normalized) return false;
    if (RESERVED_EXACT_PATHS.has(normalized)) return true;
    if (RESERVED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
        return true;
    }
    return RESERVED_APP_ROUTES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function validateSubscriptionAliasPath(value, options = {}) {
    const normalized = normalizeSubscriptionAliasPath(value);
    if (!normalized) {
        return { ok: true, value: '' };
    }

    if (normalized.length > 120) {
        return { ok: false, value: normalized, message: '兼容订阅路径长度不能超过 120 个字符' };
    }

    if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(normalized)) {
        return { ok: false, value: normalized, message: '兼容订阅路径仅支持小写字母、数字、连字符和多级路径' };
    }

    if (isReservedSubscriptionAliasPath(normalized)) {
        return { ok: false, value: normalized, message: '兼容订阅路径与系统保留路径冲突' };
    }

    const existing = options.findByPath?.(normalized);
    if (existing && String(existing.id || '') !== String(options.excludeUserId || '')) {
        return { ok: false, value: normalized, message: `兼容订阅路径 "${normalized}" 已被其他用户占用` };
    }

    return { ok: true, value: normalized };
}
