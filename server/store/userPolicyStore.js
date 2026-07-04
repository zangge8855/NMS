import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';

const USER_POLICY_FILE = path.join(config.dataDir, 'user_policies.json');
const ALLOWED_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);
const POLICY_SCOPE_MODES = new Set(['all', 'selected', 'none']);
const TRAFFIC_RESET_CYCLES = new Set(['none', 'hourly', 'daily', 'weekly', 'monthly']);
const IP_LIMIT_POLICIES = new Set(['first-wins', 'last-wins']);

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

function normalizeNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function sanitizePolicy(input = {}) {
    const blockedServerIds = toUniqueStringArray(
        input.blockedServerIds || input.deniedServerIds,
        (item) => String(item || '').trim()
    );
    const blockedServerIdSet = new Set(blockedServerIds);
    const selectedServerIds = toUniqueStringArray(input.allowedServerIds, (item) => String(item || '').trim())
        .filter((item) => !blockedServerIdSet.has(item));
    const selectedProtocols = toUniqueStringArray(input.allowedProtocols, (item) => String(item || '').trim().toLowerCase())
        .filter((item) => ALLOWED_PROTOCOLS.has(item));
    const blockedInboundKeys = toUniqueStringArray(
        input.blockedInboundKeys || input.deniedInboundKeys,
        (item) => String(item || '').trim()
    );
    const blockedInboundKeySet = new Set(blockedInboundKeys);
        const allowedInboundKeys = toUniqueStringArray(input.allowedInboundKeys, (item) => String(item || '').trim())
        .filter((item) => !blockedInboundKeySet.has(item));
    const overrideFields = toUniqueStringArray(input.overrideFields, (item) => String(item || '').trim())
        .filter((item) => [
            'allowedServerIds',
            'blockedServerIds',
            'allowedProtocols',
            'allowedInboundKeys',
            'blockedInboundKeys',
            'serverScopeMode',
            'protocolScopeMode',
            'expiryTime',
            'limitIp',
            'trafficLimitBytes',
            'trafficResetCycle',
            'ipLimitPolicy',
            'speedLimitUp',
            'speedLimitDown',
            'tgId',
            'group',
            'comment',
            'reset',
        ].includes(item));
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
        blockedServerIds,
        allowedProtocols: protocolScopeMode === 'selected' ? selectedProtocols : [],
        allowedInboundKeys,
        blockedInboundKeys,
        serverScopeMode,
        protocolScopeMode,
        expiryTime: normalizeNonNegativeInt(input.expiryTime, 0),
        limitIp: normalizeNonNegativeInt(input.limitIp, 0),
        trafficLimitBytes: normalizeNonNegativeInt(input.trafficLimitBytes, 0),
        speedLimitUp: normalizeNonNegativeInt(input.speedLimitUp, 0),
        speedLimitDown: normalizeNonNegativeInt(input.speedLimitDown, 0),
        trafficResetCycle: TRAFFIC_RESET_CYCLES.has(String(input.trafficResetCycle || '').trim().toLowerCase())
            ? String(input.trafficResetCycle).trim().toLowerCase()
            : 'none',
        ipLimitPolicy: IP_LIMIT_POLICIES.has(String(input.ipLimitPolicy || '').trim().toLowerCase())
            ? String(input.ipLimitPolicy).trim().toLowerCase()
            : 'first-wins',
        tgId: Number(input.tgId) || 0,
        group: String(input.group || '').trim(),
        comment: String(input.comment || '').trim(),
        reset: Number(input.reset) || 0,
        inheritGroup: input.inheritGroup === true,
        overrideFields,
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
        if (!fs.existsSync(USER_POLICY_FILE)) return {};
        try {
            const parsed = JSON.parse(fs.readFileSync(USER_POLICY_FILE, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Data in user_policies.json is not a valid JSON object');
            }
            return parsed;
        } catch (error) {
            console.error('Failed to load user_policies.json:', error.message);
            throw error;
        }
    }

    _save() {
        saveObjectAtomic(USER_POLICY_FILE, this.policies);
        mirrorStoreSnapshot('user_policies', this.exportState());
    }

    get(email) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
            return {
                email: '',
                allowedServerIds: [],
                blockedServerIds: [],
                allowedProtocols: [],
                allowedInboundKeys: [],
                blockedInboundKeys: [],
                serverScopeMode: 'all',
                protocolScopeMode: 'all',
                expiryTime: 0,
                limitIp: 0,
                trafficLimitBytes: 0,
                speedLimitUp: 0,
                speedLimitDown: 0,
                trafficResetCycle: 'none',
                ipLimitPolicy: 'first-wins',
                tgId: 0,
                group: '',
                comment: '',
                reset: 0,
                inheritGroup: false,
                overrideFields: [],
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

    reassignEmail(sourceEmail, targetEmail, actor = 'admin') {
        const normalizedSource = normalizeEmail(sourceEmail);
        const normalizedTarget = normalizeEmail(targetEmail);
        if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
            return {
                moved: false,
                fromEmail: normalizedSource,
                toEmail: normalizedTarget,
                policy: normalizedTarget ? this.get(normalizedTarget) : null,
            };
        }

        if (!Object.prototype.hasOwnProperty.call(this.policies, normalizedSource)) {
            return {
                moved: false,
                fromEmail: normalizedSource,
                toEmail: normalizedTarget,
                policy: null,
            };
        }
        if (Object.prototype.hasOwnProperty.call(this.policies, normalizedTarget)) {
            throw new Error(`订阅策略 "${normalizedTarget}" 已存在，无法安全迁移`);
        }

        const nowIso = new Date().toISOString();
        const sanitized = sanitizePolicy(this.policies[normalizedSource] || {});
        this.policies[normalizedTarget] = {
            ...sanitized,
            updatedAt: nowIso,
            updatedBy: String(actor || 'admin'),
        };
        delete this.policies[normalizedSource];
        this._save();

        return {
            moved: true,
            fromEmail: normalizedSource,
            toEmail: normalizedTarget,
            policy: {
                email: normalizedTarget,
                ...sanitized,
                updatedAt: nowIso,
                updatedBy: String(actor || 'admin'),
            },
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
            const inAllowed = sanitized.serverScopeMode === 'selected'
                && sanitized.allowedServerIds.includes(targetId);
            const inBlocked = sanitized.blockedServerIds.includes(targetId);
            if (!inAllowed && !inBlocked) continue;

            const nextAllowed = inAllowed
                ? sanitized.allowedServerIds.filter((item) => item !== targetId)
                : sanitized.allowedServerIds;
            const nextBlocked = inBlocked
                ? sanitized.blockedServerIds.filter((item) => item !== targetId)
                : sanitized.blockedServerIds;
            const nextMode = inAllowed
                ? (nextAllowed.length > 0 ? 'selected' : 'none')
                : sanitized.serverScopeMode;
            this.policies[normalizedEmail] = {
                ...sanitized,
                allowedServerIds: nextAllowed,
                blockedServerIds: nextBlocked,
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
