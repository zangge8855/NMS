import React from 'react';

export default function SkeletonTable({ rows = 5, cols = 4 }) {
    return (
        <table className="table">
            <thead>
                <tr>
                    {Array.from({ length: cols }, (_, i) => (
                        <th key={i}><span className="skeleton-text" style={{ width: `${60 + Math.random() * 40}%` }}>&nbsp;</span></th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {Array.from({ length: rows }, (_, r) => (
                    <tr key={r}>
                        {Array.from({ length: cols }, (_, c) => (
                            <td key={c}>
                                <span className="skeleton-text" style={{ width: `${50 + Math.random() * 40}%` }}>&nbsp;</span>
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
