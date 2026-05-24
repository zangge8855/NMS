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
    pageSize,
    totalItems,
    pageSizeOptions = [10, 20, 50, 100],
    onPageSizeChange,
    loading = false,
    previousLabel = '上一页',
    nextLabel = '下一页',
    onPrevious,
    onNext,
    onJump,
    className = '',
}) {
    const normalizedPage = Math.max(1, Number(page || 1));
    const normalizedTotalPages = Math.max(1, Number(totalPages || 1));
    const showSizeControl = typeof pageSize === 'number' && typeof onPageSizeChange === 'function';
    const showJumpControl = typeof onJump === 'function' && normalizedTotalPages > 3;
    const totalCountLabel = Number.isFinite(Number(totalItems))
        ? `共 ${Number(totalItems)} 条`
        : null;

    const handleSizeChange = (event) => {
        const next = Number(event.target.value || 0);
        if (next > 0 && next !== Number(pageSize)) {
            onPageSizeChange(next);
        }
    };

    const handleJumpKey = (event) => {
        if (event.key !== 'Enter') return;
        const raw = Number(event.currentTarget.value);
        const next = Math.min(normalizedTotalPages, Math.max(1, Math.floor(raw)));
        if (Number.isFinite(next) && next !== normalizedPage) {
            onJump(next);
        }
    };

    return (
        <div className={['list-pagination', 'page-pagination', className].filter(Boolean).join(' ')}>
            {meta || totalCountLabel ? (
                <div className="page-pagination-meta">
                    {meta}
                    {totalCountLabel ? <span className="text-sm text-muted ml-2">{totalCountLabel}</span> : null}
                </div>
            ) : null}
            {showSizeControl && (
                <div className="page-pagination-size flex items-center gap-2">
                    <span className="text-sm text-muted">每页</span>
                    <select
                        className="form-select form-select-sm"
                        value={pageSize}
                        onChange={handleSizeChange}
                        disabled={loading}
                    >
                        {pageSizeOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                </div>
            )}
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
                    {showJumpControl && (
                        <input
                            type="number"
                            min={1}
                            max={normalizedTotalPages}
                            className="form-input form-input-sm page-pagination-jump"
                            placeholder="跳转"
                            disabled={loading}
                            onKeyDown={handleJumpKey}
                            aria-label="跳转到指定页码"
                        />
                    )}
                </div>
            )}
        </div>
    );
}
