import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import {
    createBackupArchive,
    getBackupStatus,
    resetBackupStatusForTests,
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
