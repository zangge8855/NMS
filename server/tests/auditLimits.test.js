import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RotatingLineWriter } from '../lib/rotatingLogWriter.js';

const { default: config } = await import('../config.js');
const { default: auditStore } = await import('../store/auditStore.js');

test.after(async () => {
    await auditStore._save();
});

test('RotatingLineWriter rotates by size and keeps at most maxFiles old files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-rotate-'));
    const file = path.join(dir, 'security_audit.log');
    try {
        const writer = new RotatingLineWriter({ file, maxBytes: 100, maxFiles: 2 });
        const line = `${'x'.repeat(39)}\n`; // 40 bytes → two lines per file
        for (let i = 0; i < 10; i += 1) writer.write(line);
        await writer.close();

        assert.ok(fs.existsSync(file));
        assert.ok(fs.existsSync(`${file}.1`));
        assert.ok(fs.existsSync(`${file}.2`));
        assert.equal(fs.existsSync(`${file}.3`), false, 'older files are dropped');
        for (const candidate of [file, `${file}.1`, `${file}.2`]) {
            assert.ok(fs.statSync(candidate).size <= 100, `${path.basename(candidate)} stays under the cap`);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('RotatingLineWriter resumes size accounting from an existing file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-rotate-'));
    const file = path.join(dir, 'audit.log');
    try {
        fs.writeFileSync(file, 'y'.repeat(90));
        const writer = new RotatingLineWriter({ file, maxBytes: 100, maxFiles: 3 });
        writer.write(`${'z'.repeat(19)}\n`);
        await writer.close();
        assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'y'.repeat(90));
        assert.equal(fs.readFileSync(file, 'utf8'), `${'z'.repeat(19)}\n`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('auditStore caps events and subscription access records, dropping the oldest', async () => {
    const original = {
        maxEvents: config.audit.maxEvents,
        maxSub: config.audit.maxSubscriptionAccessRecords,
        events: auditStore.events,
        access: auditStore.subscriptionAccess,
    };
    config.audit.maxEvents = 3;
    config.audit.maxSubscriptionAccessRecords = 2;
    auditStore.events = [];
    auditStore.subscriptionAccess = [];
    try {
        for (let i = 0; i < 5; i += 1) {
            auditStore.appendEvent({ event: `cap_test_${i}` });
            auditStore.appendSubscriptionAccess({ email: `cap${i}@example.com`, status: 'denied' });
        }
        assert.deepEqual(auditStore.events.map((item) => item.eventType), ['cap_test_4', 'cap_test_3', 'cap_test_2']);
        assert.deepEqual(auditStore.subscriptionAccess.map((item) => item.email), ['cap4@example.com', 'cap3@example.com']);
    } finally {
        config.audit.maxEvents = original.maxEvents;
        config.audit.maxSubscriptionAccessRecords = original.maxSub;
        auditStore.events = original.events;
        auditStore.subscriptionAccess = original.access;
    }
});

test('auditStore coalesces appends into one pending flush and persists on flush()', async () => {
    await auditStore.flush();
    assert.equal(auditStore._flushTimer, null);

    const marker = `coalesce_${Date.now()}`;
    for (let i = 0; i < 25; i += 1) {
        auditStore.appendEvent({ event: marker, details: { i } });
    }
    assert.equal(auditStore._dirtyEvents, true);
    assert.ok(auditStore._flushTimer, 'a single flush is scheduled instead of 25 writes');

    await auditStore.flush();
    assert.equal(auditStore._dirtyEvents, false);
    assert.equal(auditStore._flushTimer, null);

    const persisted = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'audit_events.json'), 'utf8'));
    assert.equal(persisted.filter((item) => item.eventType === marker).length, 25);
});

test('auditStore throttles retention pruning between appends', () => {
    auditStore._pruneExpired(true);
    const stale = { id: 'stale', ts: '2000-01-01T00:00:00.000Z', eventType: 'stale' };
    auditStore.events.push(stale);
    auditStore.appendEvent({ event: 'prune_throttle' });
    assert.ok(auditStore.events.includes(stale), 'no full prune on every append');
    auditStore._pruneExpired(true);
    assert.equal(auditStore.events.includes(stale), false, 'forced prune removes expired rows');
});
