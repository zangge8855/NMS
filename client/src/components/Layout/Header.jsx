import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import {
    HiOutlineSun,
    HiOutlineMoon,
    HiOutlineComputerDesktop,
    HiOutlineMagnifyingGlass,
    HiOutlineArrowPath,
    HiOutlinePlusCircle,
    HiOutlineServerStack,
    HiOutlineUsers,
} from 'react-icons/hi2';
import NotificationBell from './NotificationBell.jsx';
import { getNavItemForPath, getSearchableNavItems } from './navConfig.js';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';
import { getManagedUsersSnapshotMeta } from '../../utils/managedUsersCache.js';
import { SESSION_SNAPSHOT_EVENT } from '../../utils/sessionSnapshot.js';

const themeIcons = {
    dark: HiOutlineMoon,
    light: HiOutlineSun,
    auto: HiOutlineComputerDesktop,
};

const MAX_SEARCH_RESULTS = 10;
const MANAGED_USERS_SNAPSHOT_KEY = 'managed_users_v1';

function normalizeKeyword(value) {
    return String(value || '').trim().toLowerCase();
}

function getShortcutLabel() {
    if (typeof navigator === 'undefined') return 'Ctrl K';
    return /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';
}

function clamp(value, min, max) {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

function isEditableShortcutTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.closest('[contenteditable="true"]')) return true;
    const tagName = String(target.tagName || '').toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable === true;
}

function buildCommandCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            actions: 'Actions',
            pages: 'Pages',
            users: 'Users',
            servers: 'Servers',
            refresh: 'Refresh current view',
            refreshMeta: 'Reload live data for this page',
            createUser: 'Create user',
            createUserMeta: 'Open the user creation form',
            createServer: 'Add server',
            createServerMeta: 'Register a new node',
            serverMeta: 'Node detail',
            userMeta: 'User detail',
        };
    }
    return {
        actions: '快捷操作',
        pages: '页面',
        users: '用户',
        servers: '服务器',
        refresh: '刷新当前页',
        refreshMeta: '重新拉取当前页面数据',
        createUser: '添加账号',
        createUserMeta: '打开用户创建表单',
        createServer: '添加服务器',
        createServerMeta: '接入新的 3x-ui 节点',
        serverMeta: '节点详情',
        userMeta: '用户详情',
    };
}

function createRefreshCommand(copy, pathname) {
    return {
        kind: 'command',
        id: 'refresh-current-view',
        label: copy.refresh,
        section: copy.actions,
        description: copy.refreshMeta,
        icon: HiOutlineArrowPath,
        keywords: ['refresh', 'reload', 'sync', '刷新', '重载', '同步'],
        action: () => {
            const event = new CustomEvent('nms:page-refresh', {
                cancelable: true,
                detail: { path: pathname },
            });
            const shouldFallback = window.dispatchEvent(event);
            if (shouldFallback) {
                window.location.reload();
            }
        },
    };
}

export default function Header({
    title,
    eyebrow: _eyebrow = '',
    subtitle = '',
    icon,
    children,
    showSubtitle = false,
    allowTitleWrap = false,
}) {
    const { activeServerId, servers = [] } = useServer();
    const { mode, cycleTheme } = useTheme();
    const { user } = useAuth();
    const { locale, toggleLocale, t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const searchRef = useRef(null);
    const inputRef = useRef(null);
    const searchResultsRef = useRef(null);
    const searchResultsId = useId();
    const [managedUsers, setManagedUsers] = useState(() => getManagedUsersSnapshotMeta().users);

    const ThemeIcon = themeIcons[mode] || HiOutlineMoon;
    const isAdmin = user?.role === 'admin';
    const isGlobalView = activeServerId === 'global';
    const shortcutLabel = useMemo(() => getShortcutLabel(), []);
    const matchedNavItem = useMemo(() => getNavItemForPath(location.pathname), [location.pathname]);
    const MatchedNavIcon = matchedNavItem?.icon || null;
    const resolvedHeaderIcon = MatchedNavIcon ? <MatchedNavIcon /> : icon;
    const themeLabels = useMemo(() => ({
        dark: t('shell.themeDark'),
        light: t('shell.themeLight'),
        auto: t('shell.themeAuto'),
    }), [t]);

    const searchableItems = useMemo(
        () => {
            const copy = buildCommandCopy(locale);
            const navItems = getSearchableNavItems({ isAdmin, isGlobalView, locale }).map((item) => ({
                ...item,
                kind: 'page',
                id: item.path,
                section: item.section || copy.pages,
                description: item.section || copy.pages,
            }));

            if (!isAdmin) {
                return navItems;
            }

            const commandItems = [
                createRefreshCommand(copy, location.pathname),
                {
                    kind: 'command',
                    id: 'create-user',
                    label: copy.createUser,
                    section: copy.actions,
                    description: copy.createUserMeta,
                    icon: HiOutlinePlusCircle,
                    path: '/clients?action=create',
                    keywords: ['create', 'add', 'user', 'client', '新增', '添加', '账号', '用户'],
                },
                {
                    kind: 'command',
                    id: 'create-server',
                    label: copy.createServer,
                    section: copy.actions,
                    description: copy.createServerMeta,
                    icon: HiOutlinePlusCircle,
                    path: '/servers?action=create',
                    keywords: ['create', 'add', 'server', 'node', '新增', '添加', '服务器', '节点'],
                },
            ];

            const serverItems = (Array.isArray(servers) ? servers : [])
                .map((server) => {
                    const serverId = String(server?.id || '').trim();
                    if (!serverId) return null;
                    const label = String(server?.name || server?.url || serverId).trim();
                    return {
                        kind: 'server',
                        id: serverId,
                        label,
                        section: copy.servers,
                        description: String(server?.url || server?.group || copy.serverMeta).trim(),
                        icon: HiOutlineServerStack,
                        path: `/servers/${encodeURIComponent(serverId)}`,
                        keywords: [
                            serverId,
                            server?.name,
                            server?.url,
                            server?.group,
                            ...(Array.isArray(server?.tags) ? server.tags : []),
                            'server',
                            'node',
                            '服务器',
                            '节点',
                        ],
                    };
                })
                .filter(Boolean);

            const userItems = (Array.isArray(managedUsers) ? managedUsers : [])
                .map((managedUser) => {
                    const userId = String(managedUser?.id || '').trim();
                    if (!userId) return null;
                    const label = String(managedUser?.username || managedUser?.email || managedUser?.subscriptionEmail || userId).trim();
                    return {
                        kind: 'user',
                        id: userId,
                        label,
                        section: copy.users,
                        description: String(managedUser?.email || managedUser?.subscriptionEmail || copy.userMeta).trim(),
                        icon: HiOutlineUsers,
                        path: `/clients/${encodeURIComponent(userId)}`,
                        keywords: [
                            userId,
                            managedUser?.username,
                            managedUser?.email,
                            managedUser?.subscriptionEmail,
                            managedUser?.enabled === false ? 'disabled 停用' : 'enabled 启用',
                            'user',
                            'client',
                            'account',
                            '用户',
                            '账号',
                            '客户端',
                        ],
                    };
                })
                .filter(Boolean);

            return [...commandItems, ...navItems, ...serverItems, ...userItems];
        },
        [isAdmin, isGlobalView, locale, location.pathname, managedUsers, servers]
    );

    const filteredItems = useMemo(() => {
        const query = normalizeKeyword(searchTerm);
        if (!query) return searchableItems.slice(0, MAX_SEARCH_RESULTS);

        return searchableItems
            .map((item) => {
                const label = normalizeKeyword(item.label);
                const section = normalizeKeyword(item.section);
                const description = normalizeKeyword(item.description);
                const keywords = Array.isArray(item.keywords) ? item.keywords.map(normalizeKeyword) : [];
                const haystack = [label, section, description, item.path, ...keywords].join(' ');
                if (!haystack.includes(query)) return null;

                let score = 0;
                if (label.startsWith(query)) score += 5;
                if (keywords.some((keyword) => keyword.startsWith(query))) score += 3;
                if (description.includes(query)) score += 2;
                if (section.includes(query)) score += 1;
                return { ...item, score };
            })
            .filter(Boolean)
            .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label, locale))
            .slice(0, MAX_SEARCH_RESULTS);
    }, [searchTerm, searchableItems]);

    useEffect(() => {
        setSearchOpen(false);
        setSearchTerm('');
        setHighlightedIndex(0);
    }, [location.pathname]);

    useEffect(() => {
        const syncManagedUsers = () => {
            setManagedUsers(getManagedUsersSnapshotMeta().users);
        };
        const handleSnapshotUpdate = (event) => {
            if (event?.detail?.key === MANAGED_USERS_SNAPSHOT_KEY) {
                syncManagedUsers();
            }
        };
        window.addEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotUpdate);
        window.addEventListener('focus', syncManagedUsers);
        return () => {
            window.removeEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotUpdate);
            window.removeEventListener('focus', syncManagedUsers);
        };
    }, []);

    useEffect(() => {
        if (!searchOpen) return undefined;
        const handleClickOutside = (event) => {
            const clickedInsideSearch = searchRef.current?.contains(event.target);
            const clickedInsideResults = searchResultsRef.current?.contains(event.target);
            if (!clickedInsideSearch && !clickedInsideResults) {
                setSearchOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [searchOpen]);

    useEffect(() => {
        const handleGlobalShortcut = (event) => {
            const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
            if (!isShortcut) return;
            if (isEditableShortcutTarget(event.target)) return;
            event.preventDefault();
            setSearchOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
        };
        document.addEventListener('keydown', handleGlobalShortcut);
        return () => document.removeEventListener('keydown', handleGlobalShortcut);
    }, []);

    useEffect(() => {
        setHighlightedIndex(0);
    }, [searchTerm, searchOpen]);

    const openSearch = () => {
        setSearchOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const handleSelect = (item) => {
        setSearchOpen(false);
        setSearchTerm('');
        setHighlightedIndex(0);
        if (typeof item.action === 'function') {
            item.action();
            return;
        }
        if (item.path && `${location.pathname}${location.search}` !== item.path) {
            navigate(item.path);
        }
    };

    const handleSearchKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSearchOpen(true);
            setHighlightedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSearchOpen(true);
            setHighlightedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length));
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (filteredItems[highlightedIndex]) {
                handleSelect(filteredItems[highlightedIndex]);
            }
            return;
        }
        if (event.key === 'Escape') {
            setSearchOpen(false);
            setSearchTerm('');
            inputRef.current?.blur();
        }
    };

    const computeSearchResultsPosition = useCallback(({ anchorRect, panelRect, viewport }) => {
        const viewportPadding = 12;
        const gap = 10;
        const width = Math.min(
            Math.max(anchorRect.width + 48, 320),
            Math.min(420, viewport.width - (viewportPadding * 2))
        );
        const left = clamp(anchorRect.right - width, viewportPadding, viewport.width - width - viewportPadding);
        const spaceBelow = viewport.height - anchorRect.bottom - viewportPadding - gap;
        const spaceAbove = anchorRect.top - viewportPadding - gap;
        const measuredHeight = panelRect.height || 280;
        const openUpward = spaceBelow < Math.min(220, measuredHeight) && spaceAbove > spaceBelow;
        const maxHeight = Math.max(180, openUpward ? spaceAbove : spaceBelow);
        const renderedHeight = Math.min(measuredHeight, maxHeight);
        const top = openUpward
            ? clamp(anchorRect.top - renderedHeight - gap, viewportPadding, viewport.height - renderedHeight - viewportPadding)
            : clamp(anchorRect.bottom + gap, viewportPadding, viewport.height - renderedHeight - viewportPadding);
        const originX = clamp(anchorRect.right - left - 18, 24, width - 24);

        return {
            top: `${top}px`,
            left: `${left}px`,
            width: `${width}px`,
            maxHeight: `${maxHeight}px`,
            transformOrigin: `${originX}px ${openUpward ? '100%' : '0%'}`,
        };
    }, []);

    const { panelStyle: searchResultsStyle, isReady: isSearchResultsReady } = useFloatingPanel({
        open: searchOpen,
        anchorRef: searchRef,
        panelRef: searchResultsRef,
        computePosition: computeSearchResultsPosition,
        deps: [filteredItems.length, searchTerm],
    });

    const searchResults = searchOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={searchResultsRef}
                className={`header-search-results${isSearchResultsReady ? ' is-ready' : ''}`}
                id={searchResultsId}
                role="listbox"
                style={searchResultsStyle}
            >
                {filteredItems.length === 0 ? (
                    <div className="header-search-empty">
                        {t('shell.searchEmpty')}
                    </div>
                ) : (
                    filteredItems.map((item, index) => {
                        const ItemIcon = item.icon;
                        const isHighlighted = index === highlightedIndex;
                        return (
                            <button
                                key={`${item.kind || 'item'}:${item.id || item.path || item.label}`}
                                id={`${searchResultsId}-${index}`}
                                type="button"
                                className={`header-search-item${isHighlighted ? ' active' : ''}`}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onClick={() => handleSelect(item)}
                                role="option"
                                aria-selected={isHighlighted}
                            >
                                <span className="header-search-item-icon">
                                    <ItemIcon />
                                </span>
                                <span className="header-search-item-copy">
                                    <span className="header-search-item-label">{item.label}</span>
                                    <span className="header-search-item-meta">{item.description || item.section}</span>
                                </span>
                                <span className="header-search-item-kind">{item.section}</span>
                            </button>
                        );
                    })
                )}
            </div>,
            document.body
        )
        : null;

    return (
        <>
        <header className="header">
            <div className="header-shell">
                <div className="header-left">
                    {resolvedHeaderIcon && <span className="header-icon">{resolvedHeaderIcon}</span>}
                    <div className="header-title-group">
                        <h1 className={`header-title${allowTitleWrap ? ' header-title--wrap' : ''}`}>{title}</h1>
                        {showSubtitle && subtitle ? <p className="header-subtitle">{subtitle}</p> : null}
                    </div>
                </div>
                <div className="header-actions">
                    <div
                        className={`header-search${searchOpen ? ' is-open' : ''}`}
                        data-open={searchOpen ? 'true' : 'false'}
                        ref={searchRef}
                        onClick={openSearch}
                        role="combobox"
                        aria-expanded={searchOpen}
                        aria-haspopup="listbox"
                        aria-controls={searchResultsId}
                    >
                        <HiOutlineMagnifyingGlass className="header-search-icon" />
                        <input
                            ref={inputRef}
                            placeholder={t('shell.searchPlaceholder')}
                            className="header-search-input"
                            value={searchTerm}
                            onChange={(event) => {
                                setSearchTerm(event.target.value);
                                setSearchOpen(true);
                            }}
                            onFocus={() => setSearchOpen(true)}
                            onKeyDown={handleSearchKeyDown}
                            aria-label={t('shell.searchAriaLabel')}
                            aria-autocomplete="list"
                            aria-controls={searchResultsId}
                            aria-activedescendant={searchOpen && filteredItems[highlightedIndex] ? `${searchResultsId}-${highlightedIndex}` : undefined}
                        />
                        <kbd className="header-search-kbd">{shortcutLabel}</kbd>
                    </div>
                    {children ? <div className="header-primary-actions">{children}</div> : null}
                    <div className="header-controls">
                        <button
                            type="button"
                            className="theme-toggle-btn language-toggle-btn"
                            onClick={toggleLocale}
                            title={t('shell.switchLanguage')}
                            aria-label={t('shell.switchLanguage')}
                        >
                            <span className="language-toggle-label">{t('shell.langLabel')}</span>
                        </button>
                        {isAdmin ? <NotificationBell /> : null}
                        <button
                            type="button"
                            className="theme-toggle-btn"
                            onClick={cycleTheme}
                            title={themeLabels[mode]}
                            aria-label={themeLabels[mode]}
                        >
                            <ThemeIcon />
                        </button>
                    </div>
                </div>
            </div>
        </header>
        {searchResults}
        </>
    );
}
