// Preloaded into every test process by `npm test` (node --import).
//
// Gives each process its own temporary DATA_DIR so no test can read or
// overwrite the repository's real `data/` directory. A test file that sets
// process.env.DATA_DIR itself still wins, because it runs after this preload.
// config.ts refuses to start under the test runner if DATA_DIR still resolves
// to the repository data directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), `nms-test-data-${process.pid}-`));
process.env.DATA_DIR = isolatedDir;

process.on('exit', () => {
    try {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
    } catch {
        // best effort cleanup
    }
});
