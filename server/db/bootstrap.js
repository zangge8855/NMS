import config from '../config.js';
import { initDb, getDbConnectionStatus } from './client.js';
import { ensureDbSchema } from './schema.js';
import { loadRuntimeModesFromDb } from './modeState.js';

export async function bootstrapDatabase() {
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
    } catch (error) {
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
