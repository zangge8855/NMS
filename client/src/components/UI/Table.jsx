import React from 'react';
import SkeletonTable from './SkeletonTable.jsx';
import EmptyState from './EmptyState.jsx';

export default function Table({
    loading = false,
    rows = 5,
    cols = 4,
    colTemplate = '',
    empty = false,
    emptyStateProps = {},
    className = '',
    tableClassName = '',
    headers = null,
    children,
    tableContainer = true,
}) {
    const containerClasses = [
        tableContainer ? 'table-container' : '',
        className,
    ].filter(Boolean).join(' ');

    if (loading) {
        return (
            <div className={`${containerClasses} p-4`}>
                <SkeletonTable rows={rows} cols={cols} colTemplate={colTemplate} />
            </div>
        );
    }

    if (empty) {
        return (
            <div className={`${containerClasses} p-4`}>
                <EmptyState {...emptyStateProps} />
            </div>
        );
    }

    return (
        <div className={containerClasses}>
            <table className={`table ${tableClassName}`}>
                {headers && (
                    <thead>
                        {Array.isArray(headers) ? (
                            <tr>
                                {headers.map((header, index) => {
                                    if (React.isValidElement(header)) {
                                        return React.cloneElement(header, { key: header.key || index });
                                    }
                                    return <th key={index}>{header}</th>;
                                })}
                            </tr>
                        ) : (
                            headers
                        )}
                    </thead>
                )}
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}
