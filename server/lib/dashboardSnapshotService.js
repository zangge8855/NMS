import { ensureAuthenticated } from './panelClient.js';
import { normalizeEmail, parseJsonObjectLike } from './normalize.js';
import { collectClusterStatusSnapshot } from './serverStatusService.js';
import { getServerPanelSnapshot, getServerPanelSnapshots } from './serverPanelSnapshotService.js';
import serverStore from '../store/serverStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import trafficStatsStore, {
    buildCalendarTrafficWindowRange,
    summarizeRegisteredTrafficTotals,
    summarizeServerTrafficTotals,
} from '../store/trafficStatsStore.js';
import userStore from '../store/userStore.js';

const CPU_HISTORY_TTL_MS = 20_000;
const LIVE_TRAFFIC_OVERLAY_SKEW_MS = 60_000;
const cpuHistoryCache = new Map();

function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getClientIdentifier(client = {}, protocol = '') {
    const normalizedProtocol = String(protocol || client?.protocol || '').trim().toLowerCase();
    if (normalizedProtocol === 'trojan' || normalizedProtocol === 'shadowsocks') {
        return client.password || client.id || client.email || '';
    }
    return client.id || client.password || client.email || '';
}

function resolveClientUsed(client = {}) {
    return safeNumber(client?.up) + safeNumber(client?.down);
}

function extractInboundClients(inbound = {}) {
    const settings = parseJsonObjectLike(inbound?.settings, {});
    return Array.isArray(settings.clients) ? settings.clients : [];
}

function resolveClientKeys(client = {}, protocol = '') {
    const keys = new Set();
    const identifier = String(getClientIdentifier(client, protocol) || '').trim();
    const email = normalizeEmail(client?.email);
    const id = String(client?.id || '').trim();
    const password = String(client?.password || '').trim();

    if (identifier) keys.add(`identifier:${identifier}`);
    if (email) keys.add(`email:${email}`);
    if (id) keys.add(`id:${id}`);
    if (password) keys.add(`password:${password}`);
    return Array.from(keys);
}

function mergeInboundClientStats(inbound = {}) {
    const baseClients = extractInboundClients(inbound);
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
        if (!stats) return client;
        return {
            ...client,
            up: stats.up ?? client.up,
            down: stats.down ?? client.down,
            reset: stats.reset ?? client.reset,
        };
    });
}

function normalizeOnlineValue(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeOnlineKeys(item) {
    if (typeof item === 'string') {
        const value = normalizeOnlineValue(item);
        return value ? [value] : [];
    }
    if (!item || typeof item !== 'object') return [];
    return Array.from(new Set(
        [
            item.email,
            item.user,
            item.username,
            item.clientEmail,
            item.client,
            item.remark,
            item.id,
            item.password,
        ].map((value) => normalizeOnlineValue(value)).filter(Boolean)
    ));
}

function buildClientOnlineKeys(client, protocol) {
    const keys = new Set();
    const email = normalizeOnlineValue(client?.email);
    const identifier = normalizeOnlineValue(getClientIdentifier(client, protocol));
    const id = normalizeOnlineValue(client?.id);
    const password = normalizeOnlineValue(client?.password);

    if (email) keys.add(email);
    if (identifier) keys.add(identifier);
    if (id) keys.add(id);
    if (password) keys.add(password);

    return Array.from(keys);
}

function collectServerInboundRemarks(inbounds = [], serverName = '') {
    const enabledRemarks = [];
    const fallbackRemarks = [];
    const seen = new Set();
    const normalizedServerName = String(serverName || '').trim().toLowerCase();

    const pushRemark = (list, remark) => {
        const text = String(remark || '').trim();
        if (!text) return;
        const normalized = text.toLowerCase();
        if (normalized === normalizedServerName || seen.has(normalized)) return;
        seen.add(normalized);
        list.push(text);
    };

    (Array.isArray(inbounds) ? inbounds : []).forEach((inbound) => {
        const remark = String(inbound?.remark || '').trim();
        if (!remark) return;
        if (inbound?.enable === false) {
            pushRemark(fallbackRemarks, remark);
            return;
        }
        pushRemark(enabledRemarks, remark);
    });

    return enabledRemarks.length > 0 ? enabledRemarks : fallbackRemarks;
}

function withServerRemarkMeta(serverData, serverName = '') {
    const nodeRemarks = collectServerInboundRemarks(serverData?.rawInbounds || [], serverName);
    return {
        ...serverData,
        nodeRemarks,
        nodeRemarkPreview: nodeRemarks.slice(0, 2),
        nodeRemarkCount: nodeRemarks.length,
    };
}

function buildManagedOnlineSummary(users, serverPayloads = [], activeTrafficKeys = new Set()) {
    const clientsMap = new Map();
    const onlineMap = new Map();
    const onlineServerIdMap = new Map();
    const onlineServerLabelMap = new Map();
    const managedEmailSet = new Set();
    const serverTrafficByServerId = {};
    const emailMatchedOnlineSessions = new Map();

    const rawTotalOnlineUsers = new Set();
    let rawTotalSessions = 0;

    (Array.isArray(users) ? users : [])
        .filter((user) => user?.role !== 'admin')
        .forEach((user) => {
            const subscriptionEmail = normalizeEmail(user?.subscriptionEmail);
            const loginEmail = normalizeEmail(user?.email);
            if (subscriptionEmail) managedEmailSet.add(subscriptionEmail);
            if (loginEmail) managedEmailSet.add(loginEmail);
        });

    serverPayloads.forEach((payload) => {
        const inbounds = Array.isArray(payload?.inbounds) ? payload.inbounds : [];
        const onlines = Array.isArray(payload?.onlines) ? payload.onlines : [];
        const serverName = String(payload?.serverName || '').trim();
        const serverId = String(payload?.serverId || '').trim();
        const onlineMatchMap = new Map();

        rawTotalSessions += onlines.length;

        onlines.forEach((entry, index) => {
            normalizeOnlineKeys(entry).forEach((key) => {
                if (!onlineMatchMap.has(key)) {
                    onlineMatchMap.set(key, new Set());
                }
                onlineMatchMap.get(key).add(index);
            });
            const email = normalizeEmail(
                entry?.email || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry?.remark || entry
            );
            
            const rawIdentifier = email || String(entry?.email || entry?.id || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry || '').trim();
            if (rawIdentifier && rawIdentifier !== '[object Object]') {
                rawTotalOnlineUsers.add(rawIdentifier);
            }

            if (email) {
                onlineMap.set(email, (onlineMap.get(email) || 0) + 1);
                if (!onlineServerIdMap.has(email)) {
                    onlineServerIdMap.set(email, new Set());
                }
                if (!onlineServerLabelMap.has(email)) {
                    onlineServerLabelMap.set(email, new Set());
                }
                if (serverId) {
                    onlineServerIdMap.get(email).add(serverId);
                }
                if (serverName) {
                    onlineServerLabelMap.get(email).add(serverName);
                }
            }
        });

        inbounds.forEach((inbound) => {
            const protocol = String(inbound?.protocol || '').toLowerCase();
            if (!['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) return;
            if (inbound?.enable === false) return;

            const clients = mergeInboundClientStats(inbound);
            clients.forEach((client) => {
                const email = normalizeEmail(client?.email);
                if (!email) return;
                if (!clientsMap.has(email)) {
                    clientsMap.set(email, {
                        count: 0,
                        totalUsed: 0,
                        totalUp: 0,
                        totalDown: 0,
                        onlineSessions: 0,
                        servers: new Set(),
                        serverIds: new Set(),
                        nodeLabels: new Set(),
                    });
                }
                const entry = clientsMap.get(email);
                const matchedOnlineEntries = new Set();
                buildClientOnlineKeys(client, protocol).forEach((key) => {
                    const matches = onlineMatchMap.get(key);
                    if (!matches) return;
                    matches.forEach((matchIndex) => matchedOnlineEntries.add(matchIndex));
                });
                
                let onlineSessions = matchedOnlineEntries.size;
                const hasActiveTraffic = activeTrafficKeys.has(`${serverId}:${email}`) || activeTrafficKeys.has(email);
                if (onlineSessions === 0 && hasActiveTraffic) {
                    onlineSessions = 1;
                    matchedOnlineEntries.add('traffic_inferred');
                }
                
                entry.count += 1;
                entry.totalUsed += resolveClientUsed(client);
                entry.totalUp += safeNumber(client?.up);
                entry.totalDown += safeNumber(client?.down);
                if (serverId && managedEmailSet.has(email)) {
                    const bucket = serverTrafficByServerId[serverId] || { up: 0, down: 0, total: 0 };
                    bucket.up += safeNumber(client?.up);
                    bucket.down += safeNumber(client?.down);
                    bucket.total += safeNumber(client?.up) + safeNumber(client?.down);
                    serverTrafficByServerId[serverId] = bucket;
                }
                if (onlineSessions > 0) {
                    if (!emailMatchedOnlineSessions.has(email)) {
                        emailMatchedOnlineSessions.set(email, new Set());
                    }
                    const matchedSet = emailMatchedOnlineSessions.get(email);
                    matchedOnlineEntries.forEach((matchIndex) => {
                        // 'traffic_inferred' is a synthetic marker — collapse across servers so a roaming
                        // user counts as 1 session, not N. Real panel-reported sessions still scope by serverId.
                        const key = matchIndex === 'traffic_inferred'
                            ? 'traffic_inferred'
                            : `${serverId}:${matchIndex}`;
                        matchedSet.add(key);
                    });
                }
                if (onlineSessions > 0 && serverName) {
                    entry.servers.add(serverName);
                }
                if (onlineSessions > 0 && serverId) {
                    entry.serverIds.add(serverId);
                }
                if (onlineSessions > 0) {
                    const nodeLabel = String(inbound?.remark || '').trim() || serverName;
                    if (nodeLabel) {
                        entry.nodeLabels.add(nodeLabel);
                    }
                }
            });
        });
    });

    const rows = (Array.isArray(users) ? users : [])
        .filter((user) => user?.role !== 'admin')
        .map((user) => {
            const subscriptionEmail = normalizeEmail(user?.subscriptionEmail);
            const loginEmail = normalizeEmail(user?.email);
            const username = String(user?.username || '').trim();
            const resolvedEmail = subscriptionEmail || loginEmail || '';
            const clientData = clientsMap.get(subscriptionEmail) || clientsMap.get(loginEmail) || {
                count: 0,
                onlineSessions: 0,
                servers: new Set(),
                serverIds: new Set(),
                nodeLabels: new Set(),
            };
            const matchedSessionsSet = emailMatchedOnlineSessions.get(subscriptionEmail) || emailMatchedOnlineSessions.get(loginEmail);
            const sessions = matchedSessionsSet ? matchedSessionsSet.size : (onlineMap.get(subscriptionEmail) || onlineMap.get(loginEmail) || 0);
            clientData.onlineSessions = sessions;
            const matchedServers = clientData.servers?.size
                ? Array.from(clientData.servers)
                : Array.from(onlineServerLabelMap.get(subscriptionEmail) || onlineServerLabelMap.get(loginEmail) || []);
            const matchedServerIds = clientData.serverIds?.size
                ? Array.from(clientData.serverIds)
                : Array.from(onlineServerIdMap.get(subscriptionEmail) || onlineServerIdMap.get(loginEmail) || []);
            const matchedNodes = clientData.nodeLabels?.size
                ? Array.from(clientData.nodeLabels)
                : matchedServers;
            const displayName = username || resolvedEmail || user?.id || '-';
            return {
                userId: user?.id,
                username,
                email: resolvedEmail,
                displayName,
                label: resolvedEmail || displayName,
                sessions,
                clientData,
                clientCount: clientData.count || 0,
                enabled: user?.enabled !== false,
                servers: matchedServers,
                serverIds: matchedServerIds,
                nodeLabels: matchedNodes,
            };
        })
        .sort((left, right) => {
            if (right.sessions !== left.sessions) return right.sessions - left.sessions;
            return String(left.displayName || left.label || '').localeCompare(String(right.displayName || right.label || ''));
        });

    const totalUp = rows.reduce((sum, row) => sum + Number(row?.clientData?.totalUp || 0), 0);
    const totalDown = rows.reduce((sum, row) => sum + Number(row?.clientData?.totalDown || 0), 0);
    const onlineRows = rows.filter((row) => row.sessions > 0);
    const serverOnlineUserCountByServerId = onlineRows.reduce((acc, row) => {
        row.serverIds.forEach((serverIdValue) => {
            const serverId = String(serverIdValue || '').trim();
            if (!serverId) return;
            acc[serverId] = (acc[serverId] || 0) + 1;
        });
        return acc;
    }, {});

    return {
        rows,
        onlineRows,
        onlineSessionCount: rows.reduce((sum, row) => sum + Number(row.sessions || 0), 0),
        pendingCount: rows.filter((row) => row.enabled === false && row.clientCount === 0).length,
        totalUp,
        totalDown,
        totalUsed: totalUp + totalDown,
        serverTrafficByServerId,
        serverOnlineUserCountByServerId,
        rawTotalOnlineUsersCount: rawTotalOnlineUsers.size,
        rawTotalSessions,
    };
}

function buildDashboardPresenceFromPanelSnapshots(users, panelSnapshots = [], activeTrafficEmails = new Set()) {
    return buildManagedOnlineSummary(
        users,
        (Array.isArray(panelSnapshots) ? panelSnapshots : []).map((item) => ({
            serverId: item?.server?.id || item?.serverId || '',
            serverName: item?.server?.name || item?.serverName || '',
            inbounds: Array.isArray(item?.inbounds) ? item.inbounds : [],
            onlines: Array.isArray(item?.onlines) ? item.onlines : [],
        })),
        activeTrafficEmails,
    );
}

function buildLiveServerPayloads(panelSnapshots = []) {
    return (Array.isArray(panelSnapshots) ? panelSnapshots : [])
        .map((item) => ({
            serverId: String(item?.server?.id || item?.serverId || '').trim(),
            serverName: String(item?.server?.name || item?.serverName || '').trim(),
            inbounds: Array.isArray(item?.inbounds) ? item.inbounds : [],
        }))
        .filter((item) => item.serverId);
}

function toIsoTimestampMs(value) {
    const timestamp = Date.parse(String(value || '').trim());
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sumTrafficTotals(items = []) {
    return (Array.isArray(items) ? items : []).reduce((acc, item) => {
        acc.upBytes += Number(item?.upBytes || 0);
        acc.downBytes += Number(item?.downBytes || 0);
        acc.totalBytes += Number(item?.totalBytes || 0);
        return acc;
    }, {
        upBytes: 0,
        downBytes: 0,
        totalBytes: 0,
    });
}

function calculateMonotonicTrafficDelta(currentValue, previousValue) {
    const current = Number(currentValue || 0);
    const previous = Number(previousValue || 0);
    if (!Number.isFinite(current) || current <= 0) return 0;
    if (!Number.isFinite(previous) || previous < 0) return current;
    return current >= previous ? (current - previous) : current;
}

function mergeTrafficTotals(base = {}, delta = {}) {
    const upBytes = Number(base?.upBytes || 0) + Number(delta?.upBytes || 0);
    const downBytes = Number(base?.downBytes || 0) + Number(delta?.downBytes || 0);
    return {
        upBytes,
        downBytes,
        totalBytes: upBytes + downBytes,
    };
}

function shouldOverlayRealtimeTraffic(overview = {}) {
    const lastCollectionAtMs = toIsoTimestampMs(overview?.lastCollectionAt);
    const fromMs = toIsoTimestampMs(overview?.from);
    const toMs = toIsoTimestampMs(overview?.to);
    if (!lastCollectionAtMs || !fromMs || !toMs) return false;
    if (lastCollectionAtMs < fromMs || lastCollectionAtMs > toMs) return false;
    return toMs >= (Date.now() - LIVE_TRAFFIC_OVERLAY_SKEW_MS);
}

function buildDashboardTrafficWindowTotal(options = {}, deps = {}) {
    const overview = options.overview || (deps.trafficStatsStore || trafficStatsStore).getOverview(options);
    const baseTotals = overview?.managedTotals || overview?.totals || { upBytes: 0, downBytes: 0 };
    const unattributedTotals = overview?.userLevelSupported === false
        ? (overview?.unattributedTotals || { upBytes: 0, downBytes: 0, totalBytes: 0 })
        : { upBytes: 0, downBytes: 0, totalBytes: 0 };
    const hasWindowSamples = Number(overview?.sampleCount || 0) > 0;
    const baselineReady = overview?.baselineReady === true;
    const liveOverlayContext = deps.liveOverlayContext || null;
    const canOverlayRealtimeTraffic = Number(liveOverlayContext?.serverCount || 0) > 0
        && baselineReady
        && shouldOverlayRealtimeTraffic(overview);

    const buildWindowValue = (totals = {}, ready = hasWindowSamples) => ({
        totalUp: Number(totals?.upBytes || 0),
        totalDown: Number(totals?.downBytes || 0),
        ready,
        attributionComplete: overview?.userLevelSupported !== false,
        unattributedUp: Number(unattributedTotals?.upBytes || 0),
        unattributedDown: Number(unattributedTotals?.downBytes || 0),
        unattributedTotal: Number(unattributedTotals?.totalBytes || 0),
    });

    if (!canOverlayRealtimeTraffic) {
        return buildWindowValue(baseTotals, hasWindowSamples);
    }

    const currentRegisteredTotals = liveOverlayContext?.registeredTotals || { upBytes: 0, downBytes: 0, totalBytes: 0 };
    const currentClusterTotals = liveOverlayContext?.clusterTotals || { upBytes: 0, downBytes: 0, totalBytes: 0 };
    const baselineClusterTotals = sumTrafficTotals(Array.isArray(overview?.serverTotals) ? overview.serverTotals : []);
    const managedDelta = {
        upBytes: calculateMonotonicTrafficDelta(currentRegisteredTotals?.upBytes, overview?.registeredTotals?.upBytes),
        downBytes: calculateMonotonicTrafficDelta(currentRegisteredTotals?.downBytes, overview?.registeredTotals?.downBytes),
    };
    managedDelta.totalBytes = managedDelta.upBytes + managedDelta.downBytes;
    const clusterDelta = {
        upBytes: calculateMonotonicTrafficDelta(currentClusterTotals?.upBytes, baselineClusterTotals?.upBytes),
        downBytes: calculateMonotonicTrafficDelta(currentClusterTotals?.downBytes, baselineClusterTotals?.downBytes),
    };
    clusterDelta.totalBytes = clusterDelta.upBytes + clusterDelta.downBytes;
    const mergedTotals = mergeTrafficTotals(baseTotals, managedDelta);

    return {
        ...buildWindowValue(mergedTotals, true),
        liveDeltaUp: Number(clusterDelta.upBytes || 0),
        liveDeltaDown: Number(clusterDelta.downBytes || 0),
    };
}

function readDashboardTrafficWindowOverviews(trafficStatsStoreRef, requests = [], deps = {}) {
    if (typeof trafficStatsStoreRef?.getOverviewBatch === 'function') {
        return trafficStatsStoreRef.getOverviewBatch(requests, {
            users: deps.users,
        });
    }
    return Object.fromEntries(
        (Array.isArray(requests) ? requests : []).map((request) => [
            request.key,
            trafficStatsStoreRef.getOverview(request),
        ])
    );
}

function buildDashboardTrafficWindowTotals(deps = {}) {
    const trafficStatsStoreRef = deps.trafficStatsStore || trafficStatsStore;
    const users = Array.isArray(deps.users)
        ? deps.users
        : ((deps.userStore || userStore).getAll?.() || []);
    const dayRange = buildCalendarTrafficWindowRange('today', deps.now);
    const weekRange = buildCalendarTrafficWindowRange('this_week', deps.now);
    const monthRange = buildCalendarTrafficWindowRange('this_month', deps.now);
    const overviews = readDashboardTrafficWindowOverviews(trafficStatsStoreRef, [
        {
            key: 'day',
            from: dayRange?.from,
            to: dayRange?.to,
        },
        {
            key: 'week',
            from: weekRange?.from,
            to: weekRange?.to,
        },
        {
            key: 'month',
            from: monthRange?.from,
            to: monthRange?.to,
        },
    ], { users });
    const liveServerPayloads = buildLiveServerPayloads(deps.panelSnapshots || []);
    const currentServerTotals = liveServerPayloads.length > 0
        ? summarizeServerTrafficTotals(liveServerPayloads)
        : [];
    const liveOverlayContext = {
        serverCount: liveServerPayloads.length,
        registeredTotals: liveServerPayloads.length > 0
            ? summarizeRegisteredTrafficTotals(users, liveServerPayloads)
            : { upBytes: 0, downBytes: 0, totalBytes: 0 },
        clusterTotals: sumTrafficTotals(currentServerTotals),
    };

    return {
        day: buildDashboardTrafficWindowTotal({
            from: dayRange?.from,
            to: dayRange?.to,
            overview: overviews.day,
        }, {
            ...deps,
            liveOverlayContext,
        }),
        week: buildDashboardTrafficWindowTotal({
            from: weekRange?.from,
            to: weekRange?.to,
            overview: overviews.week,
        }, {
            ...deps,
            liveOverlayContext,
        }),
        month: buildDashboardTrafficWindowTotal({
            from: monthRange?.from,
            to: monthRange?.to,
            overview: overviews.month,
        }, {
            ...deps,
            liveOverlayContext,
        }),
    };
}

async function getServerCpuHistory(serverId, options = {}, deps = {}) {
    const ensureAuthenticatedRef = deps.ensureAuthenticated || ensureAuthenticated;
    const normalizedServerId = String(serverId || '').trim();
    const force = options.force === true;
    const record = cpuHistoryCache.get(normalizedServerId) || {
        value: null,
        checkedAtMs: 0,
        promise: null,
    };
    const ageMs = Date.now() - Number(record.checkedAtMs || 0);

    if (!force && record.value && ageMs >= 0 && ageMs <= CPU_HISTORY_TTL_MS) {
        return record.value;
    }
    if (!force && record.promise) {
        return record.promise;
    }

    const request = ensureAuthenticatedRef(normalizedServerId)
        .then((client) => client.get('/panel/api/server/cpuHistory/30'))
        .then((res) => {
            const value = Array.isArray(res?.data?.obj)
                ? res.data.obj.map((point, index) => ({
                    time: index,
                    cpu: typeof point === 'number' ? point : Number(point?.cpu || 0),
                }))
                : [];
            record.value = value;
            record.checkedAtMs = Date.now();
            cpuHistoryCache.set(normalizedServerId, record);
            return value;
        })
        .catch(() => [])
        .finally(() => {
            if (record.promise === request) {
                record.promise = null;
            }
        });

    record.promise = request;
    cpuHistoryCache.set(normalizedServerId, record);
    return request;
}

async function buildGlobalDashboardSnapshot(options = {}, deps = {}) {
    const serverStoreRef = deps.serverStore || serverStore;
    const userStoreRef = deps.userStore || userStore;
    const trafficStatsStoreRef = deps.trafficStatsStore || trafficStatsStore;
    const collectClusterStatusSnapshotRef = deps.collectClusterStatusSnapshot || collectClusterStatusSnapshot;
    const getServerPanelSnapshotsRef = deps.getServerPanelSnapshots || getServerPanelSnapshots;
    const force = options.force === true;
    const servers = serverStoreRef.getAll();
    const users = userStoreRef.getAll();

    const [_trafficCollection, clusterSnapshot, panelSnapshots] = await Promise.all([
        Promise.resolve()
            .then(() => trafficStatsStoreRef.collectIfStale(force))
            .catch(() => null),
        collectClusterStatusSnapshotRef({
            servers,
            includeDetails: false,
            force,
            maxAgeMs: force ? 0 : 20_000,
        }),
        getServerPanelSnapshotsRef({
            servers,
            includeOnlines: true,
            force,
        }),
    ]);

    const activeSinceTs = Date.now() - 3 * 60 * 1000;
    const enabledManagedEmailsGlobal = new Set(
        (Array.isArray(users) ? users : [])
            .filter((user) => user?.role !== 'admin' && user?.enabled !== false)
            .flatMap((user) => [normalizeEmail(user?.subscriptionEmail), normalizeEmail(user?.email)])
            .filter(Boolean)
    );
    const activeTrafficKeys = new Set();
    Object.values(trafficStatsStoreRef.counters || {}).forEach(counter => {
        const email = normalizeEmail(counter?.email);
        if (email && counter.serverId && enabledManagedEmailsGlobal.has(email)) {
            if (new Date(counter.lastSeenAt).getTime() >= activeSinceTs) {
                activeTrafficKeys.add(`${counter.serverId}:${email}`);
            }
        }
    });

    const panelByServerId = Object.fromEntries(panelSnapshots.map((item) => [String(item?.server?.id || '').trim(), item]));
    const presence = buildManagedOnlineSummary(
        users,
        panelSnapshots.map((item) => ({
            serverId: item?.server?.id || '',
            serverName: item?.server?.name || '',
            inbounds: Array.isArray(item?.inbounds) ? item.inbounds : [],
            onlines: Array.isArray(item?.onlines) ? item.onlines : [],
        })),
        activeTrafficKeys
    );

    const clusterByServerId = clusterSnapshot?.byServerId && typeof clusterSnapshot.byServerId === 'object'
        ? clusterSnapshot.byServerId
        : {};

    let childNodeCount = 0;
    let onlineChildNodeCount = 0;

    const serverStatuses = servers.reduce((acc, server) => {
        const serverId = String(server?.id || '').trim();
        const clusterItem = clusterByServerId[serverId] || {};
        const panelItem = panelByServerId[serverId] || {};
        const rawInbounds = Array.isArray(panelItem?.inbounds) ? panelItem.inbounds : [];
        const rawNodes = Array.isArray(panelItem?.nodes) ? panelItem.nodes : [];

        rawNodes.forEach(node => {
            childNodeCount++;
            if (node.status === 'online') {
                onlineChildNodeCount++;
            }
        });

        const rawOnlines = Array.isArray(panelItem?.onlines) ? panelItem.onlines : [];
        const serverUniqueOnlineUsers = new Set();
        rawOnlines.forEach((entry) => {
            const email = normalizeEmail(
                entry?.email || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry?.remark || entry
            );
            const rawIdentifier = email || String(entry?.email || entry?.id || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry || '').trim();
            if (rawIdentifier && rawIdentifier !== '[object Object]') {
                serverUniqueOnlineUsers.add(rawIdentifier);
            }
        });
        const serverOnlineCount = serverUniqueOnlineUsers.size;
        const serverOnlineSessionCount = rawOnlines.length;

        acc[serverId] = withServerRemarkMeta({
            serverId,
            name: String(server?.name || clusterItem?.name || '').trim(),
            online: clusterItem?.online === true,
            error: String(clusterItem?.error || clusterItem?.reasonMessage || '').trim(),
            inboundCount: Number(clusterItem?.inboundCount || rawInbounds.length || 0),
            activeInbounds: Number(clusterItem?.activeInbounds || rawInbounds.filter((item) => item?.enable !== false).length || 0),
            managedOnlineCount: Number(presence.serverOnlineUserCountByServerId?.[serverId] || 0),
            onlineCount: serverOnlineCount,
            onlineSessionCount: serverOnlineSessionCount,
            managedTrafficTotal: Number(presence.serverTrafficByServerId?.[serverId]?.total || 0),
            managedTrafficReady: !panelItem?.inboundsError,
            status: clusterItem?.status && typeof clusterItem.status === 'object' ? clusterItem.status : null,
            rawInbounds,
            rawOnlines,
        }, server?.name);
        return acc;
    }, {});
    const derivedInboundTotals = Object.values(serverStatuses).reduce((acc, item) => {
        acc.total += Number(item?.inboundCount || 0);
        acc.active += Number(item?.activeInbounds || 0);
        return acc;
    }, { total: 0, active: 0 });

    return {
        serverStatuses,
        globalStats: {
            totalUp: Number(presence.totalUp || 0),
            totalDown: Number(presence.totalDown || 0),
            totalOnline: presence.rawTotalOnlineUsersCount,
            totalInbounds: derivedInboundTotals.total,
            activeInbounds: derivedInboundTotals.active,
            serverCount: Number(clusterSnapshot?.summary?.total || servers.length || 0) + childNodeCount,
            onlineServers: Number(clusterSnapshot?.summary?.onlineServers || 0) + onlineChildNodeCount,
        },
        globalManagedOnlineCount: presence.onlineRows.length,
        globalOnlineUsers: presence.onlineRows,
        globalOnlineSessionCount: presence.rawTotalSessions,
        globalAccountSummary: {
            totalUsers: presence.rows.length,
            pendingUsers: Number(presence.pendingCount || 0),
        },
        throughputSummary: clusterSnapshot?.summary?.throughput || {
            ready: false,
            readyServers: 0,
            upPerSecond: 0,
            downPerSecond: 0,
            totalPerSecond: 0,
        },
        trafficWindowTotals: buildDashboardTrafficWindowTotals({
            ...deps,
            trafficStatsStore: trafficStatsStoreRef,
            users,
            panelSnapshots,
        }),
        globalPresenceReady: true,
        fetchedAt: new Date().toISOString(),
    };
}

async function buildSingleDashboardSnapshot(serverId, options = {}, deps = {}) {
    const serverStoreRef = deps.serverStore || serverStore;
    const userStoreRef = deps.userStore || userStore;
    const systemSettingsStoreRef = deps.systemSettingsStore || systemSettingsStore;
    const trafficStatsStoreRef = deps.trafficStatsStore || trafficStatsStore;
    const collectClusterStatusSnapshotRef = deps.collectClusterStatusSnapshot || collectClusterStatusSnapshot;
    const getServerPanelSnapshotRef = deps.getServerPanelSnapshot || getServerPanelSnapshot;
    const normalizedServerId = String(serverId || '').trim();
    const server = serverStoreRef.getById(normalizedServerId);
    if (!server) {
        const error = new Error('Server not found');
        error.status = 404;
        throw error;
    }

    const force = options.force === true;
    const users = userStoreRef.getAll();

    const [clusterSnapshot, panelSnapshot, cpuHistory] = await Promise.all([
        collectClusterStatusSnapshotRef({
            servers: [server],
            includeDetails: false,
            force,
            maxAgeMs: force ? 0 : 20_000,
        }),
        getServerPanelSnapshotRef(server, {
            includeOnlines: true,
            force,
        }),
        getServerCpuHistory(normalizedServerId, { force }, deps),
    ]);

    const clusterItem = Array.isArray(clusterSnapshot?.items)
        ? clusterSnapshot.items.find((item) => String(item?.serverId || '').trim() === normalizedServerId) || null
        : null;
    const inbounds = systemSettingsStoreRef.sortInboundList(
        normalizedServerId,
        Array.isArray(panelSnapshot?.inbounds) ? panelSnapshot.inbounds : []
    );
    const rawOnlines = Array.isArray(panelSnapshot?.onlines) ? panelSnapshot.onlines : [];
    
    const activeSinceTs = Date.now() - 3 * 60 * 1000;
    const enabledManagedEmailsServer = new Set(
        (Array.isArray(users) ? users : [])
            .filter((user) => user?.role !== 'admin' && user?.enabled !== false)
            .flatMap((user) => [normalizeEmail(user?.subscriptionEmail), normalizeEmail(user?.email)])
            .filter(Boolean)
    );
    const activeTrafficKeys = new Set();
    Object.values(trafficStatsStoreRef.counters || {}).forEach(counter => {
        const email = normalizeEmail(counter?.email);
        if (email && String(counter.serverId) === normalizedServerId && enabledManagedEmailsServer.has(email)) {
            if (new Date(counter.lastSeenAt).getTime() >= activeSinceTs) {
                activeTrafficKeys.add(`${counter.serverId}:${email}`);
            }
        }
    });

    const presence = buildManagedOnlineSummary(users, [{
        serverId: normalizedServerId,
        serverName: server.name,
        inbounds,
        onlines: rawOnlines,
    }], activeTrafficKeys);

    return {
        status: clusterItem?.status && typeof clusterItem.status === 'object' ? clusterItem.status : null,
        cpuHistory,
        inbounds,
        onlineUsers: presence.onlineRows,
        onlineCount: presence.rawTotalOnlineUsersCount,
        onlineSessionCount: presence.rawTotalSessions,
        singleServerTrafficTotals: {
            totalUp: Number(presence.totalUp || 0),
            totalDown: Number(presence.totalDown || 0),
        },
        fetchedAt: new Date().toISOString(),
    };
}

export {
    buildDashboardTrafficWindowTotals,
    buildDashboardPresenceFromPanelSnapshots,
    buildGlobalDashboardSnapshot,
    buildSingleDashboardSnapshot,
};
