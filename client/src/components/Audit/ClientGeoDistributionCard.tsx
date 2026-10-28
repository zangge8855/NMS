import React, { useMemo } from 'react';
import { HiOutlineGlobeAlt } from 'react-icons/hi2';
import {
    normalizeCarrierLabel,
    regionCodeToFlag,
    resolveAccessCountry,
    resolveRegionDisplayName,
} from '../../utils/accessGeo';

export interface GeoItem {
    key: string;
    country: string;
    countryCode?: string;
    flag?: string;
    count: number;
    percentage: number;
    ispSummary?: string;
}

export interface ClientGeoDistributionCardProps {
    items?: Array<{
        id?: string;
        ip?: string;
        clientIp?: string;
        ipLocation?: string;
        ipCarrier?: string;
        cfCountry?: string;
    }>;
    locale?: string;
}

export default function ClientGeoDistributionCard({ items = [], locale = 'zh-CN' }: ClientGeoDistributionCardProps) {
    const isEn = locale === 'en-US';

    const { geoStats, ipCount } = useMemo(() => {
        if (!items || items.length === 0) return { geoStats: [], ipCount: 0 };

        // Access-log rows repeat for every subscription pull; aggregate per IP so a
        // single chatty client does not dominate the distribution.
        const byIp = new Map<string, (typeof items)[number]>();
        items.forEach((item, index) => {
            const ip = String(item?.clientIp || item?.ip || '').trim();
            const key = ip || `row:${item?.id || index}`;
            if (!byIp.has(key)) byIp.set(key, item);
        });

        const countMap = new Map<string, { name: string; code: string; local: boolean; count: number; carriers: Map<string, number> }>();
        for (const item of byIp.values()) {
            const country = resolveAccessCountry(item);
            const key = country.code || country.name || '';
            if (!countMap.has(key)) {
                countMap.set(key, { ...country, count: 0, carriers: new Map() });
            }
            const entry = countMap.get(key)!;
            entry.count += 1;
            const carrier = normalizeCarrierLabel(item?.ipCarrier);
            if (carrier) entry.carriers.set(carrier, (entry.carriers.get(carrier) || 0) + 1);
        }

        const total = byIp.size;
        const unknownLabel = isEn ? 'Unknown Location' : '未知区域';
        const sorted: GeoItem[] = Array.from(countMap.entries()).map(([key, data]) => {
            let country = data.name || unknownLabel;
            if (data.local) {
                country = isEn ? 'Private / Local' : data.name;
            } else if (isEn && data.code) {
                country = resolveRegionDisplayName(data.code, 'en') || country;
            }
            return {
                key: key || 'unknown',
                country,
                countryCode: data.code,
                flag: regionCodeToFlag(data.code),
                count: data.count,
                percentage: total > 0 ? Math.round((data.count / total) * 100) : 0,
                ispSummary: Array.from(data.carriers.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([carrier]) => carrier)
                    .join(', '),
            };
        });

        sorted.sort((a, b) => b.count - a.count);
        return { geoStats: sorted.slice(0, 8), ipCount: total };
    }, [items, isEn]);

    return (
        <div className="card p-6 space-y-4 border border-stroke-soft bg-surface-panel/80 backdrop-blur-md shadow-lg rounded-2xl">
            <div className="flex items-center justify-between border-b border-stroke-soft pb-4">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
                        <HiOutlineGlobeAlt className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-primary tracking-tight">
                            {isEn ? 'Client Geographic & Access Distribution' : '客户端活跃 IP 地理与运营商分布'}
                        </h3>
                        <p className="text-xs text-muted">
                            {isEn ? 'Real-time aggregated origin countries and ISP nodes' : '实时聚合活跃连接的访问来源国家与网络服务商'}
                        </p>
                    </div>
                </div>
                <span className="badge badge-primary text-xs font-mono px-2.5 py-1">
                    {ipCount} {isEn ? 'Active IPs' : '个活跃 IP'}
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
                            key={geo.key}
                            className="p-2.5 rounded-xl border border-stroke-soft/60 bg-surface-input/30 hover:border-primary/30 hover:bg-surface-input/60 transition-all duration-200 space-y-2"
                        >
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 font-semibold text-primary">
                                    <span className="text-base leading-none drop-shadow-sm">{geo.flag}</span>
                                    <span>{geo.country}</span>
                                    {geo.ispSummary && (
                                        <span className="text-muted font-normal hidden sm:inline truncate max-w-xs text-[11px]">
                                            · {geo.ispSummary}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 font-mono">
                                    <span className="font-bold text-primary">{geo.count}</span>
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
