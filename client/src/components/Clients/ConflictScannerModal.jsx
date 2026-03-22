import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, Table, Select, Button, Card, Badge, Tag, Typography, Skeleton, Empty, Space } from 'antd';
import {
    ReloadOutlined,
    ExclamationTriangleOutlined,
    WrenchOutlined,
} from '@ant-design/icons';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import { formatBytes } from '../../utils/format.js';
import {
    buildClientConflictReport,
    buildClientEntryLocator,
    findConflictSourceEntry,
    getClientIdentifier,
    getConflictTypeLabels,
} from '../../utils/clientConflict.js';

const { Text } = Typography;

const UUID_PROTOCOLS = new Set(['vmess', 'vless']);
const PASSWORD_PROTOCOLS = new Set(['trojan', 'shadowsocks']);

function normalizeProtocol(value) {
    return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatExpiry(value) {
    const ts = toNumber(value, 0);
    if (!ts) return '永久';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN');
}

function buildClientPayload(entry = {}) {
    const protocol = normalizeProtocol(entry.protocol);
    const payload = {
        id: '',
        password: '',
        email: entry.email || '',
        totalGB: toNumber(entry.totalGB, 0),
        expiryTime: toNumber(entry.expiryTime, 0),
        enable: entry.enable !== false,
        tgId: entry.tgId || '',
        subId: entry.subId || '',
        limitIp: toNumber(entry.limitIp, 0),
        flow: entry.flow || '',
    };

    if (UUID_PROTOCOLS.has(protocol)) {
        payload.id = entry.id || entry.password || '';
        payload.password = entry.password || '';
        return payload;
    }

    if (PASSWORD_PROTOCOLS.has(protocol)) {
        payload.id = entry.id || '';
        payload.password = entry.password || entry.id || '';
        return payload;
    }

    payload.id = entry.id || entry.password || entry.email || '';
    payload.password = entry.password || entry.id || entry.email || '';
    return payload;
}

function selectionKey(groupKey, protocol) {
    return `${groupKey}::${protocol}`;
}

export default function ConflictScannerModal({
    isOpen,
    onClose,
    clients = [],
    onRefreshClients,
    onShowBatchResult,
}) {
    const [report, setReport] = useState(() => buildClientConflictReport([]));
    const [selectionMap, setSelectionMap] = useState({});
    const [scanning, setScanning] = useState(false);
    const [resolvingKey, setResolvingKey] = useState('');

    const conflictGroups = report?.groups || [];

    const summary = useMemo(() => {
        const base = report?.summary || { conflictGroups: 0, high: 0, medium: 0 };
        return {
            conflictGroups: base.conflictGroups || 0,
            high: base.high || 0,
            medium: base.medium || 0,
        };
    }, [report]);

    const runScan = (sourceClients) => {
        setScanning(true);
        const next = buildClientConflictReport(sourceClients);
        setReport(next);
        setScanning(false);
    };

    useEffect(() => {
        if (!isOpen) return;
        runScan(clients);
    }, [isOpen, clients]);

    useEffect(() => {
        if (!isOpen) return;
        setSelectionMap((prev) => {
            const next = { ...prev };
            conflictGroups.forEach((group) => {
                (group.protocols || []).forEach((protocolGroup) => {
                    const key = selectionKey(group.groupKey, protocolGroup.protocol);
                    if (!next[key]) {
                        next[key] = protocolGroup.recommendedSourceKey || '';
                    }
                });
            });
            return next;
        });
    }, [conflictGroups, isOpen]);

    const refreshFromServer = async () => {
        if (!onRefreshClients) {
            runScan(clients);
            return;
        }
        setScanning(true);
        try {
            const latest = await onRefreshClients();
            runScan(Array.isArray(latest) ? latest : clients);
        } catch {
            runScan(clients);
        } finally {
            setScanning(false);
        }
    };

    const resolveProtocolConflict = async (group, protocolGroup) => {
        const key = selectionKey(group.groupKey, protocolGroup.protocol);
        const sourceKey = selectionMap[key] || protocolGroup.recommendedSourceKey;
        const sourceEntry = findConflictSourceEntry(protocolGroup, sourceKey);
        if (!sourceEntry) {
            toast.error('未找到可用来源记录');
            return;
        }

        const sourceLocator = buildClientEntryLocator(sourceEntry);
        const targets = (protocolGroup.entries || [])
            .filter((entry) => buildClientEntryLocator(entry) !== sourceLocator)
            .map((entry) => ({
                serverId: entry.serverId,
                serverName: entry.serverName,
                inboundId: entry.inboundId,
                protocol: entry.protocol,
                email: entry.email || '',
                clientIdentifier: getClientIdentifier(entry),
            }));

        if (targets.length === 0) {
            toast.error('没有需要修复的目标');
            return;
        }

        const clientPayload = buildClientPayload(sourceEntry);
        if (!targets.every((target) => String(target.clientIdentifier || '').trim())) {
            toast.error('存在空标识目标，无法自动修复');
            return;
        }

        setResolvingKey(key);
        try {
            const requestBody = {
                action: 'update',
                targets,
                client: clientPayload,
            };
            const payload = await attachBatchRiskToken(requestBody, {
                type: 'clients',
                action: 'update',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/clients', payload);
            const output = res.data?.obj || null;
            const summaryInfo = output?.summary || { success: 0, total: targets.length, failed: targets.length };

            if (onShowBatchResult && output) {
                onShowBatchResult('冲突修复结果', output);
            }

            if (summaryInfo.failed > 0) {
                toast.error(`修复完成：${summaryInfo.success}/${summaryInfo.total} 成功`);
            } else {
                toast.success(`修复完成：${summaryInfo.success}/${summaryInfo.total} 成功`);
            }

            await refreshFromServer();
        } catch (error) {
            toast.error(error.response?.data?.msg || error.message || '修复失败');
        } finally {
            setResolvingKey('');
        }
    };

    return (
        <Modal
            title="冲突扫描与修复"
            open={isOpen}
            onCancel={onClose}
            footer={[
                <Button key="close" onClick={onClose}>
                    关闭
                </Button>
            ]}
            width={1200}
            centered
        >
            <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <Space size="middle">
                        <Tag color="default">冲突组 {summary.conflictGroups}</Tag>
                        <Tag color="error">高风险 {summary.high}</Tag>
                        <Tag color="warning">中风险 {summary.medium}</Tag>
                    </Space>
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={refreshFromServer}
                        loading={scanning}
                    >
                        重新扫描
                    </Button>
                </div>

                {scanning ? (
                    <Skeleton active />
                ) : conflictGroups.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <span>
                                <strong>未检测到可识别冲突</strong>
                                <br />
                                <Text type="secondary">同一身份在同协议下未发现参数分歧。</Text>
                            </span>
                        }
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {conflictGroups.map((group) => (
                            <Card
                                key={group.groupKey}
                                size="small"
                                title={
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
                                        <div>
                                            <Text strong style={{ fontSize: '16px' }}>{group.displayIdentity}</Text>
                                            <div style={{ fontSize: '12px', fontWeight: 'normal', color: 'rgba(255, 255, 255, 0.45)' }}>
                                                {group.entryCount} 条记录 / {group.serverCount} 节点
                                            </div>
                                        </div>
                                        <Tag
                                            color={group.severity === 'high' ? 'error' : 'warning'}
                                            icon={<ExclamationTriangleOutlined />}
                                        >
                                            {group.severity === 'high' ? '高风险' : '中风险'}
                                        </Tag>
                                    </div>
                                }
                            >
                                <Space wrap style={{ marginBottom: '16px' }}>
                                    {getConflictTypeLabels(group.conflictTypes).map((label) => (
                                        <Tag key={`${group.groupKey}-${label}`}>{label}</Tag>
                                    ))}
                                </Space>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {(group.protocols || []).map((protocolGroup) => {
                                        const key = selectionKey(group.groupKey, protocolGroup.protocol);
                                        const selectedSourceKey = selectionMap[key] || protocolGroup.recommendedSourceKey || '';
                                        const resolving = resolvingKey === key;

                                        return (
                                            <Card
                                                key={key}
                                                type="inner"
                                                size="small"
                                                title={`协议 ${String(protocolGroup.protocol || '').toUpperCase()} · ${protocolGroup.entryCount} 条`}
                                                extra={<Text type="secondary" size="small">差异字段: {protocolGroup.diffFields.join(', ') || '-'}</Text>}
                                            >
                                                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <Select
                                                        style={{ flex: 1, minWidth: '300px' }}
                                                        value={selectedSourceKey}
                                                        onChange={(value) => setSelectionMap((prev) => ({ ...prev, [key]: value }))}
                                                        options={(protocolGroup.sourceCandidates || []).map((candidate) => ({
                                                            value: candidate.sourceKey,
                                                            label: `${candidate.serverName} / ${candidate.inboundRemark || '-'} / ${candidate.identifier || '(空标识)'}`
                                                        }))}
                                                    />
                                                    <Button
                                                        type="primary"
                                                        icon={<WrenchOutlined />}
                                                        onClick={() => resolveProtocolConflict(group, protocolGroup)}
                                                        loading={resolving}
                                                        disabled={scanning}
                                                    >
                                                        按来源覆盖其他节点
                                                    </Button>
                                                </div>

                                                <Table
                                                    size="small"
                                                    dataSource={protocolGroup.entries}
                                                    pagination={false}
                                                    rowKey={(record) => `${buildClientEntryLocator(record)}-${record.uiKey || ''}`}
                                                    columns={[
                                                        { title: '节点', dataIndex: 'serverName', key: 'serverName', render: (text, record) => text || record.serverId },
                                                        { title: '入站', dataIndex: 'inboundRemark', key: 'inboundRemark', render: (text, record) => text || record.inboundId },
                                                        { title: '标识', key: 'identifier', className: 'font-mono text-xs', render: (_, record) => getClientIdentifier(record) || '-' },
                                                        {
                                                            title: '启用',
                                                            dataIndex: 'enable',
                                                            key: 'enable',
                                                            align: 'center',
                                                            render: (enable) => (
                                                                <Tag color={enable === false ? 'error' : 'success'}>
                                                                    {enable === false ? '停用' : '启用'}
                                                                </Tag>
                                                            ),
                                                        },
                                                        { title: '有效期', dataIndex: 'expiryTime', key: 'expiryTime', align: 'center', className: 'cell-mono', render: (time) => formatExpiry(time) },
                                                        { title: '总量', dataIndex: 'totalGB', key: 'totalGB', align: 'right', className: 'cell-mono-right', render: (val) => formatBytes(toNumber(val, 0)) },
                                                        {
                                                            title: '来源',
                                                            key: 'source',
                                                            align: 'center',
                                                            render: (_, record) => {
                                                                const locator = buildClientEntryLocator(record);
                                                                return locator === selectedSourceKey ? <Tag color="blue">来源</Tag> : '-';
                                                            }
                                                        }
                                                    ]}
                                                />
                                            </Card>
                                        );
                                    })}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
