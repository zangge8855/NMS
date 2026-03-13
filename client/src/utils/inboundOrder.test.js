import {
    moveServerGroupToPosition,
    moveInboundWithinServerToPosition,
    normalizeInboundOrderMap,
    reorderInboundsWithinServer,
    sortInboundsByOrder,
    sortServersByOrder,
} from './inboundOrder.js';

describe('inbound order helpers', () => {
    it('normalizes and de-duplicates order maps', () => {
        expect(normalizeInboundOrderMap({
            ' server-a ': [' 2 ', '2', '', '1'],
            '': ['3'],
            'server-b': 'bad-value',
        })).toEqual({
            'server-a': ['2', '1'],
        });
    });

    it('sorts inbounds by persisted order and fallback fields', () => {
        const inbounds = [
            { id: '2', serverId: 'server-a', serverName: 'A', port: 2002, remark: 'B' },
            { id: '1', serverId: 'server-a', serverName: 'A', port: 2001, remark: 'A' },
            { id: '9', serverId: 'server-b', serverName: 'B', port: 9001, remark: 'Z' },
        ];

        expect(sortInboundsByOrder(inbounds, {
            'server-a': ['2', '1'],
        }).map((item) => `${item.serverId}:${item.id}`)).toEqual([
            'server-a:2',
            'server-a:1',
            'server-b:9',
        ]);
    });

    it('supports descending server group ordering while keeping per-server order intact', () => {
        const inbounds = [
            { id: '2', serverId: 'server-a', serverName: 'A', port: 2002, remark: 'B' },
            { id: '1', serverId: 'server-a', serverName: 'A', port: 2001, remark: 'A' },
            { id: '9', serverId: 'server-b', serverName: 'B', port: 9001, remark: 'Z' },
        ];

        expect(sortInboundsByOrder(inbounds, {
            'server-a': ['2', '1'],
        }, {
            serverDirection: 'desc',
        }).map((item) => `${item.serverId}:${item.id}`)).toEqual([
            'server-b:9',
            'server-a:2',
            'server-a:1',
        ]);
    });

    it('prefers persisted server order before server-name fallback sorting', () => {
        const inbounds = [
            { id: '2', serverId: 'server-a', serverName: 'A', port: 2002, remark: 'B' },
            { id: '1', serverId: 'server-a', serverName: 'A', port: 2001, remark: 'A' },
            { id: '9', serverId: 'server-b', serverName: 'B', port: 9001, remark: 'Z' },
        ];

        expect(sortInboundsByOrder(inbounds, {
            'server-a': ['1', '2'],
        }, {
            serverOrder: ['server-b', 'server-a'],
        }).map((item) => `${item.serverId}:${item.id}`)).toEqual([
            'server-b:9',
            'server-a:1',
            'server-a:2',
        ]);
    });

    it('reorders inbounds only within the same server group', () => {
        const result = reorderInboundsWithinServer([
            { uiKey: 'a-1', serverId: 'server-a', id: '1' },
            { uiKey: 'a-2', serverId: 'server-a', id: '2' },
            { uiKey: 'b-3', serverId: 'server-b', id: '3' },
        ], 'a-1', 'a-2');

        expect(result.changed).toBe(true);
        expect(result.serverId).toBe('server-a');
        expect(result.inboundIds).toEqual(['2', '1']);
        expect(result.items.map((item) => item.uiKey)).toEqual(['a-2', 'a-1', 'b-3']);
    });

    it('moves an inbound to a numeric position within its server group', () => {
        const result = moveInboundWithinServerToPosition([
            { uiKey: 'a-1', serverId: 'server-a', id: '1' },
            { uiKey: 'a-2', serverId: 'server-a', id: '2' },
            { uiKey: 'a-3', serverId: 'server-a', id: '3' },
            { uiKey: 'b-4', serverId: 'server-b', id: '4' },
        ], 'a-3', 0);

        expect(result.changed).toBe(true);
        expect(result.serverId).toBe('server-a');
        expect(result.inboundIds).toEqual(['3', '1', '2']);
        expect(result.items.map((item) => item.uiKey)).toEqual(['a-3', 'a-1', 'a-2', 'b-4']);
    });

    it('reorders whole server groups while preserving each server block', () => {
        const result = moveServerGroupToPosition([
            { uiKey: 'a-1', serverId: 'server-a', id: '1' },
            { uiKey: 'a-2', serverId: 'server-a', id: '2' },
            { uiKey: 'b-3', serverId: 'server-b', id: '3' },
            { uiKey: 'c-4', serverId: 'server-c', id: '4' },
        ], 'server-c', 0);

        expect(result.changed).toBe(true);
        expect(result.serverIds).toEqual(['server-c', 'server-a', 'server-b']);
        expect(result.items.map((item) => item.uiKey)).toEqual(['c-4', 'a-1', 'a-2', 'b-3']);
    });

    it('sorts server lists by persisted order with name fallback for unknown ids', () => {
        const servers = [
            { id: 'server-b', name: 'Node B' },
            { id: 'server-c', name: 'Node C' },
            { id: 'server-a', name: 'Node A' },
        ];

        expect(sortServersByOrder(servers, ['server-c'])).toEqual([
            { id: 'server-c', name: 'Node C' },
            { id: 'server-a', name: 'Node A' },
            { id: 'server-b', name: 'Node B' },
        ]);
    });
});
