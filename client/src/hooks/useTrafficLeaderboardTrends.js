import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';

function toTrendSeries(points = []) {
    return (Array.isArray(points) ? points : [])
        .map((item) => Number(item?.totalBytes))
        .filter((value) => Number.isFinite(value));
}

export default function useTrafficLeaderboardTrends({
    enabled = false,
    topUsers = [],
    topServers = [],
}) {
    const [userTrends, setUserTrends] = useState({});
    const [serverTrends, setServerTrends] = useState({});
    const requestIdRef = useRef(0);
    const userKey = useMemo(
        () => topUsers.map((item) => String(item?.email || '').trim()).filter(Boolean).join('|'),
        [topUsers]
    );
    const serverKey = useMemo(
        () => topServers.map((item) => String(item?.serverId || '').trim()).filter(Boolean).join('|'),
        [topServers]
    );

    useEffect(() => {
        if (!enabled) {
            setUserTrends({});
            setServerTrends({});
            return undefined;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        const load = async () => {
            const userTargets = topUsers.slice(0, 10);
            const serverTargets = topServers.slice(0, 10);
            const [userResults, serverResults] = await Promise.all([
                Promise.allSettled(
                    userTargets.map(async (item) => {
                        const email = String(item?.email || '').trim();
                        if (!email) return [email, []];
                        const res = await api.get(`/traffic/users/${encodeURIComponent(email)}/trend`, {
                            params: {
                                days: 1,
                                granularity: 'hour',
                            },
                        });
                        return [email, toTrendSeries(res.data?.obj?.points)];
                    })
                ),
                Promise.allSettled(
                    serverTargets.map(async (item) => {
                        const serverId = String(item?.serverId || '').trim();
                        if (!serverId) return [serverId, []];
                        const res = await api.get(`/traffic/servers/${encodeURIComponent(serverId)}/trend`, {
                            params: {
                                days: 1,
                                granularity: 'hour',
                            },
                        });
                        return [serverId, toTrendSeries(res.data?.obj?.points)];
                    })
                ),
            ]);

            if (requestId !== requestIdRef.current) return;

            const nextUserTrends = {};
            userResults.forEach((entry) => {
                if (entry.status !== 'fulfilled') return;
                const [email, series] = entry.value;
                if (!email) return;
                nextUserTrends[email] = series;
            });

            const nextServerTrends = {};
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
    }, [enabled, serverKey, topServers, topUsers, userKey]);

    return {
        userTrends,
        serverTrends,
    };
}
