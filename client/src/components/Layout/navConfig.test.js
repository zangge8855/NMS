import { describe, expect, it } from 'vitest';
import { getVisibleNavSections } from './navConfig.js';

describe('navConfig', () => {
    it('groups node console and audit links under settings section for admins', () => {
        const sections = getVisibleNavSections({
            isAdmin: true,
            isGlobalView: true,
            locale: 'zh-CN',
        });

        expect(sections.map((section) => section.title)).toEqual(['监控', '管理', '系统设置']);
        expect(sections[2].items.map((item) => item.path)).toEqual(['/settings', '/server', '/audit']);
    });
});
