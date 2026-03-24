import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerDetailSnapshot } from '../lib/serverDetailSnapshotService.js';

test('buildServerDetailSnapshot merges cached status and panel snapshot data', async () => {
    const snapshot = await buildServerDetailSnapshot('server-a', {}, {
        serverStore: {
            getById: (id) => (id === 'server-a'
                ? {
                    id: 'server-a',
                    name: 'Node A',
                    url: 'https://node-a.example.com',
                    username: 'nmsadmin',
                    health: 'healthy',
                }
                : null),
        },
        systemSettingsStore: {
            sortInboundList: (_serverId, inbounds) => [...inbounds].sort((left, right) => Number(right.port || 0) - Number(left.port || 0)),
        },
        collectClusterStatusSnapshot: async () => ({
            items: [
                {
                    serverId: 'server-a',
                    online: true,
                    health: 'healthy',
                    reasonCode: 'none',
                    reasonMessage: '',
                    checkedAt: '2026-03-24T00:00:00.000Z',
                    latencyMs: 42,
                    status: {
                        cpu: 10,
                        mem: { current: 512, total: 1024 },
                        uptime: 300,
                        xray: { version: '1.8.13' },
                    },
                },
            ],
        }),
        getServerPanelSnapshot: async () => ({
            inbounds: [
                { id: 'ib-1', port: 443, remark: 'A' },
                { id: 'ib-2', port: 8443, remark: 'B' },
            ],
            onlines: [{ email: 'alice@example.com' }, 'bob@example.com'],
            inboundsError: null,
            onlinesError: null,
        }),
    });

    assert.equal(snapshot.server.name, 'Node A');
    assert.equal(snapshot.status?.cpu, 10);
    assert.equal(snapshot.statusMeta.online, true);
    assert.equal(snapshot.statusMeta.latencyMs, 42);
    assert.deepEqual(snapshot.inbounds.map((item) => item.id), ['ib-2', 'ib-1']);
    assert.deepEqual(snapshot.onlines, ['alice@example.com', 'bob@example.com']);
    assert.equal(snapshot.warnings.inbounds, '');
    assert.equal(snapshot.warnings.onlines, '');
});

test('buildServerDetailSnapshot throws 404 when the server does not exist', async () => {
    await assert.rejects(
        () => buildServerDetailSnapshot('missing-server', {}, {
            serverStore: {
                getById: () => null,
            },
        }),
        (error) => error?.status === 404
    );
});
