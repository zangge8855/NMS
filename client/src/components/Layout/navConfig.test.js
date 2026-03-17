import { HiOutlineCog6Tooth, HiOutlineCpuChip, HiOutlineRss, HiOutlineServerStack, HiOutlineSignal, HiOutlineUserCircle } from 'react-icons/hi2';
import { describe, expect, it } from 'vitest';
import { getVisibleNavSections, navSections } from './navConfig.js';

describe('navConfig', () => {
    it('folds dashboard into manage and keeps audit under manage for admins', () => {
        const sections = getVisibleNavSections({
            isAdmin: true,
            isGlobalView: true,
            locale: 'zh-CN',
        });

        expect(sections.map((section) => section.title)).toEqual(['管理', '系统']);
        expect(sections[0].items.map((item) => item.path)).toEqual(['/', '/inbounds', '/clients', '/audit']);
        expect(sections[1].items.map((item) => item.path)).toEqual(['/settings', '/servers']);
    });

    it('shows account and subscriptions for regular users', () => {
        const sections = getVisibleNavSections({
            isAdmin: false,
            isGlobalView: false,
            locale: 'zh-CN',
        });

        expect(sections.map((section) => section.title)).toEqual(['管理']);
        expect(sections[0].items.map((item) => item.path)).toEqual(['/account', '/subscriptions']);
    });

    it('uses distinct icons for inbounds, capabilities, settings, and servers', () => {
        const items = navSections.flatMap((section) => section.items);

        expect(items.find((item) => item.path === '/inbounds')?.icon).toBe(HiOutlineSignal);
        expect(items.find((item) => item.path === '/capabilities')?.icon).toBe(HiOutlineCpuChip);
        expect(items.find((item) => item.path === '/settings')?.icon).toBe(HiOutlineCog6Tooth);
        expect(items.find((item) => item.path === '/servers')?.icon).toBe(HiOutlineServerStack);
    });

    it('uses distinct icons for account and subscriptions', () => {
        const items = navSections.flatMap((section) => section.items);

        expect(items.find((item) => item.path === '/account')?.icon).toBe(HiOutlineUserCircle);
        expect(items.find((item) => item.path === '/subscriptions')?.icon).toBe(HiOutlineRss);
    });
});
