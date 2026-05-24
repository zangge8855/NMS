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

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

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
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip
                    formatter={(value) => formatBytes(value)}
                    contentStyle={{
                        backgroundColor: 'var(--bg-popover)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        color: 'var(--text-primary)',
                    }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                />
                <Legend verticalAlign="bottom" height={36} />
            </PieChart>
        </ResponsiveContainer>
    );
}
