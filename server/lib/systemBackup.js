import zlib from 'zlib';
import { collectStoreSnapshots, listStoreKeys } from '../store/storeRegistry.js';

let lastExportMeta = null;

function normalizeStoreKeysInput(input) {
    if (typeof input === 'string') {
        return Array.from(new Set(
            input
                .split(',')
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        ));
    }
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(
        input
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

function buildBackupFilename(date = new Date()) {
    const iso = date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
    return `nms_backup_${iso}.json.gz`;
}

function createBackupArchive(options = {}) {
    const requestedKeys = normalizeStoreKeysInput(options.keys);
    const storeKeys = requestedKeys.length > 0 ? requestedKeys : listStoreKeys();
    const createdAt = new Date().toISOString();
    const payload = {
        format: 'nms-backup',
        version: 1,
        createdAt,
        storeKeys,
        snapshots: collectStoreSnapshots(storeKeys),
    };
    const json = JSON.stringify(payload);
    const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'));
    const filename = buildBackupFilename(new Date(createdAt));

    lastExportMeta = {
        createdAt,
        filename,
        bytes: buffer.byteLength,
        storeKeys,
    };

    return {
        filename,
        buffer,
        meta: lastExportMeta,
    };
}

function getBackupStatus() {
    return {
        storeKeys: listStoreKeys(),
        lastExport: lastExportMeta ? { ...lastExportMeta } : null,
    };
}

function resetBackupStatusForTests() {
    lastExportMeta = null;
}

export {
    createBackupArchive,
    getBackupStatus,
    resetBackupStatusForTests,
};
