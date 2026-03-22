import React, { useEffect, useMemo, useState } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { copyToClipboard } from '../../utils/format.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    Modal,
    Button,
    Select,
    Card,
    Row,
    Col,
    Typography,
    Space,
    Empty,
    Badge,
    Tag,
    Tooltip,
    Alert,
    Divider,
} from 'antd';
import {
    StopOutlined,
    ReloadOutlined,
    DownloadOutlined,
    GlobalOutlined,
    CloudDownloadOutlined,
    CloudUploadOutlined,
    ToolOutlined,
    CopyOutlined,
    InfoCircleOutlined,
} from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

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
            setXrayVersions([]);
            setSelectedVersion('');
            return;
        }
        setActionLoading('refreshVersions', true);
        try {
            const probeServerId = targets[0].id;
            const res = await panelRequest(probeServerId, 'get', '/panel/api/server/getXrayVersion');
            const versions = Array.isArray(res.data?.obj) ? res.data.obj : [];
            setXrayVersions(versions);
            if (versions.length > 0) setSelectedVersion(versions[0]);
        } catch {
            setXrayVersions([]);
            setSelectedVersion('');
        } finally {
            setActionLoading('refreshVersions', false);
        }
    };

    const fetchCapabilities = async () => {
        if (isGlobalView || !activeServerId) {
            setCapabilities(null);
            return;
        }
        setCapabilitiesLoading(true);
        try {
            const res = await api.get(`/capabilities/${activeServerId}`);
            setCapabilities(res.data?.obj || null);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '加载节点能力失败');
        }
        setCapabilitiesLoading(false);
    };

    useEffect(() => {
        if (!activeServerId) return;
        fetchVersions();
        fetchCapabilities();
        setToolResults({});
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
        try {
            const res = await panelApi('get', '/panel/api/server/getConfigJson');
            setConfigJson(typeof res.data?.obj === 'string' ? res.data.obj : JSON.stringify(res.data?.obj, null, 2));
            setShowConfig(true);
        } catch {
            toast.error('获取配置失败');
        }
    };

    const handleRunTool = async (tool) => {
        if (isGlobalView) return;
        setActionLoading(`tool-${tool.key}`, true);
        try {
            const res = await panelApi(tool.method || 'get', tool.path);
            const value = typeof res.data?.obj === 'object'
                ? JSON.stringify(res.data.obj, null, 2)
                : String(res.data?.obj || '');
            setToolResults((prev) => ({ ...prev, [tool.key]: value }));
            toast.success(`${tool.label || tool.key} 已生成`);
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '执行失败');
        }
        setActionLoading(`tool-${tool.key}`, false);
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
                    <Empty
                        image={<ToolOutlined style={{ fontSize: '48px', color: 'rgba(255, 255, 255, 0.25)' }} />}
                        description={
                            <span>
                                <Text strong>请先选择一台服务器</Text>
                                <br />
                                <Text type="secondary">节点控制台支持单节点操作，也支持在全局视图下执行批量控制。</Text>
                            </span>
                        }
                    />
                </div>
            </>
        );
    }

    const content = (
        <div className={embedded ? '' : 'page-content page-enter'}>
            <Card size="small" style={{ marginBottom: '24px' }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col xs={24} md={12}>
                        <Title level={5} style={{ margin: 0 }}>节点控制工作台</Title>
                        <Text type="secondary" size="small">
                            集中查看当前作用域，并执行 Xray、Geo、备份与节点工具相关操作。
                        </Text>
                    </Col>
                    <Col xs={24} md={12} style={{ textAlign: 'right' }}>
                        <Space wrap>
                            <Card size="small" bodyStyle={{ padding: '4px 12px' }} style={{ background: 'rgba(255, 255, 255, 0.05)' }}>
                                <Text type="secondary" style={{ fontSize: '12px' }}>{isGlobalView ? '作用域' : '节点'}: </Text>
                                <Text strong>{scopeSummary}</Text>
                            </Card>
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={fetchVersions}
                                loading={loading.refreshVersions}
                                size="small"
                            >
                                刷新版本
                            </Button>
                            {!isGlobalView && (
                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={fetchCapabilities}
                                    loading={capabilitiesLoading}
                                    size="small"
                                >
                                    刷新能力
                                </Button>
                            )}
                        </Space>
                    </Col>
                </Row>
                <Divider style={{ margin: '12px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Tag color={isGlobalView ? 'purple' : 'blue'}>
                        {isGlobalView ? '批量控制模式' : '单节点控制模式'}
                    </Tag>
                </div>
            </Card>

            {lastRun && (
                <Alert
                    message="最近一次执行结果"
                    description={
                        <div>
                            <Text strong>{lastRun.title}</Text>
                            <br />
                            <Text>本次共处理 {lastRun.total} 个目标，成功 {lastRun.success} 个，失败 {lastRun.failed.length} 个。</Text>
                            {lastRun.failed.length > 0 && (
                                <div style={{ marginTop: '8px', maxHeight: '120px', overflowY: 'auto' }}>
                                    {lastRun.failed.map((item) => (
                                        <div key={`${item.serverName}-${item.msg}`} style={{ fontSize: '12px', color: '#ff4d4f' }}>
                                            {item.serverName}: {item.msg}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    }
                    type={lastRun.failed.length === 0 ? 'success' : 'warning'}
                    showIcon
                    closable
                    onClose={() => setLastRun(null)}
                    style={{ marginBottom: '24px' }}
                />
            )}

            <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                    <Card title="Xray 控制" size="small" extra={<Tooltip title="停止和升级会影响当前节点代理转发"><InfoCircleOutlined /></Tooltip>}>
                        <Paragraph type="secondary" style={{ fontSize: '12px' }}>停止、重启服务，必要时查看当前节点配置。</Paragraph>
                        <Space wrap>
                            <Button
                                danger
                                icon={<StopOutlined />}
                                onClick={handleStopXray}
                                loading={loading.stop}
                            >
                                {isGlobalView ? '全部停止' : '停止'}
                            </Button>
                            <Button
                                type="primary"
                                style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                                icon={<ReloadOutlined />}
                                onClick={handleRestartXray}
                                loading={loading.restart}
                            >
                                {isGlobalView ? '全部重启' : '重启'}
                            </Button>
                            {!isGlobalView && (
                                <Button onClick={handleViewConfig}>查看配置</Button>
                            )}
                        </Space>
                    </Card>
                </Col>

                <Col xs={24} md={12}>
                    <Card
                        title="Xray 版本"
                        size="small"
                        extra={
                            <Button
                                type="link"
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={fetchVersions}
                                loading={loading.refreshVersions}
                            >
                                刷新
                            </Button>
                        }
                    >
                        <Paragraph type="secondary" style={{ fontSize: '12px' }}>从当前节点可用列表中选择版本并安装。</Paragraph>
                        <Space.Compact style={{ width: '100%' }}>
                            <Select
                                style={{ flex: 1 }}
                                value={selectedVersion}
                                onChange={setSelectedVersion}
                                placeholder="选择版本"
                            >
                                {xrayVersions.map((v) => <Select.Option key={v} value={v}>{v}</Select.Option>)}
                            </Select>
                            <Button
                                type="primary"
                                icon={<DownloadOutlined />}
                                onClick={handleInstallXray}
                                loading={loading.install}
                                disabled={!selectedVersion}
                            >
                                {isGlobalView ? '全节点安装' : '安装'}
                            </Button>
                        </Space.Compact>
                    </Card>
                </Col>

                <Col xs={24} md={12}>
                    <Card title="Geo 文件" size="small">
                        <Paragraph type="secondary" style={{ fontSize: '12px' }}>更新 GeoIP 与 GeoSite 数据，批量模式会广播到所有节点。</Paragraph>
                        <Space wrap>
                            <Button
                                type="primary"
                                icon={<GlobalOutlined />}
                                onClick={() => handleUpdateGeo()}
                                loading={loading['geo-all']}
                            >
                                {isGlobalView ? '全节点更新' : '全部更新'}
                            </Button>
                            <Button
                                onClick={() => handleUpdateGeo('geoip.dat')}
                                loading={loading['geo-geoip.dat']}
                            >
                                GeoIP
                            </Button>
                            <Button
                                onClick={() => handleUpdateGeo('geosite.dat')}
                                loading={loading['geo-geosite.dat']}
                            >
                                GeoSite
                            </Button>
                        </Space>
                    </Card>
                </Col>

                <Col xs={24} md={12}>
                    <Card title="数据与备份" size="small">
                        <Paragraph type="secondary" style={{ fontSize: '12px' }}>批量模式只保留 Telegram 备份，数据库操作限单节点。</Paragraph>
                        <Space wrap>
                            <Button
                                type="primary"
                                onClick={handleBackupTelegram}
                                loading={loading.tgBackup}
                            >
                                {isGlobalView ? '全节点 Telegram 备份' : 'Telegram 备份'}
                            </Button>
                            <Button
                                icon={<CloudDownloadOutlined />}
                                onClick={handleExportDb}
                                loading={loading.exportDb}
                                disabled={isGlobalView}
                            >
                                导出数据库
                            </Button>
                            <Tooltip title={isGlobalView ? "集群态不支持导入" : ""}>
                                <Button
                                    icon={<CloudUploadOutlined />}
                                    disabled={isGlobalView}
                                    onClick={() => document.getElementById('db-import-input').click()}
                                    loading={loading.importDb}
                                >
                                    导入数据库
                                </Button>
                            </Tooltip>
                            <input
                                id="db-import-input"
                                type="file"
                                accept=".db"
                                onChange={handleImportDb}
                                hidden
                            />
                        </Space>
                    </Card>
                </Col>

                {!isGlobalView && (
                    <Col span={24}>
                        <Card
                            title="节点工具"
                            size="small"
                            extra={
                                <Button
                                    type="link"
                                    size="small"
                                    icon={<ReloadOutlined />}
                                    onClick={fetchCapabilities}
                                    loading={capabilitiesLoading}
                                >
                                    刷新能力
                                </Button>
                            }
                        >
                            <Paragraph type="secondary" style={{ fontSize: '12px' }}>仅展示支持在控制台直接执行的节点工具接口。</Paragraph>
                            {toolEntries.length === 0 ? (
                                <Text type="secondary">当前节点未暴露可执行工具接口。</Text>
                            ) : (
                                <Row gutter={[16, 16]}>
                                    {toolEntries.map((tool) => (
                                        <Col xs={24} sm={12} lg={8} key={tool.key}>
                                            <Card size="small" type="inner">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                    <Text strong>{tool.label || tool.key}</Text>
                                                    <Badge
                                                        status={tool.available === false ? 'error' : 'success'}
                                                        text={tool.available === false ? '不可用' : '可执行'}
                                                    />
                                                </div>
                                                <Paragraph type="secondary" style={{ fontSize: '12px', minHeight: '32px' }}>
                                                    {tool.description || '-'}
                                                </Paragraph>
                                                {toolResults[tool.key] && (
                                                    <pre style={{
                                                        background: 'rgba(0,0,0,0.3)',
                                                        padding: '8px',
                                                        borderRadius: '4px',
                                                        fontSize: '11px',
                                                        maxHeight: '150px',
                                                        overflow: 'auto',
                                                        marginBottom: '12px'
                                                    }}>
                                                        {toolResults[tool.key]}
                                                    </pre>
                                                )}
                                                <Space>
                                                    <Button
                                                        size="small"
                                                        type="primary"
                                                        icon={<ReloadOutlined />}
                                                        onClick={() => handleRunTool(tool)}
                                                        loading={loading[`tool-${tool.key}`]}
                                                        disabled={tool.available === false}
                                                    >
                                                        生成
                                                    </Button>
                                                    {toolResults[tool.key] && (
                                                        <Button
                                                            size="small"
                                                            icon={<CopyOutlined />}
                                                            onClick={() => copyToClipboard(toolResults[tool.key]).then(() => toast.success('已复制'))}
                                                        >
                                                            复制
                                                        </Button>
                                                    )}
                                                </Space>
                                            </Card>
                                        </Col>
                                    ))}
                                </Row>
                            )}
                        </Card>
                    </Col>
                )}

                {!isGlobalView && guidedModules.length > 0 && (
                    <Col span={24}>
                        <Card title="官方能力引导" size="small">
                            <Paragraph type="secondary" style={{ fontSize: '12px' }}>对于 NMS 尚未接管的能力，直接跳转到上游文档查看说明。</Paragraph>
                            <Row gutter={[16, 16]}>
                                {guidedModules.map((module) => (
                                    <Col xs={24} sm={12} lg={8} key={module.key}>
                                        <Card size="small" type="inner">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                <Text strong>{module.label}</Text>
                                                <Tag color="default">{module.uiActionLabel || '官方文档'}</Tag>
                                            </div>
                                            <Paragraph type="secondary" style={{ fontSize: '12px' }}>
                                                {module.note || '-'}
                                            </Paragraph>
                                            <Button
                                                size="small"
                                                href={module.docs}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                官方文档
                                            </Button>
                                        </Card>
                                    </Col>
                                ))}
                            </Row>
                        </Card>
                    </Col>
                )}
            </Row>
        </div>
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

            <Modal
                title="Xray 配置"
                open={showConfig}
                onCancel={() => setShowConfig(false)}
                footer={[
                    <Button key="copy" icon={<CopyOutlined />} onClick={() => copyToClipboard(configJson).then(() => toast.success('已复制'))}>
                        复制
                    </Button>,
                    <Button key="close" type="primary" onClick={() => setShowConfig(false)}>
                        关闭
                    </Button>
                ]}
                width={800}
            >
                <pre style={{
                    background: 'rgba(0,0,0,0.3)',
                    padding: '16px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    maxHeight: '500px',
                    overflow: 'auto'
                }}>
                    {configJson}
                </pre>
            </Modal>
        </>
    );
}
