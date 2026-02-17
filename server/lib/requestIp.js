import { isPrivateOrLocalIp, normalizeIpAddress } from './ipGeoResolver.js';

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

export function resolveClientIp(req) {
    const ipFromReq = normalizeIpAddress(req?.ip || '');
    const ipFromSocket = normalizeIpAddress(req?.socket?.remoteAddress || '');
    const upstreamIp = ipFromReq || ipFromSocket;
    if (upstreamIp && !isPrivateOrLocalIp(upstreamIp)) {
        return upstreamIp;
    }

    // Trust forwarded headers when upstream is local/private,
    // or express has already parsed proxy chain into req.ips.
    const canTrustForwarded = isPrivateOrLocalIp(upstreamIp) || (Array.isArray(req?.ips) && req.ips.length > 0);
    if (canTrustForwarded) {
        const forwardedIps = collectForwardedIps(req);
        if (forwardedIps.length > 0) {
            const publicIp = forwardedIps.find((ip) => !isPrivateOrLocalIp(ip));
            if (publicIp) return publicIp;
            return forwardedIps[0];
        }
    }

    return upstreamIp || 'unknown';
}
