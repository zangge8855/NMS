import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { copyToClipboard, formatBytes } from '../../utils/format.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import { getClientIdentifier } from '../../utils/protocol.js';
import { bytesToGigabytesInput, gigabytesInputToBytes, normalizeLimitIp } from '../../utils/entitlements.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiOutlineChevronDown,
    HiOutlineChevronUp,
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineArrowPath,
    HiOutlineServer,
    HiOutlineSignal,
    HiOutlineCheck,
    HiOutlineClipboard,
    HiOutlineInbox,
    HiOutlineXMark,
} from 'react-icons/hi2';
import {
    normalizeInboundOrderMap,
    moveInboundWithinServerToPosition,
    moveServerGroupToPosition,
    sortServersByOrder,
    sortInboundsByOrder,
} from '../../utils/inboundOrder.js';
import {
    safeNumber,
    mergeInboundClientStats,
    resolveClientQuota,
    resolveClientUsed,
    resolveUsagePercent,
    resolveUsageTone,
} from '../../utils/inboundClients.js';

import InboundModal from './InboundModal.jsx';
import ClientModal from '../Clients/ClientModal.jsx';
import BatchResultModal from '../Batch/BatchResultModal.jsx';
import useMediaQuery from '../../hooks/useMediaQuery.js';

import {
  ConfigProvider, theme, Card, Button, Table, Modal, Form, Input, Select, Switch, Space, Tag, Typography, Row, Col, Badge, Spin, Popconfirm, Tooltip, Empty
} from 'antd';
const { Title, Text } = Typography;
const { Option } = Select;

function toLocalDateTimeString(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildOverrideKey(serverId, inboundId, clientIdentifier) {
    return `${String(serverId || '').trim()}::${String(inboundId || '').trim()}::${String(clientIdentifier || '').trim()}`;
}

function buildClientActionKey(serverId, inboundId, clientIdentifier) {
    return `${String(serverId || '').trim()}::${String(inboundId || '').trim()}::${String(clientIdentifier || '').trim()}`;
}

function buildInboundClientSelectionKey(serverId, inboundId, clientIdentifier) {
    return `${String(serverId || '').trim()}::${String(inboundId || '').trim()}::${String(clientIdentifier || '').trim()}`;
}

function resolveInboundTrafficSummary(inbound, clients = []) {
    const clientList = Array.isArray(clients) ? clients : [];
    const hasPerClientTraffic = clientList.some((client) => (
        Object.prototype.hasOwnProperty.call(client || {}, 'up')
        || Object.prototype.hasOwnProperty.call(client || {}, 'down')
    ));

    if (hasPerClientTraffic) {
        return clientList.reduce((acc, client) => {
            acc.up += safeNumber(client?.up);
            acc.down += safeNumber(client?.down);
            return acc;
        }, { up: 0, down: 0 });
    }

    return {
        up: safeNumber(inbound?.up),
        down: safeNumber(inbound?.down),
    };
}

function maskSensitiveValue(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    if (text.length <= 8) {
        return `${text.slice(0, 2)}***${text.slice(-2)}`;
    }
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function normalizeOnlineEntry(entry) {
    if (typeof entry === 'string') return [String(entry).trim().toLowerCase()].filter(Boolean);
    if (!entry || typeof entry !== 'object') return [];
    return [
        entry.email, entry.user, entry.username, entry.clientEmail, entry.client, entry.remark, entry.id, entry.password
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function buildClientOnlineKeys(client, protocol) {
    const keys = new Set();
    const email = String(client?.email || '').trim().toLowerCase();
    const identifier = String(getClientIdentifier(client, protocol) || '').trim().toLowerCase();
    const id = String(client?.id || '').trim().toLowerCase();
    const password = String(client?.password || '').trim().toLowerCase();
    if (email) keys.add(email);
    if (identifier) keys.add(identifier);
    if (id) keys.add(id);
    if (password) keys.add(password);
    return Array.from(keys);
}

export default function Inbounds() {
    const { servers, activeServerId } = useServer();
    const { t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const navigate = useNavigate();
    const confirmAction = useConfirm();
    const resolvedActiveFilterServerId = activeServerId && activeServerId !== 'global' ? activeServerId : 'all';
    const isServerFilterLocked = Boolean(activeServerId && activeServerId !== 'global');

    const [inbounds, setInbounds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInbound, setEditingInbound] = useState(null);
    const [filterServerId, setFilterServerId] = useState(resolvedActiveFilterServerId);
    const [inboundOrder, setInboundOrder] = useState({});
    const [serverOrder, setServerOrder] = useState([]);
    const [savingOrderServerId, setSavingOrderServerId] = useState('');
    const [inboundOrderDrafts, setInboundOrderDrafts] = useState({});

    const [selectedKeys, setSelectedKeys] = useState(new Set());
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientTargets, _setClientTargets] = useState([]);
    const [batchResultData, setBatchResultData] = useState(null);
    const [batchResultTitle, setBatchResultTitle] = useState(t('comp.common.batchResult'));
    
    // Entitlement Modal
    const [entitlementOpen, setEntitlementOpen] = useState(false);
    const [entitlementTarget, setEntitlementTarget] = useState(null);
    const [entitlementSaving, setEntitlementSaving] = useState(false);
    const [entitlementForm] = Form.useForm();
    
    const [overrideKeySet, setOverrideKeySet] = useState(new Set());
    const [clientActionKey, setClientActionKey] = useState('');
    const [selectedClientKeys, setSelectedClientKeys] = useState(new Set());

    const orderedServerOptions = useMemo(() => sortServersByOrder(servers, serverOrder), [servers, serverOrder]);

    const sortVisibleInbounds = (items, orderMap, nextServerOrder = serverOrder) => sortInboundsByOrder(items, orderMap, { serverOrder: nextServerOrder });

    const fetchAllInbounds = async () => {
        if (servers.length === 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const allResults = [];
        setSelectedKeys(new Set());
        setSelectedClientKeys(new Set());
        setInboundOrderDrafts({});
        let orderMap = inboundOrder;
        let nextServerOrder = serverOrder;

        try {
            const [orderRes, serverOrderRes] = await Promise.all([api.get('/system/inbounds/order'), api.get('/system/servers/order')]);
            orderMap = normalizeInboundOrderMap(orderRes.data?.obj || {});
            nextServerOrder = Array.isArray(serverOrderRes.data?.obj) ? serverOrderRes.data.obj.map(i => String(i).trim()).filter(Boolean) : [];
            setInboundOrder(orderMap);
            setServerOrder(nextServerOrder);
        } catch (err) { console.error('Failed to load order', err); }

        try {
            const overrideRes = await api.get('/clients/entitlement-overrides');
            const items = Array.isArray(overrideRes.data?.obj) ? overrideRes.data.obj : [];
            setOverrideKeySet(new Set(items.map(i => buildOverrideKey(i.serverId, i.inboundId, i.clientIdentifier))));
        } catch (err) { setOverrideKeySet(new Set()); }

        await Promise.all(servers.map(async (server) => {
            try {
                const [inboundsRes, onlinesRes] = await Promise.all([
                    api.get(`/panel/${server.id}/panel/api/inbounds/list`),
                    api.post(`/panel/${server.id}/panel/api/inbounds/onlines`).catch(() => ({ data: { obj: [] } })),
                ]);

                const onlineEntries = Array.isArray(onlinesRes.data?.obj) ? onlinesRes.data.obj : [];
                const onlineCounter = new Map();
                onlineEntries.forEach(entry => normalizeOnlineEntry(entry).forEach(key => onlineCounter.set(key, (onlineCounter.get(key) || 0) + 1)));

                if (inboundsRes.data?.obj) {
                    const serverInbounds = inboundsRes.data.obj.map((ib) => {
                        const inboundClients = mergeInboundClientStats(ib).map(cl => {
                            const matchedSessions = buildClientOnlineKeys(cl, ib.protocol).reduce((tot, key) => tot + (onlineCounter.get(key) || 0), 0);
                            return { ...cl, onlineSessionCount: matchedSessions, isOnline: matchedSessions > 0 };
                        });
                        let onlineSessionCount = 0;
                        let onlineUserCount = 0;
                        inboundClients.forEach(cl => {
                            if (cl.onlineSessionCount > 0) { onlineUserCount++; onlineSessionCount += cl.onlineSessionCount; }
                        });
                        const trafficSummary = resolveInboundTrafficSummary(ib, inboundClients);

                        return {
                            ...ib,
                            clients: inboundClients,
                            serverId: server.id,
                            serverName: server.name,
                            uiKey: `${server.id}-${ib.id}`,
                            onlineSessionCount,
                            onlineUserCount,
                            hasOnlineUsers: onlineSessionCount > 0,
                            trafficUp: trafficSummary.up,
                            trafficDown: trafficSummary.down,
                        };
                    });
                    allResults.push(...serverInbounds);
                }
            } catch (err) { toast.error(`节点 ${server.name} 连接失败`); }
        }));

        const sortedItems = sortVisibleInbounds(allResults, orderMap, nextServerOrder);
        const nextOrderMap = { ...orderMap };
        let seededOrder = false;

        sortedItems.forEach((item) => {
            if (!item.serverId || !item.id) return;
            if (!Array.isArray(nextOrderMap[item.serverId])) nextOrderMap[item.serverId] = [];
            if (!nextOrderMap[item.serverId].includes(String(item.id))) {
                nextOrderMap[item.serverId].push(String(item.id));
                seededOrder = true;
            }
        });

        if (seededOrder) setInboundOrder(nextOrderMap);
        setInbounds(sortVisibleInbounds(allResults, nextOrderMap, nextServerOrder));
        setLoading(false);
    };

    useEffect(() => { fetchAllInbounds(); }, [servers]);
    useEffect(() => {
        if (filterServerId !== 'all' && servers.length > 0 && !servers.some(s => s.id === filterServerId)) setFilterServerId(resolvedActiveFilterServerId);
    }, [filterServerId, servers, resolvedActiveFilterServerId]);
    useEffect(() => { setFilterServerId(resolvedActiveFilterServerId); }, [resolvedActiveFilterServerId]);
    useEffect(() => { setInbounds(prev => sortVisibleInbounds(prev, inboundOrder)); }, [inboundOrder, serverOrder]);
    useEffect(() => { setSelectedKeys(new Set()); setInboundOrderDrafts({}); }, [filterServerId]);

    const handleBulkDelete = async () => {
        if(selectedVisibleInbounds.length === 0) return;
        const ok = await confirmAction({ title: t('comp.inbounds.batchDeleteTitle'), message: `确定删除选中的 ${selectedVisibleCount} 个入站吗？`, confirmText: t('comp.common.confirmDelete'), tone: 'danger' });
        if (!ok) return;

        const targets = selectedVisibleInbounds.map(t => ({ serverId: t.serverId, serverName: t.serverName, id: t.id, remark: t.remark, protocol: t.protocol, port: t.port }));
        try {
            const payload = await attachBatchRiskToken({ action: 'delete', targets }, { type: 'inbounds', action: 'delete', targetCount: targets.length });
            const res = await api.post('/batch/inbounds', payload);
            setBatchResultTitle(t('comp.inbounds.batchDeleteResult'));
            setBatchResultData(res.data?.obj || null);
            toast.success('批量删除完成');
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) { toast.error('批量删除失败'); }
    };

    const handleBulkReset = async () => {
        if(selectedVisibleInbounds.length === 0) return;
        const ok = await confirmAction({ title: t('comp.inbounds.batchResetTitle'), message: `确定重置选中的 ${selectedVisibleCount} 个入站流量吗？`, confirmText: t('comp.common.confirmReset'), tone: 'secondary' });
        if (!ok) return;

        const targets = selectedVisibleInbounds.map(t => ({ serverId: t.serverId, serverName: t.serverName, id: t.id, remark: t.remark, protocol: t.protocol, port: t.port }));
        try {
            const payload = await attachBatchRiskToken({ action: 'resetTraffic', targets }, { type: 'inbounds', action: 'resetTraffic', targetCount: targets.length });
            const res = await api.post('/batch/inbounds', payload);
            setBatchResultTitle(t('comp.inbounds.batchResetResult'));
            setBatchResultData(res.data?.obj || null);
            toast.success('流量重置完成');
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) { toast.error('流量重置失败'); }
    };

    const handleBulkSetEnable = async (enable) => {
        if(selectedVisibleInbounds.length === 0) return;
        const ok = await confirmAction({ title: enable ? t('comp.inbounds.batchEnableTitle') : t('comp.inbounds.batchDisableTitle'), message: `确定${enable ? '启用' : '停用'}选中的 ${selectedVisibleCount} 个入站吗？`, confirmText: enable ? t('comp.common.confirmEnable') : t('comp.common.confirmDisable'), tone: enable ? 'success' : 'danger' });
        if (!ok) return;

        const targets = selectedVisibleInbounds.map(t => ({ serverId: t.serverId, serverName: t.serverName, id: t.id, remark: t.remark, protocol: t.protocol, port: t.port, listen: t.listen, total: t.total, expiryTime: t.expiryTime, settings: t.settings, streamSettings: t.streamSettings, sniffing: t.sniffing, enable: t.enable }));
        try {
            const action = enable ? 'enable' : 'disable';
            const payload = await attachBatchRiskToken({ action, targets }, { type: 'inbounds', action, targetCount: targets.length });
            const res = await api.post('/batch/inbounds', payload);
            setBatchResultTitle(enable ? t('comp.inbounds.batchEnableResult') : t('comp.inbounds.batchDisableResult'));
            setBatchResultData(res.data?.obj || null);
            toast.success(enable ? '批量启用完成' : '批量停用完成');
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) { toast.error('状态修改失败'); }
    };

    const handleDelete = async (inbound) => {
        const ok = await confirmAction({ title: t('comp.inbounds.deleteTitle'), message: `确定删除 ${inbound.serverName} 上的该入站吗？`, confirmText: t('comp.common.confirmDelete'), tone: 'danger' });
        if (!ok) return;
        try {
            await api.post(`/panel/${inbound.serverId}/panel/api/inbounds/del/${inbound.id}`);
            toast.success(t('comp.inbounds.inboundDeleted'));
            fetchAllInbounds();
        } catch { toast.error(t('comp.common.deleteFailed')); }
    };

    const persistInboundOrder = async (serverId, inboundIds) => {
        setSavingOrderServerId(serverId);
        try {
            const res = await api.put('/system/inbounds/order', { serverId, inboundIds });
            const savedIds = Array.isArray(res.data?.obj?.inboundIds) ? res.data.obj.inboundIds : inboundIds;
            const nextOrder = { ...inboundOrder, [serverId]: savedIds };
            setInboundOrder(nextOrder);
            setInbounds(prev => sortVisibleInbounds(prev, nextOrder));
        } catch (err) { toast.error('排序保存失败'); fetchAllInbounds(); }
        setSavingOrderServerId('');
    };

    const handleMoveInbound = async (inbound, position) => {
        if (filterServerId === 'all' || savingOrderServerId === inbound?.serverId) return;
        const next = moveInboundWithinServerToPosition(inbounds, inbound?.uiKey, position);
        if (!next.changed) return;
        setInbounds(next.items);
        await persistInboundOrder(next.serverId, next.inboundIds);
    };

    const handleMoveServerGroup = async (serverId, position) => {
        if (filterServerId !== 'all' || savingOrderServerId) return;
        const next = moveServerGroupToPosition(inbounds, serverId, position);
        if (!next.changed) return;
        setInbounds(next.items);
        setSavingOrderServerId('global');
        try {
            const res = await api.put('/system/servers/order', { serverIds: next.serverIds });
            const savedIds = Array.isArray(res.data?.obj?.serverIds) ? res.data.obj.serverIds : next.serverIds;
            setServerOrder(savedIds);
            setInbounds(prev => sortVisibleInbounds(prev, inboundOrder, savedIds));
        } catch (err) { toast.error('节点顺序保存失败'); fetchAllInbounds(); }
        setSavingOrderServerId('');
    };

    const parseClients = (ib) => {
        if (Array.isArray(ib?.clients)) return ib.clients.map(c => ({ ...c, protocol: ib.protocol, inboundId: ib.id, serverId: ib.serverId, serverName: ib.serverName }));
        return mergeInboundClientStats(ib).map(c => ({ ...c, protocol: ib.protocol, inboundId: ib.id, serverId: ib.serverId, serverName: ib.serverName }));
    };

    const handleDeleteClient = async (inbound, client) => {
        const identifier = String(getClientIdentifier(client, inbound.protocol) || '').trim();
        const displayName = client.email || identifier || '此用户';
        const ok = await confirmAction({ title: t('comp.inbounds.deleteClientTitle'), message: `确定删除 ${displayName} 吗？`, confirmText: t('comp.common.confirmDelete'), tone: 'danger' });
        if (!ok) return;
        try {
            const payload = await attachBatchRiskToken({ action: 'delete', targets: [{ serverId: inbound.serverId, serverName: inbound.serverName, inboundId: inbound.id, email: client.email || '', clientIdentifier: identifier, id: client.id || '', password: client.password || '' }] }, { type: 'clients', action: 'delete', targetCount: 1 });
            await api.post('/batch/clients', payload);
            toast.success(t('comp.inbounds.clientDeleted'));
            fetchAllInbounds();
        } catch (err) { toast.error('删除失败'); }
    };

    const handleBulkDeleteInboundClients = async (inbound, clients = []) => {
        const selectedClients = clients.filter(c => selectedClientKeys.has(buildInboundClientSelectionKey(inbound.serverId, inbound.id, getClientIdentifier(c, inbound.protocol))));
        if (selectedClients.length === 0) return;
        const ok = await confirmAction({ title: '批量删除用户', message: `确定删除选中的 ${selectedClients.length} 位用户吗？`, confirmText: t('comp.common.confirmDelete'), tone: 'danger' });
        if (!ok) return;

        const targets = selectedClients.map(c => ({ serverId: inbound.serverId, serverName: inbound.serverName, inboundId: inbound.id, email: c.email || '', clientIdentifier: getClientIdentifier(c, inbound.protocol), id: c.id || '', password: c.password || '' }));
        try {
            const payload = await attachBatchRiskToken({ action: 'delete', targets }, { type: 'clients', action: 'delete', targetCount: targets.length });
            await api.post('/batch/clients', payload);
            toast.success(`批量删除完成`);
            setSelectedClientKeys(new Set());
            fetchAllInbounds();
        } catch (err) { toast.error('批量删除失败'); }
    };

    const handleToggleClientEnabled = async (inbound, client) => {
        const identifier = String(getClientIdentifier(client, inbound.protocol) || '').trim();
        const nextAction = client.enable !== false ? 'disable' : 'enable';
        setClientActionKey(buildClientActionKey(inbound.serverId, inbound.id, identifier));
        try {
            const payload = await attachBatchRiskToken({ action: nextAction, targets: [{ serverId: inbound.serverId, serverName: inbound.serverName, inboundId: inbound.id, protocol: inbound.protocol, email: client.email || '', clientIdentifier: identifier, client }] }, { type: 'clients', action: nextAction, targetCount: 1 });
            await api.post('/batch/clients', payload);
            toast.success('状态已更新');
            fetchAllInbounds();
        } catch (err) { toast.error('状态修改失败'); }
        setClientActionKey('');
    };

    const openEntitlementModal = (inbound, client) => {
        setEntitlementTarget({ inbound, client, clientIdentifier: String(getClientIdentifier(client, inbound.protocol) || '').trim() });
        entitlementForm.setFieldsValue({
            expiryDate: toLocalDateTimeString(client.expiryTime),
            limitIp: String(normalizeLimitIp(client.limitIp)),
            trafficLimitGb: bytesToGigabytesInput(resolveClientQuota(client))
        });
        setEntitlementOpen(true);
    };

    const submitEntitlementOverride = async (values) => {
        if (!entitlementTarget) return;
        setEntitlementSaving(true);
        try {
            await api.put('/clients/entitlement', {
                serverId: entitlementTarget.inbound.serverId,
                inboundId: String(entitlementTarget.inbound.id),
                protocol: entitlementTarget.inbound.protocol,
                email: entitlementTarget.client?.email || '',
                clientIdentifier: entitlementTarget.clientIdentifier,
                mode: 'override',
                expiryTime: values.expiryDate ? new Date(values.expiryDate).getTime() : 0,
                limitIp: normalizeLimitIp(values.limitIp),
                trafficLimitBytes: gigabytesInputToBytes(values.trafficLimitGb),
            });
            toast.success('单独限制已保存');
            setEntitlementOpen(false);
            fetchAllInbounds();
        } catch (err) { toast.error('保存失败'); }
        setEntitlementSaving(false);
    };

    const restoreEntitlementPolicy = async () => {
        if (!entitlementTarget) return;
        setEntitlementSaving(true);
        try {
            await api.put('/clients/entitlement', {
                serverId: entitlementTarget.inbound.serverId,
                inboundId: String(entitlementTarget.inbound.id),
                protocol: entitlementTarget.inbound.protocol,
                email: entitlementTarget.client?.email || '',
                clientIdentifier: entitlementTarget.clientIdentifier,
                mode: 'follow_policy',
            });
            toast.success('已恢复统一策略');
            setEntitlementOpen(false);
            fetchAllInbounds();
        } catch (err) { toast.error('恢复失败'); }
        setEntitlementSaving(false);
    };

    const filteredInbounds = filterServerId === 'all' ? inbounds : inbounds.filter(i => i.serverId === filterServerId);
    const selectedVisibleInbounds = filteredInbounds.filter(i => selectedKeys.has(i.uiKey));
    const selectedVisibleCount = selectedVisibleInbounds.length;
    const bulkToggleEnable = selectedVisibleCount > 0 ? !selectedVisibleInbounds.every(item => item.enable !== false) : true;
    
    const visibleServerIds = Array.from(new Set(filteredInbounds.map(i => String(i?.serverId || '').trim()).filter(Boolean)));
    const visibleServerIndexMap = new Map(visibleServerIds.map((id, index) => [id, index]));

    const columns = [
        {
            title: '序号', width: 60, align: 'center',
            render: (_, record, index) => {
                if (filterServerId === 'all') return index + 1;
                return (
                    <Space direction="vertical" size={0}>
                        <Button size="small" type="text" icon={<HiOutlineChevronUp />} disabled={index === 0} onClick={e => { e.stopPropagation(); handleMoveInbound(record, index - 1); }} />
                        <span>{index + 1}</span>
                        <Button size="small" type="text" icon={<HiOutlineChevronDown />} disabled={index === filteredInbounds.length - 1} onClick={e => { e.stopPropagation(); handleMoveInbound(record, index + 1); }} />
                    </Space>
                );
            }
        },
        ...(filterServerId === 'all' ? [{
            title: '节点', dataIndex: 'serverName',
            render: (text, record, index) => {
                const isFirstInServerGroup = index === 0 || filteredInbounds[index - 1]?.serverId !== record.serverId;
                if(!isFirstInServerGroup) return null;
                const serverGroupIndex = visibleServerIndexMap.get(record.serverId) ?? 0;
                return (
                    <Space>
                        <Tag color="blue">{text}</Tag>
                        <Space direction="vertical" size={0}>
                            <Button size="small" type="text" icon={<HiOutlineChevronUp />} disabled={serverGroupIndex === 0} onClick={e => { e.stopPropagation(); handleMoveServerGroup(record.serverId, serverGroupIndex - 1); }} />
                            <Button size="small" type="text" icon={<HiOutlineChevronDown />} disabled={serverGroupIndex === visibleServerIds.length - 1} onClick={e => { e.stopPropagation(); handleMoveServerGroup(record.serverId, serverGroupIndex + 1); }} />
                        </Space>
                    </Space>
                );
            }
        }] : []),
        { title: '备注', dataIndex: 'remark', render: (text, record) => <Tag>{text || record.protocol}</Tag> },
        { title: '协议', dataIndex: 'protocol', align: 'center', render: text => <Tag color="geekblue">{text}</Tag> },
        { title: '端口', align: 'right', render: (_, r) => <Text code>{r.listen || '*'}:{r.port}</Text> },
        { title: '用户数', align: 'center', render: (_, r) => parseClients(r).length },
        { title: '流量', align: 'right', render: (_, r) => <div style={{fontSize: 12}}><span style={{color:'#52c41a'}}>↑{formatBytes(r.trafficUp)}</span><br/><span style={{color:'#1677ff'}}>↓{formatBytes(r.trafficDown)}</span></div> },
        { title: '状态', align: 'center', render: (_, r) => (
            <Space direction="vertical" size={0} align="center">
                <Badge status={r.enable ? 'success' : 'error'} text={r.enable ? '已启用' : '已停用'} />
                {r.hasOnlineUsers && <Text type="secondary" style={{fontSize:12}}>在线</Text>}
            </Space>
        ) },
        { title: '操作', align: 'center', render: (_, r) => (
            <Space>
                <Button size="small" icon={<HiOutlinePencilSquare />} onClick={(e) => { e.stopPropagation(); setEditingInbound(r); setIsModalOpen(true); }} />
                <Button size="small" danger icon={<HiOutlineTrash />} onClick={(e) => { e.stopPropagation(); handleDelete(r); }} />
            </Space>
        ) }
    ];

    const expandedRowRender = (inbound) => {
        const clients = parseClients(inbound);
        const selectedClientCount = clients.filter(c => selectedClientKeys.has(buildInboundClientSelectionKey(inbound.serverId, inbound.id, getClientIdentifier(c, inbound.protocol)))).length;
        return (
            <div style={{ padding: '16px', background: '#1f1f1f', borderRadius: 4 }}>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                    <Text strong>用户列表 ({clients.length})</Text>
                    {selectedClientCount > 0 && (
                        <Space>
                            <Text type="primary">已选 {selectedClientCount} 位</Text>
                            <Button size="small" danger icon={<HiOutlineTrash />} onClick={() => handleBulkDeleteInboundClients(inbound, clients)}>批量删除</Button>
                        </Space>
                    )}
                </div>
                <Table 
                    dataSource={clients} 
                    rowKey={c => buildInboundClientSelectionKey(inbound.serverId, inbound.id, getClientIdentifier(c, inbound.protocol))}
                    pagination={false}
                    size="small"
                    rowSelection={{
                        selectedRowKeys: Array.from(selectedClientKeys),
                        onChange: (keys) => setSelectedClientKeys(new Set(keys)),
                        getCheckboxProps: record => ({
                            name: record.email,
                        })
                    }}
                    columns={[
                        { title: 'Email', dataIndex: 'email', render: (text, r) => (
                            <Space>
                                {text || '-'}
                                {overrideKeySet.has(buildOverrideKey(inbound.serverId, inbound.id, getClientIdentifier(r, inbound.protocol))) && <Tag color="warning">已限制</Tag>}
                            </Space>
                        )},
                        { title: 'ID/密码', render: (_, r) => <Text code>{maskSensitiveValue(r.id || r.password)}</Text> },
                        { title: '已用流量', render: (_, r) => formatBytes(resolveClientUsed(r)) },
                        { title: '总量', align: 'right', render: (_, r) => { const q = resolveClientQuota(r); return q > 0 ? formatBytes(q) : '∞'; } },
                        { title: 'IP 限制', align: 'right', render: (_, r) => Number(r.limitIp || 0) > 0 ? r.limitIp : '∞' },
                        { title: '到期时间', align: 'center', render: (_, r) => r.expiryTime ? new Date(r.expiryTime).toLocaleDateString() : '永久' },
                        { title: '状态', align: 'center', render: (_, r) => (
                            <Space direction="vertical" size={0} align="center">
                                <Badge status={r.enable !== false ? 'success' : 'error'} text={r.enable !== false ? '启用' : '禁用'} />
                                {r.isOnline && <Text type="secondary" style={{fontSize:12}}>在线</Text>}
                            </Space>
                        )},
                        { title: '操作', align: 'center', render: (_, r) => {
                            const isActioning = clientActionKey === buildClientActionKey(inbound.serverId, inbound.id, getClientIdentifier(r, inbound.protocol));
                            return (
                                <Space>
                                    <Button size="small" type={r.enable !== false ? 'default' : 'primary'} danger={r.enable !== false} loading={isActioning} onClick={() => handleToggleClientEnabled(inbound, r)}>{r.enable !== false ? '停用' : '启用'}</Button>
                                    <Button size="small" onClick={() => openEntitlementModal(inbound, r)}>限制</Button>
                                    <Button size="small" danger icon={<HiOutlineTrash />} onClick={() => handleDeleteClient(inbound, r)} />
                                </Space>
                            );
                        }}
                    ]}
                />
            </div>
        );
    };

    if (servers.length === 0) {
        return (
            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#177ddc', colorBgBase: '#000000', colorBgContainer: '#141414', borderRadius: 4 } }}>
                <Header title={t('pages.inbounds.title')} eyebrow={t('pages.inbounds.eyebrow')} />
                <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
                    <Empty
                        image={<HiOutlineSignal style={{ fontSize: '48px', color: '#177ddc' }} />}
                        description={
                            <div style={{ color: '#rgba(255, 255, 255, 0.65)' }}>
                                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: '#fff' }}>请先在「服务器管理」添加节点</div>
                                <div>接入至少一台 3x-ui 节点后，再统一维护入站和客户端。</div>
                            </div>
                        }
                    >
                        <Button type="primary" onClick={() => navigate('/servers')} icon={<HiOutlineServer />}>前往服务器管理</Button>
                    </Empty>
                </div>
            </ConfigProvider>
        );
    }

    return (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#177ddc', colorBgBase: '#000000', colorBgContainer: '#141414', borderRadius: 4 } }}>
            <Header title={t('pages.inbounds.title')} eyebrow={t('pages.inbounds.eyebrow')} />
            <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
                <Card style={{ marginBottom: 24 }}>
                    <Row justify="space-between" align="middle">
                        <Col>
                            <Space>
                                <Select value={filterServerId} onChange={setFilterServerId} disabled={isServerFilterLocked} style={{ width: 200 }}>
                                    <Option value="all">全部节点 ({servers.length})</Option>
                                    {orderedServerOptions.map(s => <Option key={s.id} value={s.id}>{s.name}</Option>)}
                                </Select>
                                <Text type="secondary">共 {filteredInbounds.length} 条规则</Text>
                            </Space>
                        </Col>
                        <Col>
                            {selectedVisibleCount > 0 ? (
                                <Space>
                                    <Text strong style={{ color: '#177ddc' }}>已选 {selectedVisibleCount} 项</Text>
                                    <Button type="primary" danger={!bulkToggleEnable} style={bulkToggleEnable ? {backgroundColor: '#52c41a'} : {}} onClick={() => handleBulkSetEnable(bulkToggleEnable)}>{bulkToggleEnable ? '启用' : '停用'}</Button>
                                    <Button danger onClick={handleBulkDelete}>删除</Button>
                                    <Button onClick={handleBulkReset}>重置流量</Button>
                                </Space>
                            ) : (
                                <Space>
                                    <Button type="primary" icon={<HiOutlinePlusCircle />} onClick={() => { setEditingInbound(null); setIsModalOpen(true); }}>添加入站</Button>
                                    <Button icon={<HiOutlineArrowPath />} onClick={fetchAllInbounds}>刷新</Button>
                                </Space>
                            )}
                        </Col>
                    </Row>
                </Card>

                {savingOrderServerId && <div style={{ marginBottom: 16 }}><Text type="secondary">正在保存排序...</Text></div>}

                <Card bodyStyle={{ padding: 0 }}>
                    <Table 
                        dataSource={filteredInbounds} 
                        columns={columns} 
                        rowKey="uiKey" 
                        loading={loading}
                        pagination={false}
                        expandable={{ expandedRowRender, expandRowByClick: false }}
                        rowSelection={{
                            selectedRowKeys: Array.from(selectedKeys),
                            onChange: (keys) => setSelectedKeys(new Set(keys))
                        }}
                        scroll={{ x: 1000 }}
                    />
                </Card>

                <InboundModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    editingInbound={editingInbound}
                    onSuccess={fetchAllInbounds}
                    servers={servers}
                    onBatchResult={(title, data) => { if (data) { setBatchResultTitle(title); setBatchResultData(data); } }}
                />

                <ClientModal
                    isOpen={isClientModalOpen}
                    onClose={() => setIsClientModalOpen(false)}
                    targets={clientTargets}
                    onSuccess={fetchAllInbounds}
                    onBatchResult={(title, data) => { if (data) { setBatchResultTitle(title || '批量用户结果'); setBatchResultData(data); } }}
                />

                <BatchResultModal
                    isOpen={!!batchResultData}
                    onClose={() => setBatchResultData(null)}
                    title={batchResultTitle}
                    data={batchResultData}
                />

                <Modal title="单独限制" open={entitlementOpen} onCancel={() => setEntitlementOpen(false)} onOk={() => entitlementForm.submit()} confirmLoading={entitlementSaving}>
                    {entitlementTarget && (
                        <div style={{ marginBottom: 16, padding: 12, background: '#1f1f1f', borderRadius: 4 }}>
                            <div>节点: <Text strong>{entitlementTarget.inbound.serverName}</Text></div>
                            <div>入站: <Text strong>{entitlementTarget.inbound.remark || entitlementTarget.inbound.protocol}</Text></div>
                            <div>用户: <Text strong>{entitlementTarget.client.email || entitlementTarget.clientIdentifier || '-'}</Text></div>
                        </div>
                    )}
                    <Form form={entitlementForm} layout="vertical" onFinish={submitEntitlementOverride}>
                        <Form.Item name="expiryDate" label="到期时间" extra="留空 = 永不过期">
                            <Input type="datetime-local" />
                        </Form.Item>
                        <Form.Item name="limitIp" label="IP 限制" extra="0 = 不限制连接 IP 数量">
                            <Input type="number" min={0} />
                        </Form.Item>
                        <Form.Item name="trafficLimitGb" label="总流量上限 (GB)" extra="0 = 不限制总流量">
                            <Input type="number" min={0} step="0.5" />
                        </Form.Item>
                        <div style={{ textAlign: 'right' }}>
                            <Space>
                                <Button onClick={() => setEntitlementOpen(false)}>取消</Button>
                                <Button onClick={restoreEntitlementPolicy} loading={entitlementSaving}>恢复统一策略</Button>
                                <Button type="primary" htmlType="submit" loading={entitlementSaving}>保存限制</Button>
                            </Space>
                        </div>
                    </Form>
                </Modal>
            </div>
        </ConfigProvider>
    );
}