import fs from 'fs';
import crypto from 'crypto';
import { shouldWriteFile } from './dbMirror.js';

// Monotonic counter so two writers entering in the same millisecond (and even with the
// same PID) never derive the same temp filename. A same-name collision would let two
// concurrent writers truncate and interleave into one temp file, corrupting it before
// either rename publishes.
let tempCounter = 0;

function makeTempFile(file) {
    tempCounter = (tempCounter + 1) % Number.MAX_SAFE_INTEGER;
    const rand = crypto.randomBytes(6).toString('hex');
    return `${file}.${process.pid}.${Date.now()}.${tempCounter}.${rand}.tmp`;
}

/**
 * Saves a JSON object to a file atomically by writing to a temporary file
 * first and then renaming it. This prevents file corruption during crashes.
 *
 * @param {string} file The path to the file to write.
 * @param {any} data The JSON serializable data to save.
 */
export function saveObjectAtomic(file, data) {
    if (!shouldWriteFile()) return;

    const content = JSON.stringify(data, null, 2);
    const tempFile = makeTempFile(file);

    let tempWritten = false;
    try {
        fs.writeFileSync(tempFile, content, 'utf8');
        tempWritten = true;
        fs.renameSync(tempFile, file);
    } catch (e) {
        // Only fall back to a direct write when the temp file was fully written but the
        // rename failed (e.g. Windows file locks / cross-device links). If the temp write
        // itself failed (ENOSPC, EACCES, …), a direct write would truncate the real file
        // first and could fail mid-write, destroying the last good copy — so rethrow.
        if (!tempWritten) {
            console.error(`[Store Error] Failed to write temp file for ${file}:`, e);
            throw e;
        }
        try {
            fs.writeFileSync(file, content, 'utf8');
        } catch (writeErr) {
            console.error(`[Store Error] Failed to fallback write to ${file}:`, writeErr);
            throw writeErr;
        }
    } finally {
        if (fs.existsSync(tempFile)) {
            try {
                fs.rmSync(tempFile, { force: true });
            } catch {
                // Best-effort cleanup.
            }
        }
    }
}

/**
 * Saves a JSON object to a file atomically and asynchronously using promises.
 *
 * @param {string} file The path to the file to write.
 * @param {any} data The JSON serializable data to save.
 * @returns {Promise<void>}
 */
export async function saveObjectAtomicAsync(file, data) {
    if (!shouldWriteFile()) return;

    const content = JSON.stringify(data, null, 2);
    const tempFile = makeTempFile(file);

    let tempWritten = false;
    try {
        await fs.promises.writeFile(tempFile, content, 'utf8');
        tempWritten = true;
        await fs.promises.rename(tempFile, file);
    } catch (e) {
        if (!tempWritten) {
            console.error(`[Store Error] Failed to write temp file for ${file}:`, e);
            throw e;
        }
        try {
            await fs.promises.writeFile(file, content, 'utf8');
        } catch (writeErr) {
            console.error(`[Store Error] Failed to fallback async write to ${file}:`, writeErr);
            throw writeErr;
        }
    } finally {
        try {
            await fs.promises.rm(tempFile, { force: true });
        } catch {
            // Best-effort cleanup.
        }
    }
}
