import React from 'react';
import {
    LineChart,
    Line,
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
    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data || []} margin={margin}>
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
                <Line
                    type="monotone"
                    dataKey="totalBytes"
                    stroke={color || 'var(--accent-primary)'}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                    connectNulls
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
