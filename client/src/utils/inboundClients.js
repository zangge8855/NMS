import { getClientIdentifier } from './protocol.js';

export function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveClientKeys(client = {}, protocol = '') {
    const keys = new Set();
    const identifier = String(getClientIdentifier(client, protocol) || '').trim();
    const email = String(client.email || '').trim().toLowerCase();
    const id = String(client.id || '').trim();
    const password = String(client.password || '').trim();

    if (identifier) keys.add(`identifier:${identifier}`);
    if (email) keys.add(`email:${email}`);
    if (id) keys.add(`id:${id}`);
    if (password) keys.add(`password:${password}`);

    return Array.from(keys);
}

export function mergeInboundClientStats(inbound) {
    let baseClients = [];
    try {
        const settings = JSON.parse(inbound?.settings || '{}');
        baseClients = Array.isArray(settings.clients) ? settings.clients : [];
    } catch {
        baseClients = [];
    }

    const statsCandidates = [
        inbound?.clientStats,
        inbound?.clientTraffic,
        inbound?.clientTraffics,
        inbound?.clientTrafficsList,
    ];
    const statsRows = statsCandidates.find((item) => Array.isArray(item)) || [];
    const statsMap = new Map();

    statsRows.forEach((row) => {
        resolveClientKeys(row, inbound?.protocol).forEach((key) => {
            if (!statsMap.has(key)) {
                statsMap.set(key, row);
            }
        });
    });

    return baseClients.map((client) => {
        const stats = resolveClientKeys(client, inbound?.protocol)
            .map((key) => statsMap.get(key))
            .find(Boolean);

        return {
            ...(stats || {}),
            ...client,
        };
    });
}

export function resolveClientQuota(client) {
    return safeNumber(client?.totalGB || client?.total || client?.totalBytes || 0);
}

export function resolveClientUsed(client) {
    return safeNumber(client?.up) + safeNumber(client?.down);
}

export function resolveUsagePercent(usedBytes, totalBytes) {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 100)));
}

export function resolveUsageTone(percent) {
    if (percent === null) return 'neutral';
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warning';
    return 'success';
}
