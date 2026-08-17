import { describe, expect, it } from 'vitest';
import {
    moveInboundWithinServerToPosition,
    moveServerGroupToPosition,
    normalizeInboundOrderMap,
    reorderInboundsWithinServer,
    sortInboundsByOrder,
    sortServersByOrder,
} from './inboundOrder';

describe('inboundOrder helpers', () => {
    it('normalizes inbound order maps into server -> id[] arrays', () => {
        expect(normalizeInboundOrderMap({
            ' server-1 ': [' 101 ', '102', '101', ''],
            '': ['1'],
            invalid: null,
        })).toEqual({
            'server-1': ['101', '102'],
        });
    });

    it('sorts servers by persisted serverOrder then fallback name compare', () => {
        const servers = [
            { id: 's2', name: 'Beta' },
            { id: 's1', name: 'Alpha' },
            { id: 's3', name: 'Gamma' },
        ];

        expect(sortServersByOrder(servers, ['s3', 's2']).map((item) => item.id)).toEqual(['s3', 's2', 's1']);
    });

    it('sorts inbounds across servers by serverOrder and per-server inbound order', () => {
        const inbounds = [
            { id: 2, serverId: 's1', serverName: 'A', port: 8080, remark: 'two' },
            { id: 1, serverId: 's1', serverName: 'A', port: 443, remark: 'one' },
            { id: 10, serverId: 's2', serverName: 'B', port: 1000, remark: 'ten' },
        ];

        const sorted = sortInboundsByOrder(inbounds, {
            s1: ['2', '1'],
        }, {
            serverOrder: ['s2', 's1'],
        });

        expect(sorted.map((item) => `${item.serverId}:${item.id}`)).toEqual([
            's2:10',
            's1:2',
            's1:1',
        ]);
    });

    it('reorders inbounds within the same server via drag keys', () => {
        const inbounds = [
            { uiKey: 's1:1', id: 1, serverId: 's1' },
            { uiKey: 's1:2', id: 2, serverId: 's1' },
            { uiKey: 's1:3', id: 3, serverId: 's1' },
        ];

        const result = reorderInboundsWithinServer(inbounds, 's1:3', 's1:1');
        expect(result.changed).toBe(true);
        expect(result.inboundIds).toEqual(['3', '1', '2']);
        expect(result.items.map((item) => item.uiKey)).toEqual(['s1:3', 's1:1', 's1:2']);
    });

    it('moves a server group to a new zero-based index', () => {
        const inbounds = [
            { id: 1, serverId: 's1' },
            { id: 2, serverId: 's2' },
            { id: 3, serverId: 's3' },
        ];

        const result = moveServerGroupToPosition(inbounds, 's3', 0);
        expect(result.changed).toBe(true);
        expect(result.serverIds).toEqual(['s3', 's1', 's2']);
        expect(result.items.map((item) => item.serverId)).toEqual(['s3', 's1', 's2']);
    });

    it('moves an inbound within its server group to a new zero-based index', () => {
        const inbounds = [
            { uiKey: 's1:1', id: 1, serverId: 's1' },
            { uiKey: 's1:2', id: 2, serverId: 's1' },
            { uiKey: 's1:3', id: 3, serverId: 's1' },
        ];

        const result = moveInboundWithinServerToPosition(inbounds, 's1:3', 1);
        expect(result.changed).toBe(true);
        expect(result.inboundIds).toEqual(['1', '3', '2']);
        expect(result.items.map((item) => item.uiKey)).toEqual(['s1:1', 's1:3', 's1:2']);
    });
});
