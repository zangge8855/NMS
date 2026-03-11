import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const OVERRIDE_FILE = path.join(config.dataDir, 'client_entitlement_overrides.json');

function ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function buildKey(serverId, inboundId, clientIdentifier) {
    return [
        normalizeText(serverId),
        normalizeText(inboundId),
        normalizeText(clientIdentifier),
    ].join('::');
}

function sanitizeRecord(input = {}, actor = 'admin') {
    const serverId = normalizeText(input.serverId);
    const inboundId = normalizeText(input.inboundId);
    const clientIdentifier = normalizeText(input.clientIdentifier);
    if (!serverId || !inboundId || !clientIdentifier) {
        throw new Error('serverId, inboundId and clientIdentifier are required');
    }

    return {
        key: buildKey(serverId, inboundId, clientIdentifier),
        serverId,
        inboundId,
        clientIdentifier,
        email: normalizeEmail(input.email),
        expiryTime: normalizeNonNegativeInt(input.expiryTime, 0),
        limitIp: normalizeNonNegativeInt(input.limitIp, 0),
        trafficLimitBytes: normalizeNonNegativeInt(input.trafficLimitBytes, 0),
        updatedAt: new Date().toISOString(),
        updatedBy: normalizeText(actor) || 'admin',
    };
}

class ClientEntitlementOverrideStore {
    constructor() {
        ensureDataDir();
        this.records = this._load();
    }

    _load() {
        try {
            if (!fs.existsSync(OVERRIDE_FILE)) return {};
            const parsed = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : {};
        } catch {
            return {};
        }
    }

    _save() {
        saveObjectAtomic(OVERRIDE_FILE, this.records);
        mirrorStoreSnapshot('client_entitlement_overrides', this.exportState());
    }

    get(serverId, inboundId, clientIdentifier) {
        const key = buildKey(serverId, inboundId, clientIdentifier);
        const record = this.records[key];
        return record ? { ...record } : null;
    }

    upsert(input = {}, actor = 'admin') {
        const record = sanitizeRecord(input, actor);
        this.records[record.key] = record;
        this._save();
        return { ...record };
    }

    remove(serverId, inboundId, clientIdentifier) {
        const key = buildKey(serverId, inboundId, clientIdentifier);
        if (!Object.prototype.hasOwnProperty.call(this.records, key)) return false;
        delete this.records[key];
        this._save();
        return true;
    }

    exportState() {
        return {
            records: this.records,
        };
    }

    importState(snapshot = {}) {
        this.records = snapshot?.records && typeof snapshot.records === 'object' && !Array.isArray(snapshot.records)
            ? snapshot.records
            : {};
    }
}

const clientEntitlementOverrideStore = new ClientEntitlementOverrideStore();

export { buildKey as buildClientEntitlementOverrideKey };
export default clientEntitlementOverrideStore;
