#!/usr/bin/env node
import { bootstrapDatabase } from '../db/bootstrap.js';
import { listStoreKeys, verifyStoresAgainstDatabase } from '../store/storeRegistry.js';

function parseArgs(argv = []) {
    const out = {
        keys: [],
        redact: false,
    };

    argv.forEach((arg) => {
        const text = String(arg || '').trim();
        if (!text) return;
        if (text === '--redact') {
            out.redact = true;
            return;
        }
        if (text.startsWith('--keys=')) {
            out.keys.push(...text.slice('--keys='.length)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean));
        }
    });

    out.keys = Array.from(new Set(out.keys));
    return out;
}

function printReport(report) {
    const lines = [
        '',
        `DB consistency check done. Total: ${report.total}, OK: ${report.ok}, Failed: ${report.failed}`,
        '',
    ];

    report.details.forEach((item) => {
        const marker = item.ok ? 'ok' : 'failed';
        lines.push(`  - ${item.key}: ${marker}, status=${item.status}, file=${item.fileHash || '-'}, db=${item.dbHash || '-'}`);
        if (item.msg) lines.push(`    ${item.msg}`);
    });

    console.log(lines.join('\n'));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const validKeys = new Set(listStoreKeys());
    const invalid = args.keys.filter((key) => !validKeys.has(key));
    if (invalid.length > 0) {
        console.error(`Unknown store keys: ${invalid.join(', ')}`);
        console.error(`Available keys: ${Array.from(validKeys.values()).join(', ')}`);
        process.exit(1);
    }

    const db = await bootstrapDatabase();
    if (!db.enabled || !db.ready) {
        console.error('Database is not ready. Check DB_ENABLED / DB_URL / DB connection.');
        process.exit(1);
    }

    const report = await verifyStoresAgainstDatabase({
        keys: args.keys,
        redact: args.redact,
    });
    printReport(report);
    if (report.failed > 0) process.exit(2);
}

main().catch((error) => {
    console.error('DB consistency check failed:', error?.message || error);
    process.exit(1);
});
