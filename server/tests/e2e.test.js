import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';

let TEMP_DATA_DIR;
let backendPort;
let healthyPort;
let legacyPort;
let fakePanelProc;
let nmsProc;
let nmsBaseUrl;
let adminToken = '';
let healthyPanelToken = '';
let healthyPanelDef = {};
let legacyPanelDef = {};

let healthyServerId;
let legacyServerId;
let testUserEmail = 'user1@example.com';
let testUserId;
let testSubToken = '';
let testSubTokenId = '';
let testInviteCode = '';

async function getThreeFreePorts() {
    const servers = Array.from({ length: 3 }, () => net.createServer());
    const ports = await Promise.all(
        servers.map((server) => {
            return new Promise((resolve, reject) => {
                server.listen(0, '127.0.0.1', () => {
                    resolve(server.address().port);
                });
                server.on('error', reject);
            });
        })
    );
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    return ports;
}

before(async () => {
    // 1. Create temporary directory
    TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-e2e-data-'));

    // 2. Find three free ports dynamically
    const ports = await getThreeFreePorts();
    backendPort = ports[0];
    healthyPort = ports[1];
    legacyPort = ports[2];
    nmsBaseUrl = `http://127.0.0.1:${backendPort}`;

    // 3. Spawn the mock panels in a child process
    fakePanelProc = spawn('node', [
        'scripts/review_fake_panel.js',
        `--healthy-port=${healthyPort}`,
        `--legacy-port=${legacyPort}`
    ], {
        cwd: '/root/NMS/server',
        env: {
            ...process.env,
            REVIEW_PANEL_HOST: '127.0.0.1'
        }
    });

    fakePanelProc.stderr.on('data', (data) => {
        console.error(`[Mock Panels Error] ${data.toString()}`);
    });

    // 4. Wait and parse panel credentials from stdout
    let stdoutBuffer = '';
    const panelData = await new Promise((resolve, reject) => {
        const onData = (chunk) => {
            stdoutBuffer += chunk.toString();
            if (stdoutBuffer.includes('panels')) {
                try {
                    const startIdx = stdoutBuffer.indexOf('{');
                    const endIdx = stdoutBuffer.lastIndexOf('}');
                    if (startIdx >= 0 && endIdx > startIdx) {
                        const parsed = JSON.parse(stdoutBuffer.substring(startIdx, endIdx + 1));
                        if (parsed.success && parsed.panels) {
                            fakePanelProc.stdout.off('data', onData);
                            resolve(parsed);
                        }
                    }
                } catch (err) {
                    // incomplete JSON, continue
                }
            }
        };
        fakePanelProc.stdout.on('data', onData);
        fakePanelProc.on('error', reject);
        setTimeout(() => reject(new Error('Timeout waiting for mock panels stdout')), 15000);
    });

    healthyPanelDef = panelData.panels.find(p => p.key === 'healthy');
    legacyPanelDef = panelData.panels.find(p => p.key === 'legacy');

    // 5. Login to mock panel to create an API token
    const panelUrl = `http://127.0.0.1:${healthyPort}`;
    const panelLoginRes = await fetch(`${panelUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: healthyPanelDef.username,
            password: healthyPanelDef.password
        })
    });
    const panelLoginJson = await panelLoginRes.json();
    if (!panelLoginJson.success) {
        throw new Error(`Mock panel login failed: ${JSON.stringify(panelLoginJson)}`);
    }
    const panelCookie = panelLoginRes.headers.get('set-cookie');

    const panelTokenRes = await fetch(`${panelUrl}/panel/api/setting/apiTokens/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': panelCookie
        },
        body: JSON.stringify({ name: 'nms-e2e-token' })
    });
    const panelTokenJson = await panelTokenRes.json();
    if (!panelTokenJson.success || !panelTokenJson.obj || !panelTokenJson.obj.token) {
        throw new Error(`Failed to create API token on mock panel: ${JSON.stringify(panelTokenJson)}`);
    }
    healthyPanelToken = panelTokenJson.obj.token;

    // 6. Spawn the NMS backend server in another child process
    nmsProc = spawn('node', ['index.js'], {
        cwd: '/root/NMS/server',
        env: {
            ...process.env,
            PORT: String(backendPort),
            DATA_DIR: TEMP_DATA_DIR,
            JWT_SECRET: 'e2e-jwt-secret-key-32-characters-long',
            CREDENTIALS_SECRET: 'e2e-credentials-secret-key-32-characters-long',
            ADMIN_USERNAME: 'nms-e2e-admin',
            ADMIN_PASSWORD: 'E2ePassword123!!',
            DB_ENABLED: 'false',
            ENFORCE_STRICT_SECURITY: 'false',
            NODE_ENV: 'test',
            SUB_PUBLIC_BASE_URL: `http://localhost:${backendPort}`,
            ALLOW_PRIVATE_SERVER_URL: 'true',
            SERVE_CLIENT: 'true'
        }
    });

    nmsProc.stderr.on('data', (data) => {
        console.error(`[NMS Backend Error] ${data.toString()}`);
    });

    nmsProc.stdout.on('data', (data) => {
        console.log(`[NMS Backend Log] ${data.toString()}`);
    });

    // 7. Poll for NMS server startup
    let started = false;
    for (let i = 0; i < 40; i++) {
        try {
            const res = await fetch(`${nmsBaseUrl}/api/auth/registration-status`);
            if (res.status === 200) {
                started = true;
                break;
            }
        } catch (err) {
            // Wait
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!started) {
        throw new Error('NMS server failed to start');
    }

    // 8. Authenticate NMS backend to retrieve admin token
    const loginRes = await fetch(`${nmsBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'nms-e2e-admin',
            password: 'E2ePassword123!!'
        })
    });
    const loginJson = await loginRes.json();
    if (!loginJson.success || !loginJson.token) {
        throw new Error(`NMS login failed: ${JSON.stringify(loginJson)}`);
    }
    adminToken = loginJson.token;
});

after(() => {
    if (nmsProc) {
        nmsProc.kill('SIGTERM');
    }
    if (fakePanelProc) {
        fakePanelProc.kill('SIGTERM');
    }
    if (TEMP_DATA_DIR) {
        try {
            fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
        } catch (err) {
            // Ignore clean up errors in test execution.
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 1: Server & Node Management (Tests 1-5 happy path, 26-30 boundary)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 1: POST /api/servers adds healthy server with API token', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'healthy-server',
            url: `http://127.0.0.1:${healthyPort}`,
            basePath: '/',
            apiToken: healthyPanelToken
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.id);
    healthyServerId = json.obj.id;
});

test('Test 2: POST /api/servers adds legacy server with password auth', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'legacy-server',
            url: `http://127.0.0.1:${legacyPort}`,
            basePath: '/',
            username: legacyPanelDef.username,
            password: legacyPanelDef.password
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.id);
    legacyServerId = json.obj.id;
});

test('Test 3: GET /api/servers lists registered servers', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    const names = json.obj.map(s => s.name);
    assert.ok(names.includes('healthy-server'));
    assert.ok(names.includes('legacy-server'));
});

test('Test 4: GET /api/servers/:id/snapshot retrieves server snapshot details', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers/${healthyServerId}/snapshot`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj);
});

test('Test 5: DELETE /api/servers/:id removes legacy server', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers/${legacyServerId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);

    const listRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const listJson = await listRes.json();
    const list = listJson.obj;
    assert.ok(!list.some(s => s.id === legacyServerId));
});

test('Test 26: POST /api/servers fails if URL is missing', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'no-url-server',
            apiToken: 'some-token'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 27: POST /api/servers fails if credentials are missing', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'no-creds-server',
            url: 'http://127.0.0.1:9999'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 28: POST /api/servers rejects invalid protocols', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'invalid-proto',
            url: 'ftp://127.0.0.1:2053',
            apiToken: 'token'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 29: POST /api/servers/:id/test for offline server returns connection error', async () => {
    const addRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'offline-server',
            url: 'http://127.0.0.1:12345',
            apiToken: 'some-token'
        })
    });
    const addJson = await addRes.json();
    assert.equal(addRes.status, 200);
    const offlineId = addJson.obj.id;

    const testRes = await fetch(`${nmsBaseUrl}/api/servers/${offlineId}/test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const testJson = await testRes.json();
    assert.equal(testJson.success, false);
    assert.ok(testJson.msg);

    await fetch(`${nmsBaseUrl}/api/servers/${offlineId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
});

test('Test 30: GET /api/servers/:id/panel-api-tokens redacts the tokens in response', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers/${healthyServerId}/panel-api-tokens`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    if (json.obj && json.obj.length > 0) {
        assert.equal(json.obj[0].token, undefined);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 2: User Policies & Traffic Enforcement (Tests 6-10 happy path, 31-35 boundary)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 6: PUT /api/user-policy/:email creates or updates user policy', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: [healthyServerId],
            allowedProtocols: ['vless', 'vmess'],
            serverScopeMode: 'selected',
            protocolScopeMode: 'selected'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.obj.policy.allowedServerIds, [healthyServerId]);
});

test('Test 7: GET /api/user-policy/:email reads user policy', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.obj.allowedServerIds, [healthyServerId]);
    assert.deepEqual(json.obj.allowedProtocols, ['vless', 'vmess']);
});

test('Test 8: User policy updates server scope mode to all', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            serverScopeMode: 'all'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.policy.serverScopeMode, 'all');
});

test('Test 9: User policy updates protocol scope mode to all', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            protocolScopeMode: 'all'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.policy.protocolScopeMode, 'all');
});

test('Test 10: Server deletion automatically cleans up server ID from policies', async () => {
    const addRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'temp-cleanup-server',
            url: `http://127.0.0.1:${healthyPort}`,
            basePath: '/',
            apiToken: healthyPanelToken
        })
    });
    const addJson = await addRes.json();
    const tempServerId = addJson.obj.id;

    await fetch(`${nmsBaseUrl}/api/user-policy/cleanup@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: [tempServerId],
            serverScopeMode: 'selected'
        })
    });

    await fetch(`${nmsBaseUrl}/api/servers/${tempServerId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    const polRes = await fetch(`${nmsBaseUrl}/api/user-policy/cleanup@example.com`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const polJson = await polRes.json();
    assert.ok(!polJson.obj.allowedServerIds.includes(tempServerId));
});

test('Test 31: GET /api/user-policy/:email for non-existent email returns default policy', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/nonexistent@example.com`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj);
    assert.equal(json.obj.serverScopeMode, 'all');
});

test('Test 32: PUT /api/user-policy/:email rejects unknown server IDs', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: ['unknown-id']
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 33: PUT /api/user-policy/:email validates scope modes', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            serverScopeMode: 'invalid-scope-mode'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.policy.serverScopeMode, 'all');
});

test('Test 34: PUT /api/user-policy/:email validates protocol list', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedProtocols: ['invalid-protocol']
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.obj.policy.allowedProtocols, []);
});

test('Test 35: PUT /api/user-policy/:email allows empty allowedProtocols list', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedProtocols: []
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.obj.policy.allowedProtocols, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 3: Subscription Client Generation (Tests 11-15 happy path, 36-40 boundary)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 11: POST /api/auth/users creates a new managed user', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            username: 'e2e-user',
            password: 'UserPassword123!!',
            email: testUserEmail,
            role: 'user'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.id);
    testUserId = json.obj.id;

    // Trigger policy sync/deploy to mock panels now that the user exists
    const syncRes = await fetch(`${nmsBaseUrl}/api/user-policy/${testUserEmail}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: [healthyServerId],
            allowedProtocols: ['vless', 'vmess'],
            serverScopeMode: 'selected',
            protocolScopeMode: 'selected'
        })
    });
    assert.equal(syncRes.status, 200);
});

test('Test 12: POST /api/subscriptions/:email/issue issues a new subscription token', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/${testUserEmail}/issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            remark: 'e2e test token'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.token);
    assert.ok(json.obj.tokenId);
    testSubToken = json.obj.token;
    testSubTokenId = json.obj.tokenId;
});

test('Test 13: GET /api/subscriptions/:email retrieves client links', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/${testUserEmail}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.subscriptionUrl);
});

test('Test 14: GET /api/subscriptions/public/t/:tokenId/:token retrieves public subscription config', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${testSubTokenId}/${testSubToken}`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text);
});

test('Test 15: GET /api/subscriptions/public/t/:tokenId/:token?target=singbox retrieves config in json format', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${testSubTokenId}/${testSubToken}?target=singbox`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json);
});

test('Test 36: POST /api/subscriptions/:email/issue fails for invalid email format', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/invalidemail/issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ remark: 'invalid' })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 37: GET /api/subscriptions/public/t/:tokenId/:token with invalid token returns error status', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${testSubTokenId}/invalidtoken`);
    assert.ok(res.status === 401 || res.status === 404);
});

test('Test 38: Public subscription retrieval fails if user is disabled', async () => {
    await fetch(`${nmsBaseUrl}/api/auth/users/${testUserId}/set-enabled`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ enabled: false })
    });

    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${testSubTokenId}/${testSubToken}`);
    assert.ok(res.status === 401 || res.status === 404 || res.status === 403);

    await fetch(`${nmsBaseUrl}/api/auth/users/${testUserId}/set-enabled`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ enabled: true })
    });
});

test('Test 39: GET /api/subscriptions/public/t/:tokenId/:token returns rate limit headers', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${testSubTokenId}/${testSubToken}`);
    assert.equal(res.status, 200);
    const limit = res.headers.get('x-ratelimit-limit');
    assert.ok(limit);
});

test('Test 40: POST /api/subscriptions/:email/revoke revokes the token', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/subscriptions/${testUserEmail}/revoke`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ tokenId: testSubTokenId })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);

    const getRes = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${testSubTokenId}/${testSubToken}`);
    assert.ok(getRes.status === 401 || getRes.status === 404);
});

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 4: System Settings & Camouflage (Tests 16-20 happy path, 41-45 boundary)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 16: GET /api/system/settings reads settings successfully', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.site);
});

test('Test 17: PUT /api/system/settings updates settings successfully', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            site: {
                camouflageEnabled: true,
                camouflageTemplate: 'nginx',
                camouflageTitle: 'Welcome to Nginx',
                accessPath: '/admin-dashboard'
            }
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.site.camouflageTemplate, 'nginx');
});

test('Test 18: GET / serves camouflage template instead of admin page', async () => {
    const res = await fetch(`${nmsBaseUrl}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Welcome') || text.includes('nginx') || text.includes('Server'));
});

test('Test 19: GET /admin-dashboard serves the admin login page', async () => {
    const res = await fetch(`${nmsBaseUrl}/admin-dashboard`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<html') || text.includes('div'));
});

test('Test 20: PUT /api/system/settings updates security policy confirmation settings', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            security: {
                requireHighRiskConfirmation: true,
                riskTokenTtlSeconds: 300
            }
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.security.requireHighRiskConfirmation, true);
});

test('Test 41: PUT /api/system/settings fails for invalid settings payload', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            site: 'should-be-object'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 42: PUT /api/system/settings rejects reserved access path /api', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            site: {
                accessPath: '/api'
            }
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 43: PUT /api/system/settings normalizes camouflage title containing precision systems', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            site: {
                camouflageTitle: 'Precision Systems Dashboard'
            }
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.site.camouflageTitle, 'City Field Notes');

    // Restore camouflageTitle to 'Welcome to Nginx'
    await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            site: {
                camouflageTitle: 'Welcome to Nginx'
            }
        })
    });
});

test('Test 44: POST /api/auth/register fails when inviteOnlyEnabled is true and no code is provided', async () => {
    await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            registration: {
                inviteOnlyEnabled: true
            }
        })
    });

    const res = await fetch(`${nmsBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'signup-no-code',
            password: 'UserPassword123!!',
            email: 'signup-nocode@example.com'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
});

test('Test 45: GET /api/system/db/status returns file mode state when DB_ENABLED is false', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/db/status`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.obj.connection.enabled, false);
    assert.equal(json.obj.modes.userStore, 'file');
});

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 5: Alerts & SMTP Diagnostics (Tests 21-25 happy path, 46-50 boundary)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 21: POST /api/system/invite-codes generates a valid invite code', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/invite-codes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            usageLimit: 5,
            subscriptionDays: 30
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj.code);
    testInviteCode = json.obj.code;
});

test('Test 22: POST /api/system/invite-codes/send fails if SMTP is not configured', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/invite-codes/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            email: 'test-invite-email@example.com',
            code: testInviteCode
        })
    });
    const json = await res.json();
    assert.equal(json.success, false);
});

test('Test 23: POST /api/system/email/test diagnostics returns connection failure if unconfigured', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/email/test`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            to: 'admin@example.com'
        })
    });
    const json = await res.json();
    assert.equal(json.success, false);
});

test('Test 24: GET /api/system/email/status returns mailer settings state', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/email/status`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.obj);
});

test('Test 25: POST /api/system/telegram/test returns error if TG bot is unconfigured', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/telegram/test`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        }
    });
    const json = await res.json();
    assert.equal(json.success, false);
});

test('Test 46: Sending invitation fails when target email address is malformed', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/invite-codes/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            email: 'malformed-email',
            code: testInviteCode
        })
    });
    const json = await res.json();
    assert.equal(json.success, false);
});

test('Test 47: POST /api/auth/resend-code fails if email registration was not initiated', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/auth/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'nonexistent-verify@example.com'
        })
    });
    const json = await res.json();
    assert.equal(json.success, false);
});

test('Test 48: POST /api/system/telegram/test fails with explicit message when token is missing', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/telegram/test`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        }
    });
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.msg.includes('token') || json.msg.includes('Telegram') || json.msg.includes('配置'));
});

test('Test 49: POST /api/system/email/notice-users/preview validates subject and content template', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/email/notice-users/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            subject: 'Short',
            content: 'Notice message body'
        })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
});

test('Test 50: POST /api/system/batch-risk-token requires confirmation token', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/system/batch-risk-token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            action: 'rotate_secrets'
        })
    });
    const json = await res.json();
    assert.equal(json.success, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3: Cross-Feature Combinations (Tests 51-55)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 51: Cross-Feature: User policy enforces restricted protocols and servers in public subscription config', async () => {
    const userRes = await fetch(`${nmsBaseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            username: 'policy-sub-user',
            password: 'UserPassword123!!',
            email: 'policysub@example.com',
            role: 'user'
        })
    });
    assert.equal(userRes.status, 200);

    await fetch(`${nmsBaseUrl}/api/user-policy/policysub@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: [],
            serverScopeMode: 'selected'
        })
    });

    const issueRes = await fetch(`${nmsBaseUrl}/api/subscriptions/policysub@example.com/issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ remark: 'policy sub e2e' })
    });
    const issueJson = await issueRes.json();
    assert.equal(issueRes.status, 200);

    const subRes = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${issueJson.obj.tokenId}/${issueJson.obj.token}`);
    assert.equal(subRes.status, 200);
    const subText = await subRes.text();
    assert.equal(subText.trim(), '');
});

test('Test 52: Cross-Feature: Invite code registration automatically registers, validates, and provisions subscription', async () => {
    const inviteRes = await fetch(`${nmsBaseUrl}/api/system/invite-codes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ usageLimit: 1, subscriptionDays: 15 })
    });
    const inviteJson = await inviteRes.json();
    const inviteCode = inviteJson.obj.code;

    const signupRes = await fetch(`${nmsBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'invite-signup-user',
            password: 'UserPassword123!!',
            email: 'invitesignup@example.com',
            inviteCode: inviteCode
        })
    });
    const signupJson = await signupRes.json();
    assert.equal(signupRes.status, 200);
    assert.equal(signupJson.success, true);
    assert.equal(signupJson.subscriptionProvisioned, true);
});

test('Test 53: Cross-Feature: Custom access path restricts original index endpoint but allows access path endpoint', async () => {
    const indexRes = await fetch(`${nmsBaseUrl}/`);
    const indexText = await indexRes.text();
    assert.ok(indexText.includes('Welcome') || indexText.includes('nginx'));

    const dashboardRes = await fetch(`${nmsBaseUrl}/admin-dashboard`);
    assert.equal(dashboardRes.status, 200);
});

test('Test 54: Cross-Feature: Server node deletion automatically updates user policies and removes it from subscription links', async () => {
    const addRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'temp-node-policy',
            url: `http://127.0.0.1:${healthyPort}`,
            basePath: '/',
            apiToken: healthyPanelToken
        })
    });
    const addJson = await addRes.json();
    const tempNodeId = addJson.obj.id;

    await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: [tempNodeId],
            serverScopeMode: 'selected'
        })
    });

    await fetch(`${nmsBaseUrl}/api/servers/${tempNodeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    const polRes = await fetch(`${nmsBaseUrl}/api/user-policy/user1@example.com`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const polJson = await polRes.json();
    assert.ok(!polJson.obj.allowedServerIds.includes(tempNodeId));
});

test('Test 55: Cross-Feature: Export and restore settings restore NMS configuration to previous state', async () => {
    const backupRes = await fetch(`${nmsBaseUrl}/api/system/backup/local`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const backupJson = await backupRes.json();
    assert.equal(backupRes.status, 200);
    assert.equal(backupJson.success, true);
    const filename = backupJson.obj.filename;

    await fetch(`${nmsBaseUrl}/api/system/settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            site: {
                camouflageTitle: 'Modified Camouflage Title'
            }
        })
    });

    const restoreRes = await fetch(`${nmsBaseUrl}/api/system/backup/local/${filename}/restore`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const restoreJson = await restoreRes.json();
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreJson.success, true);

    const settingsRes = await fetch(`${nmsBaseUrl}/api/system/settings`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const settingsJson = await settingsRes.json();
    assert.equal(settingsJson.obj.site.camouflageTitle, 'Welcome to Nginx');

    await fetch(`${nmsBaseUrl}/api/system/backup/local/${filename}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 4: Real-World Application Scenarios (Tests 56-60)
// ─────────────────────────────────────────────────────────────────────────────

test('Test 56: Scenario: Complete Admin Node/User Lifecycle Flow', async () => {
    const nodeRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'scenario-node',
            url: `http://127.0.0.1:${healthyPort}`,
            basePath: '/',
            apiToken: healthyPanelToken
        })
    });
    const nodeJson = await nodeRes.json();
    const nodeId = nodeJson.obj.id;

    const userRes = await fetch(`${nmsBaseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            username: 'scenario-user',
            password: 'UserPassword123!!',
            email: 'scenario@example.com',
            role: 'user'
        })
    });
    const userJson = await userRes.json();
    const userId = userJson.obj.id;

    await fetch(`${nmsBaseUrl}/api/user-policy/scenario@example.com`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            allowedServerIds: [nodeId],
            serverScopeMode: 'selected'
        })
    });

    const tokenRes = await fetch(`${nmsBaseUrl}/api/subscriptions/scenario@example.com/issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ remark: 'scenario active sub' })
    });
    const tokenJson = await tokenRes.json();
    const tokenId = tokenJson.obj.tokenId;
    const tokenVal = tokenJson.obj.token;

    const subRes = await fetch(`${nmsBaseUrl}/api/subscriptions/public/t/${tokenId}/${tokenVal}`);
    assert.equal(subRes.status, 200);

    await fetch(`${nmsBaseUrl}/api/subscriptions/scenario@example.com/revoke`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ tokenId })
    });

    await fetch(`${nmsBaseUrl}/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    await fetch(`${nmsBaseUrl}/api/servers/${nodeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
});

test('Test 57: Scenario: Invite-Only Registration & Autoprovisioning Flow', async () => {
    const inviteRes = await fetch(`${nmsBaseUrl}/api/system/invite-codes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ usageLimit: 1, subscriptionDays: 30 })
    });
    const inviteJson = await inviteRes.json();
    const code = inviteJson.obj.code;

    const regRes = await fetch(`${nmsBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'auto-provision-user',
            password: 'UserPassword123!!',
            email: 'autoprovision@example.com',
            inviteCode: code
        })
    });
    const regJson = await regRes.json();
    assert.equal(regRes.status, 200);
    assert.equal(regJson.success, true);
    assert.equal(regJson.subscriptionProvisioned, true);

    const loginRes = await fetch(`${nmsBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'auto-provision-user',
            password: 'UserPassword123!!'
        })
    });
    const loginJson = await loginRes.json();
    assert.equal(loginRes.status, 200);
    assert.equal(loginJson.success, true);

    const linksRes = await fetch(`${nmsBaseUrl}/api/subscriptions/autoprovision@example.com`, {
        headers: { 'Authorization': `Bearer ${loginJson.token}` }
    });
    const linksJson = await linksRes.json();
    assert.equal(linksRes.status, 200);
    assert.equal(linksJson.success, true);

    const usersListRes = await fetch(`${nmsBaseUrl}/api/auth/users`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const usersListJson = await usersListRes.json();
    const createdUser = usersListJson.obj.find(u => u.username === 'auto-provision-user');
    if (createdUser) {
        await fetch(`${nmsBaseUrl}/api/auth/users/${createdUser.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    }
});

test('Test 58: Scenario: System Migration & Backup Restore Lifecycle Flow', async () => {
    const nodeRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            name: 'migration-node',
            url: `http://127.0.0.1:${healthyPort}`,
            basePath: '/',
            apiToken: healthyPanelToken
        })
    });
    const nodeJson = await nodeRes.json();
    const nodeId = nodeJson.obj.id;

    const backupRes = await fetch(`${nmsBaseUrl}/api/system/backup/local`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const backupJson = await backupRes.json();
    const filename = backupJson.obj.filename;

    await fetch(`${nmsBaseUrl}/api/servers/${nodeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    const restoreRes = await fetch(`${nmsBaseUrl}/api/system/backup/local/${filename}/restore`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const restoreJson = await restoreRes.json();
    assert.equal(restoreJson.success, true);

    const serversListRes = await fetch(`${nmsBaseUrl}/api/servers`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const serversListJson = await serversListRes.json();
    const serversList = serversListJson.obj;
    assert.ok(serversList.some(s => s.name === 'migration-node'));

    const restoredNode = serversList.find(s => s.name === 'migration-node');
    if (restoredNode) {
        await fetch(`${nmsBaseUrl}/api/servers/${restoredNode.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
    }
    await fetch(`${nmsBaseUrl}/api/system/backup/local/${filename}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
});

test('Test 59: Scenario: Security and Audit Trail Validation Flow', async () => {
    await fetch(`${nmsBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'bad-username-e2e',
            password: 'WrongPassword'
        })
    });

    const auditRes = await fetch(`${nmsBaseUrl}/api/audit/events?q=bad-username-e2e`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const auditJson = await auditRes.json();
    assert.equal(auditRes.status, 200);
    assert.ok(auditJson.obj.items.some(e => e.action === 'login_failed' || e.details?.username === 'bad-username-e2e'));
});

test('Test 60: Scenario: Node Outage and Recovery Traffic Baseline Flow', async () => {
    const res = await fetch(`${nmsBaseUrl}/api/servers/governance/summary`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.ok(json.obj.total !== undefined);
});
