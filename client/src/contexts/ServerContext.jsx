import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client.js';
import { readSessionSnapshot, SESSION_SNAPSHOT_EVENT, writeSessionSnapshot } from '../utils/sessionSnapshot.js';

const ServerContext = createContext(null);
const ACTIVE_SERVER_KEY = 'nms_active_server';
const LEGACY_ACTIVE_SERVER_KEY = 'xui_active_server';
const SERVER_CONTEXT_SNAPSHOT_KEY = 'server_context_bootstrap_v1';
const SERVER_CONTEXT_SNAPSHOT_TTL_MS = 2 * 60_000;
const SERVER_FETCH_TTL_MS = 10_000;

function readServerContextSnapshot() {
    const snapshot = readSessionSnapshot(SERVER_CONTEXT_SNAPSHOT_KEY, {
        maxAgeMs: SERVER_CONTEXT_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    const servers = Array.isArray(snapshot?.servers) ? snapshot.servers : [];
    const activeServerId = String(snapshot?.activeServerId || '').trim() || null;

    return {
        servers,
        activeServerId: activeServerId || (servers.length > 0 ? 'global' : null),
    };
}

function getStoredActiveServerId() {
    const value = localStorage.getItem(ACTIVE_SERVER_KEY);
    if (value) return value;

    const legacyValue = localStorage.getItem(LEGACY_ACTIVE_SERVER_KEY);
    if (legacyValue) {
        localStorage.setItem(ACTIVE_SERVER_KEY, legacyValue);
        localStorage.removeItem(LEGACY_ACTIVE_SERVER_KEY);
        return legacyValue;
    }

    return null;
}

function persistActiveServerId(value) {
    if (value) {
        localStorage.setItem(ACTIVE_SERVER_KEY, value);
        localStorage.removeItem(LEGACY_ACTIVE_SERVER_KEY);
        return;
    }

    localStorage.removeItem(ACTIVE_SERVER_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_SERVER_KEY);
}

function resolvePreferredServerId(serverList = [], ...candidates) {
    const hasServers = Array.isArray(serverList) && serverList.length > 0;
    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (!normalized) continue;
        if (normalized === 'global') {
            return hasServers ? 'global' : null;
        }
        if (serverList.some((server) => server?.id === normalized)) {
            return normalized;
        }
    }
    return hasServers ? 'global' : null;
}

export function ServerProvider({ children }) {
    const bootstrapRef = useRef(readServerContextSnapshot());
    const [servers, setServers] = useState(() => bootstrapRef.current?.servers || []);
    const [activeServerId, setActiveServerId] = useState(
        () => bootstrapRef.current?.activeServerId
            || getStoredActiveServerId()
            || (bootstrapRef.current?.servers?.length ? 'global' : null)
    );
    const [loading, setLoading] = useState(() => bootstrapRef.current == null);
    const serversStateRef = useRef(bootstrapRef.current?.servers || []);
    const fetchServersPendingRef = useRef(null);
    const lastFetchedAtRef = useRef(bootstrapRef.current ? Date.now() : 0);

    useEffect(() => {
        serversStateRef.current = servers;
    }, [servers]);

    const fetchServers = useCallback(async (options = {}) => {
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
                const serverList = res.data.obj || [];
                lastFetchedAtRef.current = Date.now();
                serversStateRef.current = serverList;
                setServers(serverList);

                setActiveServerId((prevId) => {
                    const persistedId = getStoredActiveServerId();
                    const preferredId = prevId || persistedId;

                    if (preferredId === 'global') return 'global';

                    const exists = preferredId && serverList.some(s => s.id === preferredId);
                    const nextId = exists ? preferredId : 'global';

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
    }, [servers.length]);

    useEffect(() => {
        fetchServers({ preserveCurrent: bootstrapRef.current != null });
    }, [fetchServers]);

    useEffect(() => {
        const handleSnapshotUpdate = (event) => {
            const detail = event?.detail && typeof event.detail === 'object' ? event.detail : null;
            if (!detail || detail.key !== SERVER_CONTEXT_SNAPSHOT_KEY || detail.source !== 'app-bootstrap') return;
            const snapshot = readServerContextSnapshot();
            if (!snapshot) return;
            setServers(snapshot.servers);
            setActiveServerId((currentId) => {
                const persistedId = getStoredActiveServerId();
                const nextId = resolvePreferredServerId(
                    snapshot.servers,
                    currentId,
                    persistedId,
                    snapshot.activeServerId
                );
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
    }, []);

    useEffect(() => {
        writeSessionSnapshot(SERVER_CONTEXT_SNAPSHOT_KEY, {
            servers,
            activeServerId,
        });
    }, [servers, activeServerId]);

    const selectServer = (id) => {
        setActiveServerId(id);
        persistActiveServerId(id);
    };

    const activeServer = servers.find(s => s.id === activeServerId) || null;

    const addServer = async (serverData) => {
        const res = await api.post('/servers', serverData);
        if (res.data.success) {
            await fetchServers({ force: true });
            if (!activeServerId) {
                selectServer(res.data.obj.id);
            }
        }
        return res.data;
    };

    const addServersBatch = async (payload) => {
        const res = await api.post('/servers/batch', payload);
        if (res.data.success) {
            await fetchServers({ force: true });
        }
        return res.data;
    };

    const updateServer = async (id, serverData) => {
        const res = await api.put(`/servers/${id}`, serverData);
        if (res.data.success) {
            await fetchServers({ force: true });
        }
        return res.data;
    };

    const removeServer = async (id) => {
        const res = await api.delete(`/servers/${id}`);
        if (res.data.success) {
            if (activeServerId === id) {
                setActiveServerId('global');
                persistActiveServerId('global');
            }
            await fetchServers({ force: true });
        }
        return res.data;
    };

    const testConnection = async (id, payload = {}) => {
        const res = await api.post(`/servers/${id}/test`, payload);
        return res.data;
    };

    // Helper: make a proxied API call to the active server
    const panelApi = useCallback((method, path, data, config) => {
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

export function useServer() {
    const ctx = useContext(ServerContext);
    if (!ctx) throw new Error('useServer must be used within ServerProvider');
    return ctx;
}
