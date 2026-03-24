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
    assert.deepEqual(snapshot.inbounds, []);
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
    assert.deepEqual(snapshots[1].inbounds, []);
    assert.equal(snapshots[1].inboundsError?.code, 'PANEL_LOGIN_FAILED');
    assert.equal(snapshots[1].onlinesError?.code, 'PANEL_LOGIN_FAILED');
});
