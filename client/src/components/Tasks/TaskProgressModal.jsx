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
import ModalShell from '../UI/ModalShell.jsx';

const STATUS_CONFIG = {
    pending: { label: '等待中', color: 'var(--text-muted)', icon: HiOutlineCog6Tooth },
    running: { label: '运行中', color: 'var(--accent-primary)', icon: HiOutlineCog6Tooth },
    completed: { label: '已完成', color: 'var(--accent-success)', icon: HiOutlineCheckCircle },
    failed: { label: '失败', color: 'var(--accent-danger)', icon: HiOutlineXCircle },
    cancelled: { label: '已取消', color: 'var(--text-muted)', icon: HiOutlineStopCircle },
};

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

export default function TaskProgressModal({ taskId, title = '任务执行中', onClose }) {
    const { task, cancel } = useTaskProgress(taskId, null);

    if (!taskId) return null;

    const statusConf = STATUS_CONFIG[task?.status] || STATUS_CONFIG.pending;
    const StatusIcon = statusConf.icon;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(task?.status);
    const isRunning = task?.status === 'running' || task?.status === 'pending';

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
                    <h3 className="modal-title">{title}</h3>
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
                                {task.progress.step} / {task.progress.total} 步
                            </div>
                        )}
                    </div>

                    {/* 失败详情 */}
                    {task?.status === 'failed' && task?.error && (
                        <div className="bg-danger/5 border border-danger/15 rounded-md p-3 text-sm text-danger mb-4">
                            <strong>错误：</strong>{task.error}
                        </div>
                    )}

                    {/* 成功结果摘要 */}
                    {task?.status === 'completed' && task?.result && (
                        <div className="bg-success/5 border border-success/15 rounded-md p-3 text-sm text-success mb-4">
                            {task.result.cancelled ? (
                                <span>任务已被取消，已处理 {task.result.success || 0} 项</span>
                            ) : (
                                <span>
                                    完成 {task.result.total || 0} 项，成功 {task.result.success || 0} 项
                                    {task.result.failed > 0 && `，失败 ${task.result.failed} 项`}
                                </span>
                            )}
                        </div>
                    )}

                    {/* 任务元信息 */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                        <div>任务 ID: <span className="font-mono">{taskId?.slice(0, 8)}...</span></div>
                        <div>操作者: {task?.actor || '-'}</div>
                        {task?.startedAt && (
                            <div>开始时间: {new Date(task.startedAt).toLocaleTimeString('zh-CN')}</div>
                        )}
                        {task?.completedAt && (
                            <div>完成时间: {new Date(task.completedAt).toLocaleTimeString('zh-CN')}</div>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    {isRunning && (
                        <button className="btn btn-danger btn-sm" onClick={handleCancel}>
                            <HiOutlineStopCircle /> 取消任务
                        </button>
                    )}
                    {isTerminal && (
                        <button className="btn btn-secondary btn-sm" onClick={onClose}>
                            关闭
                        </button>
                    )}
                    {!task && (
                        <div className="text-muted text-sm">
                            正在连接任务状态...
                        </div>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}
