import {
    extractInboundClients,
    mergeInboundClientStats,
    parseJsonObjectLike,
    resolveClientQuota,
    resolveClientUsed,
    resolveUsagePercent,
    resolveUsageTone,
} from './inboundClients.js';

describe('inbound client helpers', () => {
    it('merges per-client stats into the settings client list', () => {
        const inbound = {
            protocol: 'vless',
            settings: JSON.stringify({
                clients: [
                    {
                        id: 'client-1',
                        email: 'user@example.com',
                        totalGB: 1024,
                    },
                ],
            }),
            clientStats: [
                {
                    id: 'client-1',
                    email: 'user@example.com',
                    up: 10,
                    down: 20,
                },
            ],
        };

        expect(mergeInboundClientStats(inbound)).toEqual([
            {
                id: 'client-1',
                email: 'user@example.com',
                totalGB: 1024,
                up: 10,
                down: 20,
            },
        ]);
    });

    it('accepts object-like inbound settings without dropping clients', () => {
        const inbound = {
            protocol: 'vless',
            settings: {
                clients: [
                    {
                        id: 'client-2',
                        email: 'object@example.com',
                        totalGB: 2048,
                    },
                ],
            },
            clientStats: [
                {
                    id: 'client-2',
                    email: 'object@example.com',
                    up: 30,
                    down: 40,
                },
            ],
        };

        expect(extractInboundClients(inbound)).toEqual([
            {
                id: 'client-2',
                email: 'object@example.com',
                totalGB: 2048,
            },
        ]);
        expect(mergeInboundClientStats(inbound)).toEqual([
            {
                id: 'client-2',
                email: 'object@example.com',
                totalGB: 2048,
                up: 30,
                down: 40,
            },
        ]);
    });

    it('prefers refreshed clientStats traffic over stale settings counters', () => {
        const inbound = {
            protocol: 'vless',
            settings: {
                clients: [
                    {
                        id: 'client-3',
                        email: 'reset@example.com',
                        totalGB: 4096,
                        up: 1024,
                        down: 2048,
                    },
                ],
            },
            clientStats: [
                {
                    id: 'client-3',
                    email: 'reset@example.com',
                    up: 0,
                    down: 0,
                },
            ],
        };

        expect(mergeInboundClientStats(inbound)).toEqual([
            {
                id: 'client-3',
                email: 'reset@example.com',
                totalGB: 4096,
                up: 0,
                down: 0,
            },
        ]);
        expect(resolveClientUsed(mergeInboundClientStats(inbound)[0])).toBe(0);
    });

    it('falls back safely for invalid non-object JSON payloads', () => {
        expect(parseJsonObjectLike('[]', { clients: [] })).toEqual({ clients: [] });
        expect(parseJsonObjectLike('not-json', { clients: [] })).toEqual({ clients: [] });
        expect(extractInboundClients({ settings: 'not-json' })).toEqual([]);
    });

    it('derives quota, used bytes, percent, and tone consistently', () => {
        const client = {
            totalGB: 100,
            up: 10,
            down: 20,
        };

        expect(resolveClientQuota(client)).toBe(100);
        expect(resolveClientUsed(client)).toBe(30);
        expect(resolveUsagePercent(30, 100)).toBe(30);
        expect(resolveUsageTone(30)).toBe('success');
        expect(resolveUsageTone(75)).toBe('warning');
        expect(resolveUsageTone(95)).toBe('danger');
        expect(resolveUsageTone(null)).toBe('neutral');
    });
});
