import config from '../config.js';

let PoolCtor = null;
let pool = null;
let initError = null;
let initialized = false;
let ready = false;

function toSslOption() {
    const mode = String(config.db?.sslMode || '').trim().toLowerCase();
    if (!mode || mode === 'disable' || mode === 'false' || mode === 'off') return false;
    if (mode === 'require') {
        return {
            rejectUnauthorized: false,
        };
    }
    return false;
}

async function loadPoolCtor() {
    if (PoolCtor) return PoolCtor;
    const imported = await import('pg');
    PoolCtor = imported.Pool;
    return PoolCtor;
}

export function isDbEnabled() {
    return config.db?.enabled === true;
}

export function isDbReady() {
    return ready === true;
}

export function getDbInitError() {
    return initError;
}

export function getDbPool() {
    return pool;
}

export async function initDb() {
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
        const Pool = await loadPoolCtor();
        const connectionString = String(config.db?.url || '').trim();
        if (!connectionString) {
            throw new Error('DB_URL is required when DB_ENABLED=true');
        }

        pool = new Pool({
            connectionString,
            max: Math.max(1, Number(config.db?.poolMax || 10)),
            ssl: toSslOption(),
        });

        await pool.query('SELECT 1');
        ready = true;
        return {
            enabled: true,
            ready: true,
        };
    } catch (error) {
        ready = false;
        initError = error;
        return {
            enabled: true,
            ready: false,
            error: String(error?.message || error),
        };
    }
}

export async function dbQuery(text, params = []) {
    if (!ready || !pool) {
        throw new Error('Database is not ready');
    }
    return pool.query(text, params);
}

export async function closeDb() {
    if (pool) {
        await pool.end();
    }
    pool = null;
    ready = false;
    initialized = false;
}

export function getDbConnectionStatus() {
    return {
        enabled: isDbEnabled(),
        initialized,
        ready,
        error: initError ? String(initError.message || initError) : '',
    };
}
