/**
 * Alert Engine — 数据库写入失败告警引擎
 *
 * 监控数据库写入操作，当失败次数超过阈值时触发告警通知。
 * - 使用滑动时间窗口计数（5分钟窗口）
 * - 支持连续失败次数检测
 * - 集成 notificationService 分发告警
 */

import notificationService, { SEVERITY } from './notifications.js';

const DEFAULT_CONFIG = {
    windowMs: 5 * 60 * 1000,       // 5分钟滑动窗口
    failureThreshold: 3,             // 窗口内失败超过3次触发告警
    consecutiveThreshold: 2,         // 连续失败2次触发告警
};

class AlertEngine {
    constructor() {
        this.config = { ...DEFAULT_CONFIG };
        this.events = []; // { timestamp, type, detail }
        this.consecutiveFailures = 0;
        this.lastSuccessAt = null;
    }

    /**
     * 更新告警配置
     */
    configure(opts = {}) {
        if (opts.windowMs > 0) this.config.windowMs = opts.windowMs;
        if (opts.failureThreshold > 0) this.config.failureThreshold = opts.failureThreshold;
        if (opts.consecutiveThreshold > 0) this.config.consecutiveThreshold = opts.consecutiveThreshold;
    }

    /**
     * 记录一次数据库写入成功
     */
    recordSuccess() {
        this.consecutiveFailures = 0;
        this.lastSuccessAt = Date.now();
        this._cleanup();
    }

    /**
     * 记录一次数据库写入失败
     * @param {string} storeKey  哪个 store 发生写入失败
     * @param {string} errorMsg  错误信息
     */
    recordFailure(storeKey, errorMsg) {
        const now = Date.now();
        this.events.push({ timestamp: now, type: 'write_failure', storeKey, errorMsg });
        this.consecutiveFailures += 1;
        this._cleanup();
        this._evaluate();
    }

    /**
     * 移除窗口外的过期事件
     */
    _cleanup() {
        const cutoff = Date.now() - this.config.windowMs;
        this.events = this.events.filter(e => e.timestamp >= cutoff);
    }

    /**
     * 评估是否需要触发告警
     */
    _evaluate() {
        const failures = this.events.filter(e => e.type === 'write_failure');
        const windowCount = failures.length;
        const consecutive = this.consecutiveFailures;

        if (windowCount >= this.config.failureThreshold) {
            const detail = failures.slice(-3).map(e => `[${e.storeKey}] ${e.errorMsg}`).join('; ');
            notificationService.notify({
                type: 'db_write_failure',
                severity: windowCount >= this.config.failureThreshold * 2 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
                title: `数据库写入告警：${windowCount} 次失败`,
                body: `过去 ${Math.round(this.config.windowMs / 60000)} 分钟内发生 ${windowCount} 次写入失败。最近错误：${detail}`,
                meta: { windowCount, consecutive, recentErrors: failures.slice(-5).map(e => e.errorMsg) },
                dedupKey: `db_write_failure:window`,
            });
        } else if (consecutive >= this.config.consecutiveThreshold) {
            const last = failures[failures.length - 1];
            notificationService.notify({
                type: 'db_write_consecutive_failure',
                severity: SEVERITY.WARNING,
                title: `数据库连续写入失败：${consecutive} 次`,
                body: `最近连续 ${consecutive} 次写入均失败。最新错误：[${last?.storeKey}] ${last?.errorMsg}`,
                meta: { consecutive, lastStore: last?.storeKey, lastError: last?.errorMsg },
                dedupKey: `db_write_failure:consecutive`,
            });
        }
    }

    /**
     * 获取当前窗口内的失败统计
     */
    getStats() {
        this._cleanup();
        const failures = this.events.filter(e => e.type === 'write_failure');
        return {
            windowMs: this.config.windowMs,
            failuresInWindow: failures.length,
            consecutiveFailures: this.consecutiveFailures,
            lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
        };
    }
}

const alertEngine = new AlertEngine();
export default alertEngine;
