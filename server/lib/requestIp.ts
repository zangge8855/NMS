import type { Request } from 'express';
import net from 'net';
import config from '../config.js';
import { isPrivateOrLocalIp, normalizeIpAddress } from './ipGeoResolver.js';

const CLOUDFLARE_EDGE_BLOCKLIST = (() => {
    const blockList = new net.BlockList();
    const ipv4Cidrs: Array<[string, number]> = [
        ['173.245.48.0', 20],
        ['103.21.244.0', 22],
        ['103.22.200.0', 22],
        ['103.31.4.0', 22],
        ['141.101.64.0', 18],
        ['108.162.192.0', 18],
        ['190.93.240.0', 20],
        ['188.114.96.0', 20],
        ['197.234.240.0', 22],
        ['198.41.128.0', 17],
        ['162.158.0.0', 15],
        ['104.16.0.0', 13],
        ['104.24.0.0', 14],
        ['172.64.0.0', 13],
        ['131.0.72.0', 22],
    ];
    const ipv6Cidrs: Array<[string, number]> = [
        ['2400:cb00::', 32],
        ['2606:4700::', 32],
        ['2803:f800::', 32],
        ['2405:b500::', 32],
        ['2405:8100::', 32],
        ['2a06:98c0::', 29],
        ['2c0f:f248::', 32],
    ];
    for (const [prefix, mask] of ipv4Cidrs) {
        blockList.addSubnet(prefix, mask, 'ipv4');
    }
    for (const [prefix, mask] of ipv6Cidrs) {
        blockList.addSubnet(prefix, mask, 'ipv6');
    }
    return blockList;
})();

function isCloudflareEdgeIp(value: unknown): boolean {
    const normalized = normalizeIpAddress(String(value || ''));
    if (!normalized) return false;
    const family = net.isIP(normalized);
    if (family === 4) {
        return CLOUDFLARE_EDGE_BLOCKLIST.check(normalized, 'ipv4');
    }
    if (family === 6) {
        return CLOUDFLARE_EDGE_BLOCKLIST.check(normalized, 'ipv6');
    }
    return false;
}

function isTrustCloudflareEnabled(): boolean {
    return process.env.TRUST_CLOUDFLARE_HEADERS === 'true'
        || (config.security as any)?.trustCloudflareHeaders === true;
}

function firstHeaderValue(raw: unknown): string {
    if (Array.isArray(raw)) return String(raw[0] || '').trim();
    return String(raw || '').trim();
}

function normalizeForwardedToken(token: unknown): string {
    let text = String(token || '').trim();
    if (!text || text.toLowerCase() === 'unknown' || text === '_') return '';

    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1).trim();
    }

    if (text.startsWith('[')) {
        const end = text.indexOf(']');
        if (end > 0) {
            text = text.slice(1, end);
        }
    }

    return normalizeIpAddress(text);
}

function parseXForwardedFor(raw: unknown): string[] {
    const text = firstHeaderValue(raw);
    if (!text) return [];
    return text
        .split(',')
        .map((item) => normalizeForwardedToken(item))
        .filter(Boolean);
}

function parseForwardedHeader(raw: unknown): string[] {
    const text = firstHeaderValue(raw);
    if (!text) return [];

    const out: string[] = [];
    const segments = text.split(',');
    for (const segment of segments) {
        const match = segment.match(/for=([^;]+)/i);
        if (!match?.[1]) continue;
        const parsed = normalizeForwardedToken(match[1]);
        if (parsed) out.push(parsed);
    }
    return out;
}

function parseSingleIpHeader(raw: unknown): string {
    const value = firstHeaderValue(raw);
    if (!value) return '';
    return normalizeForwardedToken(value);
}

function collectForwardedIps(req: any, includeCloudflare: boolean = false): string[] {
    const expressIps = Array.isArray(req?.ips)
        ? req.ips
            .map((ip: any) => normalizeForwardedToken(ip))
            .filter(Boolean)
        : [];
    const candidates = [
        ...expressIps,
        ...parseXForwardedFor(req?.headers?.['x-forwarded-for']),
        parseSingleIpHeader(req?.headers?.['x-real-ip']),
        ...(includeCloudflare
            ? [
                parseSingleIpHeader(req?.headers?.['cf-connecting-ip']),
                parseSingleIpHeader(req?.headers?.['true-client-ip']),
            ]
            : []),
        parseSingleIpHeader(req?.headers?.['x-client-ip']),
        ...parseForwardedHeader(req?.headers?.forwarded),
    ].filter(Boolean);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const ip of candidates) {
        if (seen.has(ip)) continue;
        seen.add(ip);
        deduped.push(ip);
    }
    return deduped;
}

function resolveCloudflareClientIp(req: any): { clientIp: string; source: string } | null {
    const cfConnectingIp = parseSingleIpHeader(req?.headers?.['cf-connecting-ip']);
    const trueClientIp = parseSingleIpHeader(req?.headers?.['true-client-ip']);
    const cfConnectingIpv6 = parseSingleIpHeader(req?.headers?.['cf-connecting-ipv6']);

    if (cfConnectingIpv6 && cfConnectingIp && net.isIP(cfConnectingIp) === 4 && net.isIP(cfConnectingIpv6) === 6) {
        return {
            clientIp: cfConnectingIpv6,
            source: 'cf-connecting-ipv6',
        };
    }
    if (cfConnectingIp) {
        return {
            clientIp: cfConnectingIp,
            source: 'cf-connecting-ip',
        };
    }
    if (trueClientIp) {
        return {
            clientIp: trueClientIp,
            source: 'true-client-ip',
        };
    }
    if (cfConnectingIpv6) {
        return {
            clientIp: cfConnectingIpv6,
            source: 'cf-connecting-ipv6',
        };
    }
    return null;
}

function resolveForwardedClientIp(req: any): { clientIp: string; source: string } | null {
    const ipFromReq = normalizeIpAddress(req?.ip || '');
    const ipFromSocket = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const expressIps = Array.isArray(req?.ips)
        ? req.ips
            .map((ip: any) => normalizeForwardedToken(ip))
            .filter(Boolean)
        : [];
    if (expressIps.length > 0) {
        const publicIp = [...expressIps].reverse().find((ip: string) => !isPrivateOrLocalIp(ip));
        return {
            clientIp: publicIp || expressIps[0],
            source: 'req.ips',
        };
    }

    if (ipFromReq && ipFromSocket && ipFromReq !== ipFromSocket && !isPrivateOrLocalIp(ipFromReq)) {
        return {
            clientIp: ipFromReq,
            source: 'req.ip',
        };
    }

    const xForwardedFor = parseXForwardedFor(req?.headers?.['x-forwarded-for']);
    if (xForwardedFor.length > 0) {
        const publicIp = [...xForwardedFor].reverse().find((ip) => !isPrivateOrLocalIp(ip));
        return {
            clientIp: publicIp || xForwardedFor[0],
            source: 'x-forwarded-for',
        };
    }

    const forwardedHeader = parseForwardedHeader(req?.headers?.forwarded);
    if (forwardedHeader.length > 0) {
        const publicIp = [...forwardedHeader].reverse().find((ip) => !isPrivateOrLocalIp(ip));
        return {
            clientIp: publicIp || forwardedHeader[0],
            source: 'forwarded',
        };
    }

    const xRealIp = parseSingleIpHeader(req?.headers?.['x-real-ip']);
    if (xRealIp) {
        return {
            clientIp: xRealIp,
            source: 'x-real-ip',
        };
    }

    const xClientIp = parseSingleIpHeader(req?.headers?.['x-client-ip']);
    if (xClientIp) {
        return {
            clientIp: xClientIp,
            source: 'x-client-ip',
        };
    }

    return null;
}

export interface ClientIpDetails {
    clientIp: string;
    proxyIp: string;
    ipSource: string;
    forwardedChain: string[];
    cfCountry: string;
}

export function canTrustForwardedHeaders(req: any): boolean {
    const ipFromReq = normalizeIpAddress(req?.ip || '');
    const ipFromSocket = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const upstreamIp = ipFromSocket || ipFromReq;
    const trustProxy = config.security?.trustProxy;
    const hasExpressProxyChain = Array.isArray(req?.ips) && req.ips.length > 0;
    return trustProxy === true || (
        trustProxy !== false && (
            hasExpressProxyChain || isPrivateOrLocalIp(upstreamIp) || isCloudflareEdgeIp(upstreamIp)
        )
    );
}

export function canTrustCloudflareHeaders(req: any): boolean {
    if (config.security?.trustProxy === false) {
        return false;
    }
    const ipFromReq = normalizeIpAddress(req?.ip || '');
    const ipFromSocket = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const upstreamIp = ipFromSocket || ipFromReq;
    if (isCloudflareEdgeIp(upstreamIp)) {
        return true;
    }
    if (isTrustCloudflareEnabled()) {
        return canTrustForwardedHeaders(req);
    }
    return false;
}

export function resolveClientIpDetails(req: any): ClientIpDetails {
    const ipFromReq = normalizeIpAddress(req?.ip || '');
    const ipFromSocket = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const upstreamIp = ipFromReq || ipFromSocket;
    const proxyIp = upstreamIp || '';
    const canTrustForwarded = canTrustForwardedHeaders(req);
    const canTrustCloudflare = canTrustCloudflareHeaders(req);
    const forwardedIps = canTrustForwarded ? collectForwardedIps(req, canTrustCloudflare) : [];
    const cfCountry = canTrustCloudflare
        ? String(req?.headers?.['cf-ipcountry'] || '').trim().toUpperCase()
        : '';

    if (canTrustCloudflare) {
        const cloudflareResolved = resolveCloudflareClientIp(req);
        if (cloudflareResolved?.clientIp) {
            return {
                clientIp: cloudflareResolved.clientIp,
                proxyIp,
                ipSource: cloudflareResolved.source,
                forwardedChain: forwardedIps,
                cfCountry,
            };
        }
    }

    if (canTrustForwarded) {
        const forwardedResolved = resolveForwardedClientIp(req);
        if (forwardedResolved?.clientIp) {
            return {
                clientIp: forwardedResolved.clientIp,
                proxyIp,
                ipSource: forwardedResolved.source,
                forwardedChain: forwardedIps,
                cfCountry,
            };
        }
    }

    return {
        clientIp: upstreamIp || 'unknown',
        proxyIp,
        ipSource: upstreamIp ? 'req.ip' : 'unknown',
        forwardedChain: forwardedIps,
        cfCountry,
    };
}

export function resolveClientIp(req: any): string {
    return resolveClientIpDetails(req).clientIp;
}
