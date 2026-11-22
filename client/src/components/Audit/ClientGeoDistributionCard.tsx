import React, { useMemo } from 'react';
import {
    normalizeCarrierLabel,
    regionCodeToFlag,
    resolveAccessCountry,
    resolveRegionDisplayName,
} from '../../utils/accessGeo';
import { normalizePanelIpAddress } from '../../utils/panelClientIps';
import SectionHeader from '../UI/SectionHeader';
import EmptyState from '../UI/EmptyState';

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
            const rawIp = String(item?.clientIp || item?.ip || '').trim();
            const ip = normalizePanelIpAddress(rawIp) || rawIp;
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
            const carrier = (normalizeCarrierLabel as (value?: string | null, locale?: string) => string)(item?.ipCarrier, locale);
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
    }, [items, isEn, locale]);

    return (
        <div className="card p-4 space-y-4">
            <SectionHeader
                compact
                divider
                title={isEn ? 'Client Geographic & Access Distribution' : '客户端活跃 IP 地理与运营商分布'}
                subtitle={isEn ? 'Real-time aggregated origin countries and ISP nodes' : '实时聚合活跃连接的访问来源国家与网络服务商'}
                actions={(
                    <span className="badge badge-info">
                        {ipCount} {isEn ? 'Active IPs' : '个活跃 IP'}
                    </span>
                )}
            />

            {geoStats.length === 0 ? (
                <EmptyState
                    size="compact"
                    hideIcon
                    title={isEn ? 'No live geo data recorded yet' : '暂无活跃客户端 IP 地理分布记录'}
                />
            ) : (
                <div className="space-y-3">
                    {geoStats.map((geo) => (
                        <div
                            key={geo.key}
                            className="p-3 rounded-lg border border-stroke-soft bg-surface-subtle space-y-2"
                        >
                            <div className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-semibold text-primary min-w-0">
                                    <span className="text-base leading-none shrink-0" aria-hidden="true">{geo.flag}</span>
                                    <span className="truncate">{geo.country}</span>
                                    {geo.ispSummary && (
                                        <span className="text-muted font-normal hidden sm:inline truncate max-w-xs text-xs">
                                            · {geo.ispSummary}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 font-mono shrink-0">
                                    <span className="font-semibold text-primary">{geo.count}</span>
                                    <span className="text-muted text-xs w-9 text-right">{geo.percentage}%</span>
                                </div>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-stroke-soft overflow-hidden" aria-hidden="true">
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        width: `${Math.max(4, geo.percentage)}%`,
                                        background: 'var(--accent-primary)',
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
