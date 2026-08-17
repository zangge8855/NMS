import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import api from '../api/client';
import { clearSessionSnapshot, readSessionSnapshot, SESSION_SNAPSHOT_EVENT, writeSessionSnapshot } from '../utils/sessionSnapshot';
import { invalidateServerPanelDataCache } from '../utils/serverPanelDataCache';
import type { ServerNode } from '../types/index.ts';

export interface ServerContextType {
    servers: ServerNode[];
    activeServer: ServerNode | null;
    activeServerId: string | null;
    loading: boolean;
    selectServer: () => void;
    addServer: (serverData: any) => Promise<any>;
    addServersBatch: (payload: any) => Promise<any>;
    updateServer: (id: string | number, serverData: any) => Promise<any>;
    removeServer: (id: string | number) => Promise<any>;
    testConnection: (id: string | number, payload?: any) => Promise<any>;
    fetchServers: (options?: { force?: boolean; preserveCurrent?: boolean }) => Promise<ServerNode[]>;
    panelApi: (method: string, path: string, data?: any, config?: any) => Promise<any>;
}

const ServerContext = createContext<ServerContextType | null>(null);
const ACTIVE_SERVER_KEY = 'nms_active_server';
const LEGACY_ACTIVE_SERVER_KEY = 'xui_active_server';
const SERVER_CONTEXT_SNAPSHOT_KEY = 'server_context_bootstrap_v1';
const SERVER_CONTEXT_SNAPSHOT_TTL_MS = 2 * 60_000;
const SERVER_FETCH_TTL_MS = 10_000;

interface ServerContextSnapshot {
    servers: ServerNode[];
    activeServerId?: string | null;
}

function readServerContextSnapshot(): ServerContextSnapshot | null {
    const snapshot = readSessionSnapshot<ServerContextSnapshot>(SERVER_CONTEXT_SNAPSHOT_KEY, {
        maxAgeMs: SERVER_CONTEXT_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    const servers = Array.isArray(snapshot?.servers) ? snapshot.servers : [];

    return {
        servers,
        activeServerId: servers.length > 0 ? 'global' : null,
    };
}

function getStoredActiveServerId(): string | null {
    const value = localStorage.getItem(ACTIVE_SERVER_KEY);
    if (value) {
        persistActiveServerId('global');
        return 'global';
    }

    const legacyValue = localStorage.getItem(LEGACY_ACTIVE_SERVER_KEY);
    if (legacyValue) {
        persistActiveServerId('global');
        return 'global';
    }

    return null;
}

function persistActiveServerId(value?: string | null): void {
    if (value) {
        localStorage.setItem(ACTIVE_SERVER_KEY, value);
        localStorage.removeItem(LEGACY_ACTIVE_SERVER_KEY);
        return;
    }

    localStorage.removeItem(ACTIVE_SERVER_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_SERVER_KEY);
}

function resolvePreferredServerId(serverList: ServerNode[] = []): string | null {
    const hasServers = Array.isArray(serverList) && serverList.length > 0;
    return hasServers ? 'global' : null;
}

export interface ServerProviderProps {
    children: ReactNode;
    enabled?: boolean;
}

export function ServerProvider({ children, enabled = true }: ServerProviderProps) {
    const bootstrapRef = useRef<ServerContextSnapshot | null>(enabled ? readServerContextSnapshot() : null);
    const [servers, setServers] = useState<ServerNode[]>(() => (enabled ? (bootstrapRef.current?.servers || []) : []));
    const [activeServerId, setActiveServerId] = useState<string | null>(
        () => !enabled
            ? null
            : bootstrapRef.current?.activeServerId
            || getStoredActiveServerId()
            || (bootstrapRef.current?.servers?.length ? 'global' : null)
    );
    const [loading, setLoading] = useState<boolean>(() => (enabled ? bootstrapRef.current == null : false));
    const serversStateRef = useRef<ServerNode[]>(enabled ? (bootstrapRef.current?.servers || []) : []);
    const fetchServersPendingRef = useRef<Promise<ServerNode[]> | null>(null);
    const lastFetchedAtRef = useRef<number>(bootstrapRef.current ? Date.now() : 0);

    useEffect(() => {
        serversStateRef.current = servers;
    }, [servers]);

    const fetchServers = useCallback(async (options: { force?: boolean; preserveCurrent?: boolean } = {}): Promise<ServerNode[]> => {
        if (!enabled) {
            serversStateRef.current = [];
            setServers([]);
            setActiveServerId(null);
            setLoading(false);
            return [];
        }
        const force = options.force === true;
        const preserveCurrent = options.preserveCurrent === true || (options.preserveCurrent == null && servers.length > 0);
        const hasCachedServers = Array.isArray(serversStateRef.current);
        const ageMs = Date.now() - Number(lastFetchedAtRef.current || 0);

        if (!force && fetchServersPendingRef.current) {
            return fetchServersPendingRef.current;
        }
        if (!force && hasCachedServers && ageMs >= 0 && ageMs <= SERVER_FETCH_TTL_MS) {
            return serversStateRef.current;
        }
        if (!preserveCurrent) {
            setLoading(true);
        }

        const request = api.get('/servers')
            .then((res) => {
                const serverList: ServerNode[] = res.data.obj || [];
                lastFetchedAtRef.current = Date.now();
                serversStateRef.current = serverList;
                setServers(serverList);

                setActiveServerId(() => {
                    const nextId = resolvePreferredServerId(serverList);
                    persistActiveServerId(nextId);
                    return nextId;
                });

                return serverList;
            })
            .catch((err) => {
                if (err.response?.status !== 403) {
                    console.error('Failed to fetch servers:', err);
                }
                if (!preserveCurrent) {
                    serversStateRef.current = [];
                    setServers([]);
                    setActiveServerId('global');
                    persistActiveServerId('global');
                }
                throw err;
            })
            .finally(() => {
                if (fetchServersPendingRef.current === request) {
                    fetchServersPendingRef.current = null;
                }
                setLoading(false);
            });

        fetchServersPendingRef.current = request;
        try {
            return await request;
        } catch {
            return serversStateRef.current;
        } finally {
            if (!preserveCurrent) {
                setLoading(false);
            }
        }
    }, [enabled, servers.length]);

    useEffect(() => {
        if (!enabled) {
            serversStateRef.current = [];
            setServers([]);
            setActiveServerId(null);
            setLoading(false);
            clearSessionSnapshot(SERVER_CONTEXT_SNAPSHOT_KEY);
            return;
        }
        fetchServers({ preserveCurrent: bootstrapRef.current != null });
    }, [enabled, fetchServers]);

    useEffect(() => {
        if (!enabled) return undefined;
        const handleSnapshotUpdate = (event: any) => {
            const detail = event?.detail && typeof event.detail === 'object' ? event.detail : null;
            if (!detail || detail.key !== SERVER_CONTEXT_SNAPSHOT_KEY || detail.source !== 'app-bootstrap') return;
            const snapshot = readServerContextSnapshot();
            if (!snapshot) return;
            setServers(snapshot.servers);
            setActiveServerId(() => {
                const nextId = resolvePreferredServerId(snapshot.servers);
                if (nextId) {
                    persistActiveServerId(nextId);
                } else {
                    persistActiveServerId(null);
                }
                return nextId;
            });
            setLoading(false);
        };

        window.addEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotUpdate);
        return () => window.removeEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotUpdate);
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        writeSessionSnapshot(SERVER_CONTEXT_SNAPSHOT_KEY, {
            servers,
            activeServerId,
        });
    }, [activeServerId, enabled, servers]);

    const selectServer = () => {
        const nextId = resolvePreferredServerId(serversStateRef.current);
        setActiveServerId(nextId);
        persistActiveServerId(nextId);
    };

    const activeServer = servers.find((s) => s.id === activeServerId) || null;

    const addServer = async (serverData: any) => {
        const res = await api.post('/servers', serverData);
        if (res.data.success) {
            invalidateServerPanelDataCache();
            await fetchServers({ force: true });
            selectServer();
        }
        return res.data;
    };

    const addServersBatch = async (payload: any) => {
        const res = await api.post('/servers/batch', payload);
        if (res.data.success) {
            invalidateServerPanelDataCache();
            await fetchServers({ force: true });
        }
        return res.data;
    };

    const updateServer = async (id: string | number, serverData: any) => {
        const res = await api.put(`/servers/${id}`, serverData);
        if (res.data.success) {
            invalidateServerPanelDataCache();
            await fetchServers({ force: true });
        }
        return res.data;
    };

    const removeServer = async (id: string | number) => {
        const res = await api.delete(`/servers/${id}`);
        if (res.data.success) {
            invalidateServerPanelDataCache();
            if (activeServerId === id) {
                setActiveServerId('global');
                persistActiveServerId('global');
            }
            await fetchServers({ force: true });
        }
        return res.data;
    };

    const testConnection = async (id: string | number, payload: any = {}) => {
        const res = await api.post(`/servers/${id}/test`, payload);
        return res.data;
    };

    // Helper: make a proxied API call to the active server
    const panelApi = useCallback((method: string, path: string, data?: any, config?: any) => {
        if (!activeServerId) throw new Error('No server selected');
        const url = `/panel/${activeServerId}${path}`;
        return api({ method, url, data, ...config });
    }, [activeServerId]);

    return (
        <ServerContext.Provider value={{
            servers, activeServer, activeServerId,
            loading, selectServer, addServer,
            addServersBatch,
            updateServer, removeServer, testConnection,
            fetchServers, panelApi,
        }}>
            {children}
        </ServerContext.Provider>
    );
}

export function useServer(): ServerContextType {
    const ctx = useContext(ServerContext);
    if (!ctx) throw new Error('useServer must be used within ServerProvider');
    return ctx;
}
