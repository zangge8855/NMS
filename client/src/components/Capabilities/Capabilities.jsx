import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineCircleStack } from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import EmptyState from '../UI/EmptyState.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

function getCapabilitiesCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            refresh: 'Refresh',
            toolbarSummary: (protocolCount, toolCount) => `Protocols ${protocolCount} · Tools ${toolCount}`,
            selectServerTitle: 'Select a server first',
            selectServerSubtitle: 'Capability probing only works in a single-node view. Switch to a specific node first.',
            loadingTitle: 'Loading...',
            noDataTitle: 'No capability data yet',
            noDataSubtitle: 'Capability results will appear after you switch to a specific node.',
            protocolSectionTitle: 'Protocol Naming Alignment',
            protocolCount: (count) => `${count} protocols`,
            noProtocols: 'No inbound protocols detected',
            legacyKeysLabel: (keys) => `Legacy aliases: ${keys.join(', ')}`,
            noLegacyKeys: 'No legacy aliases',
            matrixSectionTitle: 'Official Capability Matrix',
            matrixColumns: {
                capability: 'Capability',
                support: '3x-ui',
                status: 'NMS Status',
                entry: 'Entry',
                note: 'Notes',
            },
            toolsSectionTitle: 'Tools and Interfaces',
            toolsColumns: {
                tool: 'Tool',
                availability: 'Node Availability',
                status: 'NMS Status',
                entry: 'Entry',
                source: 'Source',
            },
            batchSectionTitle: 'Batch Action Support',
            clientBatch: 'User Batch Actions',
            inboundBatch: 'Inbound Batch Actions',
            subscriptionModesTitle: 'Subscription Aggregation Modes',
            docsLink: 'Official Docs',
            noMatrixTitle: 'No matrix entries',
            noMatrixSubtitle: 'This node did not return any system capability modules.',
            noToolsTitle: 'No tool entries',
            noToolsSubtitle: 'This node did not return any tool or interface capability results.',
            availability: {
                available: 'Available',
                unavailable: 'Unavailable',
                unprobed: 'Unprobed',
            },
            support: {
                supported: 'Supported',
                missing: 'Not Integrated',
            },
            alignment: {
                integrated: 'Integrated',
                apiAvailableUiMissing: 'API Available / UI Missing',
                guidedOnly: 'Guided Only',
                unsupported: 'Intentionally Unsupported',
                unknown: 'Unknown',
            },
            source: {
                probed: 'Probed',
                unprobed: 'Unprobed',
            },
            fetchFailed: 'Failed to load capability data',
        };
    }

    return {
        refresh: '刷新',
        toolbarSummary: (protocolCount, toolCount) => `协议 ${protocolCount} · 工具 ${toolCount}`,
        selectServerTitle: '请先选择一台服务器',
        selectServerSubtitle: '能力探测仅支持单节点视图，请先切换到具体节点。',
        loadingTitle: '加载中...',
        noDataTitle: '暂无能力数据',
        noDataSubtitle: '切换到具体节点后会显示当前节点的能力探测结果。',
        protocolSectionTitle: '协议命名对齐',
        protocolCount: (count) => `${count} 种`,
        noProtocols: '未检测到入站协议',
        legacyKeysLabel: (keys) => `兼容旧命名: ${keys.join(', ')}`,
        noLegacyKeys: '无旧命名兼容项',
        matrixSectionTitle: '官方能力矩阵',
        matrixColumns: {
            capability: '能力',
            support: '3x-ui',
            status: 'NMS 状态',
            entry: '入口',
            note: '说明',
        },
        toolsSectionTitle: '工具与接口',
        toolsColumns: {
            tool: '工具',
            availability: '节点可用性',
            status: 'NMS 状态',
            entry: '入口',
            source: '来源',
        },
        batchSectionTitle: '批量动作支持',
        clientBatch: '用户批量',
        inboundBatch: '入站批量',
        subscriptionModesTitle: '订阅聚合模式',
        docsLink: '官方文档',
        noMatrixTitle: '暂无能力矩阵数据',
        noMatrixSubtitle: '当前节点暂未返回系统模块能力信息。',
        noToolsTitle: '暂无工具能力数据',
        noToolsSubtitle: '当前节点暂未返回工具与接口探测结果。',
        availability: {
            available: '可用',
            unavailable: '不可用',
            unprobed: '未探测',
        },
        support: {
            supported: '已支持',
            missing: '未接入',
        },
        alignment: {
            integrated: '已集成',
            apiAvailableUiMissing: 'API 可达 / UI 缺失',
            guidedOnly: '仅文档引导',
            unsupported: '明确不接入',
            unknown: '未知',
        },
        source: {
            probed: '已探测',
            unprobed: '未探测',
        },
        fetchFailed: '获取能力信息失败',
    };
}

function renderAvailability(value, copy) {
    if (value === true) return <span className="badge badge-success">{copy.availability.available}</span>;
    if (value === false) return <span className="badge badge-danger">{copy.availability.unavailable}</span>;
    return <span className="badge badge-neutral">{copy.availability.unprobed}</span>;
}

function renderBooleanSupport(value, copy) {
    return value ? <span className="badge badge-success">{copy.support.supported}</span> : <span className="badge badge-warning">{copy.support.missing}</span>;
}

function renderAlignmentStatus(value, copy) {
    if (value === 'integrated') return <span className="badge badge-success">{copy.alignment.integrated}</span>;
    if (value === 'api_available_ui_missing') return <span className="badge badge-warning">{copy.alignment.apiAvailableUiMissing}</span>;
    if (value === 'guided_only') return <span className="badge badge-neutral">{copy.alignment.guidedOnly}</span>;
    if (value === 'intentionally_unsupported') return <span className="badge badge-danger">{copy.alignment.unsupported}</span>;
    return <span className="badge badge-neutral">{copy.alignment.unknown}</span>;
}

function renderProbeSource(source, copy) {
    if (source === 'probed') return copy.source.probed;
    if (source === 'unprobed') return copy.source.unprobed;
    return source || '-';
}

export default function Capabilities() {
    const { activeServerId } = useServer();
    const { locale, t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const hasTargetServer = Boolean(activeServerId && activeServerId !== 'global');
    const copy = useMemo(() => getCapabilitiesCopy(locale), [locale]);

    const fetchCapabilities = async () => {
        if (!hasTargetServer) {
            setData(null);
            return;
        }
        setLoading(true);
        try {
            const res = await api.get(`/capabilities/${activeServerId}`);
            setData(res.data?.obj || null);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.fetchFailed;
            toast.error(msg);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (!hasTargetServer) {
            setData(null);
            return;
        }
        fetchCapabilities();
    }, [activeServerId, hasTargetServer]);

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

    if (!hasTargetServer) {
        return (
            <>
                <Header title={t('pages.capabilities.title')} />
                <div className="page-content page-enter">
                    <EmptyState
                        title={copy.selectServerTitle}
                        subtitle={copy.selectServerSubtitle}
                        icon={<HiOutlineCircleStack style={{ fontSize: '48px' }} />}
                        surface
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <Header title={t('pages.capabilities.title')} />
            <div className="page-content page-enter">
                <PageToolbar
                    className="card mb-6 capabilities-toolbar"
                    compact
                    actions={(
                        <button className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={loading}>
                            <HiOutlineArrowPath className={loading ? 'spinning' : ''} /> {copy.refresh}
                        </button>
                    )}
                    meta={<span>{copy.toolbarSummary(protocolList.length, toolEntries.length)}</span>}
                />
                {!data ? (
                    <EmptyState
                        title={loading ? copy.loadingTitle : copy.noDataTitle}
                        subtitle={copy.noDataSubtitle}
                        surface
                    />
                ) : (
                    <>
                        <div className="card mb-8">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title={copy.protocolSectionTitle}
                                meta={<span className="text-sm text-muted">{copy.protocolCount(protocolList.length)}</span>}
                            />
                            {protocolList.length === 0 ? (
                                <div className="text-sm text-muted">{copy.noProtocols}</div>
                            ) : (
                                <div className="capability-protocol-grid">
                                    {protocolList.map((item) => (
                                        <div key={item.key} className="capability-protocol-card">
                                            <div className="capability-card-head">
                                                <strong>{item.label}</strong>
                                                <span className="badge badge-info">{item.key}</span>
                                            </div>
                                            <div className="text-xs text-muted">
                                                {Array.isArray(item.legacyKeys) && item.legacyKeys.length > 0
                                                    ? copy.legacyKeysLabel(item.legacyKeys)
                                                    : copy.noLegacyKeys}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="card mb-8">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title={copy.matrixSectionTitle}
                            />
                            {systemModules.length === 0 ? (
                                <div className="p-4">
                                    <EmptyState
                                        title={copy.noMatrixTitle}
                                        subtitle={copy.noMatrixSubtitle}
                                        size="compact"
                                        hideIcon
                                    />
                                </div>
                            ) : (
                                <div className="table-container">
                                    <table className="table capability-matrix-table">
                                        <thead>
                                            <tr>
                                                <th>{copy.matrixColumns.capability}</th>
                                                <th className="table-cell-center capability-support-column">{copy.matrixColumns.support}</th>
                                                <th className="table-cell-center capability-status-column">{copy.matrixColumns.status}</th>
                                                <th className="table-cell-center capability-entry-column">{copy.matrixColumns.entry}</th>
                                                <th>{copy.matrixColumns.note}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {systemModules.map((module) => (
                                                <tr key={module.key}>
                                                    <td data-label={copy.matrixColumns.capability}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span>{module.label}</span>
                                                            <a href={module.docs} target="_blank" rel="noreferrer" className="text-xs">
                                                                {copy.docsLink}
                                                            </a>
                                                        </div>
                                                    </td>
                                                    <td data-label={copy.matrixColumns.support} className="table-cell-center capability-support-cell">{renderBooleanSupport(module.supportedBy3xui === true, copy)}</td>
                                                    <td data-label={copy.matrixColumns.status} className="table-cell-center capability-status-cell">{renderAlignmentStatus(module.status, copy)}</td>
                                                    <td data-label={copy.matrixColumns.entry} className="table-cell-center capability-entry-cell">
                                                        <span className="badge badge-neutral">{module.uiActionLabel || '-'}</span>
                                                    </td>
                                                    <td data-label={copy.matrixColumns.note} className="text-sm text-muted">{module.note || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="card mb-8">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title={copy.toolsSectionTitle}
                            />
                            {toolEntries.length === 0 ? (
                                <div className="p-4">
                                    <EmptyState
                                        title={copy.noToolsTitle}
                                        subtitle={copy.noToolsSubtitle}
                                        size="compact"
                                        hideIcon
                                    />
                                </div>
                            ) : (
                                <div className="table-container">
                                    <table className="table capability-tools-table">
                                        <thead>
                                            <tr>
                                                <th>{copy.toolsColumns.tool}</th>
                                                <th className="table-cell-center capability-availability-column">{copy.toolsColumns.availability}</th>
                                                <th className="table-cell-center capability-status-column">{copy.toolsColumns.status}</th>
                                                <th className="table-cell-center capability-entry-column">{copy.toolsColumns.entry}</th>
                                                <th>{copy.toolsColumns.source}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {toolEntries.map((tool) => (
                                                <tr key={tool.key}>
                                                    <td data-label={copy.toolsColumns.tool}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span>{tool.label || tool.key}</span>
                                                            <span className="text-xs text-muted">{tool.description || '-'}</span>
                                                        </div>
                                                    </td>
                                                    <td data-label={copy.toolsColumns.availability} className="table-cell-center capability-availability-cell">{renderAvailability(tool.available, copy)}</td>
                                                    <td data-label={copy.toolsColumns.status} className="table-cell-center capability-status-cell">{renderAlignmentStatus(tool.status, copy)}</td>
                                                    <td data-label={copy.toolsColumns.entry} className="table-cell-center capability-entry-cell">
                                                        <span className="badge badge-neutral">{tool.uiActionLabel || '-'}</span>
                                                    </td>
                                                    <td data-label={copy.toolsColumns.source} className="text-sm text-muted">{renderProbeSource(tool.source, copy)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="card mb-8">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title={copy.batchSectionTitle}
                            />
                            <div className="capability-batch-grid">
                                <div className="capability-stack">
                                    <div className="text-sm text-muted mb-2">{copy.clientBatch}</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {(data.batchActions?.clients || []).map((x) => (
                                            <span key={`c-${x}`} className="badge badge-neutral">{x}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="capability-stack">
                                    <div className="text-sm text-muted mb-2">{copy.inboundBatch}</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {(data.batchActions?.inbounds || []).map((x) => (
                                            <span key={`i-${x}`} className="badge badge-neutral">{x}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title={copy.subscriptionModesTitle}
                            />
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
