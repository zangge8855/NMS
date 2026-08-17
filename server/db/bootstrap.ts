import config from '../config.js';
import { initDb, getDbConnectionStatus, type DbInitResult, type DbConnectionStatus } from './client.js';
import { ensureDbSchema } from './schema.js';
import { loadRuntimeModesFromDb } from './modeState.js';

export interface DbBootstrapResult extends DbInitResult {
    schema?: string;
    modesLoaded: boolean;
    connection?: DbConnectionStatus;
    error?: string;
}

export async function bootstrapDatabase(): Promise<DbBootstrapResult> {
    const initialized = await initDb();

    if (!initialized.enabled || !initialized.ready) {
        return {
            ...initialized,
            schema: '',
            modesLoaded: false,
        };
    }

    let schema = '';
    let modesLoaded = false;

    try {
        if (config.db?.migrationAuto !== false) {
            const out = await ensureDbSchema();
            schema = out.schema || '';
        }

        await loadRuntimeModesFromDb();
        modesLoaded = true;
    } catch (error: any) {
        return {
            enabled: true,
            ready: true,
            schema,
            modesLoaded,
            error: String(error?.message || error),
        };
    }

    return {
        enabled: true,
        ready: true,
        schema,
        modesLoaded,
        connection: getDbConnectionStatus(),
    };
}
