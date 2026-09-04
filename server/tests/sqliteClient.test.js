import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    initSqliteDb,
    isSqliteReady,
    sqliteWriteSnapshot,
    sqliteReadSnapshot,
    closeSqliteDb
} from '../db/sqliteClient.js';

test('sqliteClient lifecycle and snapshot CRUD', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-sqlite-test-'));
    const testDbPath = path.join(tmpDir, 'test_nms.sqlite');

    t.after(() => {
        closeSqliteDb();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    // 1. Initialization
    const initResult = initSqliteDb(testDbPath);
    assert.equal(initResult, true);
    assert.equal(isSqliteReady(), true);

    // 2. Read non-existent key
    const nonExistent = sqliteReadSnapshot('unknown_key');
    assert.equal(nonExistent, null);

    // 3. Write snapshot
    const testPayload = { version: 1, items: ['server1', 'server2'], meta: { count: 2 } };
    const writeOk = sqliteWriteSnapshot('servers', testPayload);
    assert.equal(writeOk, true);

    // 4. Read snapshot
    const loaded = sqliteReadSnapshot('servers');
    assert.deepEqual(loaded, testPayload);

    // 5. Update (Upsert) snapshot
    const updatedPayload = { ...testPayload, version: 2, meta: { count: 3 } };
    const updateOk = sqliteWriteSnapshot('servers', updatedPayload);
    assert.equal(updateOk, true);

    const reloaded = sqliteReadSnapshot('servers');
    assert.deepEqual(reloaded, updatedPayload);

    // 6. Close database
    closeSqliteDb();
    assert.equal(isSqliteReady(), false);

    // Read after close returns null
    const readAfterClose = sqliteReadSnapshot('servers');
    assert.equal(readAfterClose, null);
});
