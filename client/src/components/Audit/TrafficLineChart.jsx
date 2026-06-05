import React, { useId } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import ChartTooltip from '../UI/ChartTooltip.jsx';

export default function TrafficLineChart({
    data,
    color,
    granularity,
    locale,
    margin,
    yAxisWidth,
    formatAxis,
    formatValue,
    formatLabel,
    trendLabel,
}) {
    const gradientId = `traffic-${useId().replace(/:/g, '')}`;
    const stroke = color || 'var(--accent-primary)';
    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data || []} margin={margin}>
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={stroke} stopOpacity={0.26} />
                        <stop offset="92%" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 8" stroke="var(--chart-grid-color)" vertical={false} />
                <XAxis
                    dataKey="ts"
                    tickFormatter={(value) => trendLabel(value, granularity, locale)}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                />
                <YAxis
                    width={yAxisWidth}
                    tickFormatter={formatAxis}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip
                    cursor={{ stroke: 'var(--chart-grid-color)', strokeDasharray: '4 6', strokeWidth: 1.5 }}
                    content={(
                        <ChartTooltip
                            valueFormatter={(value) => formatValue(value)}
                            labelFormatter={(value) => formatLabel(value, locale)}
                        />
                    )}
                />
                <Area
                    type="monotone"
                    dataKey="totalBytes"
                    stroke={stroke}
                    strokeWidth={2.5}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                    connectNulls
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
