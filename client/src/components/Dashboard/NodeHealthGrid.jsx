/**
 * NodeHealthGrid — 节点健康状态网格
 *
 * 以色彩编码的磁贴展示每个节点的实时状态，
 * 支持 hover 显示详细信息，点击可导航到节点管理。
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '../../utils/format.js';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import {
    HiOutlineServerStack,
    HiOutlineSignal,
    HiOutlineXMark,
} from 'react-icons/hi2';

function getNodeColor(serverData, t) {
    if (!serverData?.online) return { tone: 'danger', dot: 'var(--accent-danger)', label: t('pages.nodeHealth.statusOffline') };
    const cpu = serverData.status?.cpu ?? 0;
    if (cpu > 85) return { tone: 'danger', dot: 'var(--accent-danger)', label: t('pages.nodeHealth.statusHighLoad') };
    if (cpu > 70) return { tone: 'warning', dot: 'var(--accent-warning)', label: t('pages.nodeHealth.statusElevated') };
    return { tone: 'success', dot: 'var(--accent-success)', label: t('pages.nodeHealth.statusHealthy') };
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
    const traffic = (serverData?.up || 0) + (serverData?.down || 0);
    const statusLabel = `${server.name} — ${color.label}`;
    const sparkline = buildSparkline(trend);
    const handleOpen = () => navigate('/server');
    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpen();
        }
    };

    return (
        <div
            className="node-health-tile"
            onClick={handleOpen}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
            aria-label={statusLabel}
            style={{
                '--node-color': color.dot,
            }}
            data-tone={color.tone}
        >
            <div className="node-health-tile-head">
                <div className="node-health-tile-title">
                    {isOnline
                        ? <HiOutlineSignal style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                        : <HiOutlineXMark style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                    }
                    <span className="node-health-tile-name">{server.name}</span>
                </div>
                <span className="node-health-tone-pill">{color.label}</span>
            </div>

            {isOnline ? (
                <div className="node-health-tile-meta">
                    <div>
                        <div>{t('pages.nodeHealth.cpu')}</div>
                        <div className="node-health-tile-value" style={{ color: cpu > 70 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {cpu.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div>{t('pages.nodeHealth.memory')}</div>
                        <div className="node-health-tile-value" style={{ color: memPercent > 80 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {memPercent.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div>{t('pages.nodeHealth.onlineUsers')}</div>
                        <div className="node-health-tile-value">
                            {serverData?.onlineCount ?? 0}
                        </div>
                    </div>
                    <div>
                        <div>{t('pages.nodeHealth.traffic')}</div>
                        <div className="node-health-tile-value">
                            {formatBytes(traffic)}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="node-health-tile-message">
                    {serverData?.error || t('pages.nodeHealth.unreachable')}
                </div>
            )}

            {sparkline && (
                <div className="node-health-sparkline-shell" aria-hidden="true">
                    <div className="node-health-sparkline-copy">
                        <span>{t('pages.nodeHealth.cpuSamples')}</span>
                        <strong>{sparkline.lastValue.toFixed(1)}%</strong>
                    </div>
                    <svg
                        className="node-health-sparkline"
                        viewBox="0 0 132 34"
                        preserveAspectRatio="none"
                    >
                        <path className="node-health-sparkline-fill" d={sparkline.fill} />
                        <path className="node-health-sparkline-path" d={sparkline.path} />
                        <circle
                            className="node-health-sparkline-dot"
                            cx={sparkline.last.x}
                            cy={sparkline.last.y}
                            r="2.6"
                        />
                    </svg>
                </div>
            )}
        </div>
    );
}

function SkeletonTile() {
    return (
        <div className="node-health-skeleton">
            <div className="node-health-skeleton-head">
                <div className="node-health-skeleton-title">
                    <div className="skeleton node-health-skeleton-bar" style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
                    <div className="skeleton node-health-skeleton-bar" style={{ width: '80px' }} />
                </div>
                <div className="skeleton node-health-skeleton-pill" />
            </div>
            <div className="node-health-skeleton-meta">
                {[1, 2, 3, 4].map(i => (
                    <div className="node-health-skeleton-metric" key={i}>
                        <div className="skeleton node-health-skeleton-metric-label" />
                        <div className="skeleton node-health-skeleton-metric-value" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function NodeHealthGrid({ servers, serverStatuses, trendHistory = {} }) {
    const { t } = useI18n();

    if (!servers || servers.length === 0) {
        return (
            <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
                <HiOutlineServerStack style={{ fontSize: '32px', color: 'var(--text-muted)', marginBottom: '8px' }} />
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('pages.nodeHealth.empty')}</div>
            </div>
        );
    }

    const hasStatuses = serverStatuses && Object.keys(serverStatuses).length > 0;

    return (
        <div className="node-health-grid">
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
        </div>
    );
}
