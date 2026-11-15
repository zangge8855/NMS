import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_ENV_FILE = resolve(REPO_ROOT, '.env');

/**
 * Secrets that NMS generates and owns lives in the data directory, not in the
 * repo-root `.env`: the data directory is the one location guaranteed to be
 * writable and persistent (it is the Docker volume, and the PM2 data path).
 */
export const RUNTIME_ENV_FILENAME = 'runtime.env';

/** Secrets that are generated on first start when the operator did not set them. */
export const GENERATED_SECRET_KEYS = ['JWT_SECRET', 'CREDENTIALS_SECRET'] as const;

/**
 * Constants that earlier releases shipped as fallback secrets. They are public,
 * so they must never sign or verify anything again. They are kept only so that
 * data encrypted under them (server credentials, the Telegram token) can still
 * be decrypted once and re-encrypted with a real key.
 */
export const KNOWN_PUBLIC_SECRETS: readonly string[] = Object.freeze([
    'default-secret-change-me',
    'nms-default-jwt-secret-key-32-chars-min-ok!',
    'nms-default-credentials-secret-32-chars-min-ok!',
]);

export function isKnownPublicSecret(value: unknown): boolean {
    const text = String(value || '').trim();
    return Boolean(text) && KNOWN_PUBLIC_SECRETS.includes(text);
}

export function resolveDataDirFrom(value: unknown, rootDir: string = REPO_ROOT): string {
    const text = String(value || '').trim();
    if (!text) return resolve(rootDir, 'data');
    if (isAbsolute(text)) return text;
    return resolve(rootDir, text);
}

export function runtimeEnvFilePath(dataDir: string): string {
    return resolve(dataDir, RUNTIME_ENV_FILENAME);
}

export function readEnvFile(filePath: string): Record<string, string> {
    try {
        if (!filePath || !fs.existsSync(filePath)) return {};
        return dotenv.parse(fs.readFileSync(filePath));
    } catch {
        return {};
    }
}

function quoteEnvValue(value: unknown): string {
    const text = String(value ?? '');
    if (!text) return '""';
    return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
}

/**
 * Merge `updates` into a dotenv file, keeping unrelated lines and comments.
 * The write is atomic (temp file + rename) and the file is created 0600.
 */
export function writeEnvFile(filePath: string, updates: Record<string, unknown> = {}): string {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) throw new Error('writeEnvFile requires a target path');
    fs.mkdirSync(dirname(targetPath), { recursive: true });
    const source = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
    const lines = source ? source.split(/\r?\n/) : [];
    const pending = new Map<string, unknown>(Object.entries(updates));
    const nextLines = lines.map((line) => {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/);
        if (!match) return line;
        const key = match[1];
        if (!pending.has(key)) return line;
        const nextValue = pending.get(key);
        pending.delete(key);
        return `${key}=${quoteEnvValue(nextValue)}`;
    });

    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== '') {
        nextLines.push('');
    }
    for (const [key, value] of pending.entries()) {
        nextLines.push(`${key}=${quoteEnvValue(value)}`);
    }

    const tempPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
        fs.writeFileSync(tempPath, `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')}\n`, {
            encoding: 'utf8',
            mode: 0o600,
        });
        fs.renameSync(tempPath, targetPath);
        try {
            fs.chmodSync(targetPath, 0o600);
        } catch {
            // chmod is best effort (no-op on Windows)
        }
        return targetPath;
    } finally {
        if (fs.existsSync(tempPath)) {
            fs.rmSync(tempPath, { force: true });
        }
    }
}

export interface LayeredEnvResult {
    dataDir: string;
    envFile: string;
    runtimeEnvFile: string;
}

/**
 * Load configuration with this precedence (highest first):
 *   1. real process environment (docker -e, PM2 env, systemd)
 *   2. `${DATA_DIR}/runtime.env` (secrets generated or rotated by NMS itself)
 *   3. repo-root `.env` (operator defaults)
 *
 * Calling it more than once is a no-op for keys already present.
 * Under NODE_ENV=test the repo `.env` is skipped so a developer's real
 * settings (database URL, SMTP, Telegram) never leak into the test suite.
 */
export function loadLayeredEnv(options: { rootDir?: string; envFile?: string; env?: NodeJS.ProcessEnv } = {}): LayeredEnvResult {
    const env = options.env || process.env;
    const rootDir = resolve(options.rootDir || REPO_ROOT);
    const envFile = resolve(options.envFile || resolve(rootDir, '.env'));
    const isTest = String(env.NODE_ENV || '').trim().toLowerCase() === 'test';
    const repoValues = isTest ? {} : readEnvFile(envFile);
    const dataDir = resolveDataDirFrom(env.DATA_DIR || repoValues.DATA_DIR, rootDir);
    const runtimeEnvFile = runtimeEnvFilePath(dataDir);
    const runtimeValues = readEnvFile(runtimeEnvFile);
    const merged: Record<string, string> = { ...repoValues, ...runtimeValues };
    for (const [key, value] of Object.entries(merged)) {
        if (env[key] === undefined || env[key] === '') {
            env[key] = value;
        }
    }
    return { dataDir, envFile, runtimeEnvFile };
}

export function generateSecret(bytes: number = 48): string {
    return crypto.randomBytes(Math.max(32, Number(bytes) || 48)).toString('base64url');
}

export interface GeneratedSecretsResult {
    generated: string[];
    persistedTo: string | null;
}

/**
 * Make sure JWT_SECRET and CREDENTIALS_SECRET exist. A missing value is
 * replaced by a random secret persisted to `${DATA_DIR}/runtime.env`, so
 * NMS never falls back to a constant that anyone can read in the source.
 *
 * Under NODE_ENV=test secrets are generated in memory only.
 */
export function ensureGeneratedSecrets(dataDir: string, env: NodeJS.ProcessEnv = process.env): GeneratedSecretsResult {
    const missing = GENERATED_SECRET_KEYS.filter((key) => !String(env[key] || '').trim());
    if (missing.length === 0) return { generated: [], persistedTo: null };

    const updates: Record<string, string> = {};
    for (const key of missing) {
        updates[key] = generateSecret();
    }

    const isTest = String(env.NODE_ENV || '').trim().toLowerCase() === 'test';
    let persistedTo: string | null = null;
    if (!isTest) {
        const target = runtimeEnvFilePath(dataDir);
        try {
            writeEnvFile(target, updates);
            persistedTo = target;
        } catch (error: any) {
            throw new Error(
                `Unable to persist generated ${missing.join(' / ')} to ${target} (${error?.message || error}). `
                + 'Make DATA_DIR writable, or set these variables explicitly.'
            );
        }
    }

    for (const [key, value] of Object.entries(updates)) {
        env[key] = value;
    }
    return { generated: missing, persistedTo };
}
