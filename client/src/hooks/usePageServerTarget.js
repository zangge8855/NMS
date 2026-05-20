import { useCallback, useEffect, useMemo, useState } from 'react';

function normalizeServerList(servers = []) {
    return (Array.isArray(servers) ? servers : [])
        .map((server) => ({
            ...server,
            id: String(server?.id || '').trim(),
        }))
        .filter((server) => server.id);
}

function isConcreteServerId(value) {
    const normalized = String(value || '').trim();
    return Boolean(normalized && normalized !== 'global');
}

export default function usePageServerTarget({ activeServerId, servers = [] }) {
    const serverList = useMemo(() => normalizeServerList(servers), [servers]);
    const concreteActiveServerId = isConcreteServerId(activeServerId)
        ? String(activeServerId).trim()
        : '';
    const [draftServerId, setDraftServerId] = useState('');
    const [pageServerId, setPageServerId] = useState('');

    useEffect(() => {
        const firstServerId = serverList[0]?.id || '';
        const contains = (serverId) => serverList.some((server) => server.id === serverId);

        setDraftServerId((current) => (current && contains(current) ? current : firstServerId));
        setPageServerId((current) => (current && contains(current) ? current : ''));
    }, [serverList]);

    const commitDraftServer = useCallback(() => {
        if (draftServerId) {
            setPageServerId(draftServerId);
        }
    }, [draftServerId]);

    const setPageTargetServerId = useCallback((serverId) => {
        const normalized = String(serverId || '').trim();
        setDraftServerId(normalized);
        setPageServerId(normalized);
    }, []);

    const targetServerId = concreteActiveServerId || pageServerId;
    const isUsingPageServer = !concreteActiveServerId;

    return {
        serverList,
        hasServers: serverList.length > 0,
        targetServerId,
        hasTargetServer: Boolean(targetServerId),
        isUsingPageServer,
        draftServerId,
        setDraftServerId,
        pageServerId,
        setPageTargetServerId,
        commitDraftServer,
    };
}
