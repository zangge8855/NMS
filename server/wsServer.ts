/**
 * WebSocket Server — 实时推送集群节点状态
 *
 * 消息类型 (server → client):
 *   cluster_status  — 全局集群状态摘要
 *   server_status   — 单节点状态详情 (附 serverId)
 *   error           — 错误信息
 *
 * 鉴权:
 *   - 通过 /api/ws/ticket 获取短时 ticket
 *   - 连接时使用 /ws?ticket=...
 *
 * 消息类型 (client → server):
 *   subscribe       — 订阅特定服务器 { serverId }
 *   ping            — 心跳保活
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'http';
import { URL } from 'url';
import config from './config.js';
import { verifyWsTicket } from './lib/wsTicket.js';
import taskQueue from './lib/taskQueue.js';
import notificationService from './lib/notifications.js';
import { collectClusterStatusSnapshot, getCachedClusterStatusSnapshot } from './lib/serverStatusService.js';
import { getCachedServerPanelSnapshots } from './lib/serverPanelSnapshotService.js';
import {
    buildDashboardPresenceFromPanelSnapshots,
    buildDashboardTrafficWindowTotals,
} from './lib/dashboardSnapshotService.js';
import { normalizeEmail } from './lib/normalize.js';
import trafficStatsStore from './store/trafficStatsStore.js';
import userStore from './store/userStore.js';

interface CustomWebSocket extends WebSocket {
    isAlive?: boolean;
    subscribedServerId?: string | null;
    subscribedTaskIds?: Set<string>;
    user?: any;
    dashboardFollowupTimer?: NodeJS.Timeout | null;
}

const BROADCAST_INTERVAL = Math.max(5_000, Number(config.performance?.wsBroadcastIntervalMs || 10_000));
const HEARTBEAT_INTERVAL = 30_000;   // 30 秒心跳检测
const MAX_TASK_SUBSCRIPTIONS = 100;  // 单连接最大任务订阅数
const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
const DASHBOARD_FOLLOWUP_DELAY_MS = 1_200;
const FRESH_CONNECTION_SNAPSHOT_MAX_AGE_MS = 1_000;
const STAFF_WS_ROLES = new Set(['admin', 'operator', 'auditor']);
const activeWssInstances = new Set<WebSocketServer>();

function normalizeTokenVersion(value: unknown): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function validateWsUserSession(ticketUser: any): { valid: boolean; code?: number; reason?: string; stored?: any } {
    const userId = String(ticketUser?.userId || '').trim();
    const username = String(ticketUser?.username || '').trim();
    const stored = userId ? userStore.getById(userId) : (username ? userStore.getByUsername(username) : null);
    if (!stored) {
        return { valid: false, code: 401, reason: 'User session not found' };
    }
    if (stored.enabled === false) {
        return { valid: false, code: 403, reason: 'Account disabled' };
    }
    const storedRole = String(stored.role || 'user').toLowerCase();
    if (!STAFF_WS_ROLES.has(storedRole)) {
        return { valid: false, code: 403, reason: 'Staff role required' };
    }
    if (ticketUser?.role && String(ticketUser.role).toLowerCase() !== storedRole) {
        return { valid: false, code: 401, reason: 'Role mismatch' };
    }
    if (normalizeTokenVersion(ticketUser?.tokenVersion) !== normalizeTokenVersion(stored.tokenVersion)) {
        return { valid: false, code: 401, reason: 'Session revoked' };
    }
    return { valid: true, stored };
}

export async function closeWebSocketServer(): Promise<void> {
    const instances = Array.from(activeWssInstances);
    activeWssInstances.clear();
    await Promise.all(instances.map((wss) => new Promise<void>((resolve) => {
        for (const client of wss.clients as Set<CustomWebSocket>) {
            if (client.dashboardFollowupTimer) {
                clearTimeout(client.dashboardFollowupTimer);
                client.dashboardFollowupTimer = null;
            }
            try {
                client.terminate();
            } catch {
                // ignore
            }
        }
        try {
            wss.close(() => resolve());
        } catch {
            resolve();
        }
    })));
}

function buildDashboardAccountSummary() {
    const rows = userStore.getAll().filter((item: any) => (item?.role || 'user') === 'user');
    return {
        totalUsers: rows.length,
        pendingUsers: rows.filter((item: any) => item?.enabled === false).length,
    };
}

function buildDashboardPresenceSummary(panelSnapshots: any[] = []) {
    const users = userStore.getAll();
    const snapshots = Array.isArray(panelSnapshots) ? panelSnapshots : [];
    if (snapshots.length === 0) {
        return {
            onlineRows: [],
            onlineSessionCount: 0,
            serverOnlineUserCountByServerId: {} as Record<string, number>,
            serverTrafficByServerId: {} as Record<string, any>,
            rawTotalOnlineUsersCount: 0,
            rawTotalSessions: 0,
            ready: false,
        };
    }
    const activeTrafficKeys = new Set<string>();
    try {
        const activeSinceTs = Date.now() - 3 * 60 * 1000;
        const enabledManagedEmails = new Set(
            users
                .filter((user: any) => (user?.role || 'user') === 'user' && user?.enabled !== false)
                .flatMap((user: any) => [normalizeEmail(user?.subscriptionEmail), normalizeEmail(user?.email)])
                .filter(Boolean)
        );
        Object.values(trafficStatsStore.counters || {}).forEach((counter: any) => {
            const email = normalizeEmail(counter?.email);
            if (email && counter.serverId && enabledManagedEmails.has(email)) {
                if (new Date(counter.lastSeenAt).getTime() >= activeSinceTs) {
                    const inboundId = typeof counter.inboundId === 'string' ? counter.inboundId : '';
                    activeTrafficKeys.add(`${counter.serverId}:${inboundId}:${email}`);
                }
            }
        });
    } catch {
        // Best-effort
    }
    const presence = buildDashboardPresenceFromPanelSnapshots(users, snapshots, activeTrafficKeys);
    return {
        onlineRows: presence.onlineRows,
        onlineSessionCount: Number(presence.onlineSessionCount || 0),
        serverOnlineUserCountByServerId: presence.serverOnlineUserCountByServerId || {},
        serverTrafficByServerId: presence.serverTrafficByServerId || {},
        rawTotalOnlineUsersCount: Number(presence.rawTotalOnlineUsersCount || 0),
        rawTotalSessions: Number(presence.rawTotalSessions || 0),
        ready: true,
    };
}

async function buildDashboardTrafficWindows(panelSnapshots: any[] = []) {
    try {
        await trafficStatsStore.collectIfStale(false);
    } catch {
        // Fall back to latest snapshot
    }
    const windows = buildDashboardTrafficWindowTotals({
        trafficStatsStore,
        users: userStore.getAll(),
        panelSnapshots,
    });
    const collectionStatus = trafficStatsStore.getCollectionStatus();
    const toPayload = (window: any = {}) => ({
        totals: {
            upBytes: Number(window?.totalUp || 0),
            downBytes: Number(window?.totalDown || 0),
            totalBytes: Number(window?.totalUp || 0) + Number(window?.totalDown || 0),
        },
        managedTotals: {
            upBytes: Number(window?.totalUp || 0),
            downBytes: Number(window?.totalDown || 0),
            totalBytes: Number(window?.totalUp || 0) + Number(window?.totalDown || 0),
        },
        unattributedTotals: {
            upBytes: Number(window?.unattributedUp || 0),
            downBytes: Number(window?.unattributedDown || 0),
            totalBytes: Number(window?.unattributedTotal || 0),
        },
        activeUsers: 0,
        lastCollectionAt: collectionStatus?.lastCollectionAt || '',
        ready: window?.ready === true,
        attributionComplete: window?.attributionComplete !== false,
        userLevelSupported: window?.attributionComplete !== false,
    });

    return {
        day: toPayload(windows.day),
        week: toPayload(windows.week),
        month: toPayload(windows.month),
    };
}

function readDashboardPanelSnapshots(): any[] {
    return getCachedServerPanelSnapshots({
        includeOnlines: true,
    });
}

function mergeDashboardPanelSnapshots(primarySnapshots: any[] = [], fallbackSnapshots: any[] = []): any[] {
    const merged = new Map<string, any>();
    const pushSnapshot = (snapshot: any) => {
        const serverId = String(snapshot?.server?.id || snapshot?.serverId || '').trim();
        if (!serverId || !snapshot || typeof snapshot !== 'object') return;
        merged.set(serverId, snapshot);
    };

    (Array.isArray(fallbackSnapshots) ? fallbackSnapshots : []).forEach(pushSnapshot);
    (Array.isArray(primarySnapshots) ? primarySnapshots : []).forEach(pushSnapshot);
    return Array.from(merged.values());
}

function resolveDashboardPanelSnapshots(snapshot: any): any[] {
    const liveSnapshots = Array.isArray(snapshot?.panelSnapshots) ? snapshot.panelSnapshots : [];
    if (liveSnapshots.length === 0) {
        return readDashboardPanelSnapshots();
    }
    return mergeDashboardPanelSnapshots(liveSnapshots, readDashboardPanelSnapshots());
}

async function buildClusterStatusMessage(snapshot: any) {
    const panelSnapshots = resolveDashboardPanelSnapshots(snapshot);
    const presence = buildDashboardPresenceSummary(panelSnapshots);
    const trafficWindows = await buildDashboardTrafficWindows(panelSnapshots);
    const panelSnapshotByServerId = new Map<string, any>(
        panelSnapshots
            .map((item: any) => [String(item?.server?.id || item?.serverId || '').trim(), item] as [string, any])
            .filter(([serverId]) => Boolean(serverId))
    );
    const servers = Object.fromEntries(
        Object.entries(snapshot?.byServerId || {}).map(([serverId, serverData]: [string, any]) => {
            const normalizedServerId = String(serverData?.serverId || serverId || '').trim();
            const panelSnapshot = panelSnapshotByServerId.get(normalizedServerId);
            return [serverId, {
                ...serverData,
                managedOnlineCount: Number(presence.serverOnlineUserCountByServerId?.[normalizedServerId] || 0),
                managedTrafficTotal: Number(presence.serverTrafficByServerId?.[normalizedServerId]?.total || 0),
                managedTrafficReady: Boolean(panelSnapshot && !panelSnapshot?.inboundsError),
            }];
        })
    );
    return {
        type: 'cluster_status',
        ts: Date.now(),
        data: {
            serverCount: snapshot?.summary?.total || 0,
            onlineServers: snapshot?.summary?.onlineServers || 0,
            totalOnline: presence.onlineRows.length,
            totalOnlineSessionCount: presence.onlineSessionCount,
            rawTotalOnline: presence.rawTotalOnlineUsersCount,
            rawTotalOnlineSessionCount: presence.rawTotalSessions,
            totalUp: snapshot?.summary?.totalUp || 0,
            totalDown: snapshot?.summary?.totalDown || 0,
            totalInbounds: snapshot?.summary?.totalInbounds || 0,
            activeInbounds: snapshot?.summary?.activeInbounds || 0,
            byReason: snapshot?.summary?.byReason || snapshot?.summary?.reasonCounts || {},
            reasonCounts: snapshot?.summary?.reasonCounts || {},
            servers,
            throughputSummary: snapshot?.summary?.throughput || {
                ready: false,
                readyServers: 0,
                upPerSecond: 0,
                downPerSecond: 0,
                totalPerSecond: 0,
            },
            accountSummary: buildDashboardAccountSummary(),
            trafficWindows,
            managedOnlineUsers: presence.onlineRows,
            managedOnlineUserCount: presence.onlineRows.length,
            managedOnlineSessionCount: presence.onlineSessionCount,
            managedPresenceReady: presence.ready,
        },
    };
}

function dashboardMessageNeedsFollowup(message: any): boolean {
    const data = message?.data || {};
    const trafficWindows = data?.trafficWindows && typeof data.trafficWindows === 'object'
        ? Object.values(data.trafficWindows)
        : [];
    return data?.managedPresenceReady !== true
        || data?.throughputSummary?.ready !== true
        || trafficWindows.some((window: any) => window?.ready !== true);
}

function maybeScheduleDashboardFollowup(ws: CustomWebSocket) {
    if (ws.dashboardFollowupTimer) return;
    const timer = setTimeout(async () => {
        ws.dashboardFollowupTimer = null;
        if (ws.readyState !== 1) return;
        try {
            const snapshot = await collectClusterStatusSnapshot({
                includeDetails: true,
                force: true,
            });
            if (!Array.isArray(snapshot?.items)) {
                return;
            }
            safeSend(ws, await buildClusterStatusMessage(snapshot));
        } catch (err: any) {
            console.error('[WebSocket] Follow-up snapshot error:', err?.message || err);
        }
    }, DASHBOARD_FOLLOWUP_DELAY_MS);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    ws.dashboardFollowupTimer = timer;
}

/**
 * 初始化 WebSocket 服务器
 */
export function initWebSocket(httpServer: HttpServer) {
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        maxPayload: WS_MAX_PAYLOAD_BYTES,
        verifyClient: ({ req }: { req: IncomingMessage & { wsUser?: any } }, done: (res: boolean, code?: number, message?: string) => void) => {
            try {
                const url = new URL(req.url || '', 'http://nms.local');
                const ticket = url.searchParams.get('ticket');
                if (!ticket) {
                    done(false, 401, 'Missing ticket');
                    return;
                }
                const decoded = verifyWsTicket(ticket);
                const validation = validateWsUserSession(decoded);
                if (!validation.valid || !validation.stored) {
                    done(false, validation.code || 401, validation.reason || 'Unauthorized');
                    return;
                }
                req.wsUser = {
                    ...decoded,
                    userId: validation.stored.id,
                    username: validation.stored.username,
                    role: validation.stored.role,
                    tokenVersion: normalizeTokenVersion(validation.stored.tokenVersion),
                };
                done(true);
            } catch {
                done(false, 401, 'Invalid ticket');
            }
        },
    });
    activeWssInstances.add(wss);

    // ── Heartbeat ──────────────────────────────────
    const heartbeatInterval = setInterval(() => {
        for (const ws of wss.clients as Set<CustomWebSocket>) {
            const validation = validateWsUserSession(ws.user);
            if (!validation.valid) {
                try {
                    ws.close(4401, validation.reason || 'Session invalidated');
                } catch {
                    ws.terminate();
                }
                continue;
            }
            if (ws.isAlive === false) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, HEARTBEAT_INTERVAL);
    if (typeof heartbeatInterval?.unref === 'function') {
        heartbeatInterval.unref();
    }

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
        activeWssInstances.delete(wss);
    });

    wss.on('connection', async (ws: CustomWebSocket, req: IncomingMessage & { wsUser?: any }) => {
        ws.isAlive = true;
        ws.subscribedServerId = null;
        ws.subscribedTaskIds = new Set();
        ws.user = req?.wsUser || null;
        ws.dashboardFollowupTimer = null;

        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('close', () => {
            if (ws.dashboardFollowupTimer) {
                clearTimeout(ws.dashboardFollowupTimer);
                ws.dashboardFollowupTimer = null;
            }
        });

        ws.on('message', (raw: string | Buffer) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'subscribe' && msg.serverId) {
                    ws.subscribedServerId = msg.serverId;
                } else if (msg.type === 'ping') {
                    ws.isAlive = true;
                    safeSend(ws, { type: 'pong', ts: Date.now() });
                } else if (msg.type === 'subscribe_task' && msg.taskId) {
                    if (ws.subscribedTaskIds && ws.subscribedTaskIds.size < MAX_TASK_SUBSCRIPTIONS) {
                        ws.subscribedTaskIds.add(String(msg.taskId));
                    }
                    const task = taskQueue.get(msg.taskId);
                    if (task) {
                        safeSend(ws, { type: 'NMS_TASK_PROGRESS', ts: Date.now(), data: task });
                    }
                } else if (msg.type === 'unsubscribe_task' && msg.taskId) {
                    ws.subscribedTaskIds?.delete(String(msg.taskId));
                }
            } catch {
                // ignore malformed messages
            }
        });

        ws.on('error', () => { });

        const unread = notificationService.unreadCount();
        if (unread > 0) {
            safeSend(ws, { type: 'NMS_NOTIFICATION_COUNT', ts: Date.now(), data: { unreadCount: unread } });
        }

        const cachedSnapshot = getCachedClusterStatusSnapshot();
        if (Array.isArray(cachedSnapshot?.items)) {
            const message = await buildClusterStatusMessage(cachedSnapshot);
            safeSend(ws, message);
            if (dashboardMessageNeedsFollowup(message)) {
                maybeScheduleDashboardFollowup(ws);
            }
        }

        collectClusterStatusSnapshot({
            includeDetails: true,
            maxAgeMs: FRESH_CONNECTION_SNAPSHOT_MAX_AGE_MS,
        }).then(async (snapshot) => {
            if (!Array.isArray(snapshot?.items)) {
                return;
            }
            const message = await buildClusterStatusMessage(snapshot);
            safeSend(ws, message);
            if (dashboardMessageNeedsFollowup(message)) {
                maybeScheduleDashboardFollowup(ws);
            }
        }).catch((err) => {
            console.error('[WebSocket] Initial snapshot error:', err.message);
        });
    });

    // ── Broadcast Loop ─────────────────────────────
    let broadcasting = false;

    const broadcastLoop = setInterval(async () => {
        if (broadcasting) return;
        if (wss.clients.size === 0) return;

        broadcasting = true;
        try {
            const snapshot = await collectClusterStatusSnapshot({
                includeDetails: true,
                maxAgeMs: BROADCAST_INTERVAL,
            });
            if (!Array.isArray(snapshot?.items)) {
                return;
            }

            const clusterPayload = JSON.stringify(await buildClusterStatusMessage(snapshot));

            for (const ws of wss.clients as Set<CustomWebSocket>) {
                if (ws.readyState !== 1) continue;
                safeSendRaw(ws, clusterPayload);

                if (ws.subscribedServerId && snapshot.byServerId?.[ws.subscribedServerId]) {
                    safeSend(ws, {
                        type: 'server_status',
                        ts: Date.now(),
                        serverId: ws.subscribedServerId,
                        data: snapshot.byServerId[ws.subscribedServerId],
                    });
                }
            }
        } catch (err: any) {
            console.error('[WebSocket] Broadcast error:', err.message);
        } finally {
            broadcasting = false;
        }
    }, BROADCAST_INTERVAL);
    if (typeof broadcastLoop?.unref === 'function') {
        broadcastLoop.unref();
    }

    // ── Task Progress Broadcast ─────────────────────────
    const onTaskProgress = (task: any) => {
        const payload = JSON.stringify({
            type: 'NMS_TASK_PROGRESS',
            ts: Date.now(),
            data: task,
        });
        for (const ws of wss.clients as Set<CustomWebSocket>) {
            if (ws.readyState !== 1) continue;
            if (ws.subscribedTaskIds?.has(task.id)) {
                safeSendRaw(ws, payload);
            }
        }
    };
    taskQueue.on('progress', onTaskProgress);

    // ── Notification Broadcast ──────────────────────────
    const onNotification = (notification: any) => {
        const payload = JSON.stringify({
            type: 'NMS_NOTIFICATION',
            ts: Date.now(),
            data: {
                notification,
                unreadCount: notificationService.unreadCount(),
            },
        });
        for (const ws of wss.clients as Set<CustomWebSocket>) {
            if (ws.readyState !== 1) continue;
            const role = ws.user?.role;
            if (role !== 'admin' && role !== 'operator' && role !== 'auditor') continue;
            safeSendRaw(ws, payload);
        }
    };
    notificationService.on('notification', onNotification);

    wss.on('close', () => {
        clearInterval(broadcastLoop);
        taskQueue.off('progress', onTaskProgress);
        notificationService.off('notification', onNotification);
    });

    console.log('  🔌 WebSocket server initialized on /ws');
    return wss;
}

function safeSendRaw(ws: WebSocket, payload: string) {
    try {
        if (ws.readyState === 1) {
            ws.send(payload);
        }
    } catch {
        // ignore
    }
}

function safeSend(ws: WebSocket, data: any) {
    try {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify(data));
        }
    } catch {
        // ignore
    }
}
