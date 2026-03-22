import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
    Card, 
    Typography, 
    Button, 
    Input, 
    Select, 
    Space, 
    Row, 
    Col, 
    Tag, 
    Modal, 
    Empty, 
    Badge, 
    Table, 
    Tooltip,
    Form,
    Checkbox,
    Divider,
    Descriptions,
    Progress
} from 'antd';
import {
    HiOutlineArrowDown,
    HiOutlineArrowUp,
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineSignal,
    HiOutlineServerStack,
    HiOutlineEye,
    HiOutlineArrowPath
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import Header from '../Layout/Header.jsx';
import ServerTelemetryCell from './ServerTelemetryCell.jsx';
import { showAggregateToast } from '../UI/AggregateToast.jsx';
import { getErrorMessage } from '../../utils/format.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import api from '../../api/client.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import useServerTelemetry from '../../hooks/useServerTelemetry.js';
import useBulkAction from '../../hooks/useBulkAction.js';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea } = Input;

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
    const [form] = Form.useForm();
    const [batchForm] = Form.useForm();
    
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
        form.resetFields();
        setEditingId(null);
        setShowForm(false);
    };

    const resetBatchForm = () => {
        batchForm.resetFields();
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

    const handleSubmit = async (values) => {
        setLoading(prev => ({ ...prev, submit: true }));
        try {
            const payload = {
                ...values,
                tags: String(values.tags || '')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                group: String(values.group || '').trim(),
            };
            if (editingId) {
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

    const handleBatchSubmit = async (values) => {
        let items = [];
        try {
            items = parseBatchEntries(values.entries);
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
                    username: values.username,
                    password: values.password,
                    group: String(values.group || '').trim(),
                    environment: 'unknown',
                    health: 'unknown',
                },
                testConnection: values.testConnection,
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
        form.setFieldsValue({
            name: server.name,
            url: getPanelUrl(server),
            username: server.username,
            password: '',
            group: server.group || '',
            tags: Array.isArray(server.tags) ? server.tags.join(', ') : '',
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
            return { message: res.data?.msg || t('comp.servers.serverDeleted') };
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

    const handleCredentialRepairSubmit = async () => {
        const { username, password, applyToSelected } = credentialRepair;
        if (!username || !password) {
            toast.error(t('comp.servers.enterCredentials'));
            return;
        }

        const selectedTargetIds = applyToSelected ? Array.from(selectedIds) : [];
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

    const activeServer = useMemo(
        () => servers.find((item) => item.id === activeServerId) || null,
        [servers, activeServerId]
    );
    const activeScopeLabel = activeServer ? activeServer.name : uiText.global;
    
    const orderedServerIds = useMemo(
        () => orderedServers.map((item) => String(item?.id || '').trim()).filter(Boolean),
        [orderedServers]
    );

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

    const columns = [
        {
            title: '#',
            key: 'index',
            width: 50,
            render: (_, __, index) => index + 1,
        },
        {
            title: '移动',
            key: 'move',
            width: 80,
            render: (_, record, index) => (
                <Space size={0}>
                    <Button 
                        type="text" 
                        size="small" 
                        icon={<HiOutlineArrowUp />} 
                        disabled={index === 0 || loading.serverOrder || isServerBusy(record.id)}
                        onClick={(e) => { e.stopPropagation(); moveServer(record.id, -1); }}
                    />
                    <Button 
                        type="text" 
                        size="small" 
                        icon={<HiOutlineArrowDown />} 
                        disabled={index === filteredServers.length - 1 || loading.serverOrder || isServerBusy(record.id)}
                        onClick={(e) => { e.stopPropagation(); moveServer(record.id, 1); }}
                    />
                </Space>
            ),
        },
        {
            title: '服务器',
            key: 'server',
            render: (_, record) => {
                const isActive = record.id === activeServerId;
                return (
                    <Space direction="vertical" size={0}>
                        <Button 
                            type="link" 
                            style={{ padding: 0, height: 'auto', fontWeight: 600 }}
                            onClick={(e) => { e.stopPropagation(); navigate(`/servers/${record.id}`); }}
                        >
                            <span className={isActive ? 'text-glow' : ''}>{record.name}</span>
                        </Button>
                        <Text type="secondary" style={{ fontSize: '11px' }}>{record.url}</Text>
                    </Space>
                );
            }
        },
        {
            title: '24h RTT',
            key: 'telemetry',
            width: 200,
            render: (_, record) => (
                <ServerTelemetryCell
                    telemetry={telemetryByServerId[record.id]}
                    loading={telemetryLoading}
                    locale={locale}
                />
            )
        },
        {
            title: '分组 / 标签',
            key: 'tags',
            render: (_, record) => (
                <Space wrap size={[4, 4]}>
                    <Tag color="blue">{record.group || t('comp.servers.ungrouped')}</Tag>
                    {(record.tags || []).map(tag => <Tag key={tag}>{tag}</Tag>)}
                </Space>
            )
        },
        {
            title: '凭据',
            key: 'credentials',
            render: (_, record) => {
                const status = record.credentialStatus || 'configured';
                if (status === 'unreadable') return <Tag color="error">{t('comp.servers.credBroken')}</Tag>;
                if (status === 'missing') return <Tag color="warning">{t('comp.servers.credMissing')}</Tag>;
                return <Tag color="success">{t('comp.servers.credSaved')}</Tag>;
            }
        },
        {
            title: '状态',
            key: 'status',
            render: (_, record) => {
                const isActive = record.id === activeServerId;
                const testState = testResults[record.id];
                return (
                    <Space direction="vertical" size={0}>
                        <Badge status={isActive ? 'success' : 'default'} text={isActive ? '当前节点' : '已接入'} />
                        <Text type="secondary" style={{ fontSize: '11px' }}>
                            {testState === 'success' ? t('comp.servers.testOk') : testState === 'error' ? t('comp.servers.testFail') : '未测试'}
                        </Text>
                    </Space>
                );
            }
        },
        {
            title: '操作',
            key: 'actions',
            align: 'right',
            render: (_, record) => {
                const rowBusy = isServerBusy(record.id);
                const testState = testResults[record.id];
                return (
                    <Space onClick={e => e.stopPropagation()}>
                        <Tooltip title="测试连接">
                            <Button 
                                size="small" 
                                icon={rowBusy ? null : <HiOutlineSignal />} 
                                loading={rowBusy && loading[`test-${record.id}`]}
                                onClick={() => handleTest(record.id)}
                                disabled={rowBusy}
                            />
                        </Tooltip>
                        <Tooltip title={t('comp.common.edit')}>
                            <Button 
                                size="small" 
                                icon={<HiOutlinePencilSquare />} 
                                onClick={() => handleEdit(record)}
                                disabled={rowBusy}
                            />
                        </Tooltip>
                        <Tooltip title={t('comp.common.delete')}>
                            <Button 
                                size="small" 
                                danger 
                                icon={<HiOutlineTrash />} 
                                onClick={() => handleDelete(record.id)}
                                disabled={rowBusy}
                            />
                        </Tooltip>
                    </Space>
                );
            }
        }
    ];

    return (
        <>
            <Header
                title={t('pages.servers.title')}
                eyebrow={t('pages.servers.eyebrow')}
            />
            <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
                <Card style={{ marginBottom: 24 }}>
                    <Row gutter={[16, 16]} align="middle" justify="space-between">
                        <Col xs={24} lg={12}>
                            {selectedIds.size > 0 ? (
                                <Space>
                                    <Text strong>已选 {selectedIds.size} 项</Text>
                                    <Button type="primary" icon={<HiOutlineSignal />} onClick={handleBulkTest} loading={bulkTestAction.pendingIds.length > 0}>批量测试</Button>
                                    <Button danger icon={<HiOutlineTrash />} onClick={handleBulkDelete} loading={bulkDeleteAction.pendingIds.length > 0}>批量删除</Button>
                                    <Button onClick={() => setSelectedIds(new Set())}>取消</Button>
                                </Space>
                            ) : (
                                <Row gutter={24}>
                                    <Col>
                                        <Statistic title={uiText.total} value={servers.length} />
                                    </Col>
                                    <Col>
                                        <Statistic title={uiText.groups} value={groupOptions.length} />
                                    </Col>
                                    <Col>
                                        <Statistic title={uiText.current} value={activeScopeLabel} />
                                    </Col>
                                </Row>
                            )}
                        </Col>
                        <Col xs={24} lg={12} style={{ textAlign: isCompactLayout ? 'left' : 'right' }}>
                            <Space wrap>
                                <Button icon={<HiOutlinePlusCircle />} onClick={() => { setBatchResult(null); setShowBatchForm(true); }}>批量添加</Button>
                                <Button type="primary" icon={<HiOutlinePlusCircle />} onClick={() => { resetForm(); setShowForm(true); }}>添加服务器</Button>
                                <Button onClick={() => {
                                    if (selectedIds.size === filteredServers.length) setSelectedIds(new Set());
                                    else setSelectedIds(new Set(filteredServers.map(s => s.id)));
                                }}>
                                    {selectedIds.size === filteredServers.length ? t('comp.common.deselectAll') : t('comp.common.selectAll')}
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </Card>

                <Card size="small" style={{ marginBottom: 24 }}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={8} md={6}>
                            <Input 
                                placeholder={uiText.searchPlaceholder} 
                                value={searchKeyword} 
                                onChange={e => setSearchKeyword(e.target.value)} 
                                allowClear
                            />
                        </Col>
                        <Col xs={12} sm={4} md={3}>
                            <Select style={{ width: '100%' }} value={filterGroup} onChange={setFilterGroup}>
                                <Option value="all">{uiText.allGroups}</Option>
                                {groupOptions.map(g => <Option key={g} value={g}>{g}</Option>)}
                            </Select>
                        </Col>
                        <Col xs={12} sm={4} md={3}>
                            <Select style={{ width: '100%' }} value={statusFilter} onChange={setStatusFilter}>
                                <Option value="all">{uiText.allStatus}</Option>
                                <Option value="online">{uiText.statusOnline}</Option>
                                <Option value="offline">{uiText.statusOffline}</Option>
                                <Option value="maintenance">{uiText.statusMaintenance}</Option>
                                <Option value="unknown">{uiText.statusUnknown}</Option>
                            </Select>
                        </Col>
                        <Col xs={12} sm={4} md={3}>
                            <Select style={{ width: '100%' }} value={credentialFilter} onChange={setCredentialFilter}>
                                <Option value="all">{uiText.allCredentials}</Option>
                                <Option value="configured">{uiText.credentialReady}</Option>
                                <Option value="missing">{uiText.credentialMissing}</Option>
                                <Option value="unreadable">{uiText.credentialBroken}</Option>
                            </Select>
                        </Col>
                        <Col xs={12} sm={4} md={3}>
                            <Select style={{ width: '100%' }} value={latencyFilter} onChange={setLatencyFilter}>
                                <Option value="all">{uiText.allLatency}</Option>
                                <Option value="slow">{uiText.latencySlow}</Option>
                                <Option value="critical">{uiText.latencyCritical}</Option>
                            </Select>
                        </Col>
                        <Col xs={24} md={6} style={{ display: 'flex', alignItems: 'center', justifyContent: isCompactLayout ? 'flex-start' : 'flex-end' }}>
                            <Text type="secondary">{uiText.filterSummary}</Text>
                        </Col>
                    </Row>
                </Card>

                <Table 
                    columns={columns} 
                    dataSource={filteredServers} 
                    rowKey="id"
                    pagination={false}
                    rowSelection={{
                        selectedRowKeys: Array.from(selectedIds),
                        onChange: (keys) => setSelectedIds(new Set(keys)),
                    }}
                    onRow={(record) => ({
                        onClick: () => !isServerBusy(record.id) && selectServer(record.id),
                        style: { cursor: 'pointer' },
                        className: record.id === activeServerId ? 'ant-table-row-selected' : ''
                    })}
                    scroll={{ x: 1000 }}
                    locale={{
                        emptyText: servers.length === 0 ? (
                            <Empty
                                description="暂无服务器"
                                children={<Button type="primary" onClick={() => { resetForm(); setShowForm(true); }}>新增服务器</Button>}
                            />
                        ) : (
                            <Empty description={uiText.noMatchTitle} />
                        )
                    }}
                />

                <Modal
                    title={editingId ? t('comp.servers.editServer') : t('comp.servers.addServer')}
                    open={showForm}
                    onCancel={resetForm}
                    onOk={() => form.submit()}
                    confirmLoading={loading.submit}
                    width={600}
                >
                    <Form form={form} layout="vertical" onFinish={handleSubmit}>
                        <Row gutter={16}>
                            <Col span={24}>
                                <Form.Item name="name" label="服务器名称">
                                    <Input placeholder="例如: 香港节点" />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="url" label="面板完整地址" rules={[{ required: true }]}>
                                    <Input placeholder="例如: https://192.168.1.1:2053/Raw1UQnS7B23ivwIKI" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="group" label="节点分组">
                                    <Input placeholder="例如: 亚太 / 欧美" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="tags" label="标签 (逗号分隔)">
                                    <Input placeholder="hk, core, vip" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
                                    <Input placeholder="admin" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="password" label="密码" rules={[{ required: !editingId }]}>
                                    <Input.Password placeholder="密码" />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Modal>

                <Modal
                    title="批量添加服务器"
                    open={showBatchForm}
                    onCancel={resetBatchForm}
                    onOk={() => batchForm.submit()}
                    confirmLoading={loading.batchSubmit}
                    width={800}
                >
                    <Form form={batchForm} layout="vertical" onFinish={handleBatchSubmit} initialValues={{ testConnection: true }}>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="username" label="公共用户名" rules={[{ required: true }]}>
                                    <Input placeholder="例如: root" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="password" label="公共密码" rules={[{ required: true }]}>
                                    <Input.Password placeholder="密码" />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="group" label="默认分组">
                                    <Input placeholder="例如: 亚太" />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="testConnection" valuePropName="checked">
                                    <Checkbox>添加后自动测试连接</Checkbox>
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="entries" label="服务器清单" rules={[{ required: true }]}>
                                    <TextArea rows={8} placeholder={[
                                        '# 每行一条，支持 1~3 列（逗号或 TAB 分隔）',
                                        '# 1列: panelUrl',
                                        '# 2列: name,panelUrl',
                                        '# 3列(兼容旧格式): name,panelUrl,basePath',
                                        'https://1.2.3.4:2053/Raw1',
                                        '新加坡-02,https://sg2.example.com:2053/Raw2',
                                    ].join('\n')} />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>

                    {batchResult && (
                        <div style={{ marginTop: 24 }}>
                            <Divider>添加结果</Divider>
                            <Row gutter={16} style={{ marginBottom: 16 }}>
                                <Col><Badge status="default" text={`总计 ${batchResult.summary?.total || 0}`} /></Col>
                                <Col><Badge status="success" text={`成功 ${batchResult.summary?.success || 0}`} /></Col>
                                <Col><Badge status="error" text={`失败 ${batchResult.summary?.failed || 0}`} /></Col>
                            </Row>
                            <Table 
                                size="small"
                                dataSource={batchResult.results || []}
                                pagination={false}
                                rowKey={(record, index) => `${record.line}-${index}`}
                                columns={[
                                    { title: '行号', dataIndex: 'line', width: 60 },
                                    { title: '名称', dataIndex: 'name' },
                                    { title: '地址', dataIndex: 'url', ellipsis: true },
                                    { title: '状态', key: 'status', render: (_, r) => <Tag color={r.success ? 'success' : 'error'}>{r.success ? '成功' : '失败'}</Tag> },
                                    { title: '结果', dataIndex: 'msg' }
                                ]}
                            />
                        </div>
                    )}
                </Modal>

                <Modal
                    title="修复节点登录凭据"
                    open={credentialRepair.open}
                    onCancel={closeCredentialRepair}
                    onOk={handleCredentialRepairSubmit}
                    confirmLoading={loading.repairCredentials}
                >
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        {credentialRepair.reason && <Badge status="error" text={credentialRepair.reason} />}
                        <Text type="secondary">节点: {repairTargetServer?.name || credentialRepair.serverId || '-'}</Text>
                        
                        <div>
                            <Text strong block>3x-ui 用户名</Text>
                            <Input 
                                value={credentialRepair.username} 
                                onChange={e => setCredentialRepair(prev => ({ ...prev, username: e.target.value }))}
                                placeholder="例如: root"
                            />
                        </div>
                        <div>
                            <Text strong block>3x-ui 密码</Text>
                            <Input.Password 
                                value={credentialRepair.password} 
                                onChange={e => setCredentialRepair(prev => ({ ...prev, password: e.target.value }))}
                                placeholder="输入并自动保存到节点"
                            />
                        </div>
                        {selectedIds.size > 1 && (
                            <Checkbox 
                                checked={credentialRepair.applyToSelected}
                                onChange={e => setCredentialRepair(prev => ({ ...prev, applyToSelected: e.target.checked }))}
                            >
                                同时应用到已选中的 {selectedIds.size} 个节点
                            </Checkbox>
                        )}
                    </Space>
                </Modal>
            </div>
        </>
    );
}

function Statistic({ title, value }) {
    return (
        <div>
            <Text type="secondary" style={{ fontSize: '12px' }}>{title}</Text>
            <div style={{ fontSize: '18px', fontWeight: 600 }}>{value}</div>
        </div>
    );
}
