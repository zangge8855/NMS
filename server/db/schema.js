import config from '../config.js';
import { dbQuery, isDbEnabled, isDbReady } from './client.js';

function safeSchemaName(raw) {
    const text = String(raw || '').trim();
    if (!text) return 'public';
    const sanitized = text.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    return sanitized || 'public';
}

export function getDbSchemaName() {
    return safeSchemaName(config.db?.schema || 'public');
}

function qIdent(identifier) {
    return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

export async function ensureDbSchema() {
    if (!isDbEnabled() || !isDbReady()) return { applied: false };

    const schema = getDbSchemaName();
    const s = qIdent(schema);

    await dbQuery(`CREATE SCHEMA IF NOT EXISTS ${s};`);

    await dbQuery(`
        CREATE TABLE IF NOT EXISTS ${s}.store_snapshots (
            store_key TEXT PRIMARY KEY,
            payload JSONB NOT NULL,
            payload_size INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await dbQuery(`
        CREATE TABLE IF NOT EXISTS ${s}.runtime_modes (
            id SMALLINT PRIMARY KEY,
            read_mode TEXT NOT NULL,
            write_mode TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await dbQuery(`
        INSERT INTO ${s}.runtime_modes (id, read_mode, write_mode)
        VALUES (1, 'file', 'file')
        ON CONFLICT (id) DO NOTHING;
    `);

    return {
        applied: true,
        schema,
    };
}
