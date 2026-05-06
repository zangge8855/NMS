import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function CpuHistoryChart({ cpuHistory, endTick, t }) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cpuHistory}>
                <defs>
                    <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid-color)" vertical={false} />
                <XAxis
                    dataKey="time"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                    tickMargin={10}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickFormatter={(value) => {
                        if (value === 0) return t('pages.dashboardNode.cpuChartStartTick');
                        if (value === endTick) return t('pages.dashboardNode.cpuChartEndTick');
                        return '';
                    }}
                />
                <YAxis
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                    tickCount={3}
                    width={34}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                    contentStyle={{
                        background: 'var(--surface-overlay)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                        boxShadow: 'var(--shadow-lg)',
                    }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}
                    itemStyle={{ color: 'var(--accent-primary-hover)' }}
                    labelFormatter={(value) => `${t('pages.dashboardNode.cpuTooltipLabel')} · ${value}`}
                    formatter={(value) => [`${value.toFixed(1)}%`, t('pages.dashboardNode.cpuTooltipLabel')]}
                    cursor={{ stroke: 'var(--chart-grid-color)', strokeDasharray: '3 3', strokeWidth: 1.5 }}
                />
                <Area type="monotone" dataKey="cpu" stroke="var(--accent-primary)" strokeWidth={2} fill="url(#cpuGradient)" animationDuration={1500} />
            </AreaChart>
        </ResponsiveContainer>
    );
}
