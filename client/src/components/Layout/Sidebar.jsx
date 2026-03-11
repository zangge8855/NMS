import React, { useEffect, useState, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import {
    HiOutlineCloud,
    HiOutlineServerStack,
    HiOutlineArrowRightOnRectangle,
    HiOutlineChevronLeft,
    HiOutlineChevronRight,
} from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';
import { getVisibleFooterNavItems, getVisibleNavSections, navItems } from './navConfig.js';

function isUnsupportedPathInGlobal(pathname) {
    if (!pathname) return false;
    return navItems.some((item) => {
        if (item.supportsGlobal !== false) return false;
        return pathname === item.path || pathname.startsWith(`${item.path}/`);
    });
}

export default function Sidebar({ collapsed, open = false, onClose, onToggle }) {
    const { servers, activeServer, activeServerId, selectServer } = useServer();
    const { logout, user } = useAuth();
    const { locale, t } = useI18n();
    const { unreadCount } = useNotifications();
    const [showServerMenu, setShowServerMenu] = useState(false);
    const [serverSearch, setServerSearch] = useState('');
    const location = useLocation();
    const navigate = useNavigate();
    const serverSelectorRef = useRef(null);
    const isGlobalView = activeServerId === 'global';
    const isAdmin = user?.role === 'admin';
    const visibleSections = getVisibleNavSections({ isAdmin, isGlobalView, locale });
    const visibleFooterItems = getVisibleFooterNavItems({ isAdmin, isGlobalView, locale });

    useEffect(() => {
        setShowServerMenu(false);
        setServerSearch('');
        onClose?.();
    }, [location.pathname]);

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
            if (serverSelectorRef.current && !serverSelectorRef.current.contains(e.target)) {
                setShowServerMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showServerMenu]);

    return (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${open ? 'open' : ''} `}>
            <div className="sidebar-logo">
                <div className="sidebar-logo-icon sidebar-logo-icon-custom">
                    <img src="/nms-logo.png" alt="NMS" className="sidebar-logo-image" />
                </div>
                <div className="sidebar-logo-copy">
                    <span className="sidebar-logo-text sidebar-logo-text-gradient">NMS</span>
                    <span className="sidebar-logo-subtitle">{t('shell.brandSubtitle')}</span>
                </div>
            </div>

            <button
                className="sidebar-toggle"
                onClick={onToggle}
                aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
            >
                {collapsed ? <HiOutlineChevronRight /> : <HiOutlineChevronLeft />}
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
                                    onClick={onClose}
                                    data-tooltip={item.label}
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

                <div className="nav-section nav-section-footer" style={{ marginTop: 'auto' }}>
                    <div className="nav-section-title">{isAdmin ? t('nav.system') : t('nav.account')}</div>
                    {visibleFooterItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={onClose}
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
                        onClick={() => { logout(); onClose?.(); }}
                    >
                        <span className="nav-item-icon text-muted"><HiOutlineArrowRightOnRectangle /></span>
                        <span className="nav-label">{t('shell.logout')}</span>
                    </button>
                </div>
            </nav>

            <div className="sidebar-user">
                <div className="sidebar-user-avatar">{user?.username?.[0]?.toUpperCase() || 'U'}</div>
                <div className="sidebar-user-info">
                    <div className="sidebar-user-name">{user?.username || t('shell.roleUser')}</div>
                    <div className="sidebar-user-role">{isAdmin ? t('shell.roleAdmin') : t('shell.roleUser')}</div>
                </div>
            </div>

            {isAdmin && (
                <div className="server-selector" ref={serverSelectorRef}>
                {activeServerId === 'global' ? (
                    <button
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
                    <button type="button" className="server-selector-btn" onClick={() => setShowServerMenu(!showServerMenu)} aria-expanded={showServerMenu}>
                        <span className="server-dot server-dot-lg"><HiOutlineCloud /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">{t('shell.selectServer')}</div>
                        </div>
                        <HiOutlineChevronRight className={`server-chevron${showServerMenu ? ' open' : ''}`} />
                    </button>
                )}

                {showServerMenu && (servers.length > 0 || activeServerId === 'global') && (
                    <div className="server-dropdown-menu">
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
                            .filter(s => {
                                if (!serverSearch.trim()) return true;
                                const q = serverSearch.trim().toLowerCase();
                                return (s.name || '').toLowerCase().includes(q) || (s.url || '').toLowerCase().includes(q);
                            })
                            .map(s => (
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
                    </div>
                )}
                </div>
            )}
        </aside>
    );
}
