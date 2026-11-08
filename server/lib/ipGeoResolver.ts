import net from 'node:net';
import config from '../config.js';

const DEFAULT_PROVIDER = 'ip_api';
const DEFAULT_ENDPOINT = 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_SECONDS = 6 * 60 * 60;
const LOCAL_IP_LABEL = '内网/本地';

function toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function toBoolean(value: unknown, fallback: boolean = false): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

export function stripIpv6Brackets(value: unknown): string {
    const text = String(value || '').trim();
    if (text.startsWith('[') && text.endsWith(']')) {
        return text.slice(1, -1);
    }
    return text;
}

export function formatHostHeaderWithPort(hostRaw: unknown, portRaw: unknown = ''): string {
    const rawHost = String(hostRaw || '').trim();
    if (!rawHost) return '';

    const rawPortText = String(portRaw || '').trim();
    const portNum = /^\d{1,5}$/.test(rawPortText) ? Number(rawPortText) : 0;
    const cleanPort = (portNum >= 1 && portNum <= 65535) ? String(portNum) : '';

    if (rawHost.startsWith('[')) {
        if (/^\[[^\]]+\]:\d{1,5}$/.test(rawHost) || !cleanPort) {
            return rawHost;
        }
        return `${rawHost}:${cleanPort}`;
    }

    if (net.isIP(rawHost) === 6) {
        const bracketed = `[${rawHost}]`;
        return cleanPort ? `${bracketed}:${cleanPort}` : bracketed;
    }

    if (rawHost.includes(':') || !cleanPort) {
        return rawHost;
    }
    return `${rawHost}:${cleanPort}`;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
    const parts = String(ip || '').split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map((item) => {
        if (!/^(?:0|[1-9]\d{0,2})$/.test(item)) return -1;
        return Number(item);
    });
    if (nums.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
        return null;
    }
    return nums as [number, number, number, number];
}

function parseIpv6Hextets(ip: string): number[] | null {
    let text = String(ip || '').trim().toLowerCase();
    if (!text) return null;

    if (text.includes('.')) {
        const lastColon = text.lastIndexOf(':');
        if (lastColon < 0) return null;
        const ipv4Part = text.slice(lastColon + 1);
        const octets = parseIpv4Octets(ipv4Part);
        if (!octets) return null;
        const high = ((octets[0] << 8) | octets[1]).toString(16);
        const low = ((octets[2] << 8) | octets[3]).toString(16);
        text = `${text.slice(0, lastColon)}:${high}:${low}`;
    }

    const compressionParts = text.split('::');
    if (compressionParts.length > 2) return null;

    if (compressionParts.length === 2) {
        const head = compressionParts[0] ? compressionParts[0].split(':') : [];
        const tail = compressionParts[1] ? compressionParts[1].split(':') : [];
        if (head.some((item) => !item) || tail.some((item) => !item)) return null;
        const missing = 8 - head.length - tail.length;
        if (missing < 1) return null;
        const groups = [
            ...head,
            ...Array.from({ length: missing }, () => '0'),
            ...tail,
        ];
        if (groups.length !== 8) return null;
        const parsed = groups.map((item) => (/^[0-9a-f]{1,4}$/.test(item) ? Number.parseInt(item, 16) : -1));
        return parsed.some((item) => item < 0 || item > 0xffff) ? null : parsed;
    }

    const groups = text.split(':');
    if (groups.length !== 8) return null;
    const parsed = groups.map((item) => (/^[0-9a-f]{1,4}$/.test(item) ? Number.parseInt(item, 16) : -1));
    return parsed.some((item) => item < 0 || item > 0xffff) ? null : parsed;
}

function formatCanonicalIpv6(hextets: number[]): string {
    if (hextets.length !== 8) return '';

    // Unwrap IPv4-mapped IPv6 addresses (::ffff:0:0/96) into dotted IPv4.
    if (
        hextets[0] === 0
        && hextets[1] === 0
        && hextets[2] === 0
        && hextets[3] === 0
        && hextets[4] === 0
        && hextets[5] === 0xffff
    ) {
        const a = (hextets[6] >> 8) & 0xff;
        const b = hextets[6] & 0xff;
        const c = (hextets[7] >> 8) & 0xff;
        const d = hextets[7] & 0xff;
        return `${a}.${b}.${c}.${d}`;
    }

    // RFC 5952 longest zero-run compression (only compress runs of >= 2 hextets, leftmost tie-break).
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;

    for (let i = 0; i < 8; i += 1) {
        if (hextets[i] === 0) {
            if (curStart === -1) {
                curStart = i;
                curLen = 1;
            } else {
                curLen += 1;
            }
            if (curLen > bestLen) {
                bestStart = curStart;
                bestLen = curLen;
            }
        } else {
            curStart = -1;
            curLen = 0;
        }
    }

    if (bestLen < 2) {
        return hextets.map((value) => value.toString(16)).join(':');
    }

    const head = hextets.slice(0, bestStart).map((value) => value.toString(16)).join(':');
    const tail = hextets.slice(bestStart + bestLen).map((value) => value.toString(16)).join(':');
    if (!head && !tail) return '::';
    return `${head}::${tail}`;
}

export function normalizeIpAddress(value: unknown): string {
    let text = String(value || '').trim();
    if (!text || text.toLowerCase() === 'unknown') return '';

    if (text.includes(',')) {
        text = text.split(',')[0].trim();
    }

    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1).trim();
    }

    if (text.startsWith('[')) {
        const bracketMatch = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
        if (!bracketMatch) return '';
        if (bracketMatch[2]) {
            const port = Number(bracketMatch[2]);
            if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
        }
        text = bracketMatch[1].trim();
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(text)) {
        text = text.replace(/:\d{1,5}$/, '');
    }

    if (text.includes('%')) {
        text = text.split('%')[0].trim();
    }

    const family = net.isIP(text);
    if (family === 4) return text;
    if (family === 6) {
        const hextets = parseIpv6Hextets(text);
        return hextets ? formatCanonicalIpv6(hextets) : '';
    }
    return '';
}

function isPrivateIpv4Octets(octets: [number, number, number, number], includeSpecialUse = false): boolean {
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (includeSpecialUse) {
        if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64.0.0/10
        if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18.0.0/15
        if (a >= 224) return true; // multicast & reserved 224.0.0.0/4 + 240.0.0.0/4
    }
    return false;
}

function isPrivateIpv6Hextets(hextets: number[], includeSpecialUse = false): boolean {
    if (hextets.length !== 8) return false;
    const h0 = hextets[0];
    const allZero = hextets.every((v) => v === 0);
    const isLoopback = hextets.slice(0, 7).every((v) => v === 0) && hextets[7] === 1;
    if (allZero || isLoopback) return true; // ::/128, ::1/128
    if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 Unique Local
    if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-Local
    if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 Multicast

    // IPv4-mapped (::ffff:0:0/96) or IPv4-compatible (::/96)
    if (
        hextets[0] === 0
        && hextets[1] === 0
        && hextets[2] === 0
        && hextets[3] === 0
        && hextets[4] === 0
        && (hextets[5] === 0xffff || hextets[5] === 0)
    ) {
        return isPrivateIpv4Octets([
            (hextets[6] >> 8) & 0xff,
            hextets[6] & 0xff,
            (hextets[7] >> 8) & 0xff,
            hextets[7] & 0xff,
        ], includeSpecialUse);
    }

    if (includeSpecialUse) {
        // 64:ff9b:1::/48 local-use NAT64
        if (hextets[0] === 0x0064 && hextets[1] === 0xff9b && hextets[2] === 0x0001) return true;
        // 2002::/16 6to4 carrying embedded private/special IPv4
        if (hextets[0] === 0x2002) {
            return isPrivateIpv4Octets([
                (hextets[1] >> 8) & 0xff,
                hextets[1] & 0xff,
                (hextets[2] >> 8) & 0xff,
                hextets[2] & 0xff,
            ], true);
        }
    }

    return false;
}

export function isPrivateOrLocalIp(value: unknown, options: { includeSpecialUse?: boolean } = {}): boolean {
    const ip = normalizeIpAddress(value);
    if (!ip) return false;
    const includeSpecialUse = options.includeSpecialUse === true;
    const family = net.isIP(ip);
    if (family === 4) {
        const octets = parseIpv4Octets(ip);
        return octets ? isPrivateIpv4Octets(octets, includeSpecialUse) : false;
    }
    if (family === 6) {
        const hextets = parseIpv6Hextets(ip);
        return hextets ? isPrivateIpv6Hextets(hextets, includeSpecialUse) : false;
    }
    return false;
}

export function isReservedOrPrivateIp(value: unknown): boolean {
    return isPrivateOrLocalIp(value, { includeSpecialUse: true });
}

function sanitizeLocation(value: unknown): string {
    let text = String(value || '').trim();
    if (!text) return '';
    text = text.replace(/\s+/g, ' ').replace(/^[,，]+|[,，]+$/g, '').trim();
    if (!text) return '';
    if (text.toLowerCase() === 'unknown') return '';
    if (text.length > 120) text = text.slice(0, 120);
    return text;
}

export function parseIpipMyIpResponse(value: unknown): string {
    const text = String(value || '');
    if (!text.trim()) return '';
    const fromMatch = text.match(/来自于[:：]\s*([^\n\r]+)/u);
    if (fromMatch?.[1]) return sanitizeLocation(fromMatch[1]);
    const fallbackMatch = text.match(/\bfrom[:：]\s*([^\n\r]+)/iu);
    if (fallbackMatch?.[1]) return sanitizeLocation(fallbackMatch[1]);
    return '';
}

export function parseIpApiResponse(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const data = typeof value === 'object' && value !== null ? value : JSON.parse(text);
        if (!data || typeof data !== 'object') return '';
        if (data.status && data.status !== 'success' && data.status !== 'ok') return '';
        if (data.success === false) return '';

        const root = (typeof data.data === 'object' && data.data !== null)
            ? data.data
            : ((typeof data.result === 'object' && data.result !== null) ? data.result : data);

        const country = String(root.country || root.country_name || root.countryName || root.nation || '').trim();
        const region = String(root.regionName || root.region || root.province || root.prov || root.state || '').trim();
        const city = String(root.city || root.cityName || '').trim();
        const district = String(root.district || root.dist || '').trim();

        const rawParts = [country, region, city, district].filter(Boolean);
        const parts: string[] = [];
        for (const p of rawParts) {
            if (!parts.includes(p)) {
                parts.push(p);
            }
        }

        if (parts.length > 0) {
            return sanitizeLocation(parts.join(' '));
        }

        const fallbackLocation = String(root.location || root.addr || root.address || root.text || root.isp_location || '').trim();
        if (fallbackLocation) {
            return sanitizeLocation(fallbackLocation);
        }

        return '';
    } catch {
        return '';
    }
}

function buildProviderUrl(provider: string, endpointTemplate: string, ip: string): string {
    const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();
    const template = String(endpointTemplate || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;

    if (template.includes('{ip}')) {
        return template.replaceAll('{ip}', encodeURIComponent(ip));
    }

    if (normalizedProvider === 'ipip_myip') {
        if (/[\?&]ip=/.test(template)) return template;
        return `${template}${template.includes('?') ? '&' : '?'}ip=${encodeURIComponent(ip)}`;
    }

    if (normalizedProvider === 'ip_api') {
        return `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city&lang=zh-CN`;
    }

    if (/[\?&]ip=/.test(template)) return template;
    return `${template}${template.includes('?') ? '&' : '?'}ip=${encodeURIComponent(ip)}`;
}

function parseProviderResult(provider: string, payload: unknown): string {
    const normalizedProvider = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();
    if (normalizedProvider === 'ipip_myip') {
        const myip = parseIpipMyIpResponse(payload);
        if (myip) return myip;
    }
    const json = parseIpApiResponse(payload);
    if (json) return json;
    return parseIpipMyIpResponse(payload);
}

function createDefaultFetcher() {
    return async ({ url, timeoutMs }: { url: string; timeoutMs: number; ip?: string; provider?: string }): Promise<string> => {
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

export interface IpGeoResolverOptions {
    enabled?: boolean;
    provider?: string;
    endpoint?: string;
    timeoutMs?: number;
    cacheTtlSeconds?: number;
    fetcher?: (params: { ip: string; url: string; provider: string; timeoutMs: number }) => Promise<string>;
}

export function createIpGeoResolver(options: IpGeoResolverOptions = {}) {
    const runtime = {
        enabled: toBoolean(options.enabled, false),
        provider: String(options.provider || DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER,
        endpoint: String(options.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
        timeoutMs: toPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS),
        cacheTtlSeconds: toPositiveInt(options.cacheTtlSeconds, DEFAULT_CACHE_TTL_SECONDS),
    };
    const fetcher = typeof options.fetcher === 'function' ? options.fetcher : createDefaultFetcher();

    const cache = new Map<string, { location: string; expiresAt: number }>();
    const inflight = new Map<string, Promise<string>>();

    function fromCache(ip: string, nowTs: number = Date.now()): string | undefined {
        const item = cache.get(ip);
        if (!item) return undefined;
        if (item.expiresAt <= nowTs) {
            cache.delete(ip);
            return undefined;
        }
        return item.location;
    }

    function toCache(ip: string, location: unknown, ttlMs: number = runtime.cacheTtlSeconds * 1000): void {
        cache.set(ip, {
            location: String(location || ''),
            expiresAt: Date.now() + Math.max(1000, ttlMs),
        });
    }

    function configure(next: Partial<IpGeoResolverOptions> = {}): void {
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

    async function lookup(ipInput: unknown): Promise<string> {
        const ip = normalizeIpAddress(ipInput);
        if (!ip) return '';
        if (isPrivateOrLocalIp(ip)) return LOCAL_IP_LABEL;
        if (!runtime.enabled) return '';

        const cached = fromCache(ip);
        if (cached !== undefined) return cached;

        if (inflight.has(ip)) {
            return inflight.get(ip)!;
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

    async function lookupMany(values: unknown[] = []): Promise<Map<string, string>> {
        const unique = Array.from(
            new Set(
                (Array.isArray(values) ? values : [])
                    .map((item) => normalizeIpAddress(item))
                    .filter(Boolean)
            )
        );
        const entries = await Promise.all(unique.map(async (ip) => [ip, await lookup(ip)] as [string, string]));
        return new Map(entries);
    }

    function pickFromMap(map: unknown, rawIp: unknown): string {
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
