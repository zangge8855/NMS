import serverStore from '../store/serverStore.js';
import {
    fetchServerLogPayload,
    normalizeLogCount,
    normalizeLogSource,
} from '../services/panelLogsService.js';

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;

const cache = new Map();

function buildCacheKey(serverId, source, count) {
    return `${String(serverId || '').trim()}::${String(source || '').trim()}::${Number(count || 0)}`;
}

function getRecord(serverId, source, count) {
    const key = buildCacheKey(serverId, source, count);
    if (!cache.has(key)) {
        cache.set(key, {
            value: null,
            checkedAtMs: 0,
            promise: null,
        });
    }
    return cache.get(key);
}

function buildErrorPayload(error) {
    return {
        code: String(error?.code || 'LOG_FETCH_FAILED').trim(),
        status: Number(error?.status || error?.response?.status || 0) || 0,
        message: String(error?.message || error?.response?.data?.msg || '获取日志失败').trim(),
    };
}

async function runWithConcurrency(items, worker, concurrency = DEFAULT_CONCURRENCY) {
    const results = [];
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

async function getServerLogSnapshot(serverId, options = {}, deps = {}) {
    const servers = deps.serverStore || serverStore;
    const readServerLogPayload = deps.fetchServerLogPayload || fetchServerLogPayload;
    const normalizedServerId = String(serverId || '').trim();
    const source = normalizeLogSource(options.source);
    const count = normalizeLogCount(options.count, 100);
    const force = options.force === true;
    const ttlMs = Math.max(0, Number(options.ttlMs || DEFAULT_TTL_MS));
    const server = typeof servers.getById === 'function'
        ? servers.getById(normalizedServerId)
        : null;

    if (!server) {
        const error = new Error('Server not found');
        error.status = 404;
        throw error;
    }

    const record = getRecord(normalizedServerId, source, count);
    const ageMs = Date.now() - Number(record.checkedAtMs || 0);
    if (!force && record.value && ageMs >= 0 && ageMs <= ttlMs) {
        return record.value;
    }
    if (!force && record.promise) {
        return record.promise;
    }

    const request = readServerLogPayload(normalizedServerId, { source, count }, deps)
        .then((payload) => {
            const snapshot = {
                serverId: normalizedServerId,
                serverName: String(server?.name || '').trim(),
                source,
                count,
                supported: payload?.supported !== false,
                warning: String(payload?.warning || '').trim(),
                sourcePath: String(payload?.sourcePath || '').trim(),
                lines: Array.isArray(payload?.lines) ? payload.lines : [],
                fetchedAt: new Date().toISOString(),
            };
            record.value = snapshot;
            record.checkedAtMs = Date.now();
            return snapshot;
        })
        .finally(() => {
            if (record.promise === request) {
                record.promise = null;
            }
        });

    record.promise = request;
    return request;
}

async function getServerLogSnapshots(options = {}, deps = {}) {
    const servers = deps.serverStore || serverStore;
    const source = normalizeLogSource(options.source);
    const count = normalizeLogCount(options.count, 100);
    const requestedServerIds = Array.isArray(options.serverIds)
        ? options.serverIds
        : String(options.serverIds || '')
            .split(',')
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    const targetServers = requestedServerIds.length > 0
        ? servers.getAll().filter((server) => requestedServerIds.includes(String(server?.id || '').trim()))
        : servers.getAll();

    if (targetServers.length === 0) return [];

    return runWithConcurrency(
        targetServers,
        async (server) => {
            try {
                return await getServerLogSnapshot(server.id, {
                    source,
                    count,
                    force: options.force === true,
                    ttlMs: options.ttlMs,
                }, deps);
            } catch (error) {
                return {
                    serverId: String(server?.id || '').trim(),
                    serverName: String(server?.name || '').trim(),
                    source,
                    count,
                    supported: false,
                    warning: '',
                    sourcePath: '',
                    lines: [],
                    fetchedAt: new Date().toISOString(),
                    error: buildErrorPayload(error),
                };
            }
        },
        Number(options.concurrency || DEFAULT_CONCURRENCY)
    );
}

function invalidateServerLogSnapshotCache(serverId = '') {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) {
        cache.clear();
        return;
    }

    for (const key of cache.keys()) {
        if (key.startsWith(`${normalizedServerId}::`)) {
            cache.delete(key);
        }
    }
}

export {
    getServerLogSnapshot,
    getServerLogSnapshots,
    invalidateServerLogSnapshotCache,
};
