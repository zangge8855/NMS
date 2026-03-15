import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runScenario } from './helpers/runScenario.js';

const SERVER_ROOT = path.resolve(process.cwd());
const JWT_SECRET = 'test-secret-key-for-users-detail-audit';

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('user detail activity includes audits produced by bulk enable/disable actions', async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-users-detail-audit-'));

    writeJson(path.join(dataDir, 'users.json'), [
        {
            id: 'user-activity-1',
            username: 'alice',
            email: 'alice@example.com',
            subscriptionEmail: '',
            role: 'user',
            enabled: true,
            emailVerified: true,
            createdAt: '2026-03-12T00:00:00.000Z',
        },
    ]);
    writeJson(path.join(dataDir, 'servers.json'), []);

    t.after(async () => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const result = await runScenario('tests/helpers/usersRouteAuditDetailScenario.js', {
        cwd: SERVER_ROOT,
        env: {
            NODE_ENV: 'test',
            DATA_DIR: dataDir,
            JWT_SECRET,
            ADMIN_USERNAME: 'admin',
            ADMIN_PASSWORD: 'Admin123!!',
            DB_ENABLED: 'false',
        },
    });

    assert.equal(result.bulkResponse.statusCode, 200);
    assert.equal(result.bulkResponse.body?.success, true);

    assert.equal(result.detailResponse.statusCode, 200);
    const detailBody = result.detailResponse.body;
    assert.equal(detailBody.success, true);
    assert.equal(detailBody.obj.recentAudit.total, 1);
    assert.equal(detailBody.obj.recentAudit.items[0].eventType, 'user_disabled');
    assert.equal(detailBody.obj.recentAudit.items[0].details.targetUserId, 'user-activity-1');
    assert.equal(detailBody.obj.recentAudit.items[0].details.viaBulkAction, true);
});

test('user detail sanitizes masked audit IPs and enriches real audit IP metadata', async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-users-detail-enrichment-'));

    writeJson(path.join(dataDir, 'users.json'), [
        {
            id: 'user-activity-1',
            username: 'alice',
            email: 'alice@example.com',
            subscriptionEmail: '',
            role: 'user',
            enabled: true,
            emailVerified: true,
            createdAt: '2026-03-12T00:00:00.000Z',
        },
    ]);
    writeJson(path.join(dataDir, 'servers.json'), []);
    writeJson(path.join(dataDir, 'system_settings.json'), {
        auditIpGeo: {
            enabled: true,
            provider: 'ip_api',
            endpoint: 'https://example.test/{ip}',
            timeoutMs: 1000,
            cacheTtlSeconds: 60,
        },
    });
    writeJson(path.join(dataDir, 'audit_events.json'), [
        {
            id: 'audit-real-ip',
            ts: '2026-03-12T02:00:00.000Z',
            eventType: 'login_success',
            actor: 'alice',
            actorRole: 'user',
            ip: '203.0.113.8',
            method: 'POST',
            path: '/api/auth/login',
            outcome: 'success',
            resourceType: 'session',
            resourceId: 'session-1',
            serverId: '',
            targetEmail: 'alice@example.com',
            beforeSnapshot: null,
            afterSnapshot: null,
            details: {
                targetUserId: 'user-activity-1',
                userAgent: 'Mozilla/5.0',
            },
        },
        {
            id: 'audit-masked-ip',
            ts: '2026-03-12T03:00:00.000Z',
            eventType: 'user_updated',
            actor: 'admin',
            actorRole: 'admin',
            ip: 'ip_1b2b75909e944f4e',
            method: 'PUT',
            path: '/api/auth/users/user-activity-1',
            outcome: 'success',
            resourceType: 'user',
            resourceId: 'user-activity-1',
            serverId: '',
            targetEmail: 'alice@example.com',
            beforeSnapshot: null,
            afterSnapshot: null,
            details: {
                targetUserId: 'user-activity-1',
                userAgent: 'ua_1234567890abcdef',
            },
        },
    ]);

    t.after(async () => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const result = await runScenario('tests/helpers/usersRouteAuditEnrichmentScenario.js', {
        cwd: SERVER_ROOT,
        env: {
            NODE_ENV: 'test',
            DATA_DIR: dataDir,
            JWT_SECRET,
            ADMIN_USERNAME: 'admin',
            ADMIN_PASSWORD: 'Admin123!!',
            DB_ENABLED: 'false',
        },
    });

    assert.equal(result.detailResponse.statusCode, 200);
    const detailBody = result.detailResponse.body;
    assert.equal(detailBody.success, true);
    assert.equal(detailBody.obj.recentAudit.total, 2);

    const maskedEvent = detailBody.obj.recentAudit.items.find((item) => item.id === 'audit-masked-ip');
    assert.ok(maskedEvent);
    assert.equal(maskedEvent.ip, '');
    assert.equal(maskedEvent.ipMasked, true);
    assert.equal(maskedEvent.userAgent, '');
    assert.equal(maskedEvent.userAgentMasked, true);

    const realEvent = detailBody.obj.recentAudit.items.find((item) => item.id === 'audit-real-ip');
    assert.ok(realEvent);
    assert.equal(realEvent.ip, '203.0.113.8');
    assert.equal(realEvent.ipLocation, '中国 浙江 杭州 电信');
    assert.equal(realEvent.ipCarrier, '中国电信');
    assert.equal(realEvent.userAgent, 'Mozilla/5.0');
});
