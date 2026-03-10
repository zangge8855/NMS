import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { HiOutlineSignal, HiOutlineSun, HiOutlineMoon, HiOutlineComputerDesktop, HiOutlineCloud, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import NotificationBell from './NotificationBell.jsx';
import { getSearchableNavItems } from './navConfig.js';

const themeIcons = {
    dark: HiOutlineMoon,
    light: HiOutlineSun,
    auto: HiOutlineComputerDesktop,
};

const themeLabels = {
    dark: '深色模式',
    light: '浅色模式',
    auto: '跟随系统',
};

const MAX_SEARCH_RESULTS = 8;

function normalizeKeyword(value) {
    return String(value || '').trim().toLowerCase();
}

function getShortcutLabel() {
    if (typeof navigator === 'undefined') return 'Ctrl K';
    return /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';
}

export default function Header({ title, subtitle = '', icon, children }) {
    const { activeServer, activeServerId } = useServer();
    const { mode, cycleTheme } = useTheme();
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const searchRef = useRef(null);
    const inputRef = useRef(null);

    const ThemeIcon = themeIcons[mode] || HiOutlineMoon;
    const isAdmin = user?.role === 'admin';
    const isGlobalView = activeServerId === 'global';
    const shortcutLabel = useMemo(() => getShortcutLabel(), []);

    const scopeLabel = activeServer
        ? { icon: HiOutlineSignal, title: '单节点', value: activeServer.name }
        : activeServerId === 'global'
            ? { icon: HiOutlineCloud, title: '控制域', value: '集群总览' }
            : null;

    const ScopeIcon = scopeLabel?.icon;
    const searchableItems = useMemo(
        () => getSearchableNavItems({ isAdmin, isGlobalView }),
        [isAdmin, isGlobalView]
    );

    const filteredItems = useMemo(() => {
        const query = normalizeKeyword(searchTerm);
        if (!query) return searchableItems.slice(0, MAX_SEARCH_RESULTS);

        return searchableItems
            .map((item) => {
                const label = normalizeKeyword(item.label);
                const section = normalizeKeyword(item.section);
                const keywords = Array.isArray(item.keywords) ? item.keywords.map(normalizeKeyword) : [];
                const haystack = [label, section, item.path, ...keywords].join(' ');
                if (!haystack.includes(query)) return null;

                let score = 0;
                if (label.startsWith(query)) score += 5;
                if (keywords.some((keyword) => keyword.startsWith(query))) score += 3;
                if (section.includes(query)) score += 1;
                return { ...item, score };
            })
            .filter(Boolean)
            .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label, 'zh-CN'))
            .slice(0, MAX_SEARCH_RESULTS);
    }, [searchTerm, searchableItems]);

    useEffect(() => {
        setSearchOpen(false);
        setSearchTerm('');
        setHighlightedIndex(0);
    }, [location.pathname]);

    useEffect(() => {
        if (!searchOpen) return undefined;
        const handleClickOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
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
        if (location.pathname !== item.path) {
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

    return (
        <header className="header">
            <div className="header-left">
                {icon && <span className="header-icon">{icon}</span>}
                <div className="header-title-group">
                    <h1 className="header-title">{title}</h1>
                    {subtitle && <div className="header-subtitle">{subtitle}</div>}
                </div>
            </div>
            <div className="header-actions">
                <div
                    className={`header-search${searchOpen ? ' is-open' : ''}`}
                    ref={searchRef}
                    onClick={openSearch}
                >
                    <HiOutlineMagnifyingGlass className="header-search-icon" />
                    <input
                        ref={inputRef}
                        placeholder="搜索页面..."
                        className="header-search-input"
                        value={searchTerm}
                        onChange={(event) => {
                            setSearchTerm(event.target.value);
                            setSearchOpen(true);
                        }}
                        onFocus={() => setSearchOpen(true)}
                        onKeyDown={handleSearchKeyDown}
                        aria-label="全局页面搜索"
                    />
                    <kbd className="header-search-kbd">{shortcutLabel}</kbd>
                    {searchOpen && (
                        <div className="header-search-results">
                            {filteredItems.length === 0 ? (
                                <div className="header-search-empty">
                                    没有匹配页面
                                </div>
                            ) : (
                                filteredItems.map((item, index) => {
                                    const ItemIcon = item.icon;
                                    const isHighlighted = index === highlightedIndex;
                                    return (
                                        <button
                                            key={item.path}
                                            type="button"
                                            className={`header-search-item${isHighlighted ? ' active' : ''}`}
                                            onMouseEnter={() => setHighlightedIndex(index)}
                                            onClick={() => handleSelect(item)}
                                        >
                                            <span className="header-search-item-icon">
                                                <ItemIcon />
                                            </span>
                                            <span className="header-search-item-copy">
                                                <span className="header-search-item-label">{item.label}</span>
                                                <span className="header-search-item-meta">{item.section}</span>
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
                {scopeLabel && (
                    <div className="header-context">
                        <span className="system-health-dot" data-status="healthy" />
                        {ScopeIcon && <ScopeIcon style={{ fontSize: '14px' }} />}
                        <div className="header-context-copy">
                            <span className="header-context-label">{scopeLabel.title}</span>
                            <strong>{scopeLabel.value}</strong>
                        </div>
                    </div>
                )}
                {children}
                <NotificationBell />
                <button
                    type="button"
                    className="theme-toggle-btn"
                    onClick={cycleTheme}
                    title={themeLabels[mode]}
                    aria-label={themeLabels[mode]}
                >
                    <ThemeIcon />
                    <span className="theme-label">{themeLabels[mode]}</span>
                </button>
            </div>
        </header>
    );
}
