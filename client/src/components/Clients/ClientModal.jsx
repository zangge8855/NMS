import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Select, InputNumber, Checkbox, Card, Space, Typography, Tag, Row, Col } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import {
    normalizeProtocol,
    UUID_PROTOCOLS, PASSWORD_PROTOCOLS,
} from '../../utils/protocol.js';
import { generateSecurePassword, generateUuidLocal, generateHexToken } from '../../utils/crypto.js';
import toast from 'react-hot-toast';

const { Text, Paragraph } = Typography;

const BATCH_CLIENT_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks']);

function resolveResponseMsg(data, fallback = '') {
    if (!data || typeof data !== 'object') return fallback;
    const primary = String(data.msg || '').trim();
    if (primary) return primary;
    const secondary = String(data.message || '').trim();
    if (secondary) return secondary;
    return fallback;
}

function assertOperationSucceeded(response, fallbackMsg = '操作失败') {
    const data = response?.data;
    if (!data || typeof data !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(data, 'success') && data.success === false) {
        throw new Error(resolveResponseMsg(data, fallbackMsg));
    }
}

function resolveClientIdentifier(client = {}, protocol = '') {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return client.password || client.id || client.email || '';
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return client.id || client.password || client.email || '';
    }
    return client.id || client.password || client.email || '';
}

function buildStableSubId(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return '';
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36).padEnd(16, '0').slice(0, 16);
}

function toLocalDateTimeInput(timestampMs) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(input) {
    const text = String(input || '').trim();
    if (!text) return 0;
    const parsed = new Date(text);
    const ts = parsed.getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function getTargetKey(target = {}) {
    const server = String(target.serverId || '').trim();
    const inbound = String(target.id || target.inboundId || '').trim();
    if (!server || !inbound) return '';
    return `${server}::${inbound}`;
}

export default function ClientModal({
    isOpen,
    onClose,
    inboundId,
    serverId,
    inboundProtocol = '',
    targets = [],
    editingClient = null,
    onSuccess,
    onBatchResult,
}) {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [uuid, setUuid] = useState('');
    const [password, setPassword] = useState('');
    const [subId, setSubId] = useState('');
    const [totalGB, setTotalGB] = useState(0);
    const [expiryMode, setExpiryMode] = useState('never');
    const [expiryDateTime, setExpiryDateTime] = useState('');
    const [expiryAfterDays, setExpiryAfterDays] = useState(0);
    const [enable, setEnable] = useState(true);
    const [limitIp, setLimitIp] = useState(0);
    const [flow, setFlow] = useState('');
    const [editTargets, setEditTargets] = useState([]);
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [selectedInboundKeys, setSelectedInboundKeys] = useState([]);
    const [baseFlowOptions, setBaseFlowOptions] = useState(['', 'xtls-rprx-vision']);
    const [flowProtocols, setFlowProtocols] = useState(['vless']);

    const flowOptions = useMemo(() => {
        if (flow && !baseFlowOptions.includes(flow)) {
            return [...baseFlowOptions, flow];
        }
        return baseFlowOptions;
    }, [flow, baseFlowOptions]);

    useEffect(() => {
        if (isOpen) {
            if (editingClient) {
                const editScopeTargets = Array.isArray(editingClient.editTargets) && editingClient.editTargets.length > 0
                    ? editingClient.editTargets
                    : [editingClient];
                const protocolSet = new Set(
                    editScopeTargets.map((item) => normalizeProtocol(item?.protocol)).filter(Boolean)
                );
                const needsUuid = protocolSet.size === 0 || Array.from(protocolSet).some((item) => UUID_PROTOCOLS.has(item));
                const needsPassword = Array.from(protocolSet).some((item) => PASSWORD_PROTOCOLS.has(item));
                const currentId = String(editingClient.id || '').trim();
                const currentPassword = String(editingClient.password || '').trim();

                setEmail(editingClient.email);
                setUuid(currentId || (needsUuid ? currentPassword : ''));
                setPassword(currentPassword || (needsPassword ? currentId : ''));
                setSubId(editingClient.subId || '');
                setTotalGB(editingClient.totalGB ? editingClient.totalGB / (1024 * 1024 * 1024) : 0);
                {
                    const rawExpiry = Number(editingClient.expiryTime || 0);
                    if (rawExpiry > 0) {
                        setExpiryMode('datetime');
                        setExpiryDateTime(toLocalDateTimeInput(rawExpiry));
                    } else {
                        setExpiryMode('never');
                        setExpiryDateTime('');
                    }
                    setExpiryAfterDays(0);
                }
                setEnable(editingClient.enable !== false);
                setLimitIp(editingClient.limitIp || 0);
                setFlow(editingClient.flow || '');
                setEditTargets(Array.isArray(editingClient.editTargets) ? editingClient.editTargets : []);
                setSelectedServerIds([]);
                setSelectedInboundKeys([]);
            } else {
                const addProtocolSet = new Set((targets || []).map((item) => normalizeProtocol(item?.protocol)).filter(Boolean));
                const normalizedInboundProtocol = normalizeProtocol(inboundProtocol);
                if (addProtocolSet.size === 0 && normalizedInboundProtocol) {
                    addProtocolSet.add(normalizedInboundProtocol);
                }
                const needsUuid = addProtocolSet.size === 0 || Array.from(addProtocolSet).some((item) => UUID_PROTOCOLS.has(item));
                const needsPassword = Array.from(addProtocolSet).some((item) => PASSWORD_PROTOCOLS.has(item));

                setEmail('user_' + Math.random().toString(36).substring(7));
                setUuid(needsUuid ? generateUuidLocal() : '');
                setPassword(needsPassword ? generateSecurePassword() : '');
                setSubId('');
                setTotalGB(0);
                setExpiryMode('never');
                setExpiryDateTime('');
                setExpiryAfterDays(0);
                setEnable(true);
                setLimitIp(0);
                setFlow('');
                setEditTargets([]);
                const uniqueServerIds = Array.from(new Set((targets || []).map((t) => t.serverId).filter(Boolean)));
                setSelectedServerIds(uniqueServerIds);
                setSelectedInboundKeys((targets || []).map((item) => getTargetKey(item)).filter(Boolean));
            }
        }
    }, [editingClient, inboundProtocol, isOpen, targets]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const loadFlowOptions = async () => {
            try {
                const res = await api.get('/protocol-schemas');
                const options = Array.isArray(res.data?.obj?.clientFlowOptions)
                    ? res.data.obj.clientFlowOptions
                    : [];
                const normalized = options.map((item) => String(item));
                if (!cancelled && normalized.length > 0) {
                    setBaseFlowOptions(normalized);
                }
                const protocolList = Array.isArray(res.data?.obj?.clientFlowProtocols)
                    ? res.data.obj.clientFlowProtocols.map((item) => String(item))
                    : [];
                if (!cancelled && protocolList.length > 0) {
                    setFlowProtocols(protocolList);
                }
            } catch {
                if (!cancelled) {
                    setBaseFlowOptions(['', 'xtls-rprx-vision']);
                    setFlowProtocols(['vless']);
                }
            }
        };
        loadFlowOptions();
        return () => { cancelled = true; };
    }, [isOpen]);

    const generateUUID = async () => {
        if (serverId) {
            try {
                const res = await api.get(`/panel/${serverId}/panel/api/server/getNewUUID`);
                if (res.data?.obj) {
                    setUuid(res.data.obj);
                    return;
                }
            } catch { }
        }
        setUuid(generateUuidLocal());
    };

    const availableServers = useMemo(() => {
        const map = new Map();
        (targets || []).forEach((item) => {
            if (!item?.serverId) return;
            if (!map.has(item.serverId)) {
                map.set(item.serverId, item.serverName || String(item.serverId));
            }
        });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [targets]);

    const targetKeysByServer = useMemo(() => {
        const map = new Map();
        (targets || []).forEach((item) => {
            const server = String(item?.serverId || '').trim();
            const key = getTargetKey(item);
            if (!server || !key) return;
            if (!map.has(server)) map.set(server, []);
            map.get(server).push(key);
        });
        return map;
    }, [targets]);

    const visibleTargets = useMemo(() => {
        if (!Array.isArray(targets) || targets.length === 0) return [];
        if (selectedServerIds.length === 0) return [];
        const selectedSet = new Set(selectedServerIds);
        return targets.filter((item) => selectedSet.has(item.serverId));
    }, [targets, selectedServerIds]);

    const visibleTargetKeys = useMemo(
        () => visibleTargets.map((item) => getTargetKey(item)).filter(Boolean),
        [visibleTargets]
    );

    const filteredTargets = useMemo(() => {
        if (visibleTargets.length === 0) return [];
        if (selectedInboundKeys.length === 0) return [];
        const selectedSet = new Set(selectedInboundKeys);
        return visibleTargets.filter((item) => selectedSet.has(getTargetKey(item)));
    }, [selectedInboundKeys, visibleTargets]);

    const activeProtocols = useMemo(() => {
        const protocols = [];
        if (editingClient && editTargets.length > 0) {
            protocols.push(...editTargets.map((item) => item?.protocol));
        } else if (!editingClient && filteredTargets.length > 0) {
            protocols.push(...filteredTargets.map((item) => item?.protocol));
        } else if (editingClient?.protocol) {
            protocols.push(editingClient.protocol);
        } else if (inboundProtocol) {
            protocols.push(inboundProtocol);
        }

        return Array.from(new Set(protocols.map((item) => normalizeProtocol(item)).filter(Boolean)));
    }, [editingClient, editTargets, filteredTargets, inboundProtocol]);

    const requiresUuidCredential = useMemo(() => {
        if (activeProtocols.length === 0) return true;
        return activeProtocols.some((item) => UUID_PROTOCOLS.has(item));
    }, [activeProtocols]);

    const requiresPasswordCredential = useMemo(
        () => activeProtocols.some((item) => PASSWORD_PROTOCOLS.has(item)),
        [activeProtocols]
    );

    const hasMixedCredentialTypes = requiresUuidCredential && requiresPasswordCredential;

    const flowProtocolSet = useMemo(
        () => new Set((flowProtocols || []).map((item) => String(item || '').toLowerCase()).filter(Boolean)),
        [flowProtocols]
    );

    const isFlowSupported = useMemo(() => {
        if (editingClient && editTargets.length > 0) {
            return editTargets.some((item) => flowProtocolSet.has(String(item.protocol || '').toLowerCase()));
        }
        if (!editingClient && filteredTargets.length > 0) {
            return filteredTargets.some((item) => flowProtocolSet.has(String(item.protocol || '').toLowerCase()));
        }
        if (editingClient && editingClient.protocol) {
            return flowProtocolSet.has(String(editingClient.protocol).toLowerCase());
        }
        if (inboundProtocol) {
            return flowProtocolSet.has(String(inboundProtocol).toLowerCase());
        }
        return false;
    }, [editingClient, editTargets, filteredTargets, flowProtocolSet, inboundProtocol]);

    useEffect(() => {
        if (!isFlowSupported && flow) {
            setFlow('');
        }
    }, [isFlowSupported, flow]);

    useEffect(() => {
        if (!isOpen || editingClient) return;
        if (requiresUuidCredential && !uuid) {
            setUuid(generateUuidLocal());
        }
        if (requiresPasswordCredential && !password) {
            setPassword(generateSecurePassword());
        }
    }, [editingClient, isOpen, password, requiresPasswordCredential, requiresUuidCredential, uuid]);

    const handleSubmit = async () => {
        const isBatch = targets.length > 0;
        const isBatchEdit = !!editingClient && editTargets.length > 0;
        if (!isBatch && (!inboundId || !serverId)) {
            if (!isBatchEdit) {
                toast.error('Missing server or inbound ID');
                return;
            }
        }

        setLoading(true);

        try {
            if (isBatch) {
                const unsupported = filteredTargets.filter((item) => !BATCH_CLIENT_PROTOCOLS.has(String(item.protocol || '').toLowerCase()));
                if (unsupported.length > 0) {
                    toast.error('目标中包含不支持批量用户管理的协议');
                    setLoading(false);
                    return;
                }
            }

            if (isBatchEdit) {
                const unsupported = editTargets.filter((item) => !BATCH_CLIENT_PROTOCOLS.has(String(item.protocol || '').toLowerCase()));
                if (unsupported.length > 0) {
                    toast.error('编辑目标包含不支持批量用户管理的协议');
                    setLoading(false);
                    return;
                }
            }

            const normalizedUuid = String(uuid || '').trim();
            const normalizedPassword = String(password || '').trim();
            if (requiresUuidCredential && !normalizedUuid) {
                toast.error('UUID 不能为空');
                setLoading(false);
                return;
            }
            if (requiresPasswordCredential && !normalizedPassword) {
                toast.error('密码不能为空');
                setLoading(false);
                return;
            }

            let resolvedExpiryTime = 0;
            if (expiryMode === 'datetime') {
                resolvedExpiryTime = fromLocalDateTimeInput(expiryDateTime);
                if (!resolvedExpiryTime) {
                    toast.error('请选择有效的到期日期时间');
                    setLoading(false);
                    return;
                }
            } else if (expiryMode === 'days') {
                const days = Number(expiryAfterDays || 0);
                if (!Number.isFinite(days) || days <= 0) {
                    toast.error('请填写大于 0 的天数');
                    setLoading(false);
                    return;
                }
                resolvedExpiryTime = Date.now() + (Math.floor(days) * 24 * 60 * 60 * 1000);
            } else {
                resolvedExpiryTime = 0;
            }

            const derivedSubId = subId || buildStableSubId(email);
            const clientData = {
                id: normalizedUuid,
                password: normalizedPassword,
                email,
                totalGB: Number(totalGB) * 1024 * 1024 * 1024,
                expiryTime: Math.max(0, Number(resolvedExpiryTime || 0)),
                enable,
                tgId: '',
                subId: derivedSubId,
                limitIp: Number(limitIp),
                flow: isFlowSupported ? flow : '',
            };

            if (editingClient) {
                if (isBatchEdit) {
                    const updateTargets = editTargets.map((item) => ({
                        serverId: item.serverId,
                        serverName: item.serverName,
                        inboundId: item.inboundId,
                        protocol: item.protocol,
                        email: item.email || clientData.email,
                        clientIdentifier: item.clientIdentifier || resolveClientIdentifier(item, item.protocol),
                        client: {
                            ...clientData,
                            flow: flowProtocolSet.has(String(item.protocol || '').toLowerCase()) ? clientData.flow : '',
                        },
                    }));

                    const batchPayload = await attachBatchRiskToken({
                        action: 'update',
                        targets: updateTargets,
                        client: clientData,
                    }, {
                        type: 'clients',
                        action: 'update',
                        targetCount: updateTargets.length,
                    });
                    const res = await api.post('/batch/clients', batchPayload);
                    assertOperationSucceeded(res, '批量更新失败');

                    const output = res.data?.obj;
                    const summary = output?.summary || {
                        success: 0,
                        total: updateTargets.length,
                        failed: updateTargets.length,
                    };
                    onBatchResult?.('批量更新用户结果', output || null);

                    if (summary.failed === 0) {
                        toast.success(`批量更新完成: ${summary.success}/${summary.total} 成功`);
                    } else {
                        toast.error(`批量更新完成: ${summary.success}/${summary.total} 成功`);
                    }
                    onSuccess();
                    onClose();
                    setLoading(false);
                    return;
                }

                const clientIdentifier = resolveClientIdentifier(editingClient, editingClient.protocol || inboundProtocol);
                if (!clientIdentifier) {
                    throw new Error('Missing client identifier');
                }

                const params = new URLSearchParams();
                params.append('id', inboundId);
                params.append('settings', JSON.stringify({ clients: [clientData] }));

                let updateMsg = '用户已更新';
                try {
                    const updateRes = await api.post(
                        `/panel/${serverId}/panel/api/inbounds/updateClient/${encodeURIComponent(clientIdentifier)}`,
                        params,
                        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                    );
                    assertOperationSucceeded(updateRes, '更新失败');
                    updateMsg = resolveResponseMsg(updateRes.data, updateMsg);
                } catch {
                    const fallbackRes = await api.post(
                        `/panel/${serverId}/panel/api/inbounds/updateClient/${encodeURIComponent(clientIdentifier)}`,
                        clientData
                    );
                    assertOperationSucceeded(fallbackRes, '更新失败');
                    updateMsg = resolveResponseMsg(fallbackRes.data, updateMsg);
                }
                toast.success(updateMsg);
            } else {
                if (isBatch) {
                    if (filteredTargets.length === 0) {
                        toast.error('请至少选择一个入站');
                        setLoading(false);
                        return;
                    }

                    const batchTargets = filteredTargets.map((t) => ({
                        serverId: t.serverId,
                        serverName: t.serverName,
                        inboundId: t.id,
                        protocol: t.protocol,
                        email: clientData.email,
                        client: {
                            ...clientData,
                            flow: flowProtocolSet.has(String(t.protocol || '').toLowerCase()) ? clientData.flow : '',
                        },
                    }));

                    const batchPayload = await attachBatchRiskToken({
                        action: 'add',
                        targets: batchTargets,
                        client: clientData,
                    }, {
                        type: 'clients',
                        action: 'add',
                        targetCount: batchTargets.length,
                    });
                    const res = await api.post('/batch/clients', batchPayload);
                    assertOperationSucceeded(res, '批量添加失败');

                    const output = res.data?.obj;
                    const summary = output?.summary || {
                        success: 0,
                        total: filteredTargets.length,
                        failed: filteredTargets.length,
                    };
                    onBatchResult?.('批量添加用户结果', output || null);

                    if (summary.failed === 0) {
                        toast.success(`成功添加到 ${summary.success} 个入站`);
                    } else {
                        toast.error(`完成: ${summary.success} 成功, ${summary.failed} 失败`);
                    }

                } else {
                    const settings = { clients: [clientData] };
                    const params = new URLSearchParams();
                    params.append('id', inboundId);
                    params.append('settings', JSON.stringify(settings));

                    const addRes = await api.post(`/panel/${serverId}/panel/api/inbounds/addClient`, params, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    assertOperationSucceeded(addRes, '添加失败');
                    toast.success(resolveResponseMsg(addRes.data, '用户已添加'));
                }
            }
            onSuccess();
            onClose();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '未知错误';
            toast.error(editingClient ? `更新失败: ${msg}` : `添加失败: ${msg}`);
        }
        setLoading(false);
    };

    return (
        <Modal
            title={
                editingClient
                    ? (editTargets.length > 0 ? `批量编辑用户 (${editTargets.length} 个实例)` : '编辑用户')
                    : (targets.length > 0 ? `批量添加用户 (${filteredTargets.length}/${targets.length} 个目标)` : '添加用户')
            }
            open={isOpen}
            onCancel={onClose}
            onOk={handleSubmit}
            confirmLoading={loading}
            width={800}
            okText="保存"
            cancelText="取消"
        >
            <Form layout="vertical" style={{ marginTop: '24px' }}>
                {targets.length > 0 && !editingClient && (
                    <Card size="small" style={{ marginBottom: '24px', background: 'rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ marginBottom: '12px' }}>
                            <Text strong>目标节点 ({selectedServerIds.length}/{availableServers.length})：</Text>
                        </div>
                        <Space wrap style={{ marginBottom: '16px' }}>
                            <Tag color="blue" style={{ cursor: 'pointer' }}>
                                <Checkbox
                                    checked={availableServers.length > 0 && selectedServerIds.length === availableServers.length}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedServerIds(availableServers.map((item) => item.id));
                                            setSelectedInboundKeys((targets || []).map((item) => getTargetKey(item)).filter(Boolean));
                                        } else {
                                            setSelectedServerIds([]);
                                            setSelectedInboundKeys([]);
                                        }
                                    }}
                                >
                                    全选
                                </Checkbox>
                            </Tag>
                            {availableServers.map((item) => (
                                <Tag key={item.id} color={selectedServerIds.includes(item.id) ? 'blue' : 'default'} style={{ cursor: 'pointer' }}>
                                    <Checkbox
                                        checked={selectedServerIds.includes(item.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedServerIds((prev) => [...new Set([...prev, item.id])]);
                                                setSelectedInboundKeys((prev) => {
                                                    const next = new Set(prev);
                                                    const serverKeys = targetKeysByServer.get(item.id) || [];
                                                    serverKeys.forEach((key) => next.add(key));
                                                    return Array.from(next);
                                                });
                                            } else {
                                                setSelectedServerIds((prev) => prev.filter((id) => id !== item.id));
                                                setSelectedInboundKeys((prev) => {
                                                    const removeSet = new Set(targetKeysByServer.get(item.id) || []);
                                                    return prev.filter((key) => !removeSet.has(key));
                                                });
                                            }
                                        }}
                                    >
                                        {item.name}
                                    </Checkbox>
                                </Tag>
                            ))}
                        </Space>
                        <div style={{ marginBottom: '12px' }}>
                            <Text strong>目标入站 ({filteredTargets.length}/{visibleTargets.length})：</Text>
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                            <Tag color="cyan" style={{ cursor: 'pointer' }}>
                                <Checkbox
                                    checked={visibleTargets.length > 0 && filteredTargets.length === visibleTargets.length}
                                    onChange={(e) => {
                                        const visibleSet = new Set(visibleTargetKeys);
                                        if (e.target.checked) {
                                            setSelectedInboundKeys((prev) => Array.from(new Set([...prev, ...visibleTargetKeys])));
                                        } else {
                                            setSelectedInboundKeys((prev) => prev.filter((key) => !visibleSet.has(key)));
                                        }
                                    }}
                                >
                                    全选当前节点入站
                                </Checkbox>
                            </Tag>
                        </div>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '4px', padding: '8px' }}>
                            {visibleTargets.length === 0 ? (
                                <Text type="secondary">请先选择节点</Text>
                            ) : (
                                <Space orientation="vertical" style={{ width: '100%' }}>
                                    {visibleTargets.map((t) => {
                                        const key = getTargetKey(t);
                                        const checked = selectedInboundKeys.includes(key);
                                        return (
                                            <Checkbox
                                                key={key}
                                                checked={checked}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedInboundKeys((prev) => [...new Set([...prev, key])]);
                                                    } else {
                                                        setSelectedInboundKeys((prev) => prev.filter((item) => item !== key));
                                                    }
                                                }}
                                            >
                                                <Text size="small">[{t.serverName}] {t.remark} ({t.protocol}:{t.port})</Text>
                                            </Checkbox>
                                        );
                                    })}
                                </Space>
                            )}
                        </div>
                    </Card>
                )}

                {editingClient && editTargets.length > 0 && (
                    <Card size="small" style={{ marginBottom: '24px', background: 'rgba(255, 255, 255, 0.05)' }}>
                        <Text strong>将同步到以下实例:</Text>
                        <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '12px', color: 'rgba(255, 255, 255, 0.65)' }}>
                            {editTargets.map((t, idx) => (
                                <li key={`${t.serverId}-${t.inboundId}-${idx}`}>
                                    [{t.serverName}] {t.inboundRemark || t.protocol} ({t.inboundPort})
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}

                <Form.Item label="Email" required>
                    <Input value={email} onChange={e => setEmail(e.target.value)} />
                </Form.Item>

                <Row gutter={16}>
                    <Col span={requiresPasswordCredential ? 12 : 24}>
                        {requiresUuidCredential && (
                            <Form.Item label="UUID" required={requiresUuidCredential}>
                                <Input.Search
                                    className="font-mono"
                                    value={uuid}
                                    onChange={e => setUuid(e.target.value)}
                                    enterButton={<ReloadOutlined />}
                                    onSearch={generateUUID}
                                />
                            </Form.Item>
                        )}
                    </Col>
                    <Col span={12}>
                        {requiresPasswordCredential && (
                            <Form.Item label="密码" required={requiresPasswordCredential}>
                                <Input.Search
                                    className="font-mono"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    enterButton={<ReloadOutlined />}
                                    onSearch={() => setPassword(generateSecurePassword())}
                                />
                            </Form.Item>
                        )}
                    </Col>
                </Row>

                {hasMixedCredentialTypes && (
                    <Paragraph type="secondary" style={{ fontSize: '12px', marginTop: '-12px', marginBottom: '16px' }}>
                        当前选择包含多种协议：VMess/VLESS 使用 UUID，Trojan/Shadowsocks 使用密码。
                    </Paragraph>
                )}

                <Form.Item
                    label="订阅 ID (SubId)"
                    help="重置此 ID 会导致旧的订阅链接失效，需重新获取订阅"
                >
                    <Input.Search
                        className="font-mono"
                        value={subId}
                        placeholder="(自动生成)"
                        readOnly
                        enterButton="重置"
                        onSearch={() => {
                            setSubId(generateHexToken(8));
                            toast.success('已生成新订阅ID');
                        }}
                    />
                </Form.Item>

                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item label="流控 (Flow)">
                            {isFlowSupported ? (
                                <Select value={flow} onChange={setFlow}>
                                    {flowOptions.map((item) => (
                                        <Select.Option key={item || '__empty'} value={item}>
                                            {item ? item : '不设置'}
                                        </Select.Option>
                                    ))}
                                </Select>
                            ) : (
                                <Input value="当前目标协议不支持 Flow" disabled />
                            )}
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item label="流量限制 (GB)" tooltip="0 为不限制">
                            <InputNumber
                                style={{ width: '100%' }}
                                min={0}
                                value={totalGB}
                                onChange={setTotalGB}
                                addonAfter="GB"
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item label="到期策略">
                            <Space orientation="vertical" style={{ width: '100%' }}>
                                <Select value={expiryMode} onChange={setExpiryMode} style={{ width: '100%' }}>
                                    <Select.Option value="never">永不过期</Select.Option>
                                    <Select.Option value="datetime">指定日期时间</Select.Option>
                                    <Select.Option value="days">N 天后过期</Select.Option>
                                </Select>
                                {expiryMode === 'datetime' && (
                                    <Input
                                        type="datetime-local"
                                        value={expiryDateTime}
                                        onChange={(e) => setExpiryDateTime(e.target.value)}
                                    />
                                )}
                                {expiryMode === 'days' && (
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={1}
                                        value={expiryAfterDays}
                                        onChange={setExpiryAfterDays}
                                        placeholder="例如: 30"
                                        addonAfter="天"
                                    />
                                )}
                            </Space>
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item label="IP 限制" tooltip="0 为不限制">
                            <InputNumber
                                style={{ width: '100%' }}
                                min={0}
                                value={limitIp}
                                onChange={setLimitIp}
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Form.Item>
                    <Checkbox checked={enable} onChange={e => setEnable(e.target.checked)}>
                        启用此用户
                    </Checkbox>
                </Form.Item>
            </Form>
        </Modal>
    );
}
