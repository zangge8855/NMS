import fs from 'fs';
import path from 'path';
import {
    DEFAULT_REVIEW_DATA_DIR,
    REVIEW_PANEL_PORTS,
    REVIEW_SCENARIOS,
    buildReviewHarnessSnapshot,
} from './reviewHarnessFixtures.js';

const KNOWN_FILES = [
    'users.json',
    'servers.json',
    'subscription_tokens.json',
    'user_policies.json',
    'audit_events.json',
    'subscription_access_logs.json',
    'jobs.json',
    'traffic_samples.json',
    'traffic_counters.json',
    'traffic_meta.json',
    'client_entitlement_overrides.json',
    'system_settings.json',
];

function parseArgs(argv = []) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const raw = String(argv[index] || '');
        if (!raw.startsWith('--')) continue;
        const eqIndex = raw.indexOf('=');
        if (eqIndex >= 0) {
            options[raw.slice(2, eqIndex)] = raw.slice(eqIndex + 1);
            continue;
        }
        const key = raw.slice(2);
        const next = argv[index + 1];
        if (next && !String(next).startsWith('--')) {
            options[key] = String(next);
            index += 1;
        } else {
            options[key] = 'true';
        }
    }
    return options;
}

function ensureDir(targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
}

function writeJson(targetPath, value) {
    fs.writeFileSync(targetPath, JSON.stringify(value, null, 2), 'utf8');
}

function clearKnownFiles(targetDir) {
    KNOWN_FILES.forEach((filename) => {
        const targetPath = path.join(targetDir, filename);
        if (!fs.existsSync(targetPath)) return;
        fs.rmSync(targetPath, { force: true });
    });
}

function toPort(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const scenario = REVIEW_SCENARIOS.includes(String(args.scenario || '').trim())
        ? String(args.scenario).trim()
        : 'review';
    const dataDir = path.resolve(
        String(args['data-dir'] || process.env.DATA_DIR || DEFAULT_REVIEW_DATA_DIR)
    );
    const host = String(args.host || process.env.REVIEW_PANEL_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const apiBaseUrl = String(
        args['api-base-url']
        || process.env.REVIEW_API_BASE_URL
        || `http://127.0.0.1:${process.env.PORT || 3101}`
    ).trim() || 'http://127.0.0.1:3101';
    const snapshot = buildReviewHarnessSnapshot({
        scenario,
        host,
        apiBaseUrl,
        jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
        ports: {
            healthy: toPort(args['healthy-port'] || process.env.REVIEW_PANEL_PORT_HEALTHY, REVIEW_PANEL_PORTS.healthy),
            legacy: toPort(args['legacy-port'] || process.env.REVIEW_PANEL_PORT_LEGACY, REVIEW_PANEL_PORTS.legacy),
            down: toPort(args['down-port'] || process.env.REVIEW_PANEL_PORT_DOWN, REVIEW_PANEL_PORTS.down),
        },
    });

    ensureDir(dataDir);
    clearKnownFiles(dataDir);

    for (const [filename, payload] of Object.entries(snapshot.files)) {
        writeJson(path.join(dataDir, filename), payload);
    }

    const output = {
        success: true,
        scenario,
        dataDir,
        apiBaseUrl,
        host,
        files: Object.keys(snapshot.files),
        summary: snapshot.summary,
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
