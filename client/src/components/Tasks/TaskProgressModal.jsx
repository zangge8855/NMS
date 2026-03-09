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

const STATUS_CONFIG = {
    pending: { label: '等待中', color: 'var(--text-muted)', icon: HiOutlineCog6Tooth },
    running: { label: '运行中', color: 'var(--accent-primary)', icon: HiOutlineCog6Tooth },
    completed: { label: '已完成', color: 'var(--accent-success)', icon: HiOutlineCheckCircle },
    failed: { label: '失败', color: 'var(--accent-danger)', icon: HiOutlineXCircle },
    cancelled: { label: '已取消', color: 'var(--text-muted)', icon: HiOutlineStopCircle },
};

function ProgressBar({ percent, color }) {
    return (
        <div style={{
            height: '8px',
            background: 'var(--bg-tertiary)',
            borderRadius: '4px',
            overflow: 'hidden',
            width: '100%',
        }}>
            <div style={{
                height: '100%',
                width: `${percent}%`,
                background: color || 'var(--accent-primary)',
                borderRadius: '4px',
                transition: 'width 0.4s ease',
                boxShadow: `0 0 8px ${color || 'var(--accent-primary-glow)'}`,
            }} />
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
        <div className="modal-overlay" onClick={isTerminal ? onClose : undefined}>
            <div
                className="modal"
                onClick={e => e.stopPropagation()}
                style={{ minWidth: '480px', maxWidth: '560px' }}
            >
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    {isTerminal && (
                        <button className="modal-close" onClick={onClose}>
                            <HiOutlineXMark />
                        </button>
                    )}
                </div>

                <div className="modal-body" style={{ padding: '24px' }}>
                    {/* 状态指示 */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '20px',
                    }}>
                        <StatusIcon
                            style={{
                                fontSize: '24px',
                                color: statusConf.color,
                                animation: isRunning ? 'spin 1s linear infinite' : 'none',
                            }}
                        />
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '15px', color: statusConf.color }}>
                                {statusConf.label}
                            </div>
                            {task?.progress?.label && (
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                    {task.progress.label}
                                </div>
                            )}
                        </div>
                        <div style={{ marginLeft: 'auto', fontSize: '18px', fontWeight: 700, color: statusConf.color }}>
                            {task?.progress?.percent ?? 0}%
                        </div>
                    </div>

                    {/* 进度条 */}
                    <div style={{ marginBottom: '20px' }}>
                        <ProgressBar
                            percent={task?.progress?.percent ?? 0}
                            color={statusConf.color}
                        />
                        {task?.progress?.step !== undefined && task?.progress?.total !== undefined && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'right' }}>
                                {task.progress.step} / {task.progress.total} 步
                            </div>
                        )}
                    </div>

                    {/* 失败详情 */}
                    {task?.status === 'failed' && task?.error && (
                        <div style={{
                            background: 'var(--accent-danger-bg)',
                            border: '1px solid var(--accent-danger)',
                            borderRadius: 'var(--radius-md)',
                            padding: '12px 14px',
                            fontSize: '13px',
                            color: 'var(--accent-danger)',
                            marginBottom: '16px',
                        }}>
                            <strong>错误：</strong>{task.error}
                        </div>
                    )}

                    {/* 成功结果摘要 */}
                    {task?.status === 'completed' && task?.result && (
                        <div style={{
                            background: 'var(--accent-success-bg)',
                            border: '1px solid var(--accent-success)',
                            borderRadius: 'var(--radius-md)',
                            padding: '12px 14px',
                            fontSize: '13px',
                            color: 'var(--accent-success)',
                            marginBottom: '16px',
                        }}>
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
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                    }}>
                        <div>任务 ID: <span style={{ fontFamily: 'monospace' }}>{taskId?.slice(0, 8)}...</span></div>
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
                        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                            正在连接任务状态...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
