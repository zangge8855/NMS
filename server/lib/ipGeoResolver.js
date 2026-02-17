import net from 'node:net';
import config from '../config.js';

const DEFAULT_PROVIDER = 'ip_api';
const DEFAULT_ENDPOINT = 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_SECONDS = 6 * 60 * 60;
const LOCAL_IP_LABEL = '内网/本地';

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

export function normalizeIpAddress(value) {
    let text = String(value || '').trim();
    if (!text || text.toLowerCase() === 'unknown') return '';

    if (text.includes(',')) {
        text = text.split(',')[0].trim();
    }

    if (text.startsWith('[')) {
        const end = text.indexOf(']');
        if (end > 0) {
            text = text.slice(1, end);
        }
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
        text = text.replace(/:\d+$/, '');
    }

    if (text.includes('%')) {
        text = text.split('%')[0].trim();
    }

    if (text.toLowerCase().startsWith('::ffff:')) {
        const mapped = text.slice(7);
        if (net.isIP(mapped) === 4) {
            text = mapped;
        }
    }

    return net.isIP(text) ? text : '';
}

function isPrivateIpv4(ip) {
    const parts = ip.split('.').map((item) => Number(item));
    if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item) || item < 0 || item > 255)) {
        return false;
    }
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

function isPrivateIpv6(ip) {
    const text = ip.toLowerCase();
    if (text === '::1') return true;
    if (text.startsWith('fc') || text.startsWith('fd')) return true;
    if (text.startsWith('fe8') || text.startsWith('fe9') || text.startsWith('fea') || text.startsWith('feb')) return true;
    return false;
}

export function isPrivateOrLocalIp(value) {
    const ip = normalizeIpAddress(value);
    if (!ip) return false;
    const family = net.isIP(ip);
    if (family === 4) return isPrivateIpv4(ip);
    if (family === 6) return isPrivateIpv6(ip);
    return false;
}

function sanitizeLocation(value) {
    let text = String(value || '').trim();
    if (!text) return '';
    text = text.replace(/\s+/g, ' ').replace(/^[,，]+|[,，]+$/g, '').trim();
    if (!text) return '';
    if (text.toLowerCase() === 'unknown') return '';
    if (text.length > 120) text = text.slice(0, 120);
    return text;
}

export function parseIpipMyIpResponse(value) {
    const text = String(value || '');
    if (!text.trim()) return '';
    const fromMatch = text.match(/来自于[:：]\s*([^\n\r]+)/u);
    if (fromMatch?.[1]) return sanitizeLocation(fromMatch[1]);
    const fallbackMatch = text.match(/\bfrom[:：]\s*([^\n\r]+)/iu);
    if (fallbackMatch?.[1]) return sanitizeLocation(fallbackMatch[1]);
    return '';
}

export function parseIpApiResponse(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const data = JSON.parse(text);
        if (data.status !== 'success') return '';
        const parts = [data.country, data.regionName, data.city].filter(Boolean);
        return sanitizeLocation(parts.join(' '));
    } catch {
        return '';
    }
}

function buildProviderUrl(provider, endpointTemplate, ip) {
    const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();

    if (normalizedProvider === 'ip_api') {
        const template = String(endpointTemplate || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
        if (template.includes('{ip}')) {
            return template.replaceAll('{ip}', encodeURIComponent(ip));
        }
        return `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city&lang=zh-CN`;
    }

    if (normalizedProvider === 'ipip_myip') {
        const template = String(endpointTemplate || 'http://myip.ipip.net').trim();
        if (template.includes('{ip}')) {
            return template.replaceAll('{ip}', encodeURIComponent(ip));
        }
        return template;
    }

    return '';
}

function parseProviderResult(provider, payload) {
    const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();
    if (normalizedProvider === 'ip_api') return parseIpApiResponse(payload);
    if (normalizedProvider === 'ipip_myip') return parseIpipMyIpResponse(payload);
    return '';
}

function createDefaultFetcher() {
    return async ({ url, timeoutMs }) => {
        if (typeof fetch !== 'function') {
            throw new Error('fetch-unavailable');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'NMS-Audit-IPGeo/1.0',
                    'Accept': 'text/plain,*/*;q=0.8',
                },
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`geo-provider-status-${response.status}`);
            }
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    };
}

export function createIpGeoResolver(options = {}) {
    const runtime = {
        enabled: toBoolean(options.enabled, false),
        provider: String(options.provider || DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER,
        endpoint: String(options.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
        timeoutMs: toPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS),
        cacheTtlSeconds: toPositiveInt(options.cacheTtlSeconds, DEFAULT_CACHE_TTL_SECONDS),
    };
    const fetcher = typeof options.fetcher === 'function' ? options.fetcher : createDefaultFetcher();

    const cache = new Map();
    const inflight = new Map();

    function fromCache(ip, nowTs = Date.now()) {
        const item = cache.get(ip);
        if (!item) return '';
        if (item.expiresAt <= nowTs) {
            cache.delete(ip);
            return '';
        }
        return item.location;
    }

    function toCache(ip, location, ttlMs = runtime.cacheTtlSeconds * 1000) {
        cache.set(ip, {
            location: String(location || ''),
            expiresAt: Date.now() + Math.max(1000, ttlMs),
        });
    }

    function configure(next = {}) {
        const previousProvider = runtime.provider;
        const previousEndpoint = runtime.endpoint;

        if (Object.prototype.hasOwnProperty.call(next, 'enabled')) {
            runtime.enabled = toBoolean(next.enabled, runtime.enabled);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'provider')) {
            const normalizedProvider = String(next.provider || '').trim().toLowerCase();
            if (normalizedProvider) runtime.provider = normalizedProvider;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'endpoint')) {
            const normalizedEndpoint = String(next.endpoint || '').trim();
            if (normalizedEndpoint) runtime.endpoint = normalizedEndpoint;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'timeoutMs')) {
            runtime.timeoutMs = toPositiveInt(next.timeoutMs, runtime.timeoutMs);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'cacheTtlSeconds')) {
            runtime.cacheTtlSeconds = toPositiveInt(next.cacheTtlSeconds, runtime.cacheTtlSeconds);
        }

        if (runtime.provider !== previousProvider || runtime.endpoint !== previousEndpoint) {
            cache.clear();
        }
    }

    async function lookup(ipInput) {
        const ip = normalizeIpAddress(ipInput);
        if (!ip) return '';
        if (isPrivateOrLocalIp(ip)) return LOCAL_IP_LABEL;
        if (!runtime.enabled) return '';

        const cached = fromCache(ip);
        if (cached) return cached;

        if (inflight.has(ip)) {
            return inflight.get(ip);
        }

        const task = (async () => {
            const url = buildProviderUrl(runtime.provider, runtime.endpoint, ip);
            if (!url) return '';
            try {
                const payload = await fetcher({ ip, url, provider: runtime.provider, timeoutMs: runtime.timeoutMs });
                const location = parseProviderResult(runtime.provider, payload);
                toCache(ip, location);
                return location;
            } catch {
                toCache(ip, '', Math.min(runtime.cacheTtlSeconds * 1000, 60 * 1000));
                return '';
            } finally {
                inflight.delete(ip);
            }
        })();

        inflight.set(ip, task);
        return task;
    }

    async function lookupMany(values = []) {
        const unique = Array.from(
            new Set(
                (Array.isArray(values) ? values : [])
                    .map((item) => normalizeIpAddress(item))
                    .filter(Boolean)
            )
        );
        const entries = await Promise.all(unique.map(async (ip) => [ip, await lookup(ip)]));
        return new Map(entries);
    }

    function pickFromMap(map, rawIp) {
        if (!(map instanceof Map)) return '';
        const ip = normalizeIpAddress(rawIp);
        if (!ip) return '';
        if (isPrivateOrLocalIp(ip)) return LOCAL_IP_LABEL;
        return String(map.get(ip) || '');
    }

    function metadata() {
        return {
            enabled: runtime.enabled,
            provider: runtime.provider,
            endpoint: runtime.endpoint,
            timeoutMs: runtime.timeoutMs,
            cacheTtlSeconds: runtime.cacheTtlSeconds,
        };
    }

    return {
        configure,
        lookup,
        lookupMany,
        pickFromMap,
        metadata,
        isEnabled: () => runtime.enabled,
    };
}

const resolver = createIpGeoResolver({
    enabled: config.audit?.ipGeo?.enabled,
    provider: config.audit?.ipGeo?.provider,
    endpoint: config.audit?.ipGeo?.endpoint,
    timeoutMs: config.audit?.ipGeo?.timeoutMs,
    cacheTtlSeconds: config.audit?.ipGeo?.cacheTtlSeconds,
});

export default resolver;
