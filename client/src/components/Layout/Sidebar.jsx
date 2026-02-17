import React, { useEffect, useState, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
    HiOutlineChartBarSquare,
    HiOutlineCloud,
    HiOutlineServerStack,
    HiOutlineUsers,
    HiOutlineCog6Tooth,
    HiOutlineWrenchScrewdriver,
    HiOutlineLink,
    HiOutlineArrowRightOnRectangle,
    HiOutlineChevronLeft,
    HiOutlineChevronRight,
    HiOutlineSignal,
    HiOutlineShieldCheck,
} from 'react-icons/hi2';

const navItems = [
    { path: '/', icon: HiOutlineChartBarSquare, label: '仪表盘', supportsGlobal: true },
    { path: '/inbounds', icon: HiOutlineSignal, label: '入站管理', supportsGlobal: true },
    { path: '/clients', icon: HiOutlineUsers, label: '用户管理', supportsGlobal: true },
    { path: '/subscriptions', icon: HiOutlineLink, label: '订阅中心', supportsGlobal: true, userOnly: true },
    { path: '/audit', icon: HiOutlineShieldCheck, label: '审计中心', supportsGlobal: true },
    { path: '/settings', icon: HiOutlineCog6Tooth, label: '系统设置', supportsGlobal: true, adminOnly: true },
    { path: '/capabilities', icon: HiOutlineSignal, label: '系统能力', supportsGlobal: false },
    { path: '/tools', icon: HiOutlineWrenchScrewdriver, label: '密钥工具', supportsGlobal: false },
    { path: '/server', icon: HiOutlineCog6Tooth, label: '节点设置', supportsGlobal: true },

];

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
    const [showServerMenu, setShowServerMenu] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const serverSelectorRef = useRef(null);
    const isGlobalView = activeServerId === 'global';
    const isAdmin = user?.role === 'admin';
    const isUserOnly = !isAdmin;
    const visibleNavItems = navItems.filter((item) => {
        if (isUserOnly) {
            return item.path === '/subscriptions';
        }
        if (item.userOnly && isAdmin) return false;
        if (item.adminOnly && !isAdmin) return false;
        if (isGlobalView && item.supportsGlobal === false) return false;
        return true;
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps — onClose is a stable inline callback; adding it would cause unnecessary re-runs
    useEffect(() => {
        setShowServerMenu(false);
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
            {/* Logo */}
            <div className="sidebar-logo">
                <div className="sidebar-logo-icon sidebar-logo-icon-custom">N</div>
                <span className="sidebar-logo-text sidebar-logo-text-gradient">NMS</span>
            </div>

            {/* Toggle Button */}
            <button className="sidebar-toggle" onClick={onToggle}>
                {collapsed ? <HiOutlineChevronRight /> : <HiOutlineChevronLeft />}
            </button>

            {/* Navigation */}
            <nav className="sidebar-nav">
                <div className="nav-section">
                    <div className="nav-section-title">导航</div>
                    {visibleNavItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === '/'}
                            onClick={onClose}
                            className={({ isActive }) =>
                                `nav-item ${isActive ? 'active' : ''}`
                            }
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
                </div>

                <div className="nav-section" style={{ marginTop: 'auto' }}>
                    <div className="nav-section-title">{isAdmin ? '系统' : '账户'}</div>
                    {isAdmin && (
                        <NavLink
                            to="/servers"
                            onClick={onClose}
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        >
                            {({ isActive }) => (
                                <>
                                    {isActive && <div className="active-glow" />}
                                    <span className="nav-item-icon"><HiOutlineServerStack /></span>
                                    <span className="nav-label">服务器管理</span>
                                </>
                            )}
                        </NavLink>
                    )}
                    <div className="nav-item" onClick={() => { logout(); onClose?.(); }}>
                        <span className="nav-item-icon text-muted"><HiOutlineArrowRightOnRectangle /></span>
                        <span className="nav-label">退出登录</span>
                    </div>
                </div>
            </nav>

            {/* Server Selector */}
            {isAdmin && (
                <div className="server-selector" ref={serverSelectorRef}>
                {activeServerId === 'global' ? (
                    <div
                        className={`server-selector-btn glass-panel ${showServerMenu ? 'active' : ''}`}
                        onClick={() => setShowServerMenu(!showServerMenu)}
                    >
                        <span className="server-dot server-dot-lg"><HiOutlineCloud /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">集群总览</div>
                            <div className="server-addr text-muted">Global View</div>
                        </div>
                        <HiOutlineChevronRight
                            className="server-chevron"
                            style={{
                                transform: showServerMenu ? 'rotate(90deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s',
                                color: 'var(--accent-primary)'
                            }}
                        />
                    </div>
                ) : activeServer ? (
                    <div
                        className={`server-selector-btn glass-panel ${showServerMenu ? 'active' : ''}`}
                        onClick={() => setShowServerMenu(!showServerMenu)}
                    >
                        <span className="server-dot server-dot-lg"><HiOutlineServerStack /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">{activeServer.name}</div>
                            <div className="server-addr text-muted">{activeServer.url}</div>
                        </div>
                        <HiOutlineChevronRight
                            className="server-chevron"
                            style={{
                                transform: showServerMenu ? 'rotate(90deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s',
                                color: 'var(--accent-primary)'
                            }}
                        />
                    </div>
                ) : (
                    <div className="server-selector-btn glass-panel" onClick={() => setShowServerMenu(!showServerMenu)}>
                        <span className="server-dot server-dot-lg"><HiOutlineCloud /></span>
                        <div className="server-info">
                            <div className="server-name text-glow">选择服务器</div>
                        </div>
                        <HiOutlineChevronRight className="server-chevron" />
                    </div>
                )}

                {/* Server dropdown */}
                {showServerMenu && (servers.length > 0 || activeServerId === 'global') && (
                    <div className="server-dropdown-menu">
                        <div
                            onClick={() => { selectServer('global'); setShowServerMenu(false); onClose?.(); }}
                            className={`server-dropdown-item ${activeServerId === 'global' ? 'active' : ''}`}
                        >
                            <span className="server-dot flex"><HiOutlineCloud /></span>
                            <div>
                                <div className="font-medium">集群总览</div>
                                <div className="text-muted text-xs">Global View</div>
                            </div>
                        </div>

                        {servers.map(s => (
                            <div
                                key={s.id}
                                onClick={() => { selectServer(s.id); setShowServerMenu(false); onClose?.(); }}
                                className={`server-dropdown-item ${s.id === activeServerId ? 'active' : ''}`}
                            >
                                <span className="server-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-success)' }} />
                                <div>
                                    <div className="font-medium">{s.name}</div>
                                    <div className="text-muted text-xs">{s.url}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                </div>
            )}
        </aside>
    );
}
