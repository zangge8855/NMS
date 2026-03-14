import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import {
    createBackupArchive,
    deleteLocalBackupArchive,
    getBackupStatus,
    inspectBackupArchive,
    parseBackupArchive,
    resetBackupStatusForTests,
    restoreBackupArchive,
    restoreLocalBackupArchive,
    saveBackupArchiveLocally,
} from '../lib/systemBackup.js';

const TEST_BACKUP_SECRET = 'test-backup-secret-for-system-backup-suite';

function buildDeps(overrides = {}) {
    return {
        backupSecret: TEST_BACKUP_SECRET,
        ...overrides,
    };
}

function createTempBackupDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nms-system-backup-'));
}

test('createBackupArchive builds an encrypted backup with snapshots metadata', () => {
    resetBackupStatusForTests();
    const { filename, buffer, meta } = createBackupArchive({ keys: ['users'] }, buildDeps());
    const parsed = parseBackupArchive(buffer, buildDeps());

    assert.match(filename, /^nms_backup_/);
    assert.match(filename, /\.nmsbak$/);
    assert.equal(parsed.payload.format, 'nms-backup');
    assert.equal(parsed.payload.version, 1);
    assert.deepEqual(parsed.payload.storeKeys, ['users']);
    assert.ok(parsed.payload.snapshots.users);
    assert.equal(meta.filename, filename);
    assert.equal(meta.encrypted, true);
});

test('getBackupStatus exposes last export metadata', () => {
    resetBackupStatusForTests();
    createBackupArchive({ keys: ['users'] }, buildDeps());
    const status = getBackupStatus();

    assert.ok(Array.isArray(status.storeKeys));
    assert.equal(status.lastExport.storeKeys[0], 'users');
    assert.ok(status.lastExport.bytes > 0);
    assert.equal(status.lastExport.encrypted, true);
});

test('inspectBackupArchive returns restorable metadata from a backup buffer', () => {
    resetBackupStatusForTests();
    const { buffer } = createBackupArchive({ keys: ['users'] }, buildDeps());
    const inspection = inspectBackupArchive(buffer, buildDeps({
        listStoreKeys: () => ['users', 'servers'],
    }));

    assert.equal(inspection.format, 'nms-backup');
    assert.equal(inspection.version, 1);
    assert.deepEqual(inspection.storeKeys, ['users']);
    assert.deepEqual(inspection.restorableKeys, ['users']);
    assert.deepEqual(inspection.missingKeys, []);
    assert.deepEqual(inspection.unsupportedKeys, []);
    assert.equal(inspection.encrypted, true);
    assert.equal(inspection.keyHint, 'CREDENTIALS_SECRET');
});

test('restoreBackupArchive restores requested stores and tracks last import metadata', async () => {
    resetBackupStatusForTests();
    const { buffer, filename } = createBackupArchive({ keys: ['users'] }, buildDeps());
    let restoredSnapshots = null;

    const output = await restoreBackupArchive(buffer, { filename }, buildDeps({
        listStoreKeys: () => ['users', 'servers'],
        restoreStoreSnapshots: async (snapshots, options = {}) => {
            restoredSnapshots = {
                snapshots,
                keys: options.keys,
            };
            return {
                total: 1,
                restored: 1,
                failed: 0,
                details: [{ key: 'users', restored: true, reason: 'ok' }],
            };
        },
    }));

    assert.deepEqual(restoredSnapshots.keys, ['users']);
    assert.ok(restoredSnapshots.snapshots.users);
    assert.equal(output.meta.sourceFilename, filename);
    assert.equal(output.result.restored, 1);

    const status = getBackupStatus();
    assert.equal(status.lastImport.sourceFilename, filename);
    assert.equal(status.lastImport.restored, 1);
});

test('saveBackupArchiveLocally stores encrypted backups that can be restored later', async () => {
    resetBackupStatusForTests();
    const backupDir = createTempBackupDir();
    let restoredKeys = [];
    try {
        const saved = saveBackupArchiveLocally({ keys: ['users'] }, buildDeps({ backupDir }));
        assert.match(saved.filename, /\.nmsbak$/);
        assert.equal(fs.existsSync(path.join(backupDir, saved.filename)), true);

        const status = getBackupStatus(buildDeps({ backupDir }));
        assert.equal(status.localBackups.length, 1);
        assert.equal(status.localBackups[0].filename, saved.filename);
        assert.equal(status.localBackups[0].encrypted, true);

        const restored = await restoreLocalBackupArchive(saved.filename, {}, buildDeps({
            backupDir,
            listStoreKeys: () => ['users'],
            restoreStoreSnapshots: async (_snapshots, options = {}) => {
                restoredKeys = options.keys || [];
                return { total: 1, restored: 1, failed: 0, details: [] };
            },
        }));

        assert.deepEqual(restoredKeys, ['users']);
        assert.equal(restored.meta.sourceFilename, saved.filename);
    } finally {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
});

test('deleteLocalBackupArchive removes saved local backups', () => {
    resetBackupStatusForTests();
    const backupDir = createTempBackupDir();
    try {
        const saved = saveBackupArchiveLocally({ keys: ['users'] }, buildDeps({ backupDir }));
        deleteLocalBackupArchive(saved.filename, buildDeps({ backupDir }));

        assert.equal(fs.existsSync(path.join(backupDir, saved.filename)), false);
        assert.deepEqual(getBackupStatus(buildDeps({ backupDir })).localBackups, []);
    } finally {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
});

test('parseBackupArchive still accepts legacy plaintext gzip backups for restore compatibility', () => {
    const legacyPayload = {
        format: 'nms-backup',
        version: 1,
        createdAt: '2026-03-14T00:00:00.000Z',
        storeKeys: ['users'],
        snapshots: {
            users: [],
        },
    };
    const legacyBuffer = zlib.gzipSync(Buffer.from(JSON.stringify(legacyPayload), 'utf8'));
    const parsed = parseBackupArchive(legacyBuffer, buildDeps());

    assert.equal(parsed.encrypted, false);
    assert.deepEqual(parsed.storeKeys, ['users']);
    assert.equal(parsed.payload.createdAt, legacyPayload.createdAt);
});
