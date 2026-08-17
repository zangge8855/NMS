import crypto from 'crypto';
import systemSettingsStore from '../store/systemSettingsStore.js';

const SENSITIVE_ACTIONS = new Set<string>(['delete', 'disable']);

function toStringValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function toPositiveInt(value: unknown, fallback: number = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function normalizedRole(role: unknown): string {
    const text = toStringValue(role).toLowerCase();
    return text || 'anonymous';
}

function normalizeType(type: unknown): string {
    const text = toStringValue(type).toLowerCase();
    return text || 'unknown';
}

function normalizeAction(action: unknown): string {
    const text = toStringValue(action).toLowerCase();
    return text || 'unknown';
}

function actorIdentity(input: any = {}): string {
    const userId = toStringValue(input.userId);
    const username = toStringValue(input.username);
    return userId || username || normalizedRole(input.role);
}

export function buildBatchRiskOperationKey({ type, action, isRetry = false }: { type: string; action: string; isRetry?: boolean }): string {
    const mode = isRetry ? 'retry' : 'direct';
    return `${mode}:${normalizeType(type)}:${normalizeAction(action)}`;
}

export interface BatchRiskAssessment {
    type: string;
    action: string;
    level: 'low' | 'medium' | 'high';
    targetCount: number;
    reasons: string[];
    requiresToken: boolean;
}

export function assessBatchRisk({
    type,
    action,
    targetCount = 0,
    isRetry = false,
    securitySettings = null,
}: {
    type: string;
    action: string;
    targetCount?: number;
    isRetry?: boolean;
    securitySettings?: any;
}): BatchRiskAssessment {
    const security = securitySettings || systemSettingsStore.getSecurity();
    const normalizedType = normalizeType(type);
    const normalizedAction = normalizeAction(action);
    const count = toPositiveInt(targetCount, 0);
    const reasons: string[] = [];
    let level: 'low' | 'medium' | 'high' = 'low';

    if (SENSITIVE_ACTIONS.has(normalizedAction)) {
        level = 'high';
        reasons.push('sensitive_action');
    }

    if (count >= Number(security.highRiskMinTargets || 100)) {
        level = 'high';
        reasons.push('high_target_count');
    } else if (count >= Number(security.mediumRiskMinTargets || 20) && level === 'low') {
        level = 'medium';
        reasons.push('medium_target_count');
    }

    if (isRetry) {
        reasons.push('retry_operation');
    }

    const requiresToken = Boolean(security.requireHighRiskConfirmation) && level === 'high';
    return {
        type: normalizedType,
        action: normalizedAction,
        level,
        targetCount: count,
        reasons: Array.from(new Set(reasons)),
        requiresToken,
    };
}

export interface BatchRiskTokenEntry {
    actorId: string;
    role: string;
    operationKey: string;
    issuedAtTs: number;
    expiresAtTs: number;
}

class BatchRiskTokenStore {
    tokens: Map<string, BatchRiskTokenEntry>;

    constructor() {
        this.tokens = new Map();
    }

    _cleanupExpired(): void {
        const now = Date.now();
        for (const [token, entry] of this.tokens.entries()) {
            if (entry.expiresAtTs <= now) {
                this.tokens.delete(token);
            }
        }
    }

    issue({ actor = {}, operationKey = '', ttlSeconds }: { actor?: any; operationKey?: string; ttlSeconds?: number } = {}): any {
        this._cleanupExpired();
        const ttl = Math.max(
            30,
            Math.min(
                1800,
                toPositiveInt(ttlSeconds, systemSettingsStore.getSecurity().riskTokenTtlSeconds || 180)
            )
        );
        const now = Date.now();
        const token = crypto.randomBytes(24).toString('base64url');
        const expiresAtTs = now + (ttl * 1000);
        const record: BatchRiskTokenEntry = {
            actorId: actorIdentity(actor),
            role: normalizedRole(actor.role),
            operationKey: toStringValue(operationKey),
            issuedAtTs: now,
            expiresAtTs,
        };
        this.tokens.set(token, record);
        return {
            token,
            ttlSeconds: ttl,
            issuedAt: new Date(now).toISOString(),
            expiresAt: new Date(expiresAtTs).toISOString(),
            operationKey: record.operationKey,
        };
    }

    consume({ token, actor = {}, operationKey = '' }: { token?: string; actor?: any; operationKey?: string } = {}): { ok: boolean; reason: string; entry?: BatchRiskTokenEntry } {
        this._cleanupExpired();
        const normalizedToken = toStringValue(token);
        if (!normalizedToken) {
            return { ok: false, reason: 'missing_token' };
        }
        const entry = this.tokens.get(normalizedToken);
        if (!entry) {
            return { ok: false, reason: 'invalid_token' };
        }

        const expectedActorId = actorIdentity(actor);
        if (entry.actorId !== expectedActorId) {
            return { ok: false, reason: 'actor_mismatch' };
        }
        if (entry.role !== normalizedRole(actor.role)) {
            return { ok: false, reason: 'role_mismatch' };
        }

        const expectedOperationKey = toStringValue(operationKey);
        if (expectedOperationKey && entry.operationKey !== expectedOperationKey) {
            return { ok: false, reason: 'operation_mismatch' };
        }

        this.tokens.delete(normalizedToken);
        return { ok: true, reason: 'ok', entry };
    }
}

const batchRiskTokenStore = new BatchRiskTokenStore();
export default batchRiskTokenStore;
