import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { invokeApp } from './helpers/invokeApp.js';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-batch6-hardening-'));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = 'test';

const { default: app, createApp } = await import('../index.js');
const { default: config } = await import('../config.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');
const { default: userPolicyStore } = await import('../store/userPolicyStore.js');
const { default: systemSettingsStore } = await import('../store/systemSettingsStore.js');
const { default: jobStore } = await import('../store/jobStore.js');
const { default: auditStore } = await import('../store/auditStore.js');
const { createTelegramAlertService } = await import('../lib/telegramAlertService.js');
const { createCommandRegistry } = await import('../lib/telegram/commandRegistry.js');
const { registerClientCommands } = await import('../lib/telegram/commands/clients.js');

function makeAuthHeader(user) {
    const token = jwt.sign(
        {
            userId: user.id,
            username: user.username,
            role: user.role,
            tokenVersion: user.tokenVersion || 1,
        },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    return `Bearer ${token}`;
}

test.after(async () => {
    await auditStore._save();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('userPolicyStore.upsert preserves inheritGroup on partial updates unless explicitly changed', () => {
    const email = `inherit-${Date.now()}@example.com`;
    const initial = userPolicyStore.upsert(email, {
        inheritGroup: true,
        limitIp: 2,
    }, 'tester');
    assert.equal(initial.inheritGroup, true);
    assert.equal(initial.limitIp, 2);

    const omittedUpdate = userPolicyStore.upsert(email, {
        limitIp: 5,
    }, 'tester');
    assert.equal(omittedUpdate.inheritGroup, true);
    assert.equal(omittedUpdate.limitIp, 5);

    const undefinedUpdate = userPolicyStore.upsert(email, {
        limitIp: 6,
        inheritGroup: undefined,
    }, 'tester');
    assert.equal(undefinedUpdate.inheritGroup, true);
    assert.equal(undefinedUpdate.limitIp, 6);

    const explicitDisable = userPolicyStore.upsert(email, {
        limitIp: 7,
        inheritGroup: false,
    }, 'tester');
    assert.equal(explicitDisable.inheritGroup, false);
    assert.equal(explicitDisable.limitIp, 7);
});

test('proxy route rejects encoded path traversal and blocks auditors from sensitive endpoints', async () => {
    const adminUser = userStore.getByUsername('admin') || userStore.getAll().find((u) => u.role === ROLES.admin);
    const auditorUser = userStore.add({
        username: `aud_proxy_${Date.now()}`,
        password: 'AudProxy#123',
        role: ROLES.auditor,
    });
    const adminHeader = makeAuthHeader(adminUser);
    const auditorHeader = makeAuthHeader(auditorUser);

    for (const traversalPath of [
        '/api/panel/srv-1/panel/api/%2e%2e/etc/passwd',
        '/api/panel/srv-1/panel/api/%252e%252e/secret',
        '/api/panel/srv-1/panel/api/inbounds/..%5csecret',
    ]) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: traversalPath,
            headers: { Authorization: adminHeader },
        });
        assert.equal(res.statusCode, 400, `expected 400 for ${traversalPath}`);
    }

    for (const sensitivePath of [
        '/api/panel/srv-1/panel/api/setting/apiTokens',
        '/api/panel/srv-1/panel/api/setting//apiTokens',
        '/api/panel/srv-1/sui/tokens',
        '/api/panel/srv-1/sui/users',
        '/api/panel/srv-1/sui/load',
        '/api/panel/srv-1/sub/abc123',
    ]) {
        const res = await invokeApp(app, {
            method: 'GET',
            url: sensitivePath,
            headers: { Authorization: auditorHeader },
        });
        assert.equal(res.statusCode, 403, `expected 403 for auditor on ${sensitivePath}`);
    }
});

test('POST /api/jobs/:id/retry preserves failed target alignment on /inbounds/add and audits batch_sensitive_retry', async () => {
    const adminUser = userStore.getByUsername('admin') || userStore.getAll().find((u) => u.role === ROLES.admin);
    const adminHeader = makeAuthHeader(adminUser);

    const addInboundJob = jobStore.appendBatch({
        type: 'inbounds',
        action: 'add',
        actor: adminUser.username,
        output: {
            summary: { total: 2, success: 1, failed: 1 },
            results: [
                { serverId: 'srv-missing-shared', success: true, targetIndex: 0, remark: 'first-ok' },
                { serverId: 'srv-missing-shared', success: false, targetIndex: 1, remark: 'second-fail', msg: 'boom' },
            ],
        },
        requestSnapshot: {
            concurrency: 1,
            targets: [
                { serverId: 'srv-missing-shared', remark: 'first-ok', payload: { protocol: 'vless', port: 14001, remark: 'first-ok' } },
                { serverId: 'srv-missing-shared', remark: 'second-fail', payload: { protocol: 'vless', port: 14002, remark: 'second-fail' } },
            ],
        },
    });

    const addRetryRes = await invokeApp(app, {
        method: 'POST',
        url: `/api/jobs/${addInboundJob.id}/retry`,
        headers: { Authorization: adminHeader },
        body: { failedOnly: true },
    });
    assert.equal(addRetryRes.statusCode, 207);
    assert.equal(addRetryRes.json?.obj?.summary?.total, 1);
    assert.equal(addRetryRes.json?.obj?.results?.length, 1);
    assert.equal(addRetryRes.json?.obj?.results?.[0]?.remark, 'second-fail');

    const deleteClientsJob = jobStore.appendBatch({
        type: 'clients',
        action: 'delete',
        actor: adminUser.username,
        output: {
            summary: { total: 1, success: 0, failed: 1 },
            results: [
                { serverId: 'srv-missing-del', inboundId: 1, email: 'del@example.com', success: false, targetIndex: 0, msg: 'boom' },
            ],
        },
        requestSnapshot: {
            concurrency: 1,
            targets: [
                { serverId: 'srv-missing-del', inboundId: 1, email: 'del@example.com', protocol: 'vless', id: 'uuid-1' },
            ],
        },
    });

    const riskTokenRes = await invokeApp(app, {
        method: 'POST',
        url: '/api/system/batch-risk-token',
        headers: { Authorization: adminHeader },
        body: { type: 'clients', action: 'delete', isRetry: true, targetCount: 1 },
    });
    assert.equal(riskTokenRes.statusCode, 200);
    const confirmToken = riskTokenRes.json?.obj?.token || '';

    const delRetryRes = await invokeApp(app, {
        method: 'POST',
        url: `/api/jobs/${deleteClientsJob.id}/retry`,
        headers: { Authorization: adminHeader },
        body: { failedOnly: true, confirmToken },
    });
    assert.equal(delRetryRes.statusCode, 207);
    const auditEvents = auditStore.queryEvents({ eventType: 'batch_sensitive_retry', pageSize: 20 }).items;
    assert.ok(auditEvents.some((item) => item.details?.sourceHistoryId === deleteClientsJob.id));
});

test('index.ts serves JSON 404 for unknown /api routes before camouflage and restricts CORS in production', async (t) => {
    t.mock.method(systemSettingsStore, 'getSite', () => ({
        camouflageEnabled: true,
        accessPath: '/portal',
        camouflageTemplate: 'blog',
    }));

    const api404 = await invokeApp(app, {
        method: 'GET',
        url: '/api/nonexistent-endpoint',
    });
    assert.equal(api404.statusCode, 404);
    assert.equal(api404.json?.success, false);
    assert.equal(api404.json?.msg, 'API route not found');

    const prevNodeEnv = process.env.NODE_ENV;
    const prevCors = process.env.CORS_ALLOWED_ORIGINS;
    try {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ALLOWED_ORIGINS = 'https://allowed.example.com';
        const prodApp = createApp({ serveClientBuild: false });

        const allowed = await invokeApp(prodApp, {
            method: 'GET',
            url: '/api/health',
            headers: { Origin: 'https://allowed.example.com' },
        });
        assert.equal(allowed.statusCode, 200);
        assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.example.com');

        const blocked = await invokeApp(prodApp, {
            method: 'GET',
            url: '/api/health',
            headers: { Origin: 'https://evil.example.net' },
        });
        assert.equal(blocked.statusCode, 200);
        assert.equal(blocked.headers['access-control-allow-origin'], undefined);

        delete process.env.CORS_ALLOWED_ORIGINS;
        const sameHost = await invokeApp(prodApp, {
            method: 'GET',
            url: '/api/health',
            headers: {
                Host: 'panel.example.org',
                Origin: 'https://panel.example.org',
            },
        });
        assert.equal(sameHost.headers['access-control-allow-origin'], 'https://panel.example.org');

        const crossHost = await invokeApp(prodApp, {
            method: 'GET',
            url: '/api/health',
            headers: {
                Host: 'panel.example.org',
                Origin: 'https://evil.example.net',
            },
        });
        assert.equal(crossHost.headers['access-control-allow-origin'], undefined);
    } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
        else process.env.CORS_ALLOWED_ORIGINS = prevCors;
    }
});

test('telegram hardening escapes HTML in /client /sub hints, clears dedup interval on stop(), and enforces TELEGRAM_ALLOWED_USER_IDS', async (t) => {
    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const registry = createCommandRegistry();
    registerClientCommands(registry, {
        helpers: {
            joinHtmlMessage: (title, blocks) => `${title}\n${blocks.join('\n\n')}`,
            sectionHeader: (title) => `<b>${escapeHtml(title)}</b>`,
            formatHtmlKeyValueRow: (label, value) => `${escapeHtml(label)}: <b>${escapeHtml(value)}</b>`,
            escapeTelegramHtml: escapeHtml,
            formatBytesHuman: (value) => `${value}B`,
            trimLines: (lines) => lines.filter(Boolean).join('\n'),
        },
        services: {
            async userAdmin() {
                return {
                    listUsers: () => [{
                        id: 'u-xss',
                        username: 'xss',
                        email: '<script>alert(1)</script>@example.com',
                        subscriptionEmail: '<script>alert(1)</script>@example.com',
                        enabled: true,
                    }],
                };
            },
        },
    });
    const detailRes = await registry.dispatch({
        command: '/client',
        args: { positional: ['u-xss'], raw: 'u-xss' },
    });
    assert.equal(detailRes.kind, 'client_detail');
    assert.doesNotMatch(detailRes.text, /<script>/);
    assert.match(detailRes.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    const prevAllowed = process.env.TELEGRAM_ALLOWED_USER_IDS;
    const replies = [];
    const clearSpy = t.mock.method(globalThis, 'clearInterval');
    try {
        process.env.TELEGRAM_ALLOWED_USER_IDS = '999001';
        const service = createTelegramAlertService({
            enabled: true,
            botToken: '123456:ABCDEF',
            chatId: '-1001234567890',
            fetcher: async (payload) => {
                replies.push(payload);
                return { ok: true };
            },
        });
        await service._processUpdates([
            {
                update_id: 1,
                message: {
                    chat: { id: '-1001234567890' },
                    from: { id: '888002' },
                    text: '/help',
                },
            },
        ]);
        assert.equal(replies.length, 0);

        await service._processUpdates([
            {
                update_id: 2,
                message: {
                    chat: { id: '-1001234567890' },
                    from: { id: '999001' },
                    text: '/help',
                },
            },
        ]);
        const sendMessages = replies.filter((item) => String(item?.url || '').endsWith('/sendMessage'));
        assert.equal(sendMessages.length, 1);

        const beforeStopCalls = clearSpy.mock.callCount();
        service.stop();
        assert.ok(clearSpy.mock.callCount() > beforeStopCalls);
    } finally {
        if (prevAllowed === undefined) delete process.env.TELEGRAM_ALLOWED_USER_IDS;
        else process.env.TELEGRAM_ALLOWED_USER_IDS = prevAllowed;
    }
});

test('GET /api/subscriptions/public/t/:tokenId/:token accepts pre-upgrade jwt.secret tokens without logging subscription_public_denied', async (t) => {
    const { default: config } = await import('../config.js');
    const { default: subscriptionTokenStore } = await import('../store/subscriptionTokenStore.js');
    const { default: userPolicyStore } = await import('../store/userPolicyStore.js');
    const { default: userStore } = await import('../store/userStore.js');
    const { invalidatePublicSubCache } = await import('../routes/subscriptions.js');

    const prevJwt = config.jwt.secret;
    const prevCred = config.credentials.secret;
    const prevSub = config.subscription.tokenSecret;
    const prevLegacy = config.subscription.legacySecrets;
    const origSave = subscriptionTokenStore._save;
    const origTokens = subscriptionTokenStore.exportState();

    subscriptionTokenStore._save = () => {};
    invalidatePublicSubCache();

    try {
        config.jwt.secret = 'http-legacy-jwt-secret-1234567890abcdef';
        config.credentials.secret = '';
        config.subscription.tokenSecret = '';
        config.subscription.legacySecrets = [];

        const email = 'http-upgrade-sub@example.com';
        const issued = subscriptionTokenStore.issue(email, {
            name: 'pre-upgrade-http-token',
            noExpiry: true,
            ignoreActiveLimit: true,
            createdBy: 'test',
        });

        // Simulate NMS upgrade introducing a separate subscription/credentials secret.
        config.credentials.secret = 'http-upgraded-credentials-secret-123456789';
        config.subscription.tokenSecret = 'http-upgraded-credentials-secret-123456789';

        t.mock.method(userStore, 'getBySubscriptionEmail', () => null);
        t.mock.method(userStore, 'getByEmail', () => null);
        t.mock.method(userPolicyStore, 'get', () => ({ serverScopeMode: 'none' }));

        const deniedBefore = auditStore.queryEvents({ eventType: 'subscription_public_denied', pageSize: 1 }).total;
        const okRes = await invokeApp(app, {
            method: 'GET',
            url: `/api/subscriptions/public/t/${encodeURIComponent(issued.publicTokenId)}/${encodeURIComponent(issued.tokenSecret)}`,
        });
        assert.equal(okRes.statusCode, 200);
        assert.equal(okRes.headers['x-subscription-token-id'], issued.publicTokenId);
        const deniedAfterOk = auditStore.queryEvents({ eventType: 'subscription_public_denied', pageSize: 1 }).total;
        assert.equal(deniedAfterOk, deniedBefore);

        const badRes = await invokeApp(app, {
            method: 'GET',
            url: `/api/subscriptions/public/t/${encodeURIComponent(issued.publicTokenId)}/wrong-secret-value`,
        });
        assert.equal(badRes.statusCode, 401);
        const deniedAfterBad = auditStore.queryEvents({ eventType: 'subscription_public_denied', pageSize: 1 }).total;
        assert.equal(deniedAfterBad, deniedBefore + 1);
    } finally {
        invalidatePublicSubCache();
        subscriptionTokenStore._save = origSave;
        subscriptionTokenStore.importState(origTokens);
        config.jwt.secret = prevJwt;
        config.credentials.secret = prevCred;
        config.subscription.tokenSecret = prevSub;
        config.subscription.legacySecrets = prevLegacy;
    }
});
