import fs from 'fs';
import path from 'path';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import config from '../config.js';

let dbInstance: any = null;
let initialized = false;
let ready = false;
let sqlitePath = '';

export function isSqliteEnabled(): boolean {
    const engine = String(process.env.DB_ENGINE || '').trim().toLowerCase();
    const enabled = process.env.SQLITE_ENABLED === 'true' || engine === 'sqlite';
    return enabled;
}

export function isSqliteReady(): boolean {
    return ready === true && dbInstance !== null;
}

export function getSqliteDb(): any {
    return dbInstance;
}

export function initSqliteDb(targetPath?: string): boolean {
    if (initialized && ready && dbInstance) return true;

    try {
        if (!DatabaseSync) {
            throw new Error('node:sqlite DatabaseSync is not supported in this Node.js runtime');
        }
        
        sqlitePath = targetPath || path.join(config.dataDir, 'nms.sqlite');
        const dir = path.dirname(sqlitePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        dbInstance = new DatabaseSync(sqlitePath);
        
        // Optimize SQLite performance & concurrency with WAL mode
        dbInstance.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS snapshots (
                store_key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);

        initialized = true;
        ready = true;
        return true;
    } catch (error: any) {
        console.error('[SQLite] Failed to initialize SQLite database:', error.message || error);
        ready = false;
        return false;
    }
}

export function sqliteReadSnapshot<T = any>(storeKey: string): T | null {
    if (!isSqliteReady()) return null;
    try {
        const stmt = dbInstance.prepare('SELECT payload FROM snapshots WHERE store_key = ?');
        const row = stmt.get(storeKey);
        if (!row || !row.payload) return null;
        return JSON.parse(row.payload) as T;
    } catch {
        return null;
    }
}

export function sqliteWriteSnapshot(storeKey: string, payload: any): boolean {
    if (!isSqliteReady()) return false;
    try {
        const serialized = JSON.stringify(payload);
        const now = new Date().toISOString();
        const stmt = dbInstance.prepare(`
            INSERT INTO snapshots (store_key, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(store_key) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
        `);
        stmt.run(storeKey, serialized, now);
        return true;
    } catch (error: any) {
        console.error(`[SQLite] Failed to write snapshot for ${storeKey}:`, error.message || error);
        return false;
    }
}

export function closeSqliteDb(): void {
    if (dbInstance) {
        try {
            dbInstance.close();
        } catch {
            // ignore
        }
    }
    dbInstance = null;
    ready = false;
    initialized = false;
}
