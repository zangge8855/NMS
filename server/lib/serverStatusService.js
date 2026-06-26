import serverStore from '../store/serverStore.js';
import serverTelemetryStore from '../store/serverTelemetryStore.js';
import config from '../config.js';
import { getServerPanelSnapshot } from './serverPanelSnapshotService.js';
import { normalizeOnlineEntries } from './panelOnlinePayload.js';
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
const DEFAULT_WARM_INTERVAL_MS = Math.max(5_000, Number(config.performance?.clusterStatusIntervalMs || 10_000));
const DEFAULT_WARM_FOLLOWUP_DELAY_MS = 1_200;
const snapshotCache = {
    promise: null,
    promiseIncludeDetails: false,
    value: null,
    valueIncludeDetails: false,
    checkedAtMs: 0,
};
// Per-server throughput baseline, kept separately from the cluster snapshot cache so that
// scoped (single-server) collections can maintain throughput continuity without writing
// the shared cluster cache. Updated on every collection, scoped or not.
const throughputBaselineByServerId = new Map();
let warmLoopTimer = null;
let warmLoopFollowupTimer = null;

function safeTrafficTotal(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function calculateMonotonicDelta(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
    if (current < previous) return 0;
    return current - previous;
}

function resolveNetworkTrafficTotals(item = {}) {
    const netTraffic = item?.status?.netTraffic || {};
    const sentTotal = Number(netTraffic.sent ?? netTraffic.up ?? netTraffic.upload);
    const recvTotal = Number(netTraffic.recv ?? netTraffic.down ?? netTraffic.download);
    if (!Number.isFinite(sentTotal) || !Number.isFinite(recvTotal)) {
        return null;
    }
    return {
        up: safeTrafficTotal(sentTotal),
        down: safeTrafficTotal(recvTotal),
    };
}

function buildThroughputSnapshot(current = {}, previous = null) {
    const currentCheckedAtMs = Date.parse(current?.checkedAt || '');
    const previousCheckedAtMs = Date.parse(previous?.checkedAt || '');
    const elapsedSeconds = (
        Number.isFinite(currentCheckedAtMs)
        && Number.isFinite(previousCheckedAtMs)
        && currentCheckedAtMs > previousCheckedAtMs
    )
        ? Math.max(1, (currentCheckedAtMs - previousCheckedAtMs) / 1000)
        : 0;
    const currentNetworkTotals = resolveNetworkTrafficTotals(current);
    const previousNetworkTotals = resolveNetworkTrafficTotals(previous);
    const currentTotals = currentNetworkTotals && previousNetworkTotals
        ? currentNetworkTotals
        : {
            up: safeTrafficTotal(current?.up),
            down: safeTrafficTotal(current?.down),
        };
    const previousTotals = currentNetworkTotals && previousNetworkTotals
        ? previousNetworkTotals
        : {
            up: safeTrafficTotal(previous?.up),
            down: safeTrafficTotal(previous?.down),
        };
    const ready = current?.online === true && previous?.online === true && elapsedSeconds > 0;
    const upPerSecond = ready
        ? calculateMonotonicDelta(currentTotals.up, previousTotals.up) / elapsedSeconds
        : 0;
    const downPerSecond = ready
        ? calculateMonotonicDelta(currentTotals.down, previousTotals.down) / elapsedSeconds
        : 0;

    return {
        ready,
        upPerSecond,
        downPerSecond,
        totalPerSecond: upPerSecond + downPerSecond,
    };
}

function attachThroughputSnapshots(items = [], previousByServerId = {}) {
    return (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        throughput: buildThroughputSnapshot(
            item,
            previousByServerId[String(item?.serverId || '').trim()] || null
        ),
    }));
}

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
        onlineSessionCount: 0,
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
    const readServerPanelSnapshot = options.getServerPanelSnapshot || getServerPanelSnapshot;
    const startedAt = Date.now();

    try {
        const client = await auth(server.id);
        const statusResponse = await fetchPanelServerStatus(client);
        const healthState = derivePanelHealthFromStatus(statusResponse?.data || statusResponse);

        let inbounds = [];
        let onlineUsers = [];
        let panelSnapshot = null;
        const collectionIssues = [];
        if (includeDetails) {
            try {
                panelSnapshot = await readServerPanelSnapshot(server, {
                    includeOnlines: true,
                    force: options.force === true,
                    getAuthenticatedPanelClient: async () => client,
                });
                inbounds = Array.isArray(panelSnapshot?.inbounds) ? panelSnapshot.inbounds : [];
                onlineUsers = normalizeOnlineEntries(panelSnapshot?.onlines);
                if (panelSnapshot?.inboundsError) {
                    collectionIssues.push({
                        source: 'inbounds',
                        ...classifyPanelError(panelSnapshot.inboundsError, { context: 'inbounds' }),
                    });
                }
                if (panelSnapshot?.onlinesError) {
                    collectionIssues.push({
                        source: 'online_users',
                        ...classifyPanelError(panelSnapshot.onlinesError, { context: 'online_users' }),
                    });
                }
            } catch (error) {
                inbounds = [];
                onlineUsers = [];
                const failure = classifyPanelError(error, { context: 'inbounds' });
                panelSnapshot = {
                    server: {
                        id: server.id,
                        name: server.name,
                    },
                    inbounds: [],
                    onlines: [],
                    checkedAt,
                    inboundsError: {
                        code: failure.reasonCode,
                        message: failure.reasonMessage,
                        status: 0,
                    },
                    onlinesError: {
                        code: failure.reasonCode,
                        message: failure.reasonMessage,
                        status: 0,
                    },
                };
                collectionIssues.push({
                    source: 'inbounds',
                    ...failure,
                });
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

        const serverUniqueOnlineUsers = new Set();
        onlineUsers.forEach((entry) => {
            const email = String(entry?.email || '').trim();
            if (email) {
                serverUniqueOnlineUsers.add(email.toLowerCase());
            }
        });
        const onlineCount = serverUniqueOnlineUsers.size;
        const onlineSessionCount = onlineUsers.length;

        return {
            serverId: server.id,
            name: server.name,
            online: true,
            latencyMs: Math.max(0, Date.now() - startedAt),
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
            onlineCount,
            onlineSessionCount,
            onlineUsers,
            collectionIssues,
            panelSnapshot: includeDetails ? panelSnapshot : null,
        };
    } catch (error) {
        const failure = classifyPanelError(error, { context: 'server_status' });
        return {
            serverId: server.id,
            name: server.name,
            online: false,
            latencyMs: Math.max(0, Date.now() - startedAt),
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
            onlineSessionCount: 0,
            onlineUsers: [],
            collectionIssues: [],
            panelSnapshot: includeDetails ? {
                server: {
                    id: server.id,
                    name: server.name,
                },
                inbounds: [],
                onlines: [],
                checkedAt,
                inboundsError: {
                    code: failure.reasonCode,
                    message: failure.reasonMessage,
                    status: 0,
                },
                onlinesError: {
                    code: failure.reasonCode,
                    message: failure.reasonMessage,
                    status: 0,
                },
            } : null,
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
        totalOnlineSessionCount: 0,
        totalUp: 0,
        totalDown: 0,
        totalInbounds: 0,
        activeInbounds: 0,
        checkedAt: new Date().toISOString(),
        byReason: {},
        throughput: {
            ready: false,
            readyServers: 0,
            upPerSecond: 0,
            downPerSecond: 0,
            totalPerSecond: 0,
        },
    };

    items.forEach((item) => {
        if (item.health === HEALTHY) summary.healthy += 1;
        if (item.health === DEGRADED) summary.degraded += 1;
        if (item.health === UNREACHABLE) summary.unreachable += 1;
        if (item.health === MAINTENANCE) summary.maintenance += 1;
        if (item.online) summary.onlineServers += 1;
        summary.totalOnline += Number(item.onlineCount || 0);
        summary.totalOnlineSessionCount += Number(item.onlineSessionCount || 0);
        summary.totalUp += Number(item.up || 0);
        summary.totalDown += Number(item.down || 0);
        summary.totalInbounds += Number(item.inboundCount || 0);
        summary.activeInbounds += Number(item.activeInbounds || 0);
        if (item?.throughput?.ready === true) {
            summary.throughput.readyServers += 1;
            summary.throughput.upPerSecond += Number(item.throughput.upPerSecond || 0);
            summary.throughput.downPerSecond += Number(item.throughput.downPerSecond || 0);
            summary.throughput.totalPerSecond += Number(item.throughput.totalPerSecond || 0);
        }
        const reasonCode = String(item.reasonCode || STATUS_REASON.NONE);
        summary.byReason[reasonCode] = (summary.byReason[reasonCode] || 0) + 1;
    });

    summary.throughput.ready = summary.throughput.readyServers > 0;
    summary.reasonCounts = summary.byReason;

    return summary;
}

export async function collectClusterStatusSnapshot(options = {}) {
    const force = options.force === true;
    const maxAgeMs = Number(options.maxAgeMs || 0);
    const includeDetails = options.includeDetails !== false;
    // A scoped request (explicit `servers` subset, e.g. a single-server dashboard or
    // server-detail refresh) must NOT read-hit or write back the shared cluster cache.
    // Writing a partial snapshot there would publish a one-server "cluster" to every
    // cluster-wide consumer (global dashboard, WS broadcast, app bootstrap, Telegram,
    // subscriptions reachability filter) for the cache window, and would also destroy
    // the other servers' throughput baselines.
    const scoped = Array.isArray(options.servers) && options.servers.length < serverStore.getAll().length;

    if (!scoped) {
        const ageMs = Date.now() - snapshotCache.checkedAtMs;
        const cachedSupportsRequest = !includeDetails || snapshotCache.valueIncludeDetails === true;
        const pendingSupportsRequest = !includeDetails || snapshotCache.promiseIncludeDetails === true;

        if (!force && cachedSupportsRequest && snapshotCache.value && ageMs >= 0 && ageMs <= maxAgeMs) {
            return snapshotCache.value;
        }

        if (pendingSupportsRequest && snapshotCache.promise) {
            return snapshotCache.promise;
        }
    }

    const compute = async () => {
        const servers = Array.isArray(options.servers) ? options.servers : serverStore.getAll();
        // Throughput baselines come from the dedicated per-server map (updated on every
        // collection), not the cluster cache, so scoped requests keep throughput continuity.
        const previousByServerId = Object.fromEntries(throughputBaselineByServerId);
        const rawItems = await runWithConcurrency(
            servers,
            (server) => collectServerStatusSnapshot(server, options),
            Number(options.concurrency || DEFAULT_CONCURRENCY)
        );
        const panelSnapshots = rawItems
            .map((item) => item?.panelSnapshot)
            .filter((item) => item && typeof item === 'object');
        const items = attachThroughputSnapshots(
            rawItems.map((item) => {
                if (!item || typeof item !== 'object') return item;
                const { panelSnapshot, ...publicItem } = item;
                return publicItem;
            }),
            previousByServerId
        );
        // Refresh the per-server throughput baseline for every server we just collected,
        // regardless of scope.
        items.forEach((item) => {
            const serverId = String(item?.serverId || '').trim();
            if (serverId) throughputBaselineByServerId.set(serverId, item);
        });
        const byServerId = Object.fromEntries(items.map((item) => [item.serverId, item]));
        const snapshot = {
            summary: buildSummary(items),
            items,
            byServerId,
            includeDetails,
            panelSnapshots,
        };
        if (!scoped) {
            serverTelemetryStore.recordSnapshot(snapshot);
            snapshotCache.value = snapshot;
            snapshotCache.valueIncludeDetails = includeDetails;
            snapshotCache.checkedAtMs = Date.now();
        }
        return snapshot;
    };

    if (scoped) {
        return compute();
    }

    const task = compute();

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
    throughputBaselineByServerId.clear();
}

function runWarmSnapshotCycle(options = {}) {
    return collectClusterStatusSnapshot({
        includeDetails: false,
        maxAgeMs: Math.max(0, Number(options.maxAgeMs || 0)),
        force: options.force === true,
    }).catch((error) => {
        console.error('Failed to warm cluster status snapshots:', error?.message || error);
        return null;
    });
}

export function startClusterStatusWarmLoop(options = {}) {
    if (warmLoopTimer) return;
    const intervalMs = Math.max(5_000, Number(options.intervalMs || DEFAULT_WARM_INTERVAL_MS));
    const followupDelayMs = Math.max(500, Number(options.followupDelayMs || DEFAULT_WARM_FOLLOWUP_DELAY_MS));

    const initialTimer = setTimeout(() => {
        runWarmSnapshotCycle({ force: true });
    }, 0);
    if (typeof initialTimer?.unref === 'function') {
        initialTimer.unref();
    }

    warmLoopFollowupTimer = setTimeout(() => {
        runWarmSnapshotCycle({ force: true });
    }, Math.min(followupDelayMs, intervalMs));
    if (typeof warmLoopFollowupTimer?.unref === 'function') {
        warmLoopFollowupTimer.unref();
    }

    warmLoopTimer = setInterval(() => {
        runWarmSnapshotCycle({
            maxAgeMs: intervalMs,
        });
    }, intervalMs);
    if (typeof warmLoopTimer?.unref === 'function') {
        warmLoopTimer.unref();
    }
}

export function stopClusterStatusWarmLoop() {
    if (warmLoopTimer) {
        clearInterval(warmLoopTimer);
        warmLoopTimer = null;
    }
    if (warmLoopFollowupTimer) {
        clearTimeout(warmLoopFollowupTimer);
        warmLoopFollowupTimer = null;
    }
}
