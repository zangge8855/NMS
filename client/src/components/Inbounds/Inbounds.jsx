import React, { useState, useEffect } from 'react';
import { useServer } from '../../contexts/ServerContext.jsx';
import api from '../../api/client.js';
import Header from '../Layout/Header.jsx';
import { formatBytes } from '../../utils/format.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import {
    HiOutlinePlusCircle,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineArrowPath,
    HiOutlineServer,
    HiOutlineUserPlus,
    HiOutlineSignal
} from 'react-icons/hi2';

import InboundModal from './InboundModal.jsx';
import ClientModal from '../Clients/ClientModal.jsx';
import BatchResultModal from '../Batch/BatchResultModal.jsx';

export default function Inbounds() {
    const { servers } = useServer();
    const confirmAction = useConfirm();

    const [inbounds, setInbounds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInbound, setEditingInbound] = useState(null);
    const [filterServerId, setFilterServerId] = useState('all');

    // Batch Selection State
    const [selectedKeys, setSelectedKeys] = useState(new Set());

    // Batch Client Add State
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientTargets, setClientTargets] = useState([]);
    const [batchResultData, setBatchResultData] = useState(null);
    const [batchResultTitle, setBatchResultTitle] = useState('批量执行结果');

    const fetchAllInbounds = async () => {
        if (servers.length === 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const allResults = [];
        setSelectedKeys(new Set());

        await Promise.all(servers.map(async (server) => {
            try {
                const res = await api.get(`/panel/${server.id}/panel/api/inbounds/list`);
                if (res.data?.obj) {
                    const serverInbounds = res.data.obj.map(ib => ({
                        ...ib,
                        serverId: server.id,
                        serverName: server.name,
                        uiKey: `${server.id}-${ib.id}`
                    }));
                    allResults.push(...serverInbounds);
                }
            } catch (err) {
                console.error(`Failed to fetch inbounds from ${server.name}`, err);
                toast.error(`节点 ${server.name} 连接失败`, { id: `err-${server.id}` });
            }
        }));

        allResults.sort((a, b) => {
            if (a.serverId !== b.serverId) {
                return String(a.serverName || '').localeCompare(String(b.serverName || ''));
            }
            return Number(a.port || 0) - Number(b.port || 0);
        });

        setInbounds(allResults);
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

    const handleBulkAddClient = () => {
        const targets = selectedVisibleInbounds;
        // Only protocols with 3x-ui "clients" model can be batch-added here.
        const supported = targets.filter(t => {
            const protocol = String(t.protocol || '').toLowerCase();
            return ['vmess', 'vless', 'trojan', 'shadowsocks'].includes(protocol);
        });

        if (supported.length === 0) {
            toast.error('仅 VMESS / VLESS / TROJAN / SHADOWSOCKS 支持批量添加用户');
            return;
        }

        setClientTargets(supported);
        setIsClientModalOpen(true);
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

    const parseClients = (ib) => {
        try {
            const settings = JSON.parse(ib.settings || '{}');
            return settings.clients || [];
        } catch {
            return [];
        }
    };

    const filteredInbounds = filterServerId === 'all'
        ? inbounds
        : inbounds.filter(i => i.serverId === filterServerId);
    const selectedVisibleInbounds = filteredInbounds.filter(i => selectedKeys.has(i.uiKey));
    const selectedVisibleCount = selectedVisibleInbounds.length;

    if (servers.length === 0) {
        return (
            <>
                <Header title="入站管理" />
                <div className="page-content page-enter">
                    <div className="empty-state">
                        <div className="empty-state-icon"><HiOutlineSignal style={{ fontSize: '48px' }} /></div>
                        <div className="empty-state-text">请先在「服务器管理」添加节点</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header title="入站管理" />
            <div className="page-content page-enter">
                {/* Toolbar */}
                <div className="flex items-center justify-between mb-6 glass-panel p-4 mobile-toolbar">
                    <div className="flex items-center gap-4">
                        <select
                            className="form-select"
                            value={filterServerId}
                            onChange={(e) => setFilterServerId(e.target.value)}
                            style={{ width: 'auto', minWidth: '160px' }}
                        >
                            <option value="all">全部节点 ({servers.length})</option>
                            {servers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <div>
                            <h2 className="text-glow text-lg font-semibold">入站列表</h2>
                            <p className="text-muted mt-1" style={{ fontSize: '12px' }}>共 {filteredInbounds.length} 条规则</p>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        {selectedVisibleCount > 0 ? (
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

                <div className="table-container glass-panel">
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
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={`skeleton-${i}`}>
                                        <td className="p-4"><div className="skeleton w-4 h-4 rounded" /></td>
                                        {filterServerId === 'all' && <td className="p-4"><div className="skeleton w-20 h-5" /></td>}
                                        <td className="p-4"><div className="skeleton w-24 h-5" /></td>
                                        <td className="p-4"><div className="skeleton w-12 h-5" /></td>
                                        <td className="p-4"><div className="skeleton w-20 h-5" /></td>
                                        <td className="p-4"><div className="skeleton w-8 h-5" /></td>
                                        <td className="p-4"><div className="skeleton w-32 h-5" /></td>
                                        <td className="p-4"><div className="skeleton w-12 h-5" /></td>
                                        <td className="p-4"><div className="skeleton w-16 h-8" /></td>
                                    </tr>
                                ))
                            ) : filteredInbounds.length === 0 ? (
                                <tr><td colSpan={10} className="text-center" style={{ padding: '32px' }}>暂无入站规则</td></tr>
                            ) : (
                                filteredInbounds.map((ib) => {
                                    const clients = parseClients(ib);
                                    const isExpanded = expandedId === ib.uiKey;
                                    const isSelected = selectedKeys.has(ib.uiKey);
                                    return (
                                        <React.Fragment key={ib.uiKey}>
                                            <tr
                                                className={`cursor-pointer transition-colors hover-bg-surface ${isSelected ? 'bg-white/5' : ''}`}
                                                onClick={() => setExpandedId(isExpanded ? null : ib.uiKey)}
                                            >
                                                <td data-label="" onClick={e => e.stopPropagation()} className="text-center mobile-checkbox-cell">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelect(ib.uiKey)}
                                                        className="cursor-pointer"
                                                    />
                                                </td>
                                                {filterServerId === 'all' && (
                                                    <td data-label="节点">
                                                        <span className="badge badge-neutral flex items-center gap-1 w-fit">
                                                            <HiOutlineServer size={10} /> {ib.serverName}
                                                        </span>
                                                    </td>
                                                )}
                                                <td data-label="备注" className="font-medium text-white">{ib.remark || '-'}</td>
                                                <td data-label="协议"><span className="badge badge-info">{ib.protocol}</span></td>
                                                <td data-label="端口" className="font-mono text-sm">{ib.listen || '*'}:{ib.port}</td>
                                                <td data-label="用户数">{clients.length}</td>
                                                <td data-label="流量" className="text-sm">
                                                    <span className="text-success">↑{formatBytes(ib.up)}</span>
                                                    <span className="text-muted mx-1">/</span>
                                                    <span className="text-info">↓{formatBytes(ib.down)}</span>
                                                </td>
                                                <td data-label="状态">
                                                    <span className={`badge ${ib.enable ? 'badge-success' : 'badge-danger'}`}>
                                                        {ib.enable ? '启用' : '禁用'}
                                                    </span>
                                                </td>
                                                <td data-label="" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex gap-2">
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
                                                    <td colSpan={10} className="p-0 bg-black/20">
                                                        <div className="p-4">
                                                            <div className="text-xs font-bold text-muted mb-2 uppercase tracking-wider">
                                                                用户列表 ({clients.length})
                                                            </div>
                                                            <table className="table w-full text-xs">
                                                                <thead>
                                                                    <tr>
                                                                        <th>Email</th>
                                                                        <th>ID/密码</th>
                                                                        <th>流量 (总/已用)</th>
                                                                        <th>到期时间</th>
                                                                        <th>状态</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {clients.map((cl, idx) => (
                                                                        <tr key={idx}>
                                                                            <td>{cl.email || '-'}</td>
                                                                            <td className="font-mono truncate max-w-[200px]" title={cl.id || cl.password}>
                                                                                {cl.id || cl.password || '-'}
                                                                            </td>
                                                                            <td>
                                                                                {cl.totalGB ? formatBytes(cl.totalGB) : '∞'} / {formatBytes(cl.up + cl.down)}
                                                                            </td>
                                                                            <td>{cl.expiryTime ? new Date(cl.expiryTime).toLocaleDateString() : '永久'}</td>
                                                                            <td>
                                                                                <span className={`badge ${cl.enable !== false ? 'badge-success' : 'badge-danger'}`}>
                                                                                    {cl.enable !== false ? '启用' : '禁用'}
                                                                                </span>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
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

                {/* Mobile Batch Action Bar */}
                {selectedVisibleCount > 0 && (
                    <div className="mobile-batch-bar">
                        <div className="batch-count">已选 {selectedVisibleCount} 项</div>
                        <button className="btn btn-success btn-sm" onClick={() => handleBulkSetEnable(true)}>启用</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleBulkSetEnable(false)}>停用</button>
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
            </div >
        </>
    );
}
