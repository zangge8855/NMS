import React, { useState, useEffect } from 'react';
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
    HiChevronRight,
    HiOutlineBars3,
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
    reorderInboundsWithinServer,
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
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';

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

function maskSensitiveValue(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    if (text.length <= 8) {
        return `${text.slice(0, 2)}***${text.slice(-2)}`;
    }
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function normalizeOnlineEntry(entry) {
    if (typeof entry === 'string') {
        return [String(entry).trim().toLowerCase()].filter(Boolean);
    }
    if (!entry || typeof entry !== 'object') return [];

    return [
        entry.email,
        entry.user,
        entry.username,
        entry.clientEmail,
        entry.client,
        entry.remark,
        entry.id,
        entry.password,
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
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
    const { servers } = useServer();
    const { t } = useI18n();
    const navigate = useNavigate();
    const confirmAction = useConfirm();

    const [inbounds, setInbounds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInbound, setEditingInbound] = useState(null);
    const [filterServerId, setFilterServerId] = useState('all');
    const [inboundOrder, setInboundOrder] = useState({});
    const [savingOrderServerId, setSavingOrderServerId] = useState('');
    const [draggingInboundKey, setDraggingInboundKey] = useState('');
    const [dropTargetInboundKey, setDropTargetInboundKey] = useState('');

    // Batch Selection State
    const [selectedKeys, setSelectedKeys] = useState(new Set());

    // Batch Client Add State
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientTargets, _setClientTargets] = useState([]);
    const [batchResultData, setBatchResultData] = useState(null);
    const [batchResultTitle, setBatchResultTitle] = useState('批量执行结果');
    const [entitlementOpen, setEntitlementOpen] = useState(false);
    const [entitlementTarget, setEntitlementTarget] = useState(null);
    const [entitlementExpiryDate, setEntitlementExpiryDate] = useState('');
    const [entitlementLimitIp, setEntitlementLimitIp] = useState('0');
    const [entitlementTrafficLimitGb, setEntitlementTrafficLimitGb] = useState('0');
    const [entitlementSaving, setEntitlementSaving] = useState(false);
    const [overrideKeySet, setOverrideKeySet] = useState(new Set());
    const [clientActionKey, setClientActionKey] = useState('');
    const [selectedClientKeys, setSelectedClientKeys] = useState(new Set());

    const fetchAllInbounds = async () => {
        if (servers.length === 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const allResults = [];
        setSelectedKeys(new Set());
        setSelectedClientKeys(new Set());
        let orderMap = inboundOrder;

        try {
            const orderRes = await api.get('/system/inbounds/order');
            orderMap = normalizeInboundOrderMap(orderRes.data?.obj || {});
            setInboundOrder(orderMap);
        } catch (err) {
            console.error('Failed to load inbound order:', err);
        }

        try {
            const overrideRes = await api.get('/clients/entitlement-overrides');
            const items = Array.isArray(overrideRes.data?.obj) ? overrideRes.data.obj : [];
            setOverrideKeySet(new Set(items.map((item) => buildOverrideKey(item.serverId, item.inboundId, item.clientIdentifier))));
        } catch (err) {
            console.error('Failed to load entitlement overrides:', err);
            setOverrideKeySet(new Set());
        }

        await Promise.all(servers.map(async (server) => {
            try {
                const [inboundsRes, onlinesRes] = await Promise.all([
                    api.get(`/panel/${server.id}/panel/api/inbounds/list`),
                    api.post(`/panel/${server.id}/panel/api/inbounds/onlines`).catch(() => ({ data: { obj: [] } })),
                ]);

                const onlineEntries = Array.isArray(onlinesRes.data?.obj) ? onlinesRes.data.obj : [];
                const onlineCounter = new Map();
                onlineEntries.forEach((entry) => {
                    normalizeOnlineEntry(entry).forEach((key) => {
                        onlineCounter.set(key, (onlineCounter.get(key) || 0) + 1);
                    });
                });

                if (inboundsRes.data?.obj) {
                    const serverInbounds = inboundsRes.data.obj.map((ib) => {
                        const inboundClients = mergeInboundClientStats(ib).map((client) => {
                            const matchedSessions = buildClientOnlineKeys(client, ib.protocol).reduce((total, key) => {
                                return total + (onlineCounter.get(key) || 0);
                            }, 0);
                            return {
                                ...client,
                                onlineSessionCount: matchedSessions,
                                isOnline: matchedSessions > 0,
                            };
                        });
                        let onlineSessionCount = 0;
                        let onlineUserCount = 0;

                        inboundClients.forEach((client) => {
                            if (client.onlineSessionCount > 0) {
                                onlineUserCount += 1;
                                onlineSessionCount += client.onlineSessionCount;
                            }
                        });

                        return {
                            ...ib,
                            clients: inboundClients,
                            serverId: server.id,
                            serverName: server.name,
                            uiKey: `${server.id}-${ib.id}`,
                            onlineSessionCount,
                            onlineUserCount,
                            hasOnlineUsers: onlineSessionCount > 0,
                        };
                    });
                    allResults.push(...serverInbounds);
                }
            } catch (err) {
                console.error(`Failed to fetch inbounds from ${server.name}`, err);
                toast.error(`节点 ${server.name} 连接失败`, { id: `err-${server.id}` });
            }
        }));

        const sortedItems = sortInboundsByOrder(allResults, orderMap);
        const nextOrderMap = { ...orderMap };
        let seededOrder = false;

        sortedItems.forEach((item) => {
            const serverId = String(item?.serverId || '').trim();
            const inboundId = String(item?.id || '').trim();
            if (!serverId || !inboundId) return;
            if (!Array.isArray(nextOrderMap[serverId])) {
                nextOrderMap[serverId] = [];
            }
            if (!nextOrderMap[serverId].includes(inboundId)) {
                nextOrderMap[serverId].push(inboundId);
                seededOrder = true;
            }
        });

        if (seededOrder) {
            setInboundOrder(nextOrderMap);
        }
        setInbounds(sortInboundsByOrder(allResults, nextOrderMap));
        setLoading(false);
    };

    useEffect(() => {
        fetchAllInbounds();
    }, [servers]);

    useEffect(() => {
        if (filterServerId !== 'all' && !servers.some(s => s.id === filterServerId)) {
            setFilterServerId('all');
        }
    }, [filterServerId, servers]);

    useEffect(() => {
        // Avoid accidental cross-node batch actions after changing filter tabs.
        setSelectedKeys(new Set());
        setDraggingInboundKey('');
        setDropTargetInboundKey('');
    }, [filterServerId]);

    // Batch Actions
    const toggleSelect = (key) => {
        const newSet = new Set(selectedKeys);
        if (newSet.has(key)) newSet.delete(key);
        else newSet.add(key);
        setSelectedKeys(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedVisibleCount === filteredInbounds.length) setSelectedKeys(new Set());
        else setSelectedKeys(new Set(filteredInbounds.map(i => i.uiKey)));
    };

    const handleBulkDelete = async () => {
        const ok = await confirmAction({
            title: '批量删除入站',
            message: `确定删除选中的 ${selectedVisibleCount} 个入站吗？`,
            details: '删除后关联用户将失效，建议先检查订阅影响。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        const targets = selectedVisibleInbounds.map((target) => ({
            serverId: target.serverId,
            serverName: target.serverName,
            id: target.id,
            remark: target.remark,
            protocol: target.protocol,
            port: target.port,
        }));

        try {
            const payload = await attachBatchRiskToken({
                action: 'delete',
                targets,
            }, {
                type: 'inbounds',
                action: 'delete',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/inbounds', payload);
            const output = res.data?.obj;
            const summary = output?.summary || { success: 0, total: targets.length, failed: targets.length };
            setBatchResultTitle('批量删除入站结果');
            setBatchResultData(output || null);
            toast.success(`批量删除完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '批量删除失败';
            toast.error(msg);
        }
    };

    const handleBulkReset = async () => {
        const ok = await confirmAction({
            title: '批量重置流量',
            message: `确定重置选中的 ${selectedVisibleCount} 个入站流量吗？`,
            confirmText: '确认重置',
            tone: 'secondary',
        });
        if (!ok) return;

        const targets = selectedVisibleInbounds.map((target) => ({
            serverId: target.serverId,
            serverName: target.serverName,
            id: target.id,
            remark: target.remark,
            protocol: target.protocol,
            port: target.port,
        }));

        try {
            const payload = await attachBatchRiskToken({
                action: 'resetTraffic',
                targets,
            }, {
                type: 'inbounds',
                action: 'resetTraffic',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/inbounds', payload);
            const output = res.data?.obj;
            const summary = output?.summary || { success: 0, total: targets.length, failed: targets.length };
            setBatchResultTitle('批量重置流量结果');
            setBatchResultData(output || null);
            toast.success(`流量重置完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '批量重置失败';
            toast.error(msg);
        }
    };

    const handleBulkSetEnable = async (enable) => {
        const ok = await confirmAction({
            title: `批量${enable ? '启用' : '停用'}入站`,
            message: `确定${enable ? '启用' : '停用'}选中的 ${selectedVisibleCount} 个入站吗？`,
            confirmText: enable ? '确认启用' : '确认停用',
            tone: enable ? 'success' : 'danger',
        });
        if (!ok) return;

        const targets = selectedVisibleInbounds.map((target) => ({
            serverId: target.serverId,
            serverName: target.serverName,
            id: target.id,
            remark: target.remark,
            protocol: target.protocol,
            port: target.port,
            listen: target.listen,
            total: target.total,
            expiryTime: target.expiryTime,
            settings: target.settings,
            streamSettings: target.streamSettings,
            sniffing: target.sniffing,
            enable: target.enable,
        }));

        try {
            const action = enable ? 'enable' : 'disable';
            const payload = await attachBatchRiskToken({
                action,
                targets,
            }, {
                type: 'inbounds',
                action,
                targetCount: targets.length,
            });
            const res = await api.post('/batch/inbounds', payload);
            const output = res.data?.obj;
            const summary = output?.summary || { success: 0, total: targets.length, failed: targets.length };
            setBatchResultTitle(`批量${enable ? '启用' : '停用'}入站结果`);
            setBatchResultData(output || null);
            toast.success(`批量${enable ? '启用' : '停用'}完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '批量启停失败';
            toast.error(msg);
        }
    };

    const handleDelete = async (inbound) => {
        const ok = await confirmAction({
            title: '删除入站',
            message: `确定删除 ${inbound.serverName} 上的该入站吗？`,
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.post(`/panel/${inbound.serverId}/panel/api/inbounds/del/${inbound.id}`);
            toast.success('入站已删除');
            fetchAllInbounds();
        } catch {
            toast.error('删除失败');
        }
    };

    const handleEdit = (inbound) => {
        setEditingInbound(inbound);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setEditingInbound(null);
        setIsModalOpen(true);
    };

    const persistInboundOrder = async (serverId, inboundIds) => {
        setSavingOrderServerId(serverId);
        try {
            const res = await api.put('/system/inbounds/order', {
                serverId,
                inboundIds,
            });
            const savedIds = Array.isArray(res.data?.obj?.inboundIds) ? res.data.obj.inboundIds : inboundIds;
            const nextOrder = {
                ...inboundOrder,
                [serverId]: savedIds,
            };
            setInboundOrder(nextOrder);
            setInbounds((prev) => sortInboundsByOrder(prev, nextOrder));
            toast.success('入站顺序已保存');
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '保存排序失败');
            fetchAllInbounds();
        }
        setSavingOrderServerId('');
    };

    const handleInboundDragStart = (event, inbound) => {
        if (filterServerId === 'all' || savingOrderServerId === inbound?.serverId) return;
        const sourceKey = String(inbound?.uiKey || '').trim();
        if (!sourceKey) return;
        setDraggingInboundKey(sourceKey);
        setDropTargetInboundKey(sourceKey);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', sourceKey);
        }
    };

    const resolveDraggedInboundKey = (event) => {
        const transferredKey = String(event?.dataTransfer?.getData('text/plain') || '').trim();
        return transferredKey || draggingInboundKey;
    };

    const handleInboundDragEnter = (event, inbound) => {
        if (filterServerId === 'all') return;
        const sourceKey = resolveDraggedInboundKey(event);
        const targetKey = String(inbound?.uiKey || '').trim();
        if (!sourceKey || !targetKey || sourceKey === targetKey) return;
        if (String(inbound?.serverId || '').trim() !== String(filterServerId || '').trim()) return;
        event.preventDefault();
        setDropTargetInboundKey(targetKey);
    };

    const handleInboundDragOver = (event, inbound) => {
        if (filterServerId === 'all') return;
        const sourceKey = resolveDraggedInboundKey(event);
        const targetKey = String(inbound?.uiKey || '').trim();
        if (!sourceKey || !targetKey || sourceKey === targetKey) return;
        if (String(inbound?.serverId || '').trim() !== String(filterServerId || '').trim()) return;
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        if (dropTargetInboundKey !== targetKey) {
            setDropTargetInboundKey(targetKey);
        }
    };

    const clearInboundDragState = () => {
        setDraggingInboundKey('');
        setDropTargetInboundKey('');
    };

    const handleInboundDrop = async (event, inbound) => {
        if (filterServerId === 'all') return;
        const sourceKey = resolveDraggedInboundKey(event);
        const targetKey = String(inbound?.uiKey || '').trim();
        if (!sourceKey || !targetKey || sourceKey === targetKey) {
            clearInboundDragState();
            return;
        }
        event.preventDefault();
        const next = reorderInboundsWithinServer(inbounds, sourceKey, targetKey);
        clearInboundDragState();
        if (!next.changed) return;
        setInbounds(next.items);
        await persistInboundOrder(next.serverId, next.inboundIds);
    };

    const parseClients = (ib) => {
        if (Array.isArray(ib?.clients)) {
            return ib.clients.map((client) => ({
                ...client,
                protocol: ib.protocol,
                inboundId: ib.id,
                serverId: ib.serverId,
                serverName: ib.serverName,
            }));
        }
        return mergeInboundClientStats(ib).map((client) => ({
            ...client,
            protocol: ib.protocol,
            inboundId: ib.id,
            serverId: ib.serverId,
            serverName: ib.serverName,
        }));
    };

    const handleDeleteClient = async (inbound, client) => {
        const identifier = String(getClientIdentifier(client, inbound.protocol) || '').trim();
        const displayName = client.email || identifier || '该用户';
        const ok = await confirmAction({
            title: '删除入站用户',
            message: `确定删除 ${displayName} 吗？`,
            details: `${inbound.serverName} / ${inbound.remark || inbound.protocol}:${inbound.port}`,
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        try {
            const payload = await attachBatchRiskToken({
                action: 'delete',
                targets: [{
                    serverId: inbound.serverId,
                    serverName: inbound.serverName,
                    inboundId: inbound.id,
                    email: client.email || '',
                    clientIdentifier: identifier,
                    id: client.id || '',
                    password: client.password || '',
                }],
            }, {
                type: 'clients',
                action: 'delete',
                targetCount: 1,
            });
            await api.post('/batch/clients', payload);
            toast.success('入站用户已删除');
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.msg || err.message || '删除失败');
        }
    };

    const toggleClientSelect = (selectionKey) => {
        if (!selectionKey) return;
        setSelectedClientKeys((prev) => {
            const next = new Set(prev);
            if (next.has(selectionKey)) next.delete(selectionKey);
            else next.add(selectionKey);
            return next;
        });
    };

    const clearInboundClientSelection = (inbound, clients = []) => {
        const keys = new Set(
            (Array.isArray(clients) ? clients : [])
                .map((client) => buildInboundClientSelectionKey(inbound?.serverId, inbound?.id, getClientIdentifier(client, inbound?.protocol)))
                .filter(Boolean)
        );
        if (keys.size === 0) return;
        setSelectedClientKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((key) => next.delete(key));
            return next;
        });
    };

    const toggleSelectAllInboundClients = (inbound, clients = []) => {
        const keys = (Array.isArray(clients) ? clients : [])
            .map((client) => buildInboundClientSelectionKey(inbound?.serverId, inbound?.id, getClientIdentifier(client, inbound?.protocol)))
            .filter(Boolean);
        if (keys.length === 0) return;

        setSelectedClientKeys((prev) => {
            const next = new Set(prev);
            const allSelected = keys.every((key) => next.has(key));
            if (allSelected) {
                keys.forEach((key) => next.delete(key));
            } else {
                keys.forEach((key) => next.add(key));
            }
            return next;
        });
    };

    const handleBulkDeleteInboundClients = async (inbound, clients = []) => {
        const selectedClients = (Array.isArray(clients) ? clients : []).filter((client) => {
            const key = buildInboundClientSelectionKey(inbound?.serverId, inbound?.id, getClientIdentifier(client, inbound?.protocol));
            return key && selectedClientKeys.has(key);
        });

        if (selectedClients.length === 0) {
            toast.error('请先选择要删除的用户');
            return;
        }

        const ok = await confirmAction({
            title: '批量删除入站用户',
            message: `确定删除选中的 ${selectedClients.length} 位用户吗？`,
            details: `${inbound?.serverName || '-'} / ${inbound?.remark || inbound?.protocol || '-'}:${inbound?.port || '-'}`,
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        const targets = selectedClients.map((client) => ({
            serverId: inbound.serverId,
            serverName: inbound.serverName,
            inboundId: inbound.id,
            email: client.email || '',
            clientIdentifier: getClientIdentifier(client, inbound.protocol),
            id: client.id || '',
            password: client.password || '',
        }));

        try {
            const payload = await attachBatchRiskToken({
                action: 'delete',
                targets,
            }, {
                type: 'clients',
                action: 'delete',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/clients', payload);
            const output = res.data?.obj;
            const summary = output?.summary || { success: 0, total: targets.length, failed: targets.length };
            setBatchResultTitle('批量删除入站用户结果');
            setBatchResultData(output || null);
            toast.success(`批量删除完成: ${summary.success}/${summary.total} 成功`);
            clearInboundClientSelection(inbound, selectedClients);
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.msg || err.message || '批量删除失败');
        }
    };

    const handleToggleClientEnabled = async (inbound, client) => {
        const identifier = String(getClientIdentifier(client, inbound.protocol) || '').trim();
        if (!identifier) {
            toast.error('缺少用户标识，无法切换状态');
            return;
        }

        const nextAction = client.enable !== false ? 'disable' : 'enable';
        const actionKey = buildClientActionKey(inbound.serverId, inbound.id, identifier);
        setClientActionKey(actionKey);
        try {
            const payload = await attachBatchRiskToken({
                action: nextAction,
                targets: [{
                    serverId: inbound.serverId,
                    serverName: inbound.serverName,
                    inboundId: inbound.id,
                    protocol: inbound.protocol,
                    email: client.email || '',
                    clientIdentifier: identifier,
                    client,
                }],
            }, {
                type: 'clients',
                action: nextAction,
                targetCount: 1,
            });
            await api.post('/batch/clients', payload);
            toast.success(nextAction === 'enable' ? '入站用户已启用' : '入站用户已禁用');
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.msg || err.message || '切换状态失败');
        } finally {
            setClientActionKey('');
        }
    };

    const openEntitlementModal = (inbound, client) => {
        setEntitlementTarget({
            inbound,
            client,
            clientIdentifier: String(getClientIdentifier(client, inbound.protocol) || '').trim(),
        });
        setEntitlementExpiryDate(toLocalDateTimeString(client.expiryTime));
        setEntitlementLimitIp(String(normalizeLimitIp(client.limitIp)));
        setEntitlementTrafficLimitGb(bytesToGigabytesInput(resolveClientQuota(client)));
        setEntitlementSaving(false);
        setEntitlementOpen(true);
    };

    const closeEntitlementModal = () => {
        setEntitlementOpen(false);
        setEntitlementTarget(null);
        setEntitlementExpiryDate('');
        setEntitlementLimitIp('0');
        setEntitlementTrafficLimitGb('0');
        setEntitlementSaving(false);
    };

    const submitEntitlementOverride = async (event) => {
        event.preventDefault();
        if (!entitlementTarget?.inbound || !entitlementTarget?.clientIdentifier) return;
        setEntitlementSaving(true);
        try {
            await api.put('/clients/entitlement', {
                serverId: entitlementTarget.inbound.serverId,
                inboundId: String(entitlementTarget.inbound.id),
                protocol: entitlementTarget.inbound.protocol,
                email: entitlementTarget.client?.email || '',
                clientIdentifier: entitlementTarget.clientIdentifier,
                mode: 'override',
                expiryTime: entitlementExpiryDate ? new Date(entitlementExpiryDate).getTime() : 0,
                limitIp: normalizeLimitIp(entitlementLimitIp),
                trafficLimitBytes: gigabytesInputToBytes(entitlementTrafficLimitGb),
            });
            toast.success('单独限定已保存');
            closeEntitlementModal();
            fetchAllInbounds();
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '保存单独限定失败');
            setEntitlementSaving(false);
        }
    };

    const restoreEntitlementPolicy = async () => {
        if (!entitlementTarget?.inbound || !entitlementTarget?.clientIdentifier) return;
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
            toast.success('已恢复跟随统一策略');
            closeEntitlementModal();
            fetchAllInbounds();
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '恢复统一策略失败');
            setEntitlementSaving(false);
        }
    };

    const filteredInbounds = filterServerId === 'all'
        ? inbounds
        : inbounds.filter(i => i.serverId === filterServerId);
    const selectedVisibleInbounds = filteredInbounds.filter(i => selectedKeys.has(i.uiKey));
    const selectedVisibleCount = selectedVisibleInbounds.length;
    const bulkToggleEnable = selectedVisibleCount > 0
        ? !selectedVisibleInbounds.every((item) => item.enable !== false)
        : true;
    const bulkToggleLabel = bulkToggleEnable ? '启用选中' : '禁用选中';
    const bulkToggleIcon = bulkToggleEnable ? <HiOutlineCheck /> : <HiOutlineXMark />;
    const bulkToggleClassName = bulkToggleEnable ? 'btn btn-success btn-sm' : 'btn btn-danger btn-sm';
    const tableColSpan = filterServerId === 'all' ? 11 : 10;

    if (servers.length === 0) {
        return (
            <>
                <Header
                    title={t('pages.inbounds.title')}
                    subtitle={t('pages.inbounds.subtitle')}
                    eyebrow={t('pages.inbounds.eyebrow')}
                />
                <div className="page-content page-enter">
                    <EmptyState
                        title="请先在「服务器管理」添加节点"
                        subtitle="接入至少一台 3x-ui 节点后，再统一维护入站和客户端。"
                        icon={<HiOutlineSignal style={{ fontSize: '48px' }} />}
                        action={<button type="button" className="btn btn-primary" onClick={() => navigate('/servers')}><HiOutlineServer /> 前往服务器管理</button>}
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <Header
                title={t('pages.inbounds.title')}
                subtitle={t('pages.inbounds.subtitle')}
                eyebrow={t('pages.inbounds.eyebrow')}
            />
            <div className="page-content page-enter">
                <div className="inbounds-toolbar glass-panel mb-6">
                    <div className="inbounds-toolbar-main">
                        <select
                            className="form-select inbounds-filter-select"
                            value={filterServerId}
                            onChange={(e) => setFilterServerId(e.target.value)}
                            style={{ width: 'auto', minWidth: '160px' }}
                        >
                            <option value="all">全部节点 ({servers.length})</option>
                            {servers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <div className="inbounds-toolbar-copy">
                            <h2 className="text-glow text-lg font-semibold">入站列表</h2>
                            <p className="text-muted mt-1" style={{ fontSize: '12px' }}>共 {filteredInbounds.length} 条规则</p>
                        </div>
                    </div>
                    <div className="inbounds-toolbar-actions">
                        {selectedVisibleCount > 0 ? (
                            <div className="flex gap-2 items-center animate-fade-in inbounds-selection-bar">
                                <span className="text-sm font-bold px-2 text-primary">已选 {selectedVisibleCount} 项</span>
                                <button className={bulkToggleClassName} onClick={() => handleBulkSetEnable(bulkToggleEnable)}>
                                    {bulkToggleIcon}
                                    {bulkToggleLabel}
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                                    <HiOutlineTrash /> 删除
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={handleBulkReset}>
                                    <HiOutlineArrowPath /> 重置
                                </button>
                            </div>
                        ) : (
                            <button className="btn btn-primary btn-sm" onClick={handleAdd}>
                                <HiOutlinePlusCircle /> 添加入站
                            </button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={fetchAllInbounds} title="刷新">
                            <HiOutlineArrowPath />
                        </button>
                    </div>
                </div>

                {savingOrderServerId && (
                    <div className="text-xs text-muted mb-3 inbounds-saving-note">
                        正在保存节点排序: {servers.find((item) => item.id === savingOrderServerId)?.name || savingOrderServerId}
                    </div>
                )}

                <div className="table-container glass-panel inbounds-table-shell">
                    <table className="table">
                        <thead>
                            <tr>
                                <th className="cell-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={filteredInbounds.length > 0 && selectedVisibleCount === filteredInbounds.length}
                                        onChange={toggleSelectAll}
                                        className="cursor-pointer"
                                    />
                                </th>
                                <th className="inbounds-expand-col" aria-hidden="true" />
                                <th>序号</th>
                                {filterServerId === 'all' && <th>节点</th>}
                                <th>备注</th>
                                <th>协议</th>
                                <th>监听:端口</th>
                                <th>用户数</th>
                                <th>流量 (上/下)</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={tableColSpan} className="p-4">
                                        <SkeletonTable rows={5} cols={tableColSpan} />
                                    </td>
                                </tr>
                            ) : filteredInbounds.length === 0 ? (
                                <tr>
                                    <td colSpan={tableColSpan} className="p-6">
                                        <EmptyState
                                            icon={<HiOutlineInbox />}
                                            title="暂无入站规则"
                                            subtitle="当前节点下没有配置任何入站"
                                            action={(
                                                <button type="button" className="btn btn-primary" onClick={handleAdd}>
                                                    <HiOutlinePlusCircle /> 添加入站
                                                </button>
                                            )}
                                        />
                                    </td>
                                </tr>
                            ) : (
                                filteredInbounds.map((ib, index) => {
                                    const clients = parseClients(ib);
                                    const isExpanded = expandedId === ib.uiKey;
                                    const isSelected = selectedKeys.has(ib.uiKey);
                                    const canDragOrder = filterServerId !== 'all';
                                    const isDragging = draggingInboundKey === ib.uiKey;
                                    const isDropTarget = dropTargetInboundKey === ib.uiKey && draggingInboundKey !== ib.uiKey;
                                    const selectableClientKeys = clients
                                        .map((client) => buildInboundClientSelectionKey(ib.serverId, ib.id, getClientIdentifier(client, ib.protocol)))
                                        .filter(Boolean);
                                    const selectedClientCount = selectableClientKeys.filter((key) => selectedClientKeys.has(key)).length;
                                    const allInboundClientsSelected = selectableClientKeys.length > 0 && selectedClientCount === selectableClientKeys.length;
                                    return (
                                        <React.Fragment key={ib.uiKey}>
                                            <tr
                                                className={`cursor-pointer transition-colors hover-bg-surface inbounds-row${isSelected ? ' inbounds-row-selected' : ''}${isDragging ? ' inbounds-row-dragging' : ''}${isDropTarget ? ' inbounds-row-drop-target' : ''}`}
                                                onClick={() => setExpandedId(isExpanded ? null : ib.uiKey)}
                                                onDragEnter={(event) => handleInboundDragEnter(event, ib)}
                                                onDragOver={(event) => handleInboundDragOver(event, ib)}
                                                onDrop={(event) => handleInboundDrop(event, ib)}
                                                onDragEnd={clearInboundDragState}
                                            >
                                                <td data-label="" onClick={e => e.stopPropagation()} className="text-center mobile-checkbox-cell">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelect(ib.uiKey)}
                                                        className="cursor-pointer"
                                                    />
                                                </td>
                                                <td className="inbounds-expand-cell" data-label="" aria-hidden="true">
                                                    <span className={`inbounds-expand-indicator transition-transform duration-200${isExpanded ? ' rotate-90' : ''}`}>
                                                        <HiChevronRight />
                                                    </span>
                                                </td>
                                                <td data-label="序号" onClick={(e) => e.stopPropagation()} className="whitespace-nowrap">
                                                    <div className="inbounds-sequence-cell">
                                                        <span className="cell-mono inbounds-sequence-number">{index + 1}</span>
                                                        {canDragOrder && (
                                                            <span
                                                                className={`inbounds-drag-handle${savingOrderServerId === ib.serverId ? ' is-disabled' : ''}`}
                                                                role="button"
                                                                tabIndex={savingOrderServerId === ib.serverId ? -1 : 0}
                                                                aria-label={`拖拽调整 ${ib.remark || ib.protocol}:${ib.port} 的顺序`}
                                                                draggable={savingOrderServerId !== ib.serverId}
                                                                onClick={(event) => event.stopPropagation()}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                        event.preventDefault();
                                                                    }
                                                                }}
                                                                onDragStart={(event) => handleInboundDragStart(event, ib)}
                                                            >
                                                                <HiOutlineBars3 />
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                {filterServerId === 'all' && (
                                                    <td data-label="节点" className="whitespace-nowrap">
                                                        <span className="badge badge-neutral flex items-center gap-1 w-fit">
                                                            <HiOutlineServer size={10} /> {ib.serverName}
                                                        </span>
                                                    </td>
                                                )}
                                                <td
                                                    data-label="备注"
                                                    className="font-medium text-white inbounds-remark-cell"
                                                    title={ib.remark || '-'}
                                                >
                                                    {ib.remark || '-'}
                                                </td>
                                                <td data-label="协议" className="whitespace-nowrap"><span className="badge badge-info">{ib.protocol}</span></td>
                                                <td data-label="端口" className="cell-mono text-sm whitespace-nowrap">{ib.listen || '*'}:{ib.port}</td>
                                                <td data-label="用户数">
                                                    <span className="cell-mono-right inbounds-user-count" title={`共 ${clients.length} 位用户`}>
                                                        {clients.length}
                                                    </span>
                                                </td>
                                                <td data-label="流量" className="text-sm whitespace-nowrap">
                                                    <span className="text-success">↑{formatBytes(ib.up)}</span>
                                                    <span className="text-muted mx-1">/</span>
                                                    <span className="text-info">↓{formatBytes(ib.down)}</span>
                                                </td>
                                                <td data-label="状态">
                                                    <div className="inbounds-status-cell">
                                                        <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>
                                                            {ib.enable ? '启用' : '禁用'}
                                                        </span>
                                                        {ib.hasOnlineUsers && (
                                                            <span
                                                                className="inbounds-online-indicator"
                                                                title={`当前 ${ib.onlineUserCount || 0} 位用户 / ${ib.onlineSessionCount || 0} 个会话在线`}
                                                            >
                                                                <span className="inbounds-online-dot-shell" aria-hidden="true">
                                                                    <span className="inbounds-online-dot-ping" />
                                                                    <span className="inbounds-online-dot" />
                                                                </span>
                                                                在线
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td data-label="" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex gap-2 inbounds-row-actions">
                                                        <button
                                                            className="btn btn-secondary btn-sm btn-icon"
                                                            title="编辑"
                                                            onClick={() => handleEdit(ib)}
                                                        >
                                                            <HiOutlinePencilSquare />
                                                        </button>
                                                        <button
                                                            className="btn btn-danger btn-sm btn-icon"
                                                            title="删除"
                                                            onClick={() => handleDelete(ib)}
                                                        >
                                                            <HiOutlineTrash />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && clients.length > 0 && (
                                                <tr>
                                                    <td colSpan={tableColSpan} className="p-0 bg-black/20 inbounds-clients-cell">
                                                        <div className="p-4 inbounds-clients-panel">
                                                            <div className="inbounds-clients-toolbar">
                                                                <div className="text-xs font-bold text-muted uppercase tracking-wider inbounds-clients-label">
                                                                    用户列表 ({clients.length})
                                                                </div>
                                                                {selectedClientCount > 0 && (
                                                                    <div className="inbounds-clients-selection-bar">
                                                                        <span className="text-xs font-semibold text-primary">已选 {selectedClientCount} 位用户</span>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-danger btn-sm"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleBulkDeleteInboundClients(ib, clients);
                                                                            }}
                                                                        >
                                                                            <HiOutlineTrash /> 批量删除
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-secondary btn-sm"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                clearInboundClientSelection(ib, clients);
                                                                            }}
                                                                        >
                                                                            取消选择
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <table className="table w-full text-xs inbounds-clients-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="cell-checkbox">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={allInboundClientsSelected}
                                                                                onChange={() => toggleSelectAllInboundClients(ib, clients)}
                                                                                className="cursor-pointer"
                                                                            />
                                                                        </th>
                                                                        <th className="whitespace-nowrap">Email</th>
                                                                        <th className="whitespace-nowrap">ID/密码（脱敏）</th>
                                                                        <th className="whitespace-nowrap">已用流量</th>
                                                                        <th className="whitespace-nowrap">总量</th>
                                                                        <th className="whitespace-nowrap">IP 限制</th>
                                                                        <th className="whitespace-nowrap">上 / 下行</th>
                                                                        <th className="whitespace-nowrap">到期时间</th>
                                                                        <th className="whitespace-nowrap">状态</th>
                                                                        <th className="whitespace-nowrap">操作</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {clients.map((cl, idx) => {
                                                                        const usedBytes = resolveClientUsed(cl);
                                                                        const totalBytes = resolveClientQuota(cl);
                                                                        const usagePercent = resolveUsagePercent(usedBytes, totalBytes);
                                                                        const usageTone = resolveUsageTone(usagePercent);
                                                                        const remainingBytes = totalBytes > 0
                                                                            ? Math.max(0, totalBytes - usedBytes)
                                                                            : 0;
                                                                        const clientIdentifier = String(getClientIdentifier(cl, ib.protocol) || '').trim();
                                                                        const hasOverride = overrideKeySet.has(buildOverrideKey(ib.serverId, ib.id, clientIdentifier));
                                                                        const rowActionKey = buildClientActionKey(ib.serverId, ib.id, clientIdentifier);
                                                                        const isActioning = clientActionKey === rowActionKey;
                                                                        const rawCredential = cl.id || cl.password || '';
                                                                        const maskedCredential = maskSensitiveValue(rawCredential);
                                                                        const toggleLabel = cl.enable !== false ? '禁用' : '启用';
                                                                        const toggleTitle = cl.enable !== false ? '禁用该用户' : '启用该用户';
                                                                        const selectionKey = buildInboundClientSelectionKey(ib.serverId, ib.id, clientIdentifier);
                                                                        const isClientSelected = Boolean(selectionKey) && selectedClientKeys.has(selectionKey);
                                                                        return (
                                                                        <tr key={idx}>
                                                                            <td data-label="" onClick={(e) => e.stopPropagation()} className="text-center mobile-checkbox-cell">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isClientSelected}
                                                                                    onChange={() => toggleClientSelect(selectionKey)}
                                                                                    className="cursor-pointer"
                                                                                />
                                                                            </td>
                                                                            <td data-label="用户" className="whitespace-nowrap">
                                                                                <div className="inbounds-client-email-row">
                                                                                    <span>{cl.email || '-'}</span>
                                                                                    {hasOverride && (
                                                                                        <span className="badge badge-warning">已限定</span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="ID / 密码" className="cell-mono whitespace-nowrap">
                                                                                <div className="inbounds-client-id-row">
                                                                                    <span className="inbounds-client-id-text">
                                                                                        {maskedCredential}
                                                                                    </span>
                                                                                    {rawCredential && (
                                                                                        <button
                                                                                            type="button"
                                                                                            className="btn btn-ghost btn-xs btn-icon"
                                                                                            title="复制完整 ID / 密码"
                                                                                            disabled={isActioning}
                                                                                            onClick={async (e) => {
                                                                                                e.stopPropagation();
                                                                                                await copyToClipboard(rawCredential);
                                                                                                toast.success('完整 ID / 密码已复制');
                                                                                            }}
                                                                                        >
                                                                                            <HiOutlineClipboard />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="已用流量" className="whitespace-nowrap">
                                                                                <div className="inbound-client-usage">
                                                                                    <div className="inbound-client-usage-head">
                                                                                        <span className="font-medium">{formatBytes(usedBytes)}</span>
                                                                                        <span className={`inbound-client-usage-badge ${usageTone}`}>
                                                                                            {usagePercent === null ? '不限额' : `${usagePercent}%`}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="inbound-client-usage-track">
                                                                                        <div
                                                                                            className={`inbound-client-usage-fill ${usageTone}`}
                                                                                            style={{ width: `${usagePercent === null ? 18 : usagePercent}%` }}
                                                                                        />
                                                                                    </div>
                                                                                    <div className="inbound-client-usage-meta">
                                                                                        {totalBytes > 0 ? `剩余 ${formatBytes(remainingBytes)}` : '总量不限'}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="总量" className="whitespace-nowrap">{totalBytes > 0 ? formatBytes(totalBytes) : '∞'}</td>
                                                                            <td data-label="IP 限制" className="whitespace-nowrap">{Number(cl.limitIp || 0) > 0 ? cl.limitIp : '∞'}</td>
                                                                            <td data-label="上 / 下行" className="whitespace-nowrap">
                                                                                <span className="text-success">↑{formatBytes(safeNumber(cl.up))}</span>
                                                                                <span className="text-muted mx-1">/</span>
                                                                                <span className="text-info">↓{formatBytes(safeNumber(cl.down))}</span>
                                                                            </td>
                                                                            <td data-label="到期时间" className="whitespace-nowrap">{cl.expiryTime ? new Date(cl.expiryTime).toLocaleDateString() : '永久'}</td>
                                                                            <td data-label="状态" className="whitespace-nowrap">
                                                                                <div className="inbounds-client-status-stack">
                                                                                    <span className={`badge ${cl.enable !== false ? 'badge-success' : 'badge-danger'}`}>
                                                                                        {cl.enable !== false ? '启用' : '禁用'}
                                                                                    </span>
                                                                                    <span
                                                                                        className={`inbounds-client-online-status ${cl.isOnline ? 'is-online' : 'is-offline'}`}
                                                                                        title={cl.isOnline ? `当前 ${cl.onlineSessionCount || 0} 个会话在线` : '当前无在线会话'}
                                                                                    >
                                                                                        <span className="inbounds-client-online-dot-shell" aria-hidden="true">
                                                                                            <span className="inbounds-client-online-dot-ping" />
                                                                                            <span className="inbounds-client-online-dot" />
                                                                                        </span>
                                                                                        {cl.isOnline ? '在线' : '离线'}
                                                                                    </span>
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="操作" className="whitespace-nowrap">
                                                                                <div className="inbounds-client-actions flex gap-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        className={`btn btn-sm ${cl.enable !== false ? 'btn-danger' : 'btn-success'}`}
                                                                                        title={toggleTitle}
                                                                                        disabled={isActioning}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleToggleClientEnabled(ib, cl);
                                                                                        }}
                                                                                    >
                                                                                        {isActioning
                                                                                            ? <span className="spinner" />
                                                                                            : (cl.enable !== false ? <HiOutlineXMark /> : <HiOutlineCheck />)}
                                                                                        {toggleLabel}
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        className={`btn btn-ghost btn-sm inbounds-client-limit-btn ${hasOverride ? 'is-active' : ''}`}
                                                                                        title={hasOverride ? '已设置单独限定，点击修改' : '设置单独限定'}
                                                                                        disabled={isActioning}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            openEntitlementModal(ib, cl);
                                                                                        }}
                                                                                    >
                                                                                        {hasOverride ? '修改限定' : '限定策略'}
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        className="btn btn-danger btn-sm btn-icon"
                                                                                        title="删除该用户"
                                                                                        disabled={isActioning}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleDeleteClient(ib, cl);
                                                                                        }}
                                                                                    >
                                                                                        <HiOutlineTrash />
                                                                                    </button>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <InboundModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    editingInbound={editingInbound}
                    onSuccess={fetchAllInbounds}
                    servers={servers}
                    onBatchResult={(title, data) => {
                        if (!data) return;
                        setBatchResultTitle(title);
                        setBatchResultData(data);
                    }}
                />

                <ClientModal
                    isOpen={isClientModalOpen}
                    onClose={() => setIsClientModalOpen(false)}
                    targets={clientTargets}
                    onSuccess={fetchAllInbounds}
                    onBatchResult={(title, data) => {
                        if (!data) return;
                        setBatchResultTitle(title || '批量用户结果');
                        setBatchResultData(data);
                    }}
                />

                {selectedVisibleCount > 0 && (
                    <div className="mobile-batch-bar">
                        <div className="batch-count">已选 {selectedVisibleCount} 项</div>
                        <button className={bulkToggleClassName} onClick={() => handleBulkSetEnable(bulkToggleEnable)}>
                            {bulkToggleIcon}
                            {bulkToggleLabel}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}><HiOutlineTrash /> 删除</button>
                        <button className="btn btn-secondary btn-sm" onClick={handleBulkReset}><HiOutlineArrowPath /> 重置</button>
                    </div>
                )}

                <BatchResultModal
                    isOpen={!!batchResultData}
                    onClose={() => setBatchResultData(null)}
                    title={batchResultTitle}
                    data={batchResultData}
                />

                {entitlementOpen && entitlementTarget && (
                    <ModalShell isOpen={entitlementOpen} onClose={closeEntitlementModal}>
                        <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title">单独限定</h3>
                                <button className="modal-close" onClick={closeEntitlementModal}>
                                    <HiOutlineXMark />
                                </button>
                            </div>
                            <form onSubmit={submitEntitlementOverride}>
                                <div className="modal-body">
                                    <div className="mb-4 p-3 rounded bg-white/5 border border-white/10 text-sm">
                                        <div>节点: <strong>{entitlementTarget.inbound.serverName}</strong></div>
                                        <div>入站: <strong>{entitlementTarget.inbound.remark || entitlementTarget.inbound.protocol}</strong></div>
                                        <div>用户: <strong>{entitlementTarget.client.email || entitlementTarget.clientIdentifier || '-'}</strong></div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">到期时间</label>
                                        <input
                                            type="datetime-local"
                                            className="form-input"
                                            value={entitlementExpiryDate}
                                            onChange={(e) => setEntitlementExpiryDate(e.target.value)}
                                        />
                                        <p className="text-xs text-muted mt-1">留空 = 永不过期</p>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">IP 限制</label>
                                        <input
                                            type="number"
                                            className="form-input"
                                            min={0}
                                            value={entitlementLimitIp}
                                            onChange={(e) => setEntitlementLimitIp(e.target.value)}
                                        />
                                        <p className="text-xs text-muted mt-1">0 = 不限制连接 IP 数量</p>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">总流量上限</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                className="form-input"
                                                min={0}
                                                step="0.5"
                                                value={entitlementTrafficLimitGb}
                                                onChange={(e) => setEntitlementTrafficLimitGb(e.target.value)}
                                            />
                                            <span className="text-sm text-muted">GB</span>
                                        </div>
                                        <p className="text-xs text-muted mt-1">0 = 不限制总流量</p>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={closeEntitlementModal}>取消</button>
                                    <button type="button" className="btn btn-secondary" onClick={restoreEntitlementPolicy} disabled={entitlementSaving}>
                                        {entitlementSaving ? <span className="spinner" /> : '恢复统一策略'}
                                    </button>
                                    <button type="submit" className="btn btn-primary" disabled={entitlementSaving}>
                                        {entitlementSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 保存限定</>}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </ModalShell>
                )}
            </div >
        </>
    );
}
