import React from 'react';
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import { formatBytes } from '../../utils/format.js';
import ChartTooltip from '../UI/ChartTooltip.jsx';

// NMS brand-aligned palette — driven from CSS variables so palette swaps with the theme.
const BRAND_PALETTE = [
    'var(--accent-primary, #22d3ee)',
    'var(--accent-success, #10b981)',
    'var(--accent-warning, #f59e0b)',
    'var(--accent-danger, #ef4444)',
    'var(--accent-purple, #8b5cf6)',
    'var(--accent-pink, #ec4899)',
    'var(--accent-cyan, #06b6d4)',
];

export default function ProtocolPieChart({ data = [], locale = 'zh-CN' }) {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-muted">
                {locale === 'en-US' ? 'No protocol data available' : '暂无协议流量数据'}
            </div>
        );
    }

    const chartData = data.map(item => ({
        name: String(item.protocol || 'unknown').toUpperCase(),
        value: item.totalBytes || 0,
    }));

    return (
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                >
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={BRAND_PALETTE[index % BRAND_PALETTE.length]} />
                    ))}
                </Pie>
                <Tooltip
                    content={<ChartTooltip valueFormatter={(value) => formatBytes(value)} />}
                />
                <Legend verticalAlign="bottom" height={36} />
            </PieChart>
        </ResponsiveContainer>
    );
}
