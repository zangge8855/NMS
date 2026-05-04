import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runScenario } from './helpers/runScenario.js';

const SERVER_ROOT = path.resolve(process.cwd());
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

    const result = await runScenario('tests/helpers/auditExportScenario.js', {
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
