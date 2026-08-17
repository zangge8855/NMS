import React, { type ReactNode } from 'react';

export interface SectionHeaderProps {
    title?: ReactNode;
    subtitle?: ReactNode;
    meta?: ReactNode;
    actions?: ReactNode;
    align?: 'start' | 'between';
    compact?: boolean;
    divider?: boolean;
    density?: 'dense' | 'normal' | string;
    titleSize?: 'sm' | 'md' | 'lg' | string;
    className?: string;
}

export default function SectionHeader({
    title,
    subtitle,
    meta,
    actions,
    align = 'between',
    compact = false,
    divider = false,
    density = '',
    titleSize = '',
    className = '',
}: SectionHeaderProps) {
    const classes = [
        'section-header',
        compact ? 'section-header--compact' : '',
        divider ? 'section-header--divided' : '',
        density ? `section-header--${density}` : '',
        titleSize ? `section-header--title-${titleSize}` : '',
        align === 'start' ? 'section-header--align-start' : 'section-header--align-between',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={classes}>
            <div className="section-header-copy">
                {title && <div className="section-header-title">{title}</div>}
                {subtitle && <div className="section-header-subtitle">{subtitle}</div>}
            </div>
            {(meta || actions) && (
                <div className="section-header-side">
                    {meta && <div className="section-header-meta">{meta}</div>}
                    {actions && <div className="section-header-actions">{actions}</div>}
                </div>
            )}
        </div>
    );
}
