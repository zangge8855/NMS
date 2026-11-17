import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../api/client';
import { useOptionalAuth } from '../../../contexts/AuthContext';
import { useI18n } from '../../../contexts/LanguageContext';
import { getErrorMessage } from '../../../utils/format';

// 3x-ui stores some timestamps in seconds and others in milliseconds.
const MS_TIMESTAMP_THRESHOLD = 100_000_000_000;

export function toMillis(value: unknown) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n >= MS_TIMESTAMP_THRESHOLD ? n : n * 1000;
}

/** Proxy path for a 3x-ui `/panel/api` endpoint on one NMS node. */
export function panelApiPath(serverId: string, path: string) {
    return `/panel/${encodeURIComponent(serverId)}/panel/api${path}`;
}

// Panels report failures as HTTP 200 with `success: false`; turn those into errors.
export function assertPanelOk(res: any) {
    const payload = res?.data || {};
    if (payload.success === false) {
        throw Object.assign(new Error(String(payload.msg || '')), { response: { status: res?.status, data: payload } });
    }
    return payload;
}

/** Older 3x-ui builds answer unknown API routes with 404 (or 405 for a known path with another method). */
export function isUnsupportedPanelEndpoint(err: any) {
    const status = Number(err?.response?.status || 0);
    return status === 404 || status === 405 || status === 501;
}

/**
 * Encode fields for endpoints that read form values (`c.PostForm*`). Arrays become
 * repeated keys, which the NMS proxy forwards unchanged.
 */
export function toPanelForm(fields: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, String(item));
        } else {
            params.append(key, String(value));
        }
    }
    return params;
}

export function postPanelForm(url: string, fields: Record<string, unknown>) {
    return api.post(url, toPanelForm(fields), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
}

/** Admins and operators may change panel state; auditors only read. */
export function usePanelPermissions() {
    const role = useOptionalAuth()?.user?.role;
    return {
        role,
        isAdmin: role === 'admin',
        canManage: role === 'admin' || role === 'operator',
    };
}

type PanelListState<T> = {
    rows: T[];
    loading: boolean;
    error: string;
    unsupported: boolean;
    reload: () => Promise<void>;
};

/**
 * Load a list from a panel endpoint. Responses from a stale request are dropped, and a
 * 404/405 marks the feature as unsupported instead of reporting an error.
 */
export function usePanelList<T>(
    url: string,
    describeError: (err: unknown) => string,
    pick: (obj: any) => T[] = (obj) => (Array.isArray(obj) ? obj : []),
): PanelListState<T> {
    const [rows, setRows] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [unsupported, setUnsupported] = useState(false);
    const requestIdRef = useRef(0);
    const describeRef = useRef(describeError);
    const pickRef = useRef(pick);
    describeRef.current = describeError;
    pickRef.current = pick;

    const reload = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const res = await api.get(url);
            if (requestId !== requestIdRef.current) return;
            const payload = assertPanelOk(res);
            setRows(pickRef.current(payload.obj));
            setUnsupported(false);
        } catch (err) {
            if (requestId !== requestIdRef.current) return;
            if (isUnsupportedPanelEndpoint(err)) {
                setUnsupported(true);
                setRows([]);
            } else {
                setError(describeRef.current(err));
            }
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [url]);

    useEffect(() => {
        reload();
        return () => { requestIdRef.current += 1; };
    }, [reload]);

    return { rows, loading, error, unsupported, reload };
}

type PanelActionOptions = {
    success?: string;
    failure: string;
};

/**
 * Run one panel mutation at a time per key: it tracks the busy key, checks the
 * panel's `success` flag and reports the outcome as a toast. Resolves to the
 * panel payload, or null when the request failed.
 */
export function usePanelAction() {
    const { locale } = useI18n();
    const [busyKey, setBusyKey] = useState('');
    const run = useCallback(async (key: string, request: () => Promise<any>, options: PanelActionOptions) => {
        setBusyKey(key);
        try {
            const payload = assertPanelOk(await request());
            if (options.success) toast.success(options.success);
            return payload;
        } catch (err) {
            toast.error(getErrorMessage(err, options.failure, locale));
            return null;
        } finally {
            setBusyKey('');
        }
    }, [locale]);
    return { busyKey, run };
}

/** Split free text (newlines, commas, spaces) into unique trimmed entries. */
export function splitList(text: string) {
    const seen = new Set<string>();
    for (const part of String(text || '').split(/[\s,，;；]+/)) {
        const value = part.trim();
        if (value) seen.add(value);
    }
    return [...seen];
}

export type PanelInboundOption = {
    id: number;
    remark?: string;
    protocol?: string;
    port?: number | string;
    tag?: string;
};

export function describeInbound(inbound: PanelInboundOption | undefined, id: number) {
    if (!inbound) return `#${id}`;
    const name = String(inbound.remark || inbound.tag || `#${id}`);
    return inbound.port ? `${name} (${inbound.protocol || '-'}:${inbound.port})` : name;
}
