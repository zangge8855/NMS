import { useCallback, useMemo, useState } from 'react';

function defaultGetId(item) {
    if (item && typeof item === 'object' && item.id !== undefined) {
        return String(item.id);
    }
    return String(item ?? '');
}

function defaultGetLabel(item) {
    if (item && typeof item === 'object') {
        return String(item.name || item.label || item.id || '').trim();
    }
    return String(item ?? '').trim();
}

function normalizeMessage(value, fallback = '') {
    return String(value || fallback || '').trim();
}

export default function useBulkAction(options = {}) {
    const getId = options.getId || defaultGetId;
    const getLabel = options.getLabel || defaultGetLabel;
    const [pendingMap, setPendingMap] = useState({});
    const [lastReport, setLastReport] = useState(null);

    const markPending = useCallback((ids = []) => {
        setPendingMap((previous) => {
            const next = { ...previous };
            ids.forEach((id) => {
                if (!id) return;
                next[id] = (next[id] || 0) + 1;
            });
            return next;
        });
    }, []);

    const clearPending = useCallback((ids = []) => {
        setPendingMap((previous) => {
            const next = { ...previous };
            ids.forEach((id) => {
                if (!id || !next[id]) return;
                next[id] -= 1;
                if (next[id] <= 0) {
                    delete next[id];
                }
            });
            return next;
        });
    }, []);

    const run = useCallback(async (items, execute, runOptions = {}) => {
        const list = Array.isArray(items) ? items : [];
        const descriptors = list.map((item, index) => ({
            item,
            index,
            id: normalizeMessage((runOptions.getId || getId)(item), ''),
            label: normalizeMessage((runOptions.getLabel || getLabel)(item), ''),
        })).filter((item) => item.id);
        const ids = descriptors.map((item) => item.id);

        if (descriptors.length === 0) {
            const emptyReport = {
                total: 0,
                successCount: 0,
                failureCount: 0,
                results: [],
                successItems: [],
                failureItems: [],
                timestamp: new Date().toISOString(),
            };
            setLastReport(emptyReport);
            return emptyReport;
        }

        markPending(ids);
        try {
            const settled = await Promise.allSettled(
                descriptors.map(async (descriptor) => {
                    try {
                        const value = await execute(descriptor.item, descriptor);
                        const mapped = typeof runOptions.mapSuccess === 'function'
                            ? runOptions.mapSuccess(value, descriptor.item, descriptor)
                            : {
                                message: value?.msg || value?.message || '',
                                meta: value?.meta ?? null,
                            };
                        const result = {
                            ...descriptor,
                            success: true,
                            value,
                            message: normalizeMessage(mapped?.message, ''),
                            meta: mapped?.meta ?? null,
                            error: null,
                        };
                        runOptions.onItemSettled?.(result);
                        return result;
                    } catch (error) {
                        const mapped = typeof runOptions.mapError === 'function'
                            ? runOptions.mapError(error, descriptor.item, descriptor)
                            : {
                                message: error?.response?.data?.msg || error?.message || '',
                                meta: error?.meta ?? null,
                            };
                        const result = {
                            ...descriptor,
                            success: false,
                            value: null,
                            message: normalizeMessage(mapped?.message, ''),
                            meta: mapped?.meta ?? null,
                            error,
                        };
                        runOptions.onItemSettled?.(result);
                        throw result;
                    }
                })
            );

            const results = settled.map((entry) => (entry.status === 'fulfilled' ? entry.value : entry.reason));
            const successItems = results.filter((item) => item?.success === true);
            const failureItems = results.filter((item) => item?.success === false);
            const report = {
                total: results.length,
                successCount: successItems.length,
                failureCount: failureItems.length,
                results,
                successItems,
                failureItems,
                timestamp: new Date().toISOString(),
            };
            setLastReport(report);
            runOptions.onComplete?.(report);
            return report;
        } finally {
            clearPending(ids);
        }
    }, [clearPending, getId, getLabel, markPending]);

    const retryFailures = useCallback((execute, runOptions = {}) => {
        const failed = Array.isArray(lastReport?.failureItems) ? lastReport.failureItems : [];
        return run(
            failed.map((item) => item.item),
            execute,
            runOptions
        );
    }, [lastReport?.failureItems, run]);

    const pendingIds = useMemo(
        () => Object.keys(pendingMap).filter((key) => pendingMap[key] > 0),
        [pendingMap]
    );

    const isPending = useCallback((id) => {
        const normalized = String(id || '').trim();
        return Boolean(normalized && pendingMap[normalized] > 0);
    }, [pendingMap]);

    return {
        pendingIds,
        isPending,
        lastReport,
        run,
        retryFailures,
    };
}
