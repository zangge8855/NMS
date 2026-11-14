import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';
import { invokeApp } from './helpers/invokeApp.js';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-batch5-hardening-'));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = 'test';

const { default: app } = await import('../index.js');
const { default: config } = await import('../config.js');
const { default: userStore, ROLES } = await import('../store/userStore.js');
const { default: taskQueue } = await import('../lib/taskQueue.js');
const { default: notificationService } = await import('../lib/notifications.js');

const CERT_STORE_URL = pathToFileURL(path.resolve(import.meta.dirname, '../store/certificateStore.ts')).href;

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

test.after(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('certificateStore fails closed on corrupt or non-array certificates.json', () => {
    const scenarios = [
        { name: 'corrupt JSON', payload: '{not-valid-json' },
        { name: 'non-array JSON', payload: JSON.stringify({ items: [] }) },
    ];

    for (const scenario of scenarios) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-cert-fail-closed-'));
        try {
            fs.writeFileSync(path.join(dir, 'certificates.json'), scenario.payload, 'utf8');
            const script = `await import(${JSON.stringify(CERT_STORE_URL)});`;
            const res = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
                env: {
                    ...process.env,
                    DATA_DIR: dir,
                    NODE_ENV: 'test',
                },
                encoding: 'utf8',
            });
            assert.notEqual(res.status, 0, `expected ${scenario.name} to fail closed on load`);
            assert.match(res.stderr || '', /certificates\.json|JSON|SyntaxError/i);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('DELETE /api/system/tasks/:taskId blocks operators from cancelling admin-only or foreign tasks', async () => {
    const opUsername = `op_task_${Date.now()}`;
    const opUser = userStore.add({
        username: opUsername,
        password: 'OpTaskUser#123',
        role: ROLES.operator,
    });
    const adminUser = userStore.getByUsername('admin') || userStore.getAll().find((u) => u.role === ROLES.admin);
    assert.ok(adminUser);

    const backfillTask = taskQueue.create({ type: 'db_backfill', title: 'Backfill test', actor: opUsername });
    taskQueue.start(backfillTask.taskId);
    const foreignTask = taskQueue.create({ type: 'batch_action', title: 'Foreign task', actor: 'other-user' });
    taskQueue.start(foreignTask.taskId);
    const ownTask = taskQueue.create({ type: 'batch_action', title: 'Own task', actor: opUsername });
    taskQueue.start(ownTask.taskId);

    const opHeader = makeAuthHeader(opUser);
    const adminHeader = makeAuthHeader(adminUser);

    const denyBackfill = await invokeApp(app, {
        method: 'DELETE',
        url: `/api/system/tasks/${backfillTask.taskId}`,
        headers: { Authorization: opHeader },
    });
    assert.equal(denyBackfill.statusCode, 403);

    const denyForeign = await invokeApp(app, {
        method: 'DELETE',
        url: `/api/system/tasks/${foreignTask.taskId}`,
        headers: { Authorization: opHeader },
    });
    assert.equal(denyForeign.statusCode, 403);

    const allowOwn = await invokeApp(app, {
        method: 'DELETE',
        url: `/api/system/tasks/${ownTask.taskId}`,
        headers: { Authorization: opHeader },
    });
    assert.equal(allowOwn.statusCode, 200);
    assert.equal(allowOwn.json?.success, true);

    const allowAdmin = await invokeApp(app, {
        method: 'DELETE',
        url: `/api/system/tasks/${backfillTask.taskId}`,
        headers: { Authorization: adminHeader },
    });
    assert.equal(allowAdmin.statusCode, 200);
    taskQueue.cancel(foreignTask.taskId);
});

test('POST /api/system/notifications/read requires operatorOrAbove and returns 404 when id is unknown', async () => {
    const auditorUser = userStore.add({
        username: `aud_notif_${Date.now()}`,
        password: 'AudNotif#123',
        role: ROLES.auditor,
    });
    const opUser = userStore.add({
        username: `op_notif_${Date.now()}`,
        password: 'OpNotif#123',
        role: ROLES.operator,
    });

    const denyAuditor = await invokeApp(app, {
        method: 'POST',
        url: '/api/system/notifications/read',
        headers: { Authorization: makeAuthHeader(auditorUser) },
        body: { all: true },
    });
    assert.equal(denyAuditor.statusCode, 403);

    const missingId = await invokeApp(app, {
        method: 'POST',
        url: '/api/system/notifications/read',
        headers: { Authorization: makeAuthHeader(opUser) },
        body: { id: 'nonexistent-notification-id' },
    });
    assert.equal(missingId.statusCode, 404);

    const created = notificationService.notify({
        type: 'test_notice',
        severity: 'info',
        title: 'Test Notice',
        body: 'Created for read test',
    });
    const foundId = await invokeApp(app, {
        method: 'POST',
        url: '/api/system/notifications/read',
        headers: { Authorization: makeAuthHeader(opUser) },
        body: { id: created.id },
    });
    assert.equal(foundId.statusCode, 200);
    assert.equal(foundId.json?.success, true);
});
