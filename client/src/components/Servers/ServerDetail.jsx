import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
    Card, 
    Typography, 
    Button, 
    Tabs, 
    Row, 
    Col, 
    Tag, 
    Table, 
    Statistic, 
    Descriptions, 
    Badge, 
    Avatar, 
    Space, 
    Empty, 
    Divider, 
    List,
    Tooltip,
    Progress
} from 'antd';
import {
    HiOutlineArrowLeft,
    HiOutlineArrowPath,
    HiOutlineCpuChip,
    HiOutlineCircleStack,
    HiOutlineClock,
    HiOutlineGlobeAlt,
    HiOutlineServerStack,
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import ClientIpModal from '../UI/ClientIpModal.jsx';
import useAnimatedCounter from '../../hooks/useAnimatedCounter.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { formatBytes, formatDateTime, formatUptime } from '../../utils/format.js';
import { normalizeInboundOrderMap, sortInboundsByOrder } from '../../utils/inboundOrder.js';
import { isUnsupportedPanelClientIpsError, normalizePanelClientIps } from '../../utils/panelClientIps.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import InboundRemarkPill from '../UI/InboundRemarkPill.jsx';

const { Title, Text, Paragraph } = Typography;

function formatTime(ts, locale = 'zh-CN') {
    return formatDateTime(ts, locale);
}

export default function ServerDetail() {
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const { serverId } = useParams();
    const navigate = useNavigate();
    const confirmAction = useConfirm();

    const [loading, setLoading] = useState(true);
    const [server, setServer] = useState(null);
    const [status, setStatus] = useState(null);
    const [inbounds, setInbounds] = useState([]);
    const [onlines, setOnlines] = useState([]);
    const [inboundsLoading, setInboundsLoading] = useState(true);
    const [onlinesLoading, setOnlinesLoading] = useState(true);
    const [auditEvents, setAuditEvents] = useState([]);
    const [activeTab, setActiveTab] = useState('overview');
    const [clientIpSupport, setClientIpSupport] = useState({ supported: true, reason: '' });
    const [clientIpModal, setClientIpModal] = useState({
        open: false,
        email: '',
        items: [],
        loading: false,
        clearing: false,
        error: '',
    });

    const fetchServer = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/servers/${encodeURIComponent(serverId)}`);
            if (res.data?.success) {
                setServer(res.data.obj);
            } else {
                toast.error('服务器不存在');
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || '加载服务器信息失败');
        }
        setLoading(false);
    };

    const fetchStatus = async () => {
        try {
            const res = await api.get(`/panel/${encodeURIComponent(serverId)}/panel/api/server/status`);
            if (res.data?.success) {
                setStatus(res.data.obj);
            }
        } catch { /* server may be offline */ }
    };

    const fetchInbounds = async () => {
        setInboundsLoading(true);
        try {
            const [res, orderRes] = await Promise.all([
                api.get(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/list`),
                api.get('/system/inbounds/order').catch(() => ({ data: { obj: {} } })),
            ]);
            const rows = Array.isArray(res.data?.obj) ? res.data.obj.map((item) => ({
                ...item,
                serverId,
                serverName: server?.name || '',
            })) : [];
            const orderMap = normalizeInboundOrderMap(orderRes.data?.obj || {});
            const sorted = sortInboundsByOrder(rows, orderMap).map(({ serverId: _sid, serverName: _sname, ...item }) => item);
            setInbounds(sorted);
        } catch {
            setInbounds([]);
        }
        setInboundsLoading(false);
    };

    const fetchOnlines = async () => {
        setOnlinesLoading(true);
        try {
            const res = await api.post(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/onlines`);
            const data = res.data?.obj || [];
            const users = [];
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (typeof item === 'string') {
                        const email = item.trim();
                        if (email) users.push(email);
                    } else if (item?.email) {
                        const email = String(item.email).trim();
                        if (email) users.push(email);
                    }
                });
            }
            setOnlines(users);
        } catch {
            setOnlines([]);
        }
        setOnlinesLoading(false);
    };

    const fetchAudit = async () => {
        try {
            const res = await api.get('/audit/events', { params: { serverId, pageSize: 20 } });
            setAuditEvents(res.data?.obj?.items || []);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        setInbounds([]);
        setOnlines([]);
        setInboundsLoading(true);
        setOnlinesLoading(true);
        setClientIpSupport({ supported: true, reason: '' });
        closeClientIpModal();
        fetchServer();
        fetchStatus();
        fetchInbounds();
        fetchOnlines();
    }, [serverId]);

    useEffect(() => {
        if (activeTab === 'onlines') fetchOnlines();
        if (activeTab === 'audit') fetchAudit();
    }, [activeTab, serverId]);

    const totalTraffic = useMemo(() => {
        return inbounds.reduce((sum, ib) => sum + (ib.up || 0) + (ib.down || 0), 0);
    }, [inbounds]);

    const activeInbounds = useMemo(() => inbounds.filter(ib => ib.enable !== false).length, [inbounds]);
    const onlineUsers = useMemo(() => {
        const grouped = new Map();
        onlines.forEach((item) => {
            const email = String(item || '').trim();
            if (!email) return;
            const current = grouped.get(email) || { email, sessions: 0 };
            current.sessions += 1;
            grouped.set(email, current);
        });
        return Array.from(grouped.values()).sort((a, b) => {
            if (b.sessions !== a.sessions) return b.sessions - a.sessions;
            return a.email.localeCompare(b.email, 'zh-CN');
        });
    }, [onlines]);

    const clientCount = useMemo(() => {
        let count = 0;
        for (const ib of inbounds) {
            try {
                const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : (ib.settings || {});
                count += (settings.clients || []).length;
            } catch { /* ignore */ }
        }
        return count;
    }, [inbounds]);

    const refreshAll = () => {
        fetchServer();
        fetchStatus();
        fetchInbounds();
        fetchOnlines();
    };

    const closeClientIpModal = () => {
        setClientIpModal({
            open: false,
            email: '',
            items: [],
            loading: false,
            clearing: false,
            error: '',
        });
    };

    const loadClientIps = async (email, options = {}) => {
        const normalizedEmail = String(email || '').trim();
        if (!normalizedEmail || clientIpSupport.supported === false) return;

        if (options.preserveOpen !== true) {
            setClientIpModal({
                open: true,
                email: normalizedEmail,
                items: [],
                loading: true,
                clearing: false,
                error: '',
            });
        } else {
            setClientIpModal((prev) => ({
                ...prev,
                loading: true,
                error: '',
            }));
        }

        try {
            const res = await api.post(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/clientIps/${encodeURIComponent(normalizedEmail)}`);
            const items = normalizePanelClientIps(res.data?.obj);
            setClientIpSupport({ supported: true, reason: '' });
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                email: normalizedEmail,
                items,
                loading: false,
                error: '',
            }));
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '加载节点访问 IP 失败';
            if (isUnsupportedPanelClientIpsError(err)) {
                setClientIpSupport({
                    supported: false,
                    reason: msg || '当前节点的 3x-ui 版本不支持节点 IP 接口',
                });
            }
            setClientIpModal((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: msg,
                items: [],
            }));
            toast.error(msg);
        }
    };

    const clearClientIps = async () => {
        if (!clientIpModal.email) return;
        const ok = await confirmAction({
            title: '清空节点访问 IP',
            message: `确定清空 ${clientIpModal.email} 在当前节点的访问 IP 记录吗？`,
            confirmText: '确认清空',
            tone: 'danger',
        });
        if (!ok) return;

        setClientIpModal((prev) => ({
            ...prev,
            clearing: true,
            error: '',
        }));

        try {
            await api.post(`/panel/${encodeURIComponent(serverId)}/panel/api/inbounds/clearClientIps/${encodeURIComponent(clientIpModal.email)}`);
            toast.success('节点访问 IP 记录已清空');
            await loadClientIps(clientIpModal.email, { preserveOpen: true });
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '清空节点访问 IP 失败';
            setClientIpModal((prev) => ({
                ...prev,
                clearing: false,
                error: msg,
            }));
            toast.error(msg);
            return;
        }

        setClientIpModal((prev) => ({
            ...prev,
            clearing: false,
        }));
    };

    if (loading) {
        return (
            <>
                <Header title={t('pages.serverDetail.title')} />
                <div style={{ padding: '24px' }}>
                    <Card loading />
                </div>
            </>
        );
    }

    if (!server) {
        return (
            <>
                <Header title={t('pages.serverDetail.title')} />
                <div style={{ padding: '24px' }}>
                    <Empty 
                        description="服务器不存在" 
                        children={<Button icon={<HiOutlineArrowLeft />} onClick={() => navigate('/servers')}>返回服务器列表</Button>} 
                    />
                </div>
            </>
        );
    }

    const envLabel = { production: '生产', staging: '预发布', development: '开发', testing: '测试', dr: '灾备', sandbox: '沙盒' };
    const healthLabel = { healthy: '健康', degraded: '降级', unreachable: '不可达', maintenance: '维护中' };
    const healthColor = { healthy: 'success', degraded: 'warning', unreachable: 'error', maintenance: 'processing' };

    const inboundColumns = [
        {
            title: '备注',
            key: 'remark',
            render: (_, record) => <InboundRemarkPill remark={record.remark} protocol={record.protocol} />
        },
        {
            title: '协议',
            dataIndex: 'protocol',
            align: 'center',
            render: (text) => <Tag color="blue">{text}</Tag>
        },
        {
            title: '端口',
            dataIndex: 'port',
            align: 'right',
            className: 'font-mono'
        },
        {
            title: '客户端数',
            key: 'clients',
            align: 'center',
            render: (_, record) => {
                try {
                    const s = typeof record.settings === 'string' ? JSON.parse(record.settings) : (record.settings || {});
                    return (s.clients || []).length;
                } catch { return 0; }
            }
        },
        {
            title: '流量',
            key: 'traffic',
            align: 'right',
            className: 'font-mono',
            render: (_, record) => formatBytes((record.up || 0) + (record.down || 0))
        },
        {
            title: '状态',
            key: 'status',
            align: 'center',
            render: (_, record) => <Badge status={record.enable !== false ? 'success' : 'error'} text={record.enable !== false ? '启用' : '禁用'} />
        }
    ];

    const onlineColumns = [
        { title: '#', key: 'index', width: 60, align: 'center', render: (_, __, i) => i + 1 },
        { title: '用户标识', dataIndex: 'email', className: 'font-mono' },
        { title: '会话数', dataIndex: 'sessions', align: 'right', width: 100 },
        {
            title: '操作',
            key: 'actions',
            align: 'right',
            render: (_, record) => (
                <Button 
                    size="small" 
                    icon={<HiOutlineGlobeAlt />} 
                    disabled={clientIpSupport.supported === false}
                    onClick={() => loadClientIps(record.email)}
                >
                    节点 IP
                </Button>
            )
        }
    ];

    const tabItems = [
        {
            key: 'overview',
            label: '概览',
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                    <Card title="服务器信息" size="small">
                        <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                            <Descriptions.Item label="名称">{server.name}</Descriptions.Item>
                            <Descriptions.Item label="URL"><Text code>{server.url}</Text></Descriptions.Item>
                            <Descriptions.Item label="用户名">{server.username}</Descriptions.Item>
                            <Descriptions.Item label="分组">{server.group || '未分组'}</Descriptions.Item>
                            <Descriptions.Item label="环境">{envLabel[server.environment] || server.environment || '-'}</Descriptions.Item>
                            <Descriptions.Item label="健康状态">
                                <Badge status={healthColor[server.health] || 'default'} text={healthLabel[server.health] || '未知'} />
                            </Descriptions.Item>
                            {server.basePath && <Descriptions.Item label="基础路径"><Text code>{server.basePath}</Text></Descriptions.Item>}
                        </Descriptions>
                        {Array.isArray(server.tags) && server.tags.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                                <Space wrap>
                                    {server.tags.map(tag => <Tag key={tag} color="cyan">{tag}</Tag>)}
                                </Space>
                            </div>
                        )}
                    </Card>
                    {status && (
                        <Card title="Xray 状态" size="small">
                            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                                <Descriptions.Item label="Xray 版本">{status.xray?.version || '-'}</Descriptions.Item>
                                <Descriptions.Item label="运行时间">{formatUptime(status.uptime, locale)}</Descriptions.Item>
                                <Descriptions.Item label="CPU">
                                    <Progress percent={status.cpu?.toFixed(1)} size="small" status="active" />
                                </Descriptions.Item>
                                <Descriptions.Item label="内存">
                                    {status.mem ? (
                                        <Space direction="vertical" style={{ width: '100%' }} size={0}>
                                            <Text size="small">{formatBytes(status.mem.current)} / {formatBytes(status.mem.total)}</Text>
                                            <Progress percent={Number(((status.mem.current / status.mem.total) * 100).toFixed(1))} size="small" />
                                        </Space>
                                    ) : '-'}
                                </Descriptions.Item>
                                <Descriptions.Item label="磁盘">
                                    {status.disk ? (
                                        <Space direction="vertical" style={{ width: '100%' }} size={0}>
                                            <Text size="small">{formatBytes(status.disk.current)} / {formatBytes(status.disk.total)}</Text>
                                            <Progress percent={Number(((status.disk.current / status.disk.total) * 100).toFixed(1))} size="small" />
                                        </Space>
                                    ) : '-'}
                                </Descriptions.Item>
                                <Descriptions.Item label="TCP 连接">{status.tcpCount || '-'}</Descriptions.Item>
                            </Descriptions>
                        </Card>
                    )}
                </Space>
            )
        },
        {
            key: 'inbounds',
            label: '入站列表',
            children: (
                <Table 
                    columns={inboundColumns} 
                    dataSource={inbounds} 
                    rowKey="id" 
                    pagination={false} 
                    loading={inboundsLoading}
                    scroll={{ x: 800 }}
                />
            )
        },
        {
            key: 'onlines',
            label: '在线用户',
            children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Space>
                            <Text strong>在线用户 {onlineUsers.length}</Text>
                            <Text type="secondary">/ 会话 {onlines.length}</Text>
                            {clientIpSupport.supported === false && <Tag color="error">节点 IP 不可用: {clientIpSupport.reason}</Tag>}
                        </Space>
                        <Button size="small" icon={<HiOutlineArrowPath />} onClick={fetchOnlines}>刷新</Button>
                    </div>
                    <Table 
                        columns={onlineColumns} 
                        dataSource={onlineUsers} 
                        rowKey="email" 
                        pagination={false} 
                        loading={onlinesLoading}
                        scroll={{ x: 600 }}
                    />
                </Space>
            )
        },
        {
            key: 'audit',
            label: '审计日志',
            children: (
                <List
                    itemLayout="horizontal"
                    dataSource={auditEvents}
                    renderItem={(item) => (
                        <List.Item>
                            <List.Item.Meta
                                avatar={<Badge status={item.outcome === 'success' ? 'success' : item.outcome === 'failed' ? 'error' : 'default'} />}
                                title={item.eventType}
                                description={
                                    <Space direction="vertical" size={0}>
                                        <Text type="secondary" style={{ fontSize: '12px' }}>{formatTime(item.ts, locale)}</Text>
                                        {item.actor && <Text style={{ fontSize: '12px' }}>操作者: {item.actor}</Text>}
                                        {item.path && <Text type="secondary" style={{ fontSize: '11px' }} ellipsis>{item.path}</Text>}
                                    </Space>
                                }
                            />
                        </List.Item>
                    )}
                    locale={{ emptyText: <Empty description="暂无审计记录" /> }}
                />
            )
        }
    ];

    return (
        <>
            <Header
                title={t('pages.serverDetail.titleWithName', { name: server.name })}
                eyebrow={t('pages.serverDetail.eyebrow')}
                allowTitleWrap
            />
            <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
                <Button 
                    icon={<HiOutlineArrowLeft />} 
                    onClick={() => navigate('/servers')} 
                    style={{ marginBottom: 24 }}
                >
                    返回服务器列表
                </Button>

                <Card style={{ marginBottom: 24 }}>
                    <Row gutter={[24, 24]} align="middle">
                        <Col xs={24} md={16}>
                            <Space align="start" size="large">
                                <Avatar 
                                    size={64} 
                                    icon={<HiOutlineServerStack />} 
                                    style={{ backgroundColor: '#52c41a' }} 
                                />
                                <div>
                                    <Title level={3} style={{ margin: 0 }}>{server.name}</Title>
                                    <Text type="secondary" className="font-mono">{server.url}</Text>
                                    <div style={{ marginTop: 8 }}>
                                        <Space wrap>
                                            <Tag color={healthColor[server.health] || 'default'}>
                                                {healthLabel[server.health] || '未知'}
                                            </Tag>
                                            {server.environment && server.environment !== 'unknown' && (
                                                <Tag>{envLabel[server.environment] || server.environment}</Tag>
                                            )}
                                            {server.group && <Tag color="blue">{server.group}</Tag>}
                                        </Space>
                                    </div>
                                </div>
                            </Space>
                        </Col>
                        <Col xs={24} md={8} style={{ textAlign: isCompactLayout ? 'left' : 'right' }}>
                            <Button icon={<HiOutlineArrowPath />} onClick={refreshAll}>刷新</Button>
                        </Col>
                        <Col span={24}>
                            <Row gutter={24}>
                                <Col xs={12} sm={6}>
                                    <Statistic title="入站规则" value={activeInbounds} suffix={` / ${inbounds.length}`} />
                                </Col>
                                <Col xs={12} sm={6}>
                                    <Statistic title="客户端数" value={clientCount} />
                                </Col>
                                <Col xs={12} sm={6}>
                                    <Statistic title="在线用户" value={onlineUsers.length} suffix={onlines.length > onlineUsers.length ? ` / ${onlines.length}` : ''} />
                                </Col>
                                <Col xs={12} sm={6}>
                                    <Statistic title="总流量" value={formatBytes(totalTraffic)} />
                                </Col>
                            </Row>
                        </Col>
                    </Row>
                </Card>

                <Card>
                    <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
                </Card>
            </div>

            <ClientIpModal
                isOpen={clientIpModal.open}
                title={`节点访问 IP — ${server?.name || serverId}`}
                subtitle={clientIpModal.email ? `${clientIpModal.email} · 节点级记录` : ''}
                loading={clientIpModal.loading}
                clearing={clientIpModal.clearing}
                items={clientIpModal.items}
                error={clientIpModal.error}
                onClose={closeClientIpModal}
                onRefresh={() => loadClientIps(clientIpModal.email, { preserveOpen: true })}
                onClear={clientIpSupport.supported === false ? undefined : clearClientIps}
            />
        </>
    );
}
