import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '../../utils/format.js';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { Card, Row, Col, Badge, Empty, Typography, Skeleton, Space, Tooltip } from 'antd';
import {
    HiOutlineServerStack,
    HiOutlineSignal,
    HiOutlineXMark,
} from 'react-icons/hi2';

const { Text, Title } = Typography;

function getNodeColor(serverData, t) {
    if (!serverData?.online) return { tone: 'danger', dot: '#ff4d4f', label: t('pages.nodeHealth.statusOffline') };
    const cpu = serverData.status?.cpu ?? 0;
    if (cpu > 85) return { tone: 'danger', dot: '#ff4d4f', label: t('pages.nodeHealth.statusHighLoad') };
    if (cpu > 70) return { tone: 'warning', dot: '#faad14', label: t('pages.nodeHealth.statusElevated') };
    return { tone: 'success', dot: '#52c41a', label: t('pages.nodeHealth.statusHealthy') };
}

function buildSparkline(points, width = 132, height = 34, padding = 3) {
    const values = (Array.isArray(points) ? points : [])
        .map((item) => Math.max(0, Math.min(100, Number(item?.cpu || 0))));
    if (values.length === 0) return null;

    const drawableWidth = Math.max(1, width - (padding * 2));
    const drawableHeight = Math.max(1, height - (padding * 2));
    const step = values.length === 1 ? 0 : drawableWidth / (values.length - 1);
    const coords = values.map((value, index) => ({
        x: padding + (step * index),
        y: padding + (((100 - value) / 100) * drawableHeight),
    }));

    const path = coords
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(' ');
    const first = coords[0];
    const last = coords[coords.length - 1];
    const fill = `${path} L ${last.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${first.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;

    return {
        path,
        fill,
        last,
        lastValue: values[values.length - 1],
    };
}

function NodeTile({ server, serverData, trend = [] }) {
    const navigate = useNavigate();
    const { t } = useI18n();
    const color = getNodeColor(serverData, t);
    const isOnline = serverData?.online;
    const cpu = serverData?.status?.cpu ?? 0;
    const mem = serverData?.status?.mem;
    const memPercent = mem ? ((mem.current / mem.total) * 100) : 0;
    const trafficReady = serverData?.managedTrafficReady === true;
    const traffic = trafficReady ? Number(serverData?.managedTrafficTotal || 0) : null;
    const remarkPreview = Array.isArray(serverData?.nodeRemarkPreview)
        ? serverData.nodeRemarkPreview
        : Array.isArray(serverData?.nodeRemarks)
            ? serverData.nodeRemarks.slice(0, 2)
            : [];
    const extraRemarkCount = Math.max(0, Number(serverData?.nodeRemarkCount || 0) - remarkPreview.length);
    const remarksTitle = Array.isArray(serverData?.nodeRemarks) ? serverData.nodeRemarks.join(' / ') : '';
    const statusLabel = `${server.name} — ${color.label}`;
    const sparkline = buildSparkline(trend);
    
    const handleOpen = () => navigate('/settings?tab=console');
    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpen();
        }
    };

    return (
        <Col xs={24} sm={12} md={12} lg={8} xl={6}>
            <Card
                hoverable
                onClick={handleOpen}
                onKeyDown={handleKeyDown}
                tabIndex={0}
                aria-label={statusLabel}
                style={{ 
                    borderColor: color.dot, 
                    borderWidth: 1, 
                    height: '100%', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    background: 'var(--surface-overlay)' 
                }}
                bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' }}
            >
                <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                    <Space align="start">
                        {isOnline ? (
                            <HiOutlineSignal style={{ color: color.dot, fontSize: '20px' }} />
                        ) : (
                            <HiOutlineXMark style={{ color: color.dot, fontSize: '20px' }} />
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <Text strong style={{ fontSize: '16px' }}>{server.name}</Text>
                            {remarkPreview.length > 0 && (
                                <Tooltip title={remarksTitle}>
                                    <Space size={4} wrap>
                                        {remarkPreview.map((remark) => (
                                            <Badge key={`${server.id}-${remark}`} count={remark} style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--text-muted)' }} />
                                        ))}
                                        {extraRemarkCount > 0 && (
                                            <Badge count={`+${extraRemarkCount}`} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)' }} />
                                        )}
                                    </Space>
                                </Tooltip>
                            )}
                        </div>
                    </Space>
                    <Badge color={color.dot} text={<Text style={{ color: color.dot }}>{color.label}</Text>} />
                </Row>

                {isOnline ? (
                    <Row gutter={[16, 16]} style={{ flex: 1, marginBottom: sparkline ? 16 : 0 }}>
                        <Col span={12}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{t('pages.nodeHealth.cpu')}</Text>
                            <div style={{ color: cpu > 70 ? '#faad14' : 'inherit', fontWeight: 'bold' }}>{cpu.toFixed(1)}%</div>
                        </Col>
                        <Col span={12}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{t('pages.nodeHealth.memory')}</Text>
                            <div style={{ color: memPercent > 80 ? '#faad14' : 'inherit', fontWeight: 'bold' }}>{memPercent.toFixed(1)}%</div>
                        </Col>
                        <Col span={12}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{t('pages.nodeHealth.onlineUsers')}</Text>
                            <div style={{ fontWeight: 'bold' }}>{serverData?.managedOnlineCount ?? serverData?.onlineCount ?? 0}</div>
                        </Col>
                        <Col span={12}>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{t('pages.nodeHealth.traffic')}</Text>
                            <div style={{ fontWeight: 'bold' }}>{trafficReady ? formatBytes(traffic) : '--'}</div>
                        </Col>
                    </Row>
                ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', color: '#ff4d4f' }}>
                        {serverData?.error || t('pages.nodeHealth.unreachable')}
                    </div>
                )}

                {sparkline && isOnline && (
                    <div style={{ position: 'relative', height: 40, marginTop: 'auto' }} aria-hidden="true">
                        <div style={{ position: 'absolute', top: -10, right: 0, fontSize: '10px' }}>
                            <Text type="secondary">{t('pages.nodeHealth.cpuSamples')} </Text>
                            <Text strong>{sparkline.lastValue.toFixed(1)}%</Text>
                        </div>
                        <svg viewBox="0 0 132 34" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                            <path d={sparkline.fill} fill={`${color.dot}20`} />
                            <path d={sparkline.path} stroke={color.dot} strokeWidth="1.5" fill="none" />
                            <circle cx={sparkline.last.x} cy={sparkline.last.y} r="2.6" fill={color.dot} />
                        </svg>
                    </div>
                )}
            </Card>
        </Col>
    );
}

function SkeletonTile() {
    return (
        <Col xs={24} sm={12} md={12} lg={8} xl={6}>
            <Card style={{ height: '100%', background: 'var(--surface-overlay)' }} bodyStyle={{ padding: '16px' }}>
                <Row justify="space-between" style={{ marginBottom: 16 }}>
                    <Space>
                        <Skeleton.Avatar active size="small" shape="square" />
                        <Skeleton.Input active size="small" style={{ width: 80 }} />
                    </Space>
                    <Skeleton.Button active size="small" style={{ width: 50, borderRadius: 10 }} />
                </Row>
                <Row gutter={[16, 16]}>
                    {[1, 2, 3, 4].map(i => (
                        <Col span={12} key={i}>
                            <Skeleton.Input active size="small" style={{ width: '100%', height: 16, marginBottom: 4 }} />
                            <Skeleton.Input active size="small" style={{ width: '60%', height: 20 }} />
                        </Col>
                    ))}
                </Row>
            </Card>
        </Col>
    );
}

export default function NodeHealthGrid({ servers, serverStatuses, trendHistory = {} }) {
    const { t } = useI18n();

    if (!servers || servers.length === 0) {
        return (
            <Card style={{ textAlign: 'center', padding: '40px 0', background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
                <Empty
                    image={<HiOutlineServerStack style={{ fontSize: 48, color: 'var(--text-muted)', margin: '0 auto' }} />}
                    description={
                        <Typography.Text type="secondary">
                            {t('pages.nodeHealth.empty')}
                        </Typography.Text>
                    }
                />
            </Card>
        );
    }

    const hasStatuses = serverStatuses && Object.keys(serverStatuses).length > 0;

    return (
        <Row gutter={[16, 16]}>
            {servers.map(server => (
                hasStatuses ? (
                    <NodeTile
                        key={server.id}
                        server={server}
                        serverData={serverStatuses?.[server.id]}
                        trend={trendHistory?.[server.id] || []}
                    />
                ) : (
                    <SkeletonTile key={server.id} />
                )
            ))}
        </Row>
    );
}
