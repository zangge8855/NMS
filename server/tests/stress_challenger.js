import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { saveObjectAtomic, saveObjectAtomicAsync } from '../store/fileUtils.js';
import notificationService, { SEVERITY } from '../lib/notifications.js';
import alertEngine from '../lib/alertEngine.js';
import userStore from '../store/userStore.js';
import userPolicyStore from '../store/userPolicyStore.js';
import trafficStatsStore from '../store/trafficStatsStore.js';
import auditStore from '../store/auditStore.js';
import systemSettingsStore from '../store/systemSettingsStore.js';
import { restoreStoreSnapshots, collectStoreSnapshots } from '../store/storeRegistry.js';

let TEMP_DIR;

before(() => {
    TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-stress-test-'));
});

after(() => {
    if (TEMP_DIR) {
        try {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        } catch {}
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 1: Atomic File Writes under High Parallel Concurrency
// ─────────────────────────────────────────────────────────────────────────────
test('STRESS 1.1: saveObjectAtomicAsync concurrent writes to the same file', async () => {
    const testFile = path.join(TEMP_DIR, 'concurrent_async_write.json');
    const CONCURRENCY = 50;

    const promises = Array.from({ length: CONCURRENCY }, (_, i) => {
        const payload = { iteration: i, timestamp: Date.now(), data: 'x'.repeat(100) };
        return saveObjectAtomicAsync(testFile, payload);
    });

    await Promise.all(promises);

    // Verify file exists and is valid JSON
    assert.ok(fs.existsSync(testFile));
    const content = fs.readFileSync(testFile, 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(typeof parsed.iteration === 'number');
    assert.equal(parsed.data, 'x'.repeat(100));

    // Verify no leftover .tmp files
    const files = fs.readdirSync(TEMP_DIR);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0);
});

test('STRESS 1.2: saveObjectAtomic synchronous rapid writes to the same file', () => {
    const testFile = path.join(TEMP_DIR, 'rapid_sync_write.json');
    const ITERATIONS = 100;

    for (let i = 0; i < ITERATIONS; i++) {
        saveObjectAtomic(testFile, { step: i, payload: `value_${i}` });
    }

    assert.ok(fs.existsSync(testFile));
    const parsed = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    assert.equal(parsed.step, ITERATIONS - 1);
    assert.equal(parsed.payload, `value_${ITERATIONS - 1}`);

    const files = fs.readdirSync(TEMP_DIR);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0);
});

test('STRESS 1.3: saveObjectAtomic error handling for invalid/null input', () => {
    const testFile = path.join(TEMP_DIR, 'invalid_write.json');
    assert.throws(() => saveObjectAtomic(testFile, null), /null or undefined/);
    assert.throws(() => saveObjectAtomic(testFile, undefined), /null or undefined/);
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 2: Notification System & Dedup under High Throughput
// ─────────────────────────────────────────────────────────────────────────────
test('STRESS 2.1: Rapid notification flood and debounced persistence', async () => {
    const COUNT = 200;
    notificationService.clearDedupCache();

    const notifications = [];
    for (let i = 0; i < COUNT; i++) {
        const res = notificationService.notify({
            type: `test_event_${i % 10}`,
            severity: i % 2 === 0 ? SEVERITY.WARNING : SEVERITY.INFO,
            title: `Stress Test Alert ${i}`,
            body: `Body content for alert ${i}`,
            dedupKey: `stress_key_${i}`, // Unique key to test throughput without dedup suppression
        });
        if (res) notifications.push(res);
    }

    assert.equal(notifications.length, COUNT);
    assert.ok(notificationService.unreadCount() > 0);

    // Test markAllRead under state
    const readCount = notificationService.markAllRead();
    assert.ok(readCount >= COUNT);
    assert.equal(notificationService.unreadCount(), 0);
});

test('STRESS 2.2: Notification dedup window suppression', () => {
    notificationService.clearDedupCache();
    const dedupKey = 'same_alert_key';

    const n1 = notificationService.notify({
        type: 'cpu_high',
        severity: SEVERITY.CRITICAL,
        title: 'CPU Usage High',
        body: 'CPU is at 99%',
        dedupKey,
    });
    assert.ok(n1 !== null);

    // Immediate second call should be suppressed
    const n2 = notificationService.notify({
        type: 'cpu_high',
        severity: SEVERITY.CRITICAL,
        title: 'CPU Usage High',
        body: 'CPU is at 99%',
        dedupKey,
    });
    assert.equal(n2, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 3: Store State & Race Condition Verification
// ─────────────────────────────────────────────────────────────────────────────
test('STRESS 3.1: Concurrent User Policy Store updates', async () => {
    const testEmail = 'stress_policy_user@example.com';
    const CONCURRENCY = 30;

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) => {
        return Promise.resolve().then(() => {
            userPolicyStore.upsert(testEmail, {
                allowedServerIds: [`server_${i}`],
                allowedProtocols: i % 2 === 0 ? ['vless'] : ['vmess'],
                serverScopeMode: i % 2 === 0 ? 'selected' : 'all',
            }, 'stress-runner');
        });
    });

    await Promise.all(tasks);

    const finalPolicy = userPolicyStore.get(testEmail);
    assert.ok(finalPolicy);
    assert.ok(Array.isArray(finalPolicy.allowedServerIds));
    assert.ok(Array.isArray(finalPolicy.allowedProtocols));
});

test('STRESS 3.2: Concurrent Audit Store logging', async () => {
    const CONCURRENCY = 100;

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) => {
        return Promise.resolve().then(() => {
            auditStore.appendEvent({
                event: `STRESS_EVENT_${i}`,
                actor: `actor_${i}`,
                outcome: i % 2 === 0 ? 'success' : 'failed',
                targetEmail: `user_${i}@example.com`,
                details: { index: i },
            });
        });
    });

    await Promise.all(tasks);

    const logs = auditStore.queryEvents({ pageSize: 200 });
    assert.ok(logs.items.length >= CONCURRENCY);
});

test('STRESS 3.3: Backup Snapshot Collection and Restoration State Consistency', async () => {
    const snapshotBefore = collectStoreSnapshots();
    assert.ok(typeof snapshotBefore === 'object');
    assert.ok(snapshotBefore.users);
    assert.ok(snapshotBefore.system_settings);

    // Perform backup restore
    const restoreResult = await restoreStoreSnapshots(snapshotBefore);
    assert.equal(restoreResult.failed, 0);
    assert.ok(restoreResult.restored > 0);

    const snapshotAfter = collectStoreSnapshots();
    assert.deepEqual(Object.keys(snapshotBefore), Object.keys(snapshotAfter));
});

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST 4: Live HTTP API Server High Concurrency Stress
// ─────────────────────────────────────────────────────────────────────────────
test('STRESS 4.1: Express Server API concurrent requests under heavy load', async () => {
    const serverPort = 28991;
    const nmsBaseUrl = `http://127.0.0.1:${serverPort}`;
    const dataDir = path.join(TEMP_DIR, 'nms-api-stress-data');
    fs.mkdirSync(dataDir, { recursive: true });

    const nmsProc = spawn('node', ['index.js'], {
        cwd: '/root/NMS/server',
        env: {
            ...process.env,
            PORT: String(serverPort),
            DATA_DIR: dataDir,
            JWT_SECRET: 'stress-test-jwt-secret-key-32-chars-min',
            CREDENTIALS_SECRET: 'stress-test-credentials-secret-key-32',
            ADMIN_USERNAME: 'stress-admin',
            ADMIN_PASSWORD: 'StressPassword123!!',
            DB_ENABLED: 'false',
            NODE_ENV: 'test',
        }
    });

    let procLogs = '';
    nmsProc.stderr.on('data', (d) => { procLogs += `[STDERR] ${d.toString()}\n`; });
    nmsProc.stdout.on('data', (d) => { procLogs += `[STDOUT] ${d.toString()}\n`; });

    let started = false;
    for (let i = 0; i < 40; i++) {
        try {
            const res = await fetch(`${nmsBaseUrl}/api/auth/registration-status`);
            if (res.status === 200) {
                started = true;
                break;
            }
        } catch {
            // wait
        }
        await new Promise(r => setTimeout(r, 250));
    }

    if (!started) {
        nmsProc.kill('SIGKILL');
        throw new Error(`Stress NMS server failed to start:\n${procLogs}`);
    }

    try {
        // Authenticate
        const loginRes = await fetch(`${nmsBaseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'stress-admin', password: 'StressPassword123!!' })
        });
        const loginJson = await loginRes.json();
        assert.equal(loginRes.status, 200);
        assert.ok(loginJson.token);
        const token = loginJson.token;

        // Launch 150 concurrent API requests across different routes
        const CONCURRENT_REQUESTS = 150;
        const requests = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => {
            const mod = i % 5;
            if (mod === 0) {
                return fetch(`${nmsBaseUrl}/api/servers`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } else if (mod === 1) {
                return fetch(`${nmsBaseUrl}/api/system/settings`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } else if (mod === 2) {
                return fetch(`${nmsBaseUrl}/api/user-policy/stress${i}@example.com`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } else if (mod === 3) {
                return fetch(`${nmsBaseUrl}/api/audit/events`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } else {
                return fetch(`${nmsBaseUrl}/api/auth/registration-status`);
            }
        });

        const responses = await Promise.all(requests);
        assert.equal(responses.length, CONCURRENT_REQUESTS);

        for (const res of responses) {
            assert.ok(res.status === 200 || res.status === 304, `Unexpected status code: ${res.status} for ${res.url}`);
        }
    } finally {
        nmsProc.kill('SIGTERM');
    }
});
