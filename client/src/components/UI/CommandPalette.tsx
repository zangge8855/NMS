import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
    HiOutlineMagnifyingGlass,
    HiOutlineArrowPath,
    HiOutlinePlusCircle,
    HiOutlineServerStack,
    HiOutlineUsers,
    HiOutlineXMark,
    HiOutlineSun,
    HiOutlineMoon,
    HiOutlineLanguage,
    HiOutlineArrowRightOnRectangle,
    HiOutlineCommandLine,
    HiOutlineSparkles,
} from 'react-icons/hi2';
import { getSearchableNavItems } from '../Layout/navConfig';
import { getManagedUsersSnapshotMeta } from '../../utils/managedUsersCache';

export interface CommandItem {
    id: string;
    kind: 'page' | 'command' | 'server' | 'user';
    label: string;
    section: string;
    description?: string;
    icon?: React.ComponentType<{ className?: string }>;
    path?: string;
    action?: () => void;
    keywords?: (string | undefined)[];
    badge?: string;
}

function normalizeKeyword(value: any): string {
    return String(value || '').trim().toLowerCase();
}

function getCommandCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            quickLaunchBadge: 'NMS Quick Launch',
            paletteTitle: 'Command Palette',
            searchPlaceholder: 'Type a command, page, node, or user...',
            actions: 'Quick Actions',
            pages: 'Navigation',
            users: 'Users',
            servers: 'Nodes & Servers',
            refresh: 'Refresh Current Page',
            refreshMeta: 'Reload live telemetry and lists',
            createUser: 'Add User Account',
            createUserMeta: 'Create new proxy credentials and client profile',
            createServer: 'Add 3X-UI Node',
            createServerMeta: 'Connect and manage a new node server',
            toggleTheme: 'Cycle Appearance Mode',
            toggleThemeMeta: 'Switch between light and dark theme mode',
            toggleLanguage: 'Switch Language',
            toggleLanguageMeta: 'Toggle between 中文 and English',
            copySubscription: 'My Subscriptions',
            copySubscriptionMeta: 'Open subscriptions and client download center',
            logout: 'Sign Out',
            logoutMeta: 'Safely end active session',
            noResults: 'No matching commands or resources found',
            navigationHint: 'Navigate with ↑ ↓, press Enter to select, Esc to close',
        };
    }
    return {
        quickLaunchBadge: 'NMS 快捷启动',
        paletteTitle: '全局命令面板',
        searchPlaceholder: '输入命令、页面、节点或用户进行搜索...',
        actions: '快捷操作',
        pages: '系统页面',
        users: '用户管理',
        servers: '服务器节点',
        refresh: '刷新当前页面',
        refreshMeta: '重新同步页面数据与运行状态',
        createUser: '新建用户账号',
        createUserMeta: '分配新的订阅配置与协议凭据',
        createServer: '添加 3X-UI 节点',
        createServerMeta: '接入并纳管新的节点服务器',
        toggleTheme: '切换界面外观模式',
        toggleThemeMeta: '在深色与浅色外观间切换',
        toggleLanguage: '切换系统语言',
        toggleLanguageMeta: '在中英文之间快速切换',
        copySubscription: '我的订阅中心',
        copySubscriptionMeta: '打开个人订阅及客户端配置中心',
        logout: '退出登录',
        logoutMeta: '安全退出当前管理会话',
        noResults: '未找到匹配的命令、页面或资源',
        navigationHint: '使用 ↑ ↓ 键选择，回车执行，Esc 关闭',
    };
}

export default function CommandPalette() {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    const { servers = [], activeServerId } = useServer();
    const { user, logout } = useAuth();
    const { locale, toggleLocale } = useI18n();
    const { resolvedTheme, cycleTheme } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();

    const isAdmin = user?.role === 'admin';
    const isGlobalView = activeServerId === 'global';
    const copy = useMemo(() => getCommandCopy(locale), [locale]);

    // Open/close listeners
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setIsOpen((prev) => !prev);
                return;
            }
            if (e.key === 'Escape' && isOpen) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                setIsOpen(false);
            }
        };

        const handleCustomOpen = () => {
            setIsOpen(true);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('nms:open-command-palette', handleCustomOpen);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('nms:open-command-palette', handleCustomOpen);
        };
    }, [isOpen]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setSearchTerm('');
            setHighlightedIndex(0);
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }, [isOpen]);

    // Build all available command items
    const allItems = useMemo<CommandItem[]>(() => {
        const items: CommandItem[] = [];

        // 1. Navigation Pages
        const navPages = getSearchableNavItems({ isAdmin, isGlobalView, locale }).map((nav) => ({
            id: `page-${nav.path}`,
            kind: 'page' as const,
            label: nav.label,
            section: copy.pages,
            description: nav.section || copy.pages,
            icon: nav.icon,
            path: nav.path,
            keywords: [nav.label, nav.path, nav.section],
        }));
        items.push(...navPages);

        // 2. Quick Actions
        const actions: CommandItem[] = [
            {
                id: 'action-refresh',
                kind: 'command',
                label: copy.refresh,
                section: copy.actions,
                description: copy.refreshMeta,
                icon: HiOutlineArrowPath,
                action: () => {
                    const event = new CustomEvent('nms:page-refresh', { cancelable: true, detail: { path: location.pathname } });
                    const shouldFallback = window.dispatchEvent(event);
                    if (shouldFallback) {
                        window.location.reload();
                    }
                },
                keywords: ['refresh', 'reload', 'sync', '刷新', '重载'],
            },
            {
                id: 'action-toggle-theme',
                kind: 'command',
                label: copy.toggleTheme,
                section: copy.actions,
                description: copy.toggleThemeMeta,
                icon: resolvedTheme === 'dark' ? HiOutlineSun : HiOutlineMoon,
                action: () => {
                    cycleTheme();
                },
                keywords: ['theme', 'dark', 'light', 'mode', '主题', '外观', '深色', '浅色'],
            },
            {
                id: 'action-toggle-language',
                kind: 'command',
                label: copy.toggleLanguage,
                section: copy.actions,
                description: copy.toggleLanguageMeta,
                icon: HiOutlineLanguage,
                action: () => {
                    toggleLocale();
                },
                keywords: ['language', 'locale', 'chinese', 'english', '语言', '中英文'],
            },
            {
                id: 'action-my-subscription',
                kind: 'command',
                label: copy.copySubscription,
                section: copy.actions,
                description: copy.copySubscriptionMeta,
                icon: HiOutlineSparkles,
                path: '/subscriptions',
                keywords: ['subscription', 'clash', 'singbox', 'v2ray', '订阅', '复制'],
            },
        ];

        if (isAdmin) {
            actions.push(
                {
                    id: 'action-create-user',
                    kind: 'command',
                    label: copy.createUser,
                    section: copy.actions,
                    description: copy.createUserMeta,
                    icon: HiOutlinePlusCircle,
                    path: '/clients?action=create',
                    keywords: ['create', 'add', 'user', 'client', '新增', '添加', '用户', '账号'],
                },
                {
                    id: 'action-create-server',
                    kind: 'command',
                    label: copy.createServer,
                    section: copy.actions,
                    description: copy.createServerMeta,
                    icon: HiOutlinePlusCircle,
                    path: '/servers?action=create',
                    keywords: ['create', 'add', 'server', 'node', '新增', '添加', '服务器', '节点'],
                }
            );
        }

        actions.push({
            id: 'action-logout',
            kind: 'command',
            label: copy.logout,
            section: copy.actions,
            description: copy.logoutMeta,
            icon: HiOutlineArrowRightOnRectangle,
            action: () => {
                logout();
            },
            keywords: ['logout', 'signout', 'exit', '退出', '注销'],
        });

        items.push(...actions);

        // 3. Servers & Nodes
        if (isAdmin && Array.isArray(servers)) {
            const serverItems: CommandItem[] = servers
                .map((srv: any) => {
                    const id = String(srv?.id || '').trim();
                    if (!id) return null;
                    const label = String(srv?.name || srv?.url || id).trim();
                    return {
                        id: `server-${id}`,
                        kind: 'server' as const,
                        label,
                        section: copy.servers,
                        description: String(srv?.url || srv?.group || '').trim(),
                        icon: HiOutlineServerStack,
                        path: `/servers/${encodeURIComponent(id)}`,
                        keywords: [id, srv?.name, srv?.url, srv?.group, 'node', 'server', '节点', '服务器'],
                    };
                })
                .filter(Boolean) as CommandItem[];
            items.push(...serverItems);
        }

        // 4. Managed Users
        if (isAdmin) {
            const cachedUsers = getManagedUsersSnapshotMeta().users;
            if (Array.isArray(cachedUsers)) {
                const userItems: CommandItem[] = cachedUsers
                    .map((usr: any) => {
                        const id = String(usr?.id || '').trim();
                        if (!id) return null;
                        const label = String(usr?.username || usr?.email || usr?.subscriptionEmail || id).trim();
                        return {
                            id: `user-${id}`,
                            kind: 'user' as const,
                            label,
                            section: copy.users,
                            description: String(usr?.email || usr?.subscriptionEmail || usr?.username || '').trim(),
                            icon: HiOutlineUsers,
                            path: `/clients/${encodeURIComponent(id)}`,
                            keywords: [id, usr?.username, usr?.email, usr?.subscriptionEmail, 'user', 'client', '用户', '账号'],
                        };
                    })
                    .filter(Boolean) as CommandItem[];
                items.push(...userItems);
            }
        }

        return items;
    }, [copy, isAdmin, isGlobalView, locale, location.pathname, logout, resolvedTheme, servers]);

    // Filter items according to search input
    const filteredItems = useMemo(() => {
        const query = normalizeKeyword(searchTerm);
        if (!query) return allItems.slice(0, 24);

        return allItems
            .filter((item) => {
                if (normalizeKeyword(item.label).includes(query)) return true;
                if (item.description && normalizeKeyword(item.description).includes(query)) return true;
                if (Array.isArray(item.keywords)) {
                    return item.keywords.some((kw) => kw && normalizeKeyword(kw).includes(query));
                }
                return false;
            })
            .slice(0, 20);
    }, [allItems, searchTerm]);

    // Group filtered items by section
    const groupedItems = useMemo(() => {
        const groups: { section: string; items: CommandItem[] }[] = [];
        const seen = new Set<string>();

        for (const item of filteredItems) {
            if (!seen.has(item.section)) {
                seen.add(item.section);
                groups.push({
                    section: item.section,
                    items: filteredItems.filter((i) => i.section === item.section),
                });
            }
        }
        return groups;
    }, [filteredItems]);

    // Execute item
    const executeItem = useCallback((item: CommandItem) => {
        setIsOpen(false);
        if (item.action) {
            try { item.action(); } catch { /* swallow action errors */ }
        } else if (item.path) {
            navigate(item.path);
        }
    }, [navigate]);

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const selected = filteredItems[highlightedIndex];
            if (selected) {
                executeItem(selected);
            }
        }
    };

    if (!isOpen) return null;

    let globalItemIndex = 0;

    return createPortal(
        <div
            className="command-palette-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) setIsOpen(false);
            }}
            aria-modal="true"
            role="dialog"
            aria-label={copy.paletteTitle}
        >
            <div className="command-palette-modal">
                <div className="command-palette-search-box">
                    <HiOutlineMagnifyingGlass className="command-palette-search-icon" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="command-palette-input"
                        placeholder={copy.searchPlaceholder}
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setHighlightedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {searchTerm && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            className="command-palette-clear-btn"
                            onClick={() => {
                                setSearchTerm('');
                                inputRef.current?.focus();
                            }}
                        >
                            <HiOutlineXMark />
                        </button>
                    )}
                    <kbd className="command-palette-kbd">ESC</kbd>
                </div>

                <div className="command-palette-results" ref={listRef}>
                    {filteredItems.length === 0 ? (
                        <div className="command-palette-empty">
                            <HiOutlineCommandLine className="command-palette-empty-icon" />
                            <p>{copy.noResults}</p>
                        </div>
                    ) : (
                        groupedItems.map((group) => (
                            <div key={group.section} className="command-palette-group">
                                <div className="command-palette-group-title">{group.section}</div>
                                <div className="command-palette-group-items">
                                    {group.items.map((item) => {
                                        const currentIndex = globalItemIndex++;
                                        const isHighlighted = currentIndex === highlightedIndex;
                                        const IconComponent = item.icon || HiOutlineCommandLine;

                                        return (
                                            <div
                                                key={item.id}
                                                className={`command-palette-item ${isHighlighted ? 'is-highlighted' : ''}`}
                                                onClick={() => executeItem(item)}
                                                onMouseEnter={() => setHighlightedIndex(currentIndex)}
                                                role="option"
                                                aria-selected={isHighlighted}
                                            >
                                                <div className="command-palette-item-icon">
                                                    <IconComponent />
                                                </div>
                                                <div className="command-palette-item-content">
                                                    <div className="command-palette-item-label">{item.label}</div>
                                                    {item.description && (
                                                        <div className="command-palette-item-desc">{item.description}</div>
                                                    )}
                                                </div>
                                                {isHighlighted && (
                                                    <div className="command-palette-item-enter">
                                                        <span>↵</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="command-palette-footer">
                    <span className="command-palette-hint">{copy.navigationHint}</span>
                    <span className="command-palette-badge">{copy.quickLaunchBadge}</span>
                </div>
            </div>
        </div>,
        document.body
    );
}
