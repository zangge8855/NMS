import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import config from '../config.js';
import { collectStoreSnapshots, listStoreKeys, restoreStoreSnapshots } from '../store/storeRegistry.js';

let lastExportMeta = null;
let lastImportMeta = null;
const ENCRYPTED_BACKUP_FORMAT = 'nms-backup-encrypted';
const ENCRYPTED_BACKUP_VERSION = 2;
const BACKUP_CIPHER = 'aes-256-gcm';
const LOCAL_BACKUP_DIRNAME = 'backups';

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
    return `nms_backup_${iso}.nmsbak`;
}

function backupDirPath(deps = {}) {
    const target = String(deps.backupDir || '').trim();
    return target || path.join(config.dataDir, LOCAL_BACKUP_DIRNAME);
}

function ensureBackupDirExists(deps = {}) {
    const dir = backupDirPath(deps);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function deriveBackupKey(deps = {}) {
    const secret = String(deps.backupSecret || config.credentials.secret || config.jwt.secret || '').trim();
    return crypto.createHash('sha256').update(secret).digest();
}

function normalizeBackupPayload(payload) {
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
    };
}

function parseLegacyBackupArchive(buffer, deps = {}) {
    const gunzipSync = deps.gunzipSync || zlib.gunzipSync;
    let payload;
    try {
        payload = JSON.parse(gunzipSync(buffer).toString('utf8'));
    } catch {
        throw new Error('备份文件解析失败，请确认上传的是 NMS 导出的 `.nmsbak` 加密备份或旧版 `.json.gz` 备份');
    }

    const parsed = normalizeBackupPayload(payload);
    return {
        ...parsed,
        bytes: buffer.byteLength,
        encrypted: false,
        cipher: '',
        keyHint: '',
    };
}

function parseEncryptedBackupArchive(buffer, deps = {}) {
    let envelope;
    try {
        envelope = JSON.parse(buffer.toString('utf8'));
    } catch {
        return null;
    }

    if (!envelope || envelope.format !== ENCRYPTED_BACKUP_FORMAT) {
        return null;
    }
    if (Number(envelope.version) !== ENCRYPTED_BACKUP_VERSION) {
        throw new Error('备份版本不受支持');
    }
    if (!envelope.iv || !envelope.tag || !envelope.ciphertext) {
        throw new Error('加密备份结构无效');
    }

    let compressedPayload;
    try {
        const decipher = crypto.createDecipheriv(
            BACKUP_CIPHER,
            deriveBackupKey(deps),
            Buffer.from(String(envelope.iv || ''), 'hex')
        );
        decipher.setAuthTag(Buffer.from(String(envelope.tag || ''), 'hex'));
        compressedPayload = Buffer.concat([
            decipher.update(Buffer.from(String(envelope.ciphertext || ''), 'base64')),
            decipher.final(),
        ]);
    } catch {
        throw new Error('备份文件无法解密，请确认当前 NMS 的 CREDENTIALS_SECRET 与备份创建时一致');
    }

    let payload;
    try {
        payload = JSON.parse((deps.gunzipSync || zlib.gunzipSync)(compressedPayload).toString('utf8'));
    } catch {
        throw new Error('备份文件解密成功，但内容已损坏');
    }

    const parsed = normalizeBackupPayload(payload);

    return {
        ...parsed,
        bytes: buffer.byteLength,
        encrypted: true,
        cipher: String(envelope.cipher || BACKUP_CIPHER),
        keyHint: String(envelope.keyHint || 'CREDENTIALS_SECRET'),
    };
}

function parseBackupArchive(input, deps = {}) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
    return parseEncryptedBackupArchive(buffer, deps) || parseLegacyBackupArchive(buffer, deps);
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
        encrypted: parsed.encrypted === true,
        cipher: parsed.cipher || '',
        keyHint: parsed.keyHint || '',
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

function createBackupArchive(options = {}, deps = {}) {
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
    const compressedPayload = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(BACKUP_CIPHER, deriveBackupKey(deps), iv);
    const encryptedPayload = Buffer.concat([cipher.update(compressedPayload), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const buffer = Buffer.from(JSON.stringify({
        format: ENCRYPTED_BACKUP_FORMAT,
        version: ENCRYPTED_BACKUP_VERSION,
        createdAt,
        storeKeys,
        compression: 'gzip',
        cipher: BACKUP_CIPHER,
        keyHint: 'CREDENTIALS_SECRET',
        iv: iv.toString('hex'),
        tag: authTag.toString('hex'),
        ciphertext: encryptedPayload.toString('base64'),
    }), 'utf8');
    const filename = buildBackupFilename(new Date(createdAt));

    lastExportMeta = {
        createdAt,
        filename,
        bytes: buffer.byteLength,
        storeKeys,
        encrypted: true,
        cipher: BACKUP_CIPHER,
        keyHint: 'CREDENTIALS_SECRET',
    };

    return {
        filename,
        buffer,
        meta: lastExportMeta,
    };
}

function uniqueBackupFilePath(filename, deps = {}) {
    const dir = ensureBackupDirExists(deps);
    const ext = path.extname(filename);
    const baseName = ext ? filename.slice(0, -ext.length) : filename;
    let index = 0;
    let candidate = filename;
    while (fs.existsSync(path.join(dir, candidate))) {
        index += 1;
        candidate = `${baseName}_${index}${ext}`;
    }
    return path.join(dir, candidate);
}

function normalizeLocalBackupFilename(value) {
    const text = String(value || '').trim();
    const basename = path.basename(text);
    if (!text || basename !== text || basename === '.' || basename === '..') {
        throw new Error('备份文件名无效');
    }
    return basename;
}

function saveBackupArchiveLocally(options = {}, deps = {}) {
    const archive = createBackupArchive(options, deps);
    const filePath = uniqueBackupFilePath(archive.filename, deps);
    const finalFilename = path.basename(filePath);
    fs.writeFileSync(filePath, archive.buffer);
    return {
        ...archive,
        filename: finalFilename,
        meta: {
            ...archive.meta,
            filename: finalFilename,
            filePath,
        },
    };
}

function listLocalBackups(deps = {}) {
    const dir = backupDirPath(deps);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
        .map((filename) => {
            const filePath = path.join(dir, filename);
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) return null;
            let inspection = null;
            try {
                inspection = inspectBackupArchive(fs.readFileSync(filePath), deps);
            } catch {
                return null;
            }
            return {
                filename,
                bytes: stat.size,
                createdAt: inspection.createdAt || stat.mtime.toISOString(),
                storeKeys: inspection.storeKeys,
                encrypted: inspection.encrypted === true,
                cipher: inspection.cipher || '',
                keyHint: inspection.keyHint || '',
            };
        })
        .filter(Boolean)
        .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}

function readLocalBackupArchive(filename, deps = {}) {
    const safeFilename = normalizeLocalBackupFilename(filename);
    const filePath = path.join(backupDirPath(deps), safeFilename);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('本机备份不存在');
    }
    return {
        filename: safeFilename,
        filePath,
        buffer: fs.readFileSync(filePath),
    };
}

function deleteLocalBackupArchive(filename, deps = {}) {
    const entry = readLocalBackupArchive(filename, deps);
    fs.rmSync(entry.filePath, { force: true });
    return {
        filename: entry.filename,
    };
}

async function restoreLocalBackupArchive(filename, options = {}, deps = {}) {
    const entry = readLocalBackupArchive(filename, deps);
    return restoreBackupArchive(entry.buffer, {
        filename: entry.filename,
        keys: options.keys,
    }, deps);
}

function getBackupStatus(deps = {}) {
    return {
        storeKeys: listStoreKeys(),
        lastExport: lastExportMeta ? { ...lastExportMeta } : null,
        lastImport: lastImportMeta ? { ...lastImportMeta } : null,
        localBackupDir: backupDirPath(deps),
        localBackups: listLocalBackups(deps),
    };
}

function resetBackupStatusForTests() {
    lastExportMeta = null;
    lastImportMeta = null;
}

export {
    createBackupArchive,
    deleteLocalBackupArchive,
    inspectBackupArchive,
    listLocalBackups,
    parseBackupArchive,
    readLocalBackupArchive,
    restoreBackupArchive,
    restoreLocalBackupArchive,
    saveBackupArchiveLocally,
    getBackupStatus,
    resetBackupStatusForTests,
};
