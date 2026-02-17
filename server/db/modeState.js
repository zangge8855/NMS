import { dbQuery, isDbEnabled, isDbReady } from './client.js';
import { getDbSchemaName } from './schema.js';
import { getStoreModes, setStoreModes } from './runtimeModes.js';

function qIdent(identifier) {
    return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

function tableName() {
    return `${qIdent(getDbSchemaName())}.runtime_modes`;
}

export async function loadRuntimeModesFromDb() {
    if (!isDbEnabled() || !isDbReady()) return getStoreModes();
    const res = await dbQuery(`SELECT read_mode, write_mode FROM ${tableName()} WHERE id = 1 LIMIT 1;`);
    const row = res.rows?.[0];
    if (!row) return getStoreModes();
    const current = getStoreModes();
    const dbModes = {
        readMode: row.read_mode,
        writeMode: row.write_mode,
    };

    // Keep env-configured non-default mode on first boot.
    const dbIsDefault = dbModes.readMode === 'file' && dbModes.writeMode === 'file';
    const currentIsDefault = current.readMode === 'file' && current.writeMode === 'file';
    if (dbIsDefault && !currentIsDefault) {
        await dbQuery(
            `UPDATE ${tableName()} SET read_mode = $1, write_mode = $2, updated_at = NOW() WHERE id = 1;`,
            [current.readMode, current.writeMode]
        );
        return current;
    }

    return setStoreModes(dbModes);
}

export async function saveRuntimeModesToDb(modes = {}) {
    if (!isDbEnabled() || !isDbReady()) return getStoreModes();
    const normalized = setStoreModes(modes);
    await dbQuery(
        `
        INSERT INTO ${tableName()} (id, read_mode, write_mode, updated_at)
        VALUES (1, $1, $2, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
            read_mode = EXCLUDED.read_mode,
            write_mode = EXCLUDED.write_mode,
            updated_at = NOW();
        `,
        [normalized.readMode, normalized.writeMode]
    );
    return normalized;
}
