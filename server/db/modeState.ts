import { dbQuery, isDbEnabled, isDbReady } from './client.js';
import { getDbSchemaName } from './schema.js';
import { getStoreModes, setStoreModes, type StoreModes } from './runtimeModes.js';

function qIdent(identifier: string): string {
    return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

function tableName(): string {
    return `${qIdent(getDbSchemaName())}.runtime_modes`;
}

export async function loadRuntimeModesFromDb(): Promise<StoreModes> {
    if (!isDbEnabled() || !isDbReady()) return getStoreModes();
    const res = await dbQuery(`SELECT read_mode, write_mode, initialized FROM ${tableName()} WHERE id = 1 LIMIT 1;`);
    const row = res.rows?.[0];
    if (!row) return getStoreModes();
    const current = getStoreModes();
    const dbModes = {
        readMode: row.read_mode,
        writeMode: row.write_mode,
    };

    const isInitialized = row.initialized === true;
    const dbIsDefault = dbModes.readMode === 'file' && dbModes.writeMode === 'file';
    const currentIsDefault = current.readMode === 'file' && current.writeMode === 'file';

    // Only treat DB 'file'/'file' as first-boot seed when runtime_modes has not been explicitly initialized yet.
    if (!isInitialized && dbIsDefault && !currentIsDefault) {
        await dbQuery(
            `UPDATE ${tableName()} SET read_mode = $1, write_mode = $2, initialized = TRUE, updated_at = NOW() WHERE id = 1;`,
            [current.readMode, current.writeMode]
        );
        return current;
    }

    if (!isInitialized) {
        await dbQuery(
            `UPDATE ${tableName()} SET initialized = TRUE, updated_at = NOW() WHERE id = 1;`
        );
    }

    return setStoreModes(dbModes);
}

export async function saveRuntimeModesToDb(modes: { readMode?: string; writeMode?: string } = {}): Promise<StoreModes> {
    if (!isDbEnabled() || !isDbReady()) return getStoreModes();
    const normalized = setStoreModes(modes);
    await dbQuery(
        `
        INSERT INTO ${tableName()} (id, read_mode, write_mode, initialized, updated_at)
        VALUES (1, $1, $2, TRUE, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
            read_mode = EXCLUDED.read_mode,
            write_mode = EXCLUDED.write_mode,
            initialized = TRUE,
            updated_at = NOW();
        `,
        [normalized.readMode, normalized.writeMode]
    );
    return normalized;
}
