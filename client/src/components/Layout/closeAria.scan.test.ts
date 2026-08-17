import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HIGH_TRAFFIC = [
    'Clients/ConflictScannerModal',
    'Clients/ClientModal',
    'Clients/UserPolicyModal',
    'Inbounds/Inbounds',
    'Inbounds/InboundModal',
    'Servers/Servers',
    'Users/UserDetail',
    'Subscriptions/Subscriptions',
    'Tasks/TaskProgressModal',
];

function readModuleSource(relBase: string): string {
    const tsxPath = join(root, `${relBase}.tsx`);
    if (existsSync(tsxPath)) return readFileSync(tsxPath, 'utf8');
    const jsxPath = join(root, `${relBase}.jsx`);
    if (existsSync(jsxPath)) return readFileSync(jsxPath, 'utf8');
    throw new Error(`File not found: ${relBase}.(tsx|jsx)`);
}

describe('high-traffic close aria localization', () => {
    it('does not hard-code Chinese close aria-labels on critical modals', () => {
        for (const rel of HIGH_TRAFFIC) {
            const source = readModuleSource(rel);
            expect(source, rel).not.toMatch(/aria-label=["']关闭["']/);
        }
    });

    it('Inbounds order controls use i18n keys', () => {
        const source = readModuleSource('Inbounds/Inbounds');
        expect(source).toMatch(/adjustNodeOrder/);
        expect(source).toMatch(/moveNodeUp/);
        expect(source).toMatch(/moveInboundUp/);
        expect(source).not.toMatch(/调整节点 \$\{/);
        expect(source).not.toMatch(/上移节点 \$\{/);
    });
});
