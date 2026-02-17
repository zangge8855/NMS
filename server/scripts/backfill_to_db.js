#!/usr/bin/env node
import config from '../config.js';
import { bootstrapDatabase } from '../db/bootstrap.js';
import { backfillStoresToDatabase, listStoreKeys } from '../store/storeRegistry.js';

function parseArgs(argv = []) {
    const out = {
        dryRun: config.db?.backfillDryRunDefault !== false,
        redact: config.db?.backfillRedact !== false,
        keys: [],
    };

    argv.forEach((arg) => {
        const text = String(arg || '').trim();
        if (!text) return;

        if (text === '--dry-run') {
            out.dryRun = true;
            return;
        }
        if (text === '--no-dry-run') {
            out.dryRun = false;
            return;
        }
        if (text === '--redact') {
            out.redact = true;
            return;
        }
        if (text === '--no-redact') {
            out.redact = false;
            return;
        }
        if (text.startsWith('--keys=')) {
            const values = text.slice('--keys='.length)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            out.keys.push(...values);
        }
    });

    out.keys = Array.from(new Set(out.keys));
    return out;
}

function printSummary(output) {
    const lines = [
        '',
        `Backfill done (dryRun=${output.dryRun}, redact=${output.redact})`,
        `Total: ${output.total}, Success: ${output.success}, Failed: ${output.failed}`,
        '',
    ];

    output.details.forEach((item) => {
        if (item.success) {
            lines.push(`  - ${item.key}: ok${item.dryRun ? ' (dry-run)' : ''}, bytes=${item.bytes || 0}`);
        } else {
            lines.push(`  - ${item.key}: failed, msg=${item.msg || 'unknown'}`);
        }
    });

    console.log(lines.join('\n'));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const db = await bootstrapDatabase();
    if (!db.enabled || !db.ready) {
        console.error('Database is not ready. Check DB_ENABLED / DB_URL / DB connection.');
        process.exit(1);
    }

    const validKeys = new Set(listStoreKeys());
    const invalid = args.keys.filter((item) => !validKeys.has(item));
    if (invalid.length > 0) {
        console.error(`Unknown store keys: ${invalid.join(', ')}`);
        console.error(`Available keys: ${Array.from(validKeys.values()).join(', ')}`);
        process.exit(1);
    }

    const output = await backfillStoresToDatabase({
        dryRun: args.dryRun,
        redact: args.redact,
        keys: args.keys,
    });

    printSummary(output);

    if (output.failed > 0) {
        process.exit(2);
    }
}

main().catch((error) => {
    console.error('Backfill failed:', error?.message || error);
    process.exit(1);
});
