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
                background: color.bg,
                border: `1px solid ${color.border}`,
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
                position: 'relative',
                overflow: 'hidden',
                minWidth: 0,
            }}
            onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 4px 16px ${color.border}40`;
            }}
            onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
            }}
        >
            {/* 状态点 */}
            <div style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: color.dot,
                boxShadow: isOnline ? `0 0 6px ${color.dot}` : 'none',
                animation: isOnline ? undefined : 'none',
            }} />

            {/* 节点名称 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '10px',
            }}>
                {isOnline
                    ? <HiOutlineSignal style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                    : <HiOutlineXMark style={{ color: color.dot, fontSize: '16px', flexShrink: 0 }} />
                }
                <span style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {server.name}
                </span>
            </div>

            {isOnline ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <div>
                        <div style={{ marginBottom: '2px' }}>CPU</div>
                        <div style={{ fontWeight: 600, color: cpu > 70 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {cpu.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div style={{ marginBottom: '2px' }}>内存</div>
                        <div style={{ fontWeight: 600, color: memPercent > 80 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                            {memPercent.toFixed(1)}%
                        </div>
                    </div>
                    <div>
                        <div style={{ marginBottom: '2px' }}>在线</div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {serverData?.onlineCount ?? 0}
                        </div>
                    </div>
                    <div>
                        <div style={{ marginBottom: '2px' }}>流量</div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {formatBytes(traffic)}
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ fontSize: '12px', color: 'var(--accent-danger)', fontWeight: 500 }}>
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
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '12px',
        }}>
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
