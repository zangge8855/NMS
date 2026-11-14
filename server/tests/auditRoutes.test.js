import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import app from '../index.js';
import userStore from '../store/userStore.js';
import auditStore from '../store/auditStore.js';
import { invokeApp } from './helpers/invokeApp.js';
import { resolveIpLookupTarget } from '../routes/audit.js';
import { runScenario } from './helpers/runScenario.js';

const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
const JWT_SECRET = 'test-secret-key-for-audit-routes';

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('audit CSV export applies all event filters', async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-audit-export-'));

    writeJson(path.join(dataDir, 'audit_events.json'), [
        {
            id: 'audit-match',
            ts: '2026-03-12T10:00:00.000Z',
            eventType: 'system_settings_updated',
            actor: 'admin',
            actorRole: 'admin',
            ip: '203.0.113.8',
            method: 'PATCH',
            path: '/api/system/settings',
            outcome: 'success',
            resourceType: 'settings',
            resourceId: 'system',
            serverId: 'server-a',
            targetEmail: 'alice@example.com',
            beforeSnapshot: null,
            afterSnapshot: null,
            details: {
                section: 'settings',
            },
        },
        {
            id: 'audit-other-server',
            ts: '2026-03-12T10:05:00.000Z',
            eventType: 'system_settings_updated',
            actor: 'admin',
            actorRole: 'admin',
            ip: '203.0.113.9',
            method: 'PATCH',
            path: '/api/system/settings',
            outcome: 'success',
            resourceType: 'settings',
            resourceId: 'system',
            serverId: 'server-b',
            targetEmail: 'alice@example.com',
            beforeSnapshot: null,
            afterSnapshot: null,
            details: {
                section: 'settings',
            },
        },
        {
            id: 'audit-other-actor',
            ts: '2026-03-12T10:10:00.000Z',
            eventType: 'system_settings_updated',
            actor: 'operator',
            actorRole: 'admin',
            ip: '203.0.113.10',
            method: 'PATCH',
            path: '/api/system/settings',
            outcome: 'success',
            resourceType: 'settings',
            resourceId: 'system',
            serverId: 'server-a',
            targetEmail: 'alice@example.com',
            beforeSnapshot: null,
            afterSnapshot: null,
            details: {
                section: 'settings',
            },
        },
    ]);

    t.after(async () => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const result = await runScenario(path.resolve(import.meta.dirname, 'helpers/auditExportScenario.js'), {
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

    assert.equal(result.statusCode, 200);
    assert.match(result.text, /system_settings_updated/);
    assert.match(result.text, /server-a/);
    assert.doesNotMatch(result.text, /server-b/);
    assert.doesNotMatch(result.text, /operator/);
});

test('resolveIpLookupTarget handles IPv6 brackets, ports, URLs, and DNS hostname resolution', async () => {
    const ipv6 = await resolveIpLookupTarget('[2001:0db8:0000:0000::1]:8443');
    assert.equal(ipv6.ip, '2001:db8::1');
    assert.equal(ipv6.host, '');
    assert.deepEqual(ipv6.resolvedIps, ['2001:db8::1']);

    const urlTarget = await resolveIpLookupTarget('https://[::ffff:127.0.0.1]:443/sub');
    assert.equal(urlTarget.ip, '127.0.0.1');

    const dnsResolved = await resolveIpLookupTarget('edge.example.com:8443', async (hostname) => {
        assert.equal(hostname, 'edge.example.com');
        return [
            { address: '2001:0db8::42', family: 6 },
            { address: '198.51.100.42', family: 4 },
        ];
    });
    assert.equal(dnsResolved.ip, '2001:db8::42');
    assert.equal(dnsResolved.host, 'edge.example.com');
    assert.deepEqual(dnsResolved.resolvedIps, ['2001:db8::42', '198.51.100.42']);

    await assert.rejects(
        () => resolveIpLookupTarget('invalid.missing.example', async () => []),
        /Unable to resolve hostname/
    );

    await assert.rejects(
        () => resolveIpLookupTarget('redis.internal', async () => [{ address: '10.0.0.5', family: 4 }]),
        /Refusing to resolve internal hostname/
    );

    await assert.rejects(
        () => resolveIpLookupTarget('rebind.example.com', async () => [{ address: '169.254.169.254', family: 4 }]),
        /Refusing to expose private or internal DNS resolution/
    );
});

test('POST /api/audit/ip-lookup normalizes IPv6 literals with ports', async () => {
    const auditor = userStore.add({
        username: `auditor_ip_${Date.now()}`,
        email: `auditor_ip_${Date.now()}@example.com`,
        password: 'AuditorPass123!',
        role: 'auditor',
        enabled: true,
        emailVerified: true,
    });
    const token = jwt.sign(
        { userId: auditor.id, role: auditor.role, username: auditor.username, tokenVersion: 1 },
        config.jwt.secret,
        { expiresIn: '1h' }
    );

    try {
        const res = await invokeApp(app, {
            method: 'POST',
            url: '/api/audit/ip-lookup',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: {
                ip: '[0:0:0:0:0:0:0:1]:443',
            },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.success, true);
        assert.equal(res.json.obj.ip, '::1');
        assert.equal(res.json.obj.ipLocation, '内网/本地');
    } finally {
        userStore.remove(auditor.id);
    }
});

test('GET /api/audit/events/export neutralizes CSV formulas and exports more than 200 rows', async () => {
    const admin = userStore.getByUsername(config.auth.adminUsername);
    const token = jwt.sign(
        { userId: admin.id, role: admin.role, username: admin.username, tokenVersion: admin.tokenVersion || 1 },
        config.jwt.secret,
        { expiresIn: '1h' }
    );
    const originalEvents = [...auditStore.events];
    const syntheticEvents = [
        {
            id: 'csv-inj-1',
            ts: new Date().toISOString(),
            eventType: '=CMD()',
            actor: '+ADMIN',
            ip: '198.51.100.1',
            method: 'GET',
            path: '@SUM(1,1)',
            outcome: 'success',
            targetEmail: '-bad@example.com',
            serverId: 'srv-1',
        },
        ...Array.from({ length: 220 }, (_, i) => ({
            id: `csv-row-${i}`,
            ts: new Date().toISOString(),
            eventType: 'login_success',
            actor: 'alice',
            ip: '198.51.100.2',
            method: 'POST',
            path: '/api/auth/login',
            outcome: 'success',
            targetEmail: `user${i}@example.com`,
            serverId: 'srv-1',
        })),
    ];
    auditStore.events = syntheticEvents;

    try {
        const result = await invokeApp(app, {
            method: 'GET',
            url: '/api/audit/events/export',
            headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(result.statusCode, 200);
        assert.match(result.text, /"'=CMD\(\)"/);
        assert.match(result.text, /"'\+ADMIN"/);
        assert.match(result.text, /"'@SUM\(1,1\)"/);
        assert.match(result.text, /"'-bad@example\.com"/);
        const lineCount = result.text.trim().split(/\r?\n/).length;
        assert.equal(lineCount, 222);
    } finally {
        auditStore.events = originalEvents;
    }
});
