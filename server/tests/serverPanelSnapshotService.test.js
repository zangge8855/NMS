import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getServerPanelSnapshot,
    getServerPanelSnapshots,
    invalidateServerPanelSnapshotCache,
} from '../lib/serverPanelSnapshotService.js';

test('getServerPanelSnapshot degrades auth failures into per-server errors', async () => {
    invalidateServerPanelSnapshotCache();

    const error = new Error('invalid username or password');
    error.code = 'PANEL_LOGIN_FAILED';

    const snapshot = await getServerPanelSnapshot(
        { id: 'server-a', name: 'Node A' },
        {
            force: true,
            includeOnlines: true,
            getAuthenticatedPanelClient: async () => {
                throw error;
            },
        }
    );

    assert.equal(snapshot.server.id, 'server-a');
    assert.equal(snapshot.inbounds, null);
    assert.deepEqual(snapshot.onlines, []);
    assert.equal(snapshot.inboundsError?.code, 'PANEL_LOGIN_FAILED');
    assert.equal(snapshot.inboundsError?.message, 'invalid username or password');
    assert.equal(snapshot.onlinesError?.code, 'PANEL_LOGIN_FAILED');
});

test('getServerPanelSnapshots keeps healthy snapshots when one server auth fails', async () => {
    invalidateServerPanelSnapshotCache();

    const error = new Error('invalid username or password');
    error.code = 'PANEL_LOGIN_FAILED';

    const snapshots = await getServerPanelSnapshots({
        force: true,
        includeOnlines: true,
        servers: [
            { id: 'server-a', name: 'Node A' },
            { id: 'server-b', name: 'Node B' },
        ],
        getAuthenticatedPanelClient: async (serverId) => {
            if (serverId === 'server-b') throw error;
            return {
                get: async () => ({
                    data: {
                        obj: [
                            {
                                id: 'ib-a',
                                protocol: 'vless',
                                enable: true,
                                settings: JSON.stringify({
                                    clients: [{ id: 'uuid-a', email: 'alice@example.com' }],
                                }),
                            },
                        ],
                    },
                }),
                post: async () => ({
                    data: {
                        obj: [{ email: 'alice@example.com', id: 'uuid-a' }],
                    },
                }),
            };
        },
    });

    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].server.id, 'server-a');
    assert.equal(snapshots[0].inbounds.length, 1);
    assert.equal(snapshots[0].inboundsError, null);
    assert.equal(snapshots[1].server.id, 'server-b');
    assert.equal(snapshots[1].inbounds, null);
    assert.equal(snapshots[1].inboundsError?.code, 'PANEL_LOGIN_FAILED');
    assert.equal(snapshots[1].onlinesError?.code, 'PANEL_LOGIN_FAILED');
});

test('getServerPanelSnapshot includes latest 3x-ui last online timestamps when available', async () => {
    invalidateServerPanelSnapshotCache();

    const calls = [];
    const snapshot = await getServerPanelSnapshot(
        { id: 'server-last-online', name: 'Node Last Online' },
        {
            force: true,
            includeOnlines: true,
            getAuthenticatedPanelClient: async () => ({
                get: async (path) => {
                    calls.push(['get', path]);
                    if (path === '/panel/api/inbounds/list') return { data: { obj: [] } };
                    if (path === '/panel/api/nodes/list') return { data: { obj: [] } };
                    throw new Error(`unexpected get ${path}`);
                },
                post: async (path) => {
                    calls.push(['post', path]);
                    if (path === '/panel/api/clients/onlines') {
                        return { data: { obj: ['Alice@Example.com', 'alice@example.com'] } };
                    }
                    if (path === '/panel/api/clients/lastOnline') {
                        return { data: { obj: { 'Alice@Example.com': 1770000000 } } };
                    }
                    throw new Error(`unexpected post ${path}`);
                },
            }),
        }
    );

    assert.deepEqual(snapshot.onlines, [
        { email: 'Alice@Example.com' },
        { email: 'alice@example.com' },
    ]);
    assert.deepEqual(snapshot.lastOnline, {
        'alice@example.com': 1770000000,
    });
    assert.ok(calls.some(([, path]) => path === '/panel/api/clients/lastOnline'));
});

test('getServerPanelSnapshot normalizes 3x-ui guid-scoped online trees', async () => {
    invalidateServerPanelSnapshotCache();

    const snapshot = await getServerPanelSnapshot(
        { id: 'server-guid-online', name: 'Node Guid Online' },
        {
            force: true,
            includeOnlines: true,
            getAuthenticatedPanelClient: async () => ({
                get: async (path) => {
                    if (path === '/panel/api/inbounds/list') return { data: { obj: [] } };
                    if (path === '/panel/api/nodes/list') {
                        return {
                            data: {
                                obj: [
                                    { id: 7, guid: 'guid-a', name: 'Node A' },
                                    { id: 8, guid: 'guid-b', name: 'Node B' },
                                ],
                            },
                        };
                    }
                    throw new Error(`unexpected get ${path}`);
                },
                post: async (path) => {
                    if (path === '/panel/api/clients/onlinesByGuid') {
                        return {
                            data: {
                                success: true,
                                obj: {
                                    'guid-a': ['alice@example.com'],
                                    'guid-b': [{ email: 'bob@example.com', id: 'uuid-b' }],
                                },
                            },
                        };
                    }
                    if (path === '/panel/api/clients/lastOnline') {
                        return { data: { obj: {} } };
                    }
                    throw new Error(`unexpected post ${path}`);
                },
            }),
        }
    );

    assert.deepEqual(snapshot.onlines, [
        { nodeGuid: 'guid-a', nodeId: 7, email: 'alice@example.com' },
        { email: 'bob@example.com', id: 'uuid-b', nodeGuid: 'guid-b', nodeId: 8 },
    ]);
});
