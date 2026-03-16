import { HiOutlineCog6Tooth, HiOutlineCpuChip, HiOutlineServerStack, HiOutlineSignal } from 'react-icons/hi2';
import { describe, expect, it } from 'vitest';
import { getVisibleNavSections, navSections } from './navConfig.js';

describe('navConfig', () => {
    it('keeps an operation-first sidebar order and folds node console into settings for admins', () => {
        const sections = getVisibleNavSections({
            isAdmin: true,
            isGlobalView: true,
            locale: 'zh-CN',
        });

        expect(sections.map((section) => section.title)).toEqual(['概览', '运营', '节点', '系统']);
        expect(sections[1].items.map((item) => item.path)).toEqual(['/inbounds', '/clients', '/audit']);
        expect(sections[2].items.map((item) => item.path)).toEqual(['/servers']);
        expect(sections[3].items.map((item) => item.path)).toEqual(['/settings']);
    });

    it('uses distinct icons for inbounds, capabilities, settings, and servers', () => {
        const items = navSections.flatMap((section) => section.items);

        expect(items.find((item) => item.path === '/inbounds')?.icon).toBe(HiOutlineSignal);
        expect(items.find((item) => item.path === '/capabilities')?.icon).toBe(HiOutlineCpuChip);
        expect(items.find((item) => item.path === '/settings')?.icon).toBe(HiOutlineCog6Tooth);
        expect(items.find((item) => item.path === '/servers')?.icon).toBe(HiOutlineServerStack);
    });
});
