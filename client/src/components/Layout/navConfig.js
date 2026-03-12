import {
    HiOutlineChartBarSquare,
    HiOutlineServerStack,
    HiOutlineUsers,
    HiOutlineCog6Tooth,
    HiOutlineWrenchScrewdriver,
    HiOutlineLink,
    HiOutlineSignal,
    HiOutlineCpuChip,
    HiOutlineCommandLine,
    HiOutlineShieldCheck,
} from 'react-icons/hi2';

function localize(copy, locale = 'zh-CN') {
    if (typeof copy === 'string') return copy;
    if (!copy || typeof copy !== 'object') return '';
    return copy[locale] || copy['zh-CN'] || '';
}

export const navSections = [
    {
        title: { 'zh-CN': '监控', 'en-US': 'Monitor' },
        items: [
            { path: '/', icon: HiOutlineChartBarSquare, label: { 'zh-CN': '仪表盘', 'en-US': 'Dashboard' }, supportsGlobal: true, keywords: ['首页', '概览', 'dashboard'] },
        ],
    },
    {
        title: { 'zh-CN': '管理', 'en-US': 'Manage' },
        items: [
            { path: '/inbounds', icon: HiOutlineSignal, label: { 'zh-CN': '入站管理', 'en-US': 'Inbounds' }, supportsGlobal: true, keywords: ['协议', '端口', '流量', 'inbound'] },
            { path: '/clients', icon: HiOutlineUsers, label: { 'zh-CN': '用户管理', 'en-US': 'Users' }, supportsGlobal: true, keywords: ['账号', '用户', '客户端', 'users', 'clients'] },
            { path: '/subscriptions', icon: HiOutlineLink, label: { 'zh-CN': '订阅中心', 'en-US': 'Subscriptions' }, supportsGlobal: true, keywords: ['订阅', 'subscription', '账户', '密码', 'profile'] },
            { path: '/capabilities', icon: HiOutlineCpuChip, label: { 'zh-CN': '3x-ui 能力', 'en-US': '3x-ui Capabilities' }, supportsGlobal: false, keywords: ['能力', '探测', 'capabilities'] },
            { path: '/tools', icon: HiOutlineWrenchScrewdriver, label: { 'zh-CN': '节点工具', 'en-US': 'Node Tools' }, supportsGlobal: false, keywords: ['工具', 'tools'] },
        ],
    },
    {
        title: { 'zh-CN': '系统', 'en-US': 'System' },
        items: [
            { path: '/settings', icon: HiOutlineCog6Tooth, label: { 'zh-CN': '系统设置', 'en-US': 'Settings' }, supportsGlobal: true, adminOnly: true, keywords: ['设置', 'system', 'settings'] },
            { path: '/server', icon: HiOutlineCommandLine, label: { 'zh-CN': '节点控制台', 'en-US': 'Node Console' }, supportsGlobal: true, keywords: ['节点', '控制台', 'server', 'node'] },
            { path: '/audit', icon: HiOutlineShieldCheck, label: { 'zh-CN': '审计中心', 'en-US': 'Audit' }, supportsGlobal: true, keywords: ['审计', '日志', '安全', 'audit', '任务', '批量', 'jobs', 'tasks', '操作历史'] },
            { path: '/servers', icon: HiOutlineServerStack, label: { 'zh-CN': '服务器管理', 'en-US': 'Servers' }, supportsGlobal: true, adminOnly: true, keywords: ['服务器', '节点', 'server', 'registry'] },
        ],
    },
];

export const footerNavItems = [];

export const navItems = [...navSections.flatMap((section) => section.items), ...footerNavItems];

function shouldIncludeNavItem(item, { isAdmin, isGlobalView }) {
    if (!isAdmin) return item.path === '/subscriptions';
    if (item.userOnly && isAdmin) return false;
    if (item.adminOnly && !isAdmin) return false;
    if (isGlobalView && item.supportsGlobal === false) return false;
    return true;
}

export function getVisibleNavSections({ isAdmin, isGlobalView, locale = 'zh-CN' }) {
    return navSections
        .map((section) => ({
            ...section,
            title: localize(section.title, locale),
            items: section.items
                .filter((item) => shouldIncludeNavItem(item, { isAdmin, isGlobalView }))
                .map((item) => ({ ...item, label: localize(item.label, locale) })),
        }))
        .filter((section) => section.items.length > 0);
}

export function getVisibleFooterNavItems({ isAdmin, isGlobalView, locale = 'zh-CN' }) {
    return footerNavItems
        .filter((item) => shouldIncludeNavItem(item, { isAdmin, isGlobalView }))
        .map((item) => ({
            ...item,
            label: localize(item.label, locale),
            section: localize(item.section, locale),
        }));
}

export function getSearchableNavItems({ isAdmin, isGlobalView, locale = 'zh-CN' }) {
    const sectionItems = getVisibleNavSections({ isAdmin, isGlobalView, locale }).flatMap((section) =>
        section.items.map((item) => ({ ...item, section: section.title }))
    );
    const footerItems = getVisibleFooterNavItems({ isAdmin, isGlobalView, locale }).map((item) => ({
        ...item,
        section: item.section || localize({ 'zh-CN': '系统', 'en-US': 'System' }, locale),
    }));
    return [...sectionItems, ...footerItems];
}
