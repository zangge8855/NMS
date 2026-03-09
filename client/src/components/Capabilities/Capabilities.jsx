import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineCircleStack } from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';

function renderAvailability(value) {
    if (value === true) return <span className="badge badge-success">可用</span>;
    if (value === false) return <span className="badge badge-danger">不可用</span>;
    return <span className="badge badge-neutral">未探测</span>;
}

function renderBooleanSupport(value) {
    return value ? <span className="badge badge-success">已支持</span> : <span className="badge badge-warning">未接入</span>;
}

function renderAlignmentStatus(value) {
    if (value === 'integrated') return <span className="badge badge-success">已集成</span>;
    if (value === 'api_available_ui_missing') return <span className="badge badge-warning">API 可达 / UI 缺失</span>;
    if (value === 'guided_only') return <span className="badge badge-neutral">仅文档引导</span>;
    if (value === 'intentionally_unsupported') return <span className="badge badge-danger">明确不接入</span>;
    return <span className="badge badge-neutral">未知</span>;
}

function renderProbeSource(source) {
    if (source === 'probed') return '已探测';
    if (source === 'unprobed') return '未探测';
    return source || '-';
}

export default function Capabilities() {
    const { activeServerId } = useServer();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);

    const fetchCapabilities = async () => {
        if (!activeServerId) return;
        setLoading(true);
        try {
            const res = await api.get(`/capabilities/${activeServerId}`);
            setData(res.data?.obj || null);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '获取能力信息失败';
            toast.error(msg);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchCapabilities();
    }, [activeServerId]);

    const protocolList = useMemo(
        () => (Array.isArray(data?.protocolDetails) ? data.protocolDetails : []),
        [data]
    );

    const toolEntries = useMemo(() => {
        if (!data?.tools || typeof data.tools !== 'object') return [];
        return Object.values(data.tools);
    }, [data]);

    const systemModules = useMemo(
        () => (Array.isArray(data?.systemModules) ? data.systemModules : []),
        [data]
    );

    if (!activeServerId) {
        return (
            <>
                <Header title="3x-ui 能力" />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineCircleStack /></div>
                        <div className="empty-state-text">请先选择一台服务器</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header title="3x-ui 能力" />
            <div className="page-content page-enter">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>3x-ui 对齐矩阵</h2>
                        <p className="text-sm text-muted mt-1">
                            展示当前节点的协议、工具接口与官方能力在 NMS 中的接入状态
                        </p>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={loading}>
                        <HiOutlineArrowPath className={loading ? 'spinning' : ''} /> 刷新
                    </button>
                </div>

                {!data ? (
                    <div className="card text-center" style={{ padding: '36px' }}>
                        {loading ? '加载中...' : '暂无能力数据'}
                    </div>
                ) : (
                    <>
                        <div className="card mb-8">
                            <div className="card-header">
                                <span className="card-title">协议命名对齐</span>
                                <span className="text-sm text-muted">{protocolList.length} 种</span>
                            </div>
                            {protocolList.length === 0 ? (
                                <div className="text-sm text-muted">未检测到入站协议</div>
                            ) : (
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                        gap: '12px',
                                    }}
                                >
                                    {protocolList.map((item) => (
                                        <div
                                            key={item.key}
                                            style={{
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)',
                                                padding: '12px',
                                                background: 'var(--surface-soft)',
                                            }}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <strong>{item.label}</strong>
                                                <span className="badge badge-info">{item.key}</span>
                                            </div>
                                            <div className="text-xs text-muted">
                                                {Array.isArray(item.legacyKeys) && item.legacyKeys.length > 0
                                                    ? `兼容旧命名: ${item.legacyKeys.join(', ')}`
                                                    : '无旧命名兼容项'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="card mb-8">
                            <div className="card-header">
                                <span className="card-title">官方能力矩阵</span>
                            </div>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>能力</th>
                                            <th>3x-ui</th>
                                            <th>NMS 状态</th>
                                            <th>入口</th>
                                            <th>说明</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {systemModules.length === 0 ? (
                                            <tr><td colSpan={5} className="text-center">暂无数据</td></tr>
                                        ) : systemModules.map((module) => (
                                            <tr key={module.key}>
                                                <td data-label="能力">
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span>{module.label}</span>
                                                        <a href={module.docs} target="_blank" rel="noreferrer" className="text-xs">
                                                            官方文档
                                                        </a>
                                                    </div>
                                                </td>
                                                <td data-label="3x-ui">{renderBooleanSupport(module.supportedBy3xui === true)}</td>
                                                <td data-label="NMS 状态">{renderAlignmentStatus(module.status)}</td>
                                                <td data-label="入口">
                                                    <span className="badge badge-neutral">{module.uiActionLabel || '-'}</span>
                                                </td>
                                                <td data-label="说明" className="text-sm text-muted">{module.note || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="card mb-8">
                            <div className="card-header">
                                <span className="card-title">工具与接口</span>
                            </div>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>工具</th>
                                            <th>节点可用性</th>
                                            <th>NMS 状态</th>
                                            <th>入口</th>
                                            <th>来源</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {toolEntries.length === 0 ? (
                                            <tr><td colSpan={5} className="text-center">暂无数据</td></tr>
                                        ) : toolEntries.map((tool) => (
                                            <tr key={tool.key}>
                                                <td data-label="工具">
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span>{tool.label || tool.key}</span>
                                                        <span className="text-xs text-muted">{tool.description || '-'}</span>
                                                    </div>
                                                </td>
                                                <td data-label="节点可用性">{renderAvailability(tool.available)}</td>
                                                <td data-label="NMS 状态">{renderAlignmentStatus(tool.status)}</td>
                                                <td data-label="入口">
                                                    <span className="badge badge-neutral">{tool.uiActionLabel || '-'}</span>
                                                </td>
                                                <td data-label="来源" className="text-sm text-muted">{renderProbeSource(tool.source)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="card mb-8">
                            <div className="card-header">
                                <span className="card-title">批量动作支持</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <div className="text-sm text-muted mb-2">用户批量</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {(data.batchActions?.clients || []).map((x) => (
                                            <span key={`c-${x}`} className="badge badge-neutral">{x}</span>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-sm text-muted mb-2">入站批量</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {(data.batchActions?.inbounds || []).map((x) => (
                                            <span key={`i-${x}`} className="badge badge-neutral">{x}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-header">
                                <span className="card-title">订阅聚合模式</span>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {(data.subscriptionModes || []).map((mode) => (
                                    <span key={mode} className="badge badge-success">{mode}</span>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
