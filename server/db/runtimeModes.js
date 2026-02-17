import config from '../config.js';

const READ_MODES = new Set(['file', 'db']);
const WRITE_MODES = new Set(['file', 'dual', 'db']);

function normalizeReadMode(value, fallback = 'file') {
    const mode = String(value || '').trim().toLowerCase();
    if (READ_MODES.has(mode)) return mode;
    return fallback;
}

function normalizeWriteMode(value, fallback = 'file') {
    const mode = String(value || '').trim().toLowerCase();
    if (WRITE_MODES.has(mode)) return mode;
    return fallback;
}

let readMode = normalizeReadMode(config.db?.storeReadMode, 'file');
let writeMode = normalizeWriteMode(config.db?.storeWriteMode, 'file');

if (!config.db?.enabled) {
    readMode = 'file';
    writeMode = 'file';
}

export function getStoreModes() {
    return {
        readMode,
        writeMode,
    };
}

export function setStoreModes(next = {}) {
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

export function getSupportedModes() {
    return {
        readModes: Array.from(READ_MODES.values()),
        writeModes: Array.from(WRITE_MODES.values()),
    };
}

export function isDbReadMode() {
    return config.db?.enabled === true && readMode === 'db';
}

export function isDbWriteMode() {
    return config.db?.enabled === true && (writeMode === 'dual' || writeMode === 'db');
}

export function shouldWriteFileByMode() {
    if (!config.db?.enabled) return true;
    return writeMode === 'file' || writeMode === 'dual';
}
