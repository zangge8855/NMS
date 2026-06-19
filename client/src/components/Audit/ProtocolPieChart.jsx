import React from 'react';
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { formatBytes } from '../../utils/format.js';
import ChartTooltip from '../UI/ChartTooltip.jsx';
import EmptyState from '../UI/EmptyState.jsx';

// Aurora-forward palette: lead with the indigo→violet→cyan signature ramp,
// then fan out to the stable semantic accents for additional categories.
const BRAND_PALETTE = [
    '#6366f1', // indigo (primary)
    '#8b5cf6', // violet (secondary)
    '#22d3ee', // cyan (tertiary)
    '#818cf8', // indigo-400
    '#38bdf8', // info
    '#34d399', // success
    '#fbbf24', // warning
    '#fb7185', // danger
];

export default function ProtocolPieChart({ data = [], locale = 'zh-CN' }) {
    if (!data || data.length === 0) {
        return (
            <EmptyState
                title={locale === 'en-US' ? 'No protocol data available' : '暂无协议流量数据'}
                size="compact"
                hideIcon
            />
        );
    }

    const chartData = data.map(item => ({
        name: String(item.protocol || 'unknown').toUpperCase(),
        value: item.totalBytes || 0,
    })).filter((item) => Number(item.value || 0) > 0);
    const totalBytes = chartData.reduce((sum, item) => sum + Number(item.value || 0), 0);
    if (chartData.length === 0) {
        return (
            <EmptyState
                title={locale === 'en-US' ? 'No protocol data available' : '暂无协议流量数据'}
                size="compact"
                hideIcon
            />
        );
    }

    return (
        <div className="audit-protocol-chart">
            <div className="audit-protocol-chart-visual">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius="62%"
                            outerRadius="84%"
                            paddingAngle={3}
                            dataKey="value"
                            stroke="var(--bg-card)"
                            strokeWidth={3}
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${entry.name}`} fill={BRAND_PALETTE[index % BRAND_PALETTE.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            content={<ChartTooltip valueFormatter={(value) => formatBytes(value)} />}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="audit-protocol-chart-center" aria-hidden="true">
                    <span>{locale === 'en-US' ? 'Total' : '总计'}</span>
                    <strong>{formatBytes(totalBytes)}</strong>
                </div>
            </div>
            <div className="audit-protocol-chart-legend">
                {chartData.map((item, index) => {
                    const share = totalBytes > 0 ? (Number(item.value || 0) / totalBytes) * 100 : 0;
                    return (
                        <div className="audit-protocol-chart-legend-row" key={item.name}>
                            <span
                                className="audit-protocol-chart-swatch"
                                style={{ backgroundColor: BRAND_PALETTE[index % BRAND_PALETTE.length] }}
                                aria-hidden="true"
                            />
                            <span className="audit-protocol-chart-name">{item.name}</span>
                            <span className="audit-protocol-chart-value">{formatBytes(item.value)}</span>
                            <span className="audit-protocol-chart-share">{share >= 1 ? `${share.toFixed(0)}%` : '<1%'}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
