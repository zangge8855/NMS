import {
    mergeInboundClientStats,
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
