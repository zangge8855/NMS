import config from '../config.js';

const READ_MODES = new Set<string>(['file', 'db']);
const WRITE_MODES = new Set<string>(['file', 'dual', 'db']);

function normalizeReadMode(value: unknown, fallback: string = 'file'): string {
    const mode = String(value || '').trim().toLowerCase();
    if (READ_MODES.has(mode)) return mode;
    return fallback;
}

function normalizeWriteMode(value: unknown, fallback: string = 'file'): string {
    const mode = String(value || '').trim().toLowerCase();
    if (WRITE_MODES.has(mode)) return mode;
    return fallback;
}

let readMode: string = normalizeReadMode(config.db?.storeReadMode, 'file');
let writeMode: string = normalizeWriteMode(config.db?.storeWriteMode, 'file');

if (!config.db?.enabled) {
    readMode = 'file';
    writeMode = 'file';
}

export interface StoreModes {
    readMode: string;
    writeMode: string;
    userStore: string;
}

export function getStoreModes(): StoreModes {
    return {
        readMode,
        writeMode,
        userStore: readMode,
    };
}

export function setStoreModes(next: { readMode?: string; writeMode?: string } = {}): StoreModes {
    if (!config.db?.enabled) {
        readMode = 'file';
        writeMode = 'file';
        return getStoreModes();
    }

    if (next.readMode !== undefined) {
        readMode = normalizeReadMode(next.readMode, readMode);
    }
    if (next.writeMode !== undefined) {
        writeMode = normalizeWriteMode(next.writeMode, writeMode);
    }

    return getStoreModes();
}

export interface SupportedModes {
    readModes: string[];
    writeModes: string[];
}

export function getSupportedModes(): SupportedModes {
    return {
        readModes: Array.from(READ_MODES.values()),
        writeModes: Array.from(WRITE_MODES.values()),
    };
}

export function isDbReadMode(): boolean {
    return config.db?.enabled === true && readMode === 'db';
}

export function isDbWriteMode(): boolean {
    return config.db?.enabled === true && (writeMode === 'dual' || writeMode === 'db');
}

export function shouldWriteFileByMode(): boolean {
    if (!config.db?.enabled) return true;
    return writeMode === 'file' || writeMode === 'dual';
}
