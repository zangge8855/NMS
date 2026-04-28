import React from 'react';

export default function PageToolbar({
    main,
    actions,
    meta,
    summary,
    compact = false,
    sticky = false,
    density = '',
    stackOnTablet = false,
    className = '',
}) {
    const classes = [
        'page-toolbar',
        compact ? 'page-toolbar--compact' : '',
        sticky ? 'page-toolbar--sticky' : '',
        density ? `page-toolbar--${density}` : '',
        stackOnTablet ? 'page-toolbar--stack-tablet' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={classes}>
            {main && <div className="page-toolbar-main">{main}</div>}
            {summary && <div className="page-toolbar-summary">{summary}</div>}
            {actions && <div className="page-toolbar-actions">{actions}</div>}
            {meta && <div className="page-toolbar-meta">{meta}</div>}
        </div>
    );
}
