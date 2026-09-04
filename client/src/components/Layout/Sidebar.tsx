import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useServer } from '../../contexts/ServerContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/LanguageContext';
import useFloatingPanel, { type ComputePositionParams } from '../../hooks/useFloatingPanel';
import {
    HiOutlineArrowRightOnRectangle,
    HiOutlineChevronLeft,
    HiOutlineChevronRight,
} from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext';
import { getVisibleFooterNavItems, getVisibleNavSections } from './navConfig';
import { buildSiteAssetPath } from '../../utils/sitePath';

function clamp(value: number, min: number, max: number): number {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

export interface SidebarProps {
    collapsed: boolean;
    open?: boolean;
    isMobile?: boolean;
    onClose?: () => void;
    onToggle?: () => void;
}

interface NavFlyoutState {
    id: string;
    label: string;
    anchorEl: HTMLElement;
}

export default function Sidebar({ collapsed, open = false, isMobile = false, onClose, onToggle }: SidebarProps) {
    const logoSrc = buildSiteAssetPath('/nms-logo.png');
    const { activeServerId } = useServer();
    const { logout, user } = useAuth();
    const { locale, t } = useI18n();
    const { unreadCount } = useNotifications();
    const [navFlyout, setNavFlyout] = useState<NavFlyoutState | null>(null);
    const location = useLocation();
    const navFlyoutRef = useRef<HTMLDivElement | null>(null);
    const navFlyoutAnchorRef = useRef<HTMLElement | null>(null);
    const isGlobalView = activeServerId === 'global';
    const isAdmin = user?.role === 'admin';
    const role = user?.role || (isAdmin ? 'admin' : 'user');
    const visibleSections = getVisibleNavSections({ isAdmin, role, isGlobalView, locale });
    const visibleFooterItems = getVisibleFooterNavItems({ isAdmin, role, isGlobalView, locale });

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        setNavFlyout(null);
        onCloseRef.current?.();
    }, [location.pathname]);

    useEffect(() => {
        if (!collapsed || isMobile) {
            setNavFlyout(null);
        }
    }, [collapsed, isMobile]);

    const showNavFlyout = collapsed && !isMobile && !!navFlyout;

    const computeNavFlyoutPosition = useCallback(({ anchorRect, panelRect, viewport }: ComputePositionParams) => {
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

    const openNavFlyout = (id: string, label: string, target: HTMLElement) => {
        if (!collapsed || isMobile || !target) return;
        navFlyoutAnchorRef.current = target;
        setNavFlyout({ id, label, anchorEl: target });
    };

    const closeNavFlyout = (id: string) => {
        setNavFlyout((current) => (current?.id === id ? null : current));
    };

    const getNavFlyoutProps = (id: string, label: string) => (
        collapsed && !isMobile
            ? {
                onMouseEnter: (event: React.MouseEvent<HTMLElement>) => openNavFlyout(id, label, event.currentTarget),
                onMouseLeave: () => closeNavFlyout(id),
                onFocus: (event: React.FocusEvent<HTMLElement>) => openNavFlyout(id, label, event.currentTarget),
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

            <nav className="sidebar-nav" aria-label={t('shell.primaryNavigation')}>
                {visibleSections.map((section) => {
                    return (
                        <div className="nav-section" key={section.title}>
                            <div className="nav-section-title">{section.title}</div>
                            <div className="nav-section-items">
                                {section.items.map((item) => {
                                    return (
                                        <NavLink
                                            key={item.path}
                                            to={item.path}
                                            end={item.path === '/' || item.path === '/settings'}
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
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </nav>
            <div className="sidebar-utility">
                {user ? (
                    <NavLink
                        to="/account"
                        onClick={() => {
                            closeNavFlyout('/account');
                            onClose?.();
                        }}
                        {...getNavFlyoutProps('/account', user.username || user.email || (locale === 'en-US' ? 'Account' : '账户'))}
                        className={({ isActive }) => `nav-item sidebar-user-item ${isActive ? 'active' : ''}`}
                        aria-label={user.username || user.email || user.role}
                    >
                        {({ isActive }) => (
                            <>
                                {isActive && <div className="active-glow" />}
                                <span className="sidebar-user-avatar">
                                    {String(user.username || user.email || 'N').trim().charAt(0).toUpperCase()}
                                </span>
                                {!collapsed && (
                                    <span className="nav-label sidebar-user-info">
                                        <span className="sidebar-user-name">{user.username || user.email || 'NMS'}</span>
                                        <span className="sidebar-user-badge">
                                            {role === 'admin'
                                                ? (locale === 'en-US' ? 'Admin' : '管理员')
                                                : role === 'operator'
                                                ? (locale === 'en-US' ? 'Operator' : '运维员')
                                                : role === 'auditor'
                                                ? (locale === 'en-US' ? 'Auditor' : '审计员')
                                                : (locale === 'en-US' ? 'User' : '用户')}
                                        </span>
                                    </span>
                                )}
                            </>
                        )}
                    </NavLink>
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
                    <span className="nav-item-icon"><HiOutlineArrowRightOnRectangle /></span>
                    <span className="nav-label">{t('shell.logout')}</span>
                </button>
            </div>
        </aside>
        {navFlyoutMenu}
        </>
    );
}
