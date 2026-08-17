import { useCallback, useMemo, useState } from 'react';

function defaultGetId(item: any): string {
    if (item && typeof item === 'object' && item.id !== undefined) {
        return String(item.id);
    }
    return String(item ?? '');
}

function defaultGetLabel(item: any): string {
    if (item && typeof item === 'object') {
        return String(item.name || item.label || item.id || '').trim();
    }
    return String(item ?? '').trim();
}

function normalizeMessage(value: any, fallback: string = ''): string {
    return String(value || fallback || '').trim();
}

export interface BulkActionItemDescriptor<T = any> {
    item: T;
    index: number;
    id: string;
    label: string;
}

export interface BulkActionResult<T = any> extends BulkActionItemDescriptor<T> {
    success: boolean;
    value: any;
    message: string;
    meta: any;
    error: any;
}

export interface BulkActionReport<T = any> {
    total: number;
    successCount: number;
    failureCount: number;
    results: BulkActionResult<T>[];
    successItems: BulkActionResult<T>[];
    failureItems: BulkActionResult<T>[];
    timestamp: string;
}

export interface UseBulkActionOptions<T = any> {
    getId?: (item: T) => string;
    getLabel?: (item: T) => string;
}

export interface RunBulkActionOptions<T = any> {
    getId?: (item: T) => string;
    getLabel?: (item: T) => string;
    mapSuccess?: (value: any, item: T, descriptor: BulkActionItemDescriptor<T>) => { message?: string; meta?: any };
    mapError?: (error: any, item: T, descriptor: BulkActionItemDescriptor<T>) => { message?: string; meta?: any };
    onItemSettled?: (result: BulkActionResult<T>) => void;
    onComplete?: (report: BulkActionReport<T>) => void;
}

export default function useBulkAction<T = any>(options: UseBulkActionOptions<T> = {}) {
    const getId = options.getId || defaultGetId;
    const getLabel = options.getLabel || defaultGetLabel;
    const [pendingMap, setPendingMap] = useState<Record<string, number>>({});
    const [lastReport, setLastReport] = useState<BulkActionReport<T> | null>(null);

    const markPending = useCallback((ids: string[] = []) => {
        setPendingMap((previous) => {
            const next = { ...previous };
            ids.forEach((id) => {
                if (!id) return;
                next[id] = (next[id] || 0) + 1;
            });
            return next;
        });
    }, []);

    const clearPending = useCallback((ids: string[] = []) => {
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

    const run = useCallback(async (
        items: T[],
        execute: (item: T, descriptor: BulkActionItemDescriptor<T>) => Promise<any>,
        runOptions: RunBulkActionOptions<T> = {}
    ): Promise<BulkActionReport<T>> => {
        const list = Array.isArray(items) ? items : [];
        const descriptors: BulkActionItemDescriptor<T>[] = list.map((item, index) => ({
            item,
            index,
            id: normalizeMessage((runOptions.getId || getId)(item), ''),
            label: normalizeMessage((runOptions.getLabel || getLabel)(item), ''),
        })).filter((item) => item.id);
        const ids = descriptors.map((item) => item.id);

        if (descriptors.length === 0) {
            const emptyReport: BulkActionReport<T> = {
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
                descriptors.map(async (descriptor): Promise<BulkActionResult<T>> => {
                    try {
                        const value = await execute(descriptor.item, descriptor);
                        const mapped = typeof runOptions.mapSuccess === 'function'
                            ? runOptions.mapSuccess(value, descriptor.item, descriptor)
                            : {
                                message: value?.msg || value?.message || '',
                                meta: value?.meta ?? null,
                            };
                        const result: BulkActionResult<T> = {
                            ...descriptor,
                            success: true,
                            value,
                            message: normalizeMessage(mapped?.message, ''),
                            meta: mapped?.meta ?? null,
                            error: null,
                        };
                        runOptions.onItemSettled?.(result);
                        return result;
                    } catch (error: any) {
                        const mapped = typeof runOptions.mapError === 'function'
                            ? runOptions.mapError(error, descriptor.item, descriptor)
                            : {
                                message: error?.response?.data?.msg || error?.message || '',
                                meta: error?.meta ?? null,
                            };
                        const result: BulkActionResult<T> = {
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

            const results: BulkActionResult<T>[] = settled.map((entry) => (entry.status === 'fulfilled' ? entry.value : (entry.reason as BulkActionResult<T>)));
            const successItems = results.filter((item) => item?.success === true);
            const failureItems = results.filter((item) => item?.success === false);
            const report: BulkActionReport<T> = {
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

    const retryFailures = useCallback((
        execute: (item: T, descriptor: BulkActionItemDescriptor<T>) => Promise<any>,
        runOptions: RunBulkActionOptions<T> = {}
    ) => {
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

    const isPending = useCallback((id: string | number) => {
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
