import { getClientIdentifier } from './protocol';

export function safeNumber(value: any): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseJsonObjectLike<T = Record<string, any>>(value: any, fallback: T = {} as T): T {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as T;
    }
    const text = String(value || '').trim();
    if (!text) return fallback;
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return fallback;
        }
        return parsed as T;
    } catch {
        return fallback;
    }
}

export function extractInboundClients(inbound?: any): any[] {
    const settings = parseJsonObjectLike<{ clients?: any[] }>(inbound?.settings, {});
    return Array.isArray(settings.clients) ? settings.clients : [];
}

function resolveClientKeys(client: Record<string, any> = {}, protocol: string = ''): string[] {
    const keys = new Set<string>();
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

export function mergeInboundClientStats(inbound?: any): any[] {
    const baseClients = extractInboundClients(inbound);

    const statsCandidates = [
        inbound?.clientStats,
        inbound?.clientTraffic,
        inbound?.clientTraffics,
        inbound?.clientTrafficsList,
    ];
    const statsRows = statsCandidates.find((item) => Array.isArray(item)) || [];
    const statsMap = new Map<string, any>();

    statsRows.forEach((row: any) => {
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

        if (!stats) return client;

        return {
            ...client,
            up: stats.up ?? client.up,
            down: stats.down ?? client.down,
            reset: stats.reset ?? client.reset,
        };
    });
}

export function resolveClientQuota(client?: any): number {
    return safeNumber(client?.totalGB || client?.total || client?.totalBytes || 0);
}

export function resolveClientUsed(client?: any): number {
    return safeNumber(client?.up) + safeNumber(client?.down);
}

export function resolveUsagePercent(usedBytes: number, totalBytes: number): number | null {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 100)));
}

export type UsageTone = 'neutral' | 'danger' | 'warning' | 'success';

export function resolveUsageTone(percent: number | null): UsageTone {
    if (percent === null) return 'neutral';
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warning';
    return 'success';
}
