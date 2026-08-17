import fs from 'fs';
import path from 'path';
import config from '../config.js';

const BACKUP_STATUS_FILENAME = 'system_backup_status.json';
const BACKUP_CIPHER = 'aes-256-gcm';

function normalizeStoreKeysInput(input: unknown): string[] {
    if (typeof input === 'string') {
        return Array.from(new Set(
            input
                .split(',')
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        ));
    }
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(
        input
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
}

export function backupStatusFilePath(deps: any = {}): string {
    const target = String(deps.backupStatusFile || deps.statusFile || '').trim();
    return target || path.join(config.dataDir, BACKUP_STATUS_FILENAME);
}

function ensureParentDir(filePath: string = ''): void {
    const dir = path.dirname(String(filePath || '').trim());
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeBackupStatusAtomic(filePath: string, data: any): void {
    const content = JSON.stringify(data, null, 2);
    const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tempFile, content, 'utf8');
        fs.renameSync(tempFile, filePath);
    } catch {
        fs.writeFileSync(filePath, content, 'utf8');
    } finally {
        if (fs.existsSync(tempFile)) {
            fs.rmSync(tempFile, { force: true });
        }
    }
}

export interface ExportMeta {
    createdAt: string;
    filename: string;
    bytes: number;
    storeKeys: string[];
    encrypted: boolean;
    cipher: string;
    keyHint: string;
    filePath?: string;
}

function normalizeExportMeta(input: any = {}): ExportMeta | null {
    const createdAt = String(input.createdAt || '').trim();
    const filename = String(input.filename || '').trim();
    if (!createdAt && !filename) return null;
    return {
        createdAt,
        filename,
        bytes: Math.max(0, Number(input.bytes || 0)),
        storeKeys: normalizeStoreKeysInput(input.storeKeys),
        encrypted: input.encrypted !== false,
        cipher: String(input.cipher || BACKUP_CIPHER).trim() || BACKUP_CIPHER,
        keyHint: String(input.keyHint || 'CREDENTIALS_SECRET').trim() || 'CREDENTIALS_SECRET',
    };
}

export interface ImportMeta {
    restoredAt: string;
    sourceCreatedAt: string;
    sourceFilename: string;
    bytes: number;
    storeKeys: string[];
    restored: number;
    failed: number;
}

function normalizeImportMeta(input: any = {}): ImportMeta | null {
    const restoredAt = String(input.restoredAt || '').trim();
    const sourceFilename = String(input.sourceFilename || '').trim();
    if (!restoredAt && !sourceFilename) return null;
    return {
        restoredAt,
        sourceCreatedAt: String(input.sourceCreatedAt || '').trim(),
        sourceFilename,
        bytes: Math.max(0, Number(input.bytes || 0)),
        storeKeys: normalizeStoreKeysInput(input.storeKeys),
        restored: Math.max(0, Number(input.restored || 0)),
        failed: Math.max(0, Number(input.failed || 0)),
    };
}

export interface TelegramBackupMeta {
    status: 'sent' | 'failed';
    ts: string;
    filename: string;
    bytes: number;
    storeKeys: string[];
    chatIdPreview: string;
    actor: string;
    reason: string;
    error: string;
}

function normalizeTelegramBackupMeta(input: any = {}): TelegramBackupMeta | null {
    const status: 'sent' | 'failed' = String(input.status || '').trim().toLowerCase() === 'failed' ? 'failed' : 'sent';
    const ts = String(input.ts || input.sentAt || '').trim();
    const filename = String(input.filename || '').trim();
    if (!ts && !filename) return null;
    return {
        status,
        ts,
        filename,
        bytes: Math.max(0, Number(input.bytes || 0)),
        storeKeys: normalizeStoreKeysInput(input.storeKeys),
        chatIdPreview: String(input.chatIdPreview || '').trim(),
        actor: String(input.actor || 'system').trim() || 'system',
        reason: String(input.reason || 'manual').trim() || 'manual',
        error: status === 'failed' ? String(input.error || '').trim() : '',
    };
}

export interface PersistedBackupState {
    lastExport: ExportMeta | null;
    lastImport: ImportMeta | null;
    lastTelegramBackup: TelegramBackupMeta | null;
}

export function loadPersistedBackupState(deps: any = {}): PersistedBackupState {
    const filePath = backupStatusFilePath(deps);
    try {
        if (!fs.existsSync(filePath)) {
            return {
                lastExport: null,
                lastImport: null,
                lastTelegramBackup: null,
            };
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        return {
            lastExport: normalizeExportMeta(root.lastExport || {}),
            lastImport: normalizeImportMeta(root.lastImport || {}),
            lastTelegramBackup: normalizeTelegramBackupMeta(root.lastTelegramBackup || {}),
        };
    } catch {
        return {
            lastExport: null,
            lastImport: null,
            lastTelegramBackup: null,
        };
    }
}

export function persistBackupState(state: any = {}, deps: any = {}): void {
    const filePath = backupStatusFilePath(deps);
    ensureParentDir(filePath);
    writeBackupStatusAtomic(filePath, {
        lastExport: state.lastExport ? { ...state.lastExport } : null,
        lastImport: state.lastImport ? { ...state.lastImport } : null,
        lastTelegramBackup: state.lastTelegramBackup ? { ...state.lastTelegramBackup } : null,
    });
}

export function getLatestTelegramBackupMeta(deps: any = {}): TelegramBackupMeta | null {
    const state = loadPersistedBackupState(deps);
    return state.lastTelegramBackup ? { ...state.lastTelegramBackup } : null;
}

export function resetPersistedBackupState(deps: any = {}): void {
    const filePath = backupStatusFilePath(deps);
    if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
    }
}
