import React, { useEffect, useMemo, useState } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { copyToClipboard, formatBytes } from '../../utils/format.js';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../../utils/passwordPolicy.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import { normalizeEmail } from '../../utils/protocol.js';
import { generateSecurePassword } from '../../utils/crypto.js';
import toast from 'react-hot-toast';
import {
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineArrowPath,
    HiOutlineMagnifyingGlass,
    HiOutlineLink,
    HiOutlineClipboard,
    HiOutlineUsers,
    HiOutlineKey,
    HiOutlineCheck,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineXMark,
    HiOutlineUserPlus,
    HiOutlineNoSymbol,
    HiOutlinePlayCircle,
} from 'react-icons/hi2';
import { QRCodeSVG } from 'qrcode.react';

const PROTOCOL_OPTIONS = [
    { key: 'vless', label: 'VLESS' },
    { key: 'vmess', label: 'VMess' },
    { key: 'trojan', label: 'Trojan' },
    { key: 'shadowsocks', label: 'Shadowsocks' },
];

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

function formatExpiryLabel(expiryValues) {
    if (!expiryValues || expiryValues.length === 0) return '永久';
    const earliest = Math.min(...expiryValues);
    return new Date(earliest).toLocaleDateString('zh-CN');
}

export default function UsersHub() {
    const { servers } = useServer();
    const confirmAction = useConfirm();

    const [users, setUsers] = useState([]);
    const [clientsMap, setClientsMap] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Provision modal
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [provisionTargetUser, setProvisionTargetUser] = useState(null);
    const [provisionInitLoading, setProvisionInitLoading] = useState(false);
    const [provisionSaving, setProvisionSaving] = useState(false);
    const [provisionEmail, setProvisionEmail] = useState('');
    const [provisionExpiryDate, setProvisionExpiryDate] = useState('');
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

    // Create user modal
    const [createOpen, setCreateOpen] = useState(false);
    const [createSaving, setCreateSaving] = useState(false);
    const [createUsername, setCreateUsername] = useState('');
    const [createEmail, setCreateEmail] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [showCreatePassword, setShowCreatePassword] = useState(true);
    const [createProvisionAfterCreate, setCreateProvisionAfterCreate] = useState(true);

    // Subscription modal
    const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
    const [subscriptionEmail, setSubscriptionEmail] = useState('');
    const [subscriptionLoading, setSubscriptionLoading] = useState(false);
    const [subscriptionResult, setSubscriptionResult] = useState(null);
    const [subscriptionProfileKey, setSubscriptionProfileKey] = useState('v2rayn');

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersRes, ...serverResults] = await Promise.all([
                api.get('/auth/users'),
                ...servers.map((s) =>
                    api.get(`/panel/${s.id}/panel/api/inbounds/list`).catch(() => ({ data: { obj: [] } }))
                ),
            ]);
            const userList = Array.isArray(usersRes.data?.obj) ? usersRes.data.obj : [];
            setUsers(userList.filter((u) => u.role !== 'admin'));

            // Build email → client data map + collect inbound info
            const emailMap = new Map();
            const expiryRef = [];
            const inboundList = [];
            serverResults.forEach((res, idx) => {
                const server = servers[idx];
                const inbounds = res.data?.obj || [];
                inbounds.forEach((ib) => {
                    const protocol = String(ib.protocol || '').toLowerCase();
                    if (!['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) return;
                    if (ib.enable === false) return;

                    let ibClients = [];
                    try {
                        const settings = JSON.parse(ib.settings);
                        ibClients = settings.clients || [];
                    } catch { }

                    const ibKey = `${server.id}:${ib.id}`;

                    // Collect representative expiry for this inbound
                    const ibExpiries = ibClients
                        .map((cl) => Number(cl.expiryTime || 0))
                        .filter((t) => t > 0);
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
                            emailMap.set(email, { count: 0, totalUsed: 0, expiryValues: [] });
                        }
                        const entry = emailMap.get(email);
                        entry.count += 1;
                        entry.totalUsed += Number(cl.up || 0) + Number(cl.down || 0);
                        if (Number(cl.expiryTime || 0) > 0) {
                            entry.expiryValues.push(Number(cl.expiryTime));
                        }
                    });
                });
            });
            setClientsMap(emailMap);
            setInboundExpiries(expiryRef);
            setAllInbounds(inboundList);
        } catch (err) {
            console.error('Failed to fetch users data', err);
            toast.error('加载用户数据失败');
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, [servers]);

    const enrichedUsers = useMemo(() => {
        const search = String(searchTerm || '').trim().toLowerCase();
        return users
            .map((user) => {
                const subEmail = normalizeEmail(user.subscriptionEmail);
                const loginEmail = normalizeEmail(user.email);
                const clientData = clientsMap.get(subEmail) || clientsMap.get(loginEmail) || { count: 0, totalUsed: 0, expiryValues: [] };
                const status = getUserStatus(user, clientData.count);
                return { ...user, clientData, status };
            })
            .filter((user) => {
                if (!search) return true;
                return [user.username, user.email, user.subscriptionEmail, user.status.label]
                    .some((v) => String(v || '').toLowerCase().includes(search));
            })
            .sort((a, b) => {
                // Pending first, then by creation date descending
                const order = { pending: 0, enabled: 1, active: 2, disabled: 3 };
                const aOrder = order[a.status.key] ?? 4;
                const bOrder = order[b.status.key] ?? 4;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            });
    }, [users, clientsMap, searchTerm]);

    // --- Set enabled ---
    const handleSetEnabled = async (user, enabled) => {
        const action = enabled ? '启用' : '停用';
        const ok = await confirmAction({
            title: `${action}用户`,
            message: `确定${action}用户 ${user.username} 吗？`,
            details: enabled ? undefined : '停用后用户将无法登录，3x-ui客户端也会被删除。',
            confirmText: `确认${action}`,
            tone: enabled ? 'success' : 'danger',
        });
        if (!ok) return;

        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(user.id)}/set-enabled`, { enabled });
            if (res.data?.success) {
                toast.success(`用户 ${user.username} 已${action}`);
                await fetchData();
            } else {
                toast.error(res.data?.msg || `${action}失败`);
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || `${action}失败`);
        }
    };

    // --- Delete user ---
    const handleDelete = async (user) => {
        const ok = await confirmAction({
            title: '删除用户',
            message: `确定删除用户 ${user.username} 吗？`,
            details: '删除后不可恢复，关联的订阅和3x-ui客户端也会被清理。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        try {
            const res = await api.delete(`/auth/users/${encodeURIComponent(user.id)}`);
            if (res.data?.success) {
                toast.success(`用户 ${user.username} 已删除`);
                await fetchData();
            } else {
                toast.error(res.data?.msg || '删除失败');
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '删除失败');
        }
    };

    // --- Provision modal ---
    const closeProvisionModal = () => {
        setProvisionOpen(false);
        setProvisionTargetUser(null);
        setProvisionInitLoading(false);
        setProvisionSaving(false);
        setProvisionEmail('');
        setProvisionExpiryDate('');
        setProvisionResult(null);
        setProvisionSelectedInboundKeys(new Set());
    };

    const openProvisionModal = (user) => {
        const suggestedEmail = normalizeEmail(user?.subscriptionEmail || user?.email);
        if (!suggestedEmail) {
            toast.error('该用户未配置邮箱，无法开通订阅');
            return;
        }
        setProvisionTargetUser(user);
        setProvisionEmail(suggestedEmail);
        setProvisionResult(null);
        setProvisionInitLoading(false);

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
    };

    const submitProvision = async (event) => {
        event.preventDefault();
        if (!provisionTargetUser?.id) return;

        const provisionNormalizedEmail = normalizeEmail(provisionEmail);
        if (!provisionNormalizedEmail) {
            toast.error('订阅绑定邮箱不能为空');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(provisionNormalizedEmail)) {
            toast.error('订阅绑定邮箱格式不正确');
            return;
        }
        if (provisionSelectedInboundKeys.size === 0) {
            toast.error('请至少选择一个入站');
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
            });
            if (!res.data?.success) {
                toast.error(res.data?.msg || '开通失败');
                setProvisionSaving(false);
                return;
            }

            const boundEmail = normalizeEmail(res.data?.obj?.subscription?.email || provisionNormalizedEmail);
            let subscriptionPayload = null;
            try {
                const subRes = await api.get(`/subscriptions/${encodeURIComponent(boundEmail)}`);
                subscriptionPayload = subRes.data?.obj || null;
            } catch (subErr) {
                toast.error(subErr.response?.data?.msg || subErr.message || '订阅链接获取失败');
            }

            setProvisionResult({
                email: boundEmail,
                deployment: res.data?.obj?.deployment || null,
                subscriptionUrl: subscriptionPayload?.subscriptionUrl || '',
                subscriptionUrlV2rayn: subscriptionPayload?.subscriptionUrlV2rayn || '',
                subscriptionUrlRaw: subscriptionPayload?.subscriptionUrlRaw || '',
                subscriptionUrlClash: subscriptionPayload?.subscriptionUrlClash || '',
                subscriptionUrlSingbox: subscriptionPayload?.subscriptionUrlSingbox || '',
                subscriptionConverterConfigured: subscriptionPayload?.subscriptionConverterConfigured === true,
            });

            const dep = res.data?.obj?.deployment;
            if (dep && dep.failed > 0) {
                toast.success(`订阅已开通，节点下发部分失败（创建 ${dep.created} / 跳过 ${dep.skipped} / 失败 ${dep.failed}）`);
            } else if (dep && dep.created > 0) {
                toast.success(`订阅已开通，已下发 ${dep.created} 个客户端到节点`);
            } else {
                toast.success('订阅已开通，链接已生成');
            }
            await fetchData();
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '开通失败');
        }
        setProvisionSaving(false);
    };

    const provisionLinks = useMemo(() => {
        if (!provisionResult) return [];
        const items = [
            { key: 'v2rayn', label: 'v2rayN', url: provisionResult.subscriptionUrlV2rayn || provisionResult.subscriptionUrl },
            { key: 'raw', label: 'Raw', url: provisionResult.subscriptionUrlRaw },
            { key: 'clash', label: 'Clash', url: provisionResult.subscriptionUrlClash },
            { key: 'singbox', label: 'sing-box', url: provisionResult.subscriptionUrlSingbox },
        ];
        return items.filter((item) => String(item.url || '').trim());
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
            toast.error('用户名不能为空');
            return;
        }

        const email = normalizeEmail(editEmail);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error('邮箱格式不正确');
            return;
        }

        const payload = { username, email };
        if (editPassword) {
            const passwordError = getPasswordPolicyError(editPassword);
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
                toast.error(res.data?.msg || '更新失败');
                setEditSaving(false);
                return;
            }

            // Update policy
            const policyEmail = normalizeEmail(editUser.subscriptionEmail || editUser.email);
            if (policyEmail) {
                const serverScopeMode = editNoServerLimit ? 'all' : (editServerIds.length > 0 ? 'selected' : 'none');
                const protocolScopeMode = editNoProtocolLimit ? 'all' : (editProtocols.length > 0 ? 'selected' : 'none');
                try {
                    await api.put(`/user-policy/${encodeURIComponent(policyEmail)}`, {
                        allowedServerIds: serverScopeMode === 'selected' ? editServerIds : [],
                        allowedProtocols: protocolScopeMode === 'selected' ? editProtocols : [],
                        serverScopeMode,
                        protocolScopeMode,
                    });
                } catch { /* best-effort */ }
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
                        if (r.failed > 0) {
                            toast.success(`用户信息已更新，到期时间更新: ${r.updated}/${r.total} 成功`);
                        } else if (r.updated > 0) {
                            toast.success(`用户信息及到期时间已更新（${r.updated} 个节点）`);
                        } else {
                            toast.success('用户信息已更新');
                        }
                    }
                } catch (expiryErr) {
                    toast.error('用户信息已更新，但到期时间更新失败: ' + (expiryErr.response?.data?.msg || expiryErr.message));
                }
            } else {
                toast.success('用户信息已更新');
            }

            closeEditModal();
            await fetchData();
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '更新失败');
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

        if (!username) { toast.error('用户名不能为空'); return; }
        if (!password) { toast.error('初始密码不能为空'); return; }
        const passwordError = getPasswordPolicyError(password);
        if (passwordError) { toast.error(passwordError); return; }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error('邮箱格式不正确');
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
                toast.error(res.data?.msg || '创建用户失败');
                setCreateSaving(false);
                return;
            }

            const createdUser = res.data.obj;
            toast.success(`用户 ${createdUser.username || username} 已创建`);
            closeCreateModal();
            await fetchData();

            if (createProvisionAfterCreate) {
                const targetEmail = normalizeEmail(createdUser.subscriptionEmail || createdUser.email);
                if (!targetEmail) {
                    toast('用户已创建，但未设置邮箱，无法立即分配节点');
                } else {
                    openProvisionModal(createdUser);
                }
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '创建用户失败');
            setCreateSaving(false);
        }
    };

    // --- Subscription modal ---
    const openSubscriptionModal = (email) => {
        const normalized = normalizeEmail(email);
        if (!normalized) {
            toast.error('该用户没有订阅邮箱');
            return;
        }
        setSubscriptionEmail(normalized);
        setSubscriptionResult(null);
        setSubscriptionModalOpen(true);
    };

    const loadSubscription = async (email) => {
        if (!email) return;
        setSubscriptionLoading(true);
        try {
            const res = await api.get(`/subscriptions/${encodeURIComponent(email)}`);
            const subPayload = res.data?.obj || {};
            const bundle = buildSubscriptionProfileBundle(subPayload);
            setSubscriptionResult({
                email: subPayload.email || email,
                bundle,
                subscriptionActive: subPayload.subscriptionActive !== false,
            });
            if (bundle.defaultProfileKey) {
                setSubscriptionProfileKey(bundle.defaultProfileKey);
            }
        } catch (error) {
            setSubscriptionResult(null);
            toast.error(error.response?.data?.msg || error.message || '订阅加载失败');
        }
        setSubscriptionLoading(false);
    };

    useEffect(() => {
        if (subscriptionModalOpen && subscriptionEmail) {
            loadSubscription(subscriptionEmail);
        }
    }, [subscriptionModalOpen, subscriptionEmail]);

    const activeSubscriptionProfile = useMemo(
        () => findSubscriptionProfile(subscriptionResult?.bundle, subscriptionProfileKey),
        [subscriptionResult, subscriptionProfileKey]
    );

    const handleCopySubscription = async () => {
        const profile = findSubscriptionProfile(subscriptionResult?.bundle, subscriptionProfileKey);
        if (!profile?.url) {
            toast.error('暂无可复制地址');
            return;
        }
        await copyToClipboard(profile.url);
        toast.success(`${profile.label} 订阅地址已复制`);
    };

    return (
        <>
            <Header title="用户管理" />
            <div className="page-content page-enter">
                <div className="flex flex-col gap-4 mb-6">
                    {/* Toolbar */}
                    <div className="flex items-center gap-4 glass-panel p-4 mobile-toolbar">
                        <div className="account-search-shell flex-1 max-w-sm">
                            <HiOutlineMagnifyingGlass className="account-search-icon" />
                            <input
                                className="form-input account-search-input"
                                placeholder="搜索用户名 / 邮箱..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={fetchData} title="刷新">
                            <HiOutlineArrowPath /> 刷新
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={openCreateModal} title="添加账号">
                            <HiOutlineUserPlus /> 添加账号
                        </button>
                    </div>
                </div>

                <div className="table-container glass-panel">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>用户名</th>
                                <th>邮箱</th>
                                <th>状态</th>
                                <th>节点数</th>
                                <th>已用流量</th>
                                <th>到期时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={7} className="text-center table-pad-64"><div className="spinner mx-auto" /></td></tr>
                            ) : enrichedUsers.length === 0 ? (
                                <tr><td colSpan={7} className="text-center table-empty">
                                    {searchTerm ? '未找到匹配用户' : '暂无注册用户'}
                                </td></tr>
                            ) : (
                                enrichedUsers.map((user) => (
                                    <tr key={user.id}>
                                        <td data-label="用户名" className="font-medium">{user.username}</td>
                                        <td data-label="邮箱" className="text-sm text-muted">{user.email || user.subscriptionEmail || '-'}</td>
                                        <td data-label="状态">
                                            <span className={`badge ${user.status.badge}`}>{user.status.label}</span>
                                        </td>
                                        <td data-label="节点数">{user.clientData.count || '-'}</td>
                                        <td data-label="已用流量">{user.clientData.totalUsed ? formatBytes(user.clientData.totalUsed) : '-'}</td>
                                        <td data-label="到期时间">{user.clientData.count > 0 ? formatExpiryLabel(user.clientData.expiryValues) : '-'}</td>
                                        <td data-label="" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex gap-2 flex-wrap">
                                                {/* Pending: Approve + Delete */}
                                                {user.status.key === 'pending' && (
                                                    <>
                                                        <button
                                                            className="btn btn-success btn-sm"
                                                            title="通过审核"
                                                            onClick={() => handleSetEnabled(user, true)}
                                                        >
                                                            <HiOutlineCheck /> 通过
                                                        </button>
                                                        <button
                                                            className="btn btn-danger btn-sm btn-icon"
                                                            title="删除"
                                                            onClick={() => handleDelete(user)}
                                                        >
                                                            <HiOutlineTrash />
                                                        </button>
                                                    </>
                                                )}

                                                {/* Enabled (no subscription): Provision + Edit + Disable + Delete */}
                                                {user.status.key === 'enabled' && (
                                                    <>
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            title="开通订阅"
                                                            onClick={() => openProvisionModal(user)}
                                                        >
                                                            <HiOutlinePlusCircle /> 开通订阅
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary btn-sm btn-icon"
                                                            title="编辑"
                                                            onClick={() => openEditModal(user)}
                                                        >
                                                            <HiOutlinePencilSquare />
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary btn-sm btn-icon"
                                                            title="停用"
                                                            onClick={() => handleSetEnabled(user, false)}
                                                        >
                                                            <HiOutlineNoSymbol />
                                                        </button>
                                                        <button
                                                            className="btn btn-danger btn-sm btn-icon"
                                                            title="删除"
                                                            onClick={() => handleDelete(user)}
                                                        >
                                                            <HiOutlineTrash />
                                                        </button>
                                                    </>
                                                )}

                                                {/* Active (has subscription): Subscription Link + Edit + Disable + Delete */}
                                                {user.status.key === 'active' && (
                                                    <>
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            title="订阅链接"
                                                            onClick={() => openSubscriptionModal(user.subscriptionEmail || user.email)}
                                                        >
                                                            <HiOutlineLink /> 订阅链接
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary btn-sm btn-icon"
                                                            title="编辑"
                                                            onClick={() => openEditModal(user)}
                                                        >
                                                            <HiOutlinePencilSquare />
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary btn-sm btn-icon"
                                                            title="停用"
                                                            onClick={() => handleSetEnabled(user, false)}
                                                        >
                                                            <HiOutlineNoSymbol />
                                                        </button>
                                                        <button
                                                            className="btn btn-danger btn-sm btn-icon"
                                                            title="删除"
                                                            onClick={() => handleDelete(user)}
                                                        >
                                                            <HiOutlineTrash />
                                                        </button>
                                                    </>
                                                )}

                                                {/* Disabled: Enable + Delete */}
                                                {user.status.key === 'disabled' && (
                                                    <>
                                                        <button
                                                            className="btn btn-success btn-sm"
                                                            title="启用"
                                                            onClick={() => handleSetEnabled(user, true)}
                                                        >
                                                            <HiOutlinePlayCircle /> 启用
                                                        </button>
                                                        <button
                                                            className="btn btn-danger btn-sm btn-icon"
                                                            title="删除"
                                                            onClick={() => handleDelete(user)}
                                                        >
                                                            <HiOutlineTrash />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create User Modal */}
            {createOpen && (
                <div className="modal-overlay" onClick={closeCreateModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">添加用户账号</h3>
                            <button className="modal-close" onClick={closeCreateModal}><HiOutlineXMark /></button>
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
                                            onClick={() => { copyToClipboard(createPassword); toast.success('密码已复制到剪贴板'); }}
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
                                    <p className="text-muted text-sm mt-1">{PASSWORD_POLICY_HINT}</p>
                                </div>
                                <div className="form-group">
                                    <label className="badge badge-info flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={createProvisionAfterCreate}
                                            onChange={(e) => setCreateProvisionAfterCreate(e.target.checked)}
                                        />
                                        创建后立即进入"开通订阅/分配节点"
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
                </div>
            )}

            {/* Edit User Modal */}
            {editOpen && editUser && (
                <div className="modal-overlay" onClick={closeEditModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">编辑用户 - {editUser.username}</h3>
                            <button className="modal-close" onClick={closeEditModal}><HiOutlineXMark /></button>
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
                                    <p className="text-muted text-sm mt-1">{PASSWORD_POLICY_HINT}</p>
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
                </div>
            )}

            {/* Provision Modal */}
            {provisionOpen && provisionTargetUser && (
                <div className="modal-overlay" onClick={closeProvisionModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">开通订阅 - {provisionTargetUser.username}</h3>
                            <button className="modal-close" onClick={closeProvisionModal}><HiOutlineXMark /></button>
                        </div>
                        <form onSubmit={submitProvision}>
                            <div className="modal-body">
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

                                <div className="form-group">
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
                                                        const dateStr = new Date(e.expiryTime).toLocaleDateString('zh-CN');
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
                                                ? new Date(ib.expiryTime).toLocaleDateString('zh-CN')
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

                                {provisionResult && (
                                    <div className="card">
                                        <div className="card-header">
                                            <span className="card-title">开通结果</span>
                                        </div>
                                        {provisionResult.deployment && provisionResult.deployment.total > 0 && (
                                            <div className="mb-3">
                                                <div className="text-sm mb-2">
                                                    <span className="font-medium">节点下发：</span>
                                                    <span className="badge badge-success mr-1">创建 {provisionResult.deployment.created}</span>
                                                    <span className="badge badge-neutral mr-1">跳过 {provisionResult.deployment.skipped}（已存在）</span>
                                                    {provisionResult.deployment.failed > 0 && (
                                                        <span className="badge badge-danger">失败 {provisionResult.deployment.failed}</span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {!provisionResult.subscriptionConverterConfigured && (
                                            <div className="text-xs text-muted mb-2">
                                                提示: 尚未配置订阅转换器，Clash/sing-box 链接可能为空。
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
                </div>
            )}

            {/* Subscription Modal */}
            {subscriptionModalOpen && (
                <div className="modal-overlay" onClick={() => setSubscriptionModalOpen(false)}>
                    <div className="modal modal-wide glass-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">订阅链接 - {subscriptionEmail}</h3>
                            <button className="modal-close" onClick={() => setSubscriptionModalOpen(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="grid-auto-160 mb-4">
                                <button className="btn btn-secondary" onClick={() => loadSubscription(subscriptionEmail)} disabled={subscriptionLoading}>
                                    {subscriptionLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新</>}
                                </button>
                                <button className="btn btn-primary" onClick={handleCopySubscription} disabled={!activeSubscriptionProfile?.url || subscriptionResult?.subscriptionActive === false}>
                                    <HiOutlineClipboard /> 复制
                                </button>
                            </div>

                            {!subscriptionResult ? (
                                <div className="text-center p-6"><span className="spinner" /></div>
                            ) : (
                                <div className="grid-auto-240 items-start">
                                    <div className="flex flex-col gap-3">
                                        <div className="text-sm text-muted">
                                            状态：{subscriptionResult.subscriptionActive ? '可用' : '失效'}
                                        </div>
                                        <div
                                            className="grid gap-2"
                                            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}
                                        >
                                            {(subscriptionResult.bundle?.availableProfiles || []).map((item) => (
                                                <button
                                                    key={item.key}
                                                    type="button"
                                                    className={`btn btn-sm ${subscriptionProfileKey === item.key ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setSubscriptionProfileKey(item.key)}
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="text-xs text-muted">
                                            {activeSubscriptionProfile?.hint || '请选择订阅类型'}
                                        </div>
                                        {!subscriptionResult.bundle?.converterConfigured && (
                                            <div className="text-xs text-muted">
                                                提示：未配置"系统设置 → 订阅转换器 → 转换器地址"，Clash/sing-box 配置入口已隐藏。
                                            </div>
                                        )}
                                        <input className="form-input font-mono text-xs" value={activeSubscriptionProfile?.url || ''} readOnly />
                                    </div>
                                    <div className="flex justify-center">
                                        {activeSubscriptionProfile?.url && subscriptionResult.subscriptionActive ? (
                                            <div className="qr-surface">
                                                <QRCodeSVG
                                                    value={activeSubscriptionProfile.url}
                                                    size={240}
                                                    level="M"
                                                    includeMargin={false}
                                                />
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted">当前用户暂无可用订阅二维码</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setSubscriptionModalOpen(false)}>关闭</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
