import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, resolve } from 'path';
import { resolveClientBuildPaths } from './clientBuild.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_ENV_FILE = resolve(REPO_ROOT, '.env');
export const DEFAULT_LOGS_DIR = resolve(REPO_ROOT, 'logs');
export const DEFAULT_JWT_SECRET = 'default-secret-change-me';
const CORE_RUNTIME_FILES = [
    { key: 'users', file: 'users.json' },
    { key: 'servers', file: 'servers.json' },
    { key: 'notifications', file: 'notifications.json' },
];

function hasNonEmptyValue(value) {
    return String(value || '').trim().length > 0;
}

export function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

export function resolveDataDir(value, rootDir = REPO_ROOT) {
    const defaultDataDir = resolve(rootDir, 'data');
    const text = String(value || '').trim();
    if (!text) return defaultDataDir;
    if (isAbsolute(text)) return text;
    return resolve(rootDir, text);
}

export function loadRuntimeEnv(envFile = DEFAULT_ENV_FILE) {
    return dotenv.config({ path: envFile });
}

export function shouldServeClientBuild(env = process.env) {
    const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase() || 'development';
    return nodeEnv === 'production' || String(env.SERVE_CLIENT || '').trim().toLowerCase() === 'true';
}

export function isWeakJwtSecret(value) {
    const text = String(value || '');
    return text.length < 32 || text === DEFAULT_JWT_SECRET;
}

export function isWeakAdminPassword(value) {
    const text = String(value || '');
    if (text.length < 8) return true;
    const typeCount = [
        /[a-z]/.test(text),
        /[A-Z]/.test(text),
        /\d/.test(text),
        /[^A-Za-z0-9]/.test(text),
    ].filter(Boolean).length;
    if (typeCount < 3) return true;
    const lower = text.toLowerCase();
    return ['admin', 'admin123', 'password', '12345678'].includes(lower);
}

export function isWeakAdminUsername(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return true;
    if (text.length < 3) return true;
    return ['admin', 'administrator', 'root'].includes(text);
}

export function isWeakCredentialsSecret(value, jwtSecret) {
    const text = String(value || '');
    if (text.length < 32) return true;
    if (text === DEFAULT_JWT_SECRET) return true;
    if (text === String(jwtSecret || '')) return true;
    return false;
}

export function collectSecurityIssues(env = process.env) {
    const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase() || 'development';
    const isProduction = nodeEnv === 'production';
    const enforceStrictSecurity = isProduction || parseBoolean(env.ENFORCE_STRICT_SECURITY, false);
    if (!enforceStrictSecurity) return [];

    const issues = [];
    const jwtSecret = env.JWT_SECRET || DEFAULT_JWT_SECRET;
    const adminUsername = env.ADMIN_USERNAME || 'admin';
    const adminPassword = env.ADMIN_PASSWORD || 'admin';
    const credentialsSecret = env.CREDENTIALS_SECRET || '';

    if (isWeakJwtSecret(jwtSecret)) {
        issues.push({
            code: 'unsafe_jwt_secret',
            message: 'JWT_SECRET is missing or weak. Set a strong random secret with length >= 32.',
        });
    }
    if (isWeakAdminUsername(adminUsername)) {
        issues.push({
            code: 'unsafe_admin_username',
            message: 'ADMIN_USERNAME is missing or still using a default-style value. Use a non-default admin username.',
        });
    }
    if (isWeakAdminPassword(adminPassword)) {
        issues.push({
            code: 'unsafe_admin_password',
            message: 'ADMIN_PASSWORD is missing or weak. Use at least 8 characters spanning 3 of: lowercase, uppercase, digits, symbols.',
        });
    }
    if (!hasNonEmptyValue(credentialsSecret)) {
        issues.push({
            code: 'missing_credentials_secret',
            message: 'CREDENTIALS_SECRET is missing. Set a dedicated secret with length >= 32 and do not reuse JWT_SECRET.',
        });
    } else if (isWeakCredentialsSecret(credentialsSecret, jwtSecret)) {
        issues.push({
            code: 'unsafe_credentials_secret',
            message: 'CREDENTIALS_SECRET is weak or reuses JWT_SECRET. Use a separate strong secret with length >= 32.',
        });
    }

    return issues;
}

export function collectStartupIssues(env = process.env, options = {}) {
    const rootDir = resolve(options.rootDir || REPO_ROOT);
    const envFile = resolve(options.envFile || resolve(rootDir, '.env'));
    const dataDir = resolveDataDir(env.DATA_DIR, rootDir);
    const includeClientBuildCheck = options.includeClientBuildCheck !== false;
    const includeEnvFileNotice = options.includeEnvFileNotice !== false;
    const issues = [];
    const securityIssues = collectSecurityIssues(env);

    if (includeEnvFileNotice && securityIssues.length > 0 && !fs.existsSync(envFile)) {
        issues.push({
            code: 'missing_env_file',
            message: `No .env file was found at ${envFile}. Copy .env.example and set the production values, or inject the same variables through PM2/systemd.`,
        });
    }

    issues.push(...securityIssues);
    issues.push(...collectRuntimeDataIssues(dataDir));

    if (includeClientBuildCheck && shouldServeClientBuild(env)) {
        const { clientIndexFile } = resolveClientBuildPaths(rootDir);
        if (!fs.existsSync(clientIndexFile)) {
            issues.push({
                code: 'missing_client_build',
                message: `Frontend build is missing at ${clientIndexFile}. Run "cd client && npm ci && npm run build" before starting NMS in production.`,
            });
        }
    }

    return issues;
}

export function collectRuntimeDataIssues(dataDir) {
    const issues = [];

    for (const entry of CORE_RUNTIME_FILES) {
        const filePath = resolve(dataDir, entry.file);
        if (!fs.existsSync(filePath)) continue;

        try {
            JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            issues.push({
                code: `invalid_${entry.key}_store`,
                message: `Runtime data file ${filePath} is unreadable JSON (${error.message}). Restore it from backup or repair the file before starting NMS.`,
            });
        }
    }

    return issues;
}

export function ensureRuntimeDirectories(env = process.env, options = {}) {
    const rootDir = resolve(options.rootDir || REPO_ROOT);
    const logsDir = resolve(options.logsDir || resolve(rootDir, 'logs'));
    const dataDir = resolveDataDir(env.DATA_DIR, rootDir);

    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    return { logsDir, dataDir };
}

export function formatStartupIssues(issues, options = {}) {
    const rootDir = resolve(options.rootDir || REPO_ROOT);
    const envFile = resolve(options.envFile || resolve(rootDir, '.env'));
    const lines = [
        'Startup preflight failed.',
        '',
        'Fix the following before starting NMS:',
    ];

    for (const [index, issue] of issues.entries()) {
        lines.push(`${index + 1}. ${issue.message}`);
    }

    lines.push('');
    lines.push('Recommended checks:');
    lines.push(`- Confirm ${envFile} exists or inject the same variables through your process manager`);
    lines.push('- Rebuild the frontend if client/dist is missing');
    lines.push('- If PM2 still exits after this, run: pm2 logs nms --lines 100');

    return lines.join('\n');
}
