import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import useFloatingPanel from '../../hooks/useFloatingPanel.js';
import {
    HiOutlineArrowRightOnRectangle,
    HiOutlineChevronLeft,
    HiOutlineChevronRight,
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
    const { activeServerId } = useServer();
    const { logout, user } = useAuth();
    const { locale, t } = useI18n();
    const { unreadCount } = useNotifications();
    const [navFlyout, setNavFlyout] = useState(null);
    const location = useLocation();
    const navigate = useNavigate();
    const navFlyoutRef = useRef(null);
    const navFlyoutAnchorRef = useRef(null);
    const isGlobalView = activeServerId === 'global';
    const isAdmin = user?.role === 'admin';
    const visibleSections = getVisibleNavSections({ isAdmin, isGlobalView, locale });
    const visibleFooterItems = getVisibleFooterNavItems({ isAdmin, isGlobalView, locale });

    navFlyoutAnchorRef.current = navFlyout?.anchorEl || null;

    useEffect(() => {
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
        </aside>
        {navFlyoutMenu}
        </>
    );
}
