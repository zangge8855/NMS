import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { copyToClipboard, formatBytes, getErrorMessage } from '../../utils/format.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import { getClientIdentifier } from '../../utils/protocol.js';
import { bytesToGigabytesInput, gigabytesInputToBytes, normalizeLimitIp } from '../../utils/entitlements.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiChevronRight,
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
    HiOutlineCalendarDays,
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
import ModalShell from '../UI/ModalShell.jsx';
import ActionsDropdown from '../UI/ActionsDropdown.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ListToolbar from '../UI/ListToolbar.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import InboundRemarkPill from '../UI/InboundRemarkPill.jsx';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { readSessionSnapshot, writeSessionSnapshot } from '../../utils/sessionSnapshot.js';
import { fetchServerPanelData, invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache.js';

const INBOUNDS_SNAPSHOT_KEY = 'inbounds_page_bootstrap_v1';
const INBOUNDS_SNAPSHOT_TTL_MS = 2 * 60_000;

function readInboundsSnapshot() {
    const snapshot = readSessionSnapshot(INBOUNDS_SNAPSHOT_KEY, {
        maxAgeMs: INBOUNDS_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
        inbounds: Array.isArray(snapshot?.inbounds) ? snapshot.inbounds : [],
        inboundOrder: snapshot?.inboundOrder && typeof snapshot.inboundOrder === 'object' ? snapshot.inboundOrder : {},
        serverOrder: Array.isArray(snapshot?.serverOrder) ? snapshot.serverOrder : [],
        overrideKeys: Array.isArray(snapshot?.overrideKeys) ? snapshot.overrideKeys : [],
    };
}

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
    const { servers, activeServerId } = useServer();
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const navigate = useNavigate();
    const confirmAction = useConfirm();
    const bootstrapRef = useRef(readInboundsSnapshot());
    const inboundsRequestIdRef = useRef(0);
    const resolvedActiveFilterServerId = activeServerId && activeServerId !== 'global' ? activeServerId : 'all';
    const isServerFilterLocked = Boolean(activeServerId && activeServerId !== 'global');

    const [inbounds, setInbounds] = useState(() => bootstrapRef.current?.inbounds || []);
    const [loading, setLoading] = useState(() => bootstrapRef.current == null);
    const [expandedId, setExpandedId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInbound, setEditingInbound] = useState(null);
    const [filterServerId, setFilterServerId] = useState(resolvedActiveFilterServerId);
    const [inboundOrder, setInboundOrder] = useState(() => bootstrapRef.current?.inboundOrder || {});
    const [serverOrder, setServerOrder] = useState(() => bootstrapRef.current?.serverOrder || []);
    const [savingOrderServerId, setSavingOrderServerId] = useState('');
    const [inboundOrderDrafts, setInboundOrderDrafts] = useState({});

    // Batch Selection State
    const [selectedKeys, setSelectedKeys] = useState(new Set());

    // Batch Client Add State
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientTargets, _setClientTargets] = useState([]);
    const [batchResultData, setBatchResultData] = useState(null);
    const [batchResultTitle, setBatchResultTitle] = useState(t('comp.common.batchResult'));
    const [entitlementOpen, setEntitlementOpen] = useState(false);
    const [entitlementTarget, setEntitlementTarget] = useState(null);
    const [entitlementExpiryDate, setEntitlementExpiryDate] = useState('');
    const [entitlementLimitIp, setEntitlementLimitIp] = useState('0');
    const [entitlementTrafficLimitGb, setEntitlementTrafficLimitGb] = useState('0');
    const [entitlementSpeedLimitUp, setEntitlementSpeedLimitUp] = useState('0');
    const [entitlementSpeedLimitDown, setEntitlementSpeedLimitDown] = useState('0');
    const [entitlementTgId, setEntitlementTgId] = useState('0');
    const [entitlementGroup, setEntitlementGroup] = useState('');
    const [entitlementComment, setEntitlementComment] = useState('');
    const [entitlementReset, setEntitlementReset] = useState('0');
    const [entitlementSaving, setEntitlementSaving] = useState(false);
    const [overrideKeySet, setOverrideKeySet] = useState(() => new Set(bootstrapRef.current?.overrideKeys || []));
    const [clientActionKey, setClientActionKey] = useState('');
    const [selectedClientKeys, setSelectedClientKeys] = useState(new Set());
    const [clientAdjustOpen, setClientAdjustOpen] = useState(false);
    const [clientAdjustTarget, setClientAdjustTarget] = useState(null);
    const [clientAdjustDays, setClientAdjustDays] = useState('');
    const [clientAdjustTrafficGb, setClientAdjustTrafficGb] = useState('');
    const [clientAdjustSaving, setClientAdjustSaving] = useState(false);
    const orderedServerOptions = useMemo(
        () => sortServersByOrder(servers, serverOrder),
        [servers, serverOrder]
    );

    const sortVisibleInbounds = (items, orderMap, nextServerOrder = serverOrder) => sortInboundsByOrder(items, orderMap, {
        serverOrder: nextServerOrder,
    });

    const fetchAllInbounds = async (options = {}) => {
        const preserveCurrent = options.preserveCurrent === true || (options.preserveCurrent == null && inbounds.length > 0);
        const force = options.force === true;
        if (force) {
            invalidateServerPanelDataCache();
        }
        if (servers.length === 0) {
            inboundsRequestIdRef.current += 1;
            if (!preserveCurrent) {
                setInbounds([]);
            }
            setLoading(false);
            return;
        }
        const requestId = inboundsRequestIdRef.current + 1;
        inboundsRequestIdRef.current = requestId;
        if (!preserveCurrent) {
            setLoading(true);
        }
        const allResults = [];
        if (!preserveCurrent) {
            setSelectedKeys(new Set());
            setSelectedClientKeys(new Set());
            setInboundOrderDrafts({});
        }
        let orderMap = inboundOrder;
        let nextServerOrder = serverOrder;
        const previousInboundsByServer = preserveCurrent
            ? servers.reduce((acc, server) => {
                acc[server.id] = inbounds.filter((item) => item.serverId === server.id);
                return acc;
            }, {})
            : {};

        try {
            const [orderRes, serverOrderRes] = await Promise.all([
                api.get('/system/inbounds/order'),
                api.get('/system/servers/order'),
            ]);
            if (requestId !== inboundsRequestIdRef.current) return;
            orderMap = normalizeInboundOrderMap(orderRes.data?.obj || {});
            nextServerOrder = Array.isArray(serverOrderRes.data?.obj)
                ? serverOrderRes.data.obj.map((item) => String(item || '').trim()).filter(Boolean)
                : [];
            setInboundOrder(orderMap);
            setServerOrder(nextServerOrder);
        } catch (err) {
            if (requestId !== inboundsRequestIdRef.current) return;
            console.error('Failed to load inbound or server order:', err);
        }

        try {
            const overrideRes = await api.get('/clients/entitlement-overrides');
            if (requestId !== inboundsRequestIdRef.current) return;
            const items = Array.isArray(overrideRes.data?.obj) ? overrideRes.data.obj : [];
            setOverrideKeySet(new Set(items.map((item) => buildOverrideKey(item.serverId, item.inboundId, item.clientIdentifier))));
        } catch (err) {
            if (requestId !== inboundsRequestIdRef.current) return;
            console.error('Failed to load entitlement overrides:', err);
            if (!preserveCurrent) {
                setOverrideKeySet(new Set());
            }
        }

        try {
            const serverResults = await fetchServerPanelData(api, servers, {
                includeOnlines: true,
                force,
            });
            if (requestId !== inboundsRequestIdRef.current) return;

            serverResults.forEach((result) => {
                const server = result.server;
                try {
                    const onlineEntries = Array.isArray(result?.onlines) ? result.onlines : [];
                    const onlineCounter = new Map();
                    onlineEntries.forEach((entry) => {
                        normalizeOnlineEntry(entry).forEach((key) => {
                            onlineCounter.set(key, (onlineCounter.get(key) || 0) + 1);
                        });
                    });

                    if (Array.isArray(result?.inbounds)) {
                        const serverInbounds = result.inbounds.map((ib) => {
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
                    if (result?.inboundsError || result?.onlinesError) {
                        toast.error(`节点 ${server.name} 连接失败`, { id: `err-${server.id}` });
                    }
                } catch (err) {
                    console.error(`Failed to normalize inbounds from ${server.name}`, err);
                    if (preserveCurrent && Array.isArray(previousInboundsByServer[server.id])) {
                        allResults.push(...previousInboundsByServer[server.id]);
                    }
                }
            });
        } catch (err) {
            if (requestId !== inboundsRequestIdRef.current) return;
            console.error('Failed to load aggregated inbound snapshot:', err);
            if (preserveCurrent) {
                Object.values(previousInboundsByServer).forEach((items) => {
                    if (Array.isArray(items)) {
                        allResults.push(...items);
                    }
                });
            } else {
                toast.error(t('comp.common.loadFailed'));
            }
        }

        if (requestId !== inboundsRequestIdRef.current) return;

        const sortedItems = sortVisibleInbounds(allResults, orderMap, nextServerOrder);
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
        setInbounds(sortVisibleInbounds(allResults, nextOrderMap, nextServerOrder));
        setLoading(false);
    };

    useEffect(() => {
        fetchAllInbounds({ preserveCurrent: bootstrapRef.current?.inbounds?.length > 0 });
    }, [servers]);

    useEffect(() => {
        writeSessionSnapshot(INBOUNDS_SNAPSHOT_KEY, {
            inbounds,
            inboundOrder,
            serverOrder,
            overrideKeys: Array.from(overrideKeySet),
        });
    }, [inbounds, inboundOrder, overrideKeySet, serverOrder]);

    useEffect(() => {
        if (filterServerId !== 'all' && servers.length > 0 && !servers.some(s => s.id === filterServerId)) {
            setFilterServerId(resolvedActiveFilterServerId);
        }
    }, [filterServerId, servers, resolvedActiveFilterServerId]);

    useEffect(() => {
        setFilterServerId(resolvedActiveFilterServerId);
    }, [resolvedActiveFilterServerId]);

    useEffect(() => {
        setInbounds((prev) => sortVisibleInbounds(prev, inboundOrder));
    }, [inboundOrder, serverOrder]);

    useEffect(() => {
        // Avoid accidental cross-node batch actions after changing filter tabs.
        setSelectedKeys(new Set());
        setInboundOrderDrafts({});
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
            title: t('comp.inbounds.batchDeleteTitle'),
            message: `确定删除选中的 ${selectedVisibleCount} 个入站吗？`,
            details: t('comp.inbounds.batchDeleteDetails'),
            confirmText: t('comp.common.confirmDelete'),
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
            setBatchResultTitle(t('comp.inbounds.batchDeleteResult'));
            setBatchResultData(output || null);
            toast.success(`批量删除完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = getErrorMessage(err, t('comp.inbounds.batchDeleteFailed'), locale);
            toast.error(msg);
        }
    };

    const handleBulkReset = async () => {
        const ok = await confirmAction({
            title: t('comp.inbounds.batchResetTitle'),
            message: `确定重置选中的 ${selectedVisibleCount} 个入站流量吗？`,
            confirmText: t('comp.common.confirmReset'),
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
            setBatchResultTitle(t('comp.inbounds.batchResetResult'));
            setBatchResultData(output || null);
            toast.success(`流量重置完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = getErrorMessage(err, t('comp.inbounds.batchResetFailed'), locale);
            toast.error(msg);
        }
    };

    const handleBulkSyncExistingUsers = async () => {
        const ok = await confirmAction({
            title: t('comp.inbounds.batchSyncUsersTitle'),
            message: `确定把选中的 ${selectedVisibleCount} 个入站补齐到现有用户吗？`,
            details: t('comp.inbounds.batchSyncUsersDetails'),
            confirmText: t('comp.inbounds.batchSyncUsersAction'),
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
                action: 'syncExistingUsers',
                targets,
            }, {
                type: 'inbounds',
                action: 'syncExistingUsers',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/inbounds', payload);
            const output = res.data?.obj;
            const syncSummary = output?.subscriptionSync || null;
            setBatchResultTitle(t('comp.inbounds.batchSyncUsersResult'));
            setBatchResultData(output || null);

            if (Number(syncSummary?.failedUsers || 0) > 0) {
                toast.error(
                    `${t('comp.inbounds.batchSyncUsersDone')}: ${syncSummary?.syncedUsers || 0} 已同步, ${syncSummary?.skippedUsers || 0} 跳过, ${syncSummary?.failedUsers || 0} 失败；订阅地址未变`
                );
            } else {
                toast.success(
                    `${t('comp.inbounds.batchSyncUsersDone')}: ${syncSummary?.syncedUsers || 0} 已同步, ${syncSummary?.skippedUsers || 0} 跳过；订阅地址未变`
                );
            }
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = getErrorMessage(err, t('comp.inbounds.batchSyncUsersFailed'), locale);
            toast.error(msg);
        }
    };

    const handleBulkSetEnable = async (enable) => {
        const ok = await confirmAction({
            title: enable ? t('comp.inbounds.batchEnableTitle') : t('comp.inbounds.batchDisableTitle'),
            message: `确定${enable ? '启用' : '停用'}选中的 ${selectedVisibleCount} 个入站吗？`,
            confirmText: enable ? t('comp.common.confirmEnable') : t('comp.common.confirmDisable'),
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
            setBatchResultTitle(enable ? t('comp.inbounds.batchEnableResult') : t('comp.inbounds.batchDisableResult'));
            setBatchResultData(output || null);
            toast.success(`${enable ? t('comp.inbounds.batchEnableDone') : t('comp.inbounds.batchDisableDone')}: ${summary.success}/${summary.total}`);
            setSelectedKeys(new Set());
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            const msg = getErrorMessage(err, t('comp.inbounds.batchToggleFailed'), locale);
            toast.error(msg);
        }
    };

    const handleDelete = async (inbound) => {
        const ok = await confirmAction({
            title: t('comp.inbounds.deleteTitle'),
            message: `确定删除 ${inbound.serverName} 上的该入站吗？`,
            confirmText: t('comp.common.confirmDelete'),
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.post(`/panel/${inbound.serverId}/panel/api/inbounds/del/${inbound.id}`);
            toast.success(t('comp.inbounds.inboundDeleted'));
            fetchAllInbounds();
        } catch {
            toast.error(t('comp.common.deleteFailed'));
        }
    };

    const handleToggleInboundEnabled = async (inbound) => {
        const nextEnable = inbound.enable === false;
        const ok = await confirmAction({
            title: t('comp.inbounds.toggleInboundTitle'),
            message: `确定${nextEnable ? '启用' : '停用'} ${inbound.serverName} 上的该入站吗？`,
            confirmText: nextEnable ? t('comp.common.confirmEnable') : t('comp.common.confirmDisable'),
            tone: nextEnable ? 'success' : 'danger',
        });
        if (!ok) return;

        try {
            const action = nextEnable ? 'enable' : 'disable';
            const payload = await attachBatchRiskToken({
                action,
                targets: [{
                    serverId: inbound.serverId,
                    serverName: inbound.serverName,
                    id: inbound.id,
                    remark: inbound.remark,
                    protocol: inbound.protocol,
                    port: inbound.port,
                    listen: inbound.listen,
                    total: inbound.total,
                    expiryTime: inbound.expiryTime,
                    settings: inbound.settings,
                    streamSettings: inbound.streamSettings,
                    sniffing: inbound.sniffing,
                    enable: inbound.enable,
                }],
            }, {
                type: 'inbounds',
                action,
                targetCount: 1,
            });
            await api.post('/batch/inbounds', payload);
            toast.success(nextEnable ? t('comp.inbounds.inboundEnabled') : t('comp.inbounds.inboundDisabled'));
            fetchAllInbounds();
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.inbounds.toggleFailed'), locale));
        }
    };

    const handleCleanupDepletedClients = async (inbound) => {
        const ok = await confirmAction({
            title: t('comp.inbounds.cleanupDepletedTitle'),
            message: `确定清理 ${inbound.serverName} / ${inbound.remark || inbound.protocol}:${inbound.port} 的耗尽用户吗？`,
            details: t('comp.inbounds.cleanupDepletedDetails'),
            confirmText: t('comp.common.confirmDelete'),
            tone: 'danger',
        });
        if (!ok) return;

        try {
            await api.post(`/panel/${inbound.serverId}/panel/api/inbounds/delDepletedClients/${inbound.id}`);
            toast.success(t('comp.inbounds.cleanupDepletedDone'));
            fetchAllInbounds();
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.inbounds.cleanupDepletedFailed'), locale));
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
            setInbounds((prev) => sortVisibleInbounds(prev, nextOrder));
            toast.success(t('comp.inbounds.orderSaved'));
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.inbounds.orderSaveFailed'), locale));
            fetchAllInbounds();
        }
        setSavingOrderServerId('');
    };

    const persistServerOrder = async (serverIds) => {
        setSavingOrderServerId('global');
        try {
            const res = await api.put('/system/servers/order', {
                serverIds,
            });
            const savedIds = Array.isArray(res.data?.obj?.serverIds) ? res.data.obj.serverIds : serverIds;
            setServerOrder(savedIds);
            setInbounds((prev) => sortVisibleInbounds(prev, inboundOrder, savedIds));
            toast.success('节点顺序已保存');
        } catch (err) {
            toast.error(getErrorMessage(err, '节点顺序保存失败', locale));
            fetchAllInbounds();
        }
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
        await persistServerOrder(next.serverIds);
    };

    const handleInboundOrderDraftChange = (inboundKey, value) => {
        setInboundOrderDrafts((prev) => ({
            ...prev,
            [inboundKey]: value,
        }));
    };

    const handleInboundOrderCommit = async (inbound) => {
        if (filterServerId === 'all' || savingOrderServerId === inbound?.serverId) return;
        const inboundKey = String(inbound?.uiKey || '').trim();
        if (!inboundKey) return;

        const rawValue = String(inboundOrderDrafts[inboundKey] ?? '').trim();
        if (!rawValue) {
            setInboundOrderDrafts((prev) => {
                const next = { ...prev };
                delete next[inboundKey];
                return next;
            });
            return;
        }

        const nextPosition = Number.parseInt(rawValue, 10);
        if (!Number.isInteger(nextPosition) || nextPosition <= 0) {
            toast.error(t('comp.inbounds.invalidOrder'));
            return;
        }

        setInboundOrderDrafts((prev) => {
            const next = { ...prev };
            delete next[inboundKey];
            return next;
        });

        await handleMoveInbound(inbound, nextPosition - 1);
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
        const displayName = client.email || identifier || t('comp.inbounds.thisUser');
        const ok = await confirmAction({
            title: t('comp.inbounds.deleteClientTitle'),
            message: `确定删除 ${displayName} 吗？`,
            details: `${inbound.serverName} / ${inbound.remark || inbound.protocol}:${inbound.port}`,
            confirmText: t('comp.common.confirmDelete'),
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
            toast.success(t('comp.inbounds.clientDeleted'));
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            toast.error(getErrorMessage(err, t('comp.common.deleteFailed'), locale));
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
            toast.error(t('comp.inbounds.selectClientsFirst'));
            return;
        }

        const ok = await confirmAction({
            title: t('comp.inbounds.batchDeleteClientTitle'),
            message: `确定删除选中的 ${selectedClients.length} 位用户吗？`,
            details: `${inbound?.serverName || '-'} / ${inbound?.remark || inbound?.protocol || '-'}:${inbound?.port || '-'}`,
            confirmText: t('comp.common.confirmDelete'),
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
            setBatchResultTitle(t('comp.inbounds.batchDeleteClientResult'));
            setBatchResultData(output || null);
            toast.success(`批量删除完成: ${summary.success}/${summary.total} 成功`);
            clearInboundClientSelection(inbound, selectedClients);
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            toast.error(getErrorMessage(err, t('comp.inbounds.batchDeleteFailed'), locale));
        }
    };

    const getSelectedInboundClients = (inbound, clients = []) => (Array.isArray(clients) ? clients : []).filter((client) => {
        const key = buildInboundClientSelectionKey(inbound?.serverId, inbound?.id, getClientIdentifier(client, inbound?.protocol));
        return key && selectedClientKeys.has(key);
    });

    const openClientAdjustModal = (inbound, clients = []) => {
        const selectedClients = getSelectedInboundClients(inbound, clients);
        if (selectedClients.length === 0) {
            toast.error(t('comp.inbounds.selectClientsFirst'));
            return;
        }
        setClientAdjustTarget({
            inbound,
            clients: selectedClients,
        });
        setClientAdjustDays('');
        setClientAdjustTrafficGb('');
        setClientAdjustOpen(true);
    };

    const closeClientAdjustModal = () => {
        if (clientAdjustSaving) return;
        setClientAdjustOpen(false);
        setClientAdjustTarget(null);
        setClientAdjustDays('');
        setClientAdjustTrafficGb('');
    };

    const submitClientAdjust = async (event) => {
        event.preventDefault();
        const inbound = clientAdjustTarget?.inbound;
        const selectedClients = Array.isArray(clientAdjustTarget?.clients) ? clientAdjustTarget.clients : [];
        const addDays = Number(clientAdjustDays || 0) || 0;
        const addGb = Number(clientAdjustTrafficGb || 0) || 0;
        const addBytes = Math.trunc(addGb * 1024 * 1024 * 1024);
        if (addDays === 0 && addBytes === 0) {
            toast.error('请填写要调整的天数或流量');
            return;
        }
        if (!inbound || selectedClients.length === 0) {
            toast.error(t('comp.inbounds.selectClientsFirst'));
            return;
        }

        const targets = selectedClients.map((client) => ({
            serverId: inbound.serverId,
            serverName: inbound.serverName,
            inboundId: inbound.id,
            inboundRemark: inbound.remark || '',
            protocol: inbound.protocol,
            email: client.email || '',
            clientIdentifier: getClientIdentifier(client, inbound.protocol),
            id: client.id || '',
            password: client.password || '',
        }));

        setClientAdjustSaving(true);
        try {
            const payload = await attachBatchRiskToken({
                action: 'adjust',
                targets,
                payload: {
                    addDays,
                    addBytes,
                },
            }, {
                type: 'clients',
                action: 'adjust',
                targetCount: targets.length,
            });
            const res = await api.post('/batch/clients', payload);
            const output = res.data?.obj;
            const summary = output?.summary || { success: 0, total: targets.length, failed: targets.length };
            setBatchResultTitle('批量调整结果');
            setBatchResultData(output || null);
            toast.success(`批量调整完成: ${summary.success}/${summary.total} 成功`);
            clearInboundClientSelection(inbound, selectedClients);
            setClientAdjustOpen(false);
            setClientAdjustTarget(null);
            fetchAllInbounds({ force: true });
        } catch (err) {
            console.error(err);
            toast.error(getErrorMessage(err, '批量调整失败', locale));
        }
        setClientAdjustSaving(false);
    };

    const handleToggleClientEnabled = async (inbound, client) => {
        const identifier = String(getClientIdentifier(client, inbound.protocol) || '').trim();
        if (!identifier) {
            toast.error(t('comp.inbounds.missingClientId'));
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
            toast.success(nextAction === 'enable' ? t('comp.inbounds.clientEnabled') : t('comp.inbounds.clientDisabled'));
            fetchAllInbounds();
        } catch (err) {
            console.error(err);
            toast.error(getErrorMessage(err, t('comp.inbounds.toggleFailed'), locale));
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
        setEntitlementSpeedLimitUp(String(client.speedLimitUp || 0));
        setEntitlementSpeedLimitDown(String(client.speedLimitDown || 0));
        setEntitlementTgId(String(client.tgId || 0));
        setEntitlementGroup(client.group || '');
        setEntitlementComment(client.comment || '');
        setEntitlementReset(String(client.reset || 0));
        setEntitlementSaving(false);
        setEntitlementOpen(true);
    };

    const closeEntitlementModal = () => {
        setEntitlementOpen(false);
        setEntitlementTarget(null);
        setEntitlementExpiryDate('');
        setEntitlementLimitIp('0');
        setEntitlementTrafficLimitGb('0');
        setEntitlementSpeedLimitUp('0');
        setEntitlementSpeedLimitDown('0');
        setEntitlementTgId('0');
        setEntitlementGroup('');
        setEntitlementComment('');
        setEntitlementReset('0');
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
                speedLimitUp: Number(entitlementSpeedLimitUp) || 0,
                speedLimitDown: Number(entitlementSpeedLimitDown) || 0,
                tgId: Number(entitlementTgId) || 0,
                group: entitlementGroup.trim(),
                comment: entitlementComment.trim(),
                reset: Number(entitlementReset) || 0,
            });
            toast.success(t('comp.inbounds.entitlementSaved'));
            closeEntitlementModal();
            fetchAllInbounds();
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.inbounds.entitlementSaveFailed'), locale));
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
            toast.success(t('comp.inbounds.policyRestored'));
            closeEntitlementModal();
            fetchAllInbounds();
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.inbounds.policyRestoreFailed'), locale));
            setEntitlementSaving(false);
        }
    };

    const renderMobileClientCards = (ib, clients = []) => (
        <div className="inbounds-client-mobile-list">
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
                const toggleLabel = cl.enable !== false ? t('comp.common.disable') : t('comp.common.enable');
                const toggleTitle = cl.enable !== false ? t('comp.inbounds.disableUser') : t('comp.inbounds.enableUser');
                const selectionKey = buildInboundClientSelectionKey(ib.serverId, ib.id, clientIdentifier);
                const isClientSelected = Boolean(selectionKey) && selectedClientKeys.has(selectionKey);

                return (
                    <article key={`${clientIdentifier || cl.email || 'client'}-${idx}`} className={`inbounds-client-mobile-card${isClientSelected ? ' is-selected' : ''}`}>
                        <div className="inbounds-client-mobile-head">
                            <label className="inbounds-client-mobile-check">
                                <input
                                    type="checkbox"
                                    aria-label={t('pages.inbounds.selectClient', { name: cl.email || clientIdentifier || idx + 1 })}
                                    checked={isClientSelected}
                                    onChange={() => toggleClientSelect(selectionKey)}
                                    className="cursor-pointer"
                                />
                            </label>
                            <div className="inbounds-client-mobile-copy">
                                <div className="inbounds-client-mobile-email">
                                    <span>{cl.email || '-'}</span>
                                    {hasOverride ? <span className="badge badge-warning">已限制</span> : null}
                                </div>
                                <div className="inbounds-client-mobile-credential cell-mono">
                                    <span>{maskedCredential}</span>
                                    {rawCredential ? (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-xs btn-icon"
                                            title="复制完整 ID / 密码"
                                            disabled={isActioning}
                                            onClick={async () => {
                                                await copyToClipboard(rawCredential);
                                                toast.success(t('comp.inbounds.idCopied'));
                                            }}
                                        >
                                            <HiOutlineClipboard />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="inbound-client-usage inbounds-client-mobile-usage">
                            <div className="inbound-client-usage-head">
                                <span className="font-medium">{formatBytes(usedBytes)}</span>
                                <span className={`inbound-client-usage-badge ${usageTone}`}>
                                    {usagePercent === null ? t('comp.common.unlimited') : `${usagePercent}%`}
                                </span>
                            </div>
                            <div className="inbound-client-usage-track">
                                <div
                                    className={`inbound-client-usage-fill ${usageTone}`}
                                    style={{ width: `${usagePercent === null ? 18 : usagePercent}%` }}
                                />
                            </div>
                            <div className="inbound-client-usage-meta">
                                {totalBytes > 0 ? `${t('comp.inbounds.remaining').replace('{size}', formatBytes(remainingBytes))}` : t('comp.inbounds.totalUnlimited')}
                            </div>
                        </div>

                        <div className="inbounds-client-mobile-metrics">
                            <div className="inbounds-client-mobile-metric">
                                <span className="inbounds-client-mobile-label">总量</span>
                                <span>{totalBytes > 0 ? formatBytes(totalBytes) : '∞'}</span>
                            </div>
                            <div className="inbounds-client-mobile-metric">
                                <span className="inbounds-client-mobile-label">IP 限制</span>
                                <span>{Number(cl.limitIp || 0) > 0 ? cl.limitIp : '∞'}</span>
                            </div>
                            <div className="inbounds-client-mobile-metric">
                                <span className="inbounds-client-mobile-label">到期时间</span>
                                <span>{cl.expiryTime ? new Date(cl.expiryTime).toLocaleDateString() : t('comp.common.permanent')}</span>
                            </div>
                            <div className="inbounds-client-mobile-metric">
                                <span className="inbounds-client-mobile-label">上 / 下行</span>
                                <span className="inbounds-client-traffic-stack">
                                    <span className="text-success">↑{formatBytes(safeNumber(cl.up))}</span>
                                    <span className="text-info">↓{formatBytes(safeNumber(cl.down))}</span>
                                </span>
                            </div>
                        </div>

                        <div className="inbounds-client-mobile-status">
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

                        <div className="inbounds-client-actions inbounds-client-mobile-actions flex gap-2">
                            <button
                                type="button"
                                className={`btn btn-secondary btn-sm inbounds-client-action-btn inbounds-client-limit-btn ${hasOverride ? 'is-active' : ''}`}
                                title={hasOverride ? '已设置单独限制，点击修改' : '设置单独限制'}
                                disabled={isActioning}
                                onClick={() => openEntitlementModal(ib, cl)}
                            >
                                限制
                            </button>
                            <ActionsDropdown
                                actions={[
                                    {
                                        label: toggleLabel,
                                        title: toggleTitle,
                                        icon: cl.enable !== false ? HiOutlineXMark : HiOutlineCheck,
                                        onClick: () => handleToggleClientEnabled(ib, cl),
                                        disabled: isActioning,
                                    },
                                    {
                                        label: '删除',
                                        icon: HiOutlineTrash,
                                        onClick: () => handleDeleteClient(ib, cl),
                                        isDanger: true,
                                        disabled: isActioning,
                                    }
                                ]}
                            />
                        </div>
                    </article>
                );
            })}
        </div>
    );

    const filteredInbounds = filterServerId === 'all'
        ? inbounds
        : inbounds.filter(i => i.serverId === filterServerId);
    const selectedVisibleInbounds = filteredInbounds.filter(i => selectedKeys.has(i.uiKey));
    const selectedVisibleCount = selectedVisibleInbounds.length;
    const bulkToggleEnable = selectedVisibleCount > 0
        ? !selectedVisibleInbounds.every((item) => item.enable !== false)
        : true;
    const bulkToggleLabel = bulkToggleEnable ? t('comp.inbounds.enableSelected') : t('comp.inbounds.disableSelected');
    const bulkToggleIcon = bulkToggleEnable ? <HiOutlineCheck /> : <HiOutlineXMark />;
    const bulkToggleClassName = bulkToggleEnable ? 'btn btn-success btn-sm' : 'btn btn-danger btn-sm';
    const visibleServerIds = Array.from(new Set(filteredInbounds.map((item) => String(item?.serverId || '').trim()).filter(Boolean)));
    const visibleServerIndexMap = new Map(visibleServerIds.map((id, index) => [id, index]));
    const tableColSpan = filterServerId === 'all' ? 11 : 10;

    if (servers.length === 0) {
        return (
            <>
                <Header
                    title={t('pages.inbounds.title')}
                />
                <div className="page-content page-content--wide page-enter inbounds-page">
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
            />
            <div className="page-content page-content--wide page-enter inbounds-page">
                <ListToolbar
                    className="inbounds-toolbar glass-panel mb-6"
                    filters={(
                        <>
                        <select
                            className="form-select inbounds-filter-select"
                            value={filterServerId}
                            onChange={(e) => setFilterServerId(e.target.value)}
                            disabled={isServerFilterLocked}
                        >
                            <option value="all">{t('pages.inbounds.toolbar.allServers', { count: servers.length })}</option>
                            {orderedServerOptions.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        </>
                    )}
                    summary={<span className="text-sm text-muted inbounds-toolbar-summary">{t('pages.inbounds.toolbar.summary', { count: filteredInbounds.length })}</span>}
                    actions={selectedVisibleCount > 0 ? (
                        <div className="flex gap-2 items-center animate-fade-in inbounds-selection-bar">
                            <span className="text-sm font-bold px-2 text-primary">{t('pages.inbounds.toolbar.selected', { count: selectedVisibleCount })}</span>
                            <button className={bulkToggleClassName} onClick={() => handleBulkSetEnable(bulkToggleEnable)}>
                                {bulkToggleIcon}
                                {bulkToggleLabel}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                                <HiOutlineTrash /> {t('pages.inbounds.toolbar.delete')}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={handleBulkReset}>
                                <HiOutlineArrowPath /> {t('pages.inbounds.toolbar.reset')}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={handleBulkSyncExistingUsers}>
                                <HiOutlineArrowPath /> {t('comp.inbounds.syncExistingUsersButton')}
                            </button>
                        </div>
                    ) : (
                        <>
                        <button className="btn btn-primary btn-sm" onClick={handleAdd}>
                            <HiOutlinePlusCircle /> {t('pages.inbounds.toolbar.add')}
                        </button>
                        <button
                            className="btn btn-secondary btn-sm btn-icon inbounds-refresh-btn"
                            onClick={fetchAllInbounds}
                            title={t('pages.inbounds.toolbar.refresh')}
                            aria-label={t('pages.inbounds.toolbar.refresh')}
                        >
                            <HiOutlineArrowPath />
                        </button>
                        </>
                    )}
                />

                {savingOrderServerId && (
                    <div className="text-xs text-muted mb-3 inbounds-saving-note">
                        {savingOrderServerId === 'global'
                            ? t('pages.inbounds.savingOrderGlobal')
                            : t('pages.inbounds.savingOrderServer', { name: servers.find((item) => item.id === savingOrderServerId)?.name || savingOrderServerId })}
                    </div>
                )}

                {loading ? (
                    <div className="table-container p-4">
                        <SkeletonTable rows={5} cols={tableColSpan} />
                    </div>
                ) : filteredInbounds.length === 0 ? (
                    <div className="table-container p-6">
                        <EmptyState
                            icon={<HiOutlineInbox />}
                            title={t('pages.inbounds.emptyTitle')}
                            subtitle={t('pages.inbounds.emptySubtitle')}
                            action={(
                                <button type="button" className="btn btn-primary" onClick={handleAdd}>
                                    <HiOutlinePlusCircle /> {t('pages.inbounds.addAction')}
                                </button>
                            )}
                        />
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table inbounds-table">
                            <thead>
                                <tr>
                                    <th className="cell-checkbox">
                                        <input
                                            type="checkbox"
                                            aria-label={t('pages.inbounds.selectAllRows')}
                                            checked={filteredInbounds.length > 0 && selectedVisibleCount === filteredInbounds.length}
                                            onChange={toggleSelectAll}
                                            className="cursor-pointer"
                                        />
                                    </th>
                                    <th className="inbounds-expand-col" aria-hidden="true" />
                                    <th className={`inbounds-sequence-col${filterServerId === 'all' ? ' is-compact' : ''}`}>{t('pages.inbounds.cols.sequence')}</th>
                                    {filterServerId === 'all' && (
                                        <th className="inbounds-node-col">{t('pages.inbounds.cols.node')}</th>
                                    )}
                                    <th className="inbounds-remark-col">{t('pages.inbounds.cols.remark')}</th>
                                    <th className="table-cell-center inbounds-protocol-col">{t('pages.inbounds.cols.protocol')}</th>
                                    <th className="table-cell-right inbounds-port-col">{t('pages.inbounds.cols.listenPort')}</th>
                                    <th className="table-cell-center inbounds-users-col">{t('pages.inbounds.cols.users')}</th>
                                    <th className="table-cell-right inbounds-traffic-col">{t('pages.inbounds.cols.traffic')}</th>
                                    <th className="table-cell-center inbounds-status-col">{t('pages.inbounds.cols.status')}</th>
                                    <th className="table-cell-actions inbounds-actions-col">{t('pages.inbounds.cols.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredInbounds.map((ib, index) => {
                                    const clients = parseClients(ib);
                                    const isExpanded = expandedId === ib.uiKey;
                                    const isSelected = selectedKeys.has(ib.uiKey);
                                    const canAdjustOrder = filterServerId !== 'all';
                                    const isFirstInServerGroup = filterServerId !== 'all' || index === 0 || filteredInbounds[index - 1]?.serverId !== ib.serverId;
                                    const serverGroupIndex = visibleServerIndexMap.get(String(ib.serverId || '').trim()) ?? 0;
                                    const canMoveServerUp = filterServerId === 'all' && isFirstInServerGroup && serverGroupIndex > 0 && !savingOrderServerId;
                                    const canMoveServerDown = filterServerId === 'all' && isFirstInServerGroup && serverGroupIndex < visibleServerIds.length - 1 && !savingOrderServerId;
                                    const isSavingOrder = savingOrderServerId === ib.serverId;
                                    const canMoveUp = canAdjustOrder && index > 0 && !isSavingOrder;
                                    const canMoveDown = canAdjustOrder && index < filteredInbounds.length - 1 && !isSavingOrder;
                                    const inboundLabel = `${ib.remark || ib.protocol}:${ib.port}`;
                                    const sequenceValue = inboundOrderDrafts[ib.uiKey] ?? String(index + 1);
                                    const selectableClientKeys = clients
                                        .map((client) => buildInboundClientSelectionKey(ib.serverId, ib.id, getClientIdentifier(client, ib.protocol)))
                                        .filter(Boolean);
                                    const selectedClientCount = selectableClientKeys.filter((key) => selectedClientKeys.has(key)).length;
                                    const allInboundClientsSelected = selectableClientKeys.length > 0 && selectedClientCount === selectableClientKeys.length;
                                    const showNodeMoveControls = filterServerId === 'all' && isFirstInServerGroup;
                                    const renderNodeMoveControls = (layout = 'row') => (
                                        <div className={`inbounds-node-order-actions${layout === 'column' ? ' is-inline' : ''}`}>
                                            <div
                                                className={`inbounds-sequence-actions${layout === 'column' ? ' is-vertical' : ''}`}
                                                aria-label={`调整节点 ${ib.serverName} 的序号`}
                                            >
                                                <button
                                                    type="button"
                                                    className="inbounds-sequence-btn btn-icon"
                                                    aria-label={`上移节点 ${ib.serverName}`}
                                                    disabled={!canMoveServerUp}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleMoveServerGroup(ib.serverId, serverGroupIndex - 1);
                                                    }}
                                                >
                                                    <HiOutlineChevronUp />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="inbounds-sequence-btn btn-icon"
                                                    aria-label={`下移节点 ${ib.serverName}`}
                                                    disabled={!canMoveServerDown}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleMoveServerGroup(ib.serverId, serverGroupIndex + 1);
                                                    }}
                                                >
                                                    <HiOutlineChevronDown />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                    return (
                                        <React.Fragment key={ib.uiKey}>
                                            <tr
                                                className={`cursor-pointer transition-colors inbounds-row${isSelected ? ' inbounds-row-selected' : ''}`}
                                                onClick={() => setExpandedId(isExpanded ? null : ib.uiKey)}
                                            >
                                                <td data-label="" onClick={e => e.stopPropagation()} className="text-center mobile-checkbox-cell">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={t('pages.inbounds.selectInboundRow', { name: ib.remark || ib.port || ib.id })}
                                                        checked={isSelected}
                                                        onChange={() => toggleSelect(ib.uiKey)}
                                                        className="cursor-pointer"
                                                    />
                                                </td>
                                                <td
                                                    className="inbounds-expand-cell"
                                                    data-label=""
                                                    aria-hidden={showNodeMoveControls && !isCompactLayout ? undefined : 'true'}
                                                >
                                                    <div className="inbounds-expand-stack">
                                                        <span className={`inbounds-expand-indicator transition-transform duration-200${isExpanded ? ' rotate-90' : ''}`}>
                                                            <HiChevronRight />
                                                        </span>
                                                        {showNodeMoveControls && !isCompactLayout && renderNodeMoveControls('column')}
                                                    </div>
                                                </td>
                                                <td
                                                    data-label={t('pages.inbounds.cols.sequence')}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`inbounds-sequence-cell-td${filterServerId === 'all' ? ' is-compact' : ''}`}
                                                >
                                                    <div className="inbounds-sequence-cell">
                                                        {canAdjustOrder ? (
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                inputMode="numeric"
                                                                aria-label={`设置 ${inboundLabel} 的排序序号`}
                                                                className="form-input form-input-sm cell-mono inbound-order-input"
                                                                value={sequenceValue}
                                                                disabled={isSavingOrder}
                                                                onChange={(event) => handleInboundOrderDraftChange(ib.uiKey, event.target.value)}
                                                                onBlur={() => handleInboundOrderCommit(ib)}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === 'Enter') {
                                                                        event.preventDefault();
                                                                        handleInboundOrderCommit(ib);
                                                                    }
                                                                    if (event.key === 'Escape') {
                                                                        event.preventDefault();
                                                                        setInboundOrderDrafts((prev) => {
                                                                            const next = { ...prev };
                                                                            delete next[ib.uiKey];
                                                                            return next;
                                                                        });
                                                                    }
                                                                }}
                                                            />
                                                        ) : (
                                                            <span className="cell-mono inbounds-sequence-number">{index + 1}</span>
                                                        )}
                                                        {canAdjustOrder && (
                                                            <div className="inbounds-sequence-actions" aria-label={`调整 ${inboundLabel} 的序号`}>
                                                                <button
                                                                    type="button"
                                                                    className="inbounds-sequence-btn btn-icon"
                                                                    aria-label={`上移 ${inboundLabel} 的序号`}
                                                                    disabled={!canMoveUp}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        handleMoveInbound(ib, index - 1);
                                                                    }}
                                                                >
                                                                    <HiOutlineChevronUp />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="inbounds-sequence-btn btn-icon"
                                                                    aria-label={`下移 ${inboundLabel} 的序号`}
                                                                    disabled={!canMoveDown}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        handleMoveInbound(ib, index + 1);
                                                                    }}
                                                                >
                                                                    <HiOutlineChevronDown />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                {filterServerId === 'all' && (
                                                    <td data-label={t('pages.inbounds.cols.node')} onClick={(event) => event.stopPropagation()} className="inbounds-node-cell">
                                                        <div className="inbounds-node-cell-inner">
                                                            <span className="badge badge-neutral inbounds-node-badge">
                                                                <HiOutlineServer size={10} />
                                                                <span className="inbounds-node-name" title={ib.serverName}>{ib.serverName}</span>
                                                            </span>
                                                            {showNodeMoveControls && isCompactLayout && renderNodeMoveControls('row')}
                                                        </div>
                                                    </td>
                                                )}
                                                <td
                                                    data-label={t('pages.inbounds.cols.remark')}
                                                    className="inbounds-remark-cell"
                                                >
                                                    <InboundRemarkPill remark={ib.remark} protocol={ib.protocol} />
                                                </td>
                                                <td data-label={t('pages.inbounds.cols.protocol')} className="table-cell-center whitespace-nowrap inbounds-protocol-cell"><span className="badge badge-info">{ib.protocol}</span></td>
                                                <td data-label={t('pages.inbounds.cols.listenPort')} className="table-cell-right cell-mono text-sm whitespace-nowrap inbounds-port-cell">{ib.listen || '*'}:{ib.port}</td>
                                                <td data-label={t('pages.inbounds.cols.users')} className="table-cell-center inbounds-users-cell">
                                                    <span className="cell-mono inbounds-user-count" title={t('pages.inbounds.toolbar.summary', { count: clients.length })}>
                                                        {clients.length}
                                                    </span>
                                                </td>
                                                <td data-label={t('pages.inbounds.cols.traffic')} className="table-cell-right text-sm inbounds-traffic-cell">
                                                    <div className="inbounds-traffic-stack">
                                                        <span className="text-success">↑{formatBytes(ib.trafficUp)}</span>
                                                        <span className="text-info">↓{formatBytes(ib.trafficDown)}</span>
                                                    </div>
                                                </td>
                                                <td data-label={t('pages.inbounds.cols.status')} className="table-cell-center inbounds-status-cell-wrap">
                                                    <div className="inbounds-status-cell">
                                                        <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>
                                                            {ib.enable ? t('comp.common.enabled') : t('comp.common.disabled')}
                                                        </span>
                                                        {ib.hasOnlineUsers && (
                                                            <span
                                                                className="inbounds-online-indicator"
                                                                title={t('comp.inbounds.onlineUsersTitle', { users: ib.onlineUserCount || 0, sessions: ib.onlineSessionCount || 0 })}
                                                            >
                                                                <span className="inbounds-online-dot-shell" aria-hidden="true">
                                                                    <span className="inbounds-online-dot-ping" />
                                                                    <span className="inbounds-online-dot" />
                                                                </span>
                                                                {t('comp.users.online')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td data-label={t('pages.inbounds.cols.actions')} className="table-cell-actions inbounds-actions-cell" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex gap-2 items-center inbounds-row-actions">
                                                        <button
                                                            className="btn btn-secondary btn-sm btn-icon table-action-btn inbounds-action-btn"
                                                            title={t('comp.common.edit')}
                                                            onClick={() => handleEdit(ib)}
                                                        >
                                                            <HiOutlinePencilSquare />
                                                            <span className="inbounds-action-mobile-label">{t('comp.common.edit')}</span>
                                                        </button>
                                                        <ActionsDropdown
                                                            actions={[
                                                                {
                                                                    label: ib.enable ? t('comp.common.disable') : t('comp.common.enable'),
                                                                    icon: ib.enable ? HiOutlineXMark : HiOutlineCheck,
                                                                    onClick: () => handleToggleInboundEnabled(ib),
                                                                },
                                                                {
                                                                    label: t('comp.inbounds.cleanupDepletedTitle'),
                                                                    icon: HiOutlineArrowPath,
                                                                    onClick: () => handleCleanupDepletedClients(ib),
                                                                },
                                                                {
                                                                    label: t('comp.common.delete'),
                                                                    icon: HiOutlineTrash,
                                                                    onClick: () => handleDelete(ib),
                                                                    isDanger: true,
                                                                }
                                                            ]}
                                                        />
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
                                                                                openClientAdjustModal(ib, clients);
                                                                            }}
                                                                        >
                                                                            <HiOutlineCalendarDays /> 调整到期/流量
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
                                                            {isCompactLayout ? renderMobileClientCards(ib, clients) : (
                                                            <div className="table-container">
                                                                <table className="table w-full text-xs inbounds-clients-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="cell-checkbox">
                                                                            <input
                                                                                type="checkbox"
                                                                                aria-label={t('pages.inbounds.selectAllClients')}
                                                                                checked={allInboundClientsSelected}
                                                                                onChange={() => toggleSelectAllInboundClients(ib, clients)}
                                                                                className="cursor-pointer"
                                                                            />
                                                                        </th>
                                                                        <th className="inbounds-clients-col-email">Email</th>
                                                                        <th className="inbounds-clients-col-id">ID/密码（脱敏）</th>
                                                                        <th className="inbounds-clients-col-usage">已用流量</th>
                                                                        <th className="table-cell-right inbounds-clients-col-total">总量</th>
                                                                        <th className="table-cell-right inbounds-clients-col-ip">IP 限制</th>
                                                                        <th className="table-cell-right inbounds-clients-col-traffic">上 / 下行</th>
                                                                        <th className="table-cell-center inbounds-clients-col-expiry">到期时间</th>
                                                                        <th className="table-cell-center inbounds-clients-col-status">状态</th>
                                                                        <th className="table-cell-actions inbounds-clients-col-actions">操作</th>
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
                                                                        const toggleLabel = cl.enable !== false ? t('comp.common.disable') : t('comp.common.enable');
                                                                        const toggleTitle = cl.enable !== false ? t('comp.inbounds.disableUser') : t('comp.inbounds.enableUser');
                                                                        const selectionKey = buildInboundClientSelectionKey(ib.serverId, ib.id, clientIdentifier);
                                                                        const isClientSelected = Boolean(selectionKey) && selectedClientKeys.has(selectionKey);
                                                                        return (
                                                                        <tr key={idx}>
                                                                            <td data-label="" onClick={(e) => e.stopPropagation()} className="text-center mobile-checkbox-cell">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    aria-label={t('pages.inbounds.selectClient', { name: cl.email || clientIdentifier || idx + 1 })}
                                                                                    checked={isClientSelected}
                                                                                    onChange={() => toggleClientSelect(selectionKey)}
                                                                                    className="cursor-pointer"
                                                                                />
                                                                            </td>
                                                                            <td data-label="用户" className="inbounds-clients-col-email">
                                                                                <div className="inbounds-client-email-row">
                                                                                    <span>{cl.email || '-'}</span>
                                                                                    {hasOverride && (
                                                                                        <span className="badge badge-warning">已限制</span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="ID / 密码" className="cell-mono inbounds-clients-col-id">
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
                                                                                                toast.success(t('comp.inbounds.idCopied'));
                                                                                            }}
                                                                                        >
                                                                                            <HiOutlineClipboard />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="已用流量" className="inbounds-clients-col-usage">
                                                                                <div className="inbound-client-usage">
                                                                                    <div className="inbound-client-usage-head">
                                                                                        <span className="font-medium">{formatBytes(usedBytes)}</span>
                                                                                        <span className={`inbound-client-usage-badge ${usageTone}`}>
                                                                                            {usagePercent === null ? t('comp.common.unlimited') : `${usagePercent}%`}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="inbound-client-usage-track">
                                                                                        <div
                                                                                            className={`inbound-client-usage-fill ${usageTone}`}
                                                                                            style={{ width: `${usagePercent === null ? 18 : usagePercent}%` }}
                                                                                        />
                                                                                    </div>
                                                                                    <div className="inbound-client-usage-meta">
                                                                                        {totalBytes > 0 ? `${t('comp.inbounds.remaining').replace('{size}', formatBytes(remainingBytes))}` : t('comp.inbounds.totalUnlimited')}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="总量" className="table-cell-right cell-mono-right inbounds-clients-col-total">{totalBytes > 0 ? formatBytes(totalBytes) : '∞'}</td>
                                                                            <td data-label="IP 限制" className="table-cell-right cell-mono-right inbounds-clients-col-ip">{Number(cl.limitIp || 0) > 0 ? cl.limitIp : '∞'}</td>
                                                                            <td data-label="上 / 下行" className="table-cell-right inbounds-clients-col-traffic">
                                                                                <div className="inbounds-client-traffic-stack">
                                                                                    <span className="text-success">↑{formatBytes(safeNumber(cl.up))}</span>
                                                                                    <span className="text-info">↓{formatBytes(safeNumber(cl.down))}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td data-label="到期时间" className="table-cell-center cell-mono inbounds-clients-col-expiry">{cl.expiryTime ? new Date(cl.expiryTime).toLocaleDateString() : t('comp.common.permanent')}</td>
                                                                            <td data-label="状态" className="table-cell-center inbounds-clients-col-status">
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
                                                                            <td data-label="操作" className="table-cell-actions inbounds-clients-col-actions">
                                                                                <div className="inbounds-client-actions flex items-center gap-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        className={`btn btn-secondary btn-sm inbounds-client-action-btn inbounds-client-limit-btn ${hasOverride ? 'is-active' : ''}`}
                                                                                        title={hasOverride ? '已设置单独限制，点击修改' : '设置单独限制'}
                                                                                        disabled={isActioning}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            openEntitlementModal(ib, cl);
                                                                                        }}
                                                                                    >
                                                                                        限制
                                                                                    </button>
                                                                                    <ActionsDropdown
                                                                                        actions={[
                                                                                            {
                                                                                                label: toggleLabel,
                                                                                                title: toggleTitle,
                                                                                                icon: cl.enable !== false ? HiOutlineXMark : HiOutlineCheck,
                                                                                                onClick: () => handleToggleClientEnabled(ib, cl),
                                                                                                disabled: isActioning,
                                                                                            },
                                                                                            {
                                                                                                label: '删除',
                                                                                                icon: HiOutlineTrash,
                                                                                                onClick: () => handleDeleteClient(ib, cl),
                                                                                                isDanger: true,
                                                                                                disabled: isActioning,
                                                                                            }
                                                                                        ]}
                                                                                    />
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                            </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                <InboundModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    editingInbound={editingInbound}
                    onSuccess={() => fetchAllInbounds({ force: true })}
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
                    onSuccess={() => fetchAllInbounds({ force: true })}
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
                        <button className="btn btn-secondary btn-sm" onClick={handleBulkSyncExistingUsers}><HiOutlineArrowPath /> {t('comp.inbounds.syncExistingUsersButton')}</button>
                    </div>
                )}

                <BatchResultModal
                    isOpen={!!batchResultData}
                    onClose={() => setBatchResultData(null)}
                    title={batchResultTitle}
                    data={batchResultData}
                />

                {clientAdjustOpen && clientAdjustTarget && (
                    <ModalShell isOpen={clientAdjustOpen} onClose={closeClientAdjustModal}>
                        <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title">批量调整到期/流量</h3>
                                <button className="modal-close" onClick={closeClientAdjustModal} aria-label="关闭" title="关闭">
                                    <HiOutlineXMark />
                                </button>
                            </div>
                            <form onSubmit={submitClientAdjust}>
                                <div className="modal-body">
                                    <div className="mb-4 p-3 rounded bg-surface-soft border border-stroke-soft text-sm">
                                        <div>节点: <strong>{clientAdjustTarget.inbound.serverName}</strong></div>
                                        <div>入站: <strong>{clientAdjustTarget.inbound.remark || clientAdjustTarget.inbound.protocol}</strong></div>
                                        <div>已选用户: <strong>{clientAdjustTarget.clients.length}</strong></div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">到期天数变化</label>
                                        <input
                                            type="number"
                                            className="form-input"
                                            step="1"
                                            value={clientAdjustDays}
                                            onChange={(e) => setClientAdjustDays(e.target.value)}
                                            placeholder="例如 30 或 -7"
                                        />
                                        <p className="text-xs text-muted mt-1">正数延长，负数扣减；永不过期用户会跳过到期调整。</p>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">流量变化</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                className="form-input"
                                                step="0.5"
                                                value={clientAdjustTrafficGb}
                                                onChange={(e) => setClientAdjustTrafficGb(e.target.value)}
                                                placeholder="例如 100 或 -20"
                                            />
                                            <span className="text-sm text-muted">GB</span>
                                        </div>
                                        <p className="text-xs text-muted mt-1">正数增加，负数扣减；不限流量用户会跳过流量调整。</p>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={closeClientAdjustModal}>取消</button>
                                    <button type="submit" className="btn btn-primary" disabled={clientAdjustSaving}>
                                        {clientAdjustSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 执行调整</>}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </ModalShell>
                )}

                {entitlementOpen && entitlementTarget && (
                    <ModalShell isOpen={entitlementOpen} onClose={closeEntitlementModal}>
                        <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title">单独限制</h3>
                                <button className="modal-close" onClick={closeEntitlementModal} aria-label="关闭" title="关闭">
                                    <HiOutlineXMark />
                                </button>
                            </div>
                            <form onSubmit={submitEntitlementOverride}>
                                <div className="modal-body">
                                    <div className="mb-4 p-3 rounded bg-surface-soft border border-stroke-soft text-sm">
                                        <div>节点: <strong>{entitlementTarget.inbound.serverName}</strong></div>
                                        <div>入站: <strong>{entitlementTarget.inbound.remark || entitlementTarget.inbound.protocol}</strong></div>
                                        <div>用户: <strong>{entitlementTarget.client.email || entitlementTarget.clientIdentifier || '-'}</strong></div>
                                    </div>
                                    <div className="grid-auto-280-tight">
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionExpiryLabel')}</label>
                                            <input
                                                type="datetime-local"
                                                className="form-input"
                                                value={entitlementExpiryDate}
                                                onChange={(e) => setEntitlementExpiryDate(e.target.value)}
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionExpiryHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionIpLimitLabel')}</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                min={0}
                                                value={entitlementLimitIp}
                                                onChange={(e) => setEntitlementLimitIp(e.target.value)}
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionIpLimitHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionTrafficLimitLabel')}</label>
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
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionTrafficLimitHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionResetLabel')}</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                min={0}
                                                value={entitlementReset}
                                                onChange={(e) => setEntitlementReset(e.target.value)}
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionResetHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionSpeedLimitUpLabel')}</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                min={0}
                                                value={entitlementSpeedLimitUp}
                                                onChange={(e) => setEntitlementSpeedLimitUp(e.target.value)}
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionSpeedLimitUpHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionSpeedLimitDownLabel')}</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                min={0}
                                                value={entitlementSpeedLimitDown}
                                                onChange={(e) => setEntitlementSpeedLimitDown(e.target.value)}
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionSpeedLimitDownHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionTgIdLabel')}</label>
                                            <input
                                                type="number"
                                                className="form-input"
                                                min={0}
                                                value={entitlementTgId}
                                                onChange={(e) => setEntitlementTgId(e.target.value)}
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionTgIdHint')}</p>
                                        </div>
                                        <div className="form-group mb-0">
                                            <label className="form-label">{t('comp.users.provisionGroupLabel')}</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={entitlementGroup}
                                                onChange={(e) => setEntitlementGroup(e.target.value)}
                                                placeholder="e.g. VipGroup"
                                            />
                                            <p className="text-xs text-muted mt-1">{t('comp.users.provisionGroupHint')}</p>
                                        </div>
                                    </div>
                                    <div className="form-group mt-4">
                                        <label className="form-label">{t('comp.users.provisionCommentLabel')}</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={entitlementComment}
                                            onChange={(e) => setEntitlementComment(e.target.value)}
                                            placeholder="e.g. My private note"
                                        />
                                        <p className="text-xs text-muted mt-1">{t('comp.users.provisionCommentHint')}</p>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={closeEntitlementModal}>取消</button>
                                    <button type="button" className="btn btn-secondary" onClick={restoreEntitlementPolicy} disabled={entitlementSaving}>
                                        {entitlementSaving ? <span className="spinner" /> : '恢复统一策略'}
                                    </button>
                                    <button type="submit" className="btn btn-primary" disabled={entitlementSaving}>
                                        {entitlementSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 保存限制</>}
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
