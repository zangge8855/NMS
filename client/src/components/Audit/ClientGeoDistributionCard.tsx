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
        <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stroke-soft pb-3">
                <div className="flex items-center gap-2">
                    <HiOutlineGlobeAlt className="w-5 h-5 text-primary" />
                    <h3 className="text-base font-bold text-text-primary">
                        {isEn ? 'Client Geographic & Access Distribution' : '客户端活跃 IP 地理与运营商分布'}
                    </h3>
                </div>
                <span className="badge badge-primary text-xs font-mono">
                    {items.length} {isEn ? 'Active Connections' : '条活跃连接'}
                </span>
            </div>

            {geoStats.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted">
                    {isEn ? 'No live geo data recorded yet' : '暂无活跃客户端 IP 地理分布记录'}
                </div>
            ) : (
                <div className="space-y-3 pt-1">
                    {geoStats.map((geo) => (
                        <div key={geo.country} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 font-medium text-text-primary">
                                    <span className="text-sm">{geo.flag}</span>
                                    <span>{geo.country}</span>
                                    {geo.ispSummary && (
                                        <span className="text-muted font-normal hidden sm:inline truncate max-w-xs">
                                            ({geo.ispSummary})
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 font-mono">
                                    <span className="font-bold text-text-primary">{geo.count}</span>
                                    <span className="text-muted text-[11px] w-10 text-right">{geo.percentage}%</span>
                                </div>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-surface-input overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary transition-all duration-500"
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
