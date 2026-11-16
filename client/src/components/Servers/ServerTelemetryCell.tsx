import React, { useMemo } from 'react';
import MiniSparkline from '../UI/MiniSparkline';
import { formatTimeOnly } from '../../utils/format';

function getCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            rtt: 'RTT',
            uptime: '24h up',
            checkedAt: 'Checked',
            pending: 'Sampling',
        };
    }
    return {
        rtt: 'RTT',
        uptime: '24h 在线',
        checkedAt: '采样',
        pending: '采样中',
    };
}

function normalizeLatencyTrend(telemetry) {
    return Array.isArray(telemetry?.latencyTrend) ? telemetry.latencyTrend : [];
}

function ServerTelemetryCell({
    telemetry = null,
    loading = false,
    locale = 'zh-CN',
}) {
    const copy = getCopy(locale);
    const trend = useMemo(() => normalizeLatencyTrend(telemetry), [telemetry]);
    const sampledPoints = useMemo(
        () => trend.filter((value) => value !== null && value !== '' && Number.isFinite(Number(value))).length,
        [trend]
    );
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
                            : (hasCurrentLatency ? `${currentLatency} ms` : '—')}
                    </span>
                </div>
                <div className="servers-telemetry-metric">
                    <span className="servers-telemetry-label">{copy.uptime}</span>
                    <span className="servers-telemetry-value">
                        {Number.isFinite(uptimePercent) ? `${uptimePercent}%` : '—'}
                    </span>
                </div>
            </div>

            {/* A single sample is a dot, not a trend; draw the line from two on.
                Online/offline lives in the status column, so it is not repeated here. */}
            {sampledPoints >= 2 ? (
                <MiniSparkline
                    className="servers-telemetry-sparkline"
                    points={trend}
                    tone={tone}
                    width={130}
                    height={34}
                />
            ) : null}

            <div className="servers-telemetry-foot">
                <span className="servers-telemetry-checked-at">
                    {sampled
                        ? `${copy.checkedAt} ${formatTimeOnly(telemetry.checkedAt, locale)}`
                        : copy.pending}
                </span>
            </div>
        </div>
    );
}

export default React.memo(ServerTelemetryCell);
