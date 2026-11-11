import React, { type ReactNode } from 'react';
import { useI18n } from '../../contexts/LanguageContext';

function EmptyIcon() {
    return (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-state-svg">
            <path d="M8 27.5 12.6 13.4A3 3 0 0 1 15.45 11.4h17.1a3 3 0 0 1 2.85 2l4.6 14.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
            <path d="M8 27.5h9.2l2.4 4.2h8.8l2.4-4.2H40v7.6a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3v-7.6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.8" />
            <path d="M18 19.5h12M20 23.5h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        </svg>
    );
}

export interface EmptyStateProps {
    title?: string;
    subtitle?: string;
    action?: ReactNode;
    icon?: ReactNode;
    size?: 'default' | 'compact' | string;
    surface?: boolean;
    hideIcon?: boolean;
    className?: string;
}

export default function EmptyState({
    title,
    subtitle,
    action,
    icon,
    size = 'default',
    surface = false,
    hideIcon = false,
    className = '',
}: EmptyStateProps) {
    const { t } = useI18n();
    const resolvedTitle = title ?? t('comp.common.noData');
    const classes = [
        'empty-state',
        size !== 'default' ? `empty-state--${size}` : '',
        size !== 'default' ? `empty-state-${size}` : '',
        surface ? 'empty-state--surface' : '',
        surface ? 'empty-state-surface' : '',
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
                <h3 className="empty-state-title">{resolvedTitle}</h3>
                {subtitle && <p className="empty-state-sub">{subtitle}</p>}
            </div>
            {action && <div className="empty-state-action mt-4">{action}</div>}
        </div>
    );
}
