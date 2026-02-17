import React, { useState, useEffect } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiOutlinePlay,
    HiOutlineStop,
    HiOutlineArrowPath,
    HiOutlineArrowDown,
    HiOutlineArrowUp,
    HiOutlineGlobeAlt,
    HiOutlineCloudArrowDown,
    HiOutlineCloudArrowUp,
    HiOutlineWrenchScrewdriver,
} from 'react-icons/hi2';

export default function ServerManagement() {
    const { activeServerId, panelApi, servers } = useServer();
    const isGlobalView = activeServerId === 'global';
    const confirmAction = useConfirm();
    const [xrayVersions, setXrayVersions] = useState([]);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [configJson, setConfigJson] = useState('');
    const [showConfig, setShowConfig] = useState(false);
    const [loading, setLoading] = useState({});

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

        const success = targets.length - failed.length;
        if (failed.length === 0) {
            toast.success(`${successText}: ${success}/${targets.length} 成功`);
        } else {
            toast.error(`${successText}: ${success}/${targets.length} 成功`);
        }
        return { total: targets.length, success, failed };
    };

    useEffect(() => {
        if (!activeServerId) return;
        fetchVersions();
    }, [activeServerId, servers.length]);

    const fetchVersions = async () => {
        const targets = getTargets();
        if (targets.length === 0) {
            setXrayVersions([]);
            setSelectedVersion('');
            return;
        }
        try {
            const probeServerId = targets[0].id;
            const res = await panelRequest(probeServerId, 'get', '/panel/api/server/getXrayVersion');
            if (res.data?.obj) {
                setXrayVersions(res.data.obj);
                if (res.data.obj.length > 0) setSelectedVersion(res.data.obj[0]);
            }
        } catch { }
    };

    const setActionLoading = (key, val) => setLoading(prev => ({ ...prev, [key]: val }));

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
        } catch { toast.error('导出失败'); }
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
        } catch { toast.error('导入失败'); }
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
        try {
            const res = await panelApi('get', '/panel/api/server/getConfigJson');
            setConfigJson(typeof res.data?.obj === 'string' ? res.data.obj : JSON.stringify(res.data?.obj, null, 2));
            setShowConfig(true);
        } catch { toast.error('获取配置失败'); }
    };

    if (!activeServerId) {
        return (
            <>
                <Header title="节点设置" />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineWrenchScrewdriver /></div>
                        <div className="empty-state-text">请先选择一台服务器</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header title={isGlobalView ? '节点设置（集群）' : '节点设置'} />
            <div className="page-content page-enter">
                {isGlobalView && (
                    <div className="card mb-6">
                        <div className="text-sm text-muted">
                            当前为集群总览模式，将对 <strong>{servers.length}</strong> 个节点执行升级与维护动作。
                        </div>
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                    {/* Xray Service Control */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Xray 服务控制</span>
                        </div>
                        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
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
                    </div>

                    {/* Xray Version */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Xray 版本升级</span>
                        </div>
                        <div className="flex items-center gap-8">
                            <select className="form-select" value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} style={{ flex: 1 }}>
                                {xrayVersions.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <button className="btn btn-primary btn-sm" onClick={handleInstallXray} disabled={loading.install || !selectedVersion}>
                                <HiOutlineArrowDown /> {isGlobalView ? '全节点安装' : '安装'}
                            </button>
                        </div>
                    </div>

                    {/* GeoIP Update */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">GeoIP / GeoSite 更新</span>
                        </div>
                        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
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

                    {/* Backup & Database */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">备份与数据库</span>
                        </div>
                        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                            {!isGlobalView && (
                                <button className="btn btn-secondary btn-sm" onClick={handleExportDb} disabled={loading.exportDb}>
                                    <HiOutlineCloudArrowDown /> 导出数据库
                                </button>
                            )}
                            {!isGlobalView && (
                                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                                    <HiOutlineCloudArrowUp /> 导入数据库
                                    <input type="file" accept=".db" onChange={handleImportDb} hidden />
                                </label>
                            )}
                            <button className="btn btn-primary btn-sm" onClick={handleBackupTelegram} disabled={loading.tgBackup}>
                                {isGlobalView ? '全节点 Telegram 备份' : 'Telegram 备份'}
                            </button>
                            {isGlobalView && (
                                <div className="text-xs text-muted" style={{ width: '100%' }}>
                                    数据库导入/导出仅支持单节点，请切换节点后使用。
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Config JSON Modal */}
            {showConfig && (
                <div className="modal-overlay" onClick={() => setShowConfig(false)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Xray 配置</h3>
                            <button className="modal-close" onClick={() => setShowConfig(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <pre className="log-viewer" style={{ maxHeight: '500px', fontSize: '11px' }}>
                                {configJson}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
