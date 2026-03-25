import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildErrorSnapshot,
    getServerLogSnapshot,
    getServerLogSnapshots,
    invalidateServerLogSnapshotCache,
} from '../lib/serverLogsSnapshotService.js';

test.afterEach(() => {
    invalidateServerLogSnapshotCache();
});

test('getServerLogSnapshot reuses cached payloads inside the ttl window', async () => {
    let calls = 0;
    const deps = {
        serverStore: {
            getById: (id) => (id === 'server-a' ? { id: 'server-a', name: 'Node A' } : null),
        },
        fetchServerLogPayload: async () => {
            calls += 1;
            return {
                serverId: 'server-a',
                source: 'panel',
                supported: true,
                warning: '',
                sourcePath: '/panel/api/server/logs/20',
                lines: ['line-a'],
            };
        },
    };

    const first = await getServerLogSnapshot('server-a', { source: 'panel', count: 20 }, deps);
    const second = await getServerLogSnapshot('server-a', { source: 'panel', count: 20 }, deps);

    assert.equal(calls, 1);
    assert.deepEqual(first.lines, ['line-a']);
    assert.deepEqual(second.lines, ['line-a']);
});

test('getServerLogSnapshots returns per-server errors without aborting the whole batch', async () => {
    const items = await getServerLogSnapshots({
        serverIds: ['server-a', 'server-b'],
        source: 'panel',
        count: 10,
    }, {
        serverStore: {
            getAll: () => [
                { id: 'server-a', name: 'Node A' },
                { id: 'server-b', name: 'Node B' },
            ],
            getById: (id) => (
                id === 'server-a'
                    ? { id: 'server-a', name: 'Node A' }
                    : { id: 'server-b', name: 'Node B' }
            ),
        },
        fetchServerLogPayload: async (serverId) => {
            if (serverId === 'server-b') {
                const error = new Error('upstream failed');
                error.status = 502;
                throw error;
            }
            return {
                serverId: 'server-a',
                source: 'panel',
                supported: true,
                warning: '',
                sourcePath: '/panel/api/server/logs/10',
                lines: ['ok-line'],
            };
        },
    });

    assert.equal(items.length, 2);
    assert.equal(items[0].serverId, 'server-a');
    assert.deepEqual(items[0].lines, ['ok-line']);
    assert.equal(items[1].serverId, 'server-b');
    assert.equal(items[1].error?.status, 502);
    assert.equal(items[1].error?.message, 'upstream failed');
});

test('buildErrorSnapshot creates a single-node fallback payload for upstream failures', () => {
    const error = new Error('panel temporarily unavailable');
    error.code = 'PANEL_LOGIN_FAILED';
    error.status = 502;

    const snapshot = buildErrorSnapshot(
        { id: 'server-a', name: 'Node A' },
        { source: 'panel', count: 50 },
        error
    );

    assert.equal(snapshot.serverId, 'server-a');
    assert.equal(snapshot.serverName, 'Node A');
    assert.equal(snapshot.source, 'panel');
    assert.equal(snapshot.count, 50);
    assert.equal(snapshot.supported, false);
    assert.deepEqual(snapshot.lines, []);
    assert.equal(snapshot.error?.code, 'PANEL_LOGIN_FAILED');
    assert.equal(snapshot.error?.status, 502);
    assert.equal(snapshot.error?.message, 'panel temporarily unavailable');
});
