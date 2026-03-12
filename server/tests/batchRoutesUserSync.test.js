import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import jwt from 'jsonwebtoken';

const SERVER_ROOT = path.resolve(process.cwd());
const JWT_SECRET = 'test-secret-key-for-batch-routes';

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

function seedDataDir(dataDir) {
    const subscriptionEmail = 'retry-sub@example.com';
    writeJson(path.join(dataDir, 'users.json'), [
        {
            id: 'user-retry-1',
            username: 'retry-user',
            email: 'retry-user@example.com',
            subscriptionEmail,
            role: 'user',
            enabled: true,
            emailVerified: true,
            createdAt: '2026-03-12T00:00:00.000Z',
        },
    ]);
    writeJson(path.join(dataDir, 'servers.json'), [
        {
            id: 'srv-1',
            name: 'Node A',
            url: 'http://127.0.0.1:9',
            basePath: '/',
            username: 'panel-admin',
            password: 'panel-password',
        },
        {
            id: 'srv-2',
            name: 'Node B',
            url: 'http://127.0.0.1:9',
            basePath: '/',
            username: 'panel-admin',
            password: 'panel-password',
        },
    ]);
    writeJson(path.join(dataDir, 'user_policies.json'), {
        [subscriptionEmail]: {
            allowedServerIds: ['srv-1', 'srv-2'],
            allowedProtocols: ['vless'],
            allowedInboundKeys: [],
            serverScopeMode: 'selected',
            protocolScopeMode: 'selected',
            expiryTime: 0,
            limitIp: 0,
            trafficLimitBytes: 0,
            updatedAt: '2026-03-12T00:00:00.000Z',
            updatedBy: 'tester',
        },
    });
    writeJson(path.join(dataDir, 'jobs.json'), [
        {
            id: '00000000-0000-4000-8000-000000000123',
            type: 'user_sync',
            action: 'set_enabled',
            status: 'partial_success',
            createdAt: '2026-03-12T00:00:00.000Z',
            updatedAt: '2026-03-12T00:00:00.000Z',
            actor: 'tester',
            summary: {
                total: 2,
                success: 1,
                failed: 1,
            },
            results: [
                {
                    success: true,
                    retriable: false,
                    stage: 'client_toggle',
                    userId: 'user-retry-1',
                    username: 'retry-user',
                    subscriptionEmail,
                    enabled: true,
                    serverId: 'srv-1',
                    serverName: 'Node A',
                    inboundId: null,
                    inboundRemark: '',
                    protocol: '',
                    msg: 'already-enabled',
                },
                {
                    success: false,
                    retriable: true,
                    stage: 'client_toggle',
                    userId: 'user-retry-1',
                    username: 'retry-user',
                    subscriptionEmail,
                    enabled: true,
                    serverId: 'srv-2',
                    serverName: 'Node B',
                    inboundId: null,
                    inboundRemark: '',
                    protocol: '',
                    msg: 'Auth failed',
                },
            ],
            request: {
                operation: 'set_enabled',
                userId: 'user-retry-1',
            },
            retryOf: null,
            canceledAt: null,
            risk: null,
            retryStrategy: null,
            failureGroups: [
                {
                    key: 'srv-2|Auth failed',
                    serverId: 'srv-2',
                    serverName: 'Node B',
                    error: 'Auth failed',
                    count: 1,
                },
            ],
        },
    ]);
}

test('POST /api/jobs/:id/retry retries only failed user sync targets and writes retry history', async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-batch-user-sync-'));
    const testPort = 3200 + Math.floor(Math.random() * 1000);
    const baseUrl = `http://127.0.0.1:${testPort}`;
    seedDataDir(dataDir);

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

    const response = await fetch(`${baseUrl}/api/jobs/00000000-0000-4000-8000-000000000123/retry`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            failedOnly: true,
        }),
    });

    assert.equal(response.status, 207, stderr);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.obj.retriedFrom, '00000000-0000-4000-8000-000000000123');
    assert.equal(body.obj.failedOnly, true);
    assert.equal(body.obj.summary.total, 1);
    assert.equal(body.obj.summary.failed, 1);
    assert.equal(body.obj.results.length, 1);
    assert.equal(body.obj.results[0].serverId, 'srv-2');
    assert.equal(body.obj.results[0].stage, 'client_toggle');
    assert.match(body.obj.results[0].msg, /authenticate with panel/i);

    const historyResponse = await fetch(`${baseUrl}/api/jobs?page=1&pageSize=10&includeResults=true`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
    assert.equal(historyResponse.status, 200, stderr);
    const historyBody = await historyResponse.json();
    assert.equal(historyBody.obj.total, 2);
    assert.equal(historyBody.obj.items[0].retryOf, '00000000-0000-4000-8000-000000000123');
    assert.equal(historyBody.obj.items[0].summary.total, 1);
    assert.equal(historyBody.obj.items[0].results.length, 1);
    assert.equal(historyBody.obj.items[0].results[0].serverId, 'srv-2');
});
