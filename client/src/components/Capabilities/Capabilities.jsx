import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    HiOutlineArrowPath, 
    HiOutlineCircleStack,
    HiOutlineCpuChip,
    HiOutlineDocumentText,
    HiOutlineArrowsUpDown,
    HiOutlineKey,
    HiOutlineGlobeAlt,
    HiOutlineChatBubbleLeftRight,
    HiOutlineExclamationTriangle,
    HiOutlineCube,
    HiOutlineCheckCircle,
    HiOutlineXCircle,
    HiOutlineInformationCircle,
    HiOutlineBookOpen,
    HiOutlineArrowUpRight,
} from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import EmptyState from '../UI/EmptyState.jsx';
import Table from '../UI/Table.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';
import { getErrorMessage } from '../../utils/format.js';
import { readSessionSnapshot, writeSessionSnapshot } from '../../utils/sessionSnapshot.js';

const CAPABILITIES_SNAPSHOT_TTL_MS = 2 * 60_000;

function buildCapabilitiesSnapshotKey(serverId) {
    return `capabilities_view_v1:${String(serverId || '').trim()}`;
}

function readCapabilitiesSnapshot(serverId) {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return null;

    const snapshot = readSessionSnapshot(buildCapabilitiesSnapshotKey(normalizedServerId), {
        maxAgeMs: CAPABILITIES_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;
    return snapshot?.data || null;
}

function getCapabilitiesCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            refresh: 'Refresh',
            toolbarSummary: (protocolCount, toolCount) => `Protocols ${protocolCount} · Tools ${toolCount}`,
            selectServerTitle: 'Select a server first',
            selectServerSubtitle: 'Open a specific server from Server Management to view node capabilities.',
            goToServers: 'Open Servers',
            loadingTitle: 'Loading...',
            noDataTitle: 'No capability data yet',
            noDataSubtitle: 'Capability results will appear after this node returns probe data.',
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
            dashboardTitle: 'Capability Overview',
            complianceLabel: 'API Compliance Score',
            modulesLabel: 'System Modules',
            modulesDesc: (active, total) => `${active} of ${total} modules integrated`,
            toolsLabel: 'API Health Rate',
            toolsDesc: (active, total) => `${active} of ${total} endpoints active`,
            protocolsLabel: 'Active Protocols',
            protocolsDesc: (count) => `${count} protocol types online`,
        };
    }

    return {
        refresh: '刷新',
        toolbarSummary: (protocolCount, toolCount) => `协议 ${protocolCount} · 工具 ${toolCount}`,
        selectServerTitle: '请先选择一台服务器',
        selectServerSubtitle: '请从服务器管理进入某台服务器详情后查看节点能力。',
        goToServers: '前往服务器管理',
        loadingTitle: '加载中...',
        noDataTitle: '暂无能力数据',
        noDataSubtitle: '当前节点返回能力探测结果后会显示在这里。',
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
        dashboardTitle: '能力大盘概览',
        complianceLabel: 'API 兼容性评分',
        modulesLabel: '系统模块对齐率',
        modulesDesc: (active, total) => `已集成 ${active} / ${total} 个系统模块`,
        toolsLabel: 'API 接口探测率',
        toolsDesc: (active, total) => `已激活 ${active} / ${total} 个探测端点`,
        protocolsLabel: '运行中协议',
        protocolsDesc: (count) => `当前在线 ${count} 种协议类型`,
    };
}

function renderAvailability(value, copy) {
    if (value === true) {
        return (
            <span className="cap-status-pill cap-status-pill--success">
                <HiOutlineCheckCircle className="text-sm" />
                {copy.availability.available}
            </span>
        );
    }
    if (value === false) {
        return (
            <span className="cap-status-pill cap-status-pill--danger">
                <HiOutlineXCircle className="text-sm" />
                {copy.availability.unavailable}
            </span>
        );
    }
    return (
        <span className="cap-status-pill cap-status-pill--neutral">
            <HiOutlineInformationCircle className="text-sm" />
            {copy.availability.unprobed}
        </span>
    );
}

function renderBooleanSupport(value, copy) {
    if (value) {
        return (
            <span className="cap-status-pill cap-status-pill--success">
                <HiOutlineCheckCircle className="text-sm" />
                {copy.support.supported}
            </span>
        );
    }
    return (
        <span className="cap-status-pill cap-status-pill--warning">
            <HiOutlineXCircle className="text-sm" />
            {copy.support.missing}
        </span>
    );
}

function renderAlignmentStatus(value, copy) {
    if (value === 'integrated') {
        return (
            <span className="cap-status-pill cap-status-pill--success">
                <HiOutlineCheckCircle className="text-sm" />
                {copy.alignment.integrated}
            </span>
        );
    }
    if (value === 'api_available_ui_missing') {
        return (
            <span className="cap-status-pill cap-status-pill--warning">
                <HiOutlineInformationCircle className="text-sm" />
                {copy.alignment.apiAvailableUiMissing}
            </span>
        );
    }
    if (value === 'guided_only') {
        return (
            <span className="cap-status-pill cap-status-pill--neutral">
                <HiOutlineBookOpen className="text-sm" />
                {copy.alignment.guidedOnly}
            </span>
        );
    }
    if (value === 'intentionally_unsupported') {
        return (
            <span className="cap-status-pill cap-status-pill--danger">
                <HiOutlineXCircle className="text-sm" />
                {copy.alignment.unsupported}
            </span>
        );
    }
    return (
        <span className="cap-status-pill cap-status-pill--neutral">
            <HiOutlineInformationCircle className="text-sm" />
            {copy.alignment.unknown}
        </span>
    );
}

function renderProbeSource(source, copy) {
    if (source === 'probed') return copy.source.probed;
    if (source === 'unprobed') return copy.source.unprobed;
    return source || '-';
}

function getModuleIcon(key) {
    const props = { style: { fontSize: '18px', marginRight: '8px', flexShrink: 0 } };
    switch (key) {
        case 'xrayVersion':
            return <HiOutlineCpuChip {...props} className="text-primary" />;
        case 'xrayConfig':
            return <HiOutlineDocumentText {...props} className="text-info" />;
        case 'xrayRouting':
            return <HiOutlineArrowsUpDown {...props} className="text-success" />;
        case 'twoFactor':
            return <HiOutlineKey {...props} className="text-warning" />;
        case 'databaseManagement':
        case 'dbExport':
        case 'dbImport':
            return <HiOutlineCircleStack {...props} className="text-secondary" />;
        case 'geofile':
        case 'geofileUpdate':
            return <HiOutlineGlobeAlt {...props} className="text-info" />;
        case 'telegramBackup':
        case 'telegramBot':
        case 'telegramBackupTrigger':
            return <HiOutlineChatBubbleLeftRight {...props} className="text-primary" />;
        case 'panelSelfUpdate':
            return <HiOutlineArrowPath {...props} className="text-warning" />;
        case 'xrayRuntimeMetrics':
            return <HiOutlineCube {...props} className="text-success" />;
        case 'panelWebBasePath':
        case 'panelCertificatePath':
            return <HiOutlineKey {...props} className="text-muted" />;
        case 'cloudflareWarp':
            return <HiOutlineGlobeAlt {...props} className="text-muted" />;
        case 'fail2ban':
            return <HiOutlineExclamationTriangle {...props} className="text-danger" />;
        // Tools cases
        case 'uuid':
            return <HiOutlineKey {...props} className="text-primary" />;
        case 'x25519':
        case 'mldsa65':
        case 'mlkem768':
        case 'vlessEnc':
        case 'echCert':
        case 'apiLogin':
            return <HiOutlineKey {...props} className="text-warning" />;
        case 'panelLogs':
        case 'xrayLogs':
            return <HiOutlineDocumentText {...props} className="text-info" />;
        case 'panelUpdateInfo':
            return <HiOutlineCpuChip {...props} className="text-secondary" />;
        case 'xrayMetricsState':
        case 'xrayObservatory':
            return <HiOutlineCube {...props} className="text-success" />;
        case 'customGeoResources':
            return <HiOutlineGlobeAlt {...props} className="text-muted" />;
        // Inbounds and Client API groups
        case 'inboundList':
        case 'inboundGet':
        case 'inboundAdd':
        case 'inboundUpdate':
        case 'inboundDel':
        case 'inboundOnlines':
            return <HiOutlineArrowsUpDown {...props} className="text-success" />;
        case 'inboundAddClient':
        case 'inboundUpdateClient':
        case 'inboundDelClient':
        case 'inboundClientIps':
        case 'inboundClearClientIps':
            return <HiOutlineCube {...props} className="text-info" />;
        case 'v3ClientAdd':
        case 'v3ClientUpdate':
        case 'v3ClientDel':
        case 'v3ClientGet':
        case 'v3ClientOnlines':
        case 'v3ClientOnlinesByGuid':
        case 'v3ClientOnlinesByNode':
        case 'v3ClientLastOnline':
        case 'v3ClientIps':
        case 'v3ClientClearIps':
        case 'v3ClientAttach':
        case 'v3ClientDetach':
        case 'v3ClientBulkAdjust':
        case 'v3ClientResetTraffic':
            return <HiOutlineCpuChip {...props} className="text-primary" />;
        case 'serverStatus':
            return <HiOutlineCpuChip {...props} className="text-primary" />;
        case 'xrayVersionGet':
        case 'xrayInstall':
        case 'xrayRestart':
            return <HiOutlineCpuChip {...props} className="text-warning" />;
        default:
            return <HiOutlineCube {...props} className="text-muted" />;
    }
}

export default function Capabilities({ serverId = '', embedded = false } = {}) {
    const { activeServerId } = useServer();
    const { locale, t } = useI18n();
    const navigate = useNavigate();
    const targetServerId = useMemo(() => {
        const normalized = String(serverId || activeServerId || '').trim();
        return normalized && normalized !== 'global' ? normalized : '';
    }, [activeServerId, serverId]);
    const hasTargetServer = Boolean(targetServerId);
    const copy = useMemo(() => getCapabilitiesCopy(locale), [locale]);
    const cachedData = hasTargetServer ? readCapabilitiesSnapshot(targetServerId) : null;
    const capabilitiesRequestIdRef = useRef(0);
    const [loading, setLoading] = useState(() => hasTargetServer && !cachedData);
    const [data, setData] = useState(() => cachedData);

    const fetchCapabilities = async (options = {}) => {
        if (!hasTargetServer) {
            capabilitiesRequestIdRef.current += 1;
            setData(null);
            return;
        }
        const preserveCurrent = options.preserveCurrent === true;
        const requestId = capabilitiesRequestIdRef.current + 1;
        capabilitiesRequestIdRef.current = requestId;
        if (!preserveCurrent) {
            setLoading(true);
        }
        try {
            const res = await api.get(`/capabilities/${targetServerId}`);
            if (requestId !== capabilitiesRequestIdRef.current) return;
            setData(res.data?.obj || null);
        } catch (err) {
            if (requestId !== capabilitiesRequestIdRef.current) return;
            const msg = getErrorMessage(err, copy.fetchFailed, locale);
            toast.error(msg);
            if (!preserveCurrent) {
                setData(null);
            }
        } finally {
            if (requestId === capabilitiesRequestIdRef.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        if (!hasTargetServer) {
            capabilitiesRequestIdRef.current += 1;
            setData(null);
            setLoading(false);
            return;
        }
        const snapshot = readCapabilitiesSnapshot(targetServerId);
        setData(snapshot);
        setLoading(snapshot == null);
        fetchCapabilities({ preserveCurrent: snapshot != null });
    }, [targetServerId, hasTargetServer]);

    useEffect(() => {
        if (!hasTargetServer || !data) return;
        writeSessionSnapshot(buildCapabilitiesSnapshotKey(targetServerId), {
            data,
        });
    }, [data, hasTargetServer, targetServerId]);

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

    const activeProbedTools = useMemo(() => toolEntries.filter(t => t.available === true).length, [toolEntries]);
    const totalProbedTools = useMemo(() => toolEntries.filter(t => t.supportedBy3xui !== false).length, [toolEntries]);
    const toolsPercentage = useMemo(() => totalProbedTools > 0 ? Math.round((activeProbedTools / totalProbedTools) * 100) : 0, [activeProbedTools, totalProbedTools]);

    const integratedModules = useMemo(() => systemModules.filter(m => m.supportedByNms === true).length, [systemModules]);
    const totalModules = useMemo(() => systemModules.length, [systemModules]);
    const modulesPercentage = useMemo(() => totalModules > 0 ? Math.round((integratedModules / totalModules) * 100) : 0, [integratedModules, totalModules]);

    const complianceScore = useMemo(() => Math.round((modulesPercentage + toolsPercentage) / 2), [modulesPercentage, toolsPercentage]);

    const renderFrame = (children) => {
        if (embedded) {
            return (
                <div className="server-detail-capabilities-panel capabilities-page">
                    {children}
                </div>
            );
        }

        return (
            <>
                <Header title={t('pages.capabilities.title')} />
                <div className="page-content page-content--wide page-enter capabilities-page">
                    {children}
                </div>
            </>
        );
    };

    if (!hasTargetServer) {
        return renderFrame(
            <EmptyState
                title={copy.selectServerTitle}
                subtitle={copy.selectServerSubtitle}
                icon={<HiOutlineCircleStack style={{ fontSize: '48px' }} />}
                surface
                action={!embedded ? (
                    <button type="button" className="btn btn-primary" onClick={() => navigate('/servers')}>
                        {copy.goToServers}
                    </button>
                ) : undefined}
            />
        );
    }

    return renderFrame(
        <>
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
                        action={(
                            <button type="button" className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={loading}>
                                <HiOutlineArrowPath className={loading ? 'spinning' : ''} /> {copy.refresh}
                            </button>
                        )}
                    />
                ) : (
                    <>
                        {/* Summary Dashboard Grid */}
                        <div className="capabilities-dashboard-grid mb-6">
                            {/* Card 1: API Compliance */}
                            <div className="capabilities-dashboard-card">
                                <div className="capabilities-dashboard-radial">
                                    <svg width="80" height="80" viewBox="0 0 80 80">
                                        <defs>
                                            <linearGradient id="aurora-radial-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stopColor="var(--accent-primary, #6366F1)" />
                                                <stop offset="50%" stopColor="var(--accent-secondary, #8B5CF6)" />
                                                <stop offset="100%" stopColor="var(--accent-tertiary, #22D3EE)" />
                                            </linearGradient>
                                        </defs>
                                        <circle
                                            cx="40"
                                            cy="40"
                                            r="34"
                                            fill="transparent"
                                            stroke="var(--border-neutral, rgba(0,0,0,0.06))"
                                            strokeWidth="6"
                                        />
                                        <circle
                                            cx="40"
                                            cy="40"
                                            r="34"
                                            fill="transparent"
                                            stroke="url(#aurora-radial-gradient)"
                                            strokeWidth="6"
                                            strokeDasharray={2 * Math.PI * 34}
                                            strokeDashoffset={2 * Math.PI * 34 * (1 - complianceScore / 100)}
                                            strokeLinecap="round"
                                            transform="rotate(-90 40 40)"
                                            style={{ transition: 'stroke-dashoffset 0.8s ease-in-out' }}
                                        />
                                        <text
                                            x="40"
                                            y="40"
                                            textAnchor="middle"
                                            dominantBaseline="central"
                                            fontSize="15"
                                            fontWeight="700"
                                            fill="var(--text-primary)"
                                            fontFamily="var(--font-numeric)"
                                        >
                                            {complianceScore}%
                                        </text>
                                    </svg>
                                </div>
                                <div className="capabilities-dashboard-info">
                                    <div className="capabilities-dashboard-label">{copy.complianceLabel}</div>
                                    <div className="capabilities-dashboard-value">{complianceScore}%</div>
                                    <div className="capabilities-dashboard-desc">{copy.dashboardTitle}</div>
                                </div>
                            </div>

                            {/* Card 2: System Module Coverage */}
                            <div className="capabilities-dashboard-card">
                                <div className="capabilities-dashboard-icon-wrap cap-icon-wrap--modules">
                                    <HiOutlineCircleStack />
                                </div>
                                <div className="capabilities-dashboard-info">
                                    <div className="capabilities-dashboard-label">{copy.modulesLabel}</div>
                                    <div className="capabilities-dashboard-value">{integratedModules} / {totalModules}</div>
                                    <div className="capabilities-dashboard-desc">{copy.modulesDesc(integratedModules, totalModules)}</div>
                                    <div className="capabilities-card-progress-wrapper">
                                        <div 
                                            className="capabilities-card-progress-bar" 
                                            style={{ width: `${modulesPercentage}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Card 3: API Probe Status */}
                            <div className="capabilities-dashboard-card">
                                <div className="capabilities-dashboard-icon-wrap cap-icon-wrap--tools">
                                    <HiOutlineCpuChip />
                                </div>
                                <div className="capabilities-dashboard-info">
                                    <div className="capabilities-dashboard-label">{copy.toolsLabel}</div>
                                    <div className="capabilities-dashboard-value">{activeProbedTools} / {totalProbedTools}</div>
                                    <div className="capabilities-dashboard-desc">{copy.toolsDesc(activeProbedTools, totalProbedTools)}</div>
                                    <div className="capabilities-card-progress-wrapper">
                                        <div 
                                            className="capabilities-card-progress-bar" 
                                            style={{ width: `${toolsPercentage}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Card 4: Protocol Diversity */}
                            <div className="capabilities-dashboard-card">
                                <div className="capabilities-dashboard-icon-wrap cap-icon-wrap--protocols">
                                    <HiOutlineGlobeAlt />
                                </div>
                                <div className="capabilities-dashboard-info">
                                    <div className="capabilities-dashboard-label">{copy.protocolsLabel}</div>
                                    <div className="capabilities-dashboard-value">{protocolList.length}</div>
                                    <div className="capabilities-dashboard-desc">{copy.protocolsDesc(protocolList.length)}</div>
                                    <div className="capabilities-card-progress-wrapper">
                                        <div 
                                            className="capabilities-card-progress-bar" 
                                            style={{ width: protocolList.length > 0 ? '100%' : '0%' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <SectionHeader
                            className="mb-3"
                            compact divider
                            title={copy.protocolSectionTitle}
                            meta={<span className="text-sm text-muted">{copy.protocolCount(protocolList.length)}</span>}
                        />
                        {protocolList.length === 0 ? (
                            <EmptyState title={copy.noProtocols} size="compact" className="mb-8" hideIcon />
                        ) : (
                            <div className="capability-protocol-grid mb-8">
                                {protocolList.map((item) => (
                                    <div key={item.key} className="card capability-protocol-card">
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

                        <SectionHeader
                            className="mb-3"
                            compact divider
                            title={copy.matrixSectionTitle}
                        />
                        {systemModules.length === 0 ? (
                            <EmptyState title={copy.noMatrixTitle} subtitle={copy.noMatrixSubtitle} size="compact" className="mb-8" hideIcon action={(<button type="button" className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={loading}><HiOutlineArrowPath /> {copy.refresh}</button>)} />
                        ) : (
                            <Table
                                className="mb-8"
                                tableClassName="capability-matrix-table"
                                headers={[
                                    <th key="cap">{copy.matrixColumns.capability}</th>,
                                    <th key="support" className="table-cell-center capability-support-column">{copy.matrixColumns.support}</th>,
                                    <th key="status" className="table-cell-center capability-status-column">{copy.matrixColumns.status}</th>,
                                    <th key="entry" className="table-cell-center capability-entry-column">{copy.matrixColumns.entry}</th>,
                                    <th key="note">{copy.matrixColumns.note}</th>
                                ]}
                            >
                                {systemModules.map((module) => (
                                    <tr key={module.key}>
                                        <td data-label={copy.matrixColumns.capability}>
                                            <div className="flex items-start gap-2">
                                                {getModuleIcon(module.key)}
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-semibold text-sm">{module.label}</span>
                                                    <a href={module.docs} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline inline-flex items-center gap-0.5">
                                                        {copy.docsLink}
                                                        <HiOutlineArrowUpRight className="flex-shrink-0" style={{ fontSize: '11px' }} />
                                                    </a>
                                                </div>
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
                            </Table>
                        )}

                        <SectionHeader
                            className="mb-3"
                            compact divider
                            title={copy.toolsSectionTitle}
                        />
                        {toolEntries.length === 0 ? (
                            <EmptyState title={copy.noToolsTitle} subtitle={copy.noToolsSubtitle} size="compact" className="mb-8" hideIcon action={(<button type="button" className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={loading}><HiOutlineArrowPath /> {copy.refresh}</button>)} />
                        ) : (
                            <Table
                                className="mb-8"
                                tableClassName="capability-tools-table"
                                headers={[
                                    <th key="tool">{copy.toolsColumns.tool}</th>,
                                    <th key="avail" className="table-cell-center capability-availability-column">{copy.toolsColumns.availability}</th>,
                                    <th key="status" className="table-cell-center capability-status-column">{copy.toolsColumns.status}</th>,
                                    <th key="entry" className="table-cell-center capability-entry-column">{copy.toolsColumns.entry}</th>,
                                    <th key="src">{copy.toolsColumns.source}</th>
                                ]}
                            >
                                {toolEntries.map((tool) => (
                                    <tr key={tool.key}>
                                        <td data-label={copy.toolsColumns.tool}>
                                            <div className="flex items-start gap-2">
                                                {getModuleIcon(tool.key)}
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-semibold text-sm">{tool.label || tool.key}</span>
                                                    <span className="text-xs text-muted">{tool.description || '-'}</span>
                                                </div>
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
                            </Table>
                        )}

                        <SectionHeader
                            className="mb-3"
                            compact divider
                            title={copy.batchSectionTitle}
                        />
                        <div className="card p-4 mb-8">
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

                        <SectionHeader
                            className="mb-3"
                            compact divider
                            title={copy.subscriptionModesTitle}
                        />
                        <div className="card p-4">
                            <div className="flex gap-2 flex-wrap">
                                {(data.subscriptionModes || []).map((mode) => (
                                    <span key={mode} className="badge badge-success">{mode}</span>
                                ))}
                            </div>
                        </div>
                    </>
                )}
        </>
    );
}
