const DEFAULT_TTL_MS = 30_000;

interface CacheRecord {
    value: any[] | null;
    valueIncludesOnlines: boolean;
    checkedAtMs: number;
    promise: Promise<any[]> | null;
    promiseIncludesOnlines: boolean;
}

const cache = new Map<string, CacheRecord>();

function buildCacheKey(servers: any[] = []): string {
    return (Array.isArray(servers) ? servers : [])
        .map((server) => String(server?.id || '').trim())
        .filter(Boolean)
        .join('|');
}

function getRecord(key: string): CacheRecord {
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

export interface FetchServerPanelDataOptions {
    force?: boolean;
    includeOnlines?: boolean;
    ttlMs?: number;
}

export interface ServerPanelDataItem {
    server: any;
    inbounds: any[];
    onlines: any[];
    inboundsError: any;
    onlinesError: any;
}

export async function fetchServerPanelData(
    api: any,
    servers: any[] = [],
    options: FetchServerPanelDataOptions = {}
): Promise<ServerPanelDataItem[]> {
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

    const fetchViaPanelSnapshotRoute = async (): Promise<ServerPanelDataItem[]> => {
        const params = new URLSearchParams();
        if (normalizedServers.length > 0) {
            params.append('serverIds', normalizedServers.map((server) => String(server?.id || '').trim()).filter(Boolean).join(','));
        }
        if (includeOnlines === false) {
            params.append('includeOnlines', 'false');
        }
        if (force) {
            params.append('refresh', 'true');
        }
        const route = `/system/panel/snapshot${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await api.get(route);
        const items = Array.isArray(response?.data?.obj?.items) ? response.data.obj.items : [];

        return items.map((item: any) => {
            const serverId = String(item?.server?.id || '').trim();
            const fallbackServer = normalizedServers.find((server) => String(server?.id || '').trim() === serverId) || item?.server || {};
            return {
                server: fallbackServer,
                inbounds: Array.isArray(item?.inbounds) ? item.inbounds : [],
                onlines: Array.isArray(item?.onlines) ? item.onlines : [],
                inboundsError: item?.inboundsError || null,
                onlinesError: includeOnlines ? (item?.onlinesError || null) : null,
            };
        });
    };

    const fetchViaLegacyPanelProxy = (): Promise<ServerPanelDataItem[]> => Promise.all(
        normalizedServers.map(async (server: any) => {
            const [inboundsResult, onlinesResult] = await Promise.allSettled([
                api.get(`/panel/${server.id}/panel/api/inbounds/list`),
                includeOnlines
                    ? api.post(`/panel/${server.id}/panel/api/inbounds/onlines`)
                    : Promise.resolve({ data: { obj: [] } }),
            ]);

            const inbounds = inboundsResult.status === 'fulfilled' && Array.isArray((inboundsResult.value as any)?.data?.obj)
                ? (inboundsResult.value as any).data.obj
                : [];
            const onlines = onlinesResult.status === 'fulfilled' && Array.isArray((onlinesResult.value as any)?.data?.obj)
                ? (onlinesResult.value as any).data.obj
                : [];
            const inboundsError = inboundsResult.status === 'rejected' ? inboundsResult.reason : null;
            const onlinesError = includeOnlines && onlinesResult.status === 'rejected' ? onlinesResult.reason : null;

            return {
                server,
                inbounds,
                onlines,
                inboundsError,
                onlinesError,
            };
        })
    );

    const request = fetchViaPanelSnapshotRoute()
        .catch(async (error: any) => {
            const status = Number(error?.response?.status || 0);
            if (status > 0 && status !== 404 && status !== 500) {
                throw error;
            }
            return fetchViaLegacyPanelProxy();
        })
        .then((items: ServerPanelDataItem[]) => {
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

export function invalidateServerPanelDataCache(): void {
    cache.clear();
}
