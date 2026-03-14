import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import jwt from 'jsonwebtoken';

const SERVER_ROOT = path.resolve(process.cwd());
const JWT_SECRET = 'test-secret-key-for-users-detail-audit';

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, token, serverProc, getStderr) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (serverProc.exitCode !== null) {
            throw new Error(`Test server exited early: ${getStderr() || 'no stderr output'}`);
        }
        try {
            const response = await fetch(`${baseUrl}/api/auth/check`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (response.status === 200) {
                return;
            }
        } catch {
            // Server not ready yet.
        }
        await wait(200);
    }
    throw new Error('Timed out waiting for test server');
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('user detail activity includes audits produced by bulk enable/disable actions', async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-users-detail-audit-'));
    const testPort = 3400 + Math.floor(Math.random() * 1000);
    const baseUrl = `http://127.0.0.1:${testPort}`;

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

    const serverProc = spawn('node', ['index.js'], {
        cwd: SERVER_ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            PORT: String(testPort),
            DATA_DIR: dataDir,
            JWT_SECRET,
            ADMIN_USERNAME: 'admin',
            ADMIN_PASSWORD: 'Admin123!!',
            DB_ENABLED: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    serverProc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    const stopServer = async () => {
        if (serverProc.killed) return;
        serverProc.kill('SIGTERM');
        await Promise.race([
            new Promise((resolve) => serverProc.once('exit', resolve)),
            wait(3_000),
        ]);
        if (!serverProc.killed) {
            serverProc.kill('SIGKILL');
        }
    };

    t.after(async () => {
        await stopServer();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const token = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'admin' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    await waitForServer(baseUrl, token, serverProc, () => stderr);

    const bulkResponse = await fetch(`${baseUrl}/api/auth/users/bulk-set-enabled`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            userIds: ['user-activity-1'],
            enabled: false,
        }),
    });
    assert.equal(bulkResponse.status, 200, stderr);

    const detailResponse = await fetch(`${baseUrl}/api/users/user-activity-1/detail`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
    assert.equal(detailResponse.status, 200, stderr);
    const detailBody = await detailResponse.json();
    assert.equal(detailBody.success, true);
    assert.equal(detailBody.obj.recentAudit.total, 1);
    assert.equal(detailBody.obj.recentAudit.items[0].eventType, 'user_disabled');
    assert.equal(detailBody.obj.recentAudit.items[0].details.targetUserId, 'user-activity-1');
    assert.equal(detailBody.obj.recentAudit.items[0].details.viaBulkAction, true);
});
