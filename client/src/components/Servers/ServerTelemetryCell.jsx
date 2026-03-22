import React, { useMemo } from 'react';
import MiniSparkline from '../UI/MiniSparkline.jsx';
import { formatTimeOnly } from '../../utils/format.js';

function getCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            rtt: 'RTT',
            uptime: '24h up',
            checkedAt: 'Checked',
            online: 'Online',
            offline: 'Offline',
            pending: 'Sampling',
        };
    }
    return {
        rtt: 'RTT',
        uptime: '24h 在线',
        checkedAt: '采样',
        online: '在线',
        offline: '离线',
        pending: '采样中',
    };
}

function normalizeLatencyTrend(telemetry) {
    return Array.isArray(telemetry?.latencyTrend) ? telemetry.latencyTrend : [];
}

export default function ServerTelemetryCell({
    telemetry = null,
    loading = false,
    locale = 'zh-CN',
}) {
    const copy = getCopy(locale);
    const trend = useMemo(() => normalizeLatencyTrend(telemetry), [telemetry]);
    const currentLatency = Number(telemetry?.current?.latencyMs);
    const online = telemetry?.current?.online === true;
    const sampled = Boolean(telemetry?.checkedAt);
    const hasCurrentLatency = Number.isFinite(currentLatency);
    const uptimePercent = Number(telemetry?.uptimePercent);
    const tone = sampled ? (online ? 'info' : 'danger') : 'warning';

    return (
        <div className={`servers-telemetry-cell${online ? ' is-online' : ' is-offline'}`}>
            <div className="servers-telemetry-meta">
                <div className="servers-telemetry-metric">
                    <span className="servers-telemetry-label">{copy.rtt}</span>
                    <span className="servers-telemetry-value">
                        {loading
                            ? copy.pending
                            : (hasCurrentLatency ? `${currentLatency} ms` : '--')}
                    </span>
                </div>
                <div className="servers-telemetry-metric">
                    <span className="servers-telemetry-label">{copy.uptime}</span>
                    <span className="servers-telemetry-value">
                        {Number.isFinite(uptimePercent) ? `${uptimePercent}%` : '--'}
                    </span>
                </div>
            </div>

            <MiniSparkline
                className="servers-telemetry-sparkline"
                points={trend}
                tone={tone}
                width={130}
                height={34}
            />

            <div className="servers-telemetry-foot">
                <span className={`badge ${!sampled ? 'badge-warning' : online ? 'badge-success' : 'badge-danger'}`}>
                    {!sampled ? copy.pending : online ? copy.online : copy.offline}
                </span>
                <span className="servers-telemetry-checked-at">
                    {copy.checkedAt} {telemetry?.checkedAt ? formatTimeOnly(telemetry.checkedAt, locale) : '--'}
                </span>
            </div>
        </div>
    );
}
