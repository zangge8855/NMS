import { useCallback, useEffect, useMemo, useState } from 'react';

function normalizeServerList<T extends { id?: string | number }>(servers: T[] = []): Array<T & { id: string }> {
    return (Array.isArray(servers) ? servers : [])
        .map((server) => ({
            ...server,
            id: String(server?.id || '').trim(),
        }))
        .filter((server) => server.id);
}

function isConcreteServerId(value: any): boolean {
    const normalized = String(value || '').trim();
    return Boolean(normalized && normalized !== 'global');
}

export interface UsePageServerTargetProps<T extends { id?: string | number } = any> {
    activeServerId?: string | number | null;
    servers?: T[];
}

export interface UsePageServerTargetReturn<T extends { id: string } = any> {
    serverList: T[];
    hasServers: boolean;
    targetServerId: string;
    hasTargetServer: boolean;
    isUsingPageServer: boolean;
    draftServerId: string;
    setDraftServerId: React.Dispatch<React.SetStateAction<string>>;
    pageServerId: string;
    setPageTargetServerId: (serverId: string | number) => void;
    commitDraftServer: () => void;
}

export default function usePageServerTarget<T extends { id?: string | number } = any>({
    activeServerId,
    servers = [],
}: UsePageServerTargetProps<T>): UsePageServerTargetReturn<T & { id: string }> {
    const serverList = useMemo(() => normalizeServerList(servers), [servers]);
    const concreteActiveServerId = isConcreteServerId(activeServerId)
        ? String(activeServerId).trim()
        : '';
    const [draftServerId, setDraftServerId] = useState<string>('');
    const [pageServerId, setPageServerId] = useState<string>('');

    useEffect(() => {
        const firstServerId = serverList[0]?.id || '';
        const contains = (serverId: string) => serverList.some((server) => server.id === serverId);

        setDraftServerId((current) => (current && contains(current) ? current : firstServerId));
        setPageServerId((current) => (current && contains(current) ? current : ''));
    }, [serverList]);

    const commitDraftServer = useCallback(() => {
        if (draftServerId) {
            setPageServerId(draftServerId);
        }
    }, [draftServerId]);

    const setPageTargetServerId = useCallback((serverId: string | number) => {
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
