import React, { useEffect, useMemo, useState } from 'react';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import toast from 'react-hot-toast';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../../utils/passwordPolicy.js';
import { copyToClipboard } from '../../utils/format.js';
import { useServer } from '../../contexts/ServerContext.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    normalizeEmail, normalizeScopeMode,
    PROTOCOL_OPTIONS, PROTOCOL_KEY_SET,
} from '../../utils/protocol.js';
import { generateSecurePassword } from '../../utils/crypto.js';
import UserPolicyModal from '../Clients/UserPolicyModal.jsx';
import {
    HiOutlineArrowPath,
    HiOutlineClipboard,
    HiOutlineMagnifyingGlass,
    HiOutlineKey,
    HiOutlineUserPlus,
    HiOutlineServerStack,
    HiOutlineLink,
    HiOutlineXMark,
    HiOutlineCheck,
    HiOutlineTrash,
    HiOutlineEye,
    HiOutlineEyeSlash,
} from 'react-icons/hi2';

function isSubscriptionActive(user) {
    return Boolean(normalizeEmail(user?.subscriptionEmail));
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN');
}

export default function Accounts({ embedded = false }) {
    const { servers } = useServer();
    const confirmAction = useConfirm();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [pendingOnly, setPendingOnly] = useState(false);
    const [forbidden, setForbidden] = useState(false);

    const [resetOpen, setResetOpen] = useState(false);
    const [targetUser, setTargetUser] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [showResetPassword, setShowResetPassword] = useState(true);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [bindingOpen, setBindingOpen] = useState(false);
    const [bindingTargetUser, setBindingTargetUser] = useState(null);
    const [bindingEmail, setBindingEmail] = useState('');
    const [bindingSaving, setBindingSaving] = useState(false);
    const [policyOpen, setPolicyOpen] = useState(false);
    const [policyEmail, setPolicyEmail] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [createSaving, setCreateSaving] = useState(false);
    const [createUsername, setCreateUsername] = useState('');
    const [createEmail, setCreateEmail] = useState('');
    const [createUseEmailAsBinding, setCreateUseEmailAsBinding] = useState(true);
    const [createSubscriptionEmail, setCreateSubscriptionEmail] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [showCreatePassword, setShowCreatePassword] = useState(true);
    const [createProvisionAfterCreate, setCreateProvisionAfterCreate] = useState(true);
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [provisionTargetUser, setProvisionTargetUser] = useState(null);
    const [provisionInitLoading, setProvisionInitLoading] = useState(false);
    const [provisionSaving, setProvisionSaving] = useState(false);
    const [provisionEmail, setProvisionEmail] = useState('');
    const [provisionNoServerLimit, setProvisionNoServerLimit] = useState(true);
    const [provisionNoProtocolLimit, setProvisionNoProtocolLimit] = useState(true);
    const [provisionServerIds, setProvisionServerIds] = useState([]);
    const [provisionProtocols, setProvisionProtocols] = useState([]);
    const [provisionExpiryDays, setProvisionExpiryDays] = useState(0);
    const [provisionResult, setProvisionResult] = useState(null);

    const loadUsers = async () => {
        setLoading(true);
        setForbidden(false);
        try {
            const res = await api.get('/auth/users');
            setUsers(Array.isArray(res.data?.obj) ? res.data.obj : []);
        } catch (err) {
            if (err.response?.status === 403) {
                setForbidden(true);
                setUsers([]);
            } else {
                toast.error(err.response?.data?.msg || err.message || '加载用户失败');
            }
        }
        setLoading(false);
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const filteredUsers = useMemo(() => {
        const keyword = String(searchTerm || '').trim().toLowerCase();
        const base = users.filter((item) => {
            if (!pendingOnly) return true;
            return item.role !== 'admin' && !isSubscriptionActive(item);
        });
        if (!keyword) return base;
        return base.filter((item) => {
            const fields = [
                item.username,
                item.email,
                item.subscriptionEmail,
                isSubscriptionActive(item) ? 'active' : 'pending',
                item.role,
            ].map((field) => String(field || '').toLowerCase());
            return fields.some((text) => text.includes(keyword));
        });
    }, [pendingOnly, searchTerm, users]);

    const userStats = useMemo(() => {
        const businessUsers = users.filter((item) => item.role !== 'admin');
        const activeCount = businessUsers.filter((item) => isSubscriptionActive(item)).length;
        const pendingCount = Math.max(0, businessUsers.length - activeCount);
        return {
            total: businessUsers.length,
            active: activeCount,
            pending: pendingCount,
        };
    }, [users]);

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

    const openResetModal = (user) => {
        setTargetUser(user);
        setNewPassword(generateSecurePassword());
        setConfirmPassword('');
        setResetOpen(true);
    };

    const closeResetModal = () => {
        setResetOpen(false);
        setTargetUser(null);
        setNewPassword('');
        setConfirmPassword('');
        setResetLoading(false);
    };

    const toggleProvisionServer = (serverId, checked) => {
        setProvisionServerIds((prev) => {
            if (checked) return Array.from(new Set([...prev, serverId]));
            return prev.filter((item) => item !== serverId);
        });
    };

    const toggleProvisionProtocol = (protocol, checked) => {
        setProvisionProtocols((prev) => {
            if (checked) return Array.from(new Set([...prev, protocol]));
            return prev.filter((item) => item !== protocol);
        });
    };

    const closeProvisionModal = () => {
        setProvisionOpen(false);
        setProvisionTargetUser(null);
        setProvisionInitLoading(false);
        setProvisionSaving(false);
        setProvisionEmail('');
        setProvisionNoServerLimit(true);
        setProvisionNoProtocolLimit(true);
        setProvisionServerIds([]);
        setProvisionProtocols([]);
        setProvisionExpiryDays(0);
        setProvisionResult(null);
    };

    const openProvisionModal = async (user) => {
        const suggestedEmail = normalizeEmail(user?.subscriptionEmail || user?.email);
        if (!suggestedEmail) {
            toast.error('该用户未配置邮箱，无法开通订阅');
            return;
        }
        setProvisionTargetUser(user);
        setProvisionEmail(suggestedEmail);
        setProvisionNoServerLimit(true);
        setProvisionNoProtocolLimit(true);
        setProvisionServerIds([]);
        setProvisionProtocols([]);
        setProvisionExpiryDays(0);
        setProvisionResult(null);
        setProvisionOpen(true);
        setProvisionInitLoading(true);

        try {
            const policyRes = await api.get(`/user-policy/${encodeURIComponent(suggestedEmail)}`);
            const policy = policyRes.data?.obj || {};
            const validServerIdSet = new Set((Array.isArray(servers) ? servers : []).map((item) => item.id));
            const rawServerIds = Array.isArray(policy.allowedServerIds) ? policy.allowedServerIds : [];
            const serverIds = rawServerIds.filter((item) => validServerIdSet.has(item));
            const protocols = (Array.isArray(policy.allowedProtocols) ? policy.allowedProtocols : [])
                .map((item) => String(item || '').trim().toLowerCase())
                .filter((item) => PROTOCOL_KEY_SET.has(item));
            const serverScopeMode = normalizeScopeMode(policy.serverScopeMode, rawServerIds);
            const protocolScopeMode = normalizeScopeMode(policy.protocolScopeMode, protocols);
            setProvisionServerIds(serverIds);
            setProvisionProtocols(protocols);
            setProvisionNoServerLimit(serverScopeMode === 'all');
            setProvisionNoProtocolLimit(protocolScopeMode === 'all');
        } catch {
            setProvisionServerIds([]);
            setProvisionProtocols([]);
            setProvisionNoServerLimit(true);
            setProvisionNoProtocolLimit(true);
        }
        setProvisionInitLoading(false);
    };

    const openBindingModal = (user) => {
        setBindingTargetUser(user);
        setBindingEmail(String(user?.subscriptionEmail || user?.email || '').trim().toLowerCase());
        setBindingOpen(true);
    };

    const closeBindingModal = () => {
        setBindingOpen(false);
        setBindingTargetUser(null);
        setBindingEmail('');
        setBindingSaving(false);
    };

    const openPolicyModal = (subscriptionIdentity) => {
        const normalizedEmail = String(subscriptionIdentity || '').trim().toLowerCase();
        if (!normalizedEmail) {
            toast.error('该用户未绑定订阅邮箱，无法分配订阅节点');
            return;
        }
        setPolicyEmail(normalizedEmail);
        setPolicyOpen(true);
    };

    const closePolicyModal = () => {
        setPolicyOpen(false);
        setPolicyEmail('');
    };

    const submitBinding = async (event) => {
        event.preventDefault();
        if (!bindingTargetUser?.id) return;
        const next = String(bindingEmail || '').trim().toLowerCase();
        if (next && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
            toast.error('订阅绑定邮箱格式不正确');
            return;
        }

        setBindingSaving(true);
        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(bindingTargetUser.id)}/subscription-binding`, {
                subscriptionEmail: next,
            });
            if (res.data?.success) {
                toast.success(next ? '订阅邮箱绑定已更新' : '订阅邮箱绑定已清空');
                closeBindingModal();
                await loadUsers();
                return;
            }
            toast.error(res.data?.msg || '绑定保存失败');
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '绑定保存失败');
        }
        setBindingSaving(false);
    };

    const copyProvisionUrl = async (url, label) => {
        if (!url) return;
        await copyToClipboard(url);
        toast.success(`${label} 链接已复制`);
    };

    const openCreateModal = () => {
        setCreateUsername('');
        setCreateEmail('');
        setCreateUseEmailAsBinding(true);
        setCreateSubscriptionEmail('');
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
        const subscriptionEmail = normalizeEmail(
            createUseEmailAsBinding ? email : createSubscriptionEmail
        );
        const password = String(createPassword || '');

        if (!username) {
            toast.error('用户名不能为空');
            return;
        }
        if (!password) {
            toast.error('初始密码不能为空');
            return;
        }
        const passwordError = getPasswordPolicyError(password);
        if (passwordError) {
            toast.error(passwordError);
            return;
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error('登录邮箱格式不正确');
            return;
        }
        if (subscriptionEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subscriptionEmail)) {
            toast.error('订阅绑定邮箱格式不正确');
            return;
        }

        setCreateSaving(true);
        try {
            const res = await api.post('/auth/users', {
                username,
                password,
                role: 'user',
                email,
                subscriptionEmail,
            });
            if (!res.data?.success || !res.data?.obj) {
                toast.error(res.data?.msg || '创建用户失败');
                setCreateSaving(false);
                return;
            }

            const createdUser = res.data.obj;
            toast.success(`用户 ${createdUser.username || username} 已创建`);
            closeCreateModal();
            await loadUsers();

            if (createProvisionAfterCreate) {
                const targetEmail = normalizeEmail(createdUser.subscriptionEmail || createdUser.email);
                if (!targetEmail) {
                    toast('用户已创建，但未设置邮箱，无法立即分配节点');
                } else {
                    await openProvisionModal(createdUser);
                }
            }
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '创建用户失败');
            setCreateSaving(false);
        }
    };

    const submitProvision = async (event) => {
        event.preventDefault();
        if (!provisionTargetUser?.id) return;

        const normalizedEmail = normalizeEmail(provisionEmail);
        if (!normalizedEmail) {
            toast.error('订阅绑定邮箱不能为空');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            toast.error('订阅绑定邮箱格式不正确');
            return;
        }

        const validServerIdSet = new Set((Array.isArray(servers) ? servers : []).map((item) => item.id));
        const selectedServerIds = provisionServerIds.filter((item) => validServerIdSet.has(item));
        const selectedProtocols = provisionProtocols
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => PROTOCOL_KEY_SET.has(item));
        const serverScopeMode = provisionNoServerLimit ? 'all' : (selectedServerIds.length > 0 ? 'selected' : 'none');
        const protocolScopeMode = provisionNoProtocolLimit ? 'all' : (selectedProtocols.length > 0 ? 'selected' : 'none');
        const payload = {
            subscriptionEmail: normalizedEmail,
            allowedServerIds: serverScopeMode === 'selected' ? selectedServerIds : [],
            allowedProtocols: protocolScopeMode === 'selected' ? selectedProtocols : [],
            serverScopeMode,
            protocolScopeMode,
            expiryDays: Math.max(0, Math.floor(Number(provisionExpiryDays) || 0)),
        };

        setProvisionSaving(true);
        try {
            const res = await api.post(`/auth/users/${encodeURIComponent(provisionTargetUser.id)}/provision-subscription`, payload);
            if (!res.data?.success) {
                toast.error(res.data?.msg || '开通失败');
                setProvisionSaving(false);
                return;
            }

            const boundEmail = normalizeEmail(res.data?.obj?.subscription?.email || normalizedEmail);
            let subscriptionPayload = null;
            try {
                const subRes = await api.get(`/subscriptions/${encodeURIComponent(boundEmail)}`);
                subscriptionPayload = subRes.data?.obj || null;
            } catch (subErr) {
                toast.error(subErr.response?.data?.msg || subErr.message || '订阅链接获取失败');
            }

            setProvisionResult({
                email: boundEmail,
                policy: res.data?.obj?.policy || null,
                token: res.data?.obj?.subscription?.token || null,
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
            await loadUsers();
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '开通失败');
        }
        setProvisionSaving(false);
    };

    const submitReset = async (event) => {
        event.preventDefault();
        if (!targetUser?.id) return;
        if (!newPassword || !confirmPassword) {
            toast.error('请填写新密码和确认密码');
            return;
        }

        const passwordError = getPasswordPolicyError(newPassword);
        if (passwordError) {
            toast.error(passwordError);
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('两次输入的密码不一致');
            return;
        }

        setResetLoading(true);
        try {
            const res = await api.put(`/auth/users/${encodeURIComponent(targetUser.id)}/reset-password`, {
                newPassword,
            });
            if (res.data?.success) {
                toast.success(`已重置 ${targetUser.username} 的密码`);
                closeResetModal();
                await loadUsers();
                return;
            }
            toast.error(res.data?.msg || '重置失败');
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '重置失败');
        }
        setResetLoading(false);
    };

    const handleDeleteUser = async (user) => {
        if (!user?.id || user.role === 'admin') return;
        const ok = await confirmAction({
            title: '删除注册用户',
            message: `确定删除用户 ${user.username} 吗？`,
            details: '删除后该账号将无法登录，且绑定关系会被清除。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        try {
            const res = await api.delete(`/auth/users/${encodeURIComponent(user.id)}`);
            if (res.data?.success) {
                toast.success(`已删除用户 ${user.username}`);
                await loadUsers();
                return;
            }
            toast.error(res.data?.msg || '删除失败');
        } catch (err) {
            toast.error(err.response?.data?.msg || err.message || '删除失败');
        }
    };

    return (
        <>
            {!embedded && <Header title="账号管理" />}
            <div className={embedded ? '' : 'page-content page-enter'}>
                <div className="flex justify-between items-center gap-4 glass-panel p-4 mb-6 mobile-toolbar">
                    <div className="account-search-shell flex-1 max-w-sm">
                        <HiOutlineMagnifyingGlass className="account-search-icon" />
                        <input
                            className="form-input account-search-input"
                            placeholder="搜索用户名/邮箱/绑定邮箱/角色..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 items-center flex-wrap">
                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={pendingOnly}
                                onChange={(e) => setPendingOnly(e.target.checked)}
                            />
                            仅待开通
                        </label>
                        <button className="btn btn-secondary btn-sm" onClick={loadUsers} disabled={loading}>
                            {loading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新</>}
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
                            <HiOutlineUserPlus /> 添加用户
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="badge badge-info">注册用户 {userStats.total}</span>
                    <span className="badge badge-success">已开通 {userStats.active}</span>
                    <span className="badge badge-warning">待开通 {userStats.pending}</span>
                </div>

                <div className="table-container glass-panel">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>用户名</th>
                                <th>邮箱</th>
                                <th>订阅绑定邮箱</th>
                                <th>订阅状态</th>
                                <th>角色</th>
                                <th>邮箱验证</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} className="text-center table-pad-64"><div className="spinner mx-auto" /></td></tr>
                            ) : forbidden ? (
                                <tr><td colSpan={8} className="text-center table-empty">仅管理员可访问账号管理</td></tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr><td colSpan={8} className="text-center table-empty">暂无用户</td></tr>
                            ) : (
                                filteredUsers.map((item) => (
                                    <tr key={item.id}>
                                        <td data-label="用户名" className="font-medium text-white">{item.username}</td>
                                        <td data-label="邮箱" className="text-muted">{item.email || '-'}</td>
                                        <td data-label="订阅绑定邮箱" className="text-muted">{item.subscriptionEmail || '-'}</td>
                                        <td data-label="订阅状态">
                                            {item.role === 'admin' ? (
                                                <span className="badge badge-neutral">管理员</span>
                                            ) : (
                                                <span className={`badge ${isSubscriptionActive(item) ? 'badge-success' : 'badge-warning'}`}>
                                                    {isSubscriptionActive(item) ? '已开通' : '待开通'}
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="角色">
                                            <span className={`badge ${item.role === 'admin' ? 'badge-danger' : 'badge-info'}`}>
                                                {item.role}
                                            </span>
                                        </td>
                                        <td data-label="邮箱验证">
                                            <span className={`badge ${item.emailVerified ? 'badge-success' : 'badge-neutral'}`}>
                                                {item.emailVerified ? '已验证' : '未验证'}
                                            </span>
                                        </td>
                                        <td data-label="创建时间" className="text-muted">{formatDate(item.createdAt)}</td>
                                        <td data-label="">
                                            <div className="flex gap-2">
                                                {item.role !== 'admin' && (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => openProvisionModal(item)}
                                                        title="一键绑定+分配节点+生成订阅链接"
                                                    >
                                                        <HiOutlineCheck /> {isSubscriptionActive(item) ? '更新开通' : '开通订阅'}
                                                    </button>
                                                )}
                                                {item.role !== 'admin' && (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => openBindingModal(item)}
                                                        title="绑定订阅邮箱"
                                                    >
                                                        <HiOutlineLink /> 绑定订阅
                                                    </button>
                                                )}
                                                {item.role !== 'admin' && (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => openPolicyModal(item.subscriptionEmail)}
                                                        title="分配可访问节点"
                                                        disabled={!item.subscriptionEmail}
                                                    >
                                                        <HiOutlineServerStack /> 分配节点
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => openResetModal(item)}
                                                    title="手动重置密码"
                                                >
                                                    <HiOutlineKey /> 重置密码
                                                </button>
                                                {item.role !== 'admin' && (
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => handleDeleteUser(item)}
                                                        title="删除注册用户"
                                                    >
                                                        <HiOutlineTrash /> 删除用户
                                                    </button>
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

            <UserPolicyModal
                isOpen={policyOpen}
                email={policyEmail}
                servers={servers}
                onClose={closePolicyModal}
            />

            {provisionOpen && provisionTargetUser && (
                <div className="modal-overlay" onClick={closeProvisionModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">一键开通订阅 - {provisionTargetUser.username}</h3>
                            <button className="modal-close" onClick={closeProvisionModal}>
                                <HiOutlineXMark />
                            </button>
                        </div>
                        <form onSubmit={submitProvision}>
                            <div className="modal-body">
                                {provisionInitLoading ? (
                                    <div className="text-center p-6"><span className="spinner" /></div>
                                ) : (
                                    <>
                                        <div className="form-group">
                                            <label className="form-label">注册邮箱</label>
                                            <input className="form-input" value={provisionTargetUser.email || ''} readOnly placeholder="-" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">订阅绑定邮箱</label>
                                            <input
                                                type="email"
                                                className="form-input"
                                                value={provisionEmail}
                                                onChange={(e) => setProvisionEmail(e.target.value)}
                                                placeholder="与节点客户端配置一致的邮箱"
                                            />
                                            <p className="text-xs text-muted mt-1">
                                                保存后会立即生成可用订阅链接，普通用户可直接查看自己的订阅连接。
                                            </p>
                                        </div>

                                        <div className="card mb-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="card-title">可访问服务器</span>
                                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={provisionNoServerLimit}
                                                        onChange={(e) => setProvisionNoServerLimit(e.target.checked)}
                                                    />
                                                    不限制
                                                </label>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {servers.map((server) => (
                                                    <label key={server.id} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            disabled={provisionNoServerLimit}
                                                            checked={provisionServerIds.includes(server.id)}
                                                            onChange={(e) => toggleProvisionServer(server.id, e.target.checked)}
                                                        />
                                                        <span>{server.name}</span>
                                                    </label>
                                                ))}
                                                {servers.length === 0 && <span className="text-sm text-muted">暂无服务器</span>}
                                            </div>
                                        </div>

                                        <div className="card mb-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="card-title">可用协议</span>
                                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={provisionNoProtocolLimit}
                                                        onChange={(e) => setProvisionNoProtocolLimit(e.target.checked)}
                                                    />
                                                    不限制
                                                </label>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {PROTOCOL_OPTIONS.map((item) => (
                                                    <label key={item.key} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            disabled={provisionNoProtocolLimit}
                                                            checked={provisionProtocols.includes(item.key)}
                                                            onChange={(e) => toggleProvisionProtocol(item.key, e.target.checked)}
                                                        />
                                                        <span>{item.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">有效期</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    className="form-input"
                                                    style={{ maxWidth: 120 }}
                                                    min={0}
                                                    value={provisionExpiryDays}
                                                    onChange={(e) => setProvisionExpiryDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                                                />
                                                <span className="text-sm text-muted">天（0 = 永不过期）</span>
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
                                                        {provisionResult.deployment.failed > 0 && Array.isArray(provisionResult.deployment.details) && (
                                                            <div className="text-xs text-muted">
                                                                {provisionResult.deployment.details
                                                                    .filter((d) => d.status === 'failed')
                                                                    .map((d, i) => (
                                                                        <div key={i}>
                                                                            {d.serverName || d.serverId}{d.inboundRemark ? ` / ${d.inboundRemark}` : ''}: {d.error || '未知错误'}
                                                                        </div>
                                                                    ))}
                                                            </div>
                                                        )}
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
                                                                onClick={() => copyProvisionUrl(item.url, item.label)}
                                                            >
                                                                <HiOutlineClipboard /> 复制{item.label}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeProvisionModal}>关闭</button>
                                <button type="submit" className="btn btn-primary" disabled={provisionSaving || provisionInitLoading}>
                                    {provisionSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 保存并开通</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {createOpen && (
                <div className="modal-overlay" onClick={closeCreateModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">添加用户账号</h3>
                            <button className="modal-close" onClick={closeCreateModal}>
                                <HiOutlineXMark />
                            </button>
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
                                    <label className="form-label">登录邮箱</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={createEmail}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setCreateEmail(value);
                                            if (createUseEmailAsBinding) {
                                                setCreateSubscriptionEmail(value);
                                            }
                                        }}
                                        placeholder="可选，用于注册体系与找回密码"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">订阅绑定邮箱</label>
                                    <div className="flex items-center gap-2 mb-2">
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={createUseEmailAsBinding}
                                                onChange={(e) => {
                                                    const checked = e.target.checked;
                                                    setCreateUseEmailAsBinding(checked);
                                                    if (checked) {
                                                        setCreateSubscriptionEmail(createEmail);
                                                    }
                                                }}
                                            />
                                            同登录邮箱
                                        </label>
                                    </div>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={createUseEmailAsBinding ? createEmail : createSubscriptionEmail}
                                        onChange={(e) => setCreateSubscriptionEmail(e.target.value)}
                                        disabled={createUseEmailAsBinding}
                                        placeholder="用于订阅链接身份"
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
                                        创建后立即进入“开通订阅/分配节点”
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

            {bindingOpen && bindingTargetUser && (
                <div className="modal-overlay" onClick={closeBindingModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">绑定订阅邮箱 - {bindingTargetUser.username}</h3>
                            <button className="modal-close" onClick={closeBindingModal}>
                                <HiOutlineXMark />
                            </button>
                        </div>
                        <form onSubmit={submitBinding}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">登录邮箱</label>
                                    <input
                                        className="form-input"
                                        value={bindingTargetUser.email || ''}
                                        readOnly
                                        placeholder="-"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">订阅绑定邮箱</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={bindingEmail}
                                        onChange={(e) => setBindingEmail(e.target.value)}
                                        placeholder="与节点客户端一致的邮箱，例如 user@example.com"
                                    />
                                    <p className="text-xs text-muted mt-1">
                                        空值表示清空绑定，普通用户将无法查看订阅链接。
                                    </p>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeBindingModal}>取消</button>
                                <button type="submit" className="btn btn-primary" disabled={bindingSaving}>
                                    {bindingSaving ? <span className="spinner" /> : <><HiOutlineCheck /> 保存绑定</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {resetOpen && targetUser && (
                <div className="modal-overlay" onClick={closeResetModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">重置密码 - {targetUser.username}</h3>
                            <button className="modal-close" onClick={closeResetModal}>
                                <HiOutlineXMark />
                            </button>
                        </div>
                        <form onSubmit={submitReset}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">新密码</label>
                                    <div className="flex gap-2">
                                        <input
                                            type={showResetPassword ? 'text' : 'password'}
                                            className="form-input font-mono"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="至少8位，含3类字符"
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowResetPassword((v) => !v)}
                                            title={showResetPassword ? '隐藏密码' : '显示密码'}
                                        >
                                            {showResetPassword ? <HiOutlineEyeSlash /> : <HiOutlineEye />}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => { copyToClipboard(newPassword); toast.success('密码已复制到剪贴板'); }}
                                            title="复制密码"
                                        >
                                            <HiOutlineClipboard />
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setNewPassword(generateSecurePassword())}
                                        >
                                            <HiOutlineArrowPath /> 生成
                                        </button>
                                    </div>
                                </div>
                                <p className="text-muted text-sm mt-1">{PASSWORD_POLICY_HINT}</p>
                                <div className="form-group">
                                    <label className="form-label">确认新密码</label>
                                    <input
                                        type={showResetPassword ? 'text' : 'password'}
                                        className="form-input"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="再次输入新密码"
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={closeResetModal}>取消</button>
                                <button type="submit" className="btn btn-primary" disabled={resetLoading || !newPassword || !confirmPassword || newPassword !== confirmPassword}>
                                    {resetLoading ? <span className="spinner" /> : <><HiOutlineCheck /> 确认重置</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
