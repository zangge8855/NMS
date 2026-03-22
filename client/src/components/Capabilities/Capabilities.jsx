import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineCircleStack } from 'react-icons/hi2';
import { 
    Card, 
    Button, 
    Table, 
    Typography, 
    Tag, 
    Row, 
    Col, 
    Empty, 
    Space, 
    Descriptions,
    Spin
} from 'antd';
import Header from '../Layout/Header.jsx';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';

const { Title, Text, Link } = Typography;

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
    if (value === true) return <Tag color="success">{copy.availability.available}</Tag>;
    if (value === false) return <Tag color="error">{copy.availability.unavailable}</Tag>;
    return <Tag color="default">{copy.availability.unprobed}</Tag>;
}

function renderBooleanSupport(value, copy) {
    return value ? <Tag color="success">{copy.support.supported}</Tag> : <Tag color="warning">{copy.support.missing}</Tag>;
}

function renderAlignmentStatus(value, copy) {
    if (value === 'integrated') return <Tag color="success">{copy.alignment.integrated}</Tag>;
    if (value === 'api_available_ui_missing') return <Tag color="warning">{copy.alignment.apiAvailableUiMissing}</Tag>;
    if (value === 'guided_only') return <Tag color="default">{copy.alignment.guidedOnly}</Tag>;
    if (value === 'intentionally_unsupported') return <Tag color="error">{copy.alignment.unsupported}</Tag>;
    return <Tag color="default">{copy.alignment.unknown}</Tag>;
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
                <div className="page-content page-enter capabilities-page" style={{ padding: '24px' }}>
                    <Card bordered={false}>
                        <Empty
                            image={<HiOutlineCircleStack style={{ fontSize: '48px', color: '#bfbfbf' }} />}
                            description={
                                <Space direction="vertical" align="center">
                                    <Text strong size="large">{copy.selectServerTitle}</Text>
                                    <Text type="secondary">{copy.selectServerSubtitle}</Text>
                                </Space>
                            }
                        />
                    </Card>
                </div>
            </>
        );
    }

    const matrixColumns = [
        {
            title: copy.matrixColumns.capability,
            dataIndex: 'label',
            key: 'label',
            render: (text, record) => (
                <Space direction="vertical" size={0}>
                    <Text>{text}</Text>
                    <Link href={record.docs} target="_blank" style={{ fontSize: '12px' }}>
                        {copy.docsLink}
                    </Link>
                </Space>
            ),
        },
        {
            title: copy.matrixColumns.support,
            dataIndex: 'supportedBy3xui',
            key: 'support',
            align: 'center',
            render: (val) => renderBooleanSupport(val === true, copy),
        },
        {
            title: copy.matrixColumns.status,
            dataIndex: 'status',
            key: 'status',
            align: 'center',
            render: (val) => renderAlignmentStatus(val, copy),
        },
        {
            title: copy.matrixColumns.entry,
            dataIndex: 'uiActionLabel',
            key: 'entry',
            align: 'center',
            render: (val) => <Tag>{val || '-'}</Tag>,
        },
        {
            title: copy.matrixColumns.note,
            dataIndex: 'note',
            key: 'note',
            render: (val) => <Text type="secondary" style={{ fontSize: '12px' }}>{val || '-'}</Text>,
        },
    ];

    const toolColumns = [
        {
            title: copy.toolsColumns.tool,
            dataIndex: 'label',
            key: 'tool',
            render: (text, record) => (
                <Space direction="vertical" size={0}>
                    <Text>{text || record.key}</Text>
                    <Text type="secondary" style={{ fontSize: '12px' }}>{record.description || '-'}</Text>
                </Space>
            ),
        },
        {
            title: copy.toolsColumns.availability,
            dataIndex: 'available',
            key: 'availability',
            align: 'center',
            render: (val) => renderAvailability(val, copy),
        },
        {
            title: copy.toolsColumns.status,
            dataIndex: 'status',
            key: 'status',
            align: 'center',
            render: (val) => renderAlignmentStatus(val, copy),
        },
        {
            title: copy.toolsColumns.entry,
            dataIndex: 'uiActionLabel',
            key: 'entry',
            align: 'center',
            render: (val) => <Tag>{val || '-'}</Tag>,
        },
        {
            title: copy.toolsColumns.source,
            dataIndex: 'source',
            key: 'source',
            render: (val) => <Text type="secondary" style={{ fontSize: '12px' }}>{renderProbeSource(val, copy)}</Text>,
        },
    ];

    return (
        <>
            <Header title={t('pages.capabilities.title')} />
            <div className="page-content page-enter capabilities-page" style={{ padding: '24px' }}>
                <Card bordered={false} className="mb-6" bodyStyle={{ padding: '12px 24px' }}>
                    <Row justify="space-between" align="middle">
                        <Col>
                            <Text type="secondary">{copy.toolbarSummary(protocolList.length, toolEntries.length)}</Text>
                        </Col>
                        <Col>
                            <Button 
                                icon={<HiOutlineArrowPath className={loading ? 'spinning' : ''} />} 
                                onClick={fetchCapabilities} 
                                loading={loading}
                            >
                                {copy.refresh}
                            </Button>
                        </Col>
                    </Row>
                </Card>

                {!data ? (
                    <Card bordered={false}>
                        <Empty
                            description={
                                <Space direction="vertical" align="center">
                                    <Text strong>{loading ? copy.loadingTitle : copy.noDataTitle}</Text>
                                    <Text type="secondary">{copy.noDataSubtitle}</Text>
                                </Space>
                            }
                        />
                    </Card>
                ) : (
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                        <Card 
                            title={<Title level={5} style={{ margin: 0 }}>{copy.protocolSectionTitle}</Title>}
                            extra={<Text type="secondary" style={{ fontSize: '14px' }}>{copy.protocolCount(protocolList.length)}</Text>}
                            bordered={false}
                        >
                            {protocolList.length === 0 ? (
                                <Text type="secondary">{copy.noProtocols}</Text>
                            ) : (
                                <Row gutter={[16, 16]}>
                                    {protocolList.map((item) => (
                                        <Col xs={24} sm={12} md={8} lg={6} key={item.key}>
                                            <Card size="small" style={{ height: '100%', background: 'var(--bg-secondary)' }}>
                                                <Row justify="space-between" align="middle" style={{ marginBottom: '8px' }}>
                                                    <Text strong>{item.label}</Text>
                                                    <Tag color="processing">{item.key}</Tag>
                                                </Row>
                                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                                    {Array.isArray(item.legacyKeys) && item.legacyKeys.length > 0
                                                        ? copy.legacyKeysLabel(item.legacyKeys)
                                                        : copy.noLegacyKeys}
                                                </Text>
                                            </Card>
                                        </Col>
                                    ))}
                                </Row>
                            )}
                        </Card>

                        <Card 
                            title={<Title level={5} style={{ margin: 0 }}>{copy.matrixSectionTitle}</Title>}
                            bordered={false}
                            bodyStyle={{ padding: 0 }}
                        >
                            <Table 
                                columns={matrixColumns} 
                                dataSource={systemModules} 
                                pagination={false}
                                size="middle"
                                locale={{
                                    emptyText: <Empty description={copy.noMatrixSubtitle} />
                                }}
                                rowKey="key"
                                scroll={{ x: 'max-content' }}
                            />
                        </Card>

                        <Card 
                            title={<Title level={5} style={{ margin: 0 }}>{copy.toolsSectionTitle}</Title>}
                            bordered={false}
                            bodyStyle={{ padding: 0 }}
                        >
                            <Table 
                                columns={toolColumns} 
                                dataSource={toolEntries} 
                                pagination={false}
                                size="middle"
                                locale={{
                                    emptyText: <Empty description={copy.noToolsSubtitle} />
                                }}
                                rowKey="key"
                                scroll={{ x: 'max-content' }}
                            />
                        </Card>

                        <Card 
                            title={<Title level={5} style={{ margin: 0 }}>{copy.batchSectionTitle}</Title>}
                            bordered={false}
                        >
                            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                                <Descriptions.Item label={copy.clientBatch}>
                                    <Space wrap>
                                        {(data.batchActions?.clients || []).map((x) => (
                                            <Tag key={`c-${x}`}>{x}</Tag>
                                        ))}
                                    </Space>
                                </Descriptions.Item>
                                <Descriptions.Item label={copy.inboundBatch}>
                                    <Space wrap>
                                        {(data.batchActions?.inbounds || []).map((x) => (
                                            <Tag key={`i-${x}`}>{x}</Tag>
                                        ))}
                                    </Space>
                                </Descriptions.Item>
                            </Descriptions>
                        </Card>

                        <Card 
                            title={<Title level={5} style={{ margin: 0 }}>{copy.subscriptionModesTitle}</Title>}
                            bordered={false}
                        >
                            <Space wrap>
                                {(data.subscriptionModes || []).map((mode) => (
                                    <Tag color="success" key={mode}>{mode}</Tag>
                                ))}
                            </Space>
                        </Card>
                    </Space>
                )}
            </div>
        </>
    );
}
