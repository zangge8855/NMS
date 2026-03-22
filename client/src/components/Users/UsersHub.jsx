import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { copyToClipboard, formatBytes, formatDateOnly } from '../../utils/format.js';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';
import { buildSubscriptionProfileBundle } from '../../utils/subscriptionProfiles.js';
import { normalizeEmail } from '../../utils/protocol.js';
import { bytesToGigabytesInput, gigabytesInputToBytes, normalizeLimitIp } from '../../utils/entitlements.js';
import { generateSecurePassword } from '../../utils/crypto.js';
import { mergeInboundClientStats, resolveClientUsed, safeNumber } from '../../utils/inboundClients.js';
import { buildOnlineMatchMap, countClientOnlineSessions } from '../../utils/clientPresence.js';
import { fetchManagedUsers, invalidateManagedUsersCache } from '../../utils/managedUsersCache.js';
import { fetchServerPanelData, invalidateServerPanelDataCache } from '../../utils/serverPanelDataCache.js';
import SubscriptionClientLinks from '../Subscriptions/SubscriptionClientLinks.jsx';
import toast from 'react-hot-toast';
import {
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineArrowPath,
    HiOutlineChevronDown,
    HiOutlineChevronUp,
    HiOutlineMagnifyingGlass,
    HiOutlineClipboard,
    HiOutlineCheck,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineXMark,
    HiOutlineUserPlus,
    HiOutlineNoSymbol,
    HiOutlinePlayCircle,
    HiOutlineArrowDownTray,
} from 'react-icons/hi2';
import useMediaQuery from '../../hooks/useMediaQuery.js';

import {
  ConfigProvider, theme, Card, Button, Table, Modal, Form, Input, Select, Switch, Space, Tag, Typography, Row, Col, Alert, Tooltip, Checkbox, Badge, Spin
} from 'antd';
const { Title, Text } = Typography;
const { Option } = Select;

const PROTOCOL_OPTIONS = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
];

function buildProvisionSuccessMessage(deployment, locale = 'zh-CN') {
    const dep = deployment && typeof deployment === 'object' ? deployment : {};
    const isEnglish = locale === 'en-US';
    if (Number(dep.failed || 0) > 0) {
        return isEnglish
            ? `Subscription enabled, but node sync partially failed (created ${dep.created || 0} / updated ${dep.updated || 0} / skipped ${dep.skipped || 0} / failed ${dep.failed || 0})`
            : `订阅已开通，节点下发部分失败（创建 ${dep.created || 0} / 更新 ${dep.updated || 0} / 跳过 ${dep.skipped || 0} / 失败 ${dep.failed || 0}）`;
    }
    if (Number(dep.created || 0) > 0 || Number(dep.updated || 0) > 0) {
        return isEnglish
            ? `Subscription enabled and synced ${Number(dep.created || 0) + Number(dep.updated || 0)} clients to nodes`
            : `订阅已开通，已同步 ${Number(dep.created || 0) + Number(dep.updated || 0)} 个客户端到节点`;
    }
    return isEnglish ? 'Subscription enabled and links are ready' : '订阅已开通，链接已生成';
}

function toLocalDateTimeString(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getUserStatus(user, clientCount) {
    if (!user.enabled && user.emailVerified !== true && clientCount === 0) {
        return { key: 'pending', label: '待审核', badge: 'warning' };
    }
    if (!user.enabled) return { key: 'disabled', label: '已停用', badge: 'error' };
    if (clientCount > 0) return { key: 'active', label: '已开通', badge: 'success' };
    return { key: 'enabled', label: '已启用', badge: 'processing' };
}

function formatExpiryLabel(expiryValues, locale = 'zh-CN') {
    if (!expiryValues || expiryValues.length === 0) return '永久';
    const earliest = Math.min(...expiryValues);
    return formatDateOnly(earliest, locale);
}

function getOnlineStatus(clientCount, sessions) {
    if (Number(sessions || 0) > 0) {
        return {
            key: 'online',
            label: '在线',
            badge: 'success',
            detail: `${sessions} 会话`,
        };
    }
    if (Number(clientCount || 0) > 0) {
        return {
            key: 'offline',
            label: '离线',
            badge: 'default',
            detail: '',
        };
    }
    return {
        key: 'unassigned',
        label: '未接入',
        badge: 'default',
        detail: '',
    };
}

function getSyncingBadgeCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return { status: 'Syncing', detail: 'Refreshing node stats', summary: 'Refreshing node stats...' };
    }
    return { status: '同步中', detail: '正在刷新节点统计', summary: '节点统计同步中...' };
}

function createEmptyUserClientData() {
    return { count: 0, totalUsed: 0, totalUp: 0, totalDown: 0, expiryValues: [], onlineSessions: 0 };
}

function resolveTrackedUserEmails(user) {
    return Array.from(new Set([user?.subscriptionEmail, user?.email].map((value) => normalizeEmail(value)).filter(Boolean)));
}

function mergeUserClientDataRecords(records = []) {
    const merged = createEmptyUserClientData();
    const expiryValues = [];
    records.forEach((record) => {
        if (!record || typeof record !== 'object') return;
        merged.count += Number(record.count || 0);
        merged.totalUsed += Number(record.totalUsed || 0);
        merged.totalUp += Number(record.totalUp || 0);
        merged.totalDown += Number(record.totalDown || 0);
        merged.onlineSessions += Number(record.onlineSessions || 0);
        if (Array.isArray(record.expiryValues)) {
            expiryValues.push(...record.expiryValues.map((value) => Number(value || 0)).filter((value) => value > 0));
        }
    });
    merged.expiryValues = Array.from(new Set(expiryValues)).sort((left, right) => left - right);
    return merged;
}

function resolveUserClientData(user, clientsMap, onlineMap) {
    const emails = resolveTrackedUserEmails(user);
    const matchedClientData = emails.map((email) => clientsMap.get(email)).filter(Boolean);
    const mergedClientData = mergeUserClientDataRecords(matchedClientData);
    if (mergedClientData.onlineSessions === 0) {
        mergedClientData.onlineSessions = emails.reduce((total, email) => total + Number(onlineMap.get(email) || 0), 0);
    }
    return mergedClientData;
}

function compareUsersFallback(a, b) {
    const order = { pending: 0, enabled: 1, active: 2, disabled: 3 };
    const aOrder = order[a.status.key] ?? 4;
    const bOrder = order[b.status.key] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

function getUsersHubCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            provisionAction: 'Enable Subscription',
            viewSubscription: 'View Subscription',
            unsetEmail: 'No email set',
            postCreateNoEmail: 'User created, but no email is set so provisioning cannot start yet',
            provisionLoadFailed: 'Subscription enabled, but subscription details failed to load. Refresh and check later.',
            createProvisionToggle: 'Open provisioning right after create',
            provisionModalTitle: 'Enable Subscription',
            passwordCopied: 'Password copied to clipboard',
            userListLoadFailedTitle: 'Failed to load user list',
            noMatchUsersTitle: 'No matching users',
            noMatchUsersSubtitle: 'Try a different search term.',
            noUsersTitle: 'No registered users',
            noUsersSubtitle: 'Add a user from the action bar above.',
            degradedDataTitle: 'Node data partially unavailable',
            degradedDataIntro: 'The user list is available, but some node data failed to load. Traffic and online status may be incomplete.',
        };
    }
    return {
        provisionAction: '开通订阅',
        viewSubscription: '查看订阅',
        unsetEmail: '未设置邮箱',
        postCreateNoEmail: '用户已创建，但未设置邮箱，无法立即分配节点',
        provisionLoadFailed: '订阅已开通，但订阅详情加载失败，可稍后刷新查看',
        createProvisionToggle: '创建后立即进入"开通订阅/分配节点"',
        provisionModalTitle: '开通订阅',
        passwordCopied: '密码已复制到剪贴板',
        userListLoadFailedTitle: '用户列表加载失败',
        noMatchUsersTitle: '未找到匹配用户',
        noMatchUsersSubtitle: '请尝试其他搜索词',
        noUsersTitle: '暂无注册用户',
        noUsersSubtitle: '点击上方按钮添加用户',
        degradedDataTitle: '节点数据已降级显示',
        degradedDataIntro: '基础用户列表已加载，但部分节点的入站配置或在线状态读取失败，流量和在线统计可能不完整。',
    };
}

function summarizePartialErrors(partialErrors, locale = 'zh-CN') {
    if (!Array.isArray(partialErrors) || partialErrors.length === 0) return '';
    const inboundsServers = partialErrors.filter((item) => item.kind === 'inbounds').map((item) => item.serverName);
    const presenceServers = partialErrors.filter((item) => item.kind === 'presence').map((item) => item.serverName);
    if (locale === 'en-US') {
        const parts = [];
        if (inboundsServers.length > 0) parts.push(`inbounds unavailable on ${inboundsServers.join(', ')}`);
        if (presenceServers.length > 0) parts.push(`online presence unavailable on ${presenceServers.join(', ')}`);
        return parts.join('; ');
    }
    const parts = [];
    if (inboundsServers.length > 0) parts.push(`入站配置失败: ${inboundsServers.join('、')}`);
    if (presenceServers.length > 0) parts.push(`在线状态失败: ${presenceServers.join('、')}`);
    return parts.join('；');
}

export default function UsersHub() {
    const { servers } = useServer();
    const confirmAction = useConfirm();
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const copy = useMemo(() => getUsersHubCopy(locale), [locale]);
    const syncingCopy = useMemo(() => getSyncingBadgeCopy(locale), [locale]);
    const requestIdRef = useRef(0);
    const serverInventoryKey = useMemo(() => servers.map((server) => String(server?.id || '')).filter(Boolean).join('|'), [servers]);

    const [users, setUsers] = useState([]);
    const [clientsMap, setClientsMap] = useState(new Map());
    const [onlineMap, setOnlineMap] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsReady, setStatsReady] = useState(false);
    const [primaryError, setPrimaryError] = useState('');
    const [partialErrors, setPartialErrors] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    // Form instances
    const [provisionForm] = Form.useForm();
    const [editForm] = Form.useForm();
    const [createForm] = Form.useForm();

    // Provision modal
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [provisionTargetUser, setProvisionTargetUser] = useState(null);
    const [provisionInitLoading, setProvisionInitLoading] = useState(false);
    const [provisionSaving, setProvisionSaving] = useState(false);
    const [provisionResult, setProvisionResult] = useState(null);
    const [provisionSelectedInboundKeys, setProvisionSelectedInboundKeys] = useState(new Set());
    const [inboundExpiries, setInboundExpiries] = useState([]);
    const [allInbounds, setAllInbounds] = useState([]);

    // Edit user modal
    const [editOpen, setEditOpen] = useState(false);
    const [editUser, setEditUser] = useState(null);
    const [editHasClients, setEditHasClients] = useState(false);
    const [editSaving, setEditSaving] = useState(false);
    const [editPolicyLoading, setEditPolicyLoading] = useState(false);
    const [editSubscriptionFollowLogin, setEditSubscriptionFollowLogin] = useState(false);

    // Create user modal
    const [createOpen, setCreateOpen] = useState(false);
    const [createSaving, setCreateSaving] = useState(false);

    const hydrateNodeStats = async (requestId, options = {}) => {
        const forceStats = options.forceStats === true;
        setStatsLoading(true);
        setStatsReady(false);
        setPartialErrors([]);

        if (servers.length === 0) {
            if (requestId !== requestIdRef.current) return;
            setClientsMap(new Map());
            setOnlineMap(new Map());
            setInboundExpiries([]);
            setAllInbounds([]);
            setStatsLoading(false);
            setStatsReady(true);
            return;
        }

        try {
            const serverResults = await fetchServerPanelData(api, servers, { force: forceStats, includeOnlines: true });
            if (requestId !== requestIdRef.current) return;

            const nextPartialErrors = [];
            const emailMap = new Map();
            const onlineEmailMap = new Map();
            const expiryRef = [];
            const inboundList = [];

            serverResults.forEach((result) => {
                const server = result.server;
                const inbounds = Array.isArray(result?.inbounds) ? result.inbounds : [];
                const onlines = Array.isArray(result?.onlines) ? result.onlines : [];
                const onlineMatchMap = buildOnlineMatchMap(onlines);

                if (result?.inboundsError) nextPartialErrors.push({ kind: 'inbounds', serverId: server.id, serverName: server.name, message: result.inboundsError?.response?.data?.msg || result.inboundsError?.message || 'inbounds unavailable' });
                if (result?.onlinesError) nextPartialErrors.push({ kind: 'presence', serverId: server.id, serverName: server.name, message: result.onlinesError?.response?.data?.msg || result.onlinesError?.message || 'presence unavailable' });

                onlines.forEach((entry) => {
                    const email = normalizeEmail(entry?.email || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry?.remark || entry);
                    if (email) onlineEmailMap.set(email, (onlineEmailMap.get(email) || 0) + 1);
                });

                inbounds.forEach((ib) => {
                    const protocol = String(ib.protocol || '').toLowerCase();
                    if (!['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) return;
                    if (ib.enable === false) return;

                    const ibClients = mergeInboundClientStats(ib);
                    const ibKey = `${server.id}:${ib.id}`;
                    const ibExpiries = ibClients.map((cl) => Number(cl.expiryTime || 0)).filter((value) => value > 0);
                    let representativeExpiry = 0;
                    if (ibExpiries.length > 0) {
                        ibExpiries.sort((a, b) => a - b);
                        representativeExpiry = ibExpiries[Math.floor(ibExpiries.length / 2)];
                        expiryRef.push({ serverName: server.name, inboundRemark: ib.remark || protocol, expiryTime: representativeExpiry, clientCount: ibClients.length });
                    }

                    inboundList.push({ key: ibKey, serverId: server.id, serverName: server.name, inboundId: ib.id, remark: ib.remark || '', protocol, port: ib.port, clientCount: ibClients.length, expiryTime: representativeExpiry });

                    ibClients.forEach((cl) => {
                        const email = normalizeEmail(cl.email);
                        if (!email) return;
                        if (!emailMap.has(email)) emailMap.set(email, { count: 0, totalUsed: 0, totalUp: 0, totalDown: 0, expiryValues: [], onlineSessions: 0 });
                        const entry = emailMap.get(email);
                        const onlineSessions = countClientOnlineSessions(cl, protocol, onlineMatchMap);
                        entry.count += 1;
                        entry.totalUsed += resolveClientUsed(cl);
                        entry.totalUp += safeNumber(cl?.up);
                        entry.totalDown += safeNumber(cl?.down);
                        entry.onlineSessions += onlineSessions;
                        if (Number(cl.expiryTime || 0) > 0) entry.expiryValues.push(Number(cl.expiryTime));
                    });
                });
            });

            setClientsMap(emailMap);
            setOnlineMap(onlineEmailMap);
            setInboundExpiries(expiryRef);
            setAllInbounds(inboundList);
            setPartialErrors(nextPartialErrors);
        } catch (err) {
            if (requestId !== requestIdRef.current) return;
            console.error('Failed to hydrate users node stats', err);
            setClientsMap(new Map());
            setOnlineMap(new Map());
            setInboundExpiries([]);
            setAllInbounds([]);
            setPartialErrors([]);
        }

        if (requestId !== requestIdRef.current) return;
        setStatsLoading(false);
        setStatsReady(true);
    };

    const fetchData = async (options = {}) => {
        const forceUsers = options.forceUsers === true;
        const forceStats = options.forceStats === true || forceUsers;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        setLoading(true);
        setPrimaryError('');
        setStatsLoading(true);
        setStatsReady(false);
        setPartialErrors([]);
        try {
            const userList = await fetchManagedUsers(api, { force: forceUsers });
            if (requestId !== requestIdRef.current) return;
            setUsers(userList);
            setSelectedIds((previous) => new Set(Array.from(previous).filter((id) => userList.some((user) => user.id === id))));
            setLoading(false);
            hydrateNodeStats(requestId, { forceStats });
        } catch (err) {
            if (requestId !== requestIdRef.current) return;
            console.error('Failed to fetch users data', err);
            const message = err?.response?.data?.msg || err?.message || t('comp.users.loadFailed');
            setPrimaryError(message);
            setUsers([]);
            setSelectedIds(new Set());
            setClientsMap(new Map());
            setOnlineMap(new Map());
            setInboundExpiries([]);
            setAllInbounds([]);
            setStatsLoading(false);
            setStatsReady(false);
            setLoading(false);
            toast.error(t('comp.users.loadFailed'));
        }
    };

    useEffect(() => { fetchData(); }, [serverInventoryKey]);

    const allOrderedUsers = useMemo(() => {
        return users.map((user) => {
            const clientData = resolveUserClientData(user, clientsMap, onlineMap);
            const onlineSessions = statsReady ? Number(clientData.onlineSessions || 0) : 0;
            const status = statsReady ? getUserStatus(user, clientData.count) : { key: 'syncing', label: syncingCopy.status, badge: 'default' };
            const onlineStatus = statsReady ? getOnlineStatus(clientData.count, onlineSessions) : { key: 'syncing', label: syncingCopy.status, badge: 'default', detail: syncingCopy.detail };
            return { ...user, clientData, status, onlineSessions, onlineStatus, statsPending: !statsReady };
        }).sort(compareUsersFallback);
    }, [users, clientsMap, onlineMap, statsReady, syncingCopy.detail, syncingCopy.status]);

    const filteredUsers = useMemo(() => {
        const search = String(deferredSearchTerm || '').trim().toLowerCase();
        return allOrderedUsers.filter((user) => {
            if (statusFilter !== 'all' && user.status.key !== statusFilter) return false;
            if (!search) return true;
            return [user.username, user.email, user.subscriptionEmail, user.status.label, user.onlineStatus.label].some((v) => String(v || '').toLowerCase().includes(search));
        });
    }, [allOrderedUsers, deferredSearchTerm, statusFilter]);

    const handleSetEnabled = async (user, enabled) => {
        const action = enabled ? t('comp.common.enable') : t('comp.common.disable');
        const ok = await confirmAction({
            title: `${action}${t('comp.users.user')}`,
            message: `确定${action}用户 ${user.username} 吗？`,
            details: enabled ? undefined : t('comp.users.disableDetails'),
            confirmText: `确认${action}`,
            tone: enabled ? 'success' : 'danger',
        });
        if (!ok) return;

        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(user.id)}/set-enabled`, { enabled });
            if (res.data?.success) {
                const message = res.data?.msg || `用户 ${user.username} 已${action}`;
                if (res.data?.obj?.partialFailure) toast.error(message);
                else toast.success(message);
                invalidateServerPanelDataCache();
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } else toast.error(res.data?.msg || t('comp.common.operationFailed'));
        } catch (err) { toast.error(err.response?.data?.msg || err.message || t('comp.common.operationFailed')); }
    };

    const handleDelete = async (user) => {
        const ok = await confirmAction({
            title: t('comp.users.deleteUser'),
            message: `确定删除用户 ${user.username} 吗？`,
            details: t('comp.users.deleteDetails'),
            confirmText: t('comp.common.confirmDelete'),
            tone: 'danger',
        });
        if (!ok) return;

        try {
            const res = await api.delete(`/auth/users/${encodeURIComponent(user.id)}`);
            if (res.data?.success) {
                toast.success(`用户 ${user.username} 已删除`);
                invalidateServerPanelDataCache();
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } else toast.error(res.data?.msg || t('comp.common.deleteFailed'));
        } catch (err) { toast.error(err.response?.data?.msg || err.message || t('comp.common.deleteFailed')); }
    };

    const [bulkToggleEnable, setBulkToggleEnable] = useState(true);

    useEffect(() => {
        if (selectedIds.size > 0) {
            const firstId = Array.from(selectedIds)[0];
            const firstUser = users.find(u => u.id === firstId);
            setBulkToggleEnable(!(firstUser?.status?.key === 'enabled' || firstUser?.status?.key === 'active'));
        }
    }, [selectedIds, users]);

    const handleBulkSetEnabled = async (enabled) => {
        if (selectedIds.size === 0) return;
        setBulkLoading(true);
        try {
            const res = await api.post('/auth/users/bulk-set-enabled', { userIds: Array.from(selectedIds), enabled });
            if (res.data?.success) {
                const resultItems = Array.isArray(res.data?.obj) ? res.data.obj : (Array.isArray(res.data?.obj?.items) ? res.data.obj.items : []);
                const hasPartialFailure = resultItems.some((item) => item?.partialFailure === true);
                if (hasPartialFailure) toast.error(res.data.msg);
                else toast.success(res.data.msg);
                setSelectedIds(new Set());
                invalidateServerPanelDataCache();
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } else toast.error(res.data?.msg || t('comp.common.operationFailed'));
        } catch (err) { toast.error(err.response?.data?.msg || t('comp.users.batchFailed')); }
        setBulkLoading(false);
    };

    const handleExportCSV = async () => {
        try {
            const res = await api.get('/auth/users/export', { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(t('comp.users.csvExported'));
        } catch { toast.error(t('comp.users.exportFailed')); }
    };

    const rowSelection = {
        selectedRowKeys: Array.from(selectedIds),
        onChange: (newSelectedRowKeys) => setSelectedIds(new Set(newSelectedRowKeys)),
    };

    const columns = [
        {
            title: '账号',
            dataIndex: 'username',
            render: (text, record) => {
                const displayEmail = record.email || record.subscriptionEmail || '';
                return (
                    <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/clients/${record.id}`)}>
                        <div style={{ fontWeight: 500, color: '#177ddc' }}>{text}</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{displayEmail || copy.unsetEmail}</Text>
                    </div>
                );
            }
        },
        {
            title: '状态',
            dataIndex: 'status',
            align: 'center',
            render: (status) => <Badge status={status.badge} text={status.label} />
        },
        {
            title: '在线状态',
            dataIndex: 'onlineStatus',
            align: 'center',
            render: (onlineStatus) => (
                <Space direction="vertical" size={0} align="center">
                    <Badge status={onlineStatus.badge} text={onlineStatus.label} />
                    {onlineStatus.detail && <Text type="secondary" style={{ fontSize: 12 }}>{onlineStatus.detail}</Text>}
                </Space>
            )
        },
        {
            title: '节点数',
            align: 'center',
            render: (_, record) => record.statsPending ? <Text type="secondary" style={{ fontSize: 12 }}>{syncingCopy.status}</Text> : (record.clientData.count || '-')
        },
        {
            title: '已用流量',
            align: 'right',
            render: (_, record) => {
                if (record.statsPending) return <Text type="secondary" style={{ fontSize: 12 }}>{syncingCopy.detail}</Text>;
                if (record.clientData.totalUsed) {
                    return (
                        <div style={{ fontSize: 12 }}>
                            <div style={{ color: '#52c41a' }}>↑{formatBytes(record.clientData.totalUp)}</div>
                            <div style={{ color: '#1677ff' }}>↓{formatBytes(record.clientData.totalDown)}</div>
                        </div>
                    );
                }
                return '-';
            }
        },
        {
            title: '到期时间',
            align: 'center',
            render: (_, record) => {
                if (record.statsPending) return <Text type="secondary" style={{ fontSize: 12 }}>{syncingCopy.detail}</Text>;
                return <Text code>{record.clientData.count > 0 ? formatExpiryLabel(record.clientData.expiryValues, locale) : '未开通'}</Text>;
            }
        },
        {
            title: '操作',
            align: 'center',
            render: (_, record) => (
                <Space wrap>
                    <Button size="small" icon={<HiOutlineEye />} onClick={() => navigate(`/clients/${record.id}`)} title="详情" />
                    {record.status.key === 'pending' && (
                        <>
                            <Button size="small" type="primary" style={{ backgroundColor: '#52c41a' }} icon={<HiOutlineCheck />} onClick={() => handleSetEnabled(record, true)} />
                            <Button size="small" danger icon={<HiOutlineTrash />} onClick={() => handleDelete(record)} />
                        </>
                    )}
                    {record.status.key === 'enabled' && (
                        <>
                            <Button size="small" type="primary" icon={<HiOutlinePlusCircle />} onClick={() => openProvisionModal(record)} />
                            <Button size="small" icon={<HiOutlinePencilSquare />} onClick={() => openEditModal(record)} />
                            <Button size="small" danger icon={<HiOutlineTrash />} onClick={() => handleDelete(record)} />
                        </>
                    )}
                    {(record.status.key === 'active' || record.status.key === 'disabled') && (
                        <>
                            <Button size="small" icon={<HiOutlinePencilSquare />} onClick={() => openEditModal(record)} />
                            <Button size="small" danger icon={<HiOutlineTrash />} onClick={() => handleDelete(record)} />
                        </>
                    )}
                </Space>
            )
        }
    ];

    // --- Provision Modal Logic ---
    const openProvisionModal = async (user) => {
        const suggestedEmail = normalizeEmail(user?.subscriptionEmail || user?.email);
        if (!suggestedEmail) {
            toast.error(t('comp.users.noEmailForSubscription'));
            return;
        }
        setProvisionTargetUser(user);
        setProvisionResult(null);
        setProvisionInitLoading(true);
        setProvisionSelectedInboundKeys(new Set(allInbounds.map((ib) => ib.key)));

        let representativeExpiry = '';
        if (inboundExpiries.length > 0) {
            const futureExpiries = inboundExpiries.map((e) => e.expiryTime).filter((t) => t > Date.now());
            if (futureExpiries.length > 0) {
                futureExpiries.sort((a, b) => a - b);
                representativeExpiry = toLocalDateTimeString(futureExpiries[Math.floor(futureExpiries.length / 2)]);
            }
        }

        provisionForm.setFieldsValue({
            email: suggestedEmail,
            expiryDate: representativeExpiry,
            limitIp: '0',
            trafficLimitGb: '0'
        });

        setProvisionOpen(true);
        try {
            const policyRes = await api.get(`/user-policy/${encodeURIComponent(suggestedEmail)}`);
            const policy = policyRes.data?.obj || {};
            provisionForm.setFieldsValue({
                limitIp: String(normalizeLimitIp(policy.limitIp)),
                trafficLimitGb: bytesToGigabytesInput(policy.trafficLimitBytes)
            });
        } catch {}
        setProvisionInitLoading(false);
    };

    const submitProvision = async (values) => {
        if (!provisionTargetUser?.id) return;
        const provisionNormalizedEmail = normalizeEmail(values.email);
        if (!provisionNormalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(provisionNormalizedEmail)) {
            toast.error(t('comp.users.subEmailInvalid'));
            return;
        }
        if (provisionSelectedInboundKeys.size === 0) {
            toast.error(t('comp.users.selectAtLeastOneInbound'));
            return;
        }
        setProvisionSaving(true);
        try {
            const expiryTime = values.expiryDate ? new Date(values.expiryDate).getTime() : 0;
            const res = await api.post(`/auth/users/${encodeURIComponent(provisionTargetUser.id)}/provision-subscription`, {
                subscriptionEmail: provisionNormalizedEmail,
                serverScopeMode: 'all',
                protocolScopeMode: 'all',
                allowedServerIds: [],
                allowedProtocols: [],
                allowedInboundKeys: Array.from(provisionSelectedInboundKeys),
                expiryTime,
                limitIp: normalizeLimitIp(values.limitIp),
                trafficLimitBytes: gigabytesInputToBytes(values.trafficLimitGb),
            });
            if (!res.data?.success) {
                toast.error(res.data?.msg || t('comp.users.provisionFailed'));
                setProvisionSaving(false);
                return;
            }
            const dep = res.data?.obj?.deployment || null;
            const successMessage = buildProvisionSuccessMessage(dep, locale);
            toast.success(successMessage);
            const boundEmail = normalizeEmail(res.data?.obj?.subscription?.email || provisionNormalizedEmail);
            let subscriptionPayload = null;
            try {
                const subRes = await api.get(`/subscriptions/${encodeURIComponent(boundEmail)}`);
                subscriptionPayload = subRes.data?.obj || null;
            } catch { toast(copy.provisionLoadFailed, { icon: '⚠️' }); }

            setProvisionResult({
                email: boundEmail,
                deployment: dep,
                successMessage,
                bundle: buildSubscriptionProfileBundle(subscriptionPayload || {}, locale),
            });
            invalidateServerPanelDataCache();
            invalidateManagedUsersCache();
            await fetchData({ forceUsers: true });
        } catch (err) { toast.error(err.response?.data?.msg || err.message || t('comp.users.provisionFailed')); }
        setProvisionSaving(false);
    };

    // --- Edit Modal Logic ---
    const openEditModal = (user) => {
        setEditUser(user);
        const cd = resolveUserClientData(user, clientsMap, onlineMap);
        let expiryDate = '';
        if (cd && cd.expiryValues && cd.expiryValues.length > 0) {
            expiryDate = toLocalDateTimeString(Math.min(...cd.expiryValues));
            setEditHasClients(true);
        } else if (cd && cd.count > 0) {
            setEditHasClients(true);
        } else {
            setEditHasClients(false);
        }

        const initialSubEmail = user.subscriptionEmail || user.email || '';
        setEditSubscriptionFollowLogin(normalizeEmail(initialSubEmail) === normalizeEmail(user.email || ''));

        editForm.setFieldsValue({
            username: user.username || '',
            email: user.email || '',
            subscriptionEmail: initialSubEmail,
            enabled: user.enabled !== false,
            password: '',
            expiryDate,
            noServerLimit: true,
            noProtocolLimit: true,
            serverIds: [],
            protocols: [],
            limitIp: '0',
            trafficLimitGb: '0'
        });

        const policyEmail = normalizeEmail(user.subscriptionEmail || user.email);
        if (policyEmail) {
            setEditPolicyLoading(true);
            api.get(`/user-policy/${encodeURIComponent(policyEmail)}`).then((res) => {
                const p = res.data?.obj || {};
                const sMode = String(p.serverScopeMode || '').toLowerCase();
                const pMode = String(p.protocolScopeMode || '').toLowerCase();
                const validIds = new Set(servers.map((s) => s.id));
                
                editForm.setFieldsValue({
                    serverIds: (Array.isArray(p.allowedServerIds) ? p.allowedServerIds : []).filter(id => validIds.has(id)),
                    protocols: (Array.isArray(p.allowedProtocols) ? p.allowedProtocols : []).map(v => String(v).trim().toLowerCase()).filter(v => ['vless', 'vmess', 'trojan', 'shadowsocks'].includes(v)),
                    noServerLimit: sMode !== 'selected' && sMode !== 'none',
                    noProtocolLimit: pMode !== 'selected' && pMode !== 'none',
                    limitIp: String(normalizeLimitIp(p.limitIp)),
                    trafficLimitGb: bytesToGigabytesInput(p.trafficLimitBytes)
                });
            }).catch(() => {}).finally(() => setEditPolicyLoading(false));
        }
        setEditOpen(true);
    };

    const submitEdit = async (values) => {
        if (!editUser?.id) return;
        const email = normalizeEmail(values.email);
        const subscriptionEmail = normalizeEmail(values.subscriptionEmail);

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error(t('comp.users.emailInvalid')); return; }
        if (subscriptionEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subscriptionEmail)) { toast.error('订阅绑定邮箱格式不正确'); return; }

        const payload = { username: values.username.trim(), email, subscriptionEmail };
        if (values.password) {
            const passwordError = getPasswordPolicyError(values.password, locale);
            if (passwordError) { toast.error(passwordError); return; }
            payload.password = values.password;
        }

        setEditSaving(true);
        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(editUser.id)}`, payload);
            if (!res.data?.success) { toast.error(res.data?.msg || t('comp.users.updateFailed')); setEditSaving(false); return; }

            const updatedUser = res.data?.obj || {};
            const policyEmail = normalizeEmail(updatedUser.subscriptionEmail || updatedUser.email || editUser.subscriptionEmail || editUser.email);
            if (policyEmail) {
                const serverScopeMode = values.noServerLimit ? 'all' : (values.serverIds.length > 0 ? 'selected' : 'none');
                const protocolScopeMode = values.noProtocolLimit ? 'all' : (values.protocols.length > 0 ? 'selected' : 'none');
                await api.put(`/user-policy/${encodeURIComponent(policyEmail)}`, {
                    allowedServerIds: serverScopeMode === 'selected' ? values.serverIds : [],
                    allowedProtocols: protocolScopeMode === 'selected' ? values.protocols : [],
                    serverScopeMode, protocolScopeMode,
                    limitIp: normalizeLimitIp(values.limitIp),
                    trafficLimitBytes: gigabytesInputToBytes(values.trafficLimitGb)
                });
            }

            if (values.enabled !== (editUser.enabled !== false)) {
                await api.put(`/auth/users/${encodeURIComponent(editUser.id)}/set-enabled`, { enabled: values.enabled });
            }

            if (editHasClients) {
                await api.put(`/auth/users/${encodeURIComponent(editUser.id)}/update-expiry`, { expiryTime: values.expiryDate ? new Date(values.expiryDate).getTime() : 0 });
            }

            toast.success('用户信息已更新');
            setEditOpen(false);
            invalidateServerPanelDataCache();
            invalidateManagedUsersCache();
            await fetchData({ forceUsers: true });
        } catch (err) { toast.error(err.response?.data?.msg || t('comp.users.updateFailed')); }
        setEditSaving(false);
    };

    // --- Create Modal Logic ---
    const openCreateModal = () => {
        createForm.resetFields();
        createForm.setFieldsValue({
            password: generateSecurePassword(),
            provisionAfterCreate: true
        });
        setCreateOpen(true);
    };

    const submitCreate = async (values) => {
        const username = String(values.username || '').trim();
        const email = normalizeEmail(values.email);
        const password = String(values.password || '');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error(t('comp.users.emailInvalid')); return; }
        const passwordError = getPasswordPolicyError(password, locale);
        if (passwordError) { toast.error(passwordError); return; }

        setCreateSaving(true);
        try {
            const res = await api.post('/auth/users', { username, password, role: 'user', email, subscriptionEmail: email });
            if (!res.data?.success || !res.data?.obj) { toast.error(res.data?.msg || t('comp.users.createFailed')); setCreateSaving(false); return; }
            
            const createdUser = res.data.obj;
            toast.success(`用户 ${createdUser.username} 已创建`);
            setCreateOpen(false);
            invalidateServerPanelDataCache();
            invalidateManagedUsersCache();
            await fetchData({ forceUsers: true });

            if (values.provisionAfterCreate) {
                const targetEmail = normalizeEmail(createdUser.subscriptionEmail || createdUser.email);
                if (!targetEmail) toast(copy.postCreateNoEmail);
                else openProvisionModal(createdUser);
            }
        } catch (err) { toast.error(err.response?.data?.msg || t('comp.users.createFailed')); }
        setCreateSaving(false);
    };

    useEffect(() => {
        const editId = searchParams.get('edit');
        if (editId && users.length > 0 && !loading) {
            const targetUser = users.find(u => u.id === editId);
            if (targetUser) {
                openEditModal(targetUser);
                setSearchParams({}, { replace: true });
            }
        }
    }, [users, loading, searchParams]);

    return (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#177ddc', colorBgBase: '#000000', colorBgContainer: '#141414', borderRadius: 4 } }}>
            <Header title={t('pages.usersHub.title')} eyebrow={t('pages.usersHub.eyebrow')} />
            <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
                <Card style={{ marginBottom: 24 }}>
                    <Row justify="space-between" align="middle">
                        <Col>
                            <Space>
                                <Input 
                                    placeholder="搜索用户名 / 邮箱..." 
                                    prefix={<HiOutlineMagnifyingGlass />} 
                                    value={searchTerm} 
                                    onChange={(e) => setSearchTerm(e.target.value)} 
                                />
                                <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 120 }}>
                                    <Option value="all">全部状态</Option>
                                    <Option value="active">已开通</Option>
                                    <Option value="enabled">已启用</Option>
                                    <Option value="disabled">已停用</Option>
                                    <Option value="pending">待审核</Option>
                                </Select>
                            </Space>
                        </Col>
                        <Col>
                            <Space>
                                <Text type="secondary">{statsLoading ? `${syncingCopy.summary} · ` : ''}显示 {filteredUsers.length} / {users.length}</Text>
                                <Button icon={<HiOutlineArrowDownTray />} onClick={handleExportCSV}>导出</Button>
                                <Button icon={<HiOutlineArrowPath />} onClick={() => fetchData({ forceUsers: true })}>刷新</Button>
                                <Button type="primary" icon={<HiOutlineUserPlus />} onClick={openCreateModal}>添加账号</Button>
                            </Space>
                        </Col>
                    </Row>
                </Card>

                {partialErrors.length > 0 && !primaryError && !loading && (
                    <Alert 
                        message={copy.degradedDataTitle} 
                        description={<>{copy.degradedDataIntro}<br/><Text type="secondary">{summarizePartialErrors(partialErrors, locale)}</Text></>} 
                        type="warning" 
                        showIcon 
                        style={{ marginBottom: 24 }} 
                    />
                )}

                {selectedIds.size > 0 && (
                    <Card style={{ marginBottom: 24, backgroundColor: '#1f1f1f' }} bodyStyle={{ padding: '12px 24px' }}>
                        <Space>
                            <Text strong>已选 {selectedIds.size} 个用户</Text>
                            <Button 
                                type="primary" 
                                danger={!bulkToggleEnable} 
                                style={bulkToggleEnable ? { backgroundColor: '#52c41a' } : {}}
                                icon={bulkToggleEnable ? <HiOutlinePlayCircle /> : <HiOutlineNoSymbol />}
                                onClick={() => handleBulkSetEnabled(bulkToggleEnable)} 
                                loading={bulkLoading}
                            >
                                {bulkToggleEnable ? t('comp.inbounds.enableSelected') : t('comp.inbounds.disableSelected')}
                            </Button>
                            <Button onClick={() => setSelectedIds(new Set())}>取消选择</Button>
                        </Space>
                    </Card>
                )}

                <Card bodyStyle={{ padding: 0 }}>
                    <Table 
                        dataSource={filteredUsers} 
                        columns={columns} 
                        rowKey="id" 
                        rowSelection={rowSelection} 
                        loading={loading}
                        pagination={{ pageSize: 20 }}
                        scroll={{ x: 1000 }}
                    />
                </Card>
            </div>

            {/* Create User Modal */}
            <Modal title="添加用户账号" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={createSaving}>
                <Form form={createForm} layout="vertical" onFinish={submitCreate}>
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                        <Input placeholder="例如: user001" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
                        <Input placeholder="同时作为登录邮箱和订阅绑定邮箱" />
                    </Form.Item>
                    <Form.Item name="password" label="初始密码" rules={[{ required: true, message: '请输入密码' }]}>
                        <Space.Compact style={{ width: '100%' }}>
                            <Input.Password placeholder="至少8位，含3类字符" style={{ fontFamily: 'monospace' }} />
                            <Button onClick={() => {
                                const p = generateSecurePassword();
                                createForm.setFieldsValue({ password: p });
                            }}><HiOutlineArrowPath /> 生成</Button>
                        </Space.Compact>
                    </Form.Item>
                    <Form.Item name="provisionAfterCreate" valuePropName="checked">
                        <Checkbox>{copy.createProvisionToggle}</Checkbox>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Edit User Modal */}
            <Modal title={`编辑用户 - ${editUser?.username}`} open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => editForm.submit()} confirmLoading={editSaving} width={700}>
                <Form form={editForm} layout="vertical" onFinish={submitEdit} initialValues={{ enabled: true, noServerLimit: true, noProtocolLimit: true }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
                                <Input onChange={e => {
                                    if(editSubscriptionFollowLogin) editForm.setFieldsValue({ subscriptionEmail: e.target.value });
                                }} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="subscriptionEmail" label="订阅绑定邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]} extra={editSubscriptionFollowLogin ? '当前跟随登录邮箱变更' : '可单独指定订阅客户端绑定邮箱'}>
                        <Input onChange={e => setEditSubscriptionFollowLogin(normalizeEmail(e.target.value) === normalizeEmail(editForm.getFieldValue('email')))} placeholder="留空表示暂不单独绑定" />
                    </Form.Item>
                    <Form.Item name="enabled" label="账号状态" valuePropName="checked">
                        <Switch checkedChildren="启用" unCheckedChildren="停用" />
                    </Form.Item>
                    <Form.Item name="password" label="重置密码（留空则不修改）">
                        <Space.Compact style={{ width: '100%' }}>
                            <Input.Password placeholder="留空不修改" style={{ fontFamily: 'monospace' }} />
                            <Button onClick={() => editForm.setFieldsValue({ password: generateSecurePassword() })}><HiOutlineArrowPath /> 生成</Button>
                        </Space.Compact>
                    </Form.Item>
                    {editHasClients && (
                        <Form.Item name="expiryDate" label="到期时间" extra="留空 = 永不过期，修改后将同步更新所有节点客户端">
                            <Input type="datetime-local" />
                        </Form.Item>
                    )}
                    <Card title="订阅策略" size="small" style={{ marginBottom: 16 }}>
                        <Form.Item name="noServerLimit" valuePropName="checked">
                            <Checkbox>不限制服务器</Checkbox>
                        </Form.Item>
                        <Form.Item shouldUpdate={(prev, curr) => prev.noServerLimit !== curr.noServerLimit}>
                            {() => (
                                <Form.Item name="serverIds" label="可访问服务器">
                                    <Select mode="multiple" disabled={editForm.getFieldValue('noServerLimit')} options={servers.map(s => ({ value: s.id, label: s.name }))} />
                                </Form.Item>
                            )}
                        </Form.Item>
                        <Form.Item name="noProtocolLimit" valuePropName="checked">
                            <Checkbox>不限制协议</Checkbox>
                        </Form.Item>
                        <Form.Item shouldUpdate={(prev, curr) => prev.noProtocolLimit !== curr.noProtocolLimit}>
                            {() => (
                                <Form.Item name="protocols" label="可用协议">
                                    <Select mode="multiple" disabled={editForm.getFieldValue('noProtocolLimit')} options={PROTOCOL_OPTIONS.map(p => ({ value: p.key, label: p.label }))} />
                                </Form.Item>
                            )}
                        </Form.Item>
                    </Card>
                    <Card title="统一限额" size="small" extra={<Text type="secondary" style={{fontSize: 12}}>单个入站用户如有手工覆盖，优先使用覆盖值</Text>}>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="limitIp" label="IP 限制" extra="0 = 不限制连接 IP 数量">
                                    <Input type="number" min={0} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="trafficLimitGb" label="总流量上限 (GB)" extra="0 = 不限制总流量">
                                    <Input type="number" min={0} step="0.5" />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>
                </Form>
            </Modal>

            {/* Provision Modal */}
            <Modal title={`${copy.provisionModalTitle} - ${provisionTargetUser?.username}`} open={provisionOpen} onCancel={() => setProvisionOpen(false)} footer={null} width={800}>
                {provisionInitLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px' }}><Spin /></div>
                ) : provisionResult ? (
                    <div style={{ padding: '20px 0' }}>
                        <Alert message="开通成功" description={provisionResult.successMessage} type="success" showIcon style={{ marginBottom: 24 }} />
                        <Title level={5}>客户端订阅链接</Title>
                        <SubscriptionClientLinks bundle={provisionResult.bundle} compact showHeading={false} />
                        <Button type="primary" onClick={() => setProvisionOpen(false)} style={{ marginTop: 24 }}>完成</Button>
                    </div>
                ) : (
                    <Form form={provisionForm} layout="vertical" onFinish={submitProvision}>
                        <Form.Item name="email" label="订阅绑定邮箱" rules={[{ required: true, type: 'email', message: '请输入有效的邮箱' }]}>
                            <Input placeholder="与节点客户端配置一致的邮箱" />
                        </Form.Item>
                        <Card title="统一限额" size="small" style={{ marginBottom: 16 }} extra={<Text type="secondary" style={{fontSize: 12}}>同步到该用户的默认策略与选中入站客户端</Text>}>
                            <Row gutter={16}>
                                <Col span={8}>
                                    <Form.Item name="expiryDate" label="到期时间" extra="留空 = 永不过期">
                                        <Input type="datetime-local" />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item name="limitIp" label="IP 限制" extra="0 = 不限制">
                                        <Input type="number" min={0} />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item name="trafficLimitGb" label="总流量上限 (GB)" extra="0 = 不限制">
                                        <Input type="number" min={0} step="0.5" />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                        <Form.Item label={`选择入站 (已选 ${provisionSelectedInboundKeys.size} / ${allInbounds.length})`}>
                            <Space style={{ marginBottom: 8 }}>
                                <Button size="small" onClick={() => setProvisionSelectedInboundKeys(new Set(allInbounds.map(ib => ib.key)))}>全选</Button>
                                <Button size="small" onClick={() => setProvisionSelectedInboundKeys(new Set())}>全不选</Button>
                            </Space>
                            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #303030', borderRadius: 4, padding: 8 }}>
                                {allInbounds.length === 0 ? <Text type="secondary">暂无可用入站</Text> : allInbounds.map(ib => (
                                    <div key={ib.key} style={{ marginBottom: 8 }}>
                                        <Checkbox checked={provisionSelectedInboundKeys.has(ib.key)} onChange={e => {
                                            const next = new Set(provisionSelectedInboundKeys);
                                            if (e.target.checked) next.add(ib.key); else next.delete(ib.key);
                                            setProvisionSelectedInboundKeys(next);
                                        }}>
                                            <Space>
                                                <Text strong>{ib.serverName}</Text>
                                                <Text type="secondary">{ib.remark || ib.protocol}</Text>
                                                <Tag>{ib.protocol}:{ib.port}</Tag>
                                                <Text type="secondary" style={{ fontSize: 12 }}>到期: {ib.expiryTime > 0 ? formatDateOnly(ib.expiryTime, locale) : '永久'}</Text>
                                            </Space>
                                        </Checkbox>
                                    </div>
                                ))}
                            </div>
                        </Form.Item>
                        <div style={{ textAlign: 'right' }}>
                            <Space>
                                <Button onClick={() => setProvisionOpen(false)}>取消</Button>
                                <Button type="primary" htmlType="submit" loading={provisionSaving}>确认开通</Button>
                            </Space>
                        </div>
                    </Form>
                )}
            </Modal>
        </ConfigProvider>
    );
}