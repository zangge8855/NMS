import React from 'react';

export default function SectionHeader({
    title,
    subtitle,
    meta,
    actions,
    align = 'between',
    compact = false,
    className = '',
}) {
    const classes = [
        'section-header',
        compact ? 'section-header--compact' : '',
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
