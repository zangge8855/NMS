import serverStore from '../store/serverStore.js';
import {
    classifyPanelError as classifyPanelFailure,
    derivePanelHealthFromStatus,
    ensureAuthenticated,
    fetchPanelServerStatus,
} from './panelClient.js';

export const HEALTHY = 'healthy';
export const DEGRADED = 'degraded';
export const UNREACHABLE = 'unreachable';
export const MAINTENANCE = 'maintenance';

export const STATUS_REASON = {
    NONE: 'none',
    DNS_ERROR: 'dns_error',
    CONNECT_TIMEOUT: 'connect_timeout',
    CONNECTION_REFUSED: 'connection_refused',
    NETWORK_ERROR: 'network_error',
    AUTH_FAILED: 'auth_failed',
    CREDENTIALS_MISSING: 'credentials_missing',
    CREDENTIALS_UNREADABLE: 'credentials_unreadable',
    STATUS_UNSUPPORTED: 'status_unsupported',
    XRAY_NOT_RUNNING: 'xray_not_running',
    PANEL_REQUEST_FAILED: 'panel_request_failed',
    MAINTENANCE: 'maintenance',
};

const DEFAULT_CONCURRENCY = 5;
const snapshotCache = {
    promise: null,
    promiseIncludeDetails: false,
    value: null,
    valueIncludeDetails: false,
    checkedAtMs: 0,
};

function normalizeReasonMessage(value) {
    return String(
        value?.response?.data?.msg
        || value?.message
        || value
        || ''
    ).trim();
}

function classifyPanelError(error, options = {}) {
    const classified = classifyPanelFailure(error, options);
    const reasonCode = String(classified.reasonCode || STATUS_REASON.PANEL_REQUEST_FAILED);
    if (Object.values(STATUS_REASON).includes(reasonCode)) {
        return classified;
    }
    return {
        health: classified.health || DEGRADED,
        reasonCode: STATUS_REASON.PANEL_REQUEST_FAILED,
        reasonMessage: classified.reasonMessage || normalizeReasonMessage(error) || 'Panel request failed.',
        retryable: classified.retryable !== false,
    };
}

function normalizeOnlineEntries(onlines = []) {
    const rows = [];
    for (const item of onlines) {
        if (typeof item === 'string' && item.trim()) {
            rows.push({ email: item.trim() });
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        const email = String(item.email || item.user || item.username || item.clientEmail || '').trim();
        if (email) {
            rows.push({ email });
        }
    }
    return rows;
}

function buildMaintenanceSnapshot(server) {
    const checkedAt = new Date().toISOString();
    return {
        serverId: server.id,
        name: server.name,
        online: false,
        health: MAINTENANCE,
        reasonCode: STATUS_REASON.MAINTENANCE,
        reasonMessage: '',
        retryable: false,
        error: '',
        checkedAt,
        status: {
            cpu: 0,
            mem: { current: 0, total: 1 },
            uptime: 0,
            xray: {},
            netTraffic: {},
        },
        inboundCount: 0,
        activeInbounds: 0,
        up: 0,
        down: 0,
        onlineCount: 0,
        onlineUsers: [],
        collectionIssues: [],
    };
}

async function runWithConcurrency(items, worker, concurrency = DEFAULT_CONCURRENCY) {
    const results = [];
    let idx = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (idx < items.length) {
            const current = idx++;
            results[current] = await worker(items[current], current);
        }
    });
    await Promise.all(runners);
    return results;
}

export async function collectServerStatusSnapshot(server, options = {}) {
    const checkedAt = new Date().toISOString();
    const serverHealth = String(server?.health || '').trim().toLowerCase();
    if (serverHealth === MAINTENANCE) {
        return buildMaintenanceSnapshot(server);
    }

    const auth = options.ensureAuthenticated || ensureAuthenticated;
    const includeDetails = options.includeDetails !== false;

    try {
        const client = await auth(server.id);
        const statusResponse = await fetchPanelServerStatus(client);
        const healthState = derivePanelHealthFromStatus(statusResponse?.data || statusResponse);

        let inbounds = [];
        let onlineUsers = [];
        const collectionIssues = [];
        if (includeDetails) {
            try {
                const inboundsRes = await client.get('/panel/api/inbounds/list');
                inbounds = Array.isArray(inboundsRes?.data?.obj) ? inboundsRes.data.obj : [];
            } catch (error) {
                inbounds = [];
                collectionIssues.push({
                    source: 'inbounds',
                    ...classifyPanelError(error, { context: 'inbounds' }),
                });
            }
            try {
                const onlinesRes = await client.post('/panel/api/inbounds/onlines');
                onlineUsers = normalizeOnlineEntries(Array.isArray(onlinesRes?.data?.obj) ? onlinesRes.data.obj : []);
            } catch (error) {
                onlineUsers = [];
                collectionIssues.push({
                    source: 'online_users',
                    ...classifyPanelError(error, { context: 'online_users' }),
                });
            }
        }

        const inboundCount = inbounds.length;
        const activeInbounds = inbounds.filter((item) => Boolean(item?.enable)).length;
        const hasInboundTrafficTotals = inbounds.some((item) => item && (item.up !== undefined || item.down !== undefined));
        const totalInboundUp = inbounds.reduce((sum, item) => sum + Number(item?.up || 0), 0);
        const totalInboundDown = inbounds.reduce((sum, item) => sum + Number(item?.down || 0), 0);
        const status = statusResponse?.data?.obj || statusResponse?.obj || {};

        return {
            serverId: server.id,
            name: server.name,
            online: true,
            health: healthState.health,
            reasonCode: healthState.reasonCode,
            reasonMessage: healthState.reasonMessage,
            retryable: healthState.retryable === true,
            error: healthState.reasonMessage,
            checkedAt,
            status: {
                cpu: status?.cpu ?? 0,
                mem: status?.mem ?? { current: 0, total: 1 },
                uptime: status?.uptime ?? 0,
                xray: status?.xray ?? {},
                netTraffic: status?.netTraffic ?? {},
            },
            inboundCount,
            activeInbounds,
            up: hasInboundTrafficTotals ? totalInboundUp : Number(status?.netTraffic?.sent || 0),
            down: hasInboundTrafficTotals ? totalInboundDown : Number(status?.netTraffic?.recv || 0),
            onlineCount: onlineUsers.length,
            onlineUsers,
            collectionIssues,
        };
    } catch (error) {
        const failure = classifyPanelError(error, { context: 'server_status' });
        return {
            serverId: server.id,
            name: server.name,
            online: false,
            health: failure.health,
            reasonCode: failure.reasonCode,
            reasonMessage: failure.reasonMessage,
            retryable: failure.retryable,
            error: failure.reasonMessage,
            checkedAt,
            status: {
                cpu: 0,
                mem: { current: 0, total: 1 },
                uptime: 0,
                xray: {},
                netTraffic: {},
            },
            inboundCount: 0,
            activeInbounds: 0,
            up: 0,
            down: 0,
            onlineCount: 0,
            onlineUsers: [],
            collectionIssues: [],
        };
    }
}

function buildSummary(items = []) {
    const summary = {
        total: items.length,
        healthy: 0,
        degraded: 0,
        unreachable: 0,
        maintenance: 0,
        onlineServers: 0,
        totalOnline: 0,
        totalUp: 0,
        totalDown: 0,
        totalInbounds: 0,
        activeInbounds: 0,
        checkedAt: new Date().toISOString(),
        byReason: {},
    };

    items.forEach((item) => {
        if (item.health === HEALTHY) summary.healthy += 1;
        if (item.health === DEGRADED) summary.degraded += 1;
        if (item.health === UNREACHABLE) summary.unreachable += 1;
        if (item.health === MAINTENANCE) summary.maintenance += 1;
        if (item.online) summary.onlineServers += 1;
        summary.totalOnline += Number(item.onlineCount || 0);
        summary.totalUp += Number(item.up || 0);
        summary.totalDown += Number(item.down || 0);
        summary.totalInbounds += Number(item.inboundCount || 0);
        summary.activeInbounds += Number(item.activeInbounds || 0);
        const reasonCode = String(item.reasonCode || STATUS_REASON.NONE);
        summary.byReason[reasonCode] = (summary.byReason[reasonCode] || 0) + 1;
    });

    summary.reasonCounts = summary.byReason;

    return summary;
}

export async function collectClusterStatusSnapshot(options = {}) {
    const force = options.force === true;
    const maxAgeMs = Number(options.maxAgeMs || 0);
    const includeDetails = options.includeDetails !== false;
    const ageMs = Date.now() - snapshotCache.checkedAtMs;
    const cachedSupportsRequest = !includeDetails || snapshotCache.valueIncludeDetails === true;
    const pendingSupportsRequest = !includeDetails || snapshotCache.promiseIncludeDetails === true;

    if (!force && cachedSupportsRequest && snapshotCache.value && ageMs >= 0 && ageMs <= maxAgeMs) {
        return snapshotCache.value;
    }

    if (pendingSupportsRequest && snapshotCache.promise) {
        return snapshotCache.promise;
    }

    const task = (async () => {
        const servers = Array.isArray(options.servers) ? options.servers : serverStore.getAll();
        const items = await runWithConcurrency(
            servers,
            (server) => collectServerStatusSnapshot(server, options),
            Number(options.concurrency || DEFAULT_CONCURRENCY)
        );
        const byServerId = Object.fromEntries(items.map((item) => [item.serverId, item]));
        const snapshot = {
            summary: buildSummary(items),
            items,
            byServerId,
            includeDetails,
        };
        snapshotCache.value = snapshot;
        snapshotCache.valueIncludeDetails = includeDetails;
        snapshotCache.checkedAtMs = Date.now();
        return snapshot;
    })();

    snapshotCache.promise = task;
    snapshotCache.promiseIncludeDetails = includeDetails;
    try {
        return await task;
    } finally {
        if (snapshotCache.promise === task) {
            snapshotCache.promise = null;
            snapshotCache.promiseIncludeDetails = false;
        }
    }
}

export function getCachedClusterStatusSnapshot() {
    return snapshotCache.value;
}

export function resetClusterStatusSnapshotCache() {
    snapshotCache.promise = null;
    snapshotCache.promiseIncludeDetails = false;
    snapshotCache.value = null;
    snapshotCache.valueIncludeDetails = false;
    snapshotCache.checkedAtMs = 0;
}
