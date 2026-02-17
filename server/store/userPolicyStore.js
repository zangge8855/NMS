import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { mirrorStoreSnapshot, shouldWriteFile } from './dbMirror.js';

const USER_POLICY_FILE = path.join(config.dataDir, 'user_policies.json');
const ALLOWED_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const POLICY_SCOPE_MODES = new Set(['all', 'selected', 'none']);

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function toUniqueStringArray(input = [], mapper = (x) => String(x || '').trim()) {
    const result = [];
    const seen = new Set();
    (Array.isArray(input) ? input : []).forEach((item) => {
        const text = mapper(item);
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
    });
    return result;
}

function normalizeScopeMode(value, fallback = 'all') {
    const normalizedFallback = POLICY_SCOPE_MODES.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback || '').trim().toLowerCase()
        : 'all';
    const text = String(value || '').trim().toLowerCase();
    if (!text) return normalizedFallback;
    if (!POLICY_SCOPE_MODES.has(text)) return normalizedFallback;
    return text;
}

function sanitizePolicy(input = {}) {
    const selectedServerIds = toUniqueStringArray(input.allowedServerIds, (item) => String(item || '').trim());
    const selectedProtocols = toUniqueStringArray(input.allowedProtocols, (item) => String(item || '').trim().toLowerCase())
        .filter((item) => ALLOWED_PROTOCOLS.has(item));
    const inferredServerMode = selectedServerIds.length > 0 ? 'selected' : 'all';
    const inferredProtocolMode = selectedProtocols.length > 0 ? 'selected' : 'all';
    let serverScopeMode = normalizeScopeMode(input.serverScopeMode, inferredServerMode);
    let protocolScopeMode = normalizeScopeMode(input.protocolScopeMode, inferredProtocolMode);

    if (serverScopeMode === 'selected' && selectedServerIds.length === 0) {
        serverScopeMode = 'none';
    }
    if (protocolScopeMode === 'selected' && selectedProtocols.length === 0) {
        protocolScopeMode = 'none';
    }

    return {
        allowedServerIds: serverScopeMode === 'selected' ? selectedServerIds : [],
        allowedProtocols: protocolScopeMode === 'selected' ? selectedProtocols : [],
        serverScopeMode,
        protocolScopeMode,
    };
}

class UserPolicyStore {
    constructor() {
        this._ensureDataDir();
        this.policies = this._load();
    }

    _ensureDataDir() {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    _load() {
        try {
            if (!fs.existsSync(USER_POLICY_FILE)) return {};
            const parsed = JSON.parse(fs.readFileSync(USER_POLICY_FILE, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : {};
        } catch {
            return {};
        }
    }

    _save() {
        if (shouldWriteFile()) {
            fs.writeFileSync(USER_POLICY_FILE, JSON.stringify(this.policies, null, 2), 'utf8');
        }
        mirrorStoreSnapshot('user_policies', this.exportState());
    }

    get(email) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
            return {
                email: '',
                allowedServerIds: [],
                allowedProtocols: [],
                serverScopeMode: 'all',
                protocolScopeMode: 'all',
                updatedAt: null,
                updatedBy: '',
            };
        }

        const record = this.policies[normalizedEmail] || {};
        const policy = sanitizePolicy(record);
        return {
            email: normalizedEmail,
            ...policy,
            updatedAt: record.updatedAt || null,
            updatedBy: record.updatedBy || '',
        };
    }

    upsert(email, policyInput = {}, actor = 'admin') {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
            throw new Error('Email is required');
        }

        const policy = sanitizePolicy(policyInput);
        const nowIso = new Date().toISOString();

        this.policies[normalizedEmail] = {
            ...policy,
            updatedAt: nowIso,
            updatedBy: String(actor || 'admin'),
        };
        this._save();

        return {
            email: normalizedEmail,
            ...policy,
            updatedAt: nowIso,
            updatedBy: String(actor || 'admin'),
        };
    }

    remove(email) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) return false;
        if (!Object.prototype.hasOwnProperty.call(this.policies, normalizedEmail)) return false;
        delete this.policies[normalizedEmail];
        this._save();
        return true;
    }

    removeServerId(serverId, actor = 'system') {
        const targetId = String(serverId || '').trim();
        if (!targetId) return 0;

        let changed = 0;
        const nowIso = new Date().toISOString();
        for (const [email, rawRecord] of Object.entries(this.policies)) {
            const normalizedEmail = normalizeEmail(email);
            if (!normalizedEmail) continue;

            const sanitized = sanitizePolicy(rawRecord || {});
            if (sanitized.serverScopeMode !== 'selected') continue;
            if (!sanitized.allowedServerIds.includes(targetId)) continue;

            const nextServerIds = sanitized.allowedServerIds.filter((item) => item !== targetId);
            const nextMode = nextServerIds.length > 0 ? 'selected' : 'none';
            this.policies[normalizedEmail] = {
                ...sanitized,
                allowedServerIds: nextServerIds,
                serverScopeMode: nextMode,
                updatedAt: nowIso,
                updatedBy: String(actor || 'system'),
            };
            changed += 1;
        }

        if (changed > 0) {
            this._save();
        }
        return changed;
    }

    exportState() {
        return {
            policies: this.policies,
        };
    }

    importState(snapshot = {}) {
        this.policies = snapshot?.policies && typeof snapshot.policies === 'object' && !Array.isArray(snapshot.policies)
            ? snapshot.policies
            : {};
    }
}

const userPolicyStore = new UserPolicyStore();

export { ALLOWED_PROTOCOLS, POLICY_SCOPE_MODES };
export default userPolicyStore;
