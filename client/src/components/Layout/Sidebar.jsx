import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Badge } from 'antd';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { HiOutlineArrowRightOnRectangle } from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';
import { getVisibleNavSections, navItems } from './navConfig.js';
import { buildSiteAssetPath } from '../../utils/sitePath.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';

const { Sider } = Layout;

function isUnsupportedPathInGlobal(pathname) {
    if (!pathname) return false;
    return navItems.some((item) => {
        if (item.supportsGlobal !== false) return false;
        return pathname === item.path || pathname.startsWith(`${item.path}/`);
    });
}

export default function Sidebar({ collapsed, open = false, isMobile = false, onClose, onToggle }) {
    const logoSrc = buildSiteAssetPath('/nms-logo.png');
    const { activeServerId } = useServer();
    const { logout, user } = useAuth();
    const { locale, t } = useI18n();
    const { unreadCount } = useNotifications();
    const location = useLocation();
    const navigate = useNavigate();
    
    const isGlobalView = activeServerId === 'global';
    const isAdmin = user?.role === 'admin';
    const visibleSections = getVisibleNavSections({ isAdmin, isGlobalView, locale });

    useEffect(() => {
        if (!isGlobalView) return;
        if (isUnsupportedPathInGlobal(location.pathname)) {
            navigate('/', { replace: true });
        }
    }, [isGlobalView, location.pathname, navigate]);

    // Construct Menu Items
    const menuItems = visibleSections.flatMap((section) => [
        {
            type: 'group',
            label: section.title,
            children: section.items.map((item) => ({
                key: item.path,
                icon: React.createElement(item.icon, { style: { fontSize: 18 } }),
                label: (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span>{item.label}</span>
                        {item.path === '/audit' && unreadCount > 0 && (
                            <Badge count={unreadCount} overflowCount={99} size="small" />
                        )}
                    </div>
                ),
            })),
        },
    ]);

    menuItems.push({ type: 'divider' });
    menuItems.push({
        key: 'logout',
        icon: <HiOutlineArrowRightOnRectangle style={{ fontSize: 18, color: 'var(--text-muted)' }} />,
        label: t('shell.logout'),
    });

    const handleMenuClick = ({ key }) => {
        if (key === 'logout') {
            logout();
        } else {
            navigate(key);
        }
        if (isMobile) {
            onClose?.();
        }
    };

    // Find the currently selected key (handle exact match or sub-paths)
    let selectedKey = location.pathname;
    const match = navItems.find(item => item.path !== '/' && location.pathname.startsWith(`${item.path}/`));
    if (match) {
        selectedKey = match.path;
    }

    const siderStyle = isMobile ? {
        position: 'fixed',
        height: '100vh',
        zIndex: 999,
        left: open ? 0 : '-100%',
        transition: 'all 0.3s',
        boxShadow: open ? '2px 0 8px rgba(0,0,0,0.5)' : 'none'
    } : {
        height: '100vh',
        position: 'sticky',
        top: 0,
        left: 0,
        zIndex: 100,
        borderRight: '1px solid var(--border-color)',
        boxShadow: '1px 0 0 rgba(255, 255, 255, 0.02)'
    };

    return (
        <Sider
            trigger={null}
            collapsible
            collapsed={isMobile ? false : collapsed}
            width={240}
            collapsedWidth={80}
            style={siderStyle}
            theme="dark"
        >
            <div 
                style={{ 
                    height: 70, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                    padding: collapsed && !isMobile ? '0' : '0 20px',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'rgba(255, 255, 255, 0.01)',
                    overflow: 'hidden'
                }}
            >
                <div style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={logoSrc} alt="NMS" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                {(!collapsed || isMobile) && (
                    <div style={{ marginLeft: 12, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', color: '#fff' }}>NMS</span>
                        {t('shell.brandSubtitle') && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: -2 }}>{t('shell.brandSubtitle')}</span>
                        )}
                    </div>
                )}
            </div>
            <Menu
                theme="dark"
                mode="inline"
                selectedKeys={[selectedKey]}
                onClick={handleMenuClick}
                items={menuItems}
                style={{
                    borderRight: 0,
                    background: 'transparent',
                    padding: '12px 8px'
                }}
            />
        </Sider>
    );
}
