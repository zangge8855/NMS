import React from 'react';
import { NavLink } from 'react-router-dom';
import { HiOutlineBars3 } from 'react-icons/hi2';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { getVisibleMobileNavItems } from './navConfig.js';

export default function MobileBottomNav({ onOpenMenu }) {
    const { user } = useAuth();
    const { locale } = useI18n();
    const { activeServerId } = useServer();
    const isAdmin = user?.role === 'admin';
    const isGlobalView = activeServerId === 'global';
    const items = getVisibleMobileNavItems({ isAdmin, isGlobalView, locale });
    const menuLabel = locale === 'en-US' ? 'Menu' : '菜单';

    if (items.length === 0) return null;

    return (
        <nav className="mobile-bottom-nav" aria-label={locale === 'en-US' ? 'Mobile navigation' : '移动导航'}>
            <div className="mobile-bottom-nav-track">
                {items.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path === '/'}
                        className={({ isActive }) => `mobile-bottom-nav-item${isActive ? ' active' : ''}`}
                    >
                        <span className="mobile-bottom-nav-icon"><item.icon /></span>
                        <span className="mobile-bottom-nav-label">{item.label}</span>
                    </NavLink>
                ))}
                <button
                    type="button"
                    className="mobile-bottom-nav-item mobile-bottom-nav-item--menu"
                    onClick={onOpenMenu}
                    aria-label={menuLabel}
                >
                    <span className="mobile-bottom-nav-icon"><HiOutlineBars3 /></span>
                    <span className="mobile-bottom-nav-label">{menuLabel}</span>
                </button>
            </div>
        </nav>
    );
}
