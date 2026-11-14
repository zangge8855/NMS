import { isDbReady } from '../db/client.js';
import { isSqliteReady, sqliteReadSnapshot, sqliteWriteSnapshot } from '../db/sqliteClient.js';
import { isDbReadMode, isDbWriteMode, shouldWriteFileByMode } from '../db/runtimeModes.js';
import {
    applyPrivacyRedaction,
    queueSnapshotWrite,
    readSnapshot,
    writeSnapshotNow,
    type SnapshotRedactionOptions,
    type WriteSnapshotResult,
} from '../db/snapshots.js';
import alertEngine from '../lib/alertEngine.js';

function cloneJson<T = any>(value: T): T | null {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

export function shouldWriteFile(): boolean {
    if (!isDbReady() && !isSqliteReady()) return true;
    return shouldWriteFileByMode();
}

export function mirrorStoreSnapshot(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): void {
    const cloned = cloneJson(payload);
    if (cloned === null) return;

    if (isSqliteReady()) {
        const sqliteBody = applyPrivacyRedaction(storeKey, cloned, options);
        const sqliteOk = sqliteWriteSnapshot(storeKey, sqliteBody);
        if (!sqliteOk) {
            alertEngine.recordFailure(`sqlite:${storeKey}`, 'Failed to write snapshot to SQLite');
        }
    }

    if (!isDbReady() || !isDbWriteMode()) return;
    queueSnapshotWrite(storeKey, cloned, options);
}

export async function writeStoreSnapshotNow(storeKey: string, payload: any, options: SnapshotRedactionOptions = {}): Promise<WriteSnapshotResult> {
    const cloned = cloneJson(payload);
    if (cloned === null) return { success: false, skipped: true };

    if (isSqliteReady()) {
        const sqliteBody = applyPrivacyRedaction(storeKey, cloned, options);
        const sqliteOk = sqliteWriteSnapshot(storeKey, sqliteBody);
        if (!sqliteOk) {
            alertEngine.recordFailure(`sqlite:${storeKey}`, 'Failed to write snapshot to SQLite');
            if (!isDbReady()) {
                return { success: false };
            }
        }
    }

    if (!isDbReady()) return { success: true };
    return writeSnapshotNow(storeKey, cloned, options);
}

export async function loadStoreSnapshot<T = any>(storeKey: string): Promise<T | null> {
    if (isSqliteReady()) {
        const sqliteData = sqliteReadSnapshot<T>(storeKey);
        if (sqliteData !== null) return sqliteData;
    }

    if (!isDbReady() || !isDbReadMode()) return null;
    return readSnapshot<T>(storeKey);
}
