import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import {
    createBackupArchive,
    getBackupStatus,
    inspectBackupArchive,
    resetBackupStatusForTests,
    restoreBackupArchive,
} from '../lib/systemBackup.js';

test('createBackupArchive builds a gzip backup with snapshots metadata', () => {
    resetBackupStatusForTests();
    const { filename, buffer, meta } = createBackupArchive({ keys: ['users'] });
    const payload = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));

    assert.match(filename, /^nms_backup_/);
    assert.equal(payload.format, 'nms-backup');
    assert.equal(payload.version, 1);
    assert.deepEqual(payload.storeKeys, ['users']);
    assert.ok(payload.snapshots.users);
    assert.equal(meta.filename, filename);
});

test('getBackupStatus exposes last export metadata', () => {
    resetBackupStatusForTests();
    createBackupArchive({ keys: ['users'] });
    const status = getBackupStatus();

    assert.ok(Array.isArray(status.storeKeys));
    assert.equal(status.lastExport.storeKeys[0], 'users');
    assert.ok(status.lastExport.bytes > 0);
});

test('inspectBackupArchive returns restorable metadata from a backup buffer', () => {
    resetBackupStatusForTests();
    const { buffer } = createBackupArchive({ keys: ['users'] });
    const inspection = inspectBackupArchive(buffer, {
        listStoreKeys: () => ['users', 'servers'],
    });

    assert.equal(inspection.format, 'nms-backup');
    assert.equal(inspection.version, 1);
    assert.deepEqual(inspection.storeKeys, ['users']);
    assert.deepEqual(inspection.restorableKeys, ['users']);
    assert.deepEqual(inspection.missingKeys, []);
    assert.deepEqual(inspection.unsupportedKeys, []);
});

test('restoreBackupArchive restores requested stores and tracks last import metadata', async () => {
    resetBackupStatusForTests();
    const { buffer, filename } = createBackupArchive({ keys: ['users'] });
    let restoredSnapshots = null;

    const output = await restoreBackupArchive(buffer, { filename }, {
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
    });

    assert.deepEqual(restoredSnapshots.keys, ['users']);
    assert.ok(restoredSnapshots.snapshots.users);
    assert.equal(output.meta.sourceFilename, filename);
    assert.equal(output.result.restored, 1);

    const status = getBackupStatus();
    assert.equal(status.lastImport.sourceFilename, filename);
    assert.equal(status.lastImport.restored, 1);
});
