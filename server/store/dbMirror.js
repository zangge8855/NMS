import { isDbReady } from '../db/client.js';
import { isDbReadMode, isDbWriteMode, shouldWriteFileByMode } from '../db/runtimeModes.js';
import { queueSnapshotWrite, readSnapshot, writeSnapshotNow } from '../db/snapshots.js';

function cloneJson(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

export function shouldWriteFile() {
    if (!isDbReady()) return true;
    return shouldWriteFileByMode();
}

export function mirrorStoreSnapshot(storeKey, payload, options = {}) {
    if (!isDbReady() || !isDbWriteMode()) return;
    const cloned = cloneJson(payload);
    if (cloned === null) return;
    queueSnapshotWrite(storeKey, cloned, options);
}

export async function writeStoreSnapshotNow(storeKey, payload, options = {}) {
    const cloned = cloneJson(payload);
    if (cloned === null) return { success: false, skipped: true };
    return writeSnapshotNow(storeKey, cloned, options);
}

export async function loadStoreSnapshot(storeKey) {
    if (!isDbReady() || !isDbReadMode()) return null;
    return readSnapshot(storeKey);
}
