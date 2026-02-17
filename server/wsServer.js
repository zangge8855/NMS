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
import serverStore from './store/serverStore.js';
import { ensureAuthenticated } from './lib/panelClient.js';
import { verifyWsTicket } from './lib/wsTicket.js';

const BROADCAST_INTERVAL = 10_000;   // 10 秒采集/广播一次
const HEARTBEAT_INTERVAL = 30_000;   // 30 秒心跳检测
const COLLECTOR_CONCURRENCY = 5;

/** 并发控制 */
async function runWithConcurrency(items, worker, concurrency = 3) {
    const results = [];
    let idx = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await worker(items[i], i);
        }
    });
    await Promise.all(runners);
    return results;
}

async function fetchServerStatus(client) {
    try {
        return await client.get('/panel/api/server/status');
    } catch {
        return client.post('/panel/api/server/status');
    }
}

/** 从单个节点采集状态 */
async function collectServerStatus(serverMeta) {
    try {
        const client = await ensureAuthenticated(serverMeta.id);
        const [statusRes, onlineRes, inboundsRes] = await Promise.all([
            fetchServerStatus(client),
            client.post('/panel/api/inbounds/onlines'),
            client.get('/panel/api/inbounds/list').catch(() => ({ data: { obj: [] } })),
        ]);

        const status = statusRes.data?.obj;
        const onlines = Array.isArray(onlineRes.data?.obj) ? onlineRes.data.obj : [];
        const inbounds = Array.isArray(inboundsRes?.data?.obj) ? inboundsRes.data.obj : [];

        // Normalize online entries
        const onlineUsers = [];
        for (const item of onlines) {
            if (typeof item === 'string' && item.trim()) {
                onlineUsers.push({ email: item.trim() });
            } else if (item && typeof item === 'object') {
                const email = String(item.email || item.user || item.username || item.clientEmail || '').trim();
                if (email) onlineUsers.push({ email });
            }
        }

        const inboundCount = inbounds.length;
        const activeInbounds = inbounds.filter((item) => Boolean(item?.enable)).length;
        const totalInboundUp = inbounds.reduce((sum, item) => sum + Number(item?.up || 0), 0);
        const totalInboundDown = inbounds.reduce((sum, item) => sum + Number(item?.down || 0), 0);

        return {
            online: true,
            status: {
                cpu: status?.cpu ?? 0,
                mem: status?.mem ?? { current: 0, total: 1 },
                uptime: status?.uptime ?? 0,
                xray: status?.xray ?? {},
                netTraffic: status?.netTraffic ?? {},
            },
            inboundCount,
            activeInbounds,
            up: totalInboundUp,
            down: totalInboundDown,
            onlineCount: onlineUsers.length,
            onlineUsers,
        };
    } catch (err) {
        return {
            online: false,
            error: err.message || 'Connection failed',
        };
    }
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

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.subscribedServerId = null;
        ws.user = req?.wsUser || null;

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'subscribe' && msg.serverId) {
                    ws.subscribedServerId = msg.serverId;
                } else if (msg.type === 'ping') {
                    ws.isAlive = true;
                    safeSend(ws, { type: 'pong', ts: Date.now() });
                }
            } catch {
                // ignore malformed messages
            }
        });

        ws.on('error', () => { });
    });

    // ── Broadcast Loop ─────────────────────────────
    let broadcasting = false;

    const broadcastLoop = setInterval(async () => {
        if (broadcasting) return;
        if (wss.clients.size === 0) return;

        broadcasting = true;
        try {
            const servers = serverStore.getAll();
            if (servers.length === 0) {
                broadcasting = false;
                return;
            }

            const serverResults = {};
            let totalOnline = 0;
            let onlineServers = 0;
            let totalUp = 0;
            let totalDown = 0;
            let totalInbounds = 0;
            let activeInbounds = 0;

            await runWithConcurrency(servers, async (server) => {
                const result = await collectServerStatus(server);
                serverResults[server.id] = { ...result, name: server.name };
                if (result.online) {
                    onlineServers++;
                    totalOnline += result.onlineCount;
                    totalInbounds += result.inboundCount ?? 0;
                    activeInbounds += result.activeInbounds ?? 0;
                    totalUp += result.up ?? result.status?.netTraffic?.sent ?? 0;
                    totalDown += result.down ?? result.status?.netTraffic?.recv ?? 0;
                }
            }, COLLECTOR_CONCURRENCY);

            const clusterPayload = JSON.stringify({
                type: 'cluster_status',
                ts: Date.now(),
                data: {
                    serverCount: servers.length,
                    onlineServers,
                    totalOnline,
                    totalUp,
                    totalDown,
                    totalInbounds,
                    activeInbounds,
                    servers: serverResults,
                },
            });

            // Broadcast to all connected clients
            for (const ws of wss.clients) {
                if (ws.readyState !== 1) continue; // OPEN = 1
                ws.send(clusterPayload);

                // If subscribed to a specific server, send detailed status
                if (ws.subscribedServerId && serverResults[ws.subscribedServerId]) {
                    safeSend(ws, {
                        type: 'server_status',
                        ts: Date.now(),
                        serverId: ws.subscribedServerId,
                        data: serverResults[ws.subscribedServerId],
                    });
                }
            }
        } catch (err) {
            console.error('[WebSocket] Broadcast error:', err.message);
        }
        broadcasting = false;
    }, BROADCAST_INTERVAL);

    wss.on('close', () => clearInterval(broadcastLoop));

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
