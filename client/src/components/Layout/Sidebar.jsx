import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';
import {
    HiOutlineCloud,
    HiOutlineServerStack,
    HiOutlineArrowRightOnRectangle,
    HiOutlineChevronLeft,
    HiOutlineChevronRight,
    HiOutlineShieldCheck,
    HiOutlineUserCircle,
} from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';
import { getVisibleFooterNavItems, getVisibleNavSections, navItems } from './navConfig.js';
import { buildSiteAssetPath } from '../../utils/sitePath.js';

function isUnsupportedPathInGlobal(pathname) {
    if (!pathname) return false;
    return navItems.some((item) => {
        if (item.supportsGlobal !== false) return false;
        return pathname === item.path || pathname.startsWith(`${item.path}/`);
    });
}

function clamp(value, min, max) {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

export default function Sidebar({ collapsed, open = false, isMobile = false, onClose, onToggle }) {
    const logoSrc = buildSiteAssetPath('/nms-logo.png');
    const { servers, activeServer, activeServerId, selectServer } = useServer();
    const { logout, user } = useAuth();
    const { locale, t } = useI18n();
    const { unreadCount } = useNotifications();
    const [showServerMenu, setShowServerMenu] = useState(false);
    const [serverSearch, setServerSearch] = useState('');
    const [navFlyout, setNavFlyout] = useState(null);
    const location = useLocation();
    const navigate = useNavigate();
    const serverSelectorRef = useRef(null);
    const serverDropdownRef = useRef(null);
    const serverTriggerRef = useRef(null);
    const navFlyoutRef = useRef(null);
    const navFlyoutAnchorRef = useRef(null);
    const isGlobalView = activeServerId === 'global';
    const isAdmin = user?.role === 'admin';
    const AccountIdentityIcon = isAdmin ? HiOutlineShieldCheck : HiOutlineUserCircle;
    const visibleSections = getVisibleNavSections({ isAdmin, isGlobalView, locale });
    const visibleFooterItems = getVisibleFooterNavItems({ isAdmin, isGlobalView, locale });

    navFlyoutAnchorRef.current = navFlyout?.anchorEl || null;

    useEffect(() => {
        setShowServerMenu(false);
        setServerSearch('');
        setNavFlyout(null);
        onClose?.();
    }, [location.pathname]);

    useEffect(() => {
        if (!collapsed || isMobile) {
            setNavFlyout(null);
        }
    }, [collapsed, isMobile]);

    useEffect(() => {
        if (!isGlobalView) return;
        if (isUnsupportedPathInGlobal(location.pathname)) {
            navigate('/', { replace: true });
        }
    }, [isGlobalView, location.pathname, navigate]);

    // Close server dropdown when clicking outside
    useEffect(() => {
        if (!showServerMenu) return;
        const handleClickOutside = (e) => {
            const clickedInsideSelector = serverSelectorRef.current?.contains(e.target);
            const clickedInsideDropdown = serverDropdownRef.current?.contains(e.target);
            if (!clickedInsideSelector && !clickedInsideDropdown) {
                setShowServerMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showServerMenu]);

    const computeServerDropdownPosition = useCallback(({ anchorRect, panelRect, viewport }) => {
        const viewportPadding = 12;
        const gap = 8;
        const desiredWidth = collapsed ? 280 : Math.max(anchorRect.width, 280);
        const width = Math.min(desiredWidth, viewport.width - (viewportPadding * 2));
        const left = collapsed
            ? clamp(anchorRect.right + gap, viewportPadding, viewport.width - width - viewportPadding)
            : clamp(anchorRect.left, viewportPadding, viewport.width - width - viewportPadding);

        const measuredHeight = panelRect.height || 320;
        const spaceBelow = viewport.height - anchorRect.bottom - viewportPadding - gap;
        const spaceAbove = anchorRect.top - viewportPadding - gap;
        const openUpward = spaceBelow < Math.min(280, measuredHeight) && spaceAbove > spaceBelow;
        const maxHeight = Math.max(160, openUpward ? spaceAbove : spaceBelow);
        const renderedHeight = Math.min(measuredHeight, maxHeight);
        const top = openUpward
            ? clamp(anchorRect.top - renderedHeight - gap, viewportPadding, viewport.height - renderedHeight - viewportPadding)
            : clamp(anchorRect.bottom + gap, viewportPadding, viewport.height - renderedHeight - viewportPadding);
        const originX = collapsed
            ? 22
            : clamp((anchorRect.left + (anchorRect.width / 2)) - left, 28, width - 28);

        return {
            top: `${top}px`,
            left: `${left}px`,
            width: `${width}px`,
            maxHeight: `${maxHeight}px`,
            transformOrigin: `${originX}px ${openUpward ? '100%' : '0%'}`,
        };
    }, [collapsed]);

    const { panelStyle: dropdownStyle, isReady: isServerDropdownReady } = useFloatingPanel({
        open: showServerMenu,
        anchorRef: serverTriggerRef,
        panelRef: serverDropdownRef,
        computePosition: computeServerDropdownPosition,
        deps: [serverSearch, servers.length],
    });

    const showNavFlyout = collapsed && !isMobile && !!navFlyout;

    const computeNavFlyoutPosition = useCallback(({ anchorRect, panelRect, viewport }) => {
        const viewportPadding = 12;
        const gap = 12;
        const panelWidth = Math.max(144, Math.min(220, panelRect.width || 160));
        const panelHeight = panelRect.height || 44;
        const left = clamp(anchorRect.right + gap, viewportPadding, viewport.width - panelWidth - viewportPadding);
        const top = clamp(
            anchorRect.top + (anchorRect.height / 2) - (panelHeight / 2),
            viewportPadding,
            viewport.height - panelHeight - viewportPadding
        );

        return {
            top: `${top}px`,
            left: `${left}px`,
            minWidth: `${panelWidth}px`,
        };
    }, []);

    const { panelStyle: navFlyoutStyle, isReady: isNavFlyoutReady } = useFloatingPanel({
        open: showNavFlyout,
        anchorRef: navFlyoutAnchorRef,
        panelRef: navFlyoutRef,
        computePosition: computeNavFlyoutPosition,
        deps: [navFlyout?.id],
    });

    const openNavFlyout = (id, label, target) => {
        if (!collapsed || isMobile || !target) return;
        setNavFlyout({ id, label, anchorEl: target });
    };

    const closeNavFlyout = (id) => {
        setNavFlyout((current) => (current?.id === id ? null : current));
    };

    const getNavFlyoutProps = (id, label) => (
        collapsed && !isMobile
            ? {
                onMouseEnter: (event) => openNavFlyout(id, label, event.currentTarget),
                onMouseLeave: () => closeNavFlyout(id),
                onFocus: (event) => openNavFlyout(id, label, event.currentTarget),
                onBlur: () => closeNavFlyout(id),
                title: label,
            }
            : {}
    );

    const serverMenu = showServerMenu && (servers.length > 0 || activeServerId === 'global') && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={serverDropdownRef}
                className={`server-dropdown-menu${isServerDropdownReady ? ' is-ready' : ''}`}
                style={dropdownStyle || undefined}
            >
                {servers.length >= 4 && (
                    <input
                        type="text"
                        className="server-search-input"
                        placeholder={t('shell.searchServersPlaceholder')}
                        value={serverSearch}
                        onChange={(e) => setServerSearch(e.target.value)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
                <div
                    onClick={() => { selectServer('global'); setShowServerMenu(false); setServerSearch(''); onClose?.(); }}
                    className={`server-dropdown-item ${activeServerId === 'global' ? 'active' : ''}`}
                >
                    <span className="server-dropdown-item-icon"><HiOutlineCloud /></span>
                    <div>
                        <div className="font-medium">{t('shell.scopeGlobalValue')}</div>
                    </div>
                </div>

                {servers
                    .filter((s) => {
                        if (!serverSearch.trim()) return true;
                        const q = serverSearch.trim().toLowerCase();
                        return (s.name || '').toLowerCase().includes(q) || (s.url || '').toLowerCase().includes(q);
                    })
                    .map((s) => (
                        <div
                            key={s.id}
                            onClick={() => { selectServer(s.id); setShowServerMenu(false); setServerSearch(''); onClose?.(); }}
                            className={`server-dropdown-item ${s.id === activeServerId ? 'active' : ''}`}
                        >
                            <span className="server-dropdown-item-dot" />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="font-medium">{s.name}</div>
                                <div className="text-muted text-xs">{s.url}</div>
                            </div>
                            <span className="server-health-dot" data-health={s.health || 'unknown'} />
                        </div>
                    ))}
            </div>,
            document.body
        )
        : null;

    const navFlyoutMenu = showNavFlyout && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={navFlyoutRef}
                className={`sidebar-nav-flyout${isNavFlyoutReady ? ' is-ready' : ''}`}
                style={navFlyoutStyle}
                role="tooltip"
            >
                {navFlyout.label}
            </div>,
            document.body
        )
        : null;

    return (
        <>
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${open ? 'open' : ''}`}>
            <div className="sidebar-logo">
                <div className="sidebar-logo-icon sidebar-logo-icon-custom">
                    <img src={logoSrc} alt="NMS" className="sidebar-logo-image" />
                </div>
                <div className="sidebar-logo-copy">
                    <span className="sidebar-logo-text sidebar-logo-text-gradient">NMS</span>
                    {t('shell.brandSubtitle') ? (
                        <span className="sidebar-logo-subtitle">{t('shell.brandSubtitle')}</span>
                    ) : null}
                </div>
            </div>

            <button
                type="button"
                className="sidebar-toggle"
                onClick={onToggle}
                aria-label={isMobile ? t('shell.collapseSidebar') : (collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar'))}
                aria-expanded={isMobile ? open : !collapsed}
            >
                {isMobile ? <HiOutlineChevronLeft /> : (collapsed ? <HiOutlineChevronRight /> : <HiOutlineChevronLeft />)}
            </button>

            <nav className="sidebar-nav">
                {visibleSections.map((section) => {
                    return (
                        <div className="nav-section" key={section.title}>
                            <div className="nav-section-title">{section.title}</div>
                            {section.items.map((item) => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    end={item.path === '/'}
                                    onClick={() => {
                                        closeNavFlyout(item.path);
                                        onClose?.();
                                    }}
                                    data-tooltip={item.label}
                                    {...getNavFlyoutProps(item.path, item.label)}
                                    className={({ isActive }) =>
                                        `nav-item ${isActive ? 'active' : ''}`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            {isActive && <div className="active-glow" />}
                                            <span className="nav-item-icon"><item.icon /></span>
                                            <span className="nav-label">{item.label}</span>
                                            {item.path === '/audit' && unreadCount > 0 && !collapsed && (
                                                <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                                            )}
                                        </>
                                    )}
                                </NavLink>
                            ))}
                        </div>
                    );
                })}
                <div className="nav-section nav-section-utility">
                    {user?.username ? (
                        <div className="sidebar-account-chip" title={user.username}>
                            <span className="sidebar-account-chip-icon" aria-hidden="true">
                                <AccountIdentityIcon />
                            </span>
                            <span className="sidebar-account-chip-copy">
                                <span className="sidebar-account-chip-name">{user.username}</span>
                            </span>
                        </div>
                    ) : null}
                    {visibleFooterItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => {
                                closeNavFlyout(item.path);
                                onClose?.();
                            }}
                            {...getNavFlyoutProps(item.path, item.label)}
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        >
                            {({ isActive }) => (
                                <>
                                    {isActive && <div className="active-glow" />}
                                    <span className="nav-item-icon"><item.icon /></span>
                                    <span className="nav-label">{item.label}</span>
                                </>
                            )}
                        </NavLink>
                    ))}
                    <button
                        type="button"
                        className="nav-item nav-item-button sidebar-logout"
                        onClick={() => {
                            closeNavFlyout('logout');
                            logout();
                            onClose?.();
                        }}
                        {...getNavFlyoutProps('logout', t('shell.logout'))}
                    >
                        <span className="nav-item-icon text-muted"><HiOutlineArrowRightOnRectangle /></span>
                        <span className="nav-label">{t('shell.logout')}</span>
                    </button>
                </div>
            </nav>
            {isAdmin && (
                <div className="server-selector" ref={serverSelectorRef}>
                {activeServerId === 'global' ? (
                    <button
                        ref={serverTriggerRef}
                        type="button"
                        className={`server-selector-btn ${showServerMenu ? 'active' : ''}`}
                        onClick={() => setShowServerMenu(!showServerMenu)}
                        aria-expanded={showServerMenu}
                    >
                        <span className="server-dot server-dot-lg"><HiOutlineCloud /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">{t('shell.scopeGlobalValue')}</div>
                        </div>
                        <HiOutlineChevronRight className={`server-chevron${showServerMenu ? ' open' : ''}`} />
                    </button>
                ) : activeServer ? (
                    <button
                        ref={serverTriggerRef}
                        type="button"
                        className={`server-selector-btn ${showServerMenu ? 'active' : ''}`}
                        onClick={() => setShowServerMenu(!showServerMenu)}
                        aria-expanded={showServerMenu}
                    >
                        <span className="server-dot server-dot-lg"><HiOutlineServerStack /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">{activeServer.name}</div>
                            <div className="server-addr text-muted">{activeServer.url}</div>
                        </div>
                        <HiOutlineChevronRight className={`server-chevron${showServerMenu ? ' open' : ''}`} />
                    </button>
                ) : (
                    <button ref={serverTriggerRef} type="button" className="server-selector-btn" onClick={() => setShowServerMenu(!showServerMenu)} aria-expanded={showServerMenu}>
                        <span className="server-dot server-dot-lg"><HiOutlineCloud /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">{t('shell.selectServer')}</div>
                        </div>
                        <HiOutlineChevronRight className={`server-chevron${showServerMenu ? ' open' : ''}`} />
                    </button>
                )}

                </div>
            )}
            {serverMenu}
        </aside>
        {navFlyoutMenu}
        </>
    );
}
