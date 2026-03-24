import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { readSessionSnapshot, writeSessionSnapshot } from '../utils/sessionSnapshot.js';

const EMPTY_TELEMETRY = {
    items: [],
    byServerId: {},
    generatedAt: '',
};
const SERVER_TELEMETRY_SNAPSHOT_TTL_MS = 2 * 60_000;

function buildTelemetrySnapshotKey(hours, points) {
    return `server_telemetry_overview_v1:${hours}:${points}`;
}

function readTelemetrySnapshot(hours, points) {
    const snapshot = readSessionSnapshot(buildTelemetrySnapshotKey(hours, points), {
        maxAgeMs: SERVER_TELEMETRY_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;
    return {
        items: Array.isArray(snapshot?.items) ? snapshot.items : [],
        byServerId: snapshot?.byServerId && typeof snapshot.byServerId === 'object' ? snapshot.byServerId : {},
        generatedAt: String(snapshot?.generatedAt || '').trim(),
    };
}

export default function useServerTelemetry(options = {}) {
    const enabled = options.enabled !== false;
    const hours = Number(options.hours || 24);
    const points = Number(options.points || 24);
    const refreshIntervalMs = Number(options.refreshIntervalMs || 60_000);
    const snapshotKey = buildTelemetrySnapshotKey(hours, points);
    const requestIdRef = useRef(0);
    const telemetryBootstrapRef = useRef(readTelemetrySnapshot(hours, points));
    const telemetryStateRef = useRef(telemetryBootstrapRef.current || EMPTY_TELEMETRY);
    const [loading, setLoading] = useState(false);
    const [telemetry, setTelemetry] = useState(() => telemetryBootstrapRef.current || EMPTY_TELEMETRY);

    useEffect(() => {
        telemetryStateRef.current = telemetry;
        writeSessionSnapshot(snapshotKey, telemetry);
    }, [snapshotKey, telemetry]);

    const refresh = useCallback(async (fetchOptions = {}) => {
        if (!enabled) {
            setTelemetry(EMPTY_TELEMETRY);
            return EMPTY_TELEMETRY;
        }

        const quiet = fetchOptions.quiet === true;
        const preserveCurrent = fetchOptions.preserveCurrent === true
            || (fetchOptions.preserveCurrent == null && telemetryStateRef.current.items.length > 0);
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!preserveCurrent) {
            setLoading(true);
        }
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
            if (requestId === requestIdRef.current && !preserveCurrent) {
                setTelemetry(EMPTY_TELEMETRY);
            }
            return preserveCurrent ? telemetryStateRef.current : EMPTY_TELEMETRY;
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
        refresh({
            quiet: true,
            preserveCurrent: telemetryBootstrapRef.current != null || telemetryStateRef.current.items.length > 0,
        });
        const timer = window.setInterval(() => {
            refresh({ quiet: true, preserveCurrent: true });
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
