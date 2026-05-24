import React from 'react';

/**
 * Themed Recharts tooltip — replaces the default white-background tooltip so it
 * doesn't clash with the dark theme. Use with `<Tooltip content={<ChartTooltip />} />`.
 *
 * Optional props:
 *   - labelFormatter:  (label) => string  — format the header label
 *   - valueFormatter:  (value, name) => string  — format each metric value
 *   - hideZero:        boolean  — hide rows where value === 0
 */
export default function ChartTooltip({
    active,
    payload,
    label,
    labelFormatter,
    valueFormatter,
    hideZero = false,
}) {
    if (!active || !Array.isArray(payload) || payload.length === 0) return null;
    const rows = hideZero ? payload.filter((row) => Number(row?.value) !== 0) : payload;
    if (rows.length === 0) return null;
    const headerLabel = typeof labelFormatter === 'function' ? labelFormatter(label) : label;
    return (
        <div className="chart-tooltip" role="tooltip">
            {headerLabel != null && headerLabel !== '' ? (
                <div className="chart-tooltip-header">{headerLabel}</div>
            ) : null}
            <ul className="chart-tooltip-list">
                {rows.map((row, index) => {
                    const value = typeof valueFormatter === 'function'
                        ? valueFormatter(row.value, row.name)
                        : row.value;
                    const color = row?.color || row?.payload?.fill || row?.payload?.stroke || 'var(--accent-primary)';
                    return (
                        <li key={`${row?.dataKey || row?.name || index}`} className="chart-tooltip-row">
                            <span className="chart-tooltip-swatch" style={{ background: color }} />
                            <span className="chart-tooltip-name">{row?.name || row?.dataKey}</span>
                            <span className="chart-tooltip-value">{value}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
