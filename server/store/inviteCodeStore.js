import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const INVITE_CODES_FILE = path.join(config.dataDir, 'invite_codes.json');
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_SEGMENT_LENGTH = 4;
const INVITE_SEGMENT_COUNT = 3;

function ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function safeClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function normalizeInviteCode(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function formatInviteCode(code) {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return '';
    const segments = [];
    for (let index = 0; index < normalized.length; index += INVITE_SEGMENT_LENGTH) {
        segments.push(normalized.slice(index, index + INVITE_SEGMENT_LENGTH));
    }
    return segments.join('-');
}

function buildPreview(code) {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return '';
    if (normalized.length <= INVITE_SEGMENT_LENGTH * 2) {
        return formatInviteCode(normalized);
    }
    const head = normalized.slice(0, INVITE_SEGMENT_LENGTH);
    const tail = normalized.slice(-INVITE_SEGMENT_LENGTH);
    return `${head}-****-${tail}`;
}

function hashInviteCode(code) {
    return crypto.createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
}

function generateInviteCode() {
    const totalLength = INVITE_SEGMENT_LENGTH * INVITE_SEGMENT_COUNT;
    let code = '';
    for (let index = 0; index < totalLength; index += 1) {
        const next = crypto.randomInt(0, INVITE_ALPHABET.length);
        code += INVITE_ALPHABET[next];
    }
    return formatInviteCode(code);
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeRecord(input = {}) {
    const rawId = normalizeText(input.id);
    const id = rawId || crypto.randomUUID();
    const codeHash = normalizeText(input.codeHash).toLowerCase();
    const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
    const preview = normalizeText(input.preview);
    const createdBy = normalizeText(input.createdBy);
    const usedAt = normalizeText(input.usedAt);
    const usedByUserId = normalizeText(input.usedByUserId);
    const usedByUsername = normalizeText(input.usedByUsername);
    const revokedAt = normalizeText(input.revokedAt);
    const revokedBy = normalizeText(input.revokedBy);

    return {
        id,
        codeHash,
        preview,
        createdAt,
        createdBy,
        usedAt: usedAt || null,
        usedByUserId: usedByUserId || '',
        usedByUsername: usedByUsername || '',
        revokedAt: revokedAt || null,
        revokedBy: revokedBy || '',
    };
}

function resolveStatus(record = {}) {
    if (record.revokedAt) return 'revoked';
    if (record.usedAt) return 'used';
    return 'active';
}

class InviteCodeStore {
    constructor() {
        ensureDataDir();
        this.invites = this._load();
    }

    _load() {
        try {
            if (!fs.existsSync(INVITE_CODES_FILE)) {
                return [];
            }
            const parsed = JSON.parse(fs.readFileSync(INVITE_CODES_FILE, 'utf8'));
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((item) => normalizeRecord(item))
                .filter((item) => item.codeHash && item.preview);
        } catch (error) {
            console.error('Failed to load invite_codes.json:', error.message);
            return [];
        }
    }

    _save() {
        saveObjectAtomic(INVITE_CODES_FILE, this.invites);
        mirrorStoreSnapshot('invite_codes', this.exportState());
    }

    _findById(id) {
        const normalizedId = normalizeText(id);
        if (!normalizedId) return null;
        return this.invites.find((item) => item.id === normalizedId) || null;
    }

    _findByCode(code) {
        const normalizedCode = normalizeInviteCode(code);
        if (!normalizedCode) return null;
        const codeHash = hashInviteCode(normalizedCode);
        return this.invites.find((item) => item.codeHash === codeHash) || null;
    }

    _toPublicRecord(record = {}) {
        return {
            id: record.id,
            preview: record.preview,
            status: resolveStatus(record),
            createdAt: record.createdAt,
            createdBy: record.createdBy || '',
            usedAt: record.usedAt || null,
            usedByUserId: record.usedByUserId || '',
            usedByUsername: record.usedByUsername || '',
            revokedAt: record.revokedAt || null,
            revokedBy: record.revokedBy || '',
        };
    }

    list() {
        return this.invites
            .map((item) => this._toPublicRecord(item))
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }

    create(options = {}) {
        const code = generateInviteCode();
        const record = normalizeRecord({
            id: crypto.randomUUID(),
            codeHash: hashInviteCode(code),
            preview: buildPreview(code),
            createdAt: new Date().toISOString(),
            createdBy: normalizeText(options.createdBy),
        });

        this.invites.unshift(record);
        this._save();

        return {
            code,
            invite: this._toPublicRecord(record),
        };
    }

    assertUsable(code) {
        const record = this._findByCode(code);
        if (!record) {
            throw new Error('邀请码无效');
        }
        if (record.revokedAt) {
            throw new Error('邀请码已失效');
        }
        if (record.usedAt) {
            throw new Error('邀请码已被使用');
        }
        return this._toPublicRecord(record);
    }

    consume(code, options = {}) {
        const record = this._findByCode(code);
        if (!record) {
            throw new Error('邀请码无效');
        }
        if (record.revokedAt) {
            throw new Error('邀请码已失效');
        }
        if (record.usedAt) {
            throw new Error('邀请码已被使用');
        }

        record.usedAt = new Date().toISOString();
        record.usedByUserId = normalizeText(options.usedByUserId);
        record.usedByUsername = normalizeText(options.usedByUsername);
        this._save();
        return this._toPublicRecord(record);
    }

    revoke(id, options = {}) {
        const record = this._findById(id);
        if (!record) {
            throw new Error('邀请码不存在');
        }
        if (record.usedAt) {
            throw new Error('已使用的邀请码不能撤销');
        }
        if (record.revokedAt) {
            return this._toPublicRecord(record);
        }

        record.revokedAt = new Date().toISOString();
        record.revokedBy = normalizeText(options.revokedBy);
        this._save();
        return this._toPublicRecord(record);
    }

    exportState() {
        return {
            invites: safeClone(this.invites) || [],
        };
    }

    importState(snapshot = {}) {
        this.invites = Array.isArray(snapshot?.invites)
            ? snapshot.invites
                .map((item) => normalizeRecord(item))
                .filter((item) => item.codeHash && item.preview)
            : [];
    }
}

const inviteCodeStore = new InviteCodeStore();

export {
    buildPreview,
    formatInviteCode,
    generateInviteCode,
    hashInviteCode,
    normalizeInviteCode,
    resolveStatus,
    InviteCodeStore,
};

export default inviteCodeStore;
