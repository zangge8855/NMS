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

    const protocolList = useMemo(() => (
        Array.isArray(data?.protocols) ? data.protocols : []
    ), [data]);

    const toolEntries = useMemo(() => {
        if (!data?.tools || typeof data.tools !== 'object') return [];
        return Object.entries(data.tools);
    }, [data]);

    const systemModules = useMemo(() => {
        if (!data) return [];
        const hasX25519 = data.tools?.x25519?.available === true;
        const hasEch = data.tools?.echCert?.available === true || data.tools?.echCert?.available === null;
        const fallback = [
            {
                key: 'ssl',
                title: 'SSL / 证书',
                status: hasEch ? '可配置' : '需手工',
                description: '证书生成与 HTTPS 相关能力，建议结合反向代理统一管理。',
                link: 'https://github.com/MHSanaei/3x-ui/wiki/SSL-Certificate',
            },
            {
                key: 'fail2ban',
                title: 'Fail2Ban',
                status: '需手工',
                description: '系统级防爆破策略，建议按节点部署并定期核验日志规则。',
                link: 'https://github.com/MHSanaei/3x-ui/wiki/Fail2ban',
            },
            {
                key: 'warp',
                title: 'Cloudflare WARP',
                status: '需手工',
                description: '网络级能力，不建议直接在面板执行高风险变更。',
                link: 'https://github.com/MHSanaei/3x-ui/wiki/Cloudflare-WARP',
            },
            {
                key: 'tor',
                title: 'TOR Proxy',
                status: '需手工',
                description: '出口代理能力，建议先在测试节点验证后灰度上线。',
                link: 'https://github.com/MHSanaei/3x-ui/wiki/TOR-Proxy',
            },
            {
                key: 'reverse',
                title: 'Reverse Proxy',
                status: hasX25519 ? '可配置' : '需手工',
                description: '建议通过 Nginx/Caddy 统一入口并配置健康检查。',
                link: 'https://github.com/MHSanaei/3x-ui/wiki/Reverse-Proxy',
            },
            {
                key: 'env',
                title: 'Environment',
                status: '需手工',
                description: '环境变量与系统参数建议由运维流水线托管。',
                link: 'https://github.com/MHSanaei/3x-ui/wiki/Environment-Variables',
            },
        ];
        if (Array.isArray(data.systemModules) && data.systemModules.length > 0) {
            return data.systemModules.map((item) => ({
                key: item.key,
                title: item.label || item.key,
                status: item.mode === 'integrated' ? '已集成' : '可引导',
                description: '按官方文档执行，建议先在测试节点验证后上线。',
                link: item.docs,
            }));
        }
        return fallback;
    }, [data]);

    if (!activeServerId) {
        return (
            <>
                <Header title="系统能力" />
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
            <Header title="系统能力" />
            <div className="page-content page-enter">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>节点能力总览</h2>
                        <p className="text-sm text-muted mt-1">
                            基于当前节点实时探测，反映可用 API、协议与系统模块接入状态
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
                                <span className="card-title">协议支持</span>
                                <span className="text-sm text-muted">{protocolList.length} 种</span>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {protocolList.length === 0 ? (
                                    <span className="text-sm text-muted">未检测到入站协议</span>
                                ) : protocolList.map((item) => (
                                    <span key={item} className="badge badge-info">{item}</span>
                                ))}
                            </div>
                        </div>

                        <div className="card mb-8">
                            <div className="card-header">
                                <span className="card-title">系统模块对齐 (官方能力)</span>
                            </div>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                    gap: '12px',
                                }}
                            >
                                {systemModules.map((module) => (
                                    <div
                                        key={module.key}
                                        style={{
                                            border: '1px solid var(--border-color)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: '12px',
                                            background: 'var(--surface-soft)',
                                        }}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <strong>{module.title}</strong>
                                            <span className="badge badge-neutral">{module.status}</span>
                                        </div>
                                        <div className="text-sm text-muted mb-3">{module.description}</div>
                                        <a
                                            href={module.link}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="btn btn-secondary btn-sm"
                                        >
                                            官方文档
                                        </a>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="card mb-8">
                            <div className="card-header">
                                <span className="card-title">工具 API 探测</span>
                            </div>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>工具</th>
                                            <th>状态</th>
                                            <th>来源</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {toolEntries.length === 0 ? (
                                            <tr><td colSpan={3} className="text-center">暂无数据</td></tr>
                                        ) : toolEntries.map(([tool, detail]) => (
                                            <tr key={tool}>
                                                <td>{tool}</td>
                                                <td>{renderAvailability(detail?.available)}</td>
                                                <td>{renderProbeSource(detail?.source)}</td>
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
