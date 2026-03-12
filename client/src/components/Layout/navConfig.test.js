import { HiOutlineCommandLine, HiOutlineCog6Tooth, HiOutlineCpuChip, HiOutlineSignal } from 'react-icons/hi2';
import { describe, expect, it } from 'vitest';
import { getVisibleNavSections, navSections } from './navConfig.js';

describe('navConfig', () => {
    it('groups node console and audit links under settings section for admins', () => {
        const sections = getVisibleNavSections({
            isAdmin: true,
            isGlobalView: true,
            locale: 'zh-CN',
        });

        expect(sections.map((section) => section.title)).toEqual(['监控', '管理', '系统']);
        expect(sections[2].items.map((item) => item.path)).toEqual(['/settings', '/server', '/audit', '/servers']);
    });

    it('uses distinct icons for inbounds, capabilities, settings, and node console', () => {
        const items = navSections.flatMap((section) => section.items);

        expect(items.find((item) => item.path === '/inbounds')?.icon).toBe(HiOutlineSignal);
        expect(items.find((item) => item.path === '/capabilities')?.icon).toBe(HiOutlineCpuChip);
        expect(items.find((item) => item.path === '/settings')?.icon).toBe(HiOutlineCog6Tooth);
        expect(items.find((item) => item.path === '/server')?.icon).toBe(HiOutlineCommandLine);
    });
});
