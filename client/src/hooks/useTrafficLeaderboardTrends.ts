import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

function toTrendSeries(points: any[] = []): number[] {
    return (Array.isArray(points) ? points : [])
        .map((item) => Number(item?.totalBytes))
        .filter((value) => Number.isFinite(value));
}

export interface UseTrafficLeaderboardTrendsOptions {
    enabled?: boolean;
    topUsers?: Array<{ email?: string; [key: string]: any }>;
    topServers?: Array<{ serverId?: string; [key: string]: any }>;
    days?: number;
    granularity?: string;
}

export interface UseTrafficLeaderboardTrendsReturn {
    userTrends: Record<string, number[]>;
    serverTrends: Record<string, number[]>;
}

export default function useTrafficLeaderboardTrends({
    enabled = false,
    topUsers = [],
    topServers = [],
    days = 1,
    granularity = 'hour',
}: UseTrafficLeaderboardTrendsOptions): UseTrafficLeaderboardTrendsReturn {
    const [userTrends, setUserTrends] = useState<Record<string, number[]>>({});
    const [serverTrends, setServerTrends] = useState<Record<string, number[]>>({});
    const requestIdRef = useRef(0);
    const userKey = useMemo(
        () => topUsers.map((item) => String(item?.email || '').trim()).filter(Boolean).join('|'),
        [topUsers]
    );
    const serverKey = useMemo(
        () => topServers.map((item) => String(item?.serverId || '').trim()).filter(Boolean).join('|'),
        [topServers]
    );

    const topUsersRef = useRef(topUsers);
    const topServersRef = useRef(topServers);
    topUsersRef.current = topUsers;
    topServersRef.current = topServers;

    useEffect(() => {
        if (!enabled) {
            setUserTrends({});
            setServerTrends({});
            return undefined;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        const load = async () => {
            const userTargets = topUsersRef.current.slice(0, 10);
            const serverTargets = topServersRef.current.slice(0, 10);
            const [userResults, serverResults] = await Promise.all([
                Promise.allSettled(
                    userTargets.map(async (item): Promise<[string, number[]]> => {
                        const email = String(item?.email || '').trim();
                        if (!email) return [email, []];
                        const res = await api.get(`/traffic/users/${encodeURIComponent(email)}/trend`, {
                            params: {
                                days,
                                granularity,
                            },
                        });
                        return [email, toTrendSeries(res.data?.obj?.points)];
                    })
                ),
                Promise.allSettled(
                    serverTargets.map(async (item): Promise<[string, number[]]> => {
                        const serverId = String(item?.serverId || '').trim();
                        if (!serverId) return [serverId, []];
                        const res = await api.get(`/traffic/servers/${encodeURIComponent(serverId)}/trend`, {
                            params: {
                                days,
                                granularity,
                            },
                        });
                        return [serverId, toTrendSeries(res.data?.obj?.points)];
                    })
                ),
            ]);

            if (requestId !== requestIdRef.current) return;

            const nextUserTrends: Record<string, number[]> = {};
            userResults.forEach((entry) => {
                if (entry.status !== 'fulfilled') return;
                const [email, series] = entry.value;
                if (!email) return;
                nextUserTrends[email] = series;
            });

            const nextServerTrends: Record<string, number[]> = {};
            serverResults.forEach((entry) => {
                if (entry.status !== 'fulfilled') return;
                const [serverId, series] = entry.value;
                if (!serverId) return;
                nextServerTrends[serverId] = series;
            });

            setUserTrends(nextUserTrends);
            setServerTrends(nextServerTrends);
        };

        load().catch(() => {
            if (requestId !== requestIdRef.current) return;
            setUserTrends({});
            setServerTrends({});
        });

        return undefined;
    }, [enabled, serverKey, userKey, days, granularity]);

    return {
        userTrends,
        serverTrends,
    };
}
