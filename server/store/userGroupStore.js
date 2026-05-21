import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';
import { sanitizeGroupPolicy } from '../lib/userPolicyResolver.js';

const USER_GROUP_FILE = path.join(config.dataDir, 'user_groups.json');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeGroupRecord(input = {}) {
    const policy = sanitizeGroupPolicy(input);
    return {
        id: normalizeText(input.id) || crypto.randomUUID(),
        name: policy.name,
        description: policy.description,
        enabled: policy.enabled,
        allowedServerIds: policy.allowedServerIds,
        blockedServerIds: policy.blockedServerIds,
        allowedProtocols: policy.allowedProtocols,
        allowedInboundKeys: policy.allowedInboundKeys,
        blockedInboundKeys: policy.blockedInboundKeys,
        serverScopeMode: policy.serverScopeMode,
        protocolScopeMode: policy.protocolScopeMode,
        expiryTime: policy.expiryTime,
        limitIp: policy.limitIp,
        trafficLimitBytes: policy.trafficLimitBytes,
        trafficResetCycle: policy.trafficResetCycle,
        ipLimitPolicy: policy.ipLimitPolicy,
        createdAt: input.createdAt || new Date().toISOString(),
        updatedAt: input.updatedAt || input.createdAt || new Date().toISOString(),
        updatedBy: normalizeText(input.updatedBy),
    };
}

class UserGroupStore {
    constructor() {
        this._ensureDataDir();
        this.groups = this._load();
    }

    _ensureDataDir() {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    _load() {
        try {
            if (!fs.existsSync(USER_GROUP_FILE)) return [];
            const parsed = JSON.parse(fs.readFileSync(USER_GROUP_FILE, 'utf8'));
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((item) => normalizeGroupRecord(item))
                .filter((item) => item.id && item.name);
        } catch {
            return [];
        }
    }

    _save() {
        saveObjectAtomic(USER_GROUP_FILE, this.groups);
        mirrorStoreSnapshot('user_groups', this.exportState());
    }

    list() {
        return this.groups.map((item) => ({ ...item }));
    }

    getById(id) {
        const normalizedId = normalizeText(id);
        if (!normalizedId) return null;
        const group = this.groups.find((item) => item.id === normalizedId);
        return group ? { ...group } : null;
    }

    getByName(name) {
        const normalizedName = normalizeText(name).toLowerCase();
        if (!normalizedName) return null;
        const group = this.groups.find((item) => normalizeText(item.name).toLowerCase() === normalizedName);
        return group ? { ...group } : null;
    }

    add(payload = {}, actor = 'admin') {
        const record = normalizeGroupRecord({
            ...payload,
            updatedBy: actor,
        });
        if (!record.name) throw new Error('分组名称不能为空');
        const existing = this.getByName(record.name);
        if (existing) throw new Error(`用户分组 "${record.name}" 已存在`);
        this.groups.push(record);
        this._save();
        return { ...record };
    }

    update(id, payload = {}, actor = 'admin') {
        const normalizedId = normalizeText(id);
        const idx = this.groups.findIndex((item) => item.id === normalizedId);
        if (idx === -1) return null;
        const next = normalizeGroupRecord({
            ...this.groups[idx],
            ...payload,
            id: normalizedId,
            createdAt: this.groups[idx].createdAt,
            updatedAt: new Date().toISOString(),
            updatedBy: actor,
        });
        if (!next.name) throw new Error('分组名称不能为空');
        const existing = this.getByName(next.name);
        if (existing && existing.id !== normalizedId) throw new Error(`用户分组 "${next.name}" 已存在`);
        this.groups[idx] = next;
        this._save();
        return { ...next };
    }

    remove(id) {
        const normalizedId = normalizeText(id);
        const idx = this.groups.findIndex((item) => item.id === normalizedId);
        if (idx === -1) return false;
        this.groups.splice(idx, 1);
        this._save();
        return true;
    }

    removeServerId(serverId, actor = 'system') {
        const targetId = normalizeText(serverId);
        if (!targetId) return 0;
        let changed = 0;
        const nowIso = new Date().toISOString();
        this.groups = this.groups.map((group) => {
            const allowed = group.allowedServerIds.filter((item) => item !== targetId);
            const blocked = group.blockedServerIds.filter((item) => item !== targetId);
            if (allowed.length === group.allowedServerIds.length && blocked.length === group.blockedServerIds.length) {
                return group;
            }
            changed += 1;
            return normalizeGroupRecord({
                ...group,
                allowedServerIds: allowed,
                blockedServerIds: blocked,
                serverScopeMode: group.serverScopeMode === 'selected' && allowed.length === 0 ? 'none' : group.serverScopeMode,
                updatedAt: nowIso,
                updatedBy: actor,
            });
        });
        if (changed > 0) this._save();
        return changed;
    }

    exportState() {
        return {
            groups: this.groups,
        };
    }

    importState(snapshot = {}) {
        this.groups = (Array.isArray(snapshot?.groups) ? snapshot.groups : [])
            .map((item) => normalizeGroupRecord(item))
            .filter((item) => item.id && item.name);
    }
}

const userGroupStore = new UserGroupStore();

export default userGroupStore;
