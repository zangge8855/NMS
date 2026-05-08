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
    const language = resolveLocaleTag(locale);
    const messages = language === 'en-US'
        ? {
            dns: 'Node hostname cannot be resolved. Check the node URL or DNS settings.',
            refused: 'The node refused the connection. Confirm the panel port and 3x-ui service are listening.',
            timeout: 'Request timed out. Check the network path or node status.',
            network: 'Connection failed. Check the management backend, network path, and node availability.',
            auth: 'Node authentication failed. Re-enter and save the panel username and password.',
            inbounds: 'Failed to read the node inbound list. Verify node availability and retry.',
            panel: 'Node panel connection failed. Check the panel URL, port, and access policy.',
            notFound: 'Node not found. Refresh the node list and retry.',
        }
        : {
            dns: '节点域名无法解析，请检查节点 URL 或 DNS 配置',
            refused: '节点拒绝连接，请确认面板端口和 3x-ui 服务正在监听',
            timeout: '请求超时，请检查网络路径或节点状态',
            network: '连接失败，请检查管理后端、网络路径和节点可用性',
            auth: '节点认证失败，请重新输入并保存面板用户名/密码',
            inbounds: '节点入站列表读取失败，请确认节点可用后重试',
            panel: '节点面板连接失败，请检查面板地址、端口和访问策略',
            notFound: '节点不存在，请刷新节点列表后重试',
        };
    const apiMsg = String(err?.response?.data?.msg || '').trim();
    const rawMessage = String(err?.message || '').trim();
    const raw = `${apiMsg} ${rawMessage} ${err?.code || ''}`.toLowerCase();

    if (/getaddrinfo|enotfound|eai_again|dns|resolve/.test(raw)) return messages.dns;
    if (/econnrefused/.test(raw)) return messages.refused;
    if (/timeout|etimedout|econnaborted/.test(raw)) return messages.timeout;
    if (/panel_login_failed|failed to authenticate|auth failed|login failed|401|403|用户名|密码|unauthorized|forbidden/.test(raw)) return messages.auth;
    if (/panel_inbound_list_failed|list inbounds failed|inbound list/.test(raw)) return messages.inbounds;
    if (/connection failed|failed to connect to panel|panel connection/.test(raw)) return messages.panel;
    if (/network error|err_network|econnreset|ehostunreach|enetunreach/.test(raw)) return messages.network;
    if (/server not found|node not found/.test(raw)) return messages.notFound;

    if (apiMsg) return apiMsg;
    if (err?.code === 'ECONNABORTED') {
        return messages.timeout;
    }
    if (err?.message === 'Network Error') {
        return messages.network;
    }
    if (err?.response && /^Request failed with status code \d{3}$/i.test(rawMessage)) {
        return fallback;
    }
    return rawMessage || fallback;
}
