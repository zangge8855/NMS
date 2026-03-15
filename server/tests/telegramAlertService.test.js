import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramAlertService } from '../lib/telegramAlertService.js';

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
    assert.match(calls[0].body.text, /\[NMS 系统告警\]/);
    assert.match(calls[0].body.text, /节点: node-a/);
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
        method: 'POST',
        path: '/api/auth/login',
        details: {
            username: 'alice',
        },
    };

    assert.equal(await service.notifySecurityAudit(auditEntry), true);
    assert.equal(await service.notifySecurityAudit(auditEntry), false);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.text, /登录频率限制/);
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
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        fetcher: async () => ({ ok: true, result: {} }),
    });

    const sent = await service.sendTestMessage('admin');

    assert.equal(sent, true);
    assert.equal(service.getStatus().commandsEnabled, true);
    assert.equal(service.getStatus().enabled, true);
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
