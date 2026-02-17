import React, { useMemo, useState } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import Header from '../Layout/Header.jsx';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../utils/format.js';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineSignal,
    HiOutlineServerStack,
} from 'react-icons/hi2';

const ENV_OPTIONS = [
    { value: 'unknown', label: '未知' },
    { value: 'production', label: '生产' },
    { value: 'staging', label: '预发布' },
    { value: 'development', label: '开发' },
    { value: 'testing', label: '测试' },
    { value: 'dr', label: '容灾' },
    { value: 'sandbox', label: '沙箱' },
];

const HEALTH_OPTIONS = [
    { value: 'unknown', label: '未知' },
    { value: 'healthy', label: '健康' },
    { value: 'degraded', label: '降级' },
    { value: 'unreachable', label: '不可达' },
    { value: 'maintenance', label: '维护中' },
];

const PANEL_AUTH_REPAIR_CODES = new Set([
    'PANEL_CREDENTIAL_UNREADABLE',
    'PANEL_CREDENTIAL_MISSING',
    'PANEL_LOGIN_FAILED',
]);

export default function Servers() {
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
        tags: '',
        environment: 'unknown',
        health: 'unknown',
        entries: '',
        testConnection: true,
    });
    const [batchResult, setBatchResult] = useState(null);
    const [testResults, setTestResults] = useState({});
    const [loading, setLoading] = useState({});
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
    const [filterGroup, setFilterGroup] = useState('all');
    const [filterEnvironment, setFilterEnvironment] = useState('all');
    const [filterHealth, setFilterHealth] = useState('all');
    const confirmAction = useConfirm();

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
            tags: '',
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
            toast.error('请填写完整信息');
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
                toast.success(res.msg || '服务器已更新');
            } else {
                const res = await addServer(payload);
                toast.success(res.msg || '服务器已添加');
            }
            resetForm();
        } catch (err) {
            toast.error(getErrorMessage(err, '操作失败'));
        }
        setLoading(prev => ({ ...prev, submit: false }));
    };

    const handleBatchSubmit = async (e) => {
        e.preventDefault();
        const username = String(batchForm.username || '').trim();
        const password = String(batchForm.password || '').trim();
        if (!username || !password) {
            toast.error('请填写公共用户名和密码');
            return;
        }

        let items = [];
        try {
            items = parseBatchEntries(batchForm.entries);
        } catch (err) {
            toast.error(getErrorMessage(err, '批量内容格式错误'));
            return;
        }

        if (items.length === 0) {
            toast.error('请至少填写一条服务器记录');
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
                    tags: String(batchForm.tags || '').split(',').map((item) => item.trim()).filter(Boolean),
                    environment: batchForm.environment,
                    health: batchForm.health,
                },
                testConnection: batchForm.testConnection,
                items,
            };
            const res = await addServersBatch(payload);
            setBatchResult(res.obj || null);
            toast.success(res.msg || '批量添加完成');
        } catch (err) {
            toast.error(getErrorMessage(err, '批量添加失败'));
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

    const handleDelete = async (id) => {
        const ok = await confirmAction({
            title: '删除服务器',
            message: '确定删除该服务器吗？',
            details: '删除后该节点将不再参与集群任务与订阅聚合。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await removeServer(id);
            toast.success('服务器已删除');
        } catch (err) { toast.error(getErrorMessage(err, '删除失败')); }
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
        const ok = await confirmAction({
            title: '批量删除服务器',
            message: `确定删除选中的 ${selectedIds.size} 个服务器吗？`,
            details: '建议先确认没有依赖该节点的批量任务。',
            confirmText: '确认删除',
            tone: 'danger',
        });
        if (!ok) return;

        let successCount = 0;
        for (const id of selectedIds) {
            try {
                await removeServer(id);
                successCount++;
            } catch (err) {
                console.error(err);
            }
        }
        setSelectedIds(new Set());
        toast.success(`批量删除完成: ${successCount} 成功`);
    };

    const handleBulkTest = async () => {
        const ids = Array.from(selectedIds);
        setLoading(prev => ({ ...prev, bulkTest: true }));
        const failures = [];
        let repairTargetId = '';
        let repairReason = '';

        // Parallel testing
        await Promise.all(ids.map(async (id) => {
            setLoading(prev => ({ ...prev, [`test-${id}`]: true }));
            try {
                const res = await testConnection(id);
                setTestResults(prev => ({ ...prev, [id]: res.success ? 'success' : 'error' }));
                if (!res.success) {
                    failures.push({ id, msg: res.msg || '连接失败' });
                    const authCode = getAuthRepairCode(res);
                    if (!repairTargetId && authCode) {
                        repairTargetId = id;
                        repairReason = res.msg || '节点认证失败';
                    }
                }
            } catch (err) {
                setTestResults(prev => ({ ...prev, [id]: 'error' }));
                failures.push({ id, msg: getErrorMessage(err, '连接失败') });
                const authCode = getAuthRepairCode(err);
                if (!repairTargetId && authCode) {
                    repairTargetId = id;
                    repairReason = err?.response?.data?.msg || '节点认证失败';
                }
            }
            setLoading(prev => ({ ...prev, [`test-${id}`]: false }));
        }));

        setLoading(prev => ({ ...prev, bulkTest: false }));
        if (failures.length === 0) {
            toast.success('批量测试完成');
        } else {
            toast.error(`批量测试完成：${ids.length - failures.length}/${ids.length} 成功`);
        }
        if (repairTargetId) {
            openCredentialRepair(repairTargetId, repairReason);
        }
    };

    const getAuthRepairCode = (errorLike) => {
        const code = String(errorLike?.code || errorLike?.response?.data?.code || '').trim();
        if (!code) return '';
        return PANEL_AUTH_REPAIR_CODES.has(code) ? code : '';
    };

    const handleCredentialRepairSubmit = async (e) => {
        e.preventDefault();
        const username = String(credentialRepair.username || '').trim();
        const password = String(credentialRepair.password || '');
        if (!username || !password) {
            toast.error('请输入 3x-ui 管理用户名和密码');
            return;
        }

        const selectedTargetIds = credentialRepair.applyToSelected
            ? Array.from(selectedIds)
            : [];
        const baseTarget = credentialRepair.serverId ? [credentialRepair.serverId] : [];
        const targetIds = Array.from(new Set([...(selectedTargetIds.length > 0 ? selectedTargetIds : baseTarget)]));
        if (targetIds.length === 0) {
            toast.error('未找到需要修复的节点');
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
                    failures.push({ id, msg: res?.msg || '连接失败' });
                    setTestResults((prev) => ({ ...prev, [id]: 'error' }));
                }
            } catch (err) {
                failures.push({ id, msg: getErrorMessage(err, '连接失败') });
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
        toast.error('凭据验证失败，请检查 3x-ui 用户名/密码');
    };

    const handleTest = async (id) => {
        setLoading(prev => ({ ...prev, [`test-${id}`]: true }));
        try {
            const res = await testConnection(id);
            setTestResults(prev => ({ ...prev, [id]: res.success ? 'success' : 'error' }));
            if (res.success) {
                toast.success('连接成功');
            } else {
                toast.error(res.msg || '连接失败');
                const authCode = getAuthRepairCode(res);
                if (authCode) {
                    openCredentialRepair(id, res.msg || '节点认证失败');
                }
            }
        } catch (err) {
            setTestResults(prev => ({ ...prev, [id]: 'error' }));
            const authCode = getAuthRepairCode(err);
            if (authCode) {
                const reason = err?.response?.data?.msg || '节点认证失败，请更新并保存凭据';
                openCredentialRepair(id, reason);
                toast.error(reason);
            } else {
                toast.error(getErrorMessage(err, '连接失败'));
            }
        }
        setLoading(prev => ({ ...prev, [`test-${id}`]: false }));
    };

    const groupOptions = useMemo(() => {
        const set = new Set(
            servers
                .map((item) => String(item.group || '').trim())
                .filter(Boolean)
        );
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [servers]);

    const filteredServers = useMemo(() => {
        const keyword = String(searchKeyword || '').trim().toLowerCase();
        return servers.filter((server) => {
            if (filterGroup !== 'all' && String(server.group || '') !== filterGroup) return false;
            if (filterEnvironment !== 'all' && String(server.environment || 'unknown') !== filterEnvironment) return false;
            if (filterHealth !== 'all' && String(server.health || 'unknown') !== filterHealth) return false;
            if (!keyword) return true;
            const tagsText = Array.isArray(server.tags) ? server.tags.join(' ') : '';
            const text = [
                server.name,
                server.url,
                server.username,
                server.group,
                server.environment,
                server.health,
                tagsText,
            ]
                .map((item) => String(item || '').toLowerCase())
                .join(' ');
            return text.includes(keyword);
        });
    }, [servers, searchKeyword, filterGroup, filterEnvironment, filterHealth]);
    const allVisibleSelected = filteredServers.length > 0 && filteredServers.every((item) => selectedIds.has(item.id));
    const repairTargetServer = servers.find((item) => item.id === credentialRepair.serverId) || null;

    return (
        <>
            <Header title="服务器管理" />
            <div className="page-content page-enter">
                <div className="flex items-center justify-between mb-6 glass-panel p-4">
                    <div>
                        <h2 className="text-glow section-title">已注册的服务器</h2>
                        <p className="text-muted mt-1 section-subtitle">管理您的 3x-ui 面板连接</p>
                    </div>
                    <div className="flex gap-4 items-center flex-wrap justify-end">
                        {selectedIds.size > 0 && (
                            <div className="flex gap-2 items-center animate-fade-in">
                                <span className="text-sm font-bold px-2 text-primary">已选 {selectedIds.size} 项</span>
                                <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                                    <HiOutlineTrash /> 删除
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={handleBulkTest} disabled={loading.bulkTest}>
                                    {loading.bulkTest ? <span className="spinner" /> : <HiOutlineSignal />} 测试
                                </button>
                            </div>
                        )}
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setBatchResult(null); setShowBatchForm(true); }}
                        >
                            <HiOutlinePlusCircle /> 批量添加
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
                            <HiOutlinePlusCircle /> 添加服务器
                        </button>
                        <label className="flex items-center gap-2 cursor-pointer btn btn-secondary btn-sm">
                            <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                onChange={toggleSelectAll}
                                className="hidden"
                            />
                            <span>{allVisibleSelected ? '取消全选' : '全选'}</span>
                        </label>
                    </div>
                </div>

                <div className="card mb-4 p-3">
                    <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                        <input
                            className="form-input"
                            style={{ maxWidth: '260px' }}
                            placeholder="搜索名称 / URL / 标签"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                        />
                        <select className="form-select" style={{ width: '160px' }} value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
                            <option value="all">全部分组</option>
                            {groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}
                        </select>
                        <div className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
                            显示 {filteredServers.length} / {servers.length}
                        </div>
                    </div>
                </div>

                {/* Server Cards */}
                {servers.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineServerStack /></div>
                        <div className="empty-state-text">暂无服务器</div>
                        <div className="empty-state-sub">点击上方按钮添加您的第一台 3x-ui 面板</div>
                    </div>
                ) : filteredServers.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineServerStack /></div>
                        <div className="empty-state-text">没有匹配的服务器</div>
                        <div className="empty-state-sub">请调整分组/环境/健康筛选条件</div>
                    </div>
                ) : (
                    <div className="grid-auto-280">
                        {filteredServers.map(server => {
                            const isSelected = selectedIds.has(server.id);
                            const isActive = server.id === activeServerId;
                            const credentialStatus = String(server.credentialStatus || 'configured');
                            const credentialBadge = credentialStatus === 'unreadable'
                                ? { cls: 'badge-danger', text: '凭据不可解密' }
                                : (credentialStatus === 'missing'
                                    ? { cls: 'badge-warning', text: '缺少凭据' }
                                    : { cls: 'badge-success', text: '凭据已保存' });
                            return (
                                <div
                                    key={server.id}
                                    className={`card server-card hover-lift transition-all duration-300 ${isSelected ? 'ring-1 ring-primary-soft bg-white/5' : ''} ${isActive ? 'active' : ''}`}
                                    onClick={() => selectServer(server.id)}
                                >
                                    <div className="absolute top-4 right-4" onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            className="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(server.id)}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between mb-6 pr-8">
                                        <div className="flex items-center gap-4">
                                            <div className="card-icon server-card-icon">
                                                <HiOutlineServerStack />
                                            </div>
                                            <div>
                                                <div className={`server-card-name ${isActive ? 'text-glow' : ''}`}>{server.name}</div>
                                                <div className="text-sm text-muted font-mono mt-1">{getPanelUrl(server)}</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-sm text-muted mb-6 bg-black/20 p-3 rounded-lg border border-white/5">
                                        <div className="flex-1 truncate">
                                            <span className="opacity-70">用户: </span>
                                            <span className="font-medium text-primary">{server.username}</span>
                                        </div>
                                        {isActive && (
                                            <span className="badge badge-success px-2 py-0.5 text-xs">Active</span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2 mb-4 text-xs">
                                        <span className="badge badge-neutral">分组: {server.group || '未分组'}</span>
                                        <span className={`badge ${credentialBadge.cls}`}>{credentialBadge.text}</span>
                                        {Array.isArray(server.tags) && server.tags.slice(0, 3).map((tag) => (
                                            <span key={`${server.id}-${tag}`} className="badge badge-info">{tag}</span>
                                        ))}
                                    </div>

                                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="btn btn-secondary btn-sm flex-1"
                                            onClick={() => handleTest(server.id)}
                                            disabled={loading[`test-${server.id}`]}
                                        >
                                            {loading[`test-${server.id}`] ? <span className="spinner" /> : <HiOutlineSignal />}
                                            {testResults[server.id] === 'success' ? '正常' : testResults[server.id] === 'error' ? '失败' : '测试连接'}
                                        </button>
                                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleEdit(server)} title="编辑">
                                            <HiOutlinePencilSquare />
                                        </button>
                                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(server.id)} title="删除">
                                            <HiOutlineTrash />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Add/Edit Modal */}
                {showForm && (
                    <div className="modal-overlay" onClick={resetForm}>
                        <div className="modal glass-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">{editingId ? '编辑服务器' : '添加服务器'}</h3>
                                <button className="modal-close" onClick={resetForm}>×</button>
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
                                    <button type="button" className="btn btn-secondary" onClick={resetForm}>取消</button>
                                    <button type="submit" className="btn btn-primary" disabled={loading.submit}>
                                        {loading.submit ? <span className="spinner" /> : editingId ? '保存' : '添加'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Batch Add Modal */}
                {showBatchForm && (
                    <div className="modal-overlay" onClick={resetBatchForm}>
                        <div className="modal modal-lg glass-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">批量添加服务器</h3>
                                <button className="modal-close" onClick={resetBatchForm}>×</button>
                            </div>
                            <form onSubmit={handleBatchSubmit}>
                                <div className="modal-body">
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

                                    <div className="grid-auto-220">
                                        <div className="form-group">
                                            <label className="form-label">默认分组</label>
                                            <input
                                                className="form-input"
                                                placeholder="例如: 亚太"
                                                value={batchForm.group}
                                                onChange={(e) => setBatchForm((prev) => ({ ...prev, group: e.target.value }))}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">默认标签 (逗号分隔)</label>
                                            <input
                                                className="form-input"
                                                placeholder="core,vip"
                                                value={batchForm.tags}
                                                onChange={(e) => setBatchForm((prev) => ({ ...prev, tags: e.target.value }))}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group mt-3 mb-0">
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit">
                                            <input
                                                type="checkbox"
                                                checked={batchForm.testConnection}
                                                onChange={(e) => setBatchForm((prev) => ({ ...prev, testConnection: e.target.checked }))}
                                            />
                                            添加后自动测试连接
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

                                    {batchResult && (
                                        <div className="card mt-4 p-3">
                                            <div className="flex gap-8 items-center mb-12 flex-wrap">
                                                <span className="badge badge-neutral">总计 {batchResult.summary?.total || 0}</span>
                                                <span className="badge badge-success">成功 {batchResult.summary?.success || 0}</span>
                                                <span className="badge badge-danger">失败 {batchResult.summary?.failed || 0}</span>
                                            </div>
                                            <div className="table-container table-scroll table-scroll-sm">
                                                <table className="table">
                                                    <thead>
                                                        <tr>
                                                            <th>行号</th>
                                                            <th>名称</th>
                                                            <th>地址</th>
                                                            <th>Path</th>
                                                            <th>状态</th>
                                                            <th>结果</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(batchResult.results || []).map((item) => (
                                                            <tr key={`batch-add-${item.line}-${item.url || item.name || ''}`}>
                                                                <td data-label="行号">{item.line || '-'}</td>
                                                                <td data-label="名称">{item.name || '-'}</td>
                                                                <td data-label="地址" className="table-word-220">
                                                                    {item.url || '-'}
                                                                </td>
                                                                <td data-label="Path">{item.basePath || '-'}</td>
                                                                <td data-label="状态">
                                                                    <span className={`badge ${item.success ? 'badge-success' : 'badge-danger'}`}>
                                                                        {item.success ? '成功' : '失败'}
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
                                    <button type="button" className="btn btn-secondary" onClick={resetBatchForm}>关闭</button>
                                    <button type="submit" className="btn btn-primary" disabled={loading.batchSubmit}>
                                        {loading.batchSubmit ? <span className="spinner" /> : '开始批量添加'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {credentialRepair.open && (
                    <div className="modal-overlay" onClick={closeCredentialRepair}>
                        <div className="modal glass-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="modal-title text-glow">修复节点登录凭据</h3>
                                <button className="modal-close" onClick={closeCredentialRepair}>×</button>
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
                                        <label className="badge badge-neutral flex items-center gap-2 cursor-pointer w-fit mt-2">
                                            <input
                                                type="checkbox"
                                                checked={credentialRepair.applyToSelected}
                                                onChange={(e) => setCredentialRepair((prev) => ({ ...prev, applyToSelected: e.target.checked }))}
                                            />
                                            同时应用到已选中的 {selectedIds.size} 个节点
                                        </label>
                                    )}
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={closeCredentialRepair}>取消</button>
                                    <button type="submit" className="btn btn-primary" disabled={loading.repairCredentials}>
                                        {loading.repairCredentials ? <span className="spinner" /> : '保存并测试连接'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
