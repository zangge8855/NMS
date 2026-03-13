/**
 * Format bytes to human readable (KB, MB, GB, TB).
 */
const DATE_TIME_FORMATTER_CACHE = new Map();
const RELATIVE_TIME_FORMATTER_CACHE = new Map();

export function resolveLocaleTag(locale = 'zh-CN') {
    return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

function toValidDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function buildFormatterCacheKey(locale, options = {}) {
    const normalizedLocale = resolveLocaleTag(locale);
    const entries = Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify([normalizedLocale, entries]);
}

function getDateTimeFormatter(locale, options = {}) {
    const cacheKey = buildFormatterCacheKey(locale, options);
    if (!DATE_TIME_FORMATTER_CACHE.has(cacheKey)) {
        DATE_TIME_FORMATTER_CACHE.set(cacheKey, new Intl.DateTimeFormat(resolveLocaleTag(locale), options));
    }
    return DATE_TIME_FORMATTER_CACHE.get(cacheKey);
}

function getRelativeTimeFormatter(locale) {
    const normalizedLocale = resolveLocaleTag(locale);
    if (!RELATIVE_TIME_FORMATTER_CACHE.has(normalizedLocale)) {
        RELATIVE_TIME_FORMATTER_CACHE.set(
            normalizedLocale,
            new Intl.RelativeTimeFormat(normalizedLocale, { numeric: 'auto' })
        );
    }
    return RELATIVE_TIME_FORMATTER_CACHE.get(normalizedLocale);
}

export function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format uptime seconds to human readable.
 */
export function formatUptime(seconds, locale = 'zh-CN') {
    const normalizedLocale = resolveLocaleTag(locale);
    const totalSeconds = Number(seconds || 0);
    if (!totalSeconds) return normalizedLocale === 'en-US' ? '0s' : '0秒';

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];

    if (normalizedLocale === 'en-US') {
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (parts.length === 0) parts.push(`${totalSeconds}s`);
        return parts.join(' ');
    }

    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}时`);
    if (minutes > 0) parts.push(`${minutes}分`);
    if (parts.length === 0) parts.push(`${totalSeconds}秒`);
    return parts.join(' ');
}

/**
 * Format date to local string.
 */
export function formatDate(dateStr, locale = 'zh-CN') {
    const date = toValidDate(dateStr);
    if (!date) return '-';
    return getDateTimeFormatter(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

export function formatDateTime(value, locale = 'zh-CN', options = {}) {
    const date = toValidDate(value);
    if (!date) return '-';
    return getDateTimeFormatter(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...options,
    }).format(date);
}

export function formatDateOnly(value, locale = 'zh-CN', options = {}) {
    const date = toValidDate(value);
    if (!date) return '-';
    return getDateTimeFormatter(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...options,
    }).format(date);
}

export function formatTimeOnly(value, locale = 'zh-CN', options = {}) {
    const date = toValidDate(value);
    if (!date) return '-';
    return getDateTimeFormatter(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...options,
    }).format(date);
}

export function formatRelativeTime(value, locale = 'zh-CN') {
    const date = toValidDate(value);
    if (!date) return '';
    const diffMs = date.getTime() - Date.now();
    const diffSeconds = Math.round(diffMs / 1000);
    const absoluteSeconds = Math.abs(diffSeconds);
    const formatter = getRelativeTimeFormatter(locale);

    if (absoluteSeconds < 60) {
        return formatter.format(Math.round(diffSeconds), 'second');
    }
    if (absoluteSeconds < 3600) {
        return formatter.format(Math.round(diffSeconds / 60), 'minute');
    }
    if (absoluteSeconds < 86400) {
        return formatter.format(Math.round(diffSeconds / 3600), 'hour');
    }
    if (absoluteSeconds < 604800) {
        return formatter.format(Math.round(diffSeconds / 86400), 'day');
    }
    return formatDateOnly(date, locale);
}

/**
 * Format timestamp (ms) to relative time.
 */
export function formatTimestamp(ts, locale = 'zh-CN') {
    if (!ts || ts === 0) return resolveLocaleTag(locale) === 'en-US' ? 'Never' : '从未';
    return formatRelativeTime(ts, locale);
}

/**
 * Get protocol color class.
 */
export function getProtocolColor(protocol) {
    const colors = {
        vmess: '#3b82f6',
        vless: '#8b5cf6',
        trojan: '#ef4444',
        shadowsocks: '#10b981',
        wireguard: '#f59e0b',
        socks: '#ec4899',
        http: '#6366f1',
        mixed: '#14b8a6',
    };
    return colors[protocol?.toLowerCase()] || '#94a3b8';
}

/**
 * Copy text to clipboard.
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
    }
}

/**
 * Extract a user-friendly error message from an Axios error or generic Error.
 */
export function getErrorMessage(err, fallback = '操作失败', locale = 'zh-CN') {
    const apiMsg = err?.response?.data?.msg;
    if (apiMsg) return apiMsg;
    if (err?.code === 'ECONNABORTED') {
        return resolveLocaleTag(locale) === 'en-US'
            ? 'Request timed out. Check the network path or node status.'
            : '请求超时，请检查网络或节点状态';
    }
    if (err?.message === 'Network Error') {
        return resolveLocaleTag(locale) === 'en-US'
            ? 'Connection failed: the management backend is unreachable.'
            : '连接失败：管理后端不可达，请确认后端服务已启动';
    }
    return err?.message || fallback;
}
