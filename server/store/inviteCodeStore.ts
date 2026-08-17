import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const STORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_SEGMENT_LENGTH = 4;
const INVITE_SEGMENT_COUNT = 3;

function resolveDataDir(value?: unknown): string {
    const text = String(value ?? process.env.DATA_DIR ?? '').trim();
    if (!text) return config.dataDir;
    if (path.isAbsolute(text)) return text;
    return path.resolve(STORE_DIR, '..', text);
}

function ensureDataDir(dataDir: string): void {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function safeClone<T = any>(value: T): T | null {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function normalizeInviteCode(value: unknown): string {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function formatInviteCode(code: unknown): string {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return '';
    const segments: string[] = [];
    for (let index = 0; index < normalized.length; index += INVITE_SEGMENT_LENGTH) {
        segments.push(normalized.slice(index, index + INVITE_SEGMENT_LENGTH));
    }
    return segments.join('-');
}

function buildPreview(code: unknown): string {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return '';
    if (normalized.length <= INVITE_SEGMENT_LENGTH * 2) {
        return formatInviteCode(normalized);
    }
    const head = normalized.slice(0, INVITE_SEGMENT_LENGTH);
    const tail = normalized.slice(-INVITE_SEGMENT_LENGTH);
    return `${head}-****-${tail}`;
}

function hashInviteCode(code: unknown): string {
    return crypto.createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
}

function generateInviteCode(): string {
    const totalLength = INVITE_SEGMENT_LENGTH * INVITE_SEGMENT_COUNT;
    let code = '';
    for (let index = 0; index < totalLength; index += 1) {
        const next = crypto.randomInt(0, INVITE_ALPHABET.length);
        code += INVITE_ALPHABET[next];
    }
    return formatInviteCode(code);
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeTargetEmail(value: unknown): string {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : '';
}

function normalizePositiveInt(value: unknown, fallback: number, options: { min?: number; max?: number } = {}): number {
    const parsed = Number.parseInt(String(value), 10);
    let output = Number.isInteger(parsed) ? parsed : fallback;
    if (Number.isInteger(options.min)) output = Math.max(options.min!, output);
    if (Number.isInteger(options.max)) output = Math.min(options.max!, output);
    return output;
}

function normalizeNonNegativeInt(value: unknown, fallback: number, options: { max?: number } = {}): number {
    const parsed = Number.parseInt(String(value), 10);
    let output = Number.isInteger(parsed) ? parsed : fallback;
    output = Math.max(0, output);
    if (Number.isInteger(options.max)) output = Math.min(options.max!, output);
    return output;
}

function normalizeSubscriptionDays(value: unknown, fallback: number = 0): number {
    return normalizeNonNegativeInt(value, fallback, { max: 3650 });
}

function normalizeRecord(input: any = {}): any {
    const rawId = normalizeText(input.id);
    const id = rawId || crypto.randomUUID();
    const codeHash = normalizeText(input.codeHash).toLowerCase();
    const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
    const preview = normalizeText(input.preview);
    const createdBy = normalizeText(input.createdBy);
    const targetEmail = normalizeTargetEmail(input.targetEmail);
    const usedAt = normalizeText(input.usedAt);
    const usedByUserId = normalizeText(input.usedByUserId);
    const usedByUsername = normalizeText(input.usedByUsername);
    const revokedAt = normalizeText(input.revokedAt);
    const revokedBy = normalizeText(input.revokedBy);
    const usageLimit = normalizePositiveInt(input.usageLimit, 1, { min: 1, max: 1000 });
    const subscriptionDays = normalizeSubscriptionDays(input.subscriptionDays, 0);
    const legacyUsedCount = usedAt ? 1 : 0;
    const usedCount = Math.min(
        usageLimit,
        normalizeNonNegativeInt(input.usedCount, legacyUsedCount, { max: 1000 })
    );

    return {
        id,
        codeHash,
        preview,
        createdAt,
        createdBy,
        targetEmail,
        usageLimit,
        subscriptionDays,
        usedCount,
        usedAt: usedAt || null,
        usedByUserId: usedByUserId || '',
        usedByUsername: usedByUsername || '',
        revokedAt: revokedAt || null,
        revokedBy: revokedBy || '',
    };
}

function resolveStatus(record: any = {}): 'revoked' | 'used' | 'active' {
    if (record.revokedAt) return 'revoked';
    if (Number(record.usedCount || 0) >= Number(record.usageLimit || 1)) return 'used';
    return 'active';
}

class InviteCodeStore {
    dataDir: string;
    filePath: string;
    invites: any[];

    constructor(options: any = {}) {
        this.dataDir = resolveDataDir(options.dataDir);
        this.filePath = path.join(this.dataDir, 'invite_codes.json');
        ensureDataDir(this.dataDir);
        this.invites = this._load();
    }

    _load(): any[] {
        if (!fs.existsSync(this.filePath)) {
            return [];
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(parsed)) {
                throw new Error('Data in invite_codes.json is not a JSON array');
            }
            return parsed
                .map((item: any) => normalizeRecord(item))
                .filter((item: any) => item.codeHash && item.preview);
        } catch (error: any) {
            console.error('Failed to load invite_codes.json:', error.message);
            throw error;
        }
    }

    _save(): void {
        saveObjectAtomic(this.filePath, this.invites);
        mirrorStoreSnapshot('invite_codes', this.exportState());
    }

    _findById(id: unknown): any {
        const normalizedId = normalizeText(id);
        if (!normalizedId) return null;
        return this.invites.find((item) => item.id === normalizedId) || null;
    }

    _findByCode(code: unknown): any {
        const normalizedCode = normalizeInviteCode(code);
        if (!normalizedCode) return null;
        const codeHash = hashInviteCode(normalizedCode);
        return this.invites.find((item) => item.codeHash === codeHash) || null;
    }

    _toPublicRecord(record: any = {}): any {
        const usageLimit = normalizePositiveInt(record.usageLimit, 1, { min: 1, max: 1000 });
        const usedCount = Math.min(
            usageLimit,
            normalizeNonNegativeInt(record.usedCount, record.usedAt ? 1 : 0, { max: 1000 })
        );
        return {
            id: record.id,
            preview: record.preview,
            status: resolveStatus(record),
            createdAt: record.createdAt,
            createdBy: record.createdBy || '',
            targetEmail: record.targetEmail || '',
            usageLimit,
            subscriptionDays: normalizeSubscriptionDays(record.subscriptionDays, 0),
            usedCount,
            remainingUses: Math.max(0, usageLimit - usedCount),
            usedAt: record.usedAt || null,
            usedByUserId: record.usedByUserId || '',
            usedByUsername: record.usedByUsername || '',
            revokedAt: record.revokedAt || null,
            revokedBy: record.revokedBy || '',
        };
    }

    list(): any[] {
        return this.invites
            .map((item) => this._toPublicRecord(item))
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }

    create(options: any = {}): any {
        const count = normalizePositiveInt(options.count, 1, { min: 1, max: 50 });
        const usageLimit = normalizePositiveInt(options.usageLimit, 1, { min: 1, max: 1000 });
        const subscriptionDays = normalizeSubscriptionDays(options.subscriptionDays, 0);
        const existingHashes = new Set(this.invites.map((item) => item.codeHash));
        const createdHashes = new Set<string>();
        const codes: string[] = [];
        const records: any[] = [];
        let attempts = 0;

        while (records.length < count && attempts < count * 40) {
            attempts += 1;
            const code = generateInviteCode();
            const codeHash = hashInviteCode(code);
            if (existingHashes.has(codeHash) || createdHashes.has(codeHash)) continue;

            createdHashes.add(codeHash);
            codes.push(code);
            records.push(normalizeRecord({
                id: crypto.randomUUID(),
                codeHash,
                preview: buildPreview(code),
                createdAt: new Date().toISOString(),
                createdBy: normalizeText(options.createdBy),
                targetEmail: normalizeTargetEmail(options.targetEmail),
                usageLimit,
                subscriptionDays,
                usedCount: 0,
            }));
        }

        if (records.length !== count) {
            throw new Error('生成邀请码失败，请重试');
        }

        this.invites.unshift(...records);
        this._save();

        return {
            code: codes[0] || '',
            codes,
            count: codes.length,
            usageLimit,
            subscriptionDays,
            invite: this._toPublicRecord(records[0]),
            invites: records.map((item) => this._toPublicRecord(item)),
        };
    }

    assertUsable(code: unknown): any {
        const record = this._findByCode(code);
        if (!record) {
            throw new Error('邀请码无效');
        }
        if (record.revokedAt) {
            throw new Error('邀请码已失效');
        }
        if (Number(record.usedCount || 0) >= Number(record.usageLimit || 1)) {
            throw new Error(Number(record.usageLimit || 1) > 1 ? '邀请码已用完' : '邀请码已被使用');
        }
        return this._toPublicRecord(record);
    }

    consume(code: unknown, options: any = {}): any {
        const record = this._findByCode(code);
        if (!record) {
            throw new Error('邀请码无效');
        }
        if (record.revokedAt) {
            throw new Error('邀请码已失效');
        }
        if (Number(record.usedCount || 0) >= Number(record.usageLimit || 1)) {
            throw new Error(Number(record.usageLimit || 1) > 1 ? '邀请码已用完' : '邀请码已被使用');
        }

        record.usedCount = normalizeNonNegativeInt(record.usedCount, record.usedAt ? 1 : 0, { max: 1000 }) + 1;
        record.usedAt = new Date().toISOString();
        record.usedByUserId = normalizeText(options.usedByUserId);
        record.usedByUsername = normalizeText(options.usedByUsername);
        this._save();
        return this._toPublicRecord(record);
    }

    revoke(id: unknown, options: any = {}): any {
        const record = this._findById(id);
        if (!record) {
            throw new Error('邀请码不存在');
        }
        if (record.revokedAt) {
            return this._toPublicRecord(record);
        }
        if (Number(record.usedCount || 0) >= Number(record.usageLimit || 1)) {
            throw new Error(Number(record.usageLimit || 1) > 1 ? '已用完的邀请码不能撤销' : '已使用的邀请码不能撤销');
        }

        record.revokedAt = new Date().toISOString();
        record.revokedBy = normalizeText(options.revokedBy);
        this._save();
        return this._toPublicRecord(record);
    }

    exportState(): any {
        return {
            invites: safeClone(this.invites) || [],
        };
    }

    importState(snapshot: any = {}): void {
        if (!snapshot || !Array.isArray(snapshot?.invites)) {
            throw new Error('Invalid snapshot format for InviteCodeStore: invites array is missing');
        }
        this.invites = snapshot.invites
            .map((item: any) => normalizeRecord(item))
            .filter((item: any) => item.codeHash && item.preview);
    }
}

const inviteCodeStore = new InviteCodeStore();

export {
    buildPreview,
    formatInviteCode,
    generateInviteCode,
    hashInviteCode,
    normalizeSubscriptionDays,
    normalizeInviteCode,
    resolveStatus,
    InviteCodeStore,
};

export default inviteCodeStore;
