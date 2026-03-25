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

import { WebSocketServer } from 'ws';
import { URL } from 'url';
import { verifyWsTicket } from './lib/wsTicket.js';
import taskQueue from './lib/taskQueue.js';
import notificationService from './lib/notifications.js';
import { collectClusterStatusSnapshot, getCachedClusterStatusSnapshot } from './lib/serverStatusService.js';
import { getCachedServerPanelSnapshots } from './lib/serverPanelSnapshotService.js';
import {
    buildDashboardPresenceFromPanelSnapshots,
    buildDashboardTrafficWindowTotals,
} from './lib/dashboardSnapshotService.js';
import trafficStatsStore from './store/trafficStatsStore.js';
import userStore from './store/userStore.js';

const BROADCAST_INTERVAL = 5_000;    // 5 秒采集/广播一次
const HEARTBEAT_INTERVAL = 30_000;   // 30 秒心跳检测
const MAX_TASK_SUBSCRIPTIONS = 100;  // 单连接最大任务订阅数
const DASHBOARD_FOLLOWUP_DELAY_MS = 1_200;
const FRESH_CONNECTION_SNAPSHOT_MAX_AGE_MS = 1_000;

function buildDashboardAccountSummary() {
    const rows = userStore.getAll().filter((item) => item?.role !== 'admin');
    return {
        totalUsers: rows.length,
        pendingUsers: rows.filter((item) => item?.enabled === false).length,
    };
}

function buildDashboardPresenceSummary(panelSnapshots = []) {
    const users = userStore.getAll();
    const snapshots = Array.isArray(panelSnapshots) ? panelSnapshots : [];
    if (snapshots.length === 0) {
        return {
            onlineRows: [],
            onlineSessionCount: 0,
            ready: false,
        };
    }
    const presence = buildDashboardPresenceFromPanelSnapshots(users, snapshots);
    return {
        onlineRows: presence.onlineRows,
        onlineSessionCount: Number(presence.onlineSessionCount || 0),
        ready: true,
    };
}

async function buildDashboardTrafficWindows(panelSnapshots = []) {
    try {
        await trafficStatsStore.collectIfStale(false);
    } catch {
        // Dashboard pushes can fall back to the latest persisted snapshot.
    }
    const windows = buildDashboardTrafficWindowTotals({
        trafficStatsStore,
        users: userStore.getAll(),
        panelSnapshots,
    });
    const collectionStatus = trafficStatsStore.getCollectionStatus();
    const toPayload = (window = {}) => ({
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

function readDashboardPanelSnapshots() {
    return getCachedServerPanelSnapshots({
        includeOnlines: true,
    });
}

function mergeDashboardPanelSnapshots(primarySnapshots = [], fallbackSnapshots = []) {
    const merged = new Map();
    const pushSnapshot = (snapshot) => {
        const serverId = String(snapshot?.server?.id || snapshot?.serverId || '').trim();
        if (!serverId || !snapshot || typeof snapshot !== 'object') return;
        merged.set(serverId, snapshot);
    };

    (Array.isArray(fallbackSnapshots) ? fallbackSnapshots : []).forEach(pushSnapshot);
    (Array.isArray(primarySnapshots) ? primarySnapshots : []).forEach(pushSnapshot);
    return Array.from(merged.values());
}

function resolveDashboardPanelSnapshots(snapshot) {
    const liveSnapshots = Array.isArray(snapshot?.panelSnapshots) ? snapshot.panelSnapshots : [];
    if (liveSnapshots.length === 0) {
        return readDashboardPanelSnapshots();
    }
    return mergeDashboardPanelSnapshots(liveSnapshots, readDashboardPanelSnapshots());
}

async function buildClusterStatusMessage(snapshot) {
    const panelSnapshots = resolveDashboardPanelSnapshots(snapshot);
    const presence = buildDashboardPresenceSummary(panelSnapshots);
    const trafficWindows = await buildDashboardTrafficWindows(panelSnapshots);
    return {
        type: 'cluster_status',
        ts: Date.now(),
        data: {
            serverCount: snapshot?.summary?.total || 0,
            onlineServers: snapshot?.summary?.onlineServers || 0,
            totalOnline: snapshot?.summary?.totalOnline || 0,
            totalUp: snapshot?.summary?.totalUp || 0,
            totalDown: snapshot?.summary?.totalDown || 0,
            totalInbounds: snapshot?.summary?.totalInbounds || 0,
            activeInbounds: snapshot?.summary?.activeInbounds || 0,
            byReason: snapshot?.summary?.byReason || snapshot?.summary?.reasonCounts || {},
            reasonCounts: snapshot?.summary?.reasonCounts || {},
            servers: snapshot?.byServerId || {},
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

function dashboardMessageNeedsFollowup(message) {
    const data = message?.data || {};
    const trafficWindows = data?.trafficWindows && typeof data.trafficWindows === 'object'
        ? Object.values(data.trafficWindows)
        : [];
    return data?.managedPresenceReady !== true
        || data?.throughputSummary?.ready !== true
        || trafficWindows.some((window) => window?.ready !== true);
}

function maybeScheduleDashboardFollowup(ws) {
    if (ws.dashboardFollowupTimer) return;
    const timer = setTimeout(async () => {
        ws.dashboardFollowupTimer = null;
        if (ws.readyState !== 1) return;
        try {
            const snapshot = await collectClusterStatusSnapshot({
                includeDetails: true,
                force: true,
            });
            if (!Array.isArray(snapshot?.items) || snapshot.items.length === 0) {
                return;
            }
            safeSend(ws, await buildClusterStatusMessage(snapshot));
        } catch (err) {
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
 * @param {import('http').Server} httpServer
 */
export function initWebSocket(httpServer) {
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        verifyClient: ({ req }, done) => {
            try {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const ticket = url.searchParams.get('ticket');
                if (!ticket) {
                    done(false, 401, 'Missing ticket');
                    return;
                }
                req.wsUser = verifyWsTicket(ticket);
                done(true);
            } catch {
                done(false, 401, 'Invalid ticket');
            }
        },
    });

    // ── Heartbeat ──────────────────────────────────
    const heartbeatInterval = setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, HEARTBEAT_INTERVAL);

    wss.on('close', () => clearInterval(heartbeatInterval));

    wss.on('connection', async (ws, req) => {
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

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'subscribe' && msg.serverId) {
                    ws.subscribedServerId = msg.serverId;
                } else if (msg.type === 'ping') {
                    ws.isAlive = true;
                    safeSend(ws, { type: 'pong', ts: Date.now() });
                } else if (msg.type === 'subscribe_task' && msg.taskId) {
                    if (ws.subscribedTaskIds.size < MAX_TASK_SUBSCRIPTIONS) {
                        ws.subscribedTaskIds.add(String(msg.taskId));
                    }
                    // 立即推送当前任务状态
                    const task = taskQueue.get(msg.taskId);
                    if (task) {
                        safeSend(ws, { type: 'NMS_TASK_PROGRESS', ts: Date.now(), data: task });
                    }
                } else if (msg.type === 'unsubscribe_task' && msg.taskId) {
                    ws.subscribedTaskIds.delete(String(msg.taskId));
                }
            } catch {
                // ignore malformed messages
            }
        });

        ws.on('error', () => { });

        // 连接时推送未读通知数量
        const unread = notificationService.unreadCount();
        if (unread > 0) {
            safeSend(ws, { type: 'NMS_NOTIFICATION_COUNT', ts: Date.now(), data: { unreadCount: unread } });
        }

        // Push the latest cached snapshot first so the dashboard can render
        // immediately, then follow it with a fresh snapshot if needed.
        const cachedSnapshot = getCachedClusterStatusSnapshot();
        if (Array.isArray(cachedSnapshot?.items) && cachedSnapshot.items.length > 0) {
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
            if (!Array.isArray(snapshot?.items) || snapshot.items.length === 0) {
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
                maxAgeMs: Math.max(0, BROADCAST_INTERVAL - 1_000),
            });
            if (!Array.isArray(snapshot?.items) || snapshot.items.length === 0) {
                return;
            }

            const clusterPayload = JSON.stringify(await buildClusterStatusMessage(snapshot));

            // Broadcast to all connected clients
            for (const ws of wss.clients) {
                if (ws.readyState !== 1) continue; // OPEN = 1
                ws.send(clusterPayload);

                // If subscribed to a specific server, send detailed status
                if (ws.subscribedServerId && snapshot.byServerId?.[ws.subscribedServerId]) {
                    safeSend(ws, {
                        type: 'server_status',
                        ts: Date.now(),
                        serverId: ws.subscribedServerId,
                        data: snapshot.byServerId[ws.subscribedServerId],
                    });
                }
            }
        } catch (err) {
            console.error('[WebSocket] Broadcast error:', err.message);
        } finally {
            broadcasting = false;
        }
    }, BROADCAST_INTERVAL);

    wss.on('close', () => clearInterval(broadcastLoop));

    // ── Task Progress Broadcast ─────────────────────────
    taskQueue.on('progress', (task) => {
        const payload = JSON.stringify({
            type: 'NMS_TASK_PROGRESS',
            ts: Date.now(),
            data: task,
        });
        for (const ws of wss.clients) {
            if (ws.readyState !== 1) continue;
            if (ws.subscribedTaskIds?.has(task.id)) {
                ws.send(payload);
            }
        }
    });

    // ── Notification Broadcast ──────────────────────────
    notificationService.on('notification', (notification) => {
        const payload = JSON.stringify({
            type: 'NMS_NOTIFICATION',
            ts: Date.now(),
            data: {
                notification,
                unreadCount: notificationService.unreadCount(),
            },
        });
        for (const ws of wss.clients) {
            if (ws.readyState !== 1) continue;
            ws.send(payload);
        }
    });

    console.log('  🔌 WebSocket server initialized on /ws');
    return wss;
}

function safeSend(ws, data) {
    try {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify(data));
        }
    } catch {
        // ignore
    }
}
