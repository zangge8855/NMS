import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchManagedUsers,
    getManagedUsersSnapshot,
    invalidateManagedUsersCache,
} from './managedUsersCache';
import { generateHexToken, generateUuidLocal } from './crypto';
import { AUDIT_EVENT_LABELS, getAuditEventLabel } from './auditEventLabels';
import { buildClientConflictReport, getConflictTypeLabels } from './clientConflict';
import { copyToClipboard } from './format';

describe('managedUsersCache', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        invalidateManagedUsersCache();
    });

    it('drops stale in-flight fetches if cache is invalidated before resolution', async () => {
        let resolveFetch!: (val: any) => void;
        const mockApi = {
            get: vi.fn().mockImplementation(
                () => new Promise((resolve) => {
                    resolveFetch = resolve;
                })
            ),
        };

        const inflight = fetchManagedUsers(mockApi, { force: true });
        invalidateManagedUsersCache();

        resolveFetch({
            data: {
                obj: [{ id: 'u-stale', username: 'stale-user', role: 'user' }],
                totalPages: 1,
            },
        });

        const returned = await inflight;
        expect(returned).toEqual([]);
        expect(getManagedUsersSnapshot()).toEqual([]);
        expect(window.sessionStorage.getItem('nms_session_snapshot:managed_users_v1')).toBeNull();
    });
});

describe('crypto utils', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses crypto.getRandomValues for UUID fallback and hex tokens without Math.random', () => {
        const mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('Math.random must not be called');
        });
        const getRandomValues = vi.fn((arr: Uint8Array) => {
            for (let i = 0; i < arr.length; i += 1) {
                arr[i] = i + 1;
            }
            return arr;
        });

        vi.stubGlobal('crypto', {
            getRandomValues,
        });

        const uuid = generateUuidLocal();
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

        const token = generateHexToken(4);
        expect(token).toBe('01020304');
        expect(mathRandomSpy).not.toHaveBeenCalled();
    });
});

describe('auditEventLabels', () => {
    it('provides localized labels for 2FA and dynamic Xray events', () => {
        const keys = [
            'login_two_factor_challenge_issued',
            'account_2fa_setup_started',
            'account_2fa_enabled',
        ];
        for (const key of keys) {
            expect(AUDIT_EVENT_LABELS['zh-CN'][key]).toBeTruthy();
            expect(AUDIT_EVENT_LABELS['en-US'][key]).toBeTruthy();
            expect(getAuditEventLabel(key, 'zh-CN')).toBe(AUDIT_EVENT_LABELS['zh-CN'][key]);
            expect(getAuditEventLabel(key, 'en-US')).toBe(AUDIT_EVENT_LABELS['en-US'][key]);
        }

        expect(getAuditEventLabel('xray_routing_updated', 'en-US')).toBeTruthy();
        expect(getAuditEventLabel('xray_custom_update_failed', 'zh-CN')).toContain('custom');
    });
});

describe('clientConflict utils', () => {
    it('supports protocol-aligned TUIC/Hysteria2 conflict detection and localized labels', () => {
        const reportEn = buildClientConflictReport([
            {
                serverId: 's1',
                inboundId: 1,
                protocol: 'hysteria2',
                password: 'pw1',
                email: '',
                totalGB: 100,
                enable: true,
            },
            {
                serverId: 's2',
                inboundId: 2,
                protocol: 'hysteria2',
                password: 'pw1',
                email: '',
                totalGB: 200,
                enable: true,
            },
        ], 'en-US');

        expect(reportEn.groups).toHaveLength(1);
        expect(reportEn.groups[0].displayIdentity).toBe('ID hysteria2:pw1');
        expect(reportEn.groups[0].conflictFieldLabels).toEqual(['Total Traffic']);
        expect(getConflictTypeLabels(reportEn.groups[0].conflictTypes, 'en-US')).toEqual(['Traffic Quota Mismatch']);
    });
});

describe('copyToClipboard', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete (document as any).execCommand;
    });

    it('returns false and cleans up the fallback textarea when clipboard copy fails', async () => {
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Permission denied'));
        (document as any).execCommand = vi.fn(() => false);

        const beforeCount = document.body.querySelectorAll('textarea').length;
        const ok = await copyToClipboard('secret-value');
        const afterCount = document.body.querySelectorAll('textarea').length;

        expect(ok).toBe(false);
        expect(afterCount).toBe(beforeCount);
    });
});
