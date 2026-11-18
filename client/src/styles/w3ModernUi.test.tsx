import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { handleRovingTabKeyDown } from '../utils/rovingTabs';

const CLIENT_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.resolve(__dirname, '..');
const STYLES_DIR = path.resolve(__dirname);

function readClientFile(relPath: string): string {
    return fs.readFileSync(path.join(CLIENT_ROOT, relPath), 'utf8');
}

function isRuleWrappedInSupportsScrollbar(css: string, targetSelector = '::-webkit-scrollbar'): {
    total: number;
    unwrappedLines: number[];
} {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\r\n]/g, ' '));
    const lines = stripped.split(/\r?\n/);
    const stack: { header: string; depth: number }[] = [];
    let braceDepth = 0;
    let total = 0;
    const unwrappedLines: number[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();

        if (line.includes(targetSelector)) {
            total += 1;
            const hasSupports = stack.some((entry) =>
                /@supports\s+not\s*\(\s*scrollbar-color\s*:\s*auto\s*\)/i.test(entry.header)
            );
            if (!hasSupports) {
                unwrappedLines.push(i + 1);
            }
        }

        const openCount = (line.match(/\{/g) || []).length;
        const closeCount = (line.match(/\}/g) || []).length;

        if (openCount > 0) {
            for (let k = 0; k < openCount; k += 1) {
                braceDepth += 1;
                stack.push({ header: trimmed, depth: braceDepth });
            }
        }
        if (closeCount > 0) {
            for (let k = 0; k < closeCount; k += 1) {
                while (stack.length > 0 && stack[stack.length - 1].depth >= braceDepth) {
                    stack.pop();
                }
                braceDepth = Math.max(0, braceDepth - 1);
            }
        }
    }

    return { total, unwrappedLines };
}

describe('Wave 3: rovingTabs WAI-ARIA horizontal keyboard navigation', () => {
    const SAMPLE_TABS = [
        { id: 'overview', label: 'Overview' },
        { id: 'inbounds', label: 'Inbounds' },
        { id: 'audit', label: 'Audit' },
    ] as const;

    function TestTabStrip({
        initialTab = 'overview',
        onSelectSpy,
    }: {
        initialTab?: string;
        onSelectSpy?: (id: string) => void;
    }) {
        const [active, setActive] = useState(initialTab);
        const select = (id: string) => {
            setActive(id);
            onSelectSpy?.(id);
        };

        return (
            <div
                role="tablist"
                aria-label="Sample Tabs"
                onKeyDown={(e) => handleRovingTabKeyDown(e, SAMPLE_TABS, active, select)}
            >
                {SAMPLE_TABS.map((item) => {
                    const isActive = active === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            tabIndex={isActive ? 0 : -1}
                            onClick={() => select(item.id)}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    it('manages tabIndex={0}/{-1} and supports ArrowRight, ArrowLeft, Home, End with wraparound', () => {
        const onSelectSpy = vi.fn();
        render(<TestTabStrip onSelectSpy={onSelectSpy} />);

        const overviewTab = screen.getByRole('tab', { name: 'Overview' });
        const inboundsTab = screen.getByRole('tab', { name: 'Inbounds' });
        const auditTab = screen.getByRole('tab', { name: 'Audit' });

        const scrollIntoViewMock = vi.fn();
        [overviewTab, inboundsTab, auditTab].forEach((btn) => {
            btn.scrollIntoView = scrollIntoViewMock;
        });

        expect(overviewTab).toHaveAttribute('tabindex', '0');
        expect(inboundsTab).toHaveAttribute('tabindex', '-1');
        expect(auditTab).toHaveAttribute('tabindex', '-1');

        overviewTab.focus();
        expect(document.activeElement).toBe(overviewTab);

        // ArrowRight moves forward and updates tabIndex + focus + scrollIntoView
        fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
        expect(onSelectSpy).toHaveBeenLastCalledWith('inbounds');
        expect(document.activeElement).toBe(inboundsTab);
        expect(inboundsTab).toHaveAttribute('tabindex', '0');
        expect(overviewTab).toHaveAttribute('tabindex', '-1');
        expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });

        // End jumps to the last tab
        fireEvent.keyDown(inboundsTab, { key: 'End' });
        expect(onSelectSpy).toHaveBeenLastCalledWith('audit');
        expect(document.activeElement).toBe(auditTab);
        expect(auditTab).toHaveAttribute('tabindex', '0');
        expect(inboundsTab).toHaveAttribute('tabindex', '-1');

        // ArrowRight on last tab wraps back to first tab
        fireEvent.keyDown(auditTab, { key: 'ArrowRight' });
        expect(onSelectSpy).toHaveBeenLastCalledWith('overview');
        expect(document.activeElement).toBe(overviewTab);
        expect(overviewTab).toHaveAttribute('tabindex', '0');

        // ArrowLeft on first tab wraps to last tab
        fireEvent.keyDown(overviewTab, { key: 'ArrowLeft' });
        expect(onSelectSpy).toHaveBeenLastCalledWith('audit');
        expect(document.activeElement).toBe(auditTab);
        expect(auditTab).toHaveAttribute('tabindex', '0');

        // Home jumps back to first tab
        fireEvent.keyDown(auditTab, { key: 'Home' });
        expect(onSelectSpy).toHaveBeenLastCalledWith('overview');
        expect(document.activeElement).toBe(overviewTab);
        expect(overviewTab).toHaveAttribute('tabindex', '0');
    });

    it('wires rovingTabs into AuditCenter, ServerDetail, UserDetail, and UsersHub tablists', () => {
        const targets = [
            'src/components/Audit/AuditCenter.tsx',
            'src/components/Servers/ServerDetail.tsx',
            'src/components/Users/UserDetail.tsx',
            'src/components/Users/UsersHub.tsx',
        ];

        for (const rel of targets) {
            const source = readClientFile(rel);
            expect(source, rel).toContain('handleRovingTabKeyDown');
            expect(source, rel).toMatch(/tabIndex=\{[^}]*\?\s*0\s*:\s*-1\}/);
        }
    });
});

describe('Wave 3: HTML viewport, tsconfig ES2023 & CSS modernization invariants', () => {
    it('configures ES2023 in tsconfig.json and viewport-fit=cover in index.html', () => {
        const tsconfigRaw = readClientFile('tsconfig.json').replace(/\/\*[\s\S]*?\*\//g, '');
        const tsconfig = JSON.parse(tsconfigRaw);
        expect(tsconfig.compilerOptions.target).toBe('ES2023');
        expect(tsconfig.compilerOptions.lib).toContain('ES2023');

        const html = readClientFile('index.html');
        expect(html).toMatch(/<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*"/i);
        expect(html).toContain('/theme-init.js');
    });

    it('defines accent-color, scrollbar tokens, and zero scrollbar-color transitions in theme.css', () => {
        const themeCss = fs.readFileSync(path.join(STYLES_DIR, 'theme.css'), 'utf8');

        expect(themeCss).toMatch(/:root,\s*:root\[data-theme="dark"\][\s\S]*accent-color:\s*var\(--signal\);/);
        expect(themeCss).toMatch(/:root,\s*:root\[data-theme="dark"\][\s\S]*--scrollbar-thumb:\s*rgba\(150,\s*190,\s*214,\s*0\.26\);/);
        expect(themeCss).toMatch(/:root,\s*:root\[data-theme="dark"\][\s\S]*--scrollbar-track:\s*transparent;/);
        expect(themeCss).toMatch(/:root,\s*:root\[data-theme="dark"\][\s\S]*--tab-fade-start:\s*0px;/);
        expect(themeCss).toMatch(/:root,\s*:root\[data-theme="dark"\][\s\S]*--tab-fade-end:\s*0px;/);

        expect(themeCss).toMatch(/:root\[data-theme="light"\][\s\S]*accent-color:\s*var\(--signal\);/);
        expect(themeCss).toMatch(/:root\[data-theme="light"\][\s\S]*--scrollbar-thumb:\s*rgba\(13,\s*27,\s*45,\s*0\.22\);/);
        expect(themeCss).toMatch(/:root\[data-theme="light"\][\s\S]*--scrollbar-track:\s*transparent;/);

        expect(themeCss).toMatch(/:root\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\);/s);
        expect(themeCss).not.toMatch(/transition[^;]*scrollbar-color/i);
    });

    it('wraps every ::-webkit-scrollbar fallback across styles/ and index.css inside @supports not (scrollbar-color: auto)', () => {
        const cssFiles = [
            path.join(SRC_ROOT, 'index.css'),
            ...fs.readdirSync(STYLES_DIR)
                .filter((name) => name.endsWith('.css'))
                .map((name) => path.join(STYLES_DIR, name)),
        ];

        for (const filePath of cssFiles) {
            const css = fs.readFileSync(filePath, 'utf8');
            expect(css, filePath).not.toMatch(/transition[^;]*scrollbar-color/i);
            const result = isRuleWrappedInSupportsScrollbar(css);
            expect(result.unwrappedLines, `${path.relative(CLIENT_ROOT, filePath)} unwrapped ::-webkit-scrollbar lines`).toEqual([]);
        }
    });

    it('enforces Forced-Colors-safe tab ::after borders, linear() ease-out fallback, scroll-padding-bottom, and container tables in identity.css', () => {
        const identityCss = fs.readFileSync(path.join(STYLES_DIR, 'identity.css'), 'utf8');

        // Active tabs use ::after border-block-end instead of box-shadow
        expect(identityCss).not.toMatch(/box-shadow:\s*inset\s+0\s+-2px\s+0\s+var\(--signal\)/);
        expect(identityCss).toContain('box-shadow: none !important;');
        expect(identityCss).toContain('border-block-end: 2px solid var(--signal);');
        expect(identityCss).toContain('[role="tab"][aria-selected="true"]');
        expect(identityCss).toContain('.pf-nav-item[aria-current="page"]');

        // Registered fade properties & scroll-driven tab edge fades
        expect(identityCss).toContain('@property --tab-fade-start');
        expect(identityCss).toContain('@property --tab-fade-end');
        expect(identityCss).toContain('@supports (animation-timeline: scroll())');
        expect(identityCss).toContain('@keyframes tab-fade-in');
        expect(identityCss).toContain('@keyframes tab-fade-out');

        // Form-factor adaptation & typography resilience
        expect(identityCss).toContain('scroll-padding-bottom: calc(var(--mobile-bottom-nav-height, 78px) + env(safe-area-inset-bottom, 0px) + 1rem);');
        expect(identityCss).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*min-height:\s*44px;/);
        expect(identityCss).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*\.btn-icon::after[\s\S]*inset:\s*-6px;/);
        expect(identityCss).toContain('text-wrap: balance;');
        expect(identityCss).toContain('text-wrap: pretty;');
        expect(identityCss).toContain('overflow-wrap: anywhere;');

        // Responsive sticky table headers & inline-size container
        expect(identityCss).toMatch(/:root\s+\.table-container\s*\{[^}]*container-type:\s*inline-size;[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-x:\s*contain;/s);
        expect(identityCss).toMatch(/:root\s+\.table\s+thead\s+th\s*\{[^}]*position:\s*sticky;[^}]*inset-block-start:\s*0;[^}]*z-index:\s*2;[^}]*background:\s*var\(--surface-table-header\);/s);

        // Natural interactions: ease-out fallback before inline linear() spring, press scale, focus-within & hover:none reveal
        expect(identityCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)[\s\S]*scale:\s*0\.98;/);
        expect(identityCss).toMatch(/animation:\s*mwg-popover-in\s+160ms\s+ease-out;\s*\r?\n\s*animation-timing-function:\s*linear\(/);
        expect(identityCss).toContain(':focus-within');
        expect(identityCss).toContain('@media (hover: none)');
    });
});

describe('Wave 3: keyboard-scrollable .table-container regions', () => {
    it('ensures raw table-container wrappers rendering tables expose tabIndex={0} and role="region"', () => {
        const filesWithRawTableContainers = [
            'src/components/Inbounds/Inbounds.tsx',
            'src/components/Servers/Servers.tsx',
            'src/components/Users/UsersHub.tsx',
            'src/components/Audit/AuditCenter.tsx',
            'src/components/Servers/ServerDetail.tsx',
            'src/components/Users/UserDetail.tsx',
        ];

        for (const rel of filesWithRawTableContainers) {
            const source = readClientFile(rel);
            const lines = source.split(/\r?\n/);
            let matchedTableWrappers = 0;

            for (let i = 0; i < lines.length; i += 1) {
                if (lines[i].includes('className="table-container') && lines[i + 1]?.includes('<table')) {
                    matchedTableWrappers += 1;
                    expect(lines[i], `${rel}:${i + 1}`).toContain('role="region"');
                    expect(lines[i], `${rel}:${i + 1}`).toContain('tabIndex={0}');
                    expect(lines[i], `${rel}:${i + 1}`).toMatch(/aria-label=/);
                }
            }

            expect(matchedTableWrappers, `${rel} should expose >=1 accessible table-container`).toBeGreaterThan(0);
        }

        const tableComponentSource = readClientFile('src/components/UI/Table.tsx');
        expect(tableComponentSource).toContain('tabIndex={tableContainer ? 0 : undefined}');
        expect(tableComponentSource).toContain("role={tableContainer ? 'region' : undefined}");
    });
});
