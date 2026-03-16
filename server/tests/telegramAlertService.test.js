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
    assert.match(calls[0].body.text, /<b>NMS 系统告警摘要<\/b>/);
    assert.match(calls[0].body.text, /节点: node-a/);
    assert.match(calls[0].body.text, /<b>概况<\/b>/);
    assert.match(calls[0].body.text, /\n\n<b>影响<\/b>/);
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
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.parse_mode, 'HTML');
    assert.match(calls[0].body.text, /登录频率限制/);
    assert.match(calls[0].body.text, /归属地 \/ 运营商: 中国 浙江 杭州 · 中国电信/);
    assert.match(calls[0].body.text, /<b>来源<\/b>/);
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

    assert.equal(sent, true);
    assert.equal(service.getStatus().commandsEnabled, true);
    assert.equal(service.getStatus().enabled, true);
    assert.equal(calls[0].body.parse_mode, 'HTML');
    assert.match(calls[0].body.text, /<b>NMS Telegram 测试通知<\/b>/);
    assert.match(calls[0].body.text, /<code>\/expiry<\/code> 用户到期提醒摘要/);
    assert.match(calls[0].body.text, /<b>运维命令<\/b>/);
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
    assert.match(calls[0].body.text, /登录失败/);
    assert.match(calls[0].body.text, /目标用户: alice/);
    assert.match(calls[0].body.text, /请求: POST \/api\/auth\/login/);
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
    assert.match(text, /<b>集群运行<\/b>/);
    assert.match(text, /累计总量: 120 B/);
    assert.match(text, /上行: 50 B/);
    assert.match(text, /下行: 70 B/);
});

test('formatCommandCatalogMessage renders structured HTML help output', () => {
    const text = formatCommandCatalogMessage();

    assert.match(text, /<b>NMS Telegram 控制台<\/b>/);
    assert.match(text, /<b>查询命令<\/b>/);
    assert.match(text, /<code>\/status<\/code> 系统状态总览/);
    assert.match(text, /<b>运维命令<\/b>/);
    assert.match(text, /<code>\/monitor<\/code> 立即执行节点巡检/);
});
