import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineArrowPath, HiOutlineTrash, HiOutlineEye, HiOutlineArrowUturnLeft } from 'react-icons/hi2';
import Header from '../Layout/Header.jsx';
import SkeletonTable from '../UI/SkeletonTable.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import api from '../../api/client.js';
import { attachBatchRiskToken } from '../../utils/riskConfirm.js';
import {
    formatRetryGroupLabel,
    formatTaskActionLabel,
    formatTaskActionPair,
    formatTaskTypeLabel,
} from '../../utils/taskLabels.js';
import toast from 'react-hot-toast';
import BatchResultModal from '../Batch/BatchResultModal.jsx';
import { useConfirm } from '../../contexts/ConfirmContext.jsx';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import PageToolbar from '../UI/PageToolbar.jsx';
import { formatDateTime } from '../../utils/format.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';

const TASKS_COPY = {
    'zh-CN': {
        loadFailed: '加载任务失败',
        detailFailed: '获取任务详情失败',
        clearFailed: '清空失败',
        retryDone: '重试完成: {success}/{total} 成功',
        retryFailed: '重试失败',
        embeddedTitle: '批量操作历史',
        embeddedSubtitle: '与上方操作审计配套，集中查看批量任务与重试结果',
        pageTitle: '批量任务历史',
        pageSubtitle: '记录批量用户/入站操作的执行结果',
        refresh: '刷新',
        clear: '清空',
        noFilters: '未设置筛选',
        filtersActive: '已启用 {count} 项',
        allTypes: '全部类型',
        allActions: '全部动作',
        allServers: '全部节点',
        failedOnly: '仅失败任务',
        total: '共 {count} 条',
        time: '时间',
        typeAction: '类型 / 动作',
        server: '节点',
        totalCol: '总计',
        successCol: '成功',
        failedCol: '失败',
        actions: '操作',
        emptyTitle: '暂无批量任务',
        emptySubtitle: '执行批量操作后将在此显示',
        retained: '最近保留 {count} 条',
        viewDetail: '查看详情',
        retryFailedItems: '重试失败项',
        detailTitle: '任务详情: {label}',
    },
    'en-US': {
        loadFailed: 'Failed to load tasks',
        detailFailed: 'Failed to load task detail',
        clearFailed: 'Clear failed',
        retryDone: 'Retry finished: {success}/{total} succeeded',
        retryFailed: 'Retry failed',
        embeddedTitle: 'Batch Operation History',
        embeddedSubtitle: 'Review batch jobs and retry results together with the audit log',
        pageTitle: 'Batch Task History',
        pageSubtitle: 'Execution results for bulk user and inbound operations',
        refresh: 'Refresh',
        clear: 'Clear',
        noFilters: 'No filters',
        filtersActive: '{count} active',
        allTypes: 'All Types',
        allActions: 'All Actions',
        allServers: 'All Nodes',
        failedOnly: 'Failed Only',
        total: '{count} total',
        time: 'Time',
        typeAction: 'Type / Action',
        server: 'Node',
        totalCol: 'Total',
        successCol: 'Succeeded',
        failedCol: 'Failed',
        actions: 'Actions',
        emptyTitle: 'No batch tasks',
        emptySubtitle: 'Batch task results will appear here after execution',
        retained: '{count} retained',
        viewDetail: 'View Detail',
        retryFailedItems: 'Retry Failed Items',
        detailTitle: 'Task Detail: {label}',
    },
};

function getTasksCopy(locale = 'zh-CN') {
    return TASKS_COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
}

function getTaskServers(task) {
    const results = Array.isArray(task?.results) ? task.results : [];
    return Array.from(new Set(
        results
            .map((item) => item.serverName || item.serverId)
            .filter(Boolean)
    ));
}

function formatTaskServerSummary(task) {
    const servers = getTaskServers(task);
    if (servers.length === 0) return '-';
    const head = servers.slice(0, 2).join(', ');
    if (servers.length <= 2) return head;
    return `${head} +${servers.length - 2}`;
}

function getTaskResultBadge(task, copy) {
    const failed = Number(task?.summary?.failed || 0);
    if (failed > 0) {
        return {
            className: 'badge-danger',
            label: `${copy.failedCol} ${failed}`,
        };
    }
    return {
        className: 'badge-success',
        label: `${copy.successCol} ${Number(task?.summary?.success || 0)}`,
    };
}

function TaskMobileList({
    tasks = [],
    copy,
    locale,
    retryingId,
    onView,
    onRetryFailed,
}) {
    return (
        <div className="tasks-mobile-list audit-mobile-list">
            {tasks.map((task) => {
                const badge = getTaskResultBadge(task, copy);
                const failedCount = Number(task?.summary?.failed || 0);
                return (
                    <div key={task.id} className="tasks-mobile-card audit-mobile-card">
                        <div className="audit-mobile-card-head">
                            <div className="audit-mobile-card-copy">
                                <div className="audit-mobile-card-title">{formatTaskActionPair(task.type, task.action, locale)}</div>
                                <div className="audit-mobile-card-subtitle">{formatDateTime(task.createdAt, locale)}</div>
                            </div>
                            <span className={`badge ${badge.className}`}>{badge.label}</span>
                        </div>
                        <div className="audit-mobile-card-grid tasks-mobile-grid">
                            <div className="audit-mobile-card-item audit-mobile-card-item--full">
                                <span className="audit-mobile-card-label">{copy.server}</span>
                                <span className="audit-mobile-card-value tasks-mobile-server-value">
                                    {formatTaskServerSummary(task)}
                                </span>
                            </div>
                            <div className="audit-mobile-card-item">
                                <span className="audit-mobile-card-label">{copy.totalCol}</span>
                                <span className="audit-mobile-card-value audit-mobile-card-value--mono">{task.summary?.total ?? '-'}</span>
                            </div>
                            <div className="audit-mobile-card-item">
                                <span className="audit-mobile-card-label">{copy.successCol}</span>
                                <span className="audit-mobile-card-value audit-mobile-card-value--mono">{task.summary?.success ?? '-'}</span>
                            </div>
                            <div className="audit-mobile-card-item">
                                <span className="audit-mobile-card-label">{copy.failedCol}</span>
                                <span className="audit-mobile-card-value audit-mobile-card-value--mono">{task.summary?.failed ?? '-'}</span>
                            </div>
                        </div>
                        <div className="audit-mobile-card-actions tasks-mobile-actions">
                            <button
                                className="btn btn-secondary btn-sm rounded-lg"
                                onClick={() => onView(task.id)}
                                title={copy.viewDetail}
                                aria-label={copy.viewDetail}
                            >
                                <HiOutlineEye />
                                <span>{copy.viewDetail}</span>
                            </button>
                            {failedCount > 0 && (
                                <button
                                    className="btn btn-primary btn-sm rounded-lg"
                                    onClick={() => onRetryFailed(task)}
                                    disabled={retryingId === task.id}
                                    title={copy.retryFailedItems}
                                    aria-label={copy.retryFailedItems}
                                >
                                    {retryingId === task.id ? <span className="spinner" /> : <HiOutlineArrowUturnLeft />}
                                    <span>{copy.retryFailedItems}</span>
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default function Tasks({ embedded = false }) {
    const confirmAction = useConfirm();
    const { locale, t } = useI18n();
    const isCompactLayout = useMediaQuery('(max-width: 768px)');
    const copy = getTasksCopy(locale);
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
            const msg = err.response?.data?.msg || err.message || copy.loadFailed;
            toast.error(msg);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchTasks();
    }, []);

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

    const activeTaskFilterCount = useMemo(() => {
        let count = 0;
        if (typeFilter !== 'all') count += 1;
        if (actionFilter !== 'all') count += 1;
        if (serverFilter !== 'all') count += 1;
        if (failedOnlyFilter) count += 1;
        if (retryGroupBy !== 'none') count += 1;
        return count;
    }, [actionFilter, failedOnlyFilter, retryGroupBy, serverFilter, typeFilter]);

    const shellClassName = embedded ? 'tasks-embedded-shell' : 'page-content page-enter';
    const filterCardClassName = embedded ? 'card p-4 audit-control-card audit-control-card-tasks' : 'card mb-8 p-3 tasks-filter-card';
    // Converge on the shared table shell instead of page-specific container variants.
    const tableShellClassName = embedded ? 'table-container' : 'table-container mb-8';
    const mobileListShellClassName = embedded ? 'tasks-mobile-shell' : 'tasks-mobile-shell mb-8';
    const headClassName = embedded ? 'audit-traffic-toolbar mb-6' : 'page-section-head tasks-page-head mb-8';
    const paginationClassName = 'audit-pagination page-pagination';
    const filterSelectClassName = 'form-select rounded-lg';
    const failedOnlyCheckboxClassName = 'rounded';

    const handleView = async (id) => {
        try {
            const res = await api.get(`/jobs/${id}`);
            setSelectedTask(res.data?.obj || null);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.detailFailed;
            toast.error(msg);
        }
    };

    const handleClear = async () => {
        const ok = await confirmAction({
            title: t('comp.tasks.clearTitle') || '清空任务历史',
            message: t('comp.tasks.clearMessage') || '确定清空批量任务历史吗？',
            details: t('comp.tasks.clearDetails') || '该操作不会影响已执行的节点配置，只会清空控制台历史记录。',
            confirmText: t('comp.tasks.clearConfirm') || '确认清空',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete('/jobs/history');
            toast.success(t('comp.tasks.historyCleared'));
            setTasks([]);
            setSelectedTask(null);
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.clearFailed;
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
            toast.success(copy.retryDone
                .replace('{success}', String(summary.success))
                .replace('{total}', String(summary.total)));
            await fetchTasks();
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || copy.retryFailed;
            toast.error(msg);
        }
        setRetryingId('');
    };

    return (
        <>
            {!embedded && <Header title={t('pages.tasks.title')} />}
            <div className={shellClassName}>
                {!embedded && (
                    <PageToolbar
                        className={headClassName}
                        compact
                        actions={(
                            <div className="tasks-page-actions">
                                <button className="btn btn-secondary btn-sm rounded-lg" onClick={fetchTasks} disabled={loading}>
                                    <HiOutlineArrowPath className={loading ? 'spinning' : ''} /> {copy.refresh}
                                </button>
                                <button className="btn btn-danger btn-sm rounded-lg" onClick={handleClear}>
                                    <HiOutlineTrash /> {copy.clear}
                                </button>
                            </div>
                        )}
                        meta={<span>{copy.total.replace('{count}', String(filteredTasks.length))}</span>}
                    />
                )}

                <div className={filterCardClassName}>
                    {embedded ? (
                        <>
                            <div className="audit-control-head audit-control-head--compact">
                                <div className="audit-control-actions">
                                    <button className="btn btn-secondary btn-sm rounded-lg" onClick={fetchTasks} disabled={loading}>
                                        <HiOutlineArrowPath className={loading ? 'spinning' : ''} /> {copy.refresh}
                                    </button>
                                    <button className="btn btn-danger btn-sm rounded-lg" onClick={handleClear}>
                                        <HiOutlineTrash /> {copy.clear}
                                    </button>
                                </div>
                            </div>
                            <div className="audit-control-meta audit-control-meta--compact">
                                <span className="audit-control-pill">
                                    {copy.total.replace('{count}', String(filteredTasks.length))}
                                </span>
                                <span className={`audit-control-pill ${activeTaskFilterCount > 0 ? 'is-active' : ''}`}>
                                    {activeTaskFilterCount > 0
                                        ? copy.filtersActive.replace('{count}', String(activeTaskFilterCount))
                                        : copy.noFilters}
                                </span>
                            </div>
                            <div className="audit-filter-grid audit-filter-grid--tasks">
                                <select className={filterSelectClassName} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                                    <option value="all">{copy.allTypes}</option>
                                    {typeOptions.map((x) => <option key={x} value={x}>{formatTaskTypeLabel(x, locale)}</option>)}
                                </select>
                                <select className={filterSelectClassName} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                                    <option value="all">{copy.allActions}</option>
                                    {actionOptions.map((x) => <option key={x} value={x}>{formatTaskActionLabel(x, locale)}</option>)}
                                </select>
                                <select className={filterSelectClassName} value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
                                    <option value="all">{copy.allServers}</option>
                                    {serverOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                                </select>
                                <label className="toolbar-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={failedOnlyFilter}
                                        onChange={(e) => setFailedOnlyFilter(e.target.checked)}
                                        className={failedOnlyCheckboxClassName}
                                    />
                                    {copy.failedOnly}
                                </label>
                                <select className={filterSelectClassName} value={retryGroupBy} onChange={(e) => setRetryGroupBy(e.target.value)}>
                                    <option value="none">{formatRetryGroupLabel('none', locale)}</option>
                                    <option value="server">{formatRetryGroupLabel('server', locale)}</option>
                                    <option value="error">{formatRetryGroupLabel('error', locale)}</option>
                                    <option value="server_error">{formatRetryGroupLabel('server_error', locale)}</option>
                                </select>
                            </div>
                        </>
                    ) : (
                        <div className="tasks-filter-row audit-filter-bar">
                            {/* Keep native controls on the shared form surface and focus ring rules. */}
                            <select className={`${filterSelectClassName} w-140`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                                <option value="all">{copy.allTypes}</option>
                                {typeOptions.map((x) => <option key={x} value={x}>{formatTaskTypeLabel(x, locale)}</option>)}
                            </select>
                            <select className={`${filterSelectClassName} w-140`} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                                <option value="all">{copy.allActions}</option>
                                {actionOptions.map((x) => <option key={x} value={x}>{formatTaskActionLabel(x, locale)}</option>)}
                            </select>
                            <select className={`${filterSelectClassName} w-180`} value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
                                <option value="all">{copy.allServers}</option>
                                {serverOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                            <label className="toolbar-checkbox">
                                <input
                                    type="checkbox"
                                    checked={failedOnlyFilter}
                                    onChange={(e) => setFailedOnlyFilter(e.target.checked)}
                                    className={failedOnlyCheckboxClassName}
                                />
                                {copy.failedOnly}
                            </label>
                            <select className={`${filterSelectClassName} w-180`} value={retryGroupBy} onChange={(e) => setRetryGroupBy(e.target.value)}>
                                <option value="none">{formatRetryGroupLabel('none', locale)}</option>
                                <option value="server">{formatRetryGroupLabel('server', locale)}</option>
                                <option value="error">{formatRetryGroupLabel('error', locale)}</option>
                                <option value="server_error">{formatRetryGroupLabel('server_error', locale)}</option>
                            </select>
                            <div className="text-sm text-muted tasks-filter-meta">
                                {copy.total.replace('{count}', String(filteredTasks.length))}
                            </div>
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className={`${tableShellClassName} p-4`}>
                        <SkeletonTable rows={5} cols={7} />
                    </div>
                ) : filteredTasks.length === 0 ? (
                    <div className={`${tableShellClassName} p-4`}>
                        <EmptyState title={copy.emptyTitle} subtitle={copy.emptySubtitle} />
                    </div>
                ) : isCompactLayout ? (
                    <div className={mobileListShellClassName}>
                        <TaskMobileList
                            tasks={filteredTasks}
                            copy={copy}
                            locale={locale}
                            retryingId={retryingId}
                            onView={handleView}
                            onRetryFailed={handleRetryFailed}
                        />
                    </div>
                ) : (
                    <div className={tableShellClassName}>
                        <table className="table tasks-table">
                            <thead>
                                <tr>
                                    <th className="tasks-time-column">{copy.time}</th>
                                    <th>{copy.typeAction}</th>
                                    <th>{copy.server}</th>
                                    <th className="table-cell-right tasks-total-column">{copy.totalCol}</th>
                                    <th className="table-cell-right tasks-success-column">{copy.successCol}</th>
                                    <th className="table-cell-right tasks-failed-column">{copy.failedCol}</th>
                                    <th className="table-cell-actions tasks-actions-column">{copy.actions}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTasks.map((task) => (
                                    <tr key={task.id}>
                                        <td data-label={copy.time} className="cell-mono tasks-time-cell">{formatDateTime(task.createdAt, locale)}</td>
                                        <td data-label={copy.typeAction}>{formatTaskActionPair(task.type, task.action, locale)}</td>
                                        <td data-label={copy.server} className="text-sm text-muted tasks-server-cell">
                                            {formatTaskServerSummary(task)}
                                        </td>
                                        <td data-label={copy.totalCol} className="table-cell-right cell-mono-right tasks-total-cell">{task.summary?.total ?? '-'}</td>
                                        <td data-label={copy.successCol} className="table-cell-right cell-mono-right tasks-success-cell">{task.summary?.success ?? '-'}</td>
                                        <td data-label={copy.failedCol} className="table-cell-right cell-mono-right tasks-failed-cell">{task.summary?.failed ?? '-'}</td>
                                        <td data-label={copy.actions} className="table-cell-actions tasks-actions-cell">
                                            <div className="table-row-actions tasks-row-actions">
                                            <button className="btn btn-secondary btn-sm btn-icon table-action-btn" onClick={() => handleView(task.id)} title={copy.viewDetail} aria-label={copy.viewDetail}>
                                                <HiOutlineEye />
                                            </button>
                                            {Number(task.summary?.failed || 0) > 0 && (
                                                <button
                                                    className="btn btn-primary btn-sm btn-icon table-action-btn is-primary"
                                                    onClick={() => handleRetryFailed(task)}
                                                    disabled={retryingId === task.id}
                                                    title={copy.retryFailedItems}
                                                    aria-label={copy.retryFailedItems}
                                                >
                                                    {retryingId === task.id ? <span className="spinner" /> : <HiOutlineArrowUturnLeft />}
                                                </button>
                                            )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className={paginationClassName}>
                    <div className="page-pagination-meta">{copy.retained.replace('{count}', String(filteredTasks.length))}</div>
                </div>
            </div>

            <BatchResultModal
                isOpen={!!selectedTask}
                onClose={() => setSelectedTask(null)}
                title={copy.detailTitle.replace('{label}', selectedTask ? formatTaskActionPair(selectedTask.type, selectedTask.action, locale) : '')}
                data={selectedTask ? { summary: selectedTask.summary, results: selectedTask.results || [] } : null}
            />
        </>
    );
}
