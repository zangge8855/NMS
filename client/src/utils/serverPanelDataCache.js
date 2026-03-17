const DEFAULT_TTL_MS = 30_000;

const cache = new Map();

function buildCacheKey(servers = []) {
    return (Array.isArray(servers) ? servers : [])
        .map((server) => String(server?.id || '').trim())
        .filter(Boolean)
        .join('|');
}

function getRecord(key) {
    if (!cache.has(key)) {
        cache.set(key, {
            value: null,
            valueIncludesOnlines: false,
            checkedAtMs: 0,
            promise: null,
            promiseIncludesOnlines: false,
        });
    }
    return cache.get(key);
}

export async function fetchServerPanelData(api, servers = [], options = {}) {
    const normalizedServers = Array.isArray(servers) ? servers : [];
    const force = options.force === true;
    const includeOnlines = options.includeOnlines !== false;
    const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
    const key = buildCacheKey(normalizedServers);
    const record = getRecord(key);
    const ageMs = Date.now() - Number(record.checkedAtMs || 0);
    const cachedSupportsRequest = !includeOnlines || record.valueIncludesOnlines === true;
    const pendingSupportsRequest = !includeOnlines || record.promiseIncludesOnlines === true;

    if (!force && record.value && cachedSupportsRequest && ageMs >= 0 && ageMs <= ttlMs) {
        return record.value;
    }

    if (!force && record.promise && pendingSupportsRequest) {
        return record.promise;
    }

    const request = Promise.all(
        normalizedServers.map(async (server) => {
            let inbounds = [];
            let onlines = [];
            let inboundsError = null;
            let onlinesError = null;

            try {
                const inboundsRes = await api.get(`/panel/${server.id}/panel/api/inbounds/list`);
                inbounds = Array.isArray(inboundsRes.data?.obj) ? inboundsRes.data.obj : [];
            } catch (error) {
                inboundsError = error;
            }

            if (includeOnlines) {
                try {
                    const onlinesRes = await api.post(`/panel/${server.id}/panel/api/inbounds/onlines`);
                    onlines = Array.isArray(onlinesRes.data?.obj) ? onlinesRes.data.obj : [];
                } catch (error) {
                    onlinesError = error;
                }
            }

            return {
                server,
                inbounds,
                onlines,
                inboundsError,
                onlinesError,
            };
        })
    ).then((items) => {
        record.value = items;
        record.valueIncludesOnlines = includeOnlines;
        record.checkedAtMs = Date.now();
        return items;
    }).finally(() => {
        if (record.promise === request) {
            record.promise = null;
            record.promiseIncludesOnlines = false;
        }
    });

    record.promise = request;
    record.promiseIncludesOnlines = includeOnlines;
    return request;
}

export function invalidateServerPanelDataCache() {
    cache.clear();
}
