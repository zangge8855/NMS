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
