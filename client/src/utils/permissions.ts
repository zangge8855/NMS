import type { UserRole } from '../types';

export type EffectiveRole = UserRole | '';

export interface TaskPermissionSubject {
    type?: string | null;
    status?: string | null;
    actor?: string | null;
    createdBy?: string | null;
}

export interface OptionalAuthLike {
    user?: {
        role?: string | null;
        username?: string | null;
    } | null;
}

export interface ResolvedActor {
    role: UserRole;
    username: string;
}

const ADMIN_ONLY_TASK_TYPES = new Set(['db_backfill', 'registered_user_notice']);
const CANCELLABLE_TASK_STATUSES = new Set(['running', 'pending', 'queued']);

/**
 * Normalize role strings (including legacy 'viewer' -> 'auditor').
 */
export function normalizeRole(role?: string | null): EffectiveRole {
    const value = String(role || '').trim().toLowerCase();
    if (value === 'viewer') return 'auditor';
    if (value === 'admin' || value === 'operator' || value === 'auditor' || value === 'user') {
        return value;
    }
    return '';
}

export function isAdminRole(role?: string | null): boolean {
    return normalizeRole(role) === 'admin';
}

export function isOperatorOrAbove(role?: string | null): boolean {
    const normalized = normalizeRole(role);
    return normalized === 'admin' || normalized === 'operator';
}

export function isAuditorRole(role?: string | null): boolean {
    return normalizeRole(role) === 'auditor';
}

export function isStaffRole(role?: string | null): boolean {
    const normalized = normalizeRole(role);
    return normalized === 'admin' || normalized === 'operator' || normalized === 'auditor';
}

export function canAccessSystemSettings(role?: string | null): boolean {
    return isAdminRole(role);
}

export function canAccessXraySettings(role?: string | null): boolean {
    return isAdminRole(role);
}

export function canMutateOperations(role?: string | null): boolean {
    return isOperatorOrAbove(role);
}

export function canManageStaffAccounts(role?: string | null): boolean {
    return isAdminRole(role);
}

export function canManageUserTarget(actorRole?: string | null, targetRole?: string | null): boolean {
    const actor = normalizeRole(actorRole);
    if (actor === 'admin') return true;
    if (actor === 'operator') {
        return normalizeRole(targetRole) === 'user';
    }
    return false;
}

export function canClearAuditLogs(role?: string | null): boolean {
    return isAdminRole(role);
}

export function canCancelTask(
    actorRole?: string | null,
    actorUsername?: string | null,
    task?: TaskPermissionSubject | null
): boolean {
    if (!task) return false;
    const status = String(task.status || '').trim().toLowerCase();
    if (!CANCELLABLE_TASK_STATUSES.has(status)) {
        return false;
    }
    const actor = normalizeRole(actorRole);
    if (actor === 'admin') {
        return true;
    }
    if (actor === 'operator') {
        const taskType = String(task.type || '').trim();
        if (ADMIN_ONLY_TASK_TYPES.has(taskType)) {
            return false;
        }
        const expectedUser = String(actorUsername || '').trim();
        const taskActor = String(task.actor || task.createdBy || '').trim();
        return Boolean(expectedUser) && taskActor === expectedUser;
    }
    return false;
}

/**
 * Resolve the effective actor when a component uses useOptionalAuth().
 * When auth context is absent (standalone unit tests without AuthProvider),
 * preserve legacy full-permission test defaults; when AuthProvider is present,
 * fail closed to 'user' if role is missing.
 */
export function resolveOptionalAuthActor(auth: OptionalAuthLike | null | undefined): ResolvedActor {
    if (!auth) {
        return { role: 'admin', username: '' };
    }
    return {
        role: normalizeRole(auth.user?.role) || 'user',
        username: String(auth.user?.username || '').trim(),
    };
}

export function pickRoleCopy(locale: string | undefined, zh: string, en: string): string {
    return locale === 'en-US' ? en : zh;
}
