/**
 * useTaskProgress — 通过 WebSocket 订阅任务进度
 *
 * @param {string|null} taskId
 * @param {object} wsRef  WebSocket 实例引用（需要有 send 方法）
 * @returns {{ task, cancel }}
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';

export default function useTaskProgress(taskId, sendWsMessage) {
    const [task, setTask] = useState(null);

    // 通过 REST 轮询（作为 WebSocket 的兜底）
    useEffect(() => {
        if (!taskId) return;

        // 立即获取初始状态
        api.get(`/system/tasks/${taskId}`)
            .then(res => setTask(res.data?.obj || null))
            .catch(() => {});

        // 每2秒轮询一次直到任务结束
        const terminal = ['completed', 'failed', 'cancelled'];
        const interval = setInterval(() => {
            api.get(`/system/tasks/${taskId}`)
                .then(res => {
                    const t = res.data?.obj || null;
                    setTask(t);
                    if (t && terminal.includes(t.status)) {
                        clearInterval(interval);
                    }
                })
                .catch(() => {});
        }, 2000);

        return () => clearInterval(interval);
    }, [taskId]);

    // WebSocket 订阅
    useEffect(() => {
        if (!taskId || !sendWsMessage) return;
        sendWsMessage({ type: 'subscribe_task', taskId });
        return () => sendWsMessage({ type: 'unsubscribe_task', taskId });
    }, [taskId, sendWsMessage]);

    const cancel = useCallback(async () => {
        if (!taskId) return;
        try {
            await api.delete(`/system/tasks/${taskId}`);
        } catch {
            // 静默失败
        }
    }, [taskId]);

    return { task, cancel };
}
