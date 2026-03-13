/**
 * TaskProgressModal — 任务进度弹窗
 *
 * 显示长时间运行任务的进度条，支持取消操作。
 * 任务完成自动显示结果，失败显示错误信息。
 */

import React from 'react';
import {
    HiOutlineXMark,
    HiOutlineCheckCircle,
    HiOutlineXCircle,
    HiOutlineStopCircle,
    HiOutlineCog6Tooth,
} from 'react-icons/hi2';
import useTaskProgress from '../../hooks/useTaskProgress.js';
import { useI18n } from '../../contexts/LanguageContext.jsx';
import { formatTimeOnly } from '../../utils/format.js';
import ModalShell from '../UI/ModalShell.jsx';

const TASK_PROGRESS_COPY = {
    'zh-CN': {
        title: '任务执行中',
        statuses: {
            pending: '等待中',
            running: '运行中',
            completed: '已完成',
            failed: '失败',
            cancelled: '已取消',
        },
        steps: '{step} / {total} 步',
        error: '错误：',
        cancelledSummary: '任务已被取消，已处理 {count} 项',
        completedSummary: '完成 {total} 项，成功 {success} 项',
        failedSuffix: '，失败 {failed} 项',
        taskId: '任务 ID',
        actor: '操作者',
        startedAt: '开始时间',
        completedAt: '完成时间',
        cancel: '取消任务',
        close: '关闭',
        connecting: '正在连接任务状态...',
    },
    'en-US': {
        title: 'Task in Progress',
        statuses: {
            pending: 'Pending',
            running: 'Running',
            completed: 'Completed',
            failed: 'Failed',
            cancelled: 'Cancelled',
        },
        steps: '{step} / {total} steps',
        error: 'Error:',
        cancelledSummary: 'Task was cancelled after processing {count} items',
        completedSummary: 'Completed {total} items, {success} succeeded',
        failedSuffix: ', {failed} failed',
        taskId: 'Task ID',
        actor: 'Actor',
        startedAt: 'Started',
        completedAt: 'Completed',
        cancel: 'Cancel Task',
        close: 'Close',
        connecting: 'Connecting to task status...',
    },
};

function getTaskProgressCopy(locale = 'zh-CN') {
    return TASK_PROGRESS_COPY[locale === 'en-US' ? 'en-US' : 'zh-CN'];
}

function ProgressBar({ percent, color }) {
    return (
        <div className="w-full h-2 bg-tertiary rounded overflow-hidden">
            <div
                className="h-full rounded transition-all duration-300 ease-out"
                style={{
                    width: `${percent}%`,
                    background: color || 'var(--accent-primary)',
                    boxShadow: `0 0 8px ${color || 'var(--accent-primary-glow)'}`,
                }}
            />
        </div>
    );
}

export default function TaskProgressModal({ taskId, title, onClose }) {
    const { task, cancel } = useTaskProgress(taskId, null);
    const { locale } = useI18n();
    const copy = getTaskProgressCopy(locale);

    if (!taskId) return null;

    const status = task?.status || 'pending';
    const statusConf = {
        label: copy.statuses[status] || copy.statuses.pending,
        color: status === 'running'
            ? 'var(--accent-primary)'
            : status === 'completed'
                ? 'var(--accent-success)'
                : status === 'failed'
                    ? 'var(--accent-danger)'
                    : 'var(--text-muted)',
        icon: status === 'completed'
            ? HiOutlineCheckCircle
            : status === 'failed'
                ? HiOutlineXCircle
                : status === 'cancelled'
                    ? HiOutlineStopCircle
                    : HiOutlineCog6Tooth,
    };
    const StatusIcon = statusConf.icon;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(status);
    const isRunning = status === 'running' || status === 'pending';

    const handleCancel = async () => {
        await cancel();
    };

    return (
        <ModalShell isOpen={!!taskId} onClose={isTerminal ? onClose : undefined} closeOnOverlayClick={isTerminal}>
            <div
                className="modal modal-md"
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 className="modal-title">{title || copy.title}</h3>
                    {isTerminal && (
                        <button className="modal-close" onClick={onClose}>
                            <HiOutlineXMark />
                        </button>
                    )}
                </div>

                <div className="modal-body p-6">
                    {/* 状态指示 */}
                    <div className="flex items-center gap-3 mb-5">
                        <StatusIcon
                            className="text-2xl"
                            style={{
                                color: statusConf.color,
                                animation: isRunning ? 'spin 1s linear infinite' : 'none',
                            }}
                        />
                        <div>
                            <div className="font-semibold text-sm" style={{ color: statusConf.color }}>
                                {statusConf.label}
                            </div>
                            {task?.progress?.label && (
                                <div className="text-sm text-muted mt-0.5">
                                    {task.progress.label}
                                </div>
                            )}
                        </div>
                        <div className="ml-auto text-lg font-bold" style={{ color: statusConf.color }}>
                            {task?.progress?.percent ?? 0}%
                        </div>
                    </div>

                    {/* 进度条 */}
                    <div className="mb-5">
                        <ProgressBar
                            percent={task?.progress?.percent ?? 0}
                            color={statusConf.color}
                        />
                        {task?.progress?.step !== undefined && task?.progress?.total !== undefined && (
                            <div className="text-xs text-muted mt-1.5 text-right">
                                {copy.steps
                                    .replace('{step}', String(task.progress.step))
                                    .replace('{total}', String(task.progress.total))}
                            </div>
                        )}
                    </div>

                    {/* 失败详情 */}
                    {task?.status === 'failed' && task?.error && (
                        <div className="bg-danger/5 border border-danger/15 rounded-md p-3 text-sm text-danger mb-4">
                            <strong>{copy.error}</strong>{task.error}
                        </div>
                    )}

                    {/* 成功结果摘要 */}
                    {task?.status === 'completed' && task?.result && (
                        <div className="bg-success/5 border border-success/15 rounded-md p-3 text-sm text-success mb-4">
                            {task.result.cancelled ? (
                                <span>{copy.cancelledSummary.replace('{count}', String(task.result.success || 0))}</span>
                            ) : (
                                <span>
                                    {copy.completedSummary
                                        .replace('{total}', String(task.result.total || 0))
                                        .replace('{success}', String(task.result.success || 0))}
                                    {task.result.failed > 0 && copy.failedSuffix.replace('{failed}', String(task.result.failed))}
                                </span>
                            )}
                        </div>
                    )}

                    {/* 任务元信息 */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                        <div>{copy.taskId}: <span className="font-mono">{taskId?.slice(0, 8)}...</span></div>
                        <div>{copy.actor}: {task?.actor || '-'}</div>
                        {task?.startedAt && (
                            <div>{copy.startedAt}: {formatTimeOnly(task.startedAt, locale)}</div>
                        )}
                        {task?.completedAt && (
                            <div>{copy.completedAt}: {formatTimeOnly(task.completedAt, locale)}</div>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    {isRunning && (
                        <button className="btn btn-danger btn-sm" onClick={handleCancel}>
                            <HiOutlineStopCircle /> {copy.cancel}
                        </button>
                    )}
                    {isTerminal && (
                        <button className="btn btn-secondary btn-sm" onClick={onClose}>
                            {copy.close}
                        </button>
                    )}
                    {!task && (
                        <div className="text-muted text-sm">
                            {copy.connecting}
                        </div>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}
