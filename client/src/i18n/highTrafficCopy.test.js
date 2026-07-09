import { describe, expect, it } from 'vitest';
import { getLocaleMessage } from './messages.js';

/**
 * Guards criterion 1: high-traffic admin English copy must not fall back to Chinese.
 * Drives the real message table used by shipped components (not a reimplementation).
 */
const HIGH_TRAFFIC_KEYS = [
    'comp.userPolicy.title',
    'comp.userPolicy.loadFailed',
    'comp.userPolicy.saved',
    'comp.userPolicy.savePolicy',
    'comp.clients.batchUpdateFailed',
    'comp.clients.batchAddResult',
    'comp.clients.uuidRequired',
    'comp.clients.conflictTitle',
    'comp.clients.conflictRepairFailed',
    'comp.clients.modalAddTitle',
    'comp.inbounds.batchAdjustResult',
    'comp.inbounds.batchUserResult',
    'comp.inbounds.adjustNeedValues',
    'comp.inbounds.batchDeleteDone',
    'comp.inbounds.deploySuccess',
    'comp.inbounds.serverOrderSaved',
    'comp.inbounds.confirmBulkDelete',
    'comp.inbounds.confirmBulkSyncUsers',
    'comp.inbounds.batchSyncUsersSummaryOk',
    'comp.inbounds.confirmDeleteClient',
    'comp.servers.serverOrderUpdated',
    'comp.users.adjustNeedValues',
    'comp.users.noAdjustableClients',
    'comp.users.batchAdjustDone',
    'comp.common.connectFailed',
    'comp.common.saveFailed',
    'comp.common.unknownError',
];

describe('high-traffic en-US copy', () => {
    it('resolves English strings without CJK for critical paths', () => {
        const cjk = /[\u4e00-\u9fff]/;
        for (const key of HIGH_TRAFFIC_KEYS) {
            const en = getLocaleMessage('en-US', key);
            const zh = getLocaleMessage('zh-CN', key);
            expect(en, key).toBeTruthy();
            expect(zh, key).toBeTruthy();
            expect(en, key).not.toMatch(cjk);
            expect(zh, key).toMatch(cjk);
            expect(en, key).not.toEqual(zh);
        }
    });
});
