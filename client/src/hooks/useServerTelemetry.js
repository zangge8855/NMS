import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client.js';

const EMPTY_TELEMETRY = {
    items: [],
    byServerId: {},
    generatedAt: '',
};

export default function useServerTelemetry(options = {}) {
    const enabled = options.enabled !== false;
    const hours = Number(options.hours || 24);
    const points = Number(options.points || 24);
    const refreshIntervalMs = Number(options.refreshIntervalMs || 60_000);
    const requestIdRef = useRef(0);
    const [loading, setLoading] = useState(false);
    const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);

    const refresh = useCallback(async (fetchOptions = {}) => {
        if (!enabled) {
            setTelemetry(EMPTY_TELEMETRY);
            return EMPTY_TELEMETRY;
        }

        const quiet = fetchOptions.quiet === true;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        try {
            const res = await api.get('/servers/telemetry/overview', {
                params: {
                    hours,
                    points,
                },
            });
            if (requestId !== requestIdRef.current) {
                return EMPTY_TELEMETRY;
            }
            const payload = res.data?.obj || EMPTY_TELEMETRY;
            const normalized = {
                items: Array.isArray(payload.items) ? payload.items : [],
                byServerId: payload.byServerId && typeof payload.byServerId === 'object' ? payload.byServerId : {},
                generatedAt: String(payload.generatedAt || '').trim(),
            };
            setTelemetry(normalized);
            return normalized;
        } catch (error) {
            if (!quiet) {
                console.error('Failed to fetch server telemetry:', error?.response?.data || error?.message || error);
            }
            if (requestId === requestIdRef.current) {
                setTelemetry(EMPTY_TELEMETRY);
            }
            return EMPTY_TELEMETRY;
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, [enabled, hours, points]);

    useEffect(() => {
        if (!enabled) {
            setTelemetry(EMPTY_TELEMETRY);
            return undefined;
        }
        refresh({ quiet: true });
        const timer = window.setInterval(() => {
            refresh({ quiet: true });
        }, refreshIntervalMs);
        return () => window.clearInterval(timer);
    }, [enabled, refresh, refreshIntervalMs]);

    return {
        telemetry,
        telemetryByServerId: telemetry.byServerId || {},
        telemetryLoading: loading,
        refreshTelemetry: refresh,
    };
}
