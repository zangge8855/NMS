import { describe, expect, it } from 'vitest';
import {
    extractInboundClients,
    formatUsagePercentLabel,
    getClientDedupKey,
    mergeInboundClientStats,
    parseJsonObjectLike,
    resolveClientQuota,
    resolveClientUsed,
    resolveUsageBarWidth,
    resolveUsagePercent,
    resolveUsageTone,
} from './inboundClients';

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

    it('keeps entitlement fields from settings when clientStats is stale', () => {
        const inbound = {
            protocol: 'vless',
            settings: {
                clients: [
                    {
                        id: 'client-4',
                        email: 'expiry@example.com',
                        expiryTime: 1800000000000,
                        totalGB: 4096,
                        limitIp: 2,
                        enable: true,
                    },
                ],
            },
            clientStats: [
                {
                    id: 'client-4',
                    email: 'expiry@example.com',
                    expiryTime: 1700000000000,
                    totalGB: 1024,
                    limitIp: 1,
                    enable: false,
                    up: 30,
                    down: 40,
                },
            ],
        };

        expect(mergeInboundClientStats(inbound)).toEqual([
            {
                id: 'client-4',
                email: 'expiry@example.com',
                expiryTime: 1800000000000,
                totalGB: 4096,
                limitIp: 2,
                enable: true,
                up: 30,
                down: 40,
            },
        ]);
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

    it('formats tiny non-zero usage as <1% and applies a visible bar width floor', () => {
        const hundredGb = 100 * 1024 * 1024 * 1024;
        const eightySixMb = 86 * 1024 * 1024;

        expect(formatUsagePercentLabel(eightySixMb, hundredGb)).toBe('<1%');
        expect(formatUsagePercentLabel(0, hundredGb)).toBe('0%');
        expect(formatUsagePercentLabel(50 * 1024 * 1024 * 1024, hundredGb)).toBe('50%');
        expect(formatUsagePercentLabel(150 * 1024 * 1024 * 1024, hundredGb)).toBe('100%');
        expect(formatUsagePercentLabel(eightySixMb, 0)).toBeNull();

        expect(resolveUsageBarWidth(0, hundredGb)).toBe(0);
        expect(resolveUsageBarWidth(eightySixMb, hundredGb)).toBe(2);
        expect(resolveUsageBarWidth(50 * 1024 * 1024 * 1024, hundredGb)).toBe(50);
        expect(resolveUsageBarWidth(150 * 1024 * 1024 * 1024, hundredGb)).toBe(100);
        expect(resolveUsageBarWidth(eightySixMb, 0)).toBe(0);
    });

    it('deduplicates shared s-ui clients across inbounds while keeping distinct 3x-ui clients ungrouped', () => {
        const suiA = getClientDedupKey('srv-1', { suiClientId: 42, email: 'alice@example.com' });
        const suiB = getClientDedupKey('srv-1', { suiClientId: 42, email: 'alice@example.com' });
        expect(suiA).toBe('sui:srv-1:42');
        expect(suiA).toBe(suiB);

        const xuiA = getClientDedupKey('srv-1', { id: 'uuid-1', email: 'alice@example.com' });
        expect(xuiA).toBe('');
    });
});
