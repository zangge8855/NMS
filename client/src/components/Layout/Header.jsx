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
} from 'react-icons/hi2';
import NotificationBell from './NotificationBell.jsx';
import { getNavItemForPath, getSearchableNavItems } from './navConfig.js';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';

const themeIcons = {
    dark: HiOutlineMoon,
    light: HiOutlineSun,
    auto: HiOutlineComputerDesktop,
};

const MAX_SEARCH_RESULTS = 8;

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

export default function Header({
    title,
    eyebrow: _eyebrow = '',
    subtitle = '',
    icon,
    children,
    showSubtitle = false,
    allowTitleWrap = false,
}) {
    const { activeServerId } = useServer();
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
        () => getSearchableNavItems({ isAdmin, isGlobalView, locale }),
        [isAdmin, isGlobalView, locale]
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
            .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label, locale))
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
                                key={item.path}
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
                                    <span className="header-search-item-meta">{item.section}</span>
                                </span>
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
                        <NotificationBell />
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
