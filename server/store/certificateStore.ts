import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { saveObjectAtomic } from './fileUtils.js';

export interface CertificateRecord {
    id: string;
    domain: string;
    sans?: string[];
    provider: 'letsencrypt' | 'zerossl' | 'custom' | string;
    challengeType: 'dns-cloudflare' | 'http' | 'manual' | string;
    cfApiToken?: string;
    email?: string;
    status: 'valid' | 'expiring_soon' | 'expired' | 'pending' | 'error';
    issuedAt?: string | null;
    expiresAt?: string | null;
    certificate?: string;
    privateKey?: string;
    autoRenew: boolean;
    assignedServerIds?: string[];
    lastError?: string | null;
    createdAt: string;
    updatedAt: string;
}

const CERTS_FILE = path.join(config.dataDir, 'certificates.json');

class CertificateStore {
    private items: CertificateRecord[] = [];

    constructor() {
        this._ensureDataDir();
        this.items = this._load();
    }

    private _ensureDataDir(): void {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    private _load(): CertificateRecord[] {
        try {
            if (fs.existsSync(CERTS_FILE)) {
                const raw = fs.readFileSync(CERTS_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch {
            return [];
        }
        return [];
    }

    private _save(): void {
        saveObjectAtomic(CERTS_FILE, this.items);
    }

    getAll(): CertificateRecord[] {
        return [...this.items];
    }

    getById(id: string): CertificateRecord | null {
        return this.items.find((item) => item.id === id) || null;
    }

    getByDomain(domain: string): CertificateRecord | null {
        const normalized = String(domain || '').trim().toLowerCase();
        return this.items.find((item) => item.domain.toLowerCase() === normalized) || null;
    }

    create(payload: Partial<CertificateRecord>): CertificateRecord {
        const now = new Date().toISOString();
        const record: CertificateRecord = {
            id: crypto.randomUUID(),
            domain: String(payload.domain || '').trim(),
            sans: Array.isArray(payload.sans) ? payload.sans : [],
            provider: payload.provider || 'letsencrypt',
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
            createdAt: now,
            updatedAt: now,
        };

        this.items.push(record);
        this._save();
        return record;
    }

    update(id: string, updates: Partial<CertificateRecord>): CertificateRecord | null {
        const idx = this.items.findIndex((item) => item.id === id);
        if (idx < 0) return null;

        const updated: CertificateRecord = {
            ...this.items[idx],
            ...updates,
            updatedAt: new Date().toISOString(),
        };

        this.items[idx] = updated;
        this._save();
        return updated;
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
}

const certificateStore = new CertificateStore();
export default certificateStore;
