import { isPrivateOrLocalIp, normalizeIpAddress } from './ipGeoResolver.js';
import net from 'net';

function firstHeaderValue(raw) {
    if (Array.isArray(raw)) return String(raw[0] || '').trim();
    return String(raw || '').trim();
}

function normalizeForwardedToken(token) {
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

function parseXForwardedFor(raw) {
    const text = firstHeaderValue(raw);
    if (!text) return [];
    return text
        .split(',')
        .map((item) => normalizeForwardedToken(item))
        .filter(Boolean);
}

function parseForwardedHeader(raw) {
    const text = firstHeaderValue(raw);
    if (!text) return [];

    const out = [];
    const segments = text.split(',');
    for (const segment of segments) {
        const match = segment.match(/for=([^;]+)/i);
        if (!match?.[1]) continue;
        const parsed = normalizeForwardedToken(match[1]);
        if (parsed) out.push(parsed);
    }
    return out;
}

function parseSingleIpHeader(raw) {
    const value = firstHeaderValue(raw);
    if (!value) return '';
    return normalizeForwardedToken(value);
}

function collectForwardedIps(req) {
    const expressIps = Array.isArray(req?.ips)
        ? req.ips
            .map((ip) => normalizeForwardedToken(ip))
            .filter(Boolean)
        : [];
    const candidates = [
        ...expressIps,
        ...parseXForwardedFor(req?.headers?.['x-forwarded-for']),
        parseSingleIpHeader(req?.headers?.['x-real-ip']),
        parseSingleIpHeader(req?.headers?.['cf-connecting-ip']),
        parseSingleIpHeader(req?.headers?.['true-client-ip']),
        parseSingleIpHeader(req?.headers?.['x-client-ip']),
        ...parseForwardedHeader(req?.headers?.forwarded),
    ].filter(Boolean);

    const deduped = [];
    const seen = new Set();
    for (const ip of candidates) {
        if (seen.has(ip)) continue;
        seen.add(ip);
        deduped.push(ip);
    }
    return deduped;
}

function resolveCloudflareClientIp(req) {
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

function resolveForwardedClientIp(req) {
    const expressIps = Array.isArray(req?.ips)
        ? req.ips
            .map((ip) => normalizeForwardedToken(ip))
            .filter(Boolean)
        : [];
    if (expressIps.length > 0) {
        const publicIp = expressIps.find((ip) => !isPrivateOrLocalIp(ip));
        return {
            clientIp: publicIp || expressIps[0],
            source: 'req.ips',
        };
    }

    const xForwardedFor = parseXForwardedFor(req?.headers?.['x-forwarded-for']);
    if (xForwardedFor.length > 0) {
        const publicIp = xForwardedFor.find((ip) => !isPrivateOrLocalIp(ip));
        return {
            clientIp: publicIp || xForwardedFor[0],
            source: 'x-forwarded-for',
        };
    }

    const forwardedHeader = parseForwardedHeader(req?.headers?.forwarded);
    if (forwardedHeader.length > 0) {
        const publicIp = forwardedHeader.find((ip) => !isPrivateOrLocalIp(ip));
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

export function resolveClientIpDetails(req) {
    const ipFromReq = normalizeIpAddress(req?.ip || '');
    const ipFromSocket = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const upstreamIp = ipFromReq || ipFromSocket;
    const forwardedIps = collectForwardedIps(req);
    const proxyIp = upstreamIp || '';
    const cfCountry = String(req?.headers?.['cf-ipcountry'] || '').trim().toUpperCase();

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

    // Trust forwarded headers when upstream is local/private,
    // or express has already parsed proxy chain into req.ips.
    const canTrustForwarded = isPrivateOrLocalIp(upstreamIp) || (Array.isArray(req?.ips) && req.ips.length > 0);
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

export function resolveClientIp(req) {
    return resolveClientIpDetails(req).clientIp;
}
