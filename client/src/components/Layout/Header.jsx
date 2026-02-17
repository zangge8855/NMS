import React from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { HiOutlineSignal, HiOutlineSun, HiOutlineMoon, HiOutlineComputerDesktop, HiOutlineCloud } from 'react-icons/hi2';

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

export default function Header({ title, icon, children }) {
    const { activeServer, activeServerId } = useServer();
    const { mode, cycleTheme } = useTheme();

    const ThemeIcon = themeIcons[mode] || HiOutlineMoon;

    return (
        <header className="header">
            <div className="header-left">
                {icon && <span className="header-icon">{icon}</span>}
                <h1 className="header-title">{title}</h1>
            </div>
            <div className="header-right">
                {children}
                <button
                    className="theme-toggle-btn"
                    onClick={cycleTheme}
                    title={themeLabels[mode]}
                    aria-label={themeLabels[mode]}
                >
                    <ThemeIcon />
                    <span className="theme-label">{themeLabels[mode]}</span>
                </button>
                {activeServer ? (
                    <div className="flex items-center gap-8">
                        <span className="badge badge-success">
                            <HiOutlineSignal style={{ fontSize: '12px' }} />
                            {activeServer.name}
                        </span>
                    </div>
                ) : activeServerId === 'global' ? (
                    <div className="flex items-center gap-8">
                        <span className="badge badge-info">
                            <HiOutlineCloud style={{ fontSize: '12px' }} />
                            集群总览
                        </span>
                    </div>
                ) : null}
            </div>
        </header>
    );
}
