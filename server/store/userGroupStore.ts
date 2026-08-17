import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { mirrorStoreSnapshot } from './dbMirror.js';
import { saveObjectAtomic } from './fileUtils.js';
import { sanitizeGroupPolicy } from '../lib/userPolicyResolver.js';

const USER_GROUP_FILE = path.join(config.dataDir, 'user_groups.json');

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeGroupRecord(input: any = {}): any {
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
        speedLimitUp: policy.speedLimitUp,
        speedLimitDown: policy.speedLimitDown,
        trafficResetCycle: policy.trafficResetCycle,
        ipLimitPolicy: policy.ipLimitPolicy,
        createdAt: input.createdAt || new Date().toISOString(),
        updatedAt: input.updatedAt || input.createdAt || new Date().toISOString(),
        updatedBy: normalizeText(input.updatedBy),
    };
}

class UserGroupStore {
    groups: any[];

    constructor() {
        this._ensureDataDir();
        this.groups = this._load();
    }

    _ensureDataDir(): void {
        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }
    }

    _load(): any[] {
        if (!fs.existsSync(USER_GROUP_FILE)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(USER_GROUP_FILE, 'utf8'));
            if (!Array.isArray(parsed)) {
                throw new Error('Data in user_groups.json is not a JSON array');
            }
            return parsed
                .map((item: any) => normalizeGroupRecord(item))
                .filter((item: any) => item.id && item.name);
        } catch (error: any) {
            console.error('Failed to load user_groups.json:', error.message);
            throw error;
        }
    }

    _save(): void {
        saveObjectAtomic(USER_GROUP_FILE, this.groups);
        mirrorStoreSnapshot('user_groups', this.exportState());
    }

    list(): any[] {
        return this.groups.map((item) => ({ ...item }));
    }

    getById(id: string): any {
        const normalizedId = normalizeText(id);
        if (!normalizedId) return null;
        const group = this.groups.find((item) => item.id === normalizedId);
        return group ? { ...group } : null;
    }

    getByName(name: string): any {
        const normalizedName = normalizeText(name).toLowerCase();
        if (!normalizedName) return null;
        const group = this.groups.find((item) => normalizeText(item.name).toLowerCase() === normalizedName);
        return group ? { ...group } : null;
    }

    add(payload: any = {}, actor: string = 'admin'): any {
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

    update(id: string, payload: any = {}, actor: string = 'admin'): any {
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

    remove(id: string): boolean {
        const normalizedId = normalizeText(id);
        const idx = this.groups.findIndex((item) => item.id === normalizedId);
        if (idx === -1) return false;
        this.groups.splice(idx, 1);
        this._save();
        return true;
    }

    removeServerId(serverId: string, actor: string = 'system'): number {
        const targetId = normalizeText(serverId);
        if (!targetId) return 0;
        let changed = 0;
        const nowIso = new Date().toISOString();
        this.groups = this.groups.map((group) => {
            const allowed = group.allowedServerIds.filter((item: string) => item !== targetId);
            const blocked = group.blockedServerIds.filter((item: string) => item !== targetId);
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

    exportState(): any {
        return {
            groups: this.groups,
        };
    }

    importState(snapshot: any = {}): void {
        if (!snapshot || !Array.isArray(snapshot?.groups)) {
            throw new Error('Invalid snapshot format for UserGroupStore: groups array is missing');
        }
        this.groups = snapshot.groups
            .map((item: any) => normalizeGroupRecord(item))
            .filter((item: any) => item.id && item.name);
    }
}

const userGroupStore = new UserGroupStore();

export default userGroupStore;
