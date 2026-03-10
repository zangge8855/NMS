import {
    HiOutlineChartBarSquare,
    HiOutlineServerStack,
    HiOutlineUsers,
    HiOutlineCog6Tooth,
    HiOutlineWrenchScrewdriver,
    HiOutlineLink,
    HiOutlineSignal,
    HiOutlineShieldCheck,
    HiOutlineClipboardDocumentList,
} from 'react-icons/hi2';

export const navSections = [
    {
        title: '监控',
        items: [
            { path: '/', icon: HiOutlineChartBarSquare, label: '仪表盘', supportsGlobal: true, keywords: ['首页', '概览', 'dashboard'] },
        ],
    },
    {
        title: '管理',
        items: [
            { path: '/inbounds', icon: HiOutlineSignal, label: '入站管理', supportsGlobal: true, keywords: ['协议', '端口', '流量', 'inbound'] },
            { path: '/clients', icon: HiOutlineUsers, label: '用户管理', supportsGlobal: true, keywords: ['账号', '用户', '客户端', 'users', 'clients'] },
            { path: '/subscriptions', icon: HiOutlineLink, label: '订阅中心', supportsGlobal: true, userOnly: true, keywords: ['订阅', 'subscription'] },
            { path: '/server', icon: HiOutlineCog6Tooth, label: '节点控制台', supportsGlobal: true, keywords: ['节点', '控制台', 'server', 'node'] },
            { path: '/capabilities', icon: HiOutlineSignal, label: '3x-ui 能力', supportsGlobal: false, keywords: ['能力', '探测', 'capabilities'] },
            { path: '/tools', icon: HiOutlineWrenchScrewdriver, label: '节点工具', supportsGlobal: false, keywords: ['工具', 'tools'] },
        ],
    },
    {
        title: '运维',
        items: [
            { path: '/audit', icon: HiOutlineShieldCheck, label: '审计中心', supportsGlobal: true, keywords: ['审计', '日志', '安全', 'audit'] },
            { path: '/tasks', icon: HiOutlineClipboardDocumentList, label: '任务中心', supportsGlobal: true, keywords: ['任务', '批量', 'jobs', 'tasks'] },
            { path: '/settings', icon: HiOutlineCog6Tooth, label: '系统设置', supportsGlobal: true, adminOnly: true, keywords: ['设置', 'system', 'settings'] },
        ],
    },
];

export const footerNavItems = [
    { path: '/servers', icon: HiOutlineServerStack, label: '服务器管理', supportsGlobal: true, adminOnly: true, section: '系统', keywords: ['服务器', '节点', 'server', 'registry'] },
];

export const navItems = [...navSections.flatMap((section) => section.items), ...footerNavItems];

function shouldIncludeNavItem(item, { isAdmin, isGlobalView }) {
    if (!isAdmin) return item.path === '/subscriptions';
    if (item.userOnly && isAdmin) return false;
    if (item.adminOnly && !isAdmin) return false;
    if (isGlobalView && item.supportsGlobal === false) return false;
    return true;
}

export function getVisibleNavSections({ isAdmin, isGlobalView }) {
    return navSections
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => shouldIncludeNavItem(item, { isAdmin, isGlobalView })),
        }))
        .filter((section) => section.items.length > 0);
}

export function getVisibleFooterNavItems({ isAdmin, isGlobalView }) {
    return footerNavItems.filter((item) => shouldIncludeNavItem(item, { isAdmin, isGlobalView }));
}

export function getSearchableNavItems({ isAdmin, isGlobalView }) {
    const sectionItems = getVisibleNavSections({ isAdmin, isGlobalView }).flatMap((section) =>
        section.items.map((item) => ({ ...item, section: section.title }))
    );
    const footerItems = getVisibleFooterNavItems({ isAdmin, isGlobalView }).map((item) => ({
        ...item,
        section: item.section || '系统',
    }));
    return [...sectionItems, ...footerItems];
}
