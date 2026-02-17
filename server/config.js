import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, isAbsolute } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const DEFAULT_JWT_SECRET = 'default-secret-change-me';
const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const credentialsSecret = process.env.CREDENTIALS_SECRET || jwtSecret;
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
const enforceStrictSecurity = isProduction || process.env.ENFORCE_STRICT_SECURITY === 'true';
const defaultDataDir = resolve(__dirname, '..', 'data');
const isDevelopment = nodeEnv === 'development';

function resolveDataDir(value) {
    const text = String(value || '').trim();
    if (!text) return defaultDataDir;
    if (isAbsolute(text)) return text;
    return resolve(__dirname, '..', text);
}

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function parseStringList(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseHttpUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const parsed = new URL(text);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return text;
    } catch {
        return '';
    }
}

function parseHttpTemplateUrl(value, fallback = '') {
    const text = String(value || '').trim();
    const candidate = text || String(fallback || '').trim();
    if (!candidate) return '';
    try {
        const probe = candidate.replaceAll('{ip}', '1.1.1.1');
        const parsed = new URL(probe);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return candidate;
    } catch {
        return '';
    }
}

function parseStoreReadMode(value, fallback = 'file') {
    const text = String(value || '').trim().toLowerCase();
    if (['file', 'db'].includes(text)) return text;
    return fallback;
}

function parseStoreWriteMode(value, fallback = 'file') {
    const text = String(value || '').trim().toLowerCase();
    if (['file', 'dual', 'db'].includes(text)) return text;
    return fallback;
}

function isWeakJwtSecret(value) {
    const text = String(value || '');
    return text.length < 32 || text === DEFAULT_JWT_SECRET;
}

function isWeakCredentialsSecret(value) {
    const text = String(value || '');
    if (text.length < 32) return true;
    if (text === DEFAULT_JWT_SECRET) return true;
    if (text === jwtSecret) return true;
    return false;
}

function isWeakAdminPassword(value) {
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

function isWeakAdminUsername(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return true;
    if (text.length < 3) return true;
    return ['admin', 'administrator', 'root'].includes(text);
}

if (enforceStrictSecurity && isWeakJwtSecret(jwtSecret)) {
    throw new Error('Unsafe JWT_SECRET. Set a strong secret (length >= 32) before startup.');
}

if (enforceStrictSecurity && isWeakAdminPassword(adminPassword)) {
    throw new Error('Unsafe ADMIN_PASSWORD. Set a strong admin password before startup.');
}

if (enforceStrictSecurity && isWeakAdminUsername(adminUsername)) {
    throw new Error('Unsafe ADMIN_USERNAME. Set a non-default admin username before startup.');
}

if (enforceStrictSecurity && !process.env.CREDENTIALS_SECRET) {
    throw new Error('Unsafe CREDENTIALS_SECRET. Set a dedicated secret (length >= 32) before startup.');
}

if (enforceStrictSecurity && isWeakCredentialsSecret(credentialsSecret)) {
    throw new Error('Unsafe CREDENTIALS_SECRET. Do not reuse JWT_SECRET and use a strong secret (length >= 32).');
}

const config = {
    jwt: {
        secret: jwtSecret,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    },
    auth: {
        adminUsername,
        adminPassword,
        allowLegacyPasswordLogin: parseBoolean(process.env.ALLOW_LEGACY_PASSWORD_LOGIN, true),
    },
    security: {
        enforceStrictSecurity,
    },
    credentials: {
        secret: credentialsSecret,
        legacySecrets: parseStringList(process.env.CREDENTIALS_LEGACY_SECRETS),
    },
    ws: {
        ticketTtlSeconds: parsePositiveInt(process.env.WS_TICKET_TTL_SECONDS, 600),
    },
    smtp: {
        host: process.env.SMTP_HOST || '',
        port: parsePositiveInt(process.env.SMTP_PORT, 587),
        secure: parseBoolean(process.env.SMTP_SECURE, false),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    },
    registration: {
        enabled: parseBoolean(process.env.REGISTRATION_ENABLED, true),
        defaultRole: process.env.REGISTRATION_DEFAULT_ROLE || 'user',
        verifyCodeTtlMinutes: parsePositiveInt(process.env.VERIFY_CODE_TTL_MINUTES, 15),
        passwordResetCodeTtlMinutes: parsePositiveInt(process.env.PASSWORD_RESET_CODE_TTL_MINUTES, 15),
    },
    subscription: {
        defaultTtlDays: parsePositiveInt(process.env.SUB_TOKEN_DEFAULT_TTL_DAYS, 30),
        maxTtlDays: parsePositiveInt(process.env.SUB_TOKEN_MAX_TTL_DAYS, 365),
        maxActiveTokensPerUser: parsePositiveInt(process.env.SUB_TOKEN_MAX_ACTIVE, 5),
        publicBaseUrl: parseHttpUrl(process.env.SUB_PUBLIC_BASE_URL),
        converter: {
            baseUrl: parseHttpUrl(process.env.SUB_CONVERTER_BASE_URL),
            clashConfigUrl: parseHttpUrl(process.env.SUB_CONVERTER_CLASH_CONFIG_URL),
            singboxConfigUrl: parseHttpUrl(process.env.SUB_CONVERTER_SINGBOX_CONFIG_URL),
        },
    },
    audit: {
        retentionDays: parsePositiveInt(process.env.AUDIT_RETENTION_DAYS, 365),
        maxPageSize: parsePositiveInt(process.env.AUDIT_MAX_PAGE_SIZE, 200),
        ipGeo: {
            enabled: parseBoolean(process.env.AUDIT_IP_GEO_ENABLED, false),
            provider: String(process.env.AUDIT_IP_GEO_PROVIDER || 'ip_api').trim().toLowerCase() || 'ip_api',
            endpoint: parseHttpTemplateUrl(process.env.AUDIT_IP_GEO_ENDPOINT, 'http://ip-api.com/json/{ip}?fields=status,country,regionName,city&lang=zh-CN'),
            timeoutMs: parsePositiveInt(process.env.AUDIT_IP_GEO_TIMEOUT_MS, 3000),
            cacheTtlSeconds: parsePositiveInt(process.env.AUDIT_IP_GEO_CACHE_TTL_SECONDS, 21600),
        },
    },
    traffic: {
        retentionDays: parsePositiveInt(process.env.TRAFFIC_RETENTION_DAYS, 365),
        sampleIntervalSeconds: parsePositiveInt(process.env.TRAFFIC_SAMPLE_INTERVAL_SECONDS, 300),
        collectorConcurrency: parsePositiveInt(process.env.TRAFFIC_COLLECTOR_CONCURRENCY, 3),
    },
    jobs: {
        retentionDays: parsePositiveInt(process.env.JOB_RETENTION_DAYS, 90),
        maxPageSize: parsePositiveInt(process.env.JOB_MAX_PAGE_SIZE, 200),
        maxRecords: parsePositiveInt(process.env.JOB_MAX_RECORDS, 2000),
        maxConcurrency: parsePositiveInt(process.env.JOB_MAX_CONCURRENCY, 10),
    },
    servers: {
        allowPrivateServerUrl: parseBoolean(process.env.ALLOW_PRIVATE_SERVER_URL, false),
    },
    db: {
        enabled: parseBoolean(process.env.DB_ENABLED, false),
        url: process.env.DB_URL || '',
        schema: String(process.env.DB_SCHEMA || 'nms').trim() || 'nms',
        poolMax: parsePositiveInt(process.env.DB_POOL_MAX, 10),
        sslMode: String(process.env.DB_SSL_MODE || 'disable').trim().toLowerCase() || 'disable',
        migrationAuto: parseBoolean(process.env.DB_MIGRATION_AUTO, true),
        storeReadMode: parseStoreReadMode(process.env.STORE_READ_MODE, 'file'),
        storeWriteMode: parseStoreWriteMode(process.env.STORE_WRITE_MODE, 'file'),
        backfillRedact: parseBoolean(process.env.DB_BACKFILL_REDACT, true),
        backfillDryRunDefault: parseBoolean(process.env.DB_BACKFILL_DRY_RUN, true),
        privacyMode: String(process.env.DB_PRIVACY_MODE || (isDevelopment ? 'strict' : 'standard')).trim().toLowerCase() || 'standard',
    },
    port: parseInt(process.env.PORT, 10) || 3001,
    nodeEnv,
    // Path to store server registry
    dataDir: resolveDataDir(process.env.DATA_DIR),
};

export default config;
