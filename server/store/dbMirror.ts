import { isDbReady } from '../db/client.js';
import { isDbReadMode, isDbWriteMode, shouldWriteFileByMode } from '../db/runtimeModes.js';
import { queueSnapshotWrite, readSnapshot, writeSnapshotNow, type SnapshotRedactionOptions, type WriteSnapshotResult } from '../db/snapshots.js';

function cloneJson<T = any>(value: T): T | null {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

export function shouldWriteFile(): boolean {
    if (!isDbReady()) return true;
    return shouldWriteFileByMode();
}

export function mirrorStoreSnapshot(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): void {
    if (!isDbReady() || !isDbWriteMode()) return;
    const cloned = cloneJson(payload);
    if (cloned === null) return;
    queueSnapshotWrite(storeKey, cloned, options);
}

export async function writeStoreSnapshotNow(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): Promise<WriteSnapshotResult> {
    const cloned = cloneJson(payload);
    if (cloned === null) return { success: false, skipped: true };
    return writeSnapshotNow(storeKey, cloned, options);
}

export async function loadStoreSnapshot<T = any>(storeKey: string): Promise<T | null> {
    if (!isDbReady() || !isDbReadMode()) return null;
    return readSnapshot<T>(storeKey);
}
