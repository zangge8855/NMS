import React from 'react';

function EmptyIcon() {
    return (
        <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-state-svg">
            <rect x="10" y="20" width="100" height="60" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
            <rect x="20" y="35" width="40" height="4" rx="2" fill="currentColor" opacity="0.1" />
            <rect x="20" y="45" width="60" height="4" rx="2" fill="currentColor" opacity="0.08" />
            <rect x="20" y="55" width="50" height="4" rx="2" fill="currentColor" opacity="0.06" />
            <rect x="20" y="65" width="30" height="4" rx="2" fill="currentColor" opacity="0.04" />
            <circle cx="90" cy="30" r="15" stroke="currentColor" strokeWidth="1.5" opacity="0.12" />
            <path d="M85 30L88 33L95 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" />
        </svg>
    );
}

export default function EmptyState({
    title = '暂无数据',
    subtitle,
    action,
    icon,
    size = 'default',
    surface = false,
    hideIcon = false,
    className = '',
}) {
    const classes = [
        'empty-state',
        size !== 'default' ? `empty-state--${size}` : '',
        surface ? 'empty-state--surface' : '',
        className,
    ].filter(Boolean);
    const shouldRenderIcon = !hideIcon;

    return (
        <div className={classes.join(' ')}>
            {shouldRenderIcon && (
                <div className="empty-state-icon" aria-hidden="true">
                    {icon || <EmptyIcon />}
                </div>
            )}
            <div className="empty-state-body">
                <h3 className="empty-state-title">{title}</h3>
                {subtitle && <p className="empty-state-sub">{subtitle}</p>}
            </div>
            {action && <div className="empty-state-action mt-4">{action}</div>}
        </div>
    );
}
