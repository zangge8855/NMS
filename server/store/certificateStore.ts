import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';
import { KNOWN_PUBLIC_SECRETS } from '../lib/runtimeEnv.js';

const CERT_SECRET_ENC_ALGO = 'aes-256-gcm';
const CERT_SECRET_ENC_PREFIX = 'nms-cert:v1';

export interface CertificateRecord {
    id: string;
    domain: string;
    sans?: string[];
    provider: 'letsencrypt' | 'letsencrypt-staging' | 'zerossl' | 'selfsigned' | 'custom' | string;
    acmeDirectoryUrl?: string;
    challengeType: 'dns-cloudflare' | 'http' | 'manual' | string;
    cfApiToken?: string;
    cfApiTokenEnc?: string;
    email?: string;
    status: 'valid' | 'expiring_soon' | 'expired' | 'pending' | 'error';
    issuedAt?: string | null;
    expiresAt?: string | null;
    certificate?: string;
    privateKey?: string;
    privateKeyEnc?: string;
    autoRenew: boolean;
    assignedServerIds?: string[];
    lastError?: string | null;
    lastDispatchAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export function resolveCertificateStatus(record: Partial<CertificateRecord> | null | undefined, nowMs: number = Date.now()): CertificateRecord['status'] {
    if (!record) return 'pending';
    if (record.status === 'error') return 'error';
    if (!record.certificate) {
        return record.status || 'pending';
    }
    const expiresMs = record.expiresAt ? new Date(record.expiresAt).getTime() : NaN;
    if (Number.isFinite(expiresMs)) {
        const remainingMs = expiresMs - nowMs;
        if (remainingMs <= 0) return 'expired';
        if (remainingMs <= 14 * 24 * 60 * 60 * 1000) return 'expiring_soon';
        return 'valid';
    }
    return record.status || 'valid';
}

const CERTS_FILE = path.join(config.dataDir, 'certificates.json');

class CertificateStore {
    private items: CertificateRecord[] = [];

    constructor() {
        this._ensureDataDir();
        this.items = this._load().map((item) => this._normalizeStoredRecord(item));
    }

    private _credentialSecrets(): string[] {
        const primary = String(config.credentials?.secret || '').trim();
        const legacy = Array.isArray(config.credentials?.legacySecrets)
            ? config.credentials.legacySecrets
            : [];
        const jwtSecret = String(config.jwt?.secret || '').trim();
        const derivedCredentials = jwtSecret ? `${jwtSecret}-credentials` : '';
        const publicDerived = KNOWN_PUBLIC_SECRETS
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .map((item) => `${item}-credentials`);
        return Array.from(new Set([
            primary,
            ...legacy,
            jwtSecret,
            derivedCredentials,
            ...KNOWN_PUBLIC_SECRETS,
            ...publicDerived,
        ].map((item) => String(item || '').trim()).filter(Boolean)));
    }

    private _credentialKeyFromSecret(secret: unknown): Buffer {
        return crypto.createHash('sha256').update(String(secret || '')).digest();
    }

    private _credentialKey(): Buffer {
        const [primary] = this._credentialSecrets();
        return this._credentialKeyFromSecret(primary || config.jwt?.secret || '');
    }

    private _credentialKeys(): Buffer[] {
        const secrets = this._credentialSecrets();
        if (secrets.length === 0) {
            return [this._credentialKeyFromSecret(config.jwt?.secret || '')];
        }
        return secrets.map((secret) => this._credentialKeyFromSecret(secret));
    }

    private _isEncryptedSecret(value: unknown): boolean {
        return typeof value === 'string' && value.startsWith(`${CERT_SECRET_ENC_PREFIX}:`);
    }

    private _encryptSecret(value: unknown): string {
        const text = String(value || '').trim();
        if (!text) return '';
        if (this._isEncryptedSecret(text)) return text;

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(CERT_SECRET_ENC_ALGO, this._credentialKey(), iv);
        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${CERT_SECRET_ENC_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    private _encryptSecretForce(value: string): string {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(CERT_SECRET_ENC_ALGO, this._credentialKey(), iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${CERT_SECRET_ENC_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    private _decryptSecret(payload: unknown): { value: string; status: 'missing' | 'plaintext' | 'unreadable' | 'ok' } {
        const text = String(payload || '').trim();
        if (!text) {
            return { value: '', status: 'missing' };
        }
        if (!this._isEncryptedSecret(text)) {
            return { value: text, status: 'plaintext' };
        }

        const parts = text.split(':');
        if (parts.length < 5 || `${parts[0]}:${parts[1]}` !== CERT_SECRET_ENC_PREFIX) {
            return { value: '', status: 'unreadable' };
        }

        const ivHex = parts[2];
        const tagHex = parts[3];
        const encryptedHex = parts.slice(4).join(':');
        for (const key of this._credentialKeys()) {
            try {
                const decipher = crypto.createDecipheriv(
                    CERT_SECRET_ENC_ALGO,
                    key,
                    Buffer.from(ivHex, 'hex')
                );
                decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
                const decrypted = Buffer.concat([
                    decipher.update(Buffer.from(encryptedHex, 'hex')),
                    decipher.final(),
                ]);
                return { value: decrypted.toString('utf8'), status: 'ok' };
            } catch {
                // Try next key.
            }
        }
        return { value: '', status: 'unreadable' };
    }

    private _normalizeStoredRecord(record: any): CertificateRecord {
        const next: any = { ...record };
        const rawToken = record?.cfApiToken !== undefined ? String(record.cfApiToken || '').trim() : '';
        const rawTokenEnc = String(record?.cfApiTokenEnc || '').trim();
        if (rawToken) {
            next.cfApiTokenEnc = this._encryptSecret(rawToken);
        } else if (rawTokenEnc) {
            next.cfApiTokenEnc = this._isEncryptedSecret(rawTokenEnc) ? rawTokenEnc : this._encryptSecret(rawTokenEnc);
        } else {
            next.cfApiTokenEnc = '';
        }
        delete next.cfApiToken;

        const rawKey = record?.privateKey !== undefined ? String(record.privateKey || '').trim() : '';
        const rawKeyEnc = String(record?.privateKeyEnc || '').trim();
        if (rawKey) {
            next.privateKeyEnc = this._encryptSecret(rawKey);
        } else if (rawKeyEnc) {
            next.privateKeyEnc = this._isEncryptedSecret(rawKeyEnc) ? rawKeyEnc : this._encryptSecret(rawKeyEnc);
        } else {
            next.privateKeyEnc = '';
        }
        delete next.privateKey;
        return next;
    }

    private _hydrateRecord(record: CertificateRecord): CertificateRecord {
        const hydrated: any = {
            ...record,
            sans: Array.isArray(record.sans) ? [...record.sans] : [],
            assignedServerIds: Array.isArray(record.assignedServerIds) ? [...record.assignedServerIds] : [],
            cfApiToken: this._decryptSecret(record.cfApiTokenEnc ?? record.cfApiToken ?? '').value,
            privateKey: this._decryptSecret(record.privateKeyEnc ?? record.privateKey ?? '').value,
        };
        delete hydrated.cfApiTokenEnc;
        delete hydrated.privateKeyEnc;
        return hydrated;
    }

    private _ensureDataDir(): void {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    private _load(): CertificateRecord[] {
        if (!fs.existsSync(CERTS_FILE)) {
            return [];
        }
        try {
            const raw = fs.readFileSync(CERTS_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                throw new Error('Data in certificates.json is not a JSON array');
            }
            return parsed;
        } catch (err: any) {
            console.error('CRITICAL: Failed to load certificates.json:', err?.message || err);
            throw err;
        }
    }

    private _save(): void {
        saveObjectAtomic(CERTS_FILE, this.items);
        mirrorStoreSnapshot('certificates', this.exportState());
    }

    getAll(): CertificateRecord[] {
        return this.items.map((item) => this._hydrateRecord(item));
    }

    getById(id: string): CertificateRecord | null {
        const found = this.items.find((item) => item.id === id);
        return found ? this._hydrateRecord(found) : null;
    }

    getByDomain(domain: string): CertificateRecord | null {
        const normalized = String(domain || '').trim().toLowerCase();
        const found = this.items.find((item) => item.domain.toLowerCase() === normalized);
        return found ? this._hydrateRecord(found) : null;
    }

    create(payload: Partial<CertificateRecord>): CertificateRecord {
        const now = new Date().toISOString();
        const record = this._normalizeStoredRecord({
            id: crypto.randomUUID(),
            domain: String(payload.domain || '').trim(),
            sans: Array.isArray(payload.sans) ? payload.sans : [],
            provider: payload.provider || 'letsencrypt',
            acmeDirectoryUrl: payload.acmeDirectoryUrl ? String(payload.acmeDirectoryUrl).trim() : '',
            challengeType: payload.challengeType || 'dns-cloudflare',
            cfApiToken: payload.cfApiToken || '',
            email: payload.email || '',
            status: payload.status || 'pending',
            issuedAt: payload.issuedAt || null,
            expiresAt: payload.expiresAt || null,
            certificate: payload.certificate || '',
            privateKey: payload.privateKey || '',
            autoRenew: payload.autoRenew !== false,
            assignedServerIds: Array.isArray(payload.assignedServerIds) ? payload.assignedServerIds : [],
            lastError: null,
            lastDispatchAt: null,
            createdAt: now,
            updatedAt: now,
        });

        this.items.push(record);
        this._save();
        return this._hydrateRecord(record);
    }

    update(id: string, updates: Partial<CertificateRecord>): CertificateRecord | null {
        const idx = this.items.findIndex((item) => item.id === id);
        if (idx < 0) return null;

        const existing = this.items[idx];
        const nextCandidate: any = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        if (updates.cfApiToken !== undefined) {
            nextCandidate.cfApiToken = String(updates.cfApiToken || '').trim();
            delete nextCandidate.cfApiTokenEnc;
        }
        if (updates.privateKey !== undefined) {
            nextCandidate.privateKey = String(updates.privateKey || '').trim();
            delete nextCandidate.privateKeyEnc;
        }
        const updated = this._normalizeStoredRecord(nextCandidate);

        this.items[idx] = updated;
        this._save();
        return this._hydrateRecord(updated);
    }

    delete(id: string): boolean {
        const prevLen = this.items.length;
        this.items = this.items.filter((item) => item.id !== id);
        if (this.items.length !== prevLen) {
            this._save();
            return true;
        }
        return false;
    }

    rotateCredentials(options: any = {}): {
        dryRun: boolean;
        totalCertificates: number;
        scannedFields: number;
        rotatedFields: number;
        migratedPlaintext: number;
        failedFields: number;
    } {
        const dryRun = options?.dryRun === true;
        let scannedFields = 0;
        let rotatedFields = 0;
        let migratedPlaintext = 0;
        let failedFields = 0;

        const nextItems = this.items.map((record) => {
            const updated: any = { ...record };

            const rotateSecretField = (plainKey: 'privateKey' | 'cfApiToken', encKey: 'privateKeyEnc' | 'cfApiTokenEnc') => {
                const legacyPlain = String(updated[plainKey] || '').trim();
                const storedEnc = String(updated[encKey] || '').trim();
                const rawValue = storedEnc || legacyPlain;
                if (!rawValue) {
                    delete updated[plainKey];
                    updated[encKey] = '';
                    return;
                }
                scannedFields += 1;

                if (!this._isEncryptedSecret(rawValue)) {
                    migratedPlaintext += 1;
                    rotatedFields += 1;
                    updated[encKey] = this._encryptSecretForce(rawValue);
                    delete updated[plainKey];
                    return;
                }

                const decrypted = this._decryptSecret(rawValue);
                if (decrypted.status === 'unreadable' || !decrypted.value) {
                    failedFields += 1;
                    return;
                }
                const reEncrypted = this._encryptSecretForce(decrypted.value);
                if (reEncrypted !== rawValue) {
                    updated[encKey] = reEncrypted;
                    rotatedFields += 1;
                }
                delete updated[plainKey];
            };

            rotateSecretField('privateKey', 'privateKeyEnc');
            rotateSecretField('cfApiToken', 'cfApiTokenEnc');
            return updated;
        });

        if (!dryRun && rotatedFields > 0) {
            this.items = nextItems;
            this._save();
        }

        return {
            dryRun,
            totalCertificates: this.items.length,
            scannedFields,
            rotatedFields,
            migratedPlaintext,
            failedFields,
        };
    }

    exportState(): { items: CertificateRecord[] } {
        return {
            items: this.items.map((item) => ({
                ...item,
                sans: Array.isArray(item.sans) ? [...item.sans] : [],
                assignedServerIds: Array.isArray(item.assignedServerIds) ? [...item.assignedServerIds] : [],
            })),
        };
    }

    importState(snapshot: any = {}): void {
        const list = Array.isArray(snapshot) ? snapshot : snapshot?.items;
        if (!Array.isArray(list)) {
            throw new Error('Invalid snapshot format for CertificateStore: items array is missing');
        }
        this.items = list
            .filter((item: any) => item && typeof item === 'object' && item.id && item.domain)
            .map((item: any) => this._normalizeStoredRecord(item));
    }
}

const certificateStore = new CertificateStore();
export default certificateStore;
