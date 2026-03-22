import React, { useMemo } from 'react';
import {
    HiOutlineCircleStack,
    HiOutlineCloud,
    HiOutlineServerStack,
    HiOutlineArrowPath,
    HiOutlineExclamationTriangle,
} from 'react-icons/hi2';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { Card, Row, Col, Badge, Typography, Button, Space, Divider, Alert } from 'antd';

const { Text, Title } = Typography;

function resolveTopologyCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Resource Topology',
            subtitle: 'Observe control-plane, persistence, and edge-node reachability in one strip.',
            control: 'NMS Control Plane',
            storage: 'Persistence Layer',
            nodes: '3x-ui Edge Nodes',
            dbReady: 'Database ready',
            dbOffline: 'File store only',
            edgeHealthy: 'Node cluster healthy',
            edgeWarning: 'Nodes degraded',
            offlineTitle: 'Offline nodes',
            offlineNone: 'No offline nodes',
            totalNodes: 'Total',
            onlineNodes: 'Online',
            offlineNodes: 'Offline',
            openServers: 'Open nodes',
            readWrite: 'read={read} / write={write}',
        };
    }

    return {
        title: '资源拓扑',
        subtitle: '把主控、持久层和 3x-ui 边缘节点的连通性压缩到一条监控带里。',
        control: 'NMS 主控面板',
        storage: '持久化层',
        nodes: '3x-ui 边缘节点',
        dbReady: '数据库已就绪',
        dbOffline: '当前仅文件存储',
        edgeHealthy: '节点集群稳定',
        edgeWarning: '存在异常节点',
        offlineTitle: '断联节点',
        offlineNone: '暂无断联节点',
        totalNodes: '总节点',
        onlineNodes: '在线',
        offlineNodes: '离线',
        openServers: '查看节点',
        readWrite: 'read={read} / write={write}',
    };
}

function replaceParams(template, params = {}) {
    return Object.entries(params).reduce(
        (text, [key, value]) => text.replace(`{${key}}`, String(value ?? '')),
        String(template || '')
    );
}

function ResourceNode({
    icon: Icon,
    label,
    status,
    detail,
    tone = 'primary',
    action = null,
}) {
    const toneColor = tone === 'primary' ? '#1677ff' : tone === 'success' ? '#52c41a' : tone === 'warning' ? '#faad14' : '#ff4d4f';
    return (
        <Card 
            size="small" 
            style={{ borderColor: toneColor, borderWidth: 1, minWidth: 200, flex: 1, background: 'var(--surface-overlay)' }}
            bodyStyle={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
        >
            <Icon style={{ fontSize: 32, color: toneColor, marginBottom: 8 }} />
            <Text strong style={{ color: 'var(--text-primary)' }}>{label}</Text>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>{status}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{detail}</Text>
            {action && <div style={{ marginTop: 12 }}>{action}</div>}
        </Card>
    );
}

export default function ResourceTopologyCard({
    dbStatus = null,
    servers = [],
    serverStatuses = {},
    onOpenServers = null,
}) {
    const { locale } = useI18n();
    const copy = resolveTopologyCopy(locale);

    const summary = useMemo(() => {
        const statusEntries = Array.isArray(servers)
            ? servers.map((server) => ({
                serverId: server.id,
                serverName: server.name,
                online: serverStatuses?.[server.id]?.online === true,
            }))
            : [];
        const offlineNodes = statusEntries.filter((item) => item.online === false);
        const onlineCount = statusEntries.length - offlineNodes.length;
        const currentModes = dbStatus?.currentModes || {};
        const dbReady = dbStatus?.connection?.enabled ? dbStatus?.connection?.ready === true : false;
        return {
            total: statusEntries.length,
            online: Math.max(0, onlineCount),
            offline: offlineNodes.length,
            offlineNodes,
            dbReady,
            dbDetail: replaceParams(copy.readWrite, {
                read: currentModes.readMode || 'file',
                write: currentModes.writeMode || 'file',
            }),
        };
    }, [copy.readWrite, dbStatus?.connection?.enabled, dbStatus?.connection?.ready, dbStatus?.currentModes, serverStatuses, servers]);

    return (
        <Card style={{ marginBottom: 24, background: 'var(--surface-overlay)', borderColor: 'var(--border-color)' }}>
            <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
                <Col>
                    <Title level={4} style={{ margin: 0, color: 'var(--text-primary)' }}>{copy.title}</Title>
                    <Text type="secondary">{copy.subtitle}</Text>
                </Col>
                <Col>
                    <Space>
                        <Badge count={`${copy.totalNodes} ${summary.total}`} style={{ backgroundColor: 'var(--surface-elevated)', color: 'var(--text-primary)', boxShadow: '0 0 0 1px var(--border-color)' }} />
                        <Badge count={`${copy.onlineNodes} ${summary.online}`} style={{ backgroundColor: '#52c41a' }} />
                        {summary.offline > 0 && (
                            <Badge count={`${copy.offlineNodes} ${summary.offline}`} style={{ backgroundColor: '#ff4d4f' }} />
                        )}
                    </Space>
                </Col>
            </Row>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <ResourceNode
                    icon={HiOutlineCloud}
                    label={copy.control}
                    status={copy.edgeHealthy}
                    detail="API / WS / Task Queue"
                    tone="primary"
                />
                <Divider type="horizontal" dashed style={{ flex: 1, minWidth: 50, borderColor: summary.dbReady ? '#52c41a' : '#faad14' }} />
                <ResourceNode
                    icon={HiOutlineCircleStack}
                    label={copy.storage}
                    status={summary.dbReady ? copy.dbReady : copy.dbOffline}
                    detail={summary.dbDetail}
                    tone={summary.dbReady ? 'success' : 'warning'}
                />
                <Divider type="horizontal" dashed style={{ flex: 1, minWidth: 50, borderColor: summary.offline > 0 ? '#ff4d4f' : '#52c41a' }} />
                <ResourceNode
                    icon={HiOutlineServerStack}
                    label={copy.nodes}
                    status={summary.offline > 0 ? copy.edgeWarning : copy.edgeHealthy}
                    detail={`${summary.online} / ${summary.total}`}
                    tone={summary.offline > 0 ? 'danger' : 'success'}
                    action={typeof onOpenServers === 'function' ? (
                        <Button type="primary" size="small" icon={<HiOutlineArrowPath />} onClick={onOpenServers}>
                            {copy.openServers}
                        </Button>
                    ) : null}
                />
            </div>

            {summary.offlineNodes.length > 0 && (
                <div style={{ marginTop: 24 }}>
                    <Alert
                        message={<Space><HiOutlineExclamationTriangle /> {copy.offlineTitle}</Space>}
                        description={
                            <Space wrap>
                                {summary.offlineNodes.map((item) => (
                                    <Badge key={item.serverId} color="red" text={<Text style={{ color: 'var(--text-primary)' }}>{item.serverName}</Text>} />
                                ))}
                            </Space>
                        }
                        type="error"
                        showIcon={false}
                        style={{ backgroundColor: '#ff4d4f20', borderColor: '#ff4d4f' }}
                    />
                </div>
            )}
        </Card>
    );
}
