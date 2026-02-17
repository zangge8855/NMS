import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot, shouldWriteFile } from './dbMirror.js';

const TOKENS_FILE = path.join(config.dataDir, 'subscription_tokens.json');
const TOKEN_ENC_PREFIX = 'subtok:v1';
const TOKEN_ENC_ALGO = 'aes-256-gcm';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function toIsoOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hashTokenSecret(secret) {
    return crypto
        .createHmac('sha256', config.jwt.secret)
        .update(String(secret || ''))
        .digest('hex');
}

function generatePublicTokenId() {
    return crypto.randomBytes(16).toString('hex');
}

class SubscriptionTokenStore {
    constructor() {
        this._ensureDataDir();
        this.tokens = this._load();
        if (this._ensurePublicIds()) {
            this._save();
        }
    }

    _ensureDataDir() {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    _load() {
        try {
            if (fs.existsSync(TOKENS_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (error) {
            console.error('Failed to load subscription_tokens.json:', error.message);
        }
        return [];
    }

    _resolvePublicId(record) {
        const explicit = String(record?.publicId || '').trim();
        if (explicit) return explicit;
        return String(record?.id || '').trim();
    }

    _ensurePublicIds() {
        let changed = false;
        const used = new Set(
            this.tokens
                .map((item) => String(item?.publicId || '').trim())
                .filter(Boolean)
        );
        for (const record of this.tokens) {
            const current = String(record?.publicId || '').trim();
            if (current) {
                used.add(current);
                continue;
            }
            let next = generatePublicTokenId();
            while (used.has(next)) {
                next = generatePublicTokenId();
            }
            record.publicId = next;
            used.add(next);
            changed = true;
        }
        return changed;
    }

    _save() {
        if (shouldWriteFile()) {
            fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokens, null, 2), 'utf8');
        }
        mirrorStoreSnapshot('subscription_tokens', this.exportState());
    }

    _encryptionKey() {
        return crypto.createHash('sha256').update(config.jwt.secret).digest();
    }

    _encryptSecret(secret) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(TOKEN_ENC_ALGO, this._encryptionKey(), iv);
        const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${TOKEN_ENC_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    _decryptSecret(payload) {
        if (typeof payload !== 'string' || !payload.startsWith(`${TOKEN_ENC_PREFIX}:`)) return '';
        try {
            const parts = payload.split(':');
            if (parts.length < 5) return '';
            const ivHex = parts[2];
            const tagHex = parts[3];
            const dataHex = parts.slice(4).join(':');
            const decipher = crypto.createDecipheriv(
                TOKEN_ENC_ALGO,
                this._encryptionKey(),
                Buffer.from(ivHex, 'hex')
            );
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            const output = Buffer.concat([
                decipher.update(Buffer.from(dataHex, 'hex')),
                decipher.final(),
            ]);
            return output.toString('utf8');
        } catch {
            return '';
        }
    }

    _isRevoked(record) {
        return Boolean(record?.revokedAt);
    }

    _isExpired(record) {
        if (!record?.expiresAt) return false;
        return new Date(record.expiresAt).getTime() <= Date.now();
    }

    _sanitize(record) {
        const expired = this._isExpired(record);
        const revoked = this._isRevoked(record);
        let status = 'active';
        if (revoked) status = 'revoked';
        else if (expired) status = 'expired';

        return {
            id: record.id,
            publicTokenId: this._resolvePublicId(record),
            email: record.email,
            name: record.name || '',
            createdAt: record.createdAt,
            createdBy: record.createdBy || '',
            expiresAt: record.expiresAt || null,
            lastUsedAt: record.lastUsedAt || null,
            revokedAt: record.revokedAt || null,
            revokedReason: record.revokedReason || null,
            status,
        };
    }

    listByEmail(email, options = {}) {
        const normalizedEmail = normalizeEmail(email);
        const includeRevoked = options.includeRevoked !== false;
        const includeExpired = options.includeExpired !== false;

        return this.tokens
            .filter((record) => record.email === normalizedEmail)
            .filter((record) => includeRevoked || !this._isRevoked(record))
            .filter((record) => includeExpired || !this._isExpired(record))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((record) => this._sanitize(record));
    }

    countActiveByEmail(email) {
        const normalizedEmail = normalizeEmail(email);
        return this.tokens.filter((record) => {
            if (record.email !== normalizedEmail) return false;
            if (this._isRevoked(record)) return false;
            if (this._isExpired(record)) return false;
            return true;
        }).length;
    }

    issue(email, options = {}) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
            throw new Error('Email is required');
        }

        const requestedTtl = Number(options.ttlDays);
        const noExpiry = options.noExpiry === true
            || (Number.isFinite(requestedTtl) && requestedTtl <= 0);
        const ttlDays = noExpiry
            ? 0
            : (Number.isFinite(requestedTtl) && requestedTtl > 0
                ? Math.min(requestedTtl, config.subscription.maxTtlDays)
                : config.subscription.defaultTtlDays);

        if (options.ignoreActiveLimit !== true) {
            const activeCount = this.countActiveByEmail(normalizedEmail);
            if (activeCount >= config.subscription.maxActiveTokensPerUser) {
                throw new Error(`Active token limit reached (${config.subscription.maxActiveTokensPerUser})`);
            }
        }

        const secret = crypto.randomBytes(32).toString('hex');
        const now = new Date();
        const expiresAt = noExpiry
            ? null
            : new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

        const record = {
            id: crypto.randomUUID(),
            publicId: generatePublicTokenId(),
            email: normalizedEmail,
            name: String(options.name || '').trim(),
            tokenSecretHash: hashTokenSecret(secret),
            tokenSecretEnc: this._encryptSecret(secret),
            createdAt: now.toISOString(),
            createdBy: String(options.createdBy || ''),
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            lastUsedAt: null,
            revokedAt: null,
            revokedReason: null,
        };

        this.tokens.unshift(record);
        this._save();

        return {
            tokenId: record.id,
            publicTokenId: this._resolvePublicId(record),
            tokenSecret: secret,
            token: `${this._resolvePublicId(record)}.${secret}`,
            ttlDays,
            metadata: this._sanitize(record),
        };
    }

    verify(email, tokenId, tokenSecret) {
        const normalizedEmail = normalizeEmail(email);
        const lookupTokenId = String(tokenId || '').trim();
        const record = this.tokens.find(
            (item) => (
                item.email === normalizedEmail
                && (item.id === lookupTokenId || this._resolvePublicId(item) === lookupTokenId)
            )
        );

        if (!record) return { ok: false, reason: 'not-found', record: null };
        if (this._isRevoked(record)) return { ok: false, reason: 'revoked', record };
        if (this._isExpired(record)) return { ok: false, reason: 'expired', record };

        const expectedHash = record.tokenSecretHash;
        const actualHash = hashTokenSecret(tokenSecret);
        if (
            typeof expectedHash !== 'string'
            || expectedHash.length !== actualHash.length
            || !crypto.timingSafeEqual(Buffer.from(expectedHash, 'utf8'), Buffer.from(actualHash, 'utf8'))
        ) {
            return { ok: false, reason: 'invalid-secret', record };
        }

        return { ok: true, reason: 'ok', record };
    }

    touchLastUsed(email, tokenId) {
        const normalizedEmail = normalizeEmail(email);
        const lookupTokenId = String(tokenId || '').trim();
        const record = this.tokens.find(
            (item) => (
                item.email === normalizedEmail
                && (item.id === lookupTokenId || this._resolvePublicId(item) === lookupTokenId)
            )
        );
        if (!record) return false;
        record.lastUsedAt = new Date().toISOString();
        this._save();
        return true;
    }

    revoke(email, tokenId, reason = 'manual-revoke') {
        const normalizedEmail = normalizeEmail(email);
        const record = this.tokens.find(
            (item) => item.email === normalizedEmail && item.id === String(tokenId || '').trim()
        );
        if (!record) return null;
        if (record.revokedAt) return this._sanitize(record);

        record.revokedAt = new Date().toISOString();
        record.revokedReason = String(reason || 'manual-revoke');
        this._save();
        return this._sanitize(record);
    }

    revokeAllByEmail(email, reason = 'manual-revoke-all') {
        const normalizedEmail = normalizeEmail(email);
        const nowIso = new Date().toISOString();
        let count = 0;
        this.tokens.forEach((record) => {
            if (record.email !== normalizedEmail) return;
            if (record.revokedAt) return;
            record.revokedAt = nowIso;
            record.revokedReason = String(reason || 'manual-revoke-all');
            count += 1;
        });
        if (count > 0) this._save();
        return count;
    }

    getByEmailAndId(email, tokenId) {
        const normalizedEmail = normalizeEmail(email);
        const record = this.tokens.find(
            (item) => item.email === normalizedEmail && item.id === String(tokenId || '').trim()
        );
        if (!record) return null;
        return this._sanitize(record);
    }

    getTokenById(email, tokenId) {
        const normalizedEmail = normalizeEmail(email);
        return this.tokens.find(
            (item) => item.email === normalizedEmail && item.id === String(tokenId || '').trim()
        ) || null;
    }

    getTokenByPublicId(tokenId) {
        const lookupTokenId = String(tokenId || '').trim();
        if (!lookupTokenId) return null;
        return this.tokens.find(
            (item) => item.id === lookupTokenId || this._resolvePublicId(item) === lookupTokenId
        ) || null;
    }

    verifyByTokenId(tokenId, tokenSecret) {
        const record = this.getTokenByPublicId(tokenId);
        if (!record) return { ok: false, reason: 'not-found', record: null, email: '' };
        if (this._isRevoked(record)) return { ok: false, reason: 'revoked', record, email: record.email };
        if (this._isExpired(record)) return { ok: false, reason: 'expired', record, email: record.email };

        const expectedHash = record.tokenSecretHash;
        const actualHash = hashTokenSecret(tokenSecret);
        if (
            typeof expectedHash !== 'string'
            || expectedHash.length !== actualHash.length
            || !crypto.timingSafeEqual(Buffer.from(expectedHash, 'utf8'), Buffer.from(actualHash, 'utf8'))
        ) {
            return { ok: false, reason: 'invalid-secret', record, email: record.email };
        }

        return { ok: true, reason: 'ok', record, email: record.email };
    }

    touchLastUsedByTokenId(tokenId) {
        const record = this.getTokenByPublicId(tokenId);
        if (!record) return false;
        record.lastUsedAt = new Date().toISOString();
        this._save();
        return true;
    }

    getRawTokenById(email, tokenId) {
        const record = this.getTokenById(email, tokenId);
        if (!record) return null;
        const secret = this._decryptSecret(record.tokenSecretEnc);
        if (!secret) return null;
        return `${this._resolvePublicId(record)}.${secret}`;
    }

    getFirstActiveToken(email) {
        const normalizedEmail = normalizeEmail(email);
        const record = this.tokens.find((item) => (
            item.email === normalizedEmail
            && !this._isRevoked(item)
            && !this._isExpired(item)
        ));
        if (!record) return null;
        const secret = this._decryptSecret(record.tokenSecretEnc);
        if (!secret) return null;
        return {
            metadata: this._sanitize(record),
            token: `${this._resolvePublicId(record)}.${secret}`,
        };
    }

    getFirstActiveTokenByName(email, name = '') {
        const normalizedEmail = normalizeEmail(email);
        const targetName = String(name || '').trim();
        const record = this.tokens.find((item) => (
            item.email === normalizedEmail
            && String(item.name || '').trim() === targetName
            && !this._isRevoked(item)
            && !this._isExpired(item)
        ));
        if (!record) return null;
        const secret = this._decryptSecret(record.tokenSecretEnc);
        if (!secret) return null;
        return {
            metadata: this._sanitize(record),
            token: `${this._resolvePublicId(record)}.${secret}`,
        };
    }

    migrateLegacySigToken(email, signature, options = {}) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !signature) return null;
        const existing = this.tokens.find((item) => (
            item.email === normalizedEmail
            && item.name === 'legacy-signature'
            && !this._isRevoked(item)
            && !this._isExpired(item)
        ));
        if (existing) {
            return {
                tokenId: existing.id,
                publicTokenId: this._resolvePublicId(existing),
                tokenSecret: signature,
                token: `${this._resolvePublicId(existing)}.${signature}`,
                metadata: this._sanitize(existing),
            };
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000);
        const record = {
            id: crypto.randomUUID(),
            publicId: generatePublicTokenId(),
            email: normalizedEmail,
            name: 'legacy-signature',
            tokenSecretHash: hashTokenSecret(signature),
            tokenSecretEnc: this._encryptSecret(signature),
            createdAt: now.toISOString(),
            createdBy: String(options.createdBy || 'system'),
            expiresAt: expiresAt.toISOString(),
            lastUsedAt: null,
            revokedAt: null,
            revokedReason: null,
        };
        this.tokens.unshift(record);
        this._save();
        return {
            tokenId: record.id,
            publicTokenId: this._resolvePublicId(record),
            tokenSecret: signature,
            token: `${this._resolvePublicId(record)}.${signature}`,
            metadata: this._sanitize(record),
        };
    }

    parseToken(rawToken) {
        const text = String(rawToken || '').trim();
        const dotIndex = text.indexOf('.');
        if (!text || dotIndex <= 0 || dotIndex >= text.length - 1) {
            return { tokenId: '', tokenSecret: '' };
        }
        return {
            tokenId: text.slice(0, dotIndex),
            tokenSecret: text.slice(dotIndex + 1),
        };
    }

    normalizeDateInput(value) {
        return toIsoOrNull(value);
    }

    exportState() {
        return {
            tokens: this.tokens,
        };
    }

    importState(snapshot = {}) {
        this.tokens = Array.isArray(snapshot?.tokens) ? snapshot.tokens : [];
    }
}

const subscriptionTokenStore = new SubscriptionTokenStore();
export default subscriptionTokenStore;
