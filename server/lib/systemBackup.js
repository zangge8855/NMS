import zlib from 'zlib';
import { collectStoreSnapshots, listStoreKeys, restoreStoreSnapshots } from '../store/storeRegistry.js';

let lastExportMeta = null;
let lastImportMeta = null;

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

function parseBackupArchive(input, deps = {}) {
    const gunzipSync = deps.gunzipSync || zlib.gunzipSync;
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');

    let payload;
    try {
        payload = JSON.parse(gunzipSync(buffer).toString('utf8'));
    } catch {
        throw new Error('备份文件解析失败，请确认上传的是 NMS 导出的 gzip 备份');
    }

    if (!payload || payload.format !== 'nms-backup') {
        throw new Error('备份格式不受支持');
    }
    if (Number(payload.version) !== 1) {
        throw new Error('备份版本不受支持');
    }
    if (!payload.snapshots || typeof payload.snapshots !== 'object' || Array.isArray(payload.snapshots)) {
        throw new Error('备份快照结构无效');
    }

    const fallbackKeys = Object.keys(payload.snapshots || {});
    const storeKeys = normalizeStoreKeysInput(payload.storeKeys);

    return {
        payload,
        storeKeys: storeKeys.length > 0 ? storeKeys : fallbackKeys,
        snapshots: payload.snapshots,
        bytes: buffer.byteLength,
    };
}

function inspectBackupArchive(input, deps = {}) {
    const parsed = parseBackupArchive(input, deps);
    const availableKeys = new Set((deps.listStoreKeys || listStoreKeys)());
    const sourceKeys = parsed.storeKeys;
    const restorableKeys = sourceKeys.filter((key) => availableKeys.has(key) && Object.prototype.hasOwnProperty.call(parsed.snapshots, key));
    const missingKeys = sourceKeys.filter((key) => !Object.prototype.hasOwnProperty.call(parsed.snapshots, key));
    const unsupportedKeys = sourceKeys.filter((key) => !availableKeys.has(key));

    return {
        format: parsed.payload.format,
        version: parsed.payload.version,
        createdAt: parsed.payload.createdAt || '',
        bytes: parsed.bytes,
        storeKeys: sourceKeys,
        restorableKeys,
        missingKeys,
        unsupportedKeys,
    };
}

async function restoreBackupArchive(input, options = {}, deps = {}) {
    const parsed = parseBackupArchive(input, deps);
    const availableKeys = new Set((deps.listStoreKeys || listStoreKeys)());
    const requestedKeys = normalizeStoreKeysInput(options.keys);
    const candidateKeys = requestedKeys.length > 0 ? requestedKeys : parsed.storeKeys;
    const restoreKeys = candidateKeys.filter((key) => availableKeys.has(key) && Object.prototype.hasOwnProperty.call(parsed.snapshots, key));

    if (restoreKeys.length === 0) {
        throw new Error('备份中没有可恢复的 store');
    }

    const restoreFn = deps.restoreStoreSnapshots || restoreStoreSnapshots;
    const result = await restoreFn(parsed.snapshots, { keys: restoreKeys });

    lastImportMeta = {
        restoredAt: new Date().toISOString(),
        sourceCreatedAt: parsed.payload.createdAt || '',
        sourceFilename: String(options.filename || '').trim(),
        bytes: parsed.bytes,
        storeKeys: restoreKeys,
        restored: Number(result?.restored || 0),
        failed: Number(result?.failed || 0),
    };

    return {
        inspection: inspectBackupArchive(input, deps),
        result,
        meta: lastImportMeta,
    };
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
        lastImport: lastImportMeta ? { ...lastImportMeta } : null,
    };
}

function resetBackupStatusForTests() {
    lastExportMeta = null;
    lastImportMeta = null;
}

export {
    createBackupArchive,
    inspectBackupArchive,
    parseBackupArchive,
    restoreBackupArchive,
    getBackupStatus,
    resetBackupStatusForTests,
};
