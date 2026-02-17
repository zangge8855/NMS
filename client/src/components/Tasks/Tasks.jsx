import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineTrash, HiOutlineEye, HiOutlineArrowUturnLeft } from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import toast from 'react-hot-toast';
import BatchResultModal from '../Batch/BatchResultModal.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';

function formatAction(type, action) {
    return `${type || '-'} / ${action || '-'}`;
}

export default function Tasks({ embedded = false }) {
    const confirmAction = useConfirm();
    const [loading, setLoading] = useState(false);
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [retryingId, setRetryingId] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [actionFilter, setActionFilter] = useState('all');
    const [serverFilter, setServerFilter] = useState('all');
    const [failedOnlyFilter, setFailedOnlyFilter] = useState(false);
    const [retryGroupBy, setRetryGroupBy] = useState('none');

    const fetchTasks = async () => {
        setLoading(true);
        try {
            const res = await api.get('/jobs?page=1&pageSize=100&includeResults=true');
            setTasks(res.data?.obj?.items || []);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '加载任务失败';
            toast.error(msg);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    const getTaskServers = (task) => {
        const results = Array.isArray(task?.results) ? task.results : [];
        const values = Array.from(new Set(
            results
                .map((item) => item.serverName || item.serverId)
                .filter(Boolean)
        ));
        return values;
    };

    const typeOptions = useMemo(() => (
        Array.from(new Set(tasks.map((task) => task.type).filter(Boolean))).sort()
    ), [tasks]);

    const actionOptions = useMemo(() => (
        Array.from(new Set(tasks.map((task) => task.action).filter(Boolean))).sort()
    ), [tasks]);

    const serverOptions = useMemo(() => {
        const values = new Set();
        tasks.forEach((task) => {
            getTaskServers(task).forEach((name) => values.add(name));
        });
        return Array.from(values).sort();
    }, [tasks]);

    const filteredTasks = useMemo(() => (
        tasks.filter((task) => {
            if (typeFilter !== 'all' && task.type !== typeFilter) return false;
            if (actionFilter !== 'all' && task.action !== actionFilter) return false;
            if (failedOnlyFilter && !(Number(task.summary?.failed || 0) > 0)) return false;
            if (serverFilter !== 'all') {
                const servers = getTaskServers(task);
                if (!servers.includes(serverFilter)) return false;
            }
            return true;
        })
    ), [tasks, typeFilter, actionFilter, serverFilter, failedOnlyFilter]);

    const handleView = async (id) => {
        try {
            const res = await api.get(`/jobs/${id}`);
            setSelectedTask(res.data?.obj || null);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '获取任务详情失败';
            toast.error(msg);
        }
    };

    const handleClear = async () => {
        const ok = await confirmAction({
            title: '清空任务历史',
            message: '确定清空批量任务历史吗？',
            details: '该操作不会影响已执行的节点配置，只会清空控制台历史记录。',
            confirmText: '确认清空',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete('/jobs/history');
            toast.success('任务历史已清空');
            setTasks([]);
            setSelectedTask(null);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '清空失败';
            toast.error(msg);
        }
    };

    const handleRetryFailed = async (task) => {
        if (!task?.id) return;
        setRetryingId(task.id);
        try {
            const payload = await attachBatchRiskToken({
                failedOnly: true,
                groupBy: retryGroupBy,
            }, {
                type: task.type,
                action: task.action,
                isRetry: true,
                targetCount: Number(task.summary?.failed || 0),
            });
            const res = await api.post(`/jobs/${task.id}/retry`, payload);
            const output = res.data?.obj;
            if (output) {
                setSelectedTask({
                    type: task.type,
                    action: task.action,
                    summary: output.summary,
                    results: output.results || [],
                });
            }
            const summary = output?.summary || { success: 0, total: 0, failed: 0 };
            toast.success(`重试完成: ${summary.success}/${summary.total} 成功`);
            await fetchTasks();
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || '重试失败';
            toast.error(msg);
        }
        setRetryingId('');
    };

    return (
        <>
            {!embedded && <Header title="任务中心" />}
            <div className={embedded ? '' : 'page-content page-enter'}>
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>
                            {embedded ? '任务日志' : '批量任务历史'}
                        </h2>
                        <p className="text-sm text-muted mt-1">记录批量用户/入站操作的执行结果</p>
                    </div>
                    <div className="flex gap-2">
                        <button className="btn btn-secondary btn-sm" onClick={fetchTasks} disabled={loading}>
                            <HiOutlineArrowPath className={loading ? 'spinning' : ''} /> 刷新
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={handleClear}>
                            <HiOutlineTrash /> 清空
                        </button>
                    </div>
                </div>

                <div className="card mb-8" style={{ padding: '12px' }}>
                    <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                        <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: '140px' }}>
                            <option value="all">全部类型</option>
                            {typeOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <select className="form-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ width: '140px' }}>
                            <option value="all">全部动作</option>
                            {actionOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <select className="form-select" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} style={{ width: '180px' }}>
                            <option value="all">全部节点</option>
                            {serverOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={failedOnlyFilter}
                                onChange={(e) => setFailedOnlyFilter(e.target.checked)}
                            />
                            仅失败任务
                        </label>
                        <select className="form-select" value={retryGroupBy} onChange={(e) => setRetryGroupBy(e.target.value)} style={{ width: '180px' }}>
                            <option value="none">重试策略: 全部失败项</option>
                            <option value="server">重试策略: 按节点分组</option>
                            <option value="error">重试策略: 按错误分组</option>
                            <option value="server_error">重试策略: 节点+错误分组</option>
                        </select>
                        <div className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
                            共 {filteredTasks.length} 条
                        </div>
                    </div>
                </div>

                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>时间</th>
                                <th>类型/动作</th>
                                <th>节点</th>
                                <th>总计</th>
                                <th>成功</th>
                                <th>失败</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="text-center" style={{ padding: '32px' }}>
                                        <div className="spinner mx-auto" />
                                    </td>
                                </tr>
                            ) : filteredTasks.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center" style={{ padding: '32px' }}>
                                        暂无批量任务
                                    </td>
                                </tr>
                            ) : (
                                filteredTasks.map((task) => (
                                    <tr key={task.id}>
                                        <td>{new Date(task.createdAt).toLocaleString('zh-CN')}</td>
                                        <td>{formatAction(task.type, task.action)}</td>
                                        <td className="text-sm text-muted">
                                            {(() => {
                                                const servers = getTaskServers(task);
                                                if (servers.length === 0) return '-';
                                                const head = servers.slice(0, 2).join(', ');
                                                if (servers.length <= 2) return head;
                                                return `${head} +${servers.length - 2}`;
                                            })()}
                                        </td>
                                        <td>{task.summary?.total ?? '-'}</td>
                                        <td>{task.summary?.success ?? '-'}</td>
                                        <td>{task.summary?.failed ?? '-'}</td>
                                        <td className="flex gap-2">
                                            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleView(task.id)} title="查看详情">
                                                <HiOutlineEye />
                                            </button>
                                            {Number(task.summary?.failed || 0) > 0 && (
                                                <button
                                                    className="btn btn-primary btn-sm btn-icon"
                                                    onClick={() => handleRetryFailed(task)}
                                                    disabled={retryingId === task.id}
                                                    title="重试失败项"
                                                >
                                                    {retryingId === task.id ? <span className="spinner" /> : <HiOutlineArrowUturnLeft />}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <BatchResultModal
                isOpen={!!selectedTask}
                onClose={() => setSelectedTask(null)}
                title={`任务详情: ${selectedTask ? formatAction(selectedTask.type, selectedTask.action) : ''}`}
                data={selectedTask ? { summary: selectedTask.summary, results: selectedTask.results || [] } : null}
            />
        </>
    );
}
