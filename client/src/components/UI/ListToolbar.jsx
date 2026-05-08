import React from 'react';
import PageToolbar from './PageToolbar.jsx';

export default function ListToolbar({
    filters,
    summary,
    actions,
    meta,
    selection,
    className = '',
    compact = true,
    stackOnTablet = true,
}) {
    return (
        <PageToolbar
            className={['list-toolbar', className].filter(Boolean).join(' ')}
            compact={compact}
            stackOnTablet={stackOnTablet}
            main={filters ? <div className="list-toolbar-filters">{filters}</div> : null}
            summary={selection || summary}
            actions={actions ? <div className="list-toolbar-actions-inner">{actions}</div> : null}
            meta={meta ? <div className="list-toolbar-meta-inner">{meta}</div> : null}
        />
    );
}

export function ListPagination({
    meta,
    page,
    totalPages,
    loading = false,
    previousLabel = '上一页',
    nextLabel = '下一页',
    onPrevious,
    onNext,
    className = '',
}) {
    const normalizedPage = Math.max(1, Number(page || 1));
    const normalizedTotalPages = Math.max(1, Number(totalPages || 1));

    return (
        <div className={['list-pagination', 'page-pagination', className].filter(Boolean).join(' ')}>
            {meta ? <div className="page-pagination-meta">{meta}</div> : null}
            {(onPrevious || onNext) && (
                <div className="page-pagination-actions">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={normalizedPage <= 1 || loading}
                        onClick={onPrevious}
                    >
                        {previousLabel}
                    </button>
                    <span className="text-sm text-muted self-center">
                        {normalizedPage} / {normalizedTotalPages}
                    </span>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={normalizedPage >= normalizedTotalPages || loading}
                        onClick={onNext}
                    >
                        {nextLabel}
                    </button>
                </div>
            )}
        </div>
    );
}
