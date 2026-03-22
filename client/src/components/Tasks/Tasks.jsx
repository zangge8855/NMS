import React, { useEffect, useMemo, useState } from 'react';
import { Table, Select, Checkbox, Button, Card, Typography, Space, Row, Col, Tooltip } from 'antd';
import { ReloadOutlined, DeleteOutlined, EyeOutlined, RollbackOutlined } from '@ant-design/icons';
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
import { formatDateTime } from '../../utils/format.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';

const { Text } = Typography;

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
            tone: 'error',
            label: `${copy.failedCol} ${failed}`,
        };
    }
    return {
        tone: 'success',
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
        <div>
            {tasks.map((task) => {
                const badge = getTaskResultBadge(task, copy);
                const failedCount = Number(task?.summary?.failed || 0);
                return (
                    <Card key={task.id} className="tasks-mobile-card" size="small" style={{ marginBottom: 16 }}>
                        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                            <Row justify="space-between" align="top" gutter={12}>
                                <Col flex="auto">
                                    <div style={{ fontWeight: 600 }}>{formatTaskActionPair(task.type, task.action, locale)}</div>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {formatDateTime(task.createdAt, locale)}
                                    </Text>
                                </Col>
                                <Col flex="none">
                                    <Text type={badge.tone}>{badge.label}</Text>
                                </Col>
                            </Row>
                            <Row gutter={[12, 12]}>
                                <Col span={24}>
                                    <Text type="secondary">{copy.server}</Text>
                                    <div>{formatTaskServerSummary(task)}</div>
                                </Col>
                                <Col span={8}>
                                    <Text type="secondary">{copy.totalCol}</Text>
                                    <div>{task.summary?.total ?? '-'}</div>
                                </Col>
                                <Col span={8}>
                                    <Text type="secondary">{copy.successCol}</Text>
                                    <div>{task.summary?.success ?? '-'}</div>
                                </Col>
                                <Col span={8}>
                                    <Text type="secondary">{copy.failedCol}</Text>
                                    <div>{task.summary?.failed ?? '-'}</div>
                                </Col>
                            </Row>
                            <Space wrap>
                                <Button size="small" onClick={() => onView(task.id)}>
                                    {copy.viewDetail}
                                </Button>
                                {failedCount > 0 && (
                                    <Button
                                        size="small"
                                        type="primary"
                                        onClick={() => onRetryFailed(task)}
                                        loading={retryingId === task.id}
                                    >
                                        {copy.retryFailedItems}
                                    </Button>
                                )}
                            </Space>
                        </Space>
                    </Card>
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
    const [loading, setLoading] = useState(true);
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

    const columns = [
        {
            title: copy.time,
            dataIndex: 'createdAt',
            key: 'createdAt',
            className: 'cell-mono',
            render: (val) => formatDateTime(val, locale),
        },
        {
            title: copy.typeAction,
            key: 'typeAction',
            render: (_, record) => formatTaskActionPair(record.type, record.action, locale),
        },
        {
            title: copy.server,
            key: 'server',
            render: (_, record) => (
                <Text type="secondary" size="small">
                    {formatTaskServerSummary(record)}
                </Text>
            ),
        },
        {
            title: copy.totalCol,
            dataIndex: ['summary', 'total'],
            key: 'total',
            align: 'right',
            className: 'cell-mono-right',
            render: (val) => val ?? '-',
        },
        {
            title: copy.successCol,
            dataIndex: ['summary', 'success'],
            key: 'success',
            align: 'right',
            className: 'cell-mono-right',
            render: (val) => val ?? '-',
        },
        {
            title: copy.failedCol,
            dataIndex: ['summary', 'failed'],
            key: 'failed',
            align: 'right',
            className: 'cell-mono-right',
            render: (val) => {
                if (val > 0) return <Text type="danger">{val}</Text>;
                return val ?? '-';
            },
        },
        {
            title: copy.actions,
            key: 'actions',
            align: 'right',
            render: (_, record) => (
                <Space>
                    <Tooltip title={copy.viewDetail}>
                        <Button
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => handleView(record.id)}
                        />
                    </Tooltip>
                    {Number(record.summary?.failed || 0) > 0 && (
                        <Tooltip title={copy.retryFailedItems}>
                            <Button
                                size="small"
                                type="primary"
                                icon={<RollbackOutlined />}
                                onClick={() => handleRetryFailed(record)}
                                loading={retryingId === record.id}
                            />
                        </Tooltip>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <>
            {!embedded && <Header title={t('pages.tasks.title')} />}
            <div className={embedded ? '' : 'page-content page-enter'}>
                <Card size="small" style={{ marginBottom: '16px' }}>
                    <Row gutter={[16, 16]} align="middle">
                        <Col xs={24} md={18}>
                            <Space wrap>
                                <Select
                                    style={{ width: 140 }}
                                    value={typeFilter}
                                    onChange={setTypeFilter}
                                    options={[
                                        { value: 'all', label: copy.allTypes },
                                        ...typeOptions.map((x) => ({ value: x, label: formatTaskTypeLabel(x, locale) }))
                                    ]}
                                />
                                <Select
                                    style={{ width: 140 }}
                                    value={actionFilter}
                                    onChange={setActionFilter}
                                    options={[
                                        { value: 'all', label: copy.allActions },
                                        ...actionOptions.map((x) => ({ value: x, label: formatTaskActionLabel(x, locale) }))
                                    ]}
                                />
                                <Select
                                    style={{ width: 180 }}
                                    value={serverFilter}
                                    onChange={setServerFilter}
                                    options={[
                                        { value: 'all', label: copy.allServers },
                                        ...serverOptions.map((x) => ({ value: x, label: x }))
                                    ]}
                                />
                                <Checkbox
                                    checked={failedOnlyFilter}
                                    onChange={(e) => setFailedOnlyFilter(e.target.checked)}
                                >
                                    {copy.failedOnly}
                                </Checkbox>
                                <Select
                                    style={{ width: 180 }}
                                    value={retryGroupBy}
                                    onChange={setRetryGroupBy}
                                    options={[
                                        { value: 'none', label: formatRetryGroupLabel('none', locale) },
                                        { value: 'server', label: formatRetryGroupLabel('server', locale) },
                                        { value: 'error', label: formatRetryGroupLabel('error', locale) },
                                        { value: 'server_error', label: formatRetryGroupLabel('server_error', locale) }
                                    ]}
                                />
                            </Space>
                        </Col>
                        <Col xs={24} md={6} style={{ textAlign: 'right' }}>
                            <Space>
                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={fetchTasks}
                                    loading={loading}
                                >
                                    {copy.refresh}
                                </Button>
                                <Button
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={handleClear}
                                >
                                    {copy.clear}
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </Card>

                {loading ? (
                    <SkeletonTable rows={5} cols={7} />
                ) : filteredTasks.length === 0 ? (
                    <EmptyState title={copy.emptyTitle} subtitle={copy.emptySubtitle} />
                ) : isCompactLayout ? (
                    <TaskMobileList
                        tasks={filteredTasks}
                        copy={copy}
                        locale={locale}
                        retryingId={retryingId}
                        onView={handleView}
                        onRetryFailed={handleRetryFailed}
                    />
                ) : (
                    <Table
                        size="small"
                        dataSource={filteredTasks}
                        columns={columns}
                        rowKey="id"
                        pagination={{
                            size: 'small',
                            showSizeChanger: true,
                            showTotal: (total) => copy.retained.replace('{count}', String(total)),
                        }}
                        scroll={{ x: 'max-content' }}
                    />
                )}
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
