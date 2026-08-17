import serverStore from '../store/serverStore.js';
import config from '../config.js';
import { getAuthenticatedPanelClient } from '../services/panelGateway.js';
import { fetchPanelLastOnlineClients, fetchPanelOnlineClients } from './panelApiCompat.js';
import { normalizeOnlineEntries } from './panelOnlinePayload.js';

const DEFAULT_WARM_INTERVAL_MS = Math.max(5_000, Number(config.performance?.panelSnapshotIntervalMs || 10_000));
const DEFAULT_TTL_MS = DEFAULT_WARM_INTERVAL_MS;
const DEFAULT_CONCURRENCY = 5;

interface CacheRecord {
    value: any;
    valueIncludesOnlines: boolean;
    checkedAtMs: number;
    promise: Promise<any> | null;
    promiseIncludesOnlines: boolean;
}

const cache = new Map<string, CacheRecord>();
let warmTimer: NodeJS.Timeout | null = null;
let warmInFlight: Promise<any> | null = null;

function normalizeError(error: any, fallbackCode: string = 'PANEL_REQUEST_FAILED') {
    if (!error) return null;
    return {
        code: String(error.code || fallbackCode),
        message: String(error?.response?.data?.msg || error?.message || 'panel-request-failed'),
        status: Number(error?.response?.status || 0) || 0,
    };
}

function normalizeLastOnlineMap(payload: any = {}): Record<string, number> {
    const source = payload && typeof payload === 'object' ? payload : {};
    const entries = Array.isArray(source)
        ? source.map((item) => [item?.email || item?.user || item?.username || item?.clientEmail, item?.lastOnline || item?.lastSeen || item?.time || item?.ts])
        : Object.entries(source);
    const out: Record<string, number> = {};

    for (const [rawEmail, rawTs] of entries) {
        const email = String(rawEmail || '').trim().toLowerCase();
        const ts = Number(rawTs || 0);
        if (!email || !Number.isFinite(ts) || ts <= 0) continue;
        out[email] = ts;
    }

    return out;
}

function getRecord(serverId: string): CacheRecord {
    const key = String(serverId || '').trim();
    if (!cache.has(key)) {
        cache.set(key, {
            value: null,
            valueIncludesOnlines: false,
            checkedAtMs: 0,
            promise: null,
            promiseIncludesOnlines: false,
        });
    }
    return cache.get(key)!;
}

async function runWithConcurrency<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>, concurrency: number = DEFAULT_CONCURRENCY): Promise<R[]> {
    const results: R[] = [];
    let index = 0;
    const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
        while (index < items.length) {
            const current = index++;
            results[current] = await worker(items[current], current);
        }
    });
    await Promise.all(runners);
    return results;
}

async function fetchServerPanelSnapshot(server: any, options: any = {}): Promise<any> {
    const getPanelClient = options.getAuthenticatedPanelClient || getAuthenticatedPanelClient;
    const includeOnlines = options.includeOnlines !== false;
    const checkedAt = new Date().toISOString();
    let client: any = null;

    try {
        client = await getPanelClient(server.id);
    } catch (error) {
        const normalized = normalizeError(error, 'PANEL_REQUEST_FAILED');
        return {
            server: {
                id: server.id,
                name: server.name,
            },
            inbounds: null,
            onlines: [],
            lastOnline: {},
            inboundsError: normalized,
            onlinesError: includeOnlines ? normalized : null,
            checkedAt,
        };
    }

    const [inboundsResult, onlinesResult, lastOnlineResult, nodesResult] = await Promise.allSettled([
        client.get('/panel/api/inbounds/list'),
        includeOnlines
            ? fetchPanelOnlineClients(client)
            : Promise.resolve({ data: { obj: [] } }),
        includeOnlines
            ? fetchPanelLastOnlineClients(client)
            : Promise.resolve({ data: { obj: {} } }),
        client.get('/panel/api/nodes/list'),
    ]);

    let inbounds: any = null;
    let inboundsError: any = null;
    if (inboundsResult.status === 'rejected') {
        inboundsError = normalizeError(inboundsResult.reason, 'PANEL_INBOUND_LIST_FAILED');
    } else if (inboundsResult.value?.data?.success === false) {
        inboundsError = {
            code: 'PANEL_API_ERROR',
            message: String(inboundsResult.value?.data?.msg || 'api success false'),
        };
    } else if (Array.isArray(inboundsResult.value?.data?.obj)) {
        inbounds = inboundsResult.value.data.obj;
    } else {
        inboundsError = {
            code: 'PANEL_INVALID_RESPONSE',
            message: 'Inbounds payload obj is not an array',
        };
    }

    const nodes = nodesResult.status === 'fulfilled' && nodesResult.value?.data?.success !== false && Array.isArray(nodesResult.value?.data?.obj)
        ? nodesResult.value.data.obj
        : [];

    let onlines: any[] = [];
    let onlinesError: any = null;
    if (includeOnlines) {
        if (onlinesResult.status === 'rejected') {
            onlinesError = normalizeError(onlinesResult.reason, 'PANEL_ONLINES_FAILED');
        } else if (onlinesResult.value?.data?.success === false) {
            onlinesError = {
                code: 'PANEL_API_ERROR',
                message: String(onlinesResult.value?.data?.msg || 'api success false'),
            };
        } else {
            onlines = normalizeOnlineEntries(onlinesResult.value?.data?.obj, { nodes });
        }
    }

    const lastOnline = lastOnlineResult.status === 'fulfilled' && lastOnlineResult.value?.data?.success !== false
        ? normalizeLastOnlineMap(lastOnlineResult.value?.data?.obj)
        : {};

    return {
        server: {
            id: server.id,
            name: server.name,
        },
        inbounds,
        onlines,
        lastOnline,
        nodes,
        inboundsError,
        onlinesError,
        checkedAt,
    };
}

export async function getServerPanelSnapshot(server: any, options: any = {}): Promise<any> {
    const includeOnlines = options.includeOnlines !== false;
    const force = options.force === true;
    const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
    const record = getRecord(server?.id);
    const ageMs = Date.now() - Number(record.checkedAtMs || 0);
    const cachedSupportsRequest = !includeOnlines || record.valueIncludesOnlines === true;
    const pendingSupportsRequest = !includeOnlines || record.promiseIncludesOnlines === true;

    if (!force && record.value && cachedSupportsRequest && ageMs >= 0 && ageMs <= ttlMs) {
        return record.value;
    }

    if (!force && record.promise && pendingSupportsRequest) {
        return record.promise;
    }

    const request = fetchServerPanelSnapshot(server, options)
        .then((snapshot) => {
            record.value = snapshot;
            record.valueIncludesOnlines = includeOnlines;
            record.checkedAtMs = Date.now();
            return snapshot;
        })
        .finally(() => {
            if (record.promise === request) {
                record.promise = null;
                record.promiseIncludesOnlines = false;
            }
        });

    record.promise = request;
    record.promiseIncludesOnlines = includeOnlines;
    return request;
}

export async function getServerPanelSnapshots(options: any = {}): Promise<any[]> {
    const servers = Array.isArray(options.servers) ? options.servers : serverStore.getAll();
    if (servers.length === 0) return [];

    return runWithConcurrency(
        servers,
        (server) => getServerPanelSnapshot(server, options),
        Number(options.concurrency || DEFAULT_CONCURRENCY)
    );
}

export function getCachedServerPanelSnapshots(options: any = {}): any[] {
    const servers = Array.isArray(options.servers) ? options.servers : serverStore.getAll();
    const includeOnlines = options.includeOnlines !== false;

    return servers
        .map((server) => {
            const record = getRecord(server?.id);
            if (!record.value) return null;
            if (includeOnlines && record.valueIncludesOnlines !== true) return null;
            return record.value;
        })
        .filter(Boolean);
}

export function invalidateServerPanelSnapshotCache(serverId: string = ''): void {
    const normalizedServerId = String(serverId || '').trim();
    if (normalizedServerId) {
        cache.delete(normalizedServerId);
        return;
    }
    cache.clear();
}

export function startServerPanelSnapshotWarmLoop(options: any = {}): void {
    if (warmTimer) return;

    const intervalMs = Math.max(5_000, Number(options.intervalMs || DEFAULT_WARM_INTERVAL_MS));
    const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_CONCURRENCY));

    const runWarm = async () => {
        if (warmInFlight) return warmInFlight;
        warmInFlight = getServerPanelSnapshots({
            includeOnlines: true,
            ttlMs: intervalMs,
            concurrency,
        }).catch((error) => {
            console.error('Failed to warm server panel snapshots:', error?.message || error);
            return [];
        }).finally(() => {
            warmInFlight = null;
        });
        return warmInFlight;
    };

    const initialTimer = setTimeout(() => {
        runWarm();
    }, 0);
    if (typeof initialTimer?.unref === 'function') {
        initialTimer.unref();
    }

    warmTimer = setInterval(() => {
        runWarm();
    }, intervalMs);
    if (typeof warmTimer?.unref === 'function') {
        warmTimer.unref();
    }
}

export function stopServerPanelSnapshotWarmLoop(): void {
    if (warmTimer) {
        clearInterval(warmTimer);
        warmTimer = null;
    }
    warmInFlight = null;
}
