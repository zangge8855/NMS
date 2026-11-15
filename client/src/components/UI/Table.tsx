import React, { type ReactNode } from 'react';
import SkeletonTable from './SkeletonTable';
import EmptyState, { type EmptyStateProps } from './EmptyState';
import { useI18n } from '../../contexts/LanguageContext';

export interface TableProps {
    loading?: boolean;
    rows?: number;
    cols?: number;
    colTemplate?: string;
    empty?: boolean;
    emptyStateProps?: EmptyStateProps;
    className?: string;
    tableClassName?: string;
    headers?: ReactNode[] | ReactNode;
    children?: ReactNode;
    tableContainer?: boolean;
    ariaLabel?: string;
    ariaLabelledBy?: string;
}

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
    ariaLabel,
    ariaLabelledBy,
}: TableProps) {
    const { t } = useI18n();
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

    const resolvedAriaLabel = ariaLabelledBy ? undefined : (ariaLabel || t('comp.common.dataTable'));

    return (
        <div
            className={containerClasses}
            tabIndex={tableContainer ? 0 : undefined}
            role={tableContainer ? 'region' : undefined}
            aria-label={tableContainer ? resolvedAriaLabel : undefined}
            aria-labelledby={tableContainer ? ariaLabelledBy : undefined}
        >
            <table className={`table ${tableClassName}`}>
                {headers && (
                    <thead>
                        {Array.isArray(headers) ? (
                            <tr>
                                {headers.map((header, index) => {
                                    if (React.isValidElement(header)) {
                                        const headerProps = header.props as { scope?: string };
                                        return React.cloneElement(header as React.ReactElement<any>, {
                                            key: header.key || index,
                                            scope: headerProps.scope ?? 'col',
                                        });
                                    }
                                    return <th key={index} scope="col">{header}</th>;
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
