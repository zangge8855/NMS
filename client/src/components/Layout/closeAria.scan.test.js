import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HIGH_TRAFFIC = [
    'Clients/ConflictScannerModal.jsx',
    'Clients/ClientModal.jsx',
    'Clients/UserPolicyModal.jsx',
    'Inbounds/Inbounds.jsx',
    'Inbounds/InboundModal.jsx',
    'Servers/Servers.jsx',
    'Users/UserDetail.jsx',
    'Subscriptions/Subscriptions.jsx',
    'Tasks/TaskProgressModal.jsx',
];

describe('high-traffic close aria localization', () => {
    it('does not hard-code Chinese close aria-labels on critical modals', () => {
        for (const rel of HIGH_TRAFFIC) {
            const source = readFileSync(join(root, rel), 'utf8');
            expect(source, rel).not.toMatch(/aria-label=["']关闭["']/);
        }
    });

    it('Inbounds order controls use i18n keys', () => {
        const source = readFileSync(join(root, 'Inbounds/Inbounds.jsx'), 'utf8');
        expect(source).toMatch(/adjustNodeOrder/);
        expect(source).toMatch(/moveNodeUp/);
        expect(source).toMatch(/moveInboundUp/);
        expect(source).not.toMatch(/调整节点 \$\{/);
        expect(source).not.toMatch(/上移节点 \$\{/);
    });
});
