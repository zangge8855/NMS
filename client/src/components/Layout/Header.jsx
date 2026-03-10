import React from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { HiOutlineSignal, HiOutlineSun, HiOutlineMoon, HiOutlineComputerDesktop, HiOutlineCloud, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import NotificationBell from './NotificationBell.jsx';

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

export default function Header({ title, subtitle = '', eyebrow = 'NMS', icon, children }) {
    const { activeServer, activeServerId } = useServer();
    const { mode, cycleTheme } = useTheme();

    const ThemeIcon = themeIcons[mode] || HiOutlineMoon;

    const scopeLabel = activeServer
        ? { icon: HiOutlineSignal, title: '单节点', value: activeServer.name }
        : activeServerId === 'global'
            ? { icon: HiOutlineCloud, title: '控制域', value: '集群总览' }
            : null;

    const ScopeIcon = scopeLabel?.icon;

    return (
        <header className="header">
            <div className="header-left">
                {icon && <span className="header-icon">{icon}</span>}
                <div className="header-title-group">
                    <span className="header-eyebrow">{eyebrow}</span>
                    <h1 className="header-title">{title}</h1>
                    {subtitle && <div className="header-subtitle">{subtitle}</div>}
                </div>
            </div>
            <div className="header-actions">
                <div className="header-search">
                    <HiOutlineMagnifyingGlass className="header-search-icon" />
                    <input placeholder="搜索..." className="header-search-input" readOnly tabIndex={-1} />
                    <kbd className="header-search-kbd">⌘K</kbd>
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
