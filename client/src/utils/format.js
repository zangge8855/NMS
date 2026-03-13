/**
 * Format bytes to human readable (KB, MB, GB, TB).
 */
export function resolveLocaleTag(locale = 'zh-CN') {
    return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

function toValidDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

export function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format uptime seconds to human readable.
 */
export function formatUptime(seconds) {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}天`);
    if (h > 0) parts.push(`${h}时`);
    if (m > 0) parts.push(`${m}分`);
    if (parts.length === 0) parts.push(`${seconds}秒`);
    return parts.join(' ');
}

/**
 * Format date to local string.
 */
export function formatDate(dateStr, locale = 'zh-CN') {
    const date = toValidDate(dateStr);
    if (!date) return '-';
    return date.toLocaleDateString(resolveLocaleTag(locale), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}

export function formatDateTime(value, locale = 'zh-CN', options = {}) {
    const date = toValidDate(value);
    if (!date) return '-';
    return date.toLocaleString(resolveLocaleTag(locale), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hour12: false,
        ...options,
    });
}

export function formatDateOnly(value, locale = 'zh-CN', options = {}) {
    const date = toValidDate(value);
    if (!date) return '-';
    return date.toLocaleDateString(resolveLocaleTag(locale), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...options,
    });
}

export function formatTimeOnly(value, locale = 'zh-CN', options = {}) {
    const date = toValidDate(value);
    if (!date) return '-';
    return date.toLocaleTimeString(resolveLocaleTag(locale), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...options,
    });
}

export function formatRelativeTime(value, locale = 'zh-CN') {
    const date = toValidDate(value);
    if (!date) return '';
    const diff = Date.now() - date.getTime();
    const normalizedLocale = resolveLocaleTag(locale);
    if (diff < 60_000) return normalizedLocale === 'en-US' ? 'Just now' : '刚刚';
    if (diff < 3600_000) {
        const minutes = Math.floor(diff / 60_000);
        return normalizedLocale === 'en-US' ? `${minutes} min ago` : `${minutes} 分钟前`;
    }
    if (diff < 86400_000) {
        const hours = Math.floor(diff / 3600_000);
        return normalizedLocale === 'en-US' ? `${hours} hr ago` : `${hours} 小时前`;
    }
    return formatDateOnly(date, normalizedLocale);
}

/**
 * Format timestamp (ms) to relative time.
 */
export function formatTimestamp(ts) {
    if (!ts || ts === 0) return '从未';
    const date = new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
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
export function getErrorMessage(err, fallback = '操作失败') {
    const apiMsg = err?.response?.data?.msg;
    if (apiMsg) return apiMsg;
    if (err?.code === 'ECONNABORTED') return '请求超时，请检查网络或节点状态';
    if (err?.message === 'Network Error') {
        return '连接失败：管理后端不可达，请确认后端服务已启动';
    }
    return err?.message || fallback;
}
