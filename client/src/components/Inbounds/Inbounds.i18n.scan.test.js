import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getLocaleMessage } from '../../i18n/messages.js';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'Inbounds.jsx');
const source = readFileSync(sourcePath, 'utf8');

/**
 * Structural guard: high-traffic Inbounds confirm/toast paths must not embed
 * bare Chinese after localization. Drives the real shipped source file.
 */
describe('Inbounds.jsx high-traffic copy localization', () => {
    it('does not hard-code Chinese in bulk sync toast summary', () => {
        expect(source).not.toMatch(/已同步,\s*\$\{/);
        expect(source).not.toMatch(/跳过；订阅地址未变/);
        expect(source).toMatch(/batchSyncUsersSummaryOk/);
        expect(source).toMatch(/batchSyncUsersSummaryFail/);
    });

    it('uses t() for bulk/delete/enable confirm messages', () => {
        expect(source).toMatch(/confirmBulkDelete/);
        expect(source).toMatch(/confirmBulkSyncUsers/);
        expect(source).toMatch(/confirmBulkEnable/);
        expect(source).toMatch(/confirmBulkDisable/);
        expect(source).toMatch(/confirmDeleteInbound/);
        expect(source).toMatch(/confirmEnableInbound/);
        expect(source).toMatch(/confirmDisableInbound/);
        expect(source).toMatch(/confirmCleanupDepleted/);
        expect(source).toMatch(/confirmDeleteClient/);
        expect(source).toMatch(/confirmBulkDeleteClients/);
        // no leftover 确定删除选中的 template pattern
        expect(source).not.toMatch(/确定删除选中的/);
        expect(source).not.toMatch(/确定把选中的/);
        expect(source).not.toMatch(/确定\$\{enable/);
        expect(source).not.toMatch(/确定清理/);
    });

    it('resolves sync summary keys to English without CJK', () => {
        const cjk = /[\u4e00-\u9fff]/;
        for (const key of [
            'comp.inbounds.batchSyncUsersSummaryOk',
            'comp.inbounds.batchSyncUsersSummaryFail',
            'comp.inbounds.confirmBulkDelete',
            'comp.inbounds.confirmBulkSyncUsers',
        ]) {
            const en = getLocaleMessage('en-US', key, {
                done: 'done',
                synced: 1,
                skipped: 0,
                failed: 0,
                count: 2,
            });
            expect(en).toBeTruthy();
            expect(en).not.toMatch(cjk);
        }
    });
});
