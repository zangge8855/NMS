import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectStatusDigestContext,
    computeDailyBackupSchedule,
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
    assert.match(calls[0].body.text, /<b>🔔 NMS 系统通知 · 节点连接超时<\/b>/);
    assert.match(calls[0].body.text, /<i>系统事件推送<\/i>/);
    assert.match(calls[0].body.text, /节点: <b>node-a<\/b>/);
    assert.match(calls[0].body.text, /<b>📋 关键信息<\/b>/);
    assert.match(calls[0].body.text, /\n\n<b>🎯 影响范围<\/b>/);
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
    assert.match(calls[0].body.text, /<b>🔍 来源线索<\/b>/);
    assert.match(calls[1].body.text, /<b>📊 NMS 聚合告警 · 登录频率限制<\/b>/);
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

test('telegramAlertService syncs Telegram command menus only when explicitly enabled', async () => {
    const calls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        commandMenuEnabled: true,
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
    assert.equal(service.getStatus().commandMenuEnabled, true);
    assert.equal(service.getStatus().enabled, true);
    assert.ok(commandCall);
    assert.deepEqual(commandCall.body.commands.map((item) => item.command), ['status', 'online', 'traffic', 'alerts', 'security', 'nodes', 'access', 'expiry', 'monitor', 'backup']);
    assert.equal(messageCall.body.parse_mode, 'HTML');
    assert.match(messageCall.body.text, /<b>🧪 NMS Telegram 测试通知<\/b>/);
    assert.match(messageCall.body.text, /<i>消息结构与命令菜单检查<\/i>/);
    assert.match(messageCall.body.text, /<b>🚀 快速开始<\/b>/);
    assert.match(messageCall.body.text, /<pre>[\s\S]*\/expiry\s+用户到期提醒摘要[\s\S]*<\/pre>/);
    assert.match(messageCall.body.text, /<b>🔧 运维动作<\/b>/);
    assert.match(messageCall.body.text, /<pre>[\s\S]*\/backup\s+立即发送一次加密备份[\s\S]*<\/pre>/);
    assert.deepEqual(messageCall.body.reply_markup, { remove_keyboard: true });
});

test('telegramAlertService clears Telegram command menus by default', async () => {
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
    const commandCall = calls.find((item) => /\/deleteMyCommands$/.test(item.url));
    const messageCall = calls.find((item) => /\/sendMessage$/.test(item.url));

    assert.equal(sent, true);
    assert.equal(service.getStatus().commandMenuEnabled, false);
    assert.ok(commandCall);
    assert.match(messageCall.body.text, /<i>消息结构与命令入口检查<\/i>/);
    assert.deepEqual(messageCall.body.reply_markup, { remove_keyboard: true });
});

test('telegramAlertService sends encrypted backups as Telegram documents and tracks backup status', async () => {
    const documentCalls = [];
    const recorded = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        sendDailyBackup: true,
        fetcher: async () => ({ ok: true, result: {} }),
        documentFetcher: async (payload) => {
            documentCalls.push(payload);
            return { ok: true, result: { message_id: 1 } };
        },
        buildBackupArchive: () => ({
            filename: 'nms_backup_20260321_080000.nmsbak',
            buffer: Buffer.from('backup-data'),
            meta: {
                bytes: 11,
                storeKeys: ['users', 'servers'],
            },
        }),
        recordTelegramBackupMeta: (meta) => {
            recorded.push(meta);
            return meta;
        },
    });

    const result = await service.sendBackupArchive('admin', { reason: 'manual' });

    assert.equal(documentCalls.length, 1);
    assert.match(documentCalls[0].url, /\/bot123456:ABCDEF\/sendDocument$/);
    assert.equal(result.archive.filename, 'nms_backup_20260321_080000.nmsbak');
    assert.equal(result.archive.bytes, 11);
    assert.equal(service.getStatus().sendDailyBackup, true);
    assert.equal(service.getStatus().dailyBackupTime, '09:00');
    assert.match(service.getStatus().nextDailyBackupAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(service.getStatus().lastBackupFilename, 'nms_backup_20260321_080000.nmsbak');
    assert.equal(service.getStatus().lastSentKind, 'backup_manual');
    assert.equal(recorded[0].status, 'sent');
    assert.equal(recorded[0].reason, 'manual');
});

test('computeDailyBackupSchedule triggers missed backups at the configured local time and schedules the next day', () => {
    const schedule = computeDailyBackupSchedule({
        now: new Date(2026, 2, 23, 10, 15, 0, 0).getTime(),
        dailyBackupTime: '09:30',
        lastBackupAt: new Date(2026, 2, 22, 9, 30, 0, 0).toISOString(),
    });
    const todayTarget = new Date(schedule.todayTargetAt);
    const nextTarget = new Date(schedule.nextDailyBackupAt);

    assert.equal(schedule.dailyBackupTime, '09:30');
    assert.equal(schedule.shouldSendNow, true);
    assert.equal(todayTarget.getHours(), 9);
    assert.equal(todayTarget.getMinutes(), 30);
    assert.equal(nextTarget.getHours(), 9);
    assert.equal(nextTarget.getMinutes(), 30);
    assert.equal(nextTarget.getDate(), todayTarget.getDate() + 1);
});

test('computeDailyBackupSchedule can defer a missed run until the next scheduled day', () => {
    const schedule = computeDailyBackupSchedule({
        now: new Date(2026, 2, 23, 10, 15, 0, 0).getTime(),
        dailyBackupTime: '09:30',
        lastBackupAt: new Date(2026, 2, 22, 9, 30, 0, 0).toISOString(),
        deferMissedRun: true,
    });
    const todayTarget = new Date(schedule.todayTargetAt);
    const nextTarget = new Date(schedule.nextDailyBackupAt);

    assert.equal(schedule.shouldSendNow, false);
    assert.equal(nextTarget.getHours(), 9);
    assert.equal(nextTarget.getMinutes(), 30);
    assert.equal(nextTarget.getDate(), todayTarget.getDate() + 1);
});

test('telegramAlertService does not reschedule an immediate daily backup when persisted state already handled today', () => {
    const timeoutCalls = [];
    const service = createTelegramAlertService({
        enabled: true,
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
        sendDailyBackup: true,
        dailyBackupTime: '09:30',
        opsDigestIntervalMinutes: 0,
        dailyDigestIntervalHours: 0,
        now: () => new Date(2026, 2, 23, 10, 15, 0, 0).getTime(),
        getLatestTelegramBackupMeta: () => ({
            status: 'sent',
            ts: new Date(2026, 2, 23, 9, 31, 0, 0).toISOString(),
            filename: 'nms_backup_20260323_093100.nmsbak',
            reason: 'daily',
        }),
        startBackgroundTimeout: (_fn, delayMs) => {
            timeoutCalls.push(delayMs);
            return delayMs;
        },
        fetcher: async () => ({ ok: true, result: {} }),
    });

    service.start();
    service.stop();

    assert.equal(timeoutCalls.includes(0), false);
    assert.ok(timeoutCalls.includes(2000));
    assert.ok(timeoutCalls.some((delayMs) => delayMs > 20 * 60 * 60 * 1000));
});

test('formatCommandCatalogMessage keeps manual command guidance in the help text', () => {
    const message = formatCommandCatalogMessage();

    assert.match(message, /直接发送 <code>\/help<\/code>/);
    assert.doesNotMatch(message, /同步命令菜单/);
    assert.doesNotMatch(message, /快捷按钮/);
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
    assert.match(calls[0].body.text, /<b>🛡 NMS 安全审计 · 登录失败<\/b>/);
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
    assert.match(calls[0].body.text, /<b>📊 NMS 聚合告警 · 登录失败<\/b>/);
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
        opsDigestIntervalMinutes: 45,
        fetcher: async (payload) => {
            calls.push(payload);
            return { ok: true };
        },
        buildOperationsDigest: async () => '<b>NMS 运维汇总摘要</b>\n\n<b>概况</b>\n• 测试摘要',
    });

    const sent = await service.sendPeriodicDigest('ops');

    assert.equal(sent, true);
    assert.equal(service.getStatus().lastDigestKind, 'ops');
    assert.equal(service.getStatus().opsDigestIntervalMinutes, 45);
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

    assert.match(text, /<b>📡 NMS 状态总览<\/b>/);
    assert.match(text, /<i>集群即时状态与最近 24h 流量<\/i>/);
    assert.match(text, /<b>📊 核心指标<\/b>/);
    assert.match(text, /<b>💚 节点健康<\/b>/);
    assert.match(text, /统计口径: <b>当前节点快照累计值<\/b>/);
    assert.match(text, /合计: <b>120 B<\/b>/);
    assert.match(text, /上行: <b>50 B<\/b>/);
    assert.match(text, /下行: <b>70 B<\/b>/);
});

test('formatCommandCatalogMessage renders structured HTML help output', () => {
    const text = formatCommandCatalogMessage();

    assert.match(text, /<b>🤖 NMS Telegram 控制台<\/b>/);
    assert.match(text, /<i>状态摘要查询、巡检与备份入口<\/i>/);
    assert.match(text, /<b>🚀 快速开始<\/b>/);
    assert.match(text, /<b>📊 状态查询<\/b>/);
    assert.match(text, /<pre>[\s\S]*\/status\s+系统状态总览[\s\S]*<\/pre>/);
    assert.match(text, /<b>🔧 运维动作<\/b>/);
    assert.match(text, /<pre>[\s\S]*\/monitor\s+立即执行节点巡检[\s\S]*<\/pre>/);
    assert.match(text, /<pre>[\s\S]*\/backup\s+立即发送一次加密备份[\s\S]*<\/pre>/);
    assert.doesNotMatch(text, /快捷按钮/);
});
