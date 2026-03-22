import React, { useMemo } from 'react';
import { Tag, Typography, Space, Row, Col, Badge } from 'antd';
import MiniSparkline from '../UI/MiniSparkline.jsx';
import { formatTimeOnly } from '../../utils/format.js';

const { Text } = Typography;

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
        <div style={{ padding: '8px 0' }}>
            <Row gutter={[8, 8]} align="middle">
                <Col span={12}>
                    <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: '11px' }}>{copy.rtt}</Text>
                        <Text strong style={{ fontSize: '13px' }}>
                            {loading ? copy.pending : (hasCurrentLatency ? `${currentLatency} ms` : '--')}
                        </Text>
                    </Space>
                </Col>
                <Col span={12}>
                    <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: '11px' }}>{copy.uptime}</Text>
                        <Text strong style={{ fontSize: '13px' }}>
                            {Number.isFinite(uptimePercent) ? `${uptimePercent}%` : '--'}
                        </Text>
                    </Space>
                </Col>
            </Row>

            <div style={{ margin: '8px 0' }}>
                <MiniSparkline
                    points={trend}
                    tone={tone}
                    width={130}
                    height={34}
                />
            </div>

            <Row align="middle" justify="space-between">
                <Col>
                    <Badge 
                        status={!sampled ? 'warning' : (online ? 'success' : 'error')} 
                        text={<Text style={{ fontSize: '12px' }}>{!sampled ? copy.pending : (online ? copy.online : copy.offline)}</Text>}
                    />
                </Col>
                <Col>
                    <Text type="secondary" style={{ fontSize: '11px' }}>
                        {copy.checkedAt} {telemetry?.checkedAt ? formatTimeOnly(telemetry.checkedAt, locale) : '--'}
                    </Text>
                </Col>
            </Row>
        </div>
    );
}
