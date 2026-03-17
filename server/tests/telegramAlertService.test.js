import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectStatusDigestContext,
    createTelegramAlertService,
    formatCommandCatalogMessage,
    formatStatusDigestMessage,
} from '../lib/telegramAlertService.js';

test('telegramAlertService forwards critical notifications when configured', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true };
        },
    });

    const sent = await service.notifyNotification({
        type: 'server_health_connect_timeout',
        severity: 'critical',
        title: '节点连接超时',
        body: '节点 node-a 连接超时',
        createdAt: '2026-03-15T10:00:00.000Z',
        meta: {
            serverId: 'node-a',
            reasonCode: 'connect_timeout',
        },
    });

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/bot123456:ABCDEF\/sendMessage$/);
    assert.equal(calls[0].body.chat_id, '-1001234567890');
    assert.equal(calls[0].body.parse_mode, 'HTML');
    assert.match(calls[0].body.text, /<b>NMS 系统通知 · 节点连接超时<\/b>/);
    assert.match(calls[0].body.text, /<i>系统事件推送<\/i>/);
    assert.match(calls[0].body.text, /节点: <b>node-a<\/b>/);
    assert.match(calls[0].body.text, /<b>关键信息<\/b>/);
    assert.match(calls[0].body.text, /\n\n<b>影响范围<\/b>/);
});

test('telegramAlertService deduplicates repeated security alerts within the cooldown window', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        dedupWindowMs: 60_000,
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true };
        },
    });

    const auditEntry = {
        ts: '2026-03-15T10:00:00.000Z',
        eventType: 'login_rate_limited',
        actor: 'anonymous',
        ip: '203.0.113.8',
        ipLocation: '中国 浙江 杭州',
        ipCarrier: '中国电信',
        method: 'POST',
        path: '/api/auth/login',
        details: {
            username: 'alice',
        },
    };

    assert.equal(await service.notifySecurityAudit(auditEntry), true);
    assert.equal(await service.notifySecurityAudit(auditEntry), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.parse_mode, 'HTML');
    assert.match(calls[0].body.text, /登录频率限制/);
    assert.match(calls[0].body.text, /归属地 \/ 运营商: <b>中国 浙江 杭州 · 中国电信<\/b>/);
    assert.match(calls[0].body.text, /<b>来源线索<\/b>/);
    assert.match(calls[1].body.text, /<b>NMS 聚合告警 · 登录频率限制<\/b>/);
});

test('telegramAlertService ignores low-severity notifications and exposes delivery status', async () => {
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        alertSeverities: ['critical'],
        fetcher: async () => ({ ok: true }),
    });

    const sent = await service.notifyNotification({
        type: 'server_health_recovered',
        severity: 'info',
        title: '节点已恢复',
        body: 'node-a',
        createdAt: '2026-03-15T10:00:00.000Z',
    });

    assert.equal(sent, false);
    assert.deepEqual(service.getStatus().alertSeverities, ['critical']);
    assert.equal(service.getStatus().enabled, true);
});

test('telegramAlertService exposes command polling capability for numeric chat ids', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true, result: {} };
        },
    });

    const sent = await service.sendTestMessage('admin');
    const commandCall = calls.find((item) => /\/setMyCommands$/.test(item.url));
    const messageCall = calls.find((item) => /\/sendMessage$/.test(item.url));

    assert.equal(sent, true);
    assert.equal(service.getStatus().commandsEnabled, true);
    assert.equal(service.getStatus().enabled, true);
    assert.ok(commandCall);
    assert.deepEqual(commandCall.body.commands.map((item) => item.command), ['status', 'online', 'traffic', 'alerts', 'security', 'nodes', 'access', 'expiry', 'monitor']);
    assert.equal(messageCall.body.parse_mode, 'HTML');
    assert.match(messageCall.body.text, /<b>NMS Telegram 测试通知<\/b>/);
    assert.match(messageCall.body.text, /<i>消息结构与命令菜单检查<\/i>/);
    assert.match(messageCall.body.text, /<b>快速开始<\/b>/);
    assert.match(messageCall.body.text, /<pre>[\s\S]*\/expiry\s+用户到期提醒摘要[\s\S]*<\/pre>/);
    assert.match(messageCall.body.text, /<b>运维动作<\/b>/);
    assert.equal(Object.prototype.hasOwnProperty.call(messageCall.body, 'reply_markup'), false);
});

test('telegramAlertService forwards login failure audits with target account details', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true };
        },
    });

    const sent = await service.notifySecurityAudit({
        ts: '2026-03-15T10:00:00.000Z',
        eventType: 'login_failed',
        actor: 'anonymous',
        ip: '203.0.113.9',
        method: 'POST',
        path: '/api/auth/login',
        details: {
            username: 'alice',
        },
    });

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.text, /<b>NMS 安全审计 · 登录失败<\/b>/);
    assert.match(calls[0].body.text, /<i>安全审计推送<\/i>/);
    assert.match(calls[0].body.text, /目标用户: <b>alice<\/b>/);
    assert.match(calls[0].body.text, /请求: <b>POST \/api\/auth\/login<\/b>/);
});

test('telegramAlertService retries the same alert after a failed delivery', async () => {
    const calls = [];
    let failFirst = true;
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        dedupWindowMs: 60_000,
        fetcher: async (payload) => {
            calls.push(payload);
            if (failFirst) {
                failFirst = false;
                throw new Error('telegram-down');
            }
            return { ok: true };
        },
    });

    const notification = {
        type: 'server_health_connect_timeout',
        severity: 'critical',
        title: '节点连接超时',
        body: '节点 node-a 连接超时',
        createdAt: '2026-03-15T10:00:00.000Z',
        meta: {
            serverId: 'node-a',
            reasonCode: 'connect_timeout',
        },
    };

    assert.equal(await service.notifyNotification(notification), false);
    assert.equal(await service.notifyNotification(notification), true);
    assert.equal(calls.length, 2);
});

test('telegramAlertService sends an aggregate digest after repeated suppressed notifications', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        dedupWindowMs: 20,
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true };
        },
    });

    service.noteNotificationOccurrence({
        type: 'security_login_failed',
        severity: 'warning',
        title: '登录失败',
        body: '检测到登录失败请求',
        dedupKey: 'security:login_failed:203.0.113.7:alice',
        dedupWindowMs: 20,
        createdAt: '2026-03-15T10:00:00.000Z',
        meta: {
            ip: '203.0.113.7',
            ipLocation: '中国 浙江 杭州',
            ipCarrier: '中国电信',
            targetUsername: 'alice',
            method: 'POST',
            path: '/api/auth/login',
        },
    });
    service.noteNotificationOccurrence({
        type: 'security_login_failed',
        severity: 'warning',
        title: '登录失败',
        body: '检测到登录失败请求',
        dedupKey: 'security:login_failed:203.0.113.7:alice',
        dedupWindowMs: 20,
        createdAt: '2026-03-15T10:00:10.000Z',
        suppressed: true,
        meta: {
            ip: '203.0.113.7',
            ipLocation: '中国 浙江 杭州',
            ipCarrier: '中国电信',
            targetUsername: 'alice',
            method: 'POST',
            path: '/api/auth/login',
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(calls.length, 1);
    assert.match(calls[0].body.text, /<b>NMS 聚合告警 · 登录失败<\/b>/);
    assert.match(calls[0].body.text, /<i>重复事件自动聚合<\/i>/);
    assert.match(calls[0].body.text, /累计命中: <b>2 次<\/b>/);
    assert.match(calls[0].body.text, /聚合抑制: <b>1 次<\/b>/);
});

test('telegramAlertService can send scheduled operation digests without inline menus', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true };
        },
        buildOperationsDigest: async () => '<b>NMS 运维汇总摘要</b>\n\n<b>概况</b>\n• 测试摘要',
    });

    const sent = await service.sendPeriodicDigest('ops');

    assert.equal(sent, true);
    assert.equal(service.getStatus().lastDigestKind, 'ops');
    assert.match(calls[0].body.text, /<b>NMS 运维汇总摘要<\/b>/);
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'reply_markup'), false);
});

test('collectStatusDigestContext prefers sampled server traffic totals over cluster snapshot totals', async () => {
    const context = await collectStatusDigestContext({
        collectClusterStatusSnapshot: async () => ({
            summary: {
                total: 17,
                healthy: 17,
                degraded: 0,
                unreachable: 0,
                maintenance: 0,
                totalOnline: 6,
                activeInbounds: 17,
                totalInbounds: 17,
                totalUp: 999,
                totalDown: 888,
                checkedAt: '2026-03-16T14:29:00.000Z',
            },
        }),
        trafficStatsStore: {
            collectIfStale: async () => {},
            getOverview: () => ({
                serverTotals: [
                    { upBytes: 10, downBytes: 20, totalBytes: 30 },
                    { upBytes: 40, downBytes: 50, totalBytes: 90 },
                ],
                lastCollectionAt: '2026-03-16T14:30:00.000Z',
            }),
        },
        serverHealthMonitor: {
            getStatus: () => ({ lastRunAt: '2026-03-16T14:29:00.000Z' }),
        },
    });

    assert.deepEqual(context.traffic, {
        upBytes: 50,
        downBytes: 70,
        totalBytes: 120,
        lastCollectionAt: '2026-03-16T14:30:00.000Z',
        source: 'traffic_store',
    });
});

test('formatStatusDigestMessage renders structured HTML blocks', () => {
    const text = formatStatusDigestMessage({
        summary: {
            total: 17,
            healthy: 17,
            degraded: 0,
            unreachable: 0,
            maintenance: 0,
            totalOnline: 6,
            activeInbounds: 17,
            totalInbounds: 17,
        },
        traffic: {
            upBytes: 50,
            downBytes: 70,
            totalBytes: 120,
            lastCollectionAt: '2026-03-16T14:30:00.000Z',
        },
        checkedAt: '2026-03-16T14:29:00.000Z',
    });

    assert.match(text, /<b>NMS 状态总览<\/b>/);
    assert.match(text, /<i>集群即时状态与最近 24h 流量<\/i>/);
    assert.match(text, /<b>核心指标<\/b>/);
    assert.match(text, /<b>节点健康<\/b>/);
    assert.match(text, /统计口径: <b>当前节点快照累计值<\/b>/);
    assert.match(text, /合计: <b>120 B<\/b>/);
    assert.match(text, /上行: <b>50 B<\/b>/);
    assert.match(text, /下行: <b>70 B<\/b>/);
});

test('formatCommandCatalogMessage renders structured HTML help output', () => {
    const text = formatCommandCatalogMessage();

    assert.match(text, /<b>NMS Telegram 控制台<\/b>/);
    assert.match(text, /<i>状态摘要查询与巡检触发入口<\/i>/);
    assert.match(text, /<b>快速开始<\/b>/);
    assert.match(text, /<b>状态查询<\/b>/);
    assert.match(text, /<pre>[\s\S]*\/status\s+系统状态总览[\s\S]*<\/pre>/);
    assert.match(text, /<b>运维动作<\/b>/);
    assert.match(text, /<pre>[\s\S]*\/monitor\s+立即执行节点巡检[\s\S]*<\/pre>/);
    assert.doesNotMatch(text, /快捷按钮/);
});
