import { describe, expect, it } from 'vitest';
import {
    canAccessSystemSettings,
    canAccessXraySettings,
    canCancelTask,
    canClearAuditLogs,
    canManageStaffAccounts,
    canManageUserTarget,
    canMutateOperations,
    isAdminRole,
    isAuditorRole,
    isOperatorOrAbove,
    isStaffRole,
    normalizeRole,
    pickRoleCopy,
    resolveOptionalAuthActor,
} from './permissions';

describe('permissions helpers', () => {
    it('normalizes known roles including legacy viewer alias and rejects unknown values', () => {
        expect(normalizeRole('admin')).toBe('admin');
        expect(normalizeRole(' ADMIN ')).toBe('admin');
        expect(normalizeRole('operator')).toBe('operator');
        expect(normalizeRole('auditor')).toBe('auditor');
        expect(normalizeRole('viewer')).toBe('auditor');
        expect(normalizeRole('user')).toBe('user');
        expect(normalizeRole('')).toBe('');
        expect(normalizeRole(null)).toBe('');
        expect(normalizeRole(undefined)).toBe('');
        expect(normalizeRole('superuser')).toBe('');
    });

    it('identifies role tiers accurately', () => {
        expect(isAdminRole('admin')).toBe(true);
        expect(isAdminRole('operator')).toBe(false);
        expect(isAdminRole('auditor')).toBe(false);
        expect(isAdminRole('user')).toBe(false);

        expect(isOperatorOrAbove('admin')).toBe(true);
        expect(isOperatorOrAbove('operator')).toBe(true);
        expect(isOperatorOrAbove('auditor')).toBe(false);
        expect(isOperatorOrAbove('viewer')).toBe(false);
        expect(isOperatorOrAbove('user')).toBe(false);

        expect(isAuditorRole('auditor')).toBe(true);
        expect(isAuditorRole('viewer')).toBe(true);
        expect(isAuditorRole('operator')).toBe(false);

        expect(isStaffRole('admin')).toBe(true);
        expect(isStaffRole('operator')).toBe(true);
        expect(isStaffRole('auditor')).toBe(true);
        expect(isStaffRole('viewer')).toBe(true);
        expect(isStaffRole('user')).toBe(false);
        expect(isStaffRole(undefined)).toBe(false);
    });

    it('gates settings, xray, audit clear, staff account management, and operations by role', () => {
        expect(canAccessSystemSettings('admin')).toBe(true);
        expect(canAccessSystemSettings('operator')).toBe(false);
        expect(canAccessSystemSettings('auditor')).toBe(false);
        expect(canAccessSystemSettings('user')).toBe(false);

        expect(canAccessXraySettings('admin')).toBe(true);
        expect(canAccessXraySettings('operator')).toBe(false);
        expect(canAccessXraySettings('auditor')).toBe(false);

        expect(canClearAuditLogs('admin')).toBe(true);
        expect(canClearAuditLogs('operator')).toBe(false);
        expect(canClearAuditLogs('auditor')).toBe(false);

        expect(canManageStaffAccounts('admin')).toBe(true);
        expect(canManageStaffAccounts('operator')).toBe(false);
        expect(canManageStaffAccounts('auditor')).toBe(false);

        expect(canMutateOperations('admin')).toBe(true);
        expect(canMutateOperations('operator')).toBe(true);
        expect(canMutateOperations('auditor')).toBe(false);
        expect(canMutateOperations('viewer')).toBe(false);
        expect(canMutateOperations('user')).toBe(false);
    });

    it('restricts canManageUserTarget so operator only manages role=user', () => {
        expect(canManageUserTarget('admin', 'admin')).toBe(true);
        expect(canManageUserTarget('admin', 'operator')).toBe(true);
        expect(canManageUserTarget('admin', 'auditor')).toBe(true);
        expect(canManageUserTarget('admin', 'user')).toBe(true);

        expect(canManageUserTarget('operator', 'user')).toBe(true);
        expect(canManageUserTarget('operator', 'admin')).toBe(false);
        expect(canManageUserTarget('operator', 'operator')).toBe(false);
        expect(canManageUserTarget('operator', 'auditor')).toBe(false);
        expect(canManageUserTarget('operator', 'viewer')).toBe(false);
        expect(canManageUserTarget('operator', undefined)).toBe(false);

        expect(canManageUserTarget('auditor', 'user')).toBe(false);
        expect(canManageUserTarget('user', 'user')).toBe(false);
    });

    it('enforces canCancelTask for running status, ownership, and admin-only task types', () => {
        const ownBatchTask = { type: 'batch_sync', status: 'running', actor: 'op-alice' };
        const ownPendingTask = { type: 'client_provision', status: 'pending', createdBy: 'op-alice' };
        const otherTask = { type: 'batch_sync', status: 'running', actor: 'op-bob' };
        const backfillTask = { type: 'db_backfill', status: 'running', actor: 'op-alice' };
        const noticeTask = { type: 'registered_user_notice', status: 'running', actor: 'op-alice' };
        const completedTask = { type: 'batch_sync', status: 'completed', actor: 'op-alice' };

        expect(canCancelTask('admin', 'root', backfillTask)).toBe(true);
        expect(canCancelTask('admin', 'root', otherTask)).toBe(true);
        expect(canCancelTask('admin', 'root', completedTask)).toBe(false);
        expect(canCancelTask('admin', 'root', null)).toBe(false);

        expect(canCancelTask('operator', 'op-alice', ownBatchTask)).toBe(true);
        expect(canCancelTask('operator', 'op-alice', ownPendingTask)).toBe(true);
        expect(canCancelTask('operator', 'op-alice', otherTask)).toBe(false);
        expect(canCancelTask('operator', 'op-alice', backfillTask)).toBe(false);
        expect(canCancelTask('operator', 'op-alice', noticeTask)).toBe(false);
        expect(canCancelTask('operator', 'op-alice', completedTask)).toBe(false);
        expect(canCancelTask('operator', '', ownBatchTask)).toBe(false);

        expect(canCancelTask('auditor', 'op-alice', ownBatchTask)).toBe(false);
        expect(canCancelTask('user', 'op-alice', ownBatchTask)).toBe(false);
    });

    it('resolves optional auth context safely for unwrapped tests vs fail-closed auth', () => {
        expect(resolveOptionalAuthActor(null)).toEqual({ role: 'admin', username: '' });
        expect(resolveOptionalAuthActor(undefined)).toEqual({ role: 'admin', username: '' });
        expect(resolveOptionalAuthActor({ user: null })).toEqual({ role: 'user', username: '' });
        expect(resolveOptionalAuthActor({ user: { role: 'auditor', username: 'audit-1' } })).toEqual({
            role: 'auditor',
            username: 'audit-1',
        });
        expect(resolveOptionalAuthActor({ user: { role: 'viewer', username: 'legacy' } })).toEqual({
            role: 'auditor',
            username: 'legacy',
        });
    });

    it('picks locale-appropriate copy', () => {
        expect(pickRoleCopy('en-US', '取消', 'Cancel')).toBe('Cancel');
        expect(pickRoleCopy('zh-CN', '取消', 'Cancel')).toBe('取消');
    });
});
