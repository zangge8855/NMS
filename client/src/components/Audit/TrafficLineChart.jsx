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
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="ts" tickFormatter={(value) => trendLabel(value, granularity, locale)} />
                <YAxis width={yAxisWidth} tickFormatter={formatAxis} />
                <Tooltip formatter={(value) => formatValue(value)} labelFormatter={(value) => formatLabel(value, locale)} />
                <Line type="monotone" dataKey="totalBytes" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
        </ResponsiveContainer>
    );
}
