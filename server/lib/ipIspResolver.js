import net from 'node:net';
import config from '../config.js';
import { isPrivateOrLocalIp, normalizeIpAddress } from './ipGeoResolver.js';

const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const FAILURE_CACHE_TTL_SECONDS = 30 * 60;
const DEFAULT_SOURCES = [
    {
        label: '中国电信',
        urls: [
            'https://ispip.clang.cn/chinatelecom.txt',
            'https://ispip.clang.cn/chinatelecom_ipv6.txt',
        ],
    },
    {
        label: '中国联通',
        urls: [
            'https://ispip.clang.cn/unicom_cnc.txt',
            'https://ispip.clang.cn/unicom_cnc_ipv6.txt',
        ],
    },
    {
        label: '中国移动',
        urls: [
            'https://ispip.clang.cn/cmcc.txt',
            'https://ispip.clang.cn/cmcc_ipv6.txt',
        ],
    },
    {
        label: '中国广电',
        urls: [
            'https://ispip.clang.cn/chinabtn.txt',
            'https://ispip.clang.cn/chinabtn_ipv6.txt',
        ],
    },
    {
        label: '中国教育网',
        urls: [
            'https://ispip.clang.cn/cernet.txt',
            'https://ispip.clang.cn/cernet_ipv6.txt',
        ],
    },
    {
        label: '长城宽带',
        urls: [
            'https://ispip.clang.cn/gwbn.txt',
            'https://ispip.clang.cn/gwbn_ipv6.txt',
        ],
    },
];

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

function ipv4ToBigInt(ip) {
    const parts = String(ip || '').split('.');
    if (parts.length !== 4) return null;
    let result = 0n;
    for (const part of parts) {
        const value = Number(part);
        if (!Number.isInteger(value) || value < 0 || value > 255) return null;
        result = (result << 8n) + BigInt(value);
    }
    return result;
}

function ipv6ToBigInt(ip) {
    let text = String(ip || '').trim().toLowerCase();
    if (!text) return null;

    if (text.includes('.')) {
        const lastColon = text.lastIndexOf(':');
        if (lastColon < 0) return null;
        const ipv4Part = text.slice(lastColon + 1);
        const ipv4Big = ipv4ToBigInt(ipv4Part);
        if (ipv4Big === null) return null;
        const high = Number((ipv4Big >> 16n) & 0xffffn).toString(16);
        const low = Number(ipv4Big & 0xffffn).toString(16);
        text = `${text.slice(0, lastColon)}:${high}:${low}`;
    }

    const hasCompression = text.includes('::');
    const [headRaw, tailRaw = ''] = text.split('::');
    const head = headRaw ? headRaw.split(':').filter(Boolean) : [];
    const tail = tailRaw ? tailRaw.split(':').filter(Boolean) : [];
    const missing = hasCompression ? (8 - head.length - tail.length) : 0;
    if (missing < 0) return null;

    const parts = hasCompression
        ? [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
        : head;

    if (parts.length !== 8) return null;

    let result = 0n;
    for (const part of parts) {
        const value = Number.parseInt(part || '0', 16);
        if (!Number.isFinite(value) || value < 0 || value > 0xffff) return null;
        result = (result << 16n) + BigInt(value);
    }
    return result;
}

function ipToBigInt(ip) {
    const normalized = normalizeIpAddress(ip);
    const family = net.isIP(normalized);
    if (family === 4) return { family, value: ipv4ToBigInt(normalized) };
    if (family === 6) return { family, value: ipv6ToBigInt(normalized) };
    return { family: 0, value: null };
}

function parseCidrLine(line, label) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#') || text.startsWith('//')) return null;
    const match = text.match(/([0-9A-Fa-f:.]+\/\d{1,3})/);
    if (!match) return null;

    const [ipPart, prefixPart] = match[1].split('/');
    const prefix = Number(prefixPart);
    const normalizedIp = normalizeIpAddress(ipPart);
    const family = net.isIP(normalizedIp);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!family || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;

    const { value } = ipToBigInt(normalizedIp);
    if (value === null) return null;

    return {
        family,
        base: value,
        prefix,
        label,
    };
}

function cidrContains(ipValue, family, record) {
    if (record.family !== family) return false;
    const maxBits = family === 4 ? 32 : 128;
    const hostBits = BigInt(maxBits - record.prefix);
    if (hostBits === 0n) {
        return ipValue === record.base;
    }
    return (ipValue >> hostBits) === (record.base >> hostBits);
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
                    'User-Agent': 'NMS-Audit-ISP/1.0',
                    'Accept': 'text/plain,*/*;q=0.8',
                },
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`isp-provider-status-${response.status}`);
            }
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    };
}

export function createIpIspResolver(options = {}) {
    const runtime = {
        enabled: toBoolean(options.enabled, false),
        timeoutMs: toPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS),
        cacheTtlSeconds: toPositiveInt(options.cacheTtlSeconds, DEFAULT_CACHE_TTL_SECONDS),
        sources: Array.isArray(options.sources) && options.sources.length > 0 ? options.sources : DEFAULT_SOURCES,
    };
    const fetcher = typeof options.fetcher === 'function' ? options.fetcher : createDefaultFetcher();
    const dataset = {
        records: [],
        expiresAt: 0,
        loadedAt: 0,
        sourceCount: 0,
    };
    const ipCache = new Map();
    let inflight = null;

    async function loadRecords(force = false) {
        const now = Date.now();
        if (!force && dataset.records.length > 0 && dataset.expiresAt > now) {
            return dataset.records;
        }
        if (!force && inflight) return inflight;

        inflight = (async () => {
            const records = [];
            let loadedSources = 0;
            try {
                const tasks = runtime.sources.flatMap((source) => {
                    const urls = Array.isArray(source?.urls) ? source.urls : [];
                    return urls.map(async (url) => {
                        const payload = await fetcher({ url, timeoutMs: runtime.timeoutMs });
                        loadedSources += 1;
                        String(payload || '')
                            .split(/\r?\n/)
                            .forEach((line) => {
                                const record = parseCidrLine(line, source.label);
                                if (record) records.push(record);
                            });
                    });
                });
                await Promise.allSettled(tasks);

                dataset.records = records;
                dataset.loadedAt = now;
                dataset.sourceCount = loadedSources;
                dataset.expiresAt = now + ((loadedSources > 0 ? runtime.cacheTtlSeconds : FAILURE_CACHE_TTL_SECONDS) * 1000);
                ipCache.clear();
                return dataset.records;
            } catch (error) {
                if (dataset.records.length === 0) {
                    dataset.loadedAt = now;
                    dataset.sourceCount = loadedSources;
                    dataset.expiresAt = now + (FAILURE_CACHE_TTL_SECONDS * 1000);
                }
                return dataset.records;
            } finally {
                inflight = null;
            }
        })();

        return inflight;
    }

    function resolveFromRecords(ip) {
        const normalized = normalizeIpAddress(ip);
        if (!normalized || isPrivateOrLocalIp(normalized)) return '';
        const cached = ipCache.get(normalized);
        if (cached !== undefined) return cached;

        const { family, value } = ipToBigInt(normalized);
        if (!family || value === null) {
            ipCache.set(normalized, '');
            return '';
        }

        const match = dataset.records.find((record) => cidrContains(value, family, record));
        const label = String(match?.label || '');
        ipCache.set(normalized, label);
        return label;
    }

    async function lookup(ip) {
        if (!runtime.enabled) return '';
        await loadRecords(false);
        return resolveFromRecords(ip);
    }

    async function lookupMany(values = []) {
        const list = Array.isArray(values) ? values : [];
        const map = new Map();
        if (!runtime.enabled) return map;
        await loadRecords(false);
        list.forEach((value) => {
            const normalized = normalizeIpAddress(value);
            if (!normalized || map.has(normalized)) return;
            map.set(normalized, resolveFromRecords(normalized));
        });
        return map;
    }

    function pickFromMap(map, ip) {
        const normalized = normalizeIpAddress(ip);
        if (!normalized) return '';
        return map instanceof Map ? (map.get(normalized) || '') : '';
    }

    function metadata() {
        return {
            enabled: runtime.enabled,
            loadedAt: dataset.loadedAt || 0,
            recordCount: dataset.records.length,
            sourceCount: dataset.sourceCount,
            provider: 'ispip_clang',
        };
    }

    return {
        isEnabled() {
            return runtime.enabled;
        },
        configure(next = {}) {
            if (Object.prototype.hasOwnProperty.call(next, 'enabled')) {
                runtime.enabled = toBoolean(next.enabled, runtime.enabled);
            }
            if (Object.prototype.hasOwnProperty.call(next, 'timeoutMs')) {
                runtime.timeoutMs = toPositiveInt(next.timeoutMs, runtime.timeoutMs);
            }
            if (Object.prototype.hasOwnProperty.call(next, 'cacheTtlSeconds')) {
                runtime.cacheTtlSeconds = toPositiveInt(next.cacheTtlSeconds, runtime.cacheTtlSeconds);
            }
        },
        lookup,
        lookupMany,
        pickFromMap,
        metadata,
        _loadRecords: loadRecords,
    };
}

const ipIspResolver = createIpIspResolver(config.audit?.ipIsp || {});
export default ipIspResolver;
