import React from 'react';

export default function PageToolbar({
    main,
    actions,
    meta,
    compact = false,
    stackOnTablet = false,
    className = '',
}) {
    const classes = [
        'page-toolbar',
        compact ? 'page-toolbar--compact' : '',
        stackOnTablet ? 'page-toolbar--stack-tablet' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={classes}>
            {main && <div className="page-toolbar-main">{main}</div>}
            {actions && <div className="page-toolbar-actions">{actions}</div>}
            {meta && <div className="page-toolbar-meta">{meta}</div>}
        </div>
    );
}
