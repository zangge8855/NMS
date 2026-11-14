import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isReservedOrPrivateIp, stripIpv6Brackets } from './ipGeoResolver.js';

export interface ResolvedExternalAddress {
    address: string;
    family: number;
}

export interface ResolvedExternalTarget {
    url: URL;
    hostname: string;
    addresses: ResolvedExternalAddress[];
}

export interface ExternalHttpValidationOptions {
    label?: string;
    lookup?: (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
}

export interface ExternalPinnedRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxResponseBytes?: number;
}

export interface ExternalHttpResponse {
    ok: boolean;
    status: number;
    statusText: string;
    type: 'basic' | 'opaqueredirect';
    headers: Record<string, string>;
    text: () => Promise<string>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export function isBlockedInternalHostname(hostname: string): boolean {
    const host = stripIpv6Brackets(hostname).toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local') || host.endsWith('.localdomain')) return true;
    if (host.endsWith('.internal') || host.endsWith('.arpa')) return true;
    if (host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')) return true;
    if (net.isIP(host) !== 0) return false;
    if (!host.includes('.')) return true;
    return false;
}

export function assertSafeExternalUrlSyntax(rawUrl: unknown, label: string = 'Target URL'): URL {
    const text = String(rawUrl || '').trim();
    if (!text) {
        throw new Error(`${label} is required`);
    }

    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        throw new Error(`${label} is invalid`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${label} must use http or https protocol`);
    }

    if (parsed.username || parsed.password) {
        throw new Error(`${label} must not include embedded credentials`);
    }

    const hostname = stripIpv6Brackets(parsed.hostname);
    if (isBlockedInternalHostname(hostname)) {
        throw new Error(`${label} cannot target localhost or internal hostnames`);
    }

    if (isReservedOrPrivateIp(hostname)) {
        throw new Error(`${label} cannot target private or local IP addresses`);
    }

    return parsed;
}

export async function resolveExternalHttpTarget(
    rawUrl: unknown,
    options: ExternalHttpValidationOptions = {}
): Promise<ResolvedExternalTarget> {
    const label = String(options.label || 'Target URL').trim() || 'Target URL';
    const parsed = assertSafeExternalUrlSyntax(rawUrl, label);
    const hostname = stripIpv6Brackets(parsed.hostname);
    const literalFamily = net.isIP(hostname);
    if (literalFamily !== 0) {
        return {
            url: parsed,
            hostname,
            addresses: [{ address: hostname, family: literalFamily }],
        };
    }

    const lookup = options.lookup || ((target: string) => dns.lookup(target, { all: true, verbatim: true }));
    let records: Array<{ address: string; family?: number }>;
    try {
        records = await lookup(hostname);
    } catch {
        throw new Error(`${label} hostname resolution failed`);
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw new Error(`${label} hostname did not resolve to any address`);
    }

    const normalizedAddresses: ResolvedExternalAddress[] = [];
    for (const record of records) {
        const address = stripIpv6Brackets(String(record?.address || '').trim());
        const family = Number(record?.family) || net.isIP(address);
        if (!address || family === 0 || isReservedOrPrivateIp(address)) {
            throw new Error(`${label} hostname resolved to a private or internal IP address`);
        }
        normalizedAddresses.push({ address, family });
    }

    return {
        url: parsed,
        hostname,
        addresses: normalizedAddresses,
    };
}

export async function requestExternalWithPinnedIp(
    target: ResolvedExternalTarget,
    options: ExternalPinnedRequestOptions = {}
): Promise<ExternalHttpResponse> {
    const isHttps = target.url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const pinned = target.addresses[0];
    if (!pinned?.address) {
        throw new Error('No resolved IP address available for external request');
    }

    const maxBytes = Number.isFinite(Number(options.maxResponseBytes)) && Number(options.maxResponseBytes) > 0
        ? Math.floor(Number(options.maxResponseBytes))
        : DEFAULT_MAX_RESPONSE_BYTES;
    const method = String(options.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { ...(options.headers || {}) };
    const bodyText = options.body !== undefined ? String(options.body) : '';
    if (bodyText && headers['Content-Length'] === undefined && headers['content-length'] === undefined) {
        headers['Content-Length'] = String(Buffer.byteLength(bodyText));
    }

    const pinnedLookup = (_hostname: string, opts: any, callback: any) => {
        if (typeof opts === 'function') {
            opts(null, pinned.address, pinned.family);
            return;
        }
        if (opts && opts.all) {
            callback(null, target.addresses.map((item) => ({ address: item.address, family: item.family })));
            return;
        }
        callback(null, pinned.address, pinned.family);
    };

    return await new Promise<ExternalHttpResponse>((resolve, reject) => {
        const requestOptions: https.RequestOptions = {
            method,
            headers,
            lookup: pinnedLookup as any,
            signal: options.signal,
            timeout: options.timeoutMs,
        };
        if (isHttps && net.isIP(target.hostname) === 0) {
            requestOptions.servername = target.hostname;
        }

        const req = transport.request(target.url, requestOptions, (res) => {
            const status = Number(res.statusCode || 0);
            const statusText = String(res.statusMessage || '');
            const normalizedHeaders: Record<string, string> = {};
            for (const [headerName, headerVal] of Object.entries(res.headers || {})) {
                if (headerVal === undefined) continue;
                normalizedHeaders[headerName.toLowerCase()] = Array.isArray(headerVal)
                    ? headerVal.join(', ')
                    : String(headerVal);
            }
            if (status >= 300 && status < 400) {
                res.resume();
                resolve({
                    ok: false,
                    status,
                    statusText,
                    type: 'opaqueredirect',
                    headers: normalizedHeaders,
                    text: async () => '',
                });
                return;
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;
            res.on('data', (chunk: Buffer | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += buf.length;
                if (totalBytes > maxBytes) {
                    req.destroy(new Error(`Response exceeded max size of ${maxBytes} bytes`));
                    return;
                }
                chunks.push(buf);
            });
            res.on('end', () => {
                const payload = Buffer.concat(chunks).toString('utf8');
                resolve({
                    ok: status >= 200 && status < 300,
                    status,
                    statusText,
                    type: 'basic',
                    headers: normalizedHeaders,
                    text: async () => payload,
                });
            });
            res.on('error', reject);
        });

        req.on('timeout', () => {
            const timeoutErr: any = new Error('Request timed out');
            timeoutErr.name = 'AbortError';
            req.destroy(timeoutErr);
        });
        req.on('error', reject);

        if (bodyText) {
            req.write(bodyText);
        }
        req.end();
    });
}
