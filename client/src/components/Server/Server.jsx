import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { copyToClipboard } from '../../utils/format.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiOutlineStop,
    HiOutlineArrowPath,
    HiOutlineArrowDown,
    HiOutlineGlobeAlt,
    HiOutlineCloudArrowDown,
    HiOutlineCloudArrowUp,
    HiOutlineWrenchScrewdriver,
    HiOutlineClipboard,
    HiOutlineXMark,
} from 'react-icons/hi2';
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import SectionHeader from '../UI/SectionHeader.jsx';

export default function ServerManagement({ embedded = false }) {
    const { activeServerId, panelApi, servers } = useServer();
    const { t } = useI18n();
    const isGlobalView = activeServerId === 'global';
    const activeServerMeta = useMemo(
        () => servers.find((item) => item.id === activeServerId) || null,
        [servers, activeServerId]
    );
    const confirmAction = useConfirm();
    const [xrayVersions, setXrayVersions] = useState([]);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [configJson, setConfigJson] = useState('');
    const [showConfig, setShowConfig] = useState(false);
    const [loading, setLoading] = useState({});
    const [lastRun, setLastRun] = useState(null);
    const [capabilities, setCapabilities] = useState(null);
    const [toolResults, setToolResults] = useState({});
    const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
    const versionsRequestIdRef = useRef(0);
    const capabilitiesRequestIdRef = useRef(0);
    const configRequestIdRef = useRef(0);
    const toolRunRequestIdRef = useRef(0);

    const getTargets = () => {
        if (isGlobalView) return servers;
        return servers.filter((item) => item.id === activeServerId);
    };

    const getErrorText = (err, fallback = '操作失败') => {
        return err?.response?.data?.msg || err?.message || fallback;
    };

    const panelRequest = (serverId, method, path, data, config) => {
        if (isGlobalView) {
            return api({ method, url: `/panel/${serverId}${path}`, data, ...config });
        }
        return panelApi(method, path, data, config);
    };

    const setActionLoading = (key, val) => setLoading((prev) => ({ ...prev, [key]: val }));

    const runForTargets = async ({ loadingKey, successText, actionBuilder }) => {
        const targets = getTargets();
        if (targets.length === 0) {
            toast.error('暂无可维护节点');
            return { total: 0, success: 0, failed: [] };
        }

        setActionLoading(loadingKey, true);
        const failed = [];

        await Promise.all(targets.map(async (serverMeta) => {
            try {
                await actionBuilder(serverMeta);
            } catch (err) {
                failed.push({
                    serverName: serverMeta.name || serverMeta.id,
                    msg: getErrorText(err, '执行失败'),
                });
            }
        }));

        setActionLoading(loadingKey, false);

        const result = {
            title: successText,
            total: targets.length,
            success: targets.length - failed.length,
            failed,
        };
        setLastRun(result);

        if (failed.length === 0) {
            toast.success(`${successText}: ${result.success}/${targets.length} 成功`);
        } else {
            toast.error(`${successText}: ${result.success}/${targets.length} 成功`);
        }
        return result;
    };

    const fetchVersions = async () => {
        const targets = getTargets();
        if (targets.length === 0) {
            versionsRequestIdRef.current += 1;
            setXrayVersions([]);
            setSelectedVersion('');
            return;
        }
        const requestId = versionsRequestIdRef.current + 1;
        versionsRequestIdRef.current = requestId;
        setActionLoading('refreshVersions', true);
        try {
            const probeServerId = targets[0].id;
            const res = await panelRequest(probeServerId, 'get', '/panel/api/server/getXrayVersion');
            if (requestId !== versionsRequestIdRef.current) return;
            const versions = Array.isArray(res.data?.obj) ? res.data.obj : [];
            setXrayVersions(versions);
            if (versions.length > 0) setSelectedVersion(versions[0]);
        } catch {
            if (requestId !== versionsRequestIdRef.current) return;
            setXrayVersions([]);
            setSelectedVersion('');
        } finally {
            if (requestId === versionsRequestIdRef.current) {
                setActionLoading('refreshVersions', false);
            }
        }
    };

    const fetchCapabilities = async () => {
        if (isGlobalView || !activeServerId) {
            capabilitiesRequestIdRef.current += 1;
            setCapabilities(null);
            return;
        }
        const requestId = capabilitiesRequestIdRef.current + 1;
        capabilitiesRequestIdRef.current = requestId;
        setCapabilitiesLoading(true);
        try {
            const res = await api.get(`/capabilities/${activeServerId}`);
            if (requestId !== capabilitiesRequestIdRef.current) return;
            setCapabilities(res.data?.obj || null);
        } catch (error) {
            if (requestId !== capabilitiesRequestIdRef.current) return;
            toast.error(error.response?.data?.msg || error.message || '加载节点能力失败');
        } finally {
            if (requestId === capabilitiesRequestIdRef.current) {
                setCapabilitiesLoading(false);
            }
        }
    };

    useEffect(() => {
        if (!activeServerId) return;
        configRequestIdRef.current += 1;
        toolRunRequestIdRef.current += 1;
        setLoading({});
        fetchVersions();
        fetchCapabilities();
        setToolResults({});
        setShowConfig(false);
        setConfigJson('');
    }, [activeServerId, servers.length]);

    const toolEntries = useMemo(() => {
        if (!capabilities?.tools || typeof capabilities.tools !== 'object') return [];
        return Object.values(capabilities.tools)
            .filter((item) => item.uiAction === 'node_console')
            .filter((item) => item.supportedByNms === true);
    }, [capabilities]);

    const guidedModules = useMemo(
        () => (Array.isArray(capabilities?.systemModules) ? capabilities.systemModules : [])
            .filter((item) => item.supportedByNms === false),
        [capabilities]
    );
    const scopeSummary = isGlobalView ? `${servers.length} 台节点` : (activeServerMeta?.name || activeServerId);

    const handleStopXray = async () => {
        const targets = getTargets();
        if (targets.length === 0) {
            toast.error('暂无可维护节点');
            return;
        }
        const ok = await confirmAction({
            title: isGlobalView ? '停止全部节点 Xray 服务' : '停止 Xray 服务',
            message: isGlobalView
                ? `确定停止 ${targets.length} 个节点的 Xray 服务吗？`
                : '确定停止 Xray 服务吗？',
            details: isGlobalView
                ? '停止后所有节点代理将中断，需手动重启恢复。'
                : '停止后该节点代理将中断，需手动重启恢复。',
            confirmText: '确认停止',
            tone: 'danger',
        });
        if (!ok) return;

        await runForTargets({
            loadingKey: 'stop',
            successText: isGlobalView ? '批量停止' : '停止',
            actionBuilder: async (serverMeta) => {
                await panelRequest(serverMeta.id, 'post', '/panel/api/server/stopXrayService');
            },
        });
    };

    const handleRestartXray = async () => {
        await runForTargets({
            loadingKey: 'restart',
            successText: isGlobalView ? '批量重启' : '重启',
            actionBuilder: async (serverMeta) => {
                await panelRequest(serverMeta.id, 'post', '/panel/api/server/restartXrayService');
            },
        });
    };

    const handleInstallXray = async () => {
        if (!selectedVersion) return;
        const targets = getTargets();
        if (targets.length === 0) {
            toast.error('暂无可维护节点');
            return;
        }
        const ok = await confirmAction({
            title: isGlobalView ? '全节点安装 Xray' : '安装 Xray',
            message: isGlobalView
                ? `确定在 ${targets.length} 个节点安装 Xray ${selectedVersion} 吗？`
                : `确定安装 Xray ${selectedVersion} 吗？`,
            details: isGlobalView
                ? '升级可能导致集群短暂中断，建议在低峰期执行。'
                : '升级可能导致短暂中断，建议在低峰期执行。',
            confirmText: '确认安装',
            tone: 'primary',
        });
        if (!ok) return;

        await runForTargets({
            loadingKey: 'install',
            successText: isGlobalView ? '批量安装' : '安装',
            actionBuilder: async (serverMeta) => {
                await panelRequest(serverMeta.id, 'post', `/panel/api/server/installXray/${selectedVersion}`);
            },
        });
        fetchVersions();
    };

    const handleUpdateGeo = async (fileName) => {
        const key = `geo-${fileName || 'all'}`;
        const path = fileName ? `/panel/api/server/updateGeofile/${fileName}` : '/panel/api/server/updateGeofile';

        await runForTargets({
            loadingKey: key,
            successText: isGlobalView ? `批量更新 ${fileName || 'Geo 文件'}` : '更新',
            actionBuilder: async (serverMeta) => {
                await panelRequest(serverMeta.id, 'post', path);
            },
        });
    };

    const handleExportDb = async () => {
        if (isGlobalView) {
            toast.error('集群总览下不支持导出数据库，请切换到具体节点');
            return;
        }
        setActionLoading('exportDb', true);
        try {
            const res = await panelApi('get', '/panel/api/server/getDb', null, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'x-ui.db';
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success('数据库已下载');
        } catch {
            toast.error('导出失败');
        }
        setActionLoading('exportDb', false);
    };

    const handleImportDb = async (e) => {
        if (isGlobalView) {
            toast.error('集群总览下不支持导入数据库，请切换到具体节点');
            return;
        }
        const file = e.target.files[0];
        if (!file) return;
        const ok = await confirmAction({
            title: '导入数据库',
            message: '导入数据库将覆盖现有数据，确定继续吗？',
            details: '建议先执行数据库导出备份。',
            confirmText: '确认导入',
            tone: 'danger',
        });
        if (!ok) return;
        setActionLoading('importDb', true);
        try {
            const formData = new FormData();
            formData.append('db', file);
            await panelApi('post', '/panel/api/server/importDB', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            toast.success('数据库已导入，Xray 重启中');
        } catch {
            toast.error('导入失败');
        }
        setActionLoading('importDb', false);
    };

    const handleBackupTelegram = async () => {
        await runForTargets({
            loadingKey: 'tgBackup',
            successText: isGlobalView ? '批量 Telegram 备份' : 'Telegram 备份',
            actionBuilder: async (serverMeta) => {
                await panelRequest(serverMeta.id, 'get', '/panel/api/backuptotgbot');
            },
        });
    };

    const handleViewConfig = async () => {
        if (isGlobalView) {
            toast.error('集群总览下不支持查看单节点配置，请切换到具体节点');
            return;
        }
        const requestId = configRequestIdRef.current + 1;
        configRequestIdRef.current = requestId;
        try {
            const res = await panelApi('get', '/panel/api/server/getConfigJson');
            if (requestId !== configRequestIdRef.current) return;
            setConfigJson(typeof res.data?.obj === 'string' ? res.data.obj : JSON.stringify(res.data?.obj, null, 2));
            setShowConfig(true);
        } catch {
            if (requestId !== configRequestIdRef.current) return;
            toast.error('获取配置失败');
        }
    };

    const handleRunTool = async (tool) => {
        if (isGlobalView) return;
        const requestId = toolRunRequestIdRef.current + 1;
        toolRunRequestIdRef.current = requestId;
        setActionLoading(`tool-${tool.key}`, true);
        try {
            const res = await panelApi(tool.method || 'get', tool.path);
            if (requestId !== toolRunRequestIdRef.current) return;
            const value = typeof res.data?.obj === 'object'
                ? JSON.stringify(res.data.obj, null, 2)
                : String(res.data?.obj || '');
            setToolResults((prev) => ({ ...prev, [tool.key]: value }));
            toast.success(`${tool.label || tool.key} 已生成`);
        } catch (error) {
            if (requestId !== toolRunRequestIdRef.current) return;
            toast.error(error.response?.data?.msg || error.message || '执行失败');
        }
        if (requestId === toolRunRequestIdRef.current) {
            setActionLoading(`tool-${tool.key}`, false);
        }
    };

    if (!activeServerId) {
        return (
            <>
                {!embedded && (
                    <Header
                        title={t('pages.serverConsole.title')}
                        subtitle={t('pages.serverConsole.emptySubtitle')}
                        eyebrow={t('pages.serverConsole.eyebrow')}
                    />
                )}
                <div className={embedded ? 'settings-embedded-console settings-embedded-console--empty' : 'page-content page-enter server-console-page'}>
                    <EmptyState
                        title="请先选择一台服务器"
                        subtitle="节点控制台支持单节点操作，也支持在全局视图下执行批量控制。"
                        icon={<HiOutlineWrenchScrewdriver style={{ fontSize: '48px' }} />}
                        surface
                    />
                </div>
            </>
        );
    }

    const content = (
        <>
            <div className={embedded ? 'settings-embedded-console' : 'page-content page-enter server-console-page'}>
                <PageToolbar
                    className={`card mb-6 server-console-toolbar${embedded ? ' server-console-toolbar--embedded' : ''}`}
                    compact
                    main={(
                        <div className="server-console-toolbar-copy">
                            <div className="server-console-toolbar-title">节点控制工作台</div>
                            <div className="server-console-toolbar-note">
                                集中查看当前作用域，并执行 Xray、Geo、备份与节点工具相关操作。
                            </div>
                        </div>
                    )}
                    actions={(
                        <>
                            <div className="server-console-scope-card" aria-live="polite">
                                <div className="server-console-scope-label">{isGlobalView ? '当前作用域' : '当前节点'}</div>
                                <div className="server-console-scope-value">
                                    {scopeSummary}
                                </div>
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={fetchVersions} disabled={loading.refreshVersions}>
                                <HiOutlineArrowPath /> 刷新版本
                            </button>
                            {!isGlobalView && (
                                <button className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={capabilitiesLoading}>
                                    <HiOutlineArrowPath className={capabilitiesLoading ? 'spinning' : ''} /> 刷新能力
                                </button>
                            )}
                        </>
                    )}
                    meta={<span>{isGlobalView ? '批量控制模式' : '单节点控制模式'}</span>}
                />
                {lastRun && (
                    <div className="card mb-6 server-console-result-card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title="最近一次执行结果"
                            subtitle={lastRun.title}
                            meta={(
                                <span className={`badge ${lastRun.failed.length === 0 ? 'badge-success' : 'badge-warning'}`}>
                                    {lastRun.success}/{lastRun.total} 成功
                                </span>
                            )}
                        />
                        <div className="server-console-result-summary">
                            本次共处理 {lastRun.total} 个目标，成功 {lastRun.success} 个，失败 {lastRun.failed.length} 个。
                        </div>
                        {lastRun.failed.length > 0 && (
                            <div className="server-console-result-list">
                                {lastRun.failed.map((item) => (
                                    <div key={`${item.serverName}-${item.msg}`} className="server-console-result-item">
                                        {item.serverName}: {item.msg}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="server-console-grid">
                    <div className="card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title="Xray 控制"
                            subtitle="停止、重启服务，必要时查看当前节点配置。"
                        />
                        <div className="server-console-action-row mb-3">
                            <button className="btn btn-danger btn-sm" onClick={handleStopXray} disabled={loading.stop}>
                                <HiOutlineStop /> {isGlobalView ? '全部停止' : '停止'}
                            </button>
                            <button className="btn btn-success btn-sm" onClick={handleRestartXray} disabled={loading.restart}>
                                <HiOutlineArrowPath /> {isGlobalView ? '全部重启' : '重启'}
                            </button>
                            {!isGlobalView && (
                                <button className="btn btn-secondary btn-sm" onClick={handleViewConfig}>
                                    查看配置
                                </button>
                            )}
                        </div>
                        <div className="server-console-note">
                            停止和升级会影响当前节点代理转发，请在低峰期操作。
                        </div>
                    </div>

                    <div className="card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title="Xray 版本"
                            subtitle="从当前节点可用的版本列表中选择目标版本后执行安装。"
                            actions={(
                                <button className="btn btn-secondary btn-sm" onClick={fetchVersions} disabled={loading.refreshVersions}>
                                    <HiOutlineArrowPath /> 刷新
                                </button>
                            )}
                        />
                        <div className="server-console-select-row">
                            <select className="form-select" value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)}>
                                {xrayVersions.length === 0 && <option value="">暂无可用版本</option>}
                                {xrayVersions.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <button className="btn btn-primary btn-sm" onClick={handleInstallXray} disabled={loading.install || !selectedVersion}>
                                <HiOutlineArrowDown /> {isGlobalView ? '全节点安装' : '安装'}
                            </button>
                        </div>
                    </div>

                    <div className="card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title="Geo 文件"
                            subtitle="更新 GeoIP 与 GeoSite 数据，批量模式会广播到所有节点。"
                        />
                        <div className="server-console-action-row">
                            <button className="btn btn-primary btn-sm" onClick={() => handleUpdateGeo()} disabled={loading['geo-all']}>
                                <HiOutlineGlobeAlt /> {isGlobalView ? '全节点更新' : '全部更新'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleUpdateGeo('geoip.dat')} disabled={loading['geo-geoip.dat']}>
                                GeoIP
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleUpdateGeo('geosite.dat')} disabled={loading['geo-geosite.dat']}>
                                GeoSite
                            </button>
                        </div>
                    </div>

                    <div className="card">
                        <SectionHeader
                            className="card-header section-header section-header--compact"
                            title="数据与备份"
                            subtitle="批量模式只保留 Telegram 备份，数据库导入导出仍限定单节点。"
                        />
                        <div className="server-console-action-row">
                            <button className="btn btn-primary btn-sm" onClick={handleBackupTelegram} disabled={loading.tgBackup}>
                                {isGlobalView ? '全节点 Telegram 备份' : 'Telegram 备份'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={handleExportDb} disabled={loading.exportDb || isGlobalView}>
                                <HiOutlineCloudArrowDown /> 导出数据库
                            </button>
                            <label
                                className={`btn btn-secondary btn-sm server-console-import-label${isGlobalView ? ' disabled is-disabled' : ''}`}
                            >
                                <HiOutlineCloudArrowUp /> 导入数据库
                                <input type="file" accept=".db" onChange={handleImportDb} hidden disabled={isGlobalView} />
                            </label>
                        </div>
                        <div className="server-console-note mt-3">
                            数据库导入/导出仅支持单节点，集群态不会执行该类动作。
                        </div>
                    </div>

                    {!isGlobalView && (
                        <div className="card server-console-span-full">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title="节点工具"
                                subtitle="仅展示支持在控制台直接执行的节点工具接口。"
                                actions={(
                                    <button className="btn btn-secondary btn-sm" onClick={fetchCapabilities} disabled={capabilitiesLoading}>
                                        <HiOutlineArrowPath className={capabilitiesLoading ? 'spinning' : ''} /> 刷新能力
                                    </button>
                                )}
                            />
                            {toolEntries.length === 0 ? (
                                <div className="server-console-note">当前节点未暴露可执行工具接口。</div>
                            ) : (
                                <div className="server-console-tool-grid">
                                    {toolEntries.map((tool) => (
                                        <div key={tool.key} className="server-console-tool-card">
                                            <div className="server-console-tool-head">
                                                <strong>{tool.label || tool.key}</strong>
                                                <span className={`badge ${tool.available === false ? 'badge-danger' : 'badge-success'}`}>
                                                    {tool.available === false ? '不可用' : '可执行'}
                                                </span>
                                            </div>
                                            <div className="text-sm text-muted mb-3">{tool.description || '-'}</div>
                                            {toolResults[tool.key] && (
                                                <pre className="log-viewer server-console-log server-console-log--compact">
                                                    {toolResults[tool.key]}
                                                </pre>
                                            )}
                                            <div className="server-console-action-row">
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => handleRunTool(tool)}
                                                    disabled={loading[`tool-${tool.key}`] || tool.available === false}
                                                >
                                                    {loading[`tool-${tool.key}`] ? <span className="spinner" /> : <HiOutlineArrowPath />}
                                                    生成
                                                </button>
                                                {toolResults[tool.key] && (
                                                    <button className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(toolResults[tool.key]).then(() => toast.success('已复制'))}>
                                                        <HiOutlineClipboard /> 复制
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {!isGlobalView && guidedModules.length > 0 && (
                        <div className="card server-console-span-full">
                            <SectionHeader
                                className="card-header section-header section-header--compact"
                                title="官方能力引导"
                                subtitle="对于 NMS 尚未接管的能力，直接跳转到上游文档查看说明。"
                            />
                            <div className="server-console-guide-grid">
                                {guidedModules.map((module) => (
                                    <div key={module.key} className="server-console-tool-card">
                                        <div className="server-console-tool-head">
                                            <strong>{module.label}</strong>
                                            <span className="badge badge-neutral">{module.uiActionLabel || '官方文档'}</span>
                                        </div>
                                        <div className="text-sm text-muted mb-3">{module.note || '-'}</div>
                                        <a href={module.docs} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                                            官方文档
                                        </a>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    return (
        <>
            {!embedded && (
                <Header
                    title={t('pages.serverConsole.title')}
                    eyebrow={t('pages.serverConsole.eyebrow')}
                />
            )}
            {content}

            {showConfig && (
                <ModalShell isOpen={showConfig} onClose={() => setShowConfig(false)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Xray 配置</h3>
                            <button className="modal-close" onClick={() => setShowConfig(false)}><HiOutlineXMark /></button>
                        </div>
                        <div className="modal-body">
                            <pre className="log-viewer server-console-log server-console-log--modal">
                                {configJson}
                            </pre>
                        </div>
                    </div>
                </ModalShell>
            )}
        </>
    );
}
