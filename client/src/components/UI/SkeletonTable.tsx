import React from 'react';

function widthForCell(columnIndex: number, rowIndex: number = 0, type: 'head' | 'body' = 'body'): string {
    const base = type === 'head' ? 48 : 42;
    const variance = type === 'head' ? 20 : 28;
    const seed = ((columnIndex + 1) * 17) + ((rowIndex + 1) * 13);
    return `${base + (seed % variance)}%`;
}

export interface SkeletonTableProps {
    rows?: number;
    cols?: number;
    colTemplate?: string;
}

export default function SkeletonTable({ rows = 5, cols = 4, colTemplate = '' }: SkeletonTableProps) {
    return (
        <div
            className="skeleton-table"
            style={{
                '--skeleton-cols': cols,
                ...(colTemplate ? { '--skeleton-template': colTemplate } : {}),
            } as React.CSSProperties}
            role="presentation"
            aria-hidden="true"
        >
            <div className="skeleton-table-row skeleton-table-head">
                {Array.from({ length: cols }, (_, columnIndex) => (
                    <span
                        key={`head-${columnIndex}`}
                        className="skeleton skeleton-table-cell skeleton-table-head-cell"
                        style={{ width: widthForCell(columnIndex, 0, 'head') }}
                    />
                ))}
            </div>
            <div className="skeleton-table-body">
                {Array.from({ length: rows }, (_, rowIndex) => (
                    <div className="skeleton-table-row" key={`row-${rowIndex}`}>
                        {Array.from({ length: cols }, (_, columnIndex) => (
                            <span
                                key={`cell-${rowIndex}-${columnIndex}`}
                                className="skeleton skeleton-table-cell"
                                style={{ width: widthForCell(columnIndex, rowIndex, 'body') }}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
