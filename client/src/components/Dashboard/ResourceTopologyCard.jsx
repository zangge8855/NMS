import React, { useMemo } from 'react';
import {
    HiOutlineCircleStack,
    HiOutlineCloud,
    HiOutlineServerStack,
    HiOutlineArrowPath,
    HiOutlineExclamationTriangle,
} from 'react-icons/hi2';
import { useI18n } from '../../contexts/LanguageContext.jsx';

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
    return (
        <div className={`resource-topology-node resource-topology-node--${tone}`}>
            <div className="resource-topology-node-head">
                <span className="resource-topology-node-icon" aria-hidden="true">
                    <Icon />
                </span>
                <div className="resource-topology-node-copy">
                    <div className="resource-topology-node-label">{label}</div>
                    <div className="resource-topology-node-status">{status}</div>
                </div>
            </div>
            <div className="resource-topology-node-detail">{detail}</div>
            {action}
        </div>
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
        <div className="card resource-topology-card">
            <div className="resource-topology-head">
                <div>
                    <div className="resource-topology-title">{copy.title}</div>
                    <div className="resource-topology-subtitle">{copy.subtitle}</div>
                </div>
                <div className="resource-topology-stat-strip" aria-label={copy.title}>
                    <span className="resource-topology-stat-pill">
                        {copy.totalNodes} {summary.total}
                    </span>
                    <span className="resource-topology-stat-pill is-success">
                        {copy.onlineNodes} {summary.online}
                    </span>
                    <span className={`resource-topology-stat-pill${summary.offline > 0 ? ' is-danger' : ''}`}>
                        {copy.offlineNodes} {summary.offline}
                    </span>
                </div>
            </div>

            <div className="resource-topology-flow">
                <ResourceNode
                    icon={HiOutlineCloud}
                    label={copy.control}
                    status={copy.edgeHealthy}
                    detail="API / WS / Task Queue"
                    tone="primary"
                />
                <div className={`resource-topology-link${summary.dbReady ? ' is-ok' : ' is-warning'}`} aria-hidden="true">
                    <span className="resource-topology-link-dot" />
                    <span className="resource-topology-link-line" />
                </div>
                <ResourceNode
                    icon={HiOutlineCircleStack}
                    label={copy.storage}
                    status={summary.dbReady ? copy.dbReady : copy.dbOffline}
                    detail={summary.dbDetail}
                    tone={summary.dbReady ? 'success' : 'warning'}
                />
                <div className={`resource-topology-link${summary.offline > 0 ? ' is-danger' : ' is-ok'}`} aria-hidden="true">
                    <span className={`resource-topology-link-dot${summary.offline > 0 ? ' is-alert' : ''}`} />
                    <span className="resource-topology-link-line" />
                </div>
                <ResourceNode
                    icon={HiOutlineServerStack}
                    label={copy.nodes}
                    status={summary.offline > 0 ? copy.edgeWarning : copy.edgeHealthy}
                    detail={`${summary.online} / ${summary.total}`}
                    tone={summary.offline > 0 ? 'danger' : 'success'}
                    action={typeof onOpenServers === 'function' ? (
                        <button type="button" className="resource-topology-action" onClick={onOpenServers}>
                            <HiOutlineArrowPath />
                            {copy.openServers}
                        </button>
                    ) : null}
                />
            </div>

            <div className="resource-topology-alerts">
                <div className="resource-topology-alerts-title">
                    <HiOutlineExclamationTriangle />
                    {copy.offlineTitle}
                </div>
                {summary.offlineNodes.length === 0 ? (
                    <div className="resource-topology-empty">{copy.offlineNone}</div>
                ) : (
                    <div className="resource-topology-offline-list">
                        {summary.offlineNodes.map((item) => (
                            <span key={item.serverId} className="resource-topology-offline-pill">
                                <span className="resource-topology-offline-dot" />
                                {item.serverName}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
