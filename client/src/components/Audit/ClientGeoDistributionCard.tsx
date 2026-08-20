import React, { useMemo } from 'react';
import { HiOutlineGlobeAlt, HiOutlineShieldCheck, HiOutlineSignal } from 'react-icons/hi2';

export interface GeoItem {
    country: string;
    countryCode?: string;
    flag?: string;
    count: number;
    percentage: number;
    ispSummary?: string;
}

export interface ClientGeoDistributionCardProps {
    items?: Array<{ ip?: string; country?: string; countryCode?: string; city?: string; isp?: string }>;
    locale?: string;
}

export default function ClientGeoDistributionCard({ items = [], locale = 'zh-CN' }: ClientGeoDistributionCardProps) {
    const isEn = locale === 'en-US';

    const geoStats = useMemo(() => {
        if (!items || items.length === 0) return [];
        const countMap = new Map<string, { count: number; countryCode: string; isp: Set<string> }>();
        let total = 0;

        for (const item of items) {
            const country = item?.country || (isEn ? 'Unknown Location' : '未知区域');
            const code = item?.countryCode || 'UN';
            const isp = item?.isp || '';

            if (!countMap.has(country)) {
                countMap.set(country, { count: 0, countryCode: code, isp: new Set() });
            }
            const entry = countMap.get(country)!;
            entry.count += 1;
            if (isp) entry.isp.add(isp);
            total += 1;
        }

        const sorted: GeoItem[] = Array.from(countMap.entries()).map(([country, data]) => ({
            country,
            countryCode: data.countryCode,
            flag: data.countryCode && data.countryCode !== 'UN' ? String.fromCodePoint(...[...data.countryCode.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐',
            count: data.count,
            percentage: total > 0 ? Math.round((data.count / total) * 100) : 0,
            ispSummary: Array.from(data.isp).slice(0, 2).join(', '),
        }));

        sorted.sort((a, b) => b.count - a.count);
        return sorted.slice(0, 8);
    }, [items, isEn]);

    return (
        <div className="card p-6 space-y-4 border border-stroke-soft bg-surface-panel/80 backdrop-blur-md shadow-lg rounded-2xl">
            <div className="flex items-center justify-between border-b border-stroke-soft pb-4">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
                        <HiOutlineGlobeAlt className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-text-primary tracking-tight">
                            {isEn ? 'Client Geographic & Access Distribution' : '客户端活跃 IP 地理与运营商分布'}
                        </h3>
                        <p className="text-xs text-muted">
                            {isEn ? 'Real-time aggregated origin countries and ISP nodes' : '实时聚合活跃连接的访问来源国家与网络服务商'}
                        </p>
                    </div>
                </div>
                <span className="badge badge-primary text-xs font-mono px-2.5 py-1">
                    {items.length} {isEn ? 'Active' : '条活跃连接'}
                </span>
            </div>

            {geoStats.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted border border-dashed border-stroke-soft rounded-xl bg-surface-panel/30">
                    {isEn ? 'No live geo data recorded yet' : '暂无活跃客户端 IP 地理分布记录'}
                </div>
            ) : (
                <div className="space-y-3.5 pt-1">
                    {geoStats.map((geo) => (
                        <div
                            key={geo.country}
                            className="p-2.5 rounded-xl border border-stroke-soft/60 bg-surface-input/30 hover:border-primary/30 hover:bg-surface-input/60 transition-all duration-200 space-y-2"
                        >
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 font-semibold text-text-primary">
                                    <span className="text-base leading-none drop-shadow-sm">{geo.flag}</span>
                                    <span>{geo.country}</span>
                                    {geo.ispSummary && (
                                        <span className="text-muted font-normal hidden sm:inline truncate max-w-xs text-[11px]">
                                            · {geo.ispSummary}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 font-mono">
                                    <span className="font-bold text-text-primary">{geo.count}</span>
                                    <span className="text-muted text-[11px] w-9 text-right font-medium">{geo.percentage}%</span>
                                </div>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-stroke-soft overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent-secondary transition-all duration-500 shadow-sm"
                                    style={{ width: `${Math.max(4, geo.percentage)}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
