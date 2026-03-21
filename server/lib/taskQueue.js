/**
 * Task Queue — 异步任务追踪系统
 *
 * 为长时间运行的操作（如数据库回填）提供：
 * - UUID 任务标识
 * - 实时进度追踪（步骤/总数/百分比）
 * - 可取消操作（AbortController）
 * - 任务状态管理（pending → running → completed/failed/cancelled）
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export const TASK_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
};

function startBackgroundInterval(fn, delayMs) {
    const timer = setInterval(fn, delayMs);
    if (typeof timer?.unref === 'function') {
        timer.unref();
    }
    return timer;
}

const MAX_TASKS = 1000;

class TaskQueue extends EventEmitter {
    constructor() {
        super();
        this.tasks = new Map(); // taskId → task object
    }

    /**
     * 创建一个新任务
     * @param {object} opts
     * @param {string} opts.type  任务类型标识（如 'db_backfill'）
     * @param {string} opts.actor 操作者用户名
     * @param {object} [opts.meta] 额外元数据
     * @returns {{ taskId: string, abort: () => void }}
     */
    create({ type, actor, meta = {} }) {
        if (this.tasks.size >= MAX_TASKS) {
            this.prune();
            if (this.tasks.size >= MAX_TASKS) {
                throw new Error('Task queue is full');
            }
        }
        const taskId = crypto.randomUUID();
        const controller = new AbortController();
        const now = new Date().toISOString();

        const task = {
            id: taskId,
            type: String(type || 'unknown'),
            actor: String(actor || 'system'),
            status: TASK_STATUS.PENDING,
            progress: { step: 0, total: 0, percent: 0, label: '' },
            meta,
            createdAt: now,
            startedAt: null,
            completedAt: null,
            error: null,
            _controller: controller,
        };

        this.tasks.set(taskId, task);

        const abort = () => {
            const t = this.tasks.get(taskId);
            if (!t) return;
            if (t.status === TASK_STATUS.RUNNING || t.status === TASK_STATUS.PENDING) {
                controller.abort();
                this._updateStatus(taskId, TASK_STATUS.CANCELLED);
            }
        };

        return { taskId, abort, signal: controller.signal };
    }

    /**
     * 标记任务开始运行
     */
    start(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = TASK_STATUS.RUNNING;
        task.startedAt = new Date().toISOString();
        this._emit(taskId);
    }

    /**
     * 更新任务进度
     * @param {string} taskId
     * @param {{ step?: number, total?: number, label?: string }} progress
     */
    updateProgress(taskId, { step, total, label } = {}) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        if (task.status !== TASK_STATUS.RUNNING) return;

        if (step !== undefined) task.progress.step = step;
        if (total !== undefined) task.progress.total = total;
        if (label !== undefined) task.progress.label = String(label);

        const { total: t, step: s } = task.progress;
        task.progress.percent = t > 0 ? Math.min(100, Math.round((s / t) * 100)) : 0;
        this._emit(taskId);
    }

    /**
     * 标记任务完成
     */
    complete(taskId, result = null) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = TASK_STATUS.COMPLETED;
        task.completedAt = new Date().toISOString();
        task.progress.percent = 100;
        if (result !== undefined && result !== null) task.result = result;
        this._emit(taskId);
    }

    /**
     * 标记任务失败
     */
    fail(taskId, error) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = TASK_STATUS.FAILED;
        task.completedAt = new Date().toISOString();
        task.error = error instanceof Error ? error.message : String(error || 'unknown error');
        this._emit(taskId);
    }

    /**
     * 获取任务公开状态（不含私有字段）
     */
    get(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        return this._publicTask(task);
    }

    /**
     * 列出所有任务（可按状态过滤）
     */
    list({ status, type, limit = 50 } = {}) {
        let tasks = Array.from(this.tasks.values());
        if (status) tasks = tasks.filter(t => t.status === status);
        if (type) tasks = tasks.filter(t => t.type === type);
        // 最新任务在前
        tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return tasks.slice(0, limit).map(t => this._publicTask(t));
    }

    /**
     * 检查任务是否已取消
     */
    isCancelled(taskId) {
        const task = this.tasks.get(taskId);
        return task?.status === TASK_STATUS.CANCELLED || task?._controller?.signal?.aborted || false;
    }

    /**
     * 清理超过1小时的已完成任务
     */
    prune() {
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const [id, task] of this.tasks.entries()) {
            const terminal = [TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED];
            if (terminal.includes(task.status)) {
                const createdAt = new Date(task.createdAt).getTime();
                if (createdAt < cutoff) {
                    this.tasks.delete(id);
                }
            }
        }
    }

    /**
     * 取消任务（外部调用）
     */
    cancel(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (task.status !== TASK_STATUS.RUNNING && task.status !== TASK_STATUS.PENDING) return false;
        if (task._controller) {
            task._controller.abort();
        }
        this._updateStatus(taskId, TASK_STATUS.CANCELLED);
        return true;
    }

    _updateStatus(taskId, status) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = status;
        task.completedAt = new Date().toISOString();
        this._emit(taskId);
    }

    _emit(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        this.emit('progress', this._publicTask(task));
        this.emit(`progress:${taskId}`, this._publicTask(task));
    }

    _publicTask(task) {
        return {
            id: task.id,
            type: task.type,
            actor: task.actor,
            status: task.status,
            progress: { ...task.progress },
            meta: task.meta,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
            result: task.result ?? null,
        };
    }
}

const taskQueue = new TaskQueue();

// 每10分钟清理一次过期任务
startBackgroundInterval(() => taskQueue.prune(), 10 * 60 * 1000);

export default taskQueue;
