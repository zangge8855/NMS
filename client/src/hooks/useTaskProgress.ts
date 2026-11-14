/**
 * useTaskProgress — 通过 WebSocket 订阅任务进度，并在异常时安全停止轮询
 *
 * @param taskId
 * @param sendWsMessage
 * @returns {{ task, error, retrying, cancel, retry, dismiss }}
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { getErrorMessage } from '../utils/format';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const FATAL_HTTP_STATUSES = new Set([400, 401, 403, 404, 410]);
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

function getTaskLoadFallbackMessage(): string {
    const isEn = typeof document !== 'undefined'
        && String(document.documentElement.lang || '').toLowerCase().startsWith('en');
    return isEn ? 'Failed to load task progress' : '获取任务进度失败';
}

export interface UseTaskProgressReturn {
    task: any;
    error: string | null;
    retrying: boolean;
    cancel: () => Promise<void>;
    retry: () => void;
    dismiss: () => void;
}

export default function useTaskProgress(
    taskId?: string | number | null,
    sendWsMessage?: ((msg: any) => void) | null,
    lastWsMessage?: any
): UseTaskProgressReturn {
    const [task, setTask] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState<boolean>(false);
    const [retryAttempt, setRetryAttempt] = useState<number>(0);

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const consecutiveErrorsRef = useRef<number>(0);
    const inFlightRef = useRef<boolean>(false);

    const stopPolling = useCallback(() => {
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    // 处理来自 WebSocket 的实时任务进度推送
    useEffect(() => {
        if (!taskId || !lastWsMessage) return;
        const isTaskMsg = lastWsMessage.type === 'task_progress' || lastWsMessage.type === 'NMS_TASK_PROGRESS';
        if (!isTaskMsg) return;
        const incoming = lastWsMessage.task || lastWsMessage.data || null;
        if (incoming && String(incoming.id) === String(taskId)) {
            consecutiveErrorsRef.current = 0;
            setError(null);
            setRetrying(false);
            setTask(incoming);
            if (TERMINAL_STATUSES.has(String(incoming.status || ''))) {
                stopPolling();
            }
        }
    }, [taskId, lastWsMessage, stopPolling]);

    // 通过 REST 轮询（作为 WebSocket 的兜底）
    useEffect(() => {
        stopPolling();
        consecutiveErrorsRef.current = 0;
        inFlightRef.current = false;

        if (!taskId) {
            setTask(null);
            setError(null);
            setRetrying(false);
            return undefined;
        }

        let cancelled = false;

        const pollTask = async () => {
            if (cancelled || inFlightRef.current) return;
            inFlightRef.current = true;
            try {
                const res = await api.get(`/system/tasks/${taskId}`);
                if (cancelled) return;
                consecutiveErrorsRef.current = 0;
                const nextTask = res.data?.obj || null;
                setError(null);
                setRetrying(false);
                setTask(nextTask);
                if (nextTask && TERMINAL_STATUSES.has(String(nextTask.status || ''))) {
                    stopPolling();
                }
            } catch (err: any) {
                if (cancelled) return;
                const httpStatus = Number(err?.response?.status || 0);
                consecutiveErrorsRef.current += 1;
                const isFatal = FATAL_HTTP_STATUSES.has(httpStatus);
                if (isFatal || consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
                    stopPolling();
                    setRetrying(false);
                    setError(getErrorMessage(err, getTaskLoadFallbackMessage()));
                }
            } finally {
                inFlightRef.current = false;
            }
        };

        void pollTask();

        intervalRef.current = setInterval(() => {
            void pollTask();
        }, 2000);

        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [taskId, retryAttempt, stopPolling]);

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

    const retry = useCallback(() => {
        if (!taskId) return;
        setError(null);
        setRetrying(true);
        setRetryAttempt((prev) => prev + 1);
    }, [taskId]);

    const dismiss = useCallback(() => {
        stopPolling();
        consecutiveErrorsRef.current = 0;
        setTask(null);
        setError(null);
        setRetrying(false);
    }, [stopPolling]);

    return { task, error, retrying, cancel, retry, dismiss };
}
