import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { copyToClipboard, formatBytes, formatDateOnly } from '../../utils/format.js';
import { getPasswordPolicyError, getPasswordPolicyHint } from '../../utils/passwordPolicy.js';
import { buildSubscriptionProfileBundle } from '../../utils/subscriptionProfiles.js';
import { getClientIdentifier, normalizeEmail } from '../../utils/protocol.js';
import { bytesToGigabytesInput, gigabytesInputToBytes, normalizeLimitIp } from '../../utils/entitlements.js';
import { generateSecurePassword } from '../../utils/crypto.js';
import { mergeInboundClientStats, resolveClientUsed, safeNumber } from '../../utils/inboundClients.js';
import { fetchManagedUsers, invalidateManagedUsersCache } from '../../utils/managedUsersCache.js';
import SubscriptionClientLinks from '../Subscriptions/SubscriptionClientLinks.jsx';
import ModalShell from '../UI/ModalShell.jsx';
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
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import useMediaQuery from '../../hooks/useMediaQuery.js';

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
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getUserStatus(user, clientCount) {
    if (!user.enabled && clientCount === 0) return { key: 'pending', label: '待审核', badge: 'badge-warning' };
    if (user.enabled && clientCount === 0) return { key: 'enabled', label: '已启用', badge: 'badge-info' };
    if (user.enabled && clientCount > 0) return { key: 'active', label: '已开通', badge: 'badge-success' };
    if (!user.enabled && clientCount > 0) return { key: 'disabled', label: '已停用', badge: 'badge-danger' };
    return { key: 'unknown', label: '未知', badge: 'badge-neutral' };
}

function formatExpiryLabel(expiryValues, locale = 'zh-CN') {
    if (!expiryValues || expiryValues.length === 0) return '永久';
    const earliest = Math.min(...expiryValues);
    return formatDateOnly(earliest, locale);
}

function normalizeOnlineValue(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeOnlineKeys(item) {
    if (typeof item === 'string') {
        const value = normalizeOnlineValue(item);
        return value ? [value] : [];
    }
    if (!item || typeof item !== 'object') {
        return [];
    }
    return Array.from(new Set(
        [
            item.email,
            item.user,
            item.username,
            item.clientEmail,
            item.client,
            item.remark,
            item.id,
            item.password,
        ]
            .map((value) => normalizeOnlineValue(value))
            .filter(Boolean)
    ));
}

function buildClientOnlineKeys(client, protocol) {
    const keys = new Set();
    const email = normalizeOnlineValue(client?.email);
    const identifier = normalizeOnlineValue(getClientIdentifier(client, protocol));
    const id = normalizeOnlineValue(client?.id);
    const password = normalizeOnlineValue(client?.password);

    if (email) keys.add(email);
    if (identifier) keys.add(identifier);
    if (id) keys.add(id);
    if (password) keys.add(password);

    return Array.from(keys);
}

function getOnlineStatus(clientCount, sessions) {
    if (Number(sessions || 0) > 0) {
        return {
            key: 'online',
            label: '在线',
            badge: 'badge-success',
            detail: `${sessions} 会话`,
        };
    }
    if (Number(clientCount || 0) > 0) {
        return {
            key: 'offline',
            label: '离线',
            badge: 'badge-neutral',
            detail: '',
        };
    }
    return {
        key: 'unassigned',
        label: '未接入',
        badge: 'badge-neutral',
        detail: '',
    };
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
        degradedDataTitle: '节点数据已降级显示',
        degradedDataIntro: '基础用户列表已加载，但部分节点的入站配置或在线状态读取失败，流量和在线统计可能不完整。',
    };
}

function summarizePartialErrors(partialErrors, locale = 'zh-CN') {
    if (!Array.isArray(partialErrors) || partialErrors.length === 0) return '';

    const inboundsServers = partialErrors
        .filter((item) => item.kind === 'inbounds')
        .map((item) => item.serverName);
    const presenceServers = partialErrors
        .filter((item) => item.kind === 'presence')
        .map((item) => item.serverName);

    if (locale === 'en-US') {
        const parts = [];
        if (inboundsServers.length > 0) {
            parts.push(`inbounds unavailable on ${inboundsServers.join(', ')}`);
        }
        if (presenceServers.length > 0) {
            parts.push(`online presence unavailable on ${presenceServers.join(', ')}`);
        }
        return parts.join('; ');
    }

    const parts = [];
    if (inboundsServers.length > 0) {
        parts.push(`入站配置失败: ${inboundsServers.join('、')}`);
    }
    if (presenceServers.length > 0) {
        parts.push(`在线状态失败: ${presenceServers.join('、')}`);
    }
    return parts.join('；');
}

export default function UsersHub() {
    const { servers } = useServer();
    const confirmAction = useConfirm();
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const copy = useMemo(() => getUsersHubCopy(locale), [locale]);

    const [users, setUsers] = useState([]);
    const [clientsMap, setClientsMap] = useState(new Map());
    const [onlineMap, setOnlineMap] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [primaryError, setPrimaryError] = useState('');
    const [partialErrors, setPartialErrors] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [statusFilter, setStatusFilter] = useState('all');
    const [sequenceDirection, setSequenceDirection] = useState('asc');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    // Provision modal
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [provisionTargetUser, setProvisionTargetUser] = useState(null);
    const [provisionInitLoading, setProvisionInitLoading] = useState(false);
    const [provisionSaving, setProvisionSaving] = useState(false);
    const [provisionEmail, setProvisionEmail] = useState('');
    const [provisionExpiryDate, setProvisionExpiryDate] = useState('');
    const [provisionLimitIp, setProvisionLimitIp] = useState('0');
    const [provisionTrafficLimitGb, setProvisionTrafficLimitGb] = useState('0');
    const [provisionResult, setProvisionResult] = useState(null);
    const [provisionSelectedInboundKeys, setProvisionSelectedInboundKeys] = useState(new Set());
    const [inboundExpiries, setInboundExpiries] = useState([]);
    const [allInbounds, setAllInbounds] = useState([]);

    // Edit user modal
    const [editOpen, setEditOpen] = useState(false);
    const [editUser, setEditUser] = useState(null);
    const [editUsername, setEditUsername] = useState('');
    const [editEmail, setEditEmail] = useState('');
    const [editPassword, setEditPassword] = useState('');
    const [showEditPassword, setShowEditPassword] = useState(false);
    const [editExpiryDate, setEditExpiryDate] = useState('');
    const [editHasClients, setEditHasClients] = useState(false);
    const [editSaving, setEditSaving] = useState(false);
    // Policy fields in edit modal
    const [editPolicyLoading, setEditPolicyLoading] = useState(false);
    const [editNoServerLimit, setEditNoServerLimit] = useState(true);
    const [editNoProtocolLimit, setEditNoProtocolLimit] = useState(true);
    const [editServerIds, setEditServerIds] = useState([]);
    const [editProtocols, setEditProtocols] = useState([]);
    const [editLimitIp, setEditLimitIp] = useState('0');
    const [editTrafficLimitGb, setEditTrafficLimitGb] = useState('0');

    // Create user modal
    const [createOpen, setCreateOpen] = useState(false);
    const [createSaving, setCreateSaving] = useState(false);
    const [createUsername, setCreateUsername] = useState('');
    const [createEmail, setCreateEmail] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [showCreatePassword, setShowCreatePassword] = useState(true);
    const [createProvisionAfterCreate, setCreateProvisionAfterCreate] = useState(true);

    useEffect(() => {
        const queryValue = String(searchParams.get('q') || '').trim();
        if (!queryValue) return;
        setSearchTerm(queryValue);
    }, [searchParams]);

    const fetchData = async (options = {}) => {
        const forceUsers = options.forceUsers === true;
        setLoading(true);
        setPrimaryError('');
        setPartialErrors([]);
        try {
            const userList = await fetchManagedUsers(api, { force: forceUsers });
            setUsers(userList);
            setSelectedIds((previous) => new Set(
                Array.from(previous).filter((id) => userList.some((user) => user.id === id))
            ));

            const nextPartialErrors = [];
            const serverResults = await Promise.all(
                servers.map(async (server) => {
                    let inbounds = [];
                    let onlines = [];

                    try {
                        const inboundsRes = await api.get(`/panel/${server.id}/panel/api/inbounds/list`);
                        inbounds = Array.isArray(inboundsRes.data?.obj) ? inboundsRes.data.obj : [];
                    } catch (error) {
                        nextPartialErrors.push({
                            kind: 'inbounds',
                            serverId: server.id,
                            serverName: server.name,
                            message: error?.response?.data?.msg || error?.message || 'inbounds unavailable',
                        });
                    }

                    try {
                        const onlinesRes = await api.post(`/panel/${server.id}/panel/api/inbounds/onlines`);
                        onlines = Array.isArray(onlinesRes.data?.obj) ? onlinesRes.data.obj : [];
                    } catch (error) {
                        nextPartialErrors.push({
                            kind: 'presence',
                            serverId: server.id,
                            serverName: server.name,
                            message: error?.response?.data?.msg || error?.message || 'presence unavailable',
                        });
                    }

                    return { server, inbounds, onlines };
                })
            );

            const emailMap = new Map();
            const onlineEmailMap = new Map();
            const expiryRef = [];
            const inboundList = [];
            serverResults.forEach((result) => {
                const server = result.server;
                const inbounds = Array.isArray(result?.inbounds) ? result.inbounds : [];
                const onlines = Array.isArray(result?.onlines) ? result.onlines : [];
                const onlineCounter = new Map();

                onlines.forEach((entry) => {
                    normalizeOnlineKeys(entry).forEach((key) => {
                        onlineCounter.set(key, (onlineCounter.get(key) || 0) + 1);
                    });
                    const email = normalizeEmail(entry?.email || entry?.user || entry?.username || entry?.clientEmail || entry?.client || entry?.remark || entry);
                    if (email) {
                        onlineEmailMap.set(email, (onlineEmailMap.get(email) || 0) + 1);
                    }
                });

                inbounds.forEach((ib) => {
                    const protocol = String(ib.protocol || '').toLowerCase();
                    if (!['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) return;
                    if (ib.enable === false) return;

                    const ibClients = mergeInboundClientStats(ib);
                    const ibKey = `${server.id}:${ib.id}`;
                    const ibExpiries = ibClients
                        .map((cl) => Number(cl.expiryTime || 0))
                        .filter((value) => value > 0);
                    let representativeExpiry = 0;
                    if (ibExpiries.length > 0) {
                        ibExpiries.sort((a, b) => a - b);
                        representativeExpiry = ibExpiries[Math.floor(ibExpiries.length / 2)];
                        expiryRef.push({
                            serverName: server.name,
                            inboundRemark: ib.remark || protocol,
                            expiryTime: representativeExpiry,
                            clientCount: ibClients.length,
                        });
                    }

                    inboundList.push({
                        key: ibKey,
                        serverId: server.id,
                        serverName: server.name,
                        inboundId: ib.id,
                        remark: ib.remark || '',
                        protocol,
                        port: ib.port,
                        clientCount: ibClients.length,
                        expiryTime: representativeExpiry,
                    });

                    ibClients.forEach((cl) => {
                        const email = normalizeEmail(cl.email);
                        if (!email) return;
                        if (!emailMap.has(email)) {
                            emailMap.set(email, { count: 0, totalUsed: 0, totalUp: 0, totalDown: 0, expiryValues: [], onlineSessions: 0 });
                        }
                        const entry = emailMap.get(email);
                        const onlineSessions = buildClientOnlineKeys(cl, protocol).reduce((total, key) => (
                            total + (onlineCounter.get(key) || 0)
                        ), 0);
                        entry.count += 1;
                        entry.totalUsed += resolveClientUsed(cl);
                        entry.totalUp += safeNumber(cl?.up);
                        entry.totalDown += safeNumber(cl?.down);
                        entry.onlineSessions += onlineSessions;
                        if (Number(cl.expiryTime || 0) > 0) {
                            entry.expiryValues.push(Number(cl.expiryTime));
                        }
                    });
                });
            });

            setClientsMap(emailMap);
            setOnlineMap(onlineEmailMap);
            setInboundExpiries(expiryRef);
            setAllInbounds(inboundList);
            setPartialErrors(nextPartialErrors);
        } catch (err) {
            console.error('Failed to fetch users data', err);
            const message = err?.response?.data?.msg || err?.message || t('comp.users.loadFailed');
            setPrimaryError(message);
            setUsers([]);
            setSelectedIds(new Set());
            setClientsMap(new Map());
            setOnlineMap(new Map());
            setInboundExpiries([]);
            setAllInbounds([]);
            toast.error(t('comp.users.loadFailed'));
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, [servers]);

    const allOrderedUsers = useMemo(() => {
        return users
            .map((user) => {
                const subEmail = normalizeEmail(user.subscriptionEmail);
                const loginEmail = normalizeEmail(user.email);
                const clientData = clientsMap.get(subEmail) || clientsMap.get(loginEmail) || { count: 0, totalUsed: 0, totalUp: 0, totalDown: 0, expiryValues: [], onlineSessions: 0 };
                const onlineSessions = clientData.onlineSessions || onlineMap.get(subEmail) || onlineMap.get(loginEmail) || 0;
                const status = getUserStatus(user, clientData.count);
                const onlineStatus = getOnlineStatus(clientData.count, onlineSessions);
                return { ...user, clientData, status, onlineSessions, onlineStatus };
            })
            .sort(compareUsersFallback);
    }, [users, clientsMap, onlineMap]);

    const filteredUsers = useMemo(() => {
        const search = String(deferredSearchTerm || '').trim().toLowerCase();
        return allOrderedUsers
            .filter((user) => {
                if (statusFilter !== 'all' && user.status.key !== statusFilter) return false;
                if (!search) return true;
                return [user.username, user.email, user.subscriptionEmail, user.status.label, user.onlineStatus.label]
                    .some((v) => String(v || '').toLowerCase().includes(search));
            });
    }, [allOrderedUsers, deferredSearchTerm, statusFilter]);
    const enrichedUsers = useMemo(() => (
        sequenceDirection === 'desc' ? [...filteredUsers].reverse() : filteredUsers
    ), [filteredUsers, sequenceDirection]);
    const selectedUsers = useMemo(
        () => enrichedUsers.filter((user) => selectedIds.has(user.id)),
        [enrichedUsers, selectedIds]
    );
    const bulkToggleEnable = selectedUsers.length > 0
        ? !selectedUsers.every((user) => user.enabled !== false)
        : true;
    const bulkToggleLabel = bulkToggleEnable ? t('comp.inbounds.enableSelected') : t('comp.inbounds.disableSelected');
    const bulkToggleIcon = bulkToggleEnable ? <HiOutlinePlayCircle /> : <HiOutlineNoSymbol />;
    const bulkToggleClassName = bulkToggleEnable ? 'btn btn-success btn-sm' : 'btn btn-danger btn-sm';

    // --- Set enabled ---
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
                if (res.data?.obj?.partialFailure) {
                    toast.error(message);
                } else {
                    toast.success(message);
                }
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } else {
                toast.error(res.data?.msg || t('comp.common.operationFailed'));
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || t('comp.common.operationFailed'));
        }
    };

    // --- Delete user ---
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
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } else {
                toast.error(res.data?.msg || t('comp.common.deleteFailed'));
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || t('comp.common.deleteFailed'));
        }
    };

    // --- Bulk operations ---
    const handleBulkSetEnabled = async (enabled) => {
        if (selectedIds.size === 0) return;
        setBulkLoading(true);
        try {
            const res = await api.post('/auth/users/bulk-set-enabled', {
                userIds: Array.from(selectedIds),
                enabled,
            });
            if (res.data?.success) {
                const resultItems = Array.isArray(res.data?.obj)
                    ? res.data.obj
                    : (Array.isArray(res.data?.obj?.items) ? res.data.obj.items : []);
                const hasPartialFailure = resultItems.some((item) => item?.partialFailure === true);
                if (hasPartialFailure) {
                    toast.error(res.data.msg);
                } else {
                    toast.success(res.data.msg);
                }
                setSelectedIds(new Set());
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } else {
                toast.error(res.data?.msg || t('comp.common.operationFailed'));
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || t('comp.users.batchFailed'));
        }
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
        } catch {
            toast.error(t('comp.users.exportFailed'));
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === enrichedUsers.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(enrichedUsers.map((u) => u.id)));
        }
    };

    const renderUserActionButtons = (user) => (
        <>
            <button className="btn btn-secondary btn-sm btn-icon users-action-btn" title="详情" aria-label="详情" onClick={() => navigate(`/clients/${user.id}`)}>
                <HiOutlineEye />
                <span className="users-action-mobile-label">详情</span>
            </button>
            {user.status.key === 'pending' && (
                <>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-success"
                        title="通过审核"
                        aria-label="通过审核"
                        onClick={() => handleSetEnabled(user, true)}
                    >
                        <HiOutlineCheck />
                        <span className="users-action-mobile-label">通过</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-danger"
                        title="删除"
                        aria-label="删除"
                        onClick={() => handleDelete(user)}
                    >
                        <HiOutlineTrash />
                        <span className="users-action-mobile-label">删除</span>
                    </button>
                </>
            )}
            {user.status.key === 'enabled' && (
                <>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-primary"
                        title={copy.provisionAction}
                        aria-label={copy.provisionAction}
                        onClick={() => openProvisionModal(user)}
                    >
                        <HiOutlinePlusCircle />
                        <span className="users-action-mobile-label">开通</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn"
                        title="编辑"
                        aria-label="编辑"
                        onClick={() => openEditModal(user)}
                    >
                        <HiOutlinePencilSquare />
                        <span className="users-action-mobile-label">编辑</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn"
                        title={user.enabled !== false ? '停用' : '启用'}
                        aria-label={user.enabled !== false ? '停用' : '启用'}
                        onClick={() => handleSetEnabled(user, user.enabled === false)}
                    >
                        {user.enabled !== false ? <HiOutlineNoSymbol /> : <HiOutlinePlayCircle />}
                        <span className="users-action-mobile-label">{user.enabled !== false ? '停用' : '启用'}</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-danger"
                        title="删除"
                        aria-label="删除"
                        onClick={() => handleDelete(user)}
                    >
                        <HiOutlineTrash />
                        <span className="users-action-mobile-label">删除</span>
                    </button>
                </>
            )}
            {user.status.key === 'active' && (
                <>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn"
                        title="编辑"
                        aria-label="编辑"
                        onClick={() => openEditModal(user)}
                    >
                        <HiOutlinePencilSquare />
                        <span className="users-action-mobile-label">编辑</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn"
                        title={user.enabled !== false ? '停用' : '启用'}
                        aria-label={user.enabled !== false ? '停用' : '启用'}
                        onClick={() => handleSetEnabled(user, user.enabled === false)}
                    >
                        {user.enabled !== false ? <HiOutlineNoSymbol /> : <HiOutlinePlayCircle />}
                        <span className="users-action-mobile-label">{user.enabled !== false ? '停用' : '启用'}</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-danger"
                        title="删除"
                        aria-label="删除"
                        onClick={() => handleDelete(user)}
                    >
                        <HiOutlineTrash />
                        <span className="users-action-mobile-label">删除</span>
                    </button>
                </>
            )}
            {user.status.key === 'disabled' && (
                <>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-success"
                        title={user.enabled !== false ? '停用' : '启用'}
                        aria-label={user.enabled !== false ? '停用' : '启用'}
                        onClick={() => handleSetEnabled(user, user.enabled === false)}
                    >
                        {user.enabled !== false ? <HiOutlineNoSymbol /> : <HiOutlinePlayCircle />}
                        <span className="users-action-mobile-label">{user.enabled !== false ? '停用' : '启用'}</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm btn-icon users-action-btn is-danger"
                        title="删除"
                        aria-label="删除"
                        onClick={() => handleDelete(user)}
                    >
                        <HiOutlineTrash />
                        <span className="users-action-mobile-label">删除</span>
                    </button>
                </>
            )}
        </>
    );

    const renderMobileUserCard = (user, index) => {
        const sequenceNumber = sequenceDirection === 'asc'
            ? index + 1
            : enrichedUsers.length - index;
        const displayEmail = user.email || user.subscriptionEmail || '';
        const userExpiryLabel = user.clientData.count > 0
            ? formatExpiryLabel(user.clientData.expiryValues, locale)
            : '未开通';
        const userTrafficSummary = user.clientData.totalUsed
            ? `↑${formatBytes(user.clientData.totalUp)} / ↓${formatBytes(user.clientData.totalDown)}`
            : '未使用流量';

        return (
            <div
                key={user.id}
                className={`users-mobile-card ${selectedIds.has(user.id) ? 'users-mobile-card--selected' : ''}`}
            >
                <div className="users-mobile-card-head">
                    <label className="users-mobile-check">
                        <input
                            type="checkbox"
                            checked={selectedIds.has(user.id)}
                            onChange={() => toggleSelect(user.id)}
                        />
                        <span className="users-mobile-sequence">#{sequenceNumber}</span>
                    </label>
                    <div className="users-mobile-card-badges">
                        <span className={`badge ${user.status.badge}`}>{user.status.label}</span>
                        <span className={`badge ${user.onlineStatus.badge}`}>{user.onlineStatus.label}</span>
                    </div>
                </div>

                <button
                    type="button"
                    className="users-mobile-identity"
                    onClick={() => navigate(`/clients/${user.id}`)}
                    title={displayEmail ? `${user.username}\n${displayEmail}` : user.username}
                >
                    <span className="users-mobile-name">{user.username}</span>
                    <span className={`users-mobile-email${displayEmail ? '' : ' is-empty'}`}>
                        {displayEmail || copy.unsetEmail}
                    </span>
                </button>

                <div className="users-mobile-metrics">
                    <div className="users-mobile-metric">
                        <span className="users-mobile-metric-label">在线状态</span>
                        <span className="users-mobile-metric-value">
                            {user.onlineStatus.detail || user.onlineStatus.label}
                        </span>
                    </div>
                    <div className="users-mobile-metric">
                        <span className="users-mobile-metric-label">节点数</span>
                        <span className="users-mobile-metric-value">{user.clientData.count || 0}</span>
                    </div>
                    <div className="users-mobile-metric">
                        <span className="users-mobile-metric-label">流量</span>
                        <span className="users-mobile-metric-value">{userTrafficSummary}</span>
                    </div>
                    <div className="users-mobile-metric">
                        <span className="users-mobile-metric-label">到期时间</span>
                        <span className="users-mobile-metric-value">{userExpiryLabel}</span>
                    </div>
                </div>

                <div className="users-row-actions users-row-actions--mobile-card">
                    {renderUserActionButtons(user)}
                </div>
            </div>
        );
    };

    // --- Provision modal ---
    const closeProvisionModal = () => {
        setProvisionOpen(false);
        setProvisionTargetUser(null);
        setProvisionInitLoading(false);
        setProvisionSaving(false);
        setProvisionEmail('');
        setProvisionExpiryDate('');
        setProvisionLimitIp('0');
        setProvisionTrafficLimitGb('0');
        setProvisionResult(null);
        setProvisionSelectedInboundKeys(new Set());
    };

    const openProvisionModal = async (user) => {
        const suggestedEmail = normalizeEmail(user?.subscriptionEmail || user?.email);
        if (!suggestedEmail) {
            toast.error(t('comp.users.noEmailForSubscription'));
            return;
        }
        setProvisionTargetUser(user);
        setProvisionEmail(suggestedEmail);
        setProvisionResult(null);
        setProvisionInitLoading(true);
        setProvisionLimitIp('0');
        setProvisionTrafficLimitGb('0');

        // Default: select all inbounds
        setProvisionSelectedInboundKeys(new Set(allInbounds.map((ib) => ib.key)));

        // Default expiry: use the most common expiry from inbound reference
        if (inboundExpiries.length > 0) {
            const futureExpiries = inboundExpiries
                .map((e) => e.expiryTime)
                .filter((t) => t > Date.now());
            if (futureExpiries.length > 0) {
                futureExpiries.sort((a, b) => a - b);
                const representative = futureExpiries[Math.floor(futureExpiries.length / 2)];
                setProvisionExpiryDate(toLocalDateTimeString(representative));
            } else {
                setProvisionExpiryDate('');
            }
        } else {
            setProvisionExpiryDate('');
        }

        setProvisionOpen(true);
        try {
            const policyRes = await api.get(`/user-policy/${encodeURIComponent(suggestedEmail)}`);
            const policy = policyRes.data?.obj || {};
            setProvisionLimitIp(String(normalizeLimitIp(policy.limitIp)));
            setProvisionTrafficLimitGb(bytesToGigabytesInput(policy.trafficLimitBytes));
        } catch {
            setProvisionLimitIp('0');
            setProvisionTrafficLimitGb('0');
        }

        setProvisionInitLoading(false);
    };

    const submitProvision = async (event) => {
        event.preventDefault();
        if (!provisionTargetUser?.id) return;

        const provisionNormalizedEmail = normalizeEmail(provisionEmail);
        if (!provisionNormalizedEmail) {
            toast.error(t('comp.users.subEmailEmpty'));
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(provisionNormalizedEmail)) {
            toast.error(t('comp.users.subEmailInvalid'));
            return;
        }
        if (provisionSelectedInboundKeys.size === 0) {
            toast.error(t('comp.users.selectAtLeastOneInbound'));
            return;
        }

        setProvisionSaving(true);
        try {
            const expiryTime = provisionExpiryDate
                ? new Date(provisionExpiryDate).getTime()
                : 0;

            const res = await api.post(`/auth/users/${encodeURIComponent(provisionTargetUser.id)}/provision-subscription`, {
                subscriptionEmail: provisionNormalizedEmail,
                serverScopeMode: 'all',
                protocolScopeMode: 'all',
                allowedServerIds: [],
                allowedProtocols: [],
                allowedInboundKeys: Array.from(provisionSelectedInboundKeys),
                expiryTime,
                limitIp: normalizeLimitIp(provisionLimitIp),
                trafficLimitBytes: gigabytesInputToBytes(provisionTrafficLimitGb),
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
            } catch {
                toast(copy.provisionLoadFailed, { icon: '⚠️' });
            }

            setProvisionResult({
                email: boundEmail,
                deployment: dep,
                successMessage,
                bundle: buildSubscriptionProfileBundle(subscriptionPayload || {}, locale),
            });

            try {
                invalidateManagedUsersCache();
                await fetchData({ forceUsers: true });
            } catch (refreshErr) {
                console.error('Failed to refresh users hub after provisioning:', refreshErr);
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || t('comp.users.provisionFailed'));
        }
        setProvisionSaving(false);
    };

    const provisionLinks = useMemo(() => {
        if (!provisionResult) return [];
        const available = Array.isArray(provisionResult.bundle?.availableProfiles)
            ? provisionResult.bundle.availableProfiles
            : [];
        const preferredKeys = new Set(['v2rayn', 'clash', 'singbox', 'raw']);
        return available.filter((item) => preferredKeys.has(item.key));
    }, [provisionResult]);

    // --- Edit user modal ---
    const openEditModal = (user) => {
        setEditUser(user);
        setEditUsername(user.username || '');
        setEditEmail(user.email || '');
        setEditPassword('');
        setShowEditPassword(false);
        setEditSaving(false);

        // Pre-fill expiry from client data
        const subEmail = normalizeEmail(user.subscriptionEmail);
        const loginEmail = normalizeEmail(user.email);
        const cd = clientsMap.get(subEmail) || clientsMap.get(loginEmail);
        if (cd && cd.expiryValues && cd.expiryValues.length > 0) {
            const earliest = Math.min(...cd.expiryValues);
            setEditExpiryDate(toLocalDateTimeString(earliest));
            setEditHasClients(true);
        } else if (cd && cd.count > 0) {
            setEditExpiryDate('');
            setEditHasClients(true);
        } else {
            setEditExpiryDate('');
            setEditHasClients(false);
        }

        // Load policy
        const policyEmail = normalizeEmail(user.subscriptionEmail || user.email);
        setEditNoServerLimit(true);
        setEditNoProtocolLimit(true);
        setEditServerIds([]);
        setEditProtocols([]);
        setEditLimitIp('0');
        setEditTrafficLimitGb('0');
        if (policyEmail) {
            setEditPolicyLoading(true);
            api.get(`/user-policy/${encodeURIComponent(policyEmail)}`)
                .then((res) => {
                    const p = res.data?.obj || {};
                    const rawIds = Array.isArray(p.allowedServerIds) ? p.allowedServerIds : [];
                    const validIds = new Set(servers.map((s) => s.id));
                    setEditServerIds(rawIds.filter((id) => validIds.has(id)));
                    const protos = (Array.isArray(p.allowedProtocols) ? p.allowedProtocols : [])
                        .map((v) => String(v || '').trim().toLowerCase())
                        .filter((v) => ['vless', 'vmess', 'trojan', 'shadowsocks'].includes(v));
                    setEditProtocols(protos);
                    const sMode = String(p.serverScopeMode || '').toLowerCase();
                    const pMode = String(p.protocolScopeMode || '').toLowerCase();
                    setEditNoServerLimit(sMode !== 'selected' && sMode !== 'none');
                    setEditNoProtocolLimit(pMode !== 'selected' && pMode !== 'none');
                    setEditLimitIp(String(normalizeLimitIp(p.limitIp)));
                    setEditTrafficLimitGb(bytesToGigabytesInput(p.trafficLimitBytes));
                })
                .catch(() => {})
                .finally(() => setEditPolicyLoading(false));
        }

        setEditOpen(true);
    };

    const closeEditModal = () => {
        setEditOpen(false);
        setEditUser(null);
        setEditSaving(false);
    };

    const submitEdit = async (event) => {
        event.preventDefault();
        if (!editUser?.id) return;

        const username = String(editUsername || '').trim();
        if (!username) {
            toast.error(t('comp.users.usernameEmpty'));
            return;
        }

        const email = normalizeEmail(editEmail);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error(t('comp.users.emailInvalid'));
            return;
        }

        const payload = { username, email };
        if (editPassword) {
            const passwordError = getPasswordPolicyError(editPassword, locale);
            if (passwordError) {
                toast.error(passwordError);
                return;
            }
            payload.password = editPassword;
        }

        setEditSaving(true);
        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(editUser.id)}`, payload);
            if (!res.data?.success) {
                toast.error(res.data?.msg || t('comp.users.updateFailed'));
                setEditSaving(false);
                return;
            }

            // Update policy
            const updatedUser = res.data?.obj || {};
            const policyEmail = normalizeEmail(
                updatedUser.subscriptionEmail
                || updatedUser.email
                || editUser.subscriptionEmail
                || editUser.email
            );
            let policySyncFailedMessage = '';
            let policySyncPartialFailure = false;
            if (policyEmail) {
                const serverScopeMode = editNoServerLimit ? 'all' : (editServerIds.length > 0 ? 'selected' : 'none');
                const protocolScopeMode = editNoProtocolLimit ? 'all' : (editProtocols.length > 0 ? 'selected' : 'none');
                try {
                    const policyRes = await api.put(`/user-policy/${encodeURIComponent(policyEmail)}`, {
                        allowedServerIds: serverScopeMode === 'selected' ? editServerIds : [],
                        allowedProtocols: protocolScopeMode === 'selected' ? editProtocols : [],
                        serverScopeMode,
                        protocolScopeMode,
                        limitIp: normalizeLimitIp(editLimitIp),
                        trafficLimitBytes: gigabytesInputToBytes(editTrafficLimitGb),
                    });
                    policySyncPartialFailure = policyRes.data?.obj?.partialFailure === true;
                } catch (policyErr) {
                    policySyncFailedMessage = policyErr.response?.data?.msg || policyErr.message || '订阅策略同步失败';
                }
            }

            // Update expiry if user has clients
            if (editHasClients) {
                const newExpiryTime = editExpiryDate
                    ? new Date(editExpiryDate).getTime()
                    : 0;
                try {
                    const expiryRes = await api.put(`/auth/users/${encodeURIComponent(editUser.id)}/update-expiry`, {
                        expiryTime: newExpiryTime,
                    });
                    if (expiryRes.data?.success) {
                        const r = expiryRes.data.obj;
                        if (policySyncFailedMessage) {
                            toast.error(`用户信息已更新，但${policySyncFailedMessage}`);
                        } else if (r.failed > 0 || policySyncPartialFailure) {
                            toast.success(`用户信息已更新，但节点同步有部分失败（到期时间成功 ${r.updated}/${r.total}）`);
                        } else if (r.updated > 0) {
                            toast.success(`用户信息、订阅策略和到期时间已更新（${r.updated} 个节点）`);
                        } else {
                            toast.success('用户信息和订阅策略已更新');
                        }
                    }
                } catch (expiryErr) {
                    const expiryFailedMessage = expiryErr.response?.data?.msg || expiryErr.message;
                    if (policySyncFailedMessage) {
                        toast.error(`用户信息已更新，但${policySyncFailedMessage}；到期时间更新也失败: ${expiryFailedMessage}`);
                    } else {
                        toast.error(`用户信息和订阅策略已更新，但到期时间更新失败: ${expiryFailedMessage}`);
                    }
                }
            } else {
                if (policySyncFailedMessage) {
                    toast.error(`用户信息已更新，但${policySyncFailedMessage}`);
                } else if (policySyncPartialFailure) {
                    toast.success('用户信息和订阅策略已更新，但部分节点同步失败');
                } else {
                    toast.success('用户信息和订阅策略已更新');
                }
            }

            closeEditModal();
            invalidateManagedUsersCache();
            await fetchData({ forceUsers: true });
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || t('comp.users.updateFailed'));
        }
        setEditSaving(false);
    };

    // --- Create user modal ---
    const openCreateModal = () => {
        setCreateUsername('');
        setCreateEmail('');
        setCreatePassword(generateSecurePassword());
        setCreateProvisionAfterCreate(true);
        setCreateSaving(false);
        setCreateOpen(true);
    };

    const closeCreateModal = () => {
        setCreateOpen(false);
        setCreateSaving(false);
    };

    const submitCreate = async (event) => {
        event.preventDefault();
        const username = String(createUsername || '').trim();
        const email = normalizeEmail(createEmail);
        const password = String(createPassword || '');

        if (!username) { toast.error(t('comp.users.usernameEmpty')); return; }
        if (!password) { toast.error(t('comp.users.passwordEmpty')); return; }
        const passwordError = getPasswordPolicyError(password, locale);
        if (passwordError) { toast.error(passwordError); return; }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error(t('comp.users.emailInvalid'));
            return;
        }

        setCreateSaving(true);
        try {
            const res = await api.post('/auth/users', {
                username,
                password,
                role: 'user',
                email,
                subscriptionEmail: email,
            });
            if (!res.data?.success || !res.data?.obj) {
                toast.error(res.data?.msg || t('comp.users.createFailed'));
                setCreateSaving(false);
                return;
            }

            const createdUser = res.data.obj;
            toast.success(`用户 ${createdUser.username || username} 已创建`);
            closeCreateModal();
            invalidateManagedUsersCache();
            await fetchData({ forceUsers: true });

            if (createProvisionAfterCreate) {
                const targetEmail = normalizeEmail(createdUser.subscriptionEmail || createdUser.email);
                if (!targetEmail) {
                    toast(copy.postCreateNoEmail);
                } else {
                    openProvisionModal(createdUser);
                }
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || t('comp.users.createFailed'));
            setCreateSaving(false);
        }
    };

    // Auto-open edit modal from URL query param
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
        <>
            <Header
                title={t('pages.usersHub.title')}
                eyebrow={t('pages.usersHub.eyebrow')}
            />
            <div className="page-content page-enter page-content--wide">
                <div className="users-toolbar glass-panel mb-6">
                    <div className="users-toolbar-main">
                        <div className="account-search-shell flex-1 max-w-sm">
                            <HiOutlineMagnifyingGlass className="account-search-icon" />
                            <input
                                className="form-input account-search-input"
                                placeholder="搜索用户名 / 邮箱..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <select className="form-select users-filter-select" style={{ width: 'auto', minWidth: 100 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="all">全部状态</option>
                            <option value="active">已开通</option>
                            <option value="enabled">已启用</option>
                            <option value="disabled">已停用</option>
                            <option value="pending">待审核</option>
                        </select>
                    </div>
                    <div className="users-toolbar-actions">
                        <div className="text-sm text-muted users-toolbar-summary">显示 {enrichedUsers.length} / {users.length} 位账号</div>
                        <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} title="导出CSV">
                            <HiOutlineArrowDownTray /> 导出
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchData({ forceUsers: true })} title="刷新">
                            <HiOutlineArrowPath /> 刷新
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={openCreateModal} title="添加账号">
                            <HiOutlineUserPlus /> 添加账号
                        </button>
                    </div>
                </div>

                {primaryError && !loading && (
                    <div className="glass-panel mb-4" role="alert">
                        <div className="text-sm font-semibold">{copy.userListLoadFailedTitle}</div>
                        <div className="text-sm text-muted mt-1">{primaryError}</div>
                    </div>
                )}

                {partialErrors.length > 0 && !primaryError && !loading && (
                    <div className="glass-panel mb-4" role="status">
                        <div className="text-sm font-semibold">{copy.degradedDataTitle}</div>
                        <div className="text-sm text-muted mt-1">{copy.degradedDataIntro}</div>
                        <div className="text-xs text-muted mt-2">{summarizePartialErrors(partialErrors, locale)}</div>
                    </div>
                )}

                {selectedIds.size > 0 && (
                    <div className="bulk-toolbar mb-4 users-bulk-toolbar">
                        <span className="bulk-toolbar-count">已选 {selectedIds.size} 个用户</span>
                        <button className={bulkToggleClassName} onClick={() => handleBulkSetEnabled(bulkToggleEnable)} disabled={bulkLoading}>
                            {bulkToggleIcon} {bulkToggleLabel}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())}>
                            取消选择
                        </button>
                    </div>
                )}

                {isCompactLayout ? (
                    <div className="users-mobile-list">
                        <div className="users-mobile-list-head glass-panel">
                            <label className="users-mobile-list-toggle">
                                <input
                                    type="checkbox"
                                    checked={enrichedUsers.length > 0 && selectedUsers.length === enrichedUsers.length}
                                    onChange={toggleSelectAll}
                                />
                                <span>全选当前列表</span>
                            </label>
                            <button
                                type="button"
                                className="table-sort-button users-sequence-sort-button"
                                onClick={() => setSequenceDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                aria-label={`按序号${sequenceDirection === 'asc' ? '降序' : '升序'}显示`}
                            >
                                <span>序号</span>
                                <span className="table-sort-button-icon" aria-hidden="true">
                                    {sequenceDirection === 'asc' ? <HiOutlineChevronUp /> : <HiOutlineChevronDown />}
                                </span>
                            </button>
                        </div>
                        {loading ? (
                            <div className="glass-panel p-4"><SkeletonTable rows={5} cols={1} /></div>
                        ) : primaryError ? (
                            <div className="glass-panel p-4">
                                <EmptyState title={copy.userListLoadFailedTitle} subtitle={primaryError} />
                            </div>
                        ) : enrichedUsers.length === 0 ? (
                            <div className="glass-panel p-4">
                                <EmptyState title={searchTerm ? '未找到匹配用户' : '暂无注册用户'} subtitle={searchTerm ? '请尝试其他搜索词' : '点击上方按钮添加用户'} />
                            </div>
                        ) : (
                            enrichedUsers.map((user, index) => renderMobileUserCard(user, index))
                        )}
                    </div>
                ) : (
                    <div className="table-container glass-panel users-table-shell">
                        <table className="table users-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 40 }}>
                                        <input type="checkbox" checked={enrichedUsers.length > 0 && selectedUsers.length === enrichedUsers.length} onChange={toggleSelectAll} />
                                    </th>
                                    <th>
                                        <button
                                            type="button"
                                            className="table-sort-button users-sequence-sort-button"
                                            onClick={() => setSequenceDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                            aria-label={`按序号${sequenceDirection === 'asc' ? '降序' : '升序'}显示`}
                                        >
                                            <span>序号</span>
                                            <span className="table-sort-button-icon" aria-hidden="true">
                                                {sequenceDirection === 'asc' ? <HiOutlineChevronUp /> : <HiOutlineChevronDown />}
                                            </span>
                                        </button>
                                    </th>
                                    <th className="users-identity-column">账号</th>
                                    <th className="table-cell-center users-status-column">状态</th>
                                    <th className="table-cell-center users-online-column">在线状态</th>
                                    <th className="table-cell-center users-node-count-column">节点数</th>
                                    <th className="text-right users-traffic-column">已用流量</th>
                                    <th className="table-cell-center users-expiry-column">到期时间</th>
                                    <th className="table-cell-actions users-actions-column">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={9}><SkeletonTable rows={8} cols={9} colTemplate="40px 88px 236px 120px 170px 90px 120px 144px 144px" /></td></tr>
                                ) : primaryError ? (
                                    <tr><td colSpan={9}>
                                        <EmptyState title={copy.userListLoadFailedTitle} subtitle={primaryError} />
                                    </td></tr>
                                ) : enrichedUsers.length === 0 ? (
                                    <tr><td colSpan={9}>
                                        <EmptyState title={searchTerm ? '未找到匹配用户' : '暂无注册用户'} subtitle={searchTerm ? '请尝试其他搜索词' : '点击上方按钮添加用户'} />
                                    </td></tr>
                                ) : (
                                    enrichedUsers.map((user, index) => {
                                        const sequenceNumber = sequenceDirection === 'asc'
                                            ? index + 1
                                            : enrichedUsers.length - index;
                                        const displayEmail = user.email || user.subscriptionEmail || '';
                                        const userExpiryLabel = user.clientData.count > 0
                                            ? formatExpiryLabel(user.clientData.expiryValues, locale)
                                            : '未开通';
                                        return (
                                            <tr
                                                key={user.id}
                                                className={`users-row ${selectedIds.has(user.id) ? 'users-row-selected table-row-selected' : ''}${selectedIds.size > 0 ? ' table-row-selectable' : ''}`}
                                                onClick={selectedIds.size > 0 ? () => toggleSelect(user.id) : undefined}
                                            >
                                                <td className="mobile-checkbox-cell" data-label="" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)} /></td>
                                                <td data-label="序号" onClick={(e) => e.stopPropagation()}>
                                                    <span className="cell-mono users-sequence-number">{sequenceNumber}</span>
                                                </td>
                                                <td
                                                    data-label="账号"
                                                    className="users-identity-cell"
                                                    onClick={(e) => { e.stopPropagation(); navigate(`/clients/${user.id}`); }}
                                                >
                                                    <button
                                                        type="button"
                                                        className="table-cell-link table-cell-link-button users-identity-link"
                                                        title={displayEmail ? `${user.username}\n${displayEmail}` : user.username}
                                                    >
                                                        <span className="users-identity-primary">{user.username}</span>
                                                        <span className={`users-identity-secondary${displayEmail ? '' : ' is-empty'}`}>
                                                            {displayEmail || copy.unsetEmail}
                                                        </span>
                                                    </button>
                                                </td>
                                                <td data-label="状态" className="table-cell-center users-status-cell">
                                                    <span className={`badge ${user.status.badge}`}>{user.status.label}</span>
                                                </td>
                                                <td data-label="在线状态" className="table-cell-center users-online-cell">
                                                    <div className="flex items-center gap-2 flex-wrap users-online-stack">
                                                        <span className={`badge ${user.onlineStatus.badge}`}>{user.onlineStatus.label}</span>
                                                        {user.onlineStatus.detail ? <span className="text-xs text-muted font-mono">{user.onlineStatus.detail}</span> : null}
                                                    </div>
                                                </td>
                                                <td data-label="节点数" className="table-cell-center users-node-count-cell">{user.clientData.count || '-'}</td>
                                                <td
                                                    data-label="已用流量"
                                                    className="users-traffic-cell"
                                                    title={user.clientData.totalUsed ? `总计 ${formatBytes(user.clientData.totalUsed)}` : '-'}
                                                >
                                                    {user.clientData.totalUsed ? (
                                                        <div className="users-traffic-stack">
                                                            <span className="text-success">↑{formatBytes(user.clientData.totalUp)}</span>
                                                            <span className="text-info">↓{formatBytes(user.clientData.totalDown)}</span>
                                                        </div>
                                                    ) : '-'}
                                                </td>
                                                <td
                                                    data-label="到期时间"
                                                    className="cell-mono table-cell-center users-expiry-cell"
                                                    title={user.clientData.count > 0 ? userExpiryLabel : '-'}
                                                >
                                                    {user.clientData.count > 0 ? userExpiryLabel : '-'}
                                                </td>
                                                <td data-label="" className="table-cell-actions users-actions-cell" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex gap-2 flex-wrap users-row-actions">
                                                        {renderUserActionButtons(user)}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create User Modal */}
            {createOpen && (
                <ModalShell isOpen={createOpen} onClose={closeCreateModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">添加用户账号</h3>
                            <button type="button" className="modal-close" onClick={closeCreateModal}><HiOutlineXMark /></button>
                        </div>
                        <form onSubmit={submitCreate}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">用户名</label>
                                    <input
                                        className="form-input"
                                        value={createUsername}
                                        onChange={(e) => setCreateUsername(e.target.value)}
                                        placeholder="例如: user001"
                                        autoComplete="off"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">邮箱</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={createEmail}
                                        onChange={(e) => setCreateEmail(e.target.value)}
                                        placeholder="同时作为登录邮箱和订阅绑定邮箱"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">初始密码</label>
                                    <div className="flex gap-2">
                                        <input
                                            type={showCreatePassword ? 'text' : 'password'}
                                            className="form-input font-mono"
                                            value={createPassword}
                                            onChange={(e) => setCreatePassword(e.target.value)}
                                            placeholder="至少8位，含3类字符"
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowCreatePassword((v) => !v)}
                                            title={showCreatePassword ? '隐藏密码' : '显示密码'}
                                        >
                                            {showCreatePassword ? <HiOutlineEyeSlash /> : <HiOutlineEye />}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => { copyToClipboard(createPassword); toast.success(copy.passwordCopied); }}
                                            title="复制密码"
                                        >
                                            <HiOutlineClipboard />
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setCreatePassword(generateSecurePassword())}
                                        >
                                            <HiOutlineArrowPath /> 生成
                                        </button>
                                    </div>
                                    <p className="text-muted text-sm mt-1">{getPasswordPolicyHint(locale)}</p>
                                </div>
                                <div className="form-group">
                                    <label className="badge badge-info flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={createProvisionAfterCreate}
                                            onChange={(e) => setCreateProvisionAfterCreate(e.target.checked)}
                                        />
                                        {copy.createProvisionToggle}
                                    </label>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>取消</button>
                                <button type="submit" className="btn btn-primary" disabled={createSaving}>
                                    {createSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 创建账号</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </ModalShell>
            )}

            {/* Edit User Modal */}
            {editOpen && editUser && (
                <ModalShell isOpen={editOpen} onClose={closeEditModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">编辑用户 - {editUser.username}</h3>
                            <button type="button" className="modal-close" onClick={closeEditModal}><HiOutlineXMark /></button>
                        </div>
                        <form onSubmit={submitEdit}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">用户名</label>
                                    <input
                                        className="form-input"
                                        value={editUsername}
                                        onChange={(e) => setEditUsername(e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">邮箱</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={editEmail}
                                        onChange={(e) => setEditEmail(e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">重置密码（留空则不修改）</label>
                                    <div className="flex gap-2">
                                        <input
                                            type={showEditPassword ? 'text' : 'password'}
                                            className="form-input font-mono"
                                            value={editPassword}
                                            onChange={(e) => setEditPassword(e.target.value)}
                                            placeholder="留空不修改"
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowEditPassword((v) => !v)}
                                        >
                                            {showEditPassword ? <HiOutlineEyeSlash /> : <HiOutlineEye />}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => { const p = generateSecurePassword(); setEditPassword(p); setShowEditPassword(true); }}
                                        >
                                            <HiOutlineArrowPath /> 生成
                                        </button>
                                    </div>
                                    <p className="text-muted text-sm mt-1">{getPasswordPolicyHint(locale)}</p>
                                </div>
                                {editHasClients && (
                                    <div className="form-group">
                                        <label className="form-label">到期时间</label>
                                        <input
                                            type="datetime-local"
                                            className="form-input"
                                            value={editExpiryDate}
                                            onChange={(e) => setEditExpiryDate(e.target.value)}
                                        />
                                        <p className="text-muted text-sm mt-1">留空 = 永不过期，修改后将同步更新所有节点客户端</p>
                                    </div>
                                )}
                                <div className="form-group">
                                    <label className="form-label">订阅策略</label>
                                    {editPolicyLoading ? (
                                        <div className="text-center p-4"><span className="spinner" /></div>
                                    ) : (
                                        <>
                                            <div className="card mb-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-medium">可访问服务器</span>
                                                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editNoServerLimit}
                                                            onChange={(e) => setEditNoServerLimit(e.target.checked)}
                                                        />
                                                        不限制
                                                    </label>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {servers.map((s) => (
                                                        <label key={s.id} className="badge badge-neutral flex items-center gap-2 cursor-pointer text-xs">
                                                            <input
                                                                type="checkbox"
                                                                disabled={editNoServerLimit}
                                                                checked={editServerIds.includes(s.id)}
                                                                onChange={(e) => {
                                                                    setEditServerIds((prev) =>
                                                                        e.target.checked
                                                                            ? Array.from(new Set([...prev, s.id]))
                                                                            : prev.filter((x) => x !== s.id)
                                                                    );
                                                                }}
                                                            />
                                                            {s.name}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="card">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-medium">可用协议</span>
                                                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editNoProtocolLimit}
                                                            onChange={(e) => setEditNoProtocolLimit(e.target.checked)}
                                                        />
                                                        不限制
                                                    </label>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {PROTOCOL_OPTIONS.map((p) => (
                                                        <label key={p.key} className="badge badge-neutral flex items-center gap-2 cursor-pointer text-xs">
                                                            <input
                                                                type="checkbox"
                                                                disabled={editNoProtocolLimit}
                                                                checked={editProtocols.includes(p.key)}
                                                                onChange={(e) => {
                                                                    setEditProtocols((prev) =>
                                                                        e.target.checked
                                                                            ? Array.from(new Set([...prev, p.key]))
                                                                            : prev.filter((x) => x !== p.key)
                                                                    );
                                                                }}
                                                            />
                                                            {p.label}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="card mt-3">
                                                <div className="text-sm font-medium mb-2">统一限额</div>
                                                <div className="text-xs text-muted mb-3">这里保存的是该用户的默认限额；单个入站用户如有手工覆盖，会优先使用覆盖值。</div>
                                                <div className="grid-auto-280-tight">
                                                    <div className="form-group mb-0">
                                                        <label className="form-label">IP 限制</label>
                                                        <input
                                                            type="number"
                                                            className="form-input"
                                                            min={0}
                                                            value={editLimitIp}
                                                            onChange={(e) => setEditLimitIp(e.target.value)}
                                                        />
                                                        <p className="text-muted text-sm mt-1">0 = 不限制连接 IP 数量</p>
                                                    </div>
                                                    <div className="form-group mb-0">
                                                        <label className="form-label">总流量上限</label>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                className="form-input"
                                                                min={0}
                                                                step="0.5"
                                                                value={editTrafficLimitGb}
                                                                onChange={(e) => setEditTrafficLimitGb(e.target.value)}
                                                            />
                                                            <span className="text-sm text-muted">GB</span>
                                                        </div>
                                                        <p className="text-muted text-sm mt-1">0 = 不限制总流量</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeEditModal}>取消</button>
                                <button type="submit" className="btn btn-primary" disabled={editSaving}>
                                    {editSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 保存</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </ModalShell>
            )}

            {/* Provision Modal */}
            {provisionOpen && provisionTargetUser && (
                <ModalShell isOpen={provisionOpen} onClose={closeProvisionModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{copy.provisionModalTitle} - {provisionTargetUser.username}</h3>
                            <button type="button" className="modal-close" onClick={closeProvisionModal}><HiOutlineXMark /></button>
                        </div>
                        <form onSubmit={submitProvision}>
                            <div className="modal-body">
                                {provisionInitLoading ? (
                                    <div className="text-center p-6"><span className="spinner" /></div>
                                ) : (
                                    <>
                                        <div className="form-group">
                                            <label className="form-label">订阅绑定邮箱</label>
                                            <input
                                                type="email"
                                                className="form-input"
                                                value={provisionEmail}
                                                onChange={(e) => setProvisionEmail(e.target.value)}
                                                placeholder="与节点客户端配置一致的邮箱"
                                            />
                                        </div>

                                        <div className="card mb-4">
                                            <div className="text-sm font-medium mb-2">统一限额</div>
                                            <div className="text-xs text-muted mb-3">开通后会把到期时间、IP 限制和总流量上限同步到该用户的默认策略与选中入站客户端。</div>
                                            <div className="grid-auto-280-tight">
                                                <div className="form-group mb-0">
                                                    <label className="form-label">到期时间</label>
                                                    <input
                                                        type="datetime-local"
                                                        className="form-input"
                                                        value={provisionExpiryDate}
                                                        onChange={(e) => setProvisionExpiryDate(e.target.value)}
                                                    />
                                                    <p className="text-muted text-sm mt-1">留空 = 永不过期</p>
                                                    {inboundExpiries.length > 0 && (
                                                        <div className="mt-2">
                                                            <div className="text-xs text-muted mb-1">参考：当前入站到期时间</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {inboundExpiries
                                                                    .filter((e) => e.expiryTime > Date.now())
                                                                    .slice(0, 6)
                                                                    .map((e, i) => {
                                                                        const dateStr = formatDateOnly(e.expiryTime, locale);
                                                                        return (
                                                                            <button
                                                                                key={i}
                                                                                type="button"
                                                                                className="badge badge-neutral cursor-pointer"
                                                                                title={`${e.serverName} / ${e.inboundRemark}（${e.clientCount} 客户端）`}
                                                                                onClick={() => setProvisionExpiryDate(toLocalDateTimeString(e.expiryTime))}
                                                                            >
                                                                                {e.serverName}/{e.inboundRemark}: {dateStr}
                                                                            </button>
                                                                        );
                                                                    })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="form-group mb-0">
                                                    <label className="form-label">IP 限制</label>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        min={0}
                                                        value={provisionLimitIp}
                                                        onChange={(e) => setProvisionLimitIp(e.target.value)}
                                                    />
                                                    <p className="text-xs text-muted mt-1">0 = 不限制连接 IP 数量</p>
                                                </div>
                                                <div className="form-group mb-0">
                                                    <label className="form-label">总流量上限</label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            className="form-input"
                                                            min={0}
                                                            step="0.5"
                                                            value={provisionTrafficLimitGb}
                                                            onChange={(e) => setProvisionTrafficLimitGb(e.target.value)}
                                                        />
                                                        <span className="text-sm text-muted">GB</span>
                                                    </div>
                                                    <p className="text-xs text-muted mt-1">0 = 不限制总流量</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">
                                                选择入站
                                                <span className="text-muted text-xs ml-2">
                                                    已选 {provisionSelectedInboundKeys.size} / {allInbounds.length}
                                                </span>
                                            </label>
                                            <div className="flex gap-2 mb-2">
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => setProvisionSelectedInboundKeys(new Set(allInbounds.map((ib) => ib.key)))}
                                                >
                                                    全选
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => setProvisionSelectedInboundKeys(new Set())}
                                                >
                                                    全不选
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-1" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                                                {allInbounds.length === 0 ? (
                                                    <span className="text-sm text-muted">暂无可用入站</span>
                                                ) : allInbounds.map((ib) => {
                                                    const checked = provisionSelectedInboundKeys.has(ib.key);
                                                    const expiryLabel = ib.expiryTime > 0
                                                        ? formatDateOnly(ib.expiryTime, locale)
                                                        : '永久';
                                                    return (
                                                        <label
                                                            key={ib.key}
                                                            className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer text-sm ${checked ? 'bg-white/5' : ''}`}
                                                            style={{ border: '1px solid var(--border-color)' }}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={(e) => {
                                                                    setProvisionSelectedInboundKeys((prev) => {
                                                                        const next = new Set(prev);
                                                                        if (e.target.checked) next.add(ib.key);
                                                                        else next.delete(ib.key);
                                                                        return next;
                                                                    });
                                                                }}
                                                            />
                                                            <span className="font-medium">{ib.serverName}</span>
                                                            <span className="text-muted">{ib.remark || ib.protocol}</span>
                                                            <span className="badge badge-neutral text-xs">{ib.protocol}:{ib.port}</span>
                                                            <span className="text-muted text-xs ml-auto">到期: {expiryLabel}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </>
                                )}

                                {provisionResult && (
                                    <div className="card">
                                        <div className="card-header">
                                            <span className="card-title">开通结果</span>
                                        </div>
                                        <div className="text-sm mb-3" style={{ color: 'var(--accent-success)' }}>
                                            {provisionResult.successMessage || '订阅已成功开通'}
                                        </div>
                                        {provisionResult.deployment && provisionResult.deployment.total > 0 && (
                                            <div className="mb-3">
                                                <div className="text-sm mb-2">
                                                    <span className="font-medium">节点下发：</span>
                                                    <span className="badge badge-success mr-1">创建 {provisionResult.deployment.created}</span>
                                                    <span className="badge badge-info mr-1">更新 {provisionResult.deployment.updated || 0}</span>
                                                    <span className="badge badge-neutral mr-1">跳过 {provisionResult.deployment.skipped}（已存在）</span>
                                                    {provisionResult.deployment.failed > 0 && (
                                                        <span className="badge badge-danger">失败 {provisionResult.deployment.failed}</span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex flex-col gap-2">
                                            {provisionLinks.map((item) => (
                                                <div key={item.key} className="flex gap-2">
                                                    <input className="form-input font-mono text-xs" value={item.url} readOnly />
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={async () => { await copyToClipboard(item.url); toast.success(`${item.label} 链接已复制`); }}
                                                    >
                                                        <HiOutlineClipboard /> 复制{item.label}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <SubscriptionClientLinks bundle={provisionResult.bundle} />
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeProvisionModal}>关闭</button>
                                <button type="submit" className="btn btn-primary" disabled={provisionSaving || provisionInitLoading}>
                                    {provisionSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 确认开通</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </ModalShell>
            )}
        </>
    );
}
