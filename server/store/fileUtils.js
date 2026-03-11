import fs from 'fs';
import { shouldWriteFile } from './dbMirror.js';

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
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    
    try {
        fs.writeFileSync(tempFile, content, 'utf8');
        fs.renameSync(tempFile, file);
    } catch (e) {
        // Fallback: renameSync may fail on Windows due to file locks or cross-device links;
        // fall back to direct write.
        try {
            fs.writeFileSync(file, content, 'utf8');
        } catch (writeErr) {
            console.error(`[Store Error] Failed to fallback write to ${file}:`, writeErr);
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
