import React, { useEffect, useMemo, useState } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { copyToClipboard, formatBytes } from '../../utils/format.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import { buildSubscriptionProfileBundle, findSubscriptionProfile } from '../../utils/subscriptionProfiles.js';
import {
    normalizeProtocol, normalizeEmail,
    UUID_PROTOCOLS, PASSWORD_PROTOCOLS,
    getClientIdentifier,
} from '../../utils/protocol.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineArrowPath,
    HiOutlineServer,
    HiOutlineMagnifyingGlass,
    HiOutlineShieldCheck,
    HiOutlineLink,
    HiOutlineClipboard,
    HiOutlineExclamationTriangle,
    HiOutlineUsers,
    HiOutlineXMark,
} from 'react-icons/hi2';
import ClientModal from './ClientModal.jsx';
import BatchResultModal from '../Batch/BatchResultModal.jsx';
import UserPolicyModal from './UserPolicyModal.jsx';
import ConflictScannerModal from './ConflictScannerModal.jsx';
import { QRCodeSVG } from 'qrcode.react';

function buildClientPayload(entry, enableOverride) {
    const protocol = normalizeProtocol(entry?.protocol);
    const payload = {
        id: '',
        password: '',
        email: entry.email,
        totalGB: Number(entry.totalGB || 0),
        expiryTime: Number(entry.expiryTime || 0),
        enable: enableOverride,
        tgId: entry.tgId || '',
        subId: entry.subId || '',
        limitIp: Number(entry.limitIp || 0),
        flow: entry.flow || '',
    };

    if (UUID_PROTOCOLS.has(protocol)) {
        payload.id = entry.id || entry.password || '';
        payload.password = entry.password || '';
        return payload;
    }

    if (PASSWORD_PROTOCOLS.has(protocol)) {
        payload.id = entry.id || '';
        payload.password = entry.password || entry.id || '';
        return payload;
    }

    payload.id = entry.id || entry.password || entry.email;
    payload.password = entry.password || entry.id || entry.email;
    return payload;
}

function buildGroupKey(client) {
    const email = String(client.email || '').trim().toLowerCase();
    if (email) return `email:${email}`;
    const identifier = String(getClientIdentifier(client) || '').trim();
    if (identifier) return `id:${identifier}`;
    return `fallback:${client.uiKey}`;
}

function formatExpiryLabel(expiryValues) {
    if (!expiryValues || expiryValues.length === 0) return '永久';
    if (expiryValues.length === 1) {
        return new Date(expiryValues[0]).toLocaleDateString('zh-CN');
    }
    return '多节点';
}

function normalizeInactiveReason(reason) {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return '可用';
    if (text === 'all-expired-or-disabled') return '全部节点已过期或禁用';
    if (text === 'blocked-by-policy') return '被订阅权限策略限制';
    if (text === 'user-not-found') return '未找到该用户';
    if (text === 'no-links-found') return '未生成可用节点链接';
    return reason;
}

export default function Clients() {
    const { servers } = useServer();
    const confirmAction = useConfirm();

    const [clients, setClients] = useState([]);
    const [allTargets, setAllTargets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterServerId, setFilterServerId] = useState('all');
    const [batchResultData, setBatchResultData] = useState(null);
    const [batchResultTitle, setBatchResultTitle] = useState('批量执行结果');
    const [policyModal, setPolicyModal] = useState({ open: false, email: '' });
    const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
    const [subscriptionEmail, setSubscriptionEmail] = useState('');
    const [subscriptionLoading, setSubscriptionLoading] = useState(false);
    const [subscriptionResult, setSubscriptionResult] = useState(null);
    const [subscriptionProfileKey, setSubscriptionProfileKey] = useState('v2rayn');
    const [conflictModalOpen, setConflictModalOpen] = useState(false);

    const [selectedKeys, setSelectedKeys] = useState(new Set());

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState(null);
    const [modalServerId, setModalServerId] = useState(null);
    const [modalInboundId, setModalInboundId] = useState(null);
    const [batchTargets, setBatchTargets] = useState([]);

    const fetchAllClients = async () => {
        if (servers.length === 0) {
            setLoading(false);
            setAllTargets([]);
            setClients([]);
            return [];
        }

        setLoading(true);
        setSelectedKeys(new Set());

        const allClients = [];
        const discoveredTargets = [];

        await Promise.all([
            ...servers.map(async (server) => {
                try {
                    const res = await api.get(`/panel/${server.id}/panel/api/inbounds/list`);
                    if (!res.data?.obj) return;

                    res.data.obj.forEach((ib) => {
                        const protocol = String(ib.protocol || '').toLowerCase();
                        if (['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol)) {
                            discoveredTargets.push({
                                id: ib.id,
                                serverId: server.id,
                                serverName: server.name,
                                remark: ib.remark,
                                protocol: ib.protocol,
                                port: ib.port,
                            });
                        }

                        let ibClients = [];
                        try {
                            const settings = JSON.parse(ib.settings);
                            ibClients = settings.clients || [];
                        } catch { }

                        ibClients.forEach((cl) => {
                            allClients.push({
                                ...cl,
                                serverId: server.id,
                                serverName: server.name,
                                inboundId: ib.id,
                                inboundRemark: ib.remark,
                                inboundPort: ib.port,
                                protocol: ib.protocol,
                                uiKey: `${server.id}-${ib.id}-${cl.id || cl.email}`,
                            });
                        });
                    });
                } catch (err) {
                    console.error(`Failed to fetch clients from ${server.name}`, err);
                }
            }),
        ]);

        setClients(allClients);
        setAllTargets(discoveredTargets);
        setLoading(false);
        return allClients;
    };

    useEffect(() => {
        fetchAllClients();
    }, [servers]);

    useEffect(() => {
        if (filterServerId !== 'all' && !servers.some((s) => s.id === filterServerId)) {
            setFilterServerId('all');
        }
    }, [filterServerId, servers]);

    const filteredClients = useMemo(() => {
        const search = String(searchTerm || '').trim().toLowerCase();

        const rawFiltered = clients.filter((client) => {
            const matchesServer = filterServerId === 'all' || client.serverId === filterServerId;
            if (!matchesServer) return false;
            if (!search) return true;

            const values = [
                client.email,
                client.id,
                client.password,
                client.serverName,
                client.inboundRemark,
            ].map((item) => String(item || '').toLowerCase());

            return values.some((text) => text.includes(search));
        });

        const groups = new Map();
        rawFiltered.forEach((item) => {
            const key = buildGroupKey(item);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        });

        const grouped = Array.from(groups.entries()).map(([key, entries]) => {
            const primary = entries[0];
            const serverMap = new Map();
            const inboundMap = new Map();
            const expirySet = new Set();

            let totalUsed = 0;
            let totalLimit = 0;
            let enabledCount = 0;

            entries.forEach((item) => {
                serverMap.set(item.serverId, item.serverName || String(item.serverId));
                const inboundLabel = `${item.inboundRemark || item.protocol || '-'} (${item.inboundPort || '-'})`;
                inboundMap.set(`${item.serverId}-${item.inboundId}`, inboundLabel);
                totalUsed += Number(item.up || 0) + Number(item.down || 0);
                totalLimit += Number(item.totalGB || 0);
                if (item.enable !== false) enabledCount += 1;
                if (Number(item.expiryTime || 0) > 0) {
                    expirySet.add(Number(item.expiryTime));
                }
            });

            let statusType = 'mixed';
            let statusLabel = '混合';
            if (enabledCount === entries.length) {
                statusType = 'enabled';
                statusLabel = '启用';
            } else if (enabledCount === 0) {
                statusType = 'disabled';
                statusLabel = '禁用';
            }

            const serverNames = Array.from(serverMap.values());
            const serversList = Array.from(serverMap.entries()).map(([id, name]) => ({ id, name }));
            const inboundLabels = Array.from(inboundMap.values());
            const expiryValues = Array.from(expirySet.values()).sort((a, b) => a - b);

            return {
                uiKey: key,
                email: primary.email || '-',
                primary,
                entries,
                servers: serversList,
                serverNames,
                serverCount: serverNames.length,
                inboundCount: inboundLabels.length,
                inboundPreview: inboundLabels[0] || '-',
                totalUsed,
                totalLimit,
                expiryValues,
                statusType,
                statusLabel,
                enabledCount,
            };
        });

        grouped.sort((a, b) => {
            return String(a.email || '').localeCompare(String(b.email || ''));
        });
        return grouped;
    }, [clients, filterServerId, searchTerm]);

    const subscriptionEmails = useMemo(() => {
        return filteredClients
            .map((item) => String(item.email || '').trim())
            .filter((email) => email && email !== '-');
    }, [filteredClients]);

    const selectedVisibleCount = filteredClients.filter((item) => selectedKeys.has(item.uiKey)).length;
    const activeSubscriptionProfile = useMemo(
        () => findSubscriptionProfile(subscriptionResult?.bundle, subscriptionProfileKey),
        [subscriptionResult, subscriptionProfileKey]
    );

    const toggleSelect = (key) => {
        const next = new Set(selectedKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSelectedKeys(next);
    };

    const toggleSelectAll = () => {
        if (selectedVisibleCount === filteredClients.length && filteredClients.length > 0) {
            setSelectedKeys(new Set());
            return;
        }
        setSelectedKeys(new Set(filteredClients.map((item) => item.uiKey)));
    };

    const handleBulkDelete = async () => {
        const ok = await confirmAction({
            title: '批量删除用户',
            message: `确定删除选中的 ${selectedVisibleCount} 个用户吗？`,
            details: '删除后不可恢复，建议先导出或确认订阅影响范围。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        const selectedGroups = filteredClients.filter((item) => selectedKeys.has(item.uiKey));
        const targets = selectedGroups.flatMap((group) => group.entries.map((entry) => ({
            serverId: entry.serverId,
            serverName: entry.serverName,
            inboundId: entry.inboundId,
            email: entry.email,
            clientIdentifier: getClientIdentifier(entry),
            id: entry.id,
            password: entry.password,
        })));

        if (targets.length === 0) return;

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
            setBatchResultTitle('批量删除用户结果');
            setBatchResultData(output || null);
            toast.success(`批量删除完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllClients();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '批量删除失败';
            toast.error(msg);
        }
    };

    const handleBulkSetEnable = async (enable) => {
        const ok = await confirmAction({
            title: `批量${enable ? '启用' : '停用'}用户`,
            message: `确定${enable ? '启用' : '停用'}选中的 ${selectedVisibleCount} 个用户吗？`,
            confirmText: enable ? '确认启用' : '确认停用',
            tone: enable ? 'success' : 'danger',
        });
        if (!ok) return;

        const selectedGroups = filteredClients.filter((item) => selectedKeys.has(item.uiKey));
        const targets = selectedGroups.flatMap((group) => group.entries.map((entry) => ({
            serverId: entry.serverId,
            serverName: entry.serverName,
            inboundId: entry.inboundId,
            email: entry.email,
            clientIdentifier: getClientIdentifier(entry),
            client: buildClientPayload(entry, enable),
        })));

        if (targets.length === 0) return;

        try {
            const action = enable ? 'enable' : 'disable';
            const payload = await attachBatchRiskToken({
                action,
                targets,
            }, {
                type: 'clients',
                action,
                targetCount: targets.length,
            });
            const res = await api.post('/batch/clients', payload);
            const output = res.data?.obj;
            const summary = output?.summary || { success: 0, total: targets.length, failed: targets.length };
            setBatchResultTitle(`批量${enable ? '启用' : '停用'}用户结果`);
            setBatchResultData(output || null);
            toast.success(`批量${enable ? '启用' : '停用'}完成: ${summary.success}/${summary.total} 成功`);
            setSelectedKeys(new Set());
            fetchAllClients();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.msg || err.message || '批量操作失败';
            toast.error(msg);
        }
    };

    const handleDelete = async (groupedClient) => {
        const ok = await confirmAction({
            title: '删除客户端',
            message: `确定删除客户端 ${groupedClient.email}（所有节点实例）吗？`,
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        if (groupedClient.entries.length > 0) {
            const targets = groupedClient.entries.map((entry) => ({
                serverId: entry.serverId,
                serverName: entry.serverName,
                inboundId: entry.inboundId,
                email: entry.email,
                clientIdentifier: getClientIdentifier(entry),
                id: entry.id,
                password: entry.password,
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
                setBatchResultTitle('删除客户端结果');
                setBatchResultData(output || null);
                toast.success(`删除完成: ${summary.success}/${summary.total} 成功`);
            } catch (err) {
                console.error(err);
                const msg = err.response?.data?.msg || err.message || '删除失败';
                toast.error(msg);
            }
        }

        fetchAllClients();
    };

    const handleOpenAddAllNodes = () => {
        if (allTargets.length === 0) {
            toast.error('没有可添加用户的入站');
            return;
        }
        setEditingClient(null);
        setModalServerId(null);
        setModalInboundId(null);
        setBatchTargets(allTargets);
        setIsModalOpen(true);
    };

    const handleOpenPolicy = (groupedClient) => {
        if (!groupedClient?.email || groupedClient.email === '-') {
            toast.error('邮箱为空，无法设置权限');
            return;
        }
        setPolicyModal({ open: true, email: groupedClient.email });
    };

    const handleEdit = (groupedClient) => {
        const target = groupedClient.primary;
        const editTargets = groupedClient.entries.map((entry) => ({
            serverId: entry.serverId,
            serverName: entry.serverName,
            inboundId: entry.inboundId,
            inboundRemark: entry.inboundRemark,
            inboundPort: entry.inboundPort,
            protocol: entry.protocol,
            email: entry.email,
            clientIdentifier: getClientIdentifier(entry),
            id: entry.id,
            password: entry.password,
        }));
        setBatchTargets([]);
        setEditingClient({
            ...target,
            editTargets: groupedClient.entries.length > 1 ? editTargets : [],
        });
        setModalServerId(target.serverId);
        setModalInboundId(target.inboundId);
        setIsModalOpen(true);
    };

    // --- Subscription ---
    const loadSubscriptionForEmail = async (emailInput = subscriptionEmail) => {
        const normalizedSubEmail = String(emailInput || '').trim();
        if (!normalizedSubEmail) {
            setSubscriptionResult(null);
            return;
        }

        setSubscriptionLoading(true);
        try {
            const query = new URLSearchParams();
            if (filterServerId && filterServerId !== 'all') {
                query.append('serverId', filterServerId);
            }
            const suffix = query.toString() ? `?${query.toString()}` : '';
            const res = await api.get(`/subscriptions/${encodeURIComponent(normalizedSubEmail)}${suffix}`);
            const subPayload = res.data?.obj || {};
            const bundle = buildSubscriptionProfileBundle(subPayload);

            setSubscriptionResult({
                email: subPayload.email || normalizedSubEmail,
                mergedUrl: bundle.mergedUrl,
                bundle,
                subscriptionActive: subPayload.subscriptionActive !== false,
                inactiveReason: normalizeInactiveReason(subPayload.inactiveReason),
            });
            if (bundle.defaultProfileKey) {
                setSubscriptionProfileKey(bundle.defaultProfileKey);
            }
        } catch (error) {
            setSubscriptionResult(null);
            const msg = error.response?.data?.msg || error.message || '订阅加载失败';
            toast.error(msg);
        }
        setSubscriptionLoading(false);
    };

    const openSubscriptionModal = (email = '') => {
        const normalized = String(email || '').trim();
        const fallback = subscriptionEmails[0] || '';
        const target = normalized && normalized !== '-' ? normalized : fallback;
        if (!target) {
            toast.error('当前没有可用邮箱，无法生成订阅');
            return;
        }
        setSubscriptionEmail(target);
        setSubscriptionModalOpen(true);
    };

    const handleCopySubscription = async () => {
        const profile = findSubscriptionProfile(subscriptionResult?.bundle, subscriptionProfileKey);
        if (!profile?.url) {
            toast.error('暂无可复制地址');
            return;
        }
        await copyToClipboard(profile.url);
        toast.success(`${profile.label} 订阅地址已复制`);
    };

    const handleOpenConflictScanner = () => {
        if (loading) {
            toast.error('用户数据加载中，请稍后再试');
            return;
        }
        if (clients.length === 0) {
            toast.error('暂无可扫描用户记录');
            return;
        }
        setConflictModalOpen(true);
    };

    const handleShowBatchResult = (title, data) => {
        if (!data) return;
        setBatchResultTitle(title || '批量执行结果');
        setBatchResultData(data);
    };

    useEffect(() => {
        if (!subscriptionModalOpen) return;
        if (subscriptionEmails.length === 0) {
            setSubscriptionResult(null);
            return;
        }
        if (!subscriptionEmails.includes(subscriptionEmail)) {
            setSubscriptionEmail(subscriptionEmails[0]);
            return;
        }
        loadSubscriptionForEmail(subscriptionEmail);
    }, [subscriptionModalOpen, subscriptionEmail, filterServerId, subscriptionEmails]);

    if (servers.length === 0) {
        return (
            <>
                <Header title="客户端管理" />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineUsers /></div>
                        <div className="empty-state-text">请先添加服务器以管理客户端</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header title="客户端管理" />
            <div className="page-content page-enter">
                <div className="flex flex-col gap-4 mb-6">
                    {/* Toolbar Row 1: Server Filter + Search + Refresh */}
                    <div className="flex items-center gap-4 glass-panel p-4 mobile-toolbar">
                        <select
                            className="form-select"
                            value={filterServerId}
                            onChange={(e) => setFilterServerId(e.target.value)}
                            style={{ width: 'auto', minWidth: '160px' }}
                        >
                            <option value="all">全部节点</option>
                            {servers.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <div className="account-search-shell flex-1 max-w-sm">
                            <HiOutlineMagnifyingGlass className="account-search-icon" />
                            <input
                                className="form-input account-search-input"
                                placeholder="搜索 Email / 用户名 / UUID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={fetchAllClients} title="刷新">
                            <HiOutlineArrowPath /> 刷新
                        </button>
                    </div>

                    {/* Toolbar Row 2: Batch Actions + Feature Buttons */}
                    <div className="flex items-center gap-4 flex-wrap">
                        {selectedVisibleCount > 0 && (
                            <div className="flex gap-2 items-center animate-fade-in">
                                <span className="text-sm font-bold px-2 text-primary">已选 {selectedVisibleCount} 项</span>
                                <button className="btn btn-success btn-sm" onClick={() => handleBulkSetEnable(true)}>
                                    启用
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => handleBulkSetEnable(false)}>
                                    停用
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                                    <HiOutlineTrash /> 删除
                                </button>
                            </div>
                        )}
                        <div className="flex gap-2 items-center flex-wrap">
                            <button className="btn btn-primary btn-sm" onClick={handleOpenAddAllNodes} title="添加到全部节点">
                                <HiOutlinePlusCircle /> 添加客户端(全节点)
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={handleOpenConflictScanner} title="扫描并修复冲突">
                                <HiOutlineExclamationTriangle /> 冲突扫描
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => openSubscriptionModal()} title="订阅链接">
                                <HiOutlineLink /> 订阅
                            </button>
                        </div>
                    </div>
                </div>

                <div className="table-container glass-panel">
                    <table className="table">
                        <thead>
                            <tr>
                                <th className="cell-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={filteredClients.length > 0 && selectedVisibleCount === filteredClients.length}
                                        onChange={toggleSelectAll}
                                        className="cursor-pointer"
                                    />
                                </th>
                                <th>状态</th>
                                <th>Email</th>
                                {filterServerId === 'all' && <th>节点</th>}
                                <th>入站</th>
                                <th>已用流量</th>
                                <th>到期时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={10} className="text-center table-pad-64"><div className="spinner mx-auto" /></td></tr>
                            ) : filteredClients.length === 0 ? (
                                <tr><td colSpan={10} className="text-center table-empty">
                                    {searchTerm ? '未找到匹配用户' : '暂无用户'}
                                </td></tr>
                            ) : (
                                filteredClients.map((client) => {
                                    const isSelected = selectedKeys.has(client.uiKey);

                                    // Active client row
                                    const badgeClass = client.statusType === 'enabled'
                                        ? 'badge-success'
                                        : (client.statusType === 'disabled' ? 'badge-danger' : 'badge-neutral');

                                    return (
                                        <tr key={client.uiKey} className={isSelected ? 'bg-white/5' : ''}>
                                            <td data-label="" className="text-center mobile-checkbox-cell">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(client.uiKey)}
                                                    className="cursor-pointer"
                                                />
                                            </td>
                                            <td data-label="状态">
                                                <span className={`badge ${badgeClass}`}>
                                                    {client.statusLabel}
                                                </span>
                                            </td>
                                            <td data-label="Email" className="font-medium">
                                                {client.email}
                                            </td>
                                            {filterServerId === 'all' && (
                                                <td data-label="节点">
                                                    <span className="badge badge-neutral flex items-center gap-1 w-fit" title={client.serverNames.join(', ')}>
                                                        <HiOutlineServer size={10} /> {client.serverCount} 节点
                                                    </span>
                                                </td>
                                            )}
                                            <td data-label="入站" className="text-sm text-muted" title={client.inboundPreview}>
                                                {client.inboundCount} 入站
                                            </td>
                                            <td data-label="已用流量">{formatBytes(client.totalUsed)}</td>
                                            <td data-label="到期时间">{formatExpiryLabel(client.expiryValues)}</td>
                                            <td data-label="" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex gap-2">
                                                    <button
                                                        className="btn btn-secondary btn-sm btn-icon"
                                                        title="编辑"
                                                        onClick={() => handleEdit(client)}
                                                    >
                                                        <HiOutlinePencilSquare />
                                                    </button>
                                                    <button
                                                        className="btn btn-secondary btn-sm btn-icon"
                                                        title="订阅链接"
                                                        onClick={() => openSubscriptionModal(client.email)}
                                                    >
                                                        <HiOutlineLink />
                                                    </button>
                                                    <button
                                                        className="btn btn-secondary btn-sm btn-icon"
                                                        title="订阅权限"
                                                        onClick={() => handleOpenPolicy(client)}
                                                    >
                                                        <HiOutlineShieldCheck />
                                                    </button>
                                                    <button
                                                        className="btn btn-danger btn-sm btn-icon"
                                                        title="删除"
                                                        onClick={() => handleDelete(client)}
                                                    >
                                                        <HiOutlineTrash />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Batch Action Bar */}
                {selectedVisibleCount > 0 && (
                    <div className="mobile-batch-bar">
                        <div className="batch-count">已选 {selectedVisibleCount} 项</div>
                        <button className="btn btn-success btn-sm" onClick={() => handleBulkSetEnable(true)}>启用</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleBulkSetEnable(false)}>停用</button>
                        <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}><HiOutlineTrash /> 删除</button>
                    </div>
                )}
            </div>

            {/* Subscription Modal */}
            {subscriptionModalOpen && (
                <div className="modal-overlay" onClick={() => setSubscriptionModalOpen(false)}>
                    <div
                        className="modal modal-wide glass-panel"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h3 className="modal-title">用户订阅</h3>
                            <button className="modal-close" onClick={() => setSubscriptionModalOpen(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="grid-auto-160 mb-4">
                                <select
                                    className="form-select"
                                    value={subscriptionEmail}
                                    onChange={(e) => setSubscriptionEmail(e.target.value)}
                                    disabled={subscriptionEmails.length === 0}
                                >
                                    {subscriptionEmails.length === 0 && <option value="">暂无可用邮箱</option>}
                                    {subscriptionEmails.map((email) => (
                                        <option key={email} value={email}>{email}</option>
                                    ))}
                                </select>
                                <button className="btn btn-secondary" onClick={() => loadSubscriptionForEmail(subscriptionEmail)} disabled={!subscriptionEmail || subscriptionLoading}>
                                    {subscriptionLoading ? <span className="spinner" /> : <><HiOutlineArrowPath /> 刷新</>}
                                </button>
                                <button className="btn btn-primary" onClick={handleCopySubscription} disabled={!activeSubscriptionProfile?.url || subscriptionResult?.subscriptionActive === false}>
                                    <HiOutlineClipboard /> 复制
                                </button>
                            </div>

                            {!subscriptionResult ? (
                                <div className="text-muted text-sm">选择用户后会显示订阅链接和二维码。</div>
                            ) : (
                                <div className="grid-auto-240 items-start">
                                    <div className="flex flex-col gap-3">
                                        <div className="text-sm text-muted">
                                            状态：{subscriptionResult.subscriptionActive ? '可用' : '失效'}{subscriptionResult.inactiveReason ? `（${subscriptionResult.inactiveReason}）` : ''}
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

            <ClientModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setBatchTargets([]);
                    setEditingClient(null);
                }}
                editingClient={editingClient}
                inboundId={modalInboundId}
                serverId={modalServerId}
                inboundProtocol={editingClient?.protocol || ''}
                targets={batchTargets}
                onSuccess={fetchAllClients}
                onBatchResult={handleShowBatchResult}
            />

            <BatchResultModal
                isOpen={!!batchResultData}
                onClose={() => setBatchResultData(null)}
                title={batchResultTitle}
                data={batchResultData}
            />

            <UserPolicyModal
                isOpen={policyModal.open}
                email={policyModal.email}
                servers={servers}
                onClose={() => setPolicyModal({ open: false, email: '' })}
            />

            <ConflictScannerModal
                isOpen={conflictModalOpen}
                onClose={() => setConflictModalOpen(false)}
                clients={clients}
                onRefreshClients={fetchAllClients}
                onShowBatchResult={handleShowBatchResult}
            />
        </>
    );
}
