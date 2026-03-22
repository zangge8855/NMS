import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Checkbox, InputNumber, Card, Typography, Space, Skeleton, Row, Col, Tag } from 'antd';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import { bytesToGigabytesInput, gigabytesInputToBytes, normalizeLimitIp } from '../../utils/entitlements.js';

const { Text } = Typography;

const PROTOCOL_OPTIONS = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
];
const PROTOCOL_KEY_SET = new Set(PROTOCOL_OPTIONS.map((item) => item.key));

function normalizeScopeMode(mode, selectedItems = []) {
    const hasSelected = Array.isArray(selectedItems) && selectedItems.length > 0;
    const fallback = hasSelected ? 'selected' : 'all';
    const text = String(mode || '').trim().toLowerCase();
    if (!text) return fallback;
    if (!['all', 'selected', 'none'].includes(text)) return fallback;
    if (text === 'selected' && !hasSelected) return 'none';
    return text;
}

export default function UserPolicyModal({ isOpen, email, servers = [], onClose }) {
    const normalizedEmail = useMemo(() => String(email || '').trim().toLowerCase(), [email]);
    const validServerIdSet = useMemo(() => new Set((Array.isArray(servers) ? servers : []).map((item) => item.id)), [servers]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [noServerLimit, setNoServerLimit] = useState(true);
    const [noProtocolLimit, setNoProtocolLimit] = useState(true);
    const [selectedServerIds, setSelectedServerIds] = useState([]);
    const [selectedProtocols, setSelectedProtocols] = useState([]);
    const [limitIp, setLimitIp] = useState(0);
    const [trafficLimitGb, setTrafficLimitGb] = useState(0);

    useEffect(() => {
        if (!isOpen || !normalizedEmail) return;
        let cancelled = false;

        const loadPolicy = async () => {
            setLoading(true);
            setSelectedServerIds([]);
            setSelectedProtocols([]);
            setNoServerLimit(true);
            setNoProtocolLimit(true);
            setLimitIp(0);
            setTrafficLimitGb(0);
            try {
                const res = await api.get(`/user-policy/${encodeURIComponent(normalizedEmail)}`);
                const payload = res.data?.obj || {};
                const rawServerIds = Array.isArray(payload.allowedServerIds) ? payload.allowedServerIds : [];
                const serverIds = rawServerIds.filter((item) => validServerIdSet.has(item));
                const protocols = (Array.isArray(payload.allowedProtocols) ? payload.allowedProtocols : [])
                    .filter((item) => PROTOCOL_KEY_SET.has(String(item || '').trim().toLowerCase()));
                const serverScopeMode = normalizeScopeMode(payload.serverScopeMode, rawServerIds);
                const protocolScopeMode = normalizeScopeMode(payload.protocolScopeMode, protocols);
                if (cancelled) return;
                setSelectedServerIds(serverIds);
                setSelectedProtocols(protocols);
                setNoServerLimit(serverScopeMode === 'all');
                setNoProtocolLimit(protocolScopeMode === 'all');
                setLimitIp(normalizeLimitIp(payload.limitIp));
                setTrafficLimitGb(Number(bytesToGigabytesInput(payload.trafficLimitBytes)));
            } catch (error) {
                if (!cancelled) {
                    const msg = error.response?.data?.msg || error.message || '权限策略加载失败';
                    toast.error(msg);
                }
            }
            if (!cancelled) setLoading(false);
        };

        loadPolicy();
        return () => { cancelled = true; };
    }, [isOpen, normalizedEmail, validServerIdSet]);

    const toggleServerId = (serverId, checked) => {
        setSelectedServerIds((prev) => {
            if (checked) return Array.from(new Set([...prev, serverId]));
            return prev.filter((item) => item !== serverId);
        });
    };

    const toggleProtocol = (protocol, checked) => {
        setSelectedProtocols((prev) => {
            if (checked) return Array.from(new Set([...prev, protocol]));
            return prev.filter((item) => item !== protocol);
        });
    };

    const handleSubmit = async () => {
        if (!normalizedEmail) {
            toast.error('邮箱为空');
            return;
        }

        const normalizedServerIds = selectedServerIds.filter((item) => validServerIdSet.has(item));
        const normalizedProtocols = selectedProtocols
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => PROTOCOL_KEY_SET.has(item));
        const serverScopeMode = noServerLimit ? 'all' : (normalizedServerIds.length > 0 ? 'selected' : 'none');
        const protocolScopeMode = noProtocolLimit ? 'all' : (normalizedProtocols.length > 0 ? 'selected' : 'none');
        const payload = {
            allowedServerIds: serverScopeMode === 'selected' ? normalizedServerIds : [],
            allowedProtocols: protocolScopeMode === 'selected' ? normalizedProtocols : [],
            serverScopeMode,
            protocolScopeMode,
            limitIp: normalizeLimitIp(limitIp),
            trafficLimitBytes: gigabytesInputToBytes(trafficLimitGb),
        };

        setSaving(true);
        try {
            await api.put(`/user-policy/${encodeURIComponent(normalizedEmail)}`, payload);
            toast.success('订阅权限已保存');
            onClose();
        } catch (error) {
            const msg = error.response?.data?.msg || error.message || '保存失败';
            toast.error(msg);
        }
        setSaving(false);
    };

    return (
        <Modal
            title="订阅权限策略"
            open={isOpen}
            onCancel={onClose}
            onOk={handleSubmit}
            confirmLoading={saving}
            width={720}
            okText="保存策略"
            cancelText="取消"
        >
            <div style={{ marginTop: '16px' }}>
                <Card size="small" style={{ marginBottom: '24px', background: 'rgba(255, 255, 255, 0.05)' }}>
                    <Text type="secondary">用户: </Text>
                    <Text strong>{normalizedEmail || '-'}</Text>
                </Card>

                {loading ? (
                    <Skeleton active />
                ) : (
                    <Form layout="vertical">
                        <Card
                            title={
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>可访问服务器</span>
                                    <Checkbox
                                        checked={noServerLimit}
                                        onChange={(e) => setNoServerLimit(e.target.checked)}
                                    >
                                        不限制
                                    </Checkbox>
                                </div>
                            }
                            size="small"
                            style={{ marginBottom: '16px' }}
                        >
                            <Space wrap>
                                {servers.map((server) => (
                                    <Tag
                                        key={server.id}
                                        color={selectedServerIds.includes(server.id) ? 'blue' : 'default'}
                                        style={{ cursor: noServerLimit ? 'not-allowed' : 'pointer', padding: '4px 8px' }}
                                    >
                                        <Checkbox
                                            disabled={noServerLimit}
                                            checked={selectedServerIds.includes(server.id)}
                                            onChange={(e) => toggleServerId(server.id, e.target.checked)}
                                        >
                                            {server.name}
                                        </Checkbox>
                                    </Tag>
                                ))}
                                {servers.length === 0 && <Text type="secondary">暂无服务器</Text>}
                            </Space>
                        </Card>

                        <Card
                            title={
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>可用协议</span>
                                    <Checkbox
                                        checked={noProtocolLimit}
                                        onChange={(e) => setNoProtocolLimit(e.target.checked)}
                                    >
                                        不限制
                                    </Checkbox>
                                </div>
                            }
                            size="small"
                            style={{ marginBottom: '16px' }}
                        >
                            <Space wrap>
                                {PROTOCOL_OPTIONS.map((item) => (
                                    <Tag
                                        key={item.key}
                                        color={selectedProtocols.includes(item.key) ? 'green' : 'default'}
                                        style={{ cursor: noProtocolLimit ? 'not-allowed' : 'pointer', padding: '4px 8px' }}
                                    >
                                        <Checkbox
                                            disabled={noProtocolLimit}
                                            checked={selectedProtocols.includes(item.key)}
                                            onChange={(e) => toggleProtocol(item.key, e.target.checked)}
                                        >
                                            {item.label}
                                        </Checkbox>
                                    </Tag>
                                ))}
                            </Space>
                        </Card>

                        <Card title="统一限额" size="small">
                            <Row gutter={16}>
                                <Col span={12}>
                                    <Form.Item label="IP 限制" help="0 表示不限制并发连接 IP 数量">
                                        <InputNumber
                                            min={0}
                                            value={limitIp}
                                            onChange={setLimitIp}
                                            style={{ width: '100%' }}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item label="总流量上限" help="0 表示不限制总流量">
                                        <InputNumber
                                            min={0}
                                            step={0.5}
                                            value={trafficLimitGb}
                                            onChange={setTrafficLimitGb}
                                            addonAfter="GB"
                                            style={{ width: '100%' }}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    </Form>
                )}
            </div>
        </Modal>
    );
}
