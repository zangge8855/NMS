import fs from 'fs';
import config from '../config.js';
import type { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

let PoolCtor: typeof Pool | null = null;
let pool: Pool | null = null;
let initError: any = null;
let initialized: boolean = false;
let ready: boolean = false;

type SslOption = false | { rejectUnauthorized: boolean; ca?: string; checkServerIdentity?: () => undefined };

let warnedUnverifiedSsl = false;

/**
 * Map DB_SSL_MODE onto the pg TLS options, following libpq semantics:
 *   disable                      → plaintext
 *   require / prefer / allow     → encrypted, server certificate NOT verified
 *   verify-ca                    → encrypted, chain verified, hostname not checked
 *   verify-full / true / on      → encrypted, chain and hostname verified
 * An unknown value fails closed to verify-full instead of silently disabling TLS.
 * DB_SSL_CA_FILE supplies the CA bundle for a private certificate authority.
 */
export function toSslOption(
    mode: unknown = config.db?.sslMode,
    caFile: unknown = config.db?.sslCaFile,
): SslOption {
    const normalized = String(mode || '').trim().toLowerCase();
    if (!normalized || normalized === 'disable' || normalized === 'false' || normalized === 'off') return false;

    if (normalized === 'require' || normalized === 'prefer' || normalized === 'allow') {
        if (!warnedUnverifiedSsl) {
            warnedUnverifiedSsl = true;
            console.warn(`[DB] DB_SSL_MODE=${normalized} encrypts traffic but does not verify the server certificate. Use verify-full (with DB_SSL_CA_FILE for a private CA) to prevent man-in-the-middle attacks.`);
        }
        return { rejectUnauthorized: false };
    }

    const option: Exclude<SslOption, false> = { rejectUnauthorized: true };
    const caPath = String(caFile || '').trim();
    if (caPath) {
        option.ca = fs.readFileSync(caPath, 'utf8');
    }
    if (normalized === 'verify-ca') {
        option.checkServerIdentity = () => undefined;
    }
    return option;
}

async function loadPoolCtor(): Promise<typeof Pool> {
    if (PoolCtor) return PoolCtor;
    const imported = await import('pg');
    PoolCtor = imported.default?.Pool || (imported as any).Pool;
    return PoolCtor;
}

export function isDbEnabled(): boolean {
    return config.db?.enabled === true;
}

export function isDbReady(): boolean {
    return ready === true;
}

export function getDbInitError(): any {
    return initError;
}

export function getDbPool(): Pool | null {
    return pool;
}

export interface DbInitResult {
    enabled: boolean;
    ready: boolean;
    message?: string;
    error?: string;
}

export async function initDb(): Promise<DbInitResult> {
    if (!isDbEnabled()) {
        initialized = true;
        ready = false;
        initError = null;
        return {
            enabled: false,
            ready: false,
            message: 'Database integration disabled',
        };
    }

    if (initialized && pool) {
        return {
            enabled: true,
            ready,
            error: initError ? String(initError.message || initError) : '',
        };
    }

    initialized = true;
    initError = null;

    try {
        const PoolClass = await loadPoolCtor();
        const connectionString = String(config.db?.url || '').trim();
        if (!connectionString) {
            throw new Error('DB_URL is required when DB_ENABLED=true');
        }

        const poolConfig: PoolConfig = {
            connectionString,
            max: Math.max(1, Number(config.db?.poolMax || 10)),
            ssl: toSslOption(),
            connectionTimeoutMillis: 10000,
            statement_timeout: 10000,
            query_timeout: 10000,
        };

        pool = new PoolClass(poolConfig);

        await pool.query('SELECT 1');
        ready = true;
        return {
            enabled: true,
            ready: true,
        };
    } catch (error: any) {
        ready = false;
        initError = error;
        return {
            enabled: true,
            ready: false,
            error: String(error?.message || error),
        };
    }
}

export async function dbQuery<R extends QueryResultRow = any>(text: string, params: any[] = []): Promise<QueryResult<R>> {
    if (!ready || !pool) {
        throw new Error('Database is not ready');
    }
    return pool.query<R>(text, params);
}

export async function closeDb(): Promise<void> {
    if (pool) {
        await pool.end();
    }
    pool = null;
    ready = false;
    initialized = false;
}

export interface DbConnectionStatus {
    enabled: boolean;
    initialized: boolean;
    ready: boolean;
    error: string;
}

export function getDbConnectionStatus(): DbConnectionStatus {
    return {
        enabled: isDbEnabled(),
        initialized,
        ready,
        error: initError ? String(initError.message || initError) : '',
    };
}
