/**
 * NodeHealthGrid — 节点健康状态网格
 *
 * 以色彩编码的磁贴展示每个节点的实时状态，
 * 支持 hover 显示详细信息，点击可导航到节点管理。
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '../../utils/format.js';
import {
    HiOutlineServerStack,
    HiOutlineSignal,
    HiOutlineXMark,
} from 'react-icons/hi2';

function getNodeColor(serverData) {
    if (!serverData?.online) return { bg: 'var(--accent-danger-bg)', border: 'var(--accent-danger)', dot: 'var(--accent-danger)', label: '离线' };
    const cpu = serverData.status?.cpu ?? 0;
    if (cpu > 85) return { bg: 'var(--accent-danger-bg)', border: 'var(--accent-danger)', dot: 'var(--accent-danger)', label: '高负载' };
    if (cpu > 70) return { bg: 'var(--accent-warning-bg)', border: 'var(--accent-warning)', dot: 'var(--accent-warning)', label: '负载较高' };
    return { bg: 'var(--accent-success-bg)', border: 'var(--accent-success)', dot: 'var(--accent-success)', label: '正常' };
}

function NodeTile({ server, serverData }) {
    const navigate = useNavigate();
    const color = getNodeColor(serverData);
    const isOnline = serverData?.online;
    const cpu = serverData?.status?.cpu ?? 0;
    const mem = serverData?.status?.mem;
    const memPercent = mem ? ((mem.current / mem.total) * 100) : 0;
    const traffic = (serverData?.up || 0) + (serverData?.down || 0);

    return (
        <div
            className="node-health-tile"
            onClick={() => navigate('/server')}
            title={`${server.name} — ${color.label}`}
            style={{
                border: `1px solid ${color.border}`,
                background: color.bg,
                '--node-color': color.dot,
            }}
        >
            <div className="node-health-tile-status" />

            <div className="node-health-tile-title">
                {isOnline
                    ? <HiOutlineSignal style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                    : <HiOutlineXMark style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                }
                <span className="node-health-tile-name">{server.name}</span>
            </div>

            {isOnline ? (
                <div className="node-health-tile-meta">
                    <div>
                        <div>CPU</div>
                        <div className="node-health-tile-value" style={{ color: cpu > 70 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {cpu.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div>内存</div>
                        <div className="node-health-tile-value" style={{ color: memPercent > 80 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {memPercent.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div>在线</div>
                        <div className="node-health-tile-value">
                            {serverData?.onlineCount ?? 0}
                        </div>
                    </div>
                    <div>
                        <div>流量</div>
                        <div className="node-health-tile-value">
                            {formatBytes(traffic)}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="node-health-tile-value" style={{ color: 'var(--accent-danger)', fontSize: '12px' }}>
                    {serverData?.error || '无法连接'}
                </div>
            )}
        </div>
    );
}

export default function NodeHealthGrid({ servers, serverStatuses }) {
    if (!servers || servers.length === 0) {
        return (
            <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
                <HiOutlineServerStack style={{ fontSize: '32px', color: 'var(--text-muted)', marginBottom: '8px' }} />
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>暂无节点</div>
            </div>
        );
    }

    return (
        <div className="node-health-grid">
            {servers.map(server => (
                <NodeTile
                    key={server.id}
                    server={server}
                    serverData={serverStatuses?.[server.id]}
                />
            ))}
        </div>
    );
}
