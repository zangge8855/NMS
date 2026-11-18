import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client';
import { useI18n } from '../../../contexts/LanguageContext';
import { formatBytes, formatDateTime, getErrorMessage } from '../../../utils/format';
import { ListPagination } from '../../UI/ListToolbar';
import { PanelEmpty, PanelFeatureFrame, PanelListSkeleton } from './PanelFeatureFrame';
import {
    assertPanelOk,
    describeInbound,
    isUnsupportedPanelEndpoint,
    panelApiPath,
    toMillis,
    type PanelInboundOption,
} from './panelRequest';

export const DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE = 20;

const CLIENT_STATUS_OPTIONS = ['enabled', 'disabled', 'depleted', 'expired'] as const;
const MS_PER_DAY = 86_400_000;

export type ClientDirectoryQuery = {
    page: number;
    pageSize: number;
    search: string;
    inboundId: string;
    group: string;
    status: string;
};

export type ClientLookupMode = 'subId' | 'tgId';

export type ClientDirectoryEntry = {
    key: string;
    email: string;
    inboundIds: number[];
    inboundLabels: string[];
    protocol: string;
    group: string;
    enable: boolean;
    up: number;
    down: number;
    trafficUsed: number;
    totalGB: number;
    expiryTime: number;
    subId: string;
    tgId: string;
};

export type PagedClientsResult = {
    items: ClientDirectoryEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
};

type LookupState = {
    mode: ClientLookupMode;
    value: string;
};

function toFiniteNumber(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toEnabledFlag(raw: any, client: any): boolean {
    const candidate = client?.enable ?? raw?.enable ?? client?.enabled ?? raw?.enabled;
    if (candidate === undefined || candidate === null) return true;
    if (typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') return candidate !== 0;
    const normalized = String(candidate).trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'no';
}

function collectInboundIds(raw: any, client: any): number[] {
    const seen = new Set<number>();
    const addId = (value: unknown) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) seen.add(parsed);
    };

    addId(raw?.inboundId);
    addId(client?.inboundId);
    addId(raw?.inbound?.id);

    for (const list of [raw?.inboundIds, client?.inboundIds]) {
        if (Array.isArray(list)) {
            for (const item of list) addId(item);
        }
    }
    if (Array.isArray(raw?.inbounds)) {
        for (const item of raw.inbounds) addId(item?.id ?? item);
    }

    return [...seen];
}

function resolveInboundLabels(
    raw: any,
    client: any,
    inboundIds: number[],
    inboundMap?: Map<number, PanelInboundOption>,
): string[] {
    if (Array.isArray(raw?.inbounds) && raw.inbounds.some((item: any) => item && typeof item === 'object')) {
        return raw.inbounds
            .filter((item: any) => item && typeof item === 'object')
            .map((item: any) => {
                const id = Number(item.id || 0);
                return describeInbound({
                    id,
                    remark: item.remark,
                    protocol: item.protocol,
                    port: item.port,
                    tag: item.tag,
                }, id);
            });
    }

    if (raw?.inbound && typeof raw.inbound === 'object') {
        const id = Number(raw.inbound.id ?? raw?.inboundId ?? client?.inboundId ?? 0);
        return [describeInbound({
            id,
            remark: raw.inbound.remark,
            protocol: raw.inbound.protocol,
            port: raw.inbound.port,
            tag: raw.inbound.tag,
        }, id)];
    }

    const remark = String(raw?.inboundRemark ?? client?.inboundRemark ?? raw?.remark ?? '').trim();
    if (inboundIds.length > 0) {
        return inboundIds.map((id) => {
            const known = inboundMap?.get(id);
            if (known) return describeInbound(known, id);
            return remark ? `${remark} (#${id})` : `#${id}`;
        });
    }

    return remark ? [remark] : [];
}

/** Build the proxy URL + query string for `GET /panel/api/clients/list/paged`. */
export function buildClientDirectoryUrl(serverId: string, query: Partial<ClientDirectoryQuery> = {}): string {
    const base = panelApiPath(serverId, '/clients/list/paged');
    const params = new URLSearchParams();
    const parsedPage = Math.floor(toFiniteNumber(query.page, 1));
    const page = parsedPage >= 1 ? parsedPage : 1;
    const parsedPageSize = Math.floor(toFiniteNumber(query.pageSize, DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE));
    const pageSize = parsedPageSize >= 1 ? parsedPageSize : DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE;
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));

    const search = String(query.search || '').trim();
    const inboundId = String(query.inboundId || '').trim();
    const group = String(query.group || '').trim();
    const status = String(query.status || '').trim();

    if (search) params.set('search', search);
    if (inboundId) params.set('inboundId', inboundId);
    if (group) params.set('group', group);
    if (status) params.set('status', status);

    return `${base}?${params.toString()}`;
}

/** Build the proxy URL for exact SubID or Telegram ID client lookup. */
export function buildClientLookupUrl(serverId: string, mode: ClientLookupMode, value: string): string {
    const trimmed = String(value || '').trim();
    const path = mode === 'tgId'
        ? `/clients/get/tgId/${encodeURIComponent(trimmed)}`
        : `/clients/get/subId/${encodeURIComponent(trimmed)}`;
    return panelApiPath(serverId, path);
}

/**
 * Distinguish a business "no client matched this SubID/TG ID" response from a
 * generic HTTP 404/405/501 indicating the panel build lacks the endpoint.
 */
export function isClientLookupNotFound(err: any): boolean {
    const status = Number(err?.response?.status || 0);
    const msg = String(err?.response?.data?.msg || err?.message || '').trim().toLowerCase();
    if (!msg) return false;
    const isBusinessNotFound = msg.includes('client not found')
        || msg.includes('record not found')
        || msg.includes('user not found')
        || (status === 200 && msg.includes('not found'));
    if (!isBusinessNotFound) return false;
    return status === 200 || status === 404 || status === 0;
}

/** Normalize one client row from paged directory or exact lookup payloads. */
export function normalizeDirectoryClient(
    raw: any,
    inboundMap?: Map<number, PanelInboundOption>,
    index = 0,
): ClientDirectoryEntry {
    const source = raw && typeof raw === 'object' ? raw : {};
    const client = source.client && typeof source.client === 'object' ? source.client : source;
    const inboundIds = collectInboundIds(source, client);
    const inboundLabels = resolveInboundLabels(source, client, inboundIds, inboundMap);

    const firstArrayInbound = Array.isArray(source.inbounds) ? source.inbounds[0] : null;
    const firstMatchedInbound = inboundIds.length > 0 ? inboundMap?.get(inboundIds[0]) : undefined;
    const protocol = String(
        client?.protocol
        ?? source.protocol
        ?? source.inbound?.protocol
        ?? firstArrayInbound?.protocol
        ?? firstMatchedInbound?.protocol
        ?? '',
    ).trim();

    const traffic = (source.traffic && typeof source.traffic === 'object')
        ? source.traffic
        : ((source.clientStat && typeof source.clientStat === 'object') ? source.clientStat : {});

    const up = Math.max(0, toFiniteNumber(source.up ?? traffic?.up ?? client?.up, 0));
    const down = Math.max(0, toFiniteNumber(source.down ?? traffic?.down ?? client?.down, 0));
    const explicitUsed = source.trafficUsed ?? client?.trafficUsed ?? traffic?.trafficUsed;
    const trafficUsed = explicitUsed !== undefined && explicitUsed !== null
        ? Math.max(0, toFiniteNumber(explicitUsed, up + down))
        : (up + down);
    const totalGB = Math.max(0, toFiniteNumber(
        client?.totalGB ?? client?.total ?? source.totalGB ?? source.total ?? traffic?.total,
        0,
    ));

    const expiryTime = toFiniteNumber(client?.expiryTime ?? source.expiryTime ?? traffic?.expiryTime, 0);
    const email = String(client?.email ?? source.email ?? '').trim();
    const group = String(client?.group ?? source.group ?? client?.clientGroup ?? source.clientGroup ?? '').trim();
    const subId = String(client?.subId ?? client?.subID ?? source.subId ?? source.subID ?? '').trim();
    const rawTgId = client?.tgId ?? client?.tgID ?? source.tgId ?? source.tgID;
    const tgIdText = rawTgId === undefined || rawTgId === null ? '' : String(rawTgId).trim();
    const tgId = tgIdText === '' || tgIdText === '0' ? '' : tgIdText;

    return {
        key: `${email || 'client'}-${inboundIds.join('_') || 'none'}-${subId || 'nosub'}-${index}`,
        email,
        inboundIds,
        inboundLabels,
        protocol,
        group,
        enable: toEnabledFlag(source, client),
        up,
        down,
        trafficUsed,
        totalGB,
        expiryTime,
        subId,
        tgId,
    };
}

/** Normalize `{ items | clients | records | list, total, page, pageSize }` or direct arrays. */
export function normalizePagedClientsResponse(
    raw: unknown,
    fallbackPage = 1,
    fallbackPageSize = DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE,
    inboundMap?: Map<number, PanelInboundOption>,
): PagedClientsResult {
    const parsedFallbackPage = Math.floor(toFiniteNumber(fallbackPage, 1));
    const safePage = parsedFallbackPage >= 1 ? parsedFallbackPage : 1;
    const parsedFallbackSize = Math.floor(toFiniteNumber(fallbackPageSize, DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE));
    const safePageSize = parsedFallbackSize >= 1 ? parsedFallbackSize : DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE;

    if (Array.isArray(raw)) {
        const items = raw.map((item, idx) => normalizeDirectoryClient(item, inboundMap, idx));
        const total = items.length;
        return {
            items,
            total,
            page: safePage,
            pageSize: safePageSize,
            totalPages: Math.max(1, Math.ceil(total / safePageSize)),
        };
    }

    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, any>;
        const list = [obj.items, obj.clients, obj.records, obj.list].find(Array.isArray) || [];
        const items = list.map((item: any, idx: number) => normalizeDirectoryClient(item, inboundMap, idx));

        const totalCandidate = obj.total ?? obj.totalCount ?? obj.count;
        const parsedTotal = toFiniteNumber(totalCandidate, -1);
        const total = totalCandidate !== undefined && totalCandidate !== null && parsedTotal >= 0
            ? Math.floor(parsedTotal)
            : items.length;

        const pageCandidate = obj.page ?? obj.currentPage;
        const parsedPage = toFiniteNumber(pageCandidate, 0);
        const page = pageCandidate !== undefined && pageCandidate !== null && parsedPage >= 1
            ? Math.floor(parsedPage)
            : safePage;

        const sizeCandidate = obj.pageSize ?? obj.limit ?? obj.perPage;
        const parsedSize = toFiniteNumber(sizeCandidate, 0);
        const pageSize = sizeCandidate !== undefined && sizeCandidate !== null && parsedSize >= 1
            ? Math.floor(parsedSize)
            : safePageSize;

        return {
            items,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
        };
    }

    return {
        items: [],
        total: 0,
        page: safePage,
        pageSize: safePageSize,
        totalPages: 1,
    };
}

/** Normalize responses from `clients/get/subId/:subId` or `clients/get/tgId/:tgId`. */
export function normalizeLookupClientsResponse(
    raw: unknown,
    inboundMap?: Map<number, PanelInboundOption>,
): ClientDirectoryEntry[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((item, idx) => normalizeDirectoryClient(item, inboundMap, idx));
    }
    if (typeof raw === 'object') {
        const obj = raw as Record<string, any>;
        const containerList = [obj.items, obj.clients, obj.records, obj.list].find(Array.isArray);
        if (containerList) {
            return containerList.map((item: any, idx: number) => normalizeDirectoryClient(item, inboundMap, idx));
        }
        if (obj.client && typeof obj.client === 'object') {
            return [normalizeDirectoryClient(obj, inboundMap, 0)];
        }
        if (obj.email || obj.subId || obj.subID || obj.tgId || obj.tgID || obj.id || obj.uuid) {
            return [normalizeDirectoryClient(obj, inboundMap, 0)];
        }
    }
    return [];
}

function createInitialQuery(): ClientDirectoryQuery {
    return {
        page: 1,
        pageSize: DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE,
        search: '',
        inboundId: '',
        group: '',
        status: '',
    };
}

type ClientDirectoryPanelProps = {
    serverId: string;
    inbounds: PanelInboundOption[];
};

/**
 * 3x-ui v3.11 paged client directory (`clients/list/paged`) and exact lookup by
 * SubID (`clients/get/subId/:subId`) or Telegram ID (`clients/get/tgId/:tgId`).
 */
export default function ClientDirectoryPanel({ serverId, inbounds }: ClientDirectoryPanelProps) {
    const { t, locale } = useI18n();
    const tr = useCallback((key: string, params?: Record<string, any>) => t(`pages.panelFeatures.${key}`, params), [t]);
    const inboundById = useMemo(() => new Map(inbounds.map((item) => [Number(item.id), item])), [inbounds]);
    const inboundByIdRef = useRef(inboundById);
    inboundByIdRef.current = inboundById;

    const [query, setQuery] = useState<ClientDirectoryQuery>(createInitialQuery);
    const [searchDraft, setSearchDraft] = useState('');
    const [groupDraft, setGroupDraft] = useState('');
    const [directory, setDirectory] = useState<PagedClientsResult>({
        items: [],
        total: 0,
        page: 1,
        pageSize: DEFAULT_CLIENT_DIRECTORY_PAGE_SIZE,
        totalPages: 1,
    });
    const [dirLoading, setDirLoading] = useState(true);
    const [dirError, setDirError] = useState('');
    const [dirUnsupported, setDirUnsupported] = useState(false);

    const [lookupMode, setLookupMode] = useState<ClientLookupMode>('subId');
    const [lookupInput, setLookupInput] = useState('');
    const [activeLookup, setActiveLookup] = useState<LookupState | null>(null);
    const [lookupRows, setLookupRows] = useState<ClientDirectoryEntry[]>([]);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupError, setLookupError] = useState('');
    const [lookupUnsupported, setLookupUnsupported] = useState(false);

    const dirRequestIdRef = useRef(0);
    const lookupRequestIdRef = useRef(0);
    const prevServerIdRef = useRef(serverId);

    const loadDirectory = useCallback(async (targetQuery: ClientDirectoryQuery) => {
        const requestId = dirRequestIdRef.current + 1;
        dirRequestIdRef.current = requestId;
        setDirLoading(true);
        setDirError('');
        try {
            const url = buildClientDirectoryUrl(serverId, targetQuery);
            const res = await api.get(url);
            if (requestId !== dirRequestIdRef.current) return;
            const payload = assertPanelOk(res);
            const data = payload.obj !== undefined ? payload.obj : payload;
            setDirectory(normalizePagedClientsResponse(data, targetQuery.page, targetQuery.pageSize, inboundByIdRef.current));
            setDirUnsupported(false);
        } catch (err) {
            if (requestId !== dirRequestIdRef.current) return;
            if (isUnsupportedPanelEndpoint(err)) {
                setDirUnsupported(true);
                setDirectory((prev) => ({ ...prev, items: [], total: 0, totalPages: 1 }));
            } else {
                setDirError(getErrorMessage(err, tr('clients.loadFailed'), locale));
            }
        } finally {
            if (requestId === dirRequestIdRef.current) setDirLoading(false);
        }
    }, [locale, serverId, tr]);

    const runLookup = useCallback(async (mode: ClientLookupMode, value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        const requestId = lookupRequestIdRef.current + 1;
        lookupRequestIdRef.current = requestId;
        setActiveLookup({ mode, value: trimmed });
        setLookupLoading(true);
        setLookupError('');
        setLookupUnsupported(false);
        try {
            const res = await api.get(buildClientLookupUrl(serverId, mode, trimmed));
            if (requestId !== lookupRequestIdRef.current) return;
            const payload = assertPanelOk(res);
            const data = payload.obj !== undefined ? payload.obj : payload;
            setLookupRows(normalizeLookupClientsResponse(data, inboundByIdRef.current));
        } catch (err) {
            if (requestId !== lookupRequestIdRef.current) return;
            if (isClientLookupNotFound(err)) {
                setLookupRows([]);
                setLookupError('');
            } else if (isUnsupportedPanelEndpoint(err)) {
                setLookupUnsupported(true);
                setLookupRows([]);
            } else {
                setLookupError(getErrorMessage(err, tr('clients.lookupFailed'), locale));
                setLookupRows([]);
            }
        } finally {
            if (requestId === lookupRequestIdRef.current) setLookupLoading(false);
        }
    }, [locale, serverId, tr]);

    useEffect(() => {
        if (prevServerIdRef.current !== serverId) {
            prevServerIdRef.current = serverId;
            lookupRequestIdRef.current += 1;
            setActiveLookup(null);
            setLookupRows([]);
            setLookupError('');
            setLookupUnsupported(false);
            setLookupInput('');
            setSearchDraft('');
            setGroupDraft('');
            setQuery(createInitialQuery());
            return;
        }
        loadDirectory(query);
    }, [loadDirectory, query, serverId]);

    useEffect(() => () => {
        dirRequestIdRef.current += 1;
        lookupRequestIdRef.current += 1;
    }, []);

    const clearLookupState = useCallback(() => {
        lookupRequestIdRef.current += 1;
        setActiveLookup(null);
        setLookupRows([]);
        setLookupLoading(false);
        setLookupError('');
        setLookupUnsupported(false);
    }, []);

    const resetLookup = useCallback(() => {
        clearLookupState();
        setLookupInput('');
    }, [clearLookupState]);

    const applyFilterChanges = (patch: Partial<ClientDirectoryQuery>) => {
        clearLookupState();
        setQuery((prev) => ({
            ...prev,
            search: searchDraft,
            group: groupDraft,
            ...patch,
            page: patch.page ?? 1,
        }));
    };

    const handleFilterSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        applyFilterChanges({ page: 1 });
    };

    const handleResetFilters = () => {
        clearLookupState();
        setSearchDraft('');
        setGroupDraft('');
        setQuery((prev) => ({
            page: 1,
            pageSize: prev.pageSize,
            search: '',
            inboundId: '',
            group: '',
            status: '',
        }));
    };

    const handleLookupSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        runLookup(lookupMode, lookupInput);
    };

    const handleRefresh = () => {
        if (activeLookup) {
            runLookup(activeLookup.mode, activeLookup.value);
            return;
        }
        loadDirectory(query);
    };

    const isLookupMode = activeLookup !== null;
    const loading = isLookupMode ? lookupLoading : dirLoading;
    const error = isLookupMode ? lookupError : dirError;
    const unsupported = isLookupMode ? lookupUnsupported : dirUnsupported;
    const rows = isLookupMode ? lookupRows : directory.items;

    const hasActiveFilters = Boolean(
        query.search
        || query.inboundId
        || query.group
        || query.status
        || searchDraft.trim()
        || groupDraft.trim(),
    );

    const lookupTypeLabel = (mode: ClientLookupMode) => (
        mode === 'tgId' ? tr('clients.lookupTgId') : tr('clients.lookupSubId')
    );

    const formatExpiry = (expiryTime: number) => {
        if (!expiryTime) return <span>{tr('clients.expiryNever')}</span>;
        if (expiryTime < 0) {
            const days = Math.max(1, Math.round(Math.abs(expiryTime) / MS_PER_DAY));
            return <span>{tr('clients.expiryRelative', { days })}</span>;
        }
        const ms = toMillis(expiryTime);
        if (!ms) return <span>{tr('clients.none')}</span>;
        return (
            <time dateTime={new Date(ms).toISOString()} title={formatDateTime(ms, locale)}>
                {formatDateTime(ms, locale)}
            </time>
        );
    };

    const nowMs = Date.now();

    return (
        <PanelFeatureFrame
            title={tr('clients.title')}
            description={tr('clients.description')}
            loading={loading}
            error={error}
            unsupported={unsupported}
            onRefresh={handleRefresh}
        >
            <div className="pf-controls">
                <form className="pf-filter-bar" onSubmit={handleFilterSubmit}>
                    <div className="pf-filter-field">
                        <label htmlFor="pf-clients-search" className="pf-filter-label">{tr('clients.searchLabel')}</label>
                        <input
                            id="pf-clients-search"
                            className="form-input"
                            value={searchDraft}
                            onChange={(event) => setSearchDraft(event.target.value)}
                            placeholder={tr('clients.searchPlaceholder')}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                    <div className="pf-filter-field">
                        <label htmlFor="pf-clients-inbound" className="pf-filter-label">{tr('clients.inboundLabel')}</label>
                        <select
                            id="pf-clients-inbound"
                            className="form-select"
                            value={query.inboundId}
                            onChange={(event) => applyFilterChanges({ inboundId: event.target.value, page: 1 })}
                        >
                            <option value="">{tr('clients.allInbounds')}</option>
                            {inbounds.map((item) => (
                                <option key={item.id} value={String(item.id)}>
                                    {describeInbound(item, Number(item.id))}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="pf-filter-field">
                        <label htmlFor="pf-clients-group" className="pf-filter-label">{tr('clients.groupLabel')}</label>
                        <input
                            id="pf-clients-group"
                            className="form-input"
                            value={groupDraft}
                            onChange={(event) => setGroupDraft(event.target.value)}
                            placeholder={tr('clients.groupPlaceholder')}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                    <div className="pf-filter-field">
                        <label htmlFor="pf-clients-status" className="pf-filter-label">{tr('clients.statusLabel')}</label>
                        <select
                            id="pf-clients-status"
                            className="form-select"
                            value={query.status}
                            onChange={(event) => applyFilterChanges({ status: event.target.value, page: 1 })}
                        >
                            <option value="">{tr('clients.allStatuses')}</option>
                            {CLIENT_STATUS_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {tr(`clients.statusOptions.${option}`)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="pf-filter-actions">
                        <button type="submit" className="btn btn-secondary btn-sm">
                            {tr('clients.applyFilters')}
                        </button>
                        {hasActiveFilters && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetFilters}>
                                {tr('clients.resetFilters')}
                            </button>
                        )}
                    </div>
                </form>

                <form className="pf-lookup-bar" onSubmit={handleLookupSubmit}>
                    <div className="pf-filter-field pf-lookup-type">
                        <label htmlFor="pf-clients-lookup-mode" className="pf-filter-label">{tr('clients.lookupType')}</label>
                        <select
                            id="pf-clients-lookup-mode"
                            className="form-select"
                            value={lookupMode}
                            onChange={(event) => setLookupMode(event.target.value as ClientLookupMode)}
                        >
                            <option value="subId">{tr('clients.lookupSubId')}</option>
                            <option value="tgId">{tr('clients.lookupTgId')}</option>
                        </select>
                    </div>
                    <div className="pf-filter-field pf-lookup-input-wrap">
                        <label htmlFor="pf-clients-lookup-value" className="pf-filter-label">{tr('clients.lookupLabel')}</label>
                        <input
                            id="pf-clients-lookup-value"
                            className="form-input pf-machine"
                            value={lookupInput}
                            onChange={(event) => setLookupInput(event.target.value)}
                            placeholder={lookupMode === 'tgId' ? tr('clients.tgIdPlaceholder') : tr('clients.subIdPlaceholder')}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                    <div className="pf-filter-actions">
                        <button type="submit" className="btn btn-primary btn-sm" disabled={!lookupInput.trim() || lookupLoading}>
                            {tr('clients.lookupSubmit')}
                        </button>
                    </div>
                </form>
            </div>

            {isLookupMode && (
                <div className="pf-lookup-banner" role="status">
                    <span className="pf-lookup-banner-text">
                        {loading
                            ? tr('common.loading')
                            : error
                                ? `${lookupTypeLabel(activeLookup.mode)}: ${activeLookup.value}`
                                : tr('clients.lookupActive', {
                                    type: lookupTypeLabel(activeLookup.mode),
                                    value: activeLookup.value,
                                    count: rows.length,
                                })}
                    </span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={resetLookup}>
                        {tr('clients.backToDirectory')}
                    </button>
                </div>
            )}

            {loading && rows.length === 0 ? (
                <PanelListSkeleton />
            ) : rows.length === 0 ? (
                !error && (
                    <PanelEmpty
                        title={isLookupMode ? tr('clients.lookupEmptyTitle') : tr('clients.emptyTitle')}
                        hint={isLookupMode
                            ? tr('clients.lookupEmptyHint', { type: lookupTypeLabel(activeLookup.mode) })
                            : tr('clients.emptyHint')}
                        action={!isLookupMode && hasActiveFilters ? (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={handleResetFilters}>
                                {tr('clients.resetFilters')}
                            </button>
                        ) : null}
                    />
                )
            ) : (
                <>
                    <ul className="pf-list" aria-label={tr('clients.listLabel')}>
                        {rows.map((row) => {
                            const expiryMs = row.expiryTime > 0 ? toMillis(row.expiryTime) : 0;
                            const expired = Boolean(expiryMs && expiryMs <= nowMs);
                            const depleted = row.totalGB > 0 && row.trafficUsed >= row.totalGB;
                            return (
                                <li key={row.key} className={`pf-row${row.enable ? '' : ' is-muted'}`}>
                                    <div className="pf-row-main">
                                        <div className="pf-row-title">
                                            <span>{row.email || tr('clients.unknownEmail')}</span>
                                            <span className={`badge ${row.enable ? 'badge-success' : 'badge-neutral'}`}>
                                                {tr(row.enable ? 'clients.statusOptions.enabled' : 'clients.statusOptions.disabled')}
                                            </span>
                                            {row.protocol ? (
                                                <span className="badge badge-neutral">{row.protocol}</span>
                                            ) : null}
                                            {row.enable && depleted ? (
                                                <span className="badge badge-danger">{tr('clients.statusOptions.depleted')}</span>
                                            ) : null}
                                            {row.enable && expired ? (
                                                <span className="badge badge-warning">{tr('clients.statusOptions.expired')}</span>
                                            ) : null}
                                        </div>
                                        <div className="pf-row-meta">
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('clients.inboundField')}</span>
                                                <span>{row.inboundLabels.length > 0 ? row.inboundLabels.join(', ') : tr('clients.none')}</span>
                                            </span>
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('clients.groupField')}</span>
                                                <span>{row.group || tr('clients.none')}</span>
                                            </span>
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('clients.expiryField')}</span>
                                                {formatExpiry(row.expiryTime)}
                                            </span>
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('clients.subIdField')}</span>
                                                <span className="pf-machine">{row.subId || tr('clients.none')}</span>
                                            </span>
                                            <span className="pf-meta-item">
                                                <span className="pf-meta-key">{tr('clients.tgIdField')}</span>
                                                <span className="pf-machine">{row.tgId || tr('clients.none')}</span>
                                            </span>
                                        </div>
                                    </div>
                                    <div className="pf-row-figure">
                                        <span className={`pf-figure${row.trafficUsed > 0 ? '' : ' pf-figure--idle'}`}>
                                            {formatBytes(row.trafficUsed)}
                                        </span>
                                        <span className="pf-figure-label">
                                            {row.totalGB > 0
                                                ? tr('clients.trafficLimit', { limit: formatBytes(row.totalGB) })
                                                : tr('clients.unlimited')}
                                        </span>
                                        {row.up > 0 || row.down > 0 ? (
                                            <span className="pf-figure-label">
                                                {tr('clients.trafficSplit', { up: formatBytes(row.up), down: formatBytes(row.down) })}
                                            </span>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {!isLookupMode && (
                        <ListPagination
                            className="pf-pagination"
                            page={directory.page}
                            totalPages={directory.totalPages}
                            pageSize={query.pageSize}
                            totalItems={directory.total}
                            loading={loading}
                            onPrevious={() => setQuery((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                            onNext={() => setQuery((prev) => ({ ...prev, page: Math.min(directory.totalPages, prev.page + 1) }))}
                            onPageSizeChange={(nextSize) => setQuery((prev) => ({ ...prev, pageSize: nextSize, page: 1 }))}
                            onJump={(nextPage) => setQuery((prev) => ({ ...prev, page: nextPage }))}
                        />
                    )}
                </>
            )}
        </PanelFeatureFrame>
    );
}
