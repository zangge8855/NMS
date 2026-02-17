import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';

const ServerContext = createContext(null);
const ACTIVE_SERVER_KEY = 'nms_active_server';
const LEGACY_ACTIVE_SERVER_KEY = 'xui_active_server';

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

export function ServerProvider({ children }) {
    const [servers, setServers] = useState([]);
    const [activeServerId, setActiveServerId] = useState(getStoredActiveServerId);
    const [loading, setLoading] = useState(true);

    const fetchServers = useCallback(async () => {
        try {
            const res = await api.get('/servers');
            const serverList = res.data.obj || [];
            setServers(serverList);

            setActiveServerId((prevId) => {
                const persistedId = getStoredActiveServerId();
                const preferredId = prevId || persistedId;

                // Allow 'global' to persist
                if (preferredId === 'global') return 'global';

                const exists = preferredId && serverList.some(s => s.id === preferredId);
                // Default to 'global' if previous selection is invalid, or if list is not empty but no selection
                const nextId = exists ? preferredId : 'global';

                persistActiveServerId(nextId);
                return nextId;
            });
        } catch (err) {
            if (err.response?.status !== 403) {
                console.error('Failed to fetch servers:', err);
            }
            setServers([]);
            setActiveServerId('global');
            persistActiveServerId('global');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchServers();
    }, [fetchServers]);

    const selectServer = (id) => {
        setActiveServerId(id);
        persistActiveServerId(id);
    };

    const activeServer = servers.find(s => s.id === activeServerId) || null;

    const addServer = async (serverData) => {
        const res = await api.post('/servers', serverData);
        if (res.data.success) {
            await fetchServers();
            if (!activeServerId) {
                selectServer(res.data.obj.id);
            }
        }
        return res.data;
    };

    const addServersBatch = async (payload) => {
        const res = await api.post('/servers/batch', payload);
        if (res.data.success) {
            await fetchServers();
        }
        return res.data;
    };

    const updateServer = async (id, serverData) => {
        const res = await api.put(`/servers/${id}`, serverData);
        if (res.data.success) {
            await fetchServers();
        }
        return res.data;
    };

    const removeServer = async (id) => {
        const res = await api.delete(`/servers/${id}`);
        if (res.data.success) {
            if (activeServerId === id) {
                setActiveServerId(null);
                persistActiveServerId(null);
            }
            await fetchServers();
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
