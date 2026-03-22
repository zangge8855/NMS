import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import Header from '../Layout/Header.jsx';
import ModalShell from '../UI/ModalShell.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import ServerTelemetryCell from './ServerTelemetryCell.jsx';
import { showAggregateToast } from '../UI/AggregateToast.jsx';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../utils/format.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import api from '../../api/client.js';
import {
    HiOutlineArrowDown,
    HiOutlineArrowUp,
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineSignal,
    HiOutlineServerStack,
    HiOutlineEye,
    HiOutlineXMark,
} from 'react-icons/hi2';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import useServerTelemetry from '../../hooks/useServerTelemetry.js';
import useBulkAction from '../../hooks/useBulkAction.js';

const PANEL_AUTH_REPAIR_CODES = new Set([
    'PANEL_CREDENTIAL_UNREADABLE',
    'PANEL_CREDENTIAL_MISSING',
    'PANEL_LOGIN_FAILED',
]);

const SERVER_ENV_LABELS_ZH = {
    prod: '生产',
    production: '生产',
    stage: '预发布',
    staging: '预发布',
    dev: '开发',
    development: '开发',
    test: '测试',
    testing: '测试',
    dr: '灾备',
    sandbox: '沙盒',
};

const SERVER_ENV_LABELS_EN = {
    prod: 'Production',
    production: 'Production',
    stage: 'Staging',
    staging: 'Staging',
    dev: 'Development',
    development: 'Development',
    test: 'Testing',
    testing: 'Testing',
    dr: 'Disaster Recovery',
    sandbox: 'Sandbox',
};

function formatServerEnvironment(value, locale = 'zh-CN') {
    const raw = String(value || '').trim();
    const normalized = raw.toLowerCase();
    const labels = locale === 'zh-CN' ? SERVER_ENV_LABELS_ZH : SERVER_ENV_LABELS_EN;
    if (!normalized || normalized === 'unknown') return '';
    return labels[normalized] || raw;
}

function resolveServerLiveStatus(server, telemetry) {
    if (String(server?.health || '').trim().toLowerCase() === 'maintenance') {
        return 'maintenance';
    }
    if (!telemetry?.checkedAt) {
        return 'unknown';
    }
    return telemetry?.current?.online === true ? 'online' : 'offline';
}

export default function Servers() {
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const navigate = useNavigate();
    const {
        servers, activeServerId, selectServer,
        addServer, addServersBatch, updateServer, removeServer, testConnection, fetchServers,
    } = useServer();

    const [showForm, setShowForm] = useState(false);
    const [showBatchForm, setShowBatchForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({
        name: '',
        url: '',
        username: '',
        password: '',
        group: '',
        tags: '',
        environment: 'unknown',
        health: 'unknown',
    });
    const [batchForm, setBatchForm] = useState({
        username: '',
        password: '',
        group: '',
        environment: 'unknown',
        health: 'unknown',
        entries: '',
        testConnection: true,
    });
    const [batchResult, setBatchResult] = useState(null);
    const [testResults, setTestResults] = useState({});
    const [loading, setLoading] = useState({});
    const [serverOrder, setServerOrder] = useState([]);
    const [credentialRepair, setCredentialRepair] = useState({
        open: false,
        serverId: '',
        username: '',
        password: '',
        applyToSelected: false,
        reason: '',
    });

    // Batch Selection
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [searchKeyword, setSearchKeyword] = useState('');
    const deferredSearchKeyword = useDeferredValue(searchKeyword);
    const [filterGroup, setFilterGroup] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [credentialFilter, setCredentialFilter] = useState('all');
    const [latencyFilter, setLatencyFilter] = useState('all');
    const confirmAction = useConfirm();
    const {
        telemetryByServerId,
        telemetryLoading,
        refreshTelemetry,
    } = useServerTelemetry({
        enabled: servers.length > 0,
        hours: 24,
        points: 24,
    });
    const serverNameById = useMemo(
        () => Object.fromEntries(servers.map((item) => [String(item?.id || '').trim(), String(item?.name || '').trim()])),
        [servers]
    );
    const bulkTestAction = useBulkAction({
        getId: (id) => String(id || ''),
        getLabel: (id) => serverNameById[String(id || '').trim()] || String(id || ''),
    });
    const bulkDeleteAction = useBulkAction({
        getId: (id) => String(id || ''),
        getLabel: (id) => serverNameById[String(id || '').trim()] || String(id || ''),
    });

    const resetForm = () => {
        setForm({
            name: '',
            url: '',
            username: '',
            password: '',
            group: '',
            tags: '',
            environment: 'unknown',
            health: 'unknown',
        });
        setEditingId(null);
        setShowForm(false);
    };

    const resetBatchForm = () => {
        setBatchForm({
            username: '',
            password: '',
            group: '',
            environment: 'unknown',
            health: 'unknown',
            entries: '',
            testConnection: true,
        });
        setBatchResult(null);
        setShowBatchForm(false);
    };

    const closeCredentialRepair = () => {
        setCredentialRepair({
            open: false,
            serverId: '',
            username: '',
            password: '',
            applyToSelected: false,
            reason: '',
        });
    };

    useEffect(() => {
        let disposed = false;
        const loadServerOrder = async () => {
            try {
                const res = await api.get('/system/servers/order');
                if (disposed) return;
                const ids = Array.isArray(res.data?.obj) ? res.data.obj.map((item) => String(item || '').trim()).filter(Boolean) : [];
                setServerOrder(ids);
            } catch (err) {
                if (!disposed) {
                    console.error('Failed to load server order:', err);
                }
            }
        };
        loadServerOrder();
        return () => {
            disposed = true;
        };
    }, []);

    useEffect(() => {
        const knownIds = servers.map((item) => String(item?.id || '').trim()).filter(Boolean);
        setServerOrder((prev) => {
            const next = prev.filter((id) => knownIds.includes(id));
            knownIds.forEach((id) => {
                if (!next.includes(id)) next.push(id);
            });
            return next.length === prev.length && next.every((id, index) => id === prev[index]) ? prev : next;
        });
    }, [servers]);

    const openCredentialRepair = (serverId, reason = '') => {
        const target = servers.find((item) => item.id === serverId);
        setCredentialRepair({
            open: true,
            serverId,
            username: String(target?.username || '').trim(),
            password: '',
            applyToSelected: selectedIds.size > 1 && selectedIds.has(serverId),
            reason: String(reason || ''),
        });
    };

    const parseBatchEntries = (text) => {
        const lines = String(text || '').split(/\r?\n/);
        const items = [];

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;

            const parts = rawLine.split(/[\t,]/).map((item) => item.trim());
            if (parts.length === 1) {
                items.push({ line: i + 1, url: parts[0] });
                continue;
            }

            if (parts.length === 2) {
                items.push({ line: i + 1, name: parts[0], url: parts[1] });
                continue;
            }

            if (parts.length === 3) {
                items.push({ line: i + 1, name: parts[0], url: parts[1], basePath: parts[2] });
                continue;
            }

            throw new Error(`第 ${i + 1} 行格式错误，请使用 1~3 列（逗号或 TAB 分隔）`);
        }

        return items;
    };

    const getPanelUrl = (server) => {
        const baseUrl = String(server?.url || '').trim();
        const basePath = String(server?.basePath || '/').trim();
        if (!baseUrl) return '';
        if (!basePath || basePath === '/') return baseUrl;
        return `${baseUrl}${basePath.startsWith('/') ? basePath : `/${basePath}`}`;
    };



    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.url || !form.username || (!editingId && !form.password)) {
            toast.error(t('comp.servers.fillComplete'));
            return;
        }
        setLoading(prev => ({ ...prev, submit: true }));
        try {
            const payload = {
                ...form,
                tags: String(form.tags || '')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                group: String(form.group || '').trim(),
            };
            if (editingId) {
                // Keep existing passwords if edit form leaves them blank.
                if (!payload.password) {
                    delete payload.password;
                }
                const res = await updateServer(editingId, payload);
                toast.success(res.msg || t('comp.servers.serverUpdated'));
            } else {
                const res = await addServer(payload);
                toast.success(res.msg || t('comp.servers.serverAdded'));
            }
            resetForm();
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.common.operationFailed'), locale));
        }
        setLoading(prev => ({ ...prev, submit: false }));
    };

    const handleBatchSubmit = async (e) => {
        e.preventDefault();
        const username = String(batchForm.username || '').trim();
        const password = String(batchForm.password || '').trim();
        if (!username || !password) {
            toast.error(t('comp.servers.fillCredentials'));
            return;
        }

        let items = [];
        try {
            items = parseBatchEntries(batchForm.entries);
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.servers.batchFormatError'), locale));
            return;
        }

        if (items.length === 0) {
            toast.error(t('comp.servers.fillAtLeastOne'));
            return;
        }

        setLoading(prev => ({ ...prev, batchSubmit: true }));
        setBatchResult(null);
        try {
            const payload = {
                common: {
                    username,
                    password,
                    group: String(batchForm.group || '').trim(),
                    environment: batchForm.environment,
                    health: batchForm.health,
                },
                testConnection: batchForm.testConnection,
                items,
            };
            const res = await addServersBatch(payload);
            setBatchResult(res.obj || null);
            toast.success(res.msg || t('comp.servers.batchAddDone'));
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.servers.batchAddFailed'), locale));
        }
        setLoading(prev => ({ ...prev, batchSubmit: false }));
    };

    const handleEdit = (server) => {
        setForm({
            name: server.name, url: getPanelUrl(server),
            username: server.username,
            password: '',
            group: server.group || '',
            tags: Array.isArray(server.tags) ? server.tags.join(', ') : '',
            environment: server.environment || 'unknown',
            health: server.health || 'unknown',
        });
        setEditingId(server.id);
        setShowForm(true);
    };

    function getAuthRepairCode(errorLike) {
        const code = String(errorLike?.code || errorLike?.response?.data?.code || '').trim();
        if (!code) return '';
        return PANEL_AUTH_REPAIR_CODES.has(code) ? code : '';
    }

    const showBatchToast = (title, report, onRetry = null) => {
        showAggregateToast({
            title,
            report,
            successLabel: uiText.toastSuccess,
            failureLabel: uiText.toastFailed,
            detailsLabel: uiText.toastDetails,
            retryLabel: uiText.toastRetry,
            closeLabel: uiText.toastClose,
            onRetry,
        });
    };

    const handleDelete = async (id) => {
        const ok = await confirmAction({
            title: t('comp.servers.deleteTitle'),
            message: t('comp.servers.deleteMessage'),
            details: t('comp.servers.deleteDetails'),
            confirmText: t('comp.common.confirmDelete'),
            tone: 'danger',
        });
        if (!ok) return;
        setLoading((prev) => ({ ...prev, [`delete-${id}`]: true }));
        try {
            await removeServer(id);
            toast.success(t('comp.servers.serverDeleted'));
            refreshTelemetry({ quiet: true });
        } catch (err) {
            toast.error(getErrorMessage(err, t('comp.common.deleteFailed'), locale));
        }
        setLoading((prev) => ({ ...prev, [`delete-${id}`]: false }));
    };

    // Batch Actions
    const toggleSelect = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        const visibleIds = filteredServers.map((item) => item.id);
        if (visibleIds.length === 0) return;
        const everySelected = visibleIds.every((id) => selectedIds.has(id));
        if (everySelected) {
            const next = new Set(selectedIds);
            visibleIds.forEach((id) => next.delete(id));
            setSelectedIds(next);
            return;
        }
        setSelectedIds((prev) => new Set([...prev, ...visibleIds]));
    };

    const handleBulkDelete = async () => {
        const selectedVisibleCount = filteredServers.filter(item => selectedIds.has(item.id)).length;
        const ok = await confirmAction({
            title: t('comp.servers.batchDeleteTitle'),
            message: t('comp.servers.batchDeleteMessage', { count: selectedVisibleCount }),
            details: t('comp.servers.batchDeleteDetails'),
            confirmText: t('comp.common.confirmDelete'),
            tone: 'danger',
        });
        if (!ok) return;
        const executeDelete = async (id) => {
            const res = await api.delete(`/servers/${encodeURIComponent(id)}`);
            return {
                message: res.data?.msg || t('comp.servers.serverDeleted'),
            };
        };
        const runDelete = async (ids) => {
            const report = await bulkDeleteAction.run(ids, executeDelete, {
                mapError: (error) => ({
                    message: getErrorMessage(error, t('comp.common.deleteFailed'), locale),
                }),
            });
            if (report.successCount > 0) {
                await fetchServers();
                refreshTelemetry({ quiet: true });
            }
            setSelectedIds((previous) => {
                const next = new Set(previous);
                report.successItems.forEach((item) => next.delete(item.id));
                return next;
            });
            showBatchToast(
                uiText.bulkDeleteTitle,
                report,
                report.failureCount > 0 ? () => runDelete(report.failureItems.map((item) => item.item)) : null
            );
            return report;
        };
        await runDelete(Array.from(selectedIds));
    };

    const handleBulkTest = async () => {
        const executeTest = async (id) => {
            const res = await testConnection(id);
            const authCode = getAuthRepairCode(res);
            if (!res?.success) {
                const error = new Error(res?.msg || t('comp.common.connectFailed'));
                error.code = authCode || res?.code || '';
                error.meta = { authCode };
                throw error;
            }
            return {
                message: res.msg || t('comp.servers.connectSuccess'),
                meta: { authCode },
            };
        };
        const runTest = async (ids) => {
            const report = await bulkTestAction.run(ids, executeTest, {
                mapError: (error) => ({
                    message: getErrorMessage(error, t('comp.common.connectFailed'), locale),
                    meta: error?.meta || { authCode: getAuthRepairCode(error) },
                }),
                onItemSettled: (result) => {
                    setTestResults((previous) => ({
                        ...previous,
                        [result.id]: result.success ? 'success' : 'error',
                    }));
                },
            });
            refreshTelemetry({ quiet: true });
            const repairTarget = report.failureItems.find((item) => item?.meta?.authCode || getAuthRepairCode(item?.error));
            if (repairTarget) {
                openCredentialRepair(repairTarget.id, repairTarget.message || t('comp.common.authFailed'));
            }
            showBatchToast(
                uiText.bulkTestTitle,
                report,
                report.failureCount > 0 ? () => runTest(report.failureItems.map((item) => item.item)) : null
            );
            return report;
        };
        await runTest(Array.from(selectedIds));
    };

    const handleCredentialRepairSubmit = async (e) => {
        e.preventDefault();
        const username = String(credentialRepair.username || '').trim();
        const password = String(credentialRepair.password || '');
        if (!username || !password) {
            toast.error(t('comp.servers.enterCredentials'));
            return;
        }

        const selectedTargetIds = credentialRepair.applyToSelected
            ? Array.from(selectedIds)
            : [];
        const baseTarget = credentialRepair.serverId ? [credentialRepair.serverId] : [];
        const targetIds = Array.from(new Set([...(selectedTargetIds.length > 0 ? selectedTargetIds : baseTarget)]));
        if (targetIds.length === 0) {
            toast.error(t('comp.servers.noRepairNeeded'));
            return;
        }

        setLoading((prev) => ({ ...prev, repairCredentials: true }));
        const failures = [];
        let successCount = 0;

        for (const id of targetIds) {
            try {
                const res = await testConnection(id, {
                    username,
                    password,
                    persistCredentials: true,
                });
                if (res?.success) {
                    successCount += 1;
                    setTestResults((prev) => ({ ...prev, [id]: 'success' }));
                } else {
                    failures.push({ id, msg: res?.msg || t('comp.common.connectFailed') });
                    setTestResults((prev) => ({ ...prev, [id]: 'error' }));
                }
            } catch (err) {
                failures.push({ id, msg: getErrorMessage(err, t('comp.common.connectFailed'), locale) });
                setTestResults((prev) => ({ ...prev, [id]: 'error' }));
            }
        }

        await fetchServers();
        setLoading((prev) => ({ ...prev, repairCredentials: false }));

        if (successCount > 0) {
            closeCredentialRepair();
            toast.success(`凭据已保存：${successCount}/${targetIds.length} 节点修复成功`);
            if (failures.length > 0) {
                toast.error(`仍有 ${failures.length} 个节点连接失败，请核对密码是否一致`);
            }
            return;
        }
        toast.error(t('comp.servers.credentialCheckFailed'));
    };

    const handleTest = async (id) => {
        setLoading(prev => ({ ...prev, [`test-${id}`]: true }));
        try {
            const res = await testConnection(id);
            setTestResults(prev => ({ ...prev, [id]: res.success ? 'success' : 'error' }));
            if (res.success) {
                toast.success(t('comp.servers.connectSuccess'));
            } else {
                toast.error(res.msg || t('comp.common.connectFailed'));
                const authCode = getAuthRepairCode(res);
                if (authCode) {
                    openCredentialRepair(id, res.msg || t('comp.common.authFailed'));
                }
            }
        } catch (err) {
            setTestResults(prev => ({ ...prev, [id]: 'error' }));
            const authCode = getAuthRepairCode(err);
            if (authCode) {
                const reason = err?.response?.data?.msg || t('comp.servers.authFailedUpdate');
                openCredentialRepair(id, reason);
                toast.error(reason);
            } else {
                toast.error(getErrorMessage(err, t('comp.common.connectFailed'), locale));
            }
        }
        refreshTelemetry({ quiet: true });
        setLoading(prev => ({ ...prev, [`test-${id}`]: false }));
    };

    const orderedServers = useMemo(() => {
        const orderMap = new Map();
        serverOrder.forEach((id, index) => orderMap.set(id, index));
        return [...servers].sort((a, b) => {
            const aId = String(a?.id || '').trim();
            const bId = String(b?.id || '').trim();
            const aIndex = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
            const bIndex = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
            if (aIndex !== bIndex) return aIndex - bIndex;
            return String(a?.name || '').localeCompare(String(b?.name || ''), locale, { sensitivity: 'base' });
        });
    }, [locale, serverOrder, servers]);

    const groupOptions = useMemo(() => {
        const set = new Set(
            orderedServers
                .map((item) => String(item.group || '').trim())
                .filter(Boolean)
        );
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [orderedServers]);

    const filteredServers = useMemo(() => {
        const keyword = String(deferredSearchKeyword || '').trim().toLowerCase();
        return orderedServers.filter((server) => {
            if (filterGroup !== 'all' && String(server.group || '') !== filterGroup) return false;
            const telemetry = telemetryByServerId[String(server.id || '').trim()] || null;
            const liveStatus = resolveServerLiveStatus(server, telemetry);
            const credentialStatus = String(server.credentialStatus || 'configured');
            const currentLatency = Number(telemetry?.current?.latencyMs);
            if (statusFilter !== 'all' && liveStatus !== statusFilter) return false;
            if (credentialFilter !== 'all' && credentialStatus !== credentialFilter) return false;
            if (latencyFilter === 'slow' && !(Number.isFinite(currentLatency) && currentLatency >= 150)) return false;
            if (latencyFilter === 'critical' && !(Number.isFinite(currentLatency) && currentLatency >= 300)) return false;
            if (!keyword) return true;
            const tagsText = Array.isArray(server.tags) ? server.tags.join(' ') : '';
            const text = [
                server.name,
                server.url,
                server.username,
                server.group,
                server.environment,
                server.health,
                liveStatus,
                credentialStatus,
                tagsText,
            ]
                .map((item) => String(item || '').toLowerCase())
                .join(' ');
            return text.includes(keyword);
        });
    }, [orderedServers, deferredSearchKeyword, filterGroup, telemetryByServerId, statusFilter, credentialFilter, latencyFilter]);
    const allVisibleSelected = filteredServers.length > 0 && filteredServers.every((item) => selectedIds.has(item.id));
    const repairTargetServer = servers.find((item) => item.id === credentialRepair.serverId) || null;
    const activeServer = useMemo(
        () => servers.find((item) => item.id === activeServerId) || null,
        [servers, activeServerId]
    );
    const uiText = useMemo(() => (
        locale === 'zh-CN'
            ? {
                total: '服务器',
                groups: '分组',
                current: '当前视角',
                global: '全局视角',
                filterSummary: `显示 ${filteredServers.length} / ${servers.length}`,
                searchPlaceholder: '搜索名称 / URL / 标签',
                allGroups: '全部分组',
                allStatus: '全部状态',
                statusOnline: '在线',
                statusOffline: '离线',
                statusMaintenance: '维护',
                statusUnknown: '未采样',
                allCredentials: '全部凭据',
                credentialReady: '凭据正常',
                credentialMissing: '缺失',
                credentialBroken: '损坏',
                allLatency: '全部延迟',
                latencySlow: 'RTT ≥ 150ms',
                latencyCritical: 'RTT ≥ 300ms',
                noMatchTitle: '没有匹配的服务器',
                noMatchSubtitle: '请调整搜索关键词或分组筛选条件',
                bulkTestTitle: '批量连通性检测',
                bulkDeleteTitle: '批量删除服务器',
                toastSuccess: '成功',
                toastFailed: '失败',
                toastDetails: '展开失败详情',
                toastRetry: '重试失败项',
                toastClose: '关闭',
            }
            : {
                total: 'Servers',
                groups: 'Groups',
                current: 'Current scope',
                global: 'Global scope',
                filterSummary: `Showing ${filteredServers.length} / ${servers.length}`,
                searchPlaceholder: 'Search by name / URL / tag',
                allGroups: 'All groups',
                allStatus: 'All status',
                statusOnline: 'Online',
                statusOffline: 'Offline',
                statusMaintenance: 'Maintenance',
                statusUnknown: 'Unsampled',
                allCredentials: 'All credentials',
                credentialReady: 'Configured',
                credentialMissing: 'Missing',
                credentialBroken: 'Broken',
                allLatency: 'All latency',
                latencySlow: 'RTT ≥ 150ms',
                latencyCritical: 'RTT ≥ 300ms',
                noMatchTitle: 'No matching servers',
                noMatchSubtitle: 'Adjust the search keyword or group filter.',
                bulkTestTitle: 'Batch connectivity check',
                bulkDeleteTitle: 'Batch node delete',
                toastSuccess: 'Succeeded',
                toastFailed: 'Failed',
                toastDetails: 'Show failed details',
                toastRetry: 'Retry failed items',
                toastClose: 'Close',
            }
    ), [filteredServers.length, locale, servers.length]);
    const activeScopeLabel = activeServer ? activeServer.name : uiText.global;
    const orderedServerIds = useMemo(
        () => orderedServers.map((item) => String(item?.id || '').trim()).filter(Boolean),
        [orderedServers]
    );
    const bulkActionBusy = bulkTestAction.pendingIds.length > 0 || bulkDeleteAction.pendingIds.length > 0;
    const isServerBusy = (serverId) => (
        Boolean(loading[`test-${serverId}`])
        || Boolean(loading[`delete-${serverId}`])
        || bulkTestAction.isPending(serverId)
        || bulkDeleteAction.isPending(serverId)
    );

    const moveServer = async (serverId, direction) => {
        const visibleIds = filteredServers.map((item) => String(item.id || '').trim()).filter(Boolean);
        const currentVisibleIndex = visibleIds.indexOf(serverId);
        const swapWithId = visibleIds[currentVisibleIndex + direction];
        if (currentVisibleIndex === -1 || !swapWithId) return;

        const nextOrder = [...orderedServerIds];
        const currentIndex = nextOrder.indexOf(serverId);
        const swapIndex = nextOrder.indexOf(swapWithId);
        if (currentIndex === -1 || swapIndex === -1) return;
        [nextOrder[currentIndex], nextOrder[swapIndex]] = [nextOrder[swapIndex], nextOrder[currentIndex]];

        setLoading((prev) => ({ ...prev, serverOrder: true }));
        try {
            const res = await api.put('/system/servers/order', { serverIds: nextOrder });
            const persistedOrder = Array.isArray(res.data?.obj?.serverIds)
                ? res.data.obj.serverIds.map((item) => String(item || '').trim()).filter(Boolean)
                : nextOrder;
            setServerOrder(persistedOrder);
            toast.success('服务器顺序已更新');
        } catch (err) {
            toast.error(getErrorMessage(err, locale === 'en-US' ? 'Failed to update server order' : '更新服务器顺序失败', locale));
        }
        setLoading((prev) => ({ ...prev, serverOrder: false }));
    };

    const renderMobileServerCard = (server, index) => {
        const isSelected = selectedIds.has(server.id);
        const isActive = server.id === activeServerId;
        const telemetry = telemetryByServerId[String(server.id || '').trim()] || null;
        const rowBusy = isServerBusy(server.id);
        const credentialStatus = String(server.credentialStatus || 'configured');
        const serverGroup = server.group || t('comp.servers.ungrouped');
        const serverTags = Array.isArray(server.tags) ? server.tags.slice(0, 3) : [];
        const serverEnvironment = formatServerEnvironment(server.environment, locale);
        const testState = testResults[server.id];
        const testStateText = testState === 'success'
            ? t('comp.servers.testOk')
            : testState === 'error'
                ? t('comp.servers.testFail')
                : '未测试';
        const testStateBadge = testState === 'success'
            ? 'badge-success'
            : testState === 'error'
                ? 'badge-danger'
                : 'badge-neutral';
        const serverStateText = isActive ? '当前节点' : '已接入';
        const credentialBadge = credentialStatus === 'unreadable'
            ? { cls: 'badge-danger', text: t('comp.servers.credBroken') }
            : (credentialStatus === 'missing'
                ? { cls: 'badge-warning', text: t('comp.servers.credMissing') }
                : { cls: 'badge-success', text: t('comp.servers.credSaved') });

        return (
            <article
                key={server.id}
                className={`card servers-mobile-card${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}${rowBusy ? ' is-pending' : ''}`}
                onClick={() => {
                    if (!rowBusy) {
                        selectServer(server.id);
                    }
                }}
                aria-busy={rowBusy}
            >
                <div className="servers-mobile-card-top">
                    <label className="servers-mobile-check" onClick={(e) => e.stopPropagation()}>
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={isSelected}
                            disabled={rowBusy}
                            onChange={() => toggleSelect(server.id)}
                        />
                    </label>
                    <div className="servers-mobile-order">
                        <span className="servers-mobile-order-number">#{index + 1}</span>
                        <div className="servers-mobile-order-actions">
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-icon"
                                aria-label={`上移服务器 ${server.name}`}
                                title="上移"
                                disabled={index === 0 || loading.serverOrder || rowBusy}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    moveServer(server.id, -1);
                                }}
                            >
                                <HiOutlineArrowUp />
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-icon"
                                aria-label={`下移服务器 ${server.name}`}
                                title="下移"
                                disabled={index === filteredServers.length - 1 || loading.serverOrder || rowBusy}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    moveServer(server.id, 1);
                                }}
                            >
                                <HiOutlineArrowDown />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="servers-mobile-card-main">
                    <button
                        type="button"
                        className={`table-cell-link-button servers-mobile-title ${isActive ? 'text-glow' : ''}`}
                        title={server.name}
                        onClick={(e) => { e.stopPropagation(); navigate(`/servers/${server.id}`); }}
                    >
                        {server.name}
                    </button>
                </div>

                <div className="servers-mobile-badges">
                    <span className="badge badge-neutral">{t('comp.servers.groupPrefix')}: {serverGroup}</span>
                    {serverEnvironment ? <span className="badge badge-info">{serverEnvironment}</span> : null}
                    <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>{serverStateText}</span>
                    <span className={`badge ${testStateBadge}`}>{testStateText}</span>
                    <span className={`badge ${credentialBadge.cls}`}>{credentialBadge.text}</span>
                </div>

                <div className="servers-mobile-meta">
                    <div className="servers-mobile-meta-item">
                        <span className="servers-mobile-meta-label">账号</span>
                        <span className="servers-mobile-meta-value">{server.username}</span>
                    </div>
                </div>

                <ServerTelemetryCell
                    telemetry={telemetry}
                    loading={telemetryLoading}
                    locale={locale}
                />

                {serverTags.length > 0 ? (
                    <div className="servers-mobile-tags">
                        {serverTags.map((tag) => (
                            <span key={`${server.id}-${tag}`} className="badge badge-info">{tag}</span>
                        ))}
                    </div>
                ) : null}

                <div className="servers-mobile-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/servers/${server.id}`)} title="详情">
                        <HiOutlineEye /> 详情
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleTest(server.id)}
                        disabled={rowBusy}
                    >
                        {rowBusy ? <span className="spinner" /> : <HiOutlineSignal />}
                        {testState === 'success' ? t('comp.servers.testOk') : testState === 'error' ? t('comp.servers.testFail') : t('comp.servers.testConnect')}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(server)} aria-label={t('comp.common.edit')} disabled={rowBusy}>
                        <HiOutlinePencilSquare /> {t('comp.common.edit')}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(server.id)} aria-label={t('comp.common.delete')} disabled={rowBusy}>
                        <HiOutlineTrash /> {t('comp.common.delete')}
                    </button>
                </div>
            </article>
        );
    };

    return (
        <>
            <Header
                title={t('pages.servers.title')}
                eyebrow={t('pages.servers.eyebrow')}
            />
            <div className="page-content page-content--wide page-enter servers-page">
                <div className="servers-toolbar glass-panel mb-6">
                    {selectedIds.size > 0 ? (
                        <div className="flex gap-2 items-center animate-fade-in servers-selection-bar servers-selection-bar-takeover">
                            <span className="text-sm font-bold px-2 bulk-toolbar-count">已选 {selectedIds.size} 项</span>
                            <button className="btn btn-secondary btn-sm" onClick={handleBulkTest} disabled={bulkActionBusy}>
                                {bulkTestAction.pendingIds.length > 0 ? <span className="spinner" /> : <HiOutlineSignal />} 批量测试
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={bulkActionBusy}>
                                <HiOutlineTrash /> 批量删除
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())} disabled={bulkActionBusy}>
                                取消全选
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="servers-toolbar-summary" aria-label={uiText.current}>
                                <div className="servers-summary-pill">
                                    <span className="servers-summary-label">{uiText.total}</span>
                                    <span className="servers-summary-value">{servers.length}</span>
                                </div>
                                <div className="servers-summary-pill">
                                    <span className="servers-summary-label">{uiText.groups}</span>
                                    <span className="servers-summary-value">{groupOptions.length}</span>
                                </div>
                                <div className="servers-summary-pill servers-summary-pill--wide">
                                    <span className="servers-summary-label">{uiText.current}</span>
                                    <span className="servers-summary-value" title={activeScopeLabel}>{activeScopeLabel}</span>
                                </div>
                            </div>
                            <div className="servers-toolbar-actions">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => { setBatchResult(null); setShowBatchForm(true); }}
                                >
                                    <HiOutlinePlusCircle /> 批量添加
                                </button>
                                <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
                                    <HiOutlinePlusCircle /> 添加服务器
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm servers-select-all-btn" onClick={toggleSelectAll}>
                                    {allVisibleSelected ? t('comp.common.deselectAll') : t('comp.common.selectAll')}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="card mb-4 p-3 servers-filter-card">
                    <div className="flex items-center gap-3 servers-filter-bar">
                        <input
                            className="form-input servers-filter-search"
                            placeholder={uiText.searchPlaceholder}
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                        />
                        <select className="form-select servers-filter-select" value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
                            <option value="all">{uiText.allGroups}</option>
                            {groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}
                        </select>
                        <select className="form-select servers-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            <option value="all">{uiText.allStatus}</option>
                            <option value="online">{uiText.statusOnline}</option>
                            <option value="offline">{uiText.statusOffline}</option>
                            <option value="maintenance">{uiText.statusMaintenance}</option>
                            <option value="unknown">{uiText.statusUnknown}</option>
                        </select>
                        <select className="form-select servers-filter-select" value={credentialFilter} onChange={(e) => setCredentialFilter(e.target.value)}>
                            <option value="all">{uiText.allCredentials}</option>
                            <option value="configured">{uiText.credentialReady}</option>
                            <option value="missing">{uiText.credentialMissing}</option>
                            <option value="unreadable">{uiText.credentialBroken}</option>
                        </select>
                        <select className="form-select servers-filter-select" value={latencyFilter} onChange={(e) => setLatencyFilter(e.target.value)}>
                            <option value="all">{uiText.allLatency}</option>
                            <option value="slow">{uiText.latencySlow}</option>
                            <option value="critical">{uiText.latencyCritical}</option>
                        </select>
                        <div className="text-sm text-muted servers-filter-summary">
                            {uiText.filterSummary}
                        </div>
                    </div>
                </div>

                {/* Server List */}
                {servers.length === 0 ? (
                    <EmptyState
                        title="暂无服务器"
                        subtitle="点击下方按钮添加您的第一台 3x-ui 面板"
                        action={<button type="button" className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}><HiOutlinePlusCircle /> 新增服务器</button>}
                    />
                ) : filteredServers.length === 0 ? (
                    <EmptyState
                        title={uiText.noMatchTitle}
                        subtitle={uiText.noMatchSubtitle}
                        icon={<HiOutlineServerStack />}
                        size="compact"
                        surface
                    />
                ) : isCompactLayout ? (
                    <div className="servers-mobile-list">
                        {filteredServers.map((server, index) => renderMobileServerCard(server, index))}
                    </div>
                ) : (
                    <div className="table-container servers-table-shell">
                        <table className="table servers-table">
                            <thead>
                                <tr>
                                    <th className="table-cell-center servers-select-column">选择</th>
                                    <th className="table-cell-center servers-move-column">移动</th>
                                    <th className="table-cell-center servers-order-column">序号</th>
                                    <th className="servers-name-column">服务器</th>
                                    <th className="servers-telemetry-column">24h RTT</th>
                                    <th className="servers-group-column">分组 / 标签</th>
                                    <th className="servers-account-column">账号</th>
                                    <th className="servers-credential-column">凭据</th>
                                    <th className="servers-status-column">状态</th>
                                    <th className="table-cell-actions servers-actions-column">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredServers.map((server, index) => {
                            const isSelected = selectedIds.has(server.id);
                            const isActive = server.id === activeServerId;
                            const telemetry = telemetryByServerId[String(server.id || '').trim()] || null;
                            const rowBusy = isServerBusy(server.id);
                            const credentialStatus = String(server.credentialStatus || 'configured');
                            const serverGroup = server.group || t('comp.servers.ungrouped');
                            const serverTags = Array.isArray(server.tags) ? server.tags.slice(0, 3) : [];
                            const serverEnvironment = formatServerEnvironment(server.environment, locale);
                            const testState = testResults[server.id];
                            const testStateText = testState === 'success'
                                ? t('comp.servers.testOk')
                                : testState === 'error'
                                    ? t('comp.servers.testFail')
                                    : '未测试';
                            const testStateBadge = testState === 'success'
                                ? 'badge-success'
                                : testState === 'error'
                                    ? 'badge-danger'
                                    : 'badge-neutral';
                            const serverStateText = isActive ? '当前节点' : '已接入';
                            const credentialBadge = credentialStatus === 'unreadable'
                                ? { cls: 'badge-danger', text: t('comp.servers.credBroken') }
                                : (credentialStatus === 'missing'
                                    ? { cls: 'badge-warning', text: t('comp.servers.credMissing') }
                                    : { cls: 'badge-success', text: t('comp.servers.credSaved') });
                            return (
                                <tr
                                    key={server.id}
                                    className={`servers-table-row ${isSelected ? 'server-card-selected' : ''} ${isActive ? 'active' : ''}${rowBusy ? ' is-pending' : ''}`}
                                    onClick={() => {
                                        if (!rowBusy) {
                                            selectServer(server.id);
                                        }
                                    }}
                                    aria-busy={rowBusy}
                                >
                                    <td className="table-cell-center mobile-checkbox-cell" data-label="" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            className="checkbox"
                                            checked={isSelected}
                                            disabled={rowBusy}
                                            onChange={() => toggleSelect(server.id)}
                                        />
                                    </td>
                                    <td className="table-cell-center servers-move-cell" data-label="移动" onClick={(e) => e.stopPropagation()}>
                                        <div className="servers-order-actions">
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-xs btn-icon"
                                                aria-label={`上移服务器 ${server.name}`}
                                                title="上移"
                                                disabled={index === 0 || loading.serverOrder || rowBusy}
                                                onClick={() => moveServer(server.id, -1)}
                                            >
                                                <HiOutlineArrowUp />
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-xs btn-icon"
                                                aria-label={`下移服务器 ${server.name}`}
                                                title="下移"
                                                disabled={index === filteredServers.length - 1 || loading.serverOrder || rowBusy}
                                                onClick={() => moveServer(server.id, 1)}
                                            >
                                                <HiOutlineArrowDown />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="table-cell-center servers-order-cell" data-label="序号" onClick={(e) => e.stopPropagation()}>
                                        <div className="servers-order-stack">
                                            <span className="servers-order-number">{index + 1}</span>
                                        </div>
                                    </td>
                                    <td className="servers-name-cell" data-label="服务器">
                                        <div className="servers-name-stack">
                                            <div className="servers-name-head">
                                                <button
                                                    type="button"
                                                    className={`table-cell-link-button server-card-name-trigger ${isActive ? 'text-glow' : ''}`}
                                                    title={server.name}
                                                    onClick={(e) => { e.stopPropagation(); navigate(`/servers/${server.id}`); }}
                                                >
                                                    <span className="server-card-name">{server.name}</span>
                                                </button>
                                            </div>
                                            {isCompactLayout ? (
                                                <div className="servers-mobile-summary">
                                                    <div className="servers-mobile-summary-row">
                                                        <span className="badge badge-neutral">{t('comp.servers.groupPrefix')}: {serverGroup}</span>
                                                        {serverEnvironment ? <span className="badge badge-info">{serverEnvironment}</span> : null}
                                                        {serverTags.slice(0, 2).map((tag) => (
                                                            <span key={`${server.id}-mobile-${tag}`} className="badge badge-info">{tag}</span>
                                                        ))}
                                                    </div>
                                                    <div className="servers-mobile-summary-row servers-mobile-summary-row--account">
                                                        <span className="servers-mobile-account-name">{server.username}</span>
                                                        <span className={`badge ${credentialBadge.cls}`}>{credentialBadge.text}</span>
                                                    </div>
                                                    <div className="servers-mobile-summary-row">
                                                        <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>{serverStateText}</span>
                                                        <span className={`badge ${testStateBadge}`}>{testStateText}</span>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    </td>
                                    <td className="servers-telemetry-column" data-label="24h RTT">
                                        <ServerTelemetryCell
                                            telemetry={telemetry}
                                            loading={telemetryLoading}
                                            locale={locale}
                                        />
                                    </td>
                                    <td className="servers-tags-cell" data-label="分组 / 标签">
                                        <div className="flex flex-wrap gap-2 text-xs server-card-tags">
                                        <span className="badge badge-neutral">{t('comp.servers.groupPrefix')}: {serverGroup}</span>
                                        {serverTags.map((tag) => (
                                            <span key={`${server.id}-${tag}`} className="badge badge-info">{tag}</span>
                                        ))}
                                        </div>
                                    </td>
                                    <td className="servers-account-cell" data-label="账号">
                                        <div className="servers-account-stack">
                                            <span className="font-medium text-primary">{server.username}</span>
                                            {serverEnvironment ? <span className="text-xs text-muted">环境：{serverEnvironment}</span> : null}
                                        </div>
                                    </td>
                                    <td className="servers-credential-cell" data-label="凭据">
                                        <span className={`badge ${credentialBadge.cls}`}>{credentialBadge.text}</span>
                                    </td>
                                    <td className="servers-status-cell" data-label="状态">
                                        <div className="servers-status-stack">
                                            <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>{serverStateText}</span>
                                            <span className="text-xs text-muted servers-status-meta">
                                                {testStateText}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="table-cell-actions servers-actions-cell" data-label="操作" onClick={(e) => e.stopPropagation()}>
                                        <div className="table-row-actions servers-row-actions">
                                            <button className="btn btn-secondary btn-sm servers-row-action-main" onClick={() => navigate(`/servers/${server.id}`)} title="详情" disabled={rowBusy}>
                                            <HiOutlineEye /> 详情
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm servers-row-action-main"
                                            onClick={() => handleTest(server.id)}
                                            disabled={rowBusy}
                                        >
                                            {rowBusy ? <span className="spinner" /> : <HiOutlineSignal />}
                                            {testState === 'success' ? t('comp.servers.testOk') : testState === 'error' ? t('comp.servers.testFail') : t('comp.servers.testConnect')}
                                        </button>
                                            <button className="btn btn-ghost btn-sm btn-icon table-action-btn servers-row-action-icon" onClick={() => handleEdit(server)} title={t('comp.common.edit')} aria-label={t('comp.common.edit')} disabled={rowBusy}>
                                                <HiOutlinePencilSquare />
                                                <span className="servers-row-action-mobile-label">{t('comp.common.edit')}</span>
                                            </button>
                                            <button className="btn btn-danger btn-sm btn-icon table-action-btn servers-row-action-icon is-danger" onClick={() => handleDelete(server.id)} title={t('comp.common.delete')} aria-label={t('comp.common.delete')} disabled={rowBusy}>
                                                <HiOutlineTrash />
                                                <span className="servers-row-action-mobile-label">{t('comp.common.delete')}</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Add/Edit Modal */}
                {showForm && (
                    <ModalShell isOpen={showForm} onClose={resetForm}>
                        <div className="modal glass-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">{editingId ? t('comp.servers.editServer') : t('comp.servers.addServer')}</h3>
                                <button type="button" className="modal-close" onClick={resetForm}><HiOutlineXMark /></button>
                            </div>
                            <form onSubmit={handleSubmit}>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label className="form-label">服务器名称</label>
                                        <input className="form-input" placeholder="例如: 香港节点"
                                            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">面板完整地址 *</label>
                                        <input className="form-input" placeholder="例如: https://192.168.1.1:2053/Raw1UQnS7B23ivwIKI"
                                            value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
                                    </div>
                                    <div className="grid-auto-220">
                                        <div className="form-group">
                                            <label className="form-label">节点分组</label>
                                            <input
                                                className="form-input"
                                                placeholder="例如: 亚太 / 欧美"
                                                value={form.group}
                                                onChange={(e) => setForm({ ...form, group: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">标签 (逗号分隔)</label>
                                            <input
                                                className="form-input"
                                                placeholder="hk, core, vip"
                                                value={form.tags}
                                                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid-auto-220">
                                        <div className="form-group">
                                            <label className="form-label">用户名 *</label>
                                            <input className="form-input" placeholder="admin"
                                                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">密码 *</label>
                                            <input className="form-input" type="password" placeholder="密码"
                                                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editingId} />
                                        </div>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={resetForm}>{t('comp.common.cancel')}</button>
                                    <button type="submit" className="btn btn-primary" disabled={loading.submit}>
                                        {loading.submit ? <span className="spinner" /> : editingId ? t('comp.servers.saveBtn') : t('comp.servers.addBtn')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </ModalShell>
                )}

                {/* Batch Add Modal */}
                {showBatchForm && (
                    <ModalShell isOpen={showBatchForm} onClose={resetBatchForm}>
                        <div className="modal modal-lg glass-panel servers-batch-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">批量添加服务器</h3>
                                <button type="button" className="modal-close" onClick={resetBatchForm}><HiOutlineXMark /></button>
                            </div>
                            <form onSubmit={handleBatchSubmit}>
                                <div className="modal-body">
                                    <div className="server-batch-form-shell">
                                        <div className="grid-auto-220">
                                            <div className="form-group">
                                                <label className="form-label">公共用户名 *</label>
                                                <input
                                                    className="form-input"
                                                    placeholder="例如: root"
                                                    value={batchForm.username}
                                                    onChange={(e) => setBatchForm((prev) => ({ ...prev, username: e.target.value }))}
                                                    required
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">公共密码 *</label>
                                                <input
                                                    className="form-input"
                                                    type="password"
                                                    placeholder="密码"
                                                    value={batchForm.password}
                                                    onChange={(e) => setBatchForm((prev) => ({ ...prev, password: e.target.value }))}
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">默认分组</label>
                                            <input
                                                className="form-input"
                                                placeholder="例如: 亚太"
                                                value={batchForm.group}
                                                onChange={(e) => setBatchForm((prev) => ({ ...prev, group: e.target.value }))}
                                            />
                                        </div>

                                        <div className="form-group mt-3 mb-0">
                                            <label className="form-check-label w-fit">
                                                <input
                                                    type="checkbox"
                                                    checked={batchForm.testConnection}
                                                    onChange={(e) => setBatchForm((prev) => ({ ...prev, testConnection: e.target.checked }))}
                                                />
                                                <span>添加后自动测试连接</span>
                                            </label>
                                        </div>

                                        <div className="form-group mt-4">
                                            <label className="form-label">服务器清单 *</label>
                                            <textarea
                                                rows={9}
                                                placeholder={[
                                                    '# 每行一条，支持 1~3 列（逗号或 TAB 分隔）',
                                                    '# 1列: panelUrl',
                                                    '# 2列: name,panelUrl',
                                                    '# 3列(兼容旧格式): name,panelUrl,basePath',
                                                    'https://1.2.3.4:2053/Raw1',
                                                    '新加坡-02,https://sg2.example.com:2053/Raw2',
                                                    'https://hk1.example.com:2053',
                                                ].join('\n')}
                                                value={batchForm.entries}
                                                onChange={(e) => setBatchForm((prev) => ({ ...prev, entries: e.target.value }))}
                                                required
                                                className="form-textarea textarea-mono-sm"
                                            />
                                        </div>
                                    </div>

                                    {batchResult && (
                                        <div className="card mt-4 p-3">
                                            <div className="flex gap-8 items-center mb-12 flex-wrap">
                                                <span className="badge badge-neutral">总计 {batchResult.summary?.total || 0}</span>
                                                <span className="badge badge-success">成功 {batchResult.summary?.success || 0}</span>
                                                <span className="badge badge-danger">失败 {batchResult.summary?.failed || 0}</span>
                                            </div>
                                            <div className="table-container table-scroll table-scroll-sm">
                                                <table className="table servers-batch-result-table">
                                                    <thead>
                                                        <tr>
                                                            <th className="table-cell-right servers-batch-line-column">行号</th>
                                                            <th>名称</th>
                                                            <th>地址</th>
                                                            <th>Path</th>
                                                            <th className="table-cell-center servers-batch-status-column">状态</th>
                                                            <th>结果</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(batchResult.results || []).map((item) => (
                                                            <tr key={`batch-add-${item.line}-${item.url || item.name || ''}`}>
                                                                <td data-label="行号" className="table-cell-right cell-mono-right servers-batch-line-cell">{item.line || '-'}</td>
                                                                <td data-label="名称">{item.name || '-'}</td>
                                                                <td data-label="地址" className="table-word-220 cell-mono">
                                                                    {item.url || '-'}
                                                                </td>
                                                                <td data-label="Path" className="cell-mono">{item.basePath || '-'}</td>
                                                                <td data-label="状态" className="table-cell-center servers-batch-status-cell">
                                                                    <span className={`badge ${item.success ? 'badge-success' : 'badge-danger'}`}>
                                                                        {item.success ? t('comp.common.success') : t('comp.common.failed')}
                                                                    </span>
                                                                </td>
                                                                <td data-label="结果" className="table-word-280">
                                                                    {item.msg || '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={resetBatchForm}>{t('comp.common.cancel')}</button>
                                    <button type="submit" className="btn btn-primary" disabled={loading.batchSubmit}>
                                        {loading.batchSubmit ? <span className="spinner" /> : t('comp.servers.startBatchAdd')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </ModalShell>
                )}

                {credentialRepair.open && (
                    <ModalShell isOpen={credentialRepair.open} onClose={closeCredentialRepair}>
                        <div className="modal glass-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">修复节点登录凭据</h3>
                                <button type="button" className="modal-close" onClick={closeCredentialRepair}><HiOutlineXMark /></button>
                            </div>
                            <form onSubmit={handleCredentialRepairSubmit}>
                                <div className="modal-body">
                                    <div className="text-sm text-muted mb-3">
                                        节点: {repairTargetServer?.name || credentialRepair.serverId || '-'}
                                    </div>
                                    {credentialRepair.reason && (
                                        <div className="badge badge-danger mb-3 w-fit">{credentialRepair.reason}</div>
                                    )}
                                    <div className="form-group">
                                        <label className="form-label">3x-ui 用户名 *</label>
                                        <input
                                            className="form-input"
                                            value={credentialRepair.username}
                                            onChange={(e) => setCredentialRepair((prev) => ({ ...prev, username: e.target.value }))}
                                            placeholder="例如: root"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">3x-ui 密码 *</label>
                                        <input
                                            className="form-input"
                                            type="password"
                                            value={credentialRepair.password}
                                            onChange={(e) => setCredentialRepair((prev) => ({ ...prev, password: e.target.value }))}
                                            placeholder="输入并自动保存到节点"
                                            required
                                        />
                                    </div>
                                    {selectedIds.size > 1 && (
                                        <label className="form-check-label w-fit mt-2">
                                            <input
                                                type="checkbox"
                                                checked={credentialRepair.applyToSelected}
                                                onChange={(e) => setCredentialRepair((prev) => ({ ...prev, applyToSelected: e.target.checked }))}
                                            />
                                            <span>同时应用到已选中的 {selectedIds.size} 个节点</span>
                                        </label>
                                    )}
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={closeCredentialRepair}>{t('comp.common.cancel')}</button>
                                    <button type="submit" className="btn btn-primary" disabled={loading.repairCredentials}>
                                        {loading.repairCredentials ? <span className="spinner" /> : t('comp.servers.saveAndTest')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </ModalShell>
                )}
            </div>
        </>
    );
}
